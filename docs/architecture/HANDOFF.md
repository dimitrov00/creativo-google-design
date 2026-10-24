# ECS migration — the record and handoff

**Phase 4b integrated — the ECS migration is complete.** Read this first if
you are an agent (Claude Code, Codex, Cursor, Gemini, …) or a developer
working on this codebase after the ECS / data-oriented migration. It is the
migration record: what landed in which order and how each step was proved
(§2, §3), the gate every change still passes and its baselines (§4), the
operating rules (§5), the owner's rulings and open questions (§6), and what
was carried forward as follow-up work (end of §3.3). Last updated 2026-10-24
(flip 1 complete; Law 9 port-composition pass; flips 2, 3 and 4 integrated;
Phase 4a integrated; Phase 4b integrated — `libs/application/*`,
`libs/domain/*`, `luxon`, `dinero.js` and the dotted i18n keys are gone,
§3.3; the FULL §4 gate — the emulator journeys included — and the dev smoke
green on the 4b tree, §3.3 "Gate"; the UI residue cleanup integrated — the
visit shim, the `kind`/`status` view-state unions, the stray classes and the
ambient clock reads gone and lint-guarded, the FULL §4 gate green again and
the dev smoke byte-identical to `c77e932`, end of §3.3; the Law 10.2
decision-extraction pass integrated — the presenters' domain decisions moved
into ecs-core systems, the FULL §4 gate green (the emulator journeys
included), a DOM differential of 2,611 specs and the dev-stack smoke's 90
signatures identical to `fd5f2a6` but the agenda's relative minutes, end of
§3.3; pass A — the audit's four defects — and pass B — the dead code, the
old-style leftovers and the stale docs — integrated on the static gate, end
of §3.3).

## 1. Read these, in this order

1. `CLAUDE.md` (= `AGENTS.md`) — the constitution, **Laws 1–10**. Non-negotiable.
2. `.claude/rules/*.md` — compiled templates per file kind (components,
   primitives, systems, pipelines, ports, Firestore layout, layering,
   Angular UI, presenters).
3. `docs/architecture/ecs-migration.md` — the blueprint: §6 phase plan,
   §9 decisions D1–D29 (the notes at its top say where Laws 6–8 override it).
4. `docs/architecture/flatten-spec.md` — every name, shape and time rule of
   the flat archetypes (Laws 6–7); §2.3 T1–T9 are the time rules.
5. `docs/architecture/firestore-runbook.md` — the reader/writer matrix of every
   collection, the flip closures, TTL steps, deploy order, per-flip grep gates
   the Phase 4a/4b gates (§4.7, §4.8) and the UI residue gate (§4.9).
6. `docs/architecture/flips/flip-1-booking-core.md` — the worked example of a
   flip (its adapter table predates Law 9; the note above it says so).
7. `docs/architecture/module-boundaries.md` — the `scope:*`/`type:*` tags,
   the ecs-core tiers and the import cages, rewritten from the post-4b graph.
8. `docs/architecture/flips/law-10-decision-extraction.md` — what a decision
   is and what is wording (§0 D-1/D-2/D-3), the decision inventory and the
   system that now answers each row (§1, §9.1).

## 2. Where the work stands

