# ECS migration — handoff and continuation guide

Read this first if you are an agent (Claude Code, Codex, Cursor, Gemini, …) or
a developer picking up the ECS / data-oriented migration. It says where the
work stands, what to do next in which order, and how to prove each step.
Last updated 2026-10-22 (flip 1 complete; Law 9 port-composition pass;
flips 2, 3 and 4 integrated — the Phase 3b flips are complete; Phase 4a
integrated — the full gate green, the "Phase 4a" commit; Phase 4b next,
§3.3).

## 1. Read these, in this order

1. `CLAUDE.md` (= `AGENTS.md`) — the constitution, **Laws 1–9**. Non-negotiable.
2. `.claude/rules/*.md` — compiled templates per file kind (components,
   primitives, systems, pipelines, ports, Firestore layout, layering,
   Angular UI).
3. `docs/architecture/ecs-migration.md` — the blueprint: §6 phase plan,
   §9 decisions D1–D29 (the notes at its top say where Laws 6–8 override it).
4. `docs/architecture/flatten-spec.md` — every name, shape and time rule of
   the flat archetypes (Laws 6–7); §2.3 T1–T9 are the time rules.
5. `docs/architecture/firestore-runbook.md` — the reader/writer matrix of every
   collection, the flip closures, TTL steps, per-flip grep gates.
6. `docs/architecture/flips/flip-1-booking-core.md` — the worked example of a
   flip (its adapter table predates Law 9; the note above it says so).

## 2. Where the work stands

| Step                                                                                  | State                                                                                                                                                                     | Commit(s)                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Constitution + blueprint                                                              | done                                                                                                                                                                      | 81ac087                                                      |
| Tooling (ECS lint guards, functions-deps check, Analog 2.8)                           | done                                                                                                                                                                      | defb4da                                                      |
| Phase 1 — `libs/ecs-core` foundation                                                  | done                                                                                                                                                                      | 056ae43                                                      |
| Phase 2 — all business math in pure systems, legacy classes shimmed                   | done                                                                                                                                                                      | 0416587                                                      |
| Laws 6–7 (flat archetypes, primitives, shop-anchored time, error structs)             | done                                                                                                                                                                      | a6c7253                                                      |
| Phase 3a — functions composition root, `edge.ts`, body-free adapters, test support    | done                                                                                                                                                                      | 291d3f9                                                      |
| Flatten pass (Laws 6–7 applied) + owner rulings (Law 7.3 amendment, `TimeCoordinate`) | done                                                                                                                                                                      | 268aa0e, dbd39d4                                             |
| Law 8 + layering pass (`@core/*` tier barrels, no root barrel)                        | done                                                                                                                                                                      | 3458349, ab6d266, c0e5d73                                    |
| **Phase 3b flip 1 — booking core**                                                    | **done** — integrated 2026-10-16; on 2026-10-21 `verify:p0` and `e2e:web` ran green locally (baseline only) and `apps/web/e2e/booking-core.spec.ts` proves the live paths | bafdbdd, 32b870d, 4ba5d87, then the "flip 1 complete" commit |
| Law 9 + port-composition pass (bottom-up bundles, `creativo/no-sliced-ports`)         | done — 2026-10-21, full gate green                                                                                                                                        | the "Law 9" commit                                           |
| **Phase 3b flip 2 — identity and accounts**                                           | **done** — integrated 2026-10-21; the full gate of §4 green (baseline reds only), `verify:p0` (e) both ways, the flip-2 grep gate PASS                                    | the "flip 2 commit"                                          |
| **Phase 3b flip 3 — loyalty and invitations**                                         | **done** — integrated 2026-10-22; the full gate of §4 green (baseline reds only), the §6 grep gate PASS, the §8 dev smoke run                                             | the "flip 3 commit"                                          |
| **Phase 3b flip 4 — programs**                                                        | **done** — integrated 2026-10-22; the full gate of §4 green (baseline reds only), the §6 and end-of-3b grep gates PASS, the §8 dev smoke run                              | the "flip 4 commit"                                          |
| **Phase 4a — re-point every legacy consumer, the wire flip, the rules tightenings**   | **done** — integrated 2026-10-22; the full gate of §4 green (baseline reds only), runbook §4.2–§4.5 + §4.7 PASS, the §8 dev smoke 57 checks                               | the "Phase 4a" commit                                        |
| Phase 4b — delete the legacy libraries, `luxon`, `dinero.js`; the docs rewrite        | not started (a pure deletion once 4a is green)                                                                                                                            |                                                              |

`main` carries the flip-1 to flip-4 reshapes, the Law 9 port pass and
Phase 4a, and the FULL gate of §4 is green on it (baseline reds only). The
Phase 3b flips are complete and so is the blueprint's end-of-3b graph/bundle
assertion (no project edge into `libs/application/*` or `libs/domain/*`; the
functions dist without `@angular/*` and `luxon` — `rxjs` stays, 4A-2 (d)).
The last fully green commit is the "Phase 4a" commit; check `git log` for
anything newer. Next: Phase 4b, a pure deletion (§3.3).

