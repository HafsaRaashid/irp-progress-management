/**
 * Domain rule violations — the repository/service error contract (ADR-0015).
 * `code` is stable and machine-readable; `status` and `title` are what the
 * problem-details plugin serialises; the message is the RFC 7807 `detail`.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;
  abstract readonly title: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class SubmissionWindowClosedError extends DomainError {
  readonly code = "submission-window-closed";
  readonly status = 400;
  readonly title = "Submission window closed";
  constructor(target: string) {
    super(`The submission window for ${target} is closed (FR-14/FR-15).`);
  }
}

export class LockedDayError extends DomainError {
  readonly code = "day-locked";
  readonly status = 409;
  readonly title = "Day is locked";
  constructor(date: string) {
    super(`${date} is Evaluated and locked for the student (FR-20).`);
  }
}

export class AbsentDayConflictError extends DomainError {
  readonly code = "absent-day-conflict";
  readonly status = 409;
  readonly title = "Day is marked absent";
  constructor(date: string) {
    super(`${date} is marked absent — absent and submitted are contradictory.`);
  }
}

export class EntryConflictError extends DomainError {
  readonly code = "entry-conflict";
  readonly status = 409;
  readonly title = "Day already holds entries";
  constructor(date: string) {
    super(`${date} already holds entries — it cannot also be marked absent.`);
  }
}

export class WeekendAbsenceError extends DomainError {
  readonly code = "weekend-absence";
  readonly status = 400;
  readonly title = "Weekends have no absence";
  constructor(date: string) {
    super(`${date} is a weekend — there is nothing to be absent from (FR-16).`);
  }
}

export class OpenEnrolmentExistsError extends DomainError {
  readonly code = "open-enrolment-exists";
  readonly status = 409;
  readonly title = "Student already enrolled";
  constructor(studentId: string) {
    super(`Student ${studentId} already has an open enrolment.`);
  }
}

export class NoOpenEnrolmentError extends DomainError {
  readonly code = "no-open-enrolment";
  readonly status = 409;
  readonly title = "No open enrolment";
  constructor(studentId: string) {
    super(`Student ${studentId} has no open enrolment.`);
  }
}

export class AbsenceExistsError extends DomainError {
  readonly code = "absence-exists";
  readonly status = 409;
  readonly title = "Absence already recorded";
  constructor(date: string) {
    super(`${date} is already marked absent.`);
  }
}

export class InvalidTransferDateError extends DomainError {
  readonly code = "invalid-transfer-date";
  readonly status = 400;
  readonly title = "Invalid transfer date";
  constructor(effectiveDate: string) {
    super(`Transfer effective ${effectiveDate} would not leave the previous enrolment a single day.`);
  }
}

export class AbsenceNotFoundError extends DomainError {
  readonly code = "absence-not-found";
  readonly status = 404;
  readonly title = "No absence recorded";
  constructor(date: string) {
    super(`No absence is recorded for ${date}.`);
  }
}

export class AbsenceWindowClosedError extends DomainError {
  readonly code = "absence-window-closed";
  readonly status = 400;
  readonly title = "Day is final";
  constructor(date: string) {
    super(`${date} is already final — absence can only be edited while the day's window is open.`);
  }
}

export class BatchNotFoundError extends DomainError {
  readonly code = "batch-not-found";
  readonly status = 404;
  readonly title = "Batch not found";
  constructor(id: string) {
    super(`No batch exists with id ${id}.`);
  }
}

export class InvalidBatchDatesError extends DomainError {
  readonly code = "invalid-batch-dates";
  readonly status = 400;
  readonly title = "Invalid batch dates";
  constructor() {
    super("startDate must be before endDate.");
  }
}

export class DuplicateBatchNameError extends DomainError {
  readonly code = "duplicate-batch-name";
  readonly status = 409;
  readonly title = "Batch name already exists";
  constructor(name: string) {
    super(`A batch named "${name}" already exists.`);
  }
}

export class ReportNotFoundError extends DomainError {
  readonly code = "report-not-found";
  readonly status = 404;
  readonly title = "Report not found";
  constructor(id: string) {
    super(`No daily report exists with id ${id}.`);
  }
}

export class InvalidTransitionError extends DomainError {
  readonly code = "invalid-transition";
  readonly status = 409;
  readonly title = "Invalid review transition";
  constructor(from: string, to: string) {
    super(`A report in state ${from} cannot move to ${to} — review is forward-only (FR-18), with no Rejected state.`);
  }
}

export class WeekendDayRecordError extends DomainError {
  readonly code = "weekend-day-record";
  readonly status = 400;
  readonly title = "Weekends have no day record";
  constructor(date: string) {
    super(`${date} is a weekend — attendance records apply to required days only (FR-19).`);
  }
}

export class FutureDayRecordError extends DomainError {
  readonly code = "future-day-record";
  readonly status = 400;
  readonly title = "That day has not happened yet";
  constructor(date: string) {
    super(`${date} is in the future — there is nothing to attend yet (FR-19).`);
  }
}

export class StudentNotFoundError extends DomainError {
  readonly code = "student-not-found";
  readonly status = 404;
  readonly title = "Student not found";
  constructor(id: string) {
    super(`No student exists with id ${id}.`);
  }
}

export class DuplicateUserError extends DomainError {
  readonly code = "duplicate-user";
  readonly status = 409;
  readonly title = "User already exists";
  constructor(email: string) {
    super(`A user already exists with this email or external id (${email}).`);
  }
}

export class EnrolmentRequiredError extends DomainError {
  readonly code = "enrolment-required";
  readonly status = 400;
  readonly title = "Enrolment mismatch";
  constructor(detail: string) {
    super(detail);
  }
}

export class SelfArchiveError extends DomainError {
  readonly code = "self-archive";
  readonly status = 409;
  readonly title = "Cannot archive yourself";
  constructor() {
    super("Archiving your own account would lock you out mid-session.");
  }
}

export class UserNotFoundError extends DomainError {
  readonly code = "user-not-found";
  readonly status = 404;
  readonly title = "User not found";
  constructor(id: string) {
    super(`No user exists with id ${id}.`);
  }
}

export class EntryNotFoundError extends DomainError {
  readonly code = "entry-not-found";
  readonly status = 404;
  readonly title = "Entry not found";
  constructor(id: string) {
    super(`No entry exists with id ${id}.`);
  }
}

export class InvalidCycleError extends DomainError {
  readonly code = "invalid-cycle";
  readonly status = 400;
  readonly title = "Invalid cycle";
  constructor(detail: string) {
    super(detail);
  }
}
