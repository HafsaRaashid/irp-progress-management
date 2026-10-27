import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import StudentsPage from "@/app/(app)/students/page";

// Same pattern as roster-page.test.tsx / review-page.test.tsx: StudentsPage is
// an async server component. Calling it directly and awaiting the returned
// element is the only way to exercise its branches without a running Next
// server.
const { getCurrentUserOrRedirect, apiClient } = vi.hoisted(() => ({
  getCurrentUserOrRedirect: vi.fn(),
  apiClient: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ getCurrentUserOrRedirect, apiClient }));

// admin-actions.ts (unmocked -- exercised for real, same as review-page.test's
// treatment of review-actions.ts) imports createUser/createBatch/
// transferStudent/archiveUser/restoreUser as a single module; page.tsx itself
// calls listBatches/listUsers/getBatchRoster. All eight are mocked here so the
// whole tree runs without a real client or network access. createUser and
// createBatch are both exercised directly: RegisterForm and CreateBatchForm
// round-tripped Settings (ADR-0022) and back (ADR-0023 for Create batch,
// ADR-0034 for Register) and render on this page again, inside the Register /
// Create batch dialogs (2026-10-09 revision: Dialog-wrapped buttons, not
// collapsed <details>).

/**
 * jsdom ships `dialog:not([open]) { display: none; }` in its default
 * stylesheet (a real UA default, not a jsdom quirk), but its
 * HTMLDialogElement implementation is an empty stub -- `showModal()` does
 * nothing, so a real click on a Dialog trigger never flips the `open`
 * attribute the way a real browser does. Setting it directly here
 * reproduces exactly what `showModal()` would have done, and is the only
 * way these dialogs' contents become queryable in this environment --
 * verified against the real browser separately in Playwright, where
 * `showModal()` is fully implemented.
 */
