import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import StudentReviewPage from "@/app/(app)/review/[studentId]/page";

// Same pattern as roster-page.test.tsx / today-page.test.tsx: StudentReviewPage
// is an async server component. Calling it directly and awaiting the returned
// element is the only way to exercise its branches without a running Next
// server.
const { getCurrentUserOrRedirect, apiClient } = vi.hoisted(() => ({
  getCurrentUserOrRedirect: vi.fn(),
  apiClient: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ getCurrentUserOrRedirect, apiClient }));

// review-actions.ts (unmocked -- exercised for real, same as the SDK-level
// mocking roster-page.test.tsx uses) calls transitionDailyReport,
// upsertDayRecord, and reviewEntry; page.tsx itself calls listStudentDays,
// listUsers, and listDayRecords. All six are mocked here so the whole tree --
// page, TransitionControl, DayRecordForm, EntryReviewForm, and the server
// actions underneath them -- runs without a real client or network access.
const {
  listStudentDays,
  listUsers,
  listDayRecords,
  transitionDailyReport,
  upsertDayRecord,
  reviewEntry,
} = vi.hoisted(() => ({
  listStudentDays: vi.fn(),
  listUsers: vi.fn(),
  listDayRecords: vi.fn(),
  transitionDailyReport: vi.fn(),
  upsertDayRecord: vi.fn(),
  reviewEntry: vi.fn(),
}));
vi.mock("@irp/client", () => ({
  listStudentDays,
  listUsers,
  listDayRecords,
  transitionDailyReport,
  upsertDayRecord,
  reviewEntry,
}));

// redirect() in real Next never returns -- it throws a special NEXT_REDIRECT
// signal that framework internals catch. The mock reproduces just the
// "never returns normally" part with a private sentinel.
const { redirect, REDIRECT_SENTINEL } = vi.hoisted(() => {
  const REDIRECT_SENTINEL = new Error("REDIRECT_SENTINEL");
  return {
    REDIRECT_SENTINEL,
    redirect: vi.fn(() => {
      throw REDIRECT_SENTINEL;
    }),
  };
});
vi.mock("next/navigation", () => ({ redirect }));

// review-actions.ts runs for real (see the @irp/client mock's comment) and
// calls revalidatePath on every success path. Outside an actual Next request
// lifecycle that throws ("static generation store missing"), which the
// error-path tests never hit (an error return skips revalidatePath) but the
// prefill/success-line tests below do -- a no-op stub is all a unit test
// needs, the same way next/navigation's redirect is stubbed above.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ADMIN_USER = {
  id: "1",
  email: "mentor@bistec.test",
  displayName: "Dev Mentor",
  role: "Admin" as const,
};

const STUDENT_USER = {
  id: "2",
  email: "student@bistec.test",
  displayName: "Dev Student",
  role: "Student" as const,
};

const STUDENT = { id: "s1", email: "a.perera@bistecglobal.com", displayName: "Amaya Perera", role: "Student" as const, archived: false };

function params(studentId = "s1") {
  return Promise.resolve({ studentId });
}

// Every test below that renders past the Admin gate needs listDayRecords to
// resolve to *something* -- page.tsx withholds DayRecordForm entirely when
// it errors (see page.tsx's recordsByDate comment), so a test not about
// prefill would otherwise silently lose its "Save record" assertions. Tests
// that care about actual stored records override this with their own
// mockResolvedValue.
function noStoredRecords() {
  listDayRecords.mockResolvedValue({ data: [], error: undefined });
}

