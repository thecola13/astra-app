# ASTRA — v1 Build Roadmap

The ordered checklist to take the scaffold to a **complete v1 student platform**
(loyalty, academic profile, gradebook, materials, partners, events, news, users,
audit) across the Expo app and the Next.js dashboard+API.

**Scope:** Adds a **News** module the scaffold doesn't yet have. The scannable QR
is **loyalty-card only** — students show it, partner venues scan it to award
points. **Events are advertise-only** (no in-app tickets/RSVP/check-in): they're
shown in the app and link out to where tickets are actually sold. The academic
layer is **student-managed**: official public Bocconi data supplies programme
structures and class groups, while students privately record their own exams and
grades. ASTRA does not request Bocconi credentials or scrape Punto Blu.

**Stack (locked by ADRs — see ARCHITECTURE.md):** Turborepo · Neon Postgres ·
Prisma · Next.js (dashboard + API) · Better Auth email-OTP (`@studbocconi.it` / `@unibocconi.it`) ·
Vercel (hosting + Neon DB / Blob / Resend via Storage & Marketplace) · Expo/Expo Router/NativeWind/TanStack Query/Zustand · Zod
at every boundary · Sentry.

**Workflow:** Claude Code builds on `develop`; you review, verify it works, then
promote `develop → main` yourself.

**Legend:** 🤖 = Claude Code does it (you review) · 🙋 = you do by hand
(accounts, secrets, devices, money, approvals, content).

Each phase unblocks the next. Ownership is marked per item.

**Progress:** Phases 1–4 ✅ done (DB, auth, branded app shell, points engine).
Phase 0 mostly done (Neon, secrets, **email delivery via Aruba SMTP** done;
Blob / Sentry / EAS-build / store enrollment pending). Phase 13 partially done —
**web dashboard + API are deployed and live on Vercel** (ASTRA team) with
`/api/health` green and real OTP email working end-to-end; dedicated
staging/prod Neon + CI migration wiring still TODO.
Recent work: **long-lasting login** (365-day rolling session) landed, plus a
**mobile UI/UX pass** — centered logo header, single-line greeting, full-width
swipeable news carousel, compact event cards (cover-image ready), safe-area tab
bar, QR card with a centered A-logo + offline token caching, a profile
course/year selector (on-device placeholder until the real list + server field),
and a red-outlined sign-out.
**CMS landed:** admin can publish **News, Events, and Rewards** end-to-end —
dashboard CRUD (`/dashboard/news|events|rewards`) → admin API
(`/api/admin/*`, admin-only, **audit-logged**) → student read API
(`/api/news|events|rewards`) → mobile screens (news carousel + detail, events
list + detail with "Get tickets", rewards catalog). **Image upload** works now —
files are stored in Postgres (`ImageAsset`) and served via `/api/media/:id`
(swappable for Blob later); Supabase is reserved for Materials.
**Push notifications are built**: device-token registration (`/api/push/register`,
`PushToken`), Expo send-on-publish (`lib/push.ts`) with a "Send push
notification" toggle on the news form, and mobile registration
(`expo-notifications`). Real _delivery_ needs a real EAS `projectId`
(`eas init`) + a physical-device build — it no-ops on the simulator.
Course/year targeting + reward redemption still to come.
**Ask ASTRA (RAG chatbot) scaffolded** (new, not in the original v1 scope): a
"Ask us anything" bar on Home → chat screen → `/api/chat` (OpenAI embeddings +
gpt-4o-mini) → pgvector similarity search over a `Document` table (`vector`
extension + IVFFlat cosine index migrated). Content pipeline in `bocconi-scraper/`
(Playwright crawl of astrabocconi.com + scoped unibocconi.it sections → PDFs →
OpenAI-embedded chunks). Needs `OPENAI_API_KEY` + a crawl/ingest run to go live.
**Academic catalogue + gradebook landed (Phases 10A/10B):** the year's full
course list is scraped from `didattica.unibocconi.eu` into a committed
`bocconi-scraper/courses-<year>.json`, seeded into `AcademicCourse` /
`AcademicCourseProgramme`, and searchable via `/api/academic/courses`. Students
record their own exams through self-only `/api/me/gradebook` endpoints and a
mobile `/gradebook` screen (one row per exam: planned until passed). The
weighted average, credit totals and average trend are computed in
`@astra/shared` and shown on that screen. **The Exchange and MSc selection-score
estimates are the rest of 10C and deliberately absent** until the official
rules are in hand.
**Parallel next tracks → reward redemption (spend), plus the 10C estimators and
profile-driven surfaces (10D); then News push + profile targeting.**
Legend:
`[x]` done · `[~]` partial · `[ ]` todo.

