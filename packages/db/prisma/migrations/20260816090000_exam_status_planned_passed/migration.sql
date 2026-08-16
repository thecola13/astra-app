-- An exam is either planned or passed. Nothing else is worth recording.
--
-- FAILED and REJECTED existed to model attempt history, but a failed exam
-- leaves no trace on a Bocconi transcript and a grade cannot be refused here,
-- so neither status has anything to describe. Dropping them collapses the
-- "attempts are rows" design into one row per exam.

-- Any row in a dropped status becomes a plain planned exam. A REJECTED row
-- carries a grade that PLANNED may not, so the grade goes with the status.
UPDATE "ExamRecord"
  SET "status" = 'PLANNED', "grade" = NULL, "lode" = false
  WHERE "status" IN ('FAILED', 'REJECTED');

-- Postgres cannot remove a value from an enum in place; the type is rebuilt.
ALTER TYPE "ExamStatus" RENAME TO "ExamStatus_old";
CREATE TYPE "ExamStatus" AS ENUM ('PLANNED', 'PASSED');

ALTER TABLE "ExamRecord" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ExamRecord"
  ALTER COLUMN "status" TYPE "ExamStatus" USING "status"::text::"ExamStatus";
ALTER TABLE "ExamRecord" ALTER COLUMN "status" SET DEFAULT 'PLANNED';

DROP TYPE "ExamStatus_old";

-- The grade shape no longer has a second graded status to admit.
ALTER TABLE "ExamRecord" DROP CONSTRAINT "ExamRecord_grade_shape";

ALTER TABLE "ExamRecord"
  ADD CONSTRAINT "ExamRecord_grade_shape"
  CHECK (
    CASE
      WHEN "status" = 'PASSED' AND NOT "passFail"
        THEN "grade" IS NOT NULL AND "grade" BETWEEN 18 AND 30
      ELSE "grade" IS NULL
    END
    AND (NOT "lode" OR ("grade" IS NOT NULL AND "grade" = 30))
  );

-- With no attempt history there is one row per exam, so uniqueness no longer
-- needs to single out the passed one: a course appears once, planned or passed.
DROP INDEX "ExamRecord_passed_course_key";
DROP INDEX "ExamRecord_passed_custom_key";

CREATE UNIQUE INDEX "ExamRecord_course_key"
  ON "ExamRecord"("userId", "courseId")
  WHERE "courseId" IS NOT NULL;

CREATE UNIQUE INDEX "ExamRecord_custom_key"
  ON "ExamRecord"("userId", lower(btrim("customTitle")))
  WHERE "courseId" IS NULL;
