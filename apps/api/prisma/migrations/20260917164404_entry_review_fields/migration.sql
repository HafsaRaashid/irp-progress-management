-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "countsTowardEvaluation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mentorFeedback" TEXT,
ADD COLUMN     "score" INTEGER;