---

## PART A — Foundation (scope-independent; do first, in order)

### Phase 0 — Accounts & secrets _(🙋 you; ~partially done)_

- [x] 🙋 **Neon** `dev` project, pooling on. `DATABASE_URL` (pooled) + `DIRECT_URL` in `apps/web/.env`.
- [x] 🙋 **Email delivery** — OTP codes sent via **Aruba SMTP** (`noreply@astrabocconi.com`); SMTP_* env set on Vercel. _(dev still logs to console; Resend remains a coded fallback.)_
- [ ] 🙋 **Vercel Blob** (Storage → Blob) — auto-injects `BLOB_READ_WRITE_TOKEN` _(deferred until Materials/News images)_.
- [ ] 🙋 **Sentry** — one project for web, one for mobile → 2 DSNs.
- [~] 🙋 **Expo/EAS** — Expo account done; `eas init` + `projectId` in `app.config.ts` still TODO (needed for dev/store builds).
- [x] 🙋 Secrets: `BETTER_AUTH_SECRET` + `CARD_TOKEN_HMAC_SECRET` generated.
- [x] 🙋 `apps/web/.env` + `apps/mobile/.env` created (DB + secrets in; Resend/Blob/Sentry via Vercel pending).
- [ ] 🙋 Start **Apple Developer** ($99/yr) + **Google Play** ($25) enrollment — needed only to ship.

### Phase 1 — Database schema ✅ DONE _(🤖 keystone)_

- [x] 🤖 Full Prisma schema: `User`, roles/areas, soft-delete (`deletedAt`), consent (`policyVersion`).
- [x] 🤖 Append-only `PointsLedgerEntry` (+ no mutable balance anywhere).
- [x] 🤖 `PointsBalance` SQL view + `MaterialStats` view (raw-SQL migration; aggregate-only for privacy).
- [x] 🤖 UPDATE/DELETE-revoking trigger on the ledger (raw SQL) — verified live.
- [x] 🤖 `DiscountUsage` with generated `usageDate` (UTC day) + `@@unique([userId, offerId, usageDate])`.
- [ ] 🤖 Geo strategy: verify PostGIS on Neon; else `earthdistance`/haversine. _(deferred to Phase 6)_
- [x] 🤖 Better Auth Prisma tables (Session/Account/Verification). Seed script (areas, demo student, partner, reward, event, news).
- [x] 🙋 Migrated to Neon (`migrate deploy`) + seeded; zero schema drift verified.

### Phase 2 — Auth spine ✅ DONE _(🤖)_

- [x] 🤖 Better Auth email-OTP on web (`@studbocconi.it`/`@unibocconi.it` before-hook + rate-limit 3/min); bearer plugin.
- [x] 🤖 Implement `lib/authz.ts` for real — deny-by-default; roles + areas.
- [x] 🤖 `/api/me` returns the real user; `/api/health` verifies Neon (`SELECT 1`).
- [x] 🤖 Real mobile OTP flow (SecureStore session) + Bearer auth header in the shared typed client.
- [x] 🙋 **Milestone:** verified end to end (curl + on the iOS simulator).
- [x] 🤖 **Long-lasting login:** 365-day rolling session (`updateAge` 1 day) in `lib/auth.ts`; the mobile app persists the bearer token in the OS keychain (`apps/mobile/lib/session.ts`), so students sign in once. Applies to the web dashboard cookie too.

### Phase 3 — Shells → real ✅ DONE _(🤖)_

