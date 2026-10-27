import { expect, test } from "@playwright/test";
import { signInAsMentor, signInAsStudent } from "./helpers";

/**
 * The switch itself, in the default (light) project. This is the one test that
 * proves the cookie round trip: the attribute must survive a full reload,
 * which only happens if the SERVER read the cookie and stamped it.
 */
test.describe("Settings — theme switch", () => {
  test("choosing dark stamps the attribute and survives a reload", async ({ page }) => {
    await signInAsMentor(page);
    await page.goto("/settings");

    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");

    // ThemeControl (theme-control.tsx) writes the DOM attribute synchronously
    // on click, then persists via a Server Action inside startTransition --
    // deliberately not awaited by the click itself, so the repaint is instant
    // (see the component's own comment on why it does not wait for the round
    // trip). That means .check() resolving proves the DOM changed but says
    // nothing about the cookie: reloading before the action's POST completes
    // races it and reloads BEFORE the server ever set the cookie, losing the
    // choice through no fault of the round trip itself. Waiting for that POST
    // is what makes "survives a reload" test the persistence, not the race.
    const [saveDark] = await Promise.all([
      page.waitForResponse((resp) => resp.request().method() === "POST"),
      page.getByRole("radio", { name: "Dark" }).check(),
    ]);
    expect(saveDark.ok()).toBe(true);
    // Immediate, before any navigation — the control writes the DOM itself.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // The attribute existing is not the claim — the claim is that it APPLIES the
    // dark tokens. This spec runs in the light `chromium` project, so
    // prefers-color-scheme is light and the media query cannot be what sets this:
    // only :root[data-theme="dark"] can. Without this line, typoing that selector
    // leaves every unit and e2e test green while dark is entirely inert.
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      ),
    ).toBe("#121212");

    await page.reload();
    // Survives only if the cookie was written AND the server stamped from it.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Put it back, so this spec leaves no state for another test to inherit.
    const [saveSystem] = await Promise.all([
      page.waitForResponse((resp) => resp.request().method() === "POST"),
      page.getByRole("radio", { name: "Follow system" }).check(),
    ]);
    expect(saveSystem.ok()).toBe(true);
    await page.reload();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  });

  test("a student reaches Settings and gets Appearance alone", async ({ page }) => {
    await signInAsStudent(page);
    await page.goto("/settings");

    await expect(page.getByRole("radio", { name: "Follow system" })).toBeVisible();
    await expect(page.getByLabel("Role")).toHaveCount(0);
    await expect(page.getByLabel("Batch name")).toHaveCount(0);
  });

  test("a mentor reaches Settings and gets Appearance alone too (ADR-0034)", async ({ page }) => {
    // Register and Create batch both moved back to /students on 2026-10-08
    // (ADR-0034, reversing ADR-0022) -- unlike before, a MENTOR's Settings
    // page now carries no Register/Create batch section either.
    await signInAsMentor(page);
    await page.goto("/settings");

    await expect(page.getByRole("radio", { name: "Follow system" })).toBeVisible();
    await expect(page.getByLabel("Role")).toHaveCount(0);
    await expect(page.getByLabel("Batch name")).toHaveCount(0);
  });
});
