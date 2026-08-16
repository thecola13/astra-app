import test from "node:test";
import assert from "node:assert/strict";
import { LODE_GRADE, gradebookStats, averageTrend, moduleParent } from "./gradebook-stats.ts";

// Only the fields the maths reads; the API returns more.
const exam = (patch) => ({
  status: "PASSED",
  credits: 6,
  grade: 27,
  lode: false,
  passFail: false,
  examDate: "2026-01-15T00:00:00.000Z",
  course: null,
  customTitle: "An exam",
  ...patch,
});

/** Titles below are verbatim from courses-2027.json, mojibake included. */
const titled = (title, patch) => exam({ course: { id: title, code: "x", title }, ...patch });

test("the average is credit-weighted, not a mean of grades", () => {
  const stats = gradebookStats([
    exam({ credits: 12, grade: 30 }),
    exam({ credits: 4, grade: 20 }),
  ]);
  // (12*30 + 4*20) / 16 = 27.5 — a plain mean would say 25.
  assert.equal(stats.weightedAverage, 27.5);
  assert.equal(stats.gradedCredits, 16);
});

test("lode is worth 31", () => {
  assert.equal(LODE_GRADE, 31);
  const stats = gradebookStats([exam({ grade: 30, lode: true })]);
  assert.equal(stats.weightedAverage, 31);
});

test("planned exams stay out of the average and are counted apart", () => {
  const stats = gradebookStats([
    exam({ credits: 6, grade: 24 }),
    exam({ status: "PLANNED", credits: 8, grade: null }),
  ]);
  assert.equal(stats.weightedAverage, 24);
  assert.equal(stats.gradedCredits, 6);
  assert.equal(stats.plannedCredits, 8);
  assert.equal(stats.passedCount, 1);
  assert.equal(stats.plannedCount, 1);
});

test("a pass/fail activity earns credits but never moves the average", () => {
  const stats = gradebookStats([
    exam({ credits: 6, grade: 24 }),
    exam({ credits: 4, grade: null, passFail: true }),
  ]);
  assert.equal(stats.weightedAverage, 24);
  assert.equal(stats.gradedCredits, 6);
  assert.equal(stats.earnedCredits, 10); // both count towards the degree
});

test("no graded credits gives no average, not zero and not NaN", () => {
  const empty = gradebookStats([]);
  assert.equal(empty.weightedAverage, null);
  assert.equal(empty.earnedCredits, 0);

  const passFailOnly = gradebookStats([exam({ grade: null, passFail: true })]);
  assert.equal(passFailOnly.weightedAverage, null);
});

test("the trend is the running average after each exam, oldest first", () => {
  const trend = averageTrend([
    exam({ credits: 6, grade: 30, examDate: "2026-06-01T00:00:00.000Z" }),
    exam({ credits: 6, grade: 20, examDate: "2026-01-01T00:00:00.000Z" }),
  ]);
  assert.deepEqual(
    trend.map((point) => point.average),
    [20, 25]
  );
  assert.equal(trend[0].date, "2026-01-01T00:00:00.000Z");
});

test("an exam with no date can't be placed on the trend but still counts", () => {
  const records = [exam({ grade: 24, examDate: null }), exam({ grade: 30 })];
  assert.equal(averageTrend(records).length, 1);
  assert.equal(gradebookStats(records).passedCount, 2);
});

test("a module title reduces to the parent course it belongs to", () => {
  assert.equal(
    moduleParent("POLITICAL SCIENCE - MODULE 2 (INTERNATIONAL RELATIONS AND POLITICS)"),
    "POLITICAL SCIENCE"
  );
  // The parenthetical differs between modules of the same parent.
  assert.equal(
    moduleParent("STRATEGIC MARKETING AND ANALYTICS (WEB ANALYTICS) - MODULE 2"),
    moduleParent("STRATEGIC MARKETING AND ANALYTICS (DATA & ANALYTICS) - MODULE 1")
  );
  // Roman numerals, a trailing letter, and the en-dash the source mangles.
  assert.equal(
    moduleParent("FOUNDATIONS OF SOCIAL SCIENCES ? MODULE II A (INSTITUTIONS)"),
    "FOUNDATIONS OF SOCIAL SCIENCES"
  );
  assert.equal(moduleParent("MICROECONOMICS"), null);
});

