# The Students Page Becomes Users — Register Returns, One Table — Design

**Date:** 2026-10-08
**Author:** HafsaRaashid (with Claude Code)
**Status:** Approved by HafsaRaashid on 2026-10-08, decided interactively — table scope (§2),
transfer UX (D5), and the page name (D6) were each settled as their own round before this was
written down
**Feeds:** `feat/mentor-ui-ux-improvements`, one branch and one PR. First slice of a mentor
UI/UX pass; later slices (not scoped here) cover the mentor Today page's confusing cycle
visualisation, the scattered inline `style={{}}` colour overrides on Roster/Review/Cycles, the
overdue human dark-mode visual pass, and O-16's stale-theme-on-Back bug
**FRs:** FR-3 (registration), FR-5 (archive/restore), FR-6 (batch creation), FR-8 (transfer) —
all pre-existing; nothing new is implemented, only reorganised
**Governs / closes:** supersedes [ADR-0022](../../adr/0022-settings-as-the-registration-home.md).
[ADR-0023](../../adr/0023-create-batch-returns-to-students.md) already reversed half of
ADR-0022 (Create batch); this reverses the rest (Register) and adds the rename ADR-0022
considered and rejected once already, under a premise that no longer holds (§3)
**ADRs owed by this slice:** one — see §8

---

## 1. Scope and decision record

| # | Decision | Choice |
|---|---|---|
| D1 | What moves | **Register** moves from Settings back to this page. Create batch is already here (ADR-0023); Transfer and the directory are already here. Settings keeps only **Appearance** — it stops being a registration surface at all. |
| D2 | Table scope | **One combined table** of every `User` — Student and Mentor alike — not a second table, a tab, or a separate mentor page. See §2 for why this is the accurate shape, not a simplification that loses something. |
| D3 | Filtering | Three `.chip` links — **All / Students / Mentors** — reusing the exact pattern Review already ships: `?show=`, `aria-current="page"`, the `.chip` class from `globals.css`. Rejected: a dropdown or a text search box — chips are the one filter vocabulary this app already has (Review, Roster, Cycles all use it), and the table will never hold enough rows to need text search in a tool scoped to a handful of concurrent batches. |
| D4 | Add student / Create batch | Collapsed `<details>` disclosures in an action row under the page title — the same family as `RibbonKey`'s "How to read this". Rejected: always-open panels (today's layout, and exactly the clutter this slice exists to remove); a client-rendered modal (rejected on `docs/design-system.md` §9's "no reinvented form controls" — `<details>` gets focus handling and dismissal from the platform for free, a hand-rolled dialog would have to rebuild both). |
| D5 | Transfer | **One shared disclosure** above the table, reusing the existing `TransferForm` unchanged, opened and pre-filled with whichever row's "Transfer" link was clicked. Rejected: a per-row inline form — duplicates `TransferForm`'s three fields once per row for no behavioural gain over the shared form, and is more code to maintain for a worse result. |
| D6 | Page name | Visible label becomes **"Users"** — sidebar text and `PageTitle` only. **Route stays `/students`.** See §3 for the full naming trail and why the route itself is not renamed. |

**Out of scope**, logged as later slices of the same mentor UI/UX pass rather than silently
dropped: the mentor Today page's cycle-visualisation confusion (needs its own decision on
adopting the pending CycleCalendar PR #6 and/or addressing the batch-aggregation semantics
that caused it); the inline `style={{}}` colour overrides scattered across Roster/Review/Cycles;
the dark-mode visual pass Plan 7A flagged as still needing human eyes; O-16 (stale theme on
browser Back).

## 2. Why one page, one table — this is not a simplification, it is the accurate shape

The question "should mentors get their own management page" came up directly while designing
this. The answer is no, and the reasoning matters because it is easy to mistake for "we merged
two things to save effort" when the opposite is true: **there was never a second thing to
separate.**

- **FR-4**: "Admins have shared access across all batches — any Admin can view and evaluate any
  batch (v1)." Mentors are not scoped to a batch, so there is no batch-assignment step a
  dedicated mentor page could exist to manage.
- **FR-2**: there is no super-admin tier above Admin. Every mentor holds an identical Admin
  account.
- Checked against `admin-actions.ts`: the only operations available for a mentor account are
  **Register** (the same form as a student, minus the batch/start-date fields), **Archive**,
  and **Restore** — the exact three operations a student account also gets. There is no
  mentor-only field, workflow, or permission to give a second page a reason to exist.

A combined table with a **Role** column is therefore the literal data model, not a compromise:
one `User` entity, two role values, identical lifecycle operations. Splitting it into two tables
or two pages would imply a distinction the product does not have.

## 3. The rename, examined

