// Pure parsers for didattica.unibocconi.eu course pages. No I/O — so the
// fixture tests in course-parse.test.mjs can run offline and fail loudly when
// Bocconi changes the markup.

const decode = (s) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lang;/g, "(")
    .replace(/&rang;/g, ")")
    .replace(/\s+/g, " ")
    .trim();

/** Course codes + titles from tsn_ord_num.php (the year's full course index). */
export function parseCourseIndex(html) {
  const seen = new Map();
  // The label may wrap a nested <span class="grey">[English title]</span>, so it
  // is captured lazily up to the closing </a> and stripped of tags.
  const re =
    /<a href="tsn_anteprima\.php\?cod_ins=(\d+)[^"]*"[^>]*>\s*<span class="bds-link-item__title">[^<]*<\/span>\s*<span class="bds-link-link__label">([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const code = m[1];
    if (!seen.has(code)) seen.set(code, { code, title: decode(m[2].replace(/<[^>]+>/g, " ")) });
  }
  return [...seen.values()];
}

// "I sem." / "II sem." / "I/II sem." → a value the app can group by.
function normalizeSemester(raw) {
  const s = decode(raw).replace(/\.$/, "").toUpperCase();
  if (s.startsWith("I/II")) return "I/II";
  if (s.startsWith("II")) return "II";
  if (s.startsWith("I")) return "I";
  return s || null;
}

/**
 * Programme buttons at the top of a course page → [{ code, href }].
 *
 * These are the authoritative list of programmes a course belongs to. The page
 * body renders a credits block for only SOME of them; the rest are reachable
 * through the button's own `ric_cdl=` link, which renders that programme's
 * block instead. Without this, a course looks like it belongs to fewer
 * programmes than it does.
 */
export function parseProgrammeLinks(html) {
  const links = [];
  const re = /<button class="bds-btn-link btn"([^>]*)>([^<]+)<\/button>/g;
  for (const m of html.matchAll(re)) {
    const code = decode(m[2]);
    if (!code || /^all programs$/i.test(code)) continue;
    const href = m[1].match(/location\.href='([^']+)'/)?.[1] ?? null;
    if (!links.some((l) => l.code === code)) links.push({ code, href });
  }
  return links;
}

/**
 * One course page → { code, title, language, programmes[] }.
 *
 * A course is offered to one or more programmes, each with its OWN credits,
 * semester and OB/OP type — hence programmes[] rather than flat columns.
 */
export function parseCoursePage(html, { code } = {}) {
  const titleMatch = html.match(/<h2>\s*(\d+)\s*-\s*([^<]+)<\/h2>/);
  if (!titleMatch) return null;

  const language = /Course taught in English/i.test(html)
    ? "EN"
    : /Course taught in Italian/i.test(html)
      ? "IT"
      : null;

  // <a name="BIEM"></a> <strong>BIEM</strong> (6 credits - I sem. - OB  |  ...)
  const programmes = [];
  const progRe =
    /<a name="([^"]+)"><\/a>\s*<strong>([^<]+)<\/strong>\s*\(\s*(\d+(?:[.,]\d+)?)\s*credits?\s*-\s*([^-)]+?)\s*-\s*([^)&|]+?)\s*(?:&nbsp;|\||\))/g;
  for (const m of html.matchAll(progRe)) {
    const programmeCode = decode(m[2]);
    if (programmes.some((p) => p.programmeCode === programmeCode)) continue;
    programmes.push({
      programmeCode,
      credits: Number(String(m[3]).replace(",", ".")),
      semester: normalizeSemester(m[4]),
      courseType: decode(m[5]), // OB / OBBC / OBCUR / OP / OBS
    });
  }

  // Class groups: <a name="classe14"></a><strong>14</strong> (I sem.)
  const classGroups = [
    ...new Set([...html.matchAll(/<a name="classe([^"]+)"><\/a>/g)].map((m) => decode(m[1]))),
  ];

  return {
    code: code ?? titleMatch[1],
    title: decode(titleMatch[2]),
    language,
    programmes,
    programmeLinks: parseProgrammeLinks(html),
    classGroups,
  };
}
