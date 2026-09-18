# IRP Progress Management System — Interview Record & PRD

**Deliverable:** Month 2 (Internal Project Sprint) — Deliverable 1
**Project:** IRP Progress Management System
**Repository:** `irp-progress-management`
**Author:** Damian De Cruz (solo)
**Drafted:** 2026-07-27
**Source brief:** `IRP_Progress_Management_System_Brief.pdf` (v1.0 Draft)
**Status:** Draft — open points listed in §5

---

## 1. Interview Record

### 1.1 Session details

| Field | Value |
|---|---|
| Stakeholder | IRP Mentor, Bistec Hearts Academy |
| Role | Mentor / evaluator for an IRP student group; owns monthly progress evaluation and reward decisions |
| Interview date | _TODO — to be filled in_ |
| Duration | _TODO — to be filled in_ |
| Attendees | Damian De Cruz (interviewer), IRP Mentor (stakeholder) |
| Format | Conversational walkthrough of the draft brief, question plan prepared in advance |
| Raw record | `damian-month2-stakeholder-interview-questions.md` — question plan with the stakeholder's answers |

> **Note on fidelity.** The interview was conducted conversationally against a written question plan; there is no audio recording, so the answers below are the stakeholder's recorded responses, lightly cleaned for grammar with meaning preserved. They are not a timestamped verbatim transcript. Where an answer was ambiguous it was resolved with a follow-up in the same session.

### 1.2 Key points captured

**On how evaluation works today**
> "Attendance is logged after each meeting. Speaking up at meetings and giving prior notification of events are also taken into account."

> "Notes and an Excel sheet, which are reviewed by seniors."

> "2 to 2.5 hours a day per group of 5 students."

**On why a system is needed**
> "Continuous integration of the tracking process and better time management."

> "Management would question the evaluations."

> "Nothing has been questioned so far with the current approach — the root driver is the time cost and keeping progress visible in one place so management can trust the evaluations."

**On what "done" looks like**
> "If seniors can understand the reports at a glance and hand the data over to newer people."

> "10/10 students submitting daily, with late submissions tracked. Evaluation time reduced from 2.5 hours a day to about 20 minutes."

> "The performance summary dashboard and the daily student submission count." — asked what must ship if only one thing could

**On the AI's role**
> "It sets the score completely; the mentor can override it if they disagree."

> "No editing — it goes straight into the report."

**On what students see**
> "Students see a strengths-and-weaknesses summary." — not scores, not rank

### 1.3 Five-whys chain

| # | Question | Answer | Reading |
|---|---|---|---|
| 0 | Surface request | "A system where students log progress and I review it" | Solution stated as the need |
| 1 | Why a system instead of continuing as-is? | Continuous integration of the tracking process, and better time management | Two drivers surface: continuity and time |
| 2 | Why does that matter — what goes wrong when progress isn't in one place? | "Management would question the evaluations" | Points at a trust/defensibility problem |
| 3 | Has an evaluation actually been disputed? | No — nothing has been questioned so far | The trust problem is **anticipated, not experienced**. Probe was wrong; keep going |
| 4 | So what is actually costing you today? | The time cost, and keeping progress visible in one place so management can trust the evaluations | Real driver isolated |
| 5 | Why does visibility matter beyond you personally? | "If seniors can understand the reports at a glance and hand the data over to newer people" | **Root cause** below |

**Root cause.** Student progress currently lives in one mentor's notes, private Excel sheets, and memory. That makes evaluation expensive (2–2.5 h/day per group of 5) and non-transferable — a new senior cannot pick up a batch without the original mentor walking them through it. The request is not "a logging app"; it is *make the evaluation record cheap to produce and legible to someone who wasn't in the room.*

Note that the five-whys deliberately did **not** land on fairness or dispute-resolution, which was the interviewer's initial hypothesis. The stakeholder rejected it directly ("nothing has been questioned so far"), and the chain was re-pointed at cost and handover instead. Designing for dispute-proofing would have been building against a misread.

### 1.4 Success criteria — in the stakeholder's words

