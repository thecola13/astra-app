// Private, student-owned gradebook. SERVER-ONLY.
//
// Every function takes the owner's userId and scopes its query by it — there is
// deliberately no "read any student's gradebook" path for admins to call
// (Phase 12A treats grades as sensitive private data).

import { prisma, Prisma } from "@astra/db";
import type { ExamRecordInput } from "@astra/shared";

export class GradebookError extends Error {}

const withCourse = {
  course: { select: { id: true, code: true, title: true } },
} satisfies Prisma.ExamRecordInclude;

type ExamRow = Prisma.ExamRecordGetPayload<{ include: typeof withCourse }>;

export function toExamRecord(row: ExamRow) {
  return {
    id: row.id,
    course: row.course ? { id: row.course.id, code: row.course.code, title: row.course.title } : null,
    customTitle: row.customTitle,
    credits: row.credits,
    studyYear: row.studyYear,
    semester: row.semester,
    status: row.status,
    grade: row.grade,
    lode: row.lode,
    passFail: row.passFail,
    examDate: row.examDate ? row.examDate.toISOString() : null,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listGradebook(userId: string) {
  return prisma.examRecord.findMany({
    where: { userId },
    include: withCourse,
    orderBy: [{ studyYear: "asc" }, { semester: "asc" }, { createdAt: "asc" }],
  });
}

/** Rejects a courseId that isn't in the active catalogue. */
async function assertCourse(courseId: string | null | undefined) {
  if (!courseId) return;
  const course = await prisma.academicCourse.findFirst({
    where: { id: courseId, catalogue: { active: true } },
    select: { id: true },
  });
  if (!course) throw new GradebookError("Course is not in the active catalogue.");
}

function toRow(input: ExamRecordInput) {
  return {
    courseId: input.courseId ?? null,
    // A picked course carries its own title; free text is only for the rest.
    customTitle: input.courseId ? null : (input.customTitle ?? null),
    credits: input.credits,
    studyYear: input.studyYear,
    semester: input.semester ?? null,
    status: input.status,
    grade: input.grade ?? null,
    lode: input.lode,
    passFail: input.passFail,
    examDate: input.examDate ? new Date(input.examDate) : null,
    notes: input.notes ?? null,
  };
}

// The one-row-per-exam rule is a partial unique index, so it surfaces as a
// write conflict rather than a validation error.
async function write<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new GradebookError("This exam is already in your gradebook. Edit that record instead.");
    }
    throw error;
  }
}

export async function createExamRecord(userId: string, input: ExamRecordInput) {
  await assertCourse(input.courseId);
  return write(() =>
    prisma.examRecord.create({ data: { userId, ...toRow(input) }, include: withCourse })
  );
}

export async function updateExamRecord(userId: string, id: string, input: ExamRecordInput) {
  await assertCourse(input.courseId);
  return write(async () => {
    // updateMany scopes the write by userId, so one student can never touch
    // another's record even with a guessed id.
    const { count } = await prisma.examRecord.updateMany({
      where: { id, userId },
      data: toRow(input),
    });
    if (count === 0) throw new GradebookError("Exam record not found.");
    return prisma.examRecord.findUniqueOrThrow({ where: { id }, include: withCourse });
  });
}

export async function deleteExamRecord(userId: string, id: string) {
  const { count } = await prisma.examRecord.deleteMany({ where: { id, userId } });
  if (count === 0) throw new GradebookError("Exam record not found.");
}
