# ECS migration — the record and handoff

**Phase 4b integrated — the ECS migration is complete.** Read this first if
you are an agent (Claude Code, Codex, Cursor, Gemini, …) or a developer
working on this codebase after the ECS / data-oriented migration. It is the
migration record: what landed in which order and how each step was proved
(§2, §3), the gate every change still passes and its baselines (§4), the
operating rules (§5), the owner's rulings and open questions (§6), and what
was carried forward as follow-up work (end of §3.3). Last updated 2026-10-26
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
of §3.3; pass C — the decisions out of components, stores, pipelines,
adapters and the edge — integrated, the FULL §4 gate green, end of §3.3;
pass D — brands, shapes, discriminators and error homes across the whole
codebase, the staff day on the wall clock — integrated, the FULL §4 gate
green, the DOM differential and the dev smoke showing only its DEPARTURES,
end of §3.3; the edge hardening, end of §3.3; pass E — the leftovers: every
carried engineering item closed and the standing red baseline green at its
root causes, the FULL gate green with no standing reds, end of §3.3; pass F
— the owner rulings of 2026-10-26, OR-1…OR-56 and DEP-F1…DEP-F39 in
`decisions/2026-10-26-owner-rulings.md`: every open question of §3.3 and §6
ruled, the rulings built in four waves and integrated, the FULL gate green
with no standing reds and `verify:csp` passing, end of §3.3).

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
   collection, the flip closures, the TTL declarations (deployed with the
   indexes since pass E), deploy order, per-flip grep gates
   the Phase 4a/4b gates (§4.7, §4.8) and the UI residue gate (§4.9).
6. `docs/architecture/flips/flip-1-booking-core.md` — the worked example of a
   flip (its adapter table predates Law 9; the note above it says so).
7. `docs/architecture/module-boundaries.md` — the `scope:*`/`type:*` tags,
   the ecs-core tiers and the import cages, rewritten from the post-4b graph.
8. `docs/architecture/flips/law-10-decision-extraction.md` — what a decision
   is and what is wording (§0 D-1/D-2/D-3), the decision inventory and the
   system that now answers each row (§1, §9.1).
9. `docs/architecture/flips/pass-d-brands-shapes.md` — the type-level laws
   as built: the brand per concept and the parse/`ofProven` policy (§0
   D-3/D-4), one name per data file (D-7), the tag rules incl. external
   contracts (D-8), the error homes (D-9), the 23 DEPARTURES and the ledger.
10. `docs/architecture/decisions/2026-10-26-owner-rulings.md` — the owner's
    rulings on every question this record and the plans left open (OR-1 …
    OR-56, each with its evidence, options, scores, consequences and bg/en
    copy), the 39 DEPARTURES they cause (DEP-F1 … DEP-F39), the deferred
    list, the per-ruling ledger of what landed (BUILT) and the
    implementation plan. A question it rules is not reopened in code
    (`CLAUDE.md` §4).

## 2. Where the work stands

| Step                                                                                                                | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Commit(s)                                                    |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Constitution + blueprint                                                                                            | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 81ac087                                                      |
| Tooling (ECS lint guards, functions-deps check, Analog 2.8)                                                         | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | defb4da                                                      |
| Phase 1 — `libs/ecs-core` foundation                                                                                | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 056ae43                                                      |
| Phase 2 — all business math in pure systems, legacy classes shimmed                                                 | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 0416587                                                      |
| Laws 6–7 (flat archetypes, primitives, shop-anchored time, error structs)                                           | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | a6c7253                                                      |
| Phase 3a — functions composition root, `edge.ts`, body-free adapters, test support                                  | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 291d3f9                                                      |
| Flatten pass (Laws 6–7 applied) + owner rulings (Law 7.3 amendment, `TimeCoordinate`)                               | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 268aa0e, dbd39d4                                             |
| Law 8 + layering pass (`@core/*` tier barrels, no root barrel)                                                      | done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 3458349, ab6d266, c0e5d73                                    |
| **Phase 3b flip 1 — booking core**                                                                                  | **done** — integrated 2026-10-16; on 2026-10-21 `verify:p0` and `e2e:web` ran green locally (baseline only) and `apps/web/e2e/booking-core.spec.ts` proves the live paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | bafdbdd, 32b870d, 4ba5d87, then the "flip 1 complete" commit |
| Law 9 + port-composition pass (bottom-up bundles, `creativo/no-sliced-ports`)                                       | done — 2026-10-21, full gate green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | the "Law 9" commit                                           |
| **Phase 3b flip 2 — identity and accounts**                                                                         | **done** — integrated 2026-10-21; the full gate of §4 green (baseline reds only), `verify:p0` (e) both ways, the flip-2 grep gate PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | the "flip 2 commit"                                          |
| **Phase 3b flip 3 — loyalty and invitations**                                                                       | **done** — integrated 2026-10-22; the full gate of §4 green (baseline reds only), the §6 grep gate PASS, the §8 dev smoke run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | the "flip 3 commit"                                          |
| **Phase 3b flip 4 — programs**                                                                                      | **done** — integrated 2026-10-22; the full gate of §4 green (baseline reds only), the §6 and end-of-3b grep gates PASS, the §8 dev smoke run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | the "flip 4 commit"                                          |
| **Phase 4a — re-point every legacy consumer, the wire flip, the rules tightenings**                                 | **done** — integrated 2026-10-22; the full gate of §4 green (baseline reds only), runbook §4.2–§4.5 + §4.7 PASS, the §8 dev smoke 57 checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | the "Phase 4a" commit                                        |
| **Phase 4b — delete the legacy libraries, `luxon`, `dinero.js`, the dotted keys; widen the lint; the docs rewrite** | **done** — integrated 2026-10-23; the static gate of §4 green (baseline reds only), the FULL gate of §4 green (baseline reds only), runbook §4.2–§4.5, §4.7 and §4.8 PASS, the §8 dev smoke 35 checks; R4 applied the same day on the owner's go-ahead                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | the "Phase 4b" commit                                        |
| **UI residue cleanup — the visit shim, the `kind`/`status` unions, the stray classes, the ambient clock**           | **done** — integrated 2026-10-23; the FULL gate of §4 green (baseline reds only), runbook §4.2–§4.5, §4.7, §4.8 and §4.9 PASS, three new lint rules canary-proven under both ESLint base paths, the dev smoke 58 DOM signatures identical to `c77e932`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | the "UI residue cleanup" commit                              |
| **Law 8 amendment — the `@core/errors` tier and the Error file kind (`*.error.ts`)**                                | **done** — 2026-10-23 (owner ruling): 19 error files moved to `errors/<domain>.error.ts`, 401 importers re-pointed, the verifier, tier lint, `*.error.ts` suffix block and `creativo/error-dictionary-home` canary-proven; the FULL gate of §4 green (baseline reds only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | the "@core/errors tier" commit                               |
| **Law 10 — presenters word what systems decided (`*.presenter.ts`, `*.vm.ts`)**                                     | **ruled + enforced** — 2026-10-23 (owner, option B of the view-model pass): the law, `creativo/presenter-purity` canary-proven, `presenters.md`; the outlier files renamed into the kinds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | the "Law 10" commit                                          |
| **Law 10.2 — the decision-extraction pass (presenters word, systems decide)**                                       | **done** — integrated 2026-10-23 (`flips/law-10-decision-extraction.md` §9): every MOVE/DUP row answered by an ecs-core system with a purity + boundary spec (2 new systems — `LoyaltyPassSystem`, `WalletSystem` — and 23 extended, 4 component companions, 23 new tag dictionaries plus `BirthdayMoment` moved down from the vm; 428 new ecs-core cases), every presenter spec unchanged; the FULL gate of §4 green (baseline reds only — `verify:p0`, `test:emulator` 65 + 255, `e2e:web` 41 + the 19), runbook §4.2–§4.5, §4.7–§4.9 PASS, the §5 review checklist clean, a DOM differential of 2,611 specs and the §6.3 dev-stack smoke (90 signatures) identical to `fd5f2a6` but the agenda's relative minutes                                                                                                                                                                                                                                                                                                                                               | the "decision-extraction" commit                             |
| **Pass A — the audit's defects**                                                                                    | **done — FULL gate green (baseline reds only), runbook §4.2–§4.9 PASS** — 2026-10-24: the four defects of the read-only audit fixed (end of §3.3): the client photo strip's post-`limit` origin filter (index #22 gains `photoOrigin`), the client profile's age-window words missing their figure, the edit and reschedule pipelines' DST-gap fallback to a stale instant, and three staff-day defects (a cancel's words on the call, `periodLabel` on an empty day list, another chair's terms quoted)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | the "Pass A" commit                                          |
| **Pass B — dead code, old-style leftovers, stale docs**                                                             | **done — FULL gate green (baseline reds only), runbook §4.2–§4.9 PASS** — 2026-10-24: eight packages, one integrator and the review's fixer (end of §3.3): three dead Nx projects (`ui`, `cursor`, `design-tokens`) and `generated/**`, the four staff-dashboard shims, ~135 callerless ecs-core members (50 system members, ~45 component, entity and error members, four unused port families — six port types — with their tokens and adapters, 23 producer-less error codes, the `Retired*` registry) and three composite indexes, ~40 dead feature exports, the seed's symbolic mappers and private zone engines, ten unused packages; `translateCodedError`, `CatalogWording`; the docs re-derived                                                                                                                                                                                                                                                                                                                                                           | the "Pass B" commit                                          |
| **Pass C — components, stores, pipelines, adapters and the edge decide nothing**                                    | **done — FULL gate green (baseline reds only), runbook §4.2–§4.9 PASS** — 2026-10-24 (`flips/pass-c-ui-decisions.md` §9): ten wave-0 ecs-core packages, eight wave-1 re-point packages, the integrator's two rounds and the review's fixer (twelve findings, DEP-2 amended to one rule — §9.7); 3 new systems (`CatalogSystem`, `MediaSystem`, `RetentionSystem`) and ~40 extended, 8 new browser/server pipelines, fifteen tag dictionaries new or moved down out of features and the pipelines tier, ~685 new ecs-core cases; every KEEP-FOR-C system wired or re-ruled KEEP-PARKED; 15 DEPARTURES (DEP-1…DEP-15); `verify:p0`, `test:emulator` 65 + 253, `e2e:web` 41 + the 19; the DOM differential (59 spec files, 1,197 captured tests) and the §6.4 dev-stack smoke against `2bd2354` show only DEP differences (end of §3.3)                                                                                                                                                                                                                               | the "Pass C" commit                                          |
| **Pass D — brands, shapes, discriminators, error homes**                                                            | **done — FULL gate green (baseline reds only), runbook §4.2–§4.9 PASS** — 2026-10-25 (`flips/pass-d-brands-shapes.md` §9): seven wave-0 ecs-core packages, nine wave-1, three wave-2 and two wave-3 packages, the integrator's two rounds, the review's six fixes and a second review's eight (type level, the FULL gate re-run green after each); Law 7.4 brands across every type boundary (new `TrackMinute`, `MinuteOfDay.parseClock`, `DraftPersonKey`, `Tag`, `formatClock`), Law 7.3 for the staff day (OQ-14, one zone engine), Law 1 shapes (~180 new component files, one name per `*.data.ts`), Law 1/6.2 tags (~110 UI unions, the icon manifest's `iconAsset`), Law 7.5 error homes; 23 DEPARTURES (DEP-1…DEP-23); `verify:p0`, `test:emulator` 65 + 253, `e2e:web` 41 + the 19; the DOM differential (94 spec files, 1,470 captured tests) and the §6.4 dev-stack smoke against `cf91b43` show only DEP differences (end of §3.3)                                                                                                                    | the "Pass D" commit                                          |
| **Edge hardening — read-time guards, trigger retry, the transactional team note**                                   | **done — FULL gate green (baseline reds only), runbook §4.2–§4.9 PASS** — 2026-10-25 (`flips/edge-hardening.md` §8): three packages (GUARD, RETRY, NOTE) and the integrator; `StoredDocumentSystem` guards every read of `appointments`, `customers` and `barberBusy` (web adapters, functions transactions, singles, the backfill walk, both trigger sides — a single/transactional read refuses `REPOSITORY_MALFORMED` with path + field, a list drops and reports, refusing only when the WHOLE answer keeps none — the search's halves together, the history on its first page); the three projection triggers deploy `retry: true` through `retryingTrigger` (transient rejects, decisive logged and swallowed, reruns idempotent); `appendTeamNote` is ONE web transaction (`updateAppointmentNote`) — an unreachable server refuses after ~7 s, never overwrites; 15 DEPARTURES (DEP-1…DEP-15); `verify:p0`, `test:emulator` 65 + 253, `e2e:web` 41 + the 19; the review's six findings fixed and the gate re-run green (plan §8.6) (end of §3.3)           | the "edge hardening" commit                                  |
| **Pass E — the leftovers**                                                                                          | **done — FULL gate green, no standing reds, runbook §4.2–§4.9 PASS** — 2026-10-25 (`flips/pass-e-leftovers.md` §8): twelve wave-0 packages, E2E and the integrator (end of §3.3); every carried ENGINEERING item closed — the four other capacity triggers retry, `appointmentNotes` guarded at read, TTL and the `purgeAt` exemptions declared in `firestore.indexes.json`, the waitlist cart branded inside its door, the spec-only survivors, the avatar union, `BirthDate.toLocalDate`, `UiDayKey`, the alias specs, cached number formatters, `familyOfMedal` by a typed id, the reopen's busy merge, the programs rules shape-checked and the unused client write grants denied, the programs status words in the catalogues, words for 19 UI-reachable codes, a programs e2e journey — and the standing red baseline fixed at each root cause (typecheck `patterns`, the 6 unit reds, the 19 e2e reds); 9 DEPARTURES (DEP-1…DEP-9); `verify:p0`, `test:emulator` 65 + 301, `e2e:web` 61 passed, 0 failures (41 + the 19 former reds + the programs journey) | the "Pass E" commit                                          |
| **Owner rulings (2026-10-26) — pass F, OR-1…OR-56, built in four waves**                                            | **done — FULL gate green, no standing reds, runbook §4.2–§4.10 PASS, `verify:csp` PASS** — 2026-10-26 (`decisions/2026-10-26-owner-rulings.md`, marked BUILT with a per-ruling ledger; end of §3.3): the owner delegated every open decision; 56 rulings close every owner question of §3.3, §6 and the plans' open-question sections; 39 DEPARTURES (DEP-F1…DEP-F38, DEP-F10b — a no-show gives back the grant and the voucher draw, the orchestrator's override of OR-13 — and DEP-F39, the integrator's month-only upcoming tile); the live gaps built at once — coupon grants burned at save (OR-13), the walk-in client record (OR-26), the notification inbox (OR-19), the hash CSP and security headers with `verify:csp` (OR-29–OR-31), the fail-closed production preflight as predeploy (OR-35), the client issue sink (OR-34), the required read guard (OR-33); four waves of disjoint packages and one integrator round; the six baselines the rulings change regenerated after review (OR-51 voice, OR-56 tile and rail)                              | the per-package "Pass F" commits                             |

`main` carries the flip-1 to flip-4 reshapes, the Law 9 port pass, Phase 4a
and Phase 4b, and the FULL gate of §4 is green on it with no standing reds
since pass E (end of §3.3; every commit before pass E passed it with the
then-standing baseline reds only). All
four phases of the blueprint are complete: no `libs/application/*` or
`libs/domain/*` project, alias, tag or path survives outside the historical
docs, `package.json` lists no `luxon`, `@types/luxon` or `dinero.js`, and
both catalogues hold only SCREAMING `errors.<errorCode>` keys. The
blueprint's end-of-3b graph/bundle assertion is code since 4b: runbook §4.8
gate 8 (no legacy project in the graph, hence no functions → legacy edge) and
the forbidden-key check of `tools/verify/p0/functions-deps.mjs` (no
`@angular/*`, `luxon` or `dinero.js` in the functions dist — `rxjs`
stays, 4A-2 (d), 4a §10.1). The last commit whose gate also ran the
dev-stack smoke is the "decision-extraction" commit, `fe4635a` — the FULL
gate on its integrated tree (with the then-standing baseline reds), the
emulator journeys and the dev-stack smoke included (§2 row, end of §3.3;
before it, the "UI residue cleanup" commit, `474e771`, and the "Phase 4b"
commit, `f9cef52`); check `git log` for anything newer — pass A
(`99a60fa`), pass B (the "Pass B" commit), pass C (the "Pass C" commit),
pass D (the "Pass D" commit), the edge hardening (the "edge hardening"
commit) and pass E (the "Pass E" commit — the first with no standing reds)
each passed the FULL gate too,
the runbook grep gates, `verify:p0`, `test:emulator` and `e2e:web` included
(§2 rows, end of §3.3). (On 2026-10-23 the full §4 gate — `verify:p0`,
`test:emulator` and `e2e:web` included — every grep gate and the dev smoke
were green on the 4b tree and again on the cleanup tree, §3.3 "Gate" and the
UI residue plan's §8.1.) **The migration is COMPLETE**, and the phase-4b plan
§4.R R4 constitution and rules edits are applied (§6, OQ-7/OQ-11). The first
follow-up pass, the UI residue cleanup, closed four carried items (end of
§3.3); everything else is follow-up work, not migration (the carried-forward
list at the end of §3.3). Since pass F (2026-10-26) no carried owner item is
waiting on a ruling: `decisions/2026-10-26-owner-rulings.md` rules every one
(each carried list below names its OR id), and §6 keeps only the rulings'
standing contracts, the reversible defaults the record flags, and the three
pass E findings it does not rule.

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
burn/restore deferred, F1-2 — RULED 2026-10-26: the grant is burned at save
and given back on removal, cancel or no-show through `transitionWrite`,
OR-13 / DEP-F10; `loadCouponGrant` reshaped to `loadCouponGrants`, OR-13;
the receipt wired as `markNotificationsRead`, OR-19; `readCustomers` read by
the walk-in record, OR-26; `loadWaitlistRequest` deleted, OR-28); a notification produced by the waitlist
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
  (`loc-center` in the seed; the production id was flatten-spec OQ-2's —
  RULED 2026-10-26: `loc-center` stays the production default, OR-35, and
  the preflight's P1 checks it before every deploy) must exist in the target project with a valid IANA
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
  §10 — the rules, the e2e journey and the words in the catalogues landed
  with pass E; the picker is OR-37, the translated words OR-53); pre-existing and outside the flip, seen in the smoke: an
  intermittent dev-mode Angular assertion in the shared
  `SiteFooterComponent` on `/careers`, `/courses`, `/events` (the footer's
  locale toggle constructs `LanguageService`, whose constructor re-renders
  the footer's `*transloco` view inside its first create pass) and a stored
  `ui-lang = 'en'` not restored on a fresh load; the plan's §10 open
  questions stood on their defaults until all eleven closed (Q7, the e2e
  journey, with pass E; the other ten by the owner rulings of 2026-10-26 —
  OR-35, OR-37–OR-42, OR-53; flip-4 §10).

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
carried (its OQ-3 — the service sheet's performer sort and bundle saving,
the catalogue's anonymous offering —, its OQ-6 — the history page's
read-policy constants — and the two word sources of the rhythm's closed
track marks are CLOSED by pass C, end of §3.3): the keys built from display words (the reward ticket's group key, the
glance's held rewards by NAME — a coupon id / `RewardId` on the card
contracts, OQ-4 — CLOSED, OR-15 / DEP-F11: keyed by coupon id), whether the glance's voucher sum should refuse mixed
currencies like the wallet's total (OQ-5 — CLOSED, OR-17 / DEP-F12: the
glance prints every currency), whether the
wallet's `localeCompare` and the glance's input-order ties should follow the
visit list's code-unit / id tie-breaks (OQ-7 — CLOSED, OR-18 / DEP-F13:
UTF-16 code units everywhere), `CouponGrantSystem`'s `Partial<{ couponOccasion }>`
constraint (tighten it once the owner makes `ClientCardGrant.couponOccasion`
required — CLOSED, OR-16: required `CouponOccasion | null`); the
Law 7.4 branding/T1 pass (UR-13 c) and the icon manifest's `kind` wire
field (UR-13 a, OQ-5) are CLOSED by pass D (end of §3.3: brands across
every type boundary, the staff day on the wall clock, the manifest's
`iconAsset` at schema 2, the allowlist entry gone);
the flip-1 ports parked with no caller
(`markNotificationRead`, `loadWaitlistRequest`, `loadCouponGrant`,
`readCustomers`) and `CouponGrantSystem`'s whole grant verb set — `burn`,
`restore`, `expire`, `revoke` (their `*Slice` halves module-private since
pass B), `termsOf`, `isActive` and `transitionWrite` — waiting for grant
burn/restore, `NotificationSystem.markRead` / `readBeforeSent` / `isUnread`
beside the parked `markNotificationRead`, `VoucherSystem.issue` waiting for
voucher issuing (CLOSED 2026-10-26 by the owner rulings' triage, OR-28 /
DEP-F22: the grant is burned at save and given back on removal, cancel or
no-show — `settleBill`, `releasePlan`, `BillingSystem.releasesHoldings`,
OR-13 / DEP-F10 / DEP-F10b — and `expire`, `revoke`, `termsOf` and
`isActive` deleted;
`loadCouponGrant` reshaped to `loadCouponGrants`, OR-13; the read receipt
wired as `markNotificationsRead` over `NotificationSystem.unreadIds` /
`receiptAt`, `markRead` and `readBeforeSent` deleted, OR-19 / DEP-F14;
`readCustomers` read by the walk-in record, OR-26; `loadWaitlistRequest`
deleted, OR-28; `VoucherSystem.issue` and `redeem` deleted — issuing returns
with points redemption or payments, OR-14), and flip 1's other deferred behaviours (the reopen busy
write is CLOSED by pass E, DEP-5; trigger `retry: true` is CLOSED for the
three projection triggers by the edge hardening and for the four other
capacity triggers by pass E, DEP-1 — end of §3.3; the `leadTimeSampling`
gate is CLOSED, OR-27 / DEP-F21: the sampler stays ungated; the refusal's
busy body is CLOSED, OR-12: declined); the owner's confirmation
of the 4a plan's §11.4 (a) time-sheet re-pin (CLOSED, OR-7: confirmed); a location picker (flip 4 —
the programs rules tightenings, the programs status words moved into the
catalogues and a programs e2e journey are CLOSED by pass E, E-15 / E-17 /
`programs.spec.ts`; the picker is CLOSED, OR-37 / DEP-F27; translating the
words is CLOSED, OR-53 / DEP-F37, flip-4 §10 Q2); from the UI
residue cleanup (plan §8.1 "Left as found"): the lower-case unions
compared as bare literals are CLOSED by pass D (every one an `as const`
dictionary compared through its members, contract spellings kept where a
URL, a CSS hook, a test id or a DS input fixes them; the `Locale` checks
through `Tag`). (The `StaffDashboard.periodLabel` throw the
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
the onboarding birthday SAVE path's bare code (CLOSED by pass D,
DEP-17: the struct rides `OnboardingFlowEvent.birthdayFailed`); `appendTeamNote` reading the note once,
so that offline with the note document never cached it could write over the
server's copy (CLOSED by the edge hardening, end of §3.3: one transaction,
an unreachable server refuses; the editor's guard keeps its own limit); the client time sheet
cannot see where a carried companion lands, so such a reschedule is now
refused by the server instead of written wrong (CLOSED 2026-10-26, OR-7 /
DEP-F6: `MoveSystem.partyStarts` and the sheet frames every seat's start,
so it offers only times the server accepts); an end-to-end
`word-pipeline-error.spec.ts` case for the DST chain (CLOSED by pass E: one
case through `PipelineError` and the real catalogues); and `ecs-migration.md` / `flips/flip-1-booking-core.md` still
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