| # | Criterion | Stakeholder's phrasing | Measurable form |
|---|---|---|---|
| SC-1 | Submission compliance | "10/10 students submitting daily, with late submissions tracked" | 100% of enrolled students submit on each weekday; late entries flagged, not silently accepted |
| SC-2 | Evaluation effort | "Evaluation time reduced from 2.5 hours a day to about 20 minutes" | ≤ 20 min per monthly cycle per group of 5, down from 2.5 h/day |
| SC-3 | Legibility & handover | "If seniors can understand the reports at a glance and hand the data over to newer people" | A senior with no prior contact with the batch can summarise a student's month from the report alone, unaided |
| SC-4 | Must-ship surface | "The performance summary dashboard and the daily student submission count" | Both present and correct in the first shippable increment |

### 1.5 Decision owner and escalation

| Question | Answer |
|---|---|
| Who signs off on the PRD and the finished tool? | The interviewed IRP Mentor |
| Escalation path for decisions the stakeholder can't make | Bistec Hearts Academy team / leadership team |
| Follow-up channel during the sprint | Microsoft Teams |
| Demo checkpoint | To be scheduled |

---

## 2. Problem Statement

### 2.1 The problem

Bistec Hearts Academy mentors evaluate IRP students on a monthly cycle, but the evidence for those evaluations is assembled by hand. Attendance is logged after each meeting into personal notes; daily activity lives in an Excel sheet that seniors review; qualitative judgements (did the student speak up, did they give prior notice of an absence) live in the mentor's head. Nothing is queryable, and nothing is portable.

Three consequences follow:

1. **Evaluation is expensive.** 2–2.5 hours per day per group of 5 students, spent reconstructing what happened rather than judging it.
2. **It does not scale.** The Academy runs two concurrent batches and expects to grow. Effort scales linearly with student count because there is no aggregation step — each student's month is rebuilt from raw notes.
3. **It does not transfer.** A senior who did not attend the meetings cannot evaluate from the artefacts alone, so the record cannot be handed to a new mentor without a verbal walkthrough.

### 2.2 Cost of inaction

| Dimension | Today | If unchanged |
|---|---|---|
| Mentor time | 2–2.5 h/day per group of 5 | ~50 h/month per group. At 2 concurrent batches, effectively a full-time role in reconstruction work |
| Scaling headroom | Manual, linear in student count | Growth beyond current batches requires proportionally more mentor hours, not more system capacity |
| Continuity | Record is in one mentor's notes and memory | Mentor turnover or leave loses evaluation context for a batch mid-programme |
| Defensibility | Not yet challenged | Evaluations rest on artefacts leadership cannot independently read; the stakeholder expects this to be questioned as the programme grows |

Worth stating plainly: no evaluation has actually been disputed. The defensibility line is a forward-looking concern the stakeholder raised, not a live incident. It justifies keeping the audit trail, not designing the product around dispute resolution.

### 2.3 Primary success metric

> **Monthly evaluation effort for a group of 5 students drops from ~50 hours (2.5 h/day × 20 weekdays) to ≤ 20 minutes, while daily submission compliance holds at 10/10 students with late submissions explicitly flagged.**

Secondary: a senior with no prior contact with a batch can summarise any student's month from the generated report without asking the mentor.

---

## 3. PRD

### 3.1 Personas

**P-1 — Mentor / Admin (primary)**
Hearts Academy mentor running one or more IRP student groups. Reviews daily submissions, records attendance and task completion, evaluates monthly against the rubric, and decides awards. Currently spends 2–2.5 h/day per group of 5 on tracking. Comfortable with Excel and Teams; not a developer. Works from a laptop. Wants the reconstruction work to disappear, not the judgement work — they still want to be the one who decides.

**P-2 — Student (primary)**
IRP intern in a 6-month batch. Submits a short text update at the end of each working day describing what they did. Wants submitting to be fast (well under 2 minutes) and wants to know where they stand — but is shown a strengths-and-weaknesses summary, never a score or a rank. Works from a laptop.

**P-3 — Hearts Academy / Leadership (secondary, read-only recipient)**
Receives the monthly summary and the winner PDF. Does not operate the system in v1 — consumes generated output only. Needs the report to stand on its own without a verbal briefing.

### 3.2 Goals

| # | Goal | Tied to |
|---|---|---|
| G-1 | A student's whole month is assembled by the system, not by the mentor — monthly evaluation for a group of 5 takes ≤ 20 min | SC-2 |
| G-2 | Every weekday, the mentor can see at a glance who submitted, who is late, and who is absent | SC-1, SC-4 |
| G-3 | The generated monthly report is legible to a senior with no prior contact with the batch | SC-3 |
| G-4 | Scores are produced by AI against a fixed rubric, with the mentor able to override — the mentor keeps the final judgement | Interview §4.5 |
| G-5 | The monthly winner is computed from scores, with an AI-written justification in a downloadable PDF | Interview §4.7 |
| G-6 | Students get useful feedback (strengths and weaknesses) without introducing ranking or competition | Interview §4.6 |

