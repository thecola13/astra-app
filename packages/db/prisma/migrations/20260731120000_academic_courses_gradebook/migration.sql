-- Official course catalogue (imported per academic year) + the student-owned
-- gradebook. Grades are private student data: no admin-facing access here.

CREATE TYPE "ExamStatus" AS ENUM ('PLANNED', 'PASSED', 'FAILED', 'REJECTED');

CREATE TABLE "AcademicCourse" (
  "id" TEXT NOT NULL,
  "catalogueId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "language" TEXT,
  "sourceUrl" TEXT NOT NULL,
  "retrievedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcademicCourse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcademicCourseProgramme" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "programmeId" TEXT NOT NULL,
  "credits" INTEGER NOT NULL,
  "semester" TEXT,
  "courseType" TEXT,
  CONSTRAINT "AcademicCourseProgramme_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExamRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "courseId" TEXT,
  "customTitle" TEXT,
  "credits" INTEGER NOT NULL,
  "studyYear" INTEGER NOT NULL,
  "semester" TEXT,
  "status" "ExamStatus" NOT NULL DEFAULT 'PLANNED',
  "grade" INTEGER,
  "lode" BOOLEAN NOT NULL DEFAULT false,
  "passFail" BOOLEAN NOT NULL DEFAULT false,
  "examDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExamRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AcademicCourse_catalogueId_code_key"
  ON "AcademicCourse"("catalogueId", "code");
CREATE INDEX "AcademicCourse_catalogueId_idx"
  ON "AcademicCourse"("catalogueId");
CREATE UNIQUE INDEX "AcademicCourseProgramme_courseId_programmeId_key"
  ON "AcademicCourseProgramme"("courseId", "programmeId");
CREATE INDEX "AcademicCourseProgramme_programmeId_idx"
  ON "AcademicCourseProgramme"("programmeId");
CREATE INDEX "ExamRecord_userId_studyYear_idx"
  ON "ExamRecord"("userId", "studyYear");
CREATE INDEX "ExamRecord_courseId_idx"
  ON "ExamRecord"("courseId");

ALTER TABLE "AcademicCourse"
  ADD CONSTRAINT "AcademicCourse_catalogueId_fkey"
  FOREIGN KEY ("catalogueId") REFERENCES "AcademicCatalogue"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AcademicCourseProgramme"
  ADD CONSTRAINT "AcademicCourseProgramme_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "AcademicCourse"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AcademicCourseProgramme"
  ADD CONSTRAINT "AcademicCourseProgramme_programmeId_fkey"
  FOREIGN KEY ("programmeId") REFERENCES "AcademicProgramme"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExamRecord"
  ADD CONSTRAINT "ExamRecord_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExamRecord"
  ADD CONSTRAINT "ExamRecord_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "AcademicCourse"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Invariants enforced in the database, not only in Zod ────────────────────
-- The API is not the only writer (seeds, psql, future admin tooling), so the
-- rules that make a gradebook meaningful live here too.

-- A record identifies its course either by catalogue link or by free text.
ALTER TABLE "ExamRecord"
  ADD CONSTRAINT "ExamRecord_course_identified"
  CHECK (("courseId" IS NOT NULL) OR ("customTitle" IS NOT NULL AND length(btrim("customTitle")) > 0));

ALTER TABLE "ExamRecord"
  ADD CONSTRAINT "ExamRecord_credits_range"
  CHECK ("credits" > 0 AND "credits" <= 60);

ALTER TABLE "ExamRecord"
  ADD CONSTRAINT "ExamRecord_study_year_range"
  CHECK ("studyYear" >= 1 AND "studyYear" <= 6);

-- A graded pass carries 18–30; anything else carries no grade. Pass/fail
-- activities never carry one, and `lode` only ever decorates a 30.
ALTER TABLE "ExamRecord"
  ADD CONSTRAINT "ExamRecord_grade_shape"
  CHECK (
    CASE
      WHEN "status" IN ('PASSED', 'REJECTED') AND NOT "passFail"
        THEN "grade" BETWEEN 18 AND 30
      ELSE "grade" IS NULL
    END
    AND (NOT "lode" OR "grade" = 30)
  );

-- At most one PASSED attempt per course per student, so the accepted attempt is
-- unambiguous without an extra flag. Retaking means marking the old row
-- REJECTED first. Partial indexes are unavailable in the Prisma schema, hence
-- raw SQL — same pattern as the points-ledger invariants.
CREATE UNIQUE INDEX "ExamRecord_passed_course_key"
  ON "ExamRecord"("userId", "courseId")
  WHERE "status" = 'PASSED' AND "courseId" IS NOT NULL;

CREATE UNIQUE INDEX "ExamRecord_passed_custom_key"
  ON "ExamRecord"("userId", lower(btrim("customTitle")))
  WHERE "status" = 'PASSED' AND "courseId" IS NULL;