- [x] 🙋 Media kit (logos) added to `brand/` + `apps/mobile/assets/`. _(exact brand hexes/fonts optional refinement)_
- [x] 🤖 Design tokens from the logo (brand blue `#04107E` in NativeWind); app icon. _(splash deferred to builds)_
- [x] 🤖 Mobile bottom-tab navigation (Home / Events / Card / Rewards / Profile); campus-backdrop login.
- [x] 🤖 Web dashboard: auth-gated layout (deny-by-default) + `/signin`; admin routes protected.
- [x] 🤖 **Single central admin login** — `/signin` is username + password + emailed OTP (2FA), fully separate from the student email-OTP flow (`lib/admin-auth.ts`, `adminLoginPlugin` in `lib/auth.ts`, `scripts/create-admin.mjs`). OTP defaults ON in production, OFF locally (`ADMIN_2FA_ENABLED` override). Dashboard is URL-only — the public landing page has no staff-login link. ASTRA controls all content; partners/areas do **not** self-serve.
- [x] 🤖 Established the per-endpoint pattern: session → `authz` → Prisma (+ audit lands with the feature phases).

### Phase 3A — Academic profile foundation _(🤖; gradebook prerequisite)_

- [x] 🤖 Add a one-to-one `StudentAcademicProfile` owned by `User`: programme, optional official track/path, catalogue/cohort academic year, current study year, and primary class group.
- [x] 🤖 Populate cascading programme → track (when applicable) → year → class selectors from the versioned official catalogue, replacing the hard-coded mobile programme list.
- [x] 🤖 Include current BSc, MSc, MA/CLMG and still-selectable legacy programme codes; label legacy programmes instead of hiding students who are completing older structures.
- [x] 🤖 Add authenticated `GET/PUT /api/me/academic-profile` contracts in `@astra/shared`; extend `/api/me` with the saved profile.
- [x] 🤖 Migrate an existing on-device course/year choice into the server profile on the student's first update, then make the server authoritative.
- [x] 🤖 Treat the selected class as the default only: electives, languages, exchange courses, and individual offerings may override it.
- [x] 🤖 Apply profile changes immediately to Materials and preserve the targeting foundation for News, push, and Ask ASTRA.
- [ ] 🙋 Verify profile selection, persistence across devices, change/remapping behavior, and account deletion.

---

## PART B — Feature modules (dependency-ordered)

### Phase 4 — Points engine ✅ DONE _(🤖 core; rewards/partners/events depend on it)_

- [x] 🤖 Server service (`lib/points.ts`): `earn()` / `spend()` writing ledger entries; balance = SUM over the ledger.
- [x] 🤖 `spend()` rejects when balance insufficient (Serializable transaction — no overspend races).
- [x] 🤖 Endpoints: `GET /api/points/balance`, `GET /api/points/history` (auth-gated).
- [x] 🤖 Mobile: points balance on Home (tappable) + points-history screen.
- [x] 🙋 Verified: earn 250 → spend 90 → balance 160; overspend rejected; API returns balance+history.

### Phase 5 — Loyalty card (scannable QR) _(🤖 the earn mechanism)_

- [~] 🤖 HMAC-signed card token implemented (`lib/card-token.ts`, `CARD_TOKEN_HMAC_SECRET`). **Short-lived rotation + single-use/replay-block still pending** (token currently valid ~24h — a screenshot would still scan).
- [~] 🤖 Mobile "My Card" screen: renders the QR with a **centered A-logo + offline token caching** and "refreshes automatically / works offline" copy (`apps/mobile/app/(tabs)/card.tsx`). True short-lived rotation still pending (see above).
- [~] 🤖 Scan endpoint (staff/partner) → verify token → `earn()` → ledger is **live** (`/api/partner/scan`). **AuditLog write on scan still pending** (Phase 11 invariant).
- [ ] 🙋 Test: show card, scan it from a second device, see points land.

### Phase 6 — Partners & discounts _(🤖)_

- [ ] 🤖 `Partner` + `Offer` models; dashboard CRUD (area-scoped via authz).
- [ ] 🤖 Redeem flow → `DiscountUsage` (once-per-day unique) (+ optional points).
- [ ] 🤖 "Partners near me": geo query (PostGIS/haversine) + radius.
- [ ] 🤖 Mobile: partner list/map, offer detail, redeem.
- [ ] 🙋 Verify once-per-day constraint blocks a second same-day redemption.

