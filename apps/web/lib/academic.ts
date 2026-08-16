// Academic selection catalogue + student profile. SERVER-ONLY.

import { prisma } from "@astra/db";
import type { AcademicProfileInput } from "@astra/shared";

export async function getActiveAcademicCatalogue() {
  return prisma.academicCatalogue.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
    include: {
      programmes: {
        where: { active: true },
        orderBy: { code: "asc" },
        include: {
          classGroups: { orderBy: { code: "asc" } },
          tracks: { where: { active: true }, orderBy: { name: "asc" } },
        },
      },
    },
  });
}

/**
 * Official courses for the gradebook picker, scoped to the active catalogue.
 * `programmeId` narrows to one programme's offerings (credits/semester/type are
 * per-programme); without it the search spans the whole catalogue, which is what
 * electives and exchange courses need.
 */
export async function searchCourses(params: { q?: string; programmeId?: string; limit?: number }) {
  const q = params.q?.trim();
  const rows = await prisma.academicCourseProgramme.findMany({
    where: {
      programmeId: params.programmeId,
      course: {
        catalogue: { active: true },
        ...(q
          ? {
              OR: [
                { code: { startsWith: q } },
                { title: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
    },
    include: { course: true },
    orderBy: { course: { code: "asc" } },
    take: Math.min(params.limit ?? 50, 200),
  });

  // Across programmes the same course appears once per pairing; showing it
  // twice looks like a bug, so the first pairing wins.
  const byCourse = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!byCourse.has(row.courseId)) byCourse.set(row.courseId, row);

  return [...byCourse.values()].map((row) => ({
    id: row.course.id,
    code: row.course.code,
    title: row.course.title,
    language: row.course.language,
    credits: row.credits,
    semester: row.semester,
    courseType: row.courseType,
    sourceUrl: row.course.sourceUrl,
  }));
}

export async function getAcademicProfile(userId: string) {
  return prisma.studentAcademicProfile.findUnique({
    where: { userId },
    include: {
      programme: { include: { catalogue: true } },
      track: true,
      classGroup: true,
    },
  });
}

export function toAcademicProfile(
  row: NonNullable<Awaited<ReturnType<typeof getAcademicProfile>>>
) {
  return {
    programme: {
      id: row.programme.id,
      code: row.programme.code,
      name: row.programme.name,
      level: row.programme.level,
      durationYears: row.programme.durationYears,
      sourceUrl: row.programme.sourceUrl,
      legacy: row.programme.legacy,
    },
    catalogue: {
      id: row.programme.catalogue.id,
      academicYear: row.programme.catalogue.academicYear,
      version: row.programme.catalogue.version,
      sourceUrl: row.programme.catalogue.sourceUrl,
    },
    studyYear: row.studyYear,
    track: row.track
      ? { id: row.track.id, code: row.track.code, name: row.track.name, sourceUrl: row.track.sourceUrl }
      : null,
    classGroup: row.classGroup
      ? { id: row.classGroup.id, code: row.classGroup.code, sourceUrl: row.classGroup.sourceUrl }
      : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveAcademicProfile(userId: string, input: AcademicProfileInput) {
  const programme = await prisma.academicProgramme.findFirst({
    where: { id: input.programmeId, active: true, catalogue: { active: true } },
    include: { catalogue: true },
  });
  if (!programme) throw new AcademicSelectionError("Programme is not in the active catalogue.");
  if (input.studyYear > programme.durationYears) {
    throw new AcademicSelectionError(
      `Study year must be between 1 and ${programme.durationYears}.`
    );
  }

  if (input.trackId) {
    const track = await prisma.academicTrack.findFirst({
      where: { id: input.trackId, programmeId: programme.id, active: true },
      select: { id: true },
    });
    if (!track) throw new AcademicSelectionError("Track does not belong to programme.");
  }

  if (input.classGroupId) {
    const classGroup = await prisma.academicClassGroup.findFirst({
      where: { id: input.classGroupId, programmeId: programme.id },
      select: { id: true },
    });
    if (!classGroup) throw new AcademicSelectionError("Class group does not belong to programme.");
  }

  await prisma.studentAcademicProfile.upsert({
    where: { userId },
    update: {
      programmeId: programme.id,
      trackId: input.trackId ?? null,
      studyYear: input.studyYear,
      classGroupId: input.classGroupId ?? null,
    },
    create: {
      userId,
      programmeId: programme.id,
      trackId: input.trackId ?? null,
      studyYear: input.studyYear,
      classGroupId: input.classGroupId ?? null,
    },
  });

  return (await getAcademicProfile(userId))!;
}

export class AcademicSelectionError extends Error {}
