# ADR-0031: Two student pages, feedback with the history

## Status
Accepted (2026-10-05). Records **D3** of
`docs/superpowers/specs/2026-10-05-student-surface-refresh-design.md`. Implements **FR-29** and
stays inside **FR-30**. Relates to `docs/design-system.md` §8.2, whose layout it keeps.

## Context
The student has two routes today: `/` and `/my-month`. The direction for this slice split them three
ways — a scan-only dashboard, a `/daily` action page, and a history page — on the assumption that
home was carrying too much to read at a glance.

Measuring what home actually holds says otherwise. The composer is a `<select>`, a four-row
`<textarea>` and a button. "Recent days" is a short list, not a history: `submissionWindow()`
returns today plus the previous weekday, which is **two** panels Tuesday through Saturday.

**Monday is the exception, and it is the sizing case.** Friday, Saturday and Sunday all have Monday
as their next weekday, so all three stay inside grace until Monday night and `targetDates` carries
**four** entries (`submission-window.test.ts:30`). Home is therefore roughly 940px on most days and
~1340px on a Monday, against the 1280px viewport NFR-13 fixes. Either way the scan — greeting,
ribbon, counts, streak, about 290px — sits above the fold and the work sits below it. A Monday costs
one screen of scroll through content the student came to act on.

The second half of the question is where the strengths-and-areas band belongs.
`strengthsAndWeaknesses` is `null` for **every student in this release**: **O-5** blocks the AI
provider decision, so no evaluation exists to summarise.

## Decision
**Two student routes, not three.** `/my-month` is renamed `/my-progress` and takes the feedback band
off home.

| Route | Label | Holds |
|---|---|---|
| `/` | **Today** | greeting · ribbon · counts · streak · composer · recent days · mark absent |
| `/my-progress` *(renamed from `/my-month`)* | **My progress** | "Month N of 6" pips · day-by-day history · strengths & areas |

**§8.2 is not reversed.** That section places the submission box "immediately below" the ribbon, and
that is exactly what stays. The composer does not move, home keeps the primary action, and the only
deviation from §8.2 is the feedback band leaving. §8.2 is amended to record the band's new home, not
to walk back its layout.

**The feedback band goes with the history it describes, not onto a page of its own.** A top-level
destination whose only content is an empty state teaches the student that the app is empty — and
that is what a Feedback route would be for every student this release while O-5 is open. Beside the
day-by-day history, the same empty state reads as a section not yet filled rather than as a
destination with nothing in it.

**`/my-month` → `/my-progress` is a route rename, not a label change.** FR-29 defines this page as
"own submission history, programme progress … and the current strengths-and-weaknesses summary", and
"progress" is the only word that covers all three. The rename touches `sidebar.tsx`, the page
directory, `test/my-month-page.test.tsx` and the student e2e spec. `typedRoutes: true` fails the
**build** on any path missed, which is the good kind of failure — but note that `pnpm typecheck`
alone will not catch it, because the route union `tsconfig` reads is written by `next build`.

## Consequences
- Daily submission stays one page deep and zero clicks in. It is **SC-4**, the must-ship, and a
  third route would have cost a click every day to save scrolling on one.
- A Monday scrolls. Accepted deliberately: the scroll passes through the student's own recent days,
  which is content they are there for, not chrome.
- Home loses the feedback band while gaining a greeting band and a streak chip, so it does not grow
  on net. The history page gains a second subject, and with it a reason to be visited.
- When O-5 resolves and summaries start arriving, the band is already sitting beside the history
  that explains it. Nothing moves again, and no route is added.
- After the rename, `grep -rn "my-month" apps/web/` must return **no live route reference**. The
  sidebar and the student e2e spec both carry the literal path, and neither is covered by
  `typecheck`. It will not return *zero lines*: `sidebar.tsx:21` carries a historical comment
  ("Task 8 added `.../my-month/page.tsx`…") that is correct prose about the past and must be left
  alone. Read each hit; do not rewrite a true historical note to satisfy a grep.

## Rejected alternatives
1. **Three pages, with a `/daily` action page.** The direction as given: home becomes scan-only and
   the composer moves to its own route. Rejected on two grounds. The content does not fill a page —
   a select, a four-row textarea and a button is not a destination. And it puts **SC-4**'s daily
   submission one click deeper for every student, every working day, to save the one screen of
   scroll that only a Monday produces. That trade is the wrong way round.
2. **Four pages, with a separate Feedback route.** Three pages' objection, twice over. It deepens
   SC-4 exactly as above *and* promotes to a top-level destination a band that renders `null` for
   every student in this release while O-5 is open. The first thing a student would learn from the
   navigation is that one of their four pages is empty.
3. **Leave the feedback band on home.** The smallest change — nothing moves, and §8.2's diagram
   stands untouched. Rejected because home then carries three unrelated bands (act on today, review
   recent days, read a summary of a month), and the history page is left as a ribbon and a list with
   no reason to be visited. The band is the one thing that gives `/my-progress` a second subject.
