import Link from "next/link";
import { redirect } from "next/navigation";
import { listBatches, listUsers, getBatchRoster } from "@irp/client";
import { getCurrentUserOrRedirect, apiClient } from "@/lib/api-client";
import { PageTitle } from "@/components/ui/page-title";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Th, Td } from "@/components/ui/table";
import { Dialog } from "@/components/ui/dialog";
import { RegisterForm, TransferForm, CreateBatchForm, ArchiveButton, RestoreButton } from "./forms";

type RoleFilter = "student" | "mentor";

/**
 * No "all" option (2026-10-09 revision) -- a combined view mixed rows with
 * one action (Mentor: Archive) and rows with two (Student: Transfer,
 * Archive), which read as an inconsistency rather than a real difference.
 * Every view is now homogeneous: every visible row carries the same action
 * set. Defaults to Students, the larger and more frequently used list.
 *
 * Labels only -- no counts folded in, matching Review's own reasoning
 * (review/[studentId]/page.tsx) for keeping a chip's label and its figure
 * apart.
 */
const FILTERS: readonly { key: RoleFilter; label: string }[] = [
  { key: "student", label: "Students" },
  { key: "mentor", label: "Mentors" },
];

/**
 * The column-header treatment the student surfaces use for their own meta
 * lines (SectionLabel's small-caps mono), applied locally rather than by
 * editing the shared `Th` -- Roster and Cycles share that component and
 * were not part of this pass.
 */
