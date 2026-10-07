import { expect, test } from "@playwright/test";
import { SEED_BATCH_NAMES } from "@irp/fixtures";
import { signInAsMentor, signInAsStudent, switchToBatch } from "./helpers";

/**
 * FR-22/23/24/29: proves the dashboard wiring Task 8 added, end to end --
 * that a real AI-generated evaluation (not a fixture row constructed
 * directly against EvaluationRepo, the way dashboard-service.test.ts and
 * evaluation-repo.test.ts do) shows up both on the mentor's Cycles roster
 * row AND on the student's own home page, through the two reads
 * DashboardService.batchSummary/studentDashboard now perform.
 *
 * Batch 1 (SEED_BATCH_NAMES.A) starts two cycles before "now" (run-seed.ts:
 * `aStart = shiftCycle(currentCycle.start, -2)`), so its Cycle 1 is always
 * closed by the time this suite runs -- no date-relative skip needed, unlike
 * several tests in mentor-flows.spec.ts that must pick a day. dev-student-1
 * ("Dev Student") is Batch 1's own compliant persona and is also the ONLY
 * identity the dev-identity picker can sign in as on the student side
 * (student-flows.spec.ts's own doc comment), so it is the only student this
 * suite can exercise the "My month"/home side against.
 *
 * NEEDS A REAL AI PROVIDER. `evaluateAction` -> API `POST
 * /students/{id}/evaluations` -> EvaluationService -> the Azure OpenAI
 * client configured from AZURE_OPENAI_ENDPOINT/API_KEY/DEPLOYMENT
 * (apps/api/src/config.ts). Playwright's own webServer block
 * (playwright.config.ts) does not set any of those three for the apps/api
 * process, and no AZURE_OPENAI_* value is present in this environment's
 * apps/api/.env either -- so AS WRITTEN, with nothing added to the
 * environment, the "Evaluate" click is expected to surface a 503 (Problem
 * Details via AiProviderUnavailableError -- "No AI provider is configured")
 * rather than a rendered score. That is the correct, honest outcome of
 * running this file in THIS environment, not a bug in the test: O-5 (the AI
 * provider ADR) is still open, and this plan does not invent a mock-server
 * workaround for it (Task 8 brief, Step 17/18). Running this file for real
 * against a configured Azure OpenAI deployment is the only way to exercise
 * the success path before merge -- set AZURE_OPENAI_ENDPOINT/API_KEY/
 * DEPLOYMENT in the environment this spawns `pnpm --filter @irp/api exec tsx
 * src/index.ts` with, and re-run.
 */
test.describe("evaluation flows (FR-22, FR-23, FR-24, FR-29)", () => {
  test("mentor evaluates a closed cycle from Cycles, and the score reaches both the roster row and the student's own home page", async ({
    page,
  }) => {
    await signInAsMentor(page);
    await page.goto("/cycles");
    await switchToBatch(page, SEED_BATCH_NAMES.A);

    // Batch 1's current cycle is its 3rd (two full cycles since aStart);
    // Cycle 1 is the oldest chip offered and is always closed by construction
    // (see the file doc comment above) -- no isWeekday/date-relative guard
    // needed, unlike mentor-flows.spec.ts's Saturday-dependent assertions.
    await page.getByRole("link", { name: "Cycle 1", exact: true }).click();
    await expect(page.getByRole("link", { name: "Cycle 1", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const devStudentRow = page.locator("table tbody tr").filter({ hasText: "Dev Student" });
    await expect(devStudentRow).toBeVisible();

    const evaluateButton = devStudentRow.getByRole("button", { name: "Evaluate" });
    // Nothing to evaluate yet (cycle closed, no Evaluation row) is the only
    // state this row can be in on a freshly seeded database -- the seed never
    // creates Evaluation rows itself (run-seed.ts has no such step).
    await expect(evaluateButton).toBeVisible();
    await evaluateButton.click();

    // See the file doc comment: this assertion is written for the SUCCESS
    // path (a real Azure OpenAI deployment configured), and genuinely fails
    // -- with a visible 503 alert instead -- in an environment with no
    // AZURE_OPENAI_* credentials. That failure is the honest, expected
    // result here; it is not papered over with a try/catch or a soft skip.
    await expect(devStudentRow.getByRole("alert")).toHaveCount(0);
    const scoreText = await devStudentRow.locator('[data-testid^="evaluation-"]').textContent();
    expect(scoreText, "expected a rendered performanceIndex, not the Evaluate button still showing").toMatch(/^\d+$/);

    // ── student side: the same evaluation's summary on the home page ──
    await signInAsStudent(page);
    await page.goto("/");
    await expect(page.getByText("Strengths and areas to develop")).toBeVisible();
    await expect(page.getByText(/No evaluation yet/)).toHaveCount(0);
  });
});