## 3. What to do next, in order

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
still exports the retired flip-1 tokens and `*_COLLECTION` constants
(Phase 4 deletes the layer); `markNotificationRead`,
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
  record; the web reads `PROFILE_PORTS`, `USER_SEARCH_PORTS`,
  `IMPERSONATION_READ_PORTS` (`accounts.adapter.ts`,
  `impersonation.adapter.ts`), and owner edits run
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
libs/application/*` edge, no `@angular/*` or `rxjs` in
`dist/apps/functions/package.json`, `functions-deps.baseline.json`
re-recorded.

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

**Phase 4b — what it must do (a pure deletion; nothing may change
behaviour):**

1. Delete `libs/application/*` and `libs/domain/*` (17 Nx projects —
   `nx graph` shows no edge into them), their `tsconfig.base.json` aliases
   (incl. `@creativo/application/engagement/testing`, whose `src/testing.ts`
   4a already deleted), their `.nxignore` lines, their eslint `files`
   blocks; keep `.nxignore`'s `ecs-core`, `infrastructure/*` and
   `features/client/account-state` lines. Their specs die with a §7-style
   ledger that cites plan §11.3's successors (each legacy spec's rule
   already has its 4a successor there).
2. Remove `luxon`, `@types/luxon`, `dinero.js` from `package.json`, the
   dinero cross-check in `libs/ecs-core/src/components/money.data.spec.ts`
   and its `no-restricted-imports` override; re-run
   `check-functions-deps.mjs` and re-record its baseline (`dinero.js`
   leaves; `rxjs` stays unless the owner rules on plan §10.1).
3. The dotted i18n keys and their readers: `translateFunctionsError` lost
   its last 4a reader — delete it with the dotted keys, EXCEPT the keys
   still read (plan §8.1 item 9 (g): `errors.accounts.upload_avatar.upload_failed`,
   `errors.accounts.remove_avatar.remove_failed`,
   `errors.identifier_missing`, `errors.unknown`,
   `errors.repository_failure`, `errors.identity.phone.<reason>`,
   `accounts.update_profile.repository_failure`, `booking.gateway.failed`,
   `errors.booking.transition.seat_resolved`). `translateDomainError`'s
   `{ code }` branch is NOT readerless: its last readers are exactly the
   (g) keys' (`admin-rhythm.ts`, `client-account.ts`, `client-onboarding.ts`
   `phoneError`, and the `translateError(code)` of `client-auth.ts`,
   `client-profile.ts`, `client-onboarding.ts` — plan 4A-5). To delete the
   branch, first give each (g) key a SCREAMING successor with today's text
   verbatim, re-point its constant and pass its reader a flat
   `{ errorCode }` struct; else keep the keys and the branch.
4. Lint: the root-widened adapter/port/token guards (blueprint §6 Phase 4
   "Nx") and the `type:application` depConstraints rows retired; the
   remaining `libs/domain/kernel` mentions in lint messages.
5. Docs: rewrite `module-boundaries.md` from the new graph, delete
   `domain-model.md` (D6), banner `docs/migration-blueprint.md`, drop the
   "until Phase 4" clauses of `CLAUDE.md`/`AGENTS.md` (both, byte for
   byte), the provenance comments naming the legacy libs (the 33 of runbook
   §4.7's closing review) and the `firestore.rules` comments naming
   `@creativo/domain/accounts`.
6. Then the gate of §4, unchanged. Later (4A-13, not 4b): the view-model
   `kind`/`state`/`status` unions of plan §8.1 item 7, the UI-only
   `Date.now()`/`Math.random()` reads, `visit-ecs.shim.ts`, the owner's
   confirmation of §11.4 (a)'s time-sheet re-pin.

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
# the grep gates, under bash: runbook §4.0 (the preamble), then §4.2–§4.5 and,
# since Phase 4a, §4.7 (no legacy consumer, the wire flipped, no graph edge)
# the emulator journeys share ports — run ONE AT A TIME:
pnpm run verify:p0
pnpm run test:emulator
pnpm run e2e:web
```

**Pre-existing red — not yours, do not chase:** typecheck of `patterns`,
`staff-client-card`, `staff-dashboard` (spec-only errors; `admin-loyalty` is
green since flip 1);
unit tests `gauge.spec.ts` (4), `visit-pills.spec.ts` (1),
`visits-page.presenter.spec.ts` "strikes an hour that did not happen" (1);
e2e: 19 failures — 6 `*-screenshots.spec.ts`, `landing.spec.ts:121`
(MapLibre; `:120` before Phase 4a), 12 `client-card-glance.spec.ts` runs at `:343`/`:686` (`:341`/`:684` before flip 3); and
`appointments.spec.ts:152` flakes under load (passes alone with
`--repeat-each=3`). Anything else red is a regression. Since Phase 4a
`staff-client-card` and `staff-dashboard` typecheck green (only
`patterns` stays red — a new red in either is a regression), and under
`run-many -t test --parallel=3` the heavy `staff-dashboard`,
`staff-client-card` and `marketing-landing` specs can time out — re-run
the project alone before calling it a regression.

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
  `cancelWaitlist` keeps `{ code }`; customers writes per flatten-spec §5.5.
- The test runner stays Analog 2.8 (owner ruling 2026-10-10).
