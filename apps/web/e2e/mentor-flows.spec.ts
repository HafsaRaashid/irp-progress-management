import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  addDays, canSubmitFor, civilDate, compareDates, cycleContaining, dayOfWeek, toProgrammeDate,
} from "@irp/core";
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

  test("roster -> review -> record -> transition -> lock, over the mixed persona's first In Review day", async ({
    page,
  }) => {
    await signInAsMentor(page);
    await page.goto("/roster");
    await switchToBatch(page, SEED_BATCH_NAMES.B);

    const chamodiRow = page.locator("table tbody tr").filter({ hasText: "Chamodi Herath" });
    await chamodiRow.getByRole("link", { name: "Review" }).click();
    await expect(page).toHaveURL(/\/review\//);

    // "Save record" is the only action on a day now: it records attendance
    // AND, for a day the student can no longer submit to, finishes it
    // (ADR-0029). Both halves are exercised below, on two different rows,
    // because the difference between them IS the FR-20 safety rule.
    //
    // Rows are chosen by DATE, not by index. An earlier version took
    // .nth(1) on the reasoning that only the newest row is still open --
    // wrong on a Monday, when today AND the previous Friday are both inside
    // grace. How many leading rows are open depends on the weekday and on
    // which days the persona has entries for, so ask canSubmitFor.
    const dateInputs = page.locator('input[type="hidden"][name="date"]');
    await expect(dateInputs.first()).toBeAttached();
    const now = new Date();
    const dates = await Promise.all(
      (await dateInputs.all()).map((l) => l.inputValue()),
    );
    const openCandidates = dates.filter((d) => canSubmitFor(civilDate(d), now));
    const closedCandidates = dates.filter((d) => !canSubmitFor(civilDate(d), now));
    expect(openCandidates.length, "no still-open day on screen").toBeGreaterThan(0);
    expect(closedCandidates.length, "no closed day on screen to finish").toBeGreaterThan(0);

    // The mixed persona's seed pattern skips roughly one working day in six
    // (run-seed.ts: dayIndex % 6 === 3) -- a skipped day has no entry and so
    // no report at all (ADR-0028: a report is born only at student
    // submission), and it shows no "In review" text no matter how the
    // mentor's own record is saved. Pick an open day that ALREADY carries a
    // report before touching anything, so the assertion below is about the
    // save NOT re-locking an in-review day, not about whether a report
    // exists in the first place -- which date this lands on shifts with
    // "today", so it cannot be selected by position.
    let openDate = "";
    for (const candidate of openCandidates) {
      const alreadyInReview = await dayPanelByHiddenDate(page, candidate)
        .getByText("In review")
        .count();
      if (alreadyInReview > 0) {
        openDate = candidate;
        break;
      }
    }
    // The CLOSED half needs the same guard, for the same reason: saveDayRecord
    // only calls transitionDailyReport when the form's hidden `reportId` is
    // non-empty (review-actions.ts), and showForm renders for every weekday
    // that isn't Evaluated yet regardless of whether a report exists at all
    // (page.tsx's `showForm`) -- so the FIRST closed date on screen can be a
    // skipped or absent day with no report, and saving it will correctly
    // leave it unfinished. Picking that date and then asserting "· Saved"
    // was always a test bug, not a locking bug: it exercises a day that has
    // nothing to finish.
    let closedDate = "";
    for (const candidate of closedCandidates) {
      const alreadyInReview = await dayPanelByHiddenDate(page, candidate)
        .getByText("In review")
        .count();
      if (alreadyInReview > 0) {
        closedDate = candidate;
        break;
      }
    }
    // SKIP, not fail, when no open or closed day on screen carries a report.
    // The precondition legitimately does not exist on every run, and a red
    // check that depends on the wall clock teaches the reader to re-run
    // rather than to read -- the same objection playwright.config.ts records
    // against unpinned `workers`.
    //
    // Two independent reasons it can be absent, neither a defect:
    //
    //  1. TIME OF DAY. run-seed.ts writes entries at 17:xx Colombo and gates
    //     every write on `hasHappened` -- "a morning seed run leaves today
    //     honestly pending; an evening run shows it submitted". Seed before
    //     17:00 Colombo and today has no entry, so no report (ADR-0028: a
    //     report is born only at student submission).
    //  2. THE PERSONA'S PATTERN. The mixed persona skips roughly one working
    //     day in six and is absent one in nine. An absence creates no report
    //     either. So either the previous weekday or an older closed day can
    //     be reportless too.
    //
    // Hit either at once -- as on Tue 6 Oct 2026, when the previous weekday
    // was an absence and today was seeded pre-17:00 -- and there is nothing
    // for the corresponding half of this test to act on.
    test.skip(
      openDate === "",
      "no still-open day carries a report in this seed run (seeded before 17:00 Colombo, " +
        "and/or the persona's open days are skips or absences) -- nothing to test the " +
        "non-locking save against",
    );
    test.skip(
      closedDate === "",
      "no closed day carries a report in this seed run (the persona's closed days are all " +
        "skips or absences) -- nothing to test the locking save against",
    );

    // ── half one: a day still inside the window saves WITHOUT finishing ──
    const openPanel = dayPanelByHiddenDate(page, openDate);
    await openPanel.getByRole("checkbox", { name: "Attended" }).check();
    await openPanel.getByRole("checkbox", { name: "Tasks completed" }).check();
    await openPanel.getByRole("textbox").fill("E2E open-day note");

    await openPanel.getByRole("button", { name: "Save record" }).click();

    // Not asserting the transient confirmation: this is the day's FIRST
    // record, so saving flips DayRecordForm's `defaults` from undefined to
    // defined and page.tsx renders those as two separate JSX branches -- the
    // pre-save instance unmounts and a fresh one mounts in the very same
    // update that would have painted the message. A fresh GET proves
    // persistence server-side instead, the same "don't trust the client's
    // optimistic view" standard the submission test applies. page.goto, not
    // page.reload(): reload() risks resubmitting the Server Action post.
    await page.goto(page.url());
    const openAgain = dayPanelByHiddenDate(page, openDate);
    await expect(openAgain.getByRole("checkbox", { name: "Attended" })).toBeChecked();
    await expect(openAgain.getByRole("checkbox", { name: "Tasks completed" })).toBeChecked();
    await expect(openAgain.getByRole("textbox")).toHaveValue("E2E open-day note");
    // Still outstanding, and still editable -- the record saved, the day did
    // not lock, which is the whole point of the FR-20 guard.
    await expect(openAgain.getByText("In review")).toBeVisible();

    // ── half two: a day past its window saves AND finishes ──
    const closedPanel = dayPanelByHiddenDate(page, closedDate);
    const closedLabel = await panelDateLabel(closedPanel);
    await closedPanel.getByRole("checkbox", { name: "Attended" }).check();
    await closedPanel.getByRole("checkbox", { name: "Tasks completed" }).check();
    await closedPanel.getByRole("button", { name: "Save record" }).click();

    // Neither old step exists: a submission lands In review with no mentor
    // click (ADR-0028), and finishing is folded into the save (ADR-0029).
    await expect(page.getByRole("button", { name: "Start review" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark evaluated" })).toHaveCount(0);

    // Two things moved at once on that save: the day was finished, which
    // unmounts DayRecordForm (so dayPanelByHiddenDate stops resolving,
    // FR-20), AND it left the default "In review" filter. Switch to
    // ?show=saved and relocate by date label.
    await page.goto(`${page.url().split("?")[0]}?show=saved`);
    const lockedPanel = dayPanelByLabel(page, closedLabel);
    await expect(lockedPanel.getByText(/· Saved/)).toBeVisible();
    await expect(lockedPanel.getByRole("button")).toHaveCount(0);
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
