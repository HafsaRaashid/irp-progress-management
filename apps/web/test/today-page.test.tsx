import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import TodayPage from "@/app/(app)/page";
import { StudentToday } from "@/app/(app)/student-today";
import { MentorToday } from "@/app/(app)/mentor-today";

// TodayPage is a thin role dispatcher: Student -> StudentToday, everyone
// else -> MentorToday. The mentor branch's own rendering is covered by its
// dedicated suite (mentor-today.test.tsx) -- there is no equivalent
// student-today suite yet, so this file also renders the Student branch far
// enough to prove the sign-in contract (user-name/user-role testids,
// e2e/signin.spec.ts) survives the dispatch, rather than only asserting the
// dispatch itself.
const { getCurrentUserOrRedirect, apiClient } = vi.hoisted(() => ({
  getCurrentUserOrRedirect: vi.fn(),
  apiClient: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ getCurrentUserOrRedirect, apiClient }));

// student-today.tsx calls listMyDays; mocked so the Student branch never
// needs a real client or network access. createEntry/createAbsence/
// deleteAbsence are also exported from "@irp/client" and imported
// (transitively, via entry-actions.ts <- entry-composer.tsx/absence-toggle.tsx)
// by the tree StudentToday renders -- an honest mock declares them too, even
// though this test never submits a form and so never calls them.
const { getMyDashboard, listMyDays, createEntry, createAbsence, deleteAbsence } = vi.hoisted(
  () => ({
    getMyDashboard: vi.fn(),
    listMyDays: vi.fn(),
    createEntry: vi.fn(),
    createAbsence: vi.fn(),
    deleteAbsence: vi.fn(),
  }),
);
vi.mock("@irp/client", () => ({
  getMyDashboard,
  listMyDays,
  createEntry,
  createAbsence,
  deleteAbsence,
}));

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

describe("TodayPage role branches", () => {
  it("delegates an Admin caller to MentorToday, with the signed-in user's identity", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);

    const element = await TodayPage({ searchParams: Promise.resolve({}) });

    expect(element.type).toBe(MentorToday);
    expect(element.props as ComponentProps<typeof MentorToday>).toEqual({
      displayName: "Dev Mentor",
      role: "Admin",
      batchId: undefined,
    });
  });

  it("passes a batchId query param through to MentorToday unchanged", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);

    const element = await TodayPage({ searchParams: Promise.resolve({ batchId: "b2" }) });

    expect(element.props as ComponentProps<typeof MentorToday>).toEqual(
      expect.objectContaining({ batchId: "b2" }),
    );
  });

  it("delegates a Student caller to StudentToday, with the signed-in user's identity", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT_USER);

    const element = await TodayPage({ searchParams: Promise.resolve({}) });

    expect(element.type).toBe(StudentToday);
    expect(element.props as ComponentProps<typeof StudentToday>).toEqual({
      displayName: "Dev Student",
      role: "Student",
    });
  });

  it("renders both sign-in-contract testids on the Student branch, carrying the exact role string", async () => {
    // e2e/signin.spec.ts asserts data-testid="user-name" and
    // data-testid="user-role" after sign-in for every role. TodayPage()
    // returns `<StudentToday .../>` unresolved -- a React element
    // referencing an async function component, not yet invoked --
    // react-dom/client's render() cannot execute an async function
    // component itself, so the nested async Server Component is resolved
    // by hand here, the same way Next's own RSC runtime would.
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT_USER);
    apiClient.mockResolvedValue({});
    listMyDays.mockResolvedValue({ data: [], error: undefined });
    getMyDashboard.mockResolvedValue({ data: undefined, error: undefined });

    const element = await TodayPage({ searchParams: Promise.resolve({}) });
    render(await StudentToday(element.props as ComponentProps<typeof StudentToday>));

    expect(screen.getByTestId("user-name")).toHaveTextContent("Dev Student");
    expect(screen.getByTestId("user-role")).toHaveTextContent("Student");
  });

  it("puts the ribbon and the strengths prose on the student's home, above the composer (§8.2)", async () => {
    // The §8.2 restructure: "Same ribbon, personal marks. The submission box is
    // the primary action and sits immediately below it." Both used to exist
    // only on My month, so the student's home opened with a bare <select>.
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT_USER);
    apiClient.mockResolvedValue({});
    listMyDays.mockResolvedValue({ data: [], error: undefined });
    getMyDashboard.mockResolvedValue({
      data: {
        today: "2026-08-03",
        programmeMonths: 6,
        firstEvaluatedCycleStart: "2026-06-10",
        cycle: { seq: 3, startDate: "2026-07-10", endDate: "2026-08-09", requiredDayCount: 22 },
        days: [{ date: "2026-07-31", status: "onTime" }],
        extraAfter: [],
        summary: {
          requiredDays: 22, settledDays: 17, onTime: 13, late: 2, absent: 1,
          missed: 1, pending: 1, extra: 2, complianceRate: 0.9412,
        },
        strengthsAndWeaknesses: null,
      },
      error: undefined,
    });

    const element = await TodayPage({ searchParams: Promise.resolve({}) });
    render(await StudentToday(element.props as ComponentProps<typeof StudentToday>));

    expect(screen.getByRole("figure")).toBeInTheDocument();
    expect(screen.getByText(/Month 3 of 6/)).toBeInTheDocument();
    expect(screen.getByText("Strengths and areas to develop")).toBeInTheDocument();
    // FR-30: no score reaches this surface, and the compliance PERCENTAGE
    // lives on My month — home carries the outcome counts only.
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("still renders the composer when the dashboard call fails", async () => {
    // Submitting is the one thing this page exists for. A dashboard 500 costs
    // the ribbon, never the composer.
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT_USER);
    apiClient.mockResolvedValue({});
    listMyDays.mockResolvedValue({ data: [], error: undefined });
    getMyDashboard.mockResolvedValue({
      data: undefined,
      error: { title: "Internal Server Error", detail: "Your month could not be loaded." },
    });

    const element = await TodayPage({ searchParams: Promise.resolve({}) });
    render(await StudentToday(element.props as ComponentProps<typeof StudentToday>));

    expect(screen.getByRole("alert")).toHaveTextContent("Your month could not be loaded.");
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Entry text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit update/ })).toBeInTheDocument();
  });
});
