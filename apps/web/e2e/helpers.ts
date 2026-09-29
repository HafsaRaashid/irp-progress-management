import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Shared plumbing for student-flows.spec.ts and mentor-flows.spec.ts.
 * Sign-in reuses signin.spec.ts's exact selectors (button name regexes,
 * `data-testid`s) so a change to either suite's login flow is caught in one
 * place, not three.
 */

export async function signInAsStudent(page: Page): Promise<void> {
  await page.goto("/signin");
  await page.getByRole("button", { name: /^Student$/ }).click();
  await expect(page.getByTestId("user-name")).toHaveText("Dev Student");
}

export async function signInAsMentor(page: Page): Promise<void> {
  await page.goto("/signin");
  await page.getByRole("button", { name: /Mentor \(Admin\)/ }).click();
  await expect(page.getByTestId("user-name")).toHaveText("Dev Mentor");
}

/**
 * Switches the Roster page's batch filter and waits for the switch to land
 * before returning. roster/page.tsx's batch selector is a Next `<Link>`, a
 * client-side (History API) transition Playwright's `.click()` does not
 * auto-wait for the way it would a real cross-document navigation -- acting
 * on the date input or table immediately after the click can still observe
 * the PREVIOUS batch's rendered form (its hidden `batchId` input included),
 * so a `date` change submitted right after silently resubmits against the
 * old batch. Waiting for `aria-current="page"` on the new link is what
 * proves the switch actually landed.
 */
export async function switchToBatch(page: Page, batchName: string): Promise<void> {
  await page.getByRole("link", { name: batchName, exact: true }).click();
  await expect(page.getByRole("link", { name: batchName, exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
}

/**
 * Duplicated from apps/web/app/(app)/format-civil-date.ts's
 * formatCivilDateLabel, rather than imported across the `(app)` route-group
 * boundary from e2e/ -- the parenthesized directory name is legal in a
 * relative import specifier, but this is small (10 lines), pure, and stable
 * enough that duplicating it here is less risk than reaching across that
 * boundary from test code. Keep the two in sync if the copy ever drifts.
 */
const WEEKDAY_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  weekday: "long",
  day: "numeric",
  month: "long",
});

export function formatCivilDateLabel(isoDate: string): string {
  const parts = isoDate.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return WEEKDAY_DATE_FORMAT.format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * The Panel wrapping one calendar day on student-today.tsx / the review
 * page, located by its exact rendered date label (SectionLabel's text) --
 * unique per page, since no two days share a date. Panel carries no
 * `data-testid`; `contains(@class, ...)` on the Tailwind arbitrary-value
 * class sidesteps needing to escape `[`, `]`, `(`, `)` for a CSS selector,
 * which XPath's `contains()` never needed in the first place.
 */
export function dayPanelByLabel(page: Page, dateLabel: string): Locator {
  return page.locator(
    // Either title shape: the Review page renders each day title as a real
    // <h2> (so 15+ panels can be skimmed by heading), while the student's
    // own pages still use the SectionLabel <div>. This helper serves both
    // suites, so matching only one silently zero-matched the other.
    `xpath=//div[contains(@class,"rounded-[var(--radius-panel)]") and .//*[self::h2 or contains(@class,"uppercase")][normalize-space(text())="${dateLabel}"]]`,
  );
}

/**
 * The day Panel located via DayRecordForm's hidden `date` input instead of
 * the label text -- precise and collision-proof while the form is mounted
 * (In Review). It stops resolving the instant a day is marked
 * Evaluated, since FR-20 unmounts DayRecordForm entirely at that point; use
 * dayPanelByLabel (captured from panelDateLabel below, before that happens)
 * for any assertion that must survive past the lock.
 */
export function dayPanelByHiddenDate(page: Page, isoDate: string): Locator {
  return page.locator(
    `xpath=//input[@type="hidden" and @name="date" and @value="${isoDate}"]/ancestor::div[contains(@class,"rounded-[var(--radius-panel)]")][1]`,
  );
}

/** The exact rendered date-label text (e.g. "Monday, 27 July") for a day Panel located some other way. */
export async function panelDateLabel(panel: Locator): Promise<string> {
  const text = await panel
    .locator(
      'xpath=.//div[contains(@class,"mb-3") and contains(@class,"justify-between")]//*[self::h2 or contains(@class,"uppercase")]',
    )
    .first()
    .textContent();
  if (text === null) throw new Error("day panel: date-label element not found");
  return text.trim();
}
