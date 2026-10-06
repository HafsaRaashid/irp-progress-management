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

    render(await MyProgressPage());

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

    render(await MyProgressPage());

    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.getByText("Strengths and areas to develop")).toBeInTheDocument();
  });

  it("renders the feedback band's empty state while O-5 leaves every evaluation null", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
    listMyDays.mockResolvedValue({ data: [], error: undefined });

    render(await MyProgressPage());

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

    const { container } = render(await MyProgressPage());

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

    render(await MyProgressPage());

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
          entries: [{
            id: "e1", entryDate: "2026-07-31", body: "Older entry.",
            submittedAt: "2026-07-31T11:30:00.000Z", isLate: false, isExtra: false,
          }],
        },
        {
          date: "2026-08-03", status: "late", reportStatus: "InReview", reportId: "r2",
          absenceReason: null,
          entries: [{
            id: "e2", entryDate: "2026-08-03", body: "Newer entry.",
            submittedAt: "2026-08-04T04:10:00.000Z", isLate: true, isExtra: false,
          }],
        },
      ],
      error: undefined,
    });

    render(await MyProgressPage());

    const bodies = screen.getAllByTestId("day-entry-body").map((n) => n.textContent);
    expect(bodies).toEqual(["Newer entry.", "Older entry."]);
    expect(screen.getByText("Late")).toBeInTheDocument();
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
          entries: [{
            id: "e1", entryDate: "2026-07-31", body: "Real work.",
            submittedAt: "2026-07-31T11:30:00.000Z", isLate: false, isExtra: false,
          }],
        },
        // A settled weekday with no entry at all (Missed) -- still kept,
        // because "settled" alone is enough; nothing real should disappear.
        {
          date: "2026-08-03", status: "missed", reportStatus: null, reportId: null,
          absenceReason: null, entries: [],
        },
        // A quiet weekend -- nothing recorded -- dropped.
        {
          date: "2026-08-01", status: "none", reportStatus: null, reportId: null,
          absenceReason: null, entries: [],
        },
        // A future weekday that hasn't arrived yet -- dropped.
        {
          date: "2026-08-04", status: "future", reportStatus: null, reportId: null,
          absenceReason: null, entries: [],
        },
      ],
      error: undefined,
    });

    render(await MyProgressPage());

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
          absenceReason: null, entries: [],
        },
        {
          date: "2026-08-04", status: "future", reportStatus: null, reportId: null,
          absenceReason: null, entries: [],
        },
      ],
      error: undefined,
    });

    render(await MyProgressPage());

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

    render(await MyProgressPage());

    expect(screen.getByText("— compliance")).toBeInTheDocument();
  });

  it("shows the absence reason on an absent day", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT);
    apiClient.mockResolvedValue({});
    getMyDashboard.mockResolvedValue({ data: dash(), error: undefined });
    listMyDays.mockResolvedValue({
      data: [{
        date: "2026-08-03", status: "absent", reportStatus: null, reportId: null,
        absenceReason: "Medical appointment", entries: [],
      }],
      error: undefined,
    });

    render(await MyProgressPage());

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

    render(await MyProgressPage());

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

    render(await MyProgressPage());

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

    render(await MyProgressPage());

    expect(screen.getByRole("alert")).toHaveTextContent("Your month could not be loaded.");
  });
});
