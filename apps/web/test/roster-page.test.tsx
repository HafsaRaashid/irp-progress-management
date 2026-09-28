import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RosterPage from "@/app/(app)/roster/page";

// Same pattern as today-page.test.tsx: RosterPage is an async server
// component. Calling it directly and awaiting the returned element is the
// only way to exercise its branches without a running Next server.
const { getCurrentUserOrRedirect, apiClient } = vi.hoisted(() => ({
  getCurrentUserOrRedirect: vi.fn(),
  apiClient: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ getCurrentUserOrRedirect, apiClient }));

const { listBatches, getBatchRoster } = vi.hoisted(() => ({
  listBatches: vi.fn(),
  getBatchRoster: vi.fn(),
}));
vi.mock("@irp/client", () => ({ listBatches, getBatchRoster }));

// redirect() in real Next never returns — it throws a special NEXT_REDIRECT
// signal that framework internals catch. The mock reproduces just the
// "never returns normally" part with a private sentinel, so a test can
// assert the page's promise rejects with it rather than resolving to a
// rendered element.
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

const BATCH = { id: "b1", name: "Batch Aurora", startDate: "2026-05-10", endDate: "2026-11-09" };
const BATCH_2 = { id: "b2", name: "Batch Cinder", startDate: "2026-06-10", endDate: "2026-12-09" };

describe("RosterPage", () => {
  it("redirects a Student caller to / rather than rendering the roster", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT_USER);

    await expect(
      RosterPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toBe(REDIRECT_SENTINEL);

    expect(redirect).toHaveBeenCalledWith("/");
    expect(listBatches).not.toHaveBeenCalled();
  });

  it("shows an empty state pointing at Students when there are no batches", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [] });

    render(await RosterPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("No batches yet.")).toBeInTheDocument();
    expect(screen.getByText(/Students page/)).toBeInTheDocument();
    expect(getBatchRoster).not.toHaveBeenCalled();
  });

  it("renders the problem detail when listBatches itself errors -- must not fall through to the empty-batches state", async () => {
    // An earlier version destructured only `data` off listBatches()'s result,
    // so a 5xx (data undefined, error defined) looked identical to "there are
    // genuinely no batches" and rendered the wrong empty state -- "No batches
    // yet. Create one from the Students page." on what was actually a server
    // failure the mentor could do nothing about from that page.
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({
      data: undefined,
      error: {
        type: "about:blank",
        title: "Internal Server Error",
        status: 500,
        detail: "The batch list could not be loaded.",
      },
    });

    render(await RosterPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent("The batch list could not be loaded.");
    expect(screen.queryByText("No batches yet.")).not.toBeInTheDocument();
    expect(getBatchRoster).not.toHaveBeenCalled();
  });

  it("renders a roster row with the student's name, status pill, and extra count", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH] });
    getBatchRoster.mockResolvedValue({
      data: [
        {
          student: {
            id: "s1",
            displayName: "Amaya Perera",
            email: "a.perera@bistecglobal.com",
          },
          day: {
            date: "2026-07-31",
            status: "onTime",
            reportStatus: "InReview",
            reportId: "r1",
            absenceReason: null,
            entries: [
              {
                id: "e1",
                entryDate: "2026-07-31",
                body: "Implemented the roster endpoint.",
                submittedAt: "2026-07-31T04:00:00.000Z",
                isLate: false,
                isExtra: false,
              },
            ],
          },
          hasMentorRecord: true,
          extraCountThisCycle: 2,
        },
      ],
      error: undefined,
    });

    render(
      await RosterPage({
        searchParams: Promise.resolve({ batchId: "b1", date: "2026-07-31" }),
      }),
    );

    expect(getBatchRoster).toHaveBeenCalledWith({
      client: {},
      path: { id: "b1" },
      query: { date: "2026-07-31" },
    });
    expect(screen.getByText("Amaya Perera")).toBeInTheDocument();
    expect(screen.getByText("On time")).toBeInTheDocument();
    // "+2", not "+2 extra" -- the "Extra (cycle)" header carries the word now.
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("✓ recorded")).toBeInTheDocument();
  });

  it("treats an empty-string date query param as absent -- the GET form submits date=\"\" once cleared", async () => {
    // The date <input type="date"> form submits `date=""` when the mentor
    // clears it, not by omitting the field entirely. An empty string is not
    // a valid civil date, so it must be normalised to "not supplied" before
    // it reaches getBatchRoster's query or the batch-switch links, exactly
    // like an absent `date` param.
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH, BATCH_2] });
    getBatchRoster.mockResolvedValue({ data: [], error: undefined });

    render(
      await RosterPage({ searchParams: Promise.resolve({ batchId: "b1", date: "" }) }),
    );

    expect(getBatchRoster).toHaveBeenCalledWith({
      client: {},
      path: { id: "b1" },
      query: {},
    });
    const otherBatchLink = screen.getByRole("link", { name: BATCH_2.name });
    expect(otherBatchLink).toHaveAttribute("href", "/roster?batchId=b2");
  });

  it("carries the current date forward on batch-switch links -- switching batch must not silently reset to today", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH, BATCH_2] });
    getBatchRoster.mockResolvedValue({ data: [], error: undefined });

    render(
      await RosterPage({
        searchParams: Promise.resolve({ batchId: "b1", date: "2026-07-31" }),
      }),
    );

    const otherBatchLink = screen.getByRole("link", { name: BATCH_2.name });
    expect(otherBatchLink).toHaveAttribute("href", "/roster?batchId=b2&date=2026-07-31");
  });

  it("omits the date param on batch-switch links when no date is selected -- nothing to carry forward", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH, BATCH_2] });
    getBatchRoster.mockResolvedValue({ data: [], error: undefined });

    render(await RosterPage({ searchParams: Promise.resolve({ batchId: "b1" }) }));

    const otherBatchLink = screen.getByRole("link", { name: BATCH_2.name });
    expect(otherBatchLink).toHaveAttribute("href", "/roster?batchId=b2");
  });

  it("renders no StatusPill for a day with status \"none\" -- Task 12's suppressed-on-none convention extended to the table", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH] });
    getBatchRoster.mockResolvedValue({
      data: [
        {
          student: { id: "s2", displayName: "Kavindu Silva", email: "k.silva@bistecglobal.com" },
          day: {
            date: "2026-07-31",
            status: "none",
            reportStatus: null,
            reportId: null,
            absenceReason: null,
            entries: [],
          },
          hasMentorRecord: false,
          extraCountThisCycle: 0,
        },
      ],
      error: undefined,
    });

    render(await RosterPage({ searchParams: Promise.resolve({ batchId: "b1" }) }));

    expect(screen.getByText("Kavindu Silva")).toBeInTheDocument();
    // StatusPill always renders data-status on its wrapping span (see
    // status-pill.tsx); a "none" row must render plain muted text instead --
    // no such element should exist anywhere in this single-row table.
    expect(document.querySelector("[data-status]")).not.toBeInTheDocument();
  });

  it("renders the problem detail in a Panel when the SDK call errors", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH] });
    getBatchRoster.mockResolvedValue({
      data: undefined,
      error: {
        type: "about:blank",
        title: "Not found",
        status: 404,
        detail: "The batch does not exist.",
      },
    });

    render(await RosterPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent("The batch does not exist.");
  });
});