- **For pass C (KEEP-FOR-C) — RESOLVED by pass C (end of §3.3):** every
  system pass B found re-implemented elsewhere is WIRED
  (`BookingTotalSystem.total` / `seatSubtotals`, `AppointmentEditSystem.fold`,
  `OfferingPriceSystem.performerIds` / `isPerformedBy`,
  `DiscountSystem.samePromise`, `TriggerAttemptSystem.decisiveFailure`,
  `VoucherSystem.coverage`) but the seven `AppointmentLifecycleSystem` write
  verbs, `VoucherSystem.redeem` and `IntervalSetSystem.clip`, which pass C
  re-ruled KEEP-PARKED (not copies — `flips/pass-c-ui-decisions.md` §0 D-3)
  — all three DELETED by the owner rulings (2026-10-26): the write verbs,
  their specs re-targeted to `transition` (OR-20 / DEP-F15), `redeem` beside
  `issue` (OR-14), `clip` folded into `intersect` (OR-21 / DEP-F16).
- **Parked on purpose (KEEP-PARKED) — TRIAGED 2026-10-26 (OR-28 / DEP-F22,
  item by item below):** the flip-1 ports and grant verbs above
  (`markNotificationRead`, `loadWaitlistRequest`, `loadCouponGrant`,
  `readCustomers`, `CouponGrantSystem`'s verb set), `NotificationSystem`'s
  read stamp and `VoucherSystem.issue` (wired or deleted — the carried-forward
  list above: OR-13, OR-14, OR-19, OR-26, OR-28); the catalogue edge-guard family
  (`DayHours.parseWeek` / `DayHoursInput`, `ServiceComposition.parse`,
  `openDay`, the `CATALOG_LOCATION_INVALID_HOURS_*` / `_TIME_OF_DAY` codes and
  the reserved `CatalogErrorCode.LocationInvalidTimezone` — delete the family
  or wire it to an admin location writer, the owner's call — RULED, OR-22 /
  DEP-F17: `parseWeek` is live, the landing's, and closes with `EndMinute.of`,
  so a 24:00 close is accepted; `ServiceComposition.parse` and the two dead
  codes deleted; no admin location writer);
  `BookingFlowEventKind.SetDayWindows` with `FlexibleWhen.withWindows`
  (never dispatched — the per-day window sheet, or delete both — RULED,
  OR-23: the write verbs and the `DayWindows` writers deleted, the stored
  `windows` field and its readers kept);
  `EngagementErrorCode.BadgeCategoryOrderNegative` (no producer since before
  pass B — DELETED, OR-28); the type-level variants `CancellationAttribution.Shop` and
  `StreakTrackMarkKind.Kept` / `Repaired` / `Missed`; the matchMedia and
  ResizeObserver test polyfills (live consumers) — the last three KEPT, no
  action (OR-28).
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
  §5.5) — RULED 2026-10-26: the client grant is closed,
  `allow create, update: if false` (OR-25 / DEP-F19, a security fix), and «Нов клиент»
  creates a server-written walk-in record `customers/{CustomerId.forWalkIn(…)}`
  with a `WALK_IN` seat occupant (OR-26 / DEP-F20). (c) The client write grants for the catalogue
  (`isCatalogManager`), `barberSchedules` / `scheduleExceptions`
  (`mayEditRoster`) and `settings` (`isAdmin`) — CLOSED by pass E (E-16,
  DEP-6): the catalogue, `barberSchedules` and `settings` deny every client
  write; `scheduleExceptions` keeps its grant (a live writer). (d) The TTL
  declarations — CLOSED by pass E (E-3, DEP-3): the seven policies and the
  `purgeAt` exemptions are declared in `firestore.indexes.json`. (e)
  `apps/web/src/app/shell/impersonation-banner.ts` is an empty slot whose
  read port pass B deleted — keep the slot or drop it (RULED, OR-24 /
  DEP-F18: the banner and the `admin/impersonation` lib are deleted, `/admin`
  redirects to `/admin/loyalty/rhythm`, the server ledger stays, and the
  contract any future read-as must meet is in §6). (f) The deploy order
  of the deleted composites (above) and the waitlist id reseed (RULED,
  OR-36: moot for a first deploy — no hosted project ever existed; the
  general rule is in runbook §3, step 6 and "Stored-id changes").