### 3.3 Non-goals

Explicitly out of scope for v1. Each was confirmed with the stakeholder.

| # | Non-goal | Why |
|---|---|---|
| NG-1 | **File or attachment uploads** — submissions are plain text only | Confirmed by stakeholder; removes storage, virus-scanning, and file-type handling from v1 entirely |
| NG-2 | **Task assignment or project management** — the system records what was done, it never assigns work | Work is assigned outside the system; adding it would make this a PM tool |
| NG-3 | **Leave / absence request workflow** — absence is *recorded*, never *requested or approved* | Confirmed: absence tracking only. No approval chain, no balances |
| NG-4 | **Native mobile app or mobile-responsive layout** — laptop browsers only | Daily use is laptop-only in v1 |
| NG-5 | **Configurable rubric** — the five criteria and their 20/25/25/10/20 weights are fixed in code | Stakeholder confirmed fixed, explicitly not admin-editable |
| NG-6 | **Any student-visible score, rank, or leaderboard** — and no student-to-student visibility or messaging | Deliberate: students see only their own strengths-and-weaknesses summary |
| NG-7 | **Cross-batch comparison or analytics** | Batches are evaluated independently |
| NG-8 | **Data migration** — no import of existing notes or Excel sheets; the system starts empty | Confirmed: start fresh |
| NG-9 | **Admin correction of submission dates** — no back-dating, no edit-the-date feature | The system prevents wrong-date submission by construction (FR-15), so a correction path is unnecessary |
| NG-10 | **A reject step in review** — entries go In Review → Evaluated, never Rejected | Confirmed: no reject. Adjustments happen at monthly evaluation |
| NG-11 | **Editing the AI summary** | Confirmed: the summary goes into the report exactly as generated |
| NG-12 | **Payroll, stipend, or HR system integration** | Out of scope |

**Deferred to v2** (in the brief, agreed as droppable if the sprint tightens): quarterly evaluation (same rubric applied over 3 cycles) and automated emailing of the monthly report. See open point O-2 in §5.

### 3.4 Functional requirements

#### Identity and access

| # | Requirement |
|---|---|
| FR-1 | All users authenticate via Azure AD SSO on the Bistec training tenant. No local passwords, no self-registration. All students already hold Bistec accounts. |
| FR-2 | Two roles: **Admin** (mentor) and **Student**. Every mentor holds an Admin account. There is no super-admin tier above Admin. |
| FR-3 | Any Admin can register additional mentors and students. |
| FR-4 | Admins have shared access across all batches — any Admin can view and evaluate any batch (v1). |
| FR-5 | Removing a student hides them from active lists but retains all their historical data, reachable from an archive view for later analysis. Deletion is never automatic. |

#### Batches and programme structure

| # | Requirement |
|---|---|
| FR-6 | A batch has a name, a start date, and an end date. Batches run on independent calendars. Two concurrent batches are expected; the system must not hard-code that limit. |
| FR-7 | Programme duration is fixed at 6 months per student in v1. |
| FR-8 | A student can be transferred between batches. Their history follows them and their 6-month total is unchanged by the move. |
| FR-9 | Evaluation cycles run from the 10th of one month to the 9th of the next (e.g. 10 Aug → 9 Sep, next cycle opens 10 Sep), anchored to the batch's admission date. All cycle boundaries are evaluated in **Asia/Colombo (UTC+05:30)**. |

#### Daily submissions

