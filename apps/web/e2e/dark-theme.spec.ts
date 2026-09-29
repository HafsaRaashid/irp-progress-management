import { expect, test } from "@playwright/test";
import { signInAsMentor, signInAsStudent } from "./helpers";

/**
 * The dark guard. Runs ONLY under the `chromium-dark` project
 * (playwright.config.ts scopes it by testMatch), where colorScheme: "dark"
 * makes prefers-color-scheme report dark.
 *
 * Read-only ON PURPOSE. The mutating suites (mentor-flows, student-flows)
 * submit entries, walk reports irreversibly to Evaluated, and reseed mid-run;
 * running them twice in one serial pass is the state-dependence that made this
 * suite flaky before `workers: 1` was pinned. This spec navigates and asserts
 * rendering, nothing else.
 *
 * What it can and cannot catch: it proves every view renders and its landmark
 * content is present with the OS in dark. It does NOT judge whether dark LOOKS
 * right — that is the human pass in Task 9. A test cannot tell you a border
 * vanished into a canvas.
 */
test.describe("dark theme renders every view", () => {
  test("mentor views render with the OS in dark", async ({ page }) => {
    await signInAsMentor(page);

    // Proves colorScheme: "dark" is actually applied by this project rather
    // than silently ignored — without this the whole chromium-dark project
    // could be a no-op that passes for the wrong reason. Keep permanently.
    expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(
      true,
    );

    for (const [path, heading] of [
      ["/", "Today"],
      ["/roster", "Roster"],
      ["/review", "Review"],
      ["/cycles", "Cycles"],
      ["/students", "Students"],
      ["/settings", "Settings"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    }

    // /review/<id>: unlike the six views above, this route needs a real
    // student id, so it isn't a bare path -- reach it the way
    // mentor-flows.spec.ts does, via the Roster's per-row "Review" link.
    // Batch A is already the default selection, so no switchToBatch call is
    // needed. Nuwan Perera (seed-student-a2, "late") is picked over
    // dev-student-1 only because a non-compliant persona is more likely to
    // have a rendered day to look at; either would prove the route renders.
    await page.goto("/roster");
    const nuwanRow = page.locator("table tbody tr").filter({ hasText: "Nuwan Perera" });
    await nuwanRow.getByRole("link", { name: "Review" }).click();
    await expect(page).toHaveURL(/\/review\//);
    await expect(page.getByRole("heading", { name: /^Review/, level: 1 })).toBeVisible();
    // The day list itself: page.tsx always renders at least one Panel here,
    // either a real day (Panel with a date title) or the "no days on record"
    // EmptyState -- both are wrapped in the same Panel class, so asserting
    // one is visible proves the day list rendered without depending on which
    // branch a given persona/run date happens to take.
    await expect(
      page.locator('div[class*="rounded-[var(--radius-panel)]"]').first(),
    ).toBeVisible();
  });

  test("the student's views render with the OS in dark", async ({ page }) => {
    await signInAsStudent(page);

    for (const [path, heading] of [
      ["/", "Today"],
      ["/my-month", "My month"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    }
  });

  test("the bare frames render with the OS in dark", async ({ page }) => {
    // /signin is reachable signed out. /not-registered needs the unregistered
    // dev identity, and helpers.ts exposes no helper for that persona (only
    // signInAsStudent/signInAsMentor exist) -- adding one here would be scope
    // creep for this task. So /not-registered stays unguarded by this suite;
    // see e2e/README.md for the record of that gap. Both are outside the
    // (app) route group and so carry no app chrome, which is what makes them
    // worth a separate check from the six/two views above.
    await page.goto("/signin");
    await expect(page.getByRole("img", { name: "Bistec Hearts Academy" })).toBeVisible();
  });

  test("the calendar's marks are still drawn when the canvas is dark", async ({ page }) => {
    // The `future` mark is a transparent-background cell with a --line
    // border: the lowest-contrast element in the system and the likeliest to
    // disappear against a dark canvas. Its presence is assertable; its
    // visibility is not. O-17: retargeted from the retired CycleRibbon's
    // ribbon-bar testid to CycleCalendar's grid semantics.
    await signInAsMentor(page);
    await page.goto("/");
    await expect(page.getByRole("gridcell", { name: /future/ }).first()).toBeVisible();
  });

  // The mentor-only "How to read this" key (RibbonKey, ADR-0020) has no
  // calendar equivalent (O-17, ADR-0030) -- documented as a known gap in
  // docs/design-system.md §7, not silently dropped. There is nothing left
  // for a dark-mode key test to assert against.
});