- **Smaller follow-ups:** the stylelint override for `libs/ui/**` and
  `libs/features/**` (~73 literal metrics to move onto tokens, then drop it);
  `swipe-to-delete.directive.ts`'s four `@HostListener`s and the showcase's
  `phone-field.page.css` `::ng-deep` (both CLOSED by pass E: host metadata;
  the demo shell's own canvas attribute); the showcase Playwright snapshots (the
  fallback focus ring and the view-transition timing changed; a refresh is
  unlikely to be needed); the e2e support's own shop zone and clock, the staff dashboard's
  raw `priceCents` and `client-query.ts` `toRankable` (CLOSED by pass
  D: `apps/web/e2e/support/shop-clock.ts`, `PriceCents` on the legs, the
  client option's required `email`); the visit-row presenter spec's legacy
  whole-visit `{ kind }` fixture words (CLOSED by pass E: the fixture takes
  `bookingStatus`); and the CSP `headers` block of
  `firebase.json` (`csp-baseline.md` — CLOSED 2026-10-26: a static hash CSP
  and the full security header set on Hosting, enforced at launch with
  Trusted Types report-only, proven by `verify:csp` — OR-29 / DEP-F23,
  OR-30, OR-31; `csp-baseline.md` rewritten). The stylelint override and the
  showcase snapshots stay as they are (OR-28).

**Pass C — components, stores, pipelines, adapters and the edge decide
nothing (2026-10-24, integrated, the FULL gate green).** What
the Law 10.2 pass did for presenters, pass C did for every other place a
decision could hide: Angular components and templates, stores, browser use
cases, `@core/pipelines` bodies, adapters and the functions edge. The plan,
its decision inventory (§1, ~200 rows), the contracts, the 15 DEPARTURES
and the ledger are `docs/architecture/flips/pass-c-ui-decisions.md`. Wave 0
(ten packages, ecs-core only) extended ~40 systems and companions and added
`CatalogSystem`, `MediaSystem`, `RetentionSystem`, eight pipelines
(`schedule-blocks`, `attach-visit-photo` with `adoptVisitPhoto`,
`append-team-note`, `load-held-grants`, `rhythm-publish`, `rhythm-preview`,
`shop-day`, `save-own-profile`) and the tag dictionaries lifted out of
features and the pipelines tier (`ArrivalVerb`/`MarkArrivalAction`,
`PlacementVerdict`, `ShopCoverage`, `SeatArrangement`, `ClientMove`,
`ShopOpening`, `StreakPublishConsent`, `RetentionGroup`, `MediaRefusal`);
the zero-inbound-mapping signatures (`paddedBusy`, `BookingDecisionSystem`,
`CapacitySystem`, `AvatarSystem.check`, `MoveSystem`, the edit guard) now
read the stored slices. Wave 1 (eight packages) re-pointed the callers and
deleted the copies (`day-availability.ts` and `rhythm-service-groups.ts`
whole). Wave 2 (the integrator, two rounds) deleted the transitional names
(`UTC_ZONE`, the `repositoryFailure`/`decisiveAttemptFailure` delegates,
the `discountValueOf` re-export), the dead
`AppointmentEditSystem.accountSubjects`, the catalogue presenter's unread
per-variant map and — once the service sheet asked
`CatalogPricingSystem.performersByPrice` / `bundleSaving` on the stored
`Service` (C-4's sheet half, C-6) — its anonymous offering; fixed the one
regression the DOM differential found (E-13: the editor frame's neighbours
measured on the frame's clock day, as before); ruled one seam
(`AttachVisitPhotoCommand`'s sizes typed `number | null`, as the record
always stored) and one departure (DEP-15, below); moved the five
pipeline-tier outcome dictionaries (`PolicySweepOutcome`,
`PolicyStepOutcome`, `PolicyStartOutcome`, `ClientStatsOutcome`,
`CapacityTrigger`) to components; gave the wire a currency-free amount
guard (`CouponValue.positiveAmount`, which `fixedAmount` composes) in place
of a placeholder currency; homed the visit sheet's money code once
(`visit-editor-discount.ts` `MONEY_CODE`); completed the `saveOwnProfile`
spec move; resolved every package note (fixed, recorded in the ledger, or
carried, plan §9.6); and ran the §5 checklist to zero (items 2–4 reviewed:
67 / 21 / 24 hits, all wording, geometry, host lookups or D-3 rows) and the
FULL gate (§4 numbers below): typecheck (`patterns` only), lint 43
projects, **11,883 tests + exactly the 6 baseline reds**, layering, ecs-core
289 files 5,628 tests **98.21 %** statements, `build web` initial 599.95 kB
(+2.02 kB on pass B) + `verify:bundle`, `build functions` + the deps check,
the runbook grep gates (§4.2 28 `ok`, §4.3 22, §4.4 17, §4.5 6, §4.7 24,
§4.8 27, §4.9 25, 0 FAIL), `verify:p0` (a)–(f), `test:emulator` 65 + 253,
`e2e:web` 41 passed + exactly the 19 baseline failures. **Behaviour** changed only where two live rules disagreed —
DEP-1 who cancelled (the reason's side, as the card and the statistics
read it), DEP-2 what occupies a chair (every other visit whose ROOT is live,
the server's rule — `BusySystem.chairOccupants` on all five frame sources
since the review round), DEP-3 the save receipt's undo (the root's status), DEP-4 "off all
day" (roster empty), DEP-5 a recent visit's account (the booker), DEP-7 an
upload of exactly the limit (refused, as `storage.rules`), DEP-8 the
onboarding card's figures, DEP-9 the services step's "anyone" quote, DEP-10
the bundle saving in integer cents, DEP-13 a trigger's event time
(telemetry), DEP-15 where a roster window closing at midnight ends (1440 on
the sheets' frames, as the grid column already shades it — it read 0, an
inverted shift); DEP-6, -11, -12 and -14 are pinned no-ops. **The DOM
differential** on the closed tree (14 projects, 59 spec files, 1,197
captured tests against a `git archive` of `2bd2354`) shows 3 changed tests
— DEP-1's head and DEP-9's CTA twice — and 10 DEP-only new tests; the E-13
regression the first round's run found is gone. **The dev-stack smoke**
(§6.4; `pnpm run dev` and the `2bd2354` copy on the same emulators and
seed, 64 screens × bg/en): 94 signatures byte-identical, 22 differ only by
the clock between the runs, 12 by DEP-2 (the visit sheets no longer draw a
COMPLETED or NO_SHOW neighbour); the service sheet's performers and the
Full-care saving read identically (plan §9.5).

**After pass C's review round (2026-10-24, the fixer; plan §9.7).** The
review confirmed twelve findings and the fixer applied them all: the
offered-shop roster homed once (`RosterSystem.offeredWindows` /
`offeredCarveOuts` — the booking grid's `barberDays`, the waitlist match
and the staff lane); `VisitListSystem.soonestFirstByStart` (the account
page no longer forges a list row); `VisitDraftSystem.floorSpan` /
`typedSpan` (the one-grain floor, four call sites) with the grain taking a
`MinuteOfDay` and the block sheet's typed pair a `TrackSpan` (§7 R-6's
documented track-minute exception); `StreakPublishSystem.waits` (the
publish receipt); the wire's `CallStateWord` reading `ArrivalVerb`;
`exitVerbs` deriving the rebook from the chair's status;
`ClientQuerySystem.bookAccounts` ordering the book itself;
`AvailabilitySystem.dayBookable` taking a `MinuteCount`;
`GridLayoutSystem.frameVerdict` answering the visit sheet's line over
`PlacementVerdict` (the feature's `FrameVerdict` deleted; the DOM's
`data-verdict` unchanged); and `BusySystem.chairOccupants`, which makes
DEP-2 one rule — the anchor day and the create and block frames read the
ROOT's status like the stepped day and the server (a split party's chair
whose own seats are settled inside a live root is now drawn there; the
split-party dashboard case flipped on purpose). +34 cases; the FULL gate
green against the baselines (§4 numbers below); the §6.3 differential and
§6.4 smoke were not re-run (DEP-2's amendment is the only DOM-visible
change).

**After pass C's second review round (2026-10-24, the fixer; plan §9.8).**
Three findings, all behaviour-identical: the transition callable's target
check reads the lifecycle graph (`BookingLifecycle.isTransitionTarget`, the
deduplicated destinations of `TRANSITIONS` — the wire's hand-listed
`STAFF_TRANSITIONS` deleted, a PENDING request still
`BOOKING_TRANSITION_INVALID_INPUT`); no component consumes a pipeline any
more (Law 8.2) — the booking flow's day and capacity streams go through
`BookingDayStore` (provided by `ClientBooking`, the same structural
re-subscribe guards) and the contact sheet's «save to profile» through
`BookingContactStore`; `saveOwnProfile` is a Law 4 closure
(`saveOwnProfile(ports)(edits)`) and `account-state`'s re-export of it is
gone (its callers are stores importing `@core/pipelines`). +5 cases; the
FULL gate green against the baselines (§4 numbers below); nothing
DOM-visible, so the §6.3 differential and §6.4 smoke were not re-run.

**Carried from pass C — for pass D and the owner** (none blocks anything;
the plan's §9.6 has each with its reason; every pass-D item below is
CLOSED by pass D — end of §3.3 — and every owner call is RULED by the owner
rulings of 2026-10-26):
the KEEP-PARKED lifecycle write verbs (`AppointmentLifecycleSystem.confirm`
… `markSeatOutcome`), `VoucherSystem.redeem` and `IntervalSetSystem.clip`
— owner call to delete (CLOSED: deleted — OR-20 / DEP-F15, OR-14, OR-21 /
DEP-F16); the system-file dictionary family (`CancelledSide`,
`VisitRowOutcome`, `VisitTone`, …) → components; the team note's record
built twice (CLOSED: pass D's one builder `noteRecord`, which the edge
hardening's transactional append decides through too — end of §3.3); a dedicated duplicate-voucher-code error
(`VoucherCode.distinct` answers `ENGAGEMENT_VOUCHER_CODE_INVALID`); the two
spellings of the booking flow's terminal rule (`BookingFlowState.isTerminal`
/ `BookingFlowSystem.isTerminal`); the editor's `ShopNow` built inside a
`computed()` (the VM should carry the store's); two feature specs that
exercise moved ecs-core names through aliases (`day-availability.spec.ts`,
`rhythm-service-groups.spec.ts` — CLOSED by pass E, E-10: deleted, every
case mapped to its ecs-core successor); the dashboard's instant-based visit-vs-now answers and
durations (OQ-14 — the wall-clock `hasStarted`/`hasEnded` pair is their
lawful home, a DST-hour behaviour change); pass D's list (D-11: the
dashboard's `commandsFor` write plan and save/undo use case, the editor's
draft-id rules and VM reshapes, prices from labels, the client option's
optional `email?`, `actorRoles`); `actFromSheet`'s dismissal set
(= `BookingLifecycle.didNotHappen` — CLOSED by pass D's `StaffVerb.didNotHappen`,
verified by pass E); the plan's §8 open questions OQ-1…OQ-14
with their defaults as applied (OQ-3 `staffWalkIn` vs D18, OQ-4 the
account's next visit, OQ-5 the OTP cooldown among them — CLOSED, every one:
OQ-1, OQ-2, OQ-7, OQ-8, OQ-10, OQ-12 and OQ-14 affirmed or closed by pass D
(OR-43), OQ-3 `staffWalkIn` deleted (OR-11 / DEP-F9), OQ-4 upcoming judged
on each visit's own shop clock (OR-8 / DEP-F7), OQ-5 the server's 60 s
window with a countdown (OR-9 / DEP-F8), OQ-6 the lowest free guest number
(OR-6 / DEP-F5), OQ-9 the verdict reads the drawn day (OR-3 / DEP-F3),
OQ-11 reserved ids refused by the id primitive (OR-44 / DEP-F31), OQ-13
`OtpLimits.EscalateAfterSends` (OR-10); pass C §8).

**Pass D — brands, shapes, discriminators, error homes (2026-10-25,
integrated, the FULL gate green).** The last pass of the post-migration
cleanup finishes the type-level laws across the WHOLE codebase. The plan,
its inventory (§1), the contracts (§2), the 23 DEPARTURES and the ledger
are `docs/architecture/flips/pass-d-brands-shapes.md`. Seven wave-0
ecs-core packages, nine wave-1 packages, three wave-2 and two wave-3
packages, then the integrator (two rounds). What changed:

- **Law 7.4 brands** — no raw `string`/`number` for an id, an instant, a
  shop day, a minute or money where a value crosses a type boundary: view
  models, contracts, stores, presenters, components, adapters, the edge.
  New primitive members (each with JSDoc, spec and purity case):
  `TrackMinute` (a brand, OQ-1: the frames' `[0, 1440]` minute;
  `of`/`ofProven`/`plus`/`span`/`toStart`/`toEnd`), `MinuteOfDay.parseClock`
  (ONE strict clock parser, DEP-22), `DraftPersonKey`, `UtcEpochMs.EPOCH`,
  `MinuteDelta.fromDuration`, `MinuteCount.fromDelta`, `Tag`
  (`values`/`has`/`or`); `formatClock(t, ClockClosing)` in
  `@creativo/ui/wall-clock` replaces seven hand clock faces. Foreign input
  becomes a brand ONCE at its edge (`X.parse` → `Result`: the route edges
  `?day=`/`?barber=`/`?visit=`/`?waitlist=`/`?repeat=`/`?reschedule=`, typed
  clock text, opaque UI keys minted from a brand); every `ofProven` sits
  beside a comment naming its range; no `as Brand` cast outside a
  primitive's own file; the shared formatters (`formatWallClock`,
  `formatMinute`, `formatInstant`, `formatCents`, `ui-month-picker`,
  `ui-weekday-picker`) take brands. W3-G's guard
  (`uiRawPrimitiveBlock`, `tools/lint-rules/ecs-syntax.mjs`) keeps a raw
  id/instant/money/day/minute member out of every feature and UI type.
