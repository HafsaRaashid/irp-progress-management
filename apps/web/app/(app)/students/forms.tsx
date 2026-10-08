"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import {
  registerUser,
  addBatch,
  transferStudentAction,
  archiveUserAction,
  restoreUserAction,
} from "./admin-actions";

// The shared control treatment lives in app/globals.css's `.control` — the
// one place --line-strong (the §3.1 control-border token) is set.
const FIELD_CLASS = "control";

export interface BatchOption {
  id: string;
  name: string;
}

export interface StudentOption {
  id: string;
  displayName: string;
  email: string;
}

/**
 * FR-3 registration. The role select drives whether batch/startDate render
 * at all -- not just whether they're disabled -- because UserCreate's
 * `enrolment` key must be entirely absent from the request for a Mentor
 * (admin-actions.ts's registerUser reads it off formData, and an absent
 * field is what makes that omission trivial rather than a second source of
 * truth to keep in sync).
 */
export function RegisterForm({ batches }: { batches: BatchOption[] }) {
  const [state, action, pending] = useActionState(registerUser, null);
  const [role, setRole] = useState<"Student" | "Admin">("Student");

  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <SectionLabel>Role</SectionLabel>
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value === "Admin" ? "Admin" : "Student")}
          aria-label="Role"
          className={FIELD_CLASS}
        >
          <option value="Student">Student</option>
          <option value="Admin">Mentor</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <SectionLabel>Email</SectionLabel>
        <input
          name="email"
          type="email"
          required
          aria-label="Email"
          className={FIELD_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1">
        <SectionLabel>Display name</SectionLabel>
        <input
          name="displayName"
          required
          aria-label="Display name"
          className={FIELD_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1">
        <SectionLabel>External id</SectionLabel>
        <input
          name="externalId"
          required
          aria-label="External id"
          className={FIELD_CLASS}
        />
      </label>
      {role === "Student" && (
        <>
          <label className="flex flex-col gap-1">
            <SectionLabel>Batch</SectionLabel>
            <select name="batchId" required aria-label="Batch" className={FIELD_CLASS}>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <SectionLabel>Start date</SectionLabel>
            <input
              name="startDate"
              type="date"
              required
              aria-label="Start date"
              className={FIELD_CLASS}
            />
          </label>
        </>
      )}
      {state !== null && "error" in state && (
        <p role="alert" className="text-sm" style={{ color: "var(--st-missed)" }}>
          {state.error}
        </p>
      )}
      {state !== null && "ok" in state && (
        <p role="status" className="text-sm" style={{ color: "var(--st-ok)" }}>
          Registered.
        </p>
      )}
      <div>
        <Button type="submit" loading={pending}>Register</Button>
      </div>
    </form>
  );
}

/** FR-6 batch creation. */
export function CreateBatchForm() {
  const [state, action, pending] = useActionState(addBatch, null);

  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <SectionLabel>Batch name</SectionLabel>
        <input name="name" required aria-label="Batch name" className={FIELD_CLASS} />
      </label>
      <label className="flex flex-col gap-1">
        <SectionLabel>Batch start date</SectionLabel>
        <input
          name="startDate"
          type="date"
          required
          aria-label="Batch start date"
          className={FIELD_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1">
        <SectionLabel>Batch end date</SectionLabel>
        <input
          name="endDate"
          type="date"
          required
          aria-label="Batch end date"
          className={FIELD_CLASS}
        />
      </label>
      {state !== null && "error" in state && (
        <p role="alert" className="text-sm" style={{ color: "var(--st-missed)" }}>
          {state.error}
        </p>
      )}
      {state !== null && "ok" in state && (
        <p role="status" className="text-sm" style={{ color: "var(--st-ok)" }}>
          Batch created.
        </p>
      )}
      <div>
        {/* primary, not quiet (2026-10-09): this is the single confirming
            action of its own dialog now, the same standing Register's
            button has. They were different variants only because the two
            forms used to sit side by side as panels, where one had to
            recede. */}
        <Button type="submit" loading={pending}>Create batch</Button>
      </div>
    </form>
  );
}

/**
 * FR-8 transfer, ADR-0017's new-batch-owns-the-effective-date rule.
 *
 * `student` is fixed, not a pick-from-a-list `<select>` (revised 2026-10-09):
 * this form only ever opens from one specific row's Transfer dialog now that
 * the standalone shared-form entry point is gone, so a dropdown of every
 * OTHER student was never actionable from here -- opening a different
 * student's row is how you transfer them instead. It was also a real defect,
 * not just redundant: a `<select>` listing every student renders every
 * option's text into the DOM regardless of the dialog's closed, hidden
 * state, so every row's own Transfer dialog carried every OTHER student's
 * name too -- found when a Playwright row filter by name matched all nine
 * seeded students at once instead of one.
 */
export function TransferForm({
  student,
  batches,
}: {
  student: StudentOption;
  batches: BatchOption[];
}) {
  const [state, action, pending] = useActionState(transferStudentAction, null);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="studentId" value={student.id} />
      <div className="flex flex-col gap-1">
        <SectionLabel>Student</SectionLabel>
        <p style={{ color: "var(--ink)" }}>{student.displayName} ({student.email})</p>
      </div>
      <label className="flex flex-col gap-1">
        <SectionLabel>New batch</SectionLabel>
        <select name="toBatchId" required aria-label="New batch" className={FIELD_CLASS}>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <SectionLabel>Effective date</SectionLabel>
        <input
          name="effectiveDate"
          type="date"
          required
          aria-label="Effective date"
          className={FIELD_CLASS}
        />
      </label>
      {state !== null && "error" in state && (
        <p role="alert" className="text-sm" style={{ color: "var(--st-missed)" }}>
          {state.error}
        </p>
      )}
      {state !== null && "ok" in state && (
        <p role="status" className="text-sm" style={{ color: "var(--st-ok)" }}>
          Transferred.
        </p>
      )}
      <div>
        {/* primary, for the same reason as Create batch above. */}
        <Button type="submit" loading={pending}>Transfer</Button>
      </div>
    </form>
  );
}

/**
 * One row's archive control. A client component driven by useActionState,
 * mirroring transition-control.tsx: `archiveUserAction.bind(null, userId)`
 * fixes the one argument the action needs, leaving the (state, formData)
 * pair useActionState supplies as ignored parameters. The API refuses
 * self-archive (and archiving a batch's last mentor) with 409 -- that
 * `detail` must reach the mentor rather than be discarded, which is why this
 * is its own client component rather than a bound plain-form action.
 */
export function ArchiveButton({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(archiveUserAction.bind(null, userId), null);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="danger" loading={pending}>Archive</Button>
      {state !== null && "error" in state && (
        <p role="alert" className="text-sm" style={{ color: "var(--st-missed)" }}>
          {state.error}
        </p>
      )}
    </form>
  );
}

/**
 * The archive view's counterpart to ArchiveButton (FR-5). Same bound-action
 * shape, so a failed restore surfaces the API's problem detail rather than
 * silently doing nothing.
 *
 * `quiet`, not `danger`: restoring grants access back and destroys nothing,
 * so it is the safe direction. It carries no confirmation step for the same
 * reason — and because re-archiving is one click away if it was a misclick.
 */
export function RestoreButton({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(restoreUserAction.bind(null, userId), null);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="quiet" loading={pending}>Restore</Button>
      {state !== null && "error" in state && (
        <p role="alert" className="text-sm" style={{ color: "var(--st-missed)" }}>
          {state.error}
        </p>
      )}
    </form>
  );
}