test("a modular course sits out the completed-course average until it is done", () => {
  const records = [
    titled("QUANTITATIVE FINANCE AND DERIVATIVES - MODULE 1", { credits: 7, grade: 30 }),
    titled("QUANTITATIVE FINANCE AND DERIVATIVES - MODULE 2", {
      credits: 6,
      grade: null,
      status: "PLANNED",
    }),
    titled("MICROECONOMICS", { credits: 8, grade: 24 }),
  ];
  const stats = gradebookStats(records);
  assert.equal(stats.weightedAverage, 26.8); // (7*30 + 8*24) / 15
  assert.equal(stats.completedCourseAverage, 24); // the half-done course sits out
  assert.equal(stats.earnedCredits, 7 + 8); // it still earned its credits
});

test("once every module is passed the two averages agree", () => {
  const records = [
    titled("POLITICAL SCIENCE - MODULE 1 (COMPARATIVE POLITICS)", { grade: 30 }),
    titled("POLITICAL SCIENCE - MODULE 2 (INTERNATIONAL RELATIONS)", { grade: 24 }),
  ];
  const stats = gradebookStats(records);
  assert.equal(stats.weightedAverage, 27);
  assert.equal(stats.completedCourseAverage, 27);
});

test("a module with no sibling in the gradebook is a finished course", () => {
  // 50213 really is a lone MODULE 2 in the 2027 catalogue.
  const stats = gradebookStats([
    titled("ROMAN LAW - MODULE 2 (ROMAN FOUNDATIONS OF EUROPEAN LAW)", { grade: 28 }),
  ]);
  assert.equal(stats.completedCourseAverage, 28);
});

test("an elective module pool follows what the student actually enrolled in", () => {
  // Three MODULE I options and three MODULE II exist; the student picks one each.
  const stats = gradebookStats([
    titled("CRITICAL APPROACHES TO THE ARTS II - MODULE I (CINEMA)", { grade: 30 }),
    titled("CRITICAL APPROACHES TO THE ARTS II - MODULE II (MODERN ART)", {
      grade: null,
      status: "PLANNED",
    }),
  ]);
  assert.equal(stats.weightedAverage, 30);
  assert.equal(stats.completedCourseAverage, null);
});

test("an ordinary planned exam holds nothing back", () => {
  const stats = gradebookStats([
    titled("MICROECONOMICS", { grade: 26 }),
    titled("MACROECONOMICS", { grade: null, status: "PLANNED" }),
  ]);
  assert.equal(stats.completedCourseAverage, 26);
});

test("modules entered as free text group the same way", () => {
  const stats = gradebookStats([
    exam({ customTitle: "Exchange: Game Theory - Module 1", grade: 30 }),
    exam({ customTitle: "Exchange: Game Theory - Module 2", grade: null, status: "PLANNED" }),
  ]);
  assert.equal(stats.completedCourseAverage, null);
});

test("a typo in the catalogue doesn't split a modular course in two", () => {
  // 20818/20819 really are spelled differently in the 2027 catalogue.
  const stats = gradebookStats([
    titled("MANAGEMENT AND ECONOMICS FOR SUSTAINABILTY - MODULE 1 (GOVERNANCE)", { grade: 30 }),
    titled("MANAGEMENT AND ECONOMICS FOR SUSTAINABILITY - MODULE 2 (CLIMATE)", {
      grade: null,
      status: "PLANNED",
    }),
  ]);
  assert.equal(stats.weightedAverage, 30);
  assert.equal(stats.completedCourseAverage, null); // one course, still half-done
});

test("courses that differ only by a roman numeral stay separate", () => {
  // ARTS I and ARTS II are a sequence, not a typo — one letter apart.
  const stats = gradebookStats([
    titled("CRITICAL APPROACHES TO THE ARTS I - MODULE I (CINEMA)", { grade: 30 }),
    titled("CRITICAL APPROACHES TO THE ARTS II - MODULE I (MODERN ART)", {
      grade: null,
      status: "PLANNED",
    }),
  ]);
  assert.equal(stats.completedCourseAverage, 30); // ARTS I is finished
});
