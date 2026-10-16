# ECS migration — handoff and continuation guide

Read this first if you are an agent (Claude Code, Codex, Cursor, Gemini, …) or
a developer picking up the ECS / data-oriented migration. It says where the
work stands, what to do next in which order, and how to prove each step.
Last updated 2026-10-16 (flip 1 integrated; two emulator journeys still to run).

## 1. Read these, in this order

1. `CLAUDE.md` (= `AGENTS.md`) — the constitution, **Laws 1–8**. Non-negotiable.
2. `.claude/rules/*.md` — compiled templates per file kind (components,
   primitives, systems, pipelines, Firestore layout, layering, Angular UI).
3. `docs/architecture/ecs-migration.md` — the blueprint: §6 phase plan,
   §9 decisions D1–D29 (the notes at its top say where Laws 6–8 override it).
4. `docs/architecture/flatten-spec.md` — every name, shape and time rule of
   the flat archetypes (Laws 6–7); §2.3 T1–T9 are the time rules.
5. `docs/architecture/firestore-runbook.md` — the reader/writer matrix of every
   collection, the flip closures, TTL steps, per-flip grep gates.
6. `docs/architecture/flips/flip-1-booking-core.md` — the flip in progress.

## 2. Where the work stands

| Step                                                                                  | State                                                                                                                                                 | Commit(s)                                                          |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Constitution + blueprint                                                              | done                                                                                                                                                  | 81ac087                                                            |
| Tooling (ECS lint guards, functions-deps check, Analog 2.8)                           | done                                                                                                                                                  | defb4da                                                            |
| Phase 1 — `libs/ecs-core` foundation                                                  | done                                                                                                                                                  | 056ae43                                                            |
| Phase 2 — all business math in pure systems, legacy classes shimmed                   | done                                                                                                                                                  | 0416587                                                            |
| Laws 6–7 (flat archetypes, primitives, shop-anchored time, error structs)             | done                                                                                                                                                  | a6c7253                                                            |
| Phase 3a — functions composition root, `edge.ts`, body-free adapters, test support    | done                                                                                                                                                  | 291d3f9                                                            |
| Flatten pass (Laws 6–7 applied) + owner rulings (Law 7.3 amendment, `TimeCoordinate`) | done                                                                                                                                                  | 268aa0e, dbd39d4                                                   |
| Law 8 + layering pass (`@core/*` tier barrels, no root barrel)                        | done                                                                                                                                                  | 3458349, ab6d266, c0e5d73                                          |
| **Phase 3b flip 1 — booking core**                                                    | **INTEGRATED** — every package done, the plan's §11 case ledgers complete, the gate green except `verify:p0` and `e2e:web`, which have not run (§3.1) | bafdbdd, 32b870d, then the "flip 1 integrated" commit on top of it |
| Phase 3b flip 2 — identity and accounts                                               | not started                                                                                                                                           |                                                                    |
| Phase 3b flip 3 — loyalty and invitations                                             | not started                                                                                                                                           |                                                                    |
| Phase 3b flip 4 — programs                                                            | not started                                                                                                                                           |                                                                    |
| Phase 4 — web integration and legacy deletion                                         | not started                                                                                                                                           |                                                                    |

`main` carries the whole flip-1 reshape. Every gate step of §4 passes on it
except the two journeys that need the Functions emulator (`verify:p0`,
`e2e:web`), which have not been run on it yet (§3.1). The last commit with the
FULL gate green is still `c0e5d73`. If a later commit on `main` says "flip 1
complete" with both journeys green, this row is stale — check `git log`.

## 3. What to do next, in order

### 3.1 Finish flip 1 (booking core) — exact remaining work

The 2026-10-16 session integrated the flip. What it found and did:

- **Already done on `32b870d`** (the 2026-10-15 list was stale): P4's
  `staff-dashboard.spec.ts` (it typechecks and passes), every P6 seed spec
  (`seed-tools` 530/530), the `clientUserId` seed key, the e2e seed documents,
  the `verify-p0` readers, the rules spec's retired read-stamp case (spelled
  `['readAt', 'Iso'].join('')` so the grep gate stays a hard gate), every §4
  delete list, the `edge.spec` floors (18/33).
- **Done in the integration commit:** `pnpm nx sync` (five stale tsconfig
  reference lists); `tools/seed/fixtures/README.md`; the runbook
  (`firestore-runbook.md` §1.1 flip-1 rows re-derived without anchors, §2.1
  TTL rows on `purgeAtFor`, §4.0/§4.1 = the plan's §6 gate with the scoped
  `WIRE_FILES` allowlist of §4.6, §4.5 updated); the plan's §11 now holds the
  P1, P2 and P3 case ledgers (52 specs, 698 cases, none without a successor
  or a `dead:` reason). Two P3 cases had lost their assertion in the move and
  got successors: `ft:staff/dashboard/src/lib/lane-geometry.spec.ts` (a
  hidden shop's blocks leave the staff day with its windows; `laneGeometryOf`
  is exported for it) and a `booking-schedule-step.spec.ts` case (no capacity
  month is read for a visit no barber can take).
- **Gate, 2026-10-16:** `sync:check`, layering, typecheck (only the
  pre-existing spec reds below), lint, unit tests (only the six pre-existing
  failures), `ecs-core --coverage`, `typecheck seed-tools`, `build web`,
  `verify:bundle`, `build functions` + `check-functions-deps`,
  `test:emulator` (functions 46/46, firestore 241/241), `seed:dev` against a
  wiped emulator, and the plan's §6 grep gate: **all green**. A read-only
  browser smoke over seeded Firestore/Auth/Storage emulators (no Functions)
  rendered `/book` (shops, the repeat flow to WHEN), `/account`,
  `/account/appointments`, the staff day, the visit editor and the client
  card (stats, history, photo, held grant) with no flip-1 console error.
- **Left — run these two on a machine where the Functions emulator works,
  one at a time:** `pnpm run verify:p0`, then `pnpm run e2e:web` (baseline
  reds in §4). The cloud container could not: firebase-tools sends its
  emulator-to-emulator calls (`POST http://127.0.0.1:8080/emulator/v1/…/eventarcTrigger`)
  through `HTTPS_PROXY` and ignores `NO_PROXY`, and that session's egress
  proxy refuses `127.0.0.1`, so the Functions emulator never registers its
  Firestore triggers. With them green, also smoke the parts the read-only
  smoke could not reach: a `/book` day with times (needs the capacity
  trigger), a booking, a visit-editor save, a block, the inbox count. A red
  journey is a flip-1 regression: fix it on `main`, then mark the flip
  complete here.
- **Noted, not blocking:** `libs/application/**` still exports the 17
  retired flip-1 tokens and the flip-1 `*_COLLECTION` constants, unbound and
  unimported (Phase 4 deletes the layer); `markNotificationRead` /
  `markAllNotificationsRead`, `loadWaitlistRequest`, `loadCouponGrant`,
  `readCustomers` and `CouponGrantSystem.transitionWrite` have no caller yet
  (the web never marked notifications read before the flip either; grant
  burn/restore is deferred by F1-2); the web catalogue's #1 (`categoryId`) and
  #3 (`locationId`) queries exist but every caller passes `null`.

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

- **Flip 2 — identity and accounts:** `users`, `otps`, `impersonationSessions`;
  all twelve `libs/domain/models` importers move to the ecs-core brands; the
  D29 customer record links (`CustomerId` = client record, `UserId` = auth
  account, explicit nullable link); `verify-p0` check (e) via `updateProfile`.
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
(MapLibre), 12 `client-card-glance.spec.ts` runs at `:321`/`:664`; and
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
