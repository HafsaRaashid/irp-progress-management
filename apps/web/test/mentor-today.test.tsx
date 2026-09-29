import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MentorToday } from "@/app/(app)/mentor-today";

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiClient }));

const { listBatches, getBatchDashboardToday } = vi.hoisted(() => ({
  listBatches: vi.fn(),
  getBatchDashboardToday: vi.fn(),
}));
vi.mock("@irp/client", () => ({ listBatches, getBatchDashboardToday }));

const BATCH = { id: "b1", name: "Batch Aurora", startDate: "2026-05-10", endDate: "2026-11-09" };
const BATCH_2 = { id: "b2", name: "Batch Basalt", startDate: "2026-05-10", endDate: "2026-11-09" };

const dashboard = (over: Record<string, unknown> = {}) => ({
  batchId: "b1",
  batchName: "Batch Aurora",
  date: "2026-08-03",
  isFallbackDay: false,
  dayNumber: 17,
  cycle: { seq: 3, startDate: "2026-07-10", endDate: "2026-08-09", requiredDayCount: 22 },
  counts: { date: "2026-08-03", enrolled: 10, submitted: 8, late: 2, absent: 1, missed: 0, pending: 1 },
  extraCount: 3,
  days: [
    { date: "2026-07-31", enrolled: 10, submitted: 10, late: 0, absent: 0, missed: 0, pending: 0 },
    { date: "2026-08-03", enrolled: 10, submitted: 8, late: 2, absent: 1, missed: 0, pending: 1 },
  ],
  extraAfter: ["2026-07-31"],
  ...over,
});