| # | Requirement |
|---|---|
| FR-10 | A student submits a **text-only** daily update. No attachments, no links required. |
| FR-11 | Multiple entries per day are allowed. All entries for a date roll up into that date's daily report. |
| FR-12 | **Weekdays are required submission days.** Saturdays and Sundays are **optional**: they may hold entries, but carry no submission obligation. A weekend is never counted as missed, never flagged late, and never appears in a compliance denominator. *(Revised 2026-07-28 — see O-11.)* |
| FR-13 | The deadline for a given weekday is 23:59:59 Asia/Colombo on that date. Entries for the immediately preceding weekday are accepted for one further day and flagged **Late**. |
| FR-14 | After the one-day grace window closes, the day is final — no further submission is possible for it. |
| FR-15 | Each entry may only target the current weekday or the immediately preceding weekday. Submitting to any other date is impossible by construction. |
| FR-16 | A student can mark a weekday as **Absent** with a reason. Absence is recorded as a distinct state from a missed submission. |
| FR-17 | A student may optionally include attendance and task notes in their daily update. This is supplementary — the mentor's own record is authoritative (FR-19). |
| FR-33 | An entry on a Saturday or Sunday is recorded as **Extra**. Extra work is visible to the mentor and supplied to the AI summary as positive context. Its *absence* is never penalised, and it never affects the compliance rate. *(Added 2026-07-28 — see O-11.)* |

#### Review workflow

| # | Requirement |
|---|---|
| FR-18 | A day's submission moves through **Submitted → In Review → Evaluated**. There is no Rejected state. |
| FR-19 | The mentor records attendance and task completion themselves, independently of what the student wrote. The mentor's record is the authoritative one. |
| FR-20 | Once a day reaches Evaluated it is locked for the student. Approval decisions are not revisited — corrections happen at the monthly evaluation, which is where the mentor's override lives (FR-24). |
| FR-21 | Notifications fire on submission and on state change, delivered to **Microsoft Teams and email**. |

#### AI monthly evaluation

| # | Requirement |
|---|---|
| FR-22 | **Superseded pending O-18.** At cycle close, the system generates an AI summary of the student's month from all their submissions plus the mentor's attendance and task records. |
| FR-23 | **Superseded pending O-18.** The AI scores the student against the fixed five-criterion rubric (weights **20 / 25 / 25 / 10 / 20**) producing a performance index. Criteria and weights are not configurable at runtime. |
| FR-24 | **Superseded pending O-18.** The AI-produced score is the score of record. The mentor may override it; an override stores the new score, the original AI score, and the mentor's reason. |
| FR-25 | The AI summary text is not editable. It enters the report exactly as generated. |
| FR-26 | **In direct conflict with O-18, not merely superseded — flagged, not silently resolved.** As written: "There is no day-to-day scoring. Scoring happens once per monthly cycle." The O-18 design (mentor scores each `Entry` as it is reviewed) is per-submission, which is per-day by construction — the two cannot both be true. Needs the same explicit mentor sign-off as O-18 itself before this FR's text is rewritten. |
| FR-27 | A student who joins or leaves partway through a cycle is not evaluated for that cycle. |

#### Dashboards and reporting

| # | Requirement |
|---|---|
| FR-28 | **Mentor dashboard** (must-ship, SC-4): performance summary per batch plus today's submission count in the form "*N of M* submitted", with late and absent counts visible without scrolling. |
| FR-29 | **Student dashboard**: own submission history, programme progress ("Month N of 6"), and the current strengths-and-weaknesses summary. |
| FR-30 | Students see no numeric score, no rank, no leaderboard, and no data belonging to any other student. |
| FR-31 | The system computes the monthly winner per batch from rubric scores, applying a deterministic, documented tie-break rule (see open point O-3). |
| FR-32 | The monthly winner PDF is downloadable and contains an AI-generated justification for the award. |

### 3.5 Non-functional requirements

| # | Requirement | Target |
|---|---|---|
| NFR-1 | API latency under sustained load | p95 < 250 ms at 50 RPS |
| NFR-2 | Burst tolerance | 200 RPS for 30 s with zero 5xx responses |
| NFR-3 | Authenticated throughput | 10 RPS for 5 min with zero token failures |
| NFR-4 | Memory stability | No drift > 50 MB over a 30-minute idle watch |
| NFR-5 | Deploy pipeline duration | Under 8 minutes, merge to staging-live |
| NFR-6 | Observability | Every request traced; traces visible in Azure App Insights within 60 s |
| NFR-7 | API contract quality | `spec/openapi.yaml` lints clean with `@redocly/cli` — zero errors **and** zero warnings |
| NFR-8 | API documentation coverage | 100% of endpoints document happy-path and error-path examples, including 4xx and 5xx |
| NFR-9 | Student submission effort | A daily submission completes in under 2 minutes |
| NFR-10 | Mentor evaluation effort | A monthly cycle for a group of 5 completes in ≤ 20 minutes |
| NFR-11 | Data retention | Retained indefinitely. Deletion is manual and Admin-only; nothing is purged on a schedule |
| NFR-12 | Time handling | All timestamps stored in UTC; all cycle, deadline, and late calculations evaluated in Asia/Colombo (UTC+05:30) |
| NFR-13 | Client support | Desktop browsers only in v1 — minimum 1280px width. No mobile layout is provided or tested |
| NFR-14 | Access control | Staging is reachable at a public URL, gated behind Azure AD auth |
| NFR-15 | AI determinism | An identical month of input produces a score within ±2 points across runs; the score and the model version used are persisted with the evaluation |

