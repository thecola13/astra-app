// Gradebook maths. Pure functions over the records the API already returns —
// no fetching, no Prisma, no React — so mobile and web compute the same numbers
// from the same code instead of each rolling their own.
//
// These are the student's own figures, not an official transcript: Bocconi is
// the authority on what any of this actually says.

import type { ExamRecord } from "./schemas";

/** `30 e lode` is worth 31 in the weighted average. */
export const LODE_GRADE = 31;

/** Only these fields matter here; anything shaped like this can be measured. */
type Measurable = Pick<
  ExamRecord,
  "status" | "credits" | "grade" | "lode" | "passFail" | "examDate" | "course" | "customTitle"
>;

// "POLITICAL SCIENCE - MODULE 2 (INTERNATIONAL RELATIONS)" → the separator, the
// module number, an optional letter (MODULE II A). The `?` is the en-dash a few
// catalogue titles arrive mangled with, and `MODULO` is the Italian spelling.
const MODULE_MARKER = /\s*[-–—?]\s*MODUL[OE]\s+(?:[IVX]+|\d+)\s*[A-Z]?\b/i;

/**
 * The parent course a modular exam belongs to, or null if it isn't a module.
 *
 * Modules of one parent don't share a parenthetical — MODULE 1 might be
 * "(WEB ANALYTICS)" and MODULE 2 "(DATA & ANALYTICS)" — so those are dropped
 * before comparing. Case and spacing are normalised because free-text titles
 * are typed by hand while catalogue titles arrive shouting.
 */
export function moduleParent(title: string): string | null {
  const marker = title.match(MODULE_MARKER);
  if (!marker) return null;
  return title
    .slice(0, marker.index)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

const titleOf = (record: Measurable) => record.course?.title ?? record.customTitle ?? "";

// A course name may end in a sequence numeral — ARTS I and ARTS II are two
// different courses, not one misspelt. That numeral has to match exactly.
const SEQUENCE_NUMERAL = /\s+([IVX]+|\d+)$/;

/** True when two strings are equal or one typed character apart. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  return a.length - head - tail <= 1 && b.length - head - tail <= 1;
}

/**
 * Whether two parent names are the same course. Bocconi's own catalogue
 * misspells one of them — `MANAGEMENT AND ECONOMICS FOR SUSTAINABILTY` module 1
 * against `...SUSTAINABILITY` module 2 — so an exact match would split a course
 * in half. One typo is forgiven; a differing sequence numeral never is.
 */
function sameParent(a: string, b: string): boolean {
  if (a === b) return true;
  const [aName, aNumeral] = splitSequence(a);
  const [bName, bNumeral] = splitSequence(b);
  return aNumeral === bNumeral && withinOneEdit(aName, bName);
}

function splitSequence(parent: string): [string, string] {
  const numeral = parent.match(SEQUENCE_NUMERAL);
  return numeral ? [parent.slice(0, numeral.index), numeral[1]!] : [parent, ""];
}

/** A passed exam that carries a grade — the only kind the average is built on. */
function gradeOf(record: Measurable): number | null {
  if (record.status !== "PASSED" || record.passFail || record.grade == null) return null;
  return record.lode ? LODE_GRADE : record.grade;
}

/** Weighted average rounded to two decimals, or null when nothing is graded. */
function average(points: number, credits: number): number | null {
  return credits > 0 ? Math.round((points / credits) * 100) / 100 : null;
}

export function gradebookStats(records: readonly Measurable[]) {
  let points = 0;
  let gradedCredits = 0;
  let earnedCredits = 0;
  let plannedCredits = 0;
  let passedCount = 0;
  let plannedCount = 0;

  // A modular course is unfinished while any of its modules is still planned.
  // The student's own gradebook is the only thing that knows which modules they
  // have to sit: the catalogue lists elective module pools, lone modules whose
  // sibling ran in another year, and the same parent split differently between
  // programmes, so "the required modules" isn't a fact it can answer.
  // ponytail: a list scanned per passed module, not a hash set, because names
  // are matched with a typo tolerance. A gradebook holds tens of exams; if that
  // ever stops being true, bucket by first word before scanning.
  const unfinished: string[] = [];
  for (const record of records) {
    if (record.status !== "PLANNED") continue;
    const parent = moduleParent(titleOf(record));
    if (parent && !unfinished.some((seen) => sameParent(seen, parent))) unfinished.push(parent);
  }

  let completedPoints = 0;
  let completedCredits = 0;

  for (const record of records) {
    if (record.status === "PLANNED") {
      plannedCredits += record.credits;
      plannedCount += 1;
      continue;
    }
    passedCount += 1;
    earnedCredits += record.credits;

    const grade = gradeOf(record);
    if (grade != null) {
      points += grade * record.credits;
      gradedCredits += record.credits;

      const parent = moduleParent(titleOf(record));
      if (!parent || !unfinished.some((pending) => sameParent(pending, parent))) {
        completedPoints += grade * record.credits;
        completedCredits += record.credits;
      }
    }
  }

  return {
    /** Every passed module counts the day it is passed. */
    weightedAverage: average(points, gradedCredits),
    /**
     * The same average with half-finished modular courses left out. Identical
     * to `weightedAverage` once the modules are done — credit-weighting makes a
     * parent's combined result the weighted mean of its modules — so the two
     * numbers only ever differ mid-course.
     */
    completedCourseAverage: average(completedPoints, completedCredits),
    /** Credits behind the average — pass/fail passes are not in here. */
    gradedCredits,
    /** Credits actually earned towards the degree, graded or not. */
    earnedCredits,
    plannedCredits,
    passedCount,
    plannedCount,
  };
}

/**
 * The running weighted average after each graded exam, oldest first — what the
 * average looked like on the day of each result. Undated exams are left out:
 * they count in the totals, they just can't be placed on a timeline.
 */
export function averageTrend(records: readonly Measurable[]) {
  const graded = records
    .filter((record) => record.examDate != null && gradeOf(record) != null)
    .sort((a, b) => a.examDate!.localeCompare(b.examDate!));

  let points = 0;
  let credits = 0;

  return graded.map((record) => {
    points += gradeOf(record)! * record.credits;
    credits += record.credits;
    return { date: record.examDate!, average: average(points, credits)! };
  });
}
