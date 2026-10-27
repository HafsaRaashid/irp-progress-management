# ADR-0034 — Register and the Users page's toolset return to Students

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** HafsaRaashid (with Claude Code)
- **Requirements:** FR-3, FR-5, FR-6, FR-8
- **Relates to:** `docs/design-system.md` §6, §9
- **Supersedes:** [ADR-0022](0022-settings-as-the-registration-home.md)

---

## Context

ADR-0022 moved `Register` (and, briefly, `Create batch`) off the Students page and onto
Settings, because a page named "Students" minting mentor accounts was a wrong mental model
handed to every reader. ADR-0023 already reversed half of that move — `Create batch` came back
to Students because a batch is not a person and the two-panel Settings layout it left behind
read as broken.

Starting a dedicated mentor UI/UX pass (`feat/mentor-ui-ux-improvements`) surfaced the same
page again, this time as "this is confusing to navigate." Working through it
(`docs/superpowers/specs/2026-10-08-mentor-users-page-design.md`) produced three findings that
together reopen ADR-0022's remaining decision:

1. There is no separate "mentor management" concept to justify keeping registration apart from
   the directory it populates — FR-4 gives every mentor identical, batch-unscoped access, and
   the only lifecycle operations a mentor account has (Register, Archive, Restore) are the exact
   same three a student account has.
2. Splitting one admin task (manage who exists) across two pages, now that Create batch has
   already proven the opposite is workable, is friction with no remaining justification.
3. ADR-0022's own rejected-alternative #2 — renaming Students to "People" — was turned down on
   the specific grounds that it would be "a concession, not a resolution," because at the time
   registration was *leaving* the page. That premise inverts once registration is deliberately
   brought back: a name describing "this page manages everyone" stops conceding anything and
   becomes accurate.

## Decision

Move `Register` from Settings back to Students, joining `Create batch`, `Transfer`, and the
directory, which never left. Settings is reduced to **Appearance** only, for every role.

Relabel the page **"Users"** — sidebar text and `PageTitle` only. **The route stays
`/students`** (see Rejected alternatives).

## Rejected alternatives

**1. Leave Register on Settings (status quo).** Zero work. Rejected because it preserves the
exact friction this decision exists to remove: one admin task (add a person) split from the
table that immediately lists what was just added, for no remaining reason now that Create batch
already came back under ADR-0023's reasoning.

**2. Duplicate Register on both pages.** Avoids picking one home. Rejected: two places to
perform the same action means one of them silently drifts out of sync with the other the next
time either is touched, and a mentor has to guess which copy is current.

**3. A dedicated mentor-management page**, separate from a students-only directory. Rejected:
checked against FR-4 (Admins share access across all batches, no mentor-to-batch scoping to
manage) and against `admin-actions.ts` (a mentor account's only operations — Register, Archive,
Restore — are identical to a student account's). There is no mentor-specific capability for a
second page to exist around; splitting the table would imply a distinction the data model does
not have.

**4. Rename to "People."** ADR-0022's own suggestion, raised again and rejected again — this
time not on ADR-0022's original grounds (which no longer apply, see Context §3), but because it
is flat and no more specific than "Users." Also considered and rejected in the same pass:
**"Manage"** (a plain verb, which fits the design system's copy-voice rule, but would be the one
verb among otherwise-all-noun sidebar labels — Today, Roster, Cycles, Settings); **"Directory,"
"Members," "Everyone," "Accounts"** (all plausible, none distinctive). "Users" won because it is
the only candidate that matches the domain model the API already uses verbatim (`User`,
`createUser`, `listUsers`).

**5. Rename the route too** (`/students` → `/people` or `/users`), for full consistency between
URL and label. Priced at roughly 8 files — the folder itself, `admin-actions.ts`'s
`revalidatePath` calls, the sidebar `href`, three e2e specs, and `docs/walkthrough.md` — against
a purely cosmetic benefit, since nobody reads this application's URLs as user-facing copy.
Rejected for this slice; nothing prevents a future slice with an independent reason to touch the
route from carrying the rename along with it.

## Consequences

- Settings becomes a single-section page (Appearance) for every role, rather than gating a
  second, Admin-only section — simpler than today's per-section gating, not just smaller.
- Register, Create batch, Transfer, Archive/Restore are all on one page again, now organised as
  one table plus two collapsed disclosures and one pre-fillable shared Transfer disclosure,
  rather than the four always-open panels the page carried before ADR-0022. The page gains a
  responsibility back without regaining the clutter that motivated splitting it in the first
  place — `docs/superpowers/specs/2026-10-08-mentor-users-page-design.md` §4–§7 owns that shape.
- The page's folder, route, and every existing `href="/students"`/e2e `goto` are untouched. Only
  the rendered label changes, in `sidebar.tsx` and `students/page.tsx`'s `PageTitle`, plus the
  handful of test assertions that check that literal rendered string
  (`sidebar.test.tsx`, `app-frame.test.tsx`, `students-page.test.tsx`).
- A reader who greps for `"Students"` as on-screen copy will get a false negative now that the
  label is "Users" while the route, folder, and most test/file names still say `students`. This
  mismatch is deliberate (see Rejected alternative 5) and is named in the spec's Risks section
  rather than left to be rediscovered.
- Logged as **O-21** in `docs/interview-and-prd.md` §5 — the rename itself maps to no FR, on the
  same non-blocking footing as O-14/O-15/O-17. The Register/Create batch/Transfer consolidation
  is covered by FR-3/5/6/8 directly and needs no open point of its own.
