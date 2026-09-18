import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { addDays, compareDates, cycleContaining, dayOfWeek, toProgrammeDate } from "@irp/core";
import { SEED_BATCH_NAMES } from "@irp/fixtures";
import {
  dayPanelByHiddenDate,
  dayPanelByLabel,
  panelDateLabel,
  signInAsMentor,
  switchToBatch,
} from "./helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// e2e -> web -> apps -> repo root.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Synchronous on purpose: the archive test blocks on this before its own assertions continue. */
function reseed(): void {
  execSync("pnpm --filter @irp/api run db:seed", {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://irp:irp@127.0.0.1:5433/irp?schema=public",
    },
  });
}

/**
 * Mentor-side flows over the seeded personas (Plan 6 spec §7), signed in as
 * `dev-admin-1` ("Dev Mentor"). Unlike the student suite, the mentor CAN
 * reach every other persona in @irp/fixtures -- roster and review read every
 * batch's students, not just the signed-in identity -- so this file is where
 * Tharindu (archived), Dilini (weekend), and Chamodi (mixed) are actually
 * exercised. Runs in declaration order (playwright.config.ts sets
 * `fullyParallel: false`); the archive test runs before the registration
 * test and reseeds the database in its own cleanup, which is why the
 * registration test can rely on a full, freshly-named batch list afterward.
 */

