import Link from "next/link";
import { redirect } from "next/navigation";
import { listBatches, listUsers, getBatchRoster } from "@irp/client";
import { getCurrentUserOrRedirect, apiClient } from "@/lib/api-client";
import { PageTitle } from "@/components/ui/page-title";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Th, Td } from "@/components/ui/table";
import { RegisterForm, TransferForm, CreateBatchForm, ArchiveButton, RestoreButton } from "./forms";

type RoleFilter = "all" | "student" | "mentor";

/**
 * Labels only -- no counts folded in, matching Review's own reasoning
 * (review/[studentId]/page.tsx) for keeping a chip's label and its figure
 * apart: a chip reading "Students 12" runs the two together with nothing
 * between them. This page's table is never large enough (a handful of
 * concurrent batches) to need the figure at all.
 */
const FILTERS: readonly { key: RoleFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "student", label: "Students" },
  { key: "mentor", label: "Mentors" },
];

/**
 * The mentor's directory of people and batches (FR-3, FR-5, FR-6, FR-8).
 * Admin-only, matching roster/page.tsx and review/[studentId]/page.tsx's
 * gate -- a Student hitting this route is bounced to "/" rather than shown
 * a 403 page.
 *
 * Labelled "Users" on screen (sidebar + PageTitle); the route, this file's
 * path, and every test/e2e reference to "/students" are unchanged --
 * ADR-0034 is a label-only rename, not a route move.
 *
 * History: Register moved to Settings (ADR-0022), Create batch followed it
 * then came back here alone (ADR-0023). Both are back here now (ADR-0034,
 * 2026-10-08, `docs/superpowers/specs/2026-10-08-mentor-users-page-design.md`)
 * -- there was never a distinct "mentor management" concept to keep them
 * apart from (FR-4: Admins share access across every batch; a mentor
 * account's only lifecycle operations are Register/Archive/Restore, the
 * same three a student account has), so the split cost more than it bought.
 *
 * `?view=archived` renders the FR-5 archive list instead of the working
 * page -- names, emails, and a Restore control per row. It carries no other
 * actions: everything else (transfer, batch creation, re-registration) needs
 * an active user. Unaffected by ADR-0034.
 */
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; show?: string; transfer?: string }>;
}) {
  const user = await getCurrentUserOrRedirect();
  if (user.role !== "Admin") redirect("/");

  const { view, show, transfer } = await searchParams;
  const client = await apiClient();

  if (view === "archived") {
    const { data: archived, error } = await listUsers({ client, query: { archived: true } });

    return (
      <div>
        <PageTitle>Archived</PageTitle>
        {error !== undefined && (
          <Panel>
            <p role="alert" style={{ color: "var(--st-missed)" }}>
              {error.detail ?? error.title ?? "Something went wrong."}
            </p>
          </Panel>
        )}
        {error === undefined && (archived === undefined || archived.length === 0) && (
          <Panel>
            <EmptyState title="No archived users." />
          </Panel>
        )}
        {error === undefined && archived !== undefined && archived.length > 0 && (
          <Panel sunk>
            <ul className="flex flex-col gap-2">
              {archived.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-4 border-b pb-2" style={{ borderColor: "var(--line)" }}>
                  <div>
                    <div style={{ color: "var(--ink)" }}>{u.displayName}</div>
                    <div className="text-sm" style={{ color: "var(--ink-muted)" }}>{u.email}</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm" style={{ color: "var(--ink-muted)" }}>{u.role}</span>
                    {/* This view was read-only on the reasoning that an archived
                        user "has already lost access and there is nothing left
                        to do to one from here". That left archiving — a
                        one-click action — with no inverse anywhere in the
                        product, so an accidental archive could only be undone
                        with a direct database write. FR-5 never called for
                        that; it was an assumption, not a requirement. */}
                    <RestoreButton userId={u.id} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <p className="mt-4">
          <Link href="/students" className="text-link">
            Back to Users
          </Link>
        </p>
      </div>
    );
  }

  // The default view's table and its three disclosures (Add student, Create
  // batch, Transfer) all draw from the same two reads -- every active
  // (non-archived, the default) user and every batch -- rather than each one
  // issuing its own request.
  const [{ data: batches, error: batchesError }, { data: users, error: usersError }] =
    await Promise.all([
      listBatches({ client }),
      listUsers({ client }),
    ]);

  const batchOptions = (batches ?? []).map((b) => ({ id: b.id, name: b.name }));
  const studentOptions = (users ?? [])
    .filter((u) => u.role === "Student")
    .map((u) => ({ id: u.id, displayName: u.displayName, email: u.email }));

  // A student's CURRENT batch, for the People table's Batch column. There is
  // no such field on User itself (spec/openapi.yaml's User schema carries
  // only id/email/displayName/role) -- enrolment is a per-batch concept, so
  // it is read the same way Roster already does: one roster call per batch,
  // concurrently, same pattern as mentor-today.tsx's per-batch dashboard
  // reads. Today's roster IS current enrolment (a transfer's new batch owns
  // the effective date onward, ADR-0017), so no date needs choosing.
  // A single batch's roster failing just leaves ITS students showing "--"
  // rather than blanking the whole directory -- the directory's own read
  // (listUsers) is what the page's error banner below is for.
  const rosters = await Promise.all(
    (batches ?? []).map(async (b) => ({
      batchName: b.name,
      result: await getBatchRoster({ client, path: { id: b.id } }),
    })),
  );
  const batchByStudentId = new Map<string, string>();
  for (const { batchName, result } of rosters) {
    for (const row of result.data ?? []) {
      batchByStudentId.set(row.student.id, batchName);
    }
  }

  const filter: RoleFilter = show === "student" || show === "mentor" ? show : "all";
  const shownUsers = (users ?? []).filter((u) => {
    if (filter === "student") return u.role === "Student";
    if (filter === "mentor") return u.role === "Admin";
    return true;
  });

  // An unmatched or missing `transfer` id (archived meanwhile, a stale link,
  // no param at all) degrades to the collapsed, unselected form rather than
  // erroring -- spec §7's "degrade, don't 400" posture for this query param.
  const transferTarget = studentOptions.find((s) => s.id === transfer);

  return (
    <div>
      <PageTitle>Users</PageTitle>

      {batchesError !== undefined && (
        <Panel>
          <p role="alert" style={{ color: "var(--st-missed)" }}>
            {batchesError.detail ?? batchesError.title ?? "Something went wrong."}
          </p>
        </Panel>
      )}
      {usersError !== undefined && (
        <Panel>
          <p role="alert" style={{ color: "var(--st-missed)" }}>
            {usersError.detail ?? usersError.title ?? "Something went wrong."}
          </p>
        </Panel>
      )}

      {/*
        Spec D4: collapsed `<details>` disclosures, the same family as
        RibbonKey's "How to read this" -- so the page costs nothing for these
        two forms until a mentor actually opens one. Sized to content (not
        full-width) so two of them read as an action row, not two empty
        panels.
      */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <details className="rounded-[var(--radius-panel)] border" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
            <summary className="cursor-pointer px-4 py-2 text-sm font-semibold" style={{ color: "var(--ink)" }}>
              + Add student
            </summary>
            <div className="px-4 pb-4 pt-1" style={{ minWidth: "280px" }}>
              <RegisterForm batches={batchOptions} />
            </div>
          </details>

          <details className="rounded-[var(--radius-panel)] border" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
            <summary className="cursor-pointer px-4 py-2 text-sm font-semibold" style={{ color: "var(--ink)" }}>
              + Create batch
            </summary>
            <div className="px-4 pb-4 pt-1" style={{ minWidth: "280px" }}>
              <CreateBatchForm />
            </div>
          </details>
        </div>

        <Link href="/students?view=archived" className="text-link text-sm">
          View archived
        </Link>
      </div>

      {/*
        Spec D5/§7: one shared Transfer disclosure, pre-filled from whichever
        row's "Transfer" link was clicked. `open` (not a `defaultOpen` -- the
        DOM attribute, forced every render) so arriving via the query param
        always shows the form rather than only the first time it mounts.
      */}
      <details
        open={transferTarget !== undefined}
        className="mb-6 rounded-[var(--radius-panel)] border"
        style={{ background: "var(--surface)", borderColor: "var(--line)" }}
      >
        <summary className="cursor-pointer px-4 py-2 text-sm font-semibold" style={{ color: "var(--ink)" }}>
          Transfer
        </summary>
        <div className="px-4 pb-4 pt-1">
          {studentOptions.length === 0 || batchOptions.length === 0 ? (
            <EmptyState title="No active student or batch to transfer yet." />
          ) : (
            <TransferForm
              students={studentOptions}
              batches={batchOptions}
              defaultStudentId={transferTarget?.id}
            />
          )}
        </div>
      </details>

      {/* The one filter vocabulary this app already has (Review, Roster,
          Cycles) -- `.chip` + `aria-current="page"` + `?show=`, spec D3. */}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(({ key, label }) => (
          <Link
            key={key}
            href={key === "all" ? { pathname: "/students" } : { pathname: "/students", query: { show: key } }}
            aria-current={key === filter ? "page" : undefined}
            className="chip"
          >
            {label}
          </Link>
        ))}
      </div>

      <Panel>
        {usersError !== undefined ? null : (users === undefined || users.length === 0) ? (
          <EmptyState
            title="No one registered yet."
            hint="Use Add student above to register the first mentor or student."
          />
        ) : shownUsers.length === 0 ? (
          <EmptyState
            title={filter === "student" ? "No students yet." : "No mentors yet."}
            action={
              <Link href="/students" className="text-link">
                Clear filter
              </Link>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Batch</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {shownUsers.map((u) => (
                <tr key={u.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <Td style={{ color: "var(--ink)" }}>{u.displayName}</Td>
                  <Td style={{ color: "var(--ink-muted)" }}>{u.email}</Td>
                  <Td>{u.role === "Admin" ? "Mentor" : "Student"}</Td>
                  {/* A Mentor has no enrolment at all (FR-4) -- "--" the
                      same way the roster treats "nothing recorded", rather
                      than leaving the cell blank. */}
                  <Td style={{ color: "var(--ink-muted)" }}>{batchByStudentId.get(u.id) ?? "—"}</Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      {u.role === "Student" && (
                        <Link href={{ pathname: "/students", query: { transfer: u.id } }} className="text-link">
                          Transfer
                        </Link>
                      )}
                      <ArchiveButton userId={u.id} />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
