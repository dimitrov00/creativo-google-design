# tools/seed/fixtures

The home of the dev seed's document bodies as TypeScript (ECS migration,
`docs/architecture/ecs-migration.md` §6 Phase 3, Risk 1, Risk 8). Each Phase
3b flip moves the bodies of the collections it reshapes here, in the same
commit that changes their shape.

## What is here (flip 1 — booking core; flip 2 — identity and accounts; flip 3 — loyalty; the post-migration cleanup; the programs, OR-41)

| File                       | Collections                                                                                                                                                                                             | Exports                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog.fixtures.ts`      | `serviceCategories`, `locations`, `barbers`, `services`                                                                                                                                                 | the catalogue as `Seeded<Id, X>[]` rows, the brand helpers and `Body<X>` the others share; the shops' zone, read back off their bodies (`timeZoneOf`, `SHOP_TIME_ZONE` the default shop's)                                                                                                                                                                        |
| `schedules.fixtures.ts`    | `barberSchedules`, `scheduleExceptions`, `barberBusy`                                                                                                                                                   | `SCHEDULES`; `closedDayBody`, `busyDayBody`, `busyKeyOf`                                                                                                                                                                                                                                                                                                          |
| `appointments.fixtures.ts` | `appointments`, `appointmentPhotos`                                                                                                                                                                     | the authored visit (`VisitIntent`, `SeatIntent`: the seats' stored fields, `accountSeat`/`guestSeat` occupant slices, `SCHEDULED_SEAT`/`WORKED_SEAT`/`NO_SHOW_SEAT`/`calledOffBefore`/`calledOffAt` outcomes); `appointmentBody(plan)` (the root lifecycle summarised from the seats), `appointmentPhotoBody(plan)` and their plan types                          |
| `book.fixtures.ts`         | `appointments` (authored), `users` and `customers` (who)                                                                                                                                                | `CLIENTS`, `contactOf`; `HISTORY_PLANS` (one rhythm per client, drawn by `history.mjs`); `dayVisits(links)`, the hand-written visits of today and the next two days; `walkInVisit(placed)`                                                                                                                                                                        |
| `settings.fixtures.ts`     | `settings` (`bookingPolicy`)                                                                                                                                                                            | `BOOKING_POLICY` (the flat `BookingPolicySettings` body, all seven fields, `autoConfirm` included), `CANCELLATION_WINDOW_HOURS`                                                                                                                                                                                                                                   |
| `promotions.fixtures.ts`   | `coupons`, `couponGrants`, `giftVouchers`                                                                                                                                                               | `COUPONS`; `couponGrantBody`, `giftVoucherBodies`                                                                                                                                                                                                                                                                                                                 |
| `programs.fixtures.ts`     | `positions`, `courses`, `events` (OR-41)                                                                                                                                                                | the admin forms (`POSITION_FORMS`, `COURSE_FORMS`, `OPEN_STUDIO`, `CRAFT_NIGHT`) and the engine that stores them — `positionDocument`, `courseDocument`, `shopEventDocument(form, localDate)`: `ProgramsSystem` judges each form as the admin save does, an event's instant `ZonedTimeSystem.toUtc` on its shop's zone                                            |
| `waitlist.fixtures.ts`     | `waitlistRequests`                                                                                                                                                                                      | `waitlistRequestBody(plan)`                                                                                                                                                                                                                                                                                                                                       |
| `customers.fixtures.ts`    | `customers` (D29)                                                                                                                                                                                       | `customerIdOf(uid)` (`CustomerId.forUser` over sha256), `seededCustomerBody` (`SEED` origin)                                                                                                                                                                                                                                                                      |
| `users.fixtures.ts`        | `users` (flip 2)                                                                                                                                                                                        | `clientUserBody(contact, birthDate)`, `staffAccountBody`, `registeredAccountBody` (`REGISTERED`, `ACTIVE`, search keys from `SearchFieldsSystem`)                                                                                                                                                                                                                 |
| `loyalty.fixtures.ts`      | `badgeCategories`, `badgeSeries`, `seasons`, `tierDefinitions`, `rewardsCatalog`, `streakDefinitions` (+ `versions`), `loyaltyAccounts` (+ `badgeProgress`, `seasonProgress`), `clientJournal` (flip 3) | one builder per catalogue body (`seasonBody` moves a window and its announcement by whole days), `seedRuleVersionBody`, `loyaltyAccountBody`, `badgeProgressBody`, `seasonProgressBody`, `journalEntryBody` and the journal's slice builders (`ENGINE_ACTOR`, `DESK_ADMIN`/`DESK_STAFF`, `ruleSource`, `pointsEffect`, …), the record builders, `qualifierCounts` |

The plan logic that decides WHERE and WHEN stays in the `.mjs` modules
(`catalog.mjs`, `calendar.mjs`, `fixtures.mjs`, `history.mjs`,
`appointments.mjs`, `promotions.mjs`, `programs.mjs`, `waitlist.mjs`,
`loyalty.mjs`). A visit
is authored here in the entity's own vocabulary — no symbolic code and no
table turning one into a stored tag; the plan logic places it on the shop's
calendar (`calendar.mjs`: `ZonedTimeSystem` and `LocalDate` on the default
shop's zone) and the catalogue, hands these builders a plan, and the builders
return the document. (The loyalty: `loyalty.mjs` folds the book — the visits, the
levels, the tiers, the rhythm `StreakSystem.trace` projects — and hands each
builder plain values; an account, its progress and its journal are keyed by
the client RECORD, `customerIdOf(uid)` (D29), and every instant beside its
shop day is one reading of the shop's clock (T5).) (The programs: each body
is ENGINE OUTPUT — the admin form an editor would type, judged by
`ProgramsSystem` exactly as the admin save judges it, an event's instant
converted once on its shop's zone — and `programs.mjs` places the two
events on the shop's calendar, two weeks ahead and a month behind;
`programs.spec.mjs` holds every body to the system and to the rules' key
sets.) (The accounts: `fixtures.mjs` hands `clientUserBody` each client's
contact and the birth date its fixture places; `seed-dev-catalog.mjs` writes
`staffAccountBody`; `tools/verify/p0/verify-p0.mjs` builds its sysadmin with
`registeredAccountBody`. There is no second copy of the search-prefix rule:
every body's keys are `SearchFieldsSystem.searchFields`'.)

## The rule for every file here

- One file per collection family, named after it. A file exports plain
  bodies — the entity minus its `id`, never a mapper's input (Law 5).
- Every exported body is checked against its entity:

  ```ts
  import type { Service } from '@core/entities';

  export const classicCut = {
    // …every field of the entity but `id`
  } satisfies Body<Service>;
  ```

  `Body<X>` (`catalog.fixtures.ts`) is `Omit<X, 'id'>` taken per variant:
  TypeScript's `Omit` is not distributive, so a plain `Omit` of an
  archetype with a variant slice (a lifecycle, a coupon's value) would keep
  only the keys every variant shares. `satisfies` does not exist in the
  `.mjs` the seed is written in, which is why the bodies live here:
  `pnpm nx typecheck seed-tools` (inferred from `tools/seed/tsconfig.json`,
  over `tsconfig.fixtures.json`, which references `libs/ecs-core`) fails on
  a stale shape instead of a query returning a partial set against the
  emulator.

- Every field is spelled exactly as the entity names it (Laws 6 and 7: flat
  root fields, `*UtcMs` instants, `localDate` days, `*Minutes` times of day,
  `*Cents` beside a `currency`). Instants are computed from the shop's
  `timeZone` once, at the builder, through `ZonedTimeSystem`; days are
  literal `YYYY-MM-DD` strings — no `Date.now()`, no `new Date()`, no date
  library in a body (the fixtures' day is `FIXTURE_TODAY`, 2026-09-28, in
  `@core/testing`). No temporal body carries a zone (Law 7.2).
- Every value is a branded primitive built by its companion (Law 7.4); a
  fixture literal the companion refuses is a defect (`sure`, `present`).
- Ids that a key is built from (`BusyKey.of`, `CustomerId.forUser`,
  `StreakDefinitionVersionId.forVersion`) are built by their companion,
  never spelled by hand.
- The TTL `purgeAt` is never part of a body: the writer stamps it through
  `purgeAtFor` (`apps/functions/src/adapters/firestore-ttl.adapter.ts`,
  flip-1 plan F1-7), the same function the server's `firestoreCommitPlan`
  calls.
- The `.mjs` writers (`tools/seed/*.mjs`, `tools/seed-dev-catalog.mjs`)
  reach these bodies through the esbuild bundle of `load-domain.mjs`
  (`SEED_PLAN_MODULES`), which resolves the `@core/*` and `@creativo/*`
  aliases; the specs import them directly (vitest resolves both).

`seed-tools` is tagged `type:tooling`, whose row in the root
`eslint.config.mjs` lets it depend on `type:tooling`, `type:util` and
`type:domain` — so `import type { X } from '@core/entities'` (the archetype
noun, no `Entity` suffix — flatten-spec N1) is legal here, and nothing of
`type:infrastructure` is (a fixture is a document body, not an adapter's
input).

## Not here

The loyalty catalogue the seed reads BY PATH (`catalog.json`) and the gift
vouchers its own bodies are held to (`vouchers.json`) are test fixtures
shared with the specs: they live in `libs/ecs-core/src/testing/fixtures/loyalty/`
and are exported from `@core/testing` (with the two account holders'
documents, `account-georgi.json` / `account-martin.json`, which the e2e
seeds and `loyalty.spec.mjs` holds the projection's shape to). Every one is
the flat stored body (Law 5). `loyalty.fixtures.ts` rebuilds each catalogue
document field by field (so a field the entity no longer has never reaches
the emulator), and the seed reads its documents back through the two
run-time checks it keeps (`readLoyaltyWrites`:
`LoyaltyCatalogSystem.validate`, `StreakRule.parse`). The vouchers are
authored here (`promotions.fixtures.ts`, each `satisfies GiftVoucher`), and
`promotions.spec.mjs` holds what the seed writes on the fixtures' day to
`vouchers.json`, document for document.