- **Law 7.3 (OQ-14)** — the staff day and agenda answer visit-vs-now,
  durations and buckets on the wall clock (`LocalDate` + `MinuteOfDay` with
  the store's `ShopNow`, `VisitStorySystem.hasStarted`/`hasEnded`);
  `zoned-time.system.ts` is the ONLY zone engine (the store's `DAY_FRAMES`
  cache, the spring-forward walk and the feature-local clock parsers are
  gone); the e2e support reads ONE shop clock (`apps/web/e2e/support/shop-clock.ts`).
- **Law 1 shapes** — every `*.data.ts` exports one component plus the
  dictionaries of its own fields (~180 new component files: the splits of
  `client-stats`, `seat`, `cart-line`, `catalog-status`, `medal-outlook`,
  `gamification`, `page-step`, …); pass C's "system-file dictionary family"
  (`CancelledSide`, `VisitRowOutcome`, `VisitGrain`, `GridEvent`,
  `TipPreset`, …) and the pipelines' local dictionaries
  (`BookingReadSnapshot`, `EditCallOutcome`, `MoveOutcome`,
  `BackfillCallEnd`, `WaitlistDeliveryOutcome`) are components;
  `LoyaltyCatalog` is declared once (`entities/loyalty-catalog.ts`);
  `Roles` is a companion (`components/roles.data.ts`); no getter, no
  `Object.freeze` on data (`isLazyPort` replaces the frozen-proxy check).
- **Law 1 / 6.2 tags** — every state and closed set is an `as const`
  dictionary compared through its members: the booking pipelines' read
  tags, ~110 lower-case UI unions (the "Left as found" ones: `StaffView`,
  `DiscardTarget`, `Placement`, `readoutTone`, `EventsTab`, `ProgramsTab`,
  the rhythm's confirmations, the editor's discount kinds, the `Locale`
  checks), the onboarding link's `?phase=`/`?step=` words; an external
  contract keeps its spelling and says so (URL values, `data-*`/CSS hooks,
  test ids, i18n key segments, DS inputs, stored and wire values); no
  boolean discriminated union but `Result.ok` (`LazyMethod`, the icon
  resolver's `Result`); the icon manifest's `kind` is `iconAsset`
  (schema 2, DEP-16; the `no-generic-discriminator` allowlist entry gone).
- **Law 7.5 errors** — every error dictionary and struct union lives in
  `libs/ecs-core/src/errors/*.error.ts` (the booking pipelines' unions,
  `HttpsStatus`, `MoveErrorCode` with the folded move refusals,
  `StaffBlockFailure`, `OwnProfileWriteFailure`, `AuthFailure`,
  `OnboardingFailure`); feature error state holds the STRUCT, so its i18n
  params survive (the onboarding birthday save, DEP-17); refusal lines word
  reactively (DEP-23); ONE server-code helper (`wordFlowFailure`) and ONE
  loaded-language stream (`loadedLanguage`, `@creativo/infrastructure/i18n`).
- **Pass C's D-11 list** landed on the branded contracts:
  `StaffEditPlanSystem` (the editor save's write plan and undo snapshot,
  REPRICE on cents — DEP-20), the editor's VM reshapes (`now: ShopNow`,
  `currency` — DEP-21, nullable brands instead of `''`), the client
  option's `email: string | null`, the viewer
  `{ userId: UserId; roles: readonly Role[] } | null`, `StaffVerb.didNotHappen`,
  ONE booking-flow terminal rule (`BookingFlowState.isTerminalStep`), ONE
  team-note builder (`saveTeamNote`), `ENGAGEMENT_VOUCHER_CODE_DUPLICATE`
  (DEP-18).

**The DEPARTURES** (plan "DEPARTURES", each spec-pinned at its boundary):
DEP-1…DEP-12 — the staff day on the wall clock (in-the-chair, next, past,
the agenda's past groups and now line incl. a minute's millisecond 0, the
agenda group key `agenda-time-<minutes>`, search's past/order/label and
«Скорошни» on each visit's own shop clock, the catalogue tag «±N мин», the
block sheet's seeded end, boundary minutes in a spring-forward gap, the
block event id `block:<chair>:<day>:<minute>`, the countdown) — answers
change ONLY inside a DST repeat hour, a spring-forward gap, across zones or
on a minute's millisecond 0; DEP-13 `?day=` takes calendar days only;
DEP-14 a refused `?barber=` is `null` at once; DEP-15 the client card reads
the draft's wall-clock start; DEP-16 the icon manifest schema 2; DEP-17 the
birthday save keeps `{{maxAge}}`/`{{minAge}}`; DEP-18 the duplicate voucher
code; DEP-19 catalogue prices in the stored currency; DEP-20 REPRICE on
cents; DEP-21 the editor's bill in the seats' currency; DEP-22 one strict
clock parser; DEP-23 two refusal lines re-word on a language switch. For
every EUR shop on a normal day nothing a user sees changes.

**Gate (2026-10-25, the integrator's second round):** `nx sync:check` up
to date; layering OK (895 files, 3,972 import edges); typecheck after
`rm -rf dist/out-tsc` — 39 projects, only `patterns` (baseline); lint 43
projects, 0 errors (239 warnings, as before); `run-many -t test` 43 runs,
**12,283 passed** + exactly the 6 baseline reds; ecs-core 314 files, 5,802
tests, **98.27 %** statements (13,938/14,183); `seed-tools` typecheck;
`lint-rules` 13 files, 315 tests; `lint:styles`; `build web` initial
**574.76 kB** (−25.39 kB: the L-1 splits let the initial closure import
small dictionary files instead of whole multi-name files — e.g. the
`StreakRuleDirection` a publish answer names no longer pulls
`streak-rule.data.ts` and the `engagement.error.ts`, `streak-interval`
and `streak-qualifier` behind it; per-file diff in the plan's §9.3) +
`verify:bundle`; `build functions` + the four runtime dependencies; runbook
§4.2 28, §4.3 22, §4.4 17, §4.5 6, §4.7 24, §4.8 27, §4.9 25 `ok`, 0 FAIL
(also with `git grep --untracked`, so the ~220 new files are covered);
`verify:p0` (a)–(f); `test:emulator` 65 + 253; `e2e:web` 41 passed +
exactly the 19 baseline failures (the glance's 12 at `:377`/`:758` — the
same assertions as `:384`/`:765`, seven import lines fewer).

The §6.3 DOM differential (94 spec files, 1,470 captured tests, compared
strictly against a `git archive cf91b43` copy) differs only by DEP-4 (7),
DEP-4 with the never-matching row-error stub (3), the block editor's
isolated-spec now label (2) and one fast-check random sample — no
whitespace difference left; the §6.4 dev-stack smoke against the same copy on the same emulators (pass C's harness, bg + en): today (a closed Sunday) 26 signatures per side, 14 identical, 10 differing only by the clock between the runs, 2 by DEP-13; the next open day 106 per side — every view, the agenda, all nine visit sheets, both client cards with their wallet, ledger, medals, records, details, season and history, the admin rhythm — 102 identical, 2 the create sheet's drafted start (the clock), 2 DEP-13.

**The review's six fixes (the fixer, 2026-10-25, plan §9.1 Fixer — type
level, no runtime value changes, no new DEP):** the client card's grant
outputs (`openReward`/`removeReward`/`useGift`/`removeGift`) are
`output<CouponGrantId>()` and the editor's `openReward`/`removeReward`/
`rewardTicket`/`addCountedService` take `CouponGrantId`/`ServiceId`; ONE
membership scan — NEW `CallAnswer.tag(answer, name, dictionary)` over
`Tag.has` replaces the call decoders' `Object.values` lists, and
`isPipelineError`, `RepositoryError.guard`, the recurrence rule's week
check, the wire's `isStoreFailure` and `loyalty.wire.ts`'s `wordOf` read
`Tag.has` (`CallAnswer.oneOf` stays for the one subset list,
`StreakPublishError.ANSWERED_CODES`); the discount summary compares
`discountSource`, not the icon name; the staff day's barber-id members take
`BarberId` and the grid's `rosterStartMinute` is `TrackMinute | null`
(the block editor's frame start `trackMinuteOf(min)`, a proven `ofProven`);
the functions edge's own `HttpsStatus` copy is gone (`@core/errors`' one,
`satisfies` the SDK's `FunctionsErrorCode`); NEW `DraftPersonKey.parse`
(the three minted spellings; `setLegClient` keeps `of`, the edge table's
DS-menu row). The FULL gate re-ran green against the baselines (§4's
pass-D numbers below; plan §9.3 Fixer round).

**The second review's eight fixes (the fixer, 2026-10-25, plan §9.1
Fixer, second round — type level, no runtime value changes, no new DEP):**
the waitlist callable's cart keeps its pre-door `X.of` brands as a recorded
D-4.1 row (the door judges the ids, in its own order — a wire `parse` would
reorder or add refusals); `seriesById`/`medalDetailVm`/`detailAction` take
a `BadgeSeriesId` (the page keys brand once at their readers, D-8.9) and a
drawn medal's `BadgeSeriesId | SeasonId` is read through NEW
`familyOfMedal` — today's equality lookup, never a cross-brand re-brand;
`soonSeriesIds` returns `BadgeSeriesId[]`; the visit row's status fact
tone is the `StatusFactTone` dictionary (`data-tone` spellings kept); the
landing's `LandingLocationId` is an as-const dictionary (the `LOCATIONS`
ids kept); `roles.data.ts` lost a stale transitional comment; the
onboarding phone field holds the `PhoneError` struct and words it by its
own `errorCode` (the `example` param added only at wording time, every
word the same); the root ESLint config's comment says `*Minutes` is in
the raw-brand guard. +2 spec cases (`familyOfMedal`, the onboarding's
unsupported-country line); the FULL gate re-ran green (§4's pass-D
numbers; plan §9.3 Fixer, second round).

**Fixed after pass D (2026-10-25, owner go-ahead):** two of pass D's
carried defects. (1) The agenda row's error line now prints: the template
asked `rowError` with the row's own `appointment#chair` key while the store
files refusals by appointment, so no row ever showed one; it now asks by
`entry.appointmentId` (the owner's 2026-09-03 ruling for anything addressing
the aggregate — a party's refusal reads in each of its chairs' rows), and
the cancel sheet's error reads through the same `rowError`. Refusals now
show in their row (beside the toast) until the next write to that
appointment, as the store intended. (2) The ＋ no longer crashes the page
late in the evening: the create sheet seeds the next tick on the track axis
(24:00 from 23:56) and its default half hour past 24:00 from 23:31, and
`seedDraft` converted both onto the shop's clock through converters that
threw; `VisitDraftSystem.durationOverrideOf` now measures the seeded span on
the track (`TrackMinute.span`), identical for every pair the clock can hold.
No save accepts a frame past midnight: a 24:00 start is refused on this side
(`StaffEditPlanSystem`), an end past it by the server. Dead with the fixes and
deleted: `StaffDayStore.errors` and `DurationMinutes.between`. Specs:
`visit-draft.system.spec.ts` (the track span past midnight),
`staff-dashboard.spec.ts` (a refusal in its own row and in no other visit's;
the ＋ at 23:57). **Carried (owner, UX):** opened at 23:56–23:59 the new
visit's frame starts at 24:00, which the sheet's grid does not draw, so it is
moved by typing «Начало» or changing the day — start it at 23:55 instead?
(CLOSED 2026-10-26, OR-1 / DEP-F1: `VisitDraftSystem.walkInStart` seeds
`min(next tick, the latest grain start the span still fits before 24:00)`
— from 23:26 on the ＋ seeds 23:30–24:00 — and `snapUp` is deleted.)

**Carried from pass D** (none blocks anything; the plan's §9.6 has each
with its reason; every engineering item below is CLOSED by pass E — end
of §3.3 — and only the owner calls and the parked items remain; since
2026-10-26 every one of those is ruled or triaged but N-1): `subjectCustomerId` stays
optional on the visit row/card options (pass E N-1: the client's
appointments page passes none and relies on the absent path, so requiring
it is the owner's call); the icons lib's raw-brand guard (CLOSED, E-5); the spec-only survivors
(`AchievementsSystem.firstStart`, `ZonedTimeSystem.toIso`,
`rhythmPreviewReadsFacts` — CLOSED, E-6, deleted; `parseIsoIn` KEPT, an e2e
calls it); the per-surface avatar-upload unions (CLOSED, E-7);
`client-profile.ts`'s `LocalDate.parse` of the stored `BirthDate` (CLOSED,
E-8, `BirthDate.toLocalDate`); the `UiDayKey` alias (CLOSED, E-9); the plan's §8 open questions OQ-1…OQ-19 with their
defaults as applied (OQ-1 `TrackMinute` a brand, OQ-3 pooled answers on
each visit's own shop clock, OQ-6 `windowHours` raw, OQ-7 `cadenceOf` on
instants, OQ-9 the editor save's orchestration in the component, OQ-13
claims-tolerant role predicates, OQ-14 `E164` a component brand, OQ-15/16
the stored currency, OQ-19 the photo titles in `'bg-BG'` among them —
CLOSED 2026-10-26, every one: OQ-1–OQ-5, OQ-10–OQ-13, OQ-15/16 and OQ-18
affirmed (OR-43; OQ-3 with the recorded two-zone rule of §6), OQ-6 an
`HourCount` brand (OR-45), OQ-7 cadence in shop calendar days (OR-46 /
DEP-F32), OQ-8 one theme writer (OR-47 / DEP-F33), OQ-9 the save a
pipeline (OR-4), OQ-14 `E164.parse` for foreign phones (OR-48 / DEP-F34),
OQ-17 a `PersonKey` brand (OR-49), OQ-19 the photo titles in the active
language (OR-5 / DEP-F4); pass-d §8); from
the second fixer round: the waitlist cart's pre-door brands (CLOSED by pass
E, E-4: raw strings in `WaitlistCall.Input`, branded inside the door),
`familyOfMedal`'s by-string lookup (CLOSED by pass E, E-13 / DEP-4: a typed
`MedalVm.familyId` — recorded for the owner, N-4), and the visit
row's DS-input-valued tile tone and amount emphasis unions (kept, OR-28). The
owner calls from pass C — the KEEP-PARKED lifecycle write verbs,
`VoucherSystem.redeem` and `IntervalSetSystem.clip` — are CLOSED: deleted
(OR-20 / DEP-F15, OR-14, OR-21 / DEP-F16). `subjectCustomerId` (pass E N-1)
is not ruled by the record and stays an owner question (§6).

**Edge hardening (2026-10-25, `flips/edge-hardening.md`, ledger §8).** The
before/after architecture comparison found three regressions at the I/O
edge; the owner's word: fix them. Three packages on disjoint files (GUARD,
RETRY, NOTE), then the integrator.

1. **Read-time validation.** NEW `StoredDocumentSystem`
   (`systems/stored-document.system.ts`): `appointment`, `customer` and
   `busyDay` answer THE SAME OBJECT (zero mapping, Law 5) or
   `RepositoryError.malformed(path, field)` — the existing
   `REPOSITORY_MALFORMED`, reused (DEP-10). They compose the companions' new
   `fieldFault` members (`MinuteRange`, `TimeCoordinate`, `BookingLifecycle`,
   `BookingContact`, `StoodSeatPairs`, `ServiceTerms`, `SeatOccupant`,
   `SeatOutcome`, `Seat` — which also refuses a service past midnight, F-6 —
   and `MinuteBlock`) and the primitives' new non-allocating `is` doors
   (`LocalDate.is`/`isAt`, `MinuteOfDay`, `EndMinute`, `UtcEpochMs` and
   `UtcEpochMs.MAX`, `DurationMinutes`, `MinuteCount`, `PriceCents`,
   `Currency`, every id through `idCompanion` with `isSpan`, `BusyKey`; NEW
   `StoredFields`; `Tag.has` a non-allocating scan, DEP-12). One rule picks
   the fields: checked when a system iterates, narrows or computes on it.
   Wired at the two composition roots — `firestore-ports.ts` (the commit,
   the schedule singles, the backfill walk, each with `telemetry.log`) and
   `app.config.ts` (`guardedReads(errorHandlerLogPorts(ErrorHandler))` for
   the appointment, customer and scheduling bundles); a bare adapter guards
   nothing (DEP-11). A single or transactional read refuses — the commit
   answers before `decide`, nothing written (DEP-1); a list drops and
   reports the row and refuses only when it keeps none, `observeUpcoming`
   strict (DEP-2); the backfill walk stops at the document (DEP-3); each
   trigger side is guarded on its own and a refused side contributes only
   its salvaged keys, subjects and location (DEP-4); the subject mirrors
   pass absent / `null` for the backfill (DEP-15); the client history's
   first page ranges `utcEpochMs <= UtcEpochMs.MAX` and a `NaN` cursor ends
   the history (DEP-14). **Against `c1db661`** the list rule matches the
   mappers list for list (the staff lists dropped a malformed visit,
   `observeUpcomingFor` errored the stream); it adds the report and the
   systemic rule, and departs once: a busy day is one document now, refused
   whole (fail-closed), where the old reader dropped a corrupt span and
   offered the time under it. A list answer read in parts is judged WHOLE
   (plan §8.6): the staff search admits its two halves together (c1db661's
   `searchWindow` did the same), and the client history refuses only on
   its first page — a later page of only malformed rows answers an empty
   page with its cursor. Functions refusals log `'malformed document
refused'` `{ path, field }` where they happen (Cloud Logging); the web's
   report reaches the device console only (OQ-6, OQ-7).
2. **Trigger retry.** `rebuildBusyOnAppointmentChange`,
   `rebuildCapacityOnBusyChange` and `matchWaitlistOnBusyChange` deploy
   `retry: true` through `retryingTrigger` (`main.spec.ts` `ENDPOINTS`: 7
   retrying exports). The allowlist is extended, not bypassed:
   `TRANSIENT_CODES` unchanged, a malformed refusal judged `data-loss`,
   permanent (DEP-7). `rebuildBusy` and `matchWaitlist` keep going past a
   failed day / request and answer `failures` + `attemptFailure` (DEP-5,
   DEP-6); a malformed busy day skips only its barber in a match (DEP-13).
   Specs prove a transient failure rejects, a decisive one resolves and
   logs, and a rerun of the same event leaves the projection unchanged
   (busy, capacity, waitlist).
3. **The team note.** NEW port `UpdateAppointmentNote` (in
   `AppointmentNotePorts`): the web adapter reads, decides and writes
   `appointmentNotes/{id}` in ONE `runTransaction`; `appendTeamNote`
   decides through `VisitSidesSystem.appendedNote` and the one `noteRecord`
   builder (the save's stamps: the session's author, the injected clock read
   once before the transaction — DEP-9). A concurrent edit re-runs the
   decision and is appended below. **Observed on the emulator** (the
   integrator, server cut by a TCP proxy, the note never read): the append
   answers `REPOSITORY_WRITE_FAILED` reason `unavailable` after **7.2 s**
   (the SDK's five attempts), `decide` never runs, and the server's copy is
   unchanged after reconnecting; the same client then appends once (DEP-8).
   `disableNetwork` does not reach a transaction (it stops the listen and
   write streams only), so it is no offline simulation for this path. The
   dashboard's UX is unchanged (the words once per sheet,
   `staff.day.cancelNoteFailed` on a refusal).