function ColHead({ children }: { children: string }) {
  return <span className="text-xs uppercase tracking-[0.08em]">{children}</span>;
}

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
 * Register/Create batch/Transfer moved from collapsed `<details>` disclosures
 * to Dialog-wrapped buttons the same day (2026-10-09) -- a `<details>` reads
 * as a dropdown toggling a section of the page, not as an action; a button
 * that opens a focused popup reads as one. Transfer is per-row ONLY now --
 * the earlier revision also kept one shared Transfer section above the
 * table, which was the same form reachable two ways and read as duplicated
 * rather than as one feature.
 *
 * `?view=archived` renders the FR-5 archive list instead of the working
 * page -- names, emails, and a Restore control per row. It carries no other
 * actions: everything else (transfer, batch creation, re-registration) needs
 * an active user. Unaffected by any of the above.
 */
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; show?: string }>;
}) {
  const user = await getCurrentUserOrRedirect();
  if (user.role !== "Admin") redirect("/");

  const { view, show } = await searchParams;
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

  // The default view's table and its dialogs (Register, Create batch,
  // per-row Transfer) all draw from the same two reads -- every active
  // (non-archived, the default) user and every batch -- rather than each one
  // issuing its own request.
  const [{ data: batches, error: batchesError }, { data: users, error: usersError }] =
    await Promise.all([
      listBatches({ client }),
      listUsers({ client }),
    ]);

  const batchOptions = (batches ?? []).map((b) => ({ id: b.id, name: b.name }));

  // A student's CURRENT batch, for the directory table's Batch column. There
  // is no such field on User itself (spec/openapi.yaml's User schema carries
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

  // Degrades to the default rather than erroring on a stray/old `?show=`
  // value -- the same "pick the nearest valid state" posture the rest of
  // this app's query-param handling uses.
  const filter: RoleFilter = show === "mentor" ? "mentor" : "student";
  const shownUsers = (users ?? []).filter((u) =>
    filter === "mentor" ? u.role === "Admin" : u.role === "Student",
  );

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

      {/* "Register", not "Add student" -- this one trigger covers both
          roles via the form's own Role select, and a label naming only one
          of them misled a mentor who opened it to add the other. */}
      <div className="mb-7 flex flex-wrap gap-3">
        <Dialog triggerLabel="+ Register" title="Register">
          <RegisterForm batches={batchOptions} />
        </Dialog>
        <Dialog triggerLabel="+ Create batch" title="Create batch">
          <CreateBatchForm />
        </Dialog>
      </div>

      {/* The one filter vocabulary this app already has (Review, Roster,
          Cycles) -- `.chip` + `aria-current="page"` + `?show=`.
          "View archived" sits at this row's far end rather than up with the
          buttons: it switches which set of people the table shows, which is
          what these chips do, not an action that changes anything. */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(({ key, label }) => (
            <Link
              key={key}
              href={key === "student" ? { pathname: "/students" } : { pathname: "/students", query: { show: key } }}
              aria-current={key === filter ? "page" : undefined}
              className="chip"
            >
              {label}
            </Link>
          ))}
        </div>

        <Link href="/students?view=archived" className="chip">
          View archived
        </Link>
      </div>

      <Panel>
        {usersError !== undefined ? null : shownUsers.length === 0 ? (
          <EmptyState
            title={filter === "mentor" ? "No mentors yet." : "No students yet."}
            hint={`Use + Register above to add the first ${filter === "mentor" ? "mentor" : "student"}.`}
          />
        ) : (
          /* `fixed`: equal-width columns rather than content-sized ones, so
             the four (three, for mentors) read as an even grid instead of
             leaving Batch stranded between a wide Email and a right-drifting
             Actions. */
          <Table fixed>
            {/*
              No Role column, and no Batch column in the Mentors view: with
              "all" gone every row in a given view has the same role, so a
              Role column repeated "Student" nine times and "Mentor" twice
              told a reader nothing the active chip had not already said.
              Batch goes the same way for mentors specifically -- a mentor
              holds no enrolment at all (FR-4), so that column was "—" on
              every row it could ever render. Both are columns whose only
              possible value is implied by the filter, which is exactly what
              dropping "all" made true.
            */}
            <thead>
              <tr>
                <Th><ColHead>Name</ColHead></Th>
                <Th><ColHead>Email</ColHead></Th>
                {filter === "student" && <Th><ColHead>Batch</ColHead></Th>}
                <Th><ColHead>Actions</ColHead></Th>
              </tr>
            </thead>
            <tbody>
              {shownUsers.map((u) => {
                const isSelf = u.id === user.id;
                const batchName = batchByStudentId.get(u.id);
                return (
                <tr
                  key={u.id}
                  className="transition-colors hover:bg-[var(--bg)]"
                  style={{ borderTop: "1px solid var(--line)" }}
                >
                  <Td style={{ color: "var(--ink)" }}>
                    <span className="font-medium">{u.displayName}</span>
                    {/* The signed-in mentor's own row, named rather than left
                        to be inferred from a missing Archive button. */}
                    {isSelf && (
                      <span className="ml-2 text-xs" style={{ color: "var(--ink-muted)" }}>You</span>
                    )}
                  </Td>
                  {/* truncate, not wrap: table-fixed splits the width evenly,
                      and an address with no spaces in it has no break point
                      to wrap at, so it would otherwise spill into the next
                      column. `title` keeps the full value reachable. */}
                  <Td style={{ color: "var(--ink-muted)" }}>
                    <span className="block truncate" title={u.email}>{u.email}</span>
                  </Td>
                  {filter === "student" && (
                    <Td>
                      {batchName === undefined ? (
                        <span style={{ color: "var(--ink-muted)" }}>—</span>
                      ) : (
                        /* --primary on --primary-weak is one of the pairs
                           theme-tokens.test.ts already verifies (5.99:1
                           light, 5.50:1 dark), so this accent introduces no
                           unaudited colour. */
                        <span
                          className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{ background: "var(--primary-weak)", color: "var(--primary)" }}
                        >
                          {batchName}
                        </span>
                      )}
                    </Td>
                  )}
                  <Td>
                    <div className="flex items-center gap-3">
                      {/* Per-row only -- the only entry point now, fixed to
                          THIS student (forms.tsx's TransferForm takes one
                          student, not a list -- see its own comment on why
                          a dropdown of every student was both unusable here
                          and a real defect). A row full of students implies
                          at least one batch exists (FR-3 requires enrolment
                          at registration, and batches are never deleted), so
                          there is no empty-batches case left to guard
                          against here the way the old shared form did. */}
                      {u.role === "Student" && (
                        <Dialog triggerLabel="Transfer" title={`Transfer ${u.displayName}`}>
                          <TransferForm
                            student={{ id: u.id, displayName: u.displayName, email: u.email }}
                            batches={batchOptions}
                          />
                        </Dialog>
                      )}
                      {/* No Archive on your own row: the API refuses a
                          self-archive with a 409 (SelfArchiveError), so the
                          button could only ever fail there. Offering a
                          control whose single outcome is an error message
                          is worse than not offering it. */}
                      {isSelf ? (
                        <span className="text-sm" style={{ color: "var(--ink-muted)" }}>—</span>
                      ) : (
                        <ArchiveButton userId={u.id} />
                      )}
                    </div>
                  </Td>
                </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
