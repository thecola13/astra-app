-- Fix: the grade CHECK let a graded pass with NO grade through.
--
-- `"grade" BETWEEN 18 AND 30` evaluates to NULL when grade IS NULL, and a CHECK
-- constraint only rejects on FALSE — NULL passes. Same hole let `lode` be set on
-- a record with no grade. Both branches now test for NULL explicitly.

ALTER TABLE "ExamRecord" DROP CONSTRAINT "ExamRecord_grade_shape";

ALTER TABLE "ExamRecord"
  ADD CONSTRAINT "ExamRecord_grade_shape"
  CHECK (
    CASE
      WHEN "status" IN ('PASSED', 'REJECTED') AND NOT "passFail"
        THEN "grade" IS NOT NULL AND "grade" BETWEEN 18 AND 30
      ELSE "grade" IS NULL
    END
    AND (NOT "lode" OR ("grade" IS NOT NULL AND "grade" = 30))
  );
