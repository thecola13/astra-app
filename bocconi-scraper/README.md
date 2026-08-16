# bocconi-scraper

One-off tooling, in two unrelated halves. Not part of the app workspaces —
install and run it on its own.

1. **Ask ASTRA (RAG)** — crawl ASTRA + Bocconi pages to PDFs, ingest into Neon
   (pgvector) as embedded chunks. Sections 1–4 below.
2. **Academic catalogue** — scrape the official course list for one academic
   year into JSON that `packages/db` seeds from. Section 5.

## Prerequisites

- The `Document` table + `vector` extension already exist in Neon (added by the
  `rag_documents` Prisma migration).
- An `OPENAI_API_KEY`.

## 1. Install

```bash
cd bocconi-scraper
npm install
npx playwright install chromium
```

## 2. Crawl → PDFs

```bash
npm run crawl        # tune SEEDS / ALLOWED_PATHS / MAX_PAGES in crawl.mjs first
```

Outputs `pdfs/*.pdf` + `pdfs/manifest.json` (file → source URL). **Review the
PDFs and delete junk** (cookie banners, login walls, empty pages) before ingest.
Scope: `astrabocconi.com` fully; `unibocconi.it` only under the student-relevant
path prefixes in `ALLOWED_PATHS`. robots.txt is respected and requests are
rate-limited (`DELAY_MS`).

## 3. Ingest → Neon

```bash
OPENAI_API_KEY=sk-... npm run ingest
```

Chunks each PDF (~2000 chars), embeds with `text-embedding-3-small` (1536 dims),
and inserts into `"Document"`. **Full refresh** — clears existing rows first.
Reads the DB URL from `../apps/web/.env` (`DIRECT_URL`) or the environment.

## 4. Verify

```sql
SELECT count(*) FROM "Document";
```

Then ask a question in the app (Home → "Ask us anything") or curl `/api/chat`.

---

## 5. Academic catalogue → JSON → Neon

Separate from the RAG pipeline: this produces the structured course catalogue
behind the gradebook. No Playwright, no OpenAI — `didattica.unibocconi.eu` is
server-rendered PHP, so plain `fetch` is enough.

```bash
npm test                       # fixture-backed parser tests — run these first
npm run scrape:courses         # 2026-2027 a.y.; ANNO=2028 for the next one
                               # LIMIT=5 for a smoke run, DELAY_MS to slow down
                               # CACHE_DIR=/tmp/pages to keep the fetched HTML
```

Writes `courses-<anno>.json` (~800 courses, ~15 minutes at the default 800 ms
delay) and prints every code it skipped. **Commit the JSON** — a reviewed diff is
the safeguard against a layout change quietly emptying the catalogue.

Set `CACHE_DIR` when iterating: fixing the parser then re-parsing 800 pages
shouldn't mean hitting Bocconi 800 more times.

A course page renders a credits block for only *some* of the programmes its
buttons advertise, so the scraper follows each unrendered programme's
`ric_cdl=` link to get its credits and semester. Anything it still can't resolve
is listed at the end of the run rather than dropped quietly.

Then load it:

```bash
cd ../packages/db && npm run seed:courses
```

Idempotent: upserts by `(catalogue, code)`, replaces each course's programme
pairings, and warns about programme codes with no `AcademicProgramme` row rather
than importing a partial catalogue silently. The catalogue row for the JSON's
academic year must already exist.

There is deliberately **no scheduler**. Re-running is a manual command once a
year, or whenever `npm test` starts failing because Bocconi changed the markup.
