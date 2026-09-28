import { expect, test } from "@playwright/test";
import {
  addDays,
  civilDate,
  compareDates,
  isWeekday,
  previousWeekday,
  submissionWindow,
  toProgrammeDate,
} from "@irp/core";
import { dayPanelByLabel, formatCivilDateLabel, signInAsStudent } from "./helpers";

/**
 * Student-side flows over the seeded personas (Plan 6 spec §7). Every test
 * signs in fresh as `dev-student-1` ("Dev Student", the compliant persona,
 * Batch 1) via the exact dev-identity-picker selectors signin.spec.ts
 * established -- the picker itself still only carries three entries (Plan 5
 * kept it that way; Plan 6 did not extend it), so a Student flow can only
 * ever be driven as this one persona. Every other persona in @irp/fixtures
 * is exercised from the MENTOR's side instead, in mentor-flows.spec.ts.
 *
 * playwright.config.ts sets `fullyParallel: false`, so tests in this file
 * run once each, strictly in declaration order, in the same worker --
 * exactly like signin.spec.ts's five tests. That ordering is load-bearing
 * here: the absence round-trip test runs FIRST and specifically targets
 * "today", because dev-student-1 is compliant and already holds an entry on
 * every PAST required day the seed could reach -- today is the only weekday
 * that can still be empty, and only until the compliant persona's on-time
 * seed instant (17:1x-17:49 Colombo) has passed. The on-time submission test
 * runs second and reuses "today" only after the absence round-trip has
 * cleanly returned it to empty (mark, verify, remove, verify). Every
 * date-dependent test in this file records which branch it actually took as
 * a Playwright annotation (`type: "relative-date"`/`"window-size"`) -- see
 * the Task 16 report for a run's full set.
 */

