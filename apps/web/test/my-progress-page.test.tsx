import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MyProgressPage from "@/app/(app)/my-progress/page";

const { getCurrentUserOrRedirect, apiClient } = vi.hoisted(() => ({
  getCurrentUserOrRedirect: vi.fn(),
  apiClient: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ getCurrentUserOrRedirect, apiClient }));

const { getMyDashboard, listMyDays } = vi.hoisted(() => ({
  getMyDashboard: vi.fn(),
  listMyDays: vi.fn(),
}));
vi.mock("@irp/client", () => ({ getMyDashboard, listMyDays }));

const STUDENT = { id: "s1", email: "s@bistec.test", displayName: "Dev Student", role: "Student" as const };

const dash = (over: Record<string, unknown> = {}) => ({
  today: "2026-08-03",
  programmeMonths: 6,
  firstEvaluatedCycleStart: "2026-06-10",
  cycle: { seq: 3, startDate: "2026-07-10", endDate: "2026-08-09", requiredDayCount: 22 },
  days: [
    { date: "2026-07-31", status: "onTime" },
    { date: "2026-08-03", status: "late" },
  ],
  extraAfter: ["2026-07-31"],
  summary: {
    requiredDays: 22, settledDays: 17, onTime: 13, late: 2, absent: 1,
    missed: 1, pending: 1, extra: 2, complianceRate: 0.9412,
  },
  strengthsAndWeaknesses: null,
  ...over,
});

