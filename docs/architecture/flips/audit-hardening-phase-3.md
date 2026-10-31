# Audit hardening — Phase 3

**Date:** 2026-10-27 · **Status:** PLAN (ledger §8 all TODO) — written on
branch `claude/adoring-pascal-o0miro` at branch point
`20785b8` (= `origin/main`: Phases 0–2 merged by PR #1, plus PR #3 —
`icons:check` green again — and PR #4 — Nx 23.1.3, Angular 22.2.3,
maplibre-gl 6, firebase-tools 15.34.1). Every line number below is a hint
on `20785b8`; every package re-reads its sites before it edits. ·
**Owner's word:** the Phase 3 brief (orchestrator scratchpad
`brief-p3.md`, "Mission: Audit-hardening Phase 3") and the owner's three
answers of 2026-10-27 it records — _scope_: build (A) seed clock pinning,
(B) login/OTP audit rows, (C) GDPR export, (D) GDPR erasure, (E) the CI
pipeline; _erasure semantics_: **"pseudonymize, keep records — strip
names, contact values and free text from the person's documents; keep
visits, money and audit rows keyed by opaque ids"**; _App Check_: **stays
deferred** (owner rulings, Deferred #4; `docs/production-deploy.md` keeps
enforcement OFF). The Phase 0–2 brief's §1 (hierarchy and HARD LIMITS),
§6, §7, §8, §9, §10 and §11 carry over verbatim. ·
**Law:** `CLAUDE.md` Laws 1–10 and `.claude/rules/*.md` (`ecs-layering`,
`ecs-primitives`, `ecs-components`, `ecs-systems`, `ecs-ports`,
`ecs-pipelines`, `firestore-layout`, `presenters`, `angular-ui`). This plan
never overrides them; where the brief's design breaks one, §0.2 records the
lawful form with both quotes (hierarchy: hard limits › Laws + rules › OR
rulings / HANDOFF §6 › the brief's process › the brief's designs ›
latitude). ·
**Sources:** the two briefs; `docs/architecture/decisions/2026-10-26-owner-rulings.md`
(OR-9, OR-24, OR-25 / OR-58, OR-26, OR-31, OR-33, OR-34, OR-51, OR-55, the
Deferred list); `docs/architecture/HANDOFF.md` §3.3 (the audit-hardening
record: RU-1…RU-41, DEP-1…DEP-26, the carried list), §4–§6;
`docs/architecture/flips/audit-hardening.md` (the Phase 0–2 plan — the
structure template and the record of the machinery reused here);
`docs/architecture/firestore-runbook.md` (§1.1 matrix, §2.5 retention, §3
deploy order, §4.0–§4.10 grep gates); `docs/design-research/client-details-design.md`
(rows 38–40, §6.16, §6.16.1, §6.16.2, R36, R45, R47, T5); the six read-only
inventories of this phase (orchestrator scratchpad `inv-p3/a-seed-clock.md`,
`b-identity-audit.md`, `cd-person-data-map.md`, `cd-surfaces.md`,
`d-erasure-mechanics.md`, `e-ci.md`; not committed — every claim used here
was re-verified against the code, and §0.1 cites the file:line it rests on);
the Phase 3 baseline gate logs (`/home/user/gate-p3-baseline/*.log`, read
only).

**What this is.** One branch, one PR, five commits — one per workstream at
a green boundary, in the order **A → B → C → D → E**: A first because it
stabilises the gate every later stage runs; E last because it runs what A–D
add. Phases 0–2 built the machinery reused here, never copied:
`AuditSystem.createsOf` / `commitWrites` (rows inside the commit plan, a
replay plans none), `AuditAction` / `AuditContext` variants with prefixed
fields, `Actor.forCaller`, `AuditTargetRef`, `auditOperationId`, the
transport `operationId` (RU-21), `LogEvent` + `creativo/no-literal-log-message`,
the callable outcome line and its `inputDigest` (WS-4.2), `writeOperationId`,
the document-change triggers and `GovernedChangeSystem` (WS-3, DEP-26),
`AuditReadPorts` and the five `auditLog` timelines (WS-7),
`ClientIssueSystem`, `TriggerAttemptSystem`, the dead letter, preflight
P1–P9.

**Behaviour is frozen** except each workstream's declared DEPARTURE (§5,
`P3-DEP-n`, with before/after, evidence and every spec / e2e / P0 /
emulator file whose pinned behaviour changes). Valid stored documents and
callables answer exactly as before apart from those DEPs. Phase 3's ids —
`P3-RU-n`, `P3-L-n`, `P3-DEP-n` — never collide with Phases 0–2's.

**Out of scope** (brief §2 "Out of scope"; listed in the PR if an edge is
touched): App Check (Deferred #4 — not wired; R47 step-up therefore not
built); impersonation read-as (OR-24); a real OTP provider (P8 stays FAIL);
the admin Activity screen; `setRoles`; the `maxPartySize` cap and the other
Phase 0–2 owner flags (they stay flags); any change to EXISTING copy.

**This phase ends** when the packages of §3 are integrated, every existing
spec passes unchanged except the edits §4/§5 name, the FULL gate of §6.1 is
green against the measured baseline of §6.3 (plus §6.1's two Phase 3
additions: the committed runbook-gates runner and the late-shop-time run),
and HANDOFF, the runbook, `production-deploy.md` and the §8 ledger record
the phase.

---

## 0. Reconciliation, rulings and the latitude register (read first)

### 0.1 Reconciliation (every sub-item of P3-WS-A…E against `20785b8`)

STILL OPEN = nothing of it exists; PARTLY DONE = what remains is named;
DONE = nothing to build; DECIDED = a ruling, a constraint or this plan's
§0.2/§0.3 settles it. No OR ruling decides any Phase 3 item: `grep -n -i
"erasure\|erase\|export\|gdpr\|seed clock\|SEED_NOW\|otp.*audit"
docs/architecture/decisions/2026-10-26-owner-rulings.md` finds only the
Deferred list's App Check item (#4) and the walk-in adoption item (#2),
both applied below; HANDOFF §3.3 records "no login / OTP audit rows" and
"GDPR export/erasure … (Phase 3)" as Phase 0–2 carry-forwards.

| #    | Item                                                                       | Status                                            | Evidence (file:line at `20785b8`)                                                                                                                                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A.1  | dev seed derives its calendar from the wall clock                          | STILL OPEN                                        | `tools/seed-dev-catalog.mjs:284` `buildClientBook(Date.now())` (also under `--catalog-only`, "Built in both modes"); `tools/seed/calendar.mjs:42-43` `createShopCalendar(nowMs)` already takes an instant; the time of day changes bodies only through `tools/seed/appointments.mjs:80-100` `settledOnlyIfPast` (owner, 2026-09-09) and `:147`, `:188`                        |
| A.2  | the seed's stats projection clock                                          | DECIDED: stays live (P3-RU-2)                     | `tools/seed-dev-catalog.mjs:712` `nowUtcMs: () => Date.now()`; the functions' `dispatchClientProjections` recomputes the same clients on the real clock (`apps/functions/src/main.ts:253-258`); `verify:p0` (c) compares the two (`tools/verify/p0/verify-p0.mjs:13-17`)                                                                                                      |
| A.3  | e2e "today" and "still ahead" read the wall clock                          | STILL OPEN                                        | `apps/web/e2e/support/shop-clock.ts:54-59` `shopToday()`, `:62-85` `EVENING_START` / `LATEST_START` / `stillAheadToday()`; callers `client-card-glance.spec.ts:31`, `:162`, `:197`, `:370`, `:713`; `appointments.spec.ts:9`, `:14-16`; `booking-core.spec.ts`, `csp/csp-smoke.spec.ts`, `staff-walk-in.spec.ts`, `programs.spec.ts`, `support/booking-days.ts` (import only) |
| A.4  | e2e global setup                                                           | PARTLY DONE                                       | `apps/web/e2e/support/global-setup.ts:43-53`: `seededFrom = Date.now()` (`:47`, OPERATIONAL — the settle's `--since`, stays) then `seed-dev-catalog.mjs --catalog-only` with no instant (`:49`)                                                                                                                                                                               |
| A.5  | the web reads "now" through one seam `page.clock` governs                  | DONE (no app change)                              | `libs/infrastructure/clock/src/lib/browser-runtime.adapter.ts:23` `UtcEpochMs.of(Date.now())` behind `CLOCK_PORTS`; precedent `apps/web/e2e/appointments-screenshots.spec.ts:23` `page.clock.setFixedTime(PINNED_NOW)`                                                                                                                                                        |
| A.6  | server "now" under the emulator                                            | DECIDED by constraint (brief: "cannot be faked")  | `apps/functions/src/main.ts:253-258`; the emulator integration specs already pin `nowUtcMs` (`pinnedNowUtcMs()`); callable-driven e2e specs book days ≥ tomorrow (`support/booking-days.ts:11-14`) and are correct for any real time (§2.A.4)                                                                                                                                 |
| A.7  | `verify:p0` (a) byte-identical second seed run                             | PARTLY DONE                                       | `tools/verify/p0/verify-p0.mjs:306-323` `runSeed()` passes `process.env` only; `:497-528` (a): equal only while no today-visit end and no shop midnight passes between the two runs                                                                                                                                                                                           |
| A.8  | the known time-of-day flakes                                               | STILL OPEN (recorded)                             | HANDOFF §4 "Known flakes" (the glance barber test after ~23:15 shop time) and §3.3 "Carried from the audit hardening" (`client-card-glance.spec.ts:364`); mechanism: `stillAheadToday` clamps to 23:25 (`shop-clock.ts:65`, `:82`), the visit has started when `VisitStorySystem.isUpcoming` reads it                                                                         |
| A.9  | the late-shop-time proof                                                   | STILL OPEN → P3-RU-34                             | no override exists anywhere (`git grep -n "SEED_NOW\|E2E_NOW"` empty); the e2e half proves "late" only when the REAL shop clock is late (the browser pin reads the suite DAY, never its time of day — P3-RU-34); the seed half reads the instant (`appointments.mjs:80-100` `settledOnlyIfPast`)                                                                              |
| A.10 | every time-sensitive e2e spec proved deterministic or explained            | DECIDED (§2.A.1 table)                            | inventory `a-seed-clock.md` §3 re-verified: `shop-clock.ts` callers (`git grep -n shopToday apps/web/e2e`), the 2030 seeds (`appointments.spec.ts:57`, `:123`, `:161`; `account-dashboard.spec.ts:58`; `account-dashboard-screenshots.spec.ts:38-39`), `auth-onboarding.spec.ts:95-98` (cold start, unique e-mail per attempt — `:22-24`), `marketing-events.ts:88`           |
| B.1  | OTP challenge requested — no row                                           | STILL OPEN                                        | `libs/ecs-core/src/pipelines/request-otp.pipeline.ts:155` `ports.saveOtp(otp)` — a plain `Set` (`apps/functions/src/adapters/firestore-otps.adapter.ts:48-57`), no `CommitPlan`; `RequestOtpPorts` (`:62-69`) has no `CommitPorts` / `HashPorts`                                                                                                                              |
| B.2  | OTP verified / refused — no row                                            | STILL OPEN                                        | `verify-otp.pipeline.ts:110-116` `attemptWrites` (success = `consumedAtUtcMs` `Update`, wrong code = `attemptCount` `Update`, every other refusal = no write), tx1 `:127-152`; lock-out `systems/otp.system.ts:186`; `OtpSystem.attempt` `:203-218`                                                                                                                           |
| B.3  | registration completed                                                     | PARTLY DONE                                       | `complete-registration.pipeline.ts:230-241` plans the users `Set` + the `REGISTRATION` record, no row; the `users` document-change trigger already writes an anonymous `PROFILE_UPDATED` row (SYSTEM / `ADMIN_SDK`, field names) — the verified actor and operation id are missing                                                                                            |
| B.4  | the custom token issued                                                    | STILL OPEN                                        | `verify-otp.pipeline.ts:218-227` `mintCustomToken` (no commit after tx1 on the RETURNING path); `complete-registration.pipeline.ts:264-273`                                                                                                                                                                                                                                   |
| B.5  | an actor for an unauthenticated request                                    | PARTLY DONE                                       | `components/actor.data.ts:27-40` `SystemSource` (closed; `UNATTRIBUTED_UNAUTHENTICATED` means "a Firestore write whose auth context named nobody", `systems/audit.system.ts:645` `writerOf`); no sign-in source                                                                                                                                                               |
| B.6  | operation id on the sign-in callables                                      | PARTLY DONE                                       | `ports/callables.ts` `OPERATION_ID_FIELD` lists `'operationId'` for both; the web adapter mints it (RU-21); `apps/functions/src/wire/identity.wire.ts:89` `decodeRequestOtp` and `:150` `decodeVerifyOtp` ignore it (`:257` registration reads it)                                                                                                                            |
| B.7  | cooldown, channel, identifier and `IDENTITY_OTP_SEND_UNAVAILABLE` refusals | DECIDED: no row of their own (P3-L-2)             | cooldown `request-otp.pipeline.ts:120-132` (OR-9, commits nothing); send `:158-165` (RU-3 order: saved first; `LogEvent.OtpSendFailed`) — so a send refusal follows an ALREADY committed challenge and its `IDENTITY_OTP_REQUESTED` row (§7 item 5)                                                                                                                           |
| B.8  | a refusal of a blocked account at sign-in                                  | DONE — none exists (do not invent)                | `AccountLifecycle.isBlockedAt` has one reader (`systems/client-glance.system.ts:114`); `verify-otp` / `complete-registration` never read `accountStatus`                                                                                                                                                                                                                      |
| C.1  | `exportClientData` callable                                                | STILL OPEN                                        | `ports/callables.ts:29-50` (20 names, none); `apps/functions/src/main.ts:232` "47 exports"                                                                                                                                                                                                                                                                                    |
| C.2  | audit rows naming the person, read server-side                             | PARTLY DONE                                       | `ports/audit-read.port.ts` (`AuditReadPorts`, WS-7) has only the web adapter `libs/infrastructure/firestore/src/lib/audit.adapter.ts`; the five composites are declared (`firestore.indexes.json`, 24 composites)                                                                                                                                                             |
| C.3  | bundle, format version, order, size cap                                    | STILL OPEN                                        | no JSON export exists; `systems/canonical-json.system.ts:16-18` `CanonicalJsonSystem.of`; `systems/client-issue.system.ts:504` private `utf8Bytes`                                                                                                                                                                                                                            |
| C.4  | the `…_EXPORTED` row                                                       | STILL OPEN                                        | `components/audit-context.data.ts:47-91` (no privacy verb); spec regex `audit-context.data.spec.ts:59-61` `^(BOOKING\|LOYALTY\|OPS\|PROFILE\|GOVERNANCE\|GOVERNED)_`                                                                                                                                                                                                          |
| C.5  | admin entry on the staff client card                                       | STILL OPEN                                        | `libs/features/staff/client-card/src/lib/client-card/client-card.html:583-602` (only the K exits, `@if (overview().canRemove)`); record known only for an account (`client-card.store.ts:1701-1745`); download idiom `libs/features/client/appointments/src/lib/client-appointments/client-appointments.ts:865-901`                                                           |
| C.6  | feature flag                                                               | PARTLY DONE (exists, no consumer)                 | `components/feature-flags.data.ts:23` `ClientPrivacy: 'client.privacy'`, `:49` false; `config/feature-flags.json:13`, `:28`, `:43` all false; `docs/production-deploy.md` "privacy … ship dark"                                                                                                                                                                               |
| C.7  | admin-only                                                                 | PARTLY DONE (idiom)                               | `components/roles.data.ts:72` `ADMIN: [Admin, Sysadmin]`, `:81` `SPEND: [Admin]` ("not the sysadmin"), `:132` `isAdmin`, `:142` `seesClientSpend`                                                                                                                                                                                                                             |
| D.1  | the client record pseudonymized, stamped, tagged                           | STILL OPEN                                        | `entities/customer.entity.ts:37-58` (`displayName: string` required; no erasure field); guard `systems/stored-document.system.ts:184` `customerFault`; a refused document reads as ABSENT inside a transaction (`firestore-tx.adapter.ts` `admittedOrNull`) — the tombstone must pass the guard                                                                               |
| D.2  | a terminal account tag "the auth flow refuses"                             | STILL OPEN; premise false (P3-RU-17)              | `components/account-status.data.ts:8-14` (`ACTIVE`, `BLOCKED` only); no auth pipeline reads `accountStatus` (B.8)                                                                                                                                                                                                                                                             |
| D.3  | Firebase Auth user                                                         | STILL OPEN → DELETE (P3-L-9)                      | `apps/functions/src/adapters/auth-claims.adapter.ts` — mint, create, find, `updateUser(displayName)` only; no delete or disable anywhere                                                                                                                                                                                                                                      |
| D.4  | Storage objects                                                            | STILL OPEN                                        | `apps/functions/src/lib/firebase-admin.ts:1-23` (Firestore and Auth only); `storage.rules:41` `avatars/{userId}/{fileName}`, `:64` `appointmentPhotos/{appointmentId}/{photoId}`; `@google-cloud/storage` resolves from `firebase-admin` (its optional dependency, installed); the emulator's `FIREBASE_CONFIG` names `${projectId}.appspot.com`                              |
| D.5  | appointments' contact cleared, records kept                                | STILL OPEN                                        | `components/booking-contact.data.ts:21-27` (four nullable fields; `NONE`); walk-in seat `guestLabel` (`components/seat-occupant.data.ts:145`)                                                                                                                                                                                                                                 |
| D.6  | notes and photos                                                           | STILL OPEN                                        | `entities/appointment-note.entity.ts` (keyed by the VISIT); `entities/appointment-photo.entity.ts:25-42` (`clientCustomerId: CustomerId \| null`, `clientLabel`, `label`, `path`, `url`, `photoOrigin`); `components/photo-origin.data.ts:29` `ownsBytes`                                                                                                                     |
| D.7  | notifications, waitlist, invitations, journal                              | STILL OPEN; journal DONE by design                | `components/label-param.data.ts:1-6` (journal labels are "never a note or a name"); `entities/invitation.entity.ts` `inviterName`; `users/{uid}/notifications` ids only                                                                                                                                                                                                       |
| D.8  | audit rows kept, PII-free                                                  | DONE (R36 / T5, DEP-26)                           | `components/audit-context.data.ts` variants hold ids, tags, money, field NAMES                                                                                                                                                                                                                                                                                                |
| D.9  | the `…_ERASED` row                                                         | STILL OPEN                                        | as C.4                                                                                                                                                                                                                                                                                                                                                                        |
| D.10 | idempotent, resumable, paged                                               | STILL OPEN                                        | the tx adapter has NO operation-count guard (`firestore-tx.adapter.ts` `applyPlan`); the paged precedent is `run-backfill.pipeline.ts` (budget, `WorkBudgetSystem`, `systems/work-budget.system.ts`)                                                                                                                                                                          |
| D.11 | the guard every writer reads; no resurrection                              | STILL OPEN — live exposure                        | `systems/customer-record.system.ts:312` `walkInCreates` skips a stored record, so a later walk-in with the same contact silently re-seats the erased record (`CustomerId.forWalkIn` is deterministic under `WALKIN_ID_KEY`, OR-26); `book-appointment.pipeline.ts:549-561`, `edit-appointment.pipeline.ts:1071-1084`                                                          |
| D.12 | governed triggers carry field names only                                   | DONE (WS-3, DEP-26) → proof specs only            | `systems/governed-change.system.ts` (`namedFields`, `NOTE_KEYS` / `PHOTO_KEYS`); `audit.system.ts:676` `planProfileChange` (field names + role / status TAGS)                                                                                                                                                                                                                 |
| D.13 | admin action + ONE `ui-alert` with the cascade in counts                   | STILL OPEN                                        | `ui-alert` idiom `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.html:1572-1580`; counts precedent `admin-rhythm.html:942-951`                                                                                                                                                                                                                         |
| D.14 | owner flags (legal retention, Auth, undo window, step-up)                  | DECIDED as flags (§7)                             | research `client-details-design.md` §6.16.2, R47; Deferred #4                                                                                                                                                                                                                                                                                                                 |
| E.1  | CI is one job                                                              | STILL OPEN                                        | `.github/workflows/ci.yml:13-55` — format, `nx affected -t lint test build`, CSP static gate, `icons:check`, glyph check, `pnpm audit`, gitleaks; no timeouts, no concurrency, no Java                                                                                                                                                                                        |
| E.2  | a committed runbook-gates runner                                           | STILL OPEN                                        | runbook `firestore-runbook.md:293` "Paste §4.0 once per shell"; only the orchestrator's scratch extractor exists; every §4.x block ends `… gate: PASS \|\| … gate: FAIL` (`:585` and eight more), so a block's exit code is 0 on FAIL                                                                                                                                         |
| E.3  | static gate items in CI                                                    | STILL OPEN                                        | none of `sync:check`, layering, `seed-tools` typecheck, `lint-rules`, `lint:styles`, coverage, `verify:bundle`, functions build + deps, `typecheck` runs in CI (`ci.yml:34` is `lint test build`)                                                                                                                                                                             |
| E.4  | emulator journeys in CI                                                    | STILL OPEN                                        | `package.json:13-17`; JDK 21 mandatory (firebase-tools 15.34.1); jars in `~/.cache/firebase/emulators`                                                                                                                                                                                                                                                                        |
| E.5  | e2e on ubuntu vs macOS-only screenshots                                    | STILL OPEN (P3-RU-25)                             | 10 `toHaveScreenshot` tests in four describes (`account-dashboard-screenshots.spec.ts:34`, `appointments-screenshots.spec.ts:42`, `auth-onboarding-screenshots.spec.ts:22`, `landing-screenshots.spec.ts:55`); only `*-chromium-darwin.png` tracked; on Linux they write the actual and FAIL (baseline e2e: 53 passed, 10 failed — exactly those)                             |
| E.6  | the `verify:csp` Hosting smoke                                             | PARTLY DECIDED by OR-31 (CI runs the static gate) | `ci.yml:36-43`; OR-31 "CI runs the static gate. The FULL gate … gains `verify:csp`"; baseline `csp` 165 s, smoke 10 passed                                                                                                                                                                                                                                                    |
| E.7  | no secrets beyond `GITHUB_TOKEN`; never a deploy                           | DONE (kept)                                       | `ci.yml:53-55`                                                                                                                                                                                                                                                                                                                                                                |

### 0.2 Rulings (every law / brief conflict, every rename — the higher source applied)

Each row quotes both sides; the applied side is the higher one (brief §1
hierarchy). Names the brief proposes are proposals (Phase 0–2 brief §1
item 5): every rename is a row.

**WS-A — seed clock**

- **P3-RU-1 (A) the "deterministic default" lands where determinism is consumed.** Brief: _"one pinned, injectable seed instant (e.g. a `SEED_NOW_UTC_MS` / `--now` input with a deterministic default derived so that 'today' always has room before shop close)"_. The dev book is authored as a LIVE day: `tools/seed/fixtures/book.fixtures.ts:13` _"today's 10:00 cut, once its time passes, is his 24th"_, and `tools/seed/appointments.mjs:71-72` _"A settled visit on TODAY is settled only once its time has passed (owner, 2026-09-09 …)"_. A fixed time of day as the human `seed:dev` default would show every today-visit after it as an unclosed past visit for the rest of the day. Applied (P3-L-1): the instant is ONE injectable value with a deterministic default for every GATE consumer — `verify:p0` captures one instant and hands it to both runs; the e2e suite pins the BROWSER to the deterministic `suite day at 10:00 shop time` and the e2e global setup hands that instant to the catalogue seed; CI inherits both — while the human `pnpm run seed:dev` keeps the live clock unless `--now` / `SEED_NOW` is given. The owner may flip the human default to the anchored one (one constant, `SEED_DEFAULT` in `tools/seed/calendar.mjs`) — §7 item 2.
- **P3-RU-2 (A) the stats projection clock stays live.** Brief Problem: _"`nowUtcMs: () => Date.now()`"_ is listed with the seed's clock reads. Brief Intent: _"Server-side 'now' (functions under the emulator) cannot be faked"_. The seed's `projectClientStats` must answer what the functions' `dispatchClientProjections` trigger answers on the real clock for the same visits, and `verify:p0` (c) compares the seed's stats with a real-clock backfill (`verify-p0.mjs:13-17`): a pinned projection clock would make (c) flake. Kept live, with a comment saying why (`seed-dev-catalog.mjs:712`).
- **P3-RU-3 (A) rename.** Brief: _"`SEED_NOW_UTC_MS` / `--now`"_. Applied: `--now=<text>` (argv, first) and env `SEED_NOW` for the seed, env `E2E_NOW` for the e2e suite — one text grammar: epoch milliseconds (digits), or an ISO wall time ON THE SHOP'S CLOCK (`2026-10-27T23:40`), or an ISO with `Z` / an offset — parsed by the existing `ZonedTimeSystem.parseIsoIn` / `UtcEpochMs.of` (a gap time refuses `DST_GAP_INVALID_TIME`, a fall-back repeat takes the earlier offset — Law 7.3). A refused text throws (loud), never falls back. The `…_UTC_MS` suffix would forbid the shop-time form the late-time proof needs (_"the pinned instant set to 23:40 shop time"_).
- **P3-RU-4 (A) pass E's caution is superseded on purpose.** `flips/pass-e-leftovers.md:1515-1516`: _"pinning the page clock or seeding tomorrow's agenda changes what the journey proves"_. The owner's Phase 3 brief asks for exactly that (_"the specs that compare against the app's live clock pin the BROWSER clock where the app reads it (Playwright `page.clock`) — never weaken an assertion"_). The glance journey now proves "a visit ahead of the pinned 10:00 is upcoming" instead of "ahead of the real clock"; every assertion is unchanged (P3-DEP-4).
- **P3-RU-5 (A) e2e support stays typed by what exists.** `apps/web/e2e/**` is typechecked by no Nx target (HANDOFF; inventory A §4). The PURE half of the suite clock (`instantOfText`, `browserPinOf`) lives in the Node-free `shop-clock.ts`, which the web unit build compiles, and is spec'd in `apps/web/src/testing/e2e-suite-clock.spec.ts`; the env-reading half (`suite-clock.ts`) stays a few lines. No new Nx target (out of scope; §7 item 13).
- **P3-RU-34 (A) the late-shop-time proof runs at a late REAL hour.** Brief: _"Done when the known time-of-day flakes are gone by construction (prove it: run the affected specs at a pinned late shop time, e.g. with the pinned instant set to 23:40 shop time)"_. In this design the suite instant reaches the pinned specs only as its DAY (`browserPinOf(suiteDay())` = that day at 10:00; the catalogue is seeded at the same 10:00), and `E2E_NOW` must fall on the real shop day — so `E2E_NOW=<today>T23:40` and an unset `E2E_NOW` drive byte-identical e2e runs (inventory `a-seed-clock.md` §5.4 says as much). What remains time-of-day dependent in those journeys is what the brief says cannot be faked: the functions' clock (the triggers' stats and loyalty projections) and a run crossing the real midnight. Applied: the construction argument is the proof of "gone by construction"; the e2e half of §6.1 addition 2 runs WHILE the real shop clock is between 23:15 and 23:59 (the orchestrator schedules it — the window in which the glance failed before), with the suite instant resolved once (P3-L-1) so a crossing of midnight cannot split the run's day; the seed half keeps the pinned `SEED_NOW=<today>T23:40` (the seed DOES read the instant, `settledOnlyIfPast`). P3-DEP-5 waits for that late real run.

**WS-B — login / OTP audit rows**

- **P3-RU-6 (B) request-otp becomes a commit.** Brief: _"written as `WriteOp.create` INSIDE the commit plan of the pipeline that already commits (request-otp saves the OTP doc …)"_. request-otp does NOT commit today: `ports.saveOtp(otp)` is a plain `Set` (`request-otp.pipeline.ts:155`). Law 4 (_"the transaction is the sandwich"_) and WS-1's rule (rows land with the act or not at all): the challenge is saved through `ports.commit` — `WriteOp.set(otps/<id>, body)` (the same whole-body `Set`, its `purgeAt` stamped by the tx adapter, `firestore-tx.adapter.ts:315`) plus the row's `WriteOp.create` — and `OtpStorePorts.saveOtp` / `SaveOtp` lose their only caller and are deleted (Law 9: no dead port member; `grep -r saveOtp` lists the doubles, the adapter and two specs only). The RU-3 order (saved and cooldown-consumed before `sendOtp`) is unchanged.
- **P3-RU-7 (B) keys are state, not the operation id.** Brief: _"keyed deterministically (the OTP id, the attempt number, the operation id) so a replay plans no second row"_. The web mints a fresh transport id per call (`callable-client.adapter.ts` `withTransportId`), and these callables are unauthenticated: keying a row by a client id would let a caller mint unbounded rows and would never dedupe a retry. Applied: `otp-requested:<otpId>` (a fresh `nextId`), `otp-verified:<otpId>` (tx1 proves `consumedAtUtcMs === null`), `otp-refused:<otpId>:<attemptCount after>` (strictly increasing, read in the same tx), `session:<otpId>` (one consumption per OTP), `registration:<uid>` (planned only on the first completion). The operation id rides as `auditOperationId` only — a join key, never a dedupe key — and only on the rows of a caller who has proved the destination (`IDENTITY_SESSION_ISSUED`, `IDENTITY_REGISTRATION_COMPLETED`): the three pre-session rows (`_REQUESTED`, `_VERIFIED`, `_REFUSED`) carry `auditOperationId: null` (P3-L-20), because the transport id is a `[A-Za-z0-9_-]{16,64}` token any unauthenticated caller chooses (`ids.primitive.ts:236`) and `auditLog` is permanent (R36: no caller-chosen text in a row); their join to the outcome line stays through the line's own `operationId` and the `otps/<otpId>` resource.
- **P3-RU-8 (B) only refusals that change state get a row.** Brief: _"OTP refused (wrong code, expired, too many attempts / locked)"_ and _"Rate-limited / cooldown refusals that commit nothing either plan no row (preferred — nothing changed) or are logged as `LogEvent` lines only; the planner decides"_. A row needs a commit; an ALREADY_EXISTS on a `Create` aborts the WHOLE transaction and would replace tx1's verdict with a store failure (`firestore-tx.adapter.ts`), and WS-1 forbids reading audit ids inside it. A row for a state-less refusal could only be keyed by something a replay repeats. Applied (P3-L-2): the wrong code (an `attemptCount` increment) gets `IDENTITY_OTP_REFUSED` with `otpRefusalReason: WRONG_CODE`, and the wrong code whose increment reaches `maxAttempts` gets `otpRefusalReason: LOCKED_OUT`; expired, already consumed, not found, already locked, cooldown, channel, identifier and `IDENTITY_OTP_SEND_UNAVAILABLE` plan no row and add no log line — the existing `callable.refused` outcome line (WS-4.2: `callable`, `operationId`, `errorCode`, `wireStatus`, `inputDigest`) already records each, and the send refusal keeps its `LogEvent.OtpSendFailed`. The send refusal is not row-free in effect: the challenge and its `IDENTITY_OTP_REQUESTED` row commit BEFORE `sendOtp` (RU-3's order, unchanged), so a refused send leaves one REQUESTED row for a code never delivered — every production request while P8 stays FAIL. The row cannot tell a delivered challenge from an undelivered one; the `callable.refused` outcome line (`IDENTITY_OTP_SEND_UNAVAILABLE`) does. §7 item 5 lets the owner choose between accepting this and moving the row to its own commit after a successful send.
- **P3-RU-9 (B) the brief's verbs kept, one added.** Brief: _"`IDENTITY_OTP_REQUESTED`, `IDENTITY_OTP_VERIFIED`, `IDENTITY_OTP_REFUSED`, `IDENTITY_REGISTRATION_COMPLETED` — the planner names them lawfully"_ and _"the custom token issued"_. Kept verbatim; added `IDENTITY_SESSION_ISSUED` for the token (verifyOtp only — P3-L-3). The spec regex gains `IDENTITY` here (WS-C adds `PRIVACY`, P3-RU-15) — Law 7.5 asks only for a domain-prefixed SCREAMING verb; the regex is a spec, changed on purpose (P3-DEP-7).
- **P3-RU-10 (B) the unauthenticated actor.** Brief: _"the existing `Actor` variants first; a new variant only if none fits, with a type-spec"_. `Actor.system(source)` fits; its closed `SystemSource` gains `IdentityCallable: 'IDENTITY_CALLABLE'` ("a sign-in callable acting before any session exists"). Not `UNATTRIBUTED_UNAUTHENTICATED`: that value means "a Firestore write whose auth context named nobody" (`audit.system.ts:645` `writerOf`), and mixing the two would make the field lie. No new `Actor` variant. The registration row is credited to the VERIFIED caller: `Actor.forCaller(uid, read.stored.roles)` (the stored roles the transaction read — the command carries none).
- **P3-RU-11 (B) the verified row cannot name the account; the session row does.** Brief: _"the row names the account it resolves to (`targetUserId`) when one exists"_. tx1 (consume) runs BEFORE the destination lookup (`verify-otp.pipeline.ts:158-177`, order frozen by RU-3's reasoning and Law 4); so `IDENTITY_OTP_VERIFIED` / `_REFUSED` / `_REQUESTED` target `AuditTargetRef.none()` on the resource `otps/<otpId>`, and `IDENTITY_SESSION_ISSUED` (after the account is resolved) targets `AuditTargetRef.user(uid)` on `users/<uid>` — on WS-7's `pageAuditByTargetUser` timeline.
- **P3-RU-12 (B) the session row commits AFTER the mint, before the answer.** A row "token issued" committed before a failing mint would lie; committed after a mint and before the answer, it exists iff the token was answered (a `createCustomToken` is a local signature with no server state; a row commit failure answers the store failure and the token string is discarded). This adds one small `ports.commit` (no reads, one `Create`) per OTP sign-in — P3-DEP-7.

**WS-C / WS-D — export and erasure**

- **P3-RU-13 (C, D) "ADMIN-only" is the owner, not the sysadmin.** Brief: _"an ADMIN-only callable"_. `Roles.isAdmin` admits admin OR sysadmin (`roles.data.ts:132`), while `Roles.SPEND` (`:81`) documents the sysadmin as _"a support role with no business in a client's spend"_ and the research rows 38–39 say "admin only". Applied: a new callable-only list `Roles.PRIVACY = [Role.Admin]` with `Roles.handlesClientPrivacy(roles)` — one home for the server gate and the UI gate; it has no `firestore.rules` twin (the callables are the only door; `role.rules-parity.spec.ts` twins only the listed rules lists — its header gains one line naming `PRIVACY` as callable-only). The decoder gates on the token's claims BEFORE the payload is read (the `governance.wire.ts` `gate` idiom), and the pipelines RE-READ the caller's stored roles (`CallerRolesPorts.loadCallerRoles`, the `run-backfill.pipeline.ts` precedent) — an irreversible act trusts no stale claim. §7 item 7.
- **P3-RU-14 (C, D) the existing flag gates both.** Brief: silent. `FlagName.ClientPrivacy` (`'client.privacy'`, "Data export and erasure (P5)", `apps/functions/src/lib/flags.ts:46-49`) exists with no consumer and `docs/production-deploy.md` promises "privacy … ship dark". Applied: the card's block renders only with the flag on, and the three callables refuse `PRIVACY_UNAVAILABLE` (`failed-precondition`) with it off; `config/feature-flags.json` `development."client.privacy"` flips to `true` (dev and e2e exercise it); staging / production stay `false` (an irreversible destructive act never ships lit by a functions deploy alone). P3-DEP-12.
- **P3-RU-15 (C, D) verbs.** `PRIVACY_CLIENT_EXPORTED`, `PRIVACY_CLIENT_ERASURE_STARTED`, `PRIVACY_CLIENT_ERASED` (research R45 names the family `privacy.*`); the spec regex gains `PRIVACY` (P3-RU-9). Not `GOVERNANCE_*`: a privacy act is its own domain.
- **P3-RU-16 (C) the export answer is a canonical JSON string inside a typed call answer.** Brief: _"returns ONE JSON bundle"_. The callable wire (`CallableWire`, ports tier) may name entities but not systems, and the web would otherwise decode ~16 entity types it never reads (the initial bundle, `verify:bundle`). Applied: `ClientPrivacyCall.Exported = { clientExportVersion, exportedCustomerId, exportedAtUtcMs, exportDocumentCount, exportByteCount, exportJson }` — `exportJson` is `CanonicalJsonSystem.of(bundle)` (sorted keys, one canonicaliser), decided byte for byte on the server; the browser saves it verbatim. Zero mapping: the bundle's sections are the stored entities `{ id, ...body }`, except the two redactions of P3-RU-18.
- **P3-RU-17 (D) "a terminal tag the auth flow refuses" — built where the stored account is read.** Brief: _"`accountStatus` set to a terminal tag the auth flow refuses"_. No auth flow reads `accountStatus` today (§0.1 B.8). Applied: `AccountStatus.Erased: 'ERASED'` with the variant `AccountLifecycle.Erased { accountStatus; accountErasedAtUtcMs }` (Law 6.2 prefix); the auth flow cannot reach an erased account (its Auth user is deleted — P3-L-9 — and `users.phone` / `email` are cleared, so `findUserByDestination` finds nobody). Two of the three writers that read the stored account ALREADY refuse it at `20785b8`, with no new arm: `RegistrationSystem.adoptStub` refuses any `REGISTERED` stored account and a stub whose cleared contact fails `sameText` (`registration.system.ts:245-253` → `IDENTITY_OTP_ACCOUNT_CONFLICT`), and completeRegistration looks the holder up by destination BEFORE its transaction, so a cleared account is found by nobody (`complete-registration.pipeline.ts:180-187` → `IDENTITY_REGISTRATION_USER_NOT_FOUND`) — added spec cases pin both; only `ProfileEditSystem.decide` admits a `REGISTERED` erased account (`profile-edit.system.ts:158`) and gains the arm → `ACCOUNTS_UPDATE_PROFILE_NOT_FOUND`. `AccountLifecycle.isBlockedAt` answers `true` for `ERASED` (denied forever). No new copy for these.
- **P3-RU-18 (C) "nothing of another person" = no personal VALUE of another person.** Brief: _"returns ONE JSON bundle of every document holding the person's data"_; research §6.16.1: _"party companions are omitted. Staff appear by role only."_; R36 / T5 treat opaque ids as pseudonymous. Applied (P3-L-5): every document the person OWNS is exported as stored, except that no bearer capability is ever exported — a photo's `url`, and every voucher `code` (`giftVouchers[].code` and each visit's `voucherRedemptions[].code`, "what the receipt prints", `voucher-redemption.data.ts:23-35`; a party visit paid with Q's voucher would otherwise hand P Q's live code); a SHARED visit (a party) is exported with the other subjects' seat labels replaced by `PrivacyMarker.seatLabel(n)` and the visit contact set to `BookingContact.NONE` unless it is PROVABLY the person's (`ClientPrivacySystem.contactIsPersons` — owner record, owner account, or the visit contact's walk-in key derives the record, P3-L-12; the export never falls back to "sole-subject", so a sole-subject visit carrying a third person's contact is redacted too); party-visit notes are NOT exported (free text that may concern the companions — P3-RU-33); other people appear only as the opaque ids already on that shared document (seat / subject ids), staff as their uid on notes / photos / audit rows — never a name, contact value, label or free text of anybody else. Audit rows are exported when they TARGET the person (`targetCustomerId` = the record, `targetUserId` = the account), never rows where the person is only the actor (those target others), and never the `PRIVACY_CLIENT_EXPORTED` row the call itself plans (its id is known before the read; excluding it keeps a replay byte-identical). §7 item 9 asks counsel.
- **P3-RU-19 (D) "staff search shows «Изтрит клиент»" vs data minimisation.** Brief: _"a tag the rest of the system reads (e.g. staff search shows «Изтрит клиент» / "Erased client")"_; brief: _"strip names, contact values and free text"_. `searchName` / `searchPrefixes` are DERIVED from the name, phone and e-mail (`SearchFieldsSystem`) — personal values the brief's own rule clears; with them cleared, no search term reaches the record. Applied: the tag is `erasureStatus` on the record (and `accountStatus: ERASED` on the account); the client card words it «Изтрит клиент» / "Erased client" where the record is reached by id. Search shows nothing for an erased person (§7 item 10).
- **P3-RU-20 (D) "never resurrected": REFUSED, not a new record.** Brief: _"a booking by the same contact creates a NEW record or is refused — decide which, lawfully"_ (task) and _"never resurrected by a later write (the walk-in id is a keyed hash of the contact — erasure must not let the same contact map back to it)"_ (brief). A NEW record needs a different deterministic id for the same contact (a generation scheme) and a dependent second read round inside the booking and edit transactions, plus a merge policy the owner deferred (Deferred #2). Applied (P3-L-8): `bookAppointment` and `editAppointment` refuse `BOOKING_CLIENT_ERASED` when any record they would seat or create — an account's `forUser` record, a walk-in's `forWalkIn` record — is under erasure (`ERASING` or `ERASED`), read in the phase-one `getAll` they already run (no extra read, Law 4; the book reads both kinds in `set.customers`, `book-appointment.pipeline.ts:550-559`; the edit reads added accounts' records in `loaded.placement.customers`, `edit-appointment.pipeline.ts:969-972`, and added walk-ins' in `loaded.set.customers`, `:1080` — the guard reads each id in the map that holds it). The desk books the person as an anonymous guest (label only). Seats that already reference the record (carried back by an edit, cancelled, moved, tipped) are untouched: those writers write no personal value (`appointment-lifecycle.system.ts:238-241` carries `contact*` from the in-tx read).
- **P3-RU-21 (D) the stamp commit pseudonymizes too.** Brief: _"large fan-outs are paged across commits with the record's erasure stamp written first (a guard every writer reads) and the completion stamp last"_. Applied (names: the brief's `…ErasedAtUtcMs` stamp is `erasedAtUtcMs`, with `erasureStartedAtUtcMs` beside it, variant-only fields of the `erasureStatus` slice — Law 6.2): the FIRST commit sets the record `ERASING` (+ `erasureStartedAtUtcMs`) AND clears its personal values, sets the account `ERASED` and clears its personal values, and creates the `PRIVACY_CLIENT_ERASURE_STARTED` row — atomically, so the guard and the stripping land together. The OTP challenges are deleted by destination BEFORE that commit (their destination values are the contact the commit clears). The completion stamp (`ERASED` + `erasedAtUtcMs` + the `PRIVACY_CLIENT_ERASED` row) is the LAST commit, planned only when a fresh residue census is zero.
- **P3-RU-22 (D) "counts of what was erased — never values" as a census.** Brief: _"an erasure row is written (`…_ERASED`, actor the admin, target the record, counts of what was erased — never values)"_. A resumed erasure spans calls, so per-call counts would undercount. Applied: ONE pure census (`ClientErasureSystem.census`) over the person's footprint; the STARTED row carries the census BEFORE (what will be erased), the ERASED row the census AFTER (the residue, every personal count 0, plus what was retained: visits, party contacts not provably the person's, journal rows), and a `PRIVACY_CLIENT_ERASURE_RESWEPT` row the census BEFORE a sweep of residue found after completion (P3-L-19). Stateless and recomputable on any resume; the ERASED row is a self-check.
- **P3-RU-23 (D) the marker is language-neutral.** Brief: _"cleared or replaced by a fixed pseudonym marker"_. Copy in stored data would bypass i18n (`angular-ui.md`: formatting in presenters), and the label prints raw on the day grid. Applied: `PrivacyMarker.TEXT = '—'` (an em dash) where a non-null string is required (`customers.displayName`, `invitations.inviterName`, `impersonationSessions.reason`); a walk-in seat's label `PrivacyMarker.seatLabel(n)` = `'— <n>'` (n = the seat's 1-based ordinal among the visit's marked seats, through `SeatLabel`'s own smart constructor — the cast stays in its file, Law 7.4; unique per visit, so `walkInsByLabel` never matches two seats); nullable fields become `null`. Screens word the TAG, never the marker.
- **P3-RU-24 (D) "notifications, waitlist requests, invitations and journal entries deleted or pseudonymized per the research's T5 rule".** Applied: notifications and waitlist requests DELETED (ids only, but they exist only for the account); invitations: `inviterName` → `PrivacyMarker.TEXT`, the document kept (referral counts); the journal untouched (ids and codes only, `label-param.data.ts:1-6` — "pseudonymises journal entries" is the identity in this tree; the STARTED / ERASED rows count the retained rows); `impersonationSessions` targeting the account: `reason` → `PrivacyMarker.TEXT` (admin free text about the person; the WS-3 start / end rows are kept).
- **P3-RU-25 (D) "prove no erased value reaches a row or a log line".** Brief: _"The governed triggers (WS-3) will fire on these writes: their rows must carry field NAMES only (they do)"_. DONE by construction (D.12); built here: the proof specs of §4 (`erase-client.integration.spec.ts` case 3 runs the document-change pipeline over every erased document's before / after images and scans every row and every captured log line for the person's sentinel values; `verify:p0` (g) does the same with the live triggers).
- **P3-RU-26 (C, D) the functions read the person's footprint through named bundles, reusing what exists.** Law 9: `LoyaltyAccountReadPorts` (`engagement.port.ts:257`), `ClientStatsLoadPorts` (`scheduling.port.ts:432`), `AuditTimelinePorts` (WS-7 — the five timelines only; the export never uses `auditRowsForOperation`, so the server adapter builds no `AuditOperationPorts`) and the port TYPE `LoadProfile` (`accounts.port.ts:59-61`, the identical `(userId) => User | null` read, as a member of the new bundle — never a copied `LoadAccountById`) are reused; Admin-SDK adapters implement them in `apps/functions` (an adapter serving several returns their intersection); the rest is one new focused bundle `ClientFootprintPorts` (`ports/privacy.port.ts`). The card's `ListClientPhotos` is NOT reused: its contract is `photoOrigin == SHOT`, `orderBy takenAtUtcMs desc`, at most `limit` (`notes-photos.port.ts:43-53`, index #22), so a `LIBRARY` photo naming the person on a party visit would be neither exported nor erased; the footprint reads `ListPhotosOfClient` (every origin, `clientCustomerId ==` only, no `orderBy`, the automatic single-field index). Every list port takes a `limit` (the reads stop at cap + 1 — P3-L-6, P3-L-21). Reads of `appointments`, `customers` and `appointmentNotes` take `guardOf` and `log` with no defaults (OR-33, runbook §4.10). The journal is listed by `customerId ==` WITHOUT `orderBy` (its only composite carries `journalVisibility` and `journalEffect`; an `orderBy('seq')` would be emulator-green, production-dead) and ordered by the system.
- **P3-RU-27 (C) reuse the UTF-8 counter.** `client-issue.system.ts:504` `utf8Bytes` is private. Applied: it moves to `CanonicalJsonSystem.utf8Bytes(text)` and `ClientIssueSystem` calls it (behaviour-neutral; its specs unchanged). Never a second copy.
- **P3-RU-28 (D) Storage in the functions is no new dependency.** Hard limit: _"no new package in any `package.json`"_. `firebase-admin/storage` is a subpath of the existing `firebase-admin` (its optional `@google-cloud/storage` is installed and resolves); `tools/verify/p0/functions-deps.baseline.json` stays four keys (verified by `check-functions-deps.mjs` at the stage gate).
- **P3-RU-33 (C, D) party-visit notes: erased with the person, withheld from the export.** Brief (WS-D): _"`appointmentNotes` (free text about the person) deleted"_; owner: _"strip names, contact values and free text from the person's documents"_; brief (WS-C): the bundle holds _"appointment notes"_. Against: a party visit's note may concern the companions, and `AppointmentNote.text` cannot be line-redacted (non-blank, `stored-document.system.ts:204` `appointmentNoteFault`). The plan's first draft kept party notes from the latitude register, below the brief's design — not lawful in this hierarchy. Applied (P3-L-11): EVERY visit's note of the person's visits is deleted (sole-subject and party alike — the brief's text; no law forbids it); the export carries sole-subject visits' notes only (a party note may hold another person's free text — P3-RU-18 outranks "every document" for other people's values). §7 item 20: the companions lose the shared visit's note; the research's alternative (an admin redaction surface, `client-details-design.md` §6.16.2) is follow-up.
- **P3-RU-36 (C, D) the person's contact on a visit is decided by the walk-in key, not by ownership alone.** Brief: _"the `BookingContact` slice (contact name / phone / e-mail / note) cleared"_ for the person's appointments. A staff booking with no account client sets the visit contact to the FIRST walk-in of the draft (`staff-edit-plan.system.ts:767-787`, `contactPerson = owner ?? draft.clients[0]`), and that walk-in's record id is `CustomerId.forWalkIn(walkInKey(contact), walkInHash)` (`customer-record.system.ts:171-205`, `ids.primitive.ts:342-362`) — so a walk-in W plus a companion is a party visit with no owner whose contact IS W's. Ownership and sole-subject alone would keep W's name and phone and still certify the erasure complete. Applied (P3-L-12): `contactIsPersons` gains the keyed-hash arm `CustomerId.forWalkIn(contactKeyOf(visit), walkInHash) === record.id` — value-free about the record and resumable (the visit carries its own contact until it is cleared); the three privacy pipelines take `WalkInKeyPorts`, and their `onCall`s bind `WALK_IN_SECRETS` (`main.ts:381-389`, which already holds the log digest key) in place of `LOG_DIGEST_SECRETS` — the walk-in key's doc comment ("the two callables that mint walk-in records") becomes "and the three admin privacy callables that recognise them". The same keys give the walk-in records SHARING the person's phone / e-mail (the preview's siblings, P3-L-7).

**Owner delegation (2026-10-27)**

- **P3-RU-37 the owner delegated the open calls.** Owner, mid-build: _"pick decisions as a FAANG grade decision maker and proceed with recommended stuff"_. Applied — every §7 flag that asked for a choice takes the plan's recommendation, and two gaps found at C_C are closed the safer way:
  (a) **Auth user DELETED**, not disabled (P3-L-9); (b) **immediate erasure** behind the read-only preview and ONE `ui-alert` — no undo window, no step-up (P3-L-13; R47 needs App Check, still deferred); (c) visits, money, stats, loyalty and audit rows **retained** (the owner's own answer of 2026-10-27); (d) identity rows on every challenge, a refused send included (§7 item 5: accepted as built); (e) the human `seed:dev` default stays the live clock (P3-RU-1); (f) CI keeps the config's two e2e retries (P3-RU-35); (g) `errors.PRIVACY_FORBIDDEN` keeps OR-50's one forbidden line (§7 item 1); (h) **the D29 link is checked by every privacy callable** — the export, the preview and the erasure refuse `PRIVACY_ACCOUNT_LINK_MISMATCH` (renamed from the erasure-only `PRIVACY_ERASURE_LINK_MISMATCH`; `failed-precondition`) when `record.userId` is set and `record.id !== CustomerId.forUser(record.userId, hash)`, BEFORE any read keyed by the uid — a corrupt link never exports or erases another account (`ClientPrivacySystem.linkOf`, one home, PD2a; the export pipeline gains the arm in PD2b; its integration case in PD3); (i) **the export drops `purgeAt`** — a TTL stamp the tx adapter adds to `notifications` / `waitlistRequests` bodies, part of no entity (Law 5: the bundle is the entity); the functions adapter omits it (PD3). Everything the owner must still do by hand stays in §7 (deploy steps, legal review of retention, lighting `client.privacy`).

**WS-E — CI**

- **P3-RU-29 (E) the runner is `.mjs`, behind an Nx target.** Brief: _"move the extraction into a committed script, e.g. `tools/verify/runbook-gates/run-gates.sh`, used by CI and by people — never a second copy of the gates"_. CLAUDE.md §5: _"run through Nx, never the raw tool"_. Applied: `tools/verify/runbook-gates/run-gates.mjs` (Node builtins only, the `check-layering.mjs` idiom, spec'd with `node:test`) behind `pnpm nx run verify-tools:runbook-gates` (`cache: false`); it READS the runbook's blocks at run time — the gates' only copy stays the runbook.
- **P3-RU-30 (E) the screenshot gate is the owner's macOS run.** Brief: _"the screenshot baselines are macOS-only … the planner decides how CI handles them WITHOUT weakening a test (e.g. a tag + `--grep-invert` in CI only, with the owner's macOS run documented as the screenshot gate)"_. Applied (P3-L-14): the four screenshot describes gain `{ tag: '@screenshot' }` (assertions, names and baselines unchanged); `apps/web/playwright.config.mts` sets `grepInvert: /@screenshot/` ONLY when `CREATIVO_E2E_SCREENSHOTS=skip` (a closed switch, never a free regex), which only the CI `e2e` job sets; locally and on the owner's macOS full gate every screenshot test runs against its `-darwin.png`. `--update-snapshots`, `--ignore-snapshots` and `updateSnapshots: 'none'` are refused by a spec.
- **P3-RU-31 (E) CI also runs the Hosting smoke.** OR-31: _"CI runs the static gate. The FULL gate (HANDOFF §4) gains `verify:csp`."_; `ci.yml:41` comment _"The emulator smoke … is the full gate's, not CI's"_. Adding a parallel `csp-smoke` job supplements OR-31 (the static gate stays in `main`) — measured 165 s at the baseline. The comment and `docs/production-deploy.md`'s CI sentence are reworded (P3-DEP-24). §7 item 16.
- **P3-RU-32 (E) "the rest of the §9 gate" includes typecheck.** Brief: _"CI runs the rest of the brief's §9 gate that can run on GitHub's ubuntu runners"_; the §9 gate runs `run-many -t typecheck`, which CI never runs (`ci.yml:34`). Applied: `typecheck` joins the existing `nx affected -t lint test build` targets in `main` (CI keeps its affected practice; the run-many form stays the local gate).
- **P3-RU-35 (E) CI's e2e keeps the config's own CI policy (orchestrator ruling, 2026-10-27 — supersedes the reviser's draft).** Brief: CI runs the gate _"WITHOUT weakening a test"_. Config: `apps/web/playwright.config.mts:38-43` _"NO retries locally (CI keeps the preset's two): a flake is a bug to find, not a pass to retry"_ — an owner-authored decision (commit `9512f6d`, the owner rulings) that CI keeps the preset's `retries: 2` and `workers: 1`. The draft (`retries: 0` everywhere, two CI workers) would overturn a decided config line; the frozen-behaviour policy keeps it, and no test is weakened by this pass (the policy predates it). Applied (P3-L-15): the CI `e2e` job runs the config as it stands; a test that passes on a retry is reported `flaky` in the run and its trace is kept (`trace: 'retain-on-failure-and-retries'`, uploaded with the report artifact on failure); the job's timeout is sized on one worker. P3-DEP-27 is WITHDRAWN. §7 item 22 asks the owner whether CI should drop the retries.

### 0.3 The latitude register (P3-L-1 … P3-L-23, copied into the PR's owner flags)

| L       | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Reason                                                                                                                                                                                                                                                                                                                                                                   | Law                                                                        |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| P3-L-1  | **The seed instant.** One parse (`--now` / `SEED_NOW` / `E2E_NOW`, P3-RU-3). Human `seed:dev` default: the live clock. `verify:p0`: ONE instant captured before (a), handed to both runs (`SEED_NOW` wins when set). e2e: the suite instant S resolved ONCE, in global setup (`E2E_NOW`, else the live clock; `E2E_NOW` must fall on the real shop day — the loud refusal runs there and only there) and exported to every worker as `process.env.E2E_NOW` (workers inherit it and never re-check, so a worker started after midnight keeps the run's day); its shop day D = `suiteDay()`; the BROWSER of a pinned spec pinned at `D 10:00` shop time (`BROWSER_PIN_MINUTE = 600`); the catalogue seed run with `--now=<D 10:00>`; today's seeded visits start at the fixed `EVENING_VISIT_START = 21:00`; the unpinned, callable-driven specs keep the LIVE `shopToday()` of `shop-clock.ts` unchanged (they compare against the live browser and the live server)                                                                                                                                                                                                                                                                                | 10:00 is inside every open day's hours (Mon–Sat open by 10:00; `catalog.fixtures.ts:190-197`) and 11 h before the 21:00 seed, whose 30-minute visit ends 21:30 < 24:00 — "room before shop close" for any S; the human dev day stays live (P3-RU-1); callable-driven specs keep live clocks on both sides (the server's cannot be pinned) and only shift days ≥ tomorrow | Law 7.3 (one instant at the boundary; zone math only in `ZonedTimeSystem`) |
| P3-L-2  | **Identity rows only on a state change** (P3-RU-8): REQUESTED (the challenge saved), VERIFIED (consumed), REFUSED (an attempt recorded; `LOCKED_OUT` when it exhausts the challenge), SESSION_ISSUED, REGISTRATION_COMPLETED (first completion). Expired / consumed / not-found / already-locked / cooldown / channel / identifier → no row, no new log line; `SEND_UNAVAILABLE` adds no row of its own, but follows the committed challenge's REQUESTED row (RU-3 order — §7 item 5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | a row is a `Create` in a commit; a state-less refusal has no state to key on, and an ALREADY_EXISTS aborts tx1's verdict; the outcome line already records them                                                                                                                                                                                                          | Law 4; WS-1's replay rule                                                  |
| P3-L-3  | **The token row** `IDENTITY_SESSION_ISSUED` in its own one-`Create` commit after the mint (verifyOtp only); completeRegistration's token is covered by its `IDENTITY_REGISTRATION_COMPLETED` row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | verifyOtp's RETURNING path has no commit after tx1; a row before the mint could lie (P3-RU-12); a registration re-run re-mints with no state change                                                                                                                                                                                                                      | Law 4                                                                      |
| P3-L-4  | **Identity row index policy**: tags (`otpDestinationType`, `otpPurpose`, `otpRefusalReason`, `sessionKind`, `registrationIdentifierChannel`) keep their single-field index; `otpExpiresAtUtcMs`, `otpAttemptCount`, `otpMaxAttempts` get `indexes: []`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | the WS-2 / WS-3 precedent (tags indexed, scalars never queried switched off)                                                                                                                                                                                                                                                                                             | Law 5 (index hygiene)                                                      |
| P3-L-5  | **Export scope and redaction** (P3-RU-18): the person = the requested record + its linked account; sections listed in §0.4 "export?"; shared visits redacted (other seats' labels → marker, a contact not provably the person's → `NONE`); bearer capabilities never exported — `appointmentPhotos.url`, `giftVouchers[].code`, `voucherRedemptions[].code` (the named slices `ExportedPhoto`, `ExportedGiftVoucher`, `ExportedVoucherRedemption`); party-visit notes withheld (P3-RU-33); `otps` and `impersonationSessions` omitted (security artefacts, TTL'd; the session start / end rows are exported); the avatar image not exported (bytes; no document names it); the call's own `PRIVACY_CLIENT_EXPORTED` row excluded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Art. 15 needs the person's data, not other people's values or bearer capabilities                                                                                                                                                                                                                                                                                        | Law 3 (a pure system decides what is whose); R36 / T5                      |
| P3-L-6  | **Export cap**: refuse `PRIVACY_EXPORT_TOO_LARGE` past `EXPORT_MAX_DOCUMENTS = 20_000` documents (audit rows included) or `EXPORT_MAX_BYTES = 4_194_304` UTF-8 bytes of the canonical JSON — never truncate; the reads stop at cap + 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 4 MiB is far below the platform's callable response size (UNVERIFIED in this container; recalled as 32 MiB) and the browser's comfort; a larger person goes through a runbook export (§7 item 8)                                                                                                                                                                         | Law 7.5 (a refusal is a value)                                             |
| P3-L-7  | **The erased person** = the requested record R + its linked account U (`R.userId`); walk-in records sharing R's or U's phone / e-mail ("siblings": `CustomerId.forWalkIn` of each of R.phone, R.email, U.phone, U.email, through `WalkInKeyPorts`, R excluded, the existing ones read) are NOT merged into R's erasure — the PREVIEW names them (`erasureSiblingCustomerIds`, ids only, admin-only answer; derivable only while the contact values exist, i.e. before the stamp), the alert words their count, and the card offers each as its own act (preview → ONE alert → erase), with its own operation id; R's ERASED row never claims a sibling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | erasing a shared-phone record would erase another person (OR-26: two people sharing a phone share a walk-in record); the admin erases each record from its own card                                                                                                                                                                                                      | Law 2 (`CustomerId` and `UserId` distinct; links explicit)                 |
| P3-L-8  | **Resurrection refused** (P3-RU-20): `BOOKING_CLIENT_ERASED` on book / edit for a seated or created record under erasure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | no extra read; no generation scheme; the desk still serves the person as an anonymous guest                                                                                                                                                                                                                                                                              | Law 4 (decide on the read set); Law 7.5                                    |
| P3-L-9  | **Auth user DELETED**, not disabled; `auth/user-not-found` counts as done; only a uid the record PROVABLY links (`record.id === CustomerId.forUser(record.userId, hash)`, the D29 invariant every `userId`-carrying record is created under, `customer-record.system.ts:141-147`) — otherwise the uid-keyed steps are skipped and the call refuses `PRIVACY_ACCOUNT_LINK_MISMATCH`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | deletion frees the phone / e-mail (a later sign-in is a NEW uid and a NEW `forUser` record — nothing resurrects) and kills refresh tokens; disabling keeps the identifier in Auth (not erasure) and turns every later sign-in into `IDENTITY_OTP_ACCOUNT_CONFLICT`                                                                                                       | GDPR Art. 17 (owner flag §7 item 4)                                        |
| P3-L-10 | **Storage**: `avatars/<uid>/` deleted by prefix on EVERY call of a linked person (idempotent — it also takes an upload made inside the ≤ 1 h ID-token window after the Auth delete); a `SHOT` photo's object deleted BEFORE its document; a `LIBRARY` photo's object kept (shop library), its document deleted; the person's photos read through `ListPhotosOfClient` (every origin) plus `ListVisitPhotos` (null-client photos of sole-subject visits)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `PhotoOrigin.ownsBytes` (`photo-origin.data.ts:29`); object-first keeps the path for a resume; the object's custom metadata holds `clientLabel` (a name)                                                                                                                                                                                                                 | Law 4 (idempotent impure steps between commits)                            |
| P3-L-11 | **Notes and photos** (P3-RU-33): the note of EVERY visit of the person is deleted (sole-subject and party); the export carries sole-subject visits' notes only; photos with `clientCustomerId = R` (any origin), or with `clientCustomerId: null` on a sole-subject visit, are deleted; others kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | the brief's text ("free text about the person deleted") outranks latitude; `AppointmentNote.text` cannot be line-redacted (non-blank, `stored-document.system.ts:204` `appointmentNoteFault`), so a party note goes whole; exporting it could hand P a companion's free text                                                                                             | Law 3                                                                      |
| P3-L-12 | **Whose contact** (P3-RU-36): `contactIsPersons(visit, person, walkInHash)` iff `ownerCustomerId = R`, or `ownerUserId = U`, or `CustomerId.forWalkIn(contactKeyOf(visit), walkInHash) = R` (`contactKeyOf` = the visit's `contactPhone ?? contactEmail`, the `walkInKey` rule), or — **P3-DEP-28, review round 1** — the visit's `contactPhone` / `contactEmail` equals one of P's contact values (`contactCarriesValueOf`; the first three arms are `contactProvedById`), the erasure clearing a contact only that arm recognises BEFORE its stamp (`contactSweepWrites`) so every arm left after the stamp is value-free — **amended by P3-DEP-34 (review round 2):** the sweep clears EVERY contact carrying one of P's values before the stamp, whatever the visit's seats or ids prove (a desk `REMOVE_SEAT` after the stamp would otherwise leave it unfindable), its clears accounted for by the act's `PRIVACY_CLIENT_ERASURE_SWEPT` row (P3-DEP-33); the EXPORT shows a contact only then; the ERASURE clears it then OR when the visit is sole-subject (erasure errs to clearing, export to withholding); any other contact is kept and counted (`erasureContactKeptCount`: party visits whose contact derives no record of the person) | value-free about the record and resumable (the visit's own contact stays until it is cleared; the record's values are gone after the stamp); a staff walk-in party with no account seats the FIRST walk-in's contact (`staff-edit-plan.system.ts:767-787`), which the keyed-hash arm recognises                                                                          | Law 3                                                                      |
| P3-L-13 | **Immediate erasure**, no undo window, no step-up, no blocker for future visits — the alert does not single out future visits (the census counts all retained visits; §7 item 6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | the brief allows immediate and flags the window; step-up (R47) needs App Check (Deferred #4); a blocker needs the per-visit shop clock (OR-8) and a product call                                                                                                                                                                                                         | Law 7.3 (no elapsed-time rule added to T2)                                 |
| P3-L-14 | **CI screenshots**: tag + `CREATIVO_E2E_SCREENSHOTS=skip` in the CI `e2e` job only (P3-RU-30)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | no test weakened; macOS full gate is the screenshot gate                                                                                                                                                                                                                                                                                                                 | brief §1 "never weaken a test"                                             |
| P3-L-15 | **CI shape**: `main` (unchanged + `typecheck` in affected), `static`, `runbook-gates`, `coverage` (`--testTimeout=30000`, a CLI flag, as the baseline needed), `emulators` (`test:emulator` then `verify:p0`), `e2e` (the config's own CI policy: the preset's two retries and one worker — P3-RU-35), `csp-smoke`; new jobs on `ubuntu-24.04`, JDK 21 (Temurin), the jar and browser caches keyed on the lockfile; the late-shop-time proof (§6.1 addition 2) is the orchestrator's, not CI's — it needs a run inside 23:15–23:59 shop time (P3-RU-34), which a push-triggered job cannot choose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | parallel jobs, the gate's commands verbatim, cold and honest (no Nx cache restore — a stale cache once hid a typecheck error, brief §7)                                                                                                                                                                                                                                  | CLAUDE.md §5                                                               |
| P3-L-16 | **Admin only** (`Roles.PRIVACY = [admin]`, P3-RU-13); **flag-gated** (`client.privacy`, P3-RU-14); **a staff account is refused** (`PRIVACY_ERASURE_STAFF_ACCOUNT` when U holds any staff role in its STORED account OR in its Auth custom claims — `AuthRolesPorts.loadAuthRoles`, read whenever the record is linked; the admin erasing themself included) — **amended by P3-DEP-29 (review round 1):** no production path sets Auth custom claims (roles ride the custom token minted from the stored `users.roles`, Phase 4a 4A-14), so the claims arm never fires on a real account; the FAIL-CLOSED arm is a missing `users` document while U's Auth user exists, refused too — so a missing `users` document never lets an operator's Auth account be deleted                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | an irreversible act stays with the owner; erasing a staff account would remove an operator (and there is no `setRoles`)                                                                                                                                                                                                                                                  | Law 3                                                                      |
| P3-L-17 | **A read-only `previewClientErasure` callable** (the census and the siblings' ids, no row; it refuses as the erasure would — staff account, link mismatch, too large) feeds the ONE `ui-alert`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | the card holds paged history and photos only; the cascade in counts is a server census (Law 10.2: the numbers are a system's answer)                                                                                                                                                                                                                                     | Law 10.2                                                                   |
| P3-L-18 | **`erasureStatus` is required on every customer body** (strict guard): every writer (`createsFor`, `walkInCreates`, the dev seed, the e2e seed) writes `NONE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | greenfield (CLAUDE.md §0); an absent-admitted key would let the type lie, and a refused tombstone would read as ABSENT in a transaction and be re-created                                                                                                                                                                                                                | Law 1 (no optional property); Law 5                                        |
| P3-L-19 | **An ERASED record is re-swept, never short-circuited**: a call on an `ERASED` record re-runs the footprint, the units, the avatar prefix and the (idempotent) Auth delete; when its BEFORE census holds a personal count above 0 it commits, after the units, one `PRIVACY_CLIENT_ERASURE_RESWEPT` row (the census swept; key `erasure-resweep:<operationId>`, planned only when a probe read finds it absent — the export row's idiom); with nothing to sweep it writes nothing (a second call stays a no-op)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | every booking of an erased record is refused (P3-RU-20), so a note or photo written after completion is about an OLD visit of the person (any `worksTheBook()` staff may write one, `firestore.rules:357-390`); a short-circuit would leave it forever under a false ERASED certificate                                                                                  | Law 4; R36                                                                 |
| P3-L-20 | **Pre-session identity rows carry no operation id** (`auditOperationId: null` on `_REQUESTED`, `_VERIFIED`, `_REFUSED`; P3-RU-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | the transport id is caller-chosen text on an unauthenticated path and `auditLog` is permanent; the session and registration rows keep it (the caller has proved the destination)                                                                                                                                                                                         | R36 / T5; Law 7.5                                                          |
| P3-L-21 | **Erasure caps**: every footprint list read stops at `ERASURE_MAX_DOCUMENTS + 1` (`ERASURE_MAX_DOCUMENTS = 5_000` per list); past it the preview and the erasure refuse `PRIVACY_ERASURE_TOO_LARGE` (`{ errorCode, erasureListedCount }`) before any write — never a silent truncation; each call chunks only the visits whose `visitWrites` is non-empty on the outside read (re-validated in the transaction), so every call makes progress                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | a stateless call re-listing a capped list could stamp `ERASED` with residue past the cap, and re-chunking clean visits could spend every 49 s budget; 5 000 visits is decades of a barbershop client                                                                                                                                                                     | Law 7.5; Law 4                                                             |
| P3-L-22 | **The erased account's names are the marker** (`firstName` / `lastName` → `PrivacyMarker.TEXT`, as `displayName`), not `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `AccountContact` documents names as `null` only while provisioned and `OwnerProfileFields` says a REGISTERED owner's names are never `null` (`user.entity.ts:44-47`, `:70`): every existing reader stays correct with no doc amendment; the census treats a marker as no personal value (`PrivacyMarker.isMarker`)                                                       | Law 2 (invariants by structure)                                            |
| P3-L-23 | **The card's privacy rows carry icons** from glyphs already generated: `client.export` → `receipt_long`, `client.erase` → `delete` (`libs/ui/icons/src/lib/manifest/icon-vocabulary.ts`; no `icons:glyphs` network run)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | the K exits row has a leading `ui-icon` (`client-card.html:594-596`); CI's `main` job runs `icons:check`                                                                                                                                                                                                                                                                 | design-system grammar                                                      |

### 0.4 The person data map (the export and the erasure, one table)

The person P = the requested record R (`customers/{customerId}`) and its
linked account U (`users/{R.userId}`, when not `null`). "Visits" = the
appointments with `R ∈ subjectCustomerIds` (every seat of P is a subject;
`ownerUserId = U` implies a SELF seat of R) — **amended by P3-DEP-28
(review round 1):** a staff edit's `REMOVE_SEAT` may take the booker's own
seat and keep the visit's `BookingContact`, so the export and the erasure
(the erasure while R is `NONE`) also read the visits whose `contactPhone` /
`contactEmail` equals one of P's contact values (R's and U's phone and
e-mail); of such a visit only its contact is P's. "Sole-subject" = every seat's
subject is R. Fields in **bold** are personal values (names, contact
values, labels, free text). Census field = the `ClientErasureSystem.census`
count the STARTED / ERASED rows carry.

| Collection (registry)                                                                                                                                                                                                                                                                                                                                                               | Personal fields                                                                                                                                    | Link fields to P                                                                                 | Export?                                              | Erasure action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Census field                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `customers/{R}`                                                                                                                                                                                                                                                                                                                                                                     | **`displayName`, `phone`, `email`**, `searchName`, `searchPrefixes` (derived)                                                                      | `id`, `userId`                                                                                   | yes, as stored                                       | STAMP commit: `displayName: '—'`, `phone`/`email: null`, search keys `SearchFieldsSystem.searchFields(null…)`, `ERASING` + `erasureStartedAtUtcMs`; LAST commit `ERASED` + `erasedAtUtcMs`; `writeOperationId` set to the erasure's operation id on every write (WS-4.3's join key: the triggers it fans out to name the erasure). Kept: id, `userId`, `createdAtUtcMs`, `customerOrigin`                                                                                                                | `erasureRecordCount` (1 while personal)                                                               |
| `users/{U}`                                                                                                                                                                                                                                                                                                                                                                         | **`firstName`, `lastName`, `phone`, `email`, `birthDate`**, `searchName`, `searchPrefixes`                                                         | id                                                                                               | yes, as stored                                       | STAMP commit: names → `PrivacyMarker.TEXT` (P3-L-22), contact / birth date `null`, search keys cleared, `accountStatus: ERASED` + `accountErasedAtUtcMs` (`WriteOp.transition`); `roles` stays `[]` (a staff account is refused)                                                                                                                                                                                                                                                                         | `erasureAccountCount` (0/1 while personal)                                                            |
| Firebase Auth user U                                                                                                                                                                                                                                                                                                                                                                | **phone, e-mail, display name**                                                                                                                    | uid                                                                                              | no (not a document)                                  | `deleteAuthUser(U)` (not-found = done)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | — (the ERASED row needs this call's delete ok)                                                        |
| `users/{U}/notifications`                                                                                                                                                                                                                                                                                                                                                           | none (ids, topics, shop copy)                                                                                                                      | path uid                                                                                         | yes                                                  | deleted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `erasureDocumentCount`                                                                                |
| `appointments` (visits)                                                                                                                                                                                                                                                                                                                                                             | **`contactName`, `contactPhone`, `contactEmail`, `contactNote`**; WALK_IN seat **`guestLabel`**                                                    | `subjectCustomerIds`, `ownerCustomerId`, `ownerUserId`, seat `subjectCustomerId`/`subjectUserId` | yes; a shared visit redacted (P3-RU-18)              | contact → `BookingContact.NONE` when P's or the visit is sole-subject (P3-L-12, the keyed-hash arm included); R's WALK_IN seats' label → `PrivacyMarker.seatLabel(n)`; a contact only P's values recognise (a visit no longer seating R, or one whose ids do not prove it) cleared BEFORE the stamp (P3-DEP-28) — since P3-DEP-34 every contact carrying P's values, seated or not, with the act's SWEPT row (P3-DEP-33); `writeOperationId` → the erasure's id; ids, times, money, statuses, seats kept | `erasureContactCount`, `erasureLabelCount`, `erasureContactKeptCount`, `erasureVisitCount` (retained) |
| `appointmentNotes/{visitId}`                                                                                                                                                                                                                                                                                                                                                        | **`text`**                                                                                                                                         | id = the visit (no customer key)                                                                 | sole-subject visits' notes only (P3-RU-33)           | every visit's note deleted, party visits' included (P3-RU-33, P3-L-11)                                                                                                                                                                                                                                                                                                                                                                                                                                   | `erasureNoteCount`                                                                                    |
| `appointmentPhotos`                                                                                                                                                                                                                                                                                                                                                                 | **`clientLabel`, `label`**; the Storage object (and its metadata `clientLabel`)                                                                    | `clientCustomerId`, `appointmentId`                                                              | yes, metadata + `path`, never `url`                  | P's photos (any origin, `ListPhotosOfClient`) deleted (object first if `SHOT` — only the photo's own `appointmentPhotos/{visit}/{photo}` object, P3-DEP-30; a `LIBRARY` object's `clientLabel` metadata cleared first, P3-DEP-31)                                                                                                                                                                                                                                                                        | `erasurePhotoCount`                                                                                   |
| Storage `avatars/{U}/…`                                                                                                                                                                                                                                                                                                                                                             | **the image**                                                                                                                                      | path uid                                                                                         | no (bytes; no document names it — §7 item 9)         | prefix deleted on every call (P3-L-10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | — (as Auth)                                                                                           |
| Storage `appointmentPhotos/{visit}/{photo}`                                                                                                                                                                                                                                                                                                                                         | **the image**, metadata `clientLabel`                                                                                                              | path                                                                                             | no (bytes; the document's `path` is exported)        | deleted with its `SHOT` document (its own path only, P3-DEP-30); a kept `LIBRARY` object loses its metadata `clientLabel` (P3-DEP-31)                                                                                                                                                                                                                                                                                                                                                                    | (with `erasurePhotoCount`)                                                                            |
| `waitlistRequests`                                                                                                                                                                                                                                                                                                                                                                  | none                                                                                                                                               | `ownerUserId = U`                                                                                | yes                                                  | deleted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `erasureDocumentCount`                                                                                |
| `invitations`                                                                                                                                                                                                                                                                                                                                                                       | **`inviterName`**                                                                                                                                  | `inviterUserId = U`                                                                              | yes                                                  | `inviterName → '—'`; document kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `erasurePseudonymCount`                                                                               |
| `invitations/*/redemptions/{U}`                                                                                                                                                                                                                                                                                                                                                     | none                                                                                                                                               | doc id = the referee's uid                                                                       | no (unqueryable without the parent path)             | kept (ids and a stamp; §7 item 11)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                                                                                                     |
| `impersonationSessions`                                                                                                                                                                                                                                                                                                                                                             | **`reason`** (admin free text about P)                                                                                                             | `targetUserId = U`                                                                               | no (P3-L-5; its start / end audit rows are exported) | `reason → '—'`; kept (TTL 30 d)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `erasurePseudonymCount`                                                                               |
| `otps`                                                                                                                                                                                                                                                                                                                                                                              | **`destination`** (P's phone / e-mail), `codeHash`, `salt`                                                                                         | `destination`                                                                                    | no (security artefact, TTL ≤ 1 day past expiry)      | deleted by destination BEFORE the stamp (P3-RU-21); a challenge stored under another spelling (the TRIMMED RAW text, F2-10 — `request-otp.pipeline.ts:142`) or requested between the sweep and the stamp escapes it until its TTL (§7 item 3)                                                                                                                                                                                                                                                            | — (not recomputable after the stamp)                                                                  |
| `couponGrants`                                                                                                                                                                                                                                                                                                                                                                      | none                                                                                                                                               | `customerId = R`, `holderUserId = U`                                                             | yes                                                  | kept (money)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —                                                                                                     |
| `giftVouchers`                                                                                                                                                                                                                                                                                                                                                                      | none (`code` is a bearer secret, not a name)                                                                                                       | `issuedToCustomerId = R`, `holderUserId = U`                                                     | yes, without `code` (P3-L-5)                         | kept (money)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —                                                                                                     |
| `loyaltyAccounts/{R}` + `badgeProgress`, `seasonProgress`                                                                                                                                                                                                                                                                                                                           | none                                                                                                                                               | id = R                                                                                           | yes                                                  | kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                     |
| `clientStats/{R}` + `restricted/money`                                                                                                                                                                                                                                                                                                                                              | none                                                                                                                                               | id = R                                                                                           | yes (admin may read spend — `Roles.SPEND`)           | kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                     |
| `clientJournal`                                                                                                                                                                                                                                                                                                                                                                     | none (codes and ids, `label-param.data.ts:1-6`)                                                                                                    | `customerId = R`, actor ids                                                                      | yes (client- and staff-visible rows)                 | kept (T5 pseudonymous)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `erasureJournalCount` (retained)                                                                      |
| `auditLog`                                                                                                                                                                                                                                                                                                                                                                          | none (R36 / T5)                                                                                                                                    | `targetCustomerId = R`, `targetUserId = U`                                                       | yes, rows TARGETING P (P3-RU-18)                     | kept; + STARTED and ERASED rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | —                                                                                                     |
| `triggerFailures`                                                                                                                                                                                                                                                                                                                                                                   | none (`documentPath` may hold an id)                                                                                                               | path                                                                                             | no (ops)                                             | kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                     |
| Logs (Cloud Logging, the 400-day bucket)                                                                                                                                                                                                                                                                                                                                            | none by R36 / T5                                                                                                                                   | uids, ids                                                                                        | no                                                   | kept; PITR (7 d) and backups (28 d) hold pre-erasure values until they age out (§7 item 3)                                                                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                     |
| every other registry name (`barberBusy`, `capacity`, `scheduleExceptions`, `barberSchedules`, `barberLeadTimeSamples`, `services`, `serviceCategories`, `barbers`, `locations`, `coupons`, `streakDefinitions` + `versions`, `badgeCategories`, `badgeSeries`, `seasons`, `tierDefinitions`, `rewardsCatalog`, `positions`, `courses`, `events`, `settings`) and Storage `media/**` | none (catalogue, schedule and shop data; the inventory `cd-person-data-map.md` §1.4 recipe over `collections.ts:24-116` and `storage.rules:54-58`) | none                                                                                             | no                                                   | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                     |
| `backfillJobs`                                                                                                                                                                                                                                                                                                                                                                      | none (opaque `CustomerId`s only: `sampleMismatched`, `backfill-job.entity.ts:31`; `cursor`, `policy-recompute-job.entity.ts:50`)                   | a `CustomerId` in a list or cursor                                                               | no (ops)                                             | kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                     |

Queries (all equality / `array-contains` on one root field, served by the
automatic single-field index; none is switched off by a `fieldOverrides`
entry — §6.2 checks it; every list takes `limit(cap + 1)` — the export's
`EXPORT_MAX_DOCUMENTS`, the erasure's `ERASURE_MAX_DOCUMENTS`): `appointments where subjectCustomerIds
array-contains R`; `appointments where contactPhone == <value>` and
`where contactEmail == <value>` for each of P's contact values, merged by
id (`ListVisitsByContact`, P3-DEP-28; the erasure's only while R is
`NONE`); `appointmentNotes`
`getAll` by visit ids; `appointmentPhotos where clientCustomerId == R` (every origin, no `orderBy` — `ListPhotosOfClient`, never the card's SHOT-only `ListClientPhotos`) and
`where appointmentId in [≤ 30 ids]` for sole-subject visits;
`couponGrants where customerId == R`; `giftVouchers where
issuedToCustomerId == R`; `clientJournal where customerId == R` (no
`orderBy`); `waitlistRequests where ownerUserId == U`;
`invitations where inviterUserId == U`; `impersonationSessions where
targetUserId == U`; `otps where destination == <value>`;
`users/{U}/notifications` listed; `auditLog` through `AuditTimelinePorts`'
`pageAuditByTargetCustomer(R)` and `pageAuditByTargetUser(U)` (the WS-7
composites). No new composite index.

### 0.5 Orchestrator notes

- **Environment** (brief §3, no repository change): Node 22.22.3 (`.nvmrc`); JDK 21; firebase-tools 15.34.1 from the lockfile; Playwright 1.61.1 with chromium-1228; gitleaks 8.24.3. Emulator journeys run with the proxy variables unset (`env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u GLOBAL_AGENT_HTTPS_PROXY …`). ecs-core coverage with `--testTimeout=30000`. The repo holds only `*-chromium-darwin.png` screenshot baselines; the orchestrator keeps LOCAL Linux references of the branch point (never committed; `.git/info/exclude`).
- **The baseline** ran in `/home/user/baseline3` (read here through `/home/user/gate-p3-baseline/*.log`); §6.3's first column is filled from those logs where they print a number — the orchestrator confirms each.
- **Stage order** A → B → C → D → E, one commit each; `git fetch origin` and a merge of `origin/main` (never a rebase) before each stage; shared files (`apps/functions/src/main.ts`, `firestore.rules`, `firestore.indexes.json`, `docs/architecture/HANDOFF.md`, the runbook, `docs/production-deploy.md`, `package.json`) keep both sides' intent.
- **HANDOFF, the plan's ledger and the PR body** are the orchestrator's (integrator) at each stage; no package edits HANDOFF.
- **The late-shop-time proof** (WS-A done-criterion; orchestrator amendment 2026-10-27): C_A is committed after its stage gate, so the next stage is not held for an evening; the e2e half of §6.1 addition 2 then runs on the COMMITTED C_A tree, in the orchestrator's own worktree (`/home/user/baseline3`, checked out at the C_A sha, so the builds of the next stage cannot touch it), with its START between 23:15 and 23:30 shop time (Europe/Sofia) — the orchestrator schedules itself a wake-up for that window (`send_later`). The result is recorded in §8, and P3-DEP-5's HANDOFF record lands in the first commit after it passes. A failure for a reason inside the app is a stop condition before the next commit (the fix lands as its own commit and the run repeats the next evening); two missed windows are a stop condition.
- **The pin flows, it does not freeze** (orchestrator, C_A gate, 2026-10-27): the first build pinned with `page.clock.setFixedTime`, which freezes `Date.now()`; the C_A `e2e:web` run and a solo `--repeat-each=3` run each lost ONE glance barber case to data that never arrived (an agenda row after 30 s; the card's name after 5 s — the Firestore channel's long-poll watchdog measures elapsed time with `Date.now()`, so a stalled request is never timed out under a frozen clock). `pinBrowserClock` now uses `page.clock.setSystemTime` — the page starts at the suite day's 10:00 and its clock RUNS (Playwright 1.61's controller replays the log and resumes real-time sync; `playwright-core` `_replayLogOnce` / `_innerResume`), timers unchanged. A test of minutes stays hours short of the 21:00 visit; every assertion is unchanged.
- **Not verifiable in this container** (flagged): the platform's callable response size (P3-L-6); the GitHub runner image's default Java (setup-java pins 21 regardless); runner size (public 4 vCPU vs private 2 vCPU — the job timeouts carry slack); whether `orderBy(documentId())` would need a composite (avoided: no query here orders).

### 0.6 Critique disposition (2026-10-27, the three plan critiques)

Each gap was re-checked against the code at `20785b8` (file:line in the
line) and the brief before it was applied. C = completeness, F = fidelity,
L = laws / PII. Where two critiques raised one gap, the line names both.

- C1 / F2 / L2 APPLIED — `ListClientPhotos` is SHOT-only, ordered, limit-bound (`notes-photos.port.ts:43-53`): new `ListPhotosOfClient` (every origin), P3-RU-26, PC3 / PD3 fixtures gain a LIBRARY photo on the party visit.
- C2 / L4 APPLIED — party notes now follow the brief (deleted) by ruling P3-RU-33 with both quotes; export withholds them; §7 item 20 (the `notesKept` figure is moot: nothing is kept).
- C3 / F19 APPLIED — §2.A.1 per-spec table (2030 seeds, `auth-onboarding` cold start, booking-core midnight, the unnamed specs), §0.1 A.10, §7 item 21; §6.1 addition 2 says why only the pinned specs run late.
- C4 / F15 APPLIED — `seedUserProfile` `roles` override (PC5), PD5 owns `seed-firestore.ts` (sequential after PD3b) with a run-unique person; admin stored roles seeded in both journeys.
- C5 / F1 / L1 APPLIED — `staff-edit-plan.system.ts:767-787` confirmed: keyed-hash arm in `contactIsPersons` (P3-RU-36, P3-L-12), `WalkInKeyPorts` + `WALK_IN_SECRETS` on the three callables, export withholds non-provable contacts (the reverse leak), fixtures added.
- C6 / F5 APPLIED — the instant is resolved once in global setup and exported as `E2E_NOW`; the day check runs there only; unpinned specs keep the live `shopToday()` (PA2 drops five files).
- C7 APPLIED — §0.4 closing rows: every other registry name and Storage `media/**`, `backfillJobs` (opaque `CustomerId`s, `backfill-job.entity.ts:31`).
- C8 APPLIED — the avatar is not exported, stated in P3-L-5, §0.4 and §7 item 9 (no new read port).
- C9 APPLIED — Storage soft delete and mid-erasure / other-spelling OTPs in §7 item 3, PD5's runbook §2.5 and `production-deploy.md` backups bullet.
- C10 APPLIED — §2.D writer table; `startImpersonation` is NOT refused (OR-24 out of scope, the pipeline reads no target) — re-swept and flagged §7 item 23.
- C11 APPLIED — PD3 owns the three `firestore.rules` comments and the `visit-media-writers.integration.spec.ts:57` comment (no rule change).
- C12 APPLIED — the rule reads "within a WAVE"; sequential co-owners listed and marked in each package.
- C13 / F16 APPLIED — the §6.2 grep excludes `seed-dev-catalog.mjs` (comment `:533`) and `customer.entity.ts` (the type); PD3b's check says the same.
- C14 APPLIED — PD5: §1.1 reader AND writer rows, a "Data-subject requests" item; §8 adds `HANDOFF.md:2692-2693`.
- C15 APPLIED — icons decided (P3-L-23: `receipt_long`, `delete`, both in `material-glyphs.generated.ts`); PC4 / PD4 own `icon-vocabulary.ts` + its spec, `icons:check` in their checks.
- C16 APPLIED — P3-L-13 reworded (no future-visit count, §7 item 6); the alert body gains the accounts figure and the account sentence.
- C17 APPLIED — `settle.mjs:138` counts `auditLog`: P3-DEP-7 records it, measured at C_B (§8).
- C18 APPLIED — P3-L-15: the late proof is the orchestrator's (it needs a chosen late hour).
- F3 APPLIED — the call's own row (`ownRowId`, known before the read) is excluded from the bundle; PC2 / PC3 (3)–(4) rephrased (same-id byte equality under a pinned clock).
- F4 APPLIED — verified (`E2E_NOW`'s time of day reaches no value): P3-RU-34, the e2e half runs at a REAL 23:15–23:30 start; P3-DEP-5 waits for it; §0.5 schedules it.
- F6 APPLIED, then SUPERSEDED by the orchestrator — `playwright.config.mts:43` `retries: 2` under CI and the preset's `workers: 1` confirmed; the config's comment records them as the owner's decision, so CI keeps them (P3-RU-35 as amended; P3-DEP-27 withdrawn; §7 item 22).
- F7 APPLIED — the REQUESTED row commits before `sendOtp`: P3-RU-8, P3-L-2, §0.1 B.7, §7 item 5 say so and offer the alternative.
- F8 APPLIED — `registration.system.ts:245-253` and `complete-registration.pipeline.ts:180-187` already refuse: PD2b drops both production files (spec cases pin them), P3-RU-17 / P3-DEP-14 keep only `updateProfile`.
- F9 / L13b APPLIED — `LoadProfile` (`accounts.port.ts:59-61`) is the member type; `LoadAccountById` removed.
- F10 APPLIED — every footprint list port takes `limit` (the reads stop at cap + 1).
- F11 APPLIED — erasure lists capped (`ERASURE_MAX_DOCUMENTS`, `PRIVACY_ERASURE_TOO_LARGE`, P3-L-21) and only dirty visits chunked.
- F12 APPLIED — the edit guard reads accounts in `loaded.placement.customers` (`:969-972`) and walk-ins in `loaded.set.customers` (`:1080`).
- F13 APPLIED — pinned specs never mark a notification read (`firestore.rules:251-254`); `pinBrowserClock`'s doc names both rules.
- F14 / L12 APPLIED (part rejected) — the residual and the TTL backstop are stated (§0.4, step 3, §7 item 3) and the adapter failure names `otps` only; storing the canonical destination is REJECTED: F2-10 (`flip-2-identity.md:58`) froze the trimmed raw value, and changing it moves the OR-9 cooldown (a DEP outside the brief).
- F17 APPLIED — `deleteFiles` resolves `void` (`bucket.d.ts:702`): list with `getFiles({ prefix })`, delete each, count the list.
- F18 APPLIED — `ci-workflow.spec.mjs` exempts local `./` actions.
- L3 APPLIED — an ERASED record is re-swept (P3-L-19, `PRIVACY_CLIENT_ERASURE_RESWEPT`, probe-read op key); §7 item 12 rewritten; PD2b / PD3 (4b) cases.
- L5 APPLIED (part rejected) — the preview names sibling walk-in records, the alert counts them and the card erases each as its own act (P3-L-7, §7 item 11); an "open" per sibling is REJECTED: no card route resolves a walk-in record in Phase 3 (§0.1 C.5).
- L6 APPLIED — no voucher `code` is exported, own or foreign (`ExportedGiftVoucher`, `ExportedVoucherRedemption`), §7 item 9.
- L7 APPLIED — every erasure write sets `writeOperationId` to the erasure's id; `WriteProvenance`'s doc widened (PD2a); PD3 (3) asserts the governed rows' join.
- L8 APPLIED — `linkOf` (`record.id === forUser(userId)`, `PRIVACY_ACCOUNT_LINK_MISMATCH`) and the Auth-claims staff check (`AuthRolesPorts.loadAuthRoles`); PD3 case (6). Review round 1 (P3-DEP-29): production sets no custom claims, so the refusal fails closed on a missing `users` document while the Auth user exists.
- L9 APPLIED — `ClientPrivacySystem.erasureOffer` → `ErasureOffer` tag; the presenter only words it.
- L10 APPLIED — the store captures ONE `ClientPrivacyCall` at preview and sends it verbatim; a change of person clears it.
- L11 APPLIED — `verify:p0` (g) sends `customerIdOf('dev-client-9')`, asserts the outcome and scans `triggerFailures` too.
- L13a / L13c APPLIED — `idBasisOf` takes `CustomerId | UserId | null`; the export depends on `AuditTimelinePorts` and the server adapter builds only that bundle.
- L14 APPLIED — the three pre-session identity rows carry `auditOperationId: null` (P3-L-20, P3-RU-7).
- L15 APPLIED — the erased account's names are `PrivacyMarker.TEXT` (P3-L-22), keeping `user.entity.ts:44-47`'s invariant.
- L16 APPLIED (part rejected) — the avatar prefix is deleted on every call and the token window is in P3-DEP-14 / §7 item 23; the `storage.rules` guard is REJECTED for this phase (a `firestore.get()` per upload and a rules change with its own spec, beyond the brief) and flagged.
- L17 APPLIED — `request-otp.integration.spec.ts` pins the moved `purgeAt` (PB3).

---

## 1. Inventory (file:line on `20785b8`)

| #   | Item                               | Sites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Package                 |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | seed instant (A)                   | `tools/seed-dev-catalog.mjs:123-125` (argv flags), `:282-285` (`buildClientBook(Date.now())`), `:712` (stats clock), header; `tools/seed/calendar.mjs:42-80` (`createShopCalendar`); `tools/seed/fixtures.mjs:212-213` (`buildClientBook(nowMs)`, the bundle's `book` namespace — `tools/seed/load-domain.mjs` `SEED_PLAN_MODULES.book`); `tools/seed/appointments.mjs:71-100`; `tools/seed/seed-data.spec.mjs:80-88`, `:210-236`; `tools/seed/fixtures/README.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | PA1                     |
| 2   | `verify:p0` (a) (A)                | `tools/verify/p0/verify-p0.mjs:9-11` (header), `:306-323` (`runSeed`), `:497-528` ((a)); `tools/verify/p0/README.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | PA1                     |
| 3   | e2e clock (A)                      | `apps/web/e2e/support/shop-clock.ts:1-87`; `support/global-setup.ts:43-53`; `client-card-glance.spec.ts:31`, `:126-199` (`seedGeorgi`, `seedMartin`), `:361-370`, `:707-716`; `appointments.spec.ts:9-16`, `:100-140`; UNCHANGED (they keep the live `shopToday()`): `booking-core.spec.ts:15`, `csp/csp-smoke.spec.ts:18`, `staff-walk-in.spec.ts:9`, `programs.spec.ts:5`, `support/booking-days.ts:2`; `apps/web/src/testing/e2e-appointment-seed.spec.ts:19` (imports `SHOP_ZONE`, unchanged)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | PA2                     |
| 4   | identity pipelines (B)             | `libs/ecs-core/src/pipelines/request-otp.pipeline.ts:62-168`; `verify-otp.pipeline.ts:67-228`; `complete-registration.pipeline.ts:81-274`; `ports/identity.port.ts:55` (`SaveOtp`), `:197-200` (`OtpStorePorts`), `:249-258` (`IdentityPorts`); `testing/port-doubles.ts:841-913` (the memory identity world, `saveOtp` `:913`); `entities/otp.entity.ts:12`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | PB2                     |
| 5   | audit model (B, C, D)              | `components/audit-context.data.ts:47-91` (verbs), `:122-136` (union), companion factories, namespace; `audit-context.data.spec.ts:55-110` (regex, partition); `components/actor.data.ts:27-40`; `primitives/ids.primitive.ts:531-577` (`AuditResourceId`, restated collection names); `systems/audit.system.ts:232` (`ROW_BASIS_TAG` v2), `:263` (`rowBasis`, private), `:375` (`createsOf`), `:482-562` (`changeKey`), `:775-865`; `entities/identity-entities.type-spec.ts:280-340` (per-verb narrowing)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | PB1, PC1, PD2a          |
| 6   | OTP system (B)                     | `systems/otp.system.ts:93-104` (`OtpAttempt`), `:174-218` (`verify`, `attempt`); `components/otp-purpose.data.ts`, `otp-destination-type.data.ts`, `session-kind.data.ts`; `primitives/identifier-channel.data.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | PB1                     |
| 7   | identity wire / adapters (B)       | `apps/functions/src/wire/identity.wire.ts:89-105` (`decodeRequestOtp`), `:150-172` (`decodeVerifyOtp`), `:257`; `adapters/firestore-otps.adapter.ts:28-57`; `adapters/firestore-ports.spec.ts:81`, `:111`; `adapters/firestore-ttl.adapter.ts:12`; `integration/verify-otp.integration.spec.ts`, `complete-registration.integration.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | PB3                     |
| 8   | callable registry (C, D)           | `ports/callables.ts:29-50` (`Callables`), `:59-150` (`CallableWire`), `OPERATION_ID_FIELD`, `CALLABLE_ANSWER_DECODERS`; `callables.spec.ts:11-40`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | PC1, PD2a               |
| 9   | errors / edge (C, D)               | `libs/ecs-core/src/errors/index.ts`; `errors/booking.error.ts`; `apps/functions/src/edge.ts:96` (`EDGE_DICTIONARIES`), `:124` (`EdgeCode`), `:358` (`RUN_BACKFILL_WIRE` idiom), `:681` (`EDGE_WIRE`); `edge.spec.ts:361-385` (totality over the dictionaries on disk)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | PC1/PC3, PD2a/PD3       |
| 10  | roles / flags (C)                  | `components/roles.data.ts:59-142`; `components/feature-flags.data.ts:23`, `:49`; `apps/functions/src/lib/flags.ts:46-73`; `config/feature-flags.json:13`; `ports/flags.port.ts:13`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | PC1, PC4                |
| 11  | reused read ports (C, D)           | `ports/engagement.port.ts:257-261` (`LoyaltyAccountReadPorts`), `:125-140`; `ports/scheduling.port.ts:198-205`, `:432-436` (`ClientStatsLoadPorts`), `:263-265` (`Callable`); `ports/notes-photos.port.ts:43-53` (`ListClientPhotos` — SHOT-only, NOT reused, P3-RU-26); `ports/audit-read.port.ts:82` (`AuditTimelinePorts`); `ports/accounts.port.ts:59-61` (`LoadProfile`, reused as a member type), `:92-93` (`CallerRolesPorts`); `ports/tx.port.ts:180` (`WalkInKeyPorts`); web `libs/infrastructure/firestore/src/lib/audit.adapter.ts:59-111` (the paging shape to mirror)                                                                                                                                                                                                                                                                                                                                                                                                              | PC1, PC3                |
| 12  | canonical JSON / bytes (C)         | `systems/canonical-json.system.ts:16-18`; `systems/client-issue.system.ts:504-523` (`utf8Bytes`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | PC2                     |
| 13  | functions root (C, D)              | `apps/functions/src/main.ts:232` (header "47 exports"), `:261-264` (`primitives`), `:333-347` (`identityPorts`), `:381-389` (`WALK_IN_SECRETS`), `:406-420` (`walkInPorts`, `root`), `:422-489` (`Wiring`, `wiredCallable`, `plain`), `:500` (`LARGE_MEMORY`), `:1012-1031` (`runBackfill` — the budgeted template), `:1066-1090` (`startImpersonation` — the admin template); `main.spec.ts:249-318` (`ENDPOINTS`), `:981`, `:1018-1027`; `lib/firebase-admin.ts:1-23`; `adapters/firestore-ports.ts:60-140`; `adapters/auth-claims.adapter.ts:33-107`                                                                                                                                                                                                                                                                                                                                                                                                                                         | PC3, PD3                |
| 14  | customer / account model (D)       | `entities/customer.entity.ts:37-58`; `components/account-status.data.ts:8-104`; `entities/user.entity.ts`; `systems/stored-document.system.ts:184-196` (`customerFault`), `:409-424` (`guardOf`); `systems/customer-record.system.ts:131-170` (`createsFor`), `:185`, `:213`, `:260`, `:301-335` (`walkInCreates`, `:312` skip); `systems/client-glance.system.ts:109-120`; `systems/registration.system.ts:234-262` (`adoptStub` — already refuses a `REGISTERED` or cleared account, spec only); `systems/profile-edit.system.ts:153-195` (`:158` admits a `REGISTERED` account — the arm); `systems/staff-edit-plan.system.ts:767-787` (the visit contact = the first walk-in when no account); `components/write-provenance.data.ts:4-13`; `components/voucher-redemption.data.ts:23-35`; `entities/gift-voucher.entity.ts:16`                                                                                                                                                              | PD1, PD2b               |
| 15  | customer literals (D)              | 29 files, 39 `customerOrigin:` sites (`grep -rln customerOrigin libs apps tools`): ecs-core (`customer-origin.data.spec.ts`, `identity-dictionaries.type-spec.ts`, `book-appointment` / `complete-registration` / `edit-appointment` `.pipeline.spec.ts`, `customer-record.system.spec.ts`, `stored-document.system.spec.ts`, `testing/identity.fixtures(.spec).ts`, `testing/port-doubles.spec.ts`); outside (`apps/functions/src/integration/{audit-in-commit,book-appointment,complete-registration,coupon-grant-burn,edit-appointment}.integration.spec.ts`, `apps/web/e2e/support/seed-firestore.ts`, `libs/features/staff/client-card/src/testing/client-card.fixtures.ts`, `libs/features/staff/dashboard/src/lib/visit-editor/{client-search,staff-visit-editor}.spec.ts`, `libs/infrastructure/firestore/src/lib/{customers.adapter,firestore.rules.integration}.spec.ts`, `tools/seed-dev-catalog.mjs`, `tools/seed/fixtures/customers.fixtures.ts`, `tools/seed/seed-data.spec.mjs`) | PD1, PD3b               |
| 16  | booking writers (D)                | `pipelines/book-appointment.pipeline.ts:304-306` (`walkInGuests`), `:437-561` (`decideBooking`); `pipelines/edit-appointment.pipeline.ts:626-637` (`addedWalkIns`), `:1060-1086`; `errors/booking.error.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | PD2b                    |
| 17  | client card (C, D)                 | `libs/features/staff/client-card/src/lib/client-card.store.ts:347-470` (injects), `:402-412` (flags), `:428-433` (`customerId`), `:1701-1745`; `client-card/client-card.html:583-602`; `client-card/client-card.ts:150`; `client-card.words.ts:987-988`, `:1623-1624`; `client-pages.vm.ts:640-655`; `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.ts:4465-4484` (`ui-alert` actions idiom); `libs/infrastructure/firebase-app/src/lib/ports.tokens.ts:145-207`; `otp-challenge.adapter.ts:46-80` (gateway adapter idiom); `apps/web/src/app/app.config.ts:335-351`                                                                                                                                                                                                                                                                                                                                                                                                    | PC4, PD4                |
| 18  | words (C, D)                       | `libs/infrastructure/i18n/src/assets/i18n/{bg,en}.json` (`clientCard`, `errors`); `libs/infrastructure/i18n/src/lib/word-pipeline-error.spec.ts:1-18` (OR-55 rules), `:268` (`INVALID_INPUT_CODES`), `:363` (`E18_WORDS`); `catalogue-parity.spec.ts:37-44` (banned phrases in `clientCard.`), `:85-160`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | PC4, PD4                |
| 19  | indexes (B, C, D)                  | `firestore.indexes.json` (24 composites; 101 field overrides, 40 on `auditLog`); `tools/verify/indexes/audit-indexes.spec.mjs:34-70`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | PB3, PC3, PD3           |
| 20  | runbook / deploy docs (B, C, D, E) | `docs/architecture/firestore-runbook.md` §1.1 matrix (`:9-121`), §2.5 retention (`:192-215`), §3 deploy order (`:216-288`), §4 intro (`:289-293`); `docs/production-deploy.md` (`:698` "47 functions", the flag-map item, the CI sentence `:576-578`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | PB3, PC5, PD5, PE1, PE2 |
| 21  | CI (E)                             | `.github/workflows/ci.yml:1-55`; `package.json:9-20`; `tools/verify/project.json:15-43`; `apps/web/playwright.config.mts:35-101`; the four screenshot describes (§0.1 E.5); `node_modules/firebase-tools/lib/emulator/downloadableEmulators.js:32` (jar dir)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | PE1, PE2                |

---

## 2. Contracts

Every new identifier below must pass the runbook §4.0 word lists (§3's name
check). No optional property and no `| undefined` in any ECS file — absent
is `null`. Every new system ships a purity spec (Law 3); every new
`AuditContext` variant ships narrowing and disjointness lines in its
type-spec; every new port is a member of a named bundle in
`libs/ecs-core/src/ports/` (Law 9); every new error lives in an
`errors/*.error.ts` (Law 7.5, `creativo/error-dictionary-home`).

### 2.A WS-A — one injectable instant (PA1, PA2)

```js
// tools/seed/calendar.mjs (beside createShopCalendar; re-exported by tools/seed/fixtures.mjs
// so seed-dev-catalog.mjs reaches it through the bundle's `book` namespace)
export const SEED_NOW_ENV = 'SEED_NOW';
/** The human seed's default when no instant is given: the live clock (P3-L-1, P3-RU-1). */
export const SEED_DEFAULT = 'LIVE';
/**
 * The seed's instant: `--now=<text>` first, then env SEED_NOW, else `realNowMs`.
 * <text> = epoch ms (digits) | a shop wall time `YYYY-MM-DDTHH:mm` (read on `timeZone`)
 *        | an ISO instant with `Z` / an offset — `UtcEpochMs.of` / `ZonedTimeSystem.parseIsoIn`.
 * A refused text THROWS (`seed: --now '<text>' is no instant (<errorCode>)`), never falls back.
 */
export function seedNowOf({ argv, env, realNowMs, timeZone = SHOP_TIME_ZONE }) /* → number (UtcEpochMs) */;
```

`tools/seed-dev-catalog.mjs:284` becomes `const seedNowMs =
seed.book.seedNowOf({ argv: process.argv, env: process.env, realNowMs:
Date.now() }); const clientBook = buildClientBook(seedNowMs);` and logs
ONE line `seed: instant <ISO-Z> (<'pinned' | 'live'>)` through the existing
progress log (not the last three lines `verify-p0.mjs` tails). `:712`
keeps `nowUtcMs: () => Date.now()` with a comment citing P3-RU-2. The
header gains a "Pinning the instant" paragraph (the text forms, the
default, `verify:p0`'s and the e2e's use). No change to `buildClientBook`,
`createShopCalendar` or any fixture; the source-order pins of
`loyalty.spec.mjs:685-700`, `:1608-1640` keep their order (one call site).

```js
// tools/verify/p0/seed-run.mjs (new, pure; verify-p0.mjs is never imported by a spec)
/** The env a seed run gets: the caller's, with SEED_NOW set to the one instant of this proof. */
export function seedRunEnv(baseEnv, seedNowMs) /* → { ...baseEnv, SEED_NOW: String(seedNowMs) } */;
/** The proof's instant: SEED_NOW from the caller's env when set (the late-time run), else `nowMs`. */
export function proofInstantOf(baseEnv, nowMs) /* → number; a malformed SEED_NOW throws */;
```

`verify-p0.mjs` (a): `const seedNowMs = proofInstantOf(process.env,
Date.now())` captured ONCE before the first run; `runSeed()` passes
`seedRunEnv(process.env, seedNowMs)` to both runs; the header's (a) text
says "with one instant". The settle `since` reads (`:499`, `:508`, `:575`,
`:606`) stay `Date.now()` (operational — they compare against the Logging
emulator's real entry times).

```ts
// apps/web/e2e/support/shop-clock.ts — stays Firebase-free and Node-free; KEEPS the live
// shopToday() (the unpinned, callable-driven specs compare against the live browser and the
// live server — P3-L-1); LOSES stillAheadToday, EVENING_START, LATEST_START; GAINS the pure half:
/** The minute of the shop day the browser is pinned to: 10:00 — inside every open day's hours. */
export const BROWSER_PIN_MINUTE = 600;
/** Today's seeded visits start here: ahead of the pinned 10:00, a 30-minute visit ends 21:30. */
export const EVENING_VISIT_START = '21:00:00';
/** One instant from the suite's text (the seed's grammar, P3-RU-3); a refusal throws through `sure`. */
export function instantOfText(text: string): UtcEpochMs;
/** The browser's pinned instant for a shop day: `day` at BROWSER_PIN_MINUTE on the shop's clock. */
export function browserPinOf(day: LocalDate): UtcEpochMs;
/** The run's ONE instant: `text` (E2E_NOW) when given — it must fall on the REAL shop day of
 *  `realNowMs`, else it throws — or `realNowMs`. Called once, by global setup only. */
export function resolveSuiteInstant(
  text: string | null,
  realNowMs: UtcEpochMs,
): UtcEpochMs;

// apps/web/e2e/support/suite-clock.ts (new, Node side — reads process.env; imports shop-clock.ts)
export const SUITE_NOW_ENV = 'E2E_NOW';
/** Global setup ONLY: resolveSuiteInstant(process.env.E2E_NOW, Date.now()), then
 *  process.env.E2E_NOW = String(ms) — Playwright hands env set in globalSetup to every worker,
 *  so all processes of one run share ONE instant, whatever time a worker (re)starts. */
export function fixSuiteInstant(): UtcEpochMs;
/** The run's instant as the workers read it: E2E_NOW (digits, set by global setup) — trusted,
 *  never re-checked against the real day; absent → a defect ("run through the Playwright config"). */
export function suiteNowUtcMs(): UtcEpochMs;
/** The suite's shop day — what a PINNED spec calls "today" (never the live shopToday()). */
export function suiteDay(): LocalDate;
/** The browser's pinned instant for this run: browserPinOf(suiteDay()). */
export function browserNowUtcMs(): UtcEpochMs;
/** Sets the page's clock to browserNowUtcMs() and lets it RUN (timers keep running) — FIRST, before any goto or signInAs.
 *  A pinned page meets two server-time rules it must avoid: the notes / photos ±300 s stamp
 *  window (`firestore.rules:100-102`) and an inbox read stamp `readAtUtcMs >= sentAtUtcMs`
 *  (`firestore.rules:251-254`). */
export async function pinBrowserClock(page: Page): Promise<void>; // page.clock.setSystemTime(browserNowUtcMs()) — NOT setFixedTime (§0.5)
```

`global-setup.ts` calls `fixSuiteInstant()` FIRST, then runs the catalogue
seed (`:49`) with `--now=${browserNowUtcMs()}` ALWAYS (digits; the
catalogue's busy days, the Stefan exception and the loyalty seasons sit on
the suite's day, the day the pinned browser reads); `seededFrom` (`:47`)
stays `Date.now()`. Pinned specs: both glance tests
(`client-card-glance.spec.ts:364`, `:707` — `await pinBrowserClock(page)` as
the FIRST statement; `today` = `suiteDay()` at `:370`, `:713`;
`seedGeorgi` / `seedMartin` seed `${today}T${EVENING_VISIT_START}`) and
`appointments.spec.ts:100` (month navigation; `shopMonthKey()` from
`suiteDay()`). Every other e2e spec is UNCHANGED and UNPINNED (it keeps
the live `shopToday()` it imports today): each callable-driven spec runs
against the functions' real clock and only books or edits days ≥ tomorrow
(`bookableDays` skips today, `booking-days.ts:11-14`), so it is correct for
any real time (§0.1 A.6) — a memoised day there would change its behaviour
across midnight. `appointments-screenshots.spec.ts` keeps its own absolute
pin. A spec that pins the browser never authors a note or photo through
the UI (the rules' ±300 s stamp window judges the real `request.time`,
DEP-15) and never marks an inbox notification read (`readAtUtcMs >=
sentAtUtcMs`, `firestore.rules:251-254`, against a server stamp taken on
the real clock).

**2.A.1 Every time-sensitive e2e spec** (brief: _"the planner inventories
every time-sensitive spec and proves each one deterministic or documents
why it already is"_; inventory `a-seed-clock.md` §3, re-verified):

| Spec : line                                                                                          | Clock it compares                                                                                             | Verdict                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client-card-glance.spec.ts:364`, `:707` (×2 themes ×3 projects)                                     | the page's clock vs Node-side seeds (`isUpcoming`, birthday band, «днес», seasons)                            | PINNED (P3-DEP-4): browser at `suiteDay()` 10:00, visits at 21:00, one instant per run — deterministic for any real hour                                                                                          |
| `appointments.spec.ts:100` (month navigation)                                                        | `shopMonthKey()` vs the calendar's "this month" (device in `Pacific/Kiritimati`)                              | PINNED (P3-DEP-4): both sides read `suiteDay()`                                                                                                                                                                   |
| `appointments.spec.ts:52`, `:57`, `:123`, `:158`/`:161`                                              | rows seeded at `2030-06-01T10:00` (upcoming) / `2026-01-15T10:00` (past); server 24 h cancel window           | no time-of-day dependency; the `:152`/`:158` flake is a callable round trip under load (HANDOFF §4); a dated CALENDAR BOMB after 2030-05-31 — §7 item 21 (flag, not fixed)                                        |
| `account-dashboard.spec.ts:56-58`, `account-dashboard-screenshots.spec.ts:38-39`                     | the 2030 visit; `birthDate: '1990-05-05'` (no birthday-today logic in `libs/features/client/account`)         | no time-of-day dependency; the same 2030 bomb (§7 item 21); the screenshot baselines are darwin-only, so re-dating is a macOS-gate change                                                                         |
| `auth-onboarding.spec.ts:63`, `:106`, `:146`, `:159`                                                 | none asserted; server OTP TTL 5 min and the 60 s resend window                                                | NOT a clock flake: unique e-mail per attempt (`:22-24`), so the window never binds; `:95-98` documents the Functions cold start the `{ timeout: 10_000 }` waits on — a load flake (HANDOFF §4), not WS-A's to fix |
| `booking-core.spec.ts:302` (`freedDay = shopToday()+3`), `:371-378` (`centerWeekdayFrom`)            | Node's live day vs the live page and server                                                                   | callable-driven, UNPINNED, days ≥ tomorrow; a run crossing the shop's midnight between the Node read and the page is the only exposure — PRE-EXISTING, unchanged (§7 item 21)                                     |
| `client-card-rebook.spec.ts` (`bookableDays(page).nth(lane)`)                                        | the live page's bookable days                                                                                 | callable-driven, UNPINNED, never today — deterministic for any real time                                                                                                                                          |
| `staff-walk-in.spec.ts:42-50` (`laneDay` ≥ `shopToday()+90`)                                         | calendar math only; the staff save callable                                                                   | callable-driven, UNPINNED; staff placement ignores the horizon — deterministic                                                                                                                                    |
| `programs.spec.ts:101` (`eventDay = shopToday()+30`)                                                 | `/events` splits upcoming / past on the page clock (`marketing-events.ts:88`)                                 | not callable-driven but 30 days ahead for any real hour — deterministic                                                                                                                                           |
| `csp/csp-smoke.spec.ts:283` (tomorrow)                                                               | the live page and server                                                                                      | "Tomorrow, so the visit is ahead whatever the hour" — deterministic                                                                                                                                               |
| `appointments-screenshots.spec.ts:16-23`                                                             | its own `page.clock.setFixedTime(2026-09-25T10:00+03:00)`                                                     | already pinned — deterministic                                                                                                                                                                                    |
| `landing.spec.ts`, `landing-screenshots.spec.ts`, `app-shell.spec.ts`, `client-card-harness.spec.ts` | the landing's open / closed line reads the page clock (`locations.component.ts:299`, `:327`) — never asserted | no clock assertion; the hero screenshot is above the fold; the harness `:17` / `:40` flakes are load                                                                                                              |

### 2.B WS-B — login / OTP audit rows (PB1, PB2, PB3)

```ts
// components/otp-refusal-reason.data.ts (new) — the field `otpRefusalReason`
export const OtpRefusalReason = {
  /** A wrong code, recorded as an attempt; the challenge stays open. */
  WrongCode: 'WRONG_CODE',
  /** A wrong code whose recorded attempt reaches `maxAttempts`: the challenge is now locked. */
  LockedOut: 'LOCKED_OUT',
} as const;
export type OtpRefusalReason = (typeof OtpRefusalReason)[keyof typeof OtpRefusalReason];
// no companion of its own (the BlockReason precedent): readers use Tag.values / Tag.has over the dictionary

// components/actor.data.ts — SystemSource gains (P3-RU-10):
  /** A sign-in callable acting before any session exists (`requestOtpChallenge`, `verifyOtpChallenge`). */
  IdentityCallable: 'IDENTITY_CALLABLE',

// components/audit-context.data.ts — AuditAction gains:
  IdentityOtpRequested: 'IDENTITY_OTP_REQUESTED',
  IdentityOtpVerified: 'IDENTITY_OTP_VERIFIED',
  IdentityOtpRefused: 'IDENTITY_OTP_REFUSED',
  IdentitySessionIssued: 'IDENTITY_SESSION_ISSUED',
  IdentityRegistrationCompleted: 'IDENTITY_REGISTRATION_COMPLETED',
export namespace AuditContext {
  export type OtpRequested = {
    readonly auditAction: typeof AuditAction.IdentityOtpRequested;
    readonly otpDestinationType: OtpDestinationType;   // 'SMS' | 'EMAIL' — never the destination
    readonly otpPurpose: OtpPurpose;
    readonly otpExpiresAtUtcMs: UtcEpochMs;
  };
  export type OtpVerified = {
    readonly auditAction: typeof AuditAction.IdentityOtpVerified;
    readonly otpDestinationType: OtpDestinationType;
    readonly otpPurpose: OtpPurpose;
    readonly otpAttemptCount: number;                   // wrong codes before this success
  };
  export type OtpRefused = {
    readonly auditAction: typeof AuditAction.IdentityOtpRefused;
    readonly otpDestinationType: OtpDestinationType;
    readonly otpPurpose: OtpPurpose;
    readonly otpRefusalReason: OtpRefusalReason;
    readonly otpAttemptCount: number;                   // AFTER the increment
    readonly otpMaxAttempts: number;
  };
  export type SessionIssued = {
    readonly auditAction: typeof AuditAction.IdentitySessionIssued;
    readonly sessionKind: SessionKind;                  // 'NEW' | 'RETURNING' (the existing tag)
    readonly otpDestinationType: OtpDestinationType;
  };
  export type RegistrationCompleted = {
    readonly auditAction: typeof AuditAction.IdentityRegistrationCompleted;
    readonly registrationIdentifierChannel: IdentifierChannel;
  };
}
// + the five in the AuditContext union; factories otpRequested / otpVerified / otpRefused /
//   sessionIssued / registrationCompleted (the impersonationStarted idiom); Singles in the
//   partition spec gain the five verbs; the spec regex gains IDENTITY (P3-RU-9; WS-C adds PRIVACY, P3-RU-15).
// A field shared by several variants (otpDestinationType, otpPurpose, otpAttemptCount) is legal:
// the variants are a union discriminated by auditAction alone; each field is disjoint from the
// Actor / AuditTargetRef / AuditEntryMeta slices (the type-spec proves it).

// primitives/ids.primitive.ts — AuditResourceId gains (restated name, spec-checked like STREAK_DEFINITIONS):
const OTPS = 'otps';
forOtp(id: OtpId): AuditResourceId;               // `otps/<id>`

// systems/audit.system.ts — reuse, never copy:
AuditSystem.idBasisOf(action: AuditAction, resourceId: AuditResourceId,
                      targetId: CustomerId | UserId | null,   // branded (Law 7.4); the private rowBasis keeps text
                      changeKey: string): string;     // the public face of the private rowBasis (same bytes)
AuditSystem.changeKey += {
  otpRequested(otpId: OtpId): string,             // `otp-requested:<otpId>`
  otpVerified(otpId: OtpId): string,              // `otp-verified:<otpId>`
  otpRefused(otpId: OtpId, attemptCount: number): string, // `otp-refused:<otpId>:<attemptCount>`
  sessionIssued(otpId: OtpId): string,            // `session:<otpId>`
  registration(userId: UserId): string,           // `registration:<userId>`
};  // ROW_BASIS_TAG stays 'audit-row/v2': no existing key changes

// systems/otp.system.ts
OtpSystem.refusalReasonOf<O extends OtpCounters>(attempt: OtpAttempt<O>): OtpRefusalReason | null;
//   null unless attempt.write !== null && !attempt.result.ok (a recorded wrong code);
//   LOCKED_OUT iff attempt.write.attemptCount >= attempt.write.maxAttempts, else WRONG_CODE

// systems/identity-audit.system.ts (new; imports ./audit.system one way) — every planner picks
// fields EXPLICITLY (never spreads an Otp: destination, codeHash and salt never reach a row)
export const IdentityAuditSystem = {
  ACTOR: Actor.system(SystemSource.IdentityCallable),
  // the three PRE-SESSION planners take no operation id: auditOperationId = null (P3-L-20)
  planOtpRequested(otp: Otp): AuditRowPlan,
  //   recordedAtUtcMs = otp.createdAtUtcMs; resource forOtp(otp.id); target none
  planOtpVerified(consumed: Otp): AuditRowPlan,
  //   recordedAtUtcMs = consumed.consumedAtUtcMs (non-null — a defect otherwise); target none
  planOtpRefused(recorded: Otp, reason: OtpRefusalReason, nowUtcMs: UtcEpochMs): AuditRowPlan,  // target none
  planSessionIssued(otp: Otp, userId: UserId, sessionKind: SessionKind,
                    operationId: OperationId | null, nowUtcMs: UtcEpochMs): AuditRowPlan,
  //   resource AuditResourceId.forUser(userId); target AuditTargetRef.user(userId)
  planRegistrationCompleted(userId: UserId, roles: readonly unknown[], channel: IdentifierChannel,
                            operationId: OperationId | null, nowUtcMs: UtcEpochMs): AuditRowPlan,
  //   actor Actor.forCaller(userId, roles); resource forUser; target user
} as const;
// session / registration plans: auditOperationId = operationId; pre-session plans: null;
//   idBasis = AuditSystem.idBasisOf(action, resource, targetId, AuditSystem.changeKey.<verb>(…))
```

Pipelines (PB2):

```ts
// request-otp.pipeline.ts
export type RequestOtpPorts = TenantPorts & OtpStorePorts & OtpDeliveryPorts & OtpCryptoPorts &
  AuthDeploymentPorts & CommitPorts & ClockPorts & HashPorts & IdPorts & TelemetryPorts; // + Commit, Hash
RequestOtpCommand += readonly operationId: OperationId | null;   // transport id (RU-21), never refused —
//   the outcome line's join key; it reaches no pre-session row (P3-L-20)
// after OtpSystem.issue: const { id, ...body } = otp;
//   ports.commit(async () => null, () => Result.ok({ writes: [
//     WriteOp.set([Collections.Otps, id], body),
//     ...AuditSystem.createsOf([IdentityAuditSystem.planOtpRequested(otp)], ports.hash) ] }))
//   a commit failure answers its RepositoryError (as saveOtp's did); then sendOtp exactly as today.
// ports/identity.port.ts: SaveOtp and OtpStorePorts.saveOtp deleted (OtpStorePorts = { loadOpenOtps }).

// verify-otp.pipeline.ts
export type VerifyOtpPorts = CommitPorts & ClockPorts & HashPorts & OtpCryptoPorts & UserLookupPorts &
  AuthUserLookupPorts & AuthAdminPorts & TelemetryPorts;                                    // + Hash
VerifyOtpCommand += readonly operationId: OperationId | null;
// tx1 decide: writes = [...attemptWrites(otp.id, attempt), ...rowsOf(attempt)] where
//   success → planOtpVerified(attempt.result.value); recorded wrong code →
//   planOtpRefused(attempt.write, OtpSystem.refusalReasonOf(attempt), nowUtcMs); else none.
// tx2 (NEW path) unchanged. After a successful mint, BEFORE the answer:
//   ports.commit(async () => null, () => Result.ok({ writes: AuditSystem.createsOf(
//     [planSessionIssued(otp, user.id, sessionKind, op, nowUtcMs)], ports.hash) }))
//   a failure answers the RepositoryError (the token is never answered).

// complete-registration.pipeline.ts — inside decide, after RegistrationSystem.register:
//   !Registration.isRegistered(read.stored)          (registration.data.ts:68 — the existing check)
//     ? [...existing writes, ...AuditSystem.createsOf([IdentityAuditSystem.planRegistrationCompleted(
//         uid, read.stored.roles, cmd.identifierChannel, cmd.operationId, nowUtcMs)], ports.hash)]
//     : existing writes                       // a re-run plans no row (no ALREADY_EXISTS on the idempotent re-run)
```

Functions (PB3): `decodeRequestOtp` and `decodeVerifyOtp` add `operationId:
operationIdOf(request.data, 'operationId')` (absent or malformed → `null`,
never refused — the `decodeCompleteRegistration` idiom, `identity.wire.ts:257`;
RU-21's list of four optional readers becomes six). `firestore-otps.adapter.ts`
loses `saveOtp` (the tx adapter stamps the `otps` `purgeAt` on the `Set`,
`firestore-tx.adapter.ts:315` `withPurgeAt` — the `firestore-layout.md`
"must not regress" TTL invariant, pinned after the move by
`request-otp.integration.spec.ts`: the committed `otps/<id>` carries a
`purgeAt` Timestamp equal to `purgeAtFor`, expiry + 24 h).
Indexes (`firestore.indexes.json`, `auditLog`, `"indexes": []`):
`otpExpiresAtUtcMs`, `otpAttemptCount`, `otpMaxAttempts`. No rules change
(`auditLog` admin-read, no client write; `otps` closed). Logs: no new
`LogEvent` (P3-L-2).

### 2.C WS-C — the GDPR export (PC1, PC2, PC3, PC4, PC5)

```ts
// errors/privacy.error.ts (new; + errors/index.ts) — the PRIVACY_ family (C half; D adds two)
export const PrivacyErrorCode = {
  Unauthenticated: 'PRIVACY_UNAUTHENTICATED',      // unauthenticated
  Forbidden: 'PRIVACY_FORBIDDEN',                  // permission-denied (claims or stored roles not admin)
  InvalidInput: 'PRIVACY_INVALID_INPUT',           // invalid-argument (+ field: 'customerId' | 'operationId')
  Unavailable: 'PRIVACY_UNAVAILABLE',              // failed-precondition (client.privacy off)
  ClientNotFound: 'PRIVACY_CLIENT_NOT_FOUND',      // not-found
  ExportTooLarge: 'PRIVACY_EXPORT_TOO_LARGE',      // failed-precondition (+ exportDocumentCount, exportByteCount)
} as const;
export type PrivacyError = PrivacyError.Unauthenticated | … ;  // flat structs, factory companion
export namespace PrivacyError { … InvalidInput = { errorCode; field: 'customerId' | 'operationId' };
  ExportTooLarge = { errorCode; exportDocumentCount: number; exportByteCount: number } }

// components/privacy-marker.data.ts (new) — the ONE pseudonym marker (P3-RU-23), used by C and D
export const PrivacyMarker = {
  TEXT: '—',
  /** `— <n>`, n ≥ 1, through SeatLabel's own smart constructor (a refusal is a defect). */
  seatLabel(ordinal: number): SeatLabel,
  isMarker(text: string): boolean,            // TEXT, or a `— <n>` label
} as const;

// components/roles.data.ts (P3-RU-13)
PRIVACY: [Role.Admin],                         // callable-only (no rules twin); NOT the sysadmin
handlesClientPrivacy(roles: readonly string[]): boolean,

// components/client-privacy-call.data.ts (new; the GovernanceCall / BackfillCall idiom)
/** What the web sends: the record and the act's minted id (REQUIRED for the export and the erasure). */
export type ClientPrivacyCall = {
  readonly customerId: CustomerId;
  readonly operationId: ClientOperationId;
};
export const ClientPrivacyCall = {
  /** The bundle's format version — bumped by any change of a section's shape or order. */
  EXPORT_VERSION: 1,
  decodeExported(raw: unknown): Result<ClientPrivacyCall.Exported, PipelineError>,  // CallAnswer.read/parsed/text/whole
} as const;
export namespace ClientPrivacyCall {
  export type Exported = {
    readonly clientExportVersion: number;      // === EXPORT_VERSION (the decoder refuses another)
    readonly exportedCustomerId: CustomerId;
    readonly exportedAtUtcMs: UtcEpochMs;
    readonly exportDocumentCount: number;
    readonly exportByteCount: number;          // UTF-8 bytes of exportJson
    readonly exportJson: string;               // CanonicalJsonSystem.of(ClientExportBundle)
  };
}

// components/audit-context.data.ts
  PrivacyClientExported: 'PRIVACY_CLIENT_EXPORTED',
export type ClientExported = {
  readonly auditAction: typeof AuditAction.PrivacyClientExported;
  readonly exportDocumentCount: number;
  readonly exportAuditRowCount: number;
  readonly exportByteCount: number;
};
// primitives/ids.primitive.ts: AuditResourceId.forCustomer(id: CustomerId) → `customers/<id>` (restated CUSTOMERS, spec-checked)
// systems/audit.system.ts: changeKey.clientExported(operationId: OperationId) → `export:<operationId>`

// ports/callables.ts
Callables.ExportClientData: 'exportClientData'
CallableWire[ExportClientData] = { input: ClientPrivacyCall; answer: ClientPrivacyCall.Exported }
OPERATION_ID_FIELD[ExportClientData] = 'operationId';  CALLABLE_ANSWER_DECODERS → ClientPrivacyCall.decodeExported

// ports/privacy.port.ts (new; + ports/index.ts) — every list takes `limit` (the caller passes cap + 1)
export type LoadClientRecord   = (customerId: CustomerId) => Promise<Result<Customer | null, RepositoryError>>;   // guarded
export type ListClientVisits   = (customerId: CustomerId, limit: number) => Promise<Result<readonly Appointment[], RepositoryError>>; // array-contains; guarded
export type LoadVisitNotes     = (appointmentIds: readonly AppointmentId[]) => Promise<Result<readonly AppointmentNote[], RepositoryError>>; // getAll (bounded by the visits); guarded
/** The person's photo documents of EVERY origin — `clientCustomerId ==` only, no `orderBy`, the automatic
 *  single-field index (never the card's SHOT-only, ordered `ListClientPhotos`, notes-photos.port.ts:43-53). */
export type ListPhotosOfClient = (clientCustomerId: CustomerId, limit: number) => Promise<Result<readonly AppointmentPhoto[], RepositoryError>>;
export type ListVisitPhotos    = (appointmentIds: readonly AppointmentId[], limit: number) => Promise<Result<readonly AppointmentPhoto[], RepositoryError>>; // `in`, chunks of 30
export type ListClientGrants   = (customerId: CustomerId, limit: number) => Promise<Result<readonly CouponGrant[], RepositoryError>>;
export type ListClientVouchers = (customerId: CustomerId, limit: number) => Promise<Result<readonly GiftVoucher[], RepositoryError>>;
export type ListClientJournal  = (customerId: CustomerId, limit: number) => Promise<Result<readonly JournalEntry[], RepositoryError>>; // no orderBy (P3-RU-26)
export type ListAccountNotifications = (userId: UserId, limit: number) => Promise<Result<readonly InboxNotification[], RepositoryError>>;
export type ListAccountWaitlist      = (userId: UserId, limit: number) => Promise<Result<readonly WaitlistRequest[], RepositoryError>>;
export type ListAccountInvitations   = (userId: UserId, limit: number) => Promise<Result<readonly Invitation[], RepositoryError>>;
/** The person's footprint reads — `firestorePrivacyPorts(db, guardOf, log)` (functions). */
export type ClientFootprintPorts = {
  readonly loadClientRecord: LoadClientRecord;
  readonly loadProfile: LoadProfile;                    // the EXISTING type (accounts.port.ts:59-61), never a copy
  readonly listClientVisits: ListClientVisits; readonly loadVisitNotes: LoadVisitNotes;
  readonly listPhotosOfClient: ListPhotosOfClient; readonly listVisitPhotos: ListVisitPhotos;
  readonly listClientGrants: ListClientGrants; readonly listClientVouchers: ListClientVouchers;
  readonly listClientJournal: ListClientJournal;
  readonly listAccountNotifications: ListAccountNotifications;
  readonly listAccountWaitlist: ListAccountWaitlist; readonly listAccountInvitations: ListAccountInvitations;
};
/** The web's privacy callables — ONE token, CLIENT_PRIVACY_PORTS (D adds two members). */
export type ExportClientData = Callable<ClientPrivacyCall, ClientPrivacyCall.Exported>;
export type ClientPrivacyGatewayPorts = { readonly exportClientData: ExportClientData };
```

```ts
// systems/canonical-json.system.ts — utf8Bytes moves here (P3-RU-27); client-issue.system.ts calls it
CanonicalJsonSystem.utf8Bytes(text: string): number;

// systems/client-privacy.system.ts (new) — the rules C and D share; pure
export type ClientPerson = { readonly record: Customer; readonly account: User | null };
export const ClientPrivacySystem = {
  /** Every seat of the visit is the person's record (account or walk-in seat). */
  isSoleSubject(visit: Appointment, customerId: CustomerId): boolean,
  /** The visit's contact key — `contactPhone ?? contactEmail` (the `CustomerRecordSystem.walkInKey` rule
   *  over the BookingContact slice as is; no mapping), or null when the visit has no contact. */
  contactKeyOf(contact: BookingContact): string | null,
  /** The visit's BookingContact is PROVABLY the person's (P3-L-12, P3-RU-36): owner record, owner account,
   *  or `CustomerId.forWalkIn(contactKeyOf(visit), walkInHash) === record.id`. Sole-subject is NOT an arm
   *  here (the export withholds); the erasure adds it on its own side. */
  contactIsPersons(visit: Appointment, person: ClientPerson, walkInHash: (input: string) => string): boolean,
  /** The person's own WALK_IN seats (seatSubject WALK_IN, subjectCustomerId = record.id). */
  ownWalkInSeatIds(visit: Appointment, customerId: CustomerId): readonly SeatId[],
  /** A photo is the person's: clientCustomerId = record, or null on a sole-subject visit. */
  photoIsPersons(photo: AppointmentPhoto, soleSubjectVisitIds: ReadonlySet<AppointmentId>, customerId: CustomerId): boolean,
} as const;

// systems/client-export.system.ts (new) — the bundle; pure
export const EXPORT_MAX_DOCUMENTS = 20_000;
export const EXPORT_MAX_BYTES = 4_194_304;
export type ClientFootprint = {            // what the pipeline read — entities as stored, zero mapping
  readonly record: Customer; readonly account: User | null;
  readonly visits: readonly Appointment[]; readonly notes: readonly AppointmentNote[];
  readonly photos: readonly AppointmentPhoto[]; readonly couponGrants: readonly CouponGrant[];
  readonly giftVouchers: readonly GiftVoucher[]; readonly loyaltyAccount: LoyaltyAccount | null;
  readonly badgeProgress: readonly BadgeProgress[]; readonly seasonProgress: readonly SeasonProgress[];
  readonly clientStats: ClientStatsRecord | null; readonly clientMoney: ClientMoneyRecord | null;
  readonly journal: readonly JournalEntry[]; readonly notifications: readonly InboxNotification[];
  readonly waitlistRequests: readonly WaitlistRequest[]; readonly invitations: readonly Invitation[];
  readonly auditRows: readonly AuditEntry[];
};
export type ClientExportBundle = {         // the canonical JSON sorts keys; arrays carry the order below
  readonly clientExportVersion: number;    // ClientPrivacyCall.EXPORT_VERSION
  readonly exportedAtUtcMs: UtcEpochMs;
  readonly exportedCustomerId: CustomerId;
  readonly exportedUserId: UserId | null;
  readonly customers: readonly Customer[];             // [record]
  readonly users: readonly User[];                     // [] | [account]
  readonly appointments: readonly ExportedAppointment[];  // utcEpochMs desc, then id (code units); shared visits redacted; no voucher code
  readonly appointmentNotes: readonly AppointmentNote[];       // sole-subject visits only; id asc
  readonly appointmentPhotos: readonly ExportedPhoto[];        // the person's; id asc; `url` omitted
  readonly giftVouchers: readonly ExportedGiftVoucher[];      // id asc; no `code`
  readonly couponGrants, badgeProgress, seasonProgress,
           notifications, waitlistRequests, invitations: readonly …[];   // id asc each
  readonly loyaltyAccounts: readonly LoyaltyAccount[];         // [] | [account]
  readonly clientStats: readonly ClientStatsRecord[];          // [] | [stats]
  readonly clientMoney: readonly ClientMoneyRecord[];          // [] | [money]
  readonly clientJournal: readonly JournalEntry[];             // id asc (`{customerId}_{seq:6}` = seq order)
  readonly auditLog: readonly AuditEntry[];                    // AuditSystem.chronological (recordedAtUtcMs, id);
                                                               //   never the row id this call plans (P3-RU-18)
};
/** A photo as stored, without its tokenised download URL (P3-L-5) — a named slice of the system. */
export type ExportedPhoto = Omit<AppointmentPhoto, 'url'>;   // an entity minus its capability URL (Omit is banned only on *Ports, Law 9)
/** Bearer voucher codes never leave in a file (P3-L-5): a voucher, and a visit's redemption lines, without `code`. */
export type ExportedGiftVoucher = Omit<GiftVoucher, 'code'>;
export type ExportedVoucherRedemption = Omit<VoucherRedemption, 'code'>;
export type ExportedAppointment = Omit<Appointment, 'voucherRedemptions'> & {
  readonly voucherRedemptions: readonly ExportedVoucherRedemption[];
};
export const ClientExportSystem = {
  documentCount(footprint: ClientFootprint): number,
  /** Order + redaction; `ownRowId` (the id of the row this call plans, known before the read) is left out
   *  of `auditLog`, so a replay of one operation id answers the same bytes under one clock. */
  bundleOf(footprint: ClientFootprint, exportedAtUtcMs: UtcEpochMs, ownRowId: AuditEntryId,
           walkInHash: (input: string) => string): ClientExportBundle,
  /** The answer, or the refusal — never a truncated bundle. */
  exportOf(footprint: ClientFootprint, exportedAtUtcMs: UtcEpochMs, ownRowId: AuditEntryId,
           walkInHash: (input: string) => string):
    Result<{ readonly json: string; readonly documentCount: number; readonly byteCount: number;
             readonly auditRowCount: number }, PrivacyError.ExportTooLarge>,
  planClientExported(customerId: CustomerId, counts: { documentCount; auditRowCount; byteCount },
                     actor: Actor, operationId: OperationId, nowUtcMs: UtcEpochMs): AuditRowPlan,
  //   resource forCustomer(customerId); target AuditTargetRef.customer(customerId); key changeKey.clientExported(op)
} as const;
```

```ts
// pipelines/export-client-data.pipeline.ts (new; the start-impersonation shape)
export type ExportClientDataPorts = CommitPorts & ClockPorts & HashPorts & WalkInKeyPorts & CallerRolesPorts &
  FlagsPorts & ClientFootprintPorts & LoyaltyAccountReadPorts & ClientStatsLoadPorts &
  AuditTimelinePorts & TelemetryPorts;
export type ExportClientDataCommand = {
  readonly callerUserId: UserId; readonly callerRoles: readonly Role[];
  readonly customerId: CustomerId; readonly operationId: OperationId;
};
export const exportClientData = (ports: ExportClientDataPorts) =>
  async (cmd: ExportClientDataCommand): Promise<Result<ClientPrivacyCall.Exported, PrivacyError | RepositoryError>>;
// 1. flag off → Unavailable; stored roles (loadCallerRoles) not handlesClientPrivacy → Forbidden
// 2. loadClientRecord → null → ClientNotFound; account = record.userId ? loadProfile(record.userId) : null
// 3. footprint reads (every list called with limit EXPORT_MAX_DOCUMENTS + 1; audit rows paged with
//    pageAuditByTargetCustomer(record.id) and pageAuditByTargetUser(account.id) until the cursor is
//    null or the cap is passed; rows deduped by id); a cap passed → ExportTooLarge, NO row
// 4. ownRowId = the id planClientExported(…, op) will carry (AuditSystem.idBasisOf(PRIVACY_CLIENT_EXPORTED,
//    forCustomer(R), R, changeKey.clientExported(op)) hashed); ClientExportSystem.exportOf(footprint, now,
//    ownRowId, ports.walkInHash) → refusal → ExportTooLarge, NO row
// 5. ONE commit: read the row id (the publish-streak replay-probe precedent, RU-7) → absent:
//    [create row] | present (a replay of this operation id): [] — then the answer.
//    ports.log('info', LogEvent.PrivacyClientExported, { customerId, exportDocumentCount, exportByteCount })
//    — counts and ids only; the bundle never reaches a log field (the outcome line takes no answer).
```

`LogEvent` gains (primitives/log-event.data.ts, dotted, domain-prefixed —
RU-9): `PrivacyClientExported: 'privacy.client_exported'`,
`PrivacyErasureStep: 'privacy.erasure_step'`,
`PrivacyClientErased: 'privacy.client_erased'` (the D two land with D).

Functions (PC3): `wire/privacy.wire.ts` (new) `decodeExportClientData(request)`:
caller uid `null` → `PRIVACY_UNAUTHENTICATED`; `!Roles.handlesClientPrivacy(claims roles)` →
`PRIVACY_FORBIDDEN` — BOTH before the payload is read (the
`governance.wire.ts:57` gate idiom); then `CustomerId.parse(sentText(payload,
'customerId'))` and a REQUIRED `ClientOperationId` guard on `operationId`
(malformed / absent → `PRIVACY_INVALID_INPUT` naming the field); answers
`ExportClientDataCommand` with `OperationId.of` of the parsed id;
`encodeExportClientDataAnswer`; `exportClientDataRefusal = refusalOf`.
`edge.ts`: `PrivacyErrorCode` joins `EDGE_DICTIONARIES` and `EdgeCode`;
`PRIVACY_WIRE: WireTable<PrivacyErrorCode>` (statuses above; `InvalidInput`
`withField`), spread into `EDGE_WIRE`. `adapters/firestore-privacy.adapter.ts`
(new) `firestorePrivacyPorts(db, guardOf, log): ClientFootprintPorts &
LoyaltyAccountReadPorts & ClientStatsLoadPorts` (guarded reads through
`admitStored`; `{ id, ...data }` bodies; code-only failures through
`TriggerAttemptSystem.failureCode`; every list applies the `limit` it is
given). `adapters/firestore-audit-read.adapter.ts`
(new) `firestoreAuditReadPorts(db): AuditTimelinePorts` (the web adapter's
five timeline query shapes over the Admin SDK, the same pure `PagingSystem`; one port per
field, RU-35; no `auditRowsForOperation` — nothing server-side reads it). `main.ts`: a lazily built `privacyPorts = once(() => ({
...serverPorts(), ...walkInKeyPorts(walkInKey), ...firestorePrivacyPorts(adminFirestore(),
StoredDocumentSystem.guardOf, telemetry.log), ...firestoreAuditReadPorts(adminFirestore()),
...paramFlagsPorts(…) }))` (no `type …Ports =` alias in the app) and
`export const exportClientData = onCall({ memory: LARGE_MEMORY,
...WALK_IN_SECRETS }, wiredCallable(plain(Callables.ExportClientData,
null), privacyPorts, decodeExportClientData, (ports, cmd) =>
exportClientDataPipeline(ports)(cmd), encodeExportClientDataAnswer,
exportClientDataRefusal))` (`WALK_IN_SECRETS` = the walk-in key AND the log
digest key, `main.ts:381-389`; its doc comment and `main.spec.ts:176`'s
"the two that mint walk-in records" gain "and the admin privacy callables
that recognise them", P3-RU-36). `LogDigestSystem`'s allowlist is unchanged (the
outcome line's digest covers the operation id; `customerId` stays out, so
no existing digest moves). Exports 47 → **48**. Indexes (`auditLog`,
`"indexes": []`): `exportDocumentCount`, `exportAuditRowCount`,
`exportByteCount`. No rules change; no new composite.

Web (PC4): `libs/infrastructure/firebase-app/src/lib/client-privacy.adapter.ts`
(new) `clientPrivacyPorts(gateway: GatewayPorts): ClientPrivacyGatewayPorts`
(the `otp-challenge.adapter.ts:46` idiom, `gateway.callableClient(Callables.ExportClientData)`);
`ports.tokens.ts` `CLIENT_PRIVACY_PORTS = new
InjectionToken<ClientPrivacyGatewayPorts>('CLIENT_PRIVACY_PORTS')`;
`app.config.ts` provider beside `OTP_CHALLENGE_PORTS`. The card (one
separate block AFTER the K exits — never inside `ClientOverviewVm`, whose
key set `client-pages.vm.spec.ts:355` pins):

```ts
// client-pages.vm.ts — display types only
export type ClientPrivacyVm = {
  readonly groupLabel: string;
  readonly exportLabel: string;
  readonly exportStatus: string | null; // «Файлът е изтеглен.» / a refusal's words; null when idle
  readonly erase: ClientErasureVm | null; // D
  readonly erasedLabel: string | null; // D: «Изтрит клиент» when the record's erasureStatus is ERASED
};
// client-privacy.presenter.ts (new, Law 10) — words only; decides nothing
export function clientPrivacyVm(input: ClientPrivacyInput): ClientPrivacyVm;
// client-card.store.ts — inject(CLIENT_PRIVACY_PORTS, { optional: true }), inject(ID_PORTS, { optional: true });
//   flag FlagName.ClientPrivacy read with the loyalty flags (:402-412);
//   readonly privacy = computed(() => port && flag && Roles.handlesClientPrivacy(viewer roles)
//     && customerId() !== null && online ? clientPrivacyVm(…) : null)
//   exportData(): mint ONE ClientOperationId per act (kept for a retry of the same act, the
//     staff-day.store.ts:1980 idiom); call exportClientData; hand the answer to the component.
// client-card.ts — the download (DOM work in the component, the client-appointments.ts:865-901 idiom):
//   new Blob([answer.exportJson], { type: 'application/json;charset=utf-8' }),
//   a.download = `creativo-client-${answer.exportedCustomerId}.json` (no clock, no zone: the name is the id)
```

The block is a `uiListGroup` of `uiListRow` buttons like the K exits
(`client-card.html:583-602`), each with a leading `ui-icon`: `client.export`
→ `receipt_long` (PC4 adds the key to
`libs/ui/icons/src/lib/manifest/icon-vocabulary.ts`; the glyph is already in
`material-glyphs.generated.ts`, so no `icons:glyphs` run — P3-L-23).

Words (new keys only, bg + en in the same commit, OR-51 / OR-55, flagged
§7 item 1): `clientCard.privacy.groupLabel` «Лични данни» / "Personal
data"; `clientCard.privacy.export` «Изтегли данните» / "Download the data";
`clientCard.privacy.exportDone` «Файлът е изтеглен.» / "The file is
downloaded."; `errors.PRIVACY_FORBIDDEN` «Само администратор може да го
направи.» / "Only an admin can do this."; `errors.PRIVACY_UNAVAILABLE`
«Това още не е включено за салона.» / "This isn't on for the shop yet.";
`errors.PRIVACY_CLIENT_NOT_FOUND` «Не намерихме този клиент.» / "We
couldn't find this client."; `errors.PRIVACY_EXPORT_TOO_LARGE` «Данните
са твърде много за един файл. Свържи се с поддръжката.» / "There's too
much data for one file. Contact support." `PRIVACY_UNAUTHENTICATED` and
`PRIVACY_INVALID_INPUT` get no words (no surface reaches them; the
`INVALID_INPUT_CODES` precedent, `word-pipeline-error.spec.ts:268`).

### 2.D WS-D — the GDPR erasure (PD1, PD2a, PD2b, PD3, PD3b, PD4, PD5)

**The record's tag and stamps** (PD1):

```ts
// components/erasure-lifecycle.data.ts (new; the account-status / grant-lifecycle shape)
/** The field `erasureStatus` — the tag every writer of a client record reads (P3-RU-20). */
export const ErasureStatus = { None: 'NONE', Erasing: 'ERASING', Erased: 'ERASED' } as const;
export type ErasureStatus = (typeof ErasureStatus)[keyof typeof ErasureStatus];
export type ErasureLifecycle = ErasureLifecycle.None | ErasureLifecycle.Erasing | ErasureLifecycle.Erased;
export const ErasureLifecycle = {
  STATUSES: Tag.values(ErasureStatus),
  none(): ErasureLifecycle.None,                                     // one shared struct
  begin(erasureStartedAtUtcMs: UtcEpochMs): ErasureLifecycle.Erasing,
  complete(erasing: ErasureLifecycle.Erasing, erasedAtUtcMs: UtcEpochMs): ErasureLifecycle.Erased,
  /** ERASING or ERASED — what every writer refuses to seat or re-create (the guard). */
  isUnderErasure(l: ErasureLifecycle): boolean,
  /** STRICT (P3-L-18): the key present, a member of the dictionary, each variant's stamps UtcEpochMs. */
  fieldFault(raw: StoredFields): string | null,                      // the WriteProvenance.fieldFault idiom
} as const;
export namespace ErasureLifecycle {
  export type None = { readonly erasureStatus: typeof ErasureStatus.None };
  export type Erasing = { readonly erasureStatus: typeof ErasureStatus.Erasing;
                          readonly erasureStartedAtUtcMs: UtcEpochMs };
  export type Erased = { readonly erasureStatus: typeof ErasureStatus.Erased;
                         readonly erasureStartedAtUtcMs: UtcEpochMs;   // declared on the later variant (F-20)
                         readonly erasedAtUtcMs: UtcEpochMs };
}
// entities/customer.entity.ts
export type Customer = CustomerMeta & WriteProvenance & ErasureLifecycle;
// systems/stored-document.system.ts customerFault: + ErasureLifecycle.fieldFault(doc) (before WriteProvenance)
// systems/customer-record.system.ts: createsFor and walkInCreates bodies spread ErasureLifecycle.none()

// components/account-status.data.ts (P3-RU-17)
AccountStatus += Erased: 'ERASED'   /** Erased under Art. 17: terminal, never reverts. */
AccountLifecycle = Active | Blocked | Erased;
export namespace AccountLifecycle { export type Erased = {
  readonly accountStatus: typeof AccountStatus.Erased;
  readonly accountErasedAtUtcMs: UtcEpochMs; } }
AccountLifecycle.erase(accountErasedAtUtcMs: UtcEpochMs): AccountLifecycle.Erased;
AccountLifecycle.isErased(l: AccountLifecycle): boolean;
AccountLifecycle.isBlockedAt(l, now): ERASED → true (denied forever);   // its switch exhaustive
// client-glance.system.ts:114-120 reads it — its ERASED case is wording-free (the glance shows a blocked account)
```

**The audit vocabulary and the call** (PD2a):

```ts
// components/erasure-census.data.ts (new) — ONE flat count slice (the RU-12 delta-slice precedent),
// the census of a person's footprint; intersected into the audit variant and the two answers
export type ErasureCensus = {
  readonly erasureRecordCount: number;       // client records still holding a personal value (0 | 1)
  readonly erasureAccountCount: number;      // accounts still holding a personal value (0 | 1; a marker name is none)
  readonly erasureContactCount: number;      // visits still carrying the person's contact
  readonly erasureLabelCount: number;        // the person's walk-in seats still labelled by name
  readonly erasureNoteCount: number;         // notes of the person's visits still present (party visits' too, P3-RU-33)
  readonly erasurePhotoCount: number;        // the person's photo documents still present
  readonly erasureDocumentCount: number;     // notifications + waitlist requests still present
  readonly erasurePseudonymCount: number;    // invitations / sessions still holding a name or reason
  readonly erasureVisitCount: number;        // RETAINED: the person's visits (never erased)
  readonly erasureContactKeptCount: number;  // RETAINED: party visits whose contact derives no record of the person (P3-L-12)
  readonly erasureJournalCount: number;      // RETAINED: journal rows (ids and codes only)
};   // ELEVEN counts (eight personal, three retained)
export const ErasureCensus = { EMPTY: …all 0…, PERSONAL_FIELDS: [the first eight names] } as const;

// components/erasure-offer.data.ts (new) — the field-less tag a system decides and the presenter words (Law 10.2)
export const ErasureOffer = { Erase: 'ERASE', Resume: 'RESUME', Resweep: 'RESWEEP' } as const;
export type ErasureOffer = (typeof ErasureOffer)[keyof typeof ErasureOffer];

// components/erasure-action.data.ts (new; the ProfileAction / GovernedAction subset idiom)
export type ErasureAction = typeof AuditAction.PrivacyClientErasureStarted | typeof AuditAction.PrivacyClientErased |
  typeof AuditAction.PrivacyClientErasureReswept;
// components/audit-context.data.ts
  PrivacyClientErasureStarted: 'PRIVACY_CLIENT_ERASURE_STARTED',
  PrivacyClientErased: 'PRIVACY_CLIENT_ERASED',
  PrivacyClientErasureReswept: 'PRIVACY_CLIENT_ERASURE_RESWEPT',
export type ClientErasure = { readonly auditAction: ErasureAction } & ErasureCensus;
//   STARTED carries the census BEFORE (what will be erased); ERASED the residue AFTER (P3-RU-22);
//   RESWEPT the census BEFORE a sweep of an ERASED record that found residue (P3-L-19)
AuditContext.clientErasure(auditAction: ErasureAction, census: ErasureCensus): AuditContext.ClientErasure;
// systems/audit.system.ts changeKey: erasureStarted(customerId) → `erasure-start:<id>`;
//   erased(customerId) → `erasure-done:<id>` — STATE keys: each planned only on the transition
//   the same transaction read (NONE→ERASING, ERASING→ERASED), so a replay or a concurrent call
//   plans none and never reaches the ALREADY_EXISTS tripwire; erasureResweep(operationId) →
//   `erasure-resweep:<op>` — an OPERATION key, planned only when the commit's probe read finds the
//   row absent (the export row's idiom, RU-7), so a replay of the same id plans none.

// errors/privacy.error.ts += ErasureStaffAccount: 'PRIVACY_ERASURE_STAFF_ACCOUNT' (failed-precondition),
//   AccountLinkMismatch: 'PRIVACY_ACCOUNT_LINK_MISMATCH' (failed-precondition; the record's userId fails
//   record.id === CustomerId.forUser(userId, hash) — P3-L-9),
//   ErasureTooLarge: 'PRIVACY_ERASURE_TOO_LARGE' (failed-precondition; + erasureListedCount: number — P3-L-21)
// errors/booking.error.ts += ClientErased: 'BOOKING_CLIENT_ERASED' (failed-precondition) — { errorCode } only
//   (no id on the wire: the desk knows whom it typed); BookingError.clientErased()

// components/client-privacy-call.data.ts
export namespace ClientPrivacyCall {
  export type ErasurePreview = {
    readonly erasureStatus: ErasureStatus;
    /** Existing walk-in records keyed by the person's phone / e-mail, R excluded (P3-L-7) — ids only,
     *  an admin-only answer; empty once the stamp has cleared the contact values. */
    readonly erasureSiblingCustomerIds: readonly CustomerId[];
  } & ErasureCensus;
  export type Erasure = {
    readonly erasureStatus: ErasureStatus;     // ERASING while a call left work, ERASED when done
    readonly erasureDone: boolean;
  } & ErasureCensus;                           // the residue after this call
}
ClientPrivacyCall.decodeErasurePreview(raw), .decodeErasure(raw)

// ports/callables.ts
Callables.PreviewClientErasure: 'previewClientErasure'   // read-only; the alert's counts
Callables.EraseClient: 'eraseClient'
// both input ClientPrivacyCall; OPERATION_ID_FIELD 'operationId'; their decoders

// ports/privacy.port.ts
ClientFootprintPorts += {
  readonly listAccountSessions: ListAccountSessions;     // impersonationSessions where targetUserId == U; (userId, limit)
  readonly listOtpsByDestination: ListOtpsByDestination; // otps where destination == <Identifier>; (destination, limit);
                                                         //   a failure names the collection only, never the value
};
export type DeleteAuthUser = (userId: UserId) => Promise<Result<void, PipelineError>>;        // auth/user-not-found = ok
/** The Auth user's custom-claim roles — `null` when no Auth user exists (code-only failures). */
export type LoadAuthRoles = (userId: UserId) => Promise<Result<readonly Role[] | null, PipelineError>>;
export type AuthRolesPorts = { readonly loadAuthRoles: LoadAuthRoles };      // the preview's and the erasure's refusal
export type AuthEraserPorts = { readonly deleteAuthUser: DeleteAuthUser };   // the erasure only (Law 9: split, never sliced)
export type DeleteStoredObject = (path: string) => Promise<Result<void, RepositoryError>>;    // not found = ok
/** Lists the prefix (`getFiles({ prefix })`) and deletes each object (`ignoreNotFound`) — the count is the
 *  list's length (`bucket.deleteFiles` resolves `void` in @google-cloud/storage 7.21, bucket.d.ts:702). */
export type DeleteStoredPrefix = (prefix: string) => Promise<Result<number, RepositoryError>>;
export type ObjectEraserPorts = { readonly deleteStoredObject: DeleteStoredObject;
                                  readonly deleteStoredPrefix: DeleteStoredPrefix };
export type PreviewClientErasure = Callable<ClientPrivacyCall, ClientPrivacyCall.ErasurePreview>;
export type EraseClient = Callable<ClientPrivacyCall, ClientPrivacyCall.Erasure>;
ClientPrivacyGatewayPorts += { previewClientErasure; eraseClient };

// pipelines/complete-client-erasure.pipeline.ts (new, browser) — the loop of resumable calls
export type CompleteClientErasurePorts = ClientPrivacyGatewayPorts;
export const MAX_ERASURE_CALLS = 10;
export const completeClientErasure = (ports) => async (input: ClientPrivacyCall):
  Promise<Result<ClientPrivacyCall.Erasure, PipelineError>>;
// calls eraseClient with the SAME operation id until erasureDone (or MAX_ERASURE_CALLS → the last
// answer, erasureDone false — the store words "not finished yet, try again"; every call is idempotent)
```

**The decisions** (PD2b):

```ts
// systems/client-privacy.system.ts (D's additions — PD2a, so PD2b and PD4 of W-D3 both build on them)
ClientPrivacySystem += {
  /** The walk-in record ids the person's contact values derive (`forWalkIn` of R.phone, R.email, U.phone,
   *  U.email — each non-null value once), R excluded (P3-L-7); the pipeline reads which exist. */
  siblingIdsOf(person: ClientPerson, walkInHash: (input: string) => string): readonly CustomerId[],
  /** What the card offers for a record (Law 10.2: the presenter only words it): NONE → ERASE,
   *  ERASING → RESUME, ERASED → RESWEEP (P3-L-19). */
  erasureOffer(erasureStatus: ErasureStatus): ErasureOffer,
};

// systems/client-erasure.system.ts (new; pure; imports ./client-privacy.system and ./audit.system)
export type ErasureFootprint = {
  readonly person: ClientPerson;                       // record + account as read
  readonly visits: readonly Appointment[]; readonly notes: readonly AppointmentNote[];
  readonly photos: readonly AppointmentPhoto[];
  readonly notifications: readonly InboxNotification[]; readonly waitlistRequests: readonly WaitlistRequest[];
  readonly invitations: readonly Invitation[]; readonly sessions: readonly ImpersonationSession[];
  readonly journalCount: number;
};
export const ERASURE_CHUNK_SIZE = 25;                  // visits per commit (≤ 2 × 25 + 1 ops, far below 500)
export const ERASURE_MAX_DOCUMENTS = 5_000;            // per footprint list; past it → ErasureTooLarge (P3-L-21)
export const ClientErasureSystem = {
  /** The guard (book, edit): every record among `ids` the read set holds under erasure. */
  underErasureAmong(ids: Iterable<CustomerId>,
                    stored: ReadonlyMap<CustomerId, Customer | null>): readonly CustomerId[],
  /** The uid the record PROVABLY links — `record.userId` iff record.id === CustomerId.forUser(userId, hash),
   *  else null with a non-null userId meaning a corrupt link (P3-L-9). */
  linkOf(record: Customer, hash: (input: string) => string): UserId | null,
  /** Refused: a link mismatch (AccountLinkMismatch), or a staff role in the stored account OR the Auth
   *  claims (ErasureStaffAccount, P3-L-16) — `authRoles` null when no Auth user exists. */
  refusalOf(person: ClientPerson, authRoles: readonly Role[] | null, hash: (input: string) => string):
    PrivacyError.ErasureStaffAccount | PrivacyError.AccountLinkMismatch | null,
  census(footprint: ErasureFootprint, walkInHash: (input: string) => string): ErasureCensus,
  isComplete(residue: ErasureCensus): boolean,         // every PERSONAL_FIELDS count 0
  hasResidue(census: ErasureCensus): boolean,          // !isComplete — the RESWEPT row's trigger (P3-L-19)
  /** The FIRST commit: record NONE→ERASING cleared, account →ERASED cleared (WriteOp.transition with
   *  variantFieldsToDelete), the STARTED row — or [] when the record is not NONE. */
  stampWrites(person: ClientPerson, census: ErasureCensus, actor: Actor, operationId: OperationId,
              nowUtcMs: UtcEpochMs, hash: (input: string) => string): readonly WriteOp[],
  /** One visit's patch: contact → NONE when contactIsPersons OR the visit is sole-subject (P3-L-12), the
   *  person's walk-in labels → PrivacyMarker.seatLabel(n), the visit's note removed when present (any
   *  visit, P3-RU-33), `writeOperationId` → operationId on the patched visit — [] when clean (idempotent). */
  visitWrites(visit: Appointment, note: AppointmentNote | null, person: ClientPerson,
              operationId: OperationId, walkInHash: (input: string) => string): readonly WriteOp[],
  /** The person's photos to delete, and the object paths that go FIRST (SHOT only). */
  photoPlan(photos: readonly AppointmentPhoto[], soleSubjectVisitIds: ReadonlySet<AppointmentId>,
            person: ClientPerson): { readonly objectPaths: readonly string[]; readonly writes: readonly WriteOp[] },
  /** Notifications and waitlist requests removed; invitations' inviterName and sessions' reason → marker. */
  looseWrites(footprint: ErasureFootprint): readonly WriteOp[],
  /** The LAST commit: ERASING→ERASED + the ERASED row (the residue census) — [] unless ERASING. */
  completionWrites(record: Customer, residue: ErasureCensus, actor: Actor, operationId: OperationId,
                   nowUtcMs: UtcEpochMs, hash: (input: string) => string): readonly WriteOp[],
  /** An ERASED record's sweep found residue: the RESWEPT row (the census BEFORE the sweep) — [] when the
   *  census has none or the probe read found the row (a replay). */
  resweepWrites(record: Customer, before: ErasureCensus, rowPresent: boolean, actor: Actor,
                operationId: OperationId, nowUtcMs: UtcEpochMs, hash: (input: string) => string): readonly WriteOp[],
} as const;
// the record's cleared body: displayName PrivacyMarker.TEXT, phone / email null, searchName /
//   searchPrefixes from SearchFieldsSystem (null inputs — never a second derivation), writeOperationId
//   = the call's operation id (every customers write: stamp and completion — L7, WS-4.3's join key);
// the account's: firstName / lastName PrivacyMarker.TEXT (P3-L-22), phone / email / birthDate null,
//   searchName null, searchPrefixes [], profileEditedAtUtcMs null, AccountLifecycle.erase(now) (roles stay []).
// rows: actor Actor.forCaller(callerUserId, callerRoles) — the admin; resource forCustomer(record.id);
//   target AuditTargetRef.customer(record.id); auditOperationId = the call's operation id.

// the writers' arms (P3-RU-17, P3-RU-20):
// book-appointment.pipeline.ts decideBooking, BEFORE BookingDecisionSystem.decide:
//   ClientErasureSystem.underErasureAmong([...customerIds.values(), ...walkIns.map(g => g.customerId)],
//     set.customers).length > 0 → Result.err(BookingError.clientErased())   // set.customers holds both kinds
// edit-appointment.pipeline.ts — each id read in the map that holds it, never over the stored seats'
//   records (carried back untouched):
//   underErasureAmong(added, loaded.placement.customers)                       // accounts the batch adds (:969-972)
//   ∪ underErasureAmong(loaded.addedWalkIns.map(g => g.customerId), loaded.set.customers)  // walk-ins (:1080)
// profile-edit.system.ts decide: erased stored account → AccountsError.updateProfileNotFound()   // the ONE new arm
// (adoptStub and completeRegistration already refuse an erased account — spec cases pin it, no code, P3-RU-17)
```

**Every writer of a person-linked document after the stamp** (brief: _"a
guard every writer reads"_; inventory `d-erasure-mechanics.md` 2.B W8):

| Writer                                                                               | What it could write about an erased person                                                          | Answer                                                                                                                                |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `bookAppointment`, `editAppointment` (seat or create R, or the walk-in W)            | a new seat, a re-created record                                                                     | GUARDED: `BOOKING_CLIENT_ERASED` (P3-RU-20)                                                                                           |
| `updateProfile` (the erased account's live token, ≤ 1 h)                             | names, contact, birth date                                                                          | GUARDED: `ACCOUNTS_UPDATE_PROFILE_NOT_FOUND` (the new arm)                                                                            |
| `verifyOtp` tx2 `adoptStub`, `completeRegistration`                                  | an account body                                                                                     | ALREADY REFUSED at `20785b8` (P3-RU-17; spec-pinned)                                                                                  |
| lifecycle writers (cancel, transition, arrival, tip, the edit's carried seats)       | nothing personal (`appointment-lifecycle.system.ts:238-241` carries `contact*` from the in-tx read) | not guarded: they write no personal value                                                                                             |
| browser notes / photos on an OLD visit (`worksTheBook()`, `firestore.rules:357-390`) | free text, a label, an image                                                                        | not guarded (a rule would need a `get()` per write): swept by the next call — the ERASED re-sweep (P3-L-19)                           |
| avatar upload by the live token (`storage.rules:41-47`)                              | an image                                                                                            | not guarded: the avatar prefix is deleted on every call (P3-L-10); a rule guard is a §7 item 23 option                                |
| `requestWaitlist`, `redeemInvitation` (live token, ≤ 1 h)                            | ids-only documents (`ownerUserId`, a redemption keyed by uid)                                       | not guarded: no personal value; the re-sweep deletes a new waitlist request                                                           |
| the waitlist matcher (`users/{U}/notifications`)                                     | ids, topics, shop copy                                                                              | not guarded: no personal value; the re-sweep deletes it                                                                               |
| `startImpersonation` targeting U (OR-24, out of scope)                               | `impersonationSessions.reason` — admin free text                                                    | not refused (the pipeline reads no target, `start-impersonation.pipeline.ts:104`); the re-sweep pseudonymises the reason — §7 item 23 |

**The pipeline** (PD2b), `pipelines/erase-client.pipeline.ts` (new; the
`runBackfill` budgeted shape, `StepBudget` from
`continue-policy-recompute.pipeline.ts`):

```ts
export type PreviewClientErasurePorts = ClockPorts & HashPorts & WalkInKeyPorts & CallerRolesPorts & FlagsPorts &
  ClientFootprintPorts & AuthRolesPorts & TelemetryPorts;
export type EraseClientPorts = CommitPorts & ClockPorts & HashPorts & WalkInKeyPorts & CallerRolesPorts & FlagsPorts &
  ClientFootprintPorts & AuthRolesPorts & AuthEraserPorts & ObjectEraserPorts & TelemetryPorts;
export type EraseClientCommand = ExportClientDataCommand;   // the same four fields (one type, re-exported by name)
export const previewClientErasure = (ports: PreviewClientErasurePorts) =>
  async (cmd: EraseClientCommand): Promise<Result<ClientPrivacyCall.ErasurePreview, PrivacyError | RepositoryError | PipelineError>>;
export const eraseClient = (ports: EraseClientPorts) =>
  async (cmd: EraseClientCommand, budget: StepBudget):
    Promise<Result<ClientPrivacyCall.Erasure, PrivacyError | RepositoryError | PipelineError>>;
```

One `eraseClient` call (stateless resume — every step is a pure function of
the stored state; `nowUtcMs` read ONCE before the first commit):

1. **Gate.** `client.privacy` off → `PRIVACY_UNAVAILABLE`; the caller's
   STORED roles (`loadCallerRoles`) not `handlesClientPrivacy` →
   `PRIVACY_FORBIDDEN`. `loadClientRecord(customerId)` `null` →
   `PRIVACY_CLIENT_NOT_FOUND`. The link: `uid = linkOf(record, hash)`
   (a non-null `record.userId` that fails `forUser` →
   `PRIVACY_ACCOUNT_LINK_MISMATCH`, before any read keyed by it); when
   linked, account = `loadProfile(uid)` and `authRoles =
loadAuthRoles(uid)`; `refusalOf(person, authRoles, hash)` →
   `PRIVACY_ERASURE_STAFF_ACCOUNT` (a missing `users` document never lets
   an operator's Auth account through).
2. **Footprint** (outside any transaction; "linked" = `linkOf` answered a
   uid, the uid-keyed steps run on it even if its `users` document is
   gone; every list with `limit ERASURE_MAX_DOCUMENTS + 1`, any list past
   the cap → `PRIVACY_ERASURE_TOO_LARGE` with no write): visits, notes of
   those visits, photos (`listPhotosOfClient(record.id)` +
   `listVisitPhotos(sole-subject visit ids)`), and — when linked —
   notifications, waitlist requests, invitations, sessions;
   `journalCount`. `census` = BEFORE.
3. **OTP sweep** — only while the record is `NONE` (the contact values
   still exist): for each of record.phone / record.email / account.phone /
   account.email, `listOtpsByDestination` → ONE commit of
   `WriteOp.remove` (idempotent; re-run on a resume before the stamp).
   A challenge stored under another spelling (F2-10: the trimmed RAW
   text) or requested between this sweep and the stamp is left to its TTL
   (≤ 1 day past expiry — §7 item 3).
4. **Stamp** — ONE `ports.commit`: read the record and the account
   in-tx; decide `stampWrites` (empty unless the record is `NONE`). From
   here every writer refuses the person (§2.D guard).
5. **Units**, each its own commit, the budget looked at between units
   (`WorkBudgetSystem.takesChunk`): ONLY the visits whose `visitWrites`
   is non-empty on the outside read, in chunks of `ERASURE_CHUNK_SIZE` —
   read each visit and its note IN the transaction (guarded), `visitWrites`
   per visit (re-validated: a visit cleaned meanwhile plans `[]`), so
   every call makes progress and none re-reads clean chunks; photos —
   `deleteStoredObject` for each `SHOT` path FIRST, then one commit of the
   documents' removes; `looseWrites` in chunks. A spent budget answers
   `{ erasureStatus: ERASING, erasureDone: false, …residue so far }`.
6. **Account and avatar** (linked only, on every call that reaches it,
   both idempotent): `deleteStoredPrefix('avatars/<uid>/')`, then
   `deleteAuthUser(uid)` (a failure answers its error; the record stays
   as it is; the next call retries).
7. **Residue** — re-read the footprint; `census` = AFTER. Record
   `ERASING`: `isComplete(after)` → ONE commit `completionWrites` (record
   `ERASED` + `erasedAtUtcMs` + the `PRIVACY_CLIENT_ERASED` row with the
   residue) → answer `{ erasureStatus: ERASED, erasureDone: true, …after
}`; else answer `ERASING`, `erasureDone: false` (a browser note written
   during the erasure is swept by the next call — R-5, §7 item 12).
   Record already `ERASED` (P3-L-19 — steps 3 and 4 plan nothing): when
   the BEFORE census `hasResidue`, ONE commit that probe-reads the
   `erasure-resweep:<op>` row id and plans `resweepWrites` → answer
   `{ erasureStatus: ERASED, erasureDone: isComplete(after), …after }`;
   with no residue the call writes nothing (a second call stays a no-op).
8. Logs: `ports.log('info', LogEvent.PrivacyErasureStep, { customerId,
erasureStatus, erasureDone, …census })` once per call — ids, tags and
   counts only; `LogEvent.PrivacyClientErased` once on completion. No
   Auth or Storage error message is ever logged (code only, the
   `auth-claims.adapter.ts` `authCodeOf` idiom).

`previewClientErasure` runs steps 1–2 (its refusals included) and answers
`{ erasureStatus, erasureSiblingCustomerIds, …census }` — the siblings
from `siblingIdsOf(person, walkInHash)` filtered by `loadClientRecord`
(≤ 4 reads) while the record is `NONE` (`[]` after the stamp: the contact
values are gone) — no commit, no row.

**Functions** (PD3): `wire/privacy.wire.ts` adds `decodePreviewClientErasure`
and `decodeEraseClient` (the export's gate and field rules) and
`ERASE_CLIENT_TIMEOUT_SECONDS = 540` (the `RUN_BACKFILL_TIMEOUT_SECONDS`
idiom; the budget is `WorkBudgetSystem.callableBudgetMs(540)` = 49 s under
the client's 70 s); `edge.ts` `PRIVACY_WIRE` gains `ErasureStaffAccount`,
`AccountLinkMismatch` and `ErasureTooLarge` (all `failed-precondition`) and
the booking table gains `ClientErased` (`failed-precondition`);
`adapters/firebase-auth-eraser.adapter.ts` (new) `authEraserPorts(auth:
Auth): AuthEraserPorts & AuthRolesPorts` (`auth.deleteUser`;
`auth/user-not-found` → ok; `loadAuthRoles` = `auth.getUser(uid)`'s custom
claims through `Roles.known`, `auth/user-not-found` → `null`; any other
failure → its CODE only); `adapters/storage-objects.adapter.ts` (new)
`storageObjectPorts(bucket: Bucket): ObjectEraserPorts`
(`file(path).delete({ ignoreNotFound: true })`; the prefix is LISTED with
`getFiles({ prefix })` and each object deleted with `ignoreNotFound` — the
count is the list's length, since `deleteFiles` resolves `void`; failures →
`RepositoryError.writeFailed(path, code)`); `lib/firebase-admin.ts` gains
`adminBucket(): Bucket` = `getStorage(adminApp()).bucket()` (the default
bucket from `FIREBASE_CONFIG`; the functions emulator sets
`${projectId}.appspot.com`, the bucket the seed writes);
`firestore-privacy.adapter.ts` gains `listAccountSessions`,
`listOtpsByDestination` (`RepositoryError.readFailed(Collections.Otps,
code)` — never the destination, the `firestore-otps.adapter.ts:41` idiom;
a spec with a sentinel destination pins it); `main.ts`: `previewPorts =
once(() => ({ ...privacyPorts(), ...authEraserPorts(adminAuth()) }))` (the
preview's port type reads only `loadAuthRoles`) and
`erasurePorts = once(() => ({ ...privacyPorts(),
...authEraserPorts(adminAuth()), ...storageObjectPorts(adminBucket()) }))`
(`privacyPorts` already holds `walkInKeyPorts`, P3-RU-36), `export const
previewClientErasure = onCall(WALK_IN_SECRETS, wiredCallable(plain(…),
previewPorts, …))`, `export const eraseClient = onCall({ timeoutSeconds:
ERASE_CLIENT_TIMEOUT_SECONDS, memory: LARGE_MEMORY, ...WALK_IN_SECRETS },
wiredCallable({ callable: Callables.EraseClient, failureCode: null,
timeoutSeconds: ERASE_CLIENT_TIMEOUT_SECONDS, traced: true }, erasurePorts,
decodeEraseClient, (ports, cmd, budget) => eraseClientPipeline(ports)(cmd,
budget), …))` (no app-local `type …Ports`). Exports 48 → **50**. `package.json`
`test:emulator` `--only firestore,auth` → `--only firestore,auth,storage`
(the erasure proof deletes real objects); the comment of
`libs/infrastructure/firestore/src/lib/visit-media-writers.integration.spec.ts:57`
("`test:emulator` runs no Storage emulator") is reworded. Indexes
(`auditLog`, `"indexes": []`): the eleven `erasure*Count` fields. Rules: no
RULE change (`customers` and `users` are already `allow create, update: if
false` for every client, `firestore.rules:406`, `:231`; the Admin SDK
bypasses `storage.rules`) — only three COMMENTS name the new writer:
`firestore.rules:393` ("Records are written only by the booking, edit and
registration callables" + "and the admin erasure"), the `users` writer list
(`:213-231`), and the notifications block (`:235`, "the waitlist matcher
writes here" + "the erasure deletes here").

**Web** (PD4): `client-privacy.adapter.ts` gains the two members; the card
store holds ONE pending act — `previewErasure(customerId)` mints the act's
id and captures `{ customerId, operationId }` as a single
`ClientPrivacyCall` in a signal together with the preview's answer (census
and sibling ids), then opens the alert; `confirmErasure()` sends EXACTLY
that captured call to `completeClientErasure` (never re-reads
`customerId()`); `dismissErasure()` and any change of `customerId()` clear
it, so a card that switched person while the alert was open erases nobody.
The record's `erasureStatus` is read with the record (`loadCustomerForUser`
already returns the `Customer`, so the store keeps it beside
`_customerId`); the offer comes from `ClientPrivacySystem.erasureOffer`
(ERASE / RESUME / RESWEEP — P3-L-19, Law 10.2) and `clientPrivacyVm` only
words it: ERASE and RESWEEP → «Изтрий личните данни», RESUME → the same
label with `eraseUnfinished` as its status line; ERASED → the erased line
beside the RESWEEP action. The sibling ids the preview returned stay in the
store after the act; the block lists ONE row per sibling («Изтрий записа
със същия телефон или имейл» / "Erase the record with the same phone or
e-mail", `client-privacy-sibling-<n>`) that runs the same preview → ONE
alert → confirm flow for THAT id (its own act and operation id; no name of
the sibling is shown — it may be another person's). The erase row's icon:
`client.erase` → `delete` (PD4 adds the key to `icon-vocabulary.ts`,
P3-L-23). ONE `<ui-alert data-testid="client-privacy-alert">` with actions
`[{ id: 'ERASE', role: 'destructive', testId:
'client-privacy-erase-confirm' }, { id: 'KEEP', role: 'cancel', preferred:
true, testId: 'client-privacy-erase-keep' }]` (the
`staff-dashboard.ts:4465-4484` idiom: destructive first, the safe answer
last and preferred); no typed confirmation. Words (new keys, flagged §7
item 1): `clientCard.privacy.erase` «Изтрий личните данни» / "Erase
personal data"; `clientCard.privacy.alertTitle` «Да изтрием ли личните
данни?» / "Erase personal data?"; `clientCard.privacy.alertBody`
«Посещения: {{visits}} · Бележки: {{notes}} · Снимки: {{photos}} · Профили
за вход: {{accounts}} · Други записи със същия телефон или имейл:
{{siblings}}. Името, телефонът и имейлът изчезват, профилът за вход се
изтрива. Посещенията и плащанията остават.» / "Visits: {{visits}} · Notes:
{{notes}} · Photos: {{photos}} · Sign-in accounts: {{accounts}} · Other
records with this phone or e-mail: {{siblings}}. The name, phone and e-mail
are removed and the sign-in account is deleted. Visits and payments stay."
(figures only — each a system's number: `erasureNoteCount`,
`erasurePhotoCount`, `erasureAccountCount`, the siblings' length; no
`.one`/`.other` keys; `catalogue-parity.spec.ts:37-44` bans «остава(т)?
само», which the text avoids); `clientCard.privacy.eraseConfirm` «Изтрий» /
"Erase"; `clientCard.privacy.eraseKeep` «Отказ» / "Cancel";
`clientCard.privacy.erased` «Изтрит клиент» / "Erased client";
`clientCard.privacy.eraseUnfinished` «Изтриването още не е завършило.
Опитай пак.» / "The erasure isn't finished yet. Try again.";
`clientCard.privacy.eraseSibling` (the sibling row, above);
`errors.PRIVACY_ERASURE_STAFF_ACCOUNT` «Профил на служител не може да се
изтрие оттук.» / "A staff account can't be erased here.";
`errors.PRIVACY_ACCOUNT_LINK_MISMATCH` «Профилът не съвпада със записа на
клиента. Свържи се с поддръжката.» / "The account doesn't match the
client's record. Contact support."; `errors.PRIVACY_ERASURE_TOO_LARGE`
«Записите са твърде много за едно изтриване. Свържи се с поддръжката.» /
"There are too many records for one erasure. Contact support.";
`errors.BOOKING_CLIENT_ERASED` «Данните на този клиент са изтрити. Запиши
го без телефон и имейл.» / "This client's data was erased. Book them
without a phone or e-mail." (staff vocabulary; reached through the existing
`wordPipelineError` path, an `E18_WORDS` row).

### 2.E WS-E — the CI pipeline (PE1, PE2)

**The runbook-gates runner** (PE1) — the runbook stays the gates' only
copy:

````js
// tools/verify/runbook-gates/runbook-gates.mjs (pure; node builtins only; the check-layering.mjs idiom)
/** `### 4.N ` sections (prefix + trailing space, so 4.1 ≠ 4.10), each ending at the next `### ` or `## `;
 *  block = the lines between the FIRST ```bash fence and the next ``` (null when none — §4.6). */
export function sectionsOf(markdown) /* → [{ id: '4.2', heading, block: string | null }] */;
/** The script one section runs: the §4.0 preamble, the block, then `[ "$FAILED" = 0 ]` — every block
 *  ends in an echo that would mask its exit code (`firestore-runbook.md:585` and eight more). */
export function scriptFor(preamble, block) /* → string */;
/** Lines starting `ok `, `FAIL `, `ERROR `, `----  review:`; and whether a `gate: PASS` line printed. */
export function tally(log) /* → { ok, fail, error, review, passLine } */;
/** Pass iff exit 0, fail 0, error 0, ok ≥ 1 (an empty extraction is a failure) and the PASS line. */
export function verdict(tallied, exitCode) /* → boolean */;
export const DEFAULT_SKIP = { '4.1': 'superseded — §4.2 step 1 re-runs flip 1 with its exclusions dropped' };

// tools/verify/runbook-gates/run-gates.mjs (CLI; guarded by pathToFileURL(import.meta.url))
//   node tools/verify/runbook-gates/run-gates.mjs [--runbook=docs/architecture/firestore-runbook.md]
//        [--sections=4.2,4.3,…] [--allow-dirty] [--cleanup]
// default sections: every 4.N with a bash block but 4.0 (always prepended) and DEFAULT_SKIP (printed);
// each section's script written to mkdtemp(join(tmpdir(), 'runbook-gates-')) — NEVER inside the repo —
// and run alone: spawnSync('bash', [script], { cwd: repoRoot, encoding: 'utf8' });
// clean-tree guard: `git status --porcelain` empty before the first section (else exit 2 unless
// --allow-dirty); any NEW untracked path after the last (a leaked §4.9 canary) is a FAIL, removed
// with --cleanup (default ON when CI is set); prints `§4.2 ok=28 FAIL=0 ERROR=0 review=2 (<s>s)` per
// section and a summary; exit 0 only if every section passes, 1 on a FAIL / ERROR / leak, 2 on an
// unreadable runbook, a missing bash / git, a missing preamble, an unknown section or a dirty tree.
````

`tools/verify/project.json`: target `runbook-gates` (`nx:run-commands`,
`"cache": false`, `node tools/verify/runbook-gates/run-gates.mjs`, `cwd
{workspaceRoot}`, a `// runbook-gates` comment key: never cached, run
alone); `test.inputs` gain `{workspaceRoot}/docs/architecture/firestore-runbook.md`,
`{workspaceRoot}/.github/**/*`, `{workspaceRoot}/apps/web/e2e/**/*.spec.ts`,
`{workspaceRoot}/apps/web/playwright.config.mts`. Root `package.json`
script `"verify:runbook": "pnpm nx run verify-tools:runbook-gates"` (it
starts no emulator, so `settle-scripts.spec.mjs` ignores it). Runbook §4
intro: one sentence naming the runner (no gate edited).

**The workflow** (PE2):

```yaml
# .github/actions/setup-workspace/action.yml (new composite) — install written once
name: setup-workspace
description: pnpm, Node from .nvmrc with the pnpm store cache, a frozen install
runs:
  using: composite
  steps:
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v5
      with: { node-version-file: '.nvmrc', cache: 'pnpm' }
    - run: pnpm install --frozen-lockfile
      shell: bash

# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}   # never cancel main (nx-set-shas reads its last green run)
jobs:
  main:                                   # name kept: branch protection may require it (§7 item 15)
    runs-on: ubuntu-latest
    timeout-minutes: 45
    permissions: { actions: read, contents: read }
    steps: # today's steps verbatim, except:
      - run: pnpm exec nx affected -t lint test build typecheck --base=$NX_BASE --head=$NX_HEAD   # + typecheck (P3-RU-32)
      # the CSP comment: "The emulator smoke runs in the csp-smoke job (P3-RU-31)."
  static:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v5
      - uses: ./.github/actions/setup-workspace
      - run: pnpm exec nx sync:check
      - run: pnpm exec nx run verify-tools:layering --skip-nx-cache
      - run: pnpm exec nx typecheck seed-tools
      - run: pnpm exec nx test lint-rules
      - run: pnpm run lint:styles
      - run: pnpm run verify:bundle
      - run: pnpm exec nx build functions && node tools/verify/p0/check-functions-deps.mjs
  runbook-gates:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v5
      - uses: ./.github/actions/setup-workspace
      - run: pnpm exec nx run verify-tools:runbook-gates      # alone on its VM: nothing else writes the tree
  coverage:
    runs-on: ubuntu-24.04
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v5
      - uses: ./.github/actions/setup-workspace
      - run: pnpm exec nx test ecs-core --coverage --skip-nx-cache --testTimeout=30000   # thresholds fail the job
  emulators:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v5
      - uses: ./.github/actions/setup-workspace
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: '21' }
      - uses: actions/cache@v4
        with:
          path: ~/.cache/firebase/emulators
          key: firebase-emulators-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
      - run: pnpm run test:emulator
      - run: pnpm run verify:p0                               # after, never beside: they share ports
  e2e:
    runs-on: ubuntu-24.04
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v5
      - uses: ./.github/actions/setup-workspace
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: '21' }
      - uses: actions/cache@v4
        with: { path: ~/.cache/firebase/emulators, key: firebase-emulators-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }} }
      - uses: actions/cache@v4
        with: { path: ~/.cache/ms-playwright, key: playwright-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }} }
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm run e2e:web                               # the config's CI policy: 2 retries, 1 worker (P3-RU-35)
        env:
          CREATIVO_E2E_SCREENSHOTS: skip                      # the macOS full gate is the screenshot gate (P3-RU-30)
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: e2e-report, path: dist/.playwright/apps/web, retention-days: 7 }
  csp-smoke:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps: # checkout, setup-workspace, setup-java 21, the jar and browser caches, playwright install as e2e
      - run: pnpm run verify:csp
```

`apps/web/playwright.config.mts`: `grepInvert:
process.env['CREATIVO_E2E_SCREENSHOTS'] === 'skip' ? /@screenshot/ :
undefined` (a closed switch; any other value runs everything); the four
screenshot describes gain `{ tag: '@screenshot' }`; `retries` and the
preset's `workers` stay as they are (P3-RU-35 — the e2e job's 60-minute
timeout is sized on the preset's one CI worker). No secret but
`GITHUB_TOKEN` (gitleaks, unchanged); `--project demo-creativo-test` is in
every emulator script already; nothing deploys.

---

## 3. Packages — waves and DISJOINT file ownership

**Rules for every package** (the Phase 0–2 rules, carried): re-read each
site before editing; NEVER git commit, push, stash, checkout, reset,
restore, switch or worktree-add (only the orchestrator commits); undo your
own edit by the inverse edit; `git grep` misses untracked files (`grep -r`
for new files and "no caller" proofs); never `pnpm install/add/remove`,
never `nx reset`; never run an emulator journey (`verify:p0`,
`test:emulator`, `e2e:web`, `verify:csp`) — the orchestrator runs them, one
at a time; never run the runbook grep gates themselves (they write a canary
into the repo, which the wave partner's lint would read) — the **name
check** sources the §4.0 arrays from a scratch copy OUTSIDE the repo and
runs EACH array with the flags its gate uses (`-wF` for the `W*` / `M*` /
`T*` / `R9` lists, `-F` for `K*` / `S2` / `F2` and the `'status'` /
`['status']` pair) over the package's ADDED text — the `^+` lines of `git
diff -U0` of its tracked files plus every line of its new untracked files
(K2 binds the `*otp*`, `*registration*`, `*identity*`, `*profile*`,
`*impersonation*` files: no `'status'`, `'purpose'`, `expiresAt:`,
`createdAt:` there); a spec or script reads a root file
(`firestore.indexes.json`, `firestore.rules`, the runbook, `ci.yml`) with
`readFileSync(new URL('…', import.meta.url))` or `resolve(…)` — never an
`import … from '../../../…'` (Law 8.3); typecheck is project-scoped
(`pnpm nx run <project>:typecheck --skip-nx-cache`) — `rm -rf dist/out-tsc
&& run-many -t typecheck` is the orchestrator's. A file not in a package's
list is not its to edit: a forced edit elsewhere is reported, never made.
**At most two builders run at a time**; a wave lists its packages; the next
wave starts when both are back and the orchestrator has checked the tree.
Emulator-only specs a package writes (`*.integration.spec.ts`, the rules
spec, e2e specs) are typechecked / linted by the builder and run by the
orchestrator at the stage boundary. A package's report goes to the
scratchpad (`build-PXn.md`): files touched, checks run with their numbers,
anything forced elsewhere.

| Stage (commit)        | Waves (≤ 2 builders)                                               | Commit boundary                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| C_A — WS-A seed clock | W-A1: PA1 ‖ PA2                                                    | one commit after W-A1 + the stage gate; the late-shop-time run (§6.1 addition 2) follows on the committed tree (§0.5)                            |
| C_B — WS-B identity   | W-B1: PB1 · W-B2: PB2 · W-B3: PB3                                  | one commit after W-B3 + the stage gate (`test:emulator`, `e2e:web` — sign-in now writes rows)                                                    |
| C_C — WS-C export     | W-C1: PC1 · W-C2: PC2 ‖ PC4 · W-C3: PC3 ‖ PC5                      | one commit after W-C3 + the stage gate                                                                                                           |
| C_D — WS-D erasure    | W-D1: PD1 · W-D2: PD2a ‖ PD3b · W-D3: PD2b ‖ PD4 · W-D4: PD3 ‖ PD5 | one commit after W-D4 + the stage gate (the erasure proofs of §4, `verify:p0` (g), the e2e journey)                                              |
| C_E — WS-E CI         | W-E1: PE1 ‖ PE2                                                    | one commit after W-E1 + the FULL gate (§6.1), including the runbook gates run by the NEW runner and compared with the scratch extractor's counts |

Every commit's gate runs on exactly the tree it commits: no wave of the
next workstream starts before the previous stage is committed.

**How C and D share contracts.** C builds the shared files with their
export members only; D extends the SAME files in its own later waves after
C is committed — never in parallel: `errors/privacy.error.ts`,
`components/client-privacy-call.data.ts`, `components/privacy-marker.data.ts`,
`ports/privacy.port.ts`, `ports/callables.ts`, `systems/client-privacy.system.ts`,
`testing/privacy-doubles.ts`, `apps/functions/src/wire/privacy.wire.ts`,
`edge.ts`, `adapters/firestore-privacy.adapter.ts`, `main.ts`,
`main.spec.ts`, the web adapter, the card store / presenter / vm / words /
template and their specs, the i18n catalogues, `libs/ui/icons/src/lib/manifest/icon-vocabulary.ts`,
`apps/web/e2e/support/seed-firestore.ts`, `apps/web/e2e/staff-client-privacy.spec.ts`.
D reads C's committed contracts; no D package starts before `C_C`.
Within a WAVE, two packages never own one file. Across the sequential waves
of one stage a file may have successive owners, each editing on top of the
committed-to-tree work of the one before (the orchestrator checks the tree
between waves); each such file is marked "(sequential: …)" in both
packages' lists:

- C_C: PC1 → PC2 — none; PC4 → PC5 — none (PC5 owns `seed-firestore.ts` alone in C_C).
- C_D: PD1 → PD2a — `components/index.ts`, `entities/identity-entities.type-spec.ts`;
  PD2a → PD2b — `pipelines/index.ts`;
  PD1 → PD2b — `book-appointment.pipeline.spec.ts`, `edit-appointment.pipeline.spec.ts`,
  `complete-registration.pipeline.spec.ts`;
  PD3b → PD5 — `apps/web/e2e/support/seed-firestore.ts` (PD3b adds the key in W-D2; PD5 adds
  helpers in W-D4).

### PA1 — WS-A the seed's instant (W-A1)

- **Files:** `tools/seed/calendar.mjs`, `tools/seed/fixtures.mjs` (the
  re-export only), `tools/seed-dev-catalog.mjs`, `tools/seed/seed-clock.spec.mjs`
  (new), `tools/seed/seed-data.spec.mjs`, `tools/seed/load-domain.spec.mjs`
  (only if its name-equality pin must list the new export),
  `tools/seed/fixtures/README.md`, `tools/verify/p0/seed-run.mjs` (new),
  `tools/verify/p0/seed-run.spec.mjs` (new), `tools/verify/p0/verify-p0.mjs`,
  `tools/verify/p0/README.md`.
- **Brief:** §2.A (seed half). `seedNowOf` throws on a refused text and
  never reads a clock itself (`realNowMs` is a parameter). The stats clock
  (`:712`) stays live with a comment (P3-RU-2). Keep the source-order pins
  of `loyalty.spec.mjs` (one call site changes). `verify-p0.mjs` (a) uses
  ONE instant (`proofInstantOf` → `seedRunEnv`); the settle `since` reads
  stay.
- **Checks:** `pnpm nx test seed-tools`, `pnpm nx typecheck seed-tools`,
  `pnpm nx test verify-tools`, `node --check` on the touched `.mjs`; name
  check (`SEED_NOW`, `seedNowOf`, `SEED_DEFAULT`, `seedRunEnv`,
  `proofInstantOf`).

### PA2 — WS-A the suite's instant and the pinned browser (W-A1)

- **Files:** `apps/web/e2e/support/shop-clock.ts`,
  `apps/web/e2e/support/suite-clock.ts` (new),
  `apps/web/e2e/support/global-setup.ts`, `apps/web/e2e/client-card-glance.spec.ts`,
  `apps/web/e2e/appointments.spec.ts`,
  `apps/web/src/testing/e2e-suite-clock.spec.ts` (new).
- **Brief:** §2.A (e2e half). `stillAheadToday`, `EVENING_START` and
  `LATEST_START` are DELETED (not weakened); `shop-clock.ts`'s live
  `shopToday()` STAYS for the unpinned specs, which are not touched
  (`booking-core.spec.ts`, `csp/csp-smoke.spec.ts`, `staff-walk-in.spec.ts`,
  `programs.spec.ts`, `support/booking-days.ts` — P3-L-1). The glance's
  `history-upcoming` / pill assertions (`client-card-glance.spec.ts:464-469`)
  are unchanged. `pinBrowserClock` is the first statement of the three
  pinned tests, whose "today" is `suiteDay()`. `fixSuiteInstant()` is the
  first statement of global setup, which alone checks the real day.
  `seededFrom` (`global-setup.ts:47`) and `since`
  (`client-card-glance.spec.ts:128`) stay `Date.now()` (operational).
- **Checks:** `pnpm nx lint web`, `pnpm nx test web` (the new
  `src/testing` spec), `grep -rn "Date.now()" apps/web/e2e` = exactly the
  operational reads (`global-setup.ts`, `seed-firestore.ts:478`,
  `client-card-glance.spec.ts:128`), `shop-clock.ts`'s live `shopToday()`
  and `suite-clock.ts`'s `fixSuiteInstant`; name check (`E2E_NOW`,
  `fixSuiteInstant`, `resolveSuiteInstant`, `suiteNowUtcMs`, `suiteDay`,
  `pinBrowserClock`, `browserNowUtcMs`, `browserPinOf`, `instantOfText`,
  `BROWSER_PIN_MINUTE`, `EVENING_VISIT_START`).

### PB1 — WS-B ecs-core contracts and systems (W-B1)

- **Files:** `libs/ecs-core/src/components/otp-refusal-reason.data.ts`
  (new), `otp-refusal-reason.data.spec.ts` (new), `components/actor.data.ts`,
  `actor.data.spec.ts`, `components/audit-context.data.ts`,
  `audit-context.data.spec.ts`, `components/index.ts`,
  `components/identity-dictionaries.type-spec.ts`,
  `primitives/ids.primitive.ts`, `ids.primitive.spec.ts`,
  `systems/audit.system.ts`, `audit.system.spec.ts`, `systems/otp.system.ts`,
  `otp.system.spec.ts`, `systems/identity-audit.system.ts` (new),
  `identity-audit.system.spec.ts` (new), `systems/index.ts`,
  `entities/identity-entities.type-spec.ts`.
- **Brief:** §2.B (contracts, `IdentityAuditSystem`, `OtpSystem.refusalReasonOf`,
  `AuditSystem.idBasisOf` + the five change keys, `forOtp`). The regex in
  `audit-context.data.spec.ts:59-61` gains `IDENTITY`; the partition's
  `Singles` gains the five verbs. `idBasisOf` returns `rowBasis`'s exact
  bytes (a spec pins one existing row id unchanged) and types `targetId`
  as `CustomerId | UserId | null`. The three pre-session planners take no
  operation id (`auditOperationId: null`, P3-L-20).
- **Checks:** `pnpm nx test ecs-core`, `pnpm nx run ecs-core:typecheck
--skip-nx-cache`, `pnpm nx lint ecs-core`, `pnpm nx run
verify-tools:layering --skip-nx-cache`; name check (every name of §2.B).

### PB2 — WS-B the three identity pipelines (W-B2)

- **Files:** `libs/ecs-core/src/ports/identity.port.ts`,
  `pipelines/request-otp.pipeline.ts`, `request-otp.pipeline.spec.ts`,
  `pipelines/verify-otp.pipeline.ts`, `verify-otp.pipeline.spec.ts`,
  `pipelines/complete-registration.pipeline.ts`,
  `complete-registration.pipeline.spec.ts`, `testing/port-doubles.ts`,
  `testing/port-doubles.spec.ts`, `entities/otp.entity.ts` (doc comment).
- **Brief:** §2.B pipelines. The memory identity world drops `saveOtp`
  and serves the request's commit through its tx double. Every existing
  verdict, answer and log line is unchanged; the plan assertions change on
  purpose (§4 PB2). Downstream `functions` is red until W-B3 (the adapter
  still returns `saveOtp`) — expected.
- **Checks:** `pnpm nx test ecs-core`, `pnpm nx run ecs-core:typecheck
--skip-nx-cache`, `pnpm nx lint ecs-core`; `grep -rn "saveOtp" libs` = 0;
  name check.

### PB3 — WS-B functions, indexes and the runbook (W-B3)

- **Files:** `apps/functions/src/wire/identity.wire.ts`,
  `identity.wire.spec.ts`, `adapters/firestore-otps.adapter.ts`,
  `firestore-otps.adapter.spec.ts`, `adapters/firestore-ports.spec.ts`,
  `adapters/firestore-ttl.adapter.ts` (comment), `main.spec.ts` (only an
  added assertion that the identity ports carry `commit` and `hash`),
  `integration/verify-otp.integration.spec.ts`,
  `integration/complete-registration.integration.spec.ts`,
  `integration/request-otp.integration.spec.ts` (new),
  `firestore.indexes.json`, `tools/verify/indexes/audit-indexes.spec.mjs`
  (only if an assertion lists the override set), `docs/architecture/firestore-runbook.md`
  (§1.1 `otps` / `auditLog` writer rows; §2.5 one line: identity rows are
  permanent like every audit row).
- **Brief:** §2.B functions; the decoders read the optional transport id;
  `request-otp.integration.spec.ts` pins the moved `purgeAt` (TTL
  invariant).
- **Checks:** `pnpm nx test functions`, `pnpm nx run functions:typecheck
--skip-nx-cache`, `pnpm nx lint functions`, `pnpm nx test verify-tools`,
  `grep -rn "saveOtp" apps libs` = 0; name check.

### PC1 — WS-C ecs-core contracts (W-C1)

- **Files:** `libs/ecs-core/src/errors/privacy.error.ts` (new),
  `privacy.error.spec.ts` (new), `errors/index.ts`,
  `components/privacy-marker.data.ts` (new), `privacy-marker.data.spec.ts`
  (new), `components/client-privacy-call.data.ts` (new),
  `client-privacy-call.data.spec.ts` (new), `components/roles.data.ts`,
  `roles.data.spec.ts`, `components/role.rules-parity.spec.ts` (its header
  names `PRIVACY` callable-only), `components/audit-context.data.ts`,
  `audit-context.data.spec.ts`, `components/index.ts`,
  `primitives/ids.primitive.ts`, `ids.primitive.spec.ts`,
  `primitives/log-event.data.ts`, `log-event.data.spec.ts`,
  `entities/identity-entities.type-spec.ts`, `ports/callables.ts`,
  `callables.spec.ts`, `ports/privacy.port.ts` (new), `ports/index.ts`,
  `systems/audit.system.ts` (`changeKey.clientExported`),
  `audit.system.spec.ts`.
- **Brief:** §2.C contracts. `ClientFootprintPorts` reuses the `LoadProfile`
  TYPE (no `LoadAccountById`) and declares `ListPhotosOfClient`; every
  list port takes `limit`. The regex gains `PRIVACY`; `Singles` gains
  `PrivacyClientExported`; `LogEvent.PrivacyClientExported` (its value
  `'privacy.client_exported'` pinned in `log-event.data.spec.ts`).
  Downstream `functions` (`main.spec.ts` "every callable the web dials")
  is red until W-C3 — expected.
- **Checks:** as PB1; name check.

### PC2 — WS-C systems, the pipeline and the doubles (W-C2)

- **Files:** `systems/canonical-json.system.ts`,
  `canonical-json.system.spec.ts`, `systems/client-issue.system.ts` (calls
  the moved `utf8Bytes`; nothing else), `systems/client-privacy.system.ts`
  (new), `client-privacy.system.spec.ts` (new),
  `systems/client-export.system.ts` (new), `client-export.system.spec.ts`
  (new), `systems/index.ts`, `pipelines/export-client-data.pipeline.ts`
  (new), `export-client-data.pipeline.spec.ts` (new), `pipelines/index.ts`,
  `testing/privacy-doubles.ts` (new — the memory footprint, the memory
  audit timelines, a flag double; `Partial<TheBundle>` overrides, never a
  `Pick`), `testing/index.ts`.
- **Brief:** §2.C systems and pipeline. `contactIsPersons` carries the
  keyed-hash arm (P3-RU-36); the bundle omits every voucher `code` and the
  call's own row (`ownRowId`); the pipeline depends on `WalkInKeyPorts`
  and `AuditTimelinePorts`. `client-issue.system.spec.ts` passes unchanged
  (the move is behaviour-neutral).
- **Checks:** `pnpm nx test ecs-core`, `pnpm nx test ecs-core --coverage
--testTimeout=30000` (the new system and pipeline files ≥ 95 %
  statements), typecheck, lint, layering; name check.

### PC4 — WS-C the card's export (W-C2, beside PC2)

- **Files:** `libs/infrastructure/firebase-app/src/lib/client-privacy.adapter.ts`
  (new), `client-privacy.adapter.spec.ts` (new),
  `libs/infrastructure/firebase-app/src/lib/ports.tokens.ts`,
  `libs/infrastructure/firebase-app/src/index.ts`,
  `apps/web/src/app/app.config.ts`,
  `libs/features/staff/client-card/src/lib/client-card.store.ts`,
  `client-card.store.spec.ts`, `client-privacy.presenter.ts` (new),
  `client-privacy.presenter.spec.ts` (new), `client-pages.vm.ts`,
  `client-card.words.ts`, `client-card.words.spec.ts`,
  `client-card/client-card.ts`, `client-card/client-card.html`,
  `client-card/client-card.spec.ts`,
  `libs/infrastructure/i18n/src/assets/i18n/bg.json`, `en.json`,
  `libs/infrastructure/i18n/src/lib/word-pipeline-error.spec.ts`,
  `libs/ui/icons/src/lib/manifest/icon-vocabulary.ts` (`client.export` →
  `receipt_long` only), `icon-vocabulary.spec.ts` (its `GLYPHS` row),
  `config/feature-flags.json` (`development."client.privacy": true` only).
- **Brief:** §2.C web. The block is absent without the port, the flag, an
  admin viewer, a known record or the network — so every existing card
  spec and the overview's `toEqual`s pass unchanged (§4). The download
  lives in the component; the store never touches the DOM.
- **Checks:** `pnpm nx test staff-client-card`, `pnpm nx test
firebase-app`, `pnpm nx test i18n`, `pnpm nx test icons`, typecheck and
  lint of the four and `web`, `pnpm run icons:check`, `pnpm nx build web &&
pnpm run verify:bundle`; name check.

### PC3 — WS-C functions (W-C3)

- **Files:** `apps/functions/src/wire/privacy.wire.ts` (new),
  `privacy.wire.spec.ts` (new), `apps/functions/src/edge.ts`,
  `edge.spec.ts`, `adapters/firestore-privacy.adapter.ts` (new),
  `firestore-privacy.adapter.spec.ts` (new),
  `adapters/firestore-audit-read.adapter.ts` (new),
  `firestore-audit-read.adapter.spec.ts` (new), `apps/functions/src/main.ts`,
  `main.spec.ts`, `integration/export-client-data.integration.spec.ts`
  (new), `firestore.indexes.json`.
- **Brief:** §2.C functions. `main.ts`'s header "47 exports" → 48; the
  `main.spec.ts` title, `EXPORTS`, `ENDPOINTS` row (bound to
  `WALK_IN_SECRETS`; the `:176` comment widened), a `FLIPPED` case and
  `toHaveLength(48)`; `privacyPorts` spreads `walkInKeyPorts(walkInKey)`;
  `firestoreAuditReadPorts(db): AuditTimelinePorts`.
- **Checks:** `pnpm nx test functions`, typecheck, lint, `pnpm nx build
functions && node tools/verify/p0/check-functions-deps.mjs` (four
  dependencies), `pnpm nx test verify-tools`; name check.

### PC5 — WS-C the export journey and the docs (W-C3, beside PC3)

- **Files:** `apps/web/e2e/staff-client-privacy.spec.ts` (new — the export
  test), `apps/web/e2e/support/seed-firestore.ts` (additive only:
  `seedUserProfile` gains a `roles` override, default `[Role.Client]`
  unchanged, so the admin caller's `users/{uid}` is seeded with
  `['admin']` — the pipelines re-read STORED roles, P3-RU-13, and
  `signInAs` writes claims only, `sign-in.ts:39-41`), `docs/architecture/firestore-runbook.md` (§1.1 the
  export's reads, §3 the new callable, flag dark),
  `docs/production-deploy.md` (48 functions; the `client.privacy` line).
- **Brief:** the journey of §4 PC5. Chromium project only (not a
  `client-card-*` name: the three-viewport projects stay as they are). The
  admin's stored roles are seeded before the journey (else every call
  answers `PRIVACY_FORBIDDEN`).
- **Checks:** `pnpm nx lint web`; name check.

### PD1 — WS-D the record's slice, the guard and every ecs-core literal (W-D1)

- **Files:** `libs/ecs-core/src/components/erasure-lifecycle.data.ts`
  (new), `erasure-lifecycle.data.spec.ts` (new), `components/index.ts`
  (sequential: → PD2a),
  `components/account-status.data.ts`, `account-status.data.spec.ts`,
  `components/identity-dictionaries.type-spec.ts`,
  `components/customer-origin.data.spec.ts`, `entities/customer.entity.ts`,
  `entities/identity-entities.type-spec.ts` (sequential: → PD2a),
  `systems/stored-document.system.ts`, `stored-document.system.spec.ts`,
  `systems/customer-record.system.ts`, `customer-record.system.spec.ts`,
  `systems/client-glance.system.ts`, `client-glance.system.spec.ts`,
  `testing/identity.fixtures.ts`, `identity.fixtures.spec.ts`,
  `testing/port-doubles.spec.ts`, `pipelines/book-appointment.pipeline.spec.ts`,
  `edit-appointment.pipeline.spec.ts`, `complete-registration.pipeline.spec.ts`
  (the three: customer literals only; sequential: → PD2b).
- **Brief:** §2.D record slice and account variant. Every created
  customer body carries `erasureStatus: 'NONE'`; the guard is strict.
  Downstream projects (functions integration, features, infrastructure,
  seed) are red until W-D2's PD3b — expected.
- **Checks:** `pnpm nx test ecs-core`, typecheck, lint, layering; name
  check (`ErasureStatus`, `ErasureLifecycle`, `erasureStatus`,
  `erasureStartedAtUtcMs`, `erasedAtUtcMs`, `accountErasedAtUtcMs`).

### PD2a — WS-D the audit vocabulary, the call, the ports, the browser loop (W-D2)

- **Files:** `components/erasure-census.data.ts` (new),
  `erasure-census.data.spec.ts` (new), `components/erasure-action.data.ts`
  (new), `components/erasure-offer.data.ts` (new),
  `erasure-offer.data.spec.ts` (new), `components/audit-context.data.ts`,
  `audit-context.data.spec.ts`, `components/write-provenance.data.ts` (doc
  comment only: "booking-verb, registration or privacy callable"),
  `components/client-privacy-call.data.ts`, `client-privacy-call.data.spec.ts`,
  `components/index.ts` (sequential: PD1 →), `errors/privacy.error.ts`,
  `privacy.error.spec.ts`, `errors/booking.error.ts`, `booking.error.spec.ts`,
  `entities/identity-entities.type-spec.ts` (sequential: PD1 →),
  `ports/callables.ts`, `callables.spec.ts`, `ports/privacy.port.ts`,
  `systems/audit.system.ts` (three change keys), `audit.system.spec.ts`,
  `systems/client-privacy.system.ts` (`linkOf` — P3-RU-37 (h), `siblingIdsOf`, `erasureOffer` — W-D3's
  PD2b and PD4 both read them), `client-privacy.system.spec.ts`,
  `pipelines/complete-client-erasure.pipeline.ts` (new),
  `complete-client-erasure.pipeline.spec.ts` (new), `pipelines/index.ts`
  (sequential: → PD2b), `testing/privacy-doubles.ts` (the two new
  footprint reads and the Auth roles / Auth / object eraser doubles — the
  bundles it implements change here).
- **Brief:** §2.D vocabulary (eleven census counts, three erasure verbs,
  three new `PRIVACY_` codes, `ErasureOffer`), call (the preview's
  sibling ids), ports (`AuthRolesPorts` split from `AuthEraserPorts`), the
  two pure `ClientPrivacySystem` helpers the next wave reads, and the
  browser loop. Downstream
  `web` (the gateway adapter returns the widened bundle) and `functions`
  (`main.spec.ts` "every callable the web dials") are red until W-D3 / W-D4
  — expected.
- **Checks:** as PB1.

### PD3b — WS-D the customer literals outside ecs-core (W-D2, beside PD2a)

- **Files:** `apps/functions/src/integration/audit-in-commit.integration.spec.ts`,
  `book-appointment.integration.spec.ts`,
  `complete-registration.integration.spec.ts`,
  `coupon-grant-burn.integration.spec.ts`,
  `edit-appointment.integration.spec.ts`, `apps/web/e2e/support/seed-firestore.ts`
  (sequential: → PD5),
  `libs/features/staff/client-card/src/testing/client-card.fixtures.ts`,
  `libs/features/staff/dashboard/src/lib/visit-editor/client-search.spec.ts`,
  `staff-visit-editor.spec.ts`,
  `libs/infrastructure/firestore/src/lib/customers.adapter.spec.ts`,
  `firestore.rules.integration.spec.ts`,
  `tools/seed/fixtures/customers.fixtures.ts`, `tools/seed/seed-data.spec.mjs`.
- **Brief:** add `erasureStatus: 'NONE'` (or `...ErasureLifecycle.none()`)
  to every customer body; nothing else. Each edit is a key added to a
  literal the type now requires (§5 P3-DEP-16).
- **Checks:** `pnpm nx test staff-client-card`, `pnpm nx test
staff-dashboard`, `pnpm nx test firestore`, `pnpm nx test seed-tools`,
  `pnpm nx typecheck seed-tools`, typecheck of `functions`, `web`
  (e2e lint), lint of the five projects; `grep -rln "customerOrigin:"
libs apps tools` — every hit but the seed's comment
  (`tools/seed-dev-catalog.mjs:533`) and the type
  (`entities/customer.entity.ts`) also writes `erasureStatus` (the §6.2
  check excludes those two).

### PD2b — WS-D the decisions and the pipelines (W-D3)

- **Files:** `systems/client-erasure.system.ts` (new),
  `client-erasure.system.spec.ts` (new), `systems/index.ts`, `registration.system.spec.ts` (cases only — the
  existing refusal of an erased account pinned; no production change),
  `systems/profile-edit.system.ts`, `profile-edit.system.spec.ts`,
  `primitives/log-event.data.ts`, `log-event.data.spec.ts`,
  `pipelines/erase-client.pipeline.ts` (new), `erase-client.pipeline.spec.ts`
  (new), `pipelines/index.ts` (sequential: PD2a →),
  `pipelines/book-appointment.pipeline.ts`,
  `book-appointment.pipeline.spec.ts` (sequential: PD1 →),
  `pipelines/edit-appointment.pipeline.ts`,
  `edit-appointment.pipeline.spec.ts` (sequential: PD1 →),
  `complete-registration.pipeline.spec.ts` (sequential: PD1 →; cases only),
  `pipelines/export-client-data.pipeline.ts`,
  `export-client-data.pipeline.spec.ts` (the link arm only — P3-RU-37 (h)).
- **Brief:** §2.D decisions and pipeline. The export refuses
  `PRIVACY_ACCOUNT_LINK_MISMATCH` through `ClientPrivacySystem.linkOf`
  before any uid-keyed read (P3-RU-37 (h)), as the preview and the erasure do. The guard is pure and reads only
  what the decide already holds (each id in the map that holds it); ONE
  new refusal arm (`ProfileEditSystem.decide`), the other two existing
  refusals pinned by spec; `eraseClient` follows the eight steps exactly
  (the link check, the caps, dirty-only chunks, the ERASED re-sweep,
  `writeOperationId` on every write).
- **Checks:** ecs-core test, coverage (new files ≥ 95 %), typecheck, lint,
  layering; name check.

### PD4 — WS-D the card's erasure (W-D3, beside PD2b)

- **Files:** `libs/infrastructure/firebase-app/src/lib/client-privacy.adapter.ts`,
  `client-privacy.adapter.spec.ts`,
  `libs/features/staff/client-card/src/lib/client-card.store.ts`,
  `client-card.store.spec.ts`, `client-privacy.presenter.ts`,
  `client-privacy.presenter.spec.ts`, `client-pages.vm.ts`,
  `client-card.words.ts`, `client-card.words.spec.ts`,
  `client-card/client-card.ts`, `client-card/client-card.html`,
  `client-card/client-card.spec.ts`,
  `libs/infrastructure/i18n/src/assets/i18n/bg.json`, `en.json`,
  `libs/infrastructure/i18n/src/lib/word-pipeline-error.spec.ts`,
  `libs/ui/icons/src/lib/manifest/icon-vocabulary.ts` (`client.erase` →
  `delete` only), `icon-vocabulary.spec.ts` (its `GLYPHS` row).
- **Brief:** §2.D web. One `ui-alert`, the census and siblings from the
  preview, ONE pending `ClientPrivacyCall` captured at preview and sent
  verbatim at confirm (cleared on dismiss or a change of person), the
  offer from `erasureOffer`, the sibling rows, the loop through
  `completeClientErasure` (PD2a) with ONE minted id per act.
- **Checks:** as PC4.

### PD3 — WS-D functions, the erasure proof, `verify:p0` (g) (W-D4)

- **Files:** `apps/functions/src/wire/privacy.wire.ts`,
  `privacy.wire.spec.ts`, `apps/functions/src/edge.ts`, `edge.spec.ts`,
  `adapters/firestore-privacy.adapter.ts`, `firestore-privacy.adapter.spec.ts`,
  `adapters/firebase-auth-eraser.adapter.ts` (new),
  `firebase-auth-eraser.adapter.spec.ts` (new),
  `adapters/storage-objects.adapter.ts` (new),
  `storage-objects.adapter.spec.ts` (new), `lib/firebase-admin.ts`,
  `apps/functions/src/main.ts`, `main.spec.ts`,
  `integration/erase-client.integration.spec.ts` (new),
  `integration/export-client-data.integration.spec.ts` (the link-mismatch
  case and the dropped `purgeAt` — P3-RU-37 (h), (i)),
  `firestore.indexes.json`, `package.json` (`test:emulator` `--only` only),
  `firestore.rules` (three COMMENTS only — no rule change),
  `libs/infrastructure/firestore/src/lib/visit-media-writers.integration.spec.ts`
  (the `:57` comment only), `tools/verify/p0/verify-p0.mjs` ((g)).
- **Brief:** §2.D functions and the proofs of §4 PD3. "48 exports" → 50;
  both callables bound to `WALK_IN_SECRETS`; the adapters' failures carry
  codes only (never an Auth message, a destination or a path's person).
  The export's footprint reads omit the adapter-stamped `purgeAt`
  (P3-RU-37 (i)); `PRIVACY_ACCOUNT_LINK_MISMATCH` is one `PRIVACY_WIRE` row
  for all three callables.
- **Checks:** `pnpm nx test functions`, typecheck, lint, `pnpm nx build
functions && node tools/verify/p0/check-functions-deps.mjs` (still
  four), `pnpm nx test verify-tools`, `pnpm nx test seed-tools`
  (`settle-scripts.spec.mjs` reads `package.json`), `pnpm nx lint
firestore` (the spec comment); name check.

### PD5 — WS-D the erasure journey and the docs (W-D4, beside PD3)

- **Files:** `apps/web/e2e/staff-client-privacy.spec.ts` (the erasure
  test), `apps/web/e2e/support/seed-firestore.ts` (sequential: PD3b →;
  additive helpers only: a RUN-UNIQUE person — account, Auth user, record,
  a visit with a contact, a note and a photo — and an Admin-SDK read of a
  record / visit), `docs/architecture/firestore-runbook.md` (§1.1 the
  erasure's READER rows — `impersonationSessions`, `otps`,
  `users/{uid}/notifications`, `waitlistRequests`, `invitations` — and
  WRITER rows; §2.5 retention: erased persons, PITR / backups, Storage
  soft delete, OTPs that escape the sweep; §3 deploy: three callables, the
  Auth and Storage permissions the default service account holds,
  `WALKIN_ID_KEY` bound to them, `client.privacy` dark),
  `docs/production-deploy.md` (50 functions; the privacy flag; the default
  Storage bucket; the backups bullet gains the Storage soft-delete window
  for erased objects; a short "Data-subject requests" item: the card path
  for an account client, a walk-in-only record reached as a SIBLING of an
  account's preview or — with no account at all — not servable from the
  UI in Phase 3 (§7 item 11), the export cap and the erasure cap
  refusals), `tools/verify/p0/README.md` ((g)).
- **Checks:** `pnpm nx lint web`; name check.

### PE1 — WS-E the committed runbook-gates runner (W-E1)

- **Files:** `tools/verify/runbook-gates/runbook-gates.mjs` (new),
  `run-gates.mjs` (new), `runbook-gates.spec.mjs` (new),
  `tools/verify/project.json`, `package.json` (the `verify:runbook` script
  only), `docs/architecture/firestore-runbook.md` (§4 intro, one sentence).
- **Brief:** §2.E runner. Fixtures in the spec are built from neutral
  words (never a gate's forbidden spelling, even in a fake runbook); the
  real-runbook case asserts the section ids `4.0 … 4.10`, `4.6` without a
  block, every other block starting `FAILED=0` and ending in its `gate:`
  echo. Node builtins only (no YAML or markdown package — hard limit).
- **Checks:** `pnpm nx test verify-tools`, `pnpm nx lint verify-tools`
  (if the target exists), `node --check`, `pnpm exec prettier --check`
  on the new files; name check. The builder does NOT run the runner on
  the repo (the orchestrator does, alone).

### PE2 — WS-E the workflow and the screenshot switch (W-E1, beside PE1)

- **Files:** `.github/workflows/ci.yml`,
  `.github/actions/setup-workspace/action.yml` (new),
  `tools/verify/ci/ci-workflow.spec.mjs` (new),
  `tools/verify/ci/e2e-screenshot-tag.spec.mjs` (new),
  `apps/web/e2e/account-dashboard-screenshots.spec.ts`,
  `appointments-screenshots.spec.ts`, `auth-onboarding-screenshots.spec.ts`,
  `landing-screenshots.spec.ts` (the `tag` option only),
  `apps/web/playwright.config.mts`, `docs/production-deploy.md` (the CI
  sentence `:576-578` and the `ci.yml` line references).
- **Brief:** §2.E workflow. The specs are text-level (no YAML parser).
  `playwright.config.mts` gains the closed switch only; its `retries`
  line and the preset's workers stay (P3-RU-35).
- **Checks:** `pnpm nx test verify-tools`, `pnpm nx lint web`,
  `pnpm exec prettier --check .github apps/web/playwright.config.mts
tools/verify/ci`; name check.

---

## 4. Specs per package (added / changed ON PURPOSE)

Specs never read the wall clock (pinned `nowUtcMs`, `FIXTURE_NOW`); every
new system spec has the purity case (`deepFreeze`d inputs, same input →
same output); every PII-bearing input in a spec carries SENTINEL values
(`'Sentinel Firstname'`, `'+359880000777'`, `'sentinel@example.invalid'`,
`'sentinel note text'`, `'Sentinel Label'`) so a scan proves absence by
string search over the serialised rows, writes and log lines.

| Package | Added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Changed on purpose (DEP)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PA1     | `tools/seed/seed-clock.spec.mjs` — `seedNowOf`: no flag and no env → `realNowMs`; digits; `2026-10-27T23:40` (shop wall clock) equals its `+02:00` and `Z` forms; `--now=` beats `SEED_NOW`; empty / garbage / negative / fractional throw; a spring-forward gap (`2026-03-29T03:30`) throws naming `DST_GAP_INVALID_TIME`; a fall-back repeat (`2026-10-25T03:30`) takes the earlier offset; the script text still holds `nowUtcMs: () => Date.now()` (P3-RU-2, the `loyalty.spec.mjs:685-700` read-the-source idiom). `seed-data.spec.mjs` + — `buildClientBook` builds, with stable ids, at every 5-minute instant of a Monday, a Sunday and the fall-back day (3 × 288 anchors, 23:40 among them); two calls with one instant are equal. `tools/verify/p0/seed-run.spec.mjs` — `seedRunEnv` sets `SEED_NOW` and keeps the rest; `proofInstantOf` prefers a valid `SEED_NOW`, throws on a malformed one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `tools/verify/p0/verify-p0.mjs` (a) — one instant for both runs (P3-DEP-2); the seed's `--now` is additive (P3-DEP-1)                                                                                                                                                                                                                                                                                                                                           |
| PA2     | `apps/web/src/testing/e2e-suite-clock.spec.ts` — `instantOfText` (the PA1 grammar, the same cases); `browserPinOf(day)` is `day` 10:00 on `Europe/Sofia` across both DST changes; `EVENING_VISIT_START` 21:00 ends 21:30 for the 30-minute chair (a `MinuteOfDay` < 1440); `resolveSuiteInstant` — `null` → the real instant, a text on the real shop day → its instant (23:40 included), a text on another shop day → throws, and it is the ONLY function that checks the day (workers trust the inherited `E2E_NOW`: a worker restarted after the real midnight keeps the run's day).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `client-card-glance.spec.ts` (`:31` import, `:162`, `:197` the seed start, `:364` and `:707` pinned first), `appointments.spec.ts` (`:9` import, `:100` pinned first), `support/shop-clock.ts` (three members deleted, the live `shopToday()` kept), `support/global-setup.ts` (`fixSuiteInstant()` first, `--now`) — P3-DEP-3, P3-DEP-4; the unpinned specs are untouched                                                                                      |
| PB1     | `otp-refusal-reason.data.spec.ts` (values once, SCREAMING); `identity-audit.system.spec.ts` — per planner: the exact row (actor `SYSTEM` / `IDENTITY_CALLABLE`, resource `otps/<id>` or `users/<uid>`, target, `auditOperationId` — `null` on the three pre-session rows even when the command carried one, the id on SESSION / REGISTRATION —, `recordedAtUtcMs`), the id basis, distinct ids for attempts 1 and 2, the same id for the same attempt (a replay), purity, and the PII scan (the serialised row holds no destination, code hash, salt or sentinel); `otp.system.spec.ts` + `refusalReasonOf` at `maxAttempts − 2`, `− 1` (→ `LOCKED_OUT`), success, every non-recording refusal (→ `null`); `ids.primitive.spec.ts` + `forOtp` and its restated `'otps'` = `Collections.Otps`; `audit.system.spec.ts` + `idBasisOf` returns `rowBasis`'s bytes (one stored row id unchanged), the five change keys; `actor.data.spec.ts` + `IDENTITY_CALLABLE`; type-specs: each new variant narrows, its keys are disjoint from `Actor`, `AuditTargetRef`, `AuditEntryMeta`, `AuditEntry` is not `never`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `audit-context.data.spec.ts:59-61` regex (+ `IDENTITY`) and the partition's `Singles` (+ five) — P3-DEP-7                                                                                                                                                                                                                                                                                                                                                       |
| PB2     | `request-otp.pipeline.spec.ts` + the committed plan is `[Set otps/<id>, Create auditLog/<id>]`; cooldown / channel / identifier refusals plan nothing; `SEND_UNAVAILABLE` leaves the plan committed (one row) and logs `OtpSendFailed` as today; a commit failure answers the store failure; PII scan of the plan's row. `verify-otp.pipeline.spec.ts` + success → `[consume Update, VERIFIED Create]`; wrong code → `[attempt Update, REFUSED Create (WRONG_CODE)]`; the attempt reaching `maxAttempts` → `LOCKED_OUT`; the same wrong code twice → two rows, distinct ids; a retry after consumption → `ALREADY_CONSUMED`, no write; the session commit after the mint holds one `SESSION_ISSUED` row naming the account (NEW and RETURNING); a mint failure → no session row; a session-commit failure → the store failure, no token. `complete-registration.pipeline.spec.ts` + the first completion adds one `REGISTRATION_COMPLETED` row credited `Actor.forCaller(uid, stored roles)`; a re-run on `REGISTERED` plans none; forbidden / not-found / refused profile plan nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `request-otp.pipeline.spec.ts` rig (`saveOtp` → the tx double; the `saveOtp`-failure case `:456-477` becomes a commit-failure case), `verify-otp.pipeline.spec.ts:120`, `:136` (plans gain the row), `complete-registration.pipeline.spec.ts` plan assertions; `port-doubles.spec.ts:1121` (`saveOtp` case deleted) — P3-DEP-6, P3-DEP-7                                                                                                                        |
| PB3     | `identity.wire.spec.ts` + both decoders carry `operationId` (valid → id, absent / malformed → `null`, never refused); `request-otp.integration.spec.ts` (new, emulator): one request → the `otps` document and exactly one `IDENTITY_OTP_REQUESTED` row (its `auditOperationId` `null`); the committed `otps/<id>` carries a `purgeAt` Timestamp equal to `purgeAtFor` (expiry + 24 h — the TTL invariant after the `saveOtp` move); a failed commit leaves neither; no row field holds the destination. `verify-otp.integration.spec.ts` + rows per verdict (verified, refused, locked), no row on expired / consumed / not-found, the session row names the uid, a scan of every `auditLog` document after a full sign-in finds neither the destination nor the code. `complete-registration.integration.spec.ts` + one row on the first completion, none on the re-run (`:183`), none on the forbidden call (`:199`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `firestore-otps.adapter.spec.ts:38`, `:106` (the `saveOtp` cases deleted), `firestore-ports.spec.ts:81`, `:111` (the key list loses `saveOtp`) — P3-DEP-6                                                                                                                                                                                                                                                                                                       |
| PC1     | `privacy.error.spec.ts` (factories, SCREAMING, prefix, `InvalidInput` names its field); `privacy-marker.data.spec.ts` (`TEXT`, `seatLabel(1…3)` valid `SeatLabel`s, `isMarker`); `client-privacy-call.data.spec.ts` (`decodeExported`: a usable answer; a missing field or another version → `PIPELINE_UNKNOWN`); `roles.data.spec.ts` + `handlesClientPrivacy` (admin yes; sysadmin, barber, receptionist, client no); `callables.spec.ts` totality holds by construction (the new row is `'operationId'`); `ids.primitive.spec.ts` + `forCustomer`; `log-event.data.spec.ts` + the value; type-spec lines for `ClientExported`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `audit-context.data.spec.ts` regex (+ `PRIVACY`) and `Singles` (+1); `role.rules-parity.spec.ts` header comment only — P3-DEP-10                                                                                                                                                                                                                                                                                                                                |
| PC2     | `canonical-json.system.spec.ts` + `utf8Bytes` (ASCII, Cyrillic, astral — the cases `client-issue.system.spec.ts` already pins, moved by reference, not deleted there); `client-privacy.system.spec.ts` — purity; `isSoleSubject` (solo, party, walk-in seat, anonymous seat); `contactKeyOf`; `contactIsPersons` (owner record → true, owner account → true, a staff walk-in W + an ANONYMOUS companion with no account — the request built by `StaffEditPlanSystem.bookingRequest`, so the contact is W's — → true by the keyed-hash arm, a party owned by Q → false, a sole-subject visit carrying a third person's contact → false); `photoIsPersons`. `client-export.system.spec.ts` — purity; **every section present** for a footprint holding one of each; **deterministic**: the same footprint shuffled → byte-identical `json`; key order canonical; `appointments` by `utcEpochMs` desc then id; audit rows `chronological`; **nothing of another person**: a shared visit's other seats' labels are markers and a contact not provably P's is `NONE`, the other person's sentinel never appears in `json`; **no bearer capability**: no voucher `code` anywhere in `json` (Q's code on a party visit paid with Q's voucher, and P's own vouchers' codes), no photo `url`; party-visit notes absent; `url` absent from every photo; **the cap**: documents `cap − 1`, `cap` pass, `cap + 1` refuses; bytes at `EXPORT_MAX_BYTES` passes, `+ 1` refuses; never a truncated answer; `planClientExported` row exact, counts only; the row whose id is `ownRowId` never appears in `auditLog`. `export-client-data.pipeline.spec.ts` — flag off → `UNAVAILABLE` before any read; stored roles not admin (claims said admin) → `FORBIDDEN`; unknown record → `CLIENT_NOT_FOUND`; a list over the cap → `EXPORT_TOO_LARGE` with NO commit; the ONE commit holds the row; a replay (the row id present in the probe read and the row among the timeline's rows) commits nothing and answers the same bytes under the pinned clock; the log line holds counts and ids only (no sentinel, no `exportJson`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | none (`client-issue.system.spec.ts` passes unchanged)                                                                                                                                                                                                                                                                                                                                                                                                           |
| PC4     | `client-privacy.adapter.spec.ts` (dials `exportClientData`, input untouched, `PipelineError` passthrough); `client-privacy.presenter.spec.ts` (bg + en words; the done line; a refusal's words through `wordPipelineError`); `client-card.store.spec.ts` + a `describe`: `privacy` is `null` without the port / flag off / a barber or sysadmin viewer / no record / offline; one id minted per act and reused on its retry; the answer reaches the component; `client-card.spec.ts` + a `describe`: the block sits AFTER `client-exits` and renders on a cancelled visit too; the download builds `creativo-client-<id>.json` from the answer (a stubbed `URL.createObjectURL`); `client-card.words.spec.ts` + the group; `word-pipeline-error.spec.ts` `E18_WORDS` + the four reachable `PRIVACY_*` rows, `INVALID_INPUT_CODES` + `PRIVACY_INVALID_INPUT`; `icon-vocabulary.spec.ts` `GLYPHS` + `'client.export': 'receipt_long'`; `client-card.spec.ts` the export row's leading `ui-icon`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `config/feature-flags.json` `development` value (no spec pins it) — P3-DEP-12; `catalogue-parity.spec.ts` passes unchanged (parity, placeholders, banned phrases)                                                                                                                                                                                                                                                                                               |
| PC3     | `privacy.wire.spec.ts` — gate order (no uid → `UNAUTHENTICATED`; a non-admin token → `FORBIDDEN`, both before the payload is read — a payload getter that throws proves it); `customerId` / `operationId` malformed or absent → `INVALID_INPUT` naming the field; the encoder's shape. `firestore-privacy.adapter.spec.ts` / `firestore-audit-read.adapter.spec.ts` (query shapes over a fake db; guarded reads; code-only failures). `main.spec.ts` + the export's `ENDPOINTS` row and `FLIPPED` case. `export-client-data.integration.spec.ts` (emulator; Firestore + Auth) — seeds person P (account, record, a solo visit with a note and a SHOT photo, a party visit owned by person Q with Q's contact, Q's walk-in label, a note and a redemption of Q's gift voucher, a LIBRARY photo with `clientCustomerId = P` and a sentinel `clientLabel` on that party visit, grants, P's own voucher, loyalty, stats + money, journal rows, notifications, a waitlist request, an invitation, audit rows targeting P and Q), person Q, and walk-in person W (a walk-in-only record; a staff visit `[WALK_IN W, ANONYMOUS]` booked through the staff request, so its contact is W's sentinel phone): (1) **every section of §0.4 "export?" is present** with exactly P's seeded ids — the LIBRARY photo on Q's party visit included, without `url`; and W's export carries W's own contact on W's party visit (the keyed-hash arm); (2) **nothing of Q**: Q's sentinels, Q's documents, Q's own audit rows, Q's party-visit note and Q's voucher code are absent, the party visit's Q label is a marker and its contact `NONE`; no voucher `code` at all; (3) **deterministic** (pinned `nowUtcMs`): two exports with the SAME operation id are byte-identical, two exports with different ids are byte-identical once the `PRIVACY_CLIENT_EXPORTED` rows are removed from both, and so is an export after re-seeding in another order; (4) **the row**: exactly one `PRIVACY_CLIENT_EXPORTED` row (actor ADMIN, target P's record, counts only), never inside its own bundle; a replay with the same operation id adds none and answers the same bytes; (5) **logs**: the captured log lines (the `operation-trace.integration.spec.ts` logger spy) hold no sentinel and no part of `exportJson`; (6) **the cap** through the pipeline with the real adapters and a footprint double over the cap → refusal, no row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `main.spec.ts` title, `EXPORTS`, `toHaveLength(47 → 48)` (`:981`, `:1027`); `edge.spec.ts` totality covers the new dictionary (no assertion text changes) — P3-DEP-9                                                                                                                                                                                                                                                                                            |
| PC5     | `apps/web/e2e/staff-client-privacy.spec.ts` (export): an admin token (its `users/{uid}` seeded first with `roles: ['admin']` — the pipelines re-read STORED roles) opens a seeded client's card through the agenda, the block shows, «Изтегли данните» → `page.waitForEvent('download')`, the file parses, `clientExportVersion === 1`, the client's own ids are in it and a second seeded client's sentinel is not; a barber token sees no block; axe on the sheet in light and dark.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | none                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| PD1     | `erasure-lifecycle.data.spec.ts` (factories; `fieldFault` per variant, the key absent → refused naming `erasureStatus`, a foreign value refused, a stamp of the wrong type refused); `account-status.data.spec.ts` + `ERASED` (`erase`, `isErased`, `isBlockedAt` → `true` at any instant); `stored-document.system.spec.ts` + a tombstone body (marker, nulls, `ERASED` stamps) IS admitted as the same object; `customer-record.system.spec.ts` + `createsFor` / `walkInCreates` bodies carry `NONE`; `client-glance.system.spec.ts` + an `ERASED` account reads as blocked; type-specs: `Customer` not `never`, `erasureStatus` narrows its variants, `ErasureLifecycle` disjoint from `CustomerMeta` and `WriteProvenance`; `User` narrows `ERASED` to `accountErasedAtUtcMs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | every ecs-core customer literal gains `erasureStatus` (`customer-origin.data.spec.ts`, `identity-dictionaries.type-spec.ts`, `stored-document.system.spec.ts` customer describe `:253-301`, `customer-record.system.spec.ts`, `identity.fixtures(.spec).ts`, `port-doubles.spec.ts`, `book-appointment` / `edit-appointment` / `complete-registration` `.pipeline.spec.ts`) — P3-DEP-16; `identity-dictionaries.type-spec.ts` `AccountStatus` lines — P3-DEP-17 |
| PD2a    | `erasure-census.data.spec.ts` (`EMPTY`, `PERSONAL_FIELDS` = the eight personal names, eleven fields in all); `erasure-offer.data.spec.ts` (values once, SCREAMING); `client-privacy.system.spec.ts` + `siblingIdsOf` (each non-null value once, R excluded; purity) and `erasureOffer` (the three statuses); `privacy.error.spec.ts` + `ERASURE_LINK_MISMATCH`, `ERASURE_TOO_LARGE` (its count field); `client-privacy-call.data.spec.ts` + the two decoders; `privacy.error.spec.ts` + `ERASURE_STAFF_ACCOUNT`; `booking.error.spec.ts` + `BOOKING_CLIENT_ERASED`; `complete-client-erasure.pipeline.spec.ts` (loops until `erasureDone` with ONE id; stops at `MAX_ERASURE_CALLS`; a refusal ends the loop); type-spec lines for `ClientErasure` (three verbs); `audit.system.spec.ts` + the two state keys and the `erasure-resweep:<op>` key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `audit-context.data.spec.ts` `Singles` (+ the `ErasureAction` group) — P3-DEP-18                                                                                                                                                                                                                                                                                                                                                                                |
| PD3b    | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | the customer literals of §1 #15 outside ecs-core (13 files) — P3-DEP-16                                                                                                                                                                                                                                                                                                                                                                                         |
| PD2b    | `client-erasure.system.spec.ts` — purity; `underErasureAmong` (NONE passes; ERASING and ERASED caught; absent ignored); `linkOf` (a `forUser` match → the uid; a stale or foreign `userId` → mismatch); `refusalOf` (barber, admin, receptionist, sysadmin refused — in the stored account, and ONLY in the Auth claims with no `users` document; a linked uid with no `users` document while its Auth user exists refused, claims or none — production's shape, P3-DEP-29; no account and no Auth user passes; a link mismatch refused; client and no account pass); `census` on a crafted footprint (each of the eleven fields; a marker name counts as no personal value; a `[WALK_IN P, ANONYMOUS]` staff visit's contact counts as P's by the keyed-hash arm); `isComplete` over `PERSONAL_FIELDS` only; `stampWrites` — exact record and account bodies (the search keys from `SearchFieldsSystem`, the account names → marker, the record's `writeOperationId` = the call's id, the account `transition` deleting a `BLOCKED` variant's fields), the STARTED row with the census, `[]` unless `NONE`; `visitWrites` — a solo visit (contact cleared, the note removed, `writeOperationId` = the call's id), a party visit owned by another (contact kept, P's walk-in label → `— 1`, two of P's labels → `— 1`, `— 2`, its note REMOVED — P3-RU-33), a staff walk-in party `[WALK_IN P, ANONYMOUS]` with no owner (contact cleared by the keyed-hash arm), an already-clean visit → `[]` (idempotent); `photoPlan` (SHOT path first; LIBRARY document only; a null-client photo on a sole-subject visit); `looseWrites`; `completionWrites` (`[]` unless `ERASING`; the ERASED row holds the residue; `writeOperationId` = the call's id); `resweepWrites` (`[]` with no residue or with the row present; else one RESWEPT row holding the BEFORE census); a PII scan of every returned write and row. `erase-client.pipeline.spec.ts` — the gate (flag, stored roles, not found, link mismatch, a staff role in the stored account or the Auth claims, a list past `ERASURE_MAX_DOCUMENTS` — each before any write); the call order (OTP sweep BEFORE the stamp, stamp before every unit, completion last) recorded by the doubles; a spent budget after the stamp → `ERASING`, `erasureDone: false`, then a second call completes with the SAME final state and ONE STARTED + ONE ERASED row; an object delete failure → `ERASING`, no completion; an Auth failure → its error, the record `ERASING`; `ERASED` with no residue → no write; `ERASED` with a note added to an OLD visit after completion → that note removed and ONE `PRIVACY_CLIENT_ERASURE_RESWEPT` row (a replay of the same id → no second row); only dirty visits are chunked (a clean history of 3 × `ERASURE_CHUNK_SIZE` visits plans no visit commit); no plan exceeds `2 × ERASURE_CHUNK_SIZE + 1` ops; the log lines hold counts and ids only; `previewClientErasure` writes nothing. `book-appointment` / `edit-appointment` `.pipeline.spec.ts` + an erased owner record and an erased walk-in contact → `BOOKING_CLIENT_ERASED`, no plan; an edit ADDING an erased account (its record read in `placement.customers`) and one adding an erased walk-in (read in `set.customers`) each refuse; an edit carrying back a seat of an erased record (no added subject) still saves. `profile-edit.system.spec.ts` + the erased-account arm; `registration.system.spec.ts` / `complete-registration.pipeline.spec.ts` + cases pinning that the EXISTING paths already refuse an erased account (`adoptStub` → `IDENTITY_OTP_ACCOUNT_CONFLICT`; a cleared destination has no holder → `IDENTITY_REGISTRATION_USER_NOT_FOUND`). `previewClientErasure` answers the existing siblings and `[]` for an `ERASING` record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | none beyond the added cases                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| PD4     | `client-privacy.adapter.spec.ts` + the two members; `client-privacy.presenter.spec.ts` + the erase row worded per `ErasureOffer` (ERASE, RESUME with the unfinished line, RESWEEP beside the erased line), the alert (title, the five figures — visits, notes, photos, accounts, siblings —, the two actions in order), the sibling rows (no name), (bg + en); `client-card.store.spec.ts` + preview → alert → confirm → `completeClientErasure` with the act's ONE captured `ClientPrivacyCall` → the erased state; keep → nothing called; switching the card to another client between preview and confirm calls nothing and clears the pending act; a sibling row runs its own preview with a NEW operation id and the sibling's id; a refusal keeps the alert's words; `client-card.spec.ts` + the alert's actions (destructive first, the safe answer last and preferred), the erased line on an `ERASED` record; `E18_WORDS` + `PRIVACY_ERASURE_STAFF_ACCOUNT`, `PRIVACY_ACCOUNT_LINK_MISMATCH`, `PRIVACY_ERASURE_TOO_LARGE`, `BOOKING_CLIENT_ERASED`; `icon-vocabulary.spec.ts` `GLYPHS` + `'client.erase': 'delete'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | none                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| PD3     | `firebase-auth-eraser.adapter.spec.ts` (not-found → ok; `loadAuthRoles`: the claims' known roles, not-found → `null`; a failure → its code, never the message — a message holding a sentinel phone never reaches the error); `storage-objects.adapter.spec.ts` (fake bucket: `ignoreNotFound`, the prefix LISTED then each object deleted, the count = the list's length, a failure's code); `firestore-privacy.adapter.spec.ts` + `listOtpsByDestination`'s failure names `otps` only (a sentinel destination never reaches the error); `privacy.wire.spec.ts` + the two decoders; `main.spec.ts` + two `ENDPOINTS` rows and cases (erase: `timeoutSeconds` 540, `LARGE_MEMORY`). **`erase-client.integration.spec.ts`** (emulator: Firestore + Auth + Storage, real adapters — tx, privacy, audit read, the Auth eraser on the Auth emulator, the object eraser on the Storage emulator's `demo-creativo-test.appspot.com`; an admin caller; pinned `nowUtcMs`) — fixture: account person P (users doc with sentinels, an Auth user with P's phone and e-mail, record R, an avatar object), a solo visit with a note and a SHOT photo (object uploaded), a LIBRARY photo, a party visit owned by Q with P on an account companion seat, a note and a LIBRARY photo with `clientCustomerId = P` and a sentinel `clientLabel`, a walk-in record S keyed by P's phone (P's sibling), a staff walk-in visit of walk-in person W (a walk-in-only record, erased in its own case) AND a staff walk-in PARTY `[WALK_IN W, ANONYMOUS]` built by `StaffEditPlanSystem.bookingRequest` with no account (its contact is W's sentinel phone), a record L whose `userId` names a staff uid that has an Auth user — no custom claims, as production sets one up (P3-DEP-29) — and NO `users` document (the wrong-account case), notifications ×2, a waitlist request, an invitation, an impersonation session targeting P, an OTP for P's phone, journal rows, loyalty, stats + money, a grant, a voucher, pre-existing audit rows; and person Q untouched. Cases: **(1) every personal value is gone** — run `eraseClient` until `erasureDone`; serialise EVERY document of EVERY collection of §0.4 and assert none holds a P sentinel; `auth.getUser(P)` → `auth/user-not-found`; `avatars/P/…` and the SHOT object are gone, the LIBRARY object is not; the LIBRARY photo DOCUMENT on Q's party visit and that visit's note are gone; W's own case: no W sentinel anywhere, the `[WALK_IN W, ANONYMOUS]` party's contact is `NONE`; P's preview listed S's id and R's ERASED row's counts do not include S (S erased in its own call afterwards); **(2) visits, money and audit rows remain** — each visit's non-personal fields byte-equal to before (ids, times, seats but P's labels, money, statuses), stats / money / loyalty / journal / grants / voucher byte-equal, every pre-existing `auditLog` row byte-equal, exactly one STARTED and one ERASED row, the ERASED row's personal counts all 0 and `erasureVisitCount` = P's visits; Q's documents byte-equal; **(3) no erased value reaches an audit row or a log line** — the logger spy captures every line of the run; the document-change pipeline (`decodeDocumentChangeEvent` + `auditDocumentChange`, the `governed-audit.integration.spec.ts` idiom) is run over the before / after image of every erased `customers`, `users`, `appointmentNotes`, `appointmentPhotos` document; every row and every captured line is scanned: no sentinel; every governed row the erasure's writes produce carries `auditOperationId` = the erasure's operation id (the erased documents' `writeOperationId`); **(4) a second call is a no-op and a partial erasure resumes** — a second `eraseClient` after completion changes no document (a snapshot of every collection before / after is byte-equal) and adds no row; a run whose first call hits a spent budget right after the stamp (a budget double) and a run whose first call meets a failing object eraser both finish on the next call in exactly case (1)'s final state with one STARTED and one ERASED row; **(4b)** a staff note written on P's OLD solo visit after completion is deleted by the next call, which adds exactly one `PRIVACY_CLIENT_ERASURE_RESWEPT` row (a replay of that call adds none); **(6) never the wrong account** — `eraseClient(L)` answers `PRIVACY_ERASURE_STAFF_ACCOUNT` (an Auth user, no `users` document — P3-DEP-29) and a record whose `userId` fails `forUser` answers `PRIVACY_ACCOUNT_LINK_MISMATCH`, each with the Auth user and every document byte-equal; **(5) no later writer resurrects the person** — `bookAppointment` with P's record as owner, and a staff `bookAppointment` / `editAppointment` adding a walk-in with W's erased phone, each answer `BOOKING_CLIENT_ERASED` and write nothing (no appointment, R and W's record byte-equal); `completeRegistration` as P → `IDENTITY_REGISTRATION_USER_NOT_FOUND`, `updateProfile` as P → `ACCOUNTS_UPDATE_PROFILE_NOT_FOUND`, both writing nothing; `verifyOtp` with P's freed phone provisions a NEW uid and a NEW stub, P's users document byte-equal, and the new account's `forUser` record id differs from R. `tools/verify/p0/verify-p0.mjs` **(g)** — with the functions emulator and the live triggers: erase one seeded client account through the `eraseClient` callable with `customerId: customerIdOf('dev-client-9')` (`tools/seed/fixtures/customers.fixtures.ts:27` — the RECORD id; the uid text would parse and answer `PRIVACY_CLIENT_NOT_FOUND`, making every scan pass trivially), a first-visit client — never a staff account — as `dev-staff-ivan` (`admin` in both the claims and the stored roles — the (d) caller), looping until done; assert the answer `erasureDone: true`, the record `erasureStatus: 'ERASED'`, exactly one STARTED and one ERASED row, `auth.getUser('dev-client-9')` not-found; settle, then scan every `auditLog` document, every `triggerFailures` document (the dead letter) and every Logging-emulator entry since the call for that client's seeded strings (none) and check the client's visits remain. | `main.spec.ts` (48 → 50), `package.json` `test:emulator` `--only` (+ `storage`) — P3-DEP-19, P3-DEP-20                                                                                                                                                                                                                                                                                                                                                          |
| PD5     | `staff-client-privacy.spec.ts` + erasure: an admin (its `users/{uid}` seeded with `roles: ['admin']`) opens the card of a person the SPEC seeds with a run-unique uid (account, Auth user, record, a visit with a contact, a note and a photo — never a catalogue person: the act is irreversible and the workers share the catalogue seed), «Изтрий личните данни» → ONE alert with the census figures, «Отказ» → nothing changes; again → «Изтрий» → the erased line «Изтрит клиент»; an Admin-SDK read shows the record `ERASED`, the visit kept with `contactName: null`; axe with the alert open.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | none                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| PE1     | `runbook-gates.spec.mjs` — the real runbook: ids `4.0 … 4.10`, `4.6` has no block, every other block starts `FAILED=0` (4.0 with `cd "$(git rev-parse`) and ends with its `gate:` echo, `4.0` defines `gate`, `review`, `index_gate`; `4.1` vs `4.10` prefix isolation on a synthetic document; `scriptFor` appends the exit trailer; in a `mkdtemp` git repo: a synthetic block whose word is present → exit 1 and `FAIL`, absent → exit 0 and `ok`, a block printing nothing → failure; a leaked untracked file after a run → reported and, with `--cleanup`, removed; a dirty tree before → exit 2; purity of `sectionsOf`. Fixture words are neutral (`alpha`, `beta`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | none                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| PE2     | `ci-workflow.spec.mjs` (text-level): every job has `timeout-minutes`; every `uses:` but a local `./` action (`./.github/actions/setup-workspace`) ends `@v<N>` or a 40-hex sha; no `write` permission; no `secrets.` but `GITHUB_TOKEN`; the emulator, e2e and csp jobs carry `setup-java` with `java-version: '21'` and the jar cache path; the commands of the brief's §9 gate are each named once (`nx sync:check`, `verify-tools:layering`, `typecheck seed-tools`, `test lint-rules`, `lint:styles`, `verify:bundle`, `check-functions-deps.mjs`, `--coverage`, `verify-tools:runbook-gates`, `test:emulator`, `verify:p0`, `e2e:web`, `verify:csp`); no step holds `--update-snapshots`, `--ignore-snapshots`, `firebase deploy`, `gcloud`, `preflight`, `continue-on-error`. `e2e-screenshot-tag.spec.mjs`: every `apps/web/e2e` spec calling `toHaveScreenshot` carries `@screenshot`, the tagged describes cover every screenshot test (counted, not a magic number), and `playwright.config.mts` holds the closed `CREATIVO_E2E_SCREENSHOTS === 'skip'` switch, no `updateSnapshots`, and its `retries` line unchanged (P3-RU-35).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | the four screenshot describes gain a `tag` (assertions, names, baselines unchanged) — P3-DEP-25; `playwright.config.mts` gains the switch only — P3-DEP-25                                                                                                                                                                                                                                                                                                      |

---

## 5. DEPARTURES

Every behaviour change, with before / after, evidence and the specs (and
P0 / emulator / e2e files) changed on purpose. Anything not listed is
frozen.

**WS-A**

- **P3-DEP-1 (PA1) — the seed takes one injectable instant.** Before: the
  seed read `Date.now()` for its calendar (`seed-dev-catalog.mjs:284`).
  After: `--now=<text>` or `SEED_NOW` pins it (the grammar of P3-RU-3; a
  refused text stops the seed loudly); without either, the live clock as
  before (P3-L-1), so `pnpm run seed:dev` writes what it wrote; the seed
  prints one `seed: instant <ISO> (pinned | live)` line. The stats
  projection clock is unchanged (P3-RU-2). Specs: added only
  (`seed-clock.spec.mjs`, `seed-data.spec.mjs` cases).
- **P3-DEP-2 (PA1) — `verify:p0` (a) seeds twice at ONE instant.** Before:
  each run read its own clock, so a today-visit end or the shop's midnight
  between the runs made (a) differ. After: one instant (`SEED_NOW` when
  set — the late-time proof — else captured once) for both runs; (a)'s
  text says so. The P0 file `tools/verify/p0/verify-p0.mjs` changes on
  purpose; `seed-run.spec.mjs` added.
- **P3-DEP-3 (PA2) — the e2e suite clock.** Before: `shop-clock.ts` read
  `Date.now()` in `shopToday()` and `stillAheadToday()` (capped at 23:25),
  and the catalogue seed read its own clock. After: global setup resolves
  the run's ONE instant (`E2E_NOW` — refused unless it falls on the real
  shop day, checked there only — else the live clock) and hands it to every
  worker through `process.env.E2E_NOW`; `suite-clock.ts` reads it
  (`suiteDay()`, `browserNowUtcMs()`); `stillAheadToday`, `EVENING_START`,
  `LATEST_START` are deleted; the live `shopToday()` stays for the unpinned
  specs, which do not change; global setup runs the catalogue seed at
  `--now=<the suite day 10:00>`. Files changed on purpose:
  `support/shop-clock.ts`, `support/global-setup.ts`.
- **P3-DEP-4 (PA2) — three tests pin the browser.** Before: the glance's
  two tests and the month navigation compared the page's LIVE clock with
  Node-side seeds; the glance seeded "today" at `stillAheadToday()` and
  failed after ~23:15 shop time. After: `pinBrowserClock(page)` first (the
  suite day at 10:00 shop time); "today's" visits seeded at a fixed 21:00;
  every assertion unchanged; the journey proves "a visit ahead of the
  pinned 10:00 is upcoming" (P3-RU-4). Specs: `client-card-glance.spec.ts`
  (`:31`, `:162`, `:197`, `:364`, `:370`, `:707`, `:713`),
  `appointments.spec.ts` (`:9`, `:14-16`, `:100`). Added after the C_A
  gate and the late run (§8.A): the pin is a RUNNING clock
  (`setSystemTime`), and the glance's two `client-head-title` assertions
  (and the privacy journey's) wait 20 s for the profile read, the spec's
  own idiom for a server read — the asserted names unchanged.
- **P3-DEP-5 (orchestrator, records) — the time-of-day flake leaves the
  record.** HANDOFF §4 "Known flakes" and §3.3's carried list drop the
  glance clause once the late-shop-time run (§6.1 addition 2) — the e2e
  half run while the REAL shop clock is between 23:15 and 23:59 (P3-RU-34)
  — is green; the load flakes stay listed (`auth-onboarding.spec.ts:106`,
  `appointments.spec.ts:152` — load, not clock, §2.A.1).

**WS-B**

- **P3-DEP-6 (PB2, PB3) — the challenge is saved by a commit.** Before:
  `requestOtp` saved through `OtpStorePorts.saveOtp` (a plain `Set`).
  After: ONE `ports.commit` holding the same whole-body `Set` (its
  `purgeAt` stamped by the tx adapter) and the REQUESTED row; `saveOtp` /
  `SaveOtp` are deleted from the port, the adapter and the doubles. The
  RU-3 order (saved and the OR-9 window consumed before `sendOtp`) and
  every answer are unchanged; a store failure is still a `RepositoryError`.
  Specs: `request-otp.pipeline.spec.ts` (rig; the `saveOtp`-failure case
  `:456-477` becomes a commit failure), `port-doubles.spec.ts:1121`,
  `firestore-otps.adapter.spec.ts:38`, `:106`, `firestore-ports.spec.ts:81`,
  `:111`.
- **P3-DEP-7 (PB1, PB2) — sign-in leaves audit rows.** Before: no
  identity act wrote a row of its own (only the `users` trigger's anonymous
  profile rows). After: `IDENTITY_OTP_REQUESTED` (with the challenge),
  `IDENTITY_OTP_VERIFIED` (with the consumption), `IDENTITY_OTP_REFUSED`
  (with a recorded wrong code; `LOCKED_OUT` on the attempt that exhausts
  the challenge), `IDENTITY_SESSION_ISSUED` (verifyOtp, after the mint, in
  one added commit — a failure of that commit now answers the store
  failure and no token, where before the token was answered),
  `IDENTITY_REGISTRATION_COMPLETED` (the first completion only) — ids,
  tags and counts only; the three pre-session rows carry no operation id
  (P3-L-20); state-less refusals write nothing (P3-L-2), and a refused
  send follows its already-committed REQUESTED row. Rows are permanent
  (no `auditLog` TTL); an unauthenticated caller's requests now each leave
  one (§7 item 5). `tools/seed/settle.mjs`'s `triggerFingerprint` counts
  `auditLog` (`:131-146`, `count()` at `:138`), so sign-ins by parallel e2e
  workers (and, from C_C / C_D, exports and erasures) now move the
  fingerprint and reopen a settle's quiet window: the quiet window is
  per-call and the wait is bounded, so the effect is time, not
  correctness — measured at C_B (the `e2e:web` wall time against §6.3)
  and recorded in §8; a regression past 10 % is a stop-and-report. Specs: `audit-context.data.spec.ts`
  regex + `Singles`, `verify-otp.pipeline.spec.ts:120`, `:136`,
  `complete-registration.pipeline.spec.ts` plan assertions, the two
  integration specs (rows added to their assertions); found at C_B, two
  more `verify-otp.pipeline.spec.ts` plan pins move with the rows — "re-runs
  tx 2 ONCE" (plans `[[Update,VERIFIED],[],[SESSION]]`, four transactions
  where there were three) and "lands an abandoned registration"
  (`tx.plans` 1 → 2).
- **P3-DEP-8 (PB1, PB3) — the identity vocabulary.** `SystemSource`
  gains `IDENTITY_CALLABLE`; `decodeRequestOtp` and `decodeVerifyOtp` read
  the optional transport `operationId` (RU-21's four optional readers →
  six); `firestore.indexes.json` gains three `auditLog` overrides (101 →
  104 field overrides). Specs: `actor.data.spec.ts`, `identity.wire.spec.ts`
  (added cases).

**WS-C**

- **P3-DEP-9 (PC3) — a new admin callable `exportClientData`.** Exports
  47 → 48; bound to `WALK_IN_SECRETS` (the walk-in key now reaches an
  admin-only reader as well as the two minting callables, P3-RU-36). Specs: `main.spec.ts` title, `EXPORTS`, `ENDPOINTS`, a `FLIPPED`
  case, `toHaveLength(48)` (`:981`, `:1018-1027`); `main.ts` header;
  found at C_C, `edge.spec.ts`'s closed `namedBy(NamedField.Field)` list
  gains `PrivacyErrorCode.InvalidInput` (forced by `InvalidInput`'s
  `withField` contract; a pin added, none weakened). Wire
  skew: the web's export button reaches a callable only after the
  functions deploy (deploy functions, then light the flag — §7 item 17).
- **P3-DEP-10 (PC1, PC2) — the privacy vocabulary.** `AuditAction` gains
  `PRIVACY_CLIENT_EXPORTED` (the spec regex gains `PRIVACY`);
  `Roles.PRIVACY = [admin]`; `LogEvent.PrivacyClientExported`;
  `firestore.indexes.json` gains three `auditLog` overrides (104 → 107);
  `utf8Bytes` moves to `CanonicalJsonSystem` (behaviour-neutral). Specs:
  `audit-context.data.spec.ts`, `role.rules-parity.spec.ts` (header),
  `log-event.data.spec.ts`.
- **P3-DEP-11 (PC4) — the card's privacy block (export).** Before: the
  staff client card had no data-subject action. After: for an ADMIN viewer
  with `client.privacy` on and the record known, a separate block after the
  K exits offers «Изтегли данните» (icon `client.export` → `receipt_long`, a
  new vocabulary key on an existing glyph), which downloads
  `creativo-client-<customerId>.json`; new copy keys only (§7 item 1). A
  barber, receptionist or sysadmin sees nothing new; every existing card
  spec passes unchanged.
- **P3-DEP-12 (PC4) — `client.privacy` is on in development.** Before:
  `false` in every environment. After: `development: true` (dev, `e2e:web`,
  `verify:p0` exercise it); staging and production stay `false`
  (`docs/production-deploy.md`'s "ship dark" holds). No spec pins the
  value.

**WS-D**

- **P3-DEP-13 (PD2b) — booking writers refuse a person under erasure.**
  Before: a staff booking or edit with an erased walk-in's phone silently
  re-seated the erased record (`customer-record.system.ts:312`), and an
  erased account's live token could book on its record. After:
  `BOOKING_CLIENT_ERASED` (`failed-precondition`, new words — §7 item 1)
  from `bookAppointment` / `editAppointment` when a seated or created record
  is `ERASING` or `ERASED`; seats carried back untouched. Specs: added
  cases in `book-appointment` / `edit-appointment` `.pipeline.spec.ts`,
  `erase-client.integration.spec.ts` (5).
- **P3-DEP-14 (PD2b) — `updateProfile` refuses an erased account.**
  Before: `ProfileEditSystem.decide` admitted any `REGISTERED` account
  (`profile-edit.system.ts:158`). After: an `ERASED` account →
  `ACCOUNTS_UPDATE_PROFILE_NOT_FOUND` (existing code and words), reachable
  only inside the ≤ 1 h ID-token window after an erasure. NOT a departure:
  `adoptStub` (→ `IDENTITY_OTP_ACCOUNT_CONFLICT`) and `completeRegistration`
  (→ `IDENTITY_REGISTRATION_USER_NOT_FOUND`) already refuse an erased
  account at `20785b8`; added spec cases pin them. The same window lets the
  live token upload an avatar (`storage.rules:41-47`) — deleted again by
  every later erasure call (P3-L-10, §7 item 23). Specs: added cases in
  `profile-edit.system.spec.ts`, `registration.system.spec.ts`,
  `complete-registration.pipeline.spec.ts`.
- **P3-DEP-15 (PD2b, PD3) — `previewClientErasure` and `eraseClient`.**
  Before: no erasure existed. After: the admin-only, flag-gated erasure of
  §2.D — the link and staff checks (stored roles and Auth claims), the
  caps, the OTP sweep, the stamp commit (record `ERASING` and stripped,
  account `ERASED` and stripped, the STARTED row), paged unit commits of
  the dirty visits only (visits' contact — the keyed-hash arm included —
  and P's walk-in labels, EVERY visit's note, P's photos of every origin
  and their `SHOT` objects, notifications, waitlist requests, invitation
  names, session reasons), the avatar prefix, the Auth user DELETED, the
  completion commit (`ERASED` and the ERASED row), and the re-sweep of an
  `ERASED` record (one RESWEPT row when residue is found) — every write
  stamping `writeOperationId` with the erasure's id; idempotent and
  resumable; nothing of visits, money, the journal or audit rows is
  removed. The preview names the sibling walk-in records. The three
  privacy callables bind `WALK_IN_SECRETS` (the walk-in key reaches three
  more exports, all admin-only). Specs: the new specs of §4 PD2b / PD3.
- **P3-DEP-16 (PD1, PD3b) — every customer body carries `erasureStatus`.**
  Before: `Customer = CustomerMeta & WriteProvenance`. After: `&
ErasureLifecycle`; the read guard requires the key (strict, P3-L-18);
  `createsFor`, `walkInCreates`, the dev seed's customer fixtures and the
  e2e seed write `NONE`. Specs (literal keys only): `customer-origin.data.spec.ts`,
  `identity-dictionaries.type-spec.ts`, `stored-document.system.spec.ts:253-301`,
  `customer-record.system.spec.ts`, `testing/identity.fixtures(.spec).ts`,
  `testing/port-doubles.spec.ts`, `book-appointment` / `edit-appointment` /
  `complete-registration` `.pipeline.spec.ts`, the five functions
  integration specs of §1 #15, `client-card.fixtures.ts`,
  `client-search.spec.ts`, `staff-visit-editor.spec.ts`,
  `customers.adapter.spec.ts`, `firestore.rules.integration.spec.ts`,
  `tools/seed/fixtures/customers.fixtures.ts`, `tools/seed/seed-data.spec.mjs`,
  `apps/web/e2e/support/seed-firestore.ts`. `verify:p0` (a) stays
  byte-identical (the key is deterministic).
- **P3-DEP-17 (PD1) — `AccountStatus` gains `ERASED`.** A terminal
  variant with `accountErasedAtUtcMs`; `isBlockedAt` answers `true`; the
  profile trigger's rows now name the `ACTIVE → ERASED` tag pair (a tag,
  R36-safe). Specs: `account-status.data.spec.ts`,
  `identity-dictionaries.type-spec.ts`, `client-glance.system.spec.ts`
  (added case).
- **P3-DEP-18 (PD2a) — the erasure vocabulary.** `AuditAction` gains
  `PRIVACY_CLIENT_ERASURE_STARTED` / `PRIVACY_CLIENT_ERASED` /
  `PRIVACY_CLIENT_ERASURE_RESWEPT` (`ClientErasure` = the eleven census
  counts); `PrivacyErrorCode` gains `PRIVACY_ERASURE_STAFF_ACCOUNT`,
  `PRIVACY_ACCOUNT_LINK_MISMATCH`, `PRIVACY_ERASURE_TOO_LARGE`;
  `BookingErrorCode` gains `BOOKING_CLIENT_ERASED`; `firestore.indexes.json`
  gains eleven `auditLog` overrides (107 → 118 — §7 item 14);
  `WriteProvenance`'s doc comment names the privacy callable. Specs:
  `audit-context.data.spec.ts` `Singles`.
- **P3-DEP-19 (PD3) — exports 48 → 50.** Specs: `main.spec.ts`; `main.ts`
  header; `docs/production-deploy.md` ("The deploy holds 50 functions").
- **P3-DEP-20 (PD3) — `test:emulator` starts the Storage emulator.**
  `package.json` `--only firestore,auth` → `firestore,auth,storage` (the
  erasure proof deletes real objects); `settle-scripts.spec.mjs` passes
  unchanged (it inspects only scripts that start `functions`); CI's
  emulators job caches the storage-rules jar.
- **P3-DEP-21 (PD3) — `verify:p0` gains (g).** The erasure end to end with
  the live triggers and the Logging emulator scanned (§4 PD3). The P0 file
  and its README change on purpose.
- **P3-DEP-22 (PD4) — the card's erase action.** For the same admin
  viewers, «Изтрий личните данни» (icon `client.erase` → `delete`) opens ONE
  `ui-alert` with the census in figures (visits, notes, photos, sign-in
  accounts, sibling records); «Изтрий» erases exactly the record previewed
  (looping the resumable calls), «Отказ» does nothing; an erased record
  shows «Изтрит клиент» beside the re-sweep action; each sibling walk-in
  record gets its own erase row. New copy only.
- **P3-DEP-23 (PD3) — the functions reach Storage and delete Auth
  users.** `firebase-admin/storage` (a subpath of the existing dependency;
  `check-functions-deps.mjs` still four keys) and `auth.deleteUser` — only
  in the two new adapters, only from `eraseClient`.

**WS-E**

- **P3-DEP-24 (PE2) — CI runs the gate.** Before: one job (format,
  affected lint / test / build, the CSP static gate, icons, audit,
  gitleaks). After: `main` (the same + `typecheck` in affected, a timeout,
  concurrency), `static`, `runbook-gates`, `coverage`, `emulators`, `e2e`,
  `csp-smoke`, all parallel (§2.E). Files: `ci.yml` (its CSP comment
  reworded, P3-RU-31), `docs/production-deploy.md` (the CI sentence
  `:576-578` and its line references).
- **P3-DEP-25 (PE2) — the screenshot switch.** The four screenshot
  describes gain `{ tag: '@screenshot' }`; `playwright.config.mts` skips
  them only under `CREATIVO_E2E_SCREENSHOTS=skip`, which only CI's `e2e`
  job sets — CI runs the e2e suite without the ten screenshot tests, the
  owner's macOS full gate runs all of them (P3-RU-30). No assertion,
  name or baseline changes.
- **P3-DEP-26 (PE1) — the runbook gates have a committed runner.**
  `pnpm nx run verify-tools:runbook-gates` (and `pnpm run verify:runbook`)
  extracts and runs §4.0 + §4.2–§4.5, §4.7–§4.10 alone, failing on a FAIL,
  an ERROR, an empty block or a leaked file; HANDOFF §4's gate names it in
  place of the paste instruction; `tools/verify/project.json` `test.inputs`
  gain the runbook, `.github/**`, the e2e specs and the Playwright config.
- **P3-DEP-27 — WITHDRAWN (orchestrator, 2026-10-27).** The draft's
  `retries: 0` everywhere and two CI workers would have overturned the
  config's owner-authored CI policy (`playwright.config.mts:38-43`); CI
  runs the config as it stands (P3-RU-35).

**Review round 1 (2026-10-28) — the fixer's departures.** Each changes a
Phase 3 behaviour or pin ON PURPOSE (§8.R1 names the finding).

- **P3-DEP-28 (R1 findings 1, 6) — the footprint finds a visit by its
  contact value.** Before: the export and the erasure read the person's
  visits by `subjectCustomerIds array-contains R` alone, so a visit whose
  booker's seat a staff `REMOVE_SEAT` took (`edit-appointment.pipeline.ts`
  writes `AppointmentIndexSystem.withQueryKeys({...stored, seats})`: the
  mirrors recomputed, the `BookingContact` kept) was never exported and
  never cleared — and the erasure certified `ERASED`. After:
  `ClientFootprintPorts.listVisitsByContact` (`contactPhone ==` /
  `contactEmail ==`, merged by id; both fields keep their automatic
  single-field index) runs for each of `ClientPrivacySystem.contactValuesOf`
  (the one home of the record's and the account's phone and e-mail — the
  OTP sweep's destinations and the sibling ids derive from it too; the
  erasure only while R is `NONE`); `contactIsPersons` gains the value arm
  (`contactCarriesValueOf`; the id arms are `contactProvedById`); the census
  counts such a visit's contact in `erasureContactCount` (never in
  `erasureVisitCount`); and BEFORE the stamp the erasure clears every
  contact only the value arm recognises (`ClientErasureSystem.contactSweepWrites`
  — a visit no longer seating R, or a shared one whose ids do not prove
  the contact — chunked, each visit re-read and re-decided in its
  transaction, the budget looked at between chunks: a spent budget answers
  `NONE`, not done, BEFORE the stamp, so the next call still finds the rest
  by value). The export shows such a visit with its contact, its other
  seats' labels marked (P3-RU-18), its note withheld. Specs changed on
  purpose: `client-privacy.system.spec.ts` (the keyed-hash arm's key
  dependence asserted on `contactProvedById` — the whole rule also matches
  W's phone by value); `client-erasure.system.spec.ts` (the destinations
  describe calls `ClientPrivacySystem.contactValuesOf`, expectations
  unchanged). Amends §0.4 and P3-L-12. A one-time contact-sheet override
  that matches neither the record's nor the account's values stays
  unfindable (§7 item 25); an `ERASING` record stamped before this change
  cannot be swept by value (no erasure has run: `client.privacy` is off in
  production, §7 item 17). **Review round 2:** the sweep's clears gain their
  own audit row (P3-DEP-33) and the sweep widens to every contact carrying
  P's values (P3-DEP-34); the STARTED row's census counts what is left at
  the stamp, so a contact an EARLIER call swept is not in it (§7 item 28,
  §8.R2).
- **P3-DEP-29 (R1 finding 7) — the staff-account refusal fails closed.**
  Before: `refusalOf` refused a staff role in the stored account or the Auth
  custom claims — but no production path sets custom claims (Phase 4a
  4A-14; roles ride the minted custom token), so a linked uid whose `users`
  document is absent passed and its Auth user was deleted. After: a linked
  uid with no `users` document while its Auth user exists answers
  `PRIVACY_ERASURE_STAFF_ACCOUNT` (the existing code and copy); no account
  and no Auth user still proceeds; the claims check stays as defence in
  depth. Specs changed on purpose: `erase-client.pipeline.spec.ts` "a
  linked uid whose users document is gone" now removes the Auth user too
  (its intent — the record alone stripped, the uid-keyed steps run — kept),
  beside a new refused case; `erase-client.integration.spec.ts` (6) seeds
  L's Auth user without `setCustomUserClaims` (production's shape). Amends
  P3-L-16; runbook §1.1 "The erasure's reads and writes".
- **P3-DEP-30 (R1 finding 5) — a `SHOT` photo's object is deleted only at
  its own path.** Before: `photoPlan` listed every `SHOT` document's `path`
  — a staff-written, rules-unchecked field — for an Admin-SDK delete (any
  object of the bucket; an empty path stalled the erasure forever). After:
  only `path === appointmentPhotos/{appointmentId}/{id}` (the upload's
  layout) is deleted; any other path is never handed to Storage, its
  document still removed. Spec fixture changed on purpose:
  `privacy-doubles.ts` photo paths drop `.jpg` (the real layout), so the
  existing `photoPlan` expectations hold; `storage-objects.adapter.spec.ts`
  `SHOT` constant likewise.
- **P3-DEP-31 (orchestrator D1–D4, decided at C_D) — the kept `LIBRARY`
  object's label, the stamps' indexes, the alert's host, the Auth helpers.**
  `ObjectEraserPorts.clearStoredLabel` (idempotent; no object or no key is
  done) clears a `LIBRARY` photo's object `clientLabel` metadata BEFORE its
  document goes (`ErasurePhotoPlan.labelPaths`; a failure keeps the chunk
  for a resume); `firestore.indexes.json` switches off
  `customers.erasureStartedAtUtcMs` / `erasedAtUtcMs` (overrides 118 →
  120; `erasureStatus` keeps its index — `tools/verify/indexes/privacy-indexes.spec.mjs`);
  the card's empty `ui-alert` host is boxless (`.client-card__privacy >
ui-alert { display: contents }`); `firebase-auth-eraser.adapter.ts`
  imports `authCodeOf` / `authFailure` from `auth-claims.adapter.ts`.
  Specs changed on purpose: `storage-objects.adapter.spec.ts` "serves
  exactly ObjectEraserPorts" (+ `clearStoredLabel`);
  `client-erasure.system.spec.ts` "nothing to plan for nothing" (+
  `labelPaths: []`); `erase-client.pipeline.spec.ts` the order list (+
  `clearStoredLabel:<library path>`) and the no-op call's log offset (13 →
  14); `erase-client.integration.spec.ts` seeds the `LIBRARY` object with a
  `clientLabel`.
- **P3-DEP-32 (R1 finding 3) — the shared rules' one home.**
  `ClientPrivacySystem.ownWalkInSeatIds` (no production caller) becomes the
  `isOwnWalkInSeat` guard both systems call; `ClientPrivacySystem.distinct`
  replaces the two private copies and the pipeline's inline photo loop;
  `ClientErasureSystem.destinationsOf` moves to
  `ClientPrivacySystem.contactValuesOf` (P3-DEP-28). Behaviour unchanged:
  `client-export.system.spec.ts` passes unchanged. Spec changed on purpose:
  `client-privacy.system.spec.ts` (the `ownWalkInSeatIds` describe replaced
  by `isOwnWalkInSeat` and `distinct` cases, the purity block calls them).

**Review round 2 (2026-10-28) — the fixer's departures.** Each changes a
Phase 3 behaviour or pin ON PURPOSE (§8.R2 names the finding).

- **P3-DEP-33 (R2 finding 1) — the contact sweep writes its own audit row.**
  Before: the pre-stamp contact sweep (P3-DEP-28) committed its clears with
  no row; the only row covering the act was STARTED, in the stamp commit —
  a stamp that never landed (a store failure, then an abandoned or
  re-minted act) left visits cleared under a `writeOperationId` no
  `auditLog` row names (`appointments` is not governed). After: a fourth
  erasure verb `AuditAction.PrivacyClientErasureSwept`
  (`'PRIVACY_CLIENT_ERASURE_SWEPT'`, in `ErasureAction`), keyed by the act
  (`AuditSystem.changeKey.erasureSweep(operationId)` →
  `erasure-sweep:<operationId>`); every sweep commit probes the row by its id
  (`ClientErasureSystem.sweepRowIdBasis`) in its transaction and
  `ClientErasureSystem.sweepRowWrites` creates it in the first commit that
  clears a contact — the census BEFORE, counts only, the admin the actor,
  the record the target; `[]` once present, when the commit clears nothing,
  or for a record that is not `NONE` (the record as read before the stamp —
  the sweep runs only then). A later chunk or a resumed call of the same act
  plans none; a re-minted act is its own row. The OTP commit keeps no row
  (P3-RU-21). Specs changed on purpose: `audit-context.data.spec.ts` (the
  `PRIVACY_` verb list and the `clientErasure` loop gain SWEPT);
  `identity-entities.type-spec.ts` (`ErasureAction`'s four verbs);
  `audit.system.spec.ts` (+ the sweep's key); `client-erasure.system.spec.ts`
  (the R36 scan covers four rows); `erase-client.pipeline.spec.ts` ("exactly
  one SWEPT, one STARTED and one ERASED row" — `rowsOf` 2 → 3; the order
  list's sweep commit `appointments+auditLog`; the ERASED no-op's call offset
  14 → 15; "30 dirty visits" — the sweep commits `[26, 5]` beside the visit
  commits `[50, 10]`); `erase-client.integration.spec.ts` (2) (the added
  documents 2 → 3, the SWEPT row's census) and (7) (the SWEPT row) —
  emulator-run. Amends runbook §1.1 (`auditLog`'s readers and writers, "The
  erasure's reads and writes").
- **P3-DEP-34 (R2 finding 5) — the sweep clears every contact carrying the
  person's values.** Before: `contactSweepWrites` skipped a visit that still
  seated R when it was sole-subject or its ids proved the contact
  (`contactProvedById`), leaving it to `visitWrites` after the stamp — but a
  desk `REMOVE_SEAT` of R's seat after the outside read (the edit guard,
  P3-RU-20, refuses only ADDING an erased record) drops R from
  `subjectCustomerIds`, so `visitWrites` plans `[]`, an `ERASING` record's
  footprint has no by-contact read and the stamp has cleared the values it
  would search for: `ERASED` was certified with P's name, phone, e-mail and
  note on a kept visit (the window lasts while the record is `ERASING`).
  After: the sweep clears, BEFORE the stamp and re-decided per visit in its
  transaction, EVERY contact that carries one of P's contact values
  (`contactCarriesValueOf`), seated or not (the unused `walkInHash`
  parameter goes); `visitWrites` still clears what the values do not find
  (a sole-subject visit's other contact, one the ids prove under other
  values). The visits' units still run on the outside read: a visit whose
  only dirt was its contact re-reads and plans `[]`. Specs changed on
  purpose: `client-erasure.system.spec.ts` (the `contactSweepWrites`
  describe: P's solo visit and W's staff party are swept now, a SEATED
  party P owns is swept, the third person's contact on W's lone visit is
  not); `erase-client.pipeline.spec.ts` (the order list — the visits' unit
  is `appointmentNotes` alone; "a budget spent after the sweep" — nothing
  holds P's contact after the partial call; every commit-index hook shifts
  by one — the failure table gains "the contact sweep" (1) and pins the
  stamp's resumed STARTED count one lower (§7 item 28), the record-gone,
  walk-in-gone, concurrent-stamp, concurrent-completion and invitation
  hooks re-indexed to the same commits); `erase-client.integration.spec.ts`
  (4)'s comment. Added: four in-flight `REMOVE_SEAT` cases (after the stamp;
  after the outside read while `NONE`; each with a failing visits' unit and
  a resume) — all four fail on the round-1 sweep. Amends P3-L-12 and §0.4;
  §7 item 25 extended.
- **P3-DEP-35 (R2 finding 3) — the alert counts the sibling rows it sits
  beside.** Before: `alertOf` worded the preview's own
  `erasureSiblingCustomerIds.length` — `[]` after the stamp — while the card
  kept and listed its sibling rows (`siblingsAfterPreview`, round 1), so a
  RESUME or RESWEEP preview said "…: 0" above two rows. After: the store
  sets `_alertSiblings` with each preview — the kept list for the card's
  own record, the preview's list for a sibling's own act — and the presenter
  words its length (`ClientErasureInput.alertSiblings`). Specs changed on
  purpose: `client-privacy.presenter.spec.ts` (`erasureInputOf` defaults
  `alertSiblings: []`; the alert case passes the preview's two in bg and
  en); added a post-stamp case (bg/en `: 2.`) and two
  `client-card.store.spec.ts` body checks (RESUME, RESWEEP — both fail on the
  round-1 tree) plus the sibling's own act (`: 0.`).

---

## 6. Gates

### 6.1 The FULL gate (the Phase 0–2 brief's §9, verbatim — one command at a time)

```bash
pnpm nx sync:check
pnpm nx run verify-tools:layering --skip-nx-cache
rm -rf dist/out-tsc && pnpm nx run-many -t typecheck --skip-nx-cache
pnpm nx run-many -t lint
pnpm nx run-many -t test --parallel=3 --skip-nx-cache   # includes the preflight spec (verify-tools)
pnpm nx test ecs-core --coverage   # thresholds 90/95 pass; statements never below the measured baseline; new system/pipeline files ≥ 95 %
pnpm nx typecheck seed-tools && pnpm nx test lint-rules
pnpm run lint:styles
pnpm nx build web && pnpm run verify:bundle
pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs
# alone: runbook grep gates §4.0 preamble, then §4.2–§4.10, 0 FAIL
pnpm run verify:p0
pnpm run test:emulator
pnpm run e2e:web
pnpm run verify:csp
```

Known load flakes (that brief's §9): `auth-onboarding.spec.ts:106`,
`appointments.spec.ts:152`, the landing hero screenshot, the glance barber
test after ~23:15 shop time — the last one is the flake WS-A removes by
construction (P3-DEP-5 drops it from the record once addition 2 is green);
under `--parallel=3` the heavy `staff-dashboard`, `staff-client-card`,
`marketing-landing` and `booking-return-url.spec.ts` specs — judged on a
solo `--repeat-each=3` re-run. ecs-core coverage runs with
`--testTimeout=30000` on this container (brief-p3 §3). Emulator journeys
run with the proxy variables unset.

**Phase 3 additions to the FULL gate:**

1. **The runbook gates through the committed runner** (from C_E on;
   before it, the orchestrator's scratch extractor): `pnpm nx run
verify-tools:runbook-gates`, alone; at C_E both are run once and their
   per-section `ok` counts compared (equal, or the runner is wrong).
2. **The late-shop-time proof** (C_A and the final gate; P3-RU-34):

   ```bash
   # (i) the e2e half — STARTED between 23:15 and 23:30 Europe/Sofia on the REAL clock (the
   #     orchestrator wakes itself for it); no E2E_NOW: the run resolves its one instant itself
   [ "$(TZ=Europe/Sofia date +%H%M)" -ge 2315 ] && [ "$(TZ=Europe/Sofia date +%H%M)" -le 2330 ] || exit 2
   pnpm nx build functions && node tools/flags/write-functions-env.mjs --project demo-creativo-test
   START_LOGGING_EMULATOR=true \
   env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u GLOBAL_AGENT_HTTPS_PROXY \
     pnpm exec firebase emulators:exec --only firestore,auth,functions,storage --project demo-creativo-test \
     "pnpm nx e2e web -- e2e/client-card-glance.spec.ts e2e/appointments.spec.ts --repeat-each=3"
   # (ii) the seed half — any hour: the seed DOES read the instant (settledOnlyIfPast)
   SEED_NOW="$(TZ=Europe/Sofia date +%F)T23:40" \
   env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u GLOBAL_AGENT_HTTPS_PROXY pnpm run verify:p0
   ```

   Expected: (i) the glance 36/36 (2 tests × 2 themes × 3 projects × 3)
   and the month navigation 3/3 at the late real hour — the window in
   which the glance failed before (HANDOFF §4) — with the run's start and
   end times recorded in §8 (a run that crosses the shop's midnight is
   welcome: one instant per run keeps its day); (ii) `verify:p0` (a)–(g)
   green at the 23:40 seed instant. Only the pinned specs run in (i): every
   other e2e spec is callable-driven and only books or edits days ≥
   tomorrow, or is pinned already (§2.A.1), so a late hour changes nothing
   they compare; the ordinary `e2e:web` of the gate runs them all at
   whatever hour it runs. Setting `E2E_NOW` to a late time on the real day
   would NOT exercise a late hour (the instant reaches the pinned specs
   only as its day) — it is never offered as the proof.

### 6.2 Per package and per stage

Per package: its §3 "Checks", nothing else. Per stage (orchestrator,
before the commit): `rm -rf dist/out-tsc` + `run-many -t typecheck
--skip-nx-cache`, `run-many -t lint`, `run-many -t test --parallel=3
--skip-nx-cache`, layering, the grep gates alone, and the journeys of the
table below (one at a time); the full §6.1 after C_E and after each review
fix round.

| Stage | `test:emulator`                   | `verify:p0`           | `e2e:web`                 | `verify:csp`                  | addition 2 |
| ----- | --------------------------------- | --------------------- | ------------------------- | ----------------------------- | ---------- |
| C_A   | —                                 | yes ((a) one instant) | yes (glance pinned)       | yes (shares the global setup) | yes        |
| C_B   | yes (identity rows)               | yes                   | yes (sign-in writes rows) | —                             | —          |
| C_C   | yes (export proof)                | —                     | yes (export journey)      | —                             | —          |
| C_D   | yes (erasure proof, + storage)    | yes ((g))             | yes (erasure journey)     | —                             | —          |
| C_E   | the FULL §6.1 + additions 1 and 2 |                       |                           |                               |            |

Pass-specific checks (orchestrator; `grep -r` sees untracked files):

```bash
grep -rn "stillAheadToday\|LATEST_START\|EVENING_START" apps/web/e2e             # 0 (C_A)
grep -rn "Date.now()" apps/web/e2e --include=*.ts                                # operational reads + shop-clock's live shopToday + fixSuiteInstant only (C_A)
git diff --quiet -- apps/web/e2e/booking-core.spec.ts apps/web/e2e/csp/csp-smoke.spec.ts apps/web/e2e/staff-walk-in.spec.ts \
  apps/web/e2e/programs.spec.ts apps/web/e2e/support/booking-days.ts && echo unchanged   # the unpinned specs untouched (C_A)
grep -rn "saveOtp\|SaveOtp" libs apps --include=*.ts                             # 0 (C_B)
grep -rn "deleteUser(\|getStorage(\|\.bucket(" apps/functions/src --include=*.ts | grep -v spec   # firebase-admin.ts + the two eraser adapters only (C_D)
grep -rln "customerOrigin:" libs apps tools | grep -v -e 'tools/seed-dev-catalog.mjs$' -e 'libs/ecs-core/src/entities/customer.entity.ts$' \
  | xargs grep -L "erasureStatus\|ErasureLifecycle.none"                         # empty (C_D) — the two excluded files hold a comment (:533) and the type, no body
grep -rn "PRIVACY_CLIENT_ERASURE_RESWEPT\|erasure-resweep:" libs/ecs-core/src --include=*.ts | grep -v spec   # the verb's one home + its change key (C_D)
grep -rn "CREATIVO_E2E_SCREENSHOTS" .github apps/web                             # ci.yml (e2e job) + playwright.config.mts only (C_E)
node -e 'const j=require("./firestore.indexes.json");const a=j.fieldOverrides.filter(o=>o.collectionGroup==="auditLog");console.log(j.indexes.length, j.fieldOverrides.length, a.length)'
#   24 composites throughout; overrides 101 → 104 (C_B) → 107 (C_C) → 118 (C_D) → 120 (R1, the customer stamps); auditLog 40 → 43 → 46 → 57
node -e 'const j=require("./firestore.indexes.json");const q=[["appointments","subjectCustomerIds"],["appointments","contactPhone"],["appointments","contactEmail"],["appointmentPhotos","clientCustomerId"],["appointmentPhotos","appointmentId"],["couponGrants","customerId"],["giftVouchers","issuedToCustomerId"],["clientJournal","customerId"],["waitlistRequests","ownerUserId"],["invitations","inviterUserId"],["impersonationSessions","targetUserId"],["otps","destination"]];console.log(q.filter(([c,f])=>j.fieldOverrides.some(o=>o.collectionGroup===c&&o.fieldPath===f&&(o.indexes||[]).length===0)))'
#   [] — no footprint query field is switched off (C_C, C_D, R1 — also pinned by tools/verify/indexes/privacy-indexes.spec.mjs)
```

### 6.3 Measured baseline (the orchestrator fills it; measured on `20785b8` in `/home/user/baseline3`)

| Gate step                                                           | Baseline `20785b8`                                              | After C_A (WS-A)                                                             | Final (after C_E + reviews)                                                                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nx sync:check`                                                     | up to date (14 s)                                               | up to date                                                                   | up to date (11 s)                                                                                                                                                         |
| layering (files / import edges / scanned)                           | 952 / 4,245 / 2,623 (8 s)                                       | green (Law 8 holds)                                                          | 984 / 4,437 / 2,684 (8 s)                                                                                                                                                 |
| typecheck (projects green)                                          | 40 / 40 (594 s)                                                 | 40 / 40                                                                      | 40 / 40 (473 s)                                                                                                                                                           |
| lint (projects, errors, warnings)                                   | 44, 0, ___ (87 s)                                               | web, seed-tools, verify-tools: 0 errors; 3 pre-existing warnings             | 44, 0, 246 (69 s)                                                                                                                                                         |
| `run-many -t test` (targets; vitest + node; failed)                 | 44; 13,950 + 172; 0 (719 s) — orchestrator to confirm           | touched: web 57 (+31), seed-tools 567 (+23), verify-tools 178 (+6); 0 failed | 44; 14,627 + 239; 0 (530 s)                                                                                                                                               |
| ecs-core tests / statements % (covered / total)                     | 6,677 / 98.48 % (15,073 / 15,305)¹ (170 s)                      |                                                                              | 7,120 / 98.52 % (16,067 / 16,308)¹ (142 s); every new system / pipeline file ≥ 95 % (the seven: 98.50–100 %)                                                              |
| functions tests                                                     | ___                                                             |                                                                              | 1,437                                                                                                                                                                     |
| `verify-tools` tests                                                | 172                                                             |                                                                              | 239                                                                                                                                                                       |
| `seed-tools` typecheck / `lint-rules` tests                         | green (21 s) / 355 (12 s)                                       |                                                                              | green (26 s) / 355 (11 s)                                                                                                                                                 |
| `lint:styles`                                                       | green (2 s)                                                     |                                                                              | green (1 s)                                                                                                                                                               |
| `build web` initial (kB, transfer) + `verify:bundle`                | 583.82 kB (158.39 kB) + green                                   |                                                                              | 587.74 kB (159.30 kB) + green                                                                                                                                             |
| functions dist runtime dependencies                                 | 4 (firebase-admin, firebase-functions, libphonenumber-js, rxjs) |                                                                              | 4, same                                                                                                                                                                   |
| functions exports                                                   | 47                                                              | 47                                                                           | 50                                                                                                                                                                        |
| `firestore.indexes.json` composites / overrides                     | 24 / 101 (40 on `auditLog`)                                     | 24 / 101                                                                     | 24 / 120 (57)                                                                                                                                                             |
| runbook §4.2 / §4.3 / §4.4 / §4.5 / §4.7 / §4.8 / §4.9 / §4.10 `ok` | 28/22/17/6/24/27/25/20, 0 FAIL (118 s)                          | 28/22/17/6/24/27/25/20, 0 FAIL                                               | 28/22/17/6/24/27/25/20, 0 FAIL (112 s)                                                                                                                                    |
| `verify:p0`                                                         | (a)–(f) green² (149 s)                                          | (a)–(f) green; (a) "at one instant"                                          | (a)–(g) green² (129 s)                                                                                                                                                    |
| `test:emulator` (functions + infra)                                 | 103 + 361² (100 s)                                              |                                                                              | 135 + 361² (88 s)                                                                                                                                                         |
| `e2e:web` (passed / failed)                                         | 53 / 10²³ (577 s)                                               | 62 / 1 (see §8.A)                                                            | 67 / 1²³ (453 s) — `client-card-harness.spec.ts:17` [desktop, light], the listed load flake (§8.R2)                                                                       |
| `verify:csp` (hashes, smoke)                                        | both match; smoke 10 passed² (165 s)                            | smoke 10 passed                                                              | both match; smoke 10 passed² (117 s)                                                                                                                                      |
| late-shop-time proof (§6.1 addition 2)                              | — (no override existed)                                         |                                                                              | on `987e6e5` (§8.A): the e2e half 46 / 48 STARTED 23:15:11, ended 23:29:07 Sofia, no clock failure; the seed half (a)–(f) green at 23:40 — not repeated on the final tree |

¹ With `--testTimeout=30000` (a fast-check case runs ~5 s under v8 on 4 vCPU). ² Proxy variables unset (brief-p3 §3). ³ The 10 failures are exactly the ten `toHaveScreenshot` cases, which find no `-chromium-linux.png` in the fresh worktree; on the orchestrator's tree the LOCAL Linux references of the branch point are present (never committed), so from C_A on the screenshot cases compare the branch against the branch point on the same machine.

Expected movement: tests only up (every drop explained in §8); ecs-core
statements ≥ the baseline; layering grows by the added files only; `build
web` within a few kB (one card block, one adapter, one token); the grep
gates keep their reference counts.

---

## 7. Owner items touched (flags — copied into the PR)

1. **New copy, for review** (OR-51 / OR-55; every key in bg and en, the
   texts in §2.C and §2.D): `clientCard.privacy.groupLabel`, `.export`,
   `.exportDone`, `.erase`, `.alertTitle`, `.alertBody` (five figures and
   the account sentence), `.eraseConfirm`, `.eraseKeep`, `.erased`,
   `.eraseUnfinished`, `.eraseSibling`; `errors.PRIVACY_FORBIDDEN`,
   `PRIVACY_UNAVAILABLE`, `PRIVACY_CLIENT_NOT_FOUND`,
   `PRIVACY_EXPORT_TOO_LARGE`, `PRIVACY_ERASURE_STAFF_ACCOUNT`,
   `PRIVACY_ACCOUNT_LINK_MISMATCH`, `PRIVACY_ERASURE_TOO_LARGE`,
   `BOOKING_CLIENT_ERASED`; two icon keys on existing glyphs
   (`client.export` → `receipt_long`, `client.erase` → `delete`, P3-L-23).
   No existing string changes. Built at C_C: `errors.PRIVACY_FORBIDDEN`
   reuses OR-50's ONE forbidden line («Нямаш права за това. Влез отново
   или питай администратора.» / "You don't have access to this. Sign in
   again or ask an admin.") — the line the admin-only
   `LOYALTY_STREAK_PUBLISH_CALLER_NOT_ADMIN` already prints — instead of
   §2.C's «Само администратор може да го направи.».
2. **The latitude register** P3-L-1 … P3-L-23 (§0.3) — in particular the
   human seed's live default (P3-RU-1; flipping it is one constant,
   `SEED_DEFAULT`).
3. **Legal retention of visit and financial records** (research R10 /
   Q15: "a legal call"): erasure keeps every visit, its money and
   statuses, the journal, stats, loyalty, grants, vouchers and every audit
   row keyed by opaque ids (the owner's answer); Firestore PITR (7 days)
   and the scheduled backups (28 days) keep pre-erasure values until they
   age out, the 400-day log bucket keeps ids and roles (no values, R36),
   and Storage keeps a deleted avatar or `SHOT` object (with its
   `clientLabel` metadata) for the bucket's soft-delete window (7 days by
   default on a new bucket; `docs/production-deploy.md:372-373` asks for a
   Storage policy); an OTP challenge requested for the person's phone or
   e-mail between the sweep and the stamp, or stored under another
   spelling (F2-10: the trimmed RAW text, `request-otp.pipeline.ts:142`),
   keeps its destination until its TTL (≤ 1 day past expiry) — counsel to
   confirm Art. 17(3)(b)/(e) covers the retained records and the backup
   windows; runbook §2.5 and `production-deploy.md`'s backups bullet state
   it.
4. **Auth deletion vs disabling**: DELETED (P3-L-9) — the identifier is
   freed and a later sign-in is a new person; disabling (a ban list) is a
   separate product decision, not built.
5. **Permanent identity rows from an unauthenticated path**:
   `IDENTITY_OTP_REQUESTED` is written per accepted request (one per
   destination per 60 s, OR-9) and `auditLog` is never TTL'd — accept, or
   drop the REQUESTED verb and keep VERIFIED / REFUSED / SESSION /
   REGISTRATION (all need a real code or a verified caller). The
   pre-session rows carry no caller-chosen operation id (P3-L-20). A
   REQUESTED row also stands for a code that was never SENT: the challenge
   and its row commit before `sendOtp` (RU-3's order), so while P8 stays
   FAIL every production request leaves one for an undelivered code — the
   `callable.refused` outcome line tells them apart; the alternative is to
   move the row into its own commit after a successful send. App Check
   (Deferred #4) is the platform answer and stays deferred.
6. **The undo window** (research §6.16.2) — NOT built: erasure is
   immediate after ONE alert (P3-L-13); a window would add an elapsed-time
   rule to flatten-spec §2.3 T2. The alert does not single out the
   person's FUTURE visits (the census counts every retained visit; a
   blocker needs the per-visit shop clock, OR-8) — they stay booked, with
   no contact to call. **Step-up re-verification** (R47) — NOT
   built: it needs App Check (Deferred #4, still deferred — not wired).
7. **Who may export and erase**: the shop's `admin` only, not the vendor
   `sysadmin` (P3-RU-13; one line to widen to `Roles.isAdmin`).
8. **The export cap** (P3-L-6): 20,000 documents or 4 MiB; a larger person
   is refused, never truncated — a runbook export (the research's Storage
   ZIP) is the follow-up. The platform's callable response limit was not
   verifiable here.
9. **Export redaction** (P3-RU-18, P3-L-5): shared visits carry other
   people's opaque ids but no value of theirs; staff appear by uid; `otps`
   and `impersonationSessions` are omitted; audit rows only when they target
   the person; no voucher `code` is exported, the person's own included (a
   bearer capability, like the photo `url` — the person can ask the shop
   for it); party-visit notes are withheld (P3-RU-33); the avatar image is
   not exported (bytes; no document names it) — counsel to confirm.
10. **Search after erasure** (P3-RU-19): an erased person is unfindable by
    search (the derived search keys are personal values); «Изтрит клиент»
    shows where the record is opened by id (the card).
11. **Walk-in records sharing a contact are not merged** (P3-L-7, Deferred
    #2): the account person's preview names every walk-in record keyed by
    their phone or e-mail (ids only), the alert counts them, and the card
    offers each as its own erase act — so a person who was also served as
    a walk-in can be fully erased from their account's card. Limits: the
    siblings are derivable only BEFORE the stamp (the contact values are
    cleared by it), so they must be erased from the same card session; a
    walk-in-ONLY person (no account) has no card in Phase 3 — the
    callable accepts the record id, but no UI reaches it (follow-up: a
    staff search → record route), and `production-deploy.md`'s
    "Data-subject requests" item says so. A shared phone may be another
    person's record (OR-26): the admin decides per sibling. The referee's
    `invitations/*/redemptions/{uid}` cannot be found without the parent
    path and is kept (ids and a stamp).
12. **Browser-written notes and photos during or after an erasure** (the
    rules cannot read the record's tag without a `get()` per write): a note
    or photo written between two calls is swept by the next call; one
    written AFTER completion is about an OLD visit of the person (every
    booking of the record is refused), and the next call on the ERASED
    record re-sweeps it with a `PRIVACY_CLIENT_ERASURE_RESWEPT` row
    (P3-L-19) — the card offers that call beside «Изтрит клиент». Nothing
    sweeps it unless an admin makes that call. No rules change.
13. **No resurrection — refused, not re-created** (P3-RU-20): the desk books
    an erased contact as an anonymous guest; a returning person's phone can
    never be recorded again as a walk-in until a generation scheme is
    designed. `apps/web/e2e/**` stays typechecked by no Nx target (lint
    only).
14. **Single-field exemptions**: 101 → 120 field overrides (the per-database
    cap is not in the confirmed quota list — recalled as 200; confirm before
    deploy, carried from Phase 0–2 flag 16).
15. **CI required checks**: the job `main` keeps its name (branch protection
    may require it); the six new jobs start non-required — mark them
    required after a run of green builds. Runner size (private repo: 2 vCPU)
    and the minutes are the owner's.
16. **The Hosting CSP smoke in CI** (P3-RU-31) supplements OR-31; the CI
    screenshot policy (P3-RU-30): the macOS full gate is the screenshot
    gate; generating Linux baselines on a pinned runner is a follow-up.
17. **Deploy steps (owner)**: `firestore:indexes` (the new overrides) →
    `functions` (the three privacy callables, the identity rows) →
    `hosting`; `client.privacy` stays `false` in production until the
    owner lights it (functions first, then web, per `production-deploy.md`);
    the default Storage bucket must exist (the functions' default service
    account deletes objects and Auth users with its default roles —
    confirm on the project). Nothing new for secrets — the existing
    `WALKIN_ID_KEY` is also bound to the three privacy callables
    (P3-RU-36).
18. **`.claude/rules` edits**: none expected — `ecs-components.md` and
    `firestore-layout.md` name the APPOINTMENT intersection (unchanged); if
    a builder finds text this phase makes false (e.g. a rules file listing
    the `Customer` slices), the integrator edits it and lists it in the PR.
    No `CLAUDE.md` / `AGENTS.md` edit; **no law amendment is required**
    (every design has a lawful form, §0.2).
19. **Out-of-scope edges touched** (brief §2): no App Check, no
    impersonation read-as, no OTP provider (P8 stays FAIL), no Activity
    screen (the export reads the WS-7 ports server-side only), no
    `setRoles` (a staff account is refused, not demoted), no `maxPartySize`
    cap, no existing copy changed.
20. **Party-visit notes are erased with the person** (P3-RU-33): every
    note of every visit the person sat in is deleted — the brief's text —
    so the companions of a shared visit lose its note; party notes are not
    exported (they may hold a companion's free text). Alternatives: keep
    them (counted) behind an admin redaction surface (research §6.16.2), or
    export them too (counsel).
21. **Dated e2e seeds and a midnight exposure, flagged not fixed**: the
    `2030-06-01T10:00` visits of `appointments.spec.ts:57`, `:123`, `:161`,
    `account-dashboard.spec.ts:58` and `account-dashboard-screenshots.spec.ts:38-39`
    turn from upcoming to past after 2030-05-31 (re-dating the screenshot
    seed is a macOS-gate change: the baselines are darwin-only);
    `booking-core.spec.ts:302` / `:371-378` compare Node's live day with the
    live page and server, so a run crossing the shop's midnight between the
    two reads is exposed (pre-existing, unchanged — §2.A.1).
22. **CI keeps the config's two e2e retries** (P3-RU-35): a test that
    passes on a retry is reported `flaky` (trace kept) instead of failing
    the run; the local gate keeps 0 retries. The owner may make CI strict
    (`retries: 0` under `CI` too — one line in `playwright.config.mts`;
    expect red runs on the load flakes HANDOFF §4 lists).
23. **Writers the erasure does not refuse** (§2.D writer table):
    `startImpersonation` may target an erased uid and write a new free-text
    `reason` (OR-24 is out of scope; the pipeline reads no target) — the
    next erasure call pseudonymises it; the erased account's live ID token
    (≤ 1 h) may upload an avatar — deleted by every later erasure call; a
    `storage.rules` guard reading `users/{uid}.accountStatus` (a
    `firestore.get()` per upload, with its rules spec) is the stronger
    option, not built.
24. **A contact matched by value may name a phone-sharer** (P3-DEP-28,
    review round 1): a visit is the person's by contact when its phone or
    e-mail equals the record's or the account's — the same rule the walk-in
    key already applies (OR-26: two people sharing a phone share a walk-in
    record). The erasure clears such a contact even when its NAME is a
    family member's (it errs to clearing, P3-L-12), and the export shows it
    to the person whose phone it is. Alternatives: match the name too, or
    clear the phone and keep the name (both need counsel). Also: the note of
    a visit that no longer seats the person is kept (it is the remaining
    visit's); an edit that removes the booker's seat could re-point or clear
    the contact at the source (a desk-behaviour change, not built).
25. **A one-time contact override stays unfindable** (P3-DEP-28): a
    booking whose contact sheet typed values matching neither the record's
    nor the account's phone or e-mail carries a contact no footprint read
    finds once the person's seat is removed; only the person's stored values
    are searched. Since P3-DEP-34 every contact carrying the stored values is
    cleared before the stamp, so the gap is this one: a contact proved only
    by id under other values (such an override), or on a visit booked after
    the call's outside read and before its stamp, can still be orphaned if
    the desk removes the person's seat after the stamp and before that
    visit's unit commits. Alternatives: refuse a `REMOVE_SEAT` of an
    `ERASING` record's seat (a desk-behaviour change, its own DEP), or clear
    the contact at the source when the booker's seat is removed (item 24).
26. **Storage writes aimed by staff-written documents** (P3-DEP-30, -31):
    the erasure deletes only a `SHOT` photo's own object and clears the
    `clientLabel` of a `LIBRARY` photo's object at the document's `path` (a
    metadata-only change); `firestore.rules` still accepts any `path`,
    `photoOrigin`, `clientCustomerId` on an `appointmentPhotos` create. The
    defence in depth — pin `photoOrigin in ['SHOT','LIBRARY']` and, for
    `SHOT`, `path == 'appointmentPhotos/' + appointmentId + '/' + photoId`,
    with its rules spec — is not built (a rules change needs its emulator
    run). A `LIBRARY` path the SDK permanently refuses stalls that photo
    chunk, as a failing object did before.
27. **A missing `users` document refuses the erasure** (P3-DEP-29): a
    client whose `users/{uid}` was removed out of band while the Auth user
    remains cannot be erased from the card (`PRIVACY_ERASURE_STAFF_ACCOUNT`
    is answered) until an operator deletes that Auth user (or restores the
    document); erasure then proceeds.
28. **The STARTED census is the census when the stamp lands** (review
    round 2, P3-DEP-28, P3-DEP-33): a contact an EARLIER call's sweep
    cleared is not counted in it — that call spent its budget mid-sweep
    (P3-DEP-28), or failed a commit between the sweep and the stamp, in
    which case the admin's next act runs under a new operation id (the card
    mints one per preview). The cleared visit carries that earlier call's
    `writeOperationId`, and that act's `PRIVACY_CLIENT_ERASURE_SWEPT` row
    (P3-DEP-33) holds its census BEFORE — the swept contacts included — so
    no clear goes unaudited; only the STARTED row's `erasureContactCount`
    undercounts (`appointments` is ungoverned, and keeping the count exact
    would need state the stateless census, P3-RU-22, does not keep).
    Alternatives: move the stamp into the transaction of the sweep's last
    chunk (≤ 25 + 4 operations; the mid-sweep budget stop then goes too), or
    keep a swept count on the record.

---

## 8. Ledger (the orchestrator fills it)

| Workstream                    | Packages                             | Status | Commit sha                        | Gate result                                                                                                                                                                      |
| ----------------------------- | ------------------------------------ | ------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WS-A — seed clock pinning     | PA1, PA2                             | GREEN  | `987e6e5`, `7d4bca9`              | §8.A                                                                                                                                                                             |
| WS-B — login / OTP audit rows | PB1, PB2, PB3                        | GREEN  | `0ac7801`                         | §8.B                                                                                                                                                                             |
| WS-C — GDPR export            | PC1, PC2, PC4, PC3, PC5              | GREEN  | `bd5c1a4` (+ `ce5ac31`, P3-RU-37) | §8.C                                                                                                                                                                             |
| WS-D — GDPR erasure           | PD1, PD2a, PD3b, PD2b, PD4, PD3, PD5 | GREEN  | `7f26e84`                         | §8.D                                                                                                                                                                             |
| WS-E — CI pipeline            | PE1, PE2                             | GREEN  | `825b6e9`                         | §8.E                                                                                                                                                                             |
| Review round 1                | fixer                                | GREEN  | `d2c85b7`                         | §8.R1                                                                                                                                                                            |
| Review round 2 + FULL gate    | fixer                                | GREEN  | `ff69759`                         | §8.R2 + final gate — all green; `e2e:web` 67/68, the red a listed load flake (`client-card-harness.spec.ts:17`), 27/27 solo; the committed runbook runner equal to the extractor |
| Owner review — no-op mappers  | sweep A + law fixes B                | GREEN  | `968a97e`, `ac23b1d`              | §8.R3 — every journey green on each                                                                                                                                              |

### 8.A C_A — WS-A seed clock (2026-10-27)

- **Built** by PA1 ‖ PA2 with no integrator edit (`stage-C_A` report):
  PA1 `tools/seed/calendar.mjs` (`SEED_NOW_ENV`, `SEED_DEFAULT`,
  `seedNowTextOf`, `seedNowOf`), `tools/seed/fixtures.mjs`,
  `tools/seed-dev-catalog.mjs`, `tools/seed/seed-clock.spec.mjs`,
  `tools/seed/seed-data.spec.mjs`, `tools/seed/fixtures/README.md`,
  `tools/verify/p0/seed-run.mjs` (+ spec), `verify-p0.mjs`, its README;
  PA2 `apps/web/e2e/support/shop-clock.ts`, `suite-clock.ts`,
  `global-setup.ts`, `client-card-glance.spec.ts`, `appointments.spec.ts`,
  `apps/web/src/testing/e2e-suite-clock.spec.ts`. Accepted deviations:
  `proofInstantOf` takes the seed's own reader (one parser);
  `BROWSER_PIN_MINUTE` is a branded `MinuteOfDay`.
- **Orchestrator edit at the gate:** `pinBrowserClock` uses
  `page.clock.setSystemTime` (a running clock), not `setFixedTime` (§0.5
  "The pin flows").
- **Journeys:** runbook gates as the baseline; `verify:p0` (a)–(f) green
  with (a) at one instant; `verify:csp` smoke 10 passed. `e2e:web`: first
  run (frozen pin) 62/63 — the glance barber case [phone, light], an
  agenda row that never arrived; after the switch to a running pin, 62/63
  — `appointments.spec.ts:36` (UNPINNED, unchanged by WS-A: the page still
  `loading` after 5 s, the file's first test — the known load class of
  HANDOFF §4), 12/12 in a solo `--repeat-each=3` run of the file.
- **Glance solo runs (`--repeat-each=3`, 36 each):** frozen pin 35/36;
  running pin 35/36 then 36/36; the unpinned branch point 36/36. The two
  pinned reds are ONE case at ONE attempt (desktop, light, repeat 2): the
  card's name still the seat's «Клиент без име» after 5 s — `users/{uid}`
  not yet answered. No clock mechanism was found (the card names the
  profile once its one `getDoc` answers; nothing there reads the clock); it
  is recorded as a WATCH item for the review rounds and the late run, not
  as a fixed cause.
- **Reported, not made:** `tools/verify/project.json` test `inputs` do not
  name `tools/seed/calendar.mjs` (a cached `verify-tools` run would miss a
  calendar change) — PE1 adds it (it owns that file at C_E).
- **The late real-hour run** (§6.1 addition 2, P3-RU-34) on the committed
  C_A tree (`987e6e5`, `/home/user/baseline3`): e2e half STARTED 23:15:11
  and ended 23:29:07 Europe/Sofia (21:15–21:29 UTC) — the glance and
  `appointments.spec.ts`, `--repeat-each=3`: 46 / 48. The two reds are not
  the clock: the glance barber case at [desktop, light, repeat 2] — the
  card's name still the seat's after 5 s; its trace shows the Firestore
  channel's forward POST blocked 4.9 s before the profile's `addTarget`
  could even be sent (an emulator stall, the same attempt slot as two
  earlier solo runs) — and `appointments.spec.ts:36` (UNPINNED, unchanged
  by WS-A: the page still `loading` after 5 s). The failure WS-A removes
  never appeared: every «Предстоящи» / `history-upcoming` assertion held in
  the 17 barber and 18 birthday runs between 23:15 and 23:29, and the month
  navigation passed 3/3. Seed half: `SEED_NOW=2026-10-27T23:40 verify:p0`
  (a)–(f) green (23:31:32).
- **The name waits as the plate does** (orchestrator, after the late run):
  the glance's two `client-head-title` assertions and the privacy
  journey's take `{ timeout: 20_000 }`, the spec's own idiom for a server
  read (the plate, the ledger, the medal, the verb all wait 20 s); the
  asserted text is unchanged. P3-DEP-4 carries it.
- **P3-DEP-5 applied:** the glance time-of-day clause leaves HANDOFF §4
  (records pass), with this run as its evidence; the owner may repeat it
  after 23:15 shop time (`late-proof` recipe, §6.1 addition 2).

### 8.B C_B — WS-B login / OTP audit rows (2026-10-27)

- **Built** by PB1 · PB2 · PB3 (`stage-C_B` report), no integrator edit;
  accepted deviations: `idBasisOf` is the typed face of the already public
  `rowBasis`; `registrationIdentifierChannel` carries an `N15-exempt` pair
  line; two added commits annotate decide `Result<…, never>`; a
  `requestOtp` store failure throws inside the commit and still answers the
  coded `IDENTITY_REPOSITORY_FAILURE` at the edge. Orchestrator edit: the
  `AuditEntryMeta` doc comment lists `impersonationSessions/{id}` and
  `otps/{id}` among the resource spellings.
- **Checks:** typecheck 40/40; layering; sync; lint 44 projects, 0 errors,
  246 warnings (the baseline's); `run-many -t test` 14,060 vitest (ecs-core
  6,677 → 6,731, functions 1,320 → 1,322) + verify-tools 178 + lint-rules
  355, 0 failed; prettier; `saveOtp` 0; indexes 24 / 104 (43 on `auditLog`).
- **Journeys:** runbook gates as the baseline; `test:emulator` 113 (+10:
  `request-otp.integration.spec.ts` 5, `verify-otp` +4, `complete-registration`
  +1) + 361; `verify:p0` (a)–(f); `e2e:web` 63/63 in 587 s against the
  baseline's 577 s — the settle fingerprint's extra rows cost +1.7 %, inside
  P3-DEP-7's 10 % budget.

### 8.C C_C — WS-C GDPR export (2026-10-27)

- **Built** by PC1 · (PC2 ‖ PC4) · (PC3 ‖ PC5) (`stage-C_C` report).
  Integrator edits: the `WalkInKeyPorts` doc comment (`tx.port.ts`) names
  the admin privacy pipelines (P3-RU-36); `pipelines/index.ts` back in
  alphabetical order. Accepted deviations: a `PrivacyMarker` root type and
  `PrivacyError.InputField`; `documentCount` takes `ownRowId`; a
  distributive `Without<>` over the union archetypes (no `Omit` on a ports
  type); token roles checked before the stored roles; a `cursor-stalled`
  read guard on the audit paging; the card block absent when `ID_PORTS` is
  unbound; the integration spec holds 10 cases (the plan named 6).
- **Checks:** typecheck 40/40; layering 971 files / 4,362 edges; sync;
  lint 44 projects, 0 errors, 246 warnings; `run-many -t test` 14,259
  vitest (ecs-core 6,847, functions 1,376, staff-client-card 1,010) +
  verify-tools 178, 0 failed; prettier; indexes 24 / 107 (46 on
  `auditLog`), no footprint field switched off.
- **Journeys:** `test:emulator` 123 (+10:
  `export-client-data.integration.spec.ts`) + 361; `e2e:web` 66/66 (+3:
  `staff-client-privacy.spec.ts`) in 642 s; runbook gates as the baseline.
- **Open for the review rounds (not built):** the export does not check
  the D29 link (`record.id === CustomerId.forUser(record.userId)`) the
  erasure checks (P3-L-9) — a corrupt `userId` would export another
  account's profile; `PRIVACY_EXPORT_TOO_LARGE`'s counts are not in the
  edge's `WIRE_PARAM_ALLOWLIST` (the web words the code only); TTL'd
  notification / waitlist documents export `purgeAt` in the Admin SDK's
  Timestamp shape (`{_seconds,_nanoseconds}`); stale runbook line
  references in `docs/production-deploy.md` (a records item).

### 8.D C_D — WS-D GDPR erasure (2026-10-28)

- **Built** by PD1 · (PD2a ‖ PD3b) · (PD2b ‖ PD4) · (PD3 ‖ PD5); a
  container restart at ~22:24 UTC interrupted W-D2 — the run resumed (PD1
  from its cached result, PD2a / PD3b finishing their own half-edited
  files). Integrator edits: `libs/features/staff/client-card/tsconfig.lib.json`
  gains the `ui/patterns` reference (`UiAlert`; `sync:check`), the
  `WalkInKeyPorts` doc names the two erasure callables, the `verify:p0`
  README (g) sentence. Orchestrator edit at the gate:
  `staff-client-privacy.spec.ts` waits for the sheet's scroll to rest
  before each axe scan (`sheetAtRest`) — a `target-size` on the visits
  header's small action, caught passing under the sticky bar mid-scroll
  after the export press (2 of 4 dark runs); the axe gate is unchanged.
- **Checks:** typecheck 40/40; layering; sync; lint 44 projects, 0 errors,
  warnings as the baseline; `run-many -t test` green (ecs-core 7,071,
  functions 1,429, staff-client-card 1,032, staff-dashboard 582); builds,
  `verify:bundle`, `icons:check`, the functions' four dependencies; indexes
  24 / 118 (57 on `auditLog`); ecs-core statements 98.52 % (PD2b).
- **Journeys:** runbook gates as the baseline; `test:emulator` 134 (+11:
  `erase-client.integration.spec.ts` 9, the export's link and `purgeAt`
  cases) + 361; `verify:p0` (a)–(g) — (g) "an admin erasure leaves no
  personal value in a row, a dead letter or a log line — and keeps the
  visits"; `e2e:web` 67/68 then, after `sheetAtRest`, the privacy spec 15/15
  solo and the suite 68/68.
- **Corrections to the plan:** §4 PD3 (3) — the governed triggers' rows
  carry `auditOperationId: null` (WS-3 never names an operation on a
  trigger row, `governed-audit.integration.spec.ts`); the proof joins the
  erasure through the erased documents' `writeOperationId`.
  `export-client-data.integration.spec.ts` derives its ids with its world's
  `fixtureHash` (under `sha256Hex` the P3-RU-37 (h) link arm refuses every
  case); P3-DEP-9 carries it.
- **Decided for review round 1 (P3-RU-37 delegation):** a `LIBRARY`
  photo's KEPT object loses its `clientLabel` custom metadata on erasure
  (a name in Storage metadata is a personal value — the object is kept,
  the label is not); the customer stamps `erasureStartedAtUtcMs` /
  `erasedAtUtcMs` get `indexes: []` (scalars never queried — the WS-2 /
  P3-L-4 precedent), `erasureStatus` keeps its index; the empty
  `ui-alert` host adds no gap to the privacy block; the eraser adapter
  reuses `auth-claims.adapter.ts`'s Auth error helpers instead of
  restating them. **Owner (§7):** the runbook §3 service-account roles
  (Firebase Authentication Admin + Storage Object Admin, or Editor) are
  confirmed on the real project before deploy.

### 8.E C_E — WS-E the CI pipeline (2026-10-28)

- **Built** by PE1 ‖ PE2. Integrator edit: `tools/verify/project.json`'s
  test inputs widened (`apps/web/e2e/**/*.ts`, the CSP config, the web
  project and tsconfigs, `@playwright/test`). Accepted deviations: `main`
  times out at 75 min (sized on the baseline's cold typecheck and test);
  the e2e report uploads on `!cancelled()` (a flaky pass keeps its trace);
  `main` keeps its own install steps; the runner skips headings inside a
  fence and refuses an explicit §4.0 / §4.6 / unknown section with exit 2.
- **Orchestrator edit at the gate:** run under `nx run`, the committed
  runner FAILED §4.9 (6 FAIL) where the scratch extractor passed: Nx forces
  colour into its tasks, and the nested `nx lint` printed ANSI codes
  around the canary count the gate parses. `gateEnvOf` (in
  `runbook-gates.mjs`, spec'd) runs every gate with `NO_COLOR=1` and no
  `FORCE_COLOR`. After it, `pnpm nx run verify-tools:runbook-gates` equals
  the extractor section for section: §4.2 28 · §4.3 22 · §4.4 17 · §4.5 6
  · §4.7 24 · §4.8 27 · §4.9 25 · §4.10 20, 0 FAIL, 0 ERROR (96 s).
- **Checks:** typecheck 40/40; layering; sync; lint `verify-tools`, `web`
  0 errors; `verify-tools` 223 (+45) and `web` 57 green; prettier;
  `node --check`; `CREATIVO_E2E_SCREENSHOTS` only in `ci.yml` (the e2e job)
  and `playwright.config.mts`; name check 0.
- **Order:** C_E is committed and pushed BEFORE its full local gate (a
  departure from §3's boundary): the seven jobs can only be proven on
  GitHub's runners, so they run while the FULL gate (§6.1) runs here on
  the same tree; a regression either finds is fixed in its own commit.

Statuses: TODO / IN-PROGRESS / GREEN / BLOCKED. On resume, continue from
the first non-GREEN row; never redo a GREEN one. The records (the Phase
0–2 brief's §10, the pass-F way): a HANDOFF §2 row "Audit hardening (Phase
3)"; a new reference-numbers block at the top of §4 (§6.3's final column)
and §4's gate naming the runbook runner and the late-shop-time proof; the
P3-DEPs and the §7 owner flags appended at the end of §3.3 in the pass-F
format; the carried list pruned (the glance time-of-day flake, the "no
login / OTP audit rows" and "GDPR export / erasure (Phase 3)" items) and
extended (§7 items 3, 5, 6, 8, 9, 11, 12, 13, 14, 15, 20, 21, 22, 23); the
§4 sentence "CI runs this static half after every build"
(`HANDOFF.md:2692-2693`) extended with the `csp-smoke` job; the C_B
settle-fingerprint measurement (P3-DEP-7) and the late-shop-time run's
start and end times; this ledger filled,
with a per-package file list, every integrator edit beyond the packages,
and every spec count that dropped explained.

**Stop conditions** (the Phase 0–2 brief's §11, carried): a fix needs a
decision no ruling or this plan covers; a law forbids a design with no
lawful variant; a merged `origin/main` ruling contradicts a workstream;
the gate is red for a reason not attributable to the diff after two
attempts. Phase 3 adds: the late-shop-time proof fails for a reason inside
the app (not the harness) — stop and report before the next commit; the erasure proof
(§4 PD3 cases 1–5) cannot be made green without weakening a scan — stop
before C_D.

### 8.R1 Review round 1

Seven CONFIRMED findings (findings 1 and 6 are one defect) and the
orchestrator's four decisions, all applied by the fixer (no commit).

1. **MAJOR — a visit that kept a removed person's contact was never
   exported or erased, and `ERASED` was still certified**
   (`libs/ecs-core/src/pipelines/erase-client.pipeline.ts`,
   `export-client-data.pipeline.ts`). **FIXED (P3-DEP-28):** the footprint
   also reads `ListVisitsByContact` (`contactPhone ==` / `contactEmail ==`
   each of `ClientPrivacySystem.contactValuesOf`, merged by id — the
   erasure only while the record is `NONE`); `contactIsPersons` gains the
   value arm (`contactCarriesValueOf`, the id arms `contactProvedById`); the
   census counts such a contact; `ClientErasureSystem.contactSweepWrites`
   clears, BEFORE the stamp and re-decided per visit in its transaction,
   every contact only the value arm recognises (a budget spent mid-sweep
   answers `NONE`, not done, and stamps nothing). Specs:
   `client-privacy.system.spec.ts` (the `REMOVE_SEAT` shape through
   `AppointmentIndexSystem.withQueryKeys`, the walk-in variant, the value
   arm, cleared values, purity); `client-erasure.system.spec.ts`
   (`contactSweepWrites`, the census); `erase-client.pipeline.spec.ts`
   (cleared before the stamp, the STARTED census, the preview, a budget
   spent after and DURING the sweep, a visit retyped meanwhile kept);
   `export-client-data.pipeline.spec.ts` (the visit in P's bundle with its
   contact, not in Q's; the reads); `firestore-privacy.adapter.spec.ts`
   (the two equalities, the merge, the guard, a failure naming
   `appointments` only); `erase-client.integration.spec.ts` (7) (emulator).
   Residuals as owner flags §7 items 24, 25.
2. **MAJOR — a preview of the card's own record after the stamp wiped the
   sibling rows** (`libs/features/staff/client-card/src/lib/client-card.store.ts`).
   **FIXED:** `ClientPrivacySystem.siblingsAfterPreview(kept, preview)` —
   the preview's list while `NONE`, else the kept one (Law 10.2); the store
   calls it. Specs: `client-privacy.system.spec.ts` (NONE replaces even
   with `[]`, ERASING / ERASED keep, purity); `client-card.store.spec.ts`
   (a refusal mid-act then the RESUME preview; an ERASED re-sweep preview —
   both keep both rows and a sibling's preview still runs; both fail
   without the fix).
3. **MINOR — the shared own-walk-in rule was dead while two systems restated
   it; `distinct` copied three times**
   (`libs/ecs-core/src/systems/client-privacy.system.ts`). **FIXED
   (P3-DEP-32):** `isOwnWalkInSeat` (a type guard) and `distinct` are
   `ClientPrivacySystem` members both systems and the pipeline call;
   `destinationsOf` / `siblingIdsOf` derive from `contactValuesOf`.
   `client-export.system.spec.ts` passes unchanged. `PrivacyError.is`,
   `STATUSES`, `ACTOR`, `bundleOf` left as they are (refuted parts).
4. **MINOR — comments made false by WS-D** (`ports.tokens.ts`,
   `app.config.ts`, `client-card.store.ts`, `search-fields.data.ts`,
   `search-fields.system.ts`, `user.entity.ts`, `customer.entity.ts`).
   **FIXED:** comment-only, as proposed; no spec.
5. **MAJOR — the erasure deleted any Storage object a staff-written photo
   document named, and a bad path blocked completion forever**
   (`libs/ecs-core/src/systems/client-erasure.system.ts`). **FIXED
   (P3-DEP-30):** `photoPlan` lists a `SHOT` object only at the photo's own
   `appointmentPhotos/{appointmentId}/{id}`; every admitted document is
   still removed. Specs: `client-erasure.system.spec.ts` (media, another's
   avatar, another visit's shot and an empty path never listed, documents
   removed; an empty `LIBRARY` path clears no label);
   `erase-client.pipeline.spec.ts` (forged media and empty paths never
   reach `deleteStoredObject`, the media object kept, ERASED and done). The
   fixture paths drop `.jpg` (the real layout). Rules hardening left as
   owner flag §7 item 26.
6. **MAJOR — the same defect as 1** (`client-erasure.system.ts`
   `visitWrites`). **FIXED with 1** (P3-DEP-28).
7. **MINOR — the Auth-claims half of the staff refusal read claims no
   production path sets** (`apps/functions/src/adapters/firebase-auth-eraser.adapter.ts`).
   **FIXED (P3-DEP-29):** `refusalOf` refuses a linked uid with no `users`
   document while its Auth user exists; the claims check stays. Specs:
   `client-erasure.system.spec.ts` (`[]` and client claims refused, `null`
   passes); `erase-client.pipeline.spec.ts` (refused with nothing written
   and the preview refused; the "users document gone" case now removes the
   Auth user too); `erase-client.integration.spec.ts` (6) without
   `setCustomUserClaims`. Docs: P3-L-16, §4 PD2b / PD3, runbook §1.1, the
   adapter and port comments. Owner flag §7 item 27.

**Decided by the orchestrator (P3-DEP-31):** **D1** `clearStoredLabel`
(`ObjectEraserPorts`, `storage-objects.adapter.ts`; idempotent, no object
or no key is done) clears a `LIBRARY` photo's kept object's `clientLabel`
before its document goes (the photo unit; a failure keeps the chunk) —
`storage-objects.adapter.spec.ts`, `client-erasure.system.spec.ts`
(`labelPaths`), `erase-client.pipeline.spec.ts` (label gone, object kept,
Q's label kept; a failing clear resumes), `erase-client.integration.spec.ts`
(1) (the object exists, its metadata has no `clientLabel`; the census
tracks photo documents, not objects, so no count changes). **D2**
`customers.erasureStartedAtUtcMs` / `erasedAtUtcMs` `indexes: []`
(overrides 118 → 120; §6.2, §6.3, §7 item 14, `production-deploy.md` §3.1
count) — `tools/verify/indexes/privacy-indexes.spec.mjs` (also pins every
footprint field, `contactPhone` / `contactEmail` included, as indexed).
**D3** `.client-card__privacy > ui-alert { display: contents }` —
`client-card.spec.ts` (the host is a boxless child of the stack: DOM +
stylesheet). **D4** the eraser adapter imports `authCodeOf` /
`authFailure` from `auth-claims.adapter.ts`; specs unchanged and green.
**Not fixed (decided):** `PRIVACY_EXPORT_TOO_LARGE`'s counts stay out of
`WIRE_PARAM_ALLOWLIST`.

Checks after the fixes (no emulator): `typecheck` 40 projects green
(`--skip-nx-cache --parallel=1`, `dist/out-tsc` cleared); `verify-tools:layering`
OK (984 files / 4,437 edges in ecs-core, 2,684 scanned); `nx sync:check` up
to date; `lint` (ecs-core, functions, staff-client-card, firebase-app, web,
verify-tools) 0 errors, warnings equal to the C_D counts (ecs-core 42,
functions 28, staff-client-card 31, web 2, verify-tools 1); `test` all 44
projects green (ecs-core 7,071 → 7,108, functions 1,429 → 1,437,
staff-client-card 1,032 → 1,035, verify-tools 223 → 239); ecs-core
coverage thresholds green, statements 98.51 %; prettier clean on the
changed files. Not run here (the orchestrator's): `test:emulator`
(`erase-client.integration.spec.ts` cases (1) the `LIBRARY` label, (6)
without custom claims, (7) the removed-seat visit; the seed's photo paths
drop `.jpg`; `export-client-data.integration.spec.ts` now also issues the
by-contact queries), `verify:p0` (g), `e2e:web` (`staff-client-privacy.spec.ts`
— the alert host's `display: contents`), the runbook gates (§1.1 text).

**Round-1 gate (orchestrator, 2026-10-28 03:48–04:22 UTC, the FULL §6.1
on the round-1 tree):** sync, layering, typecheck 40/40, lint, `run-many
-t test` 14,614 vitest, ecs-core statements 98.51 % (16,058 / 16,300),
`seed-tools`, `lint-rules`, `lint:styles`, `build web` 587.74 kB initial +
`verify:bundle`, functions build + four dependencies, showcase, runbook
gates 28/22/17/6/24/27/25/20, `verify:p0` (a)–(g), `test:emulator` 135 +
361, `verify:csp` 10 — all green; `e2e:web` 67/68, the red
`appointments.spec.ts:161` (the cancel case — the load flake HANDOFF §4
lists as `:152`/`:158`: the row not yet drawn after 5 s; untouched by the
round), 12/12 in a solo `--repeat-each=3` run of the file.

### 8.R2 Review round 2

Five CONFIRMED findings, all applied by the fixer (no commit).

1. **MINOR — contact clears made before the stamp got no audit row when the
   act stopped before the stamp**
   (`libs/ecs-core/src/pipelines/erase-client.pipeline.ts`). **FIXED
   (P3-DEP-33):** a fourth erasure verb `PRIVACY_CLIENT_ERASURE_SWEPT`
   (`ErasureAction`, `AuditSystem.changeKey.erasureSweep`); every contact-sweep
   commit probes the act's row (`ClientErasureSystem.sweepRowIdBasis`) and
   `sweepRowWrites` creates it in the first commit that clears a contact —
   the census BEFORE, counts only; a later chunk or a resumed call of the act
   plans none. The OTP commit keeps no row (P3-RU-21). Specs:
   `client-erasure.system.spec.ts` (one row; `[]` when present, when nothing
   is cleared, when not `NONE`; another act another row; no value; purity);
   `audit.system.spec.ts`; `erase-client.pipeline.spec.ts` (a stamp that fails
   after the sweep leaves `NONE` and the visit's `writeOperationId` joins
   exactly one SWEPT row with the census BEFORE; one SWEPT row after a
   mid-sweep budget stop and still one after the resume; one in the straight
   call); `erase-client.integration.spec.ts` (2), (7) — emulator-run.
2. **MINOR — the STARTED row's census left out contacts an earlier call's
   sweep cleared** (`erase-client.pipeline.ts`). **NOT changed in behaviour —
   recorded and pinned:** owner flag §7 item 28 (the census is the one when
   the stamp lands; the earlier act's SWEPT row, P3-DEP-33, now holds the
   swept contacts, so no clear is unaudited; exact counts need stored state
   or the stamp moved into the last sweep chunk); notes in the module
   comment, the step-4 comment and `stampWrites`' JSDoc; P3-DEP-28 points to
   it. Specs: `erase-client.pipeline.spec.ts` — the mid-sweep stop's STARTED
   row pinned at `erasureContactCount: 2` (the 25 swept by call 1 are on its
   SWEPT row, 27); a re-minted act after a failed stamp pins STARTED at 0
   (a straight run counts 2) beside the first act's SWEPT row at 2; the
   failure table's stamp row pins the resumed STARTED count one lower.
3. **MINOR — the alert's sibling figure ignored the kept sibling list**
   (`libs/features/staff/client-card/src/lib/client-privacy.presenter.ts`).
   **FIXED (P3-DEP-35):** the store sets `_alertSiblings` with each preview
   (the kept list for the card's own record, the preview's list for a
   sibling's act); the presenter words `input.alertSiblings.length`. Specs:
   `client-privacy.presenter.spec.ts` (+ the post-stamp case, bg/en `: 2.`);
   `client-card.store.spec.ts` (RESUME and RESWEEP bodies `: 2.`, a sibling's
   own act `: 0.` — the first three fail on the round-1 tree).
4. **MINOR — docs left stale by round 1** (`libs/ecs-core/src/errors/privacy.error.ts`,
   `docs/architecture/firestore-runbook.md`). **FIXED (docs only):** the
   `ErasureStaffAccount` JSDoc names the fail-closed arm (P3-DEP-29); the
   runbook's WS-D deploy note counts thirteen exemptions (eleven `auditLog`,
   two `customers`, P3-DEP-31 D2). No spec (the pins exist:
   `privacy-indexes.spec.mjs`, `client-erasure.system.spec.ts`,
   `erase-client.pipeline.spec.ts`).
5. **MAJOR — a desk `REMOVE_SEAT` after the stamp left the person's contact
   on a kept visit, and `ERASED` was still certified**
   (`libs/ecs-core/src/systems/client-erasure.system.ts`). **FIXED
   (P3-DEP-34):** `contactSweepWrites` clears, before the stamp, every contact
   carrying one of the person's contact values, seated or not (the seated /
   id-proved early return and the unused `walkInHash` parameter removed).
   Specs: `client-erasure.system.spec.ts` (a seated party P owns, P's solo
   visit and W's staff party swept; a third person's contact, Q's contact,
   no contact and cleared values not); `erase-client.pipeline.spec.ts` (four
   in-flight `REMOVE_SEAT` cases — after the stamp, after the outside read
   while `NONE`, each also with a failing visits' unit and a resume — all
   four fail on the round-1 sweep; the pins P3-DEP-34 lists re-made). §7
   item 25 extended (an override-valued contact, or a visit booked between
   the outside read and the stamp, can still be orphaned). The optional
   edit-side refusal is not built (a desk-behaviour change, its own DEP).

Checks after the fixes (no emulator): `typecheck` 40 projects green
(`--skip-nx-cache --parallel=1`, `dist/out-tsc` cleared); `verify-tools:layering`
OK (984 files / 4,437 edges in ecs-core, 2,684 scanned); `nx sync:check` up
to date; `lint` (ecs-core, functions, staff-client-card) 0 errors, warnings
equal to round 1 (42, 28, 31); `test` all 44 projects green (ecs-core
7,108 → 7,120, functions 1,437, staff-client-card 1,035 → 1,036); ecs-core
coverage thresholds green, statements 98.52 %; prettier clean on the changed
files. Not run here (the orchestrator's): `test:emulator`
(`erase-client.integration.spec.ts` (2) three new rows and the SWEPT
census, (4) unchanged assertions, (7) the SWEPT row; `export-client-data`
unchanged), `verify:p0` (g) (its STARTED / ERASED filters are unaffected; a
SWEPT row now also targets the record), `e2e:web`
(`staff-client-privacy.spec.ts`), the runbook gates (§1.1 and the WS-D
note's text).

**Final gate (orchestrator, 2026-10-28 05:54–06:32 UTC, the FULL §6.1 on
the round-2 tree — §6.3 "Final"):** sync, layering (984 files / 4,437
edges, 2,684 scanned), typecheck 40/40, lint 44 projects (0 errors, 246
warnings — the baseline's), `run-many -t test` 14,627 vitest +
`verify-tools` 239, 0 failed (ecs-core 7,120, functions 1,437,
staff-client-card 1,036), ecs-core statements 98.52 % (16,067 / 16,308;
the seven new system / pipeline files 98.50–100 %), `seed-tools`,
`lint-rules` 355, `lint:styles`, `build web` 587.74 kB initial (159.30 kB
transfer) + `verify:bundle`, functions build + its four dependencies,
showcase, runbook gates 28/22/17/6/24/27/25/20, 0 FAIL, 0 ERROR (the
scratch extractor, equal to the committed runner since C_E — §8.E),
`verify:p0` (a)–(g), `test:emulator` 135 + 361, `verify:csp` 10 (both
builds' hashes match) — all green; `e2e:web` 67/68, the red
`client-card-harness.spec.ts:17` [desktop, light] (the account page still
`loading` after 5 s — the load flake HANDOFF §4 lists; untouched by the
round); its solo `--repeat-each=3` re-run judges it (not run by the
records pass). The late-shop-time proof was not repeated on this tree:
§8.A's run on `987e6e5` stands. Indexes 24 / 120 (57 on `auditLog`); the
functions' 50 exports.

### 8.R3 Owner review — no-op mappers and the reported law fixes (2026-10-28 → 2026-10-31)

The owner, on the ready PR: _"why I see useless functions like
`encodeExportClientDataAnswer` … doing effectively nothing, just copy —
lying function name; check whether there are similar not following the
Laws and our constitution; fix all those; follow DOD"_. Applied in two
commits, behaviour byte-for-byte the same:

- **Sweep A (`968a97e`).** A TypeScript-AST scanner over every production
  `.ts` file found 260 candidates (36 copy-shaped, 224 forwarder-shaped);
  four auditors classified each, a planner re-checked every verdict
  against the code. Deleted: 57 identity copies (the 17 wire encoders whose
  answer already was the wire type — a callable now answers its pipeline's
  value, and `wiredCallable` proves at compile time that it IS
  `CallableWire[N]['answer']`, `AnswerIsTheWire`), 136 pure forwarders (13
  `…Refusal` wrappers of `refusalOf`, per-callable decoder copies, ~45
  feature re-exports of ecs-core systems, companion members that only
  renamed another tier's function, second doors to the minute brands), 8
  lying names; six real wire projections named (`committedOf` …); three
  Law 3 breaks (a struct stripped before a system) passed as they are.
  Enforced by `creativo/no-identity-mapper` (error, 67 spec cases).
  Scanner 260 → 128, every remaining row a recorded keep (Angular template
  bridges, real projections, documented domain aliases, curried
  factories).
- **Law fixes B (`ac23b1d`)** — what sweep A only reported:
  `FailureCodeSystem.codeOf` (the generic SDK-failure reader, out of
  `TriggerAttemptSystem`); one home per duplicated helper (`store-answer.ts`,
  `StoredFields.field`, the stored-entity helper, the wall-clock day
  forms, `@core/testing`'s `bodyOf`); one language rule (`localeFor`,
  `DEFAULT_LOCALE` bg, `LocalizedText.pick`); the repeat-rule edits into
  `VisitDraftSystem`; systems take the request / slice as it is; the photo
  VM without a rename; `IdentityCall.identifier` branded (Law 7.4); the 11
  `X.of` slice projections → `sliceOf`; type-only aliases and defensive
  copies gone; the seed fixtures on the README's distributive
  `Body<X>`; a `script-tools` lint project for the loose `tools/*.mjs`.
  Correction recorded: Law 9.3 bans `Pick`/`Omit` of PORT bundles, not
  `Omit<Entity, 'id'>` in specs or fixtures — the fixtures moved to `Body`
  for its per-variant strictness, and the remaining `Omit<X, 'id'>` in
  specs and e2e support are lawful and stay.
- **Left as decided:** the unchecked document casts of decision D-1
  (`entityOf` in `firestore-catalog`, `firestore-privacy`, `triggers.wire`);
  history citations of deleted files in docs.
- **Gate on `ac23b1d`:** typecheck 40/40; layering 987 files / 4,453 edges;
  sync; lint 45 projects, 0 errors (warnings 246 → 220); `run-many -t
test` 14,639 vitest + `verify-tools` 239; `lint-rules` 422; functions
  1,428 (−9: the deleted encoders' cases, their key-order and
  nothing-else proofs now in 16 pipeline specs and a `JSON.stringify` pin
  in `main.spec`); ecs-core 7,136, 98.57 % statements (16,034 / 16,266);
  builds + the functions' four dependencies + `verify:bundle`; runbook gates
  28/22/17/6/24/27/25/20; `verify:p0` (a)–(g); `test:emulator` 135 + 361;
  `e2e:web` 68/68; `verify:csp` 10. A container restart and an API limit
  interrupted fix B's second wave; it was resumed from its cached plan and
  first wave.