| Step                                                                                                                | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Commit(s)                                                    |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Constitution + blueprint                                                                                            | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 81ac087                                                      |
| Tooling (ECS lint guards, functions-deps check, Analog 2.8)                                                         | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | defb4da                                                      |
| Phase 1 — `libs/ecs-core` foundation                                                                                | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 056ae43                                                      |
| Phase 2 — all business math in pure systems, legacy classes shimmed                                                 | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 0416587                                                      |
| Laws 6–7 (flat archetypes, primitives, shop-anchored time, error structs)                                           | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | a6c7253                                                      |
| Phase 3a — functions composition root, `edge.ts`, body-free adapters, test support                                  | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 291d3f9                                                      |
| Flatten pass (Laws 6–7 applied) + owner rulings (Law 7.3 amendment, `TimeCoordinate`)                               | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 268aa0e, dbd39d4                                             |
| Law 8 + layering pass (`@core/*` tier barrels, no root barrel)                                                      | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 3458349, ab6d266, c0e5d73                                    |
| **Phase 3b flip 1 — booking core**                                                                                  | **done** — integrated 2026-10-16; on 2026-10-21 `verify:p0` and `e2e:web` ran green locally (baseline only) and `apps/web/e2e/booking-core.spec.ts` proves the live paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | bafdbdd, 32b870d, 4ba5d87, then the "flip 1 complete" commit |
| Law 9 + port-composition pass (bottom-up bundles, `creativo/no-sliced-ports`)                                       | done — 2026-10-21, full gate green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | the "Law 9" commit                                           |
| **Phase 3b flip 2 — identity and accounts**                                                                         | **done** — integrated 2026-10-21; the full gate of §4 green (baseline reds only), `verify:p0` (e) both ways, the flip-2 grep gate PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | the "flip 2 commit"                                          |
| **Phase 3b flip 3 — loyalty and invitations**                                                                       | **done** — integrated 2026-10-22; the full gate of §4 green (baseline reds only), the §6 grep gate PASS, the §8 dev smoke run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | the "flip 3 commit"                                          |
| **Phase 3b flip 4 — programs**                                                                                      | **done** — integrated 2026-10-22; the full gate of §4 green (baseline reds only), the §6 and end-of-3b grep gates PASS, the §8 dev smoke run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | the "flip 4 commit"                                          |
| **Phase 4a — re-point every legacy consumer, the wire flip, the rules tightenings**                                 | **done** — integrated 2026-10-22; the full gate of §4 green (baseline reds only), runbook §4.2–§4.5 + §4.7 PASS, the §8 dev smoke 57 checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | the "Phase 4a" commit                                        |
| **Phase 4b — delete the legacy libraries, `luxon`, `dinero.js`, the dotted keys; widen the lint; the docs rewrite** | **done** — integrated 2026-10-23; the static gate of §4 green (baseline reds only), the FULL gate of §4 green (baseline reds only), runbook §4.2–§4.5, §4.7 and §4.8 PASS, the §8 dev smoke 35 checks; R4 applied the same day on the owner's go-ahead                                                                                                                                                                                                                                                                                                                                                                                                                                                               | the "Phase 4b" commit                                        |
| **UI residue cleanup — the visit shim, the `kind`/`status` unions, the stray classes, the ambient clock**           | **done** — integrated 2026-10-23; the FULL gate of §4 green (baseline reds only), runbook §4.2–§4.5, §4.7, §4.8 and §4.9 PASS, three new lint rules canary-proven under both ESLint base paths, the dev smoke 58 DOM signatures identical to `c77e932`                                                                                                                                                                                                                                                                                                                                                                                                                                                               | the "UI residue cleanup" commit                              |
| **Law 8 amendment — the `@core/errors` tier and the Error file kind (`*.error.ts`)**                                | **done** — 2026-10-23 (owner ruling): 19 error files moved to `errors/<domain>.error.ts`, 401 importers re-pointed, the verifier, tier lint, `*.error.ts` suffix block and `creativo/error-dictionary-home` canary-proven; the FULL gate of §4 green (baseline reds only)                                                                                                                                                                                                                                                                                                                                                                                                                                            | the "@core/errors tier" commit                               |
| **Law 10 — presenters word what systems decided (`*.presenter.ts`, `*.vm.ts`)**                                     | **ruled + enforced** — 2026-10-23 (owner, option B of the view-model pass): the law, `creativo/presenter-purity` canary-proven, `presenters.md`; the outlier files renamed into the kinds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | the "Law 10" commit                                          |
| **Law 10.2 — the decision-extraction pass (presenters word, systems decide)**                                       | **done** — integrated 2026-10-23 (`flips/law-10-decision-extraction.md` §9): every MOVE/DUP row answered by an ecs-core system with a purity + boundary spec (2 new systems — `LoyaltyPassSystem`, `WalletSystem` — and 23 extended, 4 component companions, 23 new tag dictionaries plus `BirthdayMoment` moved down from the vm; 428 new ecs-core cases), every presenter spec unchanged; the FULL gate of §4 green (baseline reds only — `verify:p0`, `test:emulator` 65 + 255, `e2e:web` 41 + the 19), runbook §4.2–§4.5, §4.7–§4.9 PASS, the §5 review checklist clean, a DOM differential of 2,611 specs and the §6.3 dev-stack smoke (90 signatures) identical to `fd5f2a6` but the agenda's relative minutes | the "decision-extraction" commit                             |
| **Pass A — the audit's defects**                                                                                    | **done — FULL gate green (baseline reds only), runbook §4.2–§4.9 PASS** — 2026-10-24: the four defects of the read-only audit fixed (end of §3.3): the client photo strip's post-`limit` origin filter (index #22 gains `photoOrigin`), the client profile's age-window words missing their figure, the edit and reschedule pipelines' DST-gap fallback to a stale instant, and three staff-day defects (a cancel's words on the call, `periodLabel` on an empty day list, another chair's terms quoted)                                                                                                                                                                                                             | the "Pass A" commit                                          |
| **Pass B — dead code, old-style leftovers, stale docs**                                                             | **done — FULL gate green (baseline reds only), runbook §4.2–§4.9 PASS** — 2026-10-24: eight packages, one integrator and the review's fixer (end of §3.3): three dead Nx projects (`ui`, `cursor`, `design-tokens`) and `generated/**`, the four staff-dashboard shims, ~135 callerless ecs-core members (50 system members, ~45 component, entity and error members, four unused port families — six port types — with their tokens and adapters, 23 producer-less error codes, the `Retired*` registry) and three composite indexes, ~40 dead feature exports, the seed's symbolic mappers and private zone engines, ten unused packages; `translateCodedError`, `CatalogWording`; the docs re-derived             | the "Pass B" commit                                          |

`main` carries the flip-1 to flip-4 reshapes, the Law 9 port pass, Phase 4a
and Phase 4b, and the FULL gate of §4 is green on it (baseline reds only). All
four phases of the blueprint are complete: no `libs/application/*` or
`libs/domain/*` project, alias, tag or path survives outside the historical
docs, `package.json` lists no `luxon`, `@types/luxon` or `dinero.js`, and
both catalogues hold only SCREAMING `errors.<errorCode>` keys. The
blueprint's end-of-3b graph/bundle assertion is code since 4b: runbook §4.8
gate 8 (no legacy project in the graph, hence no functions → legacy edge) and
the forbidden-key check of `tools/verify/p0/functions-deps.mjs` (no
`@angular/*`, `luxon` or `dinero.js` in the functions dist — `rxjs`
stays, 4A-2 (d), 4a §10.1). The last fully green commit is the
"decision-extraction" commit, `fe4635a` — the FULL gate on its integrated
tree, the emulator journeys and the dev-stack smoke included (§2 row, end of
§3.3; before it, the "UI residue cleanup" commit, `474e771`, and the
"Phase 4b" commit, `f9cef52`); check `git log` for anything newer — pass A
(`99a60fa`) and pass B (the "Pass B" commit) each passed the FULL gate too,
the runbook grep gates, `verify:p0`, `test:emulator` and `e2e:web` included
(§2 rows, end of §3.3). (On 2026-10-23 the full §4 gate — `verify:p0`,
`test:emulator` and `e2e:web` included — every grep gate and the dev smoke
were green on the 4b tree and again on the cleanup tree, §3.3 "Gate" and the
UI residue plan's §8.1.) **The migration is COMPLETE**, and the phase-4b plan
§4.R R4 constitution and rules edits are applied (§6, OQ-7/OQ-11). The first
follow-up pass, the UI residue cleanup, closed four carried items (end of
§3.3); everything else is follow-up work, not migration (the carried-forward
list at the end of §3.3).

## 3. What landed, in order

### 3.1 Flip 1 (booking core) — complete

Integrated 2026-10-16 (the plan's §11 case ledgers: 52 specs, 698 cases,
each with a successor or a `dead:` reason). Closed 2026-10-21 on a machine
where the Functions emulator works: `verify:p0` green, `test:emulator`
green, `e2e:web` = the baseline only. The live paths no journey covered are
now a permanent spec, `apps/web/e2e/booking-core.spec.ts` (chromium): a
`/book` day with bookable times (needs the capacity/busy triggers), a
signed-in client booking stored as the FLAT body with its `barberBusy` block
and shown on `/account/appointments`, a staff block stored as the flat
public effect, and the shell's unread-notification count. Support helpers
moved to `apps/web/e2e/support/booking-days.ts`; `seed-firestore.ts` gained
`readBarberBusyDay`, `readScheduleException`, `seedInbox`.
`auth-onboarding.spec.ts`'s reward wait now allows 20 s like every other
callable-gated wait (the `completeRegistration` cold start outlasted 5 s in a
full parallel run).

Carried forward, not blocking (from the integration): `libs/application/**`
exported the retired flip-1 tokens and `*_COLLECTION` constants (deleted
with the layer in Phase 4b); `markNotificationRead`,
`loadWaitlistRequest`, `loadCouponGrant`, `readCustomers`,
`CouponGrantSystem.transitionWrite` have no caller yet (grant
burn/restore deferred, F1-2); a notification produced by the waitlist
matcher itself is not covered end to end; optional spec hardening —
assert `ownerCustomerId` equals the seeded record and that no offered time
starts in Ivan's 13:00–14:00 break.

### 3.2 Flips 2–4

Same recipe as flip 1 (blueprint §6 Phase 3; closures in the runbook):

1. Write `docs/architecture/flips/flip-N-<name>.md`: the collections, their new
   bodies (= the ecs-core entity types), every reader and writer (grep —
   include `tools/verify/**`, `tools/seed/**`, `apps/web/e2e/**`), packages
   with **disjoint file ownership**, rules/index deltas, deletions, the grep
   gate.
2. Build the packages in parallel against the entity types (they are the
   contract), then one integrator runs the full gate until green.
3. Review: Firestore (indexes on top-level keys, TTL, rules, transaction read
   sets), surviving old-shape readers, behaviour vs the replaced handler, laws.

- **Flip 2 — identity and accounts: integrated 2026-10-21** (plan
  `docs/architecture/flips/flip-2-identity.md`, its §11 ledgers: 14 deleted
  specs / 99 cases plus 9 re-targeted impersonation cases, each with a
  successor or a `dead:` reason). `users`, `otps`, `impersonationSessions`
  are the flat `User` / `Otp` / `ImpersonationSession` bodies; the OTP trio
  and the new `updateProfile` callable are `@core/pipelines`
  (`request-otp`, `verify-otp`, `complete-registration`, `update-profile`)
  behind `apps/functions/src/wire/identity.wire.ts` (the wire frozen,
  F2-3); `completeRegistration` creates the D29 `REGISTRATION` client
  record; the web reads `PROFILE_PORTS` and `USER_SEARCH_PORTS`
  (`accounts.adapter.ts`) — the flip's `IMPERSONATION_READ_PORTS`
  (`impersonation.adapter.ts`) was bound but never injected, and pass B
  deleted it — and owner edits run
  `ProfileEditSystem.decide` in the browser transaction;
  `libs/domain/models` has no importer left; indexes #9/#10 re-keyed,
  `users.roles` override; the six server-only `libs/application/identity`
  ports, the legacy handlers, use cases, repositories and
  `AuthStateService` deleted. Gate: §4 all green but the baseline reds
  (unit 6, typecheck 3 projects, e2e 19 failed / 41 passed),
  `verify:p0` all proved, `test:emulator` 58 + 243, the §6 grep gate (runbook
  §4.2) 28 gates ok. Integrator decisions: `AVATAR_UPLOADER`
  (`AvatarUploader`, the avatar use cases, the Storage adapter) now takes
  the `@core/primitives` `UserId` — no legacy id bridge remains in the
  P3/P4 directories; `verify:p0` (e) asserts the row's actor by the
  event's auth context — the Emulator Suite delivers none (authtype
  `unknown`), so there both rows read `SYSTEM`/`UNATTRIBUTED_UNKNOWN`, as
  before the flip, and the production pair (`USER` for the owner write,
  `ADMIN_SDK` for `updateProfile`) is pinned by `audit.system.spec.ts`
  and `triggers.wire.spec.ts`; the plan's §10 open questions stand on their
  defaults (UTC age day, impersonation writes and rules tightenings in
  Phase 4, lowercase `Role`/`AuthStage`, no customer-record sync, re-run
  re-settles, adoption only of an absent/same-contact stub).
  Smoke (plan §8 step 3) run 2026-10-21 against `pnpm run dev` with
  custom-token sign-in: a client's own profile name and birth-date edits
  (the flat body, `searchName`/`searchPrefixes` re-derived, restored after),
  the booking contact sheet's «save to profile», the staff client search
  (`searchPrefixes` array-contains, by name and phone prefix) and the client
  card and companion names — all pass, no flip-2 console error; the OTP
  screens themselves are covered by `auth-onboarding.spec.ts`. One
  deliberate departure is recorded in the plan's §0 F2-1 and pinned
  (§11.3): the three OTP callables now judge an e-mail with ecs-core's ONE
  `Email.parse` rule, which wants a top-level label of two characters or
  more (`a@b.c` is refused); the shipping client already enforced it. The
  three pipeline refusal dictionaries (`CompleteRegistrationRefusalCode`,
  `CancelWaitlistRefusalCode`, `RunBackfillRefusalCode`) now live in
  primitives (Law 7.5) with edge rows on NEW dotted codes, their callables
  still answering today's legacy codes. Carried forward, not blocking:
  `CancellationRefusalCode`, `MoveErrorCode` and `StaffEditErrorCode` are
  still declared in the systems tier — a pass moves them to primitives
  (Law 7.5 / `ecs-layering.md`); `MoveErrorCode` (with `CarriedSeatRefusal`)
  and `StaffEditErrorCode` carry only primitives, but `CancellationRefusal`
  carries `bookingStatus: BookingStatus` (a component), which primitives may
  not import — it moves with scalar context, as flip 2's identity errors did
  (F2-4), touching the cancel pipeline, the edge and the web's cancel sheet;
  the unused
  `LegacyWireCode` rows whose handlers are gone (`OtpValidationFailed`,
  `OtpDestinationEmpty`, `InvalidOtpMaxAttempts`, `EmptyId`,
  `InvalidDateTime`, `AccountsIdEmpty`, `InvalidTimeZone`) stay pinned by
  `edge.spec.ts` until Phase 4; `OtpStorePorts.loadOtp` and
  `AuthAdminPorts.setClaims` have no caller (§10.13); a store failure of an
  owner write still answers the legacy
  `accounts.update_profile.repository_failure` (no `errors.REPOSITORY_*`
  i18n keys yet); `§10.15` (profile-row attribution once Phase 4 routes
  client edits through `updateProfile`) is the owner's before Phase 4.
- **Flip 3 — loyalty and invitations: integrated 2026-10-22** (plan
  `docs/architecture/flips/flip-3-loyalty.md`; its §8.1 is the integration
  record, its §11 ledgers prove every case: server 4 deleted specs / 100
  cases + 7 re-targeted, web 9 / 104, application 10 / 202 plus the loyalty
  half of `testing.spec.ts` and 4 type-spec cases, each with a successor or
  a `dead:` reason; the data plane deleted none). `loyaltyAccounts`
  (re-keyed `{customerId}`, D29; `streaks` an array), `badgeProgress`,
  `seasonProgress`, `clientJournal` (`{customerId}_{seq:06}`, index #21
  re-keyed to `customerId, journalVisibility, journalEffect, seq DESC`),
  `streakDefinitions` + `versions` and the six-collection catalogue are the
  flat ecs-core entity bodies; the never-queried arrays have `indexes: []`
  overrides; the journal rule reads `journalVisibility == 'CLIENT'`. The
  publish callable is `@core/pipelines` `publish-streak-definition`
  behind `apps/functions/src/wire/loyalty.wire.ts` (the wire frozen both
  ways, F3-3; `legacyCallable` is gone with its last row) with the new
  `paramFlagsPorts`; the web reads `LOYALTY_ACCOUNT_READ_PORTS`,
  `LOYALTY_CATALOG_READ_PORTS` (the per-day session memo is the closure
  `loyaltyCatalogMemo` behind `LOYALTY_CATALOG_MEMO`), `CLIENT_JOURNAL_PORTS`,
  `STREAK_DEFINITION_PORTS` and `STREAK_PUBLISH_PORTS` (the frozen-wire
  gateway); the client card and the admin rhythm page consume
  `@core/*` directly (`LedgerSystem` folds `JournalEntry` rows, the
  catalogue reaches every system unmapped through the store's
  `LoyaltyCatalogSystem.validate`); the seed builds every loyalty body in
  `tools/seed/fixtures/loyalty.fixtures.ts` (`satisfies` the entities). The
  dead invitation web surface, `listLedgerTail`, the legacy loyalty half of
  `libs/application/engagement` (mappers, ports, use cases, in-memory
  references, the uid-keyed account fixtures), the functions clock and the
  five legacy web adapters are deleted. Three departures, each pinned
  (§11.4): the card's loyalty rides the client-record read (F3-1 (a));
  stored bodies are answered as stored, the catalogue keeping its check as
  the store's (F3-1 (b) — with two writer-defect-only consequences recorded
  at integration: the memo keeps a refused catalogue for the day, and an
  unreadable head leaves the publish as `store_failed`); the log line's
  `error` text for a taken version number (F3-1 (c)). Integrator rulings
  (§8.1): `PublishStreakDefinitionPorts` holds no `TelemetryPorts`; the
  caller's uid is branded by `UserId.parse` as on every flipped wire; the
  four fixture-coverage checks run over the flat fixture again. Gate:
  §4 all green but the baseline reds (unit 6, typecheck 3 projects, e2e
  19 failed / 41 passed), `verify:p0` all proved, `test:emulator` 62 +
  241, the §6 grep gate (runbook §4.3) 22 gates ok, runbook §4.2 28 ok.
  Carried forward, not blocking: `libs/domain/engagement` (the loyalty and
  invitation classes, now importer-free in apps/features/infrastructure/
  tools) and the kept vouchers/coupons/reward-progress half of
  `libs/application/engagement` go with Phase 4; `AchievementScope`'s
  `kind` (a view-model contract) is a flatten-pass candidate;
  `ClientCardStore`'s `AVATAR_UPLOADER`/`ZonedDateTime` imports and its
  `Date.now()` fallback are Phase 4's; `@core/testing`'s `vouchers.json`
  is still nested (vouchers are no flip-3 collection); the
  `redeemInvitation` pipeline and the invitations rules tightening are
  Phase 4's (F3-2); the plan's §10 open questions stand on their
  defaults.
