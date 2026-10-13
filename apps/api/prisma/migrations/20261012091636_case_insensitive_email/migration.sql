-- DropIndex
DROP INDEX "User_email_key";

-- Case-insensitive uniqueness (ADR-0035): the just-in-time oid bind matches
-- a sign-in's email claim against the registered row case-insensitively
-- (Entra's claim casing need not match what an Admin typed), so two rows
-- differing only by case must be impossible or that match could hit more
-- than one. Not expressible as a plain Prisma `@unique` — same hand-written
-- index pattern as "Enrolment_one_open_per_student" in the slice_2_domain
-- migration.
CREATE UNIQUE INDEX "User_email_ci_key" ON "User" (lower("email"));
