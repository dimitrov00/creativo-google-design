# ECS migration — handoff and continuation guide

Read this first if you are an agent (Claude Code, Codex, Cursor, Gemini, …) or
a developer picking up the ECS / data-oriented migration. It says where the
work stands, what to do next in which order, and how to prove each step.
Last updated 2026-10-15 (end of session — usage limit).

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

| Step                                                                                  | State                                                                                                                                     | Commit(s)                                                                           |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Constitution + blueprint                                                              | done                                                                                                                                      | 81ac087                                                                             |
| Tooling (ECS lint guards, functions-deps check, Analog 2.8)                           | done                                                                                                                                      | defb4da                                                                             |
| Phase 1 — `libs/ecs-core` foundation                                                  | done                                                                                                                                      | 056ae43                                                                             |
| Phase 2 — all business math in pure systems, legacy classes shimmed                   | done                                                                                                                                      | 0416587                                                                             |
| Laws 6–7 (flat archetypes, primitives, shop-anchored time, error structs)             | done                                                                                                                                      | a6c7253                                                                             |
| Phase 3a — functions composition root, `edge.ts`, body-free adapters, test support    | done                                                                                                                                      | 291d3f9                                                                             |
| Flatten pass (Laws 6–7 applied) + owner rulings (Law 7.3 amendment, `TimeCoordinate`) | done                                                                                                                                      | 268aa0e, dbd39d4                                                                    |
| Law 8 + layering pass (`@core/*` tier barrels, no root barrel)                        | done                                                                                                                                      | 3458349, ab6d266, c0e5d73                                                           |
| **Phase 3b flip 1 — booking core**                                                    | **IN PROGRESS** — plan + P0, P1, P2, P3, P5 done; P4 nearly done (one spec half-edited); P6 partly done; integration and the gate not run | bafdbdd, then the "flip 1 continued" commit on top of 33d1233 (**build not green**) |
| Phase 3b flip 2 — identity and accounts                                               | not started                                                                                                                               |                                                                                     |
| Phase 3b flip 3 — loyalty and invitations                                             | not started                                                                                                                               |                                                                                     |
| Phase 3b flip 4 — programs                                                            | not started                                                                                                                               |                                                                                     |
| Phase 4 — web integration and legacy deletion                                         | not started                                                                                                                               |                                                                                     |

`main` is **mid-flip** (from `bafdbdd` on): the booking-core collections are partly
reshaped, so the full gate is red there until flip 1 completes. The last fully
green commit is `c0e5d73`. If a later commit on `main` says "flip 1 complete"
with a green gate, this row is stale — check `git log`.

## 3. What to do next, in order

### 3.1 Finish flip 1 (booking core) — exact remaining work

The plan `docs/architecture/flips/flip-1-booking-core.md` assigns every file
to a package P0–P6. Measured at the end of the 2026-10-15 session (an
assessor checked every package against the tree):

- **P0, P2, P3, P5 — done.** All pipelines already live in
  `libs/ecs-core/src/pipelines/` (Law 8); `apps/functions/src/pipelines/`
  does not exist.
- **P1 — done** (9 pipelines, 5 server adapters, `booking.wire.ts`,
  `main.ts` wiring, `edge.spec` floors 18/33, the P1 delete list). Left for
  the integrator: the layering verifier failed once on a duplicate
  `ArrivalAction` export — the completion renamed the pipeline's type to
  `MarkArrivalAction`; re-run `pnpm nx run verify-tools:layering` to
  confirm. Wire spellings `startIso`/`atIso`/`status` still inside
  `appointment-edit.system.ts:510-552` and `move.system.ts:546` reach the
  wire unchanged on purpose (frozen behaviour) — a later commit may rename.
- **P4 — production code done** (staff day, dashboard, visit editor, client
  card, shared visits, admin rhythm re-typed; `nx build web` passes).
  **Left:** `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.spec.ts`
  is half-edited (≈54 type errors, 10 failing tests): drop the unused imports
  near :54-90; rewrite the block/exception section near :2183-2344, the note
  fixture near :4261-4299, the legacy appointment builders near :5297-5330
  and :5860-5908 and the coupon builders near :5763-5810 onto
  `@core/testing` fixtures with `memorySchedulingReadPorts` /
  `memoryCouponVoucherPorts` — same cases.
- **P6 — partly done** (stopped mid-run; re-check its files first):
  done — `firestore.rules` (readAtUtcMs, couponGrants update denied,
  holderUserId, the customers block), `firestore.indexes.json` (index gate
  ok), `firestore.rules.integration.spec.ts`, the six
  `tools/seed/fixtures/*.fixtures.ts` (seed-tools typecheck green), the seed
  `.mjs` writers with `purgeAtFor`. **Left:** (1) rewrite the red seed specs
  against the flat bodies, same cases — `load-domain.spec.mjs`,
  `promotions.spec.mjs` (fail to load), `loyalty.spec.mjs` (39 fails),
  `seed-data.spec.mjs` (187 fails), check `settle.spec.mjs`; (2)
  `tools/seed/fixtures/README.md`; (3) rename the seed input key
  `clientUserId` (`tools/seed-dev-catalog.mjs:824`,
  `tools/seed/fixtures/appointments.fixtures.ts:326,348`), e.g. to
  `clientAccountUid`; (4) e2e — `apps/web/e2e/support/appointment-seed-document.ts`
  rewritten with `satisfies Omit<Appointment, 'id'>`, the flipped-collection
  readers in `apps/web/e2e/support/seed-firestore.ts`; (5) the
  `tools/verify/p0/verify-p0.mjs` readers of flipped fields; (6) the rules
  spec's intended `readAtIso` denial case needs a grep-gate allowlist line.
- **Integration (not run):** `pnpm nx sync` (stale tsconfig references in
  the root tsconfig, firebase-app, storage, firestore, apps/web); deletions
  by the deletion rule; the plan's §6 grep gate to zero; then the full gate
  of §4 below, emulator journeys one at a time. Then one commit + push, and
  update this file's §2 table.

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
`staff-client-card`, `admin-loyalty`, `staff-dashboard` (spec-only errors);
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