function openDialog(ariaLabel: string) {
  const dialog = document.querySelector(`dialog[aria-label="${ariaLabel}"]`);
  if (dialog === null) throw new Error(`No <dialog aria-label="${ariaLabel}"> found`);
  dialog.setAttribute("open", "");
}
const {
  listBatches,
  listUsers,
  getBatchRoster,
  createUser,
  createBatch,
  transferStudent,
  archiveUser,
  restoreUser,
} = vi.hoisted(() => ({
  listBatches: vi.fn(),
  listUsers: vi.fn(),
  getBatchRoster: vi.fn(),
  createUser: vi.fn(),
  createBatch: vi.fn(),
  transferStudent: vi.fn(),
  archiveUser: vi.fn(),
  restoreUser: vi.fn(),
}));
vi.mock("@irp/client", () => ({
  listBatches,
  listUsers,
  getBatchRoster,
  createUser,
  createBatch,
  transferStudent,
  archiveUser,
  restoreUser,
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

// admin-actions.ts runs for real and calls revalidatePath on every success
// path. Outside an actual Next request lifecycle that throws ("static
// generation store missing"), which a no-op stub avoids -- same treatment as
// review-page.test.tsx.
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

const BATCH = { id: "b1", name: "Batch Aurora", startDate: "2026-05-10", endDate: "2026-11-09" };

const STUDENT_DETAIL = {
  id: "s1",
  email: "a.perera@bistecglobal.com",
  displayName: "Amaya Perera",
  role: "Student" as const,
  archived: false,
};

const MENTOR_DETAIL = {
  id: "m1",
  email: "d.mentor@bistecglobal.com",
  displayName: "Dev Mentor",
  role: "Admin" as const,
  archived: false,
};

function searchParams(view?: string) {
  return Promise.resolve(view === undefined ? {} : { view });
}

function defaultReads() {
  listBatches.mockResolvedValue({ data: [BATCH], error: undefined });
  listUsers.mockResolvedValue({ data: [STUDENT_DETAIL, MENTOR_DETAIL], error: undefined });
  // The People table's Batch column reads one roster per batch (page.tsx) --
  // unmocked, getBatchRoster is undefined and the call throws. Empty by
  // default; the dedicated Batch-column test below overrides it.
  getBatchRoster.mockResolvedValue({ data: [], error: undefined });
}

describe("StudentsPage", () => {
  it("redirects a Student caller to / rather than rendering the page", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT_USER);

    await expect(StudentsPage({ searchParams: searchParams() })).rejects.toBe(REDIRECT_SENTINEL);

    expect(redirect).toHaveBeenCalledWith("/");
    expect(listBatches).not.toHaveBeenCalled();
  });

  it("carries Create batch again — it fills the column Transfer leaves short (ADR-0023)", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH], error: undefined });
    listUsers.mockResolvedValue({ data: [STUDENT_DETAIL, MENTOR_DETAIL], error: undefined });
    getBatchRoster.mockResolvedValue({ data: [], error: undefined });

    render(await StudentsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByLabelText("Batch name")).toBeInTheDocument();
  });

  it("carries Register again — it came back from Settings (ADR-0034)", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH], error: undefined });
    listUsers.mockResolvedValue({ data: [STUDENT_DETAIL, MENTOR_DETAIL], error: undefined });
    getBatchRoster.mockResolvedValue({ data: [], error: undefined });

    render(await StudentsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByLabelText("Role")).toBeInTheDocument();
  });

  it("RegisterForm hides batch/startDate for the Mentor role and omits the enrolment key entirely", async () => {
    // Relocated from settings-page.test.tsx (ADR-0034): the component's own
    // behaviour, unchanged by the move, now exercised wherever it renders.
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    defaultReads();
    createUser.mockResolvedValue({ error: undefined, data: { id: "m2" } });

    render(await StudentsPage({ searchParams: Promise.resolve({}) }));
    openDialog("Register");

    // Student is the default role -- assert batch/start date are actually
    // PRESENT first. Checking only the post-change Admin state would also
    // pass against a form that never rendered these fields at all.
    expect(screen.getByLabelText("Batch")).toBeInTheDocument();
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "Admin" } });

    expect(screen.queryByLabelText("Batch")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new.mentor@bistecglobal.com" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "New Mentor" } });
    fireEvent.change(screen.getByLabelText("External id"), { target: { value: "oid-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    await screen.findByRole("status");

    expect(createUser).toHaveBeenCalledTimes(1);
    const callArgs = createUser.mock.calls[0]?.[0] as { body: Record<string, unknown> } | undefined;
    expect(callArgs?.body.role).toBe("Admin");
    expect(callArgs?.body).not.toHaveProperty("enrolment");
  });

  it("keeps Transfer (per-row) and the directory table, which are the management half", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    defaultReads();

    // Default view (no `show`) is Students -- Dev Mentor is not expected here.
    render(await StudentsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("button", { name: "Transfer" })).toBeInTheDocument();
    expect(screen.getByText("Amaya Perera")).toBeInTheDocument();
  });

  it("shows a student's current batch from the roster read", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH], error: undefined });
    listUsers.mockResolvedValue({ data: [STUDENT_DETAIL], error: undefined });
    // STUDENT_DETAIL appears in BATCH's roster -- the Batch column reads this
    // back as "Batch Aurora" rather than re-deriving it from User (which
    // carries no batch field at all, spec/openapi.yaml's User schema).
    getBatchRoster.mockResolvedValue({
      data: [{ student: { id: STUDENT_DETAIL.id, displayName: STUDENT_DETAIL.displayName, email: STUDENT_DETAIL.email } }],
      error: undefined,
    });

    render(await StudentsPage({ searchParams: Promise.resolve({}) }));

    const studentRow = screen.getByText("Amaya Perera").closest("tr");
    expect(studentRow).not.toBeNull();
    expect(studentRow).toHaveTextContent("Batch Aurora");
  });

  it("points a reader at Register when nobody is registered yet", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH], error: undefined });
    listUsers.mockResolvedValue({ data: [], error: undefined });
    getBatchRoster.mockResolvedValue({ data: [], error: undefined });

    render(await StudentsPage({ searchParams: Promise.resolve({}) }));

    // Default filter is Students, so the empty state names students
    // specifically rather than the old role-neutral "mentor or student".
    expect(
      screen.getByText("Use + Register above to add the first student."),
    ).toBeInTheDocument();
  });

  it("offers no Archive on the signed-in mentor's own row, and names it 'You'", async () => {
    // The API refuses a self-archive with a 409 (SelfArchiveError), so the
    // button could only ever produce an error message there.
    getCurrentUserOrRedirect.mockResolvedValue({ ...ADMIN_USER, id: MENTOR_DETAIL.id });
    apiClient.mockResolvedValue({});
    defaultReads();

    render(await StudentsPage({ searchParams: Promise.resolve({ show: "mentor" }) }));

    const ownRow = screen.getByText("You").closest("tr");
    expect(ownRow).not.toBeNull();
    expect(within(ownRow!).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("still offers Archive on OTHER mentors' rows", async () => {
    // The guard above must be scoped to the signed-in mentor alone -- a
    // blanket "mentors cannot be archived" would be a different, wrong rule
    // (FR-5 archives either role).
    getCurrentUserOrRedirect.mockResolvedValue({ ...ADMIN_USER, id: "someone-else" });
    apiClient.mockResolvedValue({});
    defaultReads();

    render(await StudentsPage({ searchParams: Promise.resolve({ show: "mentor" }) }));

    expect(screen.queryByText("You")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("tells a reader filtered to an empty role, without a mentor leaking through", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({ data: [BATCH], error: undefined });
    listUsers.mockResolvedValue({ data: [MENTOR_DETAIL], error: undefined });
    getBatchRoster.mockResolvedValue({ data: [], error: undefined });

    render(await StudentsPage({ searchParams: Promise.resolve({ show: "student" }) }));

    expect(screen.getByText("No students yet.")).toBeInTheDocument();
    // The Mentor that exists is filtered OUT, not just the empty state shown
    // alongside a table that still renders it.
    expect(screen.queryByText("Dev Mentor")).not.toBeInTheDocument();
  });

  it("narrows the table to one role via the filter chips, with its own consistent action set", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    defaultReads();

    render(await StudentsPage({ searchParams: Promise.resolve({ show: "mentor" }) }));

    expect(screen.getByRole("link", { name: "Mentors" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Dev Mentor")).toBeInTheDocument();
    expect(screen.queryByText("Amaya Perera")).not.toBeInTheDocument();
    // No "All" chip any more -- Students and Mentors are the only two.
    expect(screen.queryByRole("link", { name: "All" })).not.toBeInTheDocument();
    // Every visible row (just the one Mentor) carries the SAME action set --
    // Archive only, no Transfer -- which is the whole point of dropping All.
    expect(screen.queryByRole("button", { name: "Transfer" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("renders the problem detail when a read errors -- must not silently fall through to an empty state", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listBatches.mockResolvedValue({
      data: undefined,
      error: { type: "about:blank", title: "Internal Server Error", status: 500, detail: "The batch list could not be loaded." },
    });
    listUsers.mockResolvedValue({ data: [STUDENT_DETAIL], error: undefined });

    render(await StudentsPage({ searchParams: searchParams() }));

    expect(screen.getByRole("alert")).toHaveTextContent("The batch list could not be loaded.");
  });

  it("archived view lists archived users with a Restore control, and links back", async () => {
    // This view was deliberately read-only, which left archiving -- a
    // one-click action -- with no inverse anywhere in the product. FR-5 asks
    // for an archive that keeps history; it never asked for that archive to
    // be one-way.
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({
      data: [{ ...STUDENT_DETAIL, id: "s2", displayName: "Kavindu Silva", archived: true }],
      error: undefined,
    });

    render(await StudentsPage({ searchParams: searchParams("archived") }));

    expect(listUsers).toHaveBeenCalledWith({ client: {}, query: { archived: true } });
    expect(screen.getByText("Kavindu Silva")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    // Restore is the only action here: everything else on the Users page
    // (transfer, archive, registration) needs an ACTIVE user.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Back to Users/ })).toHaveAttribute("href", "/students");
  });

  it("restores an archived user through the SDK and surfaces a failure", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    listUsers.mockResolvedValue({
      data: [{ ...STUDENT_DETAIL, id: "s2", displayName: "Kavindu Silva", archived: true }],
      error: undefined,
    });
    restoreUser.mockResolvedValue({
      data: undefined,
      error: { title: "Not Found", detail: "That user no longer exists." },
    });

    render(await StudentsPage({ searchParams: searchParams("archived") }));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    // The problem detail has to reach the mentor -- a restore that silently
    // does nothing is the failure mode the bound-action shape exists to stop.
    expect(await screen.findByRole("alert")).toHaveTextContent("That user no longer exists.");
    expect(restoreUser).toHaveBeenCalledWith({ client: {}, path: { id: "s2" } });
  });

  it("surfaces an archive action's 409 self-archive error via role=alert", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    defaultReads();
    archiveUser.mockResolvedValue({
      error: { type: "about:blank", title: "Conflict", status: 409, detail: "A mentor cannot archive their own account." },
    });

    render(await StudentsPage({ searchParams: searchParams() }));

    // Archive now asks first (a confirmation dialog), so opening it archives
    // nothing; only Confirm archive calls the API.
    const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-label^="Archive "]');
    if (dialog === null) throw new Error("No Archive confirmation dialog found");
    expect(archiveUser).not.toHaveBeenCalled();
    openDialog(dialog.getAttribute("aria-label")!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm archive" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A mentor cannot archive their own account.");
    expect(archiveUser).toHaveBeenCalledTimes(1);
  });

  // Relocated from settings-page.test.tsx by Task 7 (ADR-0023): CreateBatchForm
  // moved back to this page. Plan 7A had moved this exact test the other way,
  // to settings-page.test.tsx, when Create batch lived there (ADR-0022).
  it("surfaces a successful batch creation with a role=status success line", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    apiClient.mockResolvedValue({});
    defaultReads();
    createBatch.mockResolvedValue({ error: undefined, data: BATCH });

    render(await StudentsPage({ searchParams: searchParams() }));
    openDialog("Create batch");

    fireEvent.change(screen.getByLabelText("Batch name"), { target: { value: "Batch Bramble" } });
    fireEvent.change(screen.getByLabelText("Batch start date"), { target: { value: "2026-09-10" } });
    fireEvent.change(screen.getByLabelText("Batch end date"), { target: { value: "2027-03-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Create batch" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Batch created.");
  });
});