test.describe("mentor flows (dev-admin-1)", () => {
  test("roster shows one row per active Batch-A student, and the weekend persona's Extra badge when the cycle has a Saturday", async ({
    page,
  }) => {
    await signInAsMentor(page);
    await page.goto("/roster");

    // Batches list startDate-ascending (batch-repo.ts's `list()`), and batch
    // A started two cycles before batch B, so it is already the default
    // selection. Asserted via SEED_BATCH_NAMES rather than a literal: the
    // ordering is what this checks, and it must not re-break on a rename.
    await expect(page.getByRole("link", { name: SEED_BATCH_NAMES.A, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const rows = page.locator("table tbody tr");
    // dev-student-1, Nuwan Perera, Sachini Silva, Kavindu Jayasuriya --
    // Tharindu Weerasinghe is archived and rosterMembers (batch-repo.ts)
    // excludes any student with deletedAt set.
    await expect(rows).toHaveCount(4);
    await expect(page.getByText("Tharindu Weerasinghe")).toHaveCount(0);

    const today = toProgrammeDate(new Date());
    const currentCycle = cycleContaining(today);
    // Most recent Saturday on/before today (dayOfWeek: 0 Sunday ... 6 Saturday).
    const daysSinceSaturday = (dayOfWeek(today) - 6 + 7) % 7;
    const lastSaturday = addDays(today, -daysSinceSaturday);

    if (compareDates(lastSaturday, currentCycle.start) < 0) {
      test.skip(
        true,
        `The most recent Saturday (${lastSaturday}) falls before the current cycle's start ` +
          `(${currentCycle.start}) -- the cycle is too young to contain one yet, so Dilini's ` +
          "weekend persona has no in-cycle Saturday to show an Extra badge for.",
      );
    }

    await switchToBatch(page, SEED_BATCH_NAMES.B);
    await page.getByLabel("Date").fill(lastSaturday);
    await page.getByRole("button", { name: "Go" }).click();

    const dilini = page.locator("table tbody tr").filter({ hasText: "Dilini Rathnayake" });
    await expect(dilini).toBeVisible();
    const extraText = ((await dilini.locator("td").nth(3).textContent()) ?? "").trim();

    // Only skip a zero count when it's actually explained by "this Saturday
    // is in the cycle's first week" (the seed may not have reached its
    // 11:00 Colombo entry instant for it yet at seed time). A zero on any
    // Saturday further into the cycle than that is a real regression in the
    // extra-count computation, not a timing artefact -- fall through and let
    // the match below fail, rather than skipping forever on green.
    const withinFirstWeekOfCycle = compareDates(lastSaturday, addDays(currentCycle.start, 7)) < 0;
    if (extraText === "—" && withinFirstWeekOfCycle) {
      test.skip(
        true,
        `Extra count read 0 on ${lastSaturday}, which falls within the first 7 days of the ` +
          `current cycle (starts ${currentCycle.start}) -- most likely this is that cycle's very ` +
          "first Saturday and the seed ran before its 11:00 Colombo entry instant. No positive " +
          "count exists yet to assert against.",
      );
    }
    // Bare "+N" -- the column header ("Extra (cycle)") carries the word.
    expect(extraText).toMatch(/^\+\d+$/);
  });

  test("roster -> review -> record -> transition -> lock, over the mixed persona's first Submitted day", async ({
    page,
  }) => {
    await signInAsMentor(page);
    await page.goto("/roster");
    await switchToBatch(page, SEED_BATCH_NAMES.B);

    const chamodiRow = page.locator("table tbody tr").filter({ hasText: "Chamodi Herath" });
    await chamodiRow.getByRole("link", { name: "Review" }).click();
    await expect(page).toHaveURL(/\/review\//);

    // The mixed persona's mostly-onTime pattern guarantees at least one
    // Submitted weekday report; "Mark evaluated" renders for a Submitted day
    // directly now -- there is no separate "Start review" step
    // (transition-control.tsx) -- so the first one in DOM order (days
    // render newest-first) is exactly that day.
    const markEvaluatedButton = page.getByRole("button", { name: "Mark evaluated" }).first();
    await expect(markEvaluatedButton).toBeVisible();

    const rawPanel = markEvaluatedButton.locator(
      'xpath=ancestor::div[contains(@class,"rounded-[var(--radius-panel)]")][1]',
    );
    const isoDate = await rawPanel.locator('input[type="hidden"][name="date"]').inputValue();
    // Re-derived via the hidden date input rather than reused as a handle --
    // this locator stays valid for every step below up to (not including)
    // the Evaluated transition, which is exactly when DayRecordForm, and its
    // hidden input, unmount (FR-20).
    const panel = dayPanelByHiddenDate(page, isoDate);
    const dateLabel = await panelDateLabel(panel);

    await panel.getByRole("checkbox", { name: "Attended" }).check();
    await panel.getByRole("checkbox", { name: "Tasks completed" }).check();
    // By label, not role="textbox" -- EntryReviewForm's per-entry "Mentor
    // feedback" textarea(s) now share this panel and the same role, so a
    // bare getByRole("textbox") is ambiguous whenever the day holds an entry.
    await panel.getByLabel(`Mentor note for ${isoDate}`).fill("E2E review note");
    await panel.getByRole("button", { name: "Save record" }).click();

    // Not asserting the transient "Record saved." text: this is this day's
    // FIRST record, so saving flips DayRecordForm's `defaults` prop from
    // undefined to defined -- review/[studentId]/page.tsx renders those as
    // two separate JSX branches, so the pre-save DayRecordForm instance
    // unmounts and a fresh one mounts with `defaults` populated in the very
    // same update that would show the confirmation, before it can reliably
    // paint. A fresh GET proves persistence server-side instead, the same
    // "don't trust the client's optimistic view" standard the submission
    // test applies. page.goto, not page.reload() -- see that test's
    // comment: reload() risks resubmitting the last Server Action form post
    // as a genuine duplicate.
    await page.goto(page.url());
    await expect(panel.getByRole("checkbox", { name: "Attended" })).toBeChecked();
    await expect(panel.getByRole("checkbox", { name: "Tasks completed" })).toBeChecked();
    await expect(panel.getByLabel(`Mentor note for ${isoDate}`)).toHaveValue("E2E review note");

    // Scoring the entry is itself review activity -- it advances a
    // Submitted day to InReview automatically now, with no separate manual
    // "Start review" click (entry-repo.ts's reviewEntry). .first() in case
    // this day ever holds more than one entry -- only one needs scoring to
    // prove the advance.
    await panel.getByLabel("Score, 0 to 100").first().fill("85");
    await panel.getByLabel("Mentor feedback").first().fill("E2E review feedback.");
    await panel.getByRole("button", { name: "Save review" }).first().click();
    await expect(panel.getByText("In review")).toBeVisible();

    await panel.getByRole("button", { name: "Mark evaluated" }).click();

    // dayPanelByHiddenDate no longer resolves once Evaluated unmounts the
    // form -- relocate the same day by its date label, which FR-20 keeps
    // rendering (locked, not hidden).
    const lockedPanel = dayPanelByLabel(page, dateLabel);
    await expect(lockedPanel.getByText(/· Evaluated/)).toBeVisible();
    await expect(lockedPanel.getByRole("button")).toHaveCount(0);
  });

  test("reviews a submission's score/feedback/evaluation flag, and it persists on reload", async ({
    page,
  }) => {
    // FR-10/FR-11/FR-19, ASSUMPTION: O-18. The previous test already proves
    // an Evaluated day withholds every button in its panel, review control
    // included (`lockedPanel.getByRole("button")).toHaveCount(0)`) -- this
    // test only needs to prove the control works and its write survives a
    // reload, the same "don't trust the client's optimistic view" standard
    // the day-record test above applies.
    await signInAsMentor(page);
    await page.goto("/roster");
    await switchToBatch(page, SEED_BATCH_NAMES.B);

    const chamodiRow = page.locator("table tbody tr").filter({ hasText: "Chamodi Herath" });
    await chamodiRow.getByRole("link", { name: "Review" }).click();
    await expect(page).toHaveURL(/\/review\//);

    const scoreInput = page.getByLabel("Score, 0 to 100").first();
    await expect(scoreInput).toBeVisible();
    const form = scoreInput.locator("xpath=ancestor::form[1]");
    // Re-derived via the hidden entryId input rather than reused as a
    // handle, the same reasoning dayPanelByHiddenDate documents -- this
    // locator stays valid after the reload below re-renders the tree.
    const entryId = await form.locator('input[type="hidden"][name="entryId"]').inputValue();

    await form.getByLabel("Score, 0 to 100").fill("90");
    await form.getByLabel("Mentor feedback").fill("E2E review feedback.");
    await form.getByLabel("Counts toward evaluation").check();
    await form.getByRole("button", { name: "Save review" }).click();
    await expect(form.getByText("Review saved.")).toBeVisible();

    // page.goto, not page.reload() -- reload() risks resubmitting the last
    // Server Action form post as a genuine duplicate (same reasoning as the
    // day-record test above).
    await page.goto(page.url());
    const reloadedForm = page.locator(
      `xpath=//input[@type="hidden" and @name="entryId" and @value="${entryId}"]/ancestor::form[1]`,
    );
    await expect(reloadedForm.getByLabel("Score, 0 to 100")).toHaveValue("90");
    await expect(reloadedForm.getByLabel("Mentor feedback")).toHaveValue("E2E review feedback.");
    await expect(reloadedForm.getByLabel("Counts toward evaluation")).toBeChecked();
  });

  test("archives a non-self student, then restores the persona set via reseed", async ({ page }) => {
    // Reseeding for real (execSync, below) routinely takes several seconds --
    // budget for it explicitly rather than relying on the config default.
    test.setTimeout(120_000);

    await signInAsMentor(page);
    await page.goto("/students");

    const chamodiListItem = page.locator("li").filter({ hasText: "Chamodi Herath" });
    await expect(chamodiListItem).toBeVisible();
    await chamodiListItem.getByRole("button", { name: "Archive" }).click();
    await expect(page.locator("li").filter({ hasText: "Chamodi Herath" })).toHaveCount(0);

    await page.goto("/students?view=archived");
    await expect(page.getByText("Chamodi Herath")).toBeVisible();

    // Brief's two documented options: leave her archived and let the next
    // db:seed restore her, or reseed right here. Reseeding here is chosen so
    // every OTHER gate that runs after this file in the same session --
    // manual poking at the dev DB included -- sees the full ten-persona set
    // rather than one silently missing member.
    reseed();
  });

  test("registers a throwaway batch-B student, sees them on the roster, then archives them", async ({
    page,
  }) => {
    await signInAsMentor(page);
    // Register moved to /settings (ADR-0022, Task 7) -- the People directory
    // (the <li> list Archive lives on, checked below) stayed on /students,
    // so this test now legitimately spans both pages.
    await page.goto("/settings");

    const stamp = String(Date.now());
    const email = `e2e.throwaway.${stamp}@dev.local`;
    const displayName = `E2E Throwaway ${stamp}`;
    const externalId = `e2e-throwaway-${stamp}`;
    const today = toProgrammeDate(new Date());

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Display name").fill(displayName);
    await page.getByLabel("External id").fill(externalId);
    // exact: true throughout -- getByLabel's default substring match (case-
    // insensitive) makes "Batch" match CreateBatchForm's "Batch name"/"Batch
    // start date"/"Batch end date" too, and "Start date" matches "Batch
    // start date" the same way -- both are strict-mode violations without it.
    await page.getByLabel("Batch", { exact: true }).selectOption({ label: SEED_BATCH_NAMES.B });
    await page.getByLabel("Start date", { exact: true }).fill(today);
    await page.getByRole("button", { name: "Register" }).click();
    await expect(page.getByText("Registered.")).toBeVisible();

    // The People directory itself is on /students, not /settings -- confirm
    // the new row landed there before checking the roster and archiving.
    await page.goto("/students");
    await expect(page.locator("li").filter({ hasText: displayName })).toBeVisible();

    await page.goto("/roster");
    await switchToBatch(page, SEED_BATCH_NAMES.B);
    await expect(page.getByText(displayName)).toBeVisible();

    // externalId here is NOT in SEED_EXTERNAL_IDS (@irp/fixtures), so
    // db:seed's idempotent wipe will never remove this row -- archive it in
    // this same test to keep the dev DB tidy, per the brief.
    await page.goto("/students");
    await page.locator("li").filter({ hasText: displayName }).getByRole("button", { name: "Archive" }).click();
    await expect(page.locator("li").filter({ hasText: displayName })).toHaveCount(0);
  });
});