### Phase 7 — Rewards (spend points) _(🤖)_

- [ ] 🤖 `Reward` catalog + redemption (atomic `spend()`; deny if insufficient).
- [ ] 🤖 Endpoints + dashboard CRUD + fulfillment/redemption states.
- [ ] 🤖 Mobile: rewards catalog, redeem, redemption history.
- [ ] 🙋 Verify a redemption debits points and a too-expensive one is refused.

### Phase 8 — Events (advertise + external ticketing) _(🤖; scope trimmed)_

**No in-app tickets / RSVP / check-in.** Events are advertised in the app and link
out to wherever tickets are actually sold. (The `Rsvp`/`Ticket` models, the
`EVENT_CHECKIN` points source, and the check-in scanner are **dropped** from v1.)

- [ ] 🤖 `Event` model: title, description, image (Blob), date/time, location, **external ticket URL**.
- [ ] 🤖 Dashboard: event CRUD (publish/unpublish, area-scoped).
- [ ] 🤖 Mobile: events list + detail with a **"Get tickets"** button that opens the external link (wires up the Home "Latest events" placeholder).
- [ ] 🙋 Verify events publish/hide correctly and the external link opens.

### Phase 9 — News / announcements + push _(🤖 new module)_

- [ ] 🤖 `NewsPost` model (+ images via Vercel Blob); dashboard publish/CRUD.
- [ ] 🤖 Mobile: news feed (pull-to-refresh) + detail.
- [ ] 🤖 Expo push: register device tokens; send on publish (Edge/route + Expo push API).
- [ ] 🙋 Approve the notification permission on device; confirm a push arrives on publish.

### Phase 10 — Materials _(🤖)_

- [ ] 🤖 `Material` model; upload → **Vercel Blob**; serve via Blob URLs (private/token where needed).
- [ ] 🤖 `MaterialStats` view surfaced to admins — **aggregate counts only, no per-user rows**.
- [ ] 🤖 Mobile: materials list + download; dashboard: upload + stats.
- [ ] 🙋 Confirm signed URLs expire and the bucket isn't publicly listable.

### Phase 10A — Official academic catalogue _(🤖; structured source of truth)_

