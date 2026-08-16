import test from "node:test";
import assert from "node:assert/strict";
import { examRecordInput } from "../../../packages/shared/src/schemas/index.ts";

const base = { credits: 6, studyYear: 1, semester: "I" };
const parse = (patch) => examRecordInput.safeParse({ ...base, ...patch });

test("an exam is identified by a catalogue course or by a title", () => {
  assert.equal(parse({ courseId: "c1" }).success, true);
  assert.equal(parse({ customTitle: "Exchange: Game Theory" }).success, true);
  assert.equal(parse({}).success, false);
});

test("a graded pass carries 18-30; everything else carries no grade", () => {
  assert.equal(parse({ courseId: "c1", status: "PASSED", grade: 28 }).success, true);
  assert.equal(parse({ courseId: "c1", status: "PASSED" }).success, false);
  assert.equal(parse({ courseId: "c1", status: "PASSED", grade: 17 }).success, false);
  assert.equal(parse({ courseId: "c1", status: "PLANNED", grade: 28 }).success, false);
  // Planned and passed are the only statuses; a failed sitting is not recorded.
  assert.equal(parse({ courseId: "c1", status: "FAILED" }).success, false);
  assert.equal(parse({ courseId: "c1", status: "REJECTED", grade: 22 }).success, false);
});

test("pass/fail activities never carry a grade", () => {
  assert.equal(parse({ courseId: "c1", status: "PASSED", passFail: true }).success, true);
  assert.equal(
    parse({ courseId: "c1", status: "PASSED", passFail: true, grade: 30 }).success,
    false
  );
});

test("lode only decorates a 30", () => {
  assert.equal(parse({ courseId: "c1", status: "PASSED", grade: 30, lode: true }).success, true);
  assert.equal(parse({ courseId: "c1", status: "PASSED", grade: 29, lode: true }).success, false);
});

test("credits and study year stay inside a plausible range", () => {
  assert.equal(parse({ courseId: "c1", credits: 0 }).success, false);
  assert.equal(parse({ courseId: "c1", studyYear: 7 }).success, false);
  assert.equal(parse({ courseId: "c1", studyYear: 5 }).success, true);
});