**The integrator's rulings and edits:** the packages' flagged departures
kept — `Seat.fieldFault`'s F-6 end check (else `Seat.endMinutes` throws its
defect deep in a system), `idCompanion.isSpan`, the reported-set arguments
of `admitted`/`keepAdmitted`, the shared `admitStored`/`logRefusal` of the
functions adapters (fully shared only since the review's fixes, below), a refused side with no salvageable location rebuilding
on the default location's zone (F-4, frees the day; the zone only stamps
the busy day's first instant), and a decision naming another visit raised
as a defect after the transaction (never passed off as a store failure).
Added: a `NaN` cursor answers `nextBeforeUtcMs: null` (Firestore refuses a
range below `NaN`; the fake now orders `NaN` below every number, as the
store does; +1 adapter case); the wire's `OnRefused` alias made
module-private (runbook §4.2–§4.4 "no port function type outside ports");
four index sinks rewritten (lint back at 239 warnings); the client-stats
integration fixtures built through `AppointmentIndexSystem.withQueryKeys`
— their envelope ended before it started, which the guard refused at the
trigger decode (`test:emulator` red until then).

**Gate (2026-10-25, the integrator):** `nx sync:check` up to date; layering
OK (900 files, 3,998 import edges); typecheck after `rm -rf dist/out-tsc` —
39 projects, only `patterns`; lint 43 projects, 0 errors (239 warnings);
`run-many -t test --parallel=3` 43 targets, **12,589 passed** (12,510
vitest + `verify-tools` 79) + exactly the 6 baseline reds; ecs-core 317
files, **6,028 tests, 98.33 %** statements (14,193/14,433); `seed-tools`
typecheck; `lint-rules` 13 files, 315 tests; `build web` initial
**576.24 kB** (156.90 kB transfer; +1.41 kB: the primitives' `is` doors ride
the initial closure beside their constructors, and `errorHandlerLogPorts`)

- `verify:bundle` (`@core/systems` and the guards stay lazy); `build
functions` + the four runtime dependencies; runbook §4.2 28, §4.3 22, §4.4
  17, §4.5 6, §4.7 24, §4.8 27, §4.9 25 `ok`, 0 FAIL; `verify:p0` (a)–(f);
  `test:emulator` 65 + 253; `e2e:web` 41 passed + exactly the 19 baseline
  failures (the glance's 12 at `:377`/`:758`); no `'malformed document'`
  line in any journey's functions log.

**The review's six findings, fixed (2026-10-25, plan §8.6).** (1, major)
one malformed visit no longer blanks the staff search or strands the client
history: the search's two halves are read raw and admitted ONCE, and the
history's systemic refusal is judged on its first page only (a later page
answers through the new `ListAdmission.DropOnly`, an empty page with its
cursor); (2) the guard dispatch has one home, NEW
`StoredDocumentSystem.admit`, behind the functions `admitStored` (now a
`Result`, logged through `logRefusal`, called by the schedule singles and
the backfill walk) and the web `admitted`; (3) `main.ts`'s
`logRefusedSide` is `logRefusal(root.edge.log, error)`; (4) the trigger
decoders guard and forward only — NEW `StoredDocumentSystem.appointmentSide`
/ `salvageSides`, `RebuildBusyCommand.refusal` answered by `rebuildBusy`
over its one `affectedKeys`, NEW `ClientStatsSystem.dispatchSubjects`;
(5) `StoredFields` holds `isArrayOf`, `isRecordArray`, `isTextOrNull`,
`isCount` once; (6) each numeric brand's `of` answers through its `is` (the
range written once, the `-0` folds kept). +26 unit cases; the FULL gate
re-run green against its baselines (plan §8.6's gate record).

**Carried from the edge hardening** (none blocks anything; the plan's §7
and §8.5 have each with its reason): `appointmentNotes` bodies unguarded
(OQ-2 — CLOSED by pass E, E-2 / DEP-2); the four other capacity triggers
without `retry` (OQ-1 — CLOSED by pass E, E-1 / DEP-1); the web report's sink and a worded
"N visits could not be shown" (OQ-6, OQ-7 — CLOSED 2026-10-26: the
first-party `reportClientIssues` sink behind a `ReportingErrorHandler`,
OR-34 / DEP-F25; `BarberDayRead.unreadableCount`, the failed lanes drawn and
one health row per affected chair, OR-2 / DEP-F2); `REPOSITORY_MALFORMED`'s words
shared with every `REPOSITORY_*` code (OQ-4 — CLOSED, OR-54 / DEP-F38: each
code worded for what it means) and a separate read code if
wanted (OQ-5 — CLOSED, OR-43: `REPOSITORY_MALFORMED` reused, no new code);
guarded-by-default adapters (OQ-3 — CLOSED, OR-33 / DEP-F24: the guard is a
required parameter, the unguarded value fenced into test support); the sheet's «Запази»
(`saveTeamNote`, a whole-note write of the draft) keeps its offline limit
(kept, OR-28);
under the functions emulator a transient rethrow from a retrying trigger
is not redelivered (`tools/seed/settle.mjs` reports it), so a settle run may
list the retrying functions (seven since pass E); the integration specs and the seed
build the functions adapters unguarded by design (D-7 — reversed by OR-33 /
DEP-F24: they read through the real guard).

**Pass E — leftovers (2026-10-25, `flips/pass-e-leftovers.md`, ledger
§8).** The owner's word: "proceed with leftovers". Pass E closed every
carried item that is ENGINEERING — no product decision, no new copy beyond
words for codes that had none, no new dependency — and turned the standing
red baseline green at each red's root cause. Twelve wave-0 packages
(RETRY, GUARD, TTL, WAITLIST, CORE, REOPEN, RULES, I18N, CARD, UI, INTL,
SURVIVORS) on disjoint files, E2E in wave 1, then the integrator. What
changed:

- **E-1 — the four other capacity triggers retry** (`rebuildCapacityOn
ExceptionChange` / `RosterChange` / `LocationChange` / `SettingsChange`):
  `retry: true` through `retryingTrigger`, the edge hardening's transient /
  decisive split, the allowlist unchanged (11 `retry: true` in `main.ts`).
- **E-2 — `appointmentNotes` guarded at read:** `StoredDocumentSystem
.appointmentNote` (+ its allocation-free fault) in `guardOf`; the web
  adapter's live read emits `REPOSITORY_MALFORMED` and stays subscribed,
  the transactional append refuses before `decide` and writes nothing;
  wired through `guardedReads` in `app.config.ts`.
- **E-3 — TTL as deploy configuration:** the seven `purgeAt` policies and
  their single-field index exemptions are `fieldOverrides`
  (`"ttl": true, "indexes": []`) in `firestore.indexes.json`, deployed with
  `firestore:indexes`; runbook §2.2–§2.4 and §3 step 3 rewritten (one
  `gcloud` fallback line; §2.3's ACTIVE check stays the release gate).
- **E-4** the waitlist cart travels raw (`WaitlistCall.CartInput`) and is
  branded inside its door (`WaitlistSystem.cartAsSent`); **E-5** the
  raw-brand guard on `libs/ui/icons`; **E-6** `AchievementsSystem
.firstStart`, `ZonedTimeSystem.toIso` (its spec cases restated on the test
  helper `offsetIso` of `@core/testing`) and `rhythmPreviewReadsFacts`
  deleted, `parseIsoIn` kept; **E-7** one `AvatarUploadError` union;
  **E-8** `BirthDate.toLocalDate`; **E-9** `UiDayKey` gone; **E-10** the two
  alias feature specs deleted, every case mapped (ledger §8.3); **E-11** the
  dashboard spec imports `HeldGrant`; **E-12** cached `formatMinutesRange` /
  `formatCount` in `@creativo/ui/wall-clock`; **E-13** `MedalVm.familyId`;
  **E-14** the reopen's busy merge; **E-15 / E-16** the rules; **E-17** the
  programs status words in the bg/en catalogues (the same lowercase English
  words); **E-18** words for 19 UI-reachable codes (ledger §8.2, for the
  owner's copy review); the swipe directive's host metadata, the showcase's
  `::ng-deep` replaced by the demo shell's own attribute, the visit-row
  spec's `bookingStatus` fixture, the DST end-to-end word case.
- **E-19 — the standing red baseline, at each root cause:** typecheck
  `patterns` (an ES2023 `findLast` in a spec helper — the spec); `gauge.spec.ts`
  × 4 and `visit-pills.spec.ts` (prettier's wrapped `max( … )` / `calc( … )`
  and a whitespace text node pinned by specs born red in `98adfb3f` /
  `c1db6611` — the specs); `visits-page.presenter.spec.ts` (revision 3's two
  lines, `c1db6611` — the spec); e2e `landing.spec.ts:121` (MapLibre ships in
  hashed lazy chunks since `c1db6611`'s `prebundle.exclude` — the test reads
  a download by its body); the glance's barber test (the seed's last visit
  held today's service, so «Повтори» was never offered; a fixed 21:00 visit;
  a photo on the featured visit — the seed); the glance's birthday test (the
  focus fell to the body — the code, DEP-9); the six `*-screenshots`
  (revision 3, R59, the accent law and the date-picker style — the
  baselines, regenerated after both images were read; owner flag in ledger
  §8.4). A programs e2e journey (`programs.spec.ts`) proves the tightened
  rules admit the live admin writer.

**The DEPARTURES** (plan §5, each spec-pinned): DEP-1 the four capacity
triggers redeliver a transient failure and log one attempt line; DEP-2 a
malformed `appointmentNotes` document is refused (guarded roots only);
DEP-3 TTL and the `purgeAt` exemptions deploy with the indexes; DEP-4 a
season's own medal never draws a family (N-4 — pass D had handed this to the
owner); DEP-5 a reopened visit (`CANCELLED` / `NO_SHOW` / `COMPLETED →
CONFIRMED`) holds its chair in `barberBusy` at once — E-14's proof showed a
booking was admitted over it until `rebuildBusy` ran (outcome (b)); which
reopens are refused is unchanged (N-5); only a move from a non-live visit to
a live status reads the busy days (every other move reads what it read
before and keeps its own answer), and a malformed busy day under the
visit's keys now refuses the reopen with `REPOSITORY_MALFORMED` (the
edge-hardening D-3 guard `bookAppointment` already had); DEP-6 no client writes
`serviceCategories`, `services`, `barbers`, `locations`, `barberSchedules`
or `settings` (the Admin SDK still does; `scheduleExceptions` and `coupons`
keep their grants — a live writer, and the dated case of N-2); DEP-7 a
programs create/update must be the entity body, a delete is refused; DEP-8
the 19 codes print their own words; DEP-9 «Премахни» on the birthday band's
applied gift gives the focus to the gift offered again (it fell to the
body). Everything else is frozen.

