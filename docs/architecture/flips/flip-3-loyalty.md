# Flip 3 — loyalty and invitations (Phase 3b)

**Date:** 2026-10-22 · **Status:** INTEGRATED 2026-10-22 — all seven packages merged, the full gate of `HANDOFF.md` §4 green but the baseline reds, the §6 grep gate PASS, the §8 dev smoke run; the integration record is §8.1 and the case ledgers are §11. Written as the PLAN on `6d43e1c` (flip 2 integrated, the tree clean but for this file); the contract the parallel packages built against. · **Law:** `CLAUDE.md` Laws 1–9 and the eight
`.claude/rules/*.md` (`ecs-ports.md` is Law 9's template); this plan never
overrides them. · **Sources:** `docs/architecture/ecs-migration.md` §1.4,
§2.3, §3.1–3.4 (`loyaltyAccounts`, `clientJournal`, `streakDefinitions`,
the catalogue, index #21), §4.1 (`publishStreakDefinition`), §6 Phase 3 /
Phase 4, §9 D14 and D29; `docs/architecture/flatten-spec.md` §3.5 (every
loyalty name), §2.3 T1–T9 (T5: an instant and its shop day written once,
from the same reading), §4.2 (`StreakPublishErrorCode`), §4.3 (wire
freeze), §5.4–5.5 (the D29 re-key of flip (3)); the runbook
`docs/architecture/firestore-runbook.md` §1 (matrix), §4.3 (this flip's
gate); `docs/architecture/flips/flip-2-identity.md` (the worked example:
method, contracts, ledgers and the Law 9 block are copied from it) and
`flip-1-booking-core.md`. Every file below was located by `git grep` on
`6d43e1c`; line anchors are left out on purpose (they drift).

**Law 9 in this plan, once.** Every port this flip adds or consumes is a
member of a focused bundle record declared in
`libs/ecs-core/src/ports/*.port.ts`; every web `InjectionToken` and every
adapter factory is typed against exactly one bundle (an adapter serving
several returns their `&`, never a local alias); the one new pipeline's
`XPorts` is an intersection of named bundles and nothing else; no
`Pick`/`Omit` of a `*Ports` type appears anywhere in this plan or in the
code it produces (`creativo/no-sliced-ports`, §6's Law 9 gates). The bundle
map is §3.1.1.

A flip is the read/write closure of its collections, landed as **one
commit**: pipelines, server adapters, every surviving reader, web bundles,
the consuming stores and presenters, rules, indexes, seed fixtures, the e2e
seed. Greenfield: no dual shape, no backfill, no fallback reader; the
emulator is wiped and reseeded (`pnpm run seed:dev`; `e2e:web` reseeds
itself).

---

## 0. Decisions this plan takes (read first)

| #     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Why                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| F3-1  | **What "frozen" means** (F1-1/F2-1, unchanged). Every single-request outcome equals today's: for `publishStreakDefinition` the documents a request leaves (the head, the new version, the `withdrawnAt…` stamps, the audit row), the answer (`published`/`withdrawn`/`refused` with today's words, `fields` and `earliest`), the thrown status and `details`, the `'rhythm rule write failed'` log line; for every web read the words, numbers and test ids on screen. The stored BYTES change (that is the flip). Three deliberate departures, each pinned (§11.4): **(a)** the D29 re-key couples the client card's loyalty reads to its client-record read (F3-6): a failed or timed-out `loadCustomerForUser` now fails the account, progress, season, feed and ledger slices (today they read by uid, independently of the record), and a test rig without `CUSTOMER_PORTS` shows no loyalty — on production wiring with a readable record the card is unchanged, because every account holder's record id is `CustomerId.forUser(uid)` (`REGISTRATION`, `FIRST_BOOKING`, `SEED`); **(b)** read-side validation of stored loyalty bodies goes (Law 5, zero mapper; flip 2's three `profile.adapter` mapper cases are the precedent): a stored account, progress, head, version or journal row is answered AS STORED — today a malformed badge/season progress doc and an unparsable journal row are silently skipped, a malformed account, head or version fails its read. **The catalogue is not part of this departure:** its whole-catalogue check stays, as the pure `LoyaltyCatalogSystem.validate` the client-card store runs over the port's UNMAPPED answer (the same call puts every list in today's display order; a refused catalogue fails the catalogue slice exactly as today's reader failed its read — F3-10, §3.5). Every writer after this flip writes the entity type: the pipeline's `WriteOp`s; the seed, whose bodies are built in the NEW `tools/seed/fixtures/loyalty.fixtures.ts`, each builder `satisfies Omit<X, 'id'>` against `@core/entities` (type-checked by `pnpm nx typecheck seed-tools`, as `promotions.fixtures.ts`), and whose runtime self-check `readLoyaltyWrites` keeps exactly `LoyaltyCatalogSystem.validate` over the catalogue and `StreakRule.parse` over every head rule and version (no ecs whole-body guard exists for the account, progress or journal row, and none is added — their per-document refusal cases are `dead:` with this reason, §11.5). Each adapter spec pins "a stored body is answered as stored"; **(c)** the `'rhythm rule write failed'` log line for a version number a concurrent writer took: `firestoreCommitPlan` answers that `ALREADY_EXISTS` as the value `RepositoryError.alreadyExists(path)` (the thrown cause is gone), so the line's `error` field reads `` `${errorCode} ${path}` `` (e.g. `'REPOSITORY_ALREADY_EXISTS streakDefinitions/cadence/versions/000002'`) instead of today's `String(firestoreError)`; the message, the level, the status and `details` are unchanged, and every OTHER commit failure keeps today's `String(cause)` (§3.3). Pinned by `loyalty.wire.spec.ts`. | Task constraint; flip-2 F2-1.                                              |
| F3-2  | **Out of this flip** (each Phase 4 or later, recorded so nobody builds it): the loyalty engine — no production writer of `loyaltyAccounts`, its progress subcollections or `clientJournal` exists (D14 unbuilt, blueprint §1.4; the seed and the A0 fixtures are the only writers); the `redeemInvitation`/`createInvitation` pipelines and callables with the `invitations` rules tightening and its web switch (HANDOFF §3.3); `users/{uid}/rewardProgress` and `REWARD_PROGRESS_READER` (dormant, not a flip-3 collection); the client's own loyalty view; `callableClient` (the publish wire stays frozen, F3-3); deleting `libs/domain/engagement` (Phase 4 deletes the lib whole — this flip leaves its loyalty classes importer-free, as flip 2 left `libs/domain/models`); `RewardCatalogItem.redeemedCount`'s writer (no redemption writer exists); a referral → loyalty credit (nothing computes `client.referrals.completed` from invitations today; wiring it would be new behaviour).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Risk: a rule or a writer lands in the commit of the surface it serves.     |
| F3-3  | **The publish callable's wire is frozen in both directions** (F2-3 applied). Request: `{ op?: 'publish' \| 'withdraw', requestId, streakId, baseVersion, draft, effectiveFrom, transition: 'grandfather' \| 'recompute', previewHash? }` / `{ op: 'withdraw', requestId, streakId, version }` — the `draft` stays today's NESTED legacy body (`qualifier: { kind }`, `interval: { kind, days }`, `bookingHold: {…}`, `protections: {…}`, `clientPause: {…}`, `repair: {…}`, lowercase `excuses`/`onBreak`; its own `version`/`effectiveFrom` are sent and not read). Answers: `{ kind: 'published', version, effectiveFrom, direction: 'looser'\|'stricter'\|'mixed'\|'neutral'\|'switch' }`, `{ kind: 'withdrawn', version }`, `{ kind: 'refused', code: 'notAdmin'\|'invalid'\|'stale'\|'tooEarly'\|'recomputeNeedsEngine'\|'previewStale', fields: [legacy dotted locators], earliest? }`. Faults: `unauthenticated` / `invalid-argument` (`details { code: 'loyalty.streak_publish.invalid_input', params: { field } }`) / `internal` (`loyalty.streak_publish.store_failed`). **Order frozen:** the caller is judged BEFORE the request is read (a non-admin with a malformed request is told `notAdmin`); then the envelope (`invalid_input`, by field: `request`, `op`, `requestId` via `isClientOperationId`, `streakId` `/^[A-Za-z0-9_-]{1,64}$/`, `version` ≥ 1 / `baseVersion` ≥ 0, `draft` a record ≤ 16 384 JSON bytes, `transition`, `previewHash` non-empty ≤ 128; a non-string `effectiveFrom` reads as `''`); then the pipeline. The `HttpsError` **message** is not frozen (it becomes the wire code, as for every flipped callable — the web gateway reads `details` and `code` only). The two wire codecs live at the two edges: `apps/functions/src/wire/loyalty.wire.ts` (decode the request and the nested draft, encode the answer) and the web gateway `libs/infrastructure/firestore/src/lib/streak-publish-gateway.adapter.ts` (encode the nested draft, decode the answer) — both frozen-wire files (`WIRE3`, §6), both deleted when Phase 4's `callableClient` lands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Keeps the admin page's request and every refusal word byte-identical.      |
| F3-4  | **New ecs-core error codes, never a second rule for a legacy wire code** (F2-4). `StreakPublishErrorCode` gains `CallerUnauthenticated` (`LOYALTY_STREAK_PUBLISH_CALLER_UNAUTHENTICATED`) and `CallerNotAdmin` (`LOYALTY_STREAK_PUBLISH_CALLER_NOT_ADMIN`), with factories `callerUnauthenticated()` / `callerNotAdmin()`; their `EDGE_DICTIONARIES` rows use NEW dotted codes `loyalty.streak_publish.caller_unauthenticated` (`Unauthenticated`) and `loyalty.streak_publish.caller_not_admin` (`ANSWERED`); `STREAK_PUBLISH_WIRE` stops being `uniform(…, ANSWERED)` and becomes an explicit table. The callable never lets either reach the wire as itself: `loyalty.wire.ts`'s `publishStreakRefusal` translates them to today's `LegacyWireCode.StreakPublishUnauthenticated` fault and the `notAdmin` refusal. **The four `LegacyWireCode.StreakPublish*` rows STAY** (`Unauthenticated`, `InvalidInput`, `StoreFailed`, `NotAdmin`) — the wire still answers them. `invalid_input` is the decoder's own legacy refusal (no ecs code, as F2-3's `invalid_input` reasons); `store_failed` is the wire's translation of the commit's `RepositoryError` (no new code). No i18n key is added (flatten-spec §4.3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `edge.spec.ts` "one rule per code"; Law 7.5 (dictionaries in primitives).  |
| F3-5  | **Bodies = the ecs-core entities, flat** (Law 5/6/7; flatten-spec §3.5 verbatim): `LoyaltyAccount`, `BadgeProgress`, `SeasonProgress`, `JournalEntry`, `StreakDefinition` (+ `StreakDefinitionVersion`), `BadgeCategory`, `BadgeSeries`, `Season`, `TierDefinition`, `RewardCatalogItem`, `Invitation`, `InvitationRedemption` (§1.1). Two data notes, neither a behaviour: `RewardCatalogItem` carries a `grantVoucherCurrency` today's `grants.voucher` never stored — `'EUR'` (the owner's currency ruling) on the one voucher reward (`reward-product`); `BadgeSeries`' optional `metric.window` / `metric.where` become explicit `null` fields (`metricWindowDays`, `metricScope*Id` — `where: null` ≡ three null scope fields, the scope test is unchanged). T5 pairs (an instant and its shop day) are written once from the same reading with the shop zone (`Europe/Sofia`, the seed's `SHOP_ZONE` / the pipeline's `tenantTimeZone`): `EarnedLevel.earnedAtUtcMs` + `earnedLocalDate`, `JournalEntry.utcEpochMs` + `localDate`, `Season.announcedAtUtcMs` + `announcedLocalDate`, `BadgeSeries.retiredAtUtcMs` + `retiredLocalDate` (all null today); `TierDefinition.effectiveFromLocalDate` is the Sofia day of today's ISO instant (`'2025-03-01T07:00:00.000Z'` → `'2025-03-01'`, D24). Every value's day equals today's `sofiaDayOf` of the same instant, so no medal, month or "last" bucket moves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | flatten-spec §3.5, T5.                                                     |
| F3-6  | **D29 re-key** (flatten-spec §5.4 last row, §5.5 "Flip (3)"). `loyaltyAccounts/{customerId}` (and its `badgeProgress`/`seasonProgress` beneath), body `customerId: CustomerId` in place of `userId`; `clientJournal` rows carry `customerId`, ids `${customerId}_${seq:06}` (`JournalEntryId.forEntry(customerId: CustomerId, seq)`); `LoadLoyaltyAccount` / `ListBadgeProgress` / `ListSeasonProgress` / `PageClientJournal` take a `CustomerId`. No access field is added: every read is staff-only (`worksTheBook()`). **Stay `UserId`:** every `actor*` field of a journal row, `StreakDefinitionVersion.publishedByUserId` (the seed's `'system'` publisher stays as it is), `Invitation.inviterUserId`, `InvitationRedemption.id`. **Opaque strings kept as written:** `idempotencyKey`, `sourceAwardKey`/`achievementAwardKey` and `correlationId` keep today's text (the seed's award keys embed the uid — nothing parses them; they are never derived from the `CustomerId` text). The client card reads every loyalty slice through its existing `withRecord`/`recordOf` (the vouchers' path): `none` (no record) → the account `null`, progress/seasons/feed/ledger empty (today's "no account" view); `failed` → the slices `failed` (departure F3-1 (a)); a retry re-resolves the record. The reachability gate `subject.userId !== null` stays (frozen: a walk-in shows no loyalty).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | D29; flip-1 precedent (the record via `CUSTOMER_PORTS`).                   |
| F3-7  | **`streaks` is an array** (`readonly StreakState[]`, Law 5 "no dynamic map keys"); every read is `StreakState.find(states, id)` (a linear scan, `streak-state.data.ts`), never `streaks[id]`, `Object.keys/values/entries(account.streaks)`. The four optional fields of today's states (`period`, `periods`, `heldBy`, `runStartedOn`) are required in the flat state (no dual shape; the A0 fixtures and the seed always write them).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | flatten-spec §3.5; runbook K3.                                             |
| F3-8  | **The publish callable becomes `@core/pipelines`** `publish-streak-definition.pipeline.ts` (`publishStreakDefinition`, `withdrawStreakDefinition`) behind `wire/loyalty.wire.ts` and a `callableEdge` row — the LAST `legacyCallable` row goes, and `legacyCallable` with it (no importer, §7). Read set, decide and writes in §3.2; replay as today (a publish retry finds its version by `requestId` when a head exists and answers the ORIGINAL receipt from the stored version; a withdrawal retry finds its audit row by the derived id); the version is numbered one above the highest ever written (withdrawn included) — read as `versions orderBy version desc limit 1` inside the transaction instead of today's ids-only `select()` over every version: equal under the entity's invariant `id == StreakDefinitionVersionId.forVersion(version)` that every writer (this pipeline, the seed) keeps; noted, not a departure. The called-off version's `withdrawnAtUtcMs` is stamped only when its document exists (today's "a seeded head may lack its history"), so the read half reads the head's `SCHEDULED` version document. **Time:** `today` = `ZonedTimeSystem.toLocal(nowUtcMs, tenantTimeZone).localDate` (the server's `WIRE_ZONE` = `'Europe/Sofia'` = today's `LOYALTY_ZONE`, so the same day); the notice policy's `clientsSeeRhythm` = `flagOn(FlagName.LoyaltySelfView)` per request through a new `FlagsPorts` adapter, `noticeDays` = 30 (`StreakRule.RULE_CHANGE_NOTICE_DAYS`, P0, the one constant the web assessment and the server share).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Blueprint §4.1, §6 Phase 3; F1-8 (in-tx audit row).                        |
| F3-9  | **Law 9: one bundle per token and per adapter factory** (F2-16). `LoyaltyReadPorts` (a record today, no consumer) becomes the suite `LoyaltyAccountReadPorts & LoyaltyCatalogReadPorts` — the web binds the account/progress reads and the catalogue through two tokens today, so they are two bundles; `ClientJournalPorts` and `StreakDefinitionPorts` stay as they are (re-keyed); a NEW web gateway bundle `StreakPublishGatewayPorts` (`publishStreakRule`, `withdrawStreakRule`) carries the callable; the server pipeline's ports are `CommitPorts & ClockPorts & HashPorts & FlagsPorts & TenantZonePorts` (`TelemetryPorts` dropped at integration, §8.1 — the pipeline logs nothing), with a new functions adapter `paramFlagsPorts(): FlagsPorts`. Tokens (`ports.tokens.ts`): `LOYALTY_ACCOUNT_READ_PORTS`, `LOYALTY_CATALOG_READ_PORTS`, `CLIENT_JOURNAL_PORTS`, `STREAK_DEFINITION_PORTS`, `STREAK_PUBLISH_PORTS`. The call and receipt shapes the gateway bundle speaks are a component (`components/streak-publish-call.data.ts`, P0), never a ports-tier or pipeline-tier type, so the system that judges them may name them (Law 8.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Law 9; `.claude/rules/ecs-ports.md`.                                       |
| F3-10 | **The catalogue includes the rhythm heads, as today, under the system's keys.** `LoyaltyCatalog` (ports tier) is re-keyed by P0 to `LoyaltyCatalogParts`' keys so it passes to `LoyaltyCatalogSystem` unmapped (Law 3): `categories: readonly BadgeCategory[]`, `series: readonly BadgeSeries[]`, `seasons`, `tiers: readonly TierDefinition[]`, `rewards`, and the new `streaks: readonly StreakDefinition[]` (was `badgeCategories`/`badgeSeries`/`tierDefinitions`, no heads; a type-spec pins `LoyaltyCatalog` assignable to `LoyaltyCatalogParts`); `LoadLoyaltyCatalog` reads the six collections whole (today's `LOYALTY_CATALOG_COLLECTIONS`), in Firestore's id order. The card store hands that answer as is to `LoyaltyCatalogSystem.validate` and keeps the `ValidLoyaltyCatalog` it answers (display order, `families`; a refusal → the catalogue slice `failed`, today's behaviour); every lookup (`category`, `series`, `seriesIn`, `season`, `tier`, `streak`, `streakInForce`) and `StandingSystem` read that value — no system file changes. The card resolves the rule in force with `StreakRuleSystem.inForceOn` / `upcomingOn` over the head whose id its account's states name (`StreakState.find` order: the first head an account state names, else the first head — today's `streakSchedules.find(held) ?? streakSchedules[0]`). The session memo stays (one read per shop day per session, a failed read never kept, dropped after a landed publish or withdrawal) as a PLAIN CLOSURE, not a class: `loyaltyCatalogMemo(): LoyaltyCatalogMemo` (`readOn(day: LocalDate)`, `keep(read, day)`, `drop(read)`, `invalidate()`) in the eager `libs/infrastructure/firebase-app/src/lib/loyalty-catalog-memo.ts`, provided once through the root token `LOYALTY_CATALOG_MEMO` (`providedIn: 'root', factory: loyaltyCatalogMemo` — today's `providedIn: 'root'` session, so the catalogue and gateway rows share one memo); the day comes from a `today: () => LocalDate` closure built in `cfg` (production: `Date.now()` → `UtcEpochMs.of` → `ZonedTimeSystem.toLocal(…, 'Europe/Sofia').localDate`; spec: pinned) and passed to the adapter factory — no clock or zone code in a `*.adapter.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Fidelity; F3-9.                                                            |
| F3-11 | **The journal feed's pill table moves to ecs-core components**, values SCREAMING: `JournalFeed` = `{ All: 'ALL', Points: 'POINTS', Rewards: 'REWARDS', Status: 'STATUS' }` and `JournalFeed.effectsOf(feed)` = today's `ACTIVITY_EFFECT_KINDS` (`ALL` → `POINTS, ACHIEVEMENT, TIER, REWARD, REDEMPTION`; `POINTS` → `POINTS`; `REWARDS` → `REWARD, REDEMPTION`; `STATUS` → `TIER`), in `journal-effect.data.ts`. The client card's DOM keeps its lowercase pill words (`data-testid="ledger-filter-all"`, the `ledgerPage.filter(kind)` i18n keys) through one `satisfies Record<JournalFeed, string>` words table in the card. `LedgerSystem` folds `JournalEntry` rows directly (zero inbound mapping, Law 3): `ledgerRefOf` and its lower→SCREAMING tables go; a level's family/number come from `labelParams` through the EXISTING `PublicLabel.param(entry, 'seriesId')` / `PublicLabel.param(entry, 'level')` (`journal-effect.data.ts` — no new `LedgerSystem.param`): the family is a `BadgeSeriesId` only when the value is a string that is not blank, branded by `BadgeSeriesId.of` (the id-by-construction door of `ids.primitive.ts` for a value a stored row carries — today's `BadgeSeriesId.of(textOf(entry, 'seriesId'))`), else `null`; the level is the value narrowed by `typeof === 'number' && Number.isInteger`, else `null` (today's `countOf`); no `as BadgeSeriesId` anywhere; the visit of a row is its root `appointmentId` (no more `correlationId` parsing; `correlationId` text unchanged, the event fold still keys on it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Law 3; flatten-spec §3.5.                                                  |
| F3-12 | **Invitations: the dead web surface is deleted, the contract kept.** `INVITATION_PORT` has no injection site, `CreateInvitationUseCase`/`RedeemInvitationUseCase` are constructed only in their specs, no server/seed/e2e writer exists and `referrals.invitations` is off in every environment. So: `invitation.adapter.ts` (+ spec), the `INVITATION_PORT` cfg row and token, the application port, both use cases (+ errors, specs), the `engagement.type-spec.ts` invitation cases and the `firestore-paths.ts` invitation helpers are deleted; `Invitation`/`InvitationRedemption` entities, `RedemptionCount`, `ReferralSystem` and the three `ENGAGEMENT_INVITATION_*` codes stay for Phase 4's `redeemInvitation` (one `CommitPlan`: `Create` the redemption + `Update` the counter — today's two non-atomic client writes are NOT preserved, there is nothing to preserve). The `invitations` rules and their (absent) indexes are untouched. No single-request outcome is reachable, so no departure; the deleted cases are `dead:` (§11).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Flip-2 F2-13 (re-shape through the only reader) — here there is no reader. |
| F3-13 | **`LoyaltyReader.listLedgerTail` is deleted** (no feature caller; it queried the dot path `'effect.kind'`), with no successor member.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Deletion rule; runbook K3.                                                 |
| F3-14 | **The readers are re-typed to the ecs-core entities, no mapper bridge** (blueprint §6 Phase 3 option (a); flips 1–2 re-typed the stores and presenters that read their bodies). The client card (`libs/features/staff/client-card/**`) and the admin rhythm page (`libs/features/admin/loyalty/**`) consume `@core/entities` / `@core/components` / `@core/systems` directly: legacy → ecs table in §3.5. No file in those two libraries, `libs/features/shared/visits/**`, the flip's `libs/infrastructure` files, `apps/functions` or `apps/web/e2e` imports `@creativo/application/engagement` or `@creativo/domain/engagement` after the flip (§6 gate).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Law 5 (no mapper); "convert what you touch".                               |
| F3-15 | **The legacy loyalty half of `libs/application/engagement` is deleted in this flip** (wave 2, P6), a departure from flip 1's "application stays until Phase 4" on flip 2's F2-12 grounds: its mappers read only the old bodies, its in-memory doubles parse the reshaped fixtures, and every importer is re-typed in wave 1. Deleted: `loyalty-document.ts`, the `loyalty-reader`, `loyalty-activity-reader`, `loyalty-catalog-reader`, `streak-definition` and `invitation` ports, the observe/preview/publish streak and create/redeem invitation use cases, their specs, the loyalty half of `testing.ts`/`testing.spec.ts`, the two legacy account JSON fixtures, and their `index.ts` barrel lines. Kept until Phase 4: the coupon/voucher/reward-progress ports, `apply-discounts`, `gift-voucher-document`, and the coupon, voucher and discount domain re-exports of `index.ts`/`public-reexports.ts` (they read no body). The loyalty and streak re-exports (the `export type` read-model and rhythm blocks of `index.ts`, the catalogue and streak value blocks of `public-reexports.ts`) go with the rest: they had no importer left once wave 1 re-typed the features (review, 2026-10-22).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | D8-style deletion readiness; F2-12.                                        |

---

## 1. The closure

### 1.1 Collections, bodies, TTL, indexes, rules

Every body **is** the entity type minus `id` (Law 5), every key a root key.
Index numbers are blueprint §3.3's; "→" marks the after-state. No
collection of this flip has a TTL (`purgeAt`): accounts, progress, journal,
heads, versions and the catalogue are durable.

| Collection                                                                           | Body = entity (file)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Composite indexes after                                                                                                             | fieldOverrides after (`indexes: []`)                                                                                                                                                                                            | Rules lines that change                                                                                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `loyaltyAccounts/{customerId}`                                                       | `LoyaltyAccount` = `LoyaltyAccountMeta & TierState & PointsExpiry` (`entities/loyalty-account.entity.ts`): `customerId`, `balance`, `lifetimeEarned`, `lifetimeAdjusted`, `lifetimeSpent`, `tierId`, `tierDefinitionVersion`, `tierSinceUtcMs`, `tierQualifying`, `nextTierId`, `tierRemaining`, `tierOverrideSource` (+ `tierOverrideTierId`, `tierOverrideUntil`, `tierOverrideAwardKey` \| `tierOverrideAdjustmentId`), `streaks: StreakState[]` (each flat: `streakId`, `definitionVersion`, `streakPhase` + `phaseDueBy` \| `phaseGraceUntil` \| `phaseFrozenUntil`+`phaseFreezeReason` \| `phaseBrokenOn`+`phaseRepairableUntil`, `current`, `best`, `lastQualifiedAtUtcMs`, `dueBy`, `freezesBanked`, `periodIntervalDays`…`periodHabitDays`, `periods: [{ streakPeriodMark, on, periodReason }]`, `heldByAppointmentId`, `heldOn`, `runStartedOn`), `punchCards`, `records: [{ personalRecordKind, value, on, year, serviceId }]`, `pointsExpireOn`, `pointsExpiryNoticeFrom`, `seq`, `version`, `updatedAtUtcMs` | none                                                                                                                                | **new** `loyaltyAccounts.streaks`, `.punchCards`, `.records`                                                                                                                                                                    | wildcard `{uid}` → `{customerId}`, comment                                                                                   |
| `…/badgeProgress/{seriesId}`                                                         | `BadgeProgress` (`badge-progress.entity.ts`): `value`, `earned: [{ level, earnedAtUtcMs, earnedLocalDate, earnedVia: 'RULE'\|'MANUAL', count }]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | none                                                                                                                                | **new** `badgeProgress.earned`                                                                                                                                                                                                  | none (wildcard parent only)                                                                                                  |
| `…/seasonProgress/{seasonId}`                                                        | `SeasonProgress` (`season-progress.entity.ts`): `trackValue`, `trackLevel` (unchanged)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | none                                                                                                                                | none                                                                                                                                                                                                                            | none                                                                                                                         |
| `clientJournal/{customerId}_{seq:06}`                                                | `JournalEntry` = `JournalEntryMeta & Actor & JournalSourceRecord & JournalEffectRecord` (`journal-entry.entity.ts`): `customerId`, `seq`, `utcEpochMs`, `localDate`, `reverses`, `correlationId`, `idempotencyKey`, `journalVisibility: 'CLIENT'\|'STAFF'`, `labelCode`, `labelParams: [{ name, value }]`, `balanceAfter`, `appointmentId`, `actorRole` + its fields, `journalSource` + `source*`, `journalEffect` + its prefixed fields (flatten-spec §3.5 verbatim)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | #21 → `customerId ASC, journalVisibility ASC, journalEffect ASC, seq DESC` (the old `userId, visibility, effect.kind, seq` deleted) | **new** `clientJournal.labelParams`, `clientJournal.actorRoles`                                                                                                                                                                 | `resource.data.visibility == 'client'` → `resource.data.journalVisibility == 'CLIENT'`; comment (id `{customerId}_{seq:06}`) |
| `streakDefinitions/{streakId}`                                                       | `StreakDefinition` (`streak-definition.entity.ts`): `name`, `rules: StreakHeadRule[]` (one `CURRENT`, ≤ 1 `SCHEDULED`, flat `StreakRule` + `headRole` + `streakTransition`), `updatedAtUtcMs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | none                                                                                                                                | **new** `streakDefinitions.rules`                                                                                                                                                                                               | none (comment only)                                                                                                          |
| `…/versions/{version:06}`                                                            | `StreakDefinitionVersion` (`streak-definition-version.entity.ts`): the flat `StreakRule` at the root + `publishedAtUtcMs`, `publishedByUserId`, `streakTransition`, `streakRuleDirection`, `changed: StreakRuleParameter[]`, `requestId`, `withdrawnAtUtcMs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | none (`version` desc and `requestId ==` stay single-field automatic)                                                                | **new** `versions.changed`, `versions.excuses`, `versions.qualifierServiceIds`, `versions.qualifierCategoryIds` (collection group `versions` = only this subcollection; `barberSchedules.versions` is a FIELD of another group) | none                                                                                                                         |
| `badgeCategories` · `badgeSeries` · `seasons` · `tierDefinitions` · `rewardsCatalog` | `BadgeCategory` (`badgeCategoryKind`), `BadgeSeries` (`BadgeSubjectSlot`, `MetricRef`, `artPath`, `levels[].awards[]` flat `awardKind`…, `retiredAtUtcMs`/`retiredLocalDate`), `Season` (`seasonKind`, `windowFrom`/`windowUntil`, `announcedAtUtcMs`/`announcedLocalDate`), `TierDefinition` (`effectiveFromLocalDate`, `qualifyMetric`/`qualifyAtLeast`/`qualifyWindowDays`), `RewardCatalogItem` (`rewardGrant` + `grant*`, `availableFrom`/`availableUntil`, `perClientLimitCount`/`perClientLimitWindowDays`, `totalLimit`) — files `badge-category`, `badge-series`, `season`, `tier-definition`, `reward-catalog-item` `.entity.ts`                                                                                                                                                                                                                                                                                                                                                                                | none                                                                                                                                | **new** `badgeSeries.levels`, `seasons.seriesIds`, `tierDefinitions.benefits`                                                                                                                                                   | none                                                                                                                         |
| `invitations` · `…/redemptions/{refereeUserId}`                                      | `Invitation` (`createdAtUtcMs`), `InvitationRedemption` (`redeemedAtUtcMs`) — no writer and no reader after the flip (F3-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | none                                                                                                                                | none                                                                                                                                                                                                                            | none                                                                                                                         |
| `auditLog` (the publish/withdraw row)                                                | `AuditEntry`, unchanged (flat since F1-8) — now planned as a `WriteOp.create` of the pipeline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | unchanged                                                                                                                           | `auditLog.streakChanged` (exists)                                                                                                                                                                                               | none                                                                                                                         |

Not in the closure: `users/{uid}/rewardProgress` and `rewardPrograms`
(dormant, F3-2); `couponGrants` (the seed's redemption and stamp grants keep
flip 1's body — only how the seed reads the reward that minted them
changes, `rewardGrant`/`grantCouponId`); `customers` (read, never written
here).

### 1.2 D29 — after this flip

- `loyaltyAccounts`, its progress subcollections and `clientJournal` are
  keyed by the client RECORD (`CustomerId`); the server never reads them,
  the web reads them through the record it resolved
  (`customers where userId == uid`, flip 1), the seed and the e2e seed key
  them by `CustomerId.forUser(uid, sha256)` (`customerIdOf` in
  `tools/seed/fixtures/customers.fixtures.ts`, `customerIdFor` in
  `apps/web/e2e/support/seed-firestore.ts`).
- A journal row names WHO acted by `UserId` (`actor*`), WHOM it rewarded by
  `CustomerId` (`customerId`) — two fields, two values; never derived one
  from the other.
- `StreakDefinitionVersion.publishedByUserId`, `Invitation.inviterUserId`,
  `InvitationRedemption.id` stay `UserId` for good (account acts).

---

## 2. Reader / writer matrix (re-derived 2026-10-22 on `6d43e1c`)

Searches run (runbook §1.4, plus): every file naming a flip-3 collection
literal or `Collections.*`/`*_COLLECTION` key; every importer of
`@creativo/application/engagement` and `@creativo/domain/engagement` in
`apps/`, `libs/infrastructure`, `libs/features`, `tools/`, `apps/web/e2e`;
every `LOYALTY_READER`, `LOYALTY_ACTIVITY_READER`, `LOYALTY_CATALOG_READER`,
`STREAK_DEFINITION_REPOSITORY`, `INVITATION_PORT`, `LoyaltyCatalogSession`,
`InMemoryLoyalty*`, `InMemoryStreakDefinitionRepository`,
`HeldCatalogReader` site; every `account.streaks`, `streakSchedules`,
`ACTIVITY_EFFECT_KINDS`, `sofiaDayOf`, `loyaltyFixtures` use; the seed's
`load-domain.mjs` bundle entry; for Law 9 every consumer of an engagement
bundle outside the ports tier (none on `6d43e1c`: `LoyaltyReadPorts`,
`ClientJournalPorts`, `StreakDefinitionPorts`, `PageClientJournal`,
`LoadLoyaltyAccount` have no consumer) and every `Pick`/`Omit` over a
`*Ports` type (none). `LedgerSystem`/`LedgerEntryRef` have ONE production
consumer, `ft:staff/client-card/src/lib/ledger.presenter.ts`.

Abbreviations as flips 1–2: `fn:` = `apps/functions/src/`, `wa:` =
`libs/infrastructure/firestore/src/lib/`, `ft:` = `libs/features/`, `pl:` =
`libs/ecs-core/src/pipelines/`, `sy:` = `libs/ecs-core/src/systems/`, `sd:` =
`tools/seed/`, `sdc` = `tools/seed-dev-catalog.mjs`, `e2e:` =
`apps/web/e2e/`, `cfg` = `apps/web/src/app/app.config.ts`, `app:` =
`libs/application/engagement/src/`, `cc:` = `ft:staff/client-card/src/`.
Package tags `[P0]`…`[P6]` (§4); fate **del** / **rw** / **new** /
**edit** / **kept**.

| Collection                                                                                   | Readers today → owner, fate, successor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Writers today → owner, fate, successor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `loyaltyAccounts` (+ `badgeProgress`, `seasonProgress`)                                      | **wa** `wa:loyalty-reader.adapter.ts` `FirestoreLoyaltyReader.getAccount`/`listBadgeProgress`/`listSeasonProgress` (legacy mappers; a malformed progress doc dropped) [P2 del → `wa:loyalty.adapter.ts` `loyaltyAccountReadPorts(db): LoyaltyAccountReadPorts`]; **st** `LOYALTY_READER` (cfg) → `cc:lib/client-card.store.ts` `loadLoyalty(generation, uid, …)` by UID [P3 rw → `LOYALTY_ACCOUNT_READ_PORTS` through `withRecord`, F3-6]; presenters reading the nested account: `cc:lib/{glance,wallet,records,loyalty,achievements,client-card,medals,medal-detail}.presenter.ts`, `cc:lib/client-pages.vm.ts`, `cc:lib/client-card.store.ts` (`Object.keys(account.streaks)`, `account.data.balance`) [P3 rw]; **test** `cc:testing/{client-card.fixtures,achievements-pages.rig,client-pages.vm-fixtures}.ts`, the client-card specs [P3 rw]; `ft:staff/dashboard/src/lib/visit-editor/staff-visit-editor.spec.ts` (provides the three loyalty tokens) [P3 rw]; `app:testing.ts` `InMemoryLoyaltyReader` [P6 del]; **seed** `sd:loyalty.mjs` `readLoyaltyWrites` (reads back through the legacy mappers) [P5 rw → bodies typed by the new `sd:fixtures/loyalty.fixtures.ts` builders; the runtime self-check keeps only `LoyaltyCatalogSystem.validate` + `StreakRule.parse`, F3-1 (b)]; **int** `wa:loyalty-reader.adapter.integration.spec.ts` [P2 rw → `wa:loyalty.adapter.integration.spec.ts`]; **rules** `wa:firestore.rules.integration.spec.ts` (seeds `loyaltyAccounts/client-1 {userId, balance, seq}` and the two subcollections) [P5]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **seed** `sd:loyalty.mjs` `projectLoyaltyFor` (nested account, `streaks` map via legacy `streakStateToDocument` + `traceStreak`) / `loyaltyWritesOf(uid, …)` paths `loyaltyAccounts/${uid}/…`, committed by `sdc` (sweeps `loyaltyAccounts/{uid}` and its subcollections) [P5 rw → flat bodies under `customerIdOf(uid)`]; **e2e** `e2e:support/seed-firestore.ts` `seedLoyalty` (`{...fixture.account, userId: uid}`) [P5 rw → `customerIdFor(uid)`, flat fixture]; **rules spec seeds** [P5]. No server or web writer.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `clientJournal`                                                                              | **wa** `wa:loyalty-activity-reader.adapter.ts` `FirestoreLoyaltyActivityReader.page` (`userId ==`, `visibility == 'client'`, `effect.kind in`, `orderBy seq desc`, `startAfter`, `limit(size+1)`, an unparsable row skipped) [P2 del → `wa:loyalty.adapter.ts` `clientJournalPorts(db): ClientJournalPorts`]; `wa:loyalty-reader.adapter.ts` `listLedgerTail` (dot path `effect.kind`, NO caller) [P2 del, F3-13]; **st** `LOYALTY_ACTIVITY_READER` (cfg) → `cc:lib/client-card.store.ts` `loadFeed` / `loadLedgerFirst` / `readLedgerPage` / `fetchMoreLedger` by UID [P3 rw → `CLIENT_JOURNAL_PORTS` through `withRecord`, `JournalFeed.effectsOf`]; presenters `cc:lib/{ledger,wallet}.presenter.ts`, `cc:lib/client-ledger/client-ledger.ts`, `cc:lib/activity-list/activity-list.ts`, `cc:lib/client-pages.vm.ts`, `cc:lib/client-card.contracts.ts` (`ActivityEntry`/`ActivityKind`) [P3 rw]; **test** `cc:testing/client-card.fixtures.ts` `workedSeatsOf` (`publicLabel.params.spendMinor`, `correlationId` split, `parseOffsetIso(entry.at)`) [P3 rw], `ledger.presenter.spec.ts`, `wallet.presenter.spec.ts` (parse through `activityEntryFromDocument`) [P3 rw]; `app:testing.ts` `InMemoryLoyaltyActivityReader` [P6 del]; **seed** `sd:loyalty.mjs` `readLoyaltyWrites` (`activityEntryFromDocument`, `ledgerEntryFromDocument`, `data.effect.kind`) [P5 rw]; `sd:promotions.spec.mjs` (journal ↔ grants cross-check: `row.effect.kind`, `row.effect.ref.id`, `row.effect.grant.id`, `row.publicLabel.params.coupon`, `rewardsCatalog[row.effect.rewardId]`, `Date.parse(row.at)`) [P5 rw]; `sd:seed-data.spec.mjs` (folds by event) [P5 rw if it reads a removed key]; **int** `wa:loyalty-activity-reader.adapter.integration.spec.ts` [P2 rw → `wa:loyalty.adapter.integration.spec.ts`]; **rules** `wa:firestore.rules.integration.spec.ts` (`get` client vs staff row; the ledger and per-pill activity queries with `ACTIVITY_EFFECT_KINDS`; refused without the visibility filter) [P5]                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **seed** `sd:loyalty.mjs` `append()` (`userId`, `at: isoOf`, nested `effect`/`source`/`actor`, `visibility: 'client'`, `publicLabel { code, params }`), ids `clientJournalEntryId(uid, seq)`, swept by `sdc` with `where('userId','==',uid)` [P5 rw → flat rows, `customerId`, `utcEpochMs`+`localDate` (`SHOP_ZONE`), `labelParams[]`, `appointmentId`, ids `JournalEntryId.forEntry(customerId, seq)`, sweep `where('customerId','==',…)`]; **e2e** `seedLoyalty` (rewrites row ids `{uid}_…` and `userId`) [P5 rw]. No server or web writer.                                                                                                                                                                                                                                                                                                                                                                                |
| `streakDefinitions` (+ `versions`)                                                           | **sa** `fn:adapters/firestore-streak-definition-store.ts` (`tx.get` head via `streakScheduleFromDocument`; replay: `versions where requestId == … limit 1` / the withdrawal audit row; `versions.select()` ids for the highest version; the called-off versions' existence) [P1 del → `pl:publish-streak-definition.pipeline.ts` read half over `ReadTx`]; **h** `fn:lib/loyalty/publish-streak-definition.ts`, `fn:use-cases/publish-streak-definition.use-case.ts` (+ `.errors.ts`) [P1 del → the pipeline + `fn:wire/loyalty.wire.ts`]; **wa** `wa:streak-definition-repository.adapter.ts` `observe` (`onSnapshot` head), `listVersions` (head for the name, then `versions orderBy version desc limit`) [P2 del → `wa:streak-definitions.adapter.ts` `streakDefinitionPorts(db): StreakDefinitionPorts`]; `wa:loyalty-catalog-reader.adapter.ts` (heads with the catalogue) [P2 del → `wa:loyalty-catalog.adapter.ts`]; **st** `STREAK_DEFINITION_REPOSITORY` (cfg) → `ft:admin/loyalty/src/lib/admin-rhythm.store.ts` (through `ObserveStreakDefinitionUseCase`/`PublishStreakDefinitionUseCase`) [P4 rw → `STREAK_DEFINITION_PORTS` + `STREAK_PUBLISH_PORTS`]; `admin-rhythm.preview.ts`, `admin-rhythm/admin-rhythm.words.ts` (`sofiaDayOf(version.publishedAt)`), `admin-rhythm-sheet.ts` [P4 rw]; the card's `catalog.streakSchedules` (`cc:lib/client-card.store.ts`, `glance`/`wallet`/`records` presenters) [P3 rw]; `ft:shared/visits/src/lib/rhythm-rule/rhythm-rule.words.ts` (legacy `StreakRuleSummary`, `StreakPeriodTerms`) [P4 rw]; **test** `app:testing.ts` `InMemoryStreakDefinitionRepository` (also seeds the rules spec), `fn:lib/loyalty/publish-streak-definition.spec.ts`, `fn:use-cases/…spec.ts`, `fn:adapters/firestore-streak-definition-store.spec.ts` [P1/P6 del]; **seed** `sd:loyalty.mjs` `rulesPublishedOver`, `catalogAsHeld`, `ruleInForce` (reads a head the admin published in a running emulator through `streakScheduleFromDocument`), `readLoyaltyWrites` (`streakDefinitionVersionFromDocument`) [P5 rw]; `sdc` (`kept the … rhythm … version N since current.effectiveFrom` log, `projection.account.streaks.cadence`) [P5 rw]; **int** `wa:streak-definition-repository.adapter.integration.spec.ts` [P2 rw]; **rules** `wa:firestore.rules.integration.spec.ts` (head/versions built through `InMemoryStreakDefinitionRepository.documentsOf`) [P5]; **e2e** `e2e:app-shell.spec.ts` (opens `/admin/loyalty/rhythm`) [kept, no edit] | **sa** the store's `tx.create(version)`, `tx.update(calledOff, { withdrawnAt: ISO })` if it exists, `tx.set(head, whole)`, `tx.create(auditRow)` [P1 del → the pipeline's `WriteOp` plan through `firestoreCommitPlan`]; **wa** `streak-definition-repository.adapter.ts` `publish`/`withdraw` — the `httpsCallable` with `draft = streakDefinitionToDocument(definition)` [P2 del → `wa:streak-publish-gateway.adapter.ts` `streakPublishGatewayPorts(functions, memo): StreakPublishGatewayPorts`, the frozen nested draft encoded there]; **seed** `sd:loyalty.mjs` `loyaltyCatalogWritesOf` (the head from `catalog.json`) + `seedRuleVersionWriteOf` (version 1: `publishedAt`, `publishedBy: 'system'`, `transition: 'grandfather'`, `direction: 'neutral'`, `changed: []`, `requestId: 'seed-cadence-000001'`, `withdrawnAt: null`) [P5 rw → flat head and version]; `global-setup.ts` runs `sdc --catalog-only` [kept] |
| catalogue (`badgeCategories`, `badgeSeries`, `seasons`, `tierDefinitions`, `rewardsCatalog`) | **wa** `wa:loyalty-catalog-reader.adapter.ts` `FirestoreLoyaltyCatalogReader.getCatalog` (six `getDocs`, `loyaltyCatalogFromDocuments` refuses an invalid catalogue, `LoyaltyCatalogSession` per Sofia day) [P2 del → `wa:loyalty-catalog.adapter.ts` `loyaltyCatalogReadPorts(db, memo, today): LoyaltyCatalogReadPorts` over the closure memo `loyaltyCatalogMemo()` (`libs/infrastructure/firebase-app`, token `LOYALTY_CATALOG_MEMO`, F3-10); the class `LoyaltyCatalogSession` goes]; **st** `LOYALTY_CATALOG_READER` (cfg) → `cc:lib/client-card.store.ts` `loadCatalog` [P3 rw → `LOYALTY_CATALOG_READ_PORTS`]; catalogue readers in the card's presenters and components (`BadgeSeries`/`BadgeCategory`/`Season`/`TierDefinition`/`RewardCatalogItem` classes, `catalog.series(id)` lookups, `levels[].awards[].kind`, `window`, `qualify`, `grants`) [P3 rw → the store's `LoyaltyCatalogSystem.validate(loaded)` (unmapped, F3-10) and the system's lookups over the `ValidLoyaltyCatalog` it answers]; `HeldCatalogReader` (`cc:testing/achievements-pages.rig.ts`) [P3 rw]; **test** `app:testing.ts` `InMemoryLoyaltyCatalogReader`, `loyaltyFixtures.catalog` [P6 del]; `libs/ecs-core/src/testing/loyalty.fixtures.ts` `loyaltyCatalogJson` (+ spec holding the streak fixtures to the JSON) [P0 rw]; **seed** `sd:loyalty.mjs` (reads `catalog.json` by path; `loyaltyCatalogFor(today)` shifts `window`/`announcedAt`; `tierLadderOf`, `punchRewardOf`, `redemptionGrantsOf` read `qualify`, `grants.kind`/`couponId`; `loyaltyCatalogDriftOf` with `MOVED_SEASON_FIELDS`; `readLoyaltyWrites` through `loyaltyCatalogFromDocuments`), `sd:loyalty.spec.mjs` ("is the fixtures' catalogue, verbatim"), `sdc --check` [P5 rw]; **int** `wa:loyalty-catalog-reader.adapter.integration.spec.ts` [P2 rw]; **rules** spec catalogue reads [P5 kept, bodies flat]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **seed** `sd:loyalty.mjs` `loyaltyCatalogWritesOf` from `catalog.json` [P5 rw]; **fixture** `libs/ecs-core/src/testing/fixtures/loyalty/catalog.json` [P0 rw, flat]. No server or web writer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `invitations` (+ `redemptions`)                                                              | **wa** `wa:invitation.adapter.ts` `findById` (`ZonedDateTime.fromISO(createdAt)`) [P2 del, F3-12]; **st** `INVITATION_PORT` (cfg): **no injection site** [P2 del]; `app:lib/use-cases/{create,redeem}-invitation.use-case.ts` (spec-only callers) [P6 del]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **wa** same adapter `save` (`setDoc`/`updateDoc { redemptionCount }`), `saveRedemption` (`setDoc { redeemedAt }`) [P2 del, no successor until Phase 4]. No server, seed or e2e writer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `auditLog` (publish/withdraw row)                                                            | **sa** the store's replay read of the withdrawal row [P1 → the pipeline's read half]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **sa** the store's `tx.create(auditRowCreate(...))` [P1 → `WriteOp.create(auditLog/{hash(rowBasis)}, row minus id)` in the pipeline's plan]; body unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**`cfg` rows the flip removes** (5 class-form rows) and adds (5 factory
rows, `provideLazyPort` factory form, each `onLoadError:
ecsDataUnavailable`): `LOYALTY_READER` (`FirestoreLoyaltyReader`: 4
methods) → `LOYALTY_ACCOUNT_READ_PORTS: LoyaltyAccountReadPorts`
(`loadLoyaltyAccount`, `listBadgeProgress`, `listSeasonProgress`:
`'promise'`); `LOYALTY_CATALOG_READER` → `LOYALTY_CATALOG_READ_PORTS:
LoyaltyCatalogReadPorts` (`loadLoyaltyCatalog: 'promise'`);
`LOYALTY_ACTIVITY_READER` → `CLIENT_JOURNAL_PORTS: ClientJournalPorts`
(`pageClientJournal: 'promise'`); `STREAK_DEFINITION_REPOSITORY`
(`rhythmRuleUnavailable`) → `STREAK_DEFINITION_PORTS:
StreakDefinitionPorts` (`observeStreakDefinitionHead: 'observable'`,
`listStreakDefinitionVersions: 'promise'`) + `STREAK_PUBLISH_PORTS:
StreakPublishGatewayPorts` (`publishStreakRule`, `withdrawStreakRule`:
`'promise'`; a lazy-load failure answers `RepositoryError.unavailable()`,
which the admin store words as today's "could not be sent", F3-3);
`INVITATION_PORT` → nothing. NEW in `cfg`: the `today: () => LocalDate` closure (`Date.now()` → `UtcEpochMs.of` → `ZonedTimeSystem.toLocal(…, 'Europe/Sofia').localDate`) the catalogue row passes, and both the catalogue and the gateway rows read `inj.get(LOYALTY_CATALOG_MEMO)` (one root memo, F3-10). `rhythmRuleUnavailable`, the
`StreakPublishFailedError` import and the comment "The flip-3/4 adapters …
classes" go. Untouched: `REWARD_PROGRESS_READER` (dormant), `MEDIA_READER`,
`AVATAR_UPLOADER`, every flip-1/2 row, the flip-4 rows.

**Re-derivation deltas — what the scouts' maps missed or got wrong** (each
folded into the rows above and the packages):

1. The four `LegacyWireCode.StreakPublish*` rows are NOT deleted: the
   frozen wire still answers those codes (F3-4); only new ecs codes are
   added, on new dotted wire codes.
2. `LedgerSystem`/`LedgerEntryRef` (`sy:ledger.system.ts`) has exactly one
   production consumer (`ledger.presenter.ts`); its re-type to `JournalEntry`
   rows is therefore the client card's package (P3), not P0, so wave 0
   breaks no consumer (§4).
3. `admin-rhythm.store.ts` declares its own `SHOP_ZONE = 'Europe/Sofia'`;
   `client-card.presenter.ts` already uses `ZonedTimeSystem.checkZone`;
   `achievements.presenter.ts`, `ledger.presenter.ts`,
   `loyalty.presenter.ts`, `medal-detail.presenter.ts`,
   `client-card.format.ts`, `admin-rhythm.words.ts` call the legacy
   `sofiaDayOf` — every one becomes a stored `*LocalDate` read (T5) or
   `ZonedTimeSystem.toLocal(ms, zone).localDate` on the feature's zone
   constant (UI formatting, never a system).
4. The visits specs' only loyalty dependency is `loyaltyFixtures.today`
   (`visit-row`, `visit-card`, `visit-card.presenter`, `visit-list`,
   `visit-filter-menu`, `visits-browser` specs) — they move to
   `FIXTURE_TODAY` of `@core/testing` (P4); `visit-fixtures.ts`'s comment
   names `InMemoryLoyaltyReader.seeded()`.
5. `rhythmRuleWords`/`rhythmRuleUnits` (`ft:shared/visits`) are called by
   the client card (`achievement-detail.ts`, `wallet.presenter.ts`) AND the
   admin page — their new signature is a contract (§3.5) so P3 and P4 build
   against it in parallel.
6. `glance.presenter.spec.ts` and `wallet.presenter.spec.ts` still import
   the legacy `GiftVoucherFields` type (a flip-1 leftover) — P3 moves them
   to the ecs `GiftVoucher`, since F3-14's gate covers the whole directory.
7. `apps/functions/tsconfig.app.json` references `libs/application/engagement`,
   `libs/domain/engagement`, `libs/application/shared`, `libs/domain/kernel`
   only for the publish files (`system-clock.ts`, `fixed-clock.ts`, the
   handler, the use case, the store); `libs/application/booking`
   (`isClientOperationId`, also `booking.wire.ts`), `libs/domain/accounts`
   and `libs/domain/governance` (`lib/booking/caller-roles.ts`, kept for
   `ops.wire.ts` and reused by `loyalty.wire.ts`) stay.
8. `firestore-paths.ts` (`wa:`) re-exports the application's
   `*_COLLECTION` constants as `Collections.*`/`Subcollections.*` keys used
   beyond the flip's adapters: P2 keeps the KEYS and their values, sourcing
   them from `@core/entities` `Collections`/`Subcollections` (no consumer
   breaks), and deletes the eight loyalty/invitation path helpers
   (`loyaltyAccountDocRef`, `badgeProgressCollection`,
   `seasonProgressCollection`, `clientJournalCollection`,
   `invitationsCollection`, `invitationDocRef`,
   `invitationRedemptionsCollection`, `invitationRedemptionDocRef`) and the
   `InvitationId` import; `RewardProgramId` stays (reward progress, F3-2).
   _Closed at integration (review, 2026-10-22):_ on the integrated tree no
   consumer spells a loyalty or invitation key through this file any more
   (every flip-3 user imports `@core/entities`), so the keys went too —
   `Collections.Invitations`, `BadgeCategories` … `ClientJournal` and
   `Subcollections.Redemptions`/`BadgeProgress`/`SeasonProgress` — leaving
   only the programme and `rewardProgress` spellings, as flips 1 and 2 left
   theirs.

---

## 3. Contracts every package builds against

### 3.1 P0 lands first, alone (the ecs-core vocabulary)

P0's edits fix the types, fixtures, doubles and tokens every other package
compiles against. P0 changes NO existing consumer's signature outside the
ports tier (none exists), so wave 0 is green alone (§4 P0 gate).

#### 3.1.1 Ports — the bundle map (Law 9)

**Port function types** (`engagement.port.ts`, P0):

- `LoadLoyaltyAccount = (customerId: CustomerId) => Promise<Result<LoyaltyAccount | null, RepositoryError>>`
  — `loyaltyAccounts/{customerId}`; `null` when absent; the stored body as
  stored (F3-1 (b)).
- `ListBadgeProgress` / `ListSeasonProgress` `(customerId: CustomerId)` —
  the whole subcollection, every document as stored.
- `LoyaltyCatalog` re-keyed to `LoyaltyCatalogParts`' keys and given the
  heads (F3-10): `{ categories, series, seasons, tiers, rewards, streaks:
readonly StreakDefinition[] }`; `LoadLoyaltyCatalog`'s doc names the six
  collections. The ports tier may not import the systems tier, so the
  record is declared here and `engagement-entities.type-spec.ts` (a leaf)
  pins `LoyaltyCatalog` assignable to `LoyaltyCatalogParts`.
- `PageClientJournal = (customerId: CustomerId, effects: readonly JournalEffect[], beforeSeq: number | null, limit: number) => Promise<Result<JournalPage, RepositoryError>>`
  — `customerId ==`, `journalVisibility == CLIENT`, `journalEffect in
effects`, `orderBy seq desc`, `seq <` the cursor when given, `limit + 1`
  read and trimmed by `PagingSystem` (today's adapter's own read), index
  #21 re-keyed. `JournalPage` unchanged.
- **New named shapes — a COMPONENT, not a ports-tier type** (a port's
  argument/answer is a named entity slice or component; the system that
  judges a call and builds a receipt may import components but never
  ports or pipelines, Law 8.2): NEW
  `libs/ecs-core/src/components/streak-publish-call.data.ts` (P0, + spec,
  - the components barrel line), Law 1's three exports under ONE name:
    the root type `StreakPublishCall = { requestId: PublishRequestId;
streakId: StreakDefinitionId; baseVersion: number; rule: StreakRule;
streakTransition: StreakTransition; previewHash: string | null }` (the
    rule as proposed — its `version` the proposal `baseVersion + 1`, its
    `effectiveFromLocalDate` the day asked); the type-only namespace
    `StreakPublishCall.Withdraw = { requestId: PublishRequestId; streakId:
StreakDefinitionId; version: number }` and `StreakPublishCall.Receipt =
{ version: number; effectiveFromLocalDate: LocalDate;
streakRuleDirection: StreakRuleDirection }` (field names exactly as
    above); the companion `StreakPublishCall = { withdraw(…), receipt(…) }`
    (pure factories). `engagement.port.ts`, `sy:streak-publish.system.ts`
    and the pipeline all import them from `@core/components`.
- `PublishStreakRule = (call: StreakPublishCall) => Promise<Result<StreakPublishCall.Receipt, StreakPublishError | RepositoryError>>`
  and `WithdrawStreakRule = (call: StreakPublishCall.Withdraw) => Promise<Result<void, StreakPublishError | RepositoryError>>`
  — a refusal is a `StreakPublishError` (`CallerNotAdmin` for `notAdmin`
  and for a thrown `permission-denied`/`unauthenticated`, as today's
  `thrownRefusalOf`; `Invalid` with the FLAT `StreakRuleField` values the
  gateway decodes from the legacy locators, an unknown locator kept as
  written; `TooEarly` with `earliest` when the answer carries it, else the
  request's day as `earliest` — today the web port drops it, and the
  assessment re-derives it, so the admin store keeps deriving it); a
  request that got no answer, or an answer that is none of the three, is
  a `RepositoryError` (today's `StreakPublishFailedError`). **"An answer
  that is none of the three" is today's whole table** (each a
  `RepositoryError`, the memo left alone): for a publish — no answer
  (`undefined`), a version that is not an integer ≥ 1 (`0`, `2.5`), an
  `effectiveFrom` that is no `LocalDate` (`'2026-02-30'`, an ISO instant),
  a `direction` outside the five words, a `refused` with a code outside
  the six words, and ANY `withdrawn` answer (today's "a publish was
  answered as a withdrawal"); for a withdrawal — no answer, a `published`
  answer, and a `withdrawn` answer whose `version` is not the requested
  one (today's "a withdrawal was answered for another version"). The
  gateway drops the catalogue memo (`memo.invalidate()`) only after a
  write that landed AND passed those checks; every refusal and every
  `RepositoryError` leaves it alone.
- `callables.ts`: unchanged (`PublishStreakDefinition` exists).

**Bundles** (✱ = new or re-cut by P0; everything else exists on `6d43e1c`
and is named, not changed):

| Port file            | Bundle                                   | Members                                                                                                                            | Bound by (1:1)                                                                                 |
| -------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `engagement.port.ts` | ✱ `LoyaltyAccountReadPorts`              | `loadLoyaltyAccount`, `listBadgeProgress`, `listSeasonProgress`                                                                    | web token `LOYALTY_ACCOUNT_READ_PORTS`; web adapter `loyaltyAccountReadPorts(db)`              |
| `engagement.port.ts` | ✱ `LoyaltyCatalogReadPorts`              | `loadLoyaltyCatalog`                                                                                                               | web token `LOYALTY_CATALOG_READ_PORTS`; web adapter `loyaltyCatalogReadPorts(db, memo, today)` |
| `engagement.port.ts` | ✱ `LoyaltyReadPorts`                     | `= LoyaltyAccountReadPorts & LoyaltyCatalogReadPorts` (was a record with no consumer)                                              | — (suite)                                                                                      |
| `engagement.port.ts` | `ClientJournalPorts`                     | `pageClientJournal` (re-keyed)                                                                                                     | web token `CLIENT_JOURNAL_PORTS`; web adapter `clientJournalPorts(db)`                         |
| `engagement.port.ts` | `StreakDefinitionPorts`                  | `observeStreakDefinitionHead`, `listStreakDefinitionVersions`                                                                      | web token `STREAK_DEFINITION_PORTS`; web adapter `streakDefinitionPorts(db)`                   |
| `engagement.port.ts` | ✱ `StreakPublishGatewayPorts`            | `publishStreakRule`, `withdrawStreakRule`                                                                                          | web token `STREAK_PUBLISH_PORTS`; web adapter `streakPublishGatewayPorts(functions, memo)`     |
| `engagement.port.ts` | `EngagementPorts`                        | `= CouponVoucherPorts & LoyaltyReadPorts & ClientJournalPorts & StreakDefinitionPorts & StreakPublishGatewayPorts` (✱ += the last) | — (context suite)                                                                              |
| `flags.port.ts`      | `FlagsPorts`                             | `flagOn`                                                                                                                           | ✱ server `paramFlagsPorts()` (new, `fn:adapters/flags.adapter.ts`)                             |
| `scheduling.port.ts` | `TenantZonePorts`                        | `tenantTimeZone`                                                                                                                   | the root's `serverPorts` (`WIRE_ZONE`)                                                         |
| `tx.port.ts`         | `CommitPorts`, `ClockPorts`, `HashPorts` | `commit`, `nowUtcMs`, `hash`                                                                                                       | `firestoreCommitPlan`, the root's clock, `cryptoPorts()`                                       |
| `telemetry.port.ts`  | `TelemetryPorts`                         | `log`, `trackError`                                                                                                                | `consoleTelemetry()`                                                                           |

No invitation bundle (F3-12).

**Entities** (P0): `loyalty-account.entity.ts` — `LoyaltyAccountMeta.id:
CustomerId`, `customerId: CustomerId` (was `userId: UserId`);
`journal-entry.entity.ts` — `JournalEntryMeta.customerId: CustomerId` (was
`userId`); the "until the loyalty flip (3)" sentences of both, of
`collections.ts` (`LoyaltyAccounts` "keyed by the client record",
`ClientJournal` id `{customerId}_{seq:6}`, the two progress
subcollections) and of the other loyalty entity files (provenance pointers
to `loyalty-document.ts` line ranges) rewritten to the after-state;
`invitation.entity.ts`'s claim that "the redeemInvitation pipeline" writes
it becomes "Phase 4's". `engagement-entities.type-spec.ts` gains: the
account and the journal entry key by `CustomerId` and a `UserId` is not
assignable to either key; `LoyaltyCatalog` carries `streaks: StreakDefinition[]` and is assignable to `LoyaltyCatalogParts` (F3-10).
`journal-entry.entity.spec.ts` builds its id from a `CustomerId` (its L7
`UserId` cast — the flatten-spec L7 known hit — goes).

**Primitives** (P0): `ids.primitive.ts` `JournalEntryId.forEntry(customerId:
CustomerId, seq)` (+ `ids.primitive.spec.ts`); `streak-publish-errors.data.ts`
(+ spec) adds `CallerUnauthenticated`, `CallerNotAdmin` and their factories
(scalars only, Law 8). No `invitation` code is added (F3-12).

**Components** (P0): `journal-effect.data.ts` (+ spec) adds `JournalFeed`
and `JournalFeed.effectsOf` (F3-11) — a dictionary with its companion and
namespace per Law 1; `streak-rule.data.ts` adds
`StreakRule.RULE_CHANGE_NOTICE_DAYS = 30` (F3-8) and nothing else; NEW
`streak-publish-call.data.ts` (+ spec, + `components/index.ts` line):
`StreakPublishCall` with its `Withdraw`/`Receipt` namespace types
(§3.1.1).

**Edge** (P0 for these rows only): `apps/functions/src/edge.ts` — the two
`StreakPublishErrorCode` rows on their new dotted codes,
`STREAK_PUBLISH_WIRE` as an explicit table (`CallerUnauthenticated` →
`params(S.Unauthenticated)`, every other code `ANSWERED`), the
`LEGACY_WIRE_CODE`/code-name entries; `edge.spec.ts`'s `ANSWERED_TODAY`
list gains `loyalty.streak_publish.caller_not_admin` (so "answers exactly
the streak publish's refusals" and "one rule per code" stay green).

**Testing** (`libs/ecs-core/src/testing/`, P0, + `index.ts` lines, + specs):

- `fixtures/loyalty/catalog.json` rewritten FLAT — `{ [collection]: { [id]:
body } }`, each body the entity minus `id`, true on `FIXTURE_TODAY`
  (2026-09-28), converted mechanically from today's file (a one-off script
  in the agent's scratchpad, never committed) so every figure, title, level
  and window is today's (F3-5's T5 days included; `grantVoucherCurrency:
'EUR'` on `reward-product`).
- NEW `fixtures/loyalty/account-georgi.json`, `account-martin.json` — flat,
  `{ uid, customerId, account, badgeProgress: { [seriesId]: body },
seasonProgress: { [seasonId]: body }, clientJournal: { [id]: body } }`,
  `customerId` the literal `CustomerId.forUser(UserId.of(uid), sha256)` of
  `dev-client-1` / `dev-client-2`, journal ids `${customerId}_${seq:06}`;
  converted from `app:testing/fixtures/loyalty/account-*.json` (which stay
  until P6 deletes them). `labelParams` keep the map's insertion order;
  `appointmentId` from the row's `correlationId` (`appt:{id}…`) else `null`.
- `loyalty.fixtures.ts`: the raw JSON exports `loyaltyCatalogJson` (kept
  name) and `loyaltyAccountJson` (`{ georgi, martin }`, for the seed and the
  e2e, which read by path or as JSON) and typed accessors
  `loyaltyCatalogFixture(): LoyaltyCatalog` and
  `loyaltyAccountFixtures: { georgi, martin }` each `{ uid: UserId;
customerId: CustomerId; account: LoyaltyAccount; badgeProgress:
readonly BadgeProgress[]; seasonProgress: readonly SeasonProgress[];
clientJournal: readonly JournalEntry[] }` (ids spread in, deep-frozen,
  journal sorted by `seq`). The existing `streakDefinitionFixture` /
  `streakDefinitionVersionFixture` stay; `loyalty.fixtures.spec.ts` holds
  both to the new JSON (and every account body to its entity's narrowing:
  one `TierOverride` variant, one `StreakPhaseState` variant per state).
- `port-doubles.ts` — ONE double per bundle (flip-1/2 convention):

| Double                                                                                                                                                                  | Returns                     | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memoryLoyaltyAccountReadPorts(world)`                                                                                                                                  | `LoyaltyAccountReadPorts`   | over `LoyaltyWorld` (`accounts`, `badgeProgress`, `seasonProgress` keyed by `CustomerId`); records each call (`calls`) for the store specs that assert what was (not) asked                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `memoryLoyaltyCatalogReadPorts(catalog?)`                                                                                                                               | `LoyaltyCatalogReadPorts`   | answers `loyaltyCatalogFixture()` (keyed `categories`…`streaks`, F3-10) or the given one; a `failing` option answers `RepositoryError`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `memoryClientJournalPorts(entries)`                                                                                                                                     | `ClientJournalPorts`        | `customerId`, `CLIENT`, `effects` filter, `seq <` cursor, desc, `PagingSystem` trim — the adapter's contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `memoryStreakWorld(seed)`                                                                                                                                               | `StreakWorld` (data only)   | a `MemoryStore` (`test-support.ts`, the store `memoryTxPorts` commits into) seeded with the heads, versions and audit rows at their flat paths, plus `changed()` — the ONE state the doubles below read and the pipeline double writes                                                                                                                                                                                                                                                                                                                                                                        |
| `memoryStreakDefinitionPorts(world)`                                                                                                                                    | `StreakDefinitionPorts`     | `observeStreakDefinitionHead` emits the head from the store and again on every `world.changed()` (rxjs `BehaviorSubject`); `listStreakDefinitionVersions` newest first                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `memoryStreakPublishGatewayPorts(world, { nowUtcMs, policy })` — **P1, wave 1**, NEW `testing/streak-publish-gateway.double.ts` (+ spec, + one `testing/index.ts` line) | `StreakPublishGatewayPorts` | a THIN closure over the REAL `publishStreakDefinition` / `withdrawStreakDefinition` of `@core/pipelines` (`src/testing` may import every tier, Law 8.3), run over `memoryTxPorts(world.store, { nowUtcMs, hash: fixtureHash })`, `{ flagOn }` from `policy.clientsSeeRhythm`, `tenantTimeZone: 'Europe/Sofia'`, `recordingTelemetry()`: it only translates `StreakPublishCall` into the command (an admin caller) and the result back, then calls `world.changed()` — no decision order of its own (successor of `InMemoryStreakDefinitionRepository`); `refuse`/`fail` options script a refusal or a failure |

A spec composes a suite by spreading doubles; a scripted member is an
override typed `Partial<TheBundle>`; nobody re-implements a double — nor a
pipeline: the gateway double runs the server's pipeline, so the admin page
specs exercise the decision order the callable runs. It lands with P1 (the
pipeline is P1's); P4 builds against its name and signature above in
parallel and is red on it until P1's half of wave 1 is merged (§4).

- **Web tokens** `libs/infrastructure/firebase-app/src/lib/ports.tokens.ts`:
  `LOYALTY_ACCOUNT_READ_PORTS = new InjectionToken<LoyaltyAccountReadPorts>('LOYALTY_ACCOUNT_READ_PORTS')`,
  `LOYALTY_CATALOG_READ_PORTS`, `CLIENT_JOURNAL_PORTS`,
  `STREAK_DEFINITION_PORTS`, `STREAK_PUBLISH_PORTS` — each typed by exactly
  one bundle of the table above.

### 3.2 The pipeline (`libs/ecs-core/src/pipelines/`, owner P1)

`publish-streak-definition.pipeline.ts` exports:

```ts
export type PublishStreakDefinitionPorts = CommitPorts &
  ClockPorts &
  HashPorts &
  FlagsPorts &
  TenantZonePorts;
// Integrator ruling (§8.1): no TelemetryPorts — the pipeline logs nothing,
// as today's use case logged nothing; the one log line ('rhythm rule write
// failed') is the wire's `publishStreakRefusal` (§3.3).

/**
 * The verified caller sits FLAT at the command's root (decoded by the wire
 * off the token, never the payload) — the flipped pipelines' `callerUserId`
 * precedent (`cancel-appointment`, `update-profile`); no nested 1-to-1
 * `caller` record, no `StreakPublishCaller` type.
 */
export type PublishStreakDefinitionCommand = {
  /** `null` when the request carries no signed-in uid. */
  readonly callerUserId: UserId | null;
  readonly callerIsAdmin: boolean;
  /** The audit row's actor, derived at the wire exactly as today's `auditActorOf(callerActor(request))`; `null` with no caller. */
  readonly callerActor: Actor | null;
  readonly requestId: PublishRequestId;
  readonly streakId: StreakDefinitionId;
  readonly baseVersion: number;
  /** The draft, decoded at the wire but judged only after `admit` (order frozen, F3-3). */
  readonly draft: Result<StreakRuleInput, StreakPublishError.Invalid>;
  /** As sent; a non-string reads as '' — `StreakRule.parse` refuses it as `effectiveFrom`. */
  readonly effectiveFrom: string;
  readonly streakTransition: StreakTransition;
  readonly previewHash: string | null;
};

export type WithdrawStreakDefinitionCommand = {
  readonly callerUserId: UserId | null;
  readonly callerIsAdmin: boolean;
  readonly callerActor: Actor | null;
  readonly requestId: PublishRequestId;
  readonly streakId: StreakDefinitionId;
  readonly version: number;
};

export const publishStreakDefinition: (
  ports: PublishStreakDefinitionPorts,
) => (
  cmd: PublishStreakDefinitionCommand,
) => Promise<
  Result<StreakPublishCall.Receipt, StreakPublishError | RepositoryError>
>;
export const withdrawStreakDefinition: (
  ports: PublishStreakDefinitionPorts,
) => (
  cmd: WithdrawStreakDefinitionCommand,
) => Promise<
  Result<{ readonly version: number }, StreakPublishError | RepositoryError>
>;
```

| Step                    | Publish                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Withdraw                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| caller                  | `StreakPublishSystem.admitCaller(cmd.callerUserId, cmd.callerIsAdmin)` (P1, new; primitives in, a `Result` out): `null` or a blank uid → `CALLER_UNAUTHENTICATED`; not admin → `CALLER_NOT_ADMIN` (the wire asked it first, before decoding; asked again here, as today's `execute`/`withdraw`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | same                                                                                                                                                                                                                                                                                                                                                                                            |
| now                     | `nowUtcMs` once → `today = ZonedTimeSystem.toLocal(now, tenantTimeZone).localDate` (F3-8); `policy = { clientsSeeRhythm: flagOn(FlagName.LoyaltySelfView), noticeDays: StreakRule.RULE_CHANGE_NOTICE_DAYS }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | same (no policy)                                                                                                                                                                                                                                                                                                                                                                                |
| read set (one `commit`) | `streakDefinitions/{id}` → `StreakDefinition \| null`; when a head exists, `versions where requestId == cmd.requestId limit 1` (the replay); `versions orderBy version desc limit 1` (the highest ever written, F3-8); the version document of the head's `SCHEDULED` rule, when there is one (the one a publish can call off)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `streakDefinitions/{id}`; `auditLog/{hash(rowBasis(LOYALTY_STREAK_DEFINITION_WITHDRAWN, forStreakDefinition(id), null, requestId))}` (the replay); the version document `cmd.version` names                                                                                                                                                                                                     |
| decide (pure)           | replayed → no writes, answer `StreakPublishSystem.replayReceipt(storedVersion)` (P1, new; a `StreakPublishCall.Receipt` from `@core/components`: the original version's number, day and direction); else today's order: `StreakPublishSystem.admit` (`recomputeNeedsEngine`, `previewStale`, `stale`) → `nameOf` (`null` → `Invalid(['id'])`) → `cmd.draft` err → that `Invalid` → `StreakRule.parse({ …draft, version: admitted, effectiveFromLocalDate: cmd.effectiveFrom })` err → `Invalid(fields)` → `decide(rule, transition, head, today, policy)` (`tooEarly`, the new head, `calledOff`, `inForceVersion`, `change`) → a head the schedule refuses (`StreakRuleSystem.schedule`) → `Invalid(fields)` → `StreakPublishSystem.publishPlan(…)` (P1, new, pure): the DECISION STRUCT `{ versionBody, stampVersions, headBody, audit: AuditRowPlan[] }` — the new version's body (the flat rule + `publishedAtUtcMs: now`, `publishedByUserId: cmd.callerUserId`, `streakTransition`, `streakRuleDirection: change.direction`, `changed: change.changed`, `requestId`, `withdrawnAtUtcMs: null`), the called-off version numbers whose document the read found, the head body (`{ name, rules: decided head, updatedAtUtcMs: now }`), and `AuditSystem.plan([{ resourceId, subjects: [], changeKey: requestId, context: AuditContext.streakPublished({…}) }], cmd.callerActor, now)` (a refused plan is a defect, as today) | replayed (the row exists) → no writes, answer `{ version: cmd.version }`; else `StreakPublishSystem.withdraw(version, head, today)` (`stale` when nothing waits or the head is absent, as today) → `StreakPublishSystem.withdrawPlan(…)` (P1, new, pure): `{ stampVersions, headBody: { name, rules: [current], updatedAtUtcMs: now }, audit: AuditRowPlan[] }` (the `streakWithdrawn` context) |
| write plan (pipeline)   | the PIPELINE maps the struct to `WriteOp`s, as every flip-1/2 pipeline does (no system emits a `WriteOp`, and only the pipeline holds `ports.hash`): `WriteOp.create(versions/{forVersion(n)}, versionBody)`; per `stampVersions` entry `WriteOp.update(versions/{forVersion(v)}, { withdrawnAtUtcMs: now })`; `WriteOp.set(streakDefinitions/{id}, headBody)` (whole, as today); per audit plan `WriteOp.create(auditLog/{ports.hash(plan.idBasis)}, plan.row)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | the same mapping of the withdrawal struct: the `withdrawnAtUtcMs` update(s) (existing docs only), `WriteOp.set(head, headBody)`, the `streakWithdrawn` audit row create                                                                                                                                                                                                                         |
| answer                  | `{ version: n, effectiveFromLocalDate, streakRuleDirection }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `{ version }`                                                                                                                                                                                                                                                                                                                                                                                   |
| failure                 | a commit `RepositoryError` VALUE (a taken version number's `ALREADY_EXISTS` included — today's "a version number that was taken" → `store_failed`) is answered as is; a commit that REJECTS (contention retries exhausted, a deadline or network fault, the "audit plan refused" defect thrown inside `decide`) is turned into `RepositoryError.writeFailed(null, String(cause))` by the `main.ts` handler (§3.3) — today's store caught every throw inside `runTransaction`; the wire translates either to `store_failed` and logs `'rhythm rule write failed'` (F3-4, F3-1 (c))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | same                                                                                                                                                                                                                                                                                                                                                                                            |

Idempotency: `requestId` (replay above); version numbers created with
`Create` (a race loses the transaction, never overwrites); the audit row id
derived from `requestId` (a replayed act writes no second row). The
decision helpers (`admitCaller`, `replayReceipt`, `publishPlan`,
`withdrawPlan`) are pure functions added to `sy:streak-publish.system.ts`
(Law 3/4: a pipeline holds no business math) — they import only
`@core/primitives`, `@core/components` (`StreakPublishCall` and its
`Receipt`) and `@core/entities`, never a ports or pipelines type, and
return decision structs, never `WriteOp`s (the pipeline maps them, applying
`ports.hash` to each audit `idBasis`). Owned by P1 (their only caller),
with their spec cases in `streak-publish.system.spec.ts`.

The pipeline spec asserts the exact `WriteOp[]` that reached `commit`
(`memoryTxPorts`, `pinnedNowUtcMs`, `fixtureHash`, `recordingTelemetry`,
`streakDefinitionFixture`, `streakDefinitionVersionFixture`): a first
publish (no head: head + version 1 + row), a publish in force today
(head `[CURRENT]`), a later one that waits (`[CURRENT, SCHEDULED]`), one
that replaces a waiting version whose document exists (the stamp) and one
whose document is absent (no stamp), the withdrawal (stamp + head + row),
each replay (no writes, the original answer), each refusal in today's
order, and the transition/notice boundaries on pinned days (never the wall
clock: `RULE_CHANGE_NOTICE_DAYS` and "may start tomorrow" are date maths).

### 3.3 Server adapters, the wire, the composition root (owner P1)

- `fn:adapters/flags.adapter.ts` (new, + spec): `paramFlagsPorts():
FlagsPorts` — `flagOn(key) => FLAG_PARAMS[key].value()` read per call
  (`lib/flags.ts`, whose `FeatureFlagKey` strings equal `FlagName`'s; a
  type-level assertion pins the equality). Logic-free.
- `fn:wire/loyalty.wire.ts` (new, + spec — a frozen-wire file, `WIRE3`):
  `decodeStreakCaller(request): { callerUserId: UserId | null;
callerIsAdmin: boolean; callerActor: Actor | null }` — the command's three
  FLAT root fields, spread into it (today's `toCaller` + `auditActorOf`:
  `callerActor`/`callerIsAdmin` from `lib/booking/caller-roles.ts`, the
  legacy actor's kind → claims → `Actor.forCaller`, verbatim; no uid →
  `null`, `false`, `null`); `decodeStreakRequest(raw)` (today's
  `toRequest` field by field, F3-3, refusing with
  `LegacyWireCode.StreakPublishInvalidInput` + `field`); `decodeDraft(raw):
Result<StreakRuleInput, StreakPublishError.Invalid>` (the nested legacy
  body → the flat input; a value not of the wire's kind → `Invalid([the
legacy dotted path])`, `excuses[2]` reported as `excuses`, today's
  `streakScheduleFromDocument` type checks); `encodeStreakPublishAnswer`,
  `encodeStreakWithdrawAnswer` (`direction` SCREAMING → today's lowercase
  word); `publishStreakRefusal(error)` → the ANSWERED `{ kind: 'refused',
code, fields, earliest? }` or the thrown legacy fault, by this table
  (the ecs `TooEarly` struct carries no `fields`, so the encoder supplies
  today's; every row pinned literally in `loyalty.wire.spec.ts`):

  | ecs `errorCode`                                          | answer / fault                                                                                                                                                                                                                                                                                                                                                                                                    |
  | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `LOYALTY_STREAK_PUBLISH_INVALID`                         | `{ kind: 'refused', code: 'invalid', fields: [each flat StreakRuleField → today's LEGACY_FIELD locator, anything else as written] }`                                                                                                                                                                                                                                                                              |
  | `LOYALTY_STREAK_PUBLISH_TOO_EARLY`                       | `{ kind: 'refused', code: 'tooEarly', fields: ['effectiveFrom'], earliest }`                                                                                                                                                                                                                                                                                                                                      |
  | `…_STALE`, `…_RECOMPUTE_NEEDS_ENGINE`, `…_PREVIEW_STALE` | `{ kind: 'refused', code: 'stale' \| 'recomputeNeedsEngine' \| 'previewStale', fields: [] }` (no `earliest` key)                                                                                                                                                                                                                                                                                                  |
  | `LOYALTY_STREAK_PUBLISH_CALLER_NOT_ADMIN`                | `{ kind: 'refused', code: 'notAdmin', fields: [] }`                                                                                                                                                                                                                                                                                                                                                               |
  | `LOYALTY_STREAK_PUBLISH_CALLER_UNAUTHENTICATED`          | thrown `unauthenticated`, `details.code` `loyalty.streak_publish.unauthenticated`                                                                                                                                                                                                                                                                                                                                 |
  | any `RepositoryError`                                    | logs `('error', 'rhythm rule write failed', { error })` — `error` = the struct's `reason` when it has one (`writeFailed(null, String(cause))` from the handler: today's text, e.g. `'Error: deadline exceeded'`), else `` `${errorCode} ${path}` `` (the `ALREADY_EXISTS` value, departure F3-1 (c)) — then throws `internal`, `details.code` `loyalty.streak_publish.store_failed`, the cause never in `details` |

  The spec is written
  FIRST from the deleted handler's and use case's specs (§5.4) and pins
  status, `details` and every answered field byte for byte, the order
  (caller before envelope), a sysadmin-only, admin, admin+barber and
  barber-only caller's audit actor.

- `main.ts`: `publishStreakDefinition` becomes a `callableEdge` row
  (`failureCode: LegacyWireCode.StreakPublishStoreFailed`, the name and
  options byte-identical): decode the caller → `admitCaller` refusal
  answered/thrown → decode the envelope → run `publishStreakDefinition` or
  `withdrawStreakDefinition` over `{ ...serverPorts(), ...paramFlagsPorts() }`
  with ONE override: `commit` wrapped so a REJECTED commit resolves to
  `Result.err(RepositoryError.writeFailed(null, String(cause)))` (today's
  store caught every throw inside `runTransaction` — contention, a
  deadline, a network fault, the audit-plan defect — and answered
  `store_failed` with the log line; `unexpected()` would track it but never
  log it) → encode / refuse. `main.spec.ts` carries the legacy case
  "throws internal when the write falls over, and says why where alerting
  can find it": a commit that rejects with `Error('deadline exceeded')` →
  status `internal`, `details.code` `loyalty.streak_publish.store_failed`,
  `'deadline'` not in `details`, the log line
  `{ error: 'Error: deadline exceeded' }`; a second case pins the
  `ALREADY_EXISTS` value's line (F3-1 (c)). The `lib/loyalty/*` import
  goes; `legacyCallable` has no caller left (§7).
- `fn:integration/publish-streak-definition.integration.spec.ts` (new,
  emulator, run by the integrator only): a publish writes the flat head,
  version and audit row in one transaction; a retry with the same
  `requestId` writes nothing and answers the same receipt; a withdrawal
  stamps `withdrawnAtUtcMs` on the existing version and sets the head to
  `[CURRENT]`; two concurrent publishes on one `baseVersion` → one
  `published`, one `stale`.

### 3.4 Web bundles (`libs/infrastructure/**`, owner P2)

| New file                                                      | Export (each returns ONE bundle by name)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Replaces (deleted)                                                                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `wa:loyalty.adapter.ts`                                       | `loyaltyAccountReadPorts(db): LoyaltyAccountReadPorts` (`getDoc` of `loyaltyAccounts/{customerId}` → `{ id, ...data }` or `null`; `getDocs` of each subcollection, every doc spread); `clientJournalPorts(db): ClientJournalPorts` (the §3.1.1 query, `startAfter(beforeSeq)` on `seq` desc, `limit + 1` via `PagingSystem.pageSize`, trimmed by `PagingSystem.nextCursor`)                                                                                                                                                                                                                                                            | `wa:loyalty-reader.adapter.ts` (`FirestoreLoyaltyReader`), `wa:loyalty-activity-reader.adapter.ts` (`FirestoreLoyaltyActivityReader`) |
| `wa:loyalty-catalog.adapter.ts`                               | `loyaltyCatalogReadPorts(db, memo: LoyaltyCatalogMemo, today: () => LocalDate): LoyaltyCatalogReadPorts` (six `getDocs`, spread, under F3-10's keys `categories`…`streaks`; the memo per `today()` day, a failure never kept) — its ONLY export; no class, no `shopToday`, no clock or zone code (the day closure is `cfg`'s, the memo `firebase-app`'s, F3-10)                                                                                                                                                                                                                                                                        | `wa:loyalty-catalog-reader.adapter.ts` (and its `LoyaltyCatalogSession` class)                                                        |
| `wa:streak-definitions.adapter.ts`                            | `streakDefinitionPorts(db): StreakDefinitionPorts` (`onSnapshot` head through `subscribeWithRetry`, `null` when absent; `versions orderBy version desc limit(max(1, limit))`)                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `wa:streak-definition-repository.adapter.ts` (reads)                                                                                  |
| `wa:streak-publish-gateway.adapter.ts` (frozen wire, `WIRE3`) | `streakPublishGatewayPorts(functions, memo: LoyaltyCatalogMemo): StreakPublishGatewayPorts` — encodes `StreakPublishCall` into today's request (`draft` = the nested legacy body of `call.rule`, field for field what `streakDefinitionToDocument` wrote, its `effectiveFrom` the rule's day), decodes the answer (`answerOf` + `thrownRefusalOf`, today's rules, including §3.1.1's whole "none of the three" table: a `withdrawn` answer to a publish, and a withdrawal answered other than `withdrawn` with the requested version, are a `RepositoryError`), `memo.invalidate()` only after a landed write that passed those checks | `wa:streak-definition-repository.adapter.ts` (writes)                                                                                 |

NEW `libs/infrastructure/firebase-app/src/lib/loyalty-catalog-memo.ts`
(+ spec, + its barrel line; eager, SDK-free, so `cfg` imports it without
pulling the lazy Firestore chunk): `type LoyaltyCatalogMemo = { readOn(day:
LocalDate); keep(read, day); drop(read); invalidate() }` over `read:
Promise<Result<LoyaltyCatalog, RepositoryError>>` — a record of closures,
NOT a port (it is declared here, never in `@core/ports`); `loyaltyCatalogMemo():
LoyaltyCatalogMemo` (a `let held` inside the closure, today's four
semantics); `LOYALTY_CATALOG_MEMO = new InjectionToken<LoyaltyCatalogMemo>(
'LOYALTY_CATALOG_MEMO', { providedIn: 'root', factory: loyaltyCatalogMemo })`.
`firestore.adapters.ts` exports the new factory names and drops the five
classes, `invitation.adapter` and `LoyaltyCatalogSession`;
`firestore-paths.ts` per delta 8. Each factory row in `cfg` per §2; the
catalogue and gateway rows both pass `inj.get(LOYALTY_CATALOG_MEMO)` so
they share the one memo, as today, and the catalogue row passes `cfg`'s
`today` closure. Each adapter spec has the case "a stored body is
answered as stored" (F3-1 (b)) and the query-shape cases of the deleted
specs; the gateway spec carries BOTH `it.each` tables of the deleted
`streak-definition-repository.adapter.spec.ts` ("never reports a publish
on %s: it is no answer at all" — 7 rows incl. "a withdrawal, to a
publish"; "never reports a withdrawal on an answer for %s" — "another
version", "a publish", "nothing"), each asserting a `RepositoryError` and
the memo NOT invalidated (ledgered in §11.2); the integration specs
(emulator) keep the deleted ones' query and paging cases against flat
seeds.

### 3.5 Store and presenter fields (owners P3, P4) — what "re-typed" means

- **Client card store** (`cc:lib/client-card.store.ts`): `inject` the four
  new tokens (`LOYALTY_ACCOUNT_READ_PORTS`, `LOYALTY_CATALOG_READ_PORTS`,
  `CLIENT_JOURNAL_PORTS`, `COUPON_VOUCHER_PORTS` unchanged), all
  `{ optional: true }` as today. `_account: Slice<LoyaltyAccount | null>`,
  `_progress: Slice<readonly BadgeProgress[]>`, `_seasonProgress`,
  `_catalog: Slice<ValidLoyaltyCatalog>` (`loadCatalog` hands the port's `LoyaltyCatalog` UNMAPPED to `LoyaltyCatalogSystem.validate`; `err` → the slice `failed`, F3-10), `_activity: Slice<readonly
JournalEntry[]>`, the ledger page's `entries: readonly JournalEntry[]`,
  `filter: JournalFeed`, `next: number | null`. `loadLoyalty`,
  `loadFeed`, `loadLedgerFirst`, `readLedgerPage`, `fetchMoreLedger` ride
  `withRecord` (F3-6; `fetchMoreLedger` reads the record already known).
  `WALLET_ACTIVITY_READ = 12`, `LEDGER_PAGE_READ = 30` unchanged.
- **Legacy → ecs, everywhere in P3/P4 files** (no inbound mapping):
  `account.streaks[id]` / `Object.keys|values|entries(account.streaks)` →
  `StreakState.find` / an index `for` over `account.streaks` (`account.streaks[i]`
  is the Law 3 scan and passes §6's K3m gate, which matches only a
  key-indexed read);
  `account.tier.current|since|override` → `tierId`, `tierSinceUtcMs` (a
  day by `ZonedTimeSystem.toLocal` on the feature zone), `tierOverrideSource`
  (+ narrowed fields); `state.phase.kind` → `streakPhase` (+ the variant's
  `phase*` fields); `state.period` → the four `period*` fields /
  `StreakState.periodTerms`; `state.heldBy` → `heldByAppointmentId`/`heldOn`;
  `lastQualifiedAt: Date` → `lastQualifiedAtUtcMs`; `earned[].earnedAt` →
  `earnedLocalDate` (the stored T5 day — never re-bucketed) and
  `earnedAtUtcMs`; `via` → `earnedVia`; `record.kind` →
  `personalRecordKind`; `pointsExpiry` → `pointsExpireOn`/
  `pointsExpiryNoticeFrom`; journal `entry.at` → `utcEpochMs` / `localDate`,
  `effect.kind` → `journalEffect`, `label.code|params` → `labelCode` /
  `PublicLabel.param(entry, name)` (`@core/components`, F3-11), `appointmentIdOf(correlationId)`
  → `appointmentId`; catalogue `catalog.series(id)` & co. →
  `LoyaltyCatalogSystem.category|series|seriesIn|season|tier|streak|streakInForce`
  over the store's `ValidLoyaltyCatalog` (no renaming of a catalogue key by
  any P3/P5 file — the port already speaks the system's keys, F3-10);
  `awards[].kind` → `awardKind`; `subject` → `badgeSubject` +
  `subject*Id`; `season.window` → `windowFrom`/`windowUntil`;
  `tier.qualify` → `qualify*`; `reward.grants` → `rewardGrant` + `grant*`;
  `sofiaDayOf` → the stored `*LocalDate`, else `ZonedTimeSystem.toLocal`
  on the feature's zone constant; `tierSteps` → `TierSystem.steps`;
  `bestAffordable`/`nextAffordable` → `RewardSystem.affordable`;
  `earnedLevelCount`/`isNewSince` → `StandingSystem.*`; the streak
  projector/track → `StreakSystem.project`/`trace`/`track`;
  `StreakDefinition.default()`/`.create` → `StreakRule.DEFAULT` /
  `StreakRule.parse`; `schedule.inForceOn`/`upcomingOn` →
  `StreakRuleSystem.*`; `.summary()` → `StreakRuleSystem.summary`; the
  admin preview → `StreakPreviewSystem.estimate`; `levelNumeral` → a words
  helper in the feature (UI formatting, P3's `client-card.format.ts`; the
  admin page uses its own if it needs one). Every lowercase literal a
  words table was keyed by (phase kinds, freeze reasons, period marks and
  reasons, record kinds, interval sources, award kinds, pills) is re-keyed
  by the SCREAMING dictionary with the SAME rendered text (`satisfies
Record<Dict, string>`); i18n keys and DOM test ids keep their lowercase
  spelling.
- **`rhythmRuleWords(summary, translate, lang, context)`**
  (`ft:shared/visits`, P4 — the contract P3 calls): `summary:
StreakRuleSummary` from `@core/systems` (`StreakRuleSystem.summary`);
  `context.period?: StreakPeriodTerms | null` (`@core/components`, read
  under a `PERSONAL` interval only); `context.nameOf` unchanged. Same
  sentences, same keys. `rhythmRuleUnits` unchanged.
- **Admin rhythm store** (`ft:admin/loyalty`): `STREAK_DEFINITION_PORTS` +
  `STREAK_PUBLISH_PORTS`; the head as `StreakDefinition`, the history as
  `StreakDefinitionVersion[]` (`publishedAtUtcMs` worded by its Sofia day,
  `changed` by `StreakRuleParameter` words, `streakRuleDirection`); the
  draft is a `StreakRuleInput` (`RhythmDraftSystem` already speaks it), the
  assessment `StreakPublishSystem.assess`; a publish sends
  `StreakPublishCall`; refusals worded by `errorCode` with today's text
  (the field highlight by flat `StreakRuleField`); a `RepositoryError` →
  today's "could not be sent". `ADMIN_RHYTHM_STREAK_ID =
StreakRule.DEFAULT_DEFINITION_ID`.

---

## 4. Packages

Run order by **wave**: **wave 0 = P0 alone** (the ecs-core vocabulary every
other package compiles against; it lands green on its own gate) → **wave 1
= P1–P5 in parallel** → **wave 2 = P6 alone** (the legacy sweep: it can
only delete once every wave-1 importer is gone — a real dependency) →
integration (§8). Ownership is disjoint by file within a wave; a directory
listed with `/**` is owned whole. A package never edits another package's
file; a needed change is reported to the integrator. Every package obeys
Law 9 in what it writes (bundles by name, adapters returning bundles, no
`Pick`/`Omit` of a `*Ports` type, no port type outside the ports tier).
**Expected red while wave 1 is partial** (never a P0 type, double or
token): the legacy application specs that parse the reshaped
`catalog.json` (until P6), `tools/seed` until P5, `cfg` factory rows before
P2's bundles exist, `main.ts` before P1's wire exists, the client card and
admin page while P3/P4 convert, `rhythmRuleWords` callers between P4's and
P3's edits, and P4's admin-page specs on `memoryStreakPublishGatewayPorts`
until P1's double (and the pipeline it runs) is merged. Wave 0 itself is
never red at typecheck: P0's one-line cast in the legacy `testing.ts`
keeps every project importing `@creativo/application/engagement/testing`
compiling (their runtime reds on the flat JSON are the legacy specs P6
deletes and the wave-1 specs P3–P5 re-target).

### P0 — ecs-core vocabulary, fixtures, doubles, tokens · wave 0

**Change:** `libs/ecs-core/src/primitives/{ids.primitive,streak-publish-errors.data}.ts` (+ specs);
`libs/ecs-core/src/components/{journal-effect,streak-rule}.data.ts` (+ specs; `streak-rule` only the constant), `components/index.ts` (one line);
`libs/ecs-core/src/entities/{loyalty-account,journal-entry,badge-progress,season-progress,badge-category,badge-series,season,tier-definition,reward-catalog-item,streak-definition,streak-definition-version,invitation,invitation-redemption}.entity.ts` (re-key + after-state docs),
`entities/collections.ts`, `entities/engagement-entities.type-spec.ts`, `entities/journal-entry.entity.spec.ts`;
`libs/ecs-core/src/ports/engagement.port.ts`;
`libs/ecs-core/src/testing/{loyalty.fixtures,port-doubles,index}.ts` (+ `loyalty.fixtures.spec.ts`, `port-doubles.spec.ts`),
`testing/fixtures/loyalty/catalog.json`;
`libs/infrastructure/firebase-app/src/lib/ports.tokens.ts` (+ its barrel if it lists names);
`apps/functions/src/edge.ts` (F3-4 rows and `STREAK_PUBLISH_WIRE` only), `apps/functions/src/edge.spec.ts` (`ANSWERED_TODAY` only);
`libs/application/engagement/src/testing.ts` — ONE line, wave 0 only:
`catalog: loyaltyCatalogJson as unknown as LoyaltyCatalogFixture` in place
of `fixture<LoyaltyCatalogFixture>(loyaltyCatalogJson)` (its `Json<T>`
check holds the JSON to the NESTED legacy bodies, so the flat file would
not compile in `admin-loyalty`, `shared/visits`,
`infrastructure/firestore`, `staff-client-card`, `staff-dashboard` and
`engagement`); P6 deletes the line with the rest in wave 2.
**New:** `libs/ecs-core/src/testing/fixtures/loyalty/{account-georgi,account-martin}.json`;
`libs/ecs-core/src/components/streak-publish-call.data.ts` (+ `.spec.ts`, §3.1.1).
**Brief:** §3.1 verbatim. Convert the fixtures mechanically (no figure
changes; T5 days by the Sofia rule; journal `appointmentId` from the
correlation id). The docs of the files P0 owns that name a §6 word
(`engagement.port.ts`'s `ACTIVITY_EFFECT_KINDS`, `loyalty.fixtures.ts`'s
`loyaltyFixtures`, "keyed by the uid", "until the loyalty flip (3)") are
rewritten to the after-state — the gate counts comments. Before landing: `git grep -nE
"(LoyaltyReadPorts|ClientJournalPorts|StreakDefinitionPorts|LoadLoyaltyAccount|PageClientJournal|JournalEntryId\.forEntry)"`
outside `libs/ecs-core` must be empty (it is on `6d43e1c`). **Gate on its
own:** `pnpm nx typecheck ecs-core`, `pnpm nx test ecs-core --coverage`,
`pnpm nx lint ecs-core`, `pnpm nx run verify-tools:layering --skip-nx-cache`,
`pnpm nx run-many -t typecheck --skip-nx-cache` (baseline reds only —
with the one-line cast above; `admin-loyalty` must stay green),
`pnpm nx test functions -- edge.spec`. Land before wave 1 starts.

### P1 — server: the publish pipeline, wire, adapters, root, deletions · wave 1

**New:** `libs/ecs-core/src/pipelines/publish-streak-definition.pipeline.ts` (+ `.pipeline.spec.ts`);
`libs/ecs-core/src/testing/streak-publish-gateway.double.ts` (+ `.spec.ts`; `memoryStreakPublishGatewayPorts`, §3.1);
`apps/functions/src/wire/loyalty.wire.ts` (+ spec);
`apps/functions/src/adapters/flags.adapter.ts` (+ spec);
`apps/functions/src/integration/publish-streak-definition.integration.spec.ts`.
**Change:** `libs/ecs-core/src/pipelines/index.ts` (one line);
`libs/ecs-core/src/testing/index.ts` (one line, the double — wave 1, after
P0's wave-0 edits);
`libs/ecs-core/src/systems/streak-publish.system.ts` (+ spec: `admitCaller`,
`replayReceipt`, `publishPlan`, `withdrawPlan` — decision structs, no
`WriteOp`, no ports/pipelines import; `assess`/`admit`/`decide`/`withdraw`
untouched — P4 calls them; the doc comments naming
`InMemoryStreakDefinitionRepository` in BOTH files are rewritten to the
pipeline and its gateway double, §6 T3);
`apps/functions/src/main.ts`, `main.spec.ts` (the endpoint pinned by literal
options; no `lib/loyalty` import), `edge.ts` (wave 1: delete
`legacyCallable` and its now-unused imports — P0's rows stay as landed),
`edge.spec.ts` (floors and the `legacyCallable` wrapper cases, §7.2);
`apps/functions/tsconfig.app.json` (references per delta 7; `pnpm nx sync`
writes the same); `tools/verify/p0/functions-deps.baseline.json`
(re-recorded only if `check-functions-deps.mjs` says the generated
`package.json` shrank).
**Delete:** §7.1's server list.
**Brief:** §3.2 and §3.3. Write `loyalty.wire.spec.ts` and the pipeline
spec from the deleted specs FIRST, case by case (§5.4), then delete. The
`main.ts` row wraps `commit` so a rejection becomes
`RepositoryError.writeFailed(null, String(cause))` (§3.3), and the refusal
encoder follows §3.3's per-code table literally (`tooEarly` →
`fields: ['effectiveFrom']`). The
draft decoder must reproduce today's `invalid` `fields` for a mistyped
draft (the legacy reader's first faulty path) and the domain's fields in
today's order for a typed one (`StreakRule.parse` order — where it differs
from the legacy factory's order, the wire sorts by today's order and the
spec pins it). `nowUtcMs` and the flags are ports; nothing reads
`Date.now()` or `process.env` outside the adapters and the root.

### P2 — web data layer (`libs/infrastructure/**`, `cfg`) · wave 1

**New:** `libs/infrastructure/firestore/src/lib/{loyalty,loyalty-catalog,streak-definitions,streak-publish-gateway}.adapter.ts` (+ `.spec.ts` each),
`{loyalty,loyalty-catalog,streak-definitions}.adapter.integration.spec.ts`.
**New (also):** `libs/infrastructure/firebase-app/src/lib/loyalty-catalog-memo.ts` (+ `.spec.ts`: today's four memo cases of the deleted catalogue-reader spec).
**Change:** `libs/infrastructure/firestore/src/lib/{firestore.adapters,firestore-paths}.ts`;
`libs/infrastructure/firebase-app/src/index.ts` (the memo line — P0's
wave-0 token lines stay as landed);
`libs/infrastructure/clock/src/lib/system-clock.adapter.ts` (doc comment
only: its pointer to `apps/functions/src/adapters/system-clock.ts`, which
P1 deletes, is rewritten — the web clock itself, its spec, barrel and the
`CLOCK` row stay, §7.1);
`apps/web/src/app/app.config.ts` (also the `today` closure and the two
`LOYALTY_CATALOG_MEMO` reads, §2); `apps/web/src/app/app.spec.ts` (only if
it provides a removed token — it does not on `6d43e1c`; report otherwise).
**Delete:** `libs/infrastructure/firestore/src/lib/{invitation.adapter,loyalty-reader.adapter,loyalty-activity-reader.adapter,loyalty-catalog-reader.adapter,streak-definition-repository.adapter}.ts`
with every `.spec.ts` / `.integration.spec.ts` of them.
**Brief:** §3.4 and §2's `cfg` rows. Adapters spread `snap.data()`
(Law 5) — no reconstitute, no mapper, no validation (F3-1 (b)); the
gateway is the one frozen-wire file (its draft encoder is pinned against a
literal of today's `streakDefinitionToDocument(StreakDefinition.default())`
output, recorded BEFORE the legacy mapper is deleted). Ledger every
deleted case (§5.4); `rules.integration.spec.ts` in the same folder is P5's.

### P3 — the staff client card · wave 1

**Own whole:** `libs/features/staff/client-card/**`; and
`libs/features/staff/dashboard/src/lib/visit-editor/staff-visit-editor.spec.ts`
(provider swap only); and `libs/ecs-core/src/systems/ledger.system.ts`
(+ `ledger.system.spec.ts`) — delta 2.
**Brief:** §3.5 and F3-6/F3-7/F3-10/F3-11. `LedgerSystem.fold`,
`wholeMonths`, `months`, `leading` take `JournalEntry` rows (the
`LedgerEntryRef` struct and the presenter's `ledgerRefOf` go; the spec's
cases keep their titles, re-seeded as `JournalEntry` rows). The fixtures
and rig (`src/testing/**`) build from `loyaltyAccountFixtures` /
`loyaltyCatalogFixture()` and the P0 doubles (`HeldCatalogReader` → a held
variant typed `LoyaltyCatalogReadPorts`); every spec keeps its cases, a
renamed expectation becomes the SCREAMING value with the same words on
screen; one store spec case per F3-1 (a) branch (no record → no loyalty;
record read failed → the loyalty slices failed; retry re-resolves) and one
for the catalogue check (a catalogue `LoyaltyCatalogSystem.validate`
refuses fails the catalogue slice, as today). The catalogue reaches every
system UNMAPPED (F3-10): no P3 file renames a catalogue key, builds a
`{ families }`/`{ tiers }` view or edits `loyalty-catalog.system.ts`; a
streak is found with `StreakState.find` or an index loop, never a
key-indexed read (§6 `K3m`); a label parameter is `PublicLabel.param`
(F3-11). No
`@creativo/(application|domain)/engagement` import survives in the
directory (§6). Baseline reds of `staff-client-card` typecheck (spec-only)
must not grow. Visual: §8's smoke of the card.

### P4 — the admin rhythm page and the shared rhythm words · wave 1

**Own whole:** `libs/features/admin/loyalty/**`;
`libs/features/shared/visits/src/lib/rhythm-rule/**`;
`libs/features/shared/visits/src/lib/testing/visit-fixtures.ts` (comment);
the six visits specs of delta 4 (`loyaltyFixtures.today` → `FIXTURE_TODAY`
only); `libs/ecs-core/src/systems/streak-preview.system.spec.ts` (the
`describe('PreviewStreakDefinitionUseCase'` title only → `describe('StreakPreviewSystem.estimate — the admin preview'`;
its cases unchanged — the successor P6's §11.3 ledger lines point at).
**Brief:** §3.5's `rhythmRuleWords` contract and admin-store bullet.
The page's specs swap `InMemoryStreakDefinitionRepository` for
`memoryStreakWorld` + `memoryStreakDefinitionPorts` (P0) +
`memoryStreakPublishGatewayPorts` (P1's, over the real pipeline — red until
P1 merges, §4 intro; the same reference semantics: a publish the page
sends is observed back on the head); every case kept. The
preview (`admin-rhythm.preview.ts`) folds the client stats through
`StreakPreviewSystem` over `StreakRule` (no `projectStreak`). Words keep
their text. Baseline: `admin-loyalty` typecheck is green and must stay so.

### P5 — data plane: rules, indexes, seed, e2e, runbook · wave 1

**New:** `tools/seed/fixtures/loyalty.fixtures.ts` — the seed's loyalty
body builders (account, badge/season progress, journal row, head, version,
each catalogue item), every one `satisfies Omit<X, 'id'>` against
`@core/entities` (`LoyaltyAccount`, `BadgeProgress`, `SeasonProgress`,
`JournalEntry`, `StreakDefinition`, `StreakDefinitionVersion`,
`BadgeCategory`, `BadgeSeries`, `Season`, `TierDefinition`,
`RewardCatalogItem`), imported by `loyalty.mjs` through the esbuild path
of `load-domain.mjs` exactly as `promotions.mjs` imports
`promotions.fixtures.ts`; `tools/seed/tsconfig.fixtures.json` already
includes `fixtures/**/*.ts`, so `pnpm nx typecheck seed-tools` holds them
(F3-1 (b)).
**Change:** `firestore.rules` (§1.1: the journal read rule, the
`loyaltyAccounts` wildcard, comments); `firestore.indexes.json` (#21 re-keyed,
the §1.1 fieldOverrides); `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts`
(flat seeds: the account `{ customerId, balance, seq, … }`, journal rows
with `journalVisibility`, the ledger/per-pill queries on `customerId`,
`journalVisibility == 'CLIENT'`, `journalEffect in JournalFeed.effectsOf(…)`;
heads/versions from `streakDefinitionFixture`/`streakDefinitionVersionFixture`
— same verdicts, same titles); `tools/seed/loyalty.mjs`,
`tools/seed/load-domain.mjs` (+ `load-domain.spec.mjs`: `SEED_DOMAIN_MODULES`
and the legacy mapper/projector exports gone; `StreakSystem` from
`@core/systems` in the entry), `tools/seed/{loyalty,promotions,seed-data}.spec.mjs`,
`tools/seed/fixtures/README.md`, `tools/seed-dev-catalog.mjs`;
`apps/web/e2e/support/seed-firestore.ts` (`seedLoyalty(uid, fixture)` keys
by `customerIdFor(uid)`, rewrites `customerId` and the row-id prefix,
`satisfies` the entities), `apps/web/e2e/client-card-glance.spec.ts` (the
fixture path and type only); `docs/architecture/firestore-runbook.md`
(§1.1 rows to §2 of this plan with bundle names, §4.3 = §6 of this plan),
`docs/architecture/flatten-spec.md` (the §5.4/§5.5 flip-3 row marked done;
nothing else).
**Brief:** the seed folds as today (same visits, same rules, same dates,
the same `version`/`seq`/balance arithmetic) and EMITS the flat bodies:
journal rows via the entity's slices (`journalEffect` + prefixed fields,
`journalSource`, `actorRole` + `actorSystemSource: 'LOYALTY_ENGINE'`,
`labelParams` in today's param order, `utcEpochMs` + `localDate` on
`SHOP_ZONE`, `appointmentId` from the fact), the account flat (the
`streaks` array from `StreakSystem.trace`'s state — its SCREAMING phase,
marks and reasons — `tier*` root fields, `updatedAtUtcMs`), progress
`earned[]` with `earnedAtUtcMs` + `earnedLocalDate`, the catalogue and
head/version 1 flat from `catalog.json` (`loyaltyCatalogFor(today)` shifts
`windowFrom`/`windowUntil` AND `announcedAtUtcMs`/`announcedLocalDate` by
the same whole days; `MOVED_SEASON_FIELDS` follows), `redemptionGrantsOf`/
`punchRewardOf` read `rewardGrant`/`grantCouponId`; keys
`customerIdOf(uid)`; the sweep deletes the earlier documents under
`loyaltyAccounts/{customerId}` and `clientJournal where customerId ==`.
`readLoyaltyWrites` keeps exactly two runtime checks — `LoyaltyCatalogSystem.validate`
over the catalogue (built from the flat collections under F3-10's keys)
and `StreakRule.parse` over every head rule and every version — and still
"refuses to seed on any problem" they find; the account, progress and
journal bodies are held by the builders' `satisfies` at typecheck (no ecs
whole-body guard exists for them and none is added); the per-document
mapper refusal cases of `loyalty.spec.mjs` ("readLoyaltyWrites — what it
refuses") that no longer have a check are ledgered `dead:` (F3-1 (b)).
`rulesPublishedOver`/`catalogAsHeld` read a stored flat head's `rules`.
`loyalty.spec.mjs` holds the projection to `loyaltyAccountJson`'s SHAPE
(document by document, as today) and asserts each fixture's `customerId`
equals `customerIdOf(uid)`; the catalogue case "is the fixtures'
catalogue, verbatim" reads `loyaltyCatalogJson`. Specs pin
`LOYALTY_CATALOG_TODAY` and never read the wall clock (the dev run's
`calendar.dayKeyAt(0)` is the seed's, not a spec's). **Ledger duty** (§5.4,
§11.5): P5 returns a ledger line for every case it deletes or rewrites
away in `tools/seed/{loyalty,load-domain,promotions,seed-data}.spec.mjs`
and `firestore.rules.integration.spec.ts` — at least `load-domain.spec.mjs`
"names its modules by their files, and each is there"
(`SEED_DOMAIN_MODULES` goes) and "bundles the client card’s readers, and
they read what the card’s own import reads" (legacy mappers go);
`loyalty.spec.mjs` › "read back by the client card’s readers", the
"readLoyaltyWrites — what it refuses" cases, the `loyaltyCatalogDriftOf`
legacy-field cases (`legacy true (catalog.json: absent), retiredAt
absent …`); `promotions.spec.mjs`'s journal ↔ grants cross-check cases on
the nested keys.

### P6 — the legacy sweep · wave 2

**Delete (F3-15):** `libs/application/engagement/src/lib/ports/{loyalty-document,loyalty-reader.port,loyalty-activity-reader.port,loyalty-catalog-reader.port,streak-definition.port,invitation.port}.ts`
and their specs; `libs/application/engagement/src/lib/use-cases/{observe-streak-definition,preview-streak-definition,publish-streak-definition,create-invitation,redeem-invitation}.use-case.ts`
(+ the two `.errors.ts`, + every spec); `libs/application/engagement/src/testing/fixtures/loyalty/account-{georgi,martin}.json`.
**Change:** `libs/application/engagement/src/{index.ts,testing.ts,testing.spec.ts}`
(the loyalty, streak and invitation lines and cases go, P0's wave-0 cast
line with them; the vouchers part stays: `loyaltyFixtures` is REPLACED by
the vouchers-only `giftVoucherFixtures` — `fixture<{ giftVouchers:
GiftVouchersFixture }>(giftVouchersJson).giftVouchers` of `@core/testing`'s
`giftVouchersJson` — and `InMemoryClientVouchersReader.seeded()` reads it),
`src/lib/ports/client-vouchers-reader.port.spec.ts` (`loyaltyFixtures.vouchers`
→ `giftVoucherFixtures`, `loyaltyFixtures.today` → `FIXTURE_TODAY` of
`@core/testing`; its cases unchanged), `src/lib/engagement.type-spec.ts`
(invitation cases go), `src/lib/public-reexports.ts` (only lines naming a
deleted file — and, closed at integration, its loyalty and streak value
blocks, whose importers wave 1 removed).
**Brief:** run only after wave 1 is merged. Re-run the importer grep for
every file first (`git grep -n "<module path or exported name>"`); a file
with an importer outside the deleted set stays and is reported. Ledger
every deleted case (§5.4) — successors are the ecs systems/pipeline specs
and the new adapter specs; mapper round trips, the in-memory references'
own parsing and the invitation use cases are `dead:`. Gate: `pnpm nx
run-many -t typecheck --skip-nx-cache` and `pnpm nx test engagement`
(the `libs/application/engagement` project; its surviving specs green).

---

## 5. Specs

### 5.1 Deleted (cases live elsewhere; §5.4's ledger proves each)

Counts are `it(`/`test(` lines measured on `6d43e1c` (a table-driven
`it.each` counts once and moves as one ledger line with its rows).

| Deleted spec (cases)                                                                                                          | Owner | Successor(s) holding its cases                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn:lib/loyalty/publish-streak-definition.spec.ts` (28)                                                                       | P1    | `fn:wire/loyalty.wire.spec.ts`, `fn:main.spec.ts`, `pl:publish-streak-definition.pipeline.spec.ts`                                                                                 |
| `fn:use-cases/publish-streak-definition.use-case.spec.ts` (47)                                                                | P1    | `pl:publish-streak-definition.pipeline.spec.ts`, `sy:streak-publish.system.spec.ts` (its refusal cases already there since Phase 2), `fn:wire/loyalty.wire.spec.ts`                |
| `fn:adapters/firestore-streak-definition-store.spec.ts` (23)                                                                  | P1    | the pipeline spec (read set, plan, replay), `fn:integration/publish-streak-definition.integration.spec.ts`, `fn:adapters/firestore-tx.adapter.spec.ts` (generic `Create` conflict) |
| `fn:adapters/system-clock.spec.ts` (2)                                                                                        | P1    | `dead:` the class goes; the clock is `ClockPorts.nowUtcMs`                                                                                                                         |
| `wa:invitation.adapter.spec.ts` (8)                                                                                           | P2    | `dead:` F3-12 (no port, no reader, no writer until Phase 4)                                                                                                                        |
| `wa:loyalty-activity-reader.adapter.spec.ts` (19), `.integration.spec.ts` (6)                                                 | P2    | `wa:loyalty.adapter.spec.ts` / `.integration.spec.ts` (query, paging, pills), `co:journal-effect.data.spec.ts` (`JournalFeed`)                                                     |
| `wa:loyalty-reader.adapter.integration.spec.ts` (7)                                                                           | P2    | `wa:loyalty.adapter.integration.spec.ts`; `listLedgerTail` cases `dead:` (F3-13)                                                                                                   |
| `wa:loyalty-catalog-reader.adapter.spec.ts` (17), `.integration.spec.ts` (5)                                                  | P2    | `wa:loyalty-catalog.adapter.spec.ts` (+ integration) — the session memo cases kept; the mapper-validation cases `dead:` (F3-1 (b))                                                 |
| `wa:streak-definition-repository.adapter.spec.ts` (34), `.integration.spec.ts` (8)                                            | P2    | `wa:streak-definitions.adapter.spec.ts` (+ integration) for reads, `wa:streak-publish-gateway.adapter.spec.ts` for the callable (every answer/thrown-refusal case)                 |
| `app:lib/ports/loyalty-document.spec.ts` (76)                                                                                 | P6    | mostly `dead:` (mapper round trips); validation cases whose rule lives on → `co:*`/`sy:loyalty-catalog.system.spec.ts`                                                             |
| `app:lib/ports/{loyalty-activity-reader,loyalty-catalog-reader,loyalty-reader,streak-definition}.port.spec.ts` (20, 4, 9, 29) | P6    | `testing/port-doubles.spec.ts` (the doubles' contract), `co:journal-effect.data.spec.ts`; the rest `dead:`                                                                         |
| `app:lib/use-cases/{observe,preview,publish}-streak-definition.use-case.spec.ts` (10, 20, 30)                                 | P6    | `ft:admin/loyalty` specs (P4), `sy:streak-publish.system.spec.ts`, `sy:streak-preview.system.spec.ts`                                                                              |
| `app:lib/use-cases/{create,redeem}-invitation.use-case.spec.ts` (1, 3)                                                        | P6    | `sy:referral.system.spec.ts` (self-redemption, the counter); the repository cases `dead:` (F3-12)                                                                                  |
| `app:testing.spec.ts` (49, its loyalty/streak cases)                                                                          | P6    | `testing/port-doubles.spec.ts`, `testing/loyalty.fixtures.spec.ts`                                                                                                                 |

Server 4 files / 100 cases; web 9 files / 104 cases; application 11 files
(+ the loyalty half of `testing.spec.ts`).

### 5.2 Re-targeted

`fn:main.spec.ts`, `fn:edge.spec.ts` (§7.2), `sy:streak-publish.system.spec.ts`
(+ the P1 functions), `sy:ledger.system.spec.ts` (P3: `JournalEntry` rows,
titles kept), `entities/journal-entry.entity.spec.ts`,
`primitives/ids.primitive.spec.ts`, `entities/engagement-entities.type-spec.ts`,
`testing/loyalty.fixtures.spec.ts`, `testing/port-doubles.spec.ts`,
`wa:firestore.rules.integration.spec.ts` (82 cases, P5), every client-card
and admin-loyalty spec, `staff-visit-editor.spec.ts`, the six visits specs,
`sy:streak-preview.system.spec.ts` (P4, the one `describe` title),
`app:lib/ports/client-vouchers-reader.port.spec.ts` (P6, the fixture
export), `tools/seed/loyalty.spec.mjs` (84), `load-domain.spec.mjs` (9),
`promotions.spec.mjs` (21), `seed-data.spec.mjs` (36) — all P5, each
deleted or rewritten-away case ledgered (§5.4, §11.5) —
`e2e:client-card-glance.spec.ts` (fixture only).

### 5.3 New

`pl:publish-streak-definition.pipeline.spec.ts` (exact `WriteOp[]`);
`testing/streak-publish-gateway.double.spec.ts` (P1);
`co:streak-publish-call.data.spec.ts` (P0);
`libs/infrastructure/firebase-app/src/lib/loyalty-catalog-memo.spec.ts` (P2);
`fn:wire/loyalty.wire.spec.ts`; `fn:adapters/flags.adapter.spec.ts`;
`fn:integration/publish-streak-definition.integration.spec.ts`;
`wa:{loyalty,loyalty-catalog,streak-definitions,streak-publish-gateway}.adapter.spec.ts`
and three integration specs; the type-spec cases of §3.1.

### 5.4 The case ledger (the proof)

P1, P2, P5 and P6 each return, for every spec they delete or re-target with
dead cases, a ledger line per case: `<deleted file>:<it title> →
<successor file>:<it title>` or `dead: <reason>` (a legacy class, a
mapper round trip, an ISO parser, read-side validation of a stored body
(F3-1 (b)), the invitation surface (F3-12), `listLedgerTail` (F3-13), a
port with no successor, a seed module map or legacy-mapper bundle the
seed no longer has (P5)). The integrator appends them as §11 in the flip
commit, grepping every successor title in its file; a deleted case with
neither a successor nor a reason blocks the flip. P3/P4 report only cases
they could not keep (expected: none). §11.4 lists the three F3-1 departures
with the spec case that pins each.

---

## 6. The per-flip grep gate

Paste once per shell; passes when every `gate` prints `ok`. It runs after
flip 3 lands with flips 1–2 landed: (1) flip 1's and flip 2's blocks as they
stand in runbook §4.1/§4.2 (no flip-3 exclusion exists in them — re-measure
on the integrated tree; a hit is a regression), then (2) the block below.

```bash
cd "$(git rev-parse --show-toplevel)" || echo 'ERROR run this inside the repository'
STORE=(apps/functions/src libs/infrastructure tools/seed tools/seed-dev-catalog.mjs
       apps/web/e2e apps/web/src/testing tools/verify firestore.rules
       libs/ecs-core/src/pipelines libs/ecs-core/src/ports libs/ecs-core/src/testing)
REVIEW=(libs/features apps/web/src/app)
NOT_FS=(':(exclude)libs/infrastructure/web-storage/**' ':(exclude)*.md')
# The frozen publish wire (F3-3): it still spells the nested draft and today's words.
WIRE3=(':(exclude)apps/functions/src/wire/loyalty.wire.ts' ':(exclude)apps/functions/src/wire/loyalty.wire.spec.ts'
       ':(exclude)libs/infrastructure/firestore/src/lib/streak-publish-gateway.adapter.ts'
       ':(exclude)libs/infrastructure/firestore/src/lib/streak-publish-gateway.adapter.spec.ts')
# The flip's directories: no legacy engagement import may survive (F3-14).
FLIPPED=(apps/functions libs/features/staff/client-card libs/features/admin/loyalty
         libs/features/shared/visits apps/web/e2e
         ':(glob)libs/infrastructure/firestore/src/lib/*loyalty*'
         ':(glob)libs/infrastructure/firestore/src/lib/*streak*'
         libs/features/staff/dashboard/src/lib/visit-editor/staff-visit-editor.spec.ts)

# Removed document fields (whole words; runbook W3).
W3=(-e lastQualifiedAt -e publishedAt -e withdrawnAt -e announcedAt -e earnedAt
    -e redeemedAt -e retiredAt -e brokenAt)
# Legacy mappers and projector exports that read or wrote the old bodies (whole words).
M3=(-e loyaltyAccountFromDocument -e badgeProgressFromDocument -e seasonProgressFromDocument
    -e ledgerEntryFromDocument -e activityEntryFromDocument -e badgeCategoryFromDocument
    -e badgeSeriesFromDocument -e seasonFromDocument -e tierDefinitionFromDocument
    -e rewardCatalogItemFromDocument -e loyaltyCatalogFromDocuments -e streakScheduleFromDocument
    -e streakScheduleToDocument -e streakDefinitionVersionFromDocument
    -e streakDefinitionVersionToDocument -e streakDefinitionToDocument -e streakStateToDocument
    -e clientJournalEntryId -e streakDefinitionVersionId -e traceStreak -e projectStreak
    -e ledgerRefOf -e ACTIVITY_EFFECT_KINDS -e LOYALTY_CATALOG_COLLECTIONS)
# Removed keys and map reads (exact strings). A streak MAP read is K3m below (regex): an index
# scan `account.streaks[i]` is Law 3's prescribed loop and must pass.
K3=(-e "'effect.kind'" -e "['updatedAt']" -e "['createdAt']" -e "publicLabel"
    -e "visibility == 'client'" -e "visibility: 'client'" -e "'visibility'" -e "streaks.cadence"
    -e "Object.keys(account.streaks" -e "Object.values(account.streaks" -e "Object.entries(account.streaks"
    -e "streakSchedules")
K3m="streaks\\[(['\"\`]|[A-Za-z_.]*[Ii]d\\])"
# Nested document shapes that never ride the wire (exact strings). `subject: { kind` is narrowed
# to the badge subject kinds (the booking seat's `subject: { kind: 'self' | 'guest' }` is flip 1's
# frozen wire), `available: { from` to the reward window (i18n's "Coupon available: {{label}}").
S3=(-e "phase: { kind" -e "phase.kind" -e "source: { kind" -e "actor: { kind" -e "effect: { kind"
    -e "window: { from" -e "qualify: {" -e "subject: { kind: 'service'" -e "subject: { kind: 'barber'"
    -e "subject: { kind: 'location'" -e "art: { path" -e "grants: { kind"
    -e "limits: {" -e "available: { from" -e "pointsExpiry: {" -e "heldBy: {" -e "via: 'rule'"
    -e "tier: { current" -e "override: {")
# i18n interpolation (`"protections": "Automatic protections: {{count}}"`) is no shape.
NOT_I18N=(':(exclude)libs/infrastructure/i18n/src/assets/**')
# Nested draft keys: gone everywhere but the frozen wire (exact strings).
D3=(-e "bookingHold: {" -e "protections: {" -e "clientPause: {" -e "repair: {"
    -e "qualifier: { kind" -e "interval: { kind")
# Tokens, classes and doubles the flip retires (whole words).
T3=(-e LOYALTY_READER -e LOYALTY_ACTIVITY_READER -e LOYALTY_CATALOG_READER
    -e STREAK_DEFINITION_REPOSITORY -e INVITATION_PORT -e LoyaltyReader -e LoyaltyActivityReader
    -e LoyaltyCatalogReader -e StreakDefinitionRepository -e InvitationPort
    -e InMemoryLoyaltyReader -e InMemoryLoyaltyActivityReader -e InMemoryLoyaltyCatalogReader
    -e InMemoryStreakDefinitionRepository -e HeldCatalogReader -e FirestoreLoyaltyReader
    -e FirestoreLoyaltyActivityReader -e FirestoreLoyaltyCatalogReader
    -e FirestoreStreakDefinitionRepository -e FirestoreInvitationAdapter
    -e FirestoreStreakDefinitionStore -e PublishStreakDefinitionUseCase
    -e ObserveStreakDefinitionUseCase -e PreviewStreakDefinitionUseCase
    -e CreateInvitationUseCase -e RedeemInvitationUseCase -e StreakPublishFailedError
    -e StreakPublishRefusedError -e loyaltyFixtures -e LoyaltyAccountFixture -e legacyCallable
    -e rhythmRuleUnavailable -e listLedgerTail -e LedgerEntryRef -e LoyaltyCatalogSession)
# The functions clock (P1) — scoped to apps/functions: the WEB clock (`libs/infrastructure/clock`,
# `SystemClock` bound to `CLOCK` in cfg) is not this flip's and stays (§7.1).
FCLOCK=(-e SystemClock -e FixedClock)
# Stale pointers to the files this flip deletes (exact strings).
F3=(-e invitation.adapter -e loyalty-reader.adapter -e loyalty-activity-reader.adapter
    -e loyalty-catalog-reader.adapter -e streak-definition-repository.adapter
    -e firestore-streak-definition-store -e publish-streak-definition.use-case
    -e 'lib/loyalty/' -e adapters/system-clock -e test-support/fixed-clock -e loyalty-document
    -e 'application/engagement/src/testing/fixtures' -e streak-projector -e SEED_DOMAIN_MODULES)
# Law 9 (copied from flip 2).
CODE=(apps libs tools ':(exclude)*.md' ':(exclude)tools/lint-rules/**')
SLICE='(^|[^A-Za-z0-9_])(Pick|Omit)<[[:space:]]*(readonly[[:space:]]+)?[A-Za-z0-9_.]*Ports([^A-Za-z0-9_]|$)'
NOT_PORTS='[A-Z]([A-Za-z0-9_]*[A-Za-rt-z0-9_]|[A-Za-z0-9_]*[A-Za-su-z0-9_]s|[A-Za-z0-9_]*[A-Za-qs-z0-9_]ts|[A-Za-z0-9_]*[A-Za-np-z0-9_]rts|[A-Za-z0-9_]*[A-OQ-Za-z0-9_]orts)'
R9=(-e AccountReadPorts -e AuthClaimsPorts -e CryptoPorts)

FAILED=0
gate() { local label=$1; shift
  git grep --untracked -nI "$@"
  case $? in 0) echo "FAIL  $label"; FAILED=1 ;; 1) echo "ok    $label" ;; *) echo "ERROR $label"; FAILED=1 ;; esac; }
review() { local label=$1; shift; echo "----  review: $label"; git grep --untracked -nI "$@" || echo "      (none)"; }

gate 'flip 3 · removed fields'            -wF "${W3[@]}" -- "${STORE[@]}" "${REVIEW[@]}" "${NOT_FS[@]}"
gate 'flip 3 · legacy mappers'            -wF "${M3[@]}" -- "${STORE[@]}" "${REVIEW[@]}" "${NOT_FS[@]}"
gate 'flip 3 · removed keys and map reads' -F "${K3[@]}" -- "${STORE[@]}" "${REVIEW[@]}" "${NOT_FS[@]}" "${WIRE3[@]}"
gate 'flip 3 · no streak map read'        -E -e "$K3m" -- "${STORE[@]}" "${REVIEW[@]}" "${NOT_FS[@]}" "${WIRE3[@]}"
gate 'flip 3 · nested document shapes'    -F  "${S3[@]}" -- "${STORE[@]}" "${REVIEW[@]}" "${NOT_FS[@]}" "${WIRE3[@]}" "${NOT_I18N[@]}"
gate 'flip 3 · nested draft off the wire' -F  "${D3[@]}" -- "${STORE[@]}" "${REVIEW[@]}" "${NOT_FS[@]}" "${WIRE3[@]}" "${NOT_I18N[@]}"
gate 'flip 3 · retired tokens and classes' -wF "${T3[@]}" -- apps libs tools "${NOT_FS[@]}" ':(exclude)libs/domain/**'
gate 'flip 3 · the functions clock is gone' -wF "${FCLOCK[@]}" -- apps/functions "${NOT_FS[@]}"
gate 'flip 3 · stale pointers to deleted files' -F "${F3[@]}" -- "${STORE[@]}" "${REVIEW[@]}" "${NOT_FS[@]}" \
  ':(exclude)tools/verify/bundle/initial-bundle.spec.mjs'
gate 'flip 3 · no legacy engagement import in the flipped directories' -F \
  -e '@creativo/application/engagement' -e '@creativo/domain/engagement' -- "${FLIPPED[@]}" "${NOT_FS[@]}"
gate 'flip 3 · functions off the engagement legacy libs' -F \
  -e 'libs/application/engagement/' -e 'libs/domain/engagement/' -e 'libs/application/shared/' -e 'libs/domain/kernel/' \
  -- apps/functions/src ':(glob)apps/functions/tsconfig*.json' "${NOT_FS[@]}"
gate 'flip 3 · the legacy loyalty half is gone' -F -e 'loyalty-document' -e 'streak-definition.port' \
  -e 'loyalty-reader.port' -e 'loyalty-activity-reader.port' -e 'loyalty-catalog-reader.port' -e 'invitation.port' \
  -- libs/application/engagement/src/index.ts
gate 'flip 3 · journal rule on the flat key' -F -e "resource.data.visibility" -- firestore.rules
node -e '
  const groups = new Set(process.argv[1].split(","));
  const removed = /^(at|since|updatedAt|createdAt|publishedAt|withdrawnAt|effectiveFrom|redeemedAt|userId|visibility)$|Iso$|[.]|^(kind|type|status)$/;
  const { indexes = [], fieldOverrides = [] } = require(process.cwd() + "/firestore.indexes.json");
  const bad = [
    ...indexes.filter((i) => groups.has(i.collectionGroup)).flatMap((i) => i.fields.map((f) => [i.collectionGroup, f.fieldPath])),
    ...fieldOverrides.filter((o) => groups.has(o.collectionGroup) && o.indexes.length > 0).map((o) => [o.collectionGroup, o.fieldPath]),
  ].filter(([, p]) => removed.test(p));
  for (const [g, p] of bad) console.log(`firestore.indexes.json: ${g} -> ${p}`);
  const journal = indexes.filter((i) => i.collectionGroup === "clientJournal").map((i) => i.fields.map((f) => f.fieldPath).join(","));
  if (!journal.includes("customerId,journalVisibility,journalEffect,seq")) { console.log("firestore.indexes.json: clientJournal #21 not re-keyed"); process.exit(1); }
  process.exit(bad.length ? 1 : 0);
' invitations,redemptions,loyaltyAccounts,badgeProgress,seasonProgress,clientJournal,streakDefinitions,versions,badgeCategories,badgeSeries,seasons,tierDefinitions,rewardsCatalog \
  && echo 'ok    flip 3 · indexes' || { echo 'FAIL  flip 3 · indexes'; FAILED=1; }
# Law 9 (port composition) — flip 2's block, unchanged.
gate 'flip 3 · Law 9 no Pick/Omit of a *Ports type'   -E -e "$SLICE" -- "${CODE[@]}"
gate 'flip 3 · Law 9 ports tier holds no Pick/Omit'   -E -e '(^|[^A-Za-z0-9_])(Pick|Omit)<' -- libs/ecs-core/src/ports
gate 'flip 3 · Law 9 no bundle record outside ports'  -E -e 'type [A-Za-z0-9_]*Ports(<[^>]*>)? = \{' \
  -- "${CODE[@]}" ':(exclude)libs/ecs-core/src/ports/**'
gate 'flip 3 · Law 9 inline member in a *Ports intersection' -E \
  -e 'Ports(<[^>]*>)? = [^;]*&[[:space:]]*\{' -e 'Ports(<[^>]*>)? =[[:space:]]*$' \
  -- "${CODE[@]}" ':(exclude)libs/ecs-core/src/ports/**'
gate 'flip 3 · Law 9 pipeline XPorts hold no record' -E -e 'export type [A-Za-z0-9_]+Ports = [^;]*\{' \
  -- libs/ecs-core/src/pipelines
gate 'flip 3 · Law 9 adapter factories return *Ports' -E \
  -e "^export const [a-zA-Z]+ = (<[^>]*>)?\\([^)]*\\): ${NOT_PORTS}([^A-Za-z0-9_]|\$)" \
  -- 'apps/functions/src/adapters/*.adapter.ts' 'libs/infrastructure/**/*.adapter.ts' \
  ':(exclude)apps/functions/src/adapters/firestore-tx.adapter.ts'
gate 'flip 3 · Law 9 no port function type outside ports' -E \
  -e '^export type [A-Z][A-Za-z0-9_]* =[[:space:]]*(<[^>]*>)?\([^)]*\)[[:space:]]*=>' \
  -- libs/ecs-core/src/pipelines apps/functions/src libs/infrastructure
gate 'flip 3 · Law 9 retired bundles'                 -wF "${R9[@]}" -- "${CODE[@]}"
review 'flip 3 · Law 9 *Ports aliases outside ports/pipelines (expect only intersections: FirestorePorts, EdgePorts, ServerPorts)' \
  -E -e 'type [A-Za-z0-9_]*Ports(<[^>]*>)? =' -- "${CODE[@]}" \
  ':(exclude)libs/ecs-core/src/ports/**' ':(exclude)libs/ecs-core/src/pipelines/**'
review 'flip 3 · lowercase loyalty literals in the flipped features (expect only words tables, i18n keys, test ids)' \
  -E -e "'(active|atRisk|inGrace|frozen|broken|kept|protected|repaired|missed|longestRhythm|firstVisit|grandfather|recompute|looser|stricter)'" \
  -- libs/features/staff/client-card libs/features/admin/loyalty libs/features/shared/visits/src/lib/rhythm-rule
[ "$FAILED" = 0 ] && echo 'flip 3 gate: PASS' || echo 'flip 3 gate: FAIL'
```

Notes. (1) `W3`, `M3`, `K3` and `S3` run over `REVIEW` as hard gates: every
name in them is a removed document field, a deleted mapper or a map read,
so any mention left in a store or component is stale. (2) `WIRE3` is the
one scoped allowlist (F3-3): the two frozen-wire files may spell the
nested DRAFT (`D3`) and today's answer words, never a removed document
field (`W3`, `M3`, `S3` still apply to them). (3) The "functions off the
engagement legacy libs" gate checks import PATHS in `apps/functions/src`
and `apps/functions/tsconfig*.json` only — `apps/functions/eslint.config.mjs`
names `libs/domain/kernel/**` three times as Phase 4's lint MESSAGE (the
dinero/luxon/libphonenumber rules), not an import, and stays;
`libs/application/booking/`, `libs/domain/accounts/`,
`libs/domain/governance/` stay (delta 7). (3a) Scoping, re-measured on
`6d43e1c` (2026-10-22): `SystemClock`/`FixedClock` are gated over
`apps/functions` only (`FCLOCK`) and the stale pointers name
`adapters/system-clock` / `test-support/fixed-clock`, because the WEB clock
(`libs/infrastructure/clock`: `SystemClock`, `system-clock.adapter.ts`, its
spec and barrel, `cfg`'s `{ provide: CLOCK, useClass: SystemClock }`) is not
this flip's and survives (§7.1) — only its doc comment's pointer to the
functions file is P2's; `subject: { kind` is narrowed to the badge subject
kinds (the booking seat's `'self'`/`'guest'` subject is flip 1's frozen
booking wire and its callers: `booking.wire.spec.ts`,
`booking-flow.store.spec.ts`, `staff-dashboard.spec.ts`,
`booking-gateway.adapter.spec.ts`); `available: {` is `available: { from`
and `NOT_I18N` excludes the i18n assets from `S3`/`D3` (`en.json`'s
`"Coupon available: {{label}}"` and `"Automatic protections: {{count}}"`
are interpolation, not shapes); the streak map read is the regex `K3m`,
which matches a key-indexed read (`streaks['…']`, `streaks[…Id]`) and never
the Law 3 index scan `account.streaks[i]`. With every package's deletions
and edits applied, each hit of the block on `6d43e1c` falls in a file a
package deletes or owns (measured by listing every gate's hit files against
§4's ownership: none left over; the two `review` lines are informational). (4) The integrator dry-runs the
block on the integrated tree before §8 step 3 closes and records the
measured state; P5 copies it into runbook §4.3 (replacing today's block,
whose `index_gate` regex this block subsumes). (5) The Law 9 gates
complement `creativo/no-sliced-ports` in `pnpm nx run-many -t lint`; on
`6d43e1c` every one of them is `ok` — a hit after integration is a
regression. (6) `libs/domain/**` is excluded from `T3` only (its classes
stay until Phase 4, F3-2); nothing outside it may name them. `T3` passes
on the kept vouchers half of `libs/application/engagement` because P6
replaces `loyaltyFixtures` with `giftVoucherFixtures` there (F3-15), and on
`sy:streak-preview.system.spec.ts` / `sy:streak-publish.system(.spec).ts`
because P4 renames the `describe` and P1 rewrites the two doc comments.

---

## 7. Deletions and the edge floors

### 7.1 Deletion rule

A file is deleted in the flip commit when `git grep` shows no importer of it
and `pnpm nx run-many -t typecheck --skip-nx-cache` stays green — never
earlier because a successor exists. Checked against `6d43e1c`'s import
graph:

- **P1:** `apps/functions/src/lib/loyalty/publish-streak-definition.ts`
  (+ spec; the folder goes); `apps/functions/src/use-cases/publish-streak-definition.{use-case,errors}.ts`
  (+ spec; the folder goes); `apps/functions/src/adapters/{firestore-streak-definition-store,system-clock}.ts`
  (+ specs); `apps/functions/src/test-support/fixed-clock.ts` (its three
  importers are the deleted publish specs — the deletion flip 2 §7.1
  foretold); `legacyCallable` in `edge.ts` (no caller once `main.ts` moves).
- **P2:** the five web adapters of §4 P2 with all their specs.
- **P6 (wave 2):** §4 P6's list.

**Survivors, with the importer that keeps them:** `fn:lib/booking/caller-roles.ts`
(+ spec) ← `wire/ops.wire.ts`, `wire/loyalty.wire.ts`;
`fn:lib/booking/tenant-zone.ts` ← `edge.ts`, `main.ts`; `fn:lib/flags.ts`
(+ spec) ← `adapters/flags.adapter.ts` (and `FLAG_PARAMS` exhaustiveness);
`fn:lib/firebase-admin.ts` ← `main.ts`;
`fn:test-support/fake-projection-firestore.ts`. `libs/domain/engagement/**`
(the loyalty classes, the invitation classes, `LOYALTY_ZONE`,
`sofiaDayOf`, the projector) — importer-free in `apps/`, `libs/features`,
`libs/infrastructure` and `tools/` after this flip, deleted with the lib in
Phase 4; `libs/application/engagement/**` minus §4 P6's list (Phase 4);
`wa:reward-progress-reader.adapter.ts` and `REWARD_PROGRESS_READER`
(dormant, F3-2); the WEB clock `libs/infrastructure/clock/**`
(`SystemClock`, `CryptoIdGenerator`, their specs and barrel) ← `cfg`'s
`CLOCK`/id-generator rows — only `system-clock.adapter.ts`'s doc pointer
to the deleted functions clock changes (P2). Each package re-runs the importer grep for its deletions
at integration; a file that still has an importer stays and is reported.

### 7.2 `edge.spec.ts` floors (P1)

The throw-site scanner reads `lib/**` and `use-cases/**`. After this flip
nothing under `lib/**` throws an `HttpsError` and `use-cases/` is gone, so
no handler is left for the scanner to read today's statuses from. P1
first copies today's statuses into `loyalty.wire.spec.ts` (the table the
two scanner cases read on `6d43e1c`: 2 throw sites, 9 error classes, each
code's status), then re-targets the two cases: `expect(sites).toEqual([])`
and `expect(classes).toEqual([])` (comment: "0 after flip 3 — every
callable answers through its wire"), the `outsideASwitch` scaffolding
goes. The `legacyCallable (Phase 3a)` wrapper cases are `dead:` with the
wrapper (§11); the `callableEdge` case that names
`LegacyWireCode.StreakPublishStoreFailed` stays. "Answers exactly the
streak publish's refusals" keeps P0's `ANSWERED_TODAY`.

---

## 8. Integration and gates

1. **Wave 0:** merge P0 alone, green on its own gate. **Wave 1:** P1–P5 in
   parallel, then merged. **Wave 2:** P6 on the merged tree.
2. Deletion sweep re-check (§7.1), edge floors (§7.2), `pnpm nx sync` then
   `pnpm nx sync:check` (it must leave `apps/functions/tsconfig.app.json`
   as P1 left it).
3. The full gate of `HANDOFF.md` §4, all green but the baseline reds
   (typecheck of `patterns`, `staff-client-card`, `staff-dashboard`
   spec-only; unit `gauge.spec.ts` (4), `visit-pills.spec.ts` (1),
   `visits-page.presenter.spec.ts` "strikes an hour that did not happen" (1);
   e2e exactly 19 failures with 41 passed — 6 `*-screenshots`,
   `landing.spec.ts:120`, 12 `client-card-glance` runs at `:341`/`:684`;
   the `appointments.spec.ts:152` flake, re-run alone with
   `--repeat-each=3`):
   - `pnpm nx run verify-tools:layering --skip-nx-cache`,
     `pnpm nx run-many -t typecheck --skip-nx-cache`,
     `pnpm nx run-many -t lint`, `pnpm nx run-many -t test --parallel=3`,
     `pnpm nx test ecs-core --coverage`, `pnpm nx typecheck seed-tools`
   - `pnpm nx build web`, `pnpm run verify:bundle`,
     `pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs`
   - **one at a time** (shared ports): `pnpm run verify:p0`,
     `pnpm run test:emulator` (the new publish emulator spec, the three new
     web integration specs, the rules spec), `pnpm run e2e:web`
     (`client-card-glance.spec.ts` seeds through the flat fixture — its
     non-baseline runs must stay green; `app-shell.spec.ts` opens the
     rhythm page)
   - the grep gate of §6 and `pnpm nx run lint-rules:test`
   - a `pnpm run dev` smoke (after `pnpm run seed:dev` on a wiped emulator;
     `seed:dev` must print its loyalty lines for Георги and Мартин and
     `node tools/seed-dev-catalog.mjs --check` must report no drift): as
     `staff@test.local`, Георги's card — the loyalty module (358 points,
     Злато → Платина, the 4/10 stamp card, 24 in rhythm), the medals page
     and a medal's detail (its earned days), the records, the wallet's
     feed and «История», the ledger page with each pill and a second page;
     Мартин's card (the rhythm at risk until 30.09); a client with no
     loyalty account (no module); the visit editor's client card. As an
     admin: `/admin/loyalty/rhythm` — the rule in force and its history;
     publish a stricter change for a day the page offers (the head shows it
     waiting, `streakDefinitions/cadence` holds `[CURRENT, SCHEDULED]`, a
     `versions/000002` flat body and one `auditLog` row); withdraw it (the
     stamp, the head back to `[CURRENT]`, a second row); re-send the same
     publish (`requestId` replay: no new document). No flip-3 console
     error.
4. One commit (never pushed by a package), message ending with the
   attribution line; the integrator appends §11 and updates
   `docs/architecture/HANDOFF.md` §2/§3 (flip 3 integrated; what is left).

### 8.1 Integration record (2026-10-22)

**Integrator rulings on the packages' open items.**

1. P0's wave-0 blocker (the legacy use case's `refusalOf()` reading
   `error.fields` under the widened `StreakPublishError`) is moot: P1
   deleted `publish-streak-definition.use-case.ts` in wave 1 (§7.1). The
   expected wave-0 runtime reds (the legacy readers parsing the flat
   `catalog.json`) are gone with the specs P6 deleted and P1–P5
   re-targeted.
2. P1: `PublishStreakDefinitionPorts` drops `TelemetryPorts` — accepted
   (§3.2 and F3-9 updated). The pipeline logs nothing, as today's use case
   logged nothing; the one log line is the wire's `publishStreakRefusal`
   (§3.3), so `memoryStreakPublishGatewayPorts` builds no telemetry.
3. P1: `decodeStreakCaller` brands the uid with `UserId.parse`, so a uid
   holding `/` reads as nobody where the legacy `UserId.create` took it —
   accepted, not a departure: every flipped wire (`booking`, `ops`,
   `identity`, `waitlist`) decodes its caller so, and no reachable uid
   holds `/` (uids are `users` document ids). Draft service and category
   ids are branded with `ServiceId.of` / `ServiceCategoryId.of` after
   today's non-blank check (exact fidelity).
4. P1: a stored head the systems cannot read (e.g. a pre-flip nested body)
   now throws inside the transaction and leaves as `store_failed` through
   `main.ts`'s settled commit — a consequence of F3-1 (b), greenfield
   (every writer writes the entity type); recorded in §11.4.
5. P1/P2 shape deltas, accepted as pinned by their specs:
   `decodeStreakRequest(raw, caller)` and `decodeDraft(draft, effectiveFrom)`
   (the legacy reader checked the day before any draft field, so the
   decoder reports today's FIRST fault), the callable flow as the wire's
   `answerStreakPublish(request, portsThunk, telemetry)`, `GATEWAY_ADMIN`
   for the admin specs; the gateway maps the wire's `stale` (which names no
   head version) to `StreakPublishError.stale(asked, asked)`, a `tooEarly`
   naming no day the wire can vouch for to the day the publish asked for (a
   withdrawal asks none, so there it is no answer), no answer or a thrown
   fault to `RepositoryError.writeFailed('streakDefinitions/{id}', …)`, an
   answer of no expected shape to `RepositoryError.malformed(…)`, a thrown
   `permission-denied`/`unauthenticated` or the `notAdmin` word to
   `callerNotAdmin()`, and the legacy dotted locators to the flat
   `StreakRuleField`s through a table mirroring the wire's.
6. P2: the session memo keeps a catalogue `LoyaltyCatalogSystem.validate`
   refuses (the read succeeded; the refusal is the store's) until the next
   shop day, a landed publish or withdrawal, or a reload — before, the
   refused catalogue was a failed read and the next card read again; and a
   head whose rule is out of range (the legacy reader refused it) now
   reaches the card. Both are reachable only through a writer defect (the
   seed refuses to write a catalogue `validate` refuses or a rule
   `StreakRule.parse` refuses) and fall under F3-1 (b); recorded in §11.4,
   not changed (the memo cannot see the store's verdict without logic in an
   adapter or the composition root).
7. P3, carried forward (not flip-3 bodies): `AchievementScope`'s `kind`
   discriminator in `client-card.contracts.ts` (a view-model contract) and
   the fixtures' local `{ kind: 'active' }` are flatten-pass candidates;
   `ClientCardStore` still imports `AVATAR_UPLOADER` and `ZonedDateTime`
   (for `CLOCK`) from `@creativo/application/accounts` and keeps a
   `Date.now()` fallback when no `CLOCK` is bound (pre-existing, Phase 4);
   `@core/testing`'s `vouchers.json` keeps its nested shape (vouchers are
   not a flip-3 collection), so the card fixtures declare a local voucher
   fixture type until a flat voucher fixture lands. `records.presenter.ts`
   counts a year's visits with `ClientStatsSystem.subjectVisitOf(account.customerId, …)`,
   the same result under D29.
8. P6's optional hardening is done: the four legacy fixture-coverage checks
   run over the flat fixture again in `testing/loyalty.fixtures.spec.ts`
   (every emblem drawn, every text in both locales, every family through
   `BadgeSystem.validate` and numbered I…n, once-rules and whole payouts,
   every season through `SeasonSystem.validate`); §11.3 points at them.
9. Fixes made at integration: `HeldCatalogPorts` (a `*Ports` alias with an
   inline member — the one hit of §6's Law 9 gates) became the test handle
   `HeldCatalog`; the stale comments in `ports/callables.ts`,
   `application/engagement/eslint.config.mjs`,
   `tools/seed/tsconfig.fixtures.json` and `tools/seed/vite.config.mts`, and
   the ecs-core provenance pointers to deleted files (`journal-source`,
   `personal-record`, `punch-card`, `points-expiry`, `tier-state`,
   `audit-context`, `streak-preview.system(.spec)`, `referral.system.spec`)
   were rewritten; `pnpm nx sync` dropped the stale
   `application/engagement` (and `domain/catalog`, `domain/engagement`,
   `application/shared`, `domain/kernel` in functions) references from
   seven tsconfigs (`apps/functions/tsconfig.app.json` included, as P1 left
   it). The runbook watch item ("flip 1 · coupons' enabled" scans the
   pipelines tier) is `ok`: the pipeline and its spec never spell `enabled`.

**The gate, measured on the integrated tree.**

| Command                                                                    | Result                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm nx sync` · `pnpm nx sync:check`                                      | pass (7 tsconfigs synced; then "up to date")                                                                                                                                                                                                                                                 |
| `pnpm nx run verify-tools:layering --skip-nx-cache`                        | pass                                                                                                                                                                                                                                                                                         |
| `pnpm nx run-many -t typecheck --skip-nx-cache`                            | baseline only: `patterns` (2), `staff-dashboard` (5), `staff-client-card` (2) spec-only errors — the counts of the flip-2 baseline                                                                                                                                                           |
| `pnpm nx run-many -t lint`                                                 | pass, 63 projects, 0 errors                                                                                                                                                                                                                                                                  |
| `pnpm nx run-many -t test --parallel=3`                                    | 11 860 passed, 6 failed — exactly the baseline (`gauge.spec.ts` 4, `visit-pills.spec.ts` 1, `visits-page.presenter.spec.ts` "strikes an hour that did not happen" 1)                                                                                                                         |
| `pnpm nx test ecs-core --coverage`                                         | pass, 246 files / 4 075 tests, thresholds met (98.09 % statements, 93.76 % branches)                                                                                                                                                                                                         |
| `pnpm nx typecheck seed-tools` · `pnpm nx run lint-rules:test`             | pass · pass (145)                                                                                                                                                                                                                                                                            |
| `pnpm nx build web` · `pnpm run verify:bundle`                             | pass (the pre-existing `gauge.css` budget warning only) · pass                                                                                                                                                                                                                               |
| `pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs` | pass · pass (8 runtime dependencies, as recorded; the baseline unchanged)                                                                                                                                                                                                                    |
| `pnpm run verify:p0`                                                       | all proved, (a)–(f)                                                                                                                                                                                                                                                                          |
| `pnpm run test:emulator`                                                   | pass: functions 13 files / 62 tests (the new publish emulator spec, 4), web 12 files / 241 tests (the three new adapter integration specs 11 + 5 + 12, the rules spec 155)                                                                                                                   |
| `pnpm run e2e:web`                                                         | 19 failed / 41 passed — exactly the baseline (6 `*-screenshots`, `landing.spec.ts:120`, the 12 `client-card-glance` runs, now at `:343`/`:686` after P5's two-line fixture edit, failing at the same two steps as before: `client-quick-same` and `client-birthday-gift`)                    |
| §6 grep gate (plan block = runbook §4.3) · runbook §4.2 (flips 1–2)        | PASS, 22 gates `ok` (after the `HeldCatalog` fix) · PASS, 28 gates `ok`; both `review` lists informational: the `*Ports` aliases outside ports/pipelines are exactly `FirestorePorts`, `EdgePorts`, `ServerPorts`; the lowercase literals are words tables, view-model row ids and test data |

**Smoke (§8 step 3), 2026-10-22, against `pnpm run dev`** (`seed:dev`
printed "seeded the loyalty catalogue: 60 documents" and one loyalty line
per holder, keyed `cus_f4139a95b87f17ee035d` / `cus_64f1b6925a19e579d85b`;
the dev seed folds the generated visit book of the run day, so its figures
are that day's — 371 points, Злато, 3 от 10, 23 in rhythm for Георги —
not the A0 fixture's 358; P5 compared the flat projection with the legacy
one field by field over several run days), signed in by custom token as
`dev-staff-ivan` (barber + admin): Георги's card — the loyalty module, the
wallet (pass, vouchers, stamp card, rhythm track, tier ladder, rewards,
feed), «История» with each pill («Всички» 48 rows, «Точки», «Награди»,
«Статус») and a second page (48 → 98 rows), «Постижения» and the «Фейд»
medal's detail with its earned days, «Рекорди»; Мартин's card (Сребро, 196,
13 in rhythm); `dev-client-3` (a record, no loyalty account) shows no
loyalty module. As the admin, `/admin/loyalty/rhythm`: the rule in force and
its history; a stricter change (6 → 5 weeks) confirmed through the alert
and published for tomorrow — `streakDefinitions/cadence` held
`[CURRENT 1, SCHEDULED 2]`, `versions/000002` the flat body
(`streakRuleDirection: 'STRICTER'`, `changed: ['INTERVAL']`,
`publishedByUserId: 'dev-staff-ivan'`), one flat `auditLog` row; withdrawn —
the stamp, the head back to `[CURRENT 1]`, a second row, the history row
marked withdrawn; the same publish re-sent by its `requestId` straight to
the callable answered the original receipt and wrote nothing. No flip-3
console error (only the pre-existing `AbortError: Transition was skipped`
and the avatar 404s of clients with no photo). Not run separately:
`node tools/seed-dev-catalog.mjs --check` (`verify:p0` (a) proves the
second seed changes nothing).

---

## 9. Risks specific to this flip

| Risk                                                                                                                                                                                                     | Mitigation                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The publish wire's `invalid` `fields` list is produced today by the legacy reader + domain factory (`ruleOf`); a decoder that orders or names fields differently changes what the admin page highlights. | P1 writes `loyalty.wire.spec.ts` from the deleted specs before deleting them; every `fields` array is pinned literally; the wire sorts by today's order where `StreakRule.parse` differs.                                                                                                                    |
| Transaction semantics of the publish (reads before writes, `Create` of version and row, stamp only existing called-off docs, replay) drift in the move to a generic `CommitPlan`.                        | §3.2 fixes the read set and plan; the pipeline spec asserts the exact `WriteOp[]`; the emulator spec runs the concurrent-publish and replay cases.                                                                                                                                                           |
| The client card re-type is the long pole (31 files on legacy types, ~46 k lines in the lib) and its only journey is mostly baseline-red.                                                                 | One owner (P3) for the whole directory; shared doubles and fixtures from P0; every spec keeps its cases; the §8 dev smoke of the card is mandatory, not optional; `client-card-glance`'s green runs must stay green.                                                                                         |
| T5 days written by the seed drift from today's `sofiaDayOf` bucketing (medal "last" days, ledger months).                                                                                                | One conversion rule (Sofia day of the same instant) in P0's fixtures and P5's seed; `loyalty.spec.mjs` asserts every `earnedLocalDate`/`localDate` equals the Sofia day of its `*UtcMs`; presenters read the stored day, never re-bucket.                                                                    |
| D29 re-key: the seed, the e2e seed and the fixtures must agree on `CustomerId.forUser(uid, sha256)`; a uid-keyed leftover in a running emulator is an orphan nobody reads.                               | `customerIdOf`/`customerIdFor` reused (never a third derivation); `loyalty.spec.mjs` asserts the fixtures' ids; re-seed after the flip (greenfield).                                                                                                                                                         |
| A wave-1 package reaches for a member its bundle lacks and slices a suite or declares a local record.                                                                                                    | §3.1.1 names a bundle for every token, adapter and the pipeline; a missing subset is reported to the integrator and added to the port file; `creativo/no-sliced-ports` and §6's Law 9 gates.                                                                                                                 |
| Removing read-side validation (F3-1 (b)) hides a malformed seed write.                                                                                                                                   | The seed's bodies are built in `tools/seed/fixtures/loyalty.fixtures.ts`, each `satisfies Omit<X, 'id'>` (`pnpm nx typecheck seed-tools`); `readLoyaltyWrites` keeps `LoyaltyCatalogSystem.validate` + `StreakRule.parse` at run time and still refuses to seed; the card keeps the catalogue check (F3-10). |
| The composite index is missing in production while the emulator stays green.                                                                                                                             | §6's index gate asserts #21's new key list; P5 declares it in the same change as the query.                                                                                                                                                                                                                  |

---

## 10. Open questions (owner) — with the default this plan applies

1. **The record-read coupling** (F3-1 (a), F3-6): resolve the card's
   `CustomerId` through `customers where userId == uid` (flip 1's path —
   loyalty fails when that read fails) or derive `CustomerId.forUser(uid)`
   in the browser (`crypto.subtle` SHA-256, no extra read, a second
   resolution rule)? _Default: the flip-1 record read._
2. **Read-side validation** (F3-1 (b)): drop it (zero mapper) or keep a
   guard on the client card's catalogue (`LoyaltyCatalogSystem.validate`,
   refusing a whole catalogue as today)? _Default: drop it for the
   account, progress, heads, versions and journal (every writer writes the
   entity type); KEEP the catalogue's, as the store's
   `LoyaltyCatalogSystem.validate` call — it is also what puts the
   catalogue in today's display order, so dropping it would move medals
   and seasons on screen (revised 2026-10-22)._
3. **Invitations** (F3-12): delete the dead web surface now, or re-type it
   to a bundle no consumer uses? _Default: delete; Phase 4 builds
   `redeemInvitation` as one `CommitPlan`._
4. **The legacy application loyalty half** (F3-15): delete in this flip
   (wave 2) or leave it to Phase 4? _Default: delete now._
5. **The highest-version read** (F3-8): `orderBy version desc limit 1`
   (one read) or every version id as today (`select()`, needs a new
   ids-only `ReadTx` query)? _Default: `limit 1` under the id == version
   invariant._
6. **Catalogue memo** (F3-10): keep the per-day session memo in the web
   adapter layer, or move the cache into the client-card store (one read
   per store instance)? _Default: keep (fidelity), as the closure
   `loyaltyCatalogMemo()` behind the root token `LOYALTY_CATALOG_MEMO` —
   no class outside Angular's file kinds._
7. **`idempotencyKey`/award keys embedding the uid** (F3-6): keep the
   seed's text, or re-derive with the `CustomerId`? _Default: keep — opaque,
   never parsed, never derived from the other brand._
8. **`grantVoucherCurrency`** (F3-5): `'EUR'` on the one voucher reward.
   _Default: `'EUR'` (the currency ruling)._
9. **fieldOverrides on never-queried arrays** (§1.1) — hygiene, not
   required by any query. _Default: add them (blueprint §3.4)._

---

## 11. The case ledgers (§5.4)

Appended by the integrator on 2026-10-22. Every deleted or re-targeted case
has a successor (`<file>` › its describe › its title, each title checked
against its file by a script over the TypeScript AST of the spec) or a
`dead:` reason; every left-hand title was checked against the deleted file
at `6d43e1c`. Abbreviations as the top of §2, plus `co:` =
`libs/ecs-core/src/components/`, `fa:` =
`libs/infrastructure/firebase-app/src/lib/`; `testing/…`, `primitives/…`,
`entities/…` are under `libs/ecs-core/src/`. A `(+ …)` names a second
successor that holds the rest of the case; `› title` inside it stays in the
file last named. Totals: server 4 files / 100 cases + 7 re-targeted
(§11.1); web 9 files / 104 cases (§11.2); application 10 files / 202 cases,
`testing.spec.ts` 38 deleted, 2 re-titled, 9 kept, and 4 compile-only
type-spec cases (§11.3); data plane, none deleted (§11.5).

### 11.1 P1 — server

**`fn:lib/loyalty/publish-streak-definition.spec.ts` (28)**

- throws unauthenticated at nobody → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — who may ask › throws unauthenticated at nobody, and writes nothing
- ANSWERS %s notAdmin, and writes nothing → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — who may ask › ANSWERS %s notAdmin, and writes nothing
- judges the caller before it reads the request: a stranger never learns what was wrong with the asking → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — who may ask › judges the caller before it reads the request: a stranger never learns what was wrong with the asking (+ `fn:wire/loyalty.wire.spec.ts` › decodeStreakPublish — the caller, then the envelope › refuses nobody and a non-admin before the envelope, and reads an admin’s request; `fn:main.spec.ts` › flip 3 — the streak publish › answers today’s refusals before any pipeline runs — the caller judged before the request is read)
- reads the role off the token, never off the payload → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — who may ask › reads the role off the token, never off the payload
- admits %s, and the row names them → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — who may ask › admits %s, and the row names them
- publishes: the receipt, the documents and the row → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — the answers, end to end › publishes: the receipt, the documents and the row
- takes a request that names no op for a publish, as §4.4 draws it → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — the answers, end to end › takes a request that names no op for a publish, and one that says so (+ `fn:wire/loyalty.wire.spec.ts` › decodeStreakRequest — the envelope › takes a request that names no op — or a null one — for a publish, as §4.4 draws it)
- withdraws: the version that waits is called off by its number → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — the answers, end to end › withdraws: the version that waits is called off by its number
- answers a draft that is no rule with its fields → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — the answers, end to end › answers a draft that is no rule — %s — with its fields
- answers a day too early with the first day the change may start → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — the answers, end to end › answers a day too early with the first day the change may start
- holds a stricter rule to thirty days of notice once clients see their rhythm → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — the answers, end to end › holds a stricter rule to thirty days of notice once clients see their rhythm
- answers the other refusals in the port’s words, with no field → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — the answers, end to end › answers the other refusals in the page’s words, with no field, and writes no row
- writes nothing twice for a retry, and answers as it did → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — the answers, end to end › writes nothing twice for a retry, and answers as it did
- throws internal when the write falls over, and says why where alerting can find it → `fn:main.spec.ts` › flip 3 — the streak publish › throws internal when the write falls over, and says why where alerting can find it (+ `fn:wire/loyalty.wire.spec.ts` › publishStreakRefusal — the per-code table, literally › logs a failed write’s cause where alerting can find it, and throws store_failed without it)
- reads §4.4’s request → `fn:wire/loyalty.wire.spec.ts` › decodeStreakRequest — the envelope › reads §4.4’s request into the publish’s command, the draft into the rule’s flat input
- reads a withdrawal → `fn:wire/loyalty.wire.spec.ts` › decodeStreakRequest — the envelope › reads a withdrawal, and nothing of a publish off it
- refuses %s as no request → `fn:wire/loyalty.wire.spec.ts` › decodeStreakRequest — the envelope › refuses %s as no request
- refuses %s, by name → `fn:wire/loyalty.wire.spec.ts` › decodeStreakRequest — the envelope › refuses %s, by name (every row kept, + ‘a transition in the system’s words’)
- refuses a withdrawal whose version is %s → `fn:wire/loyalty.wire.spec.ts` › decodeStreakRequest — the envelope › refuses a withdrawal whose version is %s
- reads an absent preview as none → `fn:wire/loyalty.wire.spec.ts` › decodeStreakRequest — the envelope › reads an absent preview as none, and a recompute as the system’s word
- leaves the RULE to the use case: a draft goes on as sent, a day that is no text as none → `fn:wire/loyalty.wire.spec.ts` › decodeStreakRequest — the envelope › leaves the RULE to the pipeline: a draft of the wrong kinds is its `invalid`, a day that is no text reads as none
- answers a rule that is wrong, and throws at an envelope that is: the page words one and not the other → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — the answers, end to end › answers a rule that is wrong, and throws at an envelope that is: the page words one and not the other
- reads the caller off the verified token → `fn:wire/loyalty.wire.spec.ts` › decodeStreakCaller — the caller, off the verified token › reads %s (+ › reads nobody without a uid, or with a blank one, whatever the claim says; › admits only a role spelt as the rules spell it — a list inside the claim manages nothing, and is still attributed as today)
- hands a receipt on as it is → `fn:wire/loyalty.wire.spec.ts` › the encoders — today’s answer, key for key › publishes %s as %s (+ › withdraws by the version called off)
- RETURNS a refusal: an answer the page words → `fn:wire/loyalty.wire.spec.ts` › publishStreakRefusal — the per-code table, literally › answers INVALID with each flat field as its legacy locator, an unknown one as written, each once (+ › answers TOO_EARLY with today’s fields and the first day it may start; › answers %j as %s, with no field and no day)
- THROWS a fault, each by its status → `fn:wire/loyalty.wire.spec.ts` › publishStreakRefusal — the per-code table, literally › throws CALLER_UNAUTHENTICATED as today’s unauthenticated fault (+ › throws an envelope refusal as today’s invalid_input, by field; › logs a failed write’s cause where alerting can find it, and throws store_failed without it)
- answers every step as the reference does, and holds the same documents after each → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — the page’s reference story › answers every step as the reference did, and holds the documents it held
- opens a shop’s first rule as the reference does → `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — the page’s reference story › opens a shop’s first rule as the reference did: head, version 1 and its row, on nothing

**`fn:use-cases/publish-streak-definition.use-case.spec.ts` (47)**

- refuses nobody: a fault, since there is no caller to answer → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what it refuses, in today’s order › refuses nobody — no uid, a blank uid, no verified actor — before anything is read (+ `sy:streak-publish.system.spec.ts` › StreakPublishSystem.admitCaller — who may ask › refuses nobody, and a blank uid, as CALLER_UNAUTHENTICATED — whatever the claim says)
- refuses %s as notAdmin, and never reaches the store → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what it refuses, in today’s order › refuses anyone but the admin pair as CALLER_NOT_ADMIN, and never reaches the store (+ `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — who may ask › ANSWERS %s notAdmin, and writes nothing — the five roles)
- admits %s → `fn:wire/loyalty.wire.spec.ts` › decodeStreakCaller — the caller, off the verified token › reads %s (owner, vendor, owner who cuts hair: callerIsAdmin true) (+ `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — who may ask › admits %s, and the row names them)
- judges a withdrawal by the same gate → `pl:publish-streak-definition.pipeline.spec.ts` › withdrawStreakDefinition › judges the caller by the same gate, before anything is read
- answers admit() alone the same way: what the callable asks before it reads the request → `sy:streak-publish.system.spec.ts` › StreakPublishSystem.admitCaller — who may ask › admits the admin pair, answering the account that signs the version (+ › refuses nobody, and a blank uid, as CALLER_UNAUTHENTICATED — whatever the claim says; › refuses anyone else as CALLER_NOT_ADMIN)
- lets a later day WAIT: the rule in force stays, the new one is scheduled → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › lets a later day WAIT: the version, the stamped head [CURRENT, SCHEDULED] and ONE row, in that order
- signs the version with the caller, the intent and the change → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › lets a later day WAIT: the version, the stamped head [CURRENT, SCHEDULED] and ONE row, in that order (the exact version body)
- writes ONE audit row: who, what, from which version to which, in codes → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › lets a later day WAIT: the version, the stamped head [CURRENT, SCHEDULED] and ONE row, in that order (the exact row) (+ `sy:streak-publish.system.spec.ts` › StreakPublishSystem.publishPlan — what one publish writes › makes the version (the flat rule, signed and stamped, never withdrawn), the head whole and ONE row)
- puts a version effective today in force at once → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › puts a version effective today in force at once: the head holds it alone
- replaces what waited, and calls it off → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › replaces what waited and stamps its document; compared with the rule IN FORCE
- keeps what came into force by date as the rule in force of the new head → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › keeps what came into force by date as the rule in force of the new head, and stamps nothing
- publishes a shop’s first rule on nothing: base 0, version 1, in force whatever its day → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › opens a shop’s first rule on nothing: head, version 1 and its row; in force whatever its day
- opens no rule but the business’s one: another id names nothing → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what it refuses, in today’s order › opens no rule but the business’s one: another id names nothing (+ wire end to end, same title)
- keeps the name the head holds → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › keeps the name the head holds, and lists what moved against it
- numbers the version itself: the draft’s number is a proposal → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — the version’s number › numbers the version itself: the draft’s number is a proposal
- never gives a called-off version’s number away → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — the version’s number › never gives a called-off version’s number away: one above the highest ever written
- takes the day from the request, never from the draft → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — the version’s number › takes the day from the request, never from the draft (+ `fn:wire/loyalty.wire.spec.ts` › decodeDraft — the nested legacy draft, field by field › reads the recommended draft as the recommended rule’s flat input, its own number and day never read)
- refuses a head that moved: stale, and nothing is written → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what it refuses, in today’s order › refuses a head that moved (stale), a recompute, a preview — before the draft is judged
- refuses a base the shop never had → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what it refuses, in today’s order › refuses a base the shop never had, and judges the base by the head, not by the history
- judges the base by the head, not by the history: after a withdrawal it is the rule in force → same successor as the line above
- refuses to recompute the runs before the engine exists → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what it refuses, in today’s order › refuses a head that moved (stale), a recompute, a preview — before the draft is judged
- refuses a preview nobody can vouch for: the server holds none yet → same successor as the line above
- refuses a day the change may not start on yet, and says the first it may → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what it refuses, in today’s order › refuses a day the change may not start on yet, and says the first it may
- refuses a day that has passed → same successor as the line above (the 2026-09-27 assertion)
- lets a %s rule start tomorrow while no client sees the rhythm → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what it refuses, in today’s order › lets a %s rule start tomorrow while no client sees the rhythm (looser, stricter, mixed) + `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — the directions, and the notice nobody is owed yet › lets a %s rule start tomorrow while no client sees the rhythm (all four, switch included — the runbook flip-1 gate forbids the word `enabled` under libs/ecs-core/src/pipelines)
- owes the clients who see the rhythm their notice of a stricter rule → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what it refuses, in today’s order › owes the clients who see the rhythm (`loyalty.selfView`) thirty days’ notice of a stricter rule
- holds the notice to thirty days unless told otherwise → same successor as the line above (asserts StreakRule.RULE_CHANGE_NOTICE_DAYS === 30)
- refuses a scheduled version that would not start after the rule in force → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what it refuses, in today’s order › refuses a scheduled version that would not start after the rule in force (+ `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — the answers, end to end › answers a scheduled version that would not start after the rule in force with today’s locator)
- names every field the domain refuses, at once → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what it refuses, in today’s order › names every flat field the rule refuses, at once, each once, in the rule’s order (+ `fn:wire/loyalty.wire.spec.ts` › publishStreakDefinition — the answers, end to end › answers a draft that is no rule — %s — with its fields: every fault the rule names, at once, in today’s order)
- holds grace under the interval, by the domain’s own rule → same successor as the line above (intervalDays 14 / graceDays 14) (+ wire end to end row ‘a grace no shorter than the interval’)
- names the field of %s → `fn:wire/loyalty.wire.spec.ts` › decodeDraft — the nested legacy draft, field by field › names the field of %s (every row kept; ‘a list of no services’ is the rule’s, not the reader’s → wire end to end row ‘a list of no services’)
- refuses a day that is none: %j → `fn:wire/loyalty.wire.spec.ts` › decodeDraft — the nested legacy draft, field by field › refuses a day that is none, before any part of the draft: %j (+ `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what it refuses, in today’s order › refuses a day that is none: %j)
- refuses a draft that holds nothing → `fn:wire/loyalty.wire.spec.ts` › decodeDraft — the nested legacy draft, field by field › refuses a draft that holds nothing at its first field
- reads nothing a draft has no business saying: an id and a name of its own are not the rule’s → `fn:wire/loyalty.wire.spec.ts` › decodeDraft — the nested legacy draft, field by field › reads nothing a draft has no business saying: an id and a name of its own are not the rule’s
- calls off the version that waits: the head holds the rule in force alone → `pl:publish-streak-definition.pipeline.spec.ts` › withdrawStreakDefinition › stamps what waited, holds the rule in force alone and writes ONE row; adds no version (+ `sy:streak-publish.system.spec.ts` › StreakPublishSystem.withdrawPlan — what one withdrawal writes › stamps what waited, holds the rule in force alone (its role re-stated) and writes ONE row)
- refuses what no longer waits: another version, nothing, a day that came, no rule → `pl:publish-streak-definition.pipeline.spec.ts` › withdrawStreakDefinition › refuses what no longer waits: another version, nothing, a day that came, no rule, the rule in force
- never calls off the rule in force → same successor as the line above (version 1 row)
- writes nothing for a retry of an intent it wrote, and answers as it did → `pl:publish-streak-definition.pipeline.spec.ts` › a retry writes nothing, and answers as it did › answers the retry of a publish with the ORIGINAL receipt, a day later, from the version it wrote
- answers the retry of a withdrawal as it did → `pl:publish-streak-definition.pipeline.spec.ts` › a retry writes nothing, and answers as it did › answers the retry of a withdrawal as it did, though nothing waits any more
- tells the store which intent it is, so the store can find its earlier write → `pl:publish-streak-definition.pipeline.spec.ts` › the read set, and the shop’s calendar › reads the head, this intent’s version, the highest version and the waiting version’s document — nothing else (+ › reads a withdrawal’s head, its own audit row and the named version — the row found first stops the read)
- reads the day off the SHOP’s calendar: half past one at night in Sofia is already tomorrow → `pl:publish-streak-definition.pipeline.spec.ts` › the read set, and the shop’s calendar › reads the day off the SHOP’s calendar: half past one at night in Sofia is already tomorrow
- hands a store that could not write on as it is → `pl:publish-streak-definition.pipeline.spec.ts` › the read set, and the shop’s calendar › answers a commit failure as the commit answers it
- fails, never throws, on a clock that cannot tell the time → `dead:` the legacy ClockPort(zone) is gone — the clock is `ClockPorts.nowUtcMs` (no zone argument, cannot fail) and the zone is the checked `TimeZone` WIRE_ZONE, parsed once at module load
- are the server’s six words, one class each, in the port’s own order → `fn:wire/loyalty.wire.spec.ts` › publishStreakRefusal — the per-code table, literally › answers INVALID with each flat field as its legacy locator, an unknown one as written, each once; › answers TOO_EARLY with today’s fields and the first day it may start; › answers %j as %s, with no field and no day (the six words); the error classes themselves dead: no error class (Law 7.5)
- carry a code of their own each → `fn:wire/loyalty.wire.spec.ts` › the deleted handler’s statuses (the edge scanner’s table on 6d43e1c) › throws %s as %s, %s (+ › answers %s (%s) — never thrown)
- name their fields: the rule’s for a draft, the day for a day too early, none otherwise → `fn:wire/loyalty.wire.spec.ts` › publishStreakRefusal — the per-code table, literally › answers INVALID with each flat field as its legacy locator, an unknown one as written, each once; › answers TOO_EARLY with today’s fields and the first day it may start; › answers %j as %s, with no field and no day
- keep a fault from passing for a refusal → `fn:wire/loyalty.wire.spec.ts` › publishStreakRefusal — the per-code table, literally › throws CALLER_UNAUTHENTICATED as today’s unauthenticated fault (+ › throws an envelope refusal as today’s invalid_input, by field; › logs a failed write’s cause where alerting can find it, and throws store_failed without it)

**`fn:adapters/firestore-streak-definition-store.spec.ts` (23)**

- reads no head as no rule, and no version as none written → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › opens a shop’s first rule on nothing: head, version 1 and its row; in force whatever its day
- reads the head as a model, through the wire’s own reader → `dead:` F3-1 (b) — the head is read AS STORED (zero mapper), no reader model; the read itself → pipe:the read set, and the shop’s calendar › reads the head, this intent’s version, the highest version and the waiting version’s document — nothing else
- counts a called-off version: its number is off the head and still taken → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — the version’s number › never gives a called-off version’s number away: one above the highest ever written (+ `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what it refuses, in today’s order › refuses a base the shop never had, and judges the base by the head, not by the history)
- reads the number off the document id, and skips an id that is no version → `dead:` F3-8 — the highest version is read as `versions orderBy version desc limit 1` under the id == forVersion(version) invariant every writer keeps; no id list is read (the broken-invariant case is pipe:… › never rewrites a version: a number that is taken fails the act with the commit’s ALREADY_EXISTS, nothing written)
- fails on %s: nothing is decided over a rule nobody could read, nothing is written → `dead:` F3-1 (b) — no read-side validation of a stored head; the flat head of before revision 3 is greenfield-wiped (a body the systems cannot read throws inside the transaction and leaves as store_failed through main.ts’s settled commit)
- writes the version, the head and ONE row → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › lets a later day WAIT: the version, the stamped head [CURRENT, SCHEDULED] and ONE row, in that order (+ › leaves exactly those documents: the first version is nobody’s to rewrite)
- writes the row the audit log derives for the intent: ids and codes only → same successor (the row at hash(AuditSystem.rowBasis(…, requestId)), every fact a root key)
- records the vendor as staff: the log tells the owner’s act from the vendor’s → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › signs the version with the vendor, and the row names them as STAFF: the owner’s act told from the vendor’s
- writes what reads back as EQUAL models → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › stores the rule flat and as parsed: a services qualifier de-duplicated, the excuses in the vocabulary’s order (the mapper round trip itself dead: F3-1 (b), zero mapper)
- opens a shop’s first rule: head, version 1 and its row, on nothing → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › opens a shop’s first rule on nothing: head, version 1 and its row; in force whatever its day
- stamps what waited as called off, and touches nothing else of it → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › replaces what waited and stamps its document; compared with the rule IN FORCE
- has nothing to stamp when what waited has no document of its own → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what one publish writes › has nothing to stamp when what waited has no document of its own (+ `sy:streak-publish.system.spec.ts` › StreakPublishSystem.publishPlan — what one publish writes › stamps a called-off version only when the read found its document, and names it replaced either way)
- never gives a called-off version’s number away → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — the version’s number › never gives a called-off version’s number away: one above the highest ever written
- clears the head, stamps the version and writes ONE row; adds no version → `pl:publish-streak-definition.pipeline.spec.ts` › withdrawStreakDefinition › stamps what waited, holds the rule in force alone and writes ONE row; adds no version
- answers the retry of a publish as the first attempt was answered → `pl:publish-streak-definition.pipeline.spec.ts` › a retry writes nothing, and answers as it did › answers the retry of a publish with the ORIGINAL receipt, a day later, from the version it wrote
- finds its own write before it decides anything → `pl:publish-streak-definition.pipeline.spec.ts` › a retry writes nothing, and answers as it did › finds its own write before it decides anything: no admit, no stale
- answers the retry of a withdrawal as it did, though nothing waits any more → `pl:publish-streak-definition.pipeline.spec.ts` › a retry writes nothing, and answers as it did › answers the retry of a withdrawal as it did, though nothing waits any more
- takes another intent for what it is: the same act asked anew is decided anew → `pl:publish-streak-definition.pipeline.spec.ts` › a retry writes nothing, and answers as it did › takes another intent for what it is: the same act asked anew is decided anew
- keeps a publish and a withdrawal apart, even under one name → `pl:publish-streak-definition.pipeline.spec.ts` › a retry writes nothing, and answers as it did › keeps a publish and a withdrawal apart, even under one name
- writes nothing when the decision is a refusal, and hands the refusal on → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — what it refuses, in today’s order › refuses a head that moved (stale), a recompute, a preview — before the draft is judged (tx.plans === [] in every refusal case)
- reads before it writes, every time → `pl:publish-streak-definition.pipeline.spec.ts` › the read set, and the shop’s calendar › reads the head, this intent’s version, the highest version and the waiting version’s document — nothing else (reads precede writes by construction: the read half gets a ReadTx only — fn:adapters/firestore-tx.adapter.spec.ts)
- never rewrites a version: a number that is taken fails the act → `pl:publish-streak-definition.pipeline.spec.ts` › publishStreakDefinition — the version’s number › never rewrites a version: a number that is taken fails the act with the commit’s ALREADY_EXISTS, nothing written (+ `fn:main.spec.ts` › flip 3 — the streak publish › logs a version number a concurrent writer took by its code and path (F3-1 (c)), and throws internal; `fn:integration/publish-streak-definition.integration.spec.ts` › publishStreakDefinition (emulator) › lets one of two publishes on the same baseVersion land; the other is refused stale)
- fails, never throws, when the transaction does → `fn:main.spec.ts` › flip 3 — the streak publish › throws internal when the write falls over, and says why where alerting can find it (settledCommit)

**`fn:adapters/system-clock.spec.ts` (2)**

- succeeds for a valid IANA zone → `dead:` the class goes; the clock is `ClockPorts.nowUtcMs` (main.ts `nowUtcMs`), the zone the checked WIRE_ZONE
- fails for an invalid zone → `dead:` same

**Re-targeted: `fn:edge.spec.ts`**

- legacyCallable (Phase 3a) › answers what today’s handler answers → `fn:edge.spec.ts` › edge — the wrappers › callableEdge › answers Result.ok with its value
- legacyCallable (Phase 3a) › passes the handler’s own HttpsError through untouched, untracked → `fn:edge.spec.ts` › edge — the wrappers › callableEdge › passes a decoder’s own HttpsError through untouched, untracked
- legacyCallable (Phase 3a) › tracks an unexpected throw and answers it as the platform does today → `fn:edge.spec.ts` › edge — the wrappers › callableEdge › answers it with the platform’s bare INTERNAL when the callable names no failure code (now asserts the tracked throw)
- today’s statuses, read from today’s handlers › gives every code a handler throws the status that handler throws it with → `fn:edge.spec.ts` › edge — the wire table › today’s statuses, read from today’s handlers › finds no handler that throws its own HttpsError — every callable answers through its wire (floor 2 → 0) + `fn:wire/loyalty.wire.spec.ts` › the deleted handler’s statuses (the edge scanner’s table on 6d43e1c) › throws %s as %s, %s
- today’s statuses, read from today’s handlers › maps every use-case error class code; one no mapper names keeps its mapper’s `default:` internal → `fn:edge.spec.ts` › edge — the wire table › today’s statuses, read from today’s handlers › finds no use-case error class — every refusal is an ecs-core struct or a legacy wire code (floor 9 → 0) + `fn:wire/loyalty.wire.spec.ts` › the deleted handler’s statuses (the edge scanner’s table on 6d43e1c) › answers %s (%s) — never thrown

**Re-targeted: `fn:main.spec.ts`**

- covers every flipped export with a pipeline case and leaves the streak publish on its handler → `fn:main.spec.ts` › covers every export with a pipeline case — no export runs a Phase 3a handler
- the one export no flip has reached — still today’s handler › %s hands its input to its own handler — and to no other — and answers what it answers → `fn:main.spec.ts` › flips 1–3 — every export runs exactly its own pipeline › %s decodes its input, runs its own pipeline over the server ports — and no other — and answers today’s JSON (the publishStreakDefinition row) + `fn:main.spec.ts` › flip 3 — the streak publish › runs a withdrawal through its own pipeline — and no publish

### 11.2 P2 — web

**`wa:invitation.adapter.spec.ts` (8)** — every case `dead:` F3-12 (no port, reader or writer until Phase 4's `redeemInvitation`)

- creates a brand-new invitation with setDoc → `dead:` F3-12
- updates only redemptionCount when the invitation already exists → `dead:` F3-12
- returns a RepositoryError when save fails → `dead:` F3-12
- findById returns null for a missing document → `dead:` F3-12
- findById reconstitutes a stored invitation → `dead:` F3-12
- findById surfaces a malformed document as a RepositoryError → `dead:` F3-12
- saveRedemption writes the redemption doc → `dead:` F3-12
- saveRedemption surfaces a repeat-redemption rejection as a RepositoryError → `dead:` F3-12

**`wa:loyalty-activity-reader.adapter.spec.ts` (19)**

- names the client, the visibility the rule demands, the pill’s effects, the order and one row more than asked → `wa:loyalty.adapter.spec.ts` › names the client record, the visibility the rule demands, the pill’s effects, the order and one row more than asked
- asks «%s» for its own effects: %s → `wa:loyalty.adapter.spec.ts` › asks «%s» for its own effects: %s
- starts after the cursor on a later page → `wa:loyalty.adapter.spec.ts` › starts after the cursor on a later page
- asks for a whole page of at least one row, whatever was asked (%s) → `wa:loyalty.adapter.spec.ts` › asks for a whole page of at least one row, whatever was asked (%s)
- hands over the newest rows first, one per journal entry, whatever they moved → `wa:loyalty.adapter.spec.ts` › hands over the newest rows first, one per journal entry, whatever they moved
- never reads the rhythm’s rows, a protection or a staff row → `wa:loyalty.adapter.spec.ts` › never reads the rhythm’s rows, a protection or a staff row
- carries what ties the rows of one event together, and the balance after a point row → `wa:loyalty.adapter.spec.ts` › a stored row is answered as stored: what ties it to its event, its visit and the balance after it (F3-1 b)
- never hands one client another’s rows → `wa:loyalty.adapter.spec.ts` › never hands one client record another’s rows
- «Точки» is the point rows alone → `wa:loyalty.adapter.spec.ts` › «Точки» is the point rows alone
- «Награди» is what was given and what was exchanged → `wa:loyalty.adapter.spec.ts` › «Награди» is what was given and what was exchanged
- «Статус» is the tier’s rows → `wa:loyalty.adapter.spec.ts` › «Статус» is the tier’s rows
- is an empty page, never an error, under a pill that holds nothing → `wa:loyalty.adapter.spec.ts` › is an empty page, never an error, under a pill that holds nothing
- walks the whole feed through its cursors: every row once, in order → `wa:loyalty.adapter.spec.ts` › walks the whole feed through its cursors: every row once, in order
- gives no cursor when the rows end exactly where the page does → `wa:loyalty.adapter.spec.ts` › gives no cursor when the rows end exactly where the page does
- answers «%s» as the port’s reference does, page for page → `wa:loyalty.adapter.spec.ts` › answers «%s» as the port’s in-memory double does, page for page
- leaves out a row that does not parse, and still moves past it → `dead:` F3-1 (b) — rows are answered as stored, nothing is parsed or dropped (the cursor rule is held by the paging cases)
- refuses a pill nobody knows rather than read it as «Всички» → `dead:` the pill is the closed `JournalFeed` dictionary and the port takes `JournalFeed.effectsOf` (`co:journal-effect.data.spec.ts`); an empty effect list → `wa:loyalty.adapter.spec.ts` › reads nothing for no effects: an empty page (the SDK refuses an empty `in`)
- reads nothing for no one → `dead:` `CustomerId` is a brand whose smart constructor refuses a blank id
- turns a refused read into a failed Result → `wa:loyalty.adapter.spec.ts` › turns a refused read into a failed Result naming the collection and the store’s reason

**`wa:loyalty-activity-reader.adapter.integration.spec.ts` (6)**

- hands over «Всички» newest first, whatever the rows moved, and never the rhythm’s or a staff row → `wa:loyalty.adapter.integration.spec.ts` › hands over «Всички» newest first, whatever the rows moved, and never the rhythm’s or a staff row
- walks the whole feed through its cursors: every row once, in order → `wa:loyalty.adapter.integration.spec.ts` › walks the whole feed through its cursors: every row once, in order
- gives no cursor when the rows end exactly where the page does → `wa:loyalty.adapter.integration.spec.ts` › gives no cursor when the rows end exactly where the page does
- reads «%s» as its own effects alone → `wa:loyalty.adapter.integration.spec.ts` › reads «%s» as its own effects alone
- never hands one client another’s rows → `wa:loyalty.adapter.integration.spec.ts` › never hands one client record another’s rows
- is refused to the client, and to an anonymous visitor → `wa:loyalty.adapter.integration.spec.ts` › is refused to the client, and to an anonymous visitor

**`wa:loyalty-reader.adapter.integration.spec.ts` (7)**

- reads the account a barber sees → `wa:loyalty.adapter.integration.spec.ts` › reads the account a barber sees, as stored
- reads every started family and every season track → `wa:loyalty.adapter.integration.spec.ts` › reads every started family and every season track
- reads the newest point rows only — no staff row, no row without points → `dead:` F3-13 (`listLedgerTail`, no caller)
- answers null and empty lists for a client with no account → `wa:loyalty.adapter.integration.spec.ts` › answers null and empty lists for a client record with no account (its ledger-tail half `dead:` F3-13)
- fails a malformed account rather than showing its figures → `dead:` F3-1 (b) — now pinned by `wa:loyalty.adapter.integration.spec.ts` › answers a malformed account and progress document as stored (F3-1 b) (+ `wa:loyalty.adapter.spec.ts` › a stored body is answered as stored — a malformed account and progress document included (F3-1 b))
- leaves out the one progress document that does not parse → `dead:` F3-1 (b) — the same successors: `wa:loyalty.adapter.integration.spec.ts` › answers a malformed account and progress document as stored (F3-1 b)
- is refused for the client themselves and for a content manager (§4.5) → `wa:loyalty.adapter.integration.spec.ts` › is refused for the client themselves and for a content manager (§4.5) (its ledger-tail half `dead:` F3-13)

**`wa:loyalty-catalog-reader.adapter.spec.ts` (17)**

- reads the six collections once into one validated catalogue → `wa:loyalty-catalog.adapter.spec.ts` › reads the six collections once, under the system’s part names, every document as stored (+ › hands LoyaltyCatalogSystem.validate a catalogue it takes unmapped, in today’s display order (F3-10))
- hands over the rhythm’s rule as its head: in force, resolved by date → `wa:loyalty-catalog.adapter.spec.ts` › hands over the rhythm’s rule as its head: in force, resolved by date by the system
- never takes a rule’s versions for rules: they are a subcollection, and the admin page’s → `wa:loyalty-catalog.adapter.spec.ts` › never takes a rule’s versions for rules: they are a subcollection, and the admin page’s
- reads an unpublished catalogue as an empty one → `wa:loyalty-catalog.adapter.spec.ts` › reads an unpublished catalogue as an empty one
- fails a catalogue whose rule is no rule → `dead:` F3-1 (b) — now pinned by `wa:loyalty-catalog.adapter.spec.ts` › a stored body is answered as stored — a head whose rule is no rule included (F3-1 b)
- turns a refused read into a failed Result → `wa:loyalty-catalog.adapter.spec.ts` › turns a refused read into a failed Result naming the collection and the store’s reason
- keeps a good answer: the second card reads nothing → `wa:loyalty-catalog.adapter.spec.ts` › keeps a good answer: the second card reads nothing
- shares one read between callers asking at once → `wa:loyalty-catalog.adapter.spec.ts` › shares one read between callers asking at once
- never keeps a failed read: the next call reads again → `wa:loyalty-catalog.adapter.spec.ts` › never keeps a failed read: the next call reads again
- holds through the evening, up to the last minute of the shop’s day → `wa:loyalty-catalog.adapter.spec.ts` › holds while `today` answers the same shop day — the evening included (+ `sy:zoned-time.system.spec.ts` › reads the day on the zone clock: 22:13 UTC on the 28th is already the 29th in Sofia)
- reads again once the shop’s day has turned: a tab left open past midnight → `wa:loyalty-catalog.adapter.spec.ts` › reads again once the shop’s day has turned: a tab left open past midnight (+ `sy:zoned-time.system.spec.ts` › reads the day on the zone clock: 22:13 UTC on the 28th is already the 29th in Sofia)
- answers the day’s copy, and either copy resolves the rule by the day asked → `wa:loyalty-catalog.adapter.spec.ts` › answers the day’s copy, and either copy resolves the rule by the day asked
- drops the session’s copy: the next call reads the collections again → `wa:loyalty-catalog.adapter.spec.ts` › drops the session’s copy: the next call reads the collections again
- keeps a read that was in flight for nobody, and still answers whoever waited on it → `wa:loyalty-catalog.adapter.spec.ts` › keeps a read that was in flight for nobody, and still answers whoever waited on it (+ `fa:loyalty-catalog-memo.spec.ts` › forgets whatever is kept on invalidate; a read in flight still answers whoever waited on it)
- is shared through the root: an adapter in another injector drops the same copy → `fa:loyalty-catalog-memo.spec.ts` › is ONE memo for the session: the root token answers the same one in every injector
- the next card reads the rule that was just written → `wa:loyalty-catalog.adapter.spec.ts` › the next card reads the rule that was just written
- a publish that was refused leaves the copy where it is → `wa:loyalty-catalog.adapter.spec.ts` › a withdrawal that was refused leaves the copy where it is (the legacy case sent a withdrawal too)

**`wa:loyalty-catalog-reader.adapter.integration.spec.ts` (5)**

- reads the six collections into one validated catalogue, for any signed-in person → `wa:loyalty-catalog.adapter.integration.spec.ts` › reads the six collections as stored, for any signed-in person — a catalogue the system takes unmapped
- keeps a good answer for the session, one read shared by callers asking at once → `wa:loyalty-catalog.adapter.integration.spec.ts` › keeps a good answer for the session, one read shared by callers asking at once
- fails a catalogue that does not hold together, and reads again next time → `wa:loyalty-catalog.adapter.integration.spec.ts` › answers a catalogue that does not hold together as stored: the system refuses it (+ `wa:loyalty-catalog.adapter.spec.ts` › answers a catalogue that does not hold together as stored: refusing it is the system’s, over the answer; the refusal itself is the card store's, `cc:lib/client-card.store.spec.ts` › fails the catalogue slice when the system refuses the answer, and never keeps it); the "reads again next time" half `dead:` (§11.4, F3-1 (b): the memo keeps a read that succeeded)
- reads an unpublished catalogue as an empty one → `wa:loyalty-catalog.adapter.integration.spec.ts` › reads an unpublished catalogue as an empty one
- is refused to an anonymous visitor → `wa:loyalty-catalog.adapter.integration.spec.ts` › is refused to an anonymous visitor, and the refusal is not kept

**`wa:streak-definition-repository.adapter.spec.ts` (34)** — the reads (observe, listVersions)

- hands over the head as a schedule: the rule in force, and nothing waiting → `wa:streak-definitions.adapter.spec.ts` › hands over the head as stored: the rule in force, and nothing waiting
- resolves a version that waits by date, with no second read → `wa:streak-definitions.adapter.spec.ts` › hands over the version that waits inside the same head — the system resolves it by date, with no second read
- answers null, not a failure, for a shop that has published no rule → `wa:streak-definitions.adapter.spec.ts` › answers null, not a failure, for a shop that has published no rule
- hears a publish made elsewhere as it lands → `wa:streak-definitions.adapter.spec.ts` › hears a publish made elsewhere as it lands
- says a head that is no rule once, and stays to hear the publish that mends it → `dead:` F3-1 (b) — now pinned by `wa:streak-definitions.adapter.spec.ts` › a stored head is answered as stored — a rule that is no rule, or a body of another shape (F3-1 b)
- refuses the flat document of before revision 3 as a failed Result, and stays to hear the seed that replaces it → `dead:` F3-1 (b) — the same successor: `wa:streak-definitions.adapter.spec.ts` › a stored head is answered as stored — a rule that is no rule, or a body of another shape (F3-1 b)
- turns a refused listen into a failed Result, never a thrown stream → `wa:streak-definitions.adapter.spec.ts` › turns a refused listen into a failed Result naming the head, never a thrown stream
- watches nothing for a rule with no name → `dead:` `StreakDefinitionId` is a brand whose smart constructor refuses a blank id
- lets go of its listener when nobody watches any more → `wa:streak-definitions.adapter.spec.ts` › lets go of its listener when nobody watches any more
- lists every publish newest first, each under the head’s name → `wa:streak-definitions.adapter.spec.ts` › lists every publish newest first, every version as stored — no head read beside it (its name half `dead:` — a flat version carries no name)
- keeps to the limit, from the newest → `wa:streak-definitions.adapter.spec.ts` › keeps to the limit, from the newest
- asks for a whole count of at least one, whatever was asked (%s) → `wa:streak-definitions.adapter.spec.ts` › asks for a whole count of at least one, whatever was asked (%s)
- shows a withdrawn version as withdrawn → `wa:streak-definitions.adapter.spec.ts` › shows a withdrawn version as withdrawn
- is an empty history, and reads no version, for a rule nobody published → `wa:streak-definitions.adapter.spec.ts` › is an empty history for a rule nobody published (no head read any more)
- reads nothing for a rule with no name → `dead:` branded `StreakDefinitionId` (+ new `wa:streak-definitions.adapter.spec.ts` › reads the history of the rhythm it is asked for, by its own id)
- fails rather than list the publishes around one it cannot read → `dead:` F3-1 (b) — now pinned by `wa:streak-definitions.adapter.spec.ts` › a stored version is answered as stored — a blank publisher, or one filed under another number (F3-1 b)
- refuses a version whose document id is not its number → `dead:` F3-1 (b) — the same successor: `wa:streak-definitions.adapter.spec.ts` › a stored version is answered as stored — a blank publisher, or one filed under another number (F3-1 b)
- turns the rules’ refusal into a failed Result: the history is the admin pair’s → `wa:streak-definitions.adapter.spec.ts` › turns the rules’ refusal into a failed Result: the history is the admin pair’s

**`wa:streak-definition-repository.adapter.spec.ts`** (cont.) — the callable (publish, withdraw)

- sends the rule as the callable’s request: the draft is the rule’s own document → `wa:streak-publish-gateway.adapter.spec.ts` › sends the rule as the callable’s request: the draft is the rule’s own nested body (+ › encodes the recommended rule exactly as the legacy draft mapper did, key order included; › encodes every variant and word as the legacy draft mapper did)
- carries no id and no name in the draft: they are the head’s → `wa:streak-publish-gateway.adapter.spec.ts` › carries no id and no name in the draft: they are the head’s
- answers with what the SERVER wrote: its number, its day, its verdict → `wa:streak-publish-gateway.adapter.spec.ts` › answers with what the SERVER wrote: its number, its day, its verdict
- drops the session’s copy of the catalogue once the rule is written → `wa:streak-publish-gateway.adapter.spec.ts` › drops the session’s copy of the catalogue once the rule is written
- hands over the server’s refusal «%s» in its own word, with the fields it names → `wa:streak-publish-gateway.adapter.spec.ts` › hands over the server’s refusal «%s» as its flat struct, never dropping the copy (6 rows; only INVALID carries fields) (+ › reads an «invalid» refusal’s legacy locators as the flat fields, in the order named)
- reads «tooEarly» by its word and its field; the day the server names is not the port’s to carry yet → `wa:streak-publish-gateway.adapter.spec.ts` › reads «tooEarly» by its word, and carries the first day the server names (now carried, per §3.1.1) (+ › reads a «tooEarly» that names no day the wire can vouch for as the day the publish asked for)
- reads a refusal that names no field → `wa:streak-publish-gateway.adapter.spec.ts` › reads a refusal that names no field
- reads a refusal that arrived thrown (%s) → `wa:streak-publish-gateway.adapter.spec.ts` › reads a refusal that arrived thrown (%s)
- reads the SDK’s own «%s» as the caller not being the admin pair → `wa:streak-publish-gateway.adapter.spec.ts` › reads the SDK’s own «%s» as the caller not being the admin pair
- tells %s apart from a refusal: the request got no answer → `wa:streak-publish-gateway.adapter.spec.ts` › tells %s apart from a refusal: the request got no answer (asserting `RepositoryError.writeFailed` and that the memo is not invalidated)
- never reports a publish on %s: it is no answer at all → `wa:streak-publish-gateway.adapter.spec.ts` › never reports a publish on %s: it is no answer at all (13 rows, `null` added; each a `RepositoryError`, the memo not invalidated)
- names the version it calls off → `wa:streak-publish-gateway.adapter.spec.ts` › names the version it calls off
- drops the session’s copy of the catalogue once the version is called off → `wa:streak-publish-gateway.adapter.spec.ts` › drops the session’s copy of the catalogue once the version is called off
- hands over «stale» when the version no longer waits → `wa:streak-publish-gateway.adapter.spec.ts` › hands over «stale» when the version no longer waits
- never reports a withdrawal on an answer for %s → `wa:streak-publish-gateway.adapter.spec.ts` › never reports a withdrawal on an answer for %s (a 4th row: a «tooEarly» naming no day)
- tells a request that got no answer apart from a refusal → `wa:streak-publish-gateway.adapter.spec.ts` › tells a request that got no answer apart from a refusal

**`wa:streak-definition-repository.adapter.integration.spec.ts` (8)**

- hands a barber the head as a schedule, the waiting version resolved by date → `wa:streak-definitions.adapter.integration.spec.ts` › hands a barber the head as stored, the waiting version resolved by date by the system
- answers null for a shop that has published no rule → `wa:streak-definitions.adapter.integration.spec.ts` › answers null for a shop that has published no rule
- hears a publish as it lands → `wa:streak-definitions.adapter.integration.spec.ts` › hears a publish as it lands
- is a failed Result for an anonymous visitor → `wa:streak-definitions.adapter.integration.spec.ts` › is a failed Result for an anonymous visitor
- lists the history for an %s, newest first → `wa:streak-definitions.adapter.integration.spec.ts` › lists the history for an %s, newest first, as stored
- keeps to the limit, from the newest → `wa:streak-definitions.adapter.integration.spec.ts` › keeps to the limit, from the newest
- is an empty history for a rule nobody published → `wa:streak-definitions.adapter.integration.spec.ts` › is an empty history for a rule nobody published
- is a failed Result for a %s: the history is the admin pair’s → `wa:streak-definitions.adapter.integration.spec.ts` › is a failed Result for a %s: the history is the admin pair’s

### 11.3 P6 — application (legacy sweep) (10 specs deleted, 202 cases; `testing.spec.ts` 38 deleted, 2 re-titled, 9 kept; `engagement.type-spec.ts` 4 compile-only cases)

Abbreviations as §0, plus `co:` = `libs/ecs-core/src/components/`; `testing/…`, `primitives/…`, `entities/…` are under `libs/ecs-core/src/` (§5.2's notation). A `(+ …)` names a second successor that holds the rest of the case.

**`app:lib/ports/loyalty-document.spec.ts` (76)**

- clientJournalEntryId › names the client, then the sequence padded to six digits → `entities/journal-entry.entity.spec.ts` › pads the per-client sequence to six digits, so ids sort as the ledger (+ › keys the entry by the client record, never by the account it was derived from)
- clientJournalEntryId › sorts as the sequence does → `entities/journal-entry.entity.spec.ts` › pads the per-client sequence to six digits, so ids sort as the ledger
- streakDefinitionVersionId › pads the version to six digits, so the history sorts by document id → `entities/streak-definition-version.entity.spec.ts` › is the version padded to six digits, so the history sorts by id
- the loyalty collections › lists the six catalogue collections, none of them per client → `wa:loyalty-catalog.adapter.spec.ts` › reads the six collections once, under the system’s part names, every document as stored (+ `testing/loyalty.fixtures.spec.ts` › holds every catalogue collection, keyed by collection)
- the loyalty collections › keeps a rule’s versions under its head, outside the catalogue → `wa:loyalty-catalog.adapter.spec.ts` › never takes a rule’s versions for rules: they are a subcollection, and the admin page’s
- the loyalty collections › keeps the per-client collections apart from the catalogue → `wa:loyalty.adapter.spec.ts` › reads every started family and every season track, in Firestore’s id order (+ › names the client record, the visibility the rule demands, the pill’s effects, the order and one row more than asked)
- reading the catalogue fixture › reads every collection into one validated catalogue (§4.6’s sizes) → `testing/loyalty.fixtures.spec.ts` › spreads each document id in, every collection in Firestore’s id order (+ › holds together: the system takes it unmapped and puts it in display order)
- reading the catalogue fixture › types a family’s ids, its subject and its narrowing → `testing/loyalty.fixtures.spec.ts` › narrows each family on its subject: a variant declares only its own id
- reading the catalogue fixture › keeps what each level pays → `testing/loyalty.fixtures.spec.ts` › speaks only the closed vocabularies, SCREAMING where they are tags (every level’s awards read flat by `awardKind`); the mapper’s read `dead:` (F3-1 (b), the catalogue is answered unmapped, F3-10)
- reading the catalogue fixture › reads the rhythm family: no metric, numbered targets → `sy:badge.system.spec.ts` › takes the rhythm family: no metric, rising targets
- reading the catalogue fixture › reads tenure as calendar-driven and a one-off as its only level → `sy:badge.system.spec.ts` › is calendar-driven on tenure alone (+ › takes a one-off act and a yearly family, each with one level)
- reading the catalogue fixture › dates the seasons: one ended, one season and one event running on the fixtures’ today → `sy:loyalty-catalog.system.spec.ts` › lists the running windows in the order they opened (+ › lists the ended windows newest first; `testing/loyalty.fixtures.spec.ts` › writes every T5 pair from one reading: each stored day is the Sofia day of its instant)
- reading the catalogue fixture › reads tiers, rewards and the rhythm’s rules → `testing/loyalty.fixtures.spec.ts` › keeps every figure: the tiers’ ladder, the rewards’ costs and limits (+ › carries the rhythm’s head, whose every rule passes the rule’s own guard)
- reading the catalogue fixture › reads each catalogue document on its own, too → `dead:` the per-document mappers (`badgeCategoryFromDocument` … `streakScheduleFromDocument`) — every catalogue document is answered as stored (F3-1 (b), F3-10)
- reading the account fixture of %s › reads the account whole → `testing/loyalty.fixtures.spec.ts` › tells Георги’s story: 358 points, Злато six visits from Платина, 4/10, 24 in rhythm (+ › tells Мартин’s story: 215 points, Сребро, 3/10, 13 in rhythm at risk until 30.09, held by today’s visit; › %s: each account body is exactly one variant of every slice)
- reading the account fixture of %s › reads every family’s progress: ${levels} levels earned → `testing/loyalty.fixtures.spec.ts` › %s: earned levels carry their instant and its Sofia day (T5) (+ the two story cases count 37 and 28 levels)
- reading the account fixture of %s › reads every season’s track → `testing/port-doubles.spec.ts` › reads a record’s account and its whole progress, as stored
- reading the account fixture of %s › reads every journal row as a ledger row that adds up to the balance → `testing/loyalty.fixtures.spec.ts` › %s: the journal is the account’s, dense by seq, folding to its balance
- the standing, on the seeded story (§4.6) › Георги: «Фейд III» leads «Скоро», the four families it would finish with it yielding → `sy:standing.system.spec.ts` › keeps the service when one visit would complete five families, and one family per shelf (on Георги’s shape)
- the standing, on the seeded story (§4.6) › Мартин: «Цяла година III» leads; an unstarted service never evicts «С Иван III» → `sy:standing.system.spec.ts` › lets no unstarted family yield a started one
- the standing, on the seeded story (§4.6) › Георги: today’s levels are one rail item → `sy:standing.system.spec.ts` › groups by the Sofia day, newest day first, newest level first
- the standing, on the seeded story (§4.6) › counts the shelves in families, earned and started of total → `sy:standing.system.spec.ts` › a shelf: its families by order, a retired one only where started (+ › the archive: every family of the windows that ended; › a day: the families with a level earned on that Sofia day)
- refusing malformed catalogue documents › refuses %j as a document → `dead:` read-side validation of a stored body (F3-1 (b))
- refusing malformed catalogue documents › refuses a category of an unknown kind, or with one locale → `dead:` read-side validation of a stored body (F3-1 (b)); the kinds are `co:loyalty-dictionaries.type-spec.ts` and `testing/loyalty.fixtures.spec.ts` › speaks only the closed vocabularies, SCREAMING where they are tags
- refusing malformed catalogue documents › passes on what the domain refuses, by code → `sy:badge.system.spec.ts` › reports every problem at once (+ › names what it refused: the levels, the targets, the level and what it paid)
- refusing malformed catalogue documents › refuses a family with %s → `sy:badge.system.spec.ts` › refuses %s
- refusing malformed catalogue documents › refuses a season whose dates are not days, or whose instant is not UTC → `sy:season.system.spec.ts` › refuses %s; the ISO-instant parse `dead:` (instants are `*UtcMs`)
- refusing malformed catalogue documents › refuses a tier, a reward and a rhythm with a broken field → `sy:loyalty-catalog.system.spec.ts` › refuses tiers that do not ask more as they rank higher (+ › refuses a reward costing %s; `co:streak-rule.data.spec.ts` › refuses %s); the shape rows `dead:` (F3-1 (b))
- refusing malformed catalogue documents › leaves a reward’s price to the catalogue, which refuses one that costs nothing → `sy:loyalty-catalog.system.spec.ts` › refuses a reward costing %s
- refusing malformed catalogue documents › fails the whole catalogue on one malformed or dangling document → `sy:loyalty-catalog.system.spec.ts` › refuses a family on a shelf the catalogue lacks (+ › refuses a family in a season the catalogue lacks; `cc:lib/client-card.store.spec.ts` › fails the catalogue slice when the system refuses the answer, and never keeps it); the malformed half `dead:` (F3-1 (b))
- refusing malformed per-client documents › refuses an account body naming someone else — the document id is the client → `wa:loyalty.adapter.spec.ts` › reads the account a barber sees: the stored body, its id the client record (the body carries no `userId`, D29); the refusal `dead:` (F3-1 (b))
- refusing malformed per-client documents › refuses an account with %s → `dead:` read-side validation of a stored body (F3-1 (b)) — pinned by `wa:loyalty.adapter.spec.ts` › a stored body is answered as stored — a malformed account and progress document included (F3-1 b)
- refusing malformed per-client documents › keeps an owed balance: negative only through a correction, never clamped → `wa:loyalty.adapter.spec.ts` › a stored body is answered as stored — a malformed account and progress document included (F3-1 b) (+ `sy:reward.system.spec.ts` › meters from nothing for an account that owes, and never to the full)
- refusing malformed per-client documents › refuses progress whose levels are not each once, lowest first → `dead:` read-side validation of a stored body (F3-1 (b))
- refusing malformed per-client documents › refuses a season track below zero → `dead:` read-side validation of a stored body (F3-1 (b))
- refusing malformed per-client documents › reads only a client-visible point row as a ledger row → `wa:loyalty.adapter.spec.ts` › names the client record, the visibility the rule demands, the pill’s effects, the order and one row more than asked (+ `testing/port-doubles.spec.ts` › reads one record’s client-visible rows of the pill’s effects, newest first)
- refusing malformed per-client documents › refuses a row whose label is not a known key with plain params → `co:journal-effect.data.spec.ts` › declare the tags SCREAMING (the discriminator `journalEffect` and its peers) and keep the label keys (+ › carries its params as named pairs — no dynamic field path — flat at the entry root); the refusal `dead:` (F3-1 (b))
- reading the rhythm’s head › reads the fixture as the recommended rule in force, nothing scheduled → `testing/loyalty.fixtures.spec.ts` › is the recommended rule the JSON opens with, in the ECS shape
- reading the rhythm’s head › writes the head back exactly as the fixture holds it → `dead:` mapper round trip (`streakScheduleToDocument`); the flat head the pipeline writes is `pl:publish-streak-definition.pipeline.spec.ts` › lets a later day WAIT: the version, the stamped head [CURRENT, SCHEDULED] and ONE row, in that order
- reading the rhythm’s head › writes a body that names neither the rule nor itself: the id is the document’s, the name the head’s → `wa:streak-publish-gateway.adapter.spec.ts` › carries no id and no name in the draft: they are the head’s (+ `pl:publish-streak-definition.pipeline.spec.ts` › keeps the name the head holds, and lists what moved against it)
- reading the rhythm’s head › round-trips %s through the factories to an EQUAL rule → `dead:` mapper round trip; rule equality is `sy:streak-rule.system.spec.ts` › equals the same version of the same rule
- reading the rhythm’s head › reads the version that waits, and resolves the rule in force BY DATE → `sy:streak-rule.system.spec.ts` › on $today version $inForce is in force and $upcoming waits
- reading the rhythm’s head › reads excuses in any order, and hands them back in the rule’s → `co:streak-rule.data.spec.ts` › keeps the excuses in the vocabulary’s order, each once
- reading the rhythm’s head › reads a head with a version that waits into a catalogue that resolves the rule by date → `sy:loyalty-catalog.system.spec.ts` › resolves the rule in force by date: version $version on $today
- refusing a malformed head › refuses a head with %s → `sy:streak-rule.system.spec.ts` › refuses a transition it does not know (+ › refuses version %s after version 3); the shape rows `dead:` (F3-1 (b)) — pinned by `wa:streak-definitions.adapter.spec.ts` › a stored head is answered as stored — a rule that is no rule, or a body of another shape (F3-1 b)
- refusing a malformed head › passes on what the rule refuses: %s → `co:streak-rule.data.spec.ts` › refuses %s
- refusing a malformed head › refuses a version that waits and %s → `sy:streak-rule.system.spec.ts` › refuses a rule that waits for %s when the one in force began on 2026-09-01
- refusing a malformed head › fails the whole catalogue on a rule the domain refuses → `dead:` read-side validation (F3-1 (b)) — pinned by `wa:loyalty-catalog.adapter.spec.ts` › a stored body is answered as stored — a head whose rule is no rule included (F3-1 b)
- refusing a malformed head › refuses the flat shape of before revision 3: no version in force → `dead:` a legacy body shape (greenfield: no dual shapes, no fallback readers)
- a rule’s versions › writes the body and how it came to be, instants as UTC ISO strings → `sy:streak-publish.system.spec.ts` › makes the version (the flat rule, signed and stamped, never withdrawn), the head whole and ONE row; the ISO strings `dead:` (`publishedAtUtcMs`)
- a rule’s versions › round-trips %s to an equal record → `dead:` mapper round trip (`streakDefinitionVersionTo/FromDocument`)
- a rule’s versions › never writes a version’s identity among what changed → `sy:streak-rule.system.spec.ts` › %s (StreakRuleSystem.changeFrom’s row «a new version and day alone»: NEUTRAL, nothing changed)
- a rule’s versions › refuses a body numbered otherwise than its document → `dead:` read-side validation (F3-1 (b)) — pinned by `wa:streak-definitions.adapter.spec.ts` › a stored version is answered as stored — a blank publisher, or one filed under another number (F3-1 b)
- a rule’s versions › refuses a version with %s → `dead:` read-side validation of a stored body (F3-1 (b))
- a rule’s versions › passes on what the rule refuses, by code → `co:streak-rule.data.spec.ts` › refuses %s
- reading the rhythm’s state › Георги: twelve periods kept, oldest first, the newest today; nothing on the book holds the period → `testing/loyalty.fixtures.spec.ts` › tells Георги’s story: 358 points, Злато six visits from Платина, 4/10, 24 in rhythm (+ `co:streak-state.data.spec.ts` › keeps twelve closed periods)
- reading the rhythm’s state › Мартин: today’s visit, in the chair, holds the period → `testing/loyalty.fixtures.spec.ts` › tells Мартин’s story: 215 points, Сребро, 3/10, 13 in rhythm at risk until 30.09, held by today’s visit
- reading the rhythm’s state › reads a state written before revision 3: no terms, no periods, no hold, no day the run began → `dead:` a legacy body shape (greenfield; the four fields are always written, F3-7)
- reading the rhythm’s state › reads the day the run began, older than anything the track keeps → `sy:streak.system.spec.ts` › is the first visit the count counts, however long ago
- reading the rhythm’s state › reads a state the first seed of revision 3 wrote: the three, and no day the run began → `dead:` a legacy body shape (greenfield, F3-7)
- reading the rhythm’s state › reads a count that was lost: no run is in progress, so none began → `sy:streak.system.spec.ts` › is nobody’s day while the count is lost, and the day of the visit that starts over
- reading the rhythm’s state › reads a broken rhythm: no period is open, so no terms and no hold → `co:streak-state.data.spec.ts` › reads the open period’s flat terms back as the value, or none while no period is open
- reading the rhythm’s state › reads a period that runs on the shop’s excuse → `sy:streak.system.spec.ts` › carries the period on the excuse until its moved due date
- reading the rhythm’s state › reads a personal period: the habit to one decimal, the one figure that is not whole → `sy:streak.system.spec.ts` › personal: the habit is the mean of the last six counted gaps
- reading the rhythm’s state › reads a period covered by «%s» → `sy:streak.system.spec.ts` › draws a covered period open as protected, by what covers it, until its moved due date — never while paused
- reading the rhythm’s state › refuses a state with %s → `dead:` read-side validation of a stored body (F3-1 (b))
- reading the rhythm’s state › writes the state of %s back exactly as the fixture holds it → `dead:` mapper round trip (`streakStateToDocument`); the seed writes the flat state (`sd:loyalty.spec.mjs` › has the fixture’s shape, document by document)
- reading the rhythm’s state › writes every field, the four a reader tolerates the absence of included → `testing/loyalty.fixtures.spec.ts` › %s: each account body is exactly one variant of every slice (the four fields always written, F3-7); the mapper `dead:`
- reading the rhythm’s state › writes the day the run began as the day it is → `dead:` mapper round trip (`runStartedOn` is a stored `LocalDate`)
- reading the activity feed › names the effects behind every pill, from one table → `co:journal-effect.data.spec.ts` › reads today’s effects per pill, in the feed’s order
- reading the activity feed › reads every row of %s as the ledger does, with the event and the balance after it → `wa:loyalty.adapter.spec.ts` › a stored row is answered as stored: what ties it to its event, its visit and the balance after it (F3-1 b)
- reading the activity feed › keeps what ties the rows of one event together → `wa:loyalty.adapter.spec.ts` › a stored row is answered as stored: what ties it to its event, its visit and the balance after it (F3-1 b) (+ `sy:ledger.system.spec.ts` › folds the entries of one event into one, newest first, whatever order they arrive in)
- reading the activity feed › reads %s, cut to what a row prints → `dead:` the feed-row mapper’s cut (`activityEntryFromDocument`) — rows are answered as stored (F3-1 (b)) and worded by `cc:lib/ledger.presenter.ts`
- reading the activity feed › reads a row that owes: a negative balance is a fact, never clamped → `wa:loyalty.adapter.spec.ts` › a stored row is answered as stored: what ties it to its event, its visit and the balance after it (F3-1 b)
- reading the activity feed › keeps %s out of the feed → `wa:loyalty.adapter.spec.ts` › never reads the rhythm’s rows, a protection or a staff row
- reading the activity feed › refuses %s → `dead:` read-side validation of a stored body (F3-1 (b))

**`app:lib/ports/loyalty-activity-reader.port.spec.ts` (20)**

- names its token → `dead:` the class token `LOYALTY_ACTIVITY_READER` is retired (T3); `CLIENT_JOURNAL_PORTS` is a typed bundle token
- over the fixtures, which hold point rows › reads the newest rows first, as many as asked → `testing/port-doubles.spec.ts` › reads one record’s client-visible rows of the pill’s effects, newest first
- over the fixtures, which hold point rows › carries on each row the event it belongs to and the balance after it → `wa:loyalty.adapter.spec.ts` › a stored row is answered as stored: what ties it to its event, its visit and the balance after it (F3-1 b)
- over the fixtures, which hold point rows › answers the same under «Точки», and nothing under the other two pills → `wa:loyalty.adapter.spec.ts` › «Точки» is the point rows alone (+ › is an empty page, never an error, under a pill that holds nothing)
- over the fixtures, which hold point rows › keeps one client’s rows from another’s → `wa:loyalty.adapter.spec.ts` › never hands one client record another’s rows
- paging › walks the whole feed in pages, strictly older than the cursor, until nothing is left → `wa:loyalty.adapter.spec.ts` › walks the whole feed through its cursors: every row once, in order
- paging › gives no cursor when a page ends exactly on the oldest row → `wa:loyalty.adapter.spec.ts` › gives no cursor when the rows end exactly where the page does
- paging › reads nothing past the oldest row → `testing/port-doubles.spec.ts` › pages by seq: the page’s oldest seq is the cursor while anything older is left
- paging › reads a page of one for a limit that is none → `testing/port-doubles.spec.ts` › reads a page of at least one row, and nothing for a pill with no rows (+ `wa:loyalty.adapter.spec.ts` › asks for a whole page of at least one row, whatever was asked (%s))
- over a journal that holds every kind › reads the feed’s five effects under «Всички», and none of the rest → `wa:loyalty.adapter.spec.ts` › hands over the newest rows first, one per journal entry, whatever they moved (+ › never reads the rhythm’s rows, a protection or a staff row)
- over a journal that holds every kind › cuts each effect to what a row prints → `dead:` the feed-row mapper’s cut — rows are answered as stored (F3-1 (b))
- over a journal that holds every kind › hands over a row per entry: the three of one redemption share its event → `wa:loyalty.adapter.spec.ts` › hands over the newest rows first, one per journal entry, whatever they moved (+ `sy:ledger.system.spec.ts` › folds the entries of one event into one, newest first, whatever order they arrive in)
- over a journal that holds every kind › may end a page inside an event: the cursor is a row’s, never an event’s → `sy:ledger.system.spec.ts` › holds the oldest event back while a page is left, and shows it once the end confirms it (+ `testing/port-doubles.spec.ts` › pages by seq: the page’s oldest seq is the cursor while anything older is left)
- over a journal that holds every kind › reads each pill’s own effects → `wa:loyalty.adapter.spec.ts` › asks «%s» for its own effects: %s
- over a journal that holds every kind › pages a pill by the journal’s own sequence, gaps and all → `testing/port-doubles.spec.ts` › pages by seq: the page’s oldest seq is the cursor while anything older is left
- over a journal that holds every kind › never shows a row only the staff may see → `wa:loyalty.adapter.spec.ts` › never reads the rhythm’s rows, a protection or a staff row
- answers an empty page for a client with no journal → `wa:loyalty.adapter.spec.ts` › is an empty page, never an error, under a pill that holds nothing
- seeds a journal under any uid, and replaces one → `dead:` the reference class’s `put` — the double reads its world by reference (`testing/port-doubles.spec.ts` › reads the world by reference: an account set later is read at the next call)
- fails a page that holds a malformed row, as the adapter would → `dead:` read-side validation (F3-1 (b)) — pinned by `wa:loyalty.adapter.spec.ts` › a stored row is answered as stored: what ties it to its event, its visit and the balance after it (F3-1 b)
- fails while told to, and records every page asked for → `wa:loyalty.adapter.spec.ts` › turns a refused read into a failed Result naming the collection and the store’s reason; the class’s call log `dead:`

**`app:lib/ports/loyalty-catalog-reader.port.spec.ts` (4)**

- names its token → `dead:` the class token `LOYALTY_CATALOG_READER` is retired (T3); `LOYALTY_CATALOG_READ_PORTS` is a typed bundle token
- reads the fixture catalogue, validated whole → `testing/port-doubles.spec.ts` › answers the dev shop’s catalogue under the system’s part names (+ `testing/loyalty.fixtures.spec.ts` › holds together: the system takes it unmapped and puts it in display order)
- fails an inconsistent catalogue rather than drawing half of it → `cc:lib/client-card.store.spec.ts` › fails the catalogue slice when the system refuses the answer, and never keeps it (+ `sy:loyalty-catalog.system.spec.ts` › refuses a family in a season the catalogue lacks)
- fails while told to, and reads again once recovered → `testing/port-doubles.spec.ts` › answers the catalogue it is given, or fails as unavailable

**`app:lib/ports/loyalty-reader.port.spec.ts` (9)**

- names its token → `dead:` the class token `LOYALTY_READER` is retired (T3); `LOYALTY_ACCOUNT_READ_PORTS` is a typed bundle token
- reads the seeded clients through the mappers → `testing/port-doubles.spec.ts` › reads a record’s account and its whole progress, as stored
- answers null for a client without an account, and empty lists → `testing/port-doubles.spec.ts` › answers no account and no progress for a record without loyalty
- seeds a fixture under any uid, the account following its key → `testing/port-doubles.spec.ts` › reads the world by reference: an account set later is read at the next call
- lists every started family and every season track → `wa:loyalty.adapter.spec.ts` › reads every started family and every season track, in Firestore’s id order
- hands back the newest point rows first, as many as asked → `dead:` `listLedgerTail` had no caller (F3-13)
- leaves out a row that is not a client-visible point row → `dead:` `listLedgerTail` (F3-13)
- fails every read while told to, and records every call → `testing/port-doubles.spec.ts` › records each call, in order, by the record it asked for (+ `wa:loyalty.adapter.spec.ts` › turns a refused read into a failed Result naming the path and the store’s reason)
- fails a read whose document is malformed, as the adapter would → `dead:` read-side validation (F3-1 (b)) — pinned by `wa:loyalty.adapter.spec.ts` › a stored body is answered as stored — a malformed account and progress document included (F3-1 b)

**`app:lib/ports/streak-definition.port.spec.ts` (29)**

- names its token → `dead:` the class token `STREAK_DEFINITION_REPOSITORY` is retired (T3); `STREAK_DEFINITION_PORTS` / `STREAK_PUBLISH_PORTS` are typed bundle tokens
- names the server’s six refusals, each worded by a code of its own → `primitives/streak-publish-errors.data.spec.ts` › keeps the callable’s codes SCREAMING under the LOYALTY_STREAK_PUBLISH_ prefix (+ › builds one plain struct per errorCode)
- observe › reads the head as a model: the recommended rule in force, nothing waiting → `wa:streak-definitions.adapter.spec.ts` › hands over the head as stored: the rule in force, and nothing waiting
- observe › answers null for a rule nobody published: an answer, not an error → `wa:streak-definitions.adapter.spec.ts` › answers null, not a failure, for a shop that has published no rule
- observe › answers again whenever the head changes → `testing/port-doubles.spec.ts` › streams the head live: at subscription, and again on every changed() (+ `wa:streak-definitions.adapter.spec.ts` › hears a publish made elsewhere as it lands)
- observe › stays open through a failure and answers again once it is over → `wa:streak-definitions.adapter.spec.ts` › turns a refused listen into a failed Result naming the head, never a thrown stream
- observe › fails a head that is malformed, as the adapter would → `dead:` read-side validation (F3-1 (b)) — pinned by `wa:streak-definitions.adapter.spec.ts` › a stored head is answered as stored — a rule that is no rule, or a body of another shape (F3-1 b)
- observe › resolves what waits by date, with no write: from its own day it is the rule in force → `wa:streak-definitions.adapter.spec.ts` › hands over the version that waits inside the same head — the system resolves it by date, with no second read
- listVersions › lists the history newest first, the called-off version among it → `wa:streak-definitions.adapter.spec.ts` › lists every publish newest first, every version as stored — no head read beside it (+ › shows a withdrawn version as withdrawn)
- listVersions › lists as many as asked, one at least → `testing/port-doubles.spec.ts` › lists the newest versions first, at least one
- listVersions › lists nothing for a rule nobody published → `wa:streak-definitions.adapter.spec.ts` › is an empty history for a rule nobody published
- publish › lets a later day WAIT: the rule in force stays, the new one is scheduled → `pl:publish-streak-definition.pipeline.spec.ts` › lets a later day WAIT: the version, the stamped head [CURRENT, SCHEDULED] and ONE row, in that order
- publish › puts a version effective today in force at once → `pl:publish-streak-definition.pipeline.spec.ts` › puts a version effective today in force at once: the head holds it alone
- publish › replaces what waited, and stamps it as called off → `pl:publish-streak-definition.pipeline.spec.ts` › replaces what waited and stamps its document; compared with the rule IN FORCE
- publish › keeps what came into force by date as the rule in force of the new head → `pl:publish-streak-definition.pipeline.spec.ts` › keeps what came into force by date as the rule in force of the new head, and stamps nothing
- publish › writes nothing for a retry of an intent it wrote, and answers as it did → `pl:publish-streak-definition.pipeline.spec.ts` › answers the retry of a publish with the ORIGINAL receipt, a day later, from the version it wrote (+ `testing/streak-publish-gateway.double.spec.ts` › answers a retry of the same intent with the original receipt, and writes nothing twice)
- publish › publishes a shop’s first rule on nothing: base 0, version 1, in force whatever its day → `pl:publish-streak-definition.pipeline.spec.ts` › opens a shop’s first rule on nothing: head, version 1 and its row; in force whatever its day
- publish › refuses a head that moved: stale, and nothing is overwritten → `pl:publish-streak-definition.pipeline.spec.ts` › refuses a head that moved (stale), a recompute, a preview — before the draft is judged
- publish › numbers the version itself: the request’s number is a proposal → `pl:publish-streak-definition.pipeline.spec.ts` › numbers the version itself: the draft’s number is a proposal
- publish › refuses a day the change may not start on yet → `pl:publish-streak-definition.pipeline.spec.ts` › refuses a day the change may not start on yet, and says the first it may
- publish › owes the clients who see the rhythm their notice of a stricter rule → `pl:publish-streak-definition.pipeline.spec.ts` › owes the clients who see the rhythm (`loyalty.selfView`) thirty days’ notice of a stricter rule (+ `testing/streak-publish-gateway.double.spec.ts` › holds a stricter rule to the server’s notice once clients see the rhythm)
- publish › refuses to recompute the runs before the engine exists → `pl:publish-streak-definition.pipeline.spec.ts` › refuses a head that moved (stale), a recompute, a preview — before the draft is judged
- publish › refuses in the words it is told to, until recovered → `testing/streak-publish-gateway.double.spec.ts` › scripts a refusal or a failure for every call, touching nothing
- publish › fails, never throws, when the request gets no answer → `testing/streak-publish-gateway.double.spec.ts` › scripts a refusal or a failure for every call, touching nothing (+ `wa:streak-publish-gateway.adapter.spec.ts` › tells %s apart from a refusal: the request got no answer)
- withdraw › calls off the version that waits: the head holds the rule in force alone → `pl:publish-streak-definition.pipeline.spec.ts` › stamps what waited, holds the rule in force alone and writes ONE row; adds no version
- withdraw › never gives a called-off version’s number away → `pl:publish-streak-definition.pipeline.spec.ts` › never gives a called-off version’s number away: one above the highest ever written
- withdraw › answers a retry of the same intent as it did → `pl:publish-streak-definition.pipeline.spec.ts` › answers the retry of a withdrawal as it did, though nothing waits any more
- withdraw › refuses what no longer waits: another version, nothing, a day that came → `pl:publish-streak-definition.pipeline.spec.ts` › refuses what no longer waits: another version, nothing, a day that came, no rule, the rule in force
- records every call, in order → `dead:` the reference class’s call log — the doubles are closures over one world and their specs assert the world they leave (`testing/port-doubles.spec.ts` › seeds the head, its versions and the audit rows at their flat paths, minus their ids)

**`app:lib/use-cases/observe-streak-definition.use-case.spec.ts` (10)**

- hands the published head over as it is, and says it is published → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › opens on the rule in force, with its history
- opens on the recommended rule where the shop has published none → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › opens a shop with no rule on the recommended one, ready to be saved
- recommends the same figures under another rule’s id → `co:streak-rule.data.spec.ts` › is served under the rhythm’s stable id and name; the any-id recommendation `dead:` (the page observes the one business rule, `ADMIN_RHYTHM_STREAK_ID = StreakRule.DEFAULT_DEFINITION_ID`; `sy:streak-publish.system.spec.ts` › opens no rule but the business’s one: another id names nothing)
- fails for an id no rule can carry, never with a rule nobody asked for → `co:streak-rule.data.spec.ts` › takes an id as given and refuses a blank one
- hears of every change of the head: a version that waits, then its withdrawal → `testing/streak-publish-gateway.double.spec.ts` › lets the head stream hear of a landed publish and a withdrawal — the page observes what it sent (+ `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › is shown waiting beside a form with no draft)
- turns from the recommendation to the rule the moment one is published → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › publishes a shop’s first rule as version 1
- passes a failed read on, and the next good one after it → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › fails when the rule cannot be read, and reads again on «Опитай пак» (+ › keeps the rule on screen when a later read fails)
- history › lists the rule’s versions, newest first → `testing/port-doubles.spec.ts` › lists the newest versions first, at least one (+ `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › opens on the rule in force, with its history)
- history › asks for twenty unless told, and never for less than one → `wa:streak-definitions.adapter.spec.ts` › asks for a whole count of at least one, whatever was asked (%s) (+ › keeps to the limit, from the newest)
- history › lists nothing for a rule nobody published, and fails as the port does → `wa:streak-definitions.adapter.spec.ts` › is an empty history for a rule nobody published (+ `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › reads the history again when only the history failed)

**`app:lib/use-cases/preview-streak-definition.use-case.spec.ts` (20)** — every case moved verbatim in Phase 2; each title is `sy:streak-preview.system.spec.ts` › StreakPreviewSystem.estimate — the admin preview › (same title):

- stands on the domain’s projector: the people below are where it says they are → `sy:streak-preview.system.spec.ts` › stands on the domain’s projector: the people below are where it says they are
- counts every person once under each rule → `sy:streak-preview.system.spec.ts` › counts every person once under each rule
- counts a run close to its due date, and one a protection or a pause holds, as in rhythm → `sy:streak-preview.system.spec.ts` › counts a run close to its due date, and one a protection or a pause holds, as in rhythm
- shows what a LONGER interval brings back → `sy:streak-preview.system.spec.ts` › shows what a LONGER interval brings back
- shows what a SHORTER interval takes away → `sy:streak-preview.system.spec.ts` › shows what a SHORTER interval takes away
- counts from the rule in force, whichever that is → `sy:streak-preview.system.spec.ts` › counts from the rule in force, whichever that is
- counts a change that moves people both ways, each way → `sy:streak-preview.system.spec.ts` › counts a change that moves people both ways, each way
- keeps the change of «В ритъм» equal to who came back less who went out → `sy:streak-preview.system.spec.ts` › keeps the change of «В ритъм» equal to who came back less who went out
- moves nobody between rhythm and grace for a change only the staff sees → `sy:streak-preview.system.spec.ts` › moves nobody between rhythm and grace for a change only the staff sees
- shows more grace as people in grace, not as people in rhythm → `sy:streak-preview.system.spec.ts` › shows more grace as people in grace, not as people in rhythm
- agrees with the projector, person by person → `sy:streak-preview.system.spec.ts` › agrees with the projector, person by person
- who is judged › leaves out whoever has no visit to judge → `sy:streak-preview.system.spec.ts` › leaves out whoever has no visit to judge
- who is judged › judges a visit made today → `sy:streak-preview.system.spec.ts` › judges a visit made today
- who is judged › estimates an empty shop as nobody, not as an error → `sy:streak-preview.system.spec.ts` › estimates an empty shop as nobody, not as an error
- who is judged › judges nobody on a day that is no day → `sy:streak-preview.system.spec.ts` › judges nobody on a day that is no day
- the rule going off, or on › counts nobody under a rule that is off: it judges no one → `sy:streak-preview.system.spec.ts` › counts nobody under a rule that is off: it judges no one
- the rule going off, or on › counts where people will stand when the rule comes on → `sy:streak-preview.system.spec.ts` › counts where people will stand when the rule comes on
- a rule that counts by a list › is not estimated when %s → `sy:streak-preview.system.spec.ts` › is not estimated when %s
- is pure: the same question is the same answer, and the facts are left as they were → `sy:streak-preview.system.spec.ts` › is pure: the same question is the same answer, and the facts are left as they were
- folds a thousand clients without being asked twice → `sy:streak-preview.system.spec.ts` › folds a thousand clients without being asked twice

**`app:lib/use-cases/publish-streak-definition.use-case.spec.ts` (30)**

- assess — what a draft comes to, sending nothing › makes the draft the next version of the rule, on the day asked → `sy:streak-publish.system.spec.ts` › makes the draft the next version of the rule, on the day asked
- assess › sets the identity of the version itself: the draft cannot number or date it → `sy:streak-publish.system.spec.ts` › sets the identity of the version itself: the draft cannot number or date it
- assess › lets %s start as early as the domain does, while nobody sees the rhythm → `sy:streak-publish.system.spec.ts` › lets %s start as early as the domain does, while nobody sees the rhythm
- assess › owes the clients who see the rhythm their notice, of a stricter rule only → `sy:streak-publish.system.spec.ts` › owes the clients who see the rhythm their notice, of a stricter rule only
- assess › names every fault of a draft that is no rule, at once → `sy:streak-publish.system.spec.ts` › names every fault of a draft that is no rule, at once
- assess › names a field once, however many faults it has → `sy:streak-publish.system.spec.ts` › names a field once, however many faults it has
- assess › refuses a day that is no day as a fault of the draft → `sy:streak-publish.system.spec.ts` › refuses a day that is no day as a fault of the draft
- assess › bases the draft on what WAITS, and compares it with what is IN FORCE → `sy:streak-publish.system.spec.ts` › bases the draft on what WAITS, and compares it with what is IN FORCE
- assess › takes what waited for the rule in force once its day has come → `sy:streak-publish.system.spec.ts` › takes what waited for the rule in force once its day has come
- assess › numbers a shop’s first rule 1, on nothing → `sy:streak-publish.system.spec.ts` › numbers a shop’s first rule 1, on nothing
- execute — «Запази» › publishes a rule from a later day: it waits, and can still be called off → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › publishes a version that waits for its day, and the form rests on the rule in force
- execute › publishes what may start today as the rule in force: nothing waits → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › publishes for today what may start today, and the form stands on it
- execute › hands the preview it was confirmed on over, when there is one → `wa:streak-publish-gateway.adapter.spec.ts` › sends the rule as the callable’s request: the draft is the rule’s own nested body (`previewHash` carried; `co:streak-publish-call.data.spec.ts` › carries the rule as proposed beside the head it was drafted against)
- execute › answers the number the writer gave, which a withdrawal moves past the draft’s → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › numbers the next version above the one called off
- execute › sends nothing for a draft that is the rule in force → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › publishes nothing for a form that was not touched
- execute › publishes the recommended rule as it stands where none is published: until then there is none → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › publishes a shop’s first rule as version 1
- execute › names the fields of a draft that is no rule, before any round trip → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › sends nothing for a draft that is no rule
- execute › names the earliest day of a change asked too early, before any round trip → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › never goes under the first day the change may start
- execute › offers a later day when the SERVER holds the change to a stricter one → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › moves the day to the earliest the server allows, and publishes on the second «Запази»
- execute › offers at least the day after the one refused → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › moves the day to the earliest the server allows, and publishes on the second «Запази» (the refusal names the refused day itself; the page offers a later one)
- execute › words the server’s refusal of a draft by the fields it names → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › names the fields the server found wrong
- execute › is refused as stale when someone else published meanwhile, and overwrites nothing → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › refuses a save it overtook, keeps the draft, and the second «Запази» goes through
- execute › passes the server’s «%s» on as it is → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › keeps the draft and says so when the server refuses the caller (+ `wa:streak-publish-gateway.adapter.spec.ts` › hands over the server’s refusal «%s» as its flat struct, never dropping the copy)
- execute › leaves it to the server to refuse a recompute before the engine exists → `pl:publish-streak-definition.pipeline.spec.ts` › refuses a head that moved (stale), a recompute, a preview — before the draft is judged
- execute › says the request got no answer, and keeps the intent for the retry → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › keeps the intent’s id across a save that got no answer
- withdraw — «Отмени» › calls off the version that waits, by its own number → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › calls off the version that waits
- withdraw › sends nothing when %s → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › has nothing to call off when nothing waits
- withdraw › sends nothing for a rule nobody published → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › has nothing to call off when nothing waits
- withdraw › is refused as stale when what waited was replaced meanwhile → `sy:streak-publish.system.spec.ts` › refuses what no longer waits: another version, nothing, a day that came, no rule (+ `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › hands on the server’s refusal)
- withdraw › passes a refusal and a failure on as they are → `ft:admin/loyalty/src/lib/admin-rhythm.store.spec.ts` › hands on the server’s refusal (+ › keeps the intent’s id across an «Отмени» that got no answer)

**`app:lib/use-cases/create-invitation.use-case.spec.ts` (1)**

- creates and saves a fresh, zero-redemption invitation → `dead:` the invitation surface (F3-12): no port, reader or writer until Phase 4; the use case had spec-only callers

**`app:lib/use-cases/redeem-invitation.use-case.spec.ts` (3)**

- records a redemption and bumps the invitation counter → `sy:referral.system.spec.ts` › accepts a different user: records the redemption and bumps the invitation counter
- rejects self-redemption → `sy:referral.system.spec.ts` › rejects the inviter redeeming their own invitation
- reports not-found for an unknown invitation → `dead:` the repository lookup of the invitation surface (F3-12)

**`app:lib/engagement.type-spec.ts` (re-targeted; 4 compile-only invitation cases of 6 go, the two `CouponGrantId` cases stay)**

- (a) a bare string is not an InvitationId → `primitives/ids.type-spec.ts` (2) “No bare value” (`InvitationId` is in `Brands`)
- (b) CouponGrantId cannot substitute where an InvitationId is expected → `primitives/ids.type-spec.ts` (1) “All pairs”
- (b) InvitationId cannot substitute where a CouponGrantId is expected → `primitives/ids.type-spec.ts` (1) “All pairs”
- (c) findById takes an InvitationId, not a bare string → `dead:` the invitation port (F3-12)

**`app:testing.spec.ts` (49 → 11: 38 deleted, 2 re-titled, 9 kept as they were)**

Kept as they were: › keeps them off the production barrel (`giftVoucherFixtures` for `loyaltyFixtures`) · › re-exports none of the test support · › hands them out frozen, all the way down (its voucher half) · the voucher fixture › holds five vouchers, each under its own code · › counts money in whole euro cents, never more left than was issued · › speaks only the closed vocabulary, and dates everything in the shop’s zone (`FIXTURE_TODAY` for `today`) · › issues a voucher to a seeded client, or to nobody (the holders are `@core/testing`’s `loyaltyAccountJson.{georgi,martin}.uid`) · the seeded story (§4.6) › the vouchers: Георги has 25,00 € left of 50,00 € until the year’s end · the in-memory references, seeded › hands each client the vouchers issued to them, and nobody the paper one.

- test support › offers the loyalty fixtures → re-titled › offers the gift voucher fixture (the vouchers half); the loyalty half → `testing/loyalty.fixtures.spec.ts` › holds every catalogue collection, keyed by collection
- test support › offers every loyalty port its in-memory reference → re-titled › offers the vouchers port its in-memory reference; the loyalty doubles → `testing/port-doubles.spec.ts` › reads a record’s account and its whole progress, as stored (+ › answers the dev shop’s catalogue under the system’s part names; › reads one record’s client-visible rows of the pill’s effects, newest first; › streams the head live: at subscription, and again on every changed())
- test support › hands them out frozen, all the way down (its account, catalogue and rhythm half) → `testing/loyalty.fixtures.spec.ts` › is deep-frozen: a spec cannot leak a write into the next one
- the catalogue fixture › holds the six catalogue collections, sized as the seed writes them (§4.5) → `testing/loyalty.fixtures.spec.ts` › spreads each document id in, every collection in Firestore’s id order
- the catalogue fixture › speaks only the closed vocabularies → `testing/loyalty.fixtures.spec.ts` › speaks only the closed vocabularies, SCREAMING where they are tags
- the catalogue fixture › holds the rhythm as its head: a version in force, and nothing that waits out of turn → `testing/loyalty.fixtures.spec.ts` › carries the rhythm’s head, whose every rule passes the rule’s own guard
- the catalogue fixture › keeps every figure of the rule whole, grace and the cue shorter than a period → `testing/loyalty.fixtures.spec.ts` › carries the rhythm’s head, whose every rule passes the rule’s own guard (+ `co:streak-rule.data.spec.ts` › narrows the cue and the minimum gap to what the interval leaves)
- the catalogue fixture › draws every emblem somewhere → `testing/loyalty.fixtures.spec.ts` › draws every emblem somewhere (+ › speaks only the closed vocabularies, SCREAMING where they are tags)
- the catalogue fixture › writes every text in both locales → `testing/loyalty.fixtures.spec.ts` › writes every text in both locales
- the catalogue fixture › homes every family in exactly one existing category or season → `testing/loyalty.fixtures.spec.ts` › holds together: the system takes it unmapped and puts it in display order (`LoyaltyCatalogSystem.validate`’s dangling-home checks)
- the catalogue fixture › climbs every family I…n with rising targets; a one-off or a yearly family has one level → `testing/loyalty.fixtures.spec.ts` › climbs every family I…n with rising targets; a one-off or a yearly family has one level (`BadgeSystem.validate` over every family, + `sy:badge.system.spec.ts` › takes a one-off act and a yearly family, each with one level)
- the catalogue fixture › gives every level its own once-rule and pays in positive whole amounts → `testing/loyalty.fixtures.spec.ts` › gives every level its own once-rule and pays in positive whole amounts (+ `sy:badge.system.spec.ts` › names what it refused: the levels, the targets, the level and what it paid)
- the catalogue fixture › narrows a subject family to its subject → `testing/loyalty.fixtures.spec.ts` › narrows each family on its subject: a variant declares only its own id
- the catalogue fixture › dates every season inclusively, announced a notice period ahead (R29) → `testing/loyalty.fixtures.spec.ts` › dates every season inclusively, announced a notice period ahead (R29) (`SeasonSystem.validate` over every season; + `sy:season.system.spec.ts` › counts the announcement on the Sofia calendar; › takes a one-day window; `testing/loyalty.fixtures.spec.ts` › writes every T5 pair from one reading: each stored day is the Sofia day of its instant)
- the catalogue fixture › gives a season a track and an event none, and lists each of its families once → `testing/loyalty.fixtures.spec.ts` › holds together: the system takes it unmapped and puts it in display order (+ `sy:season.system.spec.ts` › refuses an event with a track)
- the catalogue fixture › runs one season and one event, and has one season behind it, on the fixtures’ today → `sy:loyalty-catalog.system.spec.ts` › lists the running windows in the order they opened (+ › lists the ended windows newest first)
- the catalogue fixture › ranks the tiers by visits in a year, each asking more than the last → `testing/loyalty.fixtures.spec.ts` › keeps every figure: the tiers’ ladder, the rewards’ costs and limits (+ › writes every T5 pair from one reading: each stored day is the Sofia day of its instant — 365-day windows)
- the catalogue fixture › prices every reward in positive whole points, and orders them → `testing/loyalty.fixtures.spec.ts` › keeps every figure: the tiers’ ladder, the rewards’ costs and limits (+ `sy:loyalty-catalog.system.spec.ts` › refuses a reward costing %s)
- the catalogue fixture › writes instants as UTC ISO strings → `dead:` ISO instants — instants are `*UtcMs` (`testing/loyalty.fixtures.spec.ts` › writes every T5 pair from one reading: each stored day is the Sofia day of its instant)
- the catalogue fixture › dates a rule’s first day as a day → `testing/loyalty.fixtures.spec.ts` › is dated before FIXTURE_TODAY, the day it is true on
- the account fixture of %s › is this client’s, keyed and sequenced as the journal is → `testing/loyalty.fixtures.spec.ts` › %s: the journal is the account’s, dense by seq, folding to its balance (+ › %s: the record id is CustomerId.forUser(uid) with the production sha256)
- the account fixture of %s › holds the client-visible point rows, in time order, each carrying the running balance → `testing/loyalty.fixtures.spec.ts` › %s: the journal is the account’s, dense by seq, folding to its balance
- the account fixture of %s › balances: Σ point rows = earned + adjusted − spent → `testing/loyalty.fixtures.spec.ts` › %s: the journal is the account’s, dense by seq, folding to its balance (+ `sd:loyalty.spec.mjs` › keeps every invariant a reader leans on)
- the account fixture of %s › pays a seat a point per whole euro, and a level exactly what the catalogue says it pays → `testing/loyalty.fixtures.spec.ts` › keeps each label’s params as named pairs, in the order they were written (+ `sd:loyalty.spec.mjs` › keeps every invariant a reader leans on — the seed’s projection, whose shape is the fixture’s)
- the account fixture of %s › keeps progress only for catalogue families, levels earned bottom-up in time order → `sd:loyalty.spec.mjs` › keeps every invariant a reader leans on (+ `testing/loyalty.fixtures.spec.ts` › %s: earned levels carry their instant and its Sofia day (T5))
- the account fixture of %s › counts «Посещения» as the visits the journal paid for → `sd:loyalty.spec.mjs` › keeps every invariant a reader leans on
- the account fixture of %s › mirrors each season’s track into its season progress → `sd:loyalty.spec.mjs` › keeps every invariant a reader leans on (+ `testing/loyalty.fixtures.spec.ts` › tells Георги’s story: 358 points, Злато six visits from Платина, 4/10, 24 in rhythm)
- the account fixture of %s › places the client on the tier their visits in a year reach → `testing/loyalty.fixtures.spec.ts` › tells Георги’s story: 358 points, Злато six visits from Платина, 4/10, 24 in rhythm (+ › tells Мартин’s story: 215 points, Сребро, 3/10, 13 in rhythm at risk until 30.09, held by today’s visit)
- the account fixture of %s › keeps the rhythm on the rule in force → `testing/loyalty.fixtures.spec.ts` › %s: each account body is exactly one variant of every slice (+ `sy:streak.system.spec.ts` › pins the version it was judged by)
- the account fixture of %s › pins the open period’s terms to the rule it opened under → `sy:streak.system.spec.ts` › P6: the grace is pinned with the period (+ `co:streak-state.data.spec.ts` › reads the open period’s flat terms back as the value, or none while no period is open)
- the account fixture of %s › draws the track: the newest twelve closed periods, oldest first, up to the last counted visit → `sy:streak.system.spec.ts` › keeps the newest twelve closed periods, oldest first (+ `testing/loyalty.fixtures.spec.ts` › tells Георги’s story: 358 points, Злато six visits from Платина, 4/10, 24 in rhythm)
- the account fixture of %s › names the visit that holds the period only when one is on the book ahead → `testing/loyalty.fixtures.spec.ts` › tells Мартин’s story: 215 points, Сребро, 3/10, 13 in rhythm at risk until 30.09, held by today’s visit (+ `sy:streak.system.spec.ts` › holds the period past its grace until the visit, and names it)
- the account fixture of %s › dates the run in progress: as old as the first visit of a client who never lost the count → `sy:streak.system.spec.ts` › is the first visit the count counts, however long ago (+ `testing/loyalty.fixtures.spec.ts` › tells Георги’s story: 358 points, Злато six visits from Платина, 4/10, 24 in rhythm — `runStartedOn: '2025-03-06'`)
- the account fixture of %s › keeps its stamp cards, records and bookkeeping readable → `testing/loyalty.fixtures.spec.ts` › %s: each account body is exactly one variant of every slice (+ the two story cases’ punch cards, `seq`, `version`)
- the seeded story (§4.6) › Георги: the regular, Злато, 24 in rhythm, today’s cut done → `testing/loyalty.fixtures.spec.ts` › tells Георги’s story: 358 points, Злато six visits from Платина, 4/10, 24 in rhythm
- the seeded story (§4.6) › Мартин: Сребро, 13 in rhythm and due, no birthday visit yet → `testing/loyalty.fixtures.spec.ts` › tells Мартин’s story: 215 points, Сребро, 3/10, 13 in rhythm at risk until 30.09, held by today’s visit
- the seeded story (§4.6) › the rhythm: one rule, «Посещения в ритъм», every six weeks, nothing waiting → `testing/loyalty.fixtures.spec.ts` › is the recommended rule the JSON opens with, in the ECS shape
- the in-memory references, seeded › reads the rhythm’s rule as the catalogue hands it → `wa:loyalty-catalog.adapter.spec.ts` › hands over the rhythm’s rule as its head: in force, resolved by date by the system (+ `testing/port-doubles.spec.ts` › streams the head live: at subscription, and again on every changed())
- the in-memory references, seeded › gives the rule the history the seed gives it: its first version → `testing/loyalty.fixtures.spec.ts` › is version 000001: the rule in force, published by nobody by hand, never withdrawn (+ `testing/port-doubles.spec.ts` › seeds the head, its versions and the audit rows at their flat paths, minus their ids)
- the in-memory references, seeded › hands each client’s rhythm the day its run began, as the account holds it → `testing/port-doubles.spec.ts` › reads a record’s account and its whole progress, as stored (+ `testing/loyalty.fixtures.spec.ts` › tells Георги’s story: 358 points, Злато six visits from Платина, 4/10, 24 in rhythm); the absent-field read `dead:` (F3-7, the field is always written)
- the in-memory references, seeded › reads the activity’s point rows as the ledger reads its tail → `dead:` `listLedgerTail` (F3-13); the feed’s point rows are `testing/port-doubles.spec.ts` › reads one record’s client-visible rows of the pill’s effects, newest first

### 11.4 Deliberate departures, pinned

- **F3-1 (a)** — the client card's loyalty slices ride the client-record
  read: `cc:lib/client-card.store.spec.ts` › ClientCardStore — the client record (D29, flip-3 F3-1 (a)) › reads no loyalty for an account with no client record — and fails nothing; › reads no loyalty with no record port bound — an absent module, never a failure; › fails the loyalty slices when the record cannot be read, and a retry resolves it again; › fails the wallet’s feed with the record, and reads the journal under it once it resolves
- **F3-1 (b)** — stored bodies answered as stored: `wa:loyalty.adapter.spec.ts` › a stored body is answered as stored — a malformed account and progress document included (F3-1 b); › a stored row is answered as stored: what ties it to its event, its visit and the balance after it (F3-1 b); `wa:loyalty.adapter.integration.spec.ts` › answers a malformed account and progress document as stored (F3-1 b); `wa:loyalty-catalog.adapter.spec.ts` › a stored body is answered as stored — a head whose rule is no rule included (F3-1 b); `wa:streak-definitions.adapter.spec.ts` › a stored head is answered as stored — a rule that is no rule, or a body of another shape (F3-1 b); › a stored version is answered as stored — a blank publisher, or one filed under another number (F3-1 b). The catalogue keeps its check, as the store's: `cc:lib/client-card.store.spec.ts` › ClientCardStore — the catalogue › fails the catalogue slice when the system refuses the answer, and never keeps it. Two consequences, recorded at integration (§8.1 rulings 4 and 6), each reachable only through a writer defect (every writer writes the entity type; the seed refuses a catalogue `LoyaltyCatalogSystem.validate` refuses and a rule `StreakRule.parse` refuses): the session memo now keeps a catalogue the store's check refuses until the next shop day, a landed publish or withdrawal, or a reload (`wa:loyalty-catalog.adapter.spec.ts` › answers a catalogue that does not hold together as stored: refusing it is the system’s, over the answer) — before, a refused catalogue was a failed read and the next card read again; and a stored head the systems cannot read throws inside the publish transaction and leaves as `store_failed` with the fault's text in the `'rhythm rule write failed'` line (today: `store_failed` with the reader's `MalformedField` text).
- **F3-1 (c)** — the `'rhythm rule write failed'` line's `error` text for a taken version number: `fn:wire/loyalty.wire.spec.ts` › publishStreakRefusal — the per-code table, literally › logs a version number a concurrent writer took by its code and path (F3-1 (c)); `fn:main.spec.ts` › flip 3 — the streak publish › logs a version number a concurrent writer took by its code and path (F3-1 (c)), and throws internal

### 11.5 P5 — data plane (seed, rules spec)

No case of `tools/seed/{loyalty,load-domain,promotions,seed-data}.spec.mjs` or of `wa:firestore.rules.integration.spec.ts` was deleted; the lines below are every case whose substance changed (its successor is the same file and title unless named), with each half that has no successor `dead:` and its reason. `sd:` = `tools/seed/`.

**`sd:loyalty.spec.mjs` (84 kept)**

- the rhythm’s rule, as the seed writes it (revision 3 §4.3) › writes the head the domain’s own write half would: the rule round-trips through its factories → same title: `StreakRule.parse` + `StreakRuleSystem.schedule` answer the stored `rules`, head == `streakDefinitionFixture()` minus id; the `streakScheduleFromDocument`/`ToDocument` round trip `dead:` (legacy mapper)
- writes the first version as the domain’s write half would, published by nobody, changing nothing → same title: == `streakDefinitionVersionFixture()` minus id; `streakDefinitionVersionToDocument` `dead:` (mapper)
- is the history the in-memory reference lists, so a spec and the emulator show one → same title, over `memoryStreakDefinitionPorts(memoryStreakWorld(…)).listStreakDefinitionVersions` (successor of `InMemoryStreakDefinitionRepository.seeded()`)
- reads back as the version it is, under the head’s name → same title: `StreakRule.parse` + `StreakRuleSystem.equals` against the head's rule in force; the name half `dead:` (a flat version carries no name; the legacy reader borrowed the head's)
- refuses to describe a head that holds a version in waiting: only a publish writes one → same title, a flat `SCHEDULED` rule
  Within `rulesPublishedOver`'s `it.each` (a row, not a case), the row 'the flat rule of an emulator seeded before revision 3' became 'the nested head of an emulator seeded before flip 3'. (the stale shape an emulator can now hold is the pre-flip-3 nested head)
- counts the flat rule of an older seed as a stale catalogue, and its missing history → 'counts the nested head of an emulator seeded before flip 3 as a stale catalogue, and its missing history'
- read back by the client card’s readers › reads the catalogue as one catalogue: every shelf, family, season, tier, reward and the rhythm → same title, the `ValidLoyaltyCatalog` of `LoyaltyCatalogSystem.validate` (the legacy readers `dead:` — mappers, F3-1 (b); the describe keeps its title, its bodies judge with the seed’s two checks)
- reads the rhythm as a rule in force, and its first version beside the head that names it → same title, `LoyaltyCatalogSystem.streakInForce` + the stored, `StreakRule.parse`-checked version
- on %s the catalogue and every holder’s documents read, and the domain dates the seasons as the page draws them → same title, `LoyaltyCatalogSystem.seasonsIn`
- %s’s account › reads document by document: the account, every family, every season track, every row of the journal → same title, the routed entities’ `read.journal` (the activity/ledger reader split `dead:`: legacy `activityEntryFromDocument`/`ledgerEntryFromDocument`; the `POINTS` rows stand in for the ledger)
- reads what the fold wrote: a balance its rows sum to, the rows in order → same title, on the stored entities
- reads the rhythm the domain projected: its terms, its twelve periods, the visit that holds it → same title, `StreakState.periodTerms` (the `streakStateToDocument` round trip `dead:`)
- reads the day the run began: the holder’s first visit, further back than the track reaches → same title, on the stored entities
- names only what the catalogue holds → same title, `LoyaltyCatalogSystem` lookups and `PublicLabel.param`
- readLoyaltyWrites — what it refuses › names each document a reader refused, and each path no loyalty reader reads → 'names each path no loyalty document is written at, and a version with no head — and answers every account document as stored' (the routing and headless-version lines kept); its five per-document refusals — an account's `.userId`, a family's `.earned` order, a row's `.visibility`, a `streak` effect, a points row without `.effect.delta` — `dead:` read-side validation of stored bodies (F3-1 (b)); the case now pins that they are answered as stored
- refuses a rule the domain refuses, by the rule’s own code, and a version numbered otherwise than its id → same title: `StreakRule.parse`'s `ENGAGEMENT_STREAK_DEFINITION_GRACE_NOT_SHORTER_THAN_INTERVAL` on the head and on its version; the catalogue no longer fails with the head (`LoyaltyCatalogSystem.validate` judges no rule)
- fails the catalogue whole on one document the domain refuses → same title: the trigger moved from a season announced too late (the legacy `seasonFromDocument` notice rule — `dead:`, not `LoyaltyCatalogSystem.validate`'s) to a family on a missing shelf (`ENGAGEMENT_LOYALTY_CATALOG_DANGLING_CATEGORY`)
- the journal, as «Движение» folds it (§4.7) › reads every row as the feed’s reader reads it, and every point row as the ledger’s → same title: each row holds the feed query's keys and vocabularies (`customerId`, `journalVisibility` `CLIENT`, `journalEffect` ∈ `JournalFeed.effectsOf(ALL)`, `LABEL_CODES`, `pointsDelta` only on `POINTS`); the legacy readers `dead:` (mappers)
- projectLoyaltyFor — the rhythm under the rule the shop has in force (§4.10) › is the domain’s own projection of the book: the state the projector answers, written by its write half → same title on `StreakSystem.trace` (`traceStreak` + `streakStateToDocument` `dead:`)
- stops on a rule the wire’s reader refuses, naming it → same title: `StreakRule.parse` refuses (+ a head with no rule in force)
- loyaltyCatalogDriftOf › names a missing document, a changed map by its field, and a field only one side holds → same title, the expected line `retiredAt absent` → `retiredAtUtcMs absent` (the legacy field name `dead:`)
- the loyalty catalogue › is the fixtures’ catalogue, verbatim, on the fixtures’ day → same title, `loyaltyCatalogJson` and `FIXTURE_TODAY` (`loyaltyFixtures` retired)
- writes to the wire’s collections, under the wire’s journal ids → same title: `Collections`/`Subcollections`, `JournalEntryId.forEntry`, `StreakDefinitionVersionId.forVersion` (the `loyalty-document.ts` constants `dead:`)
  Every other case: same title, same intent, assertions re-spelled to the flat fields.

**`sd:load-domain.spec.mjs` (9)**

- holds every name the fold, the read-back and the writes are handed, each a function → same title over `projectClientStats`, `purgeAtFor` and `StreakSystem.trace`/`StreakRuleSystem.inForceOn`/`StreakRule.parse`/`LoyaltyCatalogSystem.validate` (the eleven `loyalty-document.ts` names, `projectStreak`/`traceStreak` and the `@creativo/domain/catalog` id factories `dead:` — bundle entry retired)
- names its modules by their files, and each is there → same title, `SEED_SERVER_MODULES` + `SEED_PLAN_MODULES`; the `SEED_DOMAIN_MODULES` half `dead:` (the map goes — the loyalty domain is the `@core/*` barrels)
- bundles the client card’s readers, and they read what the card’s own import reads → 'bundles the read-back’s two checks, and they judge what the ordinary import judges' (the flat `loyaltyCatalogJson`/`loyaltyAccountJson` + a refused head, both ways)
- bundles the rhythm’s projector: the seed’s book folds into the documents the ordinary imports fold it into → same title (`read.journal`)
- answers the state a rule and its facts give, as the ordinary import does → same title on `StreakRuleSystem.inForceOn` + `StreakSystem.trace`; its `projectStreak == traceStreak().state` half `dead:` (no second projector entry is bundled)

**`sd:promotions.spec.mjs` (21 kept)**

- the grants › on %s every coupon the journal says was granted is a grant the seed writes, to the instant → same title on the flat row keys (`journalEffect`, `rewardCouponGrantId`, `grantCouponGrantId`, `redeemedRewardId`, `PublicLabel.param` `'coupon'`, `rewardsCatalog` `grantCouponId`) and `utcEpochMs` (no ISO parse), + the row's `customerId` == the grant's (D29)

**`sd:seed-data.spec.mjs` (36)** — none rewritten.

**`wa:firestore.rules.integration.spec.ts` (89 `it` lines, titles identical, none deleted)** — the catalogue trims on flat keys; `loyaltyAccounts` keyed by `recordOf('client-1')`; `clientJournal` rows at `JournalEntryId.forEntry(record, seq)` with `journalVisibility`/`journalEffect` and the queries on `customerId`/`journalVisibility`/`journalEffect`; the streak head and versions from `streakDefinitionFixture`/`streakDefinitionVersionFixture` (successor of `InMemoryStreakDefinitionRepository.seeded().publish` + `documentsOf`), write attempts on `rules`/`withdrawnAtUtcMs`/`publishedByUserId`; the activity pills `JournalFeed.effectsOf(ALL|REWARDS|STATUS)` (was `ACTIVITY_EFFECT_KINDS`), the cursor `seq <` (the port's own query; was `startAfter`).