describe("StudentReviewPage", () => {
  it("redirects a Student caller to / rather than rendering the review view", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT_USER);

    await expect(StudentReviewPage({ params: params() })).rejects.toBe(REDIRECT_SENTINEL);

    expect(redirect).toHaveBeenCalledWith("/");
    expect(listStudentDays).not.toHaveBeenCalled();
  });

  it("renders the problem detail when listStudentDays errors -- an unknown studentId 404s rather than crashing", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    noStoredRecords();
    listStudentDays.mockResolvedValue({
      data: undefined,
      error: {
        type: "about:blank",
        title: "Not found",
        status: 404,
        detail: "The student does not exist.",
        traceId: "t1",
      },
    });

    render(await StudentReviewPage({ params: params("unknown") }));

    expect(screen.getByRole("alert")).toHaveTextContent("The student does not exist.");
  });

  it("renders days newest-first (R5) -- listStudentDays returns oldest-first", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    noStoredRecords();
    listStudentDays.mockResolvedValue({
      data: [
        { date: "2026-07-28", status: "onTime", reportStatus: null, reportId: null, absenceReason: null, entries: [] },
        { date: "2026-07-29", status: "onTime", reportStatus: null, reportId: null, absenceReason: null, entries: [] },
        { date: "2026-07-30", status: "onTime", reportStatus: null, reportId: null, absenceReason: null, entries: [] },
      ],
      error: undefined,
    });

    render(await StudentReviewPage({ params: params() }));

    const headings = screen.getAllByText(/July/).map((el) => el.textContent);
    // formatCivilDateLabel renders e.g. "Thursday, 30 July" -- the exact
    // weekday-named copy doesn't matter here, only that the newest date
    // (30th) appears before the oldest (28th) in document order.
    const thirtiethIndex = headings.findIndex((t) => t?.includes("30 July"));
    const twentyEighthIndex = headings.findIndex((t) => t?.includes("28 July"));
    expect(thirtiethIndex).toBeGreaterThanOrEqual(0);
    expect(twentyEighthIndex).toBeGreaterThan(thirtiethIndex);
  });

  it("locks an Evaluated day -- no transition button, no record form (FR-20)", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    noStoredRecords();
    listStudentDays.mockResolvedValue({
      data: [
        {
          date: "2026-07-28",
          status: "onTime",
          reportStatus: "Evaluated",
          reportId: "r-a",
          absenceReason: null,
          entries: [
            {
              id: "e1",
              entryDate: "2026-07-28",
              body: "Wrote the review page.",
              submittedAt: "2026-07-28T04:00:00.000Z",
              isLate: false,
              isExtra: false,
              score: 88,
              mentorFeedback: "Already reviewed before the lock.",
              countsTowardEvaluation: true,
            },
          ],
        },
      ],
      error: undefined,
    });

    render(await StudentReviewPage({ params: params() }));

    expect(screen.getByText(/· Evaluated/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark evaluated" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save record" })).not.toBeInTheDocument();
    // FR-20: the API 409s a review write on a locked day, so the review
    // control is withheld entirely rather than offered and failing on
    // submit -- same treatment as the day-record form above.
    expect(screen.queryByRole("button", { name: "Save review" })).not.toBeInTheDocument();
  });

  it("shows a Start review control for a Submitted day", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    noStoredRecords();
    listStudentDays.mockResolvedValue({
      data: [
        {
          date: "2026-07-28",
          status: "onTime",
          reportStatus: "Submitted",
          reportId: "r-c",
          absenceReason: null,
          entries: [
            { id: "e1", entryDate: "2026-07-28", body: "Wrote the review page.", submittedAt: "2026-07-28T04:00:00.000Z", isLate: false, isExtra: false },
          ],
        },
      ],
      error: undefined,
    });

    render(await StudentReviewPage({ params: params() }));

    expect(screen.getByRole("button", { name: "Start review" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark evaluated" })).not.toBeInTheDocument();
  });

  it("hides the record form on a weekend day even when it holds an entry", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    noStoredRecords();
    listStudentDays.mockResolvedValue({
      data: [
        {
          // Saturday -- see weekday.ts's isWeekday. Optional days carry no
          // attendance/tasks record at all (the API 400s), so the form must
          // never render here even though the day is otherwise renderable.
          date: "2026-08-01",
          status: "extra",
          reportStatus: "Submitted",
          reportId: "r-x",
          absenceReason: null,
          entries: [
            { id: "e2", entryDate: "2026-08-01", body: "Extra weekend work.", submittedAt: "2026-08-01T04:00:00.000Z", isLate: false, isExtra: true },
          ],
        },
      ],
      error: undefined,
    });

    render(await StudentReviewPage({ params: params() }));

    expect(screen.queryByRole("button", { name: "Save record" })).not.toBeInTheDocument();
    // The transition control is independent of weekday -- a report exists
    // whenever an entry exists, weekend or not.
    expect(screen.getByRole("button", { name: "Start review" })).toBeInTheDocument();
  });

  it("prefills the review control from the entry's current review -- reopening must not start blank", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    noStoredRecords();
    listStudentDays.mockResolvedValue({
      data: [
        {
          date: "2026-07-28",
          status: "onTime",
          reportStatus: "InReview",
          reportId: "r-e",
          absenceReason: null,
          entries: [
            {
              id: "e1",
              entryDate: "2026-07-28",
              body: "Wrote the review page.",
              submittedAt: "2026-07-28T04:00:00.000Z",
              isLate: false,
              isExtra: false,
              score: 88,
              mentorFeedback: "Solid detail.",
              countsTowardEvaluation: true,
            },
          ],
        },
      ],
      error: undefined,
    });

    render(await StudentReviewPage({ params: params() }));

    expect(screen.getByLabelText("Score, 0 to 100")).toHaveValue(88);
    expect(screen.getByLabelText("Mentor feedback")).toHaveValue("Solid detail.");
    expect(screen.getByLabelText("Counts toward evaluation")).toBeChecked();
  });

  it("surfaces the review action's rejection as role=alert", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    noStoredRecords();
    listStudentDays.mockResolvedValue({
      data: [
        {
          date: "2026-07-28",
          status: "onTime",
          reportStatus: "Submitted",
          reportId: "r-f",
          absenceReason: null,
          entries: [
            {
              id: "e1",
              entryDate: "2026-07-28",
              body: "Wrote the review page.",
              submittedAt: "2026-07-28T04:00:00.000Z",
              isLate: false,
              isExtra: false,
              score: null,
              mentorFeedback: null,
              countsTowardEvaluation: false,
            },
          ],
        },
      ],
      error: undefined,
    });
    reviewEntry.mockResolvedValueOnce({
      data: undefined,
      error: {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        detail: "The day is locked.",
        traceId: "t4",
      },
    });

    render(await StudentReviewPage({ params: params() }));

    fireEvent.change(screen.getByLabelText("Score, 0 to 100"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("Mentor feedback"), { target: { value: "Fine." } });
    fireEvent.click(screen.getByRole("button", { name: "Save review" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The day is locked.");
    expect(reviewEntry).toHaveBeenCalledWith({
      client: {},
      path: { id: "e1" },
      body: { score: 70, feedback: "Fine.", countsTowardEvaluation: false },
    });
  });

  it("surfaces the transition action's rejection as role=alert -- the discarded-error shape Task 12's review rejected", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    noStoredRecords();
    listStudentDays.mockResolvedValue({
      data: [
        {
          date: "2026-07-28",
          status: "onTime",
          reportStatus: "Submitted",
          reportId: "r-c",
          absenceReason: null,
          entries: [],
        },
      ],
      error: undefined,
    });
    transitionDailyReport.mockResolvedValueOnce({
      data: undefined,
      error: {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        detail: "The report is no longer Submitted.",
        traceId: "t2",
      },
    });

    render(await StudentReviewPage({ params: params() }));

    fireEvent.click(screen.getByRole("button", { name: "Start review" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The report is no longer Submitted.");
    expect(transitionDailyReport).toHaveBeenCalledWith({
      client: {},
      path: { id: "r-c" },
      body: { to: "InReview" },
    });
  });

  it("surfaces the day-record save's rejection as role=alert", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    noStoredRecords();
    listStudentDays.mockResolvedValue({
      data: [
        {
          date: "2026-07-28",
          status: "none",
          reportStatus: null,
          reportId: null,
          absenceReason: null,
          entries: [],
        },
      ],
      error: undefined,
    });
    upsertDayRecord.mockResolvedValueOnce({
      data: undefined,
      error: {
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "The record was not saved.",
        traceId: "t3",
      },
    });

    render(await StudentReviewPage({ params: params() }));

    const panel = screen.getByLabelText("Mentor note for 2026-07-28").closest("form");
    expect(panel).not.toBeNull();
    fireEvent.click(within(panel!).getByRole("button", { name: "Save record" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The record was not saved.");
  });

  it("prefills the form from the stored day record -- reopening a recorded day must not start blank", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    listDayRecords.mockResolvedValue({
      data: [
        {
          id: "dr1",
          studentId: "s1",
          date: "2026-07-28",
          attended: true,
          tasksCompleted: false,
          note: "Caught up in the afternoon.",
          recordedById: "m1",
        },
      ],
      error: undefined,
    });
    listStudentDays.mockResolvedValue({
      data: [
        { date: "2026-07-28", status: "onTime", reportStatus: null, reportId: null, absenceReason: null, entries: [] },
      ],
      error: undefined,
    });

    render(await StudentReviewPage({ params: params() }));

    expect(screen.getByLabelText("Attended")).toBeChecked();
    expect(screen.getByLabelText("Tasks completed")).not.toBeChecked();
    expect(screen.getByLabelText("Mentor note for 2026-07-28")).toHaveValue("Caught up in the afternoon.");
  });

  it("preserves the stored checked boxes in the submitted FormData when only the note is edited", async () => {
    // The regression this whole correction exists to prevent: reopening a
    // recorded day, touching only the note field, and having attendance
    // silently revert to false/false because the form started unchecked.
    // defaultChecked (uncontrolled) means the checkbox's live DOM state
    // already reflects the stored record without the mentor touching it --
    // this asserts that state is what actually reaches upsertDayRecord.
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    listDayRecords.mockResolvedValue({
      data: [
        {
          id: "dr1",
          studentId: "s1",
          date: "2026-07-28",
          attended: true,
          tasksCompleted: true,
          note: null,
          recordedById: "m1",
        },
      ],
      error: undefined,
    });
    listStudentDays.mockResolvedValue({
      data: [
        { date: "2026-07-28", status: "onTime", reportStatus: null, reportId: null, absenceReason: null, entries: [] },
      ],
      error: undefined,
    });
    upsertDayRecord.mockResolvedValueOnce({
      data: { id: "dr1", studentId: "s1", date: "2026-07-28", attended: true, tasksCompleted: true, note: "Followed up by evening.", recordedById: "m1" },
      error: undefined,
    });

    render(await StudentReviewPage({ params: params() }));

    fireEvent.change(screen.getByLabelText("Mentor note for 2026-07-28"), {
      target: { value: "Followed up by evening." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save record" }));

    await screen.findByText("Record saved.");
    expect(upsertDayRecord).toHaveBeenCalledWith({
      client: {},
      path: { id: "s1", date: "2026-07-28" },
      body: { attended: true, tasksCompleted: true, note: "Followed up by evening." },
    });
  });

  it("shows a success line after a save resolves without error", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    noStoredRecords();
    listStudentDays.mockResolvedValue({
      data: [
        { date: "2026-07-28", status: "none", reportStatus: null, reportId: null, absenceReason: null, entries: [] },
      ],
      error: undefined,
    });
    upsertDayRecord.mockResolvedValueOnce({
      data: { id: "dr2", studentId: "s1", date: "2026-07-28", attended: false, tasksCompleted: false, note: null, recordedById: "m1" },
      error: undefined,
    });

    render(await StudentReviewPage({ params: params() }));

    expect(screen.queryByText("Record saved.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save record" }));

    expect(await screen.findByText("Record saved.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
