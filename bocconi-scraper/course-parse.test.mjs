// Fixture-backed parser tests: if Bocconi changes the course-page markup these
// fail loudly, instead of a scrape silently writing an empty catalogue.
//
//   node --test course-parse.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCourseIndex, parseCoursePage, parseProgrammeLinks } from "./course-parse.mjs";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

test("index yields a code + title per course, including nested-span titles", () => {
  const courses = parseCourseIndex(fixture("index-2027.html"));

  assert.ok(courses.length >= 10);
  assert.deepEqual(courses[0], { code: "20125", title: "CHANNEL MARKETING (Trade evolution, analysis and planning)" });
  assert.equal(
    courses.find((c) => c.code === "20267")?.title,
    "RIORGANIZZAZIONI FINANZIARIE E DISTRESSED VALUE INVESTING [CORPORATE FINANCIAL TURNAROUND AND DISTRESSED VALUE INVESTING]"
  );
});

test("course page yields credits, semester and type per programme", () => {
  const course = parseCoursePage(fixture("course-30280.html"));

  assert.equal(course.code, "30280");
  assert.equal(course.title, "APPLICATIONS FOR MANAGEMENT");
  assert.equal(course.language, "EN");
  assert.deepEqual(course.programmes, [
    { programmeCode: "BIEM", credits: 6, semester: "I", courseType: "OB" },
  ]);
  assert.deepEqual(course.classGroups, ["14", "15", "16", "17", "18", "19"]);
});

test("a course shared by two programmes keeps one entry per programme", () => {
  const course = parseCoursePage(fixture("course-30001.html"));

  assert.deepEqual(course.programmes, [
    { programmeCode: "CLEAM", credits: 8, semester: "I", courseType: "OBBC" },
    { programmeCode: "BIEF", credits: 8, semester: "I", courseType: "OBBC" },
  ]);
});

// The page body renders blocks for only some programmes, so the buttons are the
// only complete list. 30001 advertises BIEM but renders no BIEM block — missing
// this silently drops a course from a whole programme's catalogue.
test("programme buttons list every programme, including ones with no block", () => {
  const html = fixture("course-30001.html");
  const links = parseProgrammeLinks(html);
  const rendered = parseCoursePage(html).programmes.map((p) => p.programmeCode);

  assert.deepEqual(
    links.map((l) => l.code),
    ["CLEAM", "BIEF", "BIEM"]
  );
  assert.ok(!links.some((l) => /all programs/i.test(l.code)), "the 'All Programs' button is not a programme");
  assert.deepEqual(rendered, ["CLEAM", "BIEF"]);
  // …and the one with no block carries a link the scraper can follow.
  assert.match(links.find((l) => l.code === "BIEM").href, /ric_cdl=/);
});

test("a single-programme page needs no follow-up fetch", () => {
  const links = parseProgrammeLinks(fixture("course-30280.html"));
  assert.deepEqual(links.map((l) => l.code), ["BIEM"]);
});

test("a page without a course block parses to null rather than a half-record", () => {
  assert.equal(parseCoursePage("<html><body>Not a course</body></html>"), null);
});