describe("MyProgressPage", () => {
  // Same latent risk cycles-page.test.tsx had (Finding 3, Plan 7 whole-branch
  // review): with no clearing, `toHaveBeenCalledWith` could match a call
  // left over from an earlier test rather than the one this test made.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows which month the history covers, and how it came out", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
    listMyDays.mockResolvedValue({ data: [], error: undefined });

    render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(/Month 3 of 6/)).toBeInTheDocument();
    expect(screen.getByText(/94% compliance/)).toBeInTheDocument();
  });

  it("leaves the ribbon to the student's home but now CARRIES the feedback band (ADR-0031)", async () => {
    // The ribbon stays on home, where §8.2 places it: above the composer, on
    // the page the student lands on. A second copy here made this page a
    // near-duplicate of home rather than the day-by-day history FR-29 asks for.
    //
    // The FEEDBACK band moved the other way, which is what ADR-0031 decided and
    // what this assertion flipped to record. It belongs with the history it
    // describes, and it does not earn a nav item of its own: O-5 blocks the AI
    // provider, so strengthsAndWeaknesses is null for every student in this
    // release and a dedicated page would be permanently empty.
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
    listMyDays.mockResolvedValue({ data: [], error: undefined });

    render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.getByText("Strengths and areas to develop")).toBeInTheDocument();
  });

  it("renders the feedback band's empty state while O-5 leaves every evaluation null", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
    listMyDays.mockResolvedValue({ data: [], error: undefined });

    render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

    // §11: empty states are invitations, and the copy says "month", never the
    // internal word "cycle".
    const empty = screen.getByText(/No evaluation yet/);
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toContain("month");
    expect(empty.textContent).not.toContain("cycle");
  });

  it("shows no score, no rank, and no other student anywhere (FR-30)", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
    listMyDays.mockResolvedValue({ data: [], error: undefined });

    const { container } = render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

    expect(container.textContent).not.toMatch(/rank|score|index|leaderboard/i);
  });

  it("tells a mid-cycle joiner when their first evaluated cycle opens, instead of Month null of 6", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({
      data: dash({
        cycle: { seq: null, startDate: "2026-07-10", endDate: "2026-08-09", requiredDayCount: 22 },
        firstEvaluatedCycleStart: "2026-08-10",
      }),
      error: undefined,
    });
    listMyDays.mockResolvedValue({ data: [], error: undefined });

    render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(/first evaluated month starts/i)).toBeInTheDocument();
    expect(screen.queryByText(/Month null/)).not.toBeInTheDocument();
  });

  it("lists the cycle's days newest first, with a status pill and the entry text", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
    listMyDays.mockResolvedValue({
      data: [
        {
          date: "2026-07-31", status: "onTime", reportStatus: "Evaluated", reportId: "r1",
          absenceReason: null,
    mentorNote: null,
          entries: [{
            id: "e1", entryDate: "2026-07-31", body: "Older entry.",
            submittedAt: "2026-07-31T11:30:00.000Z", isLate: false, isExtra: false,
          }],
        },
        {
          date: "2026-08-03", status: "late", reportStatus: "InReview", reportId: "r2",
          absenceReason: null,
    mentorNote: null,
          entries: [{
            id: "e2", entryDate: "2026-08-03", body: "Newer entry.",
            submittedAt: "2026-08-04T04:10:00.000Z", isLate: true, isExtra: false,
          }],
        },
      ],
      error: undefined,
    });

    render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

    const bodies = screen.getAllByTestId("day-entry-body").map((n) => n.textContent);
    expect(bodies).toEqual(["Newer entry.", "Older entry."]);
    // TWO "Late" pills now, not one: the day's own status pill, plus a
    // second on its one entry -- the per-entry meta row added to
    // differentiate entries on the same day marks each one's own
    // late/extra/on-time outcome, independent of the day-level pill.
    expect(screen.getAllByText("Late")).toHaveLength(2);
    expect(screen.getByText(/· Saved/)).toBeInTheDocument();
  });

  it("drops future days and quiet weekends from the history, but keeps a settled day even with no entry (Finding 4)", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
    listMyDays.mockResolvedValue({
      data: [
        // A settled weekday with a real entry -- kept.
        {
          date: "2026-07-31", status: "onTime", reportStatus: "Evaluated", reportId: "r1",
          absenceReason: null,
    mentorNote: null,
          entries: [{
            id: "e1", entryDate: "2026-07-31", body: "Real work.",
            submittedAt: "2026-07-31T11:30:00.000Z", isLate: false, isExtra: false,
          }],
        },
        // A settled weekday with no entry at all (Missed) -- still kept,
        // because "settled" alone is enough; nothing real should disappear.
        {
          date: "2026-08-03", status: "missed", reportStatus: null, reportId: null,
          absenceReason: null,
    mentorNote: null, entries: [],
        },
        // A quiet weekend -- nothing recorded -- dropped.
        {
          date: "2026-08-01", status: "none", reportStatus: null, reportId: null,
          absenceReason: null,
    mentorNote: null, entries: [],
        },
        // A future weekday that hasn't arrived yet -- dropped.
        {
          date: "2026-08-04", status: "future", reportStatus: null, reportId: null,
          absenceReason: null,
    mentorNote: null, entries: [],
        },
      ],
      error: undefined,
    });

    render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Real work.")).toBeInTheDocument();
    expect(screen.getByText("Friday 31 July")).toBeInTheDocument();
    expect(screen.getByText("Monday 3 August")).toBeInTheDocument();
    expect(screen.queryByText("Saturday 1 August")).not.toBeInTheDocument();
    expect(screen.queryByText("Tuesday 4 August")).not.toBeInTheDocument();
  });

  it("shows the (now reachable) empty state once every day on record is future or a quiet weekend (Finding 4 corollary)", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
    listMyDays.mockResolvedValue({
      data: [
        {
          date: "2026-08-01", status: "none", reportStatus: null, reportId: null,
          absenceReason: null,
    mentorNote: null, entries: [],
        },
        {
          date: "2026-08-04", status: "future", reportStatus: null, reportId: null,
          absenceReason: null,
    mentorNote: null, entries: [],
        },
      ],
      error: undefined,
    });

    render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Nothing recorded this month yet.")).toBeInTheDocument();
  });

  it("labels a null compliance rate '— compliance', not a bare dash, among the other labelled figures (Finding 6)", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({
      data: dash({
        summary: {
          requiredDays: 22, settledDays: 0, onTime: 0, late: 0, absent: 0,
          missed: 0, pending: 0, extra: 0, complianceRate: null,
        },
      }),
      error: undefined,
    });
    listMyDays.mockResolvedValue({ data: [], error: undefined });

    render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("— compliance")).toBeInTheDocument();
  });

  it("shows the absence reason on an absent day", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
    listMyDays.mockResolvedValue({
      data: [{
        date: "2026-08-03", status: "absent", reportStatus: null, reportId: null,
        absenceReason: "Medical appointment",
    mentorNote: null, entries: [],
      }],
      error: undefined,
    });

    render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Medical appointment")).toBeInTheDocument();
  });

  it("tells a caller with no enrolment at all, instead of a stray Month figure", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({
      data: dash({
        cycle: { seq: null, startDate: "2026-07-10", endDate: "2026-08-09", requiredDayCount: 22 },
        firstEvaluatedCycleStart: null,
      }),
      error: undefined,
    });
    listMyDays.mockResolvedValue({ data: [], error: undefined });

    render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(/not enrolled in a batch yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Month null/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Month \d/)).not.toBeInTheDocument();
  });

  it("surfaces a failed day-history load distinctly from the genuine empty state", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
    listMyDays.mockResolvedValue({
      data: undefined,
      error: { type: "about:blank", title: "Internal Server Error", status: 500, detail: "Your day history could not be loaded." },
    });

    render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Your day history could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing recorded this month yet./)).not.toBeInTheDocument();
    // The dashboard heading and compliance rate still render -- only the
    // day-history section is affected by listMyDays failing.
    expect(screen.getByText(/Month 3 of 6/)).toBeInTheDocument();
    expect(screen.getByText(/94% compliance/)).toBeInTheDocument();
  });

  it("renders the problem detail when the dashboard call errors", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({
      data: undefined,
      error: { type: "about:blank", title: "Internal Server Error", status: 500, detail: "Your month could not be loaded." },
    });
    listMyDays.mockResolvedValue({ data: [], error: undefined });

    render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent("Your month could not be loaded.");
  });

  /**
   * The week/month toggle (confirmed direction: a toggle defaulting to the
   * full month). `dash()`'s `today` is 2026-08-03; the trailing window is
   * the 7 days ending there, so 2026-07-29 is one day OUTSIDE it and
   * 2026-07-31 is the oldest date still inside it.
   */
  describe("the This week / This month toggle", () => {
    const twoWeeksOfDays = [
      { date: "2026-07-27", status: "onTime", reportStatus: "InReview", reportId: "r1", absenceReason: null, mentorNote: null, entries: [{ id: "e1", entryDate: "2026-07-27", body: "Outside the trailing week.", submittedAt: "2026-07-29T10:00:00.000Z", isLate: false, isExtra: false, meetingMinutes: null }] },
      { date: "2026-07-31", status: "onTime", reportStatus: "InReview", reportId: "r2", absenceReason: null, mentorNote: null, entries: [{ id: "e2", entryDate: "2026-07-31", body: "Just inside the trailing week.", submittedAt: "2026-07-31T10:00:00.000Z", isLate: false, isExtra: false, meetingMinutes: null }] },
      { date: "2026-08-03", status: "late", reportStatus: "InReview", reportId: "r3", absenceReason: null, mentorNote: null, entries: [{ id: "e3", entryDate: "2026-08-03", body: "Today.", submittedAt: "2026-08-03T10:00:00.000Z", isLate: true, isExtra: false, meetingMinutes: null }] },
    ];

    it("shows the full month by default, with no range param", async () => {
      getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
      apiClient.mockResolvedValue({});
      getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
      listMyDays.mockResolvedValue({ data: twoWeeksOfDays, error: undefined });

      render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

      expect(screen.getByText("Outside the trailing week.")).toBeInTheDocument();
      expect(screen.getByText("Just inside the trailing week.")).toBeInTheDocument();
      expect(screen.getByText("Today.")).toBeInTheDocument();
    });

    it("hides a day outside the trailing 7-day window when range=week", async () => {
      getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
      apiClient.mockResolvedValue({});
      getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
      listMyDays.mockResolvedValue({ data: twoWeeksOfDays, error: undefined });

      render(await MyProgressPage({ searchParams: Promise.resolve({ range: "week" }) }));

      expect(screen.queryByText("Outside the trailing week.")).not.toBeInTheDocument();
      expect(screen.getByText("Just inside the trailing week.")).toBeInTheDocument();
      expect(screen.getByText("Today.")).toBeInTheDocument();
    });

    it("marks the active toggle with aria-current, never colour alone (§12)", async () => {
      getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
      apiClient.mockResolvedValue({});
      getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
      listMyDays.mockResolvedValue({ data: twoWeeksOfDays, error: undefined });

      render(await MyProgressPage({ searchParams: Promise.resolve({ range: "week" }) }));

      expect(screen.getByRole("link", { name: "This week" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: "This month" })).not.toHaveAttribute("aria-current");
    });

    it("shows a week-specific empty state, not the month one, when the week has nothing", async () => {
      getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
      apiClient.mockResolvedValue({});
      getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
      // Only the OUTSIDE-the-window day exists.
      listMyDays.mockResolvedValue({ data: [twoWeeksOfDays[0]], error: undefined });

      render(await MyProgressPage({ searchParams: Promise.resolve({ range: "week" }) }));

      expect(screen.getByText("Nothing recorded this week yet.")).toBeInTheDocument();
      expect(screen.queryByText("Nothing recorded this month yet.")).not.toBeInTheDocument();
    });

    it("falls back to the full month for an unrecognised range value, rather than showing nothing", async () => {
      getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
      apiClient.mockResolvedValue({});
      getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
      listMyDays.mockResolvedValue({ data: twoWeeksOfDays, error: undefined });

      render(await MyProgressPage({ searchParams: Promise.resolve({ range: "nonsense" }) }));

      expect(screen.getByText("Outside the trailing week.")).toBeInTheDocument();
    });

    it("falls back to the full month for an unrecognised range value, rather than showing nothing", async () => {
      getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
      apiClient.mockResolvedValue({});
      getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
      listMyDays.mockResolvedValue({ data: twoWeeksOfDays, error: undefined });

      render(await MyProgressPage({ searchParams: Promise.resolve({ range: "nonsense" }) }));

      expect(screen.getByText("Outside the trailing week.")).toBeInTheDocument();
    });
  });

  /**
   * Multiple entries on one day used to render as two bare paragraphs with
   * nothing between them but a gap -- no timestamp, no late/extra marker,
   * nothing to tell them apart. Each entry now carries its own meta row,
   * matching what student-today.tsx's "Recent days" already does.
   */
  describe("differentiating two entries on the same day", () => {
    it("gives each entry its own timestamp, with no redundant on-time pill", async () => {
      getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
      apiClient.mockResolvedValue({});
      getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
      listMyDays.mockResolvedValue({
        data: [{
          date: "2026-08-03", status: "onTime", reportStatus: "InReview", reportId: "r1",
          absenceReason: null, mentorNote: null,
          entries: [
            {
              id: "morning", entryDate: "2026-08-03", body: "Morning standup notes.",
              submittedAt: "2026-08-03T04:30:00.000Z", isLate: false, isExtra: false,
            },
            {
              id: "evening", entryDate: "2026-08-03", body: "Evening wrap-up.",
              submittedAt: "2026-08-03T13:05:00.000Z", isLate: false, isExtra: false,
            },
          ],
        }],
        error: undefined,
      });

      render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

      // 2026-08-03T04:30:00.000Z is 10:00am Colombo; T13:05:00.000Z is 6:35pm.
      // Both entries distinguish themselves by TIME alone -- neither carries
      // its own "On time" pill, because that is the default outcome and the
      // day's single header pill already states it once.
      expect(screen.getByText("10:00 am")).toBeInTheDocument();
      expect(screen.getByText("6:35 pm")).toBeInTheDocument();
      expect(screen.getAllByText("On time")).toHaveLength(1); // the day pill, alone
    });

    it("marks a same-day second entry as late independently of the day's own outcome", async () => {
      getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
      apiClient.mockResolvedValue({});
      getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
      listMyDays.mockResolvedValue({
        data: [{
          date: "2026-08-03", status: "late", reportStatus: "InReview", reportId: "r1",
          absenceReason: null, mentorNote: null,
          entries: [
            {
              id: "first", entryDate: "2026-08-03", body: "Filed on time.",
              submittedAt: "2026-08-03T04:30:00.000Z", isLate: false, isExtra: false,
            },
            {
              id: "second", entryDate: "2026-08-03", body: "A late follow-up.",
              submittedAt: "2026-08-04T03:00:00.000Z", isLate: true, isExtra: false,
            },
          ],
        }],
        error: undefined,
      });

      render(await MyProgressPage({ searchParams: Promise.resolve({}) }));

      // The first entry is plain on-time -- no pill of its own, nothing to
      // find beyond its timestamp. The second IS informative: its own
      // outcome (late) differs from the day's, so it earns the one pill
      // that is not redundant with the header.
      expect(screen.queryAllByText("On time")).toHaveLength(0);
      expect(screen.getAllByText("Late")).toHaveLength(2); // day pill + the one late entry
    });
  });
});