**The integrator's edits** (ledger §8, top): the stale i18n project
references of three feature tsconfigs (`nx sync`); the root ESLint config
re-exports `UI_RAW_PRIMITIVE_RESTRICTIONS` and `PRODUCTION_TS_IGNORES` for
the icons config; CORE's helper renamed `offsetIso` (`wallIso` is a retired
wire word in runbook §4.7's gate); DEP-9 applied with its unit case (red
without the fix); `AppointmentLifecycleSystem.endsLive` beside
`endsCancelled` (the reopen's predicate out of the pipeline); the showcase
month-picker page brands its days (`nx build showcase` was red since pass
D); one restated booking-cart case; doc-only edits (`observe.ts`,
`firestore-tx.adapter.ts`, `visit-list-words.ts`, runbook §1.1 and §4.4).

**Gate (2026-10-25, the integrator, one command at a time — plan §8.5):**
`nx sync:check` up to date; layering OK (900 files, 4,006 import edges);
typecheck after `rm -rf dist/out-tsc` — **39 projects, all green**; lint 43
projects, 0 errors (236 warnings); `run-many -t test --parallel=3` 43
targets, **12,718 passed, 0 failed** (12,639 vitest + `verify-tools` 79);
ecs-core 317 files, **6,115 tests, 98.34 %** statements (14,236/14,476);
functions 964; `seed-tools` typecheck; `lint-rules` 13 files, 319 tests;
`lint:styles`; `build web` initial **576.13 kB** (+0.04 kB) +
`verify:bundle`; `build functions` + the four runtime dependencies; runbook
§4.2 28, §4.3 22, §4.4 17, §4.5 6, §4.7 24, §4.8 27, §4.9 25 `ok`, 0 FAIL;
`verify:p0` (a)–(f); `test:emulator` **65 + 301**; `e2e:web` **61 passed,
0 failed**; `nx build showcase` green. No standing red is left.

**The review's fixer (plan §8.7–§8.8):** DEP-5's busy read narrowed to a
move from a non-live visit to a live status (+3 pipeline cases) and its
malformed-busy refusal declared; DEP-9 declared in plan §5; the test helper
`offsetIso` rebuilt on `ZonedTimeSystem.toLocal` (one zone engine); §2's
summary corrected. The FULL gate re-run one command at a time: typecheck 39
green, lint 0 errors, `run-many -t test` **12,721 passed, 0 failed** (ecs-core
6,118), coverage **98.34 %** (14,236/14,476), `build web` 576.13 kB +
`verify:bundle`, `build functions` + deps, runbook §4.2–§4.9 at the same
counts, `verify:p0`, `test:emulator` 65 + 301, `e2e:web` **61 passed, 0
failed**.

**What remained after pass E — the OWNER items** (plan §7.1, verbatim; none
blocked anything; every one RULED on 2026-10-26 by
`decisions/2026-10-26-owner-rulings.md` — the ruling follows each item):

1. Location picker for the event's free-text location (flip 4) — HANDOFF §3.3 'Carried forward'; flip-4 F4-2, §10 Q1. — **CLOSED: OR-37 / DEP-F27** (a `ui-choice-menu` over the active shops; existence checked by `ProgramsSystem` and the rules), **OR-38 / DEP-F28** (a shop that does not exist is refused).
2. customers create/update grant for worksTheBook and CustomerOrigin.StaffWalkIn kept with no web writer (the walk-in client-record path) — HANDOFF §3.3 pass B owner flag (b); flip-1 §10 Q7. — **CLOSED: OR-25 / DEP-F19** (the client grant closed, the server the only writer), **OR-26 / DEP-F20** (the server-written walk-in record, `WALK_IN` seats).
3. Client time sheet cannot see where a carried companion lands, so such a reschedule is refused by the server — HANDOFF §3.3 'Carried from pass A'. — **CLOSED: OR-7 / DEP-F6** (`MoveSystem.partyStarts`; the sheet frames every seat).
4. KEEP-PARKED lifecycle write verbs (AppointmentLifecycleSystem.confirm/complete/markNoShow/cancel/reopenNoShow/reopenSettled/markSeatOutcome), VoucherSystem.redeem, IntervalSetSystem.clip — delete? — HANDOFF §3.3 'Carried from pass B/C/D'; pass-c §9.6; pass-d §9.6. — **CLOSED: deleted — OR-20 / DEP-F15, OR-14, OR-21 / DEP-F16.**
5. Grant burn/restore and voucher issuing (features behind the parked code) — HANDOFF §6 flip-1 OQs; flip-1 §10 Q2. — **CLOSED: OR-13 / DEP-F10 / DEP-F10b** (burned at save, given back on removal, cancel or no-show), **OR-14** (issuing returns with points redemption or payments).
6. leadTimeSampling gate on sampleBarberLeadTimeDaily; the public busy body in an availability refusal's details — HANDOFF §3.3 'flip 1's other deferred behaviours'; flip-1 §10 Q3. — **CLOSED: OR-27 / DEP-F21** (the sampler stays ungated), **OR-12** (no busy body; the details stay the flat scalar struct).
7. Catalogue edge-guard family (DayHours.parseWeek/DayHoursInput, ServiceComposition.parse, openDay, CATALOG_LOCATION_INVALID_HOURS_*/_TIME_OF_DAY, reserved CatalogErrorCode.LocationInvalidTimezone) — delete or wire to an admin location writer — HANDOFF §3.3 'Carried from pass B' (KEEP-PARKED); §6. — **CLOSED: OR-22 / DEP-F17** (`parseWeek` live with a 24:00 close; the dead members deleted; no admin writer).
8. BookingFlowEventKind.SetDayWindows + FlexibleWhen.withWindows (never dispatched) — keep for the per-day window sheet or delete both — HANDOFF §3.3 'Carried from pass B'; §6. — **CLOSED: OR-23** (the write verbs deleted, the stored `windows` kept).
9. Pass B owner flag (e): apps/web/src/app/shell/impersonation-banner.ts empty slot — keep or drop — HANDOFF §3.3 pass B owner flags; §6. — **CLOSED: OR-24 / DEP-F18** (dropped; `/admin` redirects; the read-as contract in §6).
10. Pass B owner flag (f): deploy order of the three deleted composite indexes, and the waitlist request id reseed (every wl_ id changes) — HANDOFF §3.3 pass B owner flags; §6. — **CLOSED: OR-36** (moot for a first deploy; the rule is in runbook §3).
11. CSP headers block of firebase.json (csp-baseline.md) — HANDOFF §3.3 pass B 'Smaller follow-ups'. — **CLOSED: OR-29 / DEP-F23, OR-30, OR-31** (the hash CSP and the header set, enforced, proven by `verify:csp`).
12. Law 10.2 OQ-4: keys built from display words (the reward ticket's group key, the glance's held rewards by NAME → coupon id / RewardId on the card contracts) — HANDOFF §3.3 'Carried forward'; §6 decision-extraction OQs. — **CLOSED: OR-15 / DEP-F11** (keyed by coupon id).
13. Law 10.2 OQ-5: should the glance's voucher sum refuse mixed currencies like the wallet's total — HANDOFF §3.3 'Carried forward'; §6. — **CLOSED: OR-17 / DEP-F12** (the glance prints every currency).
14. Law 10.2 OQ-7: the wallet's localeCompare and the glance's input-order ties vs the visit list's code-unit/id tie-breaks — HANDOFF §3.3 'Carried forward'; §6. — **CLOSED: OR-18 / DEP-F13** (UTF-16 code units everywhere).
15. CouponGrantSystem's Partial<{ couponOccasion }> constraint — tighten once ClientCardGrant.couponOccasion is required — HANDOFF §3.3 'Carried forward'. — **CLOSED: OR-16** (required `CouponOccasion | null`).
16. Owner confirmation of the 4a plan's §11.4 (a) time-sheet re-pin — HANDOFF §3.3 'Carried forward'. — **CLOSED: OR-7** (confirmed).
17. Opened at 23:56–23:59 the new visit's frame starts at 24:00 (not drawn by the grid) — start it at 23:55 instead? — HANDOFF §3.3 'Fixed after pass D' (Carried, owner, UX). — **CLOSED: OR-1 / DEP-F1** (`walkInStart`: the latest half hour that fits).
18. Pass C OQ-1…OQ-14 (OQ-1 cancel side by reason; OQ-2 isLive; OQ-3 staffWalkIn vs D18; OQ-4 /account's next visit past start; OQ-5 OTP cooldown 30 s vs 60 s; OQ-6 guest label number; OQ-7 off all day; OQ-8 recent visit's client; OQ-9 seeded-day verdict; OQ-10 flow store orchestration; OQ-11 isReadableId tier; OQ-13 OTP escalation sendCount ≥ 3) — HANDOFF §3.3 'Carried from pass C'; pass-c §8. — **CLOSED: OR-43** (OQ-1, 2, 7, 8, 10, 12, 14), **OR-11 / DEP-F9** (OQ-3), **OR-8 / DEP-F7** (OQ-4), **OR-9 / DEP-F8** (OQ-5), **OR-6 / DEP-F5** (OQ-6), **OR-3 / DEP-F3** (OQ-9), **OR-44 / DEP-F31** (OQ-11), **OR-10** (OQ-13).
19. Pass D OQ-1…OQ-19 (TrackMinute brand, stray helper files, pooled answers on own shop clock, parseIsoIn/toIso kept, telemetry Log level, windowHours raw, cadenceOf on instants, UiTheme copy, editor save orchestration, LoyaltyCatalog home, icon kebab codes, pipeline error unions, claims-tolerant roles, E164 component brand, stored currency for bills/catalogue, SeatKeyText families, reactive error lines, photo titles in 'bg-BG') — HANDOFF §3.3 'Carried from pass D'; pass-d §8, §9.6. _(Note: pass E deletes `toIso` under the task's spec-only-survivor rule — E-6 — and KEEPS `parseIsoIn` (an e2e calls it); OQ-4's default is otherwise untouched.)_ — **CLOSED: OR-43** (OQ-1–5, 10–13, 15/16, 18), **OR-45** (OQ-6), **OR-46 / DEP-F32** (OQ-7), **OR-47 / DEP-F33** (OQ-8), **OR-4** (OQ-9), **OR-48 / DEP-F34** (OQ-14), **OR-49** (OQ-17), **OR-5 / DEP-F4** (OQ-19).
20. Web report's sink (an ErrorHandler forwarding DATA_LOG_ERROR to telemetry) — HANDOFF §3.3 'Carried from the edge hardening' (OQ-6); edge-hardening §7. — **CLOSED: OR-34 / DEP-F25** (the `reportClientIssues` callable into Cloud Logging).
21. Worded 'N visits could not be shown' on the staff day — HANDOFF §3.3 edge hardening (OQ-7). — **CLOSED: OR-2 / DEP-F2.**
22. REPOSITORY_MALFORMED's words shared with every REPOSITORY_* code (read oddly for a read) — HANDOFF §3.3 edge hardening (OQ-4). — **CLOSED: OR-54 / DEP-F38.**
23. A separate REPOSITORY_DOCUMENT_MALFORMED read code — HANDOFF §3.3 edge hardening (OQ-5). — **CLOSED: OR-43** (no new code).
24. Guarded-by-default adapters (vs unguarded default, DEP-11) — HANDOFF §3.3 edge hardening (OQ-3). — **CLOSED: OR-33 / DEP-F24** (no default; reverses edge DEP-11).
25. Flip-4 OQ-11 / HANDOFF §6: confirm the production default location id and that its document holds a valid timeZone before the flip-4 web deploys — HANDOFF §6; flip-4 §10 Q11. — **CLOSED: OR-35 / DEP-F26** (`loc-center`; the preflight's P1).
26. Flip-4 OQs 1, 3–6, 8–10 (event location fallback, read-side validation, legacy libs, seed programs, clock/id bundles, event formatter, start form, positions locationIds wipe-on-edit) — flip-4-programs.md §10. — **CLOSED: OR-37 / OR-38** (Q1), **OR-39** (Q3), **OR-40** (Q4, Q6, Q8, Q9), **OR-41 / DEP-F29** (Q5), **OR-42 / DEP-F30** (Q10).

New for the owner from pass E (plan §7.2 and ledger §8): N-1 —
`subjectCustomerId` cannot be required on `VisitRowOptions` /
`VisitCardOptions` (the client's appointments page passes none and relies on
`VisitStorySystem.subjectRecordOf`'s absent path); N-2 — the `coupons` write
grant (`isAdmin`) has no client writer but a dated rules case pins an
admin's save; N-3 — the `purgeAt` single-field index exemption, which the
runbook used to leave to the owner, is declared; N-4 — DEP-4 was pass D's
owner hand-off; N-5 — a `NO_SHOW` or same-day `COMPLETED` reopen (and a
seat-level reopen inside a cancelled party) checks no collision against
appointments booked into the freed chair; the six screenshot baselines were
regenerated though `client-card-revision-3.md` §7.7 rule 2 waits for the
owner's acceptance of review 2 (revert: the six PNGs from `6d64f69f`); the
`IDENTITY_CLAIMS_PROMOTION_FAILURE` words (an `S.Internal` code the
onboarding printed raw) and the two identity lines' formal «вие»; whether
`LOYALTY_STREAK_PUBLISH_RECOMPUTE_NEEDS_ENGINE` / `_PREVIEW_STALE` should get
words (the admin rhythm page says nothing for them on purpose). Ruled
2026-10-26: the six baselines are ACCEPTED, which decides
`client-card-revision-3.md` §7.7 rule 2, and their two defects — an
upcoming tile with no month or year, a filter row of one chip — are fixed,
each regenerating its own baselines (OR-56); the identity words and the
formal «вие» go to one «ти» voice (OR-51); both rhythm codes are worded and
the page's switch is exhaustive (OR-52 / DEP-F36). N-1, N-2 and N-5 are not
ruled by the record and stay open (§6); N-3 and N-4 record changes pass E
made, each reverted by one edit (pass E §7.2).

**PARKED** (plan §7.3, verbatim; TRIAGED 2026-10-26 by OR-28 / DEP-F22 —
an item the triage wired or deleted says so, every other item is kept with
no action):

- `ZonedTimeSystem.parseIsoIn` — KEPT (e2e support calls it).
- `GridLayoutSystem.closedRuns` on `MinuteRun` (no host feeds past-midnight ends).
- `ShopDayFrame` stays in `booking-read-set.pipeline.ts` (deliberate).
- `ecs-migration.md` / `flip-1-booking-core.md` describing #22's earlier shape (historical records).
- Flip-1 parked ports and grant verbs; `NotificationSystem` read stamp; `VoucherSystem.issue` (owner features). — **Wired or deleted:** the grant verbs (OR-13), the read receipt (OR-19), `readCustomers` (OR-26), `loadCouponGrant` reshaped (OR-13); `VoucherSystem.issue` / `redeem` (OR-14), `expire` / `revoke` / `termsOf` (OR-13) and `loadWaitlistRequest` (OR-28) deleted.
- `EngagementErrorCode.BadgeCategoryOrderNegative`; `CancellationAttribution.Shop`, `StreakTrackMarkKind.Kept/Repaired/Missed`. — **`BadgeCategoryOrderNegative` deleted** (OR-28); the closed vocabularies kept.
- matchMedia and ResizeObserver test polyfills (live consumers).
- The stylelint override for `libs/ui/**` and `libs/features/**` (a DS styling pass; taste risk).
- Showcase Playwright snapshots refresh (only if a run fails, after viewing).
- The visit row's DS-input-valued tile tone and amount emphasis unions.
- `TRANSIENT_CODES` / `RETRYABLE_CODES` spelled through `HttpsStatus` (optional; never widened).
- `setLegClient` keeping `DraftPersonKey.of`.
- Spec titles naming retired names.
- The sheet «Запази» offline limit; the functions emulator not redelivering a transient rethrow (`settle.mjs` will now list up to seven retrying names); integration specs and seed building adapters unguarded. — **The last clause is reversed** by OR-33 / DEP-F24: they read through the real guard.
- `SiteFooterComponent` dev-mode assertion on `/careers`, `/courses`, `/events`; a stored `ui-lang = 'en'` not restored (pre-existing; re-check against `index.html:24`'s pre-paint script before any work).
- R-1 (E-1): the capacity sweep's per-barber failure handling.
- `libs/ui/patterns/src/lib/metric/metric.ts:271` per-call `Intl.NumberFormat` (a DS component, outside E-12's wording-helper scope).

**Carried from pass E** (engineering, none blocks anything; ledger §8.6;
the owner rulings keep R-1 as it is, OR-28, and rule nothing else here —
the rest stay engineering follow-ups):
R-1 — for the Location / Settings capacity triggers the retry covers the
sweep's zone, policy and roster-list reads, not one barber's commit (still
logged and healed by the 03:00 `sweepCapacityDaily`); the glance e2e seed
cannot seed a visit still to come today after ~23:15 shop time; no Nx target
typechecks `apps/web/e2e/**`; three per-call `Intl.ListFormat` sites
(`admin-rhythm.words.ts`, `rhythm-rule.words.ts`, `staff-block-editor.ts`);
`translate-coded-error.spec.ts`' `AUTH_FLOW_ERROR_CODES` does not list the
two newly worded identity codes.

**Pass F — the owner rulings (2026-10-26,
`docs/architecture/decisions/2026-10-26-owner-rulings.md`).** The owner
delegated every open decision. Eight research clusters scored each
question's real options on seven criteria (correctness, security,
performance, one source of truth, UX, simplicity, reversibility); the chief
architect re-read the evidence, settled the conflicts between clusters
(record §0) and issued 56 rulings, OR-1 … OR-56, covering every owner item
of the carried lists above and of §6, and every open question of the plans
(`pass-e-leftovers.md` §7, `pass-c-ui-decisions.md` §8,
`pass-d-brands-shapes.md` §8, `edge-hardening.md` §7,
`law-10-decision-extraction.md` §8, `flip-1-booking-core.md` §10,
`flip-4-programs.md` §10, `flatten-spec.md` OQ-2, the 4a plan's §11.4 (a),
`client-card-revision-3.md` §7.7 rule 2), each plan marked in place. The
rule of the round: anything that closes a live correctness, security or
revenue gap is built now, whatever its size — the coupon-grant leak
(OR-13), the walk-in data loss (OR-26), the notification inbox (OR-19), the
`customers` write grant (OR-25), the CSP and security headers (OR-29–OR-31),
the failed chair drawn as a free day (OR-2). The rulings were built in four
waves of disjoint packages (the record's implementation plan): W0 the
ecs-core contracts, systems and catalogue keys; W1 the pipelines, features,
rules and platform; W2 the walk-in record's server and editor halves, the
save pipeline's wiring, the theme writer, the operations (runbook, the
preflight, the index rule) and the visit row; W3 the required read guard,
the «ти» voice pass and these docs — one commit per package, the FULL gate
of §4 (`verify:csp` from wave 1 on) at every wave boundary. Two rulings
close no carried item and stand as rules: Firebase Auth through
`initializeAuth` with no popup/redirect resolver, so no third-party script
or iframe loads on a phone (OR-32), and the fixed rules for every new
refusal's copy — «ти», at most two short sentences, «Опитай пак.» only when
a retry can succeed, bg and en in the same commit (OR-55, recorded at the
top of `word-pipeline-error.spec.ts`).

**The orchestrator's override (2026-10-26, delegated owner authority).**
OR-13 flagged one product default — a no-show keeps the grant burned, like
the voucher draw. It is overridden: `BillingSystem.releasesHoldings`
releases a visit's holdings on cancel AND no-show, on the staff and the
server paths alike (DEP-F10b) — a reward or a voucher balance is value the
client earned or bought, consumed only by a visit that happened; a no-show
penalty belongs to the shop's explicit policy, never to a silent forfeit. A
reopen of a cancelled or no-showed visit does not re-burn (the barber
re-adds the reward), and a completed visit keeps its grant `USED`.

**The DEPARTURES** (record, each pinned by its package's specs):

- DEP-F1 (OR-1) — from 23:26 the ＋ seeds the latest half hour that fits
  (23:30–24:00); `staff-dashboard.spec.ts`'s late-evening case re-pinned to
  1410/1440.
- DEP-F2 (OR-2) — a failed chair draws no gap cards and is no longer listed
  as off: it shows a health row; a partial drop shows a count; the dead
  `staff.day.laneFailed` key is wired; edge OQ-7's default reversed and
  edge D-3's promise made true.
- DEP-F3 (OR-3) — the frame verdict speaks about the drawn day and chair;
  the create sheet's frame follows its draft.
- DEP-F4 (OR-5) — in the English UI the editor's photo titles and money
  read en-GB; Bulgarian unchanged.
- DEP-F5 (OR-6) — after the first guest is removed, the next one added is
  «Гост 1» (the lowest free number on all three surfaces).
- DEP-F6 (OR-7) — on a companion-first move `data-start` carries the
  party's earliest instant, the stored `utcEpochMs`.
- DEP-F7 (OR-8) — a live visit that has begun on its shop's clock is no
  longer shown or counted as upcoming.
- DEP-F8 (OR-9) — the OTP countdown is 60 s, server-owned, and a throttled
  resend restarts it instead of showing an error.
- DEP-F9 (OR-11) — staff placement allows conflicting services everywhere,
  a recorded departure from §9 D18 (the live behaviour since flip 1).
- DEP-F10 (OR-13) — a coupon grant is burned at save and given back on
  removal or cancel (departs from F1-2's "no grant write" and from the
  design doc's "burn on completion"); DEP-F10b — a no-show gives the grant
  back to the wallet and the voucher draw back to the balance.
- DEP-F11 (OR-15) — in en, held rewards are excluded from «enough for», and
  different coupons that share a name show as separate tickets.
- DEP-F12 (OR-17) — the glance shows voucher money in every currency.
- DEP-F13 (OR-18) — only exact ties reorder, by UTF-16 code units.
- DEP-F14 (OR-19) — the read stamp is one-shot and never predates the
  message; the menu row routes to `/account/notifications`; the read
  stamp's KEEP-PARKED status reversed.
- DEP-F15 (OR-20) — the seven lifecycle write wrappers are deleted
  (reverses pass C D-3's KEEP-PARKED).
- DEP-F16 (OR-21) — `IntervalSetSystem.clip` is deleted (reverses pass C's
  KEEP-PARKED).
- DEP-F17 (OR-22) — `parseWeek` is ruled live, and a 24:00 close is
  accepted.
- DEP-F18 (OR-24) — the impersonation slot is dropped and `/admin`
  redirects to `/admin/loyalty/rhythm`.
- DEP-F19 (OR-25) — no client writes `customers`; the server is the only
  writer (closes pass B flag (b)).
- DEP-F20 (OR-26) — a new `SeatSubject` variant, `WALK_IN`, and the
  server-written walk-in client record (flatten-spec §5.5 anticipated it).
- DEP-F21 (OR-27) — the lead-time sampler stays ungated (supersedes the
  blueprint's "gated off").
- DEP-F22 (OR-28) — the KEEP-PARKED status of the triaged items reversed.
- DEP-F23 (OR-29) — `csp-baseline.md`: no nonces, no Google Fonts, style
  `'unsafe-inline'`.
- DEP-F24 (OR-33) — a bare adapter no longer typechecks; the seed and the
  integration specs read through the real guard, and a malformed seeded
  body refuses the seed run (reverses edge-hardening DEP-11 / D-7).
- DEP-F25 (OR-34) — the web gains a custom `ErrorHandler`, and scrubbed
  issue structs leave the device.
- DEP-F26 (OR-35) — deploys refuse to run until the preflight passes.
- DEP-F27 (OR-37) — the event's shop is a picker and `/events` shows the
  shop at multi-shop tenants (takes back flip-4 F4-2's exclusions, extends
  pass E DEP-7).
- DEP-F28 (OR-38) — an event naming no existing shop is refused (retires
  half of flip-4 F4-1 (c)).
- DEP-F29 (OR-41) — the dev seed creates programs through `ProgramsSystem`
  (reverses flip-4 Q5).
- DEP-F30 (OR-42) — a position's shop scope is editable and never wiped,
  and `/careers` names the shops at multi-shop tenants (retires the F4-8
  wipe).
- DEP-F31 (OR-44) — a book or reschedule naming a reserved location id gets
  the parse refusal (invalid request) instead of not found.
- DEP-F32 (OR-46) — `avgCadenceDays` is a mean of shop calendar-day gaps,
  same-day pairs excluded.
- DEP-F33 (OR-47) — a visitor who never toggled the theme follows the
  system setting live.
- DEP-F34 (OR-48) — a tampered draft phone rehydrates as null, and the
  review step asks again.
- DEP-F35 (OR-50) — the E-18 refusal lines are edited (overrides pass E
  DEP-8's "no existing string changes" for three codes).
- DEP-F36 (OR-52) — the rhythm page words both refusals (reverses pass E
  §8.2).
- DEP-F37 (OR-53) — the programs status words are translated (reverses
  flip-4 F4-7).
- DEP-F38 (OR-54) — each `REPOSITORY_*` code is worded for what it means
  (reverses edge OQ-4's default).
- DEP-F39 (OR-56 b, the integrator's at landing) — the upcoming tile names
  the month and never the year: the 44 pt DS tile printed «юни 2030 г.» as
  «юни 20…»; a booking lies within the horizon, and the row's accessible
  name keeps the year (R59). Beside it (the fixer's note): on the shop's
  today the client fact line says «днес» / "today" in place of the weekday
  («Иван · днес, 11:00», `whenShort`), as the row's accessible name and
  the staff lines do; `visit-row.presenter.spec.ts` pins it in bg and en.

**Deferred** (the record's list — L-size work that deserves its own design;
none closes a live gap): a server-atomic visit save (the north star after
OR-4); adopting the walk-in record at registration; enforcing Trusted Types
and the DS map attribution footnote; App Check on `reportClientIssues` and
the callables; a nightly sweep that settles stale CONFIRMED visits (a
product decision); voucher issuing and selling; impersonation read-as (its
contract is in §6); an admin location writer, outside venues and the
programs admin's date/time fields; a generic `ListAnswer<E>` dropped count;
HSTS `preload`.

**The integration (2026-10-26).** Every package delivered; the integrator
resolved the open items the packages handed over (the record's ledger has
the per-ruling list) and ran the FULL gate on the integrated tree:

- **Bridges the contracts-first waves left:** the `@core/testing` double
  spec on the reshaped ports (`loadCouponGrants`, `markNotificationsRead`,
  `BarberDayRead`, the new doubles); the rest of the brands package's patch
  (`HourCount` through policy, seat outcome, the recompute job and the
  pipelines, `PersonKey` in the spellers and the dashboard, `E164.parse` at
  the landing); the seed's USED grants keeping their terms; the
  `WaitlistRequestReadPorts` remnant of `firestore-ports.ts`; the client
  card's glance keyed by held coupon ids; the `CUSTOMER_SEARCH_PORTS` token,
  its lazy wiring and the dashboard's merged account + record search
  (`client-search.ts`); the e2e `seedWaitlistMatch` helper; the dev seed
  writing the programs; `nx sync` (the theme, inbox and i18n references).
- **The wire allowlist:** `IDENTITY_OTP_RATE_LIMITED: ['retryAfterSeconds']`
  (OR-9 — the countdown restarts from the server's seconds, and
  `translateCodedError` / `wordFlowFailure` fill the copy's `{{seconds}}`
  from it) and `seatIndex` on `BOOKING_SLOT_UNAVAILABLE` (OR-12).
- **Rulings the packages flagged, decided:** DEP-F31 as the record words it
  (an unparseable shop id is `BOOKING_INVALID_INPUT` on `locationId`,
  unread, at book and reschedule); DEP-F39 (above); a second ACCOUNT holder
  riding a create as a guest sends no contact, so no account mints a second,
  walk-in record (OR-26); the grant offer rule moved into
  `CouponGrantSystem.offered` (Law 4: the pipeline only coordinates);
  `AppointmentLifecycleSystem.endsCancelled` and
  `VisitListSystem.soonestFirstByStart` deleted (no caller left); the
  console telemetry writes a client error line as ONE whole ERROR entry, so
  Error Reporting groups by the client's frame, never the server's stack
  (OR-34); the edge's throttle answers an inline `() => boolean`, no port
  function type outside the ports tier (Law 9.3).
- **`verify:csp`, first run end to end:** the Hosting emulator moved to
  port 5050 (macOS' AirPlay Receiver holds 5000); the smoke reads every
  response off the network (Chromium's cache never persists
  `Strict-Transport-Security`) and skips `blob:` URLs the page minted
  itself. Zero violations beyond the tolerated MapLibre Trusted Types
  report-only baseline (`docs/security/csp-baseline.md`).
- **The grep gates, refined, not weakened:** `save-visit-edit.pipeline.spec.ts`
  is excluded from the two wire-spelling gates (§4.2, §4.5) — `dayKey` there
  is the staff sheet's draft day (`StaffEditDraft`), never stored — and the
  §4.7 Error-subclass pattern matches `Error` as a whole word, so Angular's
  own `ErrorHandler`, which `ReportingErrorHandler` extends, is not taken for
  one. Every reference count is unchanged.
- **Package departures (each pinned by its specs):** `releasesHoldings`
  reads `(before, after)`; `GrantLifecycle.used` normalises a multi-use
  grant to no use left; `settleBill` writes nothing for a new grant line
  whose grant was not read; `settleDiscounts` refuses an unknown grant as
  `invalidCommand('grant')` too; `VoucherSystem.spendableSums` replaces
  `spendableSum` (OR-14/17, W0-ENGAGEMENT). The outcome dictionary keeps its
  own one-name file, and a note-only save still sends the batch first (the
  chair-wide MOVE / RESIZE_END ride along, as the dashboard's net pins —
  W0-VISITEDIT). The health row's disc uses the registry's
  `running_with_errors` (Material `error` is not in the pinned glyph set;
  W1-STAFF-DAY). The time sheet memoises per party
  start set, not per minute (W1-BOOKING). The editor's locale is read once,
  as the date picker's already was (W1-EDITOR). The i18n catalogues
  revalidate, the MapLibre report-only sinks are tolerated by name, the
  service worker is off under the emulators and the e2e hook is keyed on
  `environment.emulators.enabled` (W1-PLATFORM, `csp-baseline.md`). The
  preflight checks the zone through `ZonedTimeSystem.checkZone` (no
  `TimeZone.parse` exists) in its canonical spelling, requires exactly one
  `cloudfunctions.net` host and reads the location through the guard
  registry (W2-OPS); with P1–P2 in the functions predeploy, `loc-center` and
  the seven TTLs must be ready before deploy step 4. Walk-in rows are keyed
  by the record, never the name, «Без профил» is the event head's last fact
  line, and the new-client ✓ waits for a valid e-mail (W2-WALKIN-UI). The
  web's shared reads keep the default `AS_STORED`, which reads only the
  collections no guard covers and raises a defect on the guarded ones — a
  forgotten guard fails loudly instead of reading unguarded (W3-GUARDS). The
  «Нещо се обърка от наша страна» family line went to the four
  `*_REPOSITORY_FAILURE` / `OTP_DESTINATION_CORRUPTED` codes only;
  `REPOSITORY_*` keep OR-54's words (W3-VOICE).
- **The fixer round (review findings, each pinned by its specs):** a
  walk-in's record id is KEYED — HMAC-SHA-256 under the Secret Manager
  secret `WALKIN_ID_KEY` (`WalkInKeyPorts.walkInHash`, bound to
  `commitBooking` and `staffEditAppointment` only), never the plain hash a
  client could brute-force a guest's phone back out of (OR-26 "Built"); the
  secret is the owner's to create before the first functions deploy
  (runbook step 4), and the emulator reads a fixed TEST value that
  `write-functions-env.mjs` writes to the build's `.secret.local` for a
  `demo-*` project (never deployed). The page's issue reporter drops the
  measured MapLibre report-only baseline (`MAPLIBRE_REPORT_ONLY_SINKS`, ONE
  list with the CSP smoke's, behind its own Node-loadable entry point
  `@creativo/infrastructure/firebase-app/csp-baseline`; OR-30 "Built").
  The day's health row follows OR-2's copy placement — the meta is
  `staff.day.unreadableHint`, the count sits under the chair's name — and
  its `role="status"` card nests in a plain `<li>`, so the all-day strip
  stays a list. Every inbox row is described (`aria-describedby`) by its age
  and, unread, «Ново» (`notifications.unread`, OR-19's copy addendum). A
  shop's name has one wording helper, `shop-name.format.ts`
  (`@creativo/features/shared/catalog`), read by `/careers`, `/events` and
  `/admin/programs`, each reading its data language as
  `Tag.or(Locale, lang, Locale.Bg)`.
- **Baselines regenerated after viewing old and new (exactly the rulings'
  differences):** `auth-identify-{light,dark}` and
  `account-dashboard-populated-{light,dark}` (OR-51: «Записвай и управлявай
  часовете си в салона.», «Ще ти изпратим…», «Продължавайки, приемаш…»,
  «Избери бръснар, услуга и час», «Завърши профила си»);
  `appointments-list-populated-{light,dark}` (OR-56: no one-pill rail, the
  tile «юни / 1», the line «Иван Колев · сб, 10:00»).
- **The dev-stack smoke** (`pnpm run dev`, custom-token sign-in, the seed
  restored and the stack stopped after): the staff day's health row for a
  chair holding a malformed visit («1 посещение не може да се покаже»); a
  coupon applied and saved (grant `USED`, `usedNote appointment:<id>`),
  removed (`ACTIVE`), re-applied (`USED`) and the visit no-showed (`ACTIVE`,
  the bill's grant line dropped); `/account/notifications` listing and
  receipting both unread rows once; the OTP countdown at «Нов код след 60
  сек»; `/admin` → `/admin/loyalty/rhythm`; the event shop picker («Без
  конкретен салон», Център, Младост); the position chips («Всеки салон»);
  `/careers` naming the shop with «Отворена»; `/account`'s upcoming card
  skipping a visit begun an hour earlier on its shop's clock. The walk-in
  «Нов клиент» with phone and e-mail is the e2e journey
  `staff-walk-in.spec.ts`.
- **Follow-ups (no ruling needed, none blocks):** the health rows read the
  shown day's lanes only — the three-day and week grids give another visible
  day no row; a hop to a peer visit does not re-probe its bill's grants; a
  stored `WALK_IN` seat reopens as a guest by label (keying it by its record
  and carrying the record's contact would keep the link through an undo);
  the staff edit's audit fact does not target an added walk-in's record;
  `StaffDashboard.commandsFor` and `reversibleSave` survive only for the
  characterisation specs; `ClientIssue.release` is sent as `null` (no build
  id stamped); the Firestore connectivity probe's `cleardot.gif` and the
  service worker's Trusted Types report are listed in `csp-baseline.md`;
  `libs/ui/patterns` `gauge.css` sits 45 bytes over its 10 kB warning
  budget (unchanged); the OR-34 ops half (the `client_issue_count` metric
  and alert) and the privacy-policy line are the owner's (runbook).

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
# and §4.10 (since pass F, OR-33: the read guard is a required parameter, the
# unguarded registries live in test support only)
# the emulator journeys share ports — run ONE AT A TIME:
pnpm run verify:p0
pnpm run test:emulator
pnpm run e2e:web
pnpm run verify:csp   # since pass F (OR-31): the static hash gate on the production
                      # and csp-smoke builds, then the hosting-emulator smoke
# before any deploy, against the target project (OR-35, DEP-F26; also the
# hosting and functions predeploy of firebase.json, which refuses the deploy):
pnpm run preflight --project "$PROJECT_ID"
```

**`verify:csp` and the preflight (pass F).** `pnpm run verify:csp`
(`docs/security/csp-baseline.md`) builds production and the `csp-smoke`
configuration, proves each `index.html`'s inline-script hashes against
`firebase.json`'s `script-src` (`tools/verify/csp/check-csp.mjs` — CI runs
this static half after every build), writes the emulator superset config
(`tools/verify/csp/emulator-config.mjs`, its difference from production
asserted) and runs `apps/web/e2e/csp/csp-smoke.spec.ts` on a desktop and a
Pixel 7 under Hosting: any violation of either disposition, a missing
security header or a wrong `Cache-Control` fails it. It starts every
emulator, Hosting included, so it runs alone like the journeys above. The
production preflight (`tools/verify/preflight/preflight.mjs`, runbook §3)
reads the target project — P1 the default location and its zone, P2 the
seven TTL policies `ACTIVE`, P3 every declared composite `READY`, P4 the
bundle names the project, P5 `connect-src` names its callables host, P6 no
emulator variable and no placeholder or `demo-*` project — and exits 1
unless every row passes. Its pure checks run in `run-many -t test`
(`verify-tools`, `preflight.spec.mjs`); against the emulator project it
stops at P6 by design, so the gate on a tree with no hosted project is that
spec, and the run against the real project is the release step before any
deploy. `CREATIVO_SKIP_PREFLIGHT=1` is the loud escape hatch, never a habit.

**Pre-existing red — none (since pass E, 2026-10-25).** Every typecheck,
unit, emulator and e2e red of the old baseline was fixed at its root cause
(pass E, end of §3.3): typecheck is green on all projects (40 since pass
F), `run-many -t test` has 0 failures, `e2e:web` has 0 failures. Anything red is a
regression. **Known flakes under load** (judge each on a solo
`--repeat-each=3` run: `START_LOGGING_EMULATOR=true pnpm exec firebase
emulators:exec --only firestore,auth,functions,storage --project
demo-creativo-test "pnpm nx e2e web -- e2e/<spec> --repeat-each=3"`):
`auth-onboarding.spec.ts:106`, `appointments.spec.ts:152`, the landing
hero screenshot; and the glance's barber test cannot seed a visit still to
come today when it runs after ~23:15 shop time (pass E ledger §8.4 —
re-run it after midnight). Under `run-many -t test --parallel=3` the heavy
`staff-dashboard`, `staff-client-card` and `marketing-landing` specs (and
`client-booking`'s `booking-return-url.spec.ts` property case) can time
out — re-run the project alone before calling it a regression. Typecheck
after `rm -rf dist/out-tsc`.

**Reference numbers after the pass-F fixer round (2026-10-26, the FULL
gate after the review's seven findings, §3.3 "The fixer round")** — a drop
without a reason is a lost case: `nx sync:check` up to date (the round's
new edges synced); layering **923 files and 4,106 import edges**; typecheck
**40 projects, all green**; 44 projects lint, 0 errors (245 warnings by a
per-project count, unchanged); `run-many -t test` 44 test targets,
**13,314 passed, 0 failed** (13,203 vitest + `verify-tools` 111);
`lint-rules` 319 tests; ecs-core **6,383 tests, 98.42 % statements**
(14,730–14,731/14,966 — the auth-flow property cases' unseeded draws
reach two default-branch `break`s on some runs and not others, so the
covered count moves by one or two between identical runs; no statement of
a file the round touched is uncovered); functions **1,003 tests**;
`seed-tools` typecheck; `lint:styles`; `build web` initial **581.63 kB**
(157.92 kB transfer) + `verify:bundle`; the functions dist's four runtime
dependencies; `build showcase`; runbook §4.2 28 `ok`, §4.3 22, §4.4 17,
§4.5 6, §4.7 24, §4.8 27, §4.9 25, §4.10 20 (no reference count changed);
`verify:csp` — both builds' hashes match, the Hosting smoke **10 passed**;
the preflight's spec 32 passed; `verify:p0` (a)–(f); `test:emulator`
**69 + 312**; `e2e:web` **63 passed, 0 failed** (the walk-in journey under
the emulator's TEST walk-in key).

**Reference numbers on the pass-F tree (2026-10-26, the integrator's FULL
gate — `decisions/2026-10-26-owner-rulings.md`, ledger)** — a drop without a
reason is a lost case: `nx sync:check` up to date; layering **923 files and
4,106 import edges**; typecheck **40 projects, all green** (`ui-theme` is
new); 44 projects lint, 0 errors (245 warnings by a per-project count);
`run-many -t test` 44 test targets, **13,291 passed, 0 failed** (13,180
vitest + `verify-tools` 111, the preflight's spec among them); `lint-rules`
13 files and 319 tests; ecs-core 327 files, **6,380 tests, 98.43 %
statements** (14,732/14,966); functions 38 files, 998 tests; `seed-tools`
typecheck; `lint:styles`; `build web` initial **581.67 kB** (158.79 kB
transfer) + `verify:bundle`; the functions dist's four runtime
dependencies; `build showcase`; runbook §4.2 28 `ok`, §4.3 22, §4.4 17,
§4.5 6, §4.7 24, §4.8 27, §4.9 25, §4.10 20; `verify:csp` — both builds'
inline-script hashes match `script-src`, the Hosting smoke **10 passed**
(desktop + Pixel 7), no violation beyond the MapLibre report-only baseline;
`verify:p0` (a)–(f); `test:emulator` **69 + 312**; `e2e:web` **63 passed,
0 failed** (61 + the inbox page and the walk-in journey).

**Reference numbers on the pass-E tree (2026-10-25, the integrator's FULL
gate — `flips/pass-e-leftovers.md` §8.5)** — a drop without a reason is a
lost case: `nx sync:check` up to date; layering **900 files and 4,006 import
edges**; typecheck **39 projects, all green**; 43 projects lint, 0 errors
(236 warnings by a per-project count — no modified file's warnings
changed against `6d64f69f`); `run-many -t test` 43 test targets, **12,718
passed, 0 failed** (12,639 vitest + `verify-tools` 79); `lint-rules` 13
files and 319 tests; ecs-core 317 files, **6,115 tests, 98.34 %
statements** (14,236/14,476); functions 37 files, 964 tests; `seed-tools`
typecheck; `lint:styles`; `build web` initial **576.13 kB** (156.88 kB
transfer) + `verify:bundle`; the functions dist's four runtime
dependencies; runbook §4.2 28 `ok`, §4.3 22, §4.4 17, §4.5 6, §4.7 24,
§4.8 27, §4.9 25; `verify:p0` (a)–(f); `test:emulator` **65 + 301**;
`e2e:web` **61 passed, 0 failed** (41 + the 19 former baseline failures + `programs.spec.ts`).

**Reference numbers on the edge-hardening tree (2026-10-25, the FULL
gate after the review's six fixes, the fixer — `flips/edge-hardening.md`
§8.6; the integrator's §8.4 numbers before them in brackets)** — a drop
without a reason is a lost case: 43 projects lint, 0 errors (239
warnings); typecheck 39 projects, only `patterns`; `run-many -t test` 43
test targets, **12,615 passed** (12,536 vitest + `verify-tools` 79)
[12,589] + the 6 baseline reds; `lint-rules` 13 files and 315 tests;
ecs-core 317 files, **6,048 tests, 98.33 % statements** (14,207/14,447)
[6,028; 14,193/14,433]; functions 37 files, 955 tests [954]; `verify:p0`
(a)–(f); `test:emulator` **65 + 253**; `e2e:web` 41 passed + the 19
baseline failures; `build web` initial **576.09 kB** (156.91 kB transfer)
[576.24 kB]; the functions dist's four runtime dependencies; layering
**900 files and 4,001 import edges** [3,998]; runbook §4.2 28 `ok`, §4.3
22, §4.4 17, §4.5 6, §4.7 24, §4.8 27, §4.9 25.

**Reference numbers on the pass-D tree (2026-10-25, the FULL gate, after
the review's six fixes and the second review's eight — plan §9.3 Fixer,
second round)** — a drop without a reason
is a lost case: 43 projects lint, 0 errors (239 warnings); typecheck 39
projects, only `patterns`; `run-many -t test` 43 test targets, **12,289
passed** + the 6 baseline reds (`web:test` 18 and `verify-tools` 79
included; 12,283 on the integrator's second round, + 4 ecs-core cases in
the first fixer round, + 1 `staff-client-card` and + 1 `client-onboarding`
in the second);
`lint-rules` 13 files and 315 tests; ecs-core 314 files, **5,806 tests,
98.27 % statements** (13,937/14,182); `verify:p0` (a)–(f); `test:emulator`
**65 + 253**; `e2e:web` 41 passed + the 19 baseline failures; `build web`
initial **574.83 kB** (156.97 kB transfer; −25.32 kB against pass C, the
L-1 splits — pass D plan §9.3); the functions dist's four runtime
dependencies; layering **895 files and 3,973 import edges**; runbook §4.2
28 `ok`, §4.3 22, §4.4 17, §4.5 6, §4.7 24, §4.8 27, §4.9 25 (the same with
`git grep --untracked`); pass D's plan §5 items 2(a)/2(b)/2(c) = 15/17/0
reviewed hits (2(a) was 18 before the second fixer round).

**Reference numbers on the pass-C tree after its second review round
(2026-10-24, the FULL gate)** — a drop without a reason is a lost case: 43
projects lint, 0 errors; `run-many -t test` 42 runs, **11,922 passed** + the
6 baseline reds (11,883 before the first review round, +34, then +5);
`lint-rules` 13 files and 290 tests; ecs-core 289 files, **5,666 tests,
98.22 % statements** (13,806/14,056); `verify:p0` (a)–(f); `test:emulator` **65 + 253** (pass B
removed the impersonation adapter's integration spec); `e2e:web` 41 passed

- the 19 baseline failures; `build web` initial **600.15 kB** (162.49 kB
  transfer); the functions dist's four runtime dependencies; layering **703
  files and 3,305 import edges**; runbook §4.2 28 `ok`, §4.3 22, §4.4 17,
  §4.5 6, §4.7 24, §4.8 27, §4.9 25; pass C's plan §5 items 2/3/4 = 65/20/24
  reviewed hits.

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

- Production deploy: `docs/production-deploy.md` (the checklist — setup,
  bootstrap, order, verification, rollback; the preflight first).
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

- **Ruled 2026-10-26 — the owner rulings (pass F,
  `docs/architecture/decisions/2026-10-26-owner-rulings.md`).** The owner
  delegated every open decision; OR-1 … OR-56 rule every owner item this
  record carried (end of §3.3, each list names its OR id) and every open
  question of the plans, with DEP-F1 … DEP-F38. The pass B owner flags, the
  flip-4 OQ-11 deploy check and the decision-extraction tie orders that used
  to wait here are among them (OR-24, OR-25/OR-26, OR-35, OR-36, OR-18,
  OR-22, OR-23). The rulings' standing contracts follow.
- **The impersonation read-as contract (OR-24).** Today impersonation is
  the server ledger only, with no read-as: the callables write an inert,
  audited `impersonationSessions` ledger that nothing consumes (no token, no
  rule), the web banner and the `admin/impersonation` lib are deleted, and
  `/admin` redirects to `/admin/loyalty/rhythm`. A future read-as ships ALL
  of the following in ONE change, or none of it: a custom token of at most
  15 minutes carrying the claims `{ imp, impBy, impScope }`; a banner that
  reads those claims from the ID token (no Firestore read) — «Действаш като
  {{name}} · Край» / "Acting as {{name}} · End"; rules that deny every write
  under `imp` with the `READ_ONLY` scope; and `Actor.impersonator` audit
  rows. Building it is deferred (the record's deferred list, item 7).
- **The two-zone ordering rule (OR-43, pass D OQ-3).** Every visit is judged
  on its OWN shop's wall clock (Law 7.2, the physical chair invariant), and
  rows, lanes and the agenda on the day's zone. The day a tenant has shops
  in two zones, a pooled cross-zone ORDER (the staff search, «Скорошни», any
  list that merges visits of several shops) sorts on `utcEpochMs`, never on
  wall-clock minutes of different zones; placement math stays on the local
  coordinates.
- **Flagged by the record — decided on the safest reversible default; the
  owner may reverse each:** impersonation kept as a ledger — if it will
  never ship, delete it end to end (OR-24 option C, reversible through git);
  the production default location id stays `loc-center` (OR-35 — one
  constant plus one document, which the preflight then checks); one «ти»
  voice, «бръснар», «Опитай пак» (OR-51, copy only); the privacy-policy line
  for the client issue sink ("diagnostic data under legitimate interest,
  30-day Cloud Logging retention, no personal identifiers") is the owner's
  to publish (OR-34); and the orchestrator's override of OR-13's flagged
  default — a no-show gives back the grant and the voucher draw (DEP-F10b,
  end of §3.3).
- **Still open — found by pass E, not ruled by the record** (pass E §7.2):
  N-1, `subjectCustomerId` cannot be required on `VisitRowOptions` /
  `VisitCardOptions` (the client's appointments page relies on
  `VisitStorySystem.subjectRecordOf`'s absent path) — keep it optional, or
  make the absent case an explicit contract value; N-2, the `coupons` write
  grant (`isAdmin`) has no client writer, but a dated rules case pins an
  admin's save — deny it on the owner's word only; N-5, a `NO_SHOW` or
  same-day `COMPLETED` reopen (and a seat-level reopen inside a cancelled
  party) checks no collision against appointments booked into the freed
  chair — refuse such a reopen, or let the shop knowingly overlap.
- Decision-extraction plan (`docs/architecture/flips/law-10-decision-extraction.md`)
  §8 — every question CLOSED: the catalog component specs' fixture literals
  gained the three figure fields (OQ-1); the cue rule
  (`AchievementsSystem.completesWithVisit`) and the detail/count rule
  (`countsToward`) stay two functions, documented side by side (OQ-2); the
  service detail sheet's math and the history read-policy constants were
  carried and closed by pass C (OQ-3, OQ-6); those applied defaults are
  affirmed (OR-43); the keys built from display words, the glance voucher
  sum and the tie orders are ruled — coupon-id keys (OQ-4, OR-15), every
  currency on the glance (OQ-5, OR-17), UTF-16 code-unit ties everywhere
  (OQ-7, OR-18); OQ-8 is moot — `samplePeriods` delegates to
  `StreakSystem.track`, proven equivalent on the admin sample's states.
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
- `flatten-spec.md` §10 OQ-3…OQ-12 proceed on their documented defaults
  (Role/AuthStage claim casing, `LocalizedText` nested,
  D29 contact sync/merge, `EndMinute`, one shop day per appointment,
  `attendanceState` values, backfill job ids, media prefixes, D17
  seconds + nanos, no index change in the flatten pass); OQ-2 is CLOSED
  (2026-10-26, OR-35): the production default id stays `loc-center`,
  checked by the preflight's P1 before every deploy, and the cron trigger
  zone stays the deploy-time `CRON_TIME_ZONE` Phase 4a gave it.
- Flip-1 plan open questions (its §open questions) proceed on the plan's
  defaults: customer ids sit beside `subjectUserIds`; grant burn/restore
  deferred to its own commit (ruled and built 2026-10-26: burned at save,
  given back on removal, cancel or no-show — OR-13 / DEP-F10 / DEP-F10b;
  flip-1 §10 Q2) (the reopen busy write landed with pass E,
  DEP-5; trigger `retry: true` for the three projection triggers with the
  edge hardening and for the four other capacity triggers with pass E,
  2026-10-25, end of §3.3);
  `cancelWaitlist` kept `{ code }` until the Phase 4a wire flip (it now
  refuses with `CancelWaitlistRefusalCode` structs keyed by `errorCode`);
  customers writes per flatten-spec §5.5 (ruled 2026-10-26: the server is
  the only writer — OR-25 / DEP-F19, OR-26 / DEP-F20; flip-1 §10 Q7); the
  `leadTimeSampling` gate and the refusal's busy body (flip-1 §10 Q3) ruled
  — ungated (OR-27 / DEP-F21) and declined (OR-12).
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
