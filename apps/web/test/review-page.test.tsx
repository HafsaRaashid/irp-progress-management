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
// mocking roster-page.test.tsx uses) calls transitionDailyReport and
// upsertDayRecord; page.tsx itself calls listStudentDays, listUsers, and
// listDayRecords. All five are mocked here so the whole tree -- page,
// DayRecordForm and the server actions underneath it --
// runs without a real client or network access. transitionDailyReport is
// still here because saveDayRecord calls it to finish a day -- the separate
// "Mark evaluated" control it used to serve is gone.
const { listStudentDays, listUsers, listDayRecords, transitionDailyReport, upsertDayRecord } = vi.hoisted(() => ({
  listStudentDays: vi.fn(),
  listUsers: vi.fn(),
  listDayRecords: vi.fn(),
  transitionDailyReport: vi.fn(),
  upsertDayRecord: vi.fn(),
}));
vi.mock("@irp/client", () => ({
  listStudentDays,
  listUsers,
  listDayRecords,
  transitionDailyReport,
  upsertDayRecord,
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

/**
 * The page reads `?show=` to pick its filter. Default (no argument) is the
 * "Needs review" view, which is what a bare /review/<id> renders.
 */
function searchParams(show?: string) {
  return Promise.resolve(show === undefined ? {} : { show });
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

    await expect(StudentReviewPage({ params: params(), searchParams: searchParams() })).rejects.toBe(REDIRECT_SENTINEL);

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

    render(await StudentReviewPage({ params: params("unknown"), searchParams: searchParams() }));

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

    render(await StudentReviewPage({ params: params(), searchParams: searchParams() }));

    const headings = screen.getAllByText(/July/).map((el) => el.textContent);
    // formatCivilDateLabel renders e.g. "Thursday, 30 July" -- the exact
    // weekday-named copy doesn't matter here, only that the newest date
    // (30th) appears before the oldest (28th) in document order.
    const thirtiethIndex = headings.findIndex((t) => t?.includes("30 July"));
    const twentyEighthIndex = headings.findIndex((t) => t?.includes("28 July"));
    expect(thirtiethIndex).toBeGreaterThanOrEqual(0);
    expect(twentyEighthIndex).toBeGreaterThan(thirtiethIndex);
  });

  // The three-day fixture every filter case below shares: two finished days
  // straddling one still-open day, oldest-first as listStudentDays really
  // returns it, so a filter that merely happened to follow date order would
  // not pass. All three are WEEKDAYS (Mon 27, Tue 28, Wed 29 July) -- an
  // empty weekend day is deliberately dropped from this page, so using one
  // here would make these pass or fail for a reason unrelated to filtering.
  function threeDaysMixed() {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    noStoredRecords();
    listStudentDays.mockResolvedValue({
      data: [
        { date: "2026-07-27", status: "onTime", reportStatus: "Evaluated", reportId: "r-old", absenceReason: null, entries: [] },
        { date: "2026-07-28", status: "onTime", reportStatus: "InReview", reportId: "r-mid", absenceReason: null, entries: [] },
        { date: "2026-07-29", status: "onTime", reportStatus: "Evaluated", reportId: "r-new", absenceReason: null, entries: [] },
      ],
      error: undefined,
    });
  }

  it("defaults to the In review filter, hiding finished days entirely", async () => {
    threeDaysMixed();

    render(await StudentReviewPage({ params: params(), searchParams: searchParams() }));

    expect(screen.getByText("Tuesday 28 July")).toBeInTheDocument();
    // Absent, not merely ordered after. That is the point of the filter: a
    // mentor never scrolls past finished work to reach the rest.
    expect(screen.queryByText("Monday 27 July")).not.toBeInTheDocument();
    expect(screen.queryByText("Wednesday 29 July")).not.toBeInTheDocument();
  });

  it("shows only finished days under ?show=saved", async () => {
    threeDaysMixed();

    render(await StudentReviewPage({ params: params(), searchParams: searchParams("saved") }));

    expect(screen.getByText("Monday 27 July")).toBeInTheDocument();
    expect(screen.getByText("Wednesday 29 July")).toBeInTheDocument();
    expect(screen.queryByText("Tuesday 28 July")).not.toBeInTheDocument();
  });

  it("shows every day, newest first, under ?show=all", async () => {
    threeDaysMixed();

    render(await StudentReviewPage({ params: params(), searchParams: searchParams("all") }));

    const headings = screen.getAllByText(/July/).map((el) => el.textContent);
    expect(headings).toEqual(["Wednesday 29 July", "Tuesday 28 July", "Monday 27 July"]);
  });

  it("falls back to the In review filter for an unrecognised ?show=", async () => {
    threeDaysMixed();

    render(await StudentReviewPage({ params: params(), searchParams: searchParams("nonsense") }));

    expect(screen.getByText("Tuesday 28 July")).toBeInTheDocument();
    expect(screen.queryByText("Wednesday 29 July")).not.toBeInTheDocument();
  });

  it("renders the day titles as real headings so the list can be skimmed", async () => {
    threeDaysMixed();

    render(await StudentReviewPage({ params: params(), searchParams: searchParams("all") }));

    // Styled text is not a heading: with 15+ day panels the page's whole
    // structure is these titles, and a screen-reader user needs to jump
    // between them. They were <div> until this was asserted.
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Wednesday 29 July",
      "Tuesday 28 July",
      "Monday 27 July",
    ]);
  });

  it("counts every group, not just the visible one", async () => {
    threeDaysMixed();

    render(await StudentReviewPage({ params: params(), searchParams: searchParams() }));

    // Counts live on their own line rather than inside the chips, and must
    // be right for groups that are off screen -- a "1 saved" that only
    // became correct once you clicked Saved would defeat the point.
    expect(screen.getByText(/in review/)).toHaveTextContent("1 in review · 2 saved · 3 days this cycle");
    expect(screen.getByRole("link", { name: "In review" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Saved" })).not.toHaveAttribute("aria-current");
  });

  it("drops an empty weekend day, and keeps one that holds an Extra entry", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    noStoredRecords();
    listStudentDays.mockResolvedValue({
      data: [
        // Sat 1 Aug with work on it, Sun 2 Aug with none. A weekend carries
        // no obligation (FR-12) and never enters a denominator (FR-33), so
        // an empty one is not "missing" -- rendering it as "No entry
        // recorded." invented work that does not exist.
        {
          date: "2026-08-01", status: "extra", reportStatus: "InReview", reportId: "r-sat",
          absenceReason: null,
          entries: [
            { id: "e-sat", entryDate: "2026-08-01", body: "Extra weekend work.", submittedAt: "2026-08-01T04:00:00.000Z", isLate: false, isExtra: true },
          ],
        },
        { date: "2026-08-02", status: "none", reportStatus: null, reportId: null, absenceReason: null, entries: [] },
      ],
      error: undefined,
    });

    render(await StudentReviewPage({ params: params(), searchParams: searchParams("all") }));

    expect(screen.getByText("Saturday 1 August")).toBeInTheDocument();
    expect(screen.queryByText("Sunday 2 August")).not.toBeInTheDocument();
    // The Saturday still gets no record form -- FR-19 has nothing to attend
    // on an optional day, and the API 400s such a write.
    expect(screen.queryByRole("button", { name: /^Save/ })).not.toBeInTheDocument();
  });

  it("tells the mentor the queue is empty rather than rendering a blank page", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    noStoredRecords();
    listStudentDays.mockResolvedValue({
      data: [
        { date: "2026-07-28", status: "onTime", reportStatus: "Evaluated", reportId: "r-1", absenceReason: null, entries: [] },
      ],
      error: undefined,
    });

    render(await StudentReviewPage({ params: params(), searchParams: searchParams() }));

    expect(screen.getByText("Nothing left to review for this cycle.")).toBeInTheDocument();
  });

  it("locks a finished day -- no record form at all (FR-20)", async () => {
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
            { id: "e1", entryDate: "2026-07-28", body: "Wrote the review page.", submittedAt: "2026-07-28T04:00:00.000Z", isLate: false, isExtra: false },
          ],
        },
      ],
      error: undefined,
    });

    // ?show=saved, not the default: a locked day is exactly what the
    // default view hides, so asserting the lock there would pass for the
    // wrong reason -- no buttons because no day.
    render(await StudentReviewPage({ params: params(), searchParams: searchParams("saved") }));

    expect(screen.getByText(/· Saved/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark evaluated" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save record" })).not.toBeInTheDocument();
  });

  function oneDay(date: string, reportStatus: "InReview" | "Evaluated" = "InReview") {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({ data: [STUDENT], error: undefined });
    noStoredRecords();
    listStudentDays.mockResolvedValue({
      data: [
        {
          date, status: "onTime", reportStatus, reportId: "r-c", absenceReason: null,
          entries: [
            { id: "e1", entryDate: date, body: "Wrote the review page.", submittedAt: `${date}T04:00:00.000Z`, isLate: false, isExtra: false },
          ],
        },
      ],
      error: undefined,
    });
  }

  it("finishes the day on save once the student can no longer submit to it", async () => {
    // Long past, so canSubmitFor is false and finishing the day is safe.
    oneDay("2026-07-28");

    render(await StudentReviewPage({ params: params(), searchParams: searchParams() }));

    expect(screen.getByRole("button", { name: "Save record" })).toBeInTheDocument();
    // The separate step is gone in both directions -- neither the old
    // "Start review" nor the old "Mark evaluated" exists any more.
    expect(screen.queryByRole("button", { name: "Mark evaluated" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start review" })).not.toBeInTheDocument();
  });

  it("does not finish a day still inside the submission window (FR-20 safety)", async () => {
    // Today. Finishing locks the day against the student (FR-20), and a
    // lock cannot be undone -- so today is never offered as finishable, or
    // a mentor recording morning attendance would take the rest of the
    // student's day away from them.
    const today = new Date().toISOString().slice(0, 10);
    oneDay(today);
    upsertDayRecord.mockResolvedValue({ data: {}, error: undefined });

    render(await StudentReviewPage({ params: params(), searchParams: searchParams() }));

    // Same label as every other row -- what differs is what the save DOES,
    // not what the button is called. The proof it does NOT finish the day
    // is that no transition is attempted at all.
    fireEvent.click(screen.getByRole("button", { name: "Save record" }));
    // "Record saved.", not "Saved — day finished." -- and no transition
    // attempted at all, which is the real assertion here.
    await screen.findByText("Record saved.");
    expect(transitionDailyReport).not.toHaveBeenCalled();
  });

  it("reports a day whose record saved but whose finish was rejected", async () => {
    oneDay("2026-07-28");
    upsertDayRecord.mockResolvedValue({ data: {}, error: undefined });
    transitionDailyReport.mockResolvedValue({
      data: undefined,
      error: { detail: "The report is no longer InReview." },
    });

    render(await StudentReviewPage({ params: params(), searchParams: searchParams() }));
    fireEvent.click(screen.getByRole("button", { name: "Save record" }));

    // The two writes are separate calls, so the mentor must be told when
    // the second fails -- otherwise the record silently saved and the day
    // silently stayed open, which reads as "nothing happened".
    expect(await screen.findByRole("alert")).toHaveTextContent("The report is no longer InReview.");
    expect(transitionDailyReport).toHaveBeenCalledWith({
      client: {},
      path: { id: "r-c" },
      body: { to: "Evaluated" },
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

    render(await StudentReviewPage({ params: params(), searchParams: searchParams() }));

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

    render(await StudentReviewPage({ params: params(), searchParams: searchParams() }));

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

    render(await StudentReviewPage({ params: params(), searchParams: searchParams() }));

    fireEvent.change(screen.getByLabelText("Mentor note for 2026-07-28"), {
      target: { value: "Followed up by evening." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save record" }));

    // Past-dated fixture, so this save also finished the day.
    await screen.findByText("Saved — day finished.");
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

    render(await StudentReviewPage({ params: params(), searchParams: searchParams() }));

    expect(screen.queryByText("Saved — day finished.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save record" }));

    expect(await screen.findByText("Saved — day finished.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