ADR-0022 (2026-08-04) considered renaming Students → "People" and rejected it, for two reasons:

1. It called the rename **"a concession, not a resolution"** — ADR-0022's actual fix was to
   *move registration away* from the page, so the name stopped lying. Renaming instead would
   have kept registration (including minting mentor accounts) on the page while just widening
   its label to cover the mismatch.
2. **Real cost**: `/students` is referenced by name across the e2e suite, the sidebar, and
   `docs/walkthrough.md`.

**Reason 1 no longer applies.** D1 above reverses ADR-0022's core decision — Register, including
mentor creation, is moving back onto this page, on purpose, as a considered design rather than
an oversight. Once that is true, a name that is honest about "this page manages everyone, not
just students" is not a concession papering over a problem; it is the correct label for a page
we have deliberately designed to do that job. The naming trail that followed, for the record:

- **"People"** — ADR-0022's own suggestion, still rejected on reconsideration: flat, and no more
  specific than "Users."
- **"Directory" / "Members" / "Everyone" / "Accounts"** — all considered, none chosen.
- **"Manage"** — a plain verb, which actually fits `docs/design-system.md:489`'s copy-voice rule
  ("plain verbs, sentence case, active voice") better than a noun does. Rejected anyway: every
  other sidebar entry (Today, Roster, Cycles, Settings) is a noun, and "Manage" would be the one
  verb in the list — a naming-pattern inconsistency traded for a different naming-pattern win.
- **"Users"** — chosen. It is the one candidate that matches the underlying domain model the API
  already uses verbatim (`User`, `createUser`, `listUsers`, `UserCreate` in `spec/openapi.yaml`
  and throughout `apps/api`). For the first time, the on-screen label and the code agree.

**Reason 2 (cost) still applies and is handled by scope, not by ignoring it**: this is a
**label-only** rename. The route, the folder (`apps/web/app/(app)/students/`), and every
`href="/students"` stay exactly as they are. What changes:

- `sidebar.tsx`'s `label: "Students"` → `"Users"` (the `href` and `icon` are untouched).
- `students/page.tsx`'s `<PageTitle>` text.
- Test assertions that check the **rendered label text** — `sidebar.test.tsx`,
  `app-frame.test.tsx`, and `students-page.test.tsx` each assert the literal string "Students"
  somewhere; those need updating to "Users" even though nothing about the route changes. This is
  a real, small cost, distinct from a route rename's cost (no folder move, no e2e `goto`/`href`
  changes, no `docs/walkthrough.md` route references to touch).

A full route rename (`/students` → `/people` or `/users`) was priced and rejected: it touches
~8 real files (the three above, plus `admin-actions.ts`'s `revalidatePath("/students")` calls,
three e2e specs, and `docs/walkthrough.md`) for a purely cosmetic win — nobody reads this app's
URLs as copy. If a future slice ever has an independent reason to touch the route, the rename can
ride along with it; it does not need to be bought on its own here.

## 4. Route and layout

`apps/web/app/(app)/students/page.tsx` keeps its existing gate
(`if (user.role !== "Admin") redirect("/")`) and its existing `?view=archived` sub-view,
unchanged. The default view's layout changes from two side-by-side panels (Transfer,
Create batch) plus a bulleted `People` list, to:

```
PageTitle "Users"
[+ Add student]  [+ Create batch]            View archived
▸ Transfer  (collapsed; opens pre-filled — see §6)

[ All ]  Students  Mentors        <- .chip filter row, D3

<Table>  Name | Email | Role | Batch | Actions
```

`listBatches` and `listUsers` are still read once, in parallel, exactly as today — nothing about
the data fetching changes, only what is built from it.

## 5. The table

Reuses the existing `Table`/`Th`/`Td` primitives (`components/ui/table.tsx`), the same
chrome Roster and Cycles already use, replacing the current `<ul>`/`<li>` "People" list (which
carried ad hoc `style={{ color: "var(--ink)" }}` / `style={{ color: "var(--ink-muted)" }}`
inline on every row — this table removes that duplication, not just restyles it).

| Column | Student row | Mentor row |
|---|---|---|
| Name | `displayName` | `displayName` |
| Email | `email` | `email` |
| Role | "Student" | "Mentor" |
| Batch | current batch name | `—` (no batch — FR-4) |
| Actions | **Transfer** · **Archive** | **Archive** only |

Filtered by the D3 chips before rendering — `all`/`student`/`mentor` narrows the same `users`
array client-visibly via the `?show=` query param read server-side, matching Review's existing
pattern exactly (a Server Component re-render, not client state).

