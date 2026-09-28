-- A DailyReport is born IN_REVIEW: a student's submission IS the thing under
-- review, so the mentor has nothing to "start". Interview Q14 names exactly
-- two states ("entries go from 'in review' to 'evaluated'"); SUBMITTED was a
-- third that no stakeholder answer asked for. ASSUMPTION: O-19.

-- 1. Nothing may be left pointing at the value about to be dropped.
UPDATE "DailyReport" SET "status" = 'IN_REVIEW' WHERE "status" = 'SUBMITTED';

-- 2. inReviewAt is the instant review became possible. For a row that never
--    got a manual "Start review" click it was NULL; backfill it from the row's
--    own creation so the column keeps meaning "when did this enter review"
--    rather than silently meaning "when was it clicked" for old rows only.
UPDATE "DailyReport" SET "inReviewAt" = "createdAt" WHERE "inReviewAt" IS NULL;

-- 3. Postgres cannot drop a value from an enum in place, so swap the type.
--    The DEFAULT must come off first: it is bound to the old type and blocks
--    the ALTER COLUMN ... TYPE with "default for column cannot be cast".
ALTER TABLE "DailyReport" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "DailyReportStatus" RENAME TO "DailyReportStatus_old";
CREATE TYPE "DailyReportStatus" AS ENUM ('IN_REVIEW', 'EVALUATED');
ALTER TABLE "DailyReport"
  ALTER COLUMN "status" TYPE "DailyReportStatus"
  USING "status"::text::"DailyReportStatus";
ALTER TABLE "DailyReport" ALTER COLUMN "status" SET DEFAULT 'IN_REVIEW';
DROP TYPE "DailyReportStatus_old";