- [x] 🤖 Model `AcademicCourse` + `AcademicCourseProgramme` (credits/semester/type are per programme) alongside the existing `AcademicCatalogue`/`AcademicProgramme`/`AcademicClassGroup`/`AcademicTrack`. **`CourseOffering` and per-course class groups were dropped** — class groups already exist at programme level and nothing consumed a separate offering. Module parent/child deferred to 10C, which is the first thing that needs it.
- [x] 🤖 Store official course code, title, credits, semester, compulsory/elective type, language, programme, source URL, and retrieval time. _(Study year is **not** published per course by Bocconi — only the study-plan pages carry it, as categories rather than codes — so students set the year on their own record.)_
- [x] 🤖 Idempotent import: `bocconi-scraper/scrape-courses.mjs` (plain `fetch`, politeness delay, retries — these pages are server-rendered PHP, so Playwright is unnecessary) → committed `courses-<year>.json` → `npm run seed:courses` upserts by `(catalogue, code)` and reports unmatched programme codes instead of importing silently.
- [x] 🤖 Version every import by academic year: the JSON snapshot is committed and the catalogue row keyed by academic year, so prior snapshots survive in git.
- [x] 🤖 Parse structured HTML into catalogue records; RAG chunks are not the academic database.
- [x] 🤖 Manually run and reviewed import, with fixture-backed parser tests (`bocconi-scraper/course-parse.test.mjs`). **No scheduling** — a re-run is a command plus a reviewed diff.
- [x] 🤖 Covers every programme in the year's course index (BSc, MSc, MA/CLMG and legacy codes), since the import is driven by the index rather than a programme list.
- [ ] 🙋 Review imported programmes, class groups, credits, semesters, and module links against the [official study plans](https://www.unibocconi.it/en/programs/bachelor-science/management/study-plan) and [course catalogue](https://didattica.unibocconi.it/ts/tsn_anteprima.php?anno=2027&cod_ins=30280).

### Phase 10B — Personal gradebook _(🤖; private student-owned data)_

- [x] 🤖 `ExamRecord` covers official courses (`courseId`) plus custom/elective/exchange ones (`customTitle`).
- [x] 🤖 Tracks planned/passed status, exam date, credits, grade (18–30), `30 e lode`, pass/fail, notes, study year and semester. _(Registration date and per-course class override skipped — nothing reads them yet.)_
- [~] 🤖 **Attempt history was dropped as a non-goal:** a failed sitting leaves no trace on the transcript and a grade cannot be refused, so `FAILED`/`REJECTED` had nothing to describe. An exam is `PLANNED` until it is `PASSED`, one row per exam, enforced by a partial unique index.
- [~] 🤖 Profile changes never touch gradebook records (nothing cascades from the profile). **Pre-seeding a plan from the programme's compulsory courses is not built** — students add exams themselves.
- [x] 🤖 Self-only `GET/POST /api/me/gradebook` and `PUT/DELETE /api/me/gradebook/:id` + `GET /api/academic/courses`, Zod contracts in `@astra/shared`, `self:read`/`self:write` through `lib/authz.ts`, ownership enforced inside the query.
- [x] 🤖 Standalone mobile `/gradebook` screen linked from Home and Profile (no sixth tab), grouped by year then semester.
- [x] 🤖 Add/edit/delete, catalogue picker with an "outside my programme" search plus free-text fallback, loading/empty/error states, and catalogue data visibly distinct from student-entered data. _(Module relationships deferred with 10C.)_
- [ ] 🙋 Verify manual entry, attempts, electives/exchange courses, profile changes, and cross-device persistence.

### Phase 10C — Academic analytics _(🤖; estimates, not official rankings)_

- [x] 🤖 Pure, tested calculation functions in `packages/shared/src/gradebook-stats.ts` — credit-weighted average (`30 e lode` = 31), graded vs earned credits, planned credits, passed/planned counts, and the running average trend. No endpoint and no query: mobile already holds every record.
- [x] 🤖 Show two deliberate views: **module-inclusive average** includes each completed module immediately; **completed-course average** leaves a modular course out while any of its modules is still planned. The parent is derived from the title (`moduleParent()`), which already carries the module marker — no schema change, no re-scrape. _The catalogue cannot answer "which modules are required": it lists elective module pools (three MODULE I options for `CRITICAL APPROACHES TO THE ARTS II`), lone modules whose sibling ran in another year (`50213 ROMAN LAW - MODULE 2`), and the same parent split differently per programme (`MATHEMATICS` is 1+2 for BESS, only 2 for WBB). The student's own gradebook is the authority instead. Parent names are matched one typo apart, because the catalogue misspells `MANAGEMENT AND ECONOMICS FOR SUSTAINABILTY` in module 1 but not module 2; a differing sequence numeral (`ARTS I` vs `ARTS II`) is never forgiven. Checked against all 41 module parents in the 2027 catalogue: one merge, the intended one._
- [ ] 🤖 Add an undergraduate Exchange score estimate using academic-year/programme-specific coefficients, credit scope, minimum-credit threshold, and deadline rules.
- [ ] 🤖 Add an internal Bocconi MSc admission score estimate using the applicable round threshold, weighted average converted to 110, module treatment, extra-credit adjustment, and `in corso` status.
- [ ] 🤖 Store each rule's academic year, programme/level, selection round, effective dates, official source URL, and version; never hard-code one formula as timeless policy. **Decided:** committed constants keyed by year and round, like `courses-<year>.json` — git is the version history, a rule change is a reviewed PR. No rules table, no admin UI.
- [ ] 🤖 Label every selection score as an estimate and show the formula inputs/as-of deadline so students can reconcile it with their transcript.
- [~] 🤖 Test honors, pass/fail activities, modules, partial courses, zero graded credits, exchange scope/deadlines, programme coefficients, MSc rounds, and rounding. _(Done for the averages: `packages/shared/src/gradebook-stats.test.mjs`. The estimator cases land with the estimators.)_
- [ ] 🙋 Validate sample calculations against the current [Exchange criteria](https://www.unibocconi.it/en/current-students/international-mobility/exchange-program/undergraduate-selection-criteria) and [MSc admission rules](https://www.unibocconi.it/en/current-students/application-and-admissions).

### Phase 10D — Profile-driven academic experience _(🤖)_

- [ ] 🤖 Filter Materials server-side by the saved programme/year; the mobile UI must not be the authorization boundary.
- [ ] 🤖 Surface a compact Home summary: next exam, current average, and completed-credit progress.
- [ ] 🤖 Add programme/year targeting to academic News and push preferences without placing grades in notifications.
- [ ] 🤖 Give Ask ASTRA programme/year context when useful, but do not provide grades unless a later explicitly consented use case requires them.
- [ ] 🤖 When a profile changes, preserve the gradebook and offer explicit catalogue remapping instead of silently deleting or rewriting records.
- [ ] 🙋 Verify that two students with different profiles receive the correct catalogue, Materials, and targeted experience.

### Phase 11 — Users, roles/areas admin & Audit log _(🤖)_

- [ ] 🤖 Dashboard user management: list, assign roles/areas, soft-delete, consent view.
- [ ] 🤖 Audit log written on **every** mutating admin action (append-only) + dashboard audit viewer.
- [ ] 🙋 Verify a non-admin is denied and the action is audited.

### Phase 12 — Hardening & polish _(🤖)_

- [ ] 🤖 Zod on every endpoint (no `any` at the boundary); consistent error envelope + `requestId`.
- [ ] 🤖 Rate limits on sensitive routes; CORS allow-list (`MOBILE_ALLOWED_ORIGINS`).
- [ ] 🤖 Loading/empty/error/offline states across mobile; accessibility pass.
- [ ] 🤖 i18n (IT/EN) if desired. 🙋 decide.
- [ ] 🤖 Tests: authz unit tests, points-ledger invariants, endpoint contract tests. Sentry verified both apps.

### Phase 12A — Academic-data privacy and resilience _(🤖)_

- [ ] 🤖 Treat grades and exam history as sensitive private data; administrators cannot browse individual gradebooks by default.
- [ ] 🤖 Keep grades out of logs, analytics events, audit metadata, push payloads, and RAG context.
- [ ] 🤖 Add gradebook export and complete deletion, including orphan/retention checks after account deletion.
- [ ] 🤖 Add API tests proving cross-user isolation for profile, exams, grades, and analytics.
- [ ] 🤖 Add saved official-page fixtures so catalogue layout changes fail visibly before corrupting an import.
- [ ] 🤖 Monitor catalogue freshness and failed imports without serving partially updated snapshots.
- [ ] 🙋 Review consent/privacy copy and confirm score disclaimers before release.

---

## PART C — Ship

### Phase 13 — Deploy web (dashboard + API) _(🙋 + 🤖; ~partially done)_

- [~] 🙋 Vercel import + Root Dir `apps/web` + env done — **production live on the ASTRA-team Vercel** (`astra-app-liard.vercel.app`); dedicated Neon `staging`/`prod` projects still TODO (one Neon for now).
- [~] 🤖 DB migrated to Neon (`migrate deploy` from Phase 1); formal `db:migrate:deploy` CI wiring against `DIRECT_URL` still TODO.
- [~] 🙋 `/api/health` smoke-tested on the live deployment (`db:up` ✅); per-PR Neon branch previews still TODO.

### Phase 14 — Ship mobile _(🙋 + 🤖)_

- [ ] 🤖 Finalize `app.config.ts` per-env API URLs, `eas.json` profiles, Android **API 36**.
- [ ] 🙋 `eas build --profile preview` (internal APK) → test on real devices.
- [ ] 🤖 Store copy + privacy policy draft; 🙋 screenshots, listings in App Store Connect / Play Console.
- [ ] 🙋 `eas build/submit --profile production`; submit for review; respond to reviewers.

---

## Notes

- **Media kit:** drop into `apps/mobile/assets/brand` (and a `/brand` root folder for raw source). Tokens flow into the NativeWind theme.
- **Every** DB access routes through `lib/authz.ts` and (for mutations) writes an audit entry — this is added per-endpoint as modules land, not bolted on at the end.
- Calendar time is dominated by **external waits** (Apple/Play review, account approvals), not build time.