- **Flip 4 — programs: integrated 2026-10-22** (plan
  `docs/architecture/flips/flip-4-programs.md`; its §8.1 is the integration
  record, its §11 ledgers prove every case: web adapters 3 deleted specs /
  12 cases, domain 3 / 29, application 4 / 8, each with a successor or a
  `dead:` reason; no re-targeted case lost). `positions`
  (`positionStatus: 'OPEN' | 'CLOSED'`, index #12 re-keyed to
  `positionStatus, sortOrder`, a `positions.locationIds` `indexes: []`
  override), `courses` (`enrollmentStatus` SCREAMING, #11 unchanged) and
  `events` (`localDate` + `startMinutes` + `utcEpochMs`, no `startDateIso`,
  no `timezone`) are the flat ecs-core bodies, every optional present as
  `null`. Admin writes stay rules-guarded browser writes (D9(b), no rules
  edit): `@core/pipelines` `program-content` (`writePosition`,
  `writeCourse`, `writeShopEvent`) over `ProgramsSystem` — the event's
  instant computed once at ingestion on its location's zone, else the
  default shop's (`DefaultLocationPorts`, bound from
  `TenantConfig.DEFAULT` in `cfg`; flip 4 is its first runtime reader). The
  web binds `PROGRAMS_PORTS`, `POSITION_READ_PORTS`, `COURSE_READ_PORTS`,
  `SHOP_EVENT_READ_PORTS`, `LOCATION_LOAD_PORTS` (`programs.adapter.ts`,
  `catalog.adapter.ts` `locationLoadPorts`), `DEFAULT_LOCATION_PORTS`, and
  the new `CLOCK_PORTS`/`ID_PORTS` (`browser-runtime.adapter.ts`; the
  legacy `CLOCK`/`ID_GENERATOR` stay for the features of flips 1–3). The
  status words stay today's lowercase through words tables (F4-7); the
  `/events` date is formatted from the wall clock with `formatWallClock`
  (equal to the legacy Luxon output in en and bg, F4-11).
  `libs/application/programs`, `libs/domain/programs` and the three class
  adapters are deleted. Six departures, each pinned (plan §11.4): a
  spring-forward gap start refused `DST_GAP_INVALID_TIME` (a); stored bodies
  answered as stored (b); the zone from the location with the default
  shop's fallback, refused `ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN` only when
  neither is stored (c); a `/` in a location id refused (d); the
  upcoming/past split on the instant (e); only the `datetime-local` form
  accepted (f). **Deploy precondition (runbook §3):** before the web
  carrying flip 4 deploys, `locations/<TenantConfig.DEFAULT.defaultLocationId>`
  (`loc-center` in the seed; the production id is flatten-spec OQ-2's, not
  yet confirmed) must exist in the target project with a valid IANA
  `timeZone` — otherwise an event save that names no location, or one with
  no document, is refused; deploy index #12's new key before the web.
  Integrator rulings (§8.1): the four new codes leave the edge as
  `not-found` / `failed-precondition` (no callable returns them); the
  end-of-3b gate's three false hits fixed (two scoped exclusions with
  reasons, the `@core/testing` helpers' `hours` parameter renamed); an
  emulator spec's cache-first first snapshot fixed by one client per read.
  Gate: §4 all green but the baseline reds (unit 6, typecheck 3 projects,
  e2e 19 failed / 41 passed), `verify:p0` all proved, `test:emulator`
  62 + 251, the §6 grep gate (runbook §4.4) 17 ok, §4.2 28 ok, §4.3 22 ok,
  the end-of-3b gate (§4.5) PASS; the smoke 58 checks pass. Carried
  forward, not blocking: the end-of-3b graph/bundle half (seven
  `apps/functions` files still import `@creativo/(application|domain)/*`,
  the functions dist still lists `@angular/*`, `rxjs`, `luxon`,
  `dinero.js`; `functions-deps.baseline.json` not re-recorded) is Phase 4's
  (F4-2); the admin view-state `kind` unions are a flatten-pass candidate;
  rules tightenings for the programs collections, a location picker, i18n of
  the status words and a programs e2e journey are follow-ups (F4-2,
  §10); pre-existing and outside the flip, seen in the smoke: an
  intermittent dev-mode Angular assertion in the shared
  `SiteFooterComponent` on `/careers`, `/courses`, `/events` (the footer's
  locale toggle constructs `LanguageService`, whose constructor re-renders
  the footer's `*transloco` view inside its first create pass) and a stored
  `ui-lang = 'en'` not restored on a fresh load; the plan's §10 open
  questions stand on their defaults.

### 3.3 Phase 4 — client integration and legacy deletion (blueprint §6 Phase 4)

`lazy-port` factory rows in `app.config.ts`; feature stores re-typed to the
ecs-core entities; delete `libs/application/*`, `libs/domain/*` (incl. the
kernel and `libs/domain/models`), every shim bridge, the contact-change
adapter (D12(b)); remove `luxon`, `@types/luxon`, `dinero.js` from
`package.json`; the rules tightenings (impersonationSessions write false,
invitation redemption via callable, users allowlist) each with its web switch;
rewrite `module-boundaries.md`, delete `domain-model.md` (D6).
It also closes the blueprint's end-of-3b graph/bundle assertion that flip 4
deferred (flip-4 plan F4-2, runbook §4.5's measured state): no `functions →
libs/application/*` edge, no `@angular/*` in
`dist/apps/functions/package.json` (`rxjs` stays — Nx's `createPackageJson`
scans ecs-core, whose ports name `Observable`; 4A-2 (d), 4a §10.1),
`functions-deps.baseline.json` re-recorded (4a, then again in 4b when
`dinero.js` left).

Phase 4 runs in two halves. **4a** (plan
`docs/architecture/flips/phase-4a-repoint.md`, its §0 the decisions 4A-1 …
4A-16, §4 the nine packages) re-points every consumer of
`@creativo/application/*` and `@creativo/domain/*` outside those libraries
onto ecs-core, flips the callable wire (the refusals are the projected
ecs-core structs, the web reads `errors.<errorCode>` through ONE
`callableClient`), lands the three rules tightenings with their callables
(`updateProfile` writes its own audit row, flip-2 §10.15;
`startImpersonation`/`endImpersonation`; `redeemInvitation`), and closes the
law leftovers (the systems-tier dictionaries in primitives, the zone only on
the location — `TENANT_ZONE` gone, `CRON_TIME_ZONE` the one cron option).
**4b** deletes the legacy libraries, their aliases and Nx projects, `luxon`,
`@types/luxon`, `dinero.js`, and rewrites the docs.

**Phase 4a — integrated 2026-10-22** (plan
`docs/architecture/flips/phase-4a-repoint.md`: §8.1 is the integration
record — the P9 sweep in items 1–7, the integrator's fixes and rulings in
items 8–9, the gate in item 10; §11 the case ledgers, §11.5 the
integrator's). Nothing outside `libs/application/**` and `libs/domain/**`
imports them (specs, fixtures and tools included; `firestore.rules`
comments and `tsconfig.base.json` aside, which are 4b's); no tsconfig
references them; the project graph has no edge into the 17 legacy projects.
The callable wire is flipped (the ecs-core call components in, the
projected error structs out, the web reading `errors.<errorCode>` through
ONE `callableClient`); `users` client updates, `impersonationSessions`
writes and invitation creates/updates/redemptions are closed in the rules,
with `updateProfile` (now writing its own audit row and the
`profileEditedAtUtcMs` marker), `startImpersonation`/`endImpersonation` and
`redeemInvitation`; the zone lives on the location only (`TENANT_ZONE`,
`WIRE_ZONE`, `TenantZonePorts` gone; `CRON_TIME_ZONE` the cron option); every
error dictionary is in primitives. Integration decisions worth knowing
(plan §8.1 item 9): `BookingCall` carries the appointment's own
`placement` (`SELF` from `/book`, `STAFF` from the staff day) — the flipped
wire's always-present `onBehalfOfUserId` could no longer tell them apart;
`ShopZoneService` exposes `defaultZoneFailed()`/`retryDefaultZone()`, so the
appointments page and the client card show their failed states on an
unreadable default location (4A-2 (e)); `libs/features/client/account-state`
is `"sideEffects": false` (its `src/package.json` + `.nxignore`), which took
`libphonenumber-js` out of `main` (initial 802 kB → 598 kB, `verify:bundle`
green, F6's premise holds); the dead voucher half of
`libs/application/engagement` was deleted ahead of 4b (no nested copy of the
flat fixture may exist). Gate (plan §8.1 item 10): all green but the
baseline reds — unit 6, typecheck `patterns` only, `e2e:web` 19 failed / 41
passed; `verify:p0` all proved; `test:emulator` 65 + 255; runbook §4.2 28 ok,
§4.3 22, §4.4 17, §4.5 PASS, §4.7 PASS (24); the smoke 57 checks.
**Deploy (runbook §3, the Phase 4a paragraph):** functions and hosting
together, THEN the rules (the tightenings close write paths the old web
still uses); no index deploy; the flip-4 precondition (the default
location's `timeZone`) still stands.

**Phase 4b — integrated 2026-10-23** (plan
`docs/architecture/flips/phase-4b-delete.md`: §0 the decisions 4B-1 … 4B-11,
§4 the packages P0–P9 in four waves, §4.R the residue packages R1–R8
(wave 4, R4 applied on the owner's go-ahead) and the integrator (wave 5), §8.1 the
integration record, §11 the case ledgers). A pure deletion and re-wording: behaviour frozen, no departure
(4B-1) — every screen, every message in `bg` and `en`, every callable status
and `details`, every stored document and telemetry line as on the 4a tree.

- **Deleted.** The 17 Nx projects under `libs/application/*` (accounts,
  booking, catalog, engagement, governance, identity, notifications, shared)
  and `libs/domain/*` (accounts, catalog, engagement, governance, identity,
  kernel, models, notifications, scheduling) — 621 tracked files, 169 spec
  files, each with its successor or `dead:` reason in plan §11.1 (the three
  live cases that had none — the legacy `standing.spec.ts`'s two
  `levelNumeral` tables and `list-services-grouped-by-category.use-case.spec.ts`'s
  one — recovered from `e2d7a8f` into `client-card.format.spec.ts` and the
  new `rhythm-service-groups.spec.ts`, R5, plan §11.3) — with their
  19 `tsconfig.base.json` aliases, 17 `.nxignore` lines and the
  `type:application` tag and depConstraints row (61 → 44 projects); `luxon`,
  `@types/luxon` and `dinero.js` from `package.json` and the lockfile, with
  the dinero cross-check of `money.data.spec.ts` (its properties kept against
  exact `BigInt` arithmetic, plus a golden table of dinero's own answers
  captured before the package left, 4B-6); `translateFunctionsError`,
  `FunctionsErrorDetails`, `UNKNOWN_ERROR_KEY`, `CodedError`'s `{ code }`
  member and branch, and the i18n lib's `firebase/functions` import with its
  lint exemption; every lowercase-rooted `errors` leaf of both catalogues
  (139 per locale); `docs/architecture/domain-model.md` (D6). The only
  `{workspaceRoot}/firestore.rules` test input (the deleted `domain-accounts`)
  moved to `ecs-core` and `functions`, whose specs parse the rules (runbook
  §4.8 gate 11). Already gone before 4b, so not re-deleted: `LegacyWireCode`
  and its tables (4a, 4A-4); the Phase 2 shim bridges died inside the legacy
  directories — all but four modules of the staff dashboard (`visit-sides.ts`,
  `barber-tone.ts`, `shared/walk-in-labels.ts`, `shared/catalog-delta.ts`),
  which outlived 4b and the UI residue cleanup and went in pass B.
- **The dotted keys' successors (plan §2).** Each still-read dotted key got a
  SCREAMING, domain-prefixed `errorCode` declared once in its primitives
  dictionary, holding today's words verbatim in both locales; its readers
  were re-pointed before the key was retired, and each now reads the
  dictionary member itself (the feature-level aliases and module constants
  that carried the dotted strings are deleted — R7, OQ 14):

  | Retired (`errors.…`)                         | Successor (`errors.…`)                       | Readers re-pointed (the deleted alias or constant in brackets)                                                                                                                                |
  | -------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `accounts.upload_avatar.upload_failed`       | `ACCOUNTS_UPLOAD_AVATAR_UPLOAD_FAILED`       | `avatar-refusal.ts` (`AVATAR_UPLOAD_FAILED`)                                                                                                                                                  |
  | `accounts.remove_avatar.remove_failed`       | `ACCOUNTS_REMOVE_AVATAR_REMOVE_FAILED`       | `profile.store.ts` (`avatar-refusal.ts` `AVATAR_REMOVE_FAILED`)                                                                                                                               |
  | `accounts.update_profile.repository_failure` | `ACCOUNTS_UPDATE_PROFILE_REPOSITORY_FAILURE` | `own-profile.ts` (`PROFILE_WRITE_FAILED`)                                                                                                                                                     |
  | `identifier_missing`                         | `IDENTITY_IDENTIFIER_MISSING`                | `onboarding-flow.store.ts`, `profile.store.ts` (`IDENTIFIER_MISSING`)                                                                                                                         |
  | `unknown`                                    | `IDENTITY_CALL_FAILED`                       | `auth-flow.store.ts`, `onboarding-flow.store.ts` (`UNKNOWN_ERROR_CODE`)                                                                                                                       |
  | `repository_failure` (client account)        | `ACCOUNTS_REPOSITORY_FAILURE`                | `client-account.ts` `translateRepositoryError`                                                                                                                                                |
  | `repository_failure` (admin rhythm)          | `ENGAGEMENT_REPOSITORY_FAILURE`              | `admin-rhythm.ts` ×3                                                                                                                                                                          |
  | `identity.phone.<reason>` (5)                | `PHONE_INVALID.<reason>` (flat keys)         | `client-onboarding.ts` `phoneError`, through `translateCodedError`'s reason argument                                                                                                          |
  | `booking.gateway.failed`                     | `BOOKING_CALL_FAILED`                        | FOUR: `booking-error-message.ts` (`REVIEW_FALLBACK_CODE`); `client-appointments.ts` (`CANCEL_FAILED`); `staff-dashboard.ts` `refuse()`'s default `fallbackKey` and `describeError`'s fallback |
  | `booking.transition.seat_resolved`           | `BOOKING_TRANSITION_SEAT_RESOLVED`           | `staff-dashboard.ts` `describeError`                                                                                                                                                          |

  The other lowercase-rooted leaves had no reader since the 4a wire flip and
  went in one edit. No value was added to the dictionaries enumerated in
  production (`PipelineErrorCode`, `RepositoryErrorCode`,
  `StreakPublishErrorCode`); every new code has an inert `EDGE_WIRE` row
  (4B-5). The words, re-measured at integration with a node one-liner
  against `e2d7a8f`'s catalogues: all 14 successors hold the retired keys'
  words byte for byte in `bg` and in `en`; the 126 SCREAMING keys of
  `e2d7a8f` are unchanged; 139 lowercase-rooted leaves left each locale;
  `errors` holds 140 keys in each (126 + 14); the i18n suite (5 files, 66
  tests) pins the words permanently («the Phase 4b successors carry the
  retired keys' words»). The smoke's (c) — the same comparison on the
  catalogues the running app serves — found the same: all 14 exact in `bg`
  and `en`, 140 SCREAMING `errors` keys each ("Gate" below).

- **The lint widening (plan §3, 4B-7).** The root config spreads
  `ecsSyntaxBlocks(ECS_ALL_SUFFIXES, { extra: ECS_TOKEN_RESTRICTIONS })` —
  the `*.port.ts` and `*.adapter.ts` blocks and the `InjectionToken` guard
  on every ECS-suffix file of the workspace — and a `**/*.port.ts` block
  with `creativo/no-sliced-ports` in strict mode (`anyType`); ecs-core keeps
  its `src/ports/**` strict block (moving it would narrow coverage);
  `ECS_ROOT_SUFFIXES` is retired. The token guard is NOT installed on every
  root `*.ts`: it would flag 67 lawful Angular-wiring sites in 15 files
  (`ports.tokens.ts` ×37, `firebase-app.provider.ts`, `lazy-port.ts` and its
  specs, `app.config.ts`, the `libs/ui/*` tokens, feature rigs) — Law 4
  allows `InjectionToken` in Angular UI wiring — so the every-file half stays
  project-scoped (`ecsProjectBlocks`, libs/ecs-core and apps/functions, where
  no Angular lives). The `luxon`/`dinero.js` bans stay as retired-package
  guards, their messages without the kernel clauses; the i18n lib takes the
  root firebase ban whole again. `libs/ui/icons/eslint.config.mjs` no
  longer cancels the root blocks: its registry-boundary
  `no-restricted-syntax: 'off'` ignores the seven ECS suffixes (R8), so an
  ECS-suffix file there keeps the root's suffix block (runbook §4.8 gate 9's
  icons probe). What the widened blocks flagged on the 4b tree: nothing —
  `run-many -t lint` is 44 projects, 0 errors, and no warning sits on a line
  4b changed (the one new finding of the tree, `catalogue-parity.spec.ts`'s
  nested-quantifier regex, was rewritten without one, R6). No exemption was
  added (no new `eslint-disable`, no new `ignores` but R8's narrowing of an
  `'off'`); the one stated non-widening is the every-file token guard above.
- **The functions deps re-record (plan §8 step 3).** After R8, the last
  lint-config change: `pnpm nx build functions --skip-nx-cache`, whose
  `dist/apps/functions/package.json` lists exactly `firebase-admin`,
  `firebase-functions`, `libphonenumber-js`, `rxjs` (no devDependencies, no
  peers); the check before the record failed as it must ("removed:
  dinero.js"); `node tools/verify/p0/check-functions-deps.mjs --record`
  re-recorded `functions-deps.baseline.json` (four keys, the recorder's
  rxjs-stays `//` text, `recordedAt` the UTC day); the check without
  `--record` then passes, the forbidden-key half included ("4 runtime
  dependencies, as recorded, none forbidden"). Why, for the commit message:
  dinero.js leaves with the money spec's cross-check (4B-6, 4B-8); rxjs stays
  (4a §10.1). `functions-deps.mjs` refuses a forbidden key (`@angular/*`,
  `luxon`, `@types/luxon`, `dinero.js`) before the baseline diff, and
  `--record` refuses to write one — with runbook §4.8 gate 8 (no legacy
  project in the graph, so no functions → legacy edge) that is the
  blueprint's end-of-3b assertion as code.
- **The docs.** `module-boundaries.md` rewritten from the post-4b graph (44
  projects, the ecs-core tiers, the import cages, `## scope:backend`); the
  Phase 4b deletion banner on `docs/migration-blueprint.md`,
  `domain-deviations.md` and every design-research spec still citing the
  deleted trees (runbook §4.8 gate 12), and on `docs/migration/goals/`
  `README.md`, `00`, `02`, `03`, `08` (plan OQ 10, re-decided; R3); the
  blueprint's status "executed"; `flatten-spec.md`'s "until Phase 4" sites
  noted done and the spec bannered executed (R3); the runbook's gates over
  deleted paths rewritten (§4.2, §4.3, §4.5, §4.7) and §4.8 added (with
  gates 3b, 3c and 6b, and gate 9's per-project probes, R3);
  `firestore.rules` comments re-pointed to `role.data.ts` (`STAFF_ROLES`,
  `BOOK_ROLES`). `CLAUDE.md` = `AGENTS.md` (§0 the 3-tier shape REMOVED, §1,
  Law 7.1, Law 9.4, §3, §4) and `.claude/rules/ecs-ports.md` are agent
  configuration, changed only on the owner's own approval (4B-11, plan R4):
  **applied 2026-10-23** on the owner's go-ahead for Phase 4 (plan §4.R R4's
  exact text; `cmp CLAUDE.md AGENTS.md` clean, no "until Phase 4" clause
  left, `ecs-ports.md` names `DefaultLocationPorts`).
- **Gate (plan §8.1, 2026-10-23, after `nx reset`).** The static half of §4
  green but the baseline reds: `sync:check` up to date;
  `verify-tools:layering --skip-nx-cache` ok (644 files, 2,874 import edges
  in ecs-core; 2,238 files scanned in libs/apps/tools);
  `run-many -t typecheck --skip-nx-cache` only `patterns` red;
  `run-many -t lint` 44 projects, 0 errors;
  `run-many -t test --parallel=3` 43 projects, 10,698 passed, 6 failed (the
  baseline `gauge.spec.ts` 4, `visit-pills.spec.ts` 1,
  `visits-page.presenter.spec.ts` «strikes an hour that did not happen» 1),
  plus `verify-tools`' 79 node tests — down from 12,605 passed + 6 on the 4a
  tree with the 169 legacy spec files (per-project totals in plan §8.1);
  `nx test ecs-core --coverage --skip-nx-cache` 272 files, 4,530 tests,
  97.85 % statements, 98.82 % lines; `nx test functions --skip-nx-cache` 37
  files, 937 tests; `typecheck seed-tools` green; `build web` green (initial
  598.10 kB, 4a 597.59 kB; the `gauge.css` budget warning as before);
  `verify:bundle` ok; `build functions --skip-nx-cache` +
  `check-functions-deps.mjs` pass on the re-recorded baseline. Grep gates
  under bash: runbook §4.2 PASS (28 `ok`), §4.3 PASS (22), §4.4 PASS (17),
  §4.5 PASS (6), §4.7 re-run on the 4b tree PASS (24; its closing review 34
  comment mentions, all past-tense provenance or `dead:` notes), §4.8 PASS
  (26 `ok`, its gates 1–7 each first failing on the committed `e2d7a8f`
  tree — the known-bad run). **The second pass, the same day (plan §8.1
  item 9), after `nx reset`:** the whole of §4 again, identical numbers
  (ecs-core 97.86 % statements; `nx test lint-rules` 6 files, 145 tests),
  §4.8 27 `ok` with gate 6c (the feature-level aliases, word-bounded), and
  the emulator journeys ONE AT A TIME: `pnpm run verify:p0` "all proved"
  (check (f) on the re-recorded deps); `pnpm run test:emulator` 65 + 255,
  unchanged; `pnpm run e2e:web` 19 failed / 41 passed — exactly the
  baseline. The plan's §8 step 6 dev smoke: 35 checks, 0 failed — `/book`
  to the review step, `/account` and the profile sheet, the staff agenda
  and a visit sheet, `/admin/loyalty` → the rhythm page, each with no
  console error; the formerly-dotted families in `bg` and `en` with the
  same words — the onboarding phone field's too-short refusal; with the
  Functions emulator unreachable, the `/auth` OTP request
  (`IDENTITY_CALL_FAILED`), an appointment cancel (`BOOKING_CALL_FAILED`),
  a profile save (`ACCOUNTS_UPDATE_PROFILE_REPOSITORY_FAILURE`) and an
  admin rhythm save's toast (`ENGAGEMENT_REPOSITORY_FAILURE`); the
  `/account` read refused (`ACCOUNTS_REPOSITORY_FAILURE`, the emulator's
  rules swapped and put back); (c) the served catalogues. 4b's gate is
  green, whole.

**Deploy (runbook §3).** The ordinary order; nothing to stage ahead of the
code: no index changed, `firestore.rules` changed in comments only, and no
callable answer or stored shape moved (4B-1). The flip-4 precondition (the
default location's `timeZone`) still stands.

**UI residue cleanup (2026-10-23, `docs/architecture/flips/ui-residue-cleanup.md`)
— four of the items 4A-13 and phase-4b OQ 15 carried forward are closed.**
(1) The visit shim `libs/features/shared/visits/src/lib/visit-ecs.shim.ts` is
deleted with every legacy translation table of the UI layer (its five
tables, `client-query.ts`'s `LEGACY_CLIENT_QUERY_SHAPE` pair, `GRID_EVENT_OF`,
`COUPON_OCCASION_OF`, the dashboard's verb, status and resolution word round
trips): the visit rows carry the ecs-core tags and `localDate` +
`startMinutes`, "now" is a `ShopNow` the host derives, and no Sofia fallback
is left. (2) The view-model `kind`/`status` discriminators (the 4a plan's
§8.1 item 7, the admin programs view state and the rest — 27 files) are
domain-prefixed fields over SCREAMING `as const` dictionaries, and every
load state reads the ONE `LoadState`/`LoadSlice`/`PagingState` vocabulary of
`@creativo/shared/view-state`. (3) The five undecorated classes — `VisitClock`,
`CardClock`, `EdgeScroller`, `FrameFullscreen` and the
`ConsoleUiIconReporter` the inventories missed — are factories:
`visitClockOf` (one clock for rows and cards), `edgeScrollerOf`,
`injectFrameFullscreen`, `consoleUiIconReporter`. (4) The UI's ambient clock
and entropy reads are the injected `CLOCK_PORTS` clock, `ZonedTimeSystem`,
`LocalDate` and the one cached set of `@creativo/ui/wall-clock` formatters
(moved out of the visits lib); the draft seat and guest ids keep their
persisted format on a `CLOCK_PORTS` stamp (plan UR-11). What stays, by name:
the media cache's retry jitter and the confetti (`Math.random()`), and the
two sanctioned adapters (`browser-runtime.adapter.ts`,
`auth-session.adapter.ts`). Enforced, not trusted: four lint rules in the
root config — `creativo/no-undecorated-class` on every production `.ts` of
the apps and libs, `creativo/no-ambient-clock`,
`creativo/no-generic-discriminator` and `creativo/no-hand-built-load-slice`
(a `LoadSlice` comes from its companion, never a hand-built literal; added by
the review fixes) on the UI layer — scoped by path-fragment
options so they hold under the nx executor and under directory lookup alike,
and runbook §4.9 (gates 1–8). Since the class rule recognises an Angular
class by its called decorator rather than by a file name, the class guard no
longer stops at the ECS suffixes (plus every file of libs/ecs-core and
apps/functions): it covers every production file, and the suffix blocks'
class ban is defence in depth there. The test doubles — `FakeFirestore`
(`libs/infrastructure/firestore/src/testing/fake-firestore.ts`), the observer
polyfills, spec-local stubs such as `FixtureLoader`
(`translate-coded-error.spec.ts`) — stay legal under the rules' test-support
ignores (plan UR-8). **Gate (2026-10-23, plan §8.1):** `sync:check` (after
`nx sync` + `nx reset` for the two new libs), layering, typecheck (only
`patterns`), lint 46 projects 0 errors, test 46 projects 10,832 passed + the 6
baseline reds, ecs-core coverage unchanged, seed-tools, lint-rules 9 files
221 tests, `build web` (initial 604.22 kB: +6.14 kB raw / +0.81 kB transfer,
all of it Angular's `resource()` chunk joining the initial `@angular/core`
code for client-account's zone read — kept, plan §8.1 ruling 8),
`verify:bundle`, `build functions` + the deps check, runbook §4.2–§4.5, §4.7,
§4.8 PASS and §4.9 PASS (24 `ok`), `verify:p0`, `test:emulator` 65 + 255,
`e2e:web` 41 passed + exactly the 19 baseline failures; the dev smoke drove
29 screens and states in bg and en against the integrated tree and a HEAD
copy of `c77e932` on the same emulators — every DOM signature identical but
the now-label minute and the bare static `perspective` attribute the hosts
no longer carry (no reader; `data-perspective` unchanged). Integrator
rulings: the `/account` card's failed zone read prints the card's existing
`ACCOUNTS_REPOSITORY_FAILURE` line (DEP-5), the path-scope helper of the
rules lives in `tools/lint-rules/path-scope.mjs`.

**Carried forward — follow-up work, not migration (4a plan 4A-13, UI residue
plan UR-13; none of it blocks anything):** the **view-model pass** (UR-13 f,
plan OQ-11) — RULED 2026-10-23 (owner, option B; **Law 10**): presenters
(`*.presenter.ts`) and display models (`*.vm.ts`) are a sanctioned, pure
file kind that words what systems decided (`creativo/presenter-purity`;
`.claude/rules/presenters.md`); `catalog-to-vm.ts` / `catalog-vm.ts` /
`visit-vm.ts` / `seat-scope-vm.ts` were renamed into the kinds
(`catalog.presenter.ts` + `catalog.vm.ts`, `visit.vm.ts`, `seat-scope.vm.ts`).
The **decision-extraction pass** (Law 10.2) is integrated (above); what it
carried: the service detail sheet's performer sort and bundle saving
(Angular component math → `CatalogPricingSystem.performersByPrice` /
`bundleSaving`, which then retire the catalog's anonymous offering — plan
OQ-3), the keys built from display words (the reward ticket's group key, the
glance's held rewards by NAME — a coupon id / `RewardId` on the card
contracts, OQ-4), whether the glance's voucher sum should refuse mixed
currencies like the wallet's total (OQ-5), the history page's read-policy
constants `HISTORY_PAGE_SIZE` / `FILTER_REFILL_*` (OQ-6), whether the
wallet's `localeCompare` and the glance's input-order ties should follow the
visit list's code-unit / id tie-breaks (OQ-7, owner), `CouponGrantSystem`'s `Partial<{ couponOccasion }>`
constraint (tighten it once the owner makes `ClientCardGrant.couponOccasion`
required — `client-card.contracts.spec.ts` pins it optional today), the two
word sources of the rhythm's closed track marks (`admin-rhythm.words.ts`
`sampleClosed`, `wallet.presenter.ts` `closedPeriod`); the
Law 7.4 branding/T1 pass (UR-13 c) — the staff day's instant-based
agenda/grid fields (`startMs: number` threads in `staff-day.store.ts`,
`staff-dashboard.ts`, the booking time sheet), the client card's raw
`nowMs: number` threads into its non-visit presenters (pause, photos,
capsules), and the raw ids the cleanup's contracts leave raw
(`VisitRowVm.id`, `VisitRowOptions.subjectUserId`/`subjectCustomerId`/
`currentAppointmentId`, `PlacementVerdictSlice` `minutes`) and the raw
`today`/`nowMs` strings the presenters still parse at their edge, incl. the
glance's raw `context.appointmentId` (decision-extraction plan D-2.8, D-3); the icon
manifest's `kind` wire field, allowlisted in `no-generic-discriminator` until
an icons pass bumps its `schemaVersion` (UR-13 a, OQ-5);
the flip-1 ports parked with no caller
(`markNotificationRead`, `loadWaitlistRequest`, `loadCouponGrant`,
`readCustomers`) and `CouponGrantSystem`'s whole grant verb set — `burn`,
`restore`, `expire`, `revoke` (their `*Slice` halves module-private since
pass B), `termsOf`, `isActive` and `transitionWrite` — waiting for grant
burn/restore, `NotificationSystem.markRead` / `readBeforeSent` / `isUnread`
beside the parked `markNotificationRead`, `VoucherSystem.issue` waiting for
voucher issuing, and flip 1's other deferred behaviours (reopen busy write,
trigger `retry: true`); the owner's confirmation of the 4a plan's §11.4 (a)
time-sheet re-pin; the programs rules tightenings, a location picker, i18n of
the programs status words and a programs e2e journey (flip 4); from the UI
residue cleanup (plan §8.1 "Left as found"): the lower-case unions compared as
bare literals that are neither a `kind`/`type`/`status` field nor a load state
(the dashboard's `StaffView` and `discardPending`, the grid's `Placement`,
`readoutTone`, marketing-events' `EventsTab`, admin-programs' `ProgramsTab`,
the rhythm page's `confirm` switch, the editor's `discountKind()`/`by`/
`refusal`, the bare `'en'` language checks — the menu's `lang() === 'en'`
and six more production sites). (The `StaffDashboard.periodLabel` throw the
smoke surfaced is fixed by pass A, below; the `angular-ui.md` sentence that
named the i18n lib as the formatting home, UR plan OQ-7, and the Node tooling
classes, OQ-6, are closed by pass B, below.)

**Law 10.2 decision-extraction pass (2026-10-23,
`docs/architecture/flips/law-10-decision-extraction.md`) — presenters word,
systems decide.** The domain decisions still inside the ~20 presenters and
their wording helpers — a state with precedence, what is owed or earned,
what qualifies, which items exist, an ordering or grouping rule, a
threshold, a duplicated rule constant (plan §0 D-1; wording, zero forms,
display caps, host lookups and UI read-state stay, D-2/D-3) — are answered
by ecs-core systems (Law 3), each with a purity + boundary spec that ports
the presenter's cases (plan §1, §9.1, 111 rows). Two new systems:
`LoyaltyPassSystem` (the pass — `presenters.md`'s canonical example) and
`WalletSystem` (the discs and the write gate, which `client-card.store.ts`
`rewardsUsable` now calls too); 23 extended (REUSE, NEVER COPY — e.g.
`VisitStorySystem.toneOf`/`statusMark`/`subjectFigure`/`marksOf`,
`VoucherSystem.held`/`heldTotal`, `RewardSystem.tiles`/`pointsReach`,
`TierSystem.plate`, `LedgerSystem.lineOf`, `StreakSystem.outlook`,
`BadgeSystem.captionOf`/`detailState`/`ladder`,
`AchievementsSystem.completesWithVisit`, `StandingSystem.strip`/`shelves`,
`ClientStatsSystem.cadenceWeeks` — the ONE home of `max(1, round(days/7))`
— `tenureOf`, `historyNote`); the companions `ServiceComposition.drawnKind`,
`Gamification.countsVisits`/`isVisitKind`, `JournalEffectRecord.isTier` and the
new `PunchCard.progress`;
23 new SCREAMING tag dictionaries in `components/` (`BirthdayMoment` moved
down from `client-pages.vm.ts`, which binds and re-exports it). Additive
only (plan D-5): no existing system output changed; the three outright
copies (`pricedOf` twice, `voidedIds`, the wallet's voucher sort) and the
duplicated constants are deleted. The catalog view model carries the
pricing system's answers (`ServiceVm.priceFrom`/`cardPrice`/`minutesRange`,
D-10); `servicesByBarber` became `LandingContentService.barberPrices`.
Every presenter keeps its exported surface (D-9) and every presenter spec
passes unchanged; the only spec edits are §4.3's catalog fixture fields and
one value-identical line of `visit-story.system.spec.ts`, plus a type-only
edit of `catalog-navigation.service.spec.ts`'s helper that §4.3 missed (plan
§9.2). No
departure (D-13): the wallet's vouchers keep their `localeCompare` ties (a
comparator parameter of `VoucherSystem.held`) and the glance's equal starts
their input order (`VisitListSystem.upcomingSoonestFirst` is stable); DEP-3
(a 23:59 DST gap on the records' 12-month row) is unreachable on the
supported zones. **Gate (2026-10-23, plan §9.3):** `sync:check`, layering,
typecheck (only `patterns`; run after `rm -rf dist/out-tsc` — a stale
buildinfo had hidden a `marketing-landing` spec's type error from the first
green run, fixed type-only, plan §9.2), lint 46 projects 0 errors, test 46
projects 11,340 passed + the 6 baseline reds, ecs-core 275 files 4,958 tests
98.00 % statements, seed-tools, `lint-rules`, `build web` (initial 604.26 kB, +0.06 kB),
`verify:bundle`, `build functions` + the deps check, runbook §4.2–§4.5,
§4.7, §4.8 and §4.9 PASS with the reference counts, the plan's §5 review
checklist clean (every surviving hit ruled), and — in place of the
dev-stack smoke, which needs the emulators — a DOM differential of every
spec of the nine projects behind the smoke's screens on a `git archive`
copy of `fd5f2a6` and a copy of the integrated tree: 2,611 tests and their
rendered DOMs identical (one load-timing artefact of the time grid's
auto-scroll spec, identical when re-run alone); then, one at a time,
`verify:p0` ((a)–(f) proved), `test:emulator` (65 + 255) and `e2e:web` (41
passed + exactly the 19 baseline failures, the glance's 12 failing at
`:384`/`:765` as on the earlier trees), and the plan's §6.3 dev-stack smoke
against a `git archive` copy of `fd5f2a6` on the same emulators and seed: 45
screens × bg/en — the landing shelf, five service sheets, the team's barber
prices, `/book`'s services step, `/account` and its appointments, Георги's
and Мартин's client card, wallet, ledger, medals, records, eight medal
details, the season's scope and a season family, the history page and its
filter menu, admin rhythm — 86 of 90 signatures byte-identical and the
other 4 differing only in two «след N мин» glosses of the agenda behind the
filter menu (the minutes between the runs); console errors the same set.
The closing integrator's own edits (plan §9 top): `StandingSystem.strip`
answers the cue's `closestId` (the presenter no longer re-applies the
newest-family rule), `JournalEffectRecord.isTier` narrows the ledger's TIER
line, the reserved publisher uid's two fixture copies read
`StreakPublishSystem.SYSTEM_PUBLISHER`, and the stale
`catalog-pricing.system.ts` JSDoc names its callers.

**Pass A — the audit's defects (2026-10-24).** A read-only audit of `main`
at `fe4635a` confirmed four defects; four fixers worked on disjoint files
and one integrator fitted them together.

1. **The client photo strip came up short.** `listClientPhotos` read the
   newest `limit` photos of a client record and only then set the shop's
   library pictures aside, so a library picture adopted onto a visit took
   one of the 12 places. The origin is now a filter of the query
   (`clientCustomerId ==`, `photoOrigin == SHOT`, `takenAtUtcMs desc`,
   `limit`), and index #22 became (`clientCustomerId` ASC, `photoOrigin`
   ASC, `takenAtUtcMs` DESC), replaced in place under the same blueprint
   number (runbook matrix row updated). The memory double answers what the
   adapter answers: shots only for the strip and the per-visit counts, and
   nothing for a limit under one. So the `GEORGI_SHOTS` hand filter of the
   shared visits fixtures is gone, and the rules integration spec copies
   the production query. **Deploy:** the new composite must be `READY`
   before the web code reaches a real project (runbook §3 step 1, indexes
   first, additive); the old two-field composite goes at step 6 (prune),
   once hosting is live.
2. **The age window was worded without its figure.** The client profile's
   birth-date line rebuilt `{ errorCode }` from the bare code, so
   `errors.IDENTITY_BIRTH_DATE_TOO_YOUNG` / `_TOO_OLD` printed without 16
   or 120. The page now holds `AgeSystem.fromParts`' whole `IdentityError`
   and words it with `translateCodedError`, onboarding's grammar (spec:
   bg + en from the shipped catalogues). A survey of every other
   `errors.*` site found no other rendered parameter lost, except the
   onboarding residual carried below.
3. **A DST gap was swallowed into a stale instant.** The staff edit and the
   client reschedule wrote `start.ok ? start.value : stored.utcEpochMs`
   (and the cart's instant), so a seat moved into a spring-forward gap was
   saved with the old `utcEpochMs`. Now every chair of the folded visit
   (the edit, on the TARGET shop's zone, so a relocation included) and the
   whole party with its carried seats (the reschedule) go through
   `frameWallClock`, as a new booking does. A start in the gap is refused
   `DST_GAP_INVALID_TIME` before the placement read, and the envelope's
   instant is computed once and used for both the decision and the write.
   `WIRE_PARAM_ALLOWLIST` gained `DST_GAP_INVALID_TIME: ['localDate',
'minute', 'timeZone']`, so the web's copy names the erased wall clock
   and the zone. **Behaviour change:** a stored visit with a seat inside a
   gap (only the old whole-party move could make one) now answers any staff
   edit with the refusal until it is moved.
4. **Three staff-day defects.** (a) A cancel's «Друго…» words rode the
   `transitionAppointment` call as `note`, and the wire refused an `OTHER`
   with nothing written, against D23 (code-only). `BookingCall.Transition`
   lost `note`; the wire accepts `OTHER` alone and ignores a stray `note`.
   Once a cancel has landed, the dashboard appends the words BELOW the
   visit's note (`StaffDayStore.appendTeamNote` → `saveTeamNote`, the rule
   `VisitSidesSystem.appendedNote`), and a note that did not save raises
   `staff.day.cancelNoteFailed` (new key, bg + en, worded for either scope —
   «Отказано е, …», since a seat called off out of a party leaves the rest
   booked). A chair holding two seats whose second seat is refused files the
   words with the first seat's cancel, once per sheet, and the sheet narrows
   to the refused seats, so the retry no longer re-sends a seat already
   resolved (which was refused on every retry). (b) `periodLabel`
   formatted `visibleDays()[0]` while the list was still empty and threw
   on every cold staff-page load. It now names nothing until a day is
   shown. (c) The visit editor's service options and the row's catalogue
   tag fell back to the FIRST barber's offering for a chair with none, so
   they quoted a price and minutes the server would not charge. Both now
   resolve through `OfferingPriceSystem.termsFor`, the server's own
   resolution (the service's own terms for such a chair).

The integrator's own edits: the append rule moved from the dashboard's
`visit-sides.ts` into `VisitSidesSystem` (math case + purity), the new i18n
key and its bg/en spec, `appointment-photo.entity.ts`'s strip JSDoc, the
rules spec's strip query, the `GEORGI_SHOTS` removal and its three
consumers, and `main.spec.ts`'s stray `note: null`. The review's fixer:
the partly-landed multi-seat cancel above (`confirmCancel`, two dashboard
cases) and the scope-neutral bg toast (its bg/en pin for a seat cancel and
a whole booking). **Static gate
(2026-10-24, re-run after the review's fixer):** typecheck after
`rm -rf dist/out-tsc` (only `patterns`, the baseline), lint 46 projects 0
errors, test 46 projects 11,343 passed +
exactly the 6 baseline reds, layering OK, ecs-core 275 files 5,002 tests
98.01 % statements (the threshold holds), `build web` (initial 604.34 kB,
+0.08 kB) + `verify:bundle`, `build functions` + the deps check; then the
orchestrator's full gate, green: runbook §4.2–§4.9 28/22/17/6/24/27/25 ok,
`verify:p0` (a)–(f), `test:emulator` 65 + 255, `e2e:web` 41 passed + exactly
the 19 baseline failures (the glance's 12 still at `:384`/`:765`). **Carried from pass A** (none blocks anything):
the onboarding birthday SAVE path still dispatches a bare code into the flow
state's `error: string`, so a 120 → 121 refusal re-judged across a UTC
midnight reads without `{{maxAge}}` (the struct would have to ride
`OnboardingFlowEvent.birthdayFailed`); `appendTeamNote` reads the note once,
so offline with the note document never cached it could write over the
server's copy (the editor's guard has the same limit); the client time sheet
cannot see where a carried companion lands, so such a reschedule is now
refused by the server instead of written wrong; an end-to-end
`word-pipeline-error.spec.ts` case for the DST chain (today covered in two
halves); and `ecs-migration.md` / `flips/flip-1-booking-core.md` still
describe #22's earlier two-field shape, as the historical records they are.

**Pass B — dead code, old-style leftovers, stale docs (2026-10-24).** A
read-only audit of `main` at `99a60fa` (13 agents, skeptic-verified) listed
what the migration left dead or old-style; the owner's word: remove the dead
code and the old-style leftovers, and correct the docs. Eight packages worked
on disjoint files, then one integrator. "Dead" meant no production caller,
re-proven with `git grep` over libs, apps and tools (templates, project
files and configs included); a spec alone kept nothing alive, and a spec case
that also proved live behaviour was re-pointed at the live API, never
dropped. Every deletion is behaviour-neutral unless marked otherwise.

1. **The legacy design system** (cr-design-system): three Nx projects deleted
   — `libs/shared/ui` (36 files, 12 specs), `libs/shared/cursor` (19) and
   `libs/shared/design-tokens` (11) — with their three aliases, and the eight
   `generated/**` files of the token build retired in 2026-07.
   `reset.css` and `reduced-motion.css` moved rule-for-rule into
   `libs/ui/tokens` (the web's built stylesheet byte-identical, its layer
   order unchanged); the showcase moved onto `--sys-*` (its fallback focus
   ring is now the ink ring, the view transition 300 ms, no Roboto link);
   stylelint's base list switched from `--cr-*` to `--sys-*`;
   `docs/styling-conventions.md`, `docs/accessibility-conventions.md` and
   `module-boundaries.md` (43 projects) rewritten against `libs/ui`.
2. **The staff dashboard's Phase 2 shims** (dashboard-shims): `visit-sides.ts`,
   `barber-tone.ts`, `shared/walk-in-labels.ts`, `shared/catalog-delta.ts` and
   their four specs (every case already in the ecs-core system specs). The
   callers call `VisitSidesSystem`, `BarberToneSystem` and `VisitDraftSystem`
   directly; the `−10 мин` wording is `shared/catalog-tag.words.ts` (Law 10);
   the tip is `tipCents: PriceCents | null` end to end, so `recordTip`'s
   unreachable re-validation went.
3. **The data surface** (data-surface): the `users/{uid}/rewardProgress` and
   `rewardPrograms` rules blocks (the default deny covers both, pinned by the
   rules spec) and the `Retired*` collection registry; four callerless port
   families (six port types) and what served them — `markAllNotificationsRead`
   (its `inboxPorts` member and double; `INBOX_PORTS` stays), the
   impersonation read (`ImpersonationReadPorts`, `IMPERSONATION_READ_PORTS`,
   `impersonation.adapter.ts` and its two specs, the double), `KeyValuePorts`
   (`KEY_VALUE_PORTS`, the local-storage adapter, the double) and
   `LoadAppointment`/`AppointmentLoadPorts`, which had no adapter, token or
   double — and the catalogue streams'
   never-passed `categoryId`/`locationId` filters; composite indexes #1, #3
   and #9 deleted (a `barbers.locationIds` `indexes: []` override added);
   `auditRowCreate` and `errorCodeOf`. The three `settings/bookingPolicy`
   readers type the body as `BookingPolicySettings` (Law 5), and the
   `firestore.rules` / `storage.rules` comments are rewritten against
   today's adapters (a comment-stripped diff shows only the two deleted
   blocks).
4. **The seed and P0 tooling** (seed-tooling): the symbolic-to-stored mapper
   tables and the seed's two private zone engines (`calendar.mjs`,
   `loyalty.mjs`) went — a visit is authored typed in the ecs-core vocabulary
   (`fixtures/book.fixtures.ts`), days and instants come from
   `ZonedTimeSystem` and `LocalDate`, the root lifecycle from
   `SeatOutcome.summarize`; `ExecutionTally` is a closure and `LostAnswer` a
   tagged answer (UR OQ-6 closed); `settings/bookingPolicy` is seeded from a
   typed `BOOKING_POLICY` with all seven fields. An equivalence recorder ran
   the real seed against the old and the new tree on seven pinned clocks (both
   DST edges and a leap day included): 0 differences but the intended one,
   `autoConfirm` now written (`true`, the default every reader already fell
   back to).
5. **Dead feature code** (features-dead), ~40 exports: `appointment-groups.ts`;
   the client card's deprecated head (`ClientCardStore.head`, `clientHeadVm`,
   `ClientHeadVm` — the visit editor reads `ClientCardStore.avatarSrc`); 20
   `sheet-width.ts` exports; `walletTierVm`, `rewardTiles`, `daysBetweenDays`,
   `signedFigure`, `UiDisabledDirective`, `offered`, `cueOrder`, `signedDelta`,
   `streakFactsOf`, `BookingStepWord`, two unread fixtures; the landing's test
   support out of its production barrel (its test catalogue now under
   `src/testing/`), and `LandingContentService` delegating its words to the
   shared catalogue's.
6. **ecs-core components, entities and errors** (ecs-core-data), ~45 members:
   the legacy readers (`PhotoOrigin.parse`, `DayHours.parseClock` /
   `parseClockWeek`, `SeatOutcome.reasonOf`), the spec-only guards and
   `*_KINDS` / `*_CODES` lists (gamification, coupon occasion, customer
   origin, enrollment, OTP, session kind, role, audit actions, label codes,
   personal records, engagement codes), `AccountAppointment`, four
   `BarberPref` helpers, `JournalActor`, `PointsExpiry.of`,
   `BookingDraft.freshOrigin`, the error `CouponOccasionUnknown`; and the
   doubles' dotted-path walks — `fieldAt` and the fake Admin Firestore read
   root keys only, and the fake's lenient object-form `update` is refused.
7. **ecs-core systems** (ecs-core-systems): 50 public members with no
   production caller, found by an AST scan over every `XSystem` member — e.g.
   `AgeSystem.ageAtInstant`, `AppointmentLifecycleSystem.admit` /
   `seatViolations` / `openSeats` / `latenessMinutes` /
   `bookingLeadTimeMinutes`, `AvailabilitySystem.candidateStarts` /
   `hasAnyOption` / `distinctStarts`, `BadgeSystem.validate` and
   `SeasonSystem.validate`, `BusySystem.plan`, the `CancellationPolicySystem`
   copies of `BookingPolicy`'s formula, six `ClientStatsSystem` members,
   `LoyaltyCatalogSystem.streak` / `streakInForce`, `StreakRuleSystem.equals`,
   `VisitStorySystem.story`, `VoucherSystem.isRedeemable` / `void`; the
   lifecycle's and the coupon grant's `*Slice` verbs are module-private.
   **Behaviour change:** the waitlist request id hashes the flat stored body
   (no `dayKey` / `HH:mm` projection), so every `wl_` id changes — reseed the
   emulator; an admission refusal is
   `WaitlistError.cartRefused(<the commit's BookingError>)`, the wire
   unchanged.
8. **The docs** (docs): the README; HANDOFF corrections (the last green
   commit, R4, OQ-12, the e2e anchors); the runbook rows re-derived on the
   pass-B tree; `.claude/rules` — `firestore-layout.md`'s appointment example
   is the real seven-slice body, `ecs-pipelines.md`'s examples name live
   ports and adapters, `angular-ui.md` and `presenters.md` name `formatCents`
   and `@creativo/ui/wall-clock` (the carried UR OQ-7 sentence).

The integrator's own edits: the packages' cross-file issues (the visit-row
spec off `reasonOf`, the loyalty and client-card fixtures and three specs off
the deleted validators and streak lookups, the stale JSDoc that named deleted
files — `formatMoney` → `formatCents` included); the deletions the packages
unblocked — `CancellationReasonSet.fromStored`, `Seat.composeAccount`,
`SeatOccupant.accountOf`, `CollectionName` / `SubcollectionName`, and the 15
error codes left with no producer (`ENGAGEMENT_DISCOUNT_APPLICATION_INVALID_CAP`,
eight `ENGAGEMENT_BADGE_SERIES_*`, five `ENGAGEMENT_SEASON_*`,
`SCHEDULING_CANCELLATION_WINDOW_INVALID` with its edge row; no catalogue key
named any); the P0 callable answer's generic `kind` → `callableAnswer` over a
SCREAMING dictionary (Law 6.2); two renames, everywhere but the historical
records — the i18n lib's refusal wording is `translateCodedError`
(`translate-coded-error.ts`: it words any `{ errorCode }` struct, there is no
domain-error class left) and the catalogue's locale-bound wording service is
`CatalogWording` (`catalog-wording.service.ts`: an injectable, not a Law 10
presenter); the shell header's last `--cr-*` names →
`--site-header-float-*`; `docs/design-research/decisions.md` corrected,
`docs/security/csp-baseline.md` bannered, the runbook's index legend and its
§1.2 / §1.3 banner; and ten unused packages removed in one `pnpm remove` —
`@angular/platform-server`, `@angular/ssr`, `express`, `@types/express`,
`style-dictionary`, `culori`, `@angular/forms`, `@angular/cdk`,
`@angular/aria`, `@angular-devkit/build-angular` (`gsap` stays: the confetti
imports it). **Static gate (2026-10-24, re-run on the final tree after the
review's fixes below):** typecheck after `rm -rf dist/out-tsc` (only
`patterns`, the baseline), lint 43 projects 0 errors, test 43 projects 11,144
passed + exactly the 6 baseline reds, layering OK, ecs-core 275 files 4,898
tests 97.95 % statements (the threshold holds), `seed-tools` typecheck,
`lint-rules` 13 files 290 tests, `lint:styles`, `build web` (initial
597.93 kB, −6.41 kB; the global stylesheet byte-identical,
`styles-ACTLBMYT.css`, the reset and reduced-motion rules in it) +
`verify:bundle`, `build showcase` (initial 642.56 kB, from 655 kB),
`build functions` + the deps check (the same four runtime dependencies),
`sync:check`; then the orchestrator's full gate, green: the runbook grep
gates first caught two seed authoring names that are retired document
spellings (`bookedAt` in the new `ShopMoment` intents, a `hours:` parameter —
§4.2 and §4.5 "removed fields / removed document keys"); they became
`bookedOn` / `cancelledOn` / `hoursBefore`, the seed equivalence proof was
re-run on the final seed (0 differences on all eight runs but the explicit
`autoConfirm`), and runbook §4.2–§4.9 then read 28/22/17/6/24/27/25 ok;
`verify:p0` (a)–(f), `test:emulator` 65 + 253 (the impersonation adapter's
three-case integration spec went with the adapter; the rules spec gained the
case that pins the retired collections closed), `e2e:web` 41 passed + exactly
the 19 baseline failures (the glance's 12 still at `:384`/`:765`). **Deploy:**
`firestore.indexes.json` now omits composites #1, #3 and #9 — deploy it after
the web build that drops the catalogue filters; the CLI deletes an index
missing from the file only on confirmation or `--force`.

**The review's fixes (2026-10-24).** A skeptic-verified review of the pass-B
tree confirmed eight gaps, and one fixer closed them. Three test-support
members the packages had skipped went with the spec cases that only pinned
them: `memoryAppointmentNotePorts`, `memoryBookingDraftPorts` and
`steppingNowUtcMs` (the clock case keeps its `pinnedNowUtcMs` half). Eight
more error codes with no producer since before pass B went the way of the 15:
`EngagementErrorCode.CouponNameEmpty`, `CouponUsageLimitInvalid` and
`InvitationInviterNameEmpty`, and `SchedulingErrorCode.PartyInvalidGuestSequence`,
`PartyUnclaimed`, `CalendarDayInvalid`, `DateRangeInvalid` and
`WaitlistInvalid` (no edge row or catalogue key named any). The two renames
came back out of the seven historical records the integrator had touched (the
migration blueprint, goals 05 and 06, and four design-research docs), which
name `translateDomainError` and `CatalogPresenter` again, as their trees did.
The runbook's two retired rows now name the rules spec that pins them, and its
§1.1 note no longer cites the `Retired*` entries. The disabled-cursor and
unlayered-sheet sentences in `docs/styling-conventions.md` now match the tree.
This record's port count and §6 owner flags were corrected too.

**Carried from pass B** (none blocks anything):

- **For pass C — systems the features or pipelines re-implement (KEEP-FOR-C):**
  `BookingTotalSystem.total` / `seatSubtotals` (`booking-review-step.ts`
  `totalLabel` and the per-seat totals); `AppointmentLifecycleSystem.confirm`
  / `complete` / `markNoShow` / `cancel` / `reopenNoShow` / `reopenSettled` /
  `markSeatOutcome` (`staff-dashboard.ts`: the legal verbs, `primaryVerb`,
  the party-vs-seat fan-out, the undo inverse, the seat-outcome summary);
  `AppointmentEditSystem.fold` (`edit-appointment.pipeline.ts`
  `foldOnClock` — business math in a pipeline); `IntervalSetSystem.clip`
  (`staff-time-grid.ts` `proportionalBox`, `staff-timeline.ts`);
  `OfferingPriceSystem.performerIds` / `isPerformedBy`
  (`booking-services-step.ts`, `service-detail-sheet.component.ts`);
  `DiscountSystem.samePromise` (the visit editor's own `samePromise`);
  `TriggerAttemptSystem.decisiveFailure` (`project-client-stats.pipeline.ts`
  `decisiveAttemptFailure`); `VoucherSystem.coverage` / `redeem` (the visit
  editor's voucher draw).
- **Parked on purpose (KEEP-PARKED):** the flip-1 ports and grant verbs above
  (`markNotificationRead`, `loadWaitlistRequest`, `loadCouponGrant`,
  `readCustomers`, `CouponGrantSystem`'s verb set), `NotificationSystem`'s
  read stamp and `VoucherSystem.issue`; the catalogue edge-guard family
  (`DayHours.parseWeek` / `DayHoursInput`, `ServiceComposition.parse`,
  `openDay`, the `CATALOG_LOCATION_INVALID_HOURS_*` / `_TIME_OF_DAY` codes and
  the reserved `CatalogErrorCode.LocationInvalidTimezone` — delete the family
  or wire it to an admin location writer, the owner's call);
  `BookingFlowEventKind.SetDayWindows` with `FlexibleWhen.withWindows`
  (never dispatched — the per-day window sheet, or delete both);
  `EngagementErrorCode.BadgeCategoryOrderNegative` (no producer since before
  pass B); the type-level variants `CancellationAttribution.Shop` and
  `StreakTrackMarkKind.Kept` / `Repaired` / `Missed`; the matchMedia and
  ResizeObserver test polyfills (live consumers).
- **Owner flags:** (a) `CLAUDE.md` + `AGENTS.md` — APPLIED 2026-10-24 on the
  owner's go-ahead (byte for byte; Law 2's illustrative example left as is):
  §4's "D1–D28" twice → "D1–D29" (D29, the customer record,
  decided 2026-10-10); Law 5's `/appointments/{id}` example stores no
  `tenantId`, `paymentMethod` or root `priceCents`/`currency` — the docs
  package's proposed body names `locationId, ownerUserId, ownerCustomerId,
subjectCustomerIds, barberIds, busyKeys, localDate, startMinutes,
endMinutes, utcEpochMs, bookingStatus, confirmedAtUtcMs, contactName,
bookedAtUtcMs, seats: [{ …, priceCents, currency }]`; Law 10.1's
  `formatMoney` → `formatCents` (deleted with `libs/domain/kernel` in
  `f9cef52`); optionally Law 2's example intersection, which is
  illustrative (the real entity intersects seven slices). (b) The walk-in
  client path: the `customers` create/update grant for `worksTheBook` and
  `CustomerOrigin.StaffWalkIn` are kept with no web writer (flatten-spec
  §5.5). (c) The client write grants for the catalogue
  (`isCatalogManager`), `barberSchedules` / `scheduleExceptions`
  (`mayEditRoster`) and `settings` (`isAdmin`) are kept for a later rules
  pass. (d) The TTL declarations are untouched (a later pass). (e)
  `apps/web/src/app/shell/impersonation-banner.ts` is an empty slot whose
  read port pass B deleted — keep the slot or drop it. (f) The deploy order
  of the deleted composites (above) and the waitlist id reseed.
- **Smaller follow-ups:** the stylelint override for `libs/ui/**` and
  `libs/features/**` (~73 literal metrics to move onto tokens, then drop it);
  `swipe-to-delete.directive.ts`'s four `@HostListener`s (host metadata,
  `docs/styling-conventions.md`); the showcase's
  `phone-field.page.css` `::ng-deep`; the showcase Playwright snapshots (the
  fallback focus ring and the view-transition timing changed; a refresh is
  unlikely to be needed); the e2e support's own shop zone and clock
  (`appointment-seed-document.ts` `SHOP_ZONE`, `booking-days.ts`
  `new Date()` — `ZonedTimeSystem.shopNow` on the seeded location's zone);
  the staff dashboard's raw `priceCents: number | null` (`DayRowVm`,
  `VisitEditorVm`, the editor's legs — the boundary the tip had);
  `client-query.ts` `toRankable`; the visit-row presenter spec's legacy
  whole-visit `{ kind }` fixture words; and the CSP `headers` block of
  `firebase.json` (`csp-baseline.md`).

## 4. The gate — every step must pass it before landing on `main`

```bash
pnpm nx sync:check
pnpm nx run verify-tools:layering --skip-nx-cache
pnpm nx run-many -t typecheck --skip-nx-cache   # ALWAYS skip the cache here
pnpm nx run-many -t lint
pnpm nx run-many -t test --parallel=3
pnpm nx test ecs-core --coverage
pnpm nx typecheck seed-tools
pnpm nx build web
pnpm run verify:bundle
pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs
# the grep gates, under bash: runbook §4.0 (the preamble), then §4.2–§4.5,
# §4.7 (since Phase 4a: no legacy consumer, the wire flipped, no graph edge)
# and §4.8 (since Phase 4b: the deletion — no legacy path, alias, tag, package
# or dotted key; the root ECS lint blocks; the firestore.rules test inputs)
# and §4.9 (since the UI residue cleanup: no shim or legacy table, no kind/status
# discriminator, no undecorated class, no ambient clock, no hand-built load
# slice — the four rules proven under both ESLint base paths, with a canary)
# the emulator journeys share ports — run ONE AT A TIME:
pnpm run verify:p0
pnpm run test:emulator
pnpm run e2e:web
```

**Pre-existing red — not yours, do not chase:** typecheck of `patterns`
(spec-only errors) and nothing else — `admin-loyalty` is green since flip 1,
`staff-client-card` and `staff-dashboard` since Phase 4a, so a typecheck red
in any other project is a regression;
unit tests `gauge.spec.ts` (4), `visit-pills.spec.ts` (1),
`visits-page.presenter.spec.ts` "strikes an hour that did not happen" (1);
e2e: 19 failures — 6 `*-screenshots.spec.ts`, `landing.spec.ts:121`
(MapLibre; `:120` before Phase 4a), 12 `client-card-glance.spec.ts` runs of
the two tests at `:343`/`:686` (`:341`/`:684` before flip 3), failing at
`:384`/`:765`; and
`appointments.spec.ts:152` flakes under load (passes alone with
`--repeat-each=3`). Anything else red is a regression. Under
`run-many -t test --parallel=3` the heavy `staff-dashboard`,
`staff-client-card` and `marketing-landing` specs can time out — re-run
the project alone before calling it a regression.

**Reference numbers on the decision-extraction tree (2026-10-23, the FULL
gate)** — a drop without a reason is a lost case: 46 projects lint, 0
errors; `run-many -t test` 46 projects, 11,340 passed + the 6 baseline reds
(10,888 below + 24 `lint-rules` cases of the Law 10 commit's
`presenter-purity` + 428 ecs-core cases of the pass), `verify-tools` 79 node
tests, `lint-rules` 13 files and 290 tests; ecs-core 275 files, 4,958
tests, 98.00 % statements (13,061/13,327), 98.90 % lines (11,341/11,467);
functions 37 files, 937 tests; `verify:p0` (a)–(f); `test:emulator` 65 +
255; `e2e:web` 41 passed + the 19 baseline failures; `build web` initial
604.26 kB (164.00 kB transfer); the functions dist's four runtime
dependencies; layering 664 files and 3,105 import edges; runbook §4.2 28
`ok`, §4.3 22, §4.4 17, §4.5 6, §4.7 24, §4.8 27, §4.9 25. Typecheck after
`rm -rf dist/out-tsc` when a type moved: `tsc --build` can judge a spec
config up to date from a stale buildinfo and hide its error.

**After the pass's review round (2026-10-23, `flips/law-10-decision-extraction.md`
§9.5)** — the numbers that moved: ecs-core 4,989 tests (+31: `dueAfter`,
`pointsReachBeyondHeld`, `shelfRank`, the null-modelled draft,
`MinuteOfDay.LAST`), 98.00 % statements (13,080/13,346), 98.90 % lines
(11,357/11,483); layering 665 files and 3,107 import edges; `build web`
initial 604.28 kB (164.06 kB transfer); plan §5 grep 3 = 44. Every other
number above held.

**Reference numbers on the `@core/errors` tree (2026-10-23)** — a drop
without a reason is a lost case: 46 projects lint, 0 errors; `run-many -t
test` 46 projects, 10,888 passed + the 6 baseline reds (10,864 on the UI
residue cleanup tree; +2 `ecs-core-base-paths` cases of the OQ-12 fix, +22
lint-rules cases of the errors tier — `error-dictionary-home` and the
`*.error.ts` suffix block), `verify-tools` 79 node tests, `lint-rules` 12
files and 266 tests; ecs-core 272 files, 4,530 tests, 97.85 % statements
(12,108/12,373), 98.82 % lines; functions 37 files, 937 tests;
`test:emulator` 65 + 255; `e2e:web` 41 passed + the 19 baseline failures;
`build web` initial 604.20 kB; the functions dist's four runtime
dependencies (`firebase-admin`, `firebase-functions`, `libphonenumber-js`,
`rxjs`); runbook §4.2 28 `ok`, §4.3 22, §4.4 17, §4.5 6, §4.7 24, §4.8 27,
§4.9 25 (§4.7's two error-home gates re-homed to `src/errors`).

## 5. Operating rules

- Work directly on `main`; commit and push at every green step, in a few
  logical commits; fast-forward only, never force-push. Never bypass the
  pre-commit hook (Prettier + stylelint + gitleaks).
- Behaviour is frozen during reshaping: a failing legacy spec means the code
  changed behaviour — fix the code, never the spec.
- Greenfield: no dual shapes, no backfill, no fallback readers — the emulator
  is wiped and reseeded (`pnpm run seed:dev`, and `e2e:web` does it itself).
- Never `git checkout`/`stash`/`reset` a dirty path to undo your own edit;
  apply the inverse edit.
- Parallel agents need disjoint file ownership; one integrator owns the gate.
- Ports (Law 9, `.claude/rules/ecs-ports.md`): declare focused bundle records
  in `libs/ecs-core/src/ports/`, compose with `&`, type each InjectionToken
  and adapter factory against a bundle; `Pick`/`Omit` of a `*Ports` type is a
  lint error everywhere (`creativo/no-sliced-ports`).

## 6. Open questions for the owner

- **Pass B owner flags (2026-10-24)** — the end of §3.3 lists them: the
  `CLAUDE.md`/`AGENTS.md` corrections the docs package proposed (D1–D29,
  Law 5's appointment example, Law 10.1's `formatCents` — applied on the
  owner's go-ahead the same day), the walk-in client
  path, the client write grants, the TTL declarations, the catalogue
  edge-guard family, the impersonation banner slot, the deploy order of the
  three deleted composite indexes, the waitlist request ids, which now hash
  the flat stored body (every `wl_` id changes; reseed), and
  `BookingFlowEventKind.SetDayWindows` / `FlexibleWhen.withWindows` (keep for
  the per-day window sheet, or delete both).
- Decision-extraction plan (`docs/architecture/flips/law-10-decision-extraction.md`)
  §8: OQ-1 … OQ-8 proceed on their defaults — the catalog component specs'
  fixture literals gained the three figure fields (OQ-1); the cue rule
  (`AchievementsSystem.completesWithVisit`) and the detail/count rule
  (`countsToward`) stay two functions, documented side by side (OQ-2);
  the service detail sheet's math, keys built from display words, the
  glance voucher sum and the history read-policy constants are carried
  (OQ-3 … OQ-6, end of §3.3); the tie orders are unchanged — the wallet's
  `localeCompare`, the glance's input order (OQ-7, yours to rule later);
  OQ-8 is moot — `samplePeriods` delegates to `StreakSystem.track`, proven
  equivalent on the admin sample's states.
- **Ruled 2026-10-23 — Law 10, presenters (the view-model pass, option B).**
  Presenters (`*.presenter.ts`) and display models (`*.vm.ts`) stay as a
  sanctioned, pure file kind that words what ecs-core systems decided; the
  full conversion to template pipes (option A) is declined. Every domain
  decision moves into a system (Law 10.2); `creativo/presenter-purity`
  enforces the purity half.
- **Ruled 2026-10-23 — the `@core/errors` tier.** Error dictionaries and
  their struct unions live in `libs/ecs-core/src/errors/<domain>.error.ts`
  (`@core/errors`), a tier between primitives and components; `Result`,
  `PrimitiveError` (`primitives/primitive.error.ts`) and the base tag
  dictionaries stay in primitives; an error names no component type. Law 1,
  Law 7.5, Law 8 and the §2 file-kinds table (Error | `*.error.ts`) say so;
  `creativo/error-dictionary-home` enforces the home.
- **Ruled 2026-10-22 — F6:** no `@core/phone` alias; the phone field lazily
  imports `@core/systems` and the owner accepts the larger lazy chunk
  (`.claude/rules/ecs-layering.md`).
- **Ruled 2026-10-22 — flip-2 §10.15:** once the web's profile edits go
  through `updateProfile`, the pipeline writes the profile-change audit row
  itself, inside its transaction, credited to the calling user; the
  `auditProfileChanges` trigger skips an edit the callable already audited.
- **Before the flip-4 web deploys (flip-4 OQ-11):** confirm the production
  default location id and that its document holds a valid `timeZone`
  (runbook §3).
- `flatten-spec.md` §10 OQ-2…OQ-12 proceed on their documented defaults
  (cron zone home, Role/AuthStage claim casing, `LocalizedText` nested,
  D29 contact sync/merge, `EndMinute`, one shop day per appointment,
  `attendanceState` values, backfill job ids, media prefixes, D17
  seconds + nanos, no index change in the flatten pass).
- Flip-1 plan open questions (its §open questions) proceed on the plan's
  defaults: customer ids sit beside `subjectUserIds`; grant burn/restore,
  reopen busy write, trigger `retry: true` deferred to their own commits;
  `cancelWaitlist` kept `{ code }` until the Phase 4a wire flip (it now
  refuses with `CancelWaitlistRefusalCode` structs keyed by `errorCode`);
  customers writes per flatten-spec §5.5.
- The test runner stays Analog 2.8 (owner ruling 2026-10-10).
- Phase 4b plan §10: OQ-1 … OQ-9 proceed on their defaults — two
  `repository_failure` successors (`ACCOUNTS_REPOSITORY_FAILURE`,
  `ENGAGEMENT_REPOSITORY_FAILURE`), a generic call-failure code per surface
  (`IDENTITY_CALL_FAILED`, `BOOKING_CALL_FAILED`), inert `EDGE_WIRE` rows for
  the web-only codes, the retired-package lint bans kept, the strict
  `no-sliced-ports` block at the root AND in ecs-core, the i18n firebase ban
  re-instated (and web-storage's at the review-fix pass — it imports no
  firebase either; plan §8.1 item 10), `rxjs` accepted in the functions dist, provenance by legacy
  basename with a pointer to the plan's §11.1. OQ-10 was RE-DECIDED
  2026-10-23: `docs/migration/goals/{README,00,02,03,08}.md` carry the
  one-line Phase 4b banner (R3), since their exit gates grep deleted paths.
  OQ-7 and OQ-11 (the constitution and rules edits): **applied 2026-10-23**
  on the owner's go-ahead for Phase 4 — plan §4.R R4's exact text. OQ-12: runbook §4.8 gate 3b
  (deleted-tree paths cited without `libs/`) added; its four sites
  re-worded (R1). OQ-13: the legacy-dotted `{ code }` error and log payloads
  of four specs and `telemetry.port.ts`' doc re-targeted to the flat
  `{ errorCode }` of their successors (R2), gated by §4.8 gate 6b. OQ-14:
  the feature-level aliases `PROFILE_WRITE_FAILED`, `AVATAR_UPLOAD_FAILED`,
  `AVATAR_REMOVE_FAILED` deleted — every reader names the `AccountsErrorCode`
  member (R7). OQ-15: the undecorated non-Angular classes carried
  forward, not converted in 4b — the production ones converted by the UI
  residue cleanup and guarded by `creativo/no-undecorated-class` since; the
  test doubles stay under its test-support ignores (end of §3.3).
- UI residue plan (`docs/architecture/flips/ui-residue-cleanup.md`) §10:
  OQ-1 … OQ-12 proceed on their defaults — the landing locations line and
  today row on the SHOP's clock (DEP-1), the footer year on the SHOP's
  calendar (the default location's zone, the UTC calendar only while that
  read is pending — DEP-2 as amended by the review), the month picker's shortcuts inert without `uiToday`
  (DEP-3), `/account`'s card waiting inside its pending state for the zone
  (DEP-4) and reading "now" in the appointment's OWN location's zone, a failed
  read showing the existing `'error'` state (DEP-5 — integrator ruling: with
  the card's existing `ACCOUNTS_REPOSITORY_FAILURE` line, never the zone
  answer's code), the icon manifest's `kind` allowlisted (OQ-5), the tools
  classes left (OQ-6 — closed by pass B: `ExecutionTally` is a closure,
  `LostAnswer` a tagged answer), `wall-clock.ts` in `@creativo/ui/wall-clock`
  (OQ-7 — the owner may rename the home and owns `angular-ui.md`'s wording,
  which pass B corrected to name it), draft ids
  on the `CLOCK_PORTS` stamp (OQ-8), one-variant tags deleted (OQ-9), the
  view-model pass (OQ-11) — ruled 2026-10-23 as Law 10 (presenters
  sanctioned; the decision-extraction pass integrated since, end of §3.3), ecs-core's tier lint blocks (OQ-12) —
  resolved 2026-10-23: CI enforced them all along (its lint target runs
  `eslint .` from the project), and their globs now also match from the
  workspace root (`fromEitherBase`, pinned by
  `tools/lint-rules/ecs-core-base-paths.spec.mjs`). Also for the owner: the +6.14 kB initial
  bundle of Angular's `resource()` (plan §8.1 ruling 8), kept.
