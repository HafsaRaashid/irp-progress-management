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

    // The home page's <h1> is the greeting band's salutation, not a static
    // title: the bare <PageTitle>Today</PageTitle> was replaced in the student
    // refresh (design-system §8.2). It is time-of-day dependent, so this
    // matches the three possible salutations rather than pinning one -- a
    // fixed string here would pass only between certain hours in Colombo,
    // which is the kind of gate that fails at 6pm and nowhere else.
    for (const [path, heading] of [
      ["/", /^Good (morning|afternoon|evening)$/],
      ["/my-progress", "My progress"],
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

  test("the ribbon's marks are still drawn when the canvas is dark", async ({ page }) => {
    // The `future` mark is a transparent bar with a --line border: the
    // lowest-contrast element in the system and the likeliest to disappear
    // against a dark canvas. Its presence is assertable; its visibility is not.
    await signInAsMentor(page);
    await page.goto("/");
    await expect(page.getByTestId("ribbon-bar").first()).toBeVisible();
  });

  test("the theme key and its swatches survive dark", async ({ page }) => {
    await signInAsMentor(page);
    await page.goto("/");
    const key = page.getByTestId("ribbon-key");
    await expect(key).toBeVisible();
    await key.getByText("How to read this").click();
    // exact: true -- the key's own closing paragraph ("...missed, then late,
    // then absent, then partly in, then on time.") contains the substring
    // "on time" too, so the default case-insensitive substring match resolves
    // to two elements (the <dt>'s swatch label and that trailing <p>) and
    // trips Playwright's strict mode. The <dt> is the one this test means.
    await expect(key.getByText("On time", { exact: true })).toBeVisible();
  });
});