describe("MentorToday", () => {
  // Every test sets its own mock return values, but vi.fn() call COUNTS
  // accumulate across tests without this -- and one test asserts a mock was
  // never called, which silently reads the previous tests' calls otherwise.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders FR-28's figures — N of M, late, absent — for the selected batch", async () => {
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH] });
    getBatchDashboardToday.mockResolvedValue({ data: dashboard(), error: undefined });

    render(await MentorToday({ displayName: "Dev Mentor", role: "Admin" }));

    // The batch name is the section's accessible name, not a standalone text
    // node -- it is rendered inside the calendar's composite label. This is
    // also the locator the Playwright suite uses.
    expect(screen.getByRole("region", { name: "Batch Aurora" })).toBeInTheDocument();
    expect(screen.getByTestId("submitted-count-b1")).toHaveTextContent("8 of 10 submitted");
    expect(screen.getByTestId("late-count-b1")).toHaveTextContent("2 late");
    expect(screen.getByTestId("absent-count-b1")).toHaveTextContent("1 absent");
    expect(screen.getByTestId("missed-count-b1")).toHaveTextContent("0 missed");
  });

  it("labels the day as an earlier one when isFallbackDay is set — a weekend must not read as today", async () => {
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH] });
    getBatchDashboardToday.mockResolvedValue({
      data: dashboard({ isFallbackDay: true, date: "2026-07-31" }),
      error: undefined,
    });

    render(await MentorToday({ displayName: "Dev Mentor", role: "Admin" }));

    expect(screen.getByTestId("day-label-b1")).toHaveTextContent(/Friday 31 July/);
    expect(screen.getByTestId("day-label-b1")).toHaveTextContent(/last required day/i);
  });

  it("renders no batch selector and exactly one calendar for a single-batch mentor", async () => {
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH] });
    getBatchDashboardToday.mockResolvedValue({ data: dashboard(), error: undefined });

    render(await MentorToday({ displayName: "Dev Mentor", role: "Admin" }));

    expect(screen.getAllByRole("figure")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Batch Aurora" })).not.toBeInTheDocument();
    expect(getBatchDashboardToday).toHaveBeenCalledTimes(1);
    expect(getBatchDashboardToday).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: "b1" } }),
    );
  });

  it("renders chips and exactly one calendar for a multi-batch mentor, defaulting to the first batch (D3)", async () => {
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH, BATCH_2] });
    getBatchDashboardToday.mockResolvedValue({ data: dashboard(), error: undefined });

    render(await MentorToday({ displayName: "Dev Mentor", role: "Admin" }));

    expect(screen.getAllByRole("figure")).toHaveLength(1);
    const auroraChip = screen.getByRole("link", { name: "Batch Aurora" });
    const basaltChip = screen.getByRole("link", { name: "Batch Basalt" });
    expect(auroraChip).toHaveAttribute("aria-current", "page");
    expect(basaltChip).not.toHaveAttribute("aria-current");
    expect(getBatchDashboardToday).toHaveBeenCalledTimes(1);
    expect(getBatchDashboardToday).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: "b1" } }),
    );
  });

  it("selects the named batch's calendar when batchId is passed, matching the Cycles page's own fallback", async () => {
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH, BATCH_2] });
    getBatchDashboardToday.mockResolvedValue({
      data: dashboard({ batchId: "b2", batchName: "Batch Basalt" }),
      error: undefined,
    });

    render(await MentorToday({ displayName: "Dev Mentor", role: "Admin", batchId: "b2" }));

    expect(screen.getByRole("region", { name: "Batch Basalt" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Batch Basalt" })).toHaveAttribute("aria-current", "page");
    expect(getBatchDashboardToday).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: "b2" } }),
    );
  });

  it("falls back to the first batch when batchId names a batch the mentor doesn't have", async () => {
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH, BATCH_2] });
    getBatchDashboardToday.mockResolvedValue({ data: dashboard(), error: undefined });

    render(await MentorToday({ displayName: "Dev Mentor", role: "Admin", batchId: "no-such-batch" }));

    expect(getBatchDashboardToday).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: "b1" } }),
    );
  });

  it("says the cycle has not opened when seq is null, rather than printing Cycle null", async () => {
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH] });
    getBatchDashboardToday.mockResolvedValue({
      data: dashboard({ cycle: { seq: null, startDate: "2026-11-10", endDate: "2026-12-09", requiredDayCount: 22 } }),
      error: undefined,
    });

    render(await MentorToday({ displayName: "Dev Mentor", role: "Admin" }));

    expect(screen.getByText(/first evaluated cycle/i)).toBeInTheDocument();
    expect(screen.queryByText(/Cycle null/)).not.toBeInTheDocument();
  });

  it("renders the problem detail and still keeps the identity testids when listBatches itself errors", async () => {
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({
      data: undefined,
      error: { type: "about:blank", title: "Internal Server Error", status: 500, detail: "Could not load batches." },
    });

    render(await MentorToday({ displayName: "Dev Mentor", role: "Admin" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Could not load batches.");
    expect(screen.getByTestId("user-name")).toHaveTextContent("Dev Mentor");
    expect(screen.getByTestId("user-role")).toHaveTextContent("Admin");
  });

  it("shows an empty state pointing at Students when there are no batches", async () => {
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [] });

    render(await MentorToday({ displayName: "Dev Mentor", role: "Admin" }));

    expect(screen.getByText("No batches yet.")).toBeInTheDocument();
    expect(getBatchDashboardToday).not.toHaveBeenCalled();
  });

  it("shows an alert for the selected batch's dashboard failure, without erroring the whole page", async () => {
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH] });
    getBatchDashboardToday.mockResolvedValue({
      data: undefined,
      error: { type: "about:blank", title: "Internal Server Error", status: 500, detail: "Aggregation failed." },
    });

    render(await MentorToday({ displayName: "Dev Mentor", role: "Admin" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Aggregation failed.");
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });

  it("omits the extra-this-cycle line when extraCount is zero", async () => {
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH] });
    getBatchDashboardToday.mockResolvedValue({ data: dashboard({ extraCount: 0 }), error: undefined });

    render(await MentorToday({ displayName: "Dev Mentor", role: "Admin" }));

    expect(screen.queryByText(/extra this cycle/)).not.toBeInTheDocument();
  });

  it("keeps the sign-in chain's identity testids on the mentor branch", async () => {
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [] });

    render(await MentorToday({ displayName: "Dev Mentor", role: "Admin" }));

    expect(screen.getByTestId("user-name")).toHaveTextContent("Dev Mentor");
    expect(screen.getByTestId("user-role")).toHaveTextContent("Admin");
  });
});
