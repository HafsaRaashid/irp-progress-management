import { expect, test } from "@playwright/test";
import { SEED_BATCH_NAMES, SEED_STUDENTS } from "@irp/fixtures";
import { signInAsMentor, signInAsStudent, switchToBatch } from "./helpers";

/**
 * Plan 7's dashboards over the seeded personas. Everything here is relational:
 * the seed is a function of the run date (spec §6), so a hard-coded count or
 * percentage would pass today and fail on the 10th.
 */
test.describe("mentor Today (FR-28)", () => {
  test("shows N of M submitted for each seeded batch, with N never exceeding M nor undercounting late submitters", async ({ page }) => {
    await signInAsMentor(page);

    // O-17: the mentor's home now shows ONE calendar for a selected batch,
    // with a chip row to switch -- unlike the old ribbon stack, both
    // batches' regions never coexist on the page at once.
    for (const name of Object.values(SEED_BATCH_NAMES)) {
      await switchToBatch(page, name);
      const section = page.getByRole("region", { name });
      await expect(section).toBeVisible();
      const counts = await section.getByText(/\d+ of \d+ submitted/).textContent();
      const [submitted, enrolled] = /(\d+) of (\d+)/.exec(counts!)!.slice(1).map(Number);
      expect(submitted).toBeLessThanOrEqual(enrolled!);
      expect(enrolled).toBeGreaterThan(0);

      // "submitted" is defined (spec: BatchTodayCounts.submitted) as
      // students with at least one entry for the day, LATE INCLUDED -- so
      // it structurally can never be smaller than the late figure beside
      // it. Unlike a hard-coded ">0", this bound holds regardless of which
      // day the suite happens to run on, and it would catch a counter stuck
      // at 0 even on a day nothing else in this test can distinguish from
      // a genuinely quiet one.
      const lateText = await section.locator('[data-testid^="late-count-"]').textContent();
      const late = Number(/^(\d+)/.exec(lateText!)![1]);
      expect(submitted).toBeGreaterThanOrEqual(late);
    }
  });

  test("M matches the number of rows the Roster shows for the same batch and day", async ({ page }) => {
    await signInAsMentor(page);
    const section = page.getByRole("region", { name: SEED_BATCH_NAMES.A });
    const counts = await section.getByText(/\d+ of \d+ submitted/).textContent();
    const enrolled = Number(/of (\d+)/.exec(counts!)![1]);

    // Address the Roster by the dashboard's OWN reported day, read off
    // `data-date`, rather than letting it default to today. The two differ on
    // a weekend -- the dashboard falls back to the last required day while the
    // Roster defaults to today -- so a comparison against the default would
    // pass Monday to Friday and fail every Saturday. The batch id comes from
    // the same element's testid, so neither value is hard-coded.
    const dayLabel = section.locator('[data-testid^="day-label-"]');
    const isoDate = await dayLabel.getAttribute("data-date");
    const testId = await dayLabel.getAttribute("data-testid");
    const batchId = testId!.replace("day-label-", "");
    expect(isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await page.goto(`/roster?batchId=${batchId}&date=${isoDate!}`);
    await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(enrolled);
  });

  test("renders a calendar grid whose weekday-cell count matches the cycle's required-day count", async ({ page }) => {
    await signInAsMentor(page);
    const section = page.getByRole("region", { name: SEED_BATCH_NAMES.A });
    const figure = section.getByRole("figure");
    const label = await figure.locator("figcaption").textContent();
    const declared = Number(/of (\d+)/.exec(label!)![1]);

    // O-17: CycleCalendar renders one gridcell per calendar day, including
    // weekends and dimmed adjacent-month padding -- neither of those carries
    // the "submit until" wording every real weekday cell's accessible name
    // does (Task 4's cellLabel), so counting by that text is what isolates
    // required days from the rest of the grid.
    const weekdayCells = await figure.getByRole("gridcell", { name: /submit until/i }).count();
    expect(weekdayCells).toBe(declared);
  });

  test("switching the batch chip re-renders the calendar for the newly selected batch", async ({ page }) => {
    await signInAsMentor(page);

    const initialLabel = await page.getByRole("figure").locator("figcaption").textContent();
    expect(initialLabel).toContain(SEED_BATCH_NAMES.A);

    await switchToBatch(page, SEED_BATCH_NAMES.B);

    // One calendar on the page at a time (D3) -- there is no cycle selection
    // on this page to carry over, unlike the Cycles page's batch/cycle pair.
    await expect(page.getByRole("figure")).toHaveCount(1);
    const newLabel = await page.getByRole("figure").locator("figcaption").textContent();
    expect(newLabel).toContain(SEED_BATCH_NAMES.B);
    expect(newLabel).not.toContain(SEED_BATCH_NAMES.A);
  });

  test("the Cycles page lists a row per batch-1 student and never a score", async ({ page }) => {
    await signInAsMentor(page);
    await page.getByRole("link", { name: "Cycles" }).click();
    await expect(page.getByRole("heading", { name: "Cycles" })).toBeVisible();

    const activeBatch1Students = SEED_STUDENTS.filter((s) => s.batch === "A" && s.kind !== "archived");
    for (const s of activeBatch1Students) {
      await expect(page.getByText(s.name)).toBeVisible();
    }
    // The archived persona has left active rosters (FR-5).
    const archived = SEED_STUDENTS.find((s) => s.kind === "archived")!;
    await expect(page.getByText(archived.name)).toHaveCount(0);
    await expect(page.getByText(/awaiting evaluation/i).first()).toBeVisible();
  });
});

test.describe("student home (FR-29, FR-30, design-system §8.2)", () => {
  test("leads with the student's own ribbon above the composer, and the designed empty evaluation state", async ({
    page,
  }) => {
    // §8.2: "Same ribbon, personal marks. The submission box is the primary
    // action and sits immediately below it." Both the ribbon and the strengths
    // prose used to live only on My month, so this is the assertion that keeps
    // them on the page the student actually lands on.
    await signInAsStudent(page);

    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    const figure = page.getByRole("figure");
    await expect(figure).toBeVisible();
    await expect(figure.locator("figcaption")).toHaveText(/Month \d of 6/);
    await expect(page.getByText(/No evaluation yet/)).toBeVisible();
    await expect(page.getByLabel("Entry text")).toBeVisible();

    // Ordering is the actual §8.2 requirement, not merely co-presence: the
    // ribbon has to sit ABOVE the composer. DOCUMENT_POSITION_FOLLOWING means
    // the composer comes after the ribbon in document order.
    const ribbonPrecedesComposer = await page.evaluate(() => {
      const fig = document.querySelector("figure");
      const composer = document.querySelector('textarea[name="body"]');
      if (!fig || !composer) return false;
      return (
        (fig.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      );
    });
    expect(ribbonPrecedesComposer).toBe(true);
  });
});

test.describe("student My month (FR-29, FR-30)", () => {
  test("shows which month the history covers and the student's own pills", async ({ page }) => {
    await signInAsStudent(page);
    await page.getByRole("link", { name: "My month" }).click();

    await expect(page.getByRole("heading", { name: "My month" })).toBeVisible();
    await expect(page.getByText(/Month \d of 6/)).toBeVisible();
    await expect(page.getByText(/\d+% compliance/)).toBeVisible();
    // dev-student-1 is the fully compliant persona, so at least one on-time day.
    await expect(page.locator('[data-status="onTime"]').first()).toBeVisible();
  });

  test("leaves the ribbon and the strengths prose to the home page (§8.2)", async ({ page }) => {
    // The restructure's other half. Without this, the two surfaces could drift
    // back into being near-duplicates and nothing would catch it.
    await signInAsStudent(page);
    await page.getByRole("link", { name: "My month" }).click();
    await expect(page.getByRole("heading", { name: "My month" })).toBeVisible();

    await expect(page.getByRole("figure")).toHaveCount(0);
    await expect(page.getByText("Strengths and areas to develop")).toHaveCount(0);
  });

  test("shows no score, rank or other student's name anywhere on the page (FR-30)", async ({ page }) => {
    await signInAsStudent(page);
    await page.getByRole("link", { name: "My month" }).click();
    await expect(page.getByRole("heading", { name: "My month" })).toBeVisible();

    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/rank|leaderboard|performance index/i);
    for (const other of SEED_STUDENTS.filter((s) => s.externalId !== "dev-student-1")) {
      expect(text).not.toContain(other.name);
    }
  });

  test("a student cannot reach the mentor dashboards, and is not offered them", async ({ page }) => {
    await signInAsStudent(page);
    await expect(page.getByRole("link", { name: "Cycles" })).toHaveCount(0);

    await page.goto("/cycles");
    // Redirected home, not shown a 403 page — the pattern Roster and Review set.
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  });
});