Empty states use the existing `EmptyState` component's opt-in `action` slot
(`docs/adr/0032-opt-in-expressive-props.md`) rather than prose pointing at another page — e.g. a
filtered-to-Mentors view with zero mentors can offer "Add student" as its own `action`, which it
could not do while Register lived on Settings.

## 6. Register and Create batch as disclosures

Both become `<details>` wrappers around the existing `RegisterForm` and `CreateBatchForm` —
**the forms themselves do not change**, only what contains them, mirroring the existing
`RibbonKey` disclosure's shape (`rounded-[var(--radius-panel)] border` panel,
`<summary className="cursor-pointer ...">` trigger). Collapsed by default, so the page reads as
one quiet table at rest and the two forms cost nothing until opened.

`RegisterForm` needs `batchOptions` exactly as it does today on Settings — `students/page.tsx`
already reads `listBatches` for Transfer, so no new fetch is introduced.

`settings/page.tsx` drops its `Register` panel and the `listBatches` call it only existed for;
it keeps `Appearance` alone and simplifies to the single-panel shape it already renders for a
Student today (§3 of the original Settings spec), now rendered for every role identically.

## 7. Transfer, pre-filled

The shared `TransferForm` disclosure is controlled by a `?transfer=<userId>` query param:

- Each Student row's "Transfer" action is a `<Link href={{ query: { transfer: s.id } }}>`, not a
  button — it is navigation to a different view of the same page, the same reasoning Review's
  chips already use for `aria-current`.
- The page reads `transfer` from `searchParams` server-side and, when present and the id matches
  an active student: renders the `<details open>` (forced open, not just default-open, so
  arriving via the link always shows the form) and passes that student as `TransferForm`'s new
  `defaultStudentId` prop, which sets the `<select defaultValue={...}>` already in the form.
- An unmatched or missing `transfer` id (archived meanwhile, bad param) falls back to the
  collapsed, unselected form rather than erroring — the same "degrade, don't 400" posture the
  rest of this app's query-param handling uses.

`TransferForm`'s own behaviour (`transferStudentAction`, validation, the `ok`/`error` states) is
unchanged; only one new optional prop is added.

## 8. ADRs owed

**ADR-0034 — Register and the Users page's toolset return to Students.** Supersedes ADR-0022.
Rejected alternatives: leaving Register on Settings (status quo, reintroduces the exact
"one admin task split across two pages" friction this slice exists to remove, now that Create
batch already proved the opposite reasoning in ADR-0023); duplicating Register in both places
(two places to look for the same action, one of them stale the moment the other changes); a
dedicated mentor-management page (§2 — no distinct mentor-only capability exists to manage); and
the naming alternatives in §3 ("People", "Manage", "Directory", a full route rename).

## 9. Testing

| Level | Case |
|---|---|
| Unit | Combined table renders both roles; a Mentor row shows `—` under Batch and only Archive under Actions |
| Unit | Filter chips: `all`/`student`/`mentor` each narrow the rendered rows; chip counts match |
| Unit | Register and Create batch disclosures are collapsed by default and render inside Students, not Settings |
| Unit | Settings renders Appearance only, for every role, with no Register panel |
| Unit | `?transfer=<id>` opens the Transfer disclosure pre-selected to that student; an unmatched id renders it collapsed and unselected |
| Unit | Sidebar and `PageTitle` render "Users"; `href` is still `/students` |
| E2E | `mentor-flows.spec.ts`: register (now via the Students-page disclosure, not Settings), transfer (via a row's Transfer link), archive, still pass under the new layout |

## 10. Documentation to update

- `docs/design-system.md` §6 — frame mock's Students/Settings descriptions swap which panels
  each page carries
- `docs/interview-and-prd.md` §5 — add **O-21**: the rename maps to no FR, logged on the same
  non-blocking footing as O-14/O-15/O-17, mentor sign-off outstanding
- `docs/walkthrough.md` — the Students section gains Register and the filter chips; Settings
  loses its Register panel
- `handoff.md` §1 — a dated entry for this slice

## 11. Risks

| Risk | Handling |
|---|---|
| A reader greps for `"Students"` as page copy and gets a false negative now that the label is "Users" while the route/folder/tests-by-path still say `students` | Named here and in ADR-0034 explicitly, so it is a documented mismatch rather than a surprise; the alternative (full rename) was priced and rejected in §3 |
| The `?transfer=` param becomes a second, undocumented way archived/attacker-supplied ids could be probed | Server-side read only selects from the already-fetched active-student list; an unmatched id renders the collapsed default, never a new query or error surface |
| Combining Register back onto Students re-crowds the page the way it was before ADR-0022 | Mitigated by D4 (collapsed disclosures) and D2 (one table, not four panels) — the page carries fewer always-visible elements than today's four-panel layout, not more |
