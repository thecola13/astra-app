// Scrape the official Bocconi course catalogue for one academic year into a
// JSON file that packages/db seeds from.
//
//   node scrape-courses.mjs            # 2026-2027 a.y. (anno=2027)
//   ANNO=2028 node scrape-courses.mjs
//
// One-off by design: run it, review the diff, commit the JSON. There is no
// scheduler and no live sync — programme structures change rarely, and a
// reviewed snapshot is safer than a silent overwrite.
//
// ponytail: plain fetch, no Playwright — these pages are server-rendered PHP
// with no JS. Switch to the crawl.mjs Playwright setup only if that changes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCourseIndex, parseCoursePage } from "./course-parse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANNO = process.env.ANNO ?? "2027";
const DELAY_MS = Number(process.env.DELAY_MS ?? 800); // politeness delay
const LIMIT = Number(process.env.LIMIT ?? 0); // 0 = all; >0 for smoke runs
const CACHE_DIR = process.env.CACHE_DIR; // optional: reuse fetched HTML across runs
const BASE = "https://didattica.unibocconi.eu/ts";
const OUT = path.join(HERE, `courses-${ANNO}.json`);

const indexUrl = `${BASE}/tsn_ord_num.php?anno=${ANNO}`;
const courseUrl = (code) => `${BASE}/tsn_anteprima.php?anno=${ANNO}&cod_ins=${code}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Optional on-disk cache: re-parsing 800 pages after a parser fix shouldn't mean
// re-hitting Bocconi 800 times. Off unless CACHE_DIR is set.
const cachePath = (url) =>
  CACHE_DIR ? path.join(CACHE_DIR, `${url.replace(/[^\w]+/g, "_")}.html`) : null;

async function getCached(url) {
  const file = cachePath(url);
  if (file && fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  await sleep(DELAY_MS);
  const html = await get(url);
  if (file) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, html);
  }
  return html;
}

async function get(url, attempt = 1) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "ASTRA-bocconi-app/1.0 (student association; one-off catalogue import)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (attempt >= 3) throw err;
    await sleep(DELAY_MS * attempt * 2);
    return get(url, attempt + 1);
  }
}

const index = parseCourseIndex(await get(indexUrl));
if (index.length === 0) {
  throw new Error(`No courses found at ${indexUrl} — the index layout probably changed.`);
}
const targets = LIMIT > 0 ? index.slice(0, LIMIT) : index;
console.log(`${index.length} courses in the ${ANNO} index; fetching ${targets.length}…`);

const courses = [];
const skipped = [];
const incomplete = [];
for (const [i, entry] of targets.entries()) {
  const url = courseUrl(entry.code);
  let parsed = null;
  try {
    parsed = parseCoursePage(await getCached(url), { code: entry.code });
  } catch (err) {
    skipped.push({ code: entry.code, reason: String(err.message ?? err) });
    continue;
  }
  // No course block = the code is listed but not actually offered this year.
  if (!parsed || parsed.programmes.length === 0) {
    skipped.push({ code: entry.code, reason: parsed ? "no programme block" : "no course block" });
    continue;
  }

  // The default view renders a credits block for only some of the programmes
  // the buttons advertise. Fetch the per-programme view for the rest.
  const { programmeLinks, ...course } = parsed;
  for (const link of programmeLinks) {
    if (course.programmes.some((p) => p.programmeCode === link.code)) continue;
    if (!link.href) {
      incomplete.push({ code: entry.code, programme: link.code, reason: "no link to follow" });
      continue;
    }
    const variantUrl = new URL(link.href, `${BASE}/`).toString();
    try {
      const variant = parseCoursePage(await getCached(variantUrl), { code: entry.code });
      const block = variant?.programmes.find((p) => p.programmeCode === link.code);
      if (block) course.programmes.push(block);
      else incomplete.push({ code: entry.code, programme: link.code, reason: "no block on its own page" });
    } catch (err) {
      incomplete.push({ code: entry.code, programme: link.code, reason: String(err.message ?? err) });
    }
  }

  courses.push({ ...course, title: course.title || entry.title, sourceUrl: url });
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${targets.length}…`);
}

const payload = {
  academicYear: `${Number(ANNO) - 1}-${ANNO}`,
  indexUrl,
  retrievedAt: new Date().toISOString(),
  courses: courses.sort((a, b) => a.code.localeCompare(b.code)),
};
fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);

// Loud about what was dropped — a silent skip list reads as full coverage.
const pairings = courses.reduce((n, c) => n + c.programmes.length, 0);
console.log(
  `\nWrote ${courses.length} courses / ${pairings} programme offerings to ${path.basename(OUT)}`
);
if (incomplete.length) {
  console.log(`\n${incomplete.length} programme(s) advertised but not resolved:`);
  for (const s of incomplete) console.log(`  ${s.code} → ${s.programme} — ${s.reason}`);
}
if (skipped.length) {
  console.log(`\nSkipped ${skipped.length} course(s):`);
  for (const s of skipped) console.log(`  ${s.code} — ${s.reason}`);
}