test.describe("student flows (dev-student-1, compliant, Batch 1)", () => {
  test("marks and clears an absence for today, when today is still open", async ({ page }) => {
    await signInAsStudent(page);
    const today = toProgrammeDate(new Date());

    if (!isWeekday(today)) {
      test.skip(
        true,
        `Today (${today}) is a weekend. AbsenceToggle never renders for a weekend day ` +
          "(FR-12 -- there is nothing to be absent from), so there is no control to exercise.",
      );
    }

    // Scoped to today's own Panel throughout -- the compliant persona's other
    // visible days never carry an absence, so an unscoped "Remove" would
    // still be unique today, but scoping it removes that "still" and matches
    // the reasonInput/Mark-absent scoping below. toHaveCount(1) is asserted
    // (not swallowed) before probing emptiness: a `.catch(() => false)`
    // around isVisible() would silently treat a strict-mode violation (e.g.
    // today's Panel unexpectedly matching twice) as "not empty" and just
    // skip, masking a real bug as a quiet skip instead of a loud failure.
    const todayPanel = dayPanelByLabel(page, formatCivilDateLabel(today));
    await expect(todayPanel).toHaveCount(1);

    const emptyToday = todayPanel.getByText("No entry for today yet.", { exact: true });
    const isEmpty = await emptyToday.isVisible();
    if (!isEmpty) {
      test.skip(
        true,
        `Today (${today}) already carries a submission. The compliant persona's own on-time ` +
          "seed entry for today lands once the run's wall-clock passes its 17:1x-17:49 Colombo " +
          "instant, and this run started after that -- there is no empty required day left for " +
          "dev-student-1 to exercise the absence round-trip against.",
      );
    }

    const reasonInput = todayPanel.getByLabel(`Absence reason for ${today}`);
    await reasonInput.fill("E2E absence round-trip");
    await todayPanel.getByRole("button", { name: "Mark absent" }).click();

    await expect(todayPanel.getByText(/Marked absent — E2E absence round-trip/)).toBeVisible();

    await todayPanel.getByRole("button", { name: "Remove" }).click();
    await expect(emptyToday).toBeVisible();
  });

  test("submits an entry for today, confirmed with no Late flag after a fresh GET", async ({ page }) => {
    await signInAsStudent(page);
    const marker = `E2E submission check ${String(Date.now())}`;
    const today = toProgrammeDate(new Date());

    // The composer defaults entryDate to targetDates[0], which submissionWindow
    // guarantees is always today -- no need to touch the <select>.
    await page.getByLabel("Entry text").fill(marker);
    await page.getByRole("button", { name: "Submit update" }).click();
    await expect(page.getByText(marker)).toBeVisible();

    // A fresh GET via page.goto, deliberately NOT page.reload(): Next's Server
    // Action form submission leaves the browser's last navigation for this URL
    // recorded as a POST, and reload() silently resubmits it -- demonstrated
    // here as a genuine duplicate entry (two identical paragraphs) the first
    // time this test used reload(). goto("/") is an unambiguous fresh GET, and
    // it is what actually proves the entry and its flags are the server's own
    // view, not this tab's optimistic one.
    await page.goto("/");
    await expect(page.getByText(marker)).toBeVisible();
    await expect(page.getByText("Late", { exact: true })).toHaveCount(0);

    // Today's status pill depends on which weekday the suite lands on: a
    // required weekday reads "On time", a weekend (optional, FR-33) reads
    // "Extra" instead -- neither is wrong, so this only records which branch
    // applied rather than asserting one over the other.
    test.info().annotations.push({
      type: "relative-date",
      description: isWeekday(today)
        ? `Today (${today}) is a weekday -- the entry is required work and reads "On time".`
        : `Today (${today}) is a weekend -- the entry is optional Extra work (FR-33), not "On time".`,
    });
  });

  test("offers exactly the legal submission window, never older than the previous weekday", async ({
    page,
  }) => {
    await signInAsStudent(page);

    // Derived from the same domain function the composer's SSR call uses,
    // rather than a hardcoded count -- submissionWindow's own suite already
    // covers the pure date logic exhaustively; this test is checking the
    // WIRING (that the rendered <option> list is exactly this array), which
    // is what an E2E test can prove and a unit test cannot.
    const expected = submissionWindow(new Date()).targetDates;
    const boundary = previousWeekday(toProgrammeDate(new Date()));

    const options = page.getByLabel("Entry date").locator("option");
    await expect(options).toHaveCount(expected.length);
    const values = await options.evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value));
    expect(values).toEqual(expected);

    for (const value of values) {
      expect(compareDates(civilDate(value), boundary)).toBeGreaterThanOrEqual(0);
    }

    test.info().annotations.push({
      type: "window-size",
      description:
        `Today is ${toProgrammeDate(new Date())}; the composer offered ${String(expected.length)} ` +
        `target date(s): ${expected.join(", ")}.`,
    });
  });

  test("the composer never offers a date outside the submission window, even one the seed marked Evaluated", async ({
    page,
  }) => {
    await signInAsStudent(page);
    const today = toProgrammeDate(new Date());

    // run-seed.ts's own rule (apps/api/src/seed/run-seed.ts): any report
    // older than 14 days is set EVALUATED for every seeded batch-A student --
    // dev-student-1 included, enrolled two cycles (~60 days) back, so there is
    // real history well past that cutoff. -20 days clears it with margin and
    // is always still inside dev-student-1's enrolment.
    let lockedDate = addDays(today, -20);
    while (!isWeekday(lockedDate)) lockedDate = addDays(lockedDate, -1);

    const insideWindow = submissionWindow(new Date()).targetDates.includes(lockedDate);

    if (insideWindow) {
      test.info().annotations.push({
        type: "relative-date",
        description:
          `Branch taken: ${lockedDate} fell INSIDE today's submission window -- attempting a ` +
          "direct submission against it and expecting the API to refuse it.",
      });
      await page.getByLabel("Entry date").selectOption(lockedDate);
      await page.getByLabel("Entry text").fill("Should be refused -- this day is locked.");
      await page.getByRole("button", { name: "Submit update" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      return;
    }

    test.info().annotations.push({
      type: "relative-date",
      description:
        `Branch taken: ${lockedDate} is more than 14 days old, so it is structurally outside ` +
        "every submission window (max span is 4 days, spanning a weekend) -- and Plan 7's My " +
        "month page does not exist yet, so the Today page never lists a day this old at all. " +
        "Its absence from both the composer's <select> and the Recent days list IS the observable " +
        "lock from this page; there is nowhere on the student's own UI closer to FR-20's " +
        '"· Saved" pill (that text only renders on the mentor review page).',
    });
    const values = await page
      .getByLabel("Entry date")
      .locator("option")
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value));
    expect(values).not.toContain(lockedDate);
    await expect(page.getByText(formatCivilDateLabel(lockedDate))).toHaveCount(0);
  });

  test("blocks a student from mentor-only pages, redirecting home", async ({ page }) => {
    await signInAsStudent(page);

    await page.goto("/roster");
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/students");
    await expect(page).toHaveURL(/\/$/);
  });

  test("signs out to the sign-in page", async ({ page }) => {
    await signInAsStudent(page);
    await page.getByRole("button", { name: /Sign out/ }).click();
    await expect(page).toHaveURL(/\/signin/);
  });
});
