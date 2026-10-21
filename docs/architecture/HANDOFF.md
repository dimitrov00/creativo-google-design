# ECS migration — handoff and continuation guide

Read this first if you are an agent (Claude Code, Codex, Cursor, Gemini, …) or
a developer picking up the ECS / data-oriented migration. It says where the
work stands, what to do next in which order, and how to prove each step.
Last updated 2026-10-21 (flip 1 complete; Law 9 port-composition pass;
flip 2 integrated; flip 3 next).

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
| Phase 3b flip 3 — loyalty and invitations                                             | not started                                                                                                                                                               |                                                              |
| Phase 3b flip 4 — programs                                                            | not started                                                                                                                                                               |                                                              |
| Phase 4 — web integration and legacy deletion                                         | not started                                                                                                                                                               |                                                              |

`main` carries the flip-1 and flip-2 reshapes and the Law 9 port pass, and
the FULL gate of §4 is green on it (baseline reds only). The last fully
green commit is the "flip 2" commit; check `git log` for anything newer.

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
  still declared in the systems tier — a small pass moves them to
  primitives (Law 7.5 / `ecs-layering.md`); the unused
  `LegacyWireCode` rows whose handlers are gone (`OtpValidationFailed`,
  `OtpDestinationEmpty`, `InvalidOtpMaxAttempts`, `EmptyId`,
  `InvalidDateTime`, `AccountsIdEmpty`, `InvalidTimeZone`) stay pinned by
  `edge.spec.ts` until Phase 4; `OtpStorePorts.loadOtp` and
  `AuthAdminPorts.setClaims` have no caller (§10.13); a store failure of an
  owner write still answers the legacy
  `accounts.update_profile.repository_failure` (no `errors.REPOSITORY_*`
  i18n keys yet); `§10.15` (profile-row attribution once Phase 4 routes
  client edits through `updateProfile`) is the owner's before Phase 4.
- **Flip 3 — loyalty and invitations:** `invitations`, `loyaltyAccounts`
  (streaks as an array), `clientJournal`, `streakDefinitions` + versions,
  badge/season/tier/reward catalogue.
- **Flip 4 — programs:** `positions`, `courses`, `events` (admin writes stay
  rules-guarded, D9(b)).

### 3.3 Phase 4 — client integration and legacy deletion (blueprint §6 Phase 4)

`lazy-port` factory rows in `app.config.ts`; feature stores re-typed to the
ecs-core entities; delete `libs/application/*`, `libs/domain/*` (incl. the
kernel and `libs/domain/models`), every shim bridge, the contact-change
adapter (D12(b)); remove `luxon`, `@types/luxon`, `dinero.js` from
`package.json`; the rules tightenings (impersonationSessions write false,
invitation redemption via callable, users allowlist) each with its web switch;
rewrite `module-boundaries.md`, delete `domain-model.md` (D6).

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
e2e: 19 failures — 6 `*-screenshots.spec.ts`, `landing.spec.ts:120`
(MapLibre), 12 `client-card-glance.spec.ts` runs at `:341`/`:684`; and
`appointments.spec.ts:152` flakes under load (passes alone with
`--repeat-each=3`). Anything else red is a regression.

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

- **F6 (before Phase 4):** the phone field lazily loads phone parsing; under
  Law 8 that would import all of `@core/systems` lazily — add a sanctioned
  lazy-only `@core/phone` alias, or accept the larger lazy chunk?
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