### 3.6 Out-of-scope list (v1 boundary, at a glance)

File uploads · task assignment · leave requests · mobile app · configurable rubric weights · student-visible scores, ranks, or leaderboards · student-to-student visibility or messaging · cross-batch analytics · data migration · admin date-correction · reject/resubmit flow · AI summary editing · payroll/HR integration · quarterly evaluation (v2) · automated report emailing (v2).

---

## 4. Team Contract

**Team size: 1.** The Month 2 sprint is being run solo, so the three BMAD roles are held by one person. That removes peer review, which is the main safeguard the role split exists to provide — so this contract states what replaces it rather than pretending the split is real.

### 4.1 Role assignments

| Role | Held by | Owns | Named decision owner for |
|---|---|---|---|
| **Spec Lead** | Damian De Cruz | PRD, user stories, acceptance criteria; sole owner of the stakeholder channel | Requirement wording, story decomposition, acceptance criteria |
| **Impl Lead** | Damian De Cruz | Architecture doc, monorepo scaffold, Claude Code session orchestration (one agent per story) | Libraries, file layout, schema design, implementation patterns |
| **Review Lead** | Damian De Cruz | ADRs, PR review, merge gates | Whether a PR merges; whether a decision needs an ADR |

### 4.2 Decision rights

| Class | Who decides | Examples |
|---|---|---|
| **Decide alone, no record needed** | Impl Lead | Library choice within the fixed stack, folder structure, component breakdown, test layout |
| **Decide alone, ADR required** | Review Lead | Anything with a rejected alternative worth naming: AI provider, Prisma vs raw SQL, background job strategy, auth session handling |
| **Requires stakeholder sign-off** | IRP Mentor (decision owner) | Any change to stakeholder-visible scope, rubric semantics, what students can see, cycle boundaries, notification behaviour |
| **Escalate beyond the stakeholder** | Hearts Academy / leadership team | AI provider cost or data-processing terms, data retention policy, anything sending student data to a third party |

**Standing rule:** if a decision changes anything in §3.3 (non-goals) or §3.4 (functional requirements), it is not mine to make — it goes to the mentor via Teams before any code moves.

### 4.3 What replaces peer review

| Safeguard normally provided by | Solo substitute |
|---|---|
| A second person reviewing the PR | No direct commits to `main`. Every story lands via branch + PR. Review is a **separate pass in a fresh Claude Code session**, so the reviewing context is not the authoring context, checked against the Bistec PR Review Checklist v2 (architecture, correctness, tests, ergonomics, ops). |
| A teammate catching an unjustified decision | Any decision with a plausible rejected alternative gets an ADR before implementation, with at least two alternatives named and rejected in writing. |
| Someone noticing scope creep | Every PR description states which FR it implements. A PR that maps to no FR does not merge. |
| A second opinion on the stakeholder's intent | Ambiguities go to the mentor in a batched Teams message rather than being resolved by assumption. Anything resolved by assumption is logged in §5 of this document. |

### 4.4 Communication cadence

| Rhythm | When | Form |
|---|---|---|
| Written standup | Every working day | Entry in the sprint log: done since last / next / blockers. Substitutes for the team standup; keeps a dated record for the retro |
| Stakeholder check-in | Weekly | Teams message to the mentor: progress, decisions taken, questions outstanding |
| Blocking questions | As they arise, batched | Teams. Assumed response window: 1 working day. If unanswered by then, proceed on a stated assumption and log it in §5 |
| PR review pass | Before each merge | Fresh session, checklist-driven (§4.3) |
| Retro | End of sprint | Start / stop / continue, minimum 3 each, plus honest notes on where solo multi-agent orchestration helped and where it cost time |
| Demo checkpoint | To be scheduled with the mentor | Stakeholder demo of the mentor dashboard and daily submission count first (SC-4) |

