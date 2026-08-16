// Loads a scraped course catalogue into Neon.
// Idempotent — safe to re-run. Run from packages/db:
//
//   npx tsx prisma/seed-courses.ts                        # bocconi-scraper/courses-2027.json
//   npx tsx prisma/seed-courses.ts path/to/courses.json
//
// The JSON is produced by bocconi-scraper/scrape-courses.mjs and committed, so
// what lands in the database is always something a human reviewed in a diff.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

process.loadEnvFile(fileURLToPath(new URL("../../../apps/web/.env", import.meta.url)));

const pooledUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL ||
  process.env.STORAGE_DATABASE_URL;
const prisma = new PrismaClient({ adapter: new PrismaPg(pooledUrl!) });

const DEFAULT_JSON = fileURLToPath(
  new URL("../../../bocconi-scraper/courses-2027.json", import.meta.url)
);

interface ScrapedCourse {
  code: string;
  title: string;
  language: string | null;
  sourceUrl: string;
  programmes: { programmeCode: string; credits: number; semester: string | null; courseType: string | null }[];
}

async function main() {
  const file = process.argv[2] ?? DEFAULT_JSON;
  const payload = JSON.parse(fs.readFileSync(file, "utf8")) as {
    academicYear: string;
    retrievedAt: string;
    courses: ScrapedCourse[];
  };

  const catalogue = await prisma.academicCatalogue.findFirst({
    where: { academicYear: payload.academicYear },
    include: { programmes: { select: { id: true, code: true } } },
  });
  if (!catalogue) {
    throw new Error(
      `No AcademicCatalogue for academic year ${payload.academicYear}. Seed the catalogue first.`
    );
  }

  const programmeIdByCode = new Map(catalogue.programmes.map((p) => [p.code, p.id]));
  const retrievedAt = new Date(payload.retrievedAt);
  const unknownProgrammes = new Map<string, number>();

  const courseRows = payload.courses.map((course) => ({
    id: `${catalogue.id}-course-${course.code}`,
    code: course.code,
    title: course.title,
    language: course.language,
    sourceUrl: course.sourceUrl,
  }));

  const offeringRows = payload.courses.flatMap((course) =>
    course.programmes.flatMap((p) => {
      const programmeId = programmeIdByCode.get(p.programmeCode);
      if (!programmeId) {
        unknownProgrammes.set(p.programmeCode, (unknownProgrammes.get(p.programmeCode) ?? 0) + 1);
        return [];
      }
      if (!Number.isInteger(p.credits)) {
        throw new Error(
          `Course ${course.code}: non-integer credits ${p.credits} — widen the column first.`
        );
      }
      const courseId = `${catalogue.id}-course-${course.code}`;
      return [
        {
          id: `${courseId}-${programmeId}`,
          courseId,
          programmeId,
          credits: p.credits,
          semester: p.semester,
          courseType: p.courseType,
        },
      ];
    })
  );

  // Bulk upsert via unnest: two statements instead of one round trip per row.
  // A full catalogue is ~660 courses and ~3400 pairings — sequential upserts
  // exhaust the connection pool long before they finish.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "AcademicCourse" ("id", "catalogueId", "code", "title", "language", "sourceUrl", "retrievedAt")
        SELECT * FROM unnest(
          ${courseRows.map((r) => r.id)}::text[],
          ${courseRows.map(() => catalogue.id)}::text[],
          ${courseRows.map((r) => r.code)}::text[],
          ${courseRows.map((r) => r.title)}::text[],
          ${courseRows.map((r) => r.language)}::text[],
          ${courseRows.map((r) => r.sourceUrl)}::text[],
          ${courseRows.map(() => retrievedAt)}::timestamp[]
        )
        ON CONFLICT ("id") DO UPDATE SET
          "title" = EXCLUDED."title",
          "language" = EXCLUDED."language",
          "sourceUrl" = EXCLUDED."sourceUrl",
          "retrievedAt" = EXCLUDED."retrievedAt"`;

      // Pairings are replaced wholesale: a course a programme dropped this year
      // must disappear, not linger from the previous import.
      await tx.$executeRaw`
        DELETE FROM "AcademicCourseProgramme"
        WHERE "courseId" IN (SELECT "id" FROM "AcademicCourse" WHERE "catalogueId" = ${catalogue.id})
          AND "id" <> ALL(${offeringRows.map((r) => r.id)}::text[])`;

      await tx.$executeRaw`
        INSERT INTO "AcademicCourseProgramme" ("id", "courseId", "programmeId", "credits", "semester", "courseType")
        SELECT * FROM unnest(
          ${offeringRows.map((r) => r.id)}::text[],
          ${offeringRows.map((r) => r.courseId)}::text[],
          ${offeringRows.map((r) => r.programmeId)}::text[],
          ${offeringRows.map((r) => r.credits)}::int[],
          ${offeringRows.map((r) => r.semester)}::text[],
          ${offeringRows.map((r) => r.courseType)}::text[]
        )
        ON CONFLICT ("id") DO UPDATE SET
          "credits" = EXCLUDED."credits",
          "semester" = EXCLUDED."semester",
          "courseType" = EXCLUDED."courseType"`;
    },
    { timeout: 120_000 }
  );

  console.log(
    `Seeded ${courseRows.length} courses / ${offeringRows.length} programme offerings into ${payload.academicYear}.`
  );
  // Unmatched codes mean the catalogue is missing a programme — say so rather
  // than quietly importing a partial catalogue.
  if (unknownProgrammes.size) {
    console.warn(`\nNo AcademicProgramme for ${unknownProgrammes.size} code(s) — offerings skipped:`);
    for (const [code, count] of [...unknownProgrammes].sort((a, b) => b[1] - a[1])) {
      console.warn(`  ${code} — ${count} course(s)`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
