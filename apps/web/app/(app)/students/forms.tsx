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
        <Button type="submit" variant="quiet" loading={pending}>Create batch</Button>
      </div>
    </form>
  );
}

/**
 * FR-8 transfer, ADR-0017's new-batch-owns-the-effective-date rule.
 *
 * `defaultStudentId` (2026-10-08, the mentor Users-page spec D5) pre-selects
 * whichever row's "Transfer" link opened this shared form -- `defaultValue`
 * on an uncontrolled `<select>`, so the form stays a plain `useActionState`
 * form with no new client state of its own. An id that does not match any
 * option (a stale link to an archived or since-transferred student) is not
 * an error here: the browser falls back to the select's first option exactly
 * as it would with no default at all.
 */
export function TransferForm({
  students,
  batches,
  defaultStudentId,
}: {
  students: StudentOption[];
  batches: BatchOption[];
  // `| undefined`, not just `?:` -- exactOptionalPropertyTypes distinguishes
  // "prop omitted" from "prop passed explicitly as undefined", and the
  // caller passes `transferTarget?.id`, which is the latter whenever the
  // query param is absent or stale.
  defaultStudentId?: string | undefined;
}) {
  const [state, action, pending] = useActionState(transferStudentAction, null);

  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <SectionLabel>Student</SectionLabel>
        <select
          name="studentId"
          required
          aria-label="Student"
          defaultValue={defaultStudentId}
          className={FIELD_CLASS}
        >
          {students.map((s) => (
            <option key={s.id} value={s.id}>{s.displayName} ({s.email})</option>
          ))}
        </select>
      </label>
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
        <Button type="submit" variant="quiet" loading={pending}>Transfer</Button>
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