---

## 5. Assumptions and open points

Items resolved by inference rather than by a stakeholder statement, or still genuinely open. Each needs confirmation before it hardens into code.

| # | Item | Current assumption | Needs |
|---|---|---|---|
| O-1 | Interview date, duration, and stakeholder name | Left as TODO in §1.1 | Damian to fill in |
| O-2 | **Email delivery conflict.** The interview says report PDFs are "downloadable, with an email sent as well" (§4.7), but also lists emailed report delivery as a v2 candidate (§5.3) | v1 ships download-only for the winner PDF; Teams/email notifications still fire for submission and review events (FR-21) | Mentor to confirm which reading is right |
| O-3 | Winner tie-break rule | Not discussed. Assumed: highest weighted score, then highest submission-compliance rate, then earliest average submission time | Mentor to confirm or replace |
| O-4 | Leadership team system access | Assumed report recipients only, no login in v1 | Mentor to confirm |
| O-5 | AI provider and data-processing terms | Undecided. Student submissions are personal data leaving the tenant if a third-party API is used | ADR + escalation to Hearts Academy / leadership before implementation |
| O-6 | Rubric criteria names | Weights (20/25/25/10/20) are confirmed; the five criteria are taken from the brief's table | Confirm the exact criterion wording against the brief before it goes in the schema |
| O-7 | Absence and late handling inside the rubric | Not discussed. Assumed absence and lateness feed the AI summary as context but carry no automatic score penalty | Mentor to confirm |
| O-8 | Out-of-scope list and decision owner (interview §5–§6) | These sections of the interview record were derived from the other answers, not stated directly by the stakeholder | Confirm the non-goals list and the named decision owner explicitly |
| O-9 | Demo Day #2 date | To be scheduled | Mentor |
| O-10 | **Grace-window conflict between FR-13 and FR-15.** FR-13 accepts a late entry "for one further day"; FR-15 permits targeting "the current weekday or the immediately preceding weekday". They disagree on Monday: under FR-13 Friday's grace closes Saturday night, but under FR-15 Friday is still Monday's immediately preceding weekday | The FR-15 reading — grace runs to the end of the next **weekday**, so Friday stays open until Monday 23:59:59 Asia/Colombo. Weekend work is *optional* (FR-12, FR-33), so closing Friday's grace on Saturday night would require a weekend login to protect a weekday submission — making optional work effectively mandatory. Marked `// ASSUMPTION: O-10` in `packages/core` | Mentor to confirm or replace |
| O-13 | **OpenAPI 3.1 rather than the 3.0 the brief names.** Deliverable 2 is graded on the spec | Author in 3.1 per [ADR-0006](adr/0006-openapi-3-1-over-3-0.md). 3.1's schemas are real JSON Schema 2020-12, so the document can drive Fastify's runtime validation directly instead of through a translation layer — which is the mechanism keeping the spec and the service from drifting | Impl Lead accepted the grading risk directly on 2026-07-28; no escalation attached. Mentor notification optional. Fallback is 3.0.3 if tooling proves unreliable |
| O-12 | **Next.js 16 in place of the pinned Next.js 15.** `CLAUDE.md` and the Month 2 brief both name Next.js 15 as a fixed stack row; the current release is 16.2.12 and the Impl Lead's standing instruction is to build on newest versions | Build on Next.js 16 per [ADR-0004](adr/0004-nextjs-16-over-pinned-15.md). Next.js does not appear until Plan 3, so the cost of reversal is currently zero and stays low while `apps/web` avoids version-specific APIs | **Confirmed by the Impl Lead 2026-07-28 — build proceeds on 16.** Mentor notification still outstanding, since §4.2 reserves fixed-stack changes to the decision owner, but it no longer blocks Plan 3. Fallback remains Next.js 15 if the mentor objects; reversal is cheap while `apps/web` avoids version-specific APIs |
| O-11 | **Weekends reclassified from "no submission slot" to optional Extra work**, revising FR-12 and adding FR-33 (2026-07-28) | Weekdays remain required; weekends may hold entries that count as Extra. Weekends are never missed, never late, and never enter a compliance denominator. Extra work feeds the AI summary as positive context but carries no automatic score bonus — mirroring the O-7 treatment of absence, so scoring stays symmetric until the mentor rules otherwise | **Mentor sign-off required.** This changes §3.4, which the §4.2 standing rule reserves to the decision owner |
| O-14 | **The theme switch maps to no FR.** `CLAUDE.md` states a change mapping to no FR does not belong in the repo | The assumption taken is that finishing ADR-0002 is wanted — support nobody can reach is not support, and the dark tokens ship in `globals.css` either way ([ADR-0021](adr/0021-theme-persistence-by-cookie.md)) | Mentor sign-off outstanding, non-blocking; the theme layer is kept in commits separate from the FR-3 registration move (ADR-0022) so a "no" reverts cleanly |
| O-15 | **The frame and brand changes map to no FR.** The sidebar icons, the logo, and Sign out's relocation into the sidebar. `CLAUDE.md` states a change mapping to no FR does not belong in the repo | The assumption taken is that they are wanted — the mentor requested them directly after reviewing the running application, the same footing as O-14. `Create batch`'s relocation is **excluded** from this open point: it serves FR-3 and is covered by [ADR-0023](adr/0023-create-batch-returns-to-students.md) instead | Mentor sign-off outstanding, non-blocking |
| O-16 | **Back-navigation can render a stale theme.** Confirmed by Plan 7B's Task 9 visual pass (measured with the OS reporting light, so any dark rendering could only come from the explicit choice): choosing **Dark** in Settings, navigating to another page, then pressing the browser's **Back** button renders that page in the **pre-choice** theme — not just the radio group misreading, the page itself repaints light. It **self-heals on a full reload** | Pre-existing from Plan 7A ([ADR-0021](adr/0021-theme-persistence-by-cookie.md)), not introduced by Plan 7B — `theme-control.tsx`/`theme-actions.ts` were untouched by this plan except for the Task 9 radio-seeding fix. Root cause: Next's client router cache can replay an RSC payload (including the root layout's `<html data-theme>`) rendered before the theme cookie changed. The theme cookie is deliberately `httpOnly` (ADR-0021), so the client has no way to read it and re-stamp `data-theme` on restore — every candidate fix (drop `httpOnly`, add `revalidatePath`, introduce a client-readable store) is an ADR-level decision, and `revalidatePath` specifically is what `theme-actions.ts`'s docblock rejects (it would force a server round trip and re-render on every switch, contradicting ADR-0021's flash-free Decision — the whole point of stamping `data-theme` before the page streams). `theme-control.tsx`'s reconciliation effect (`useEffect(..., [])`, added for this defect) only closes part of the gap: it re-seeds the radio group from the live DOM on mount, so it corrects a remount, but a browser back/forward restore served from bfcache does not remount and so is not covered by it | Needs its own ADR before a real fix is attempted; not fixed in Plan 7B. Mentor notification optional — it self-heals and no data or session state is at risk |
| O-18 | **Replace AI-scored cycles (FR-22-24) with mentor-scored submissions.** FR-22/23/24 describe an AI pipeline gated on O-5 (undecided AI provider, no resolution date). The `2026-09-15-per-submission-review-design.md` spec (tasks 1-4 of the irp-consolidation-task-list.xlsx sequence) instead has mentors score each `Entry` directly (0-100, feedback, a `countsTowardEvaluation` flag), with a deterministic monthly calculation (task 7) aggregating scores plus attendance — no AI call anywhere in this path. This also puts FR-26 ("no day-to-day scoring") in direct conflict, not just FR-22-24 — see FR-26's own annotation above | **This is the one open point in the tasks 1-4/5/6/7 sequence needing mentor confirmation before it ships to students** — reverting a shipped scoring-model pivot after use is not cheap, unlike O-14/O-15/O-16 which are cosmetic and reversible. Implemented behind this stated assumption per [ADR-0026](adr/0026-mentor-scored-submissions-over-ai-scored-cycles.md), marked `// ASSUMPTION: O-18` in code. Mentor sign-off outstanding |

---

## Appendix — Traceability

| Success criterion | Goals | Key FRs |
|---|---|---|
| SC-1 — 10/10 submitting daily, late tracked | G-2 | FR-10 to FR-16, FR-28 |
| SC-2 — evaluation 2.5 h/day → 20 min | G-1, G-4 | FR-22 to FR-26, FR-28 |
| SC-3 — reports legible and handover-ready | G-3 | FR-22, FR-25, FR-32, FR-5 |
| SC-4 — dashboard + daily submission count ship first | G-2 | FR-28, FR-29 |
