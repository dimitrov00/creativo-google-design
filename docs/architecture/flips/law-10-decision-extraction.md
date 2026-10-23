# Law 10.2 — the decision-extraction pass (presenters word, systems decide)

**Date:** 2026-10-23 · **Status:** DONE — integrated 2026-10-23 (§9): the
FULL gate of HANDOFF §4 green (baseline reds only, the three emulator
journeys included) and the §6.3 dev-stack smoke identical to `fd5f2a6` but
the agenda's relative minutes;
lands as the "decision-extraction" commit. The plan as REVISED after review
(2026-10-23: zone-free achievements contracts, no tie-order departures,
three declared wave-0 edges, exact strip/cue/fresh-day shapes) — written on
`main` at `fd5f2a6`
(the ECS migration complete, Law 10 ruled and lint-enforced, the tree
clean). Line numbers are hints on that commit and drift. ·
**Law:** `CLAUDE.md` Laws 1–10 and `.claude/rules/*.md` — above all
`presenters.md` (Law 10.2: a presenter decides nothing), `ecs-systems.md`
(Law 3: pure, branded in and out, `now` is an input, purity spec),
`ecs-components.md` (a tag dictionary is an `as const` component),
`ecs-layering.md` (Law 8 tiers, one home per name) and `angular-ui.md`.
This plan never overrides them. ·
**Sources:** `docs/architecture/HANDOFF.md` §3.3 "Carried forward" (the
decision-extraction pass), §4 (gate and baselines), §5 (operating rules);
the five scout inventories the workflow handed in (catalog-visits,
wallet-ledger-loyalty, medals-achievements, glance-card-records,
helpers-other), each row re-read against the code here (§1 records what
was re-ruled); `docs/architecture/flips/ui-residue-cleanup.md` (the shape
of this plan, its §8.1 smoke method).

**What this is.** Not migration — the follow-up the owner ruled on
2026-10-23 (Law 10, option B). The presenters (`*.presenter.ts`), display
models (`*.vm.ts`) and wording helpers (`*.words.ts`, `*.format.ts`) are
pure since the Law 10 commit (`creativo/presenter-purity`), but many still
DECIDE: they choose a domain state, sum or compare domain values, filter a
list by a domain rule, order or group domain items, hold a threshold, or
re-derive what a system already answers (three outright copies:
`catalog.presenter.ts`/`catalog-presenter.service.ts` `pricedOf`,
`ledger.presenter.ts` `voidedIds`, `wallet.presenter.ts`'s voucher sort;
four duplicated constants). This pass moves every such decision into an
ecs-core system (Law 3) — extending the system that already owns the
concept first — and leaves the presenters only the wording.

**This pass ends** when every row of §1 marked MOVE is answered by an
ecs-core system function (new or existing) with a purity + boundary spec,
every presenter reads that answer instead of deciding, the §5 review
checklist finds no leftover, every presenter spec passes unchanged (import
lines aside), and the screens of §6.3 render byte-identically to `fd5f2a6`
(§0 D-13: no departure; DEP-3 is a pinned no-op unreachable on every
supported zone).

---

## 0. Decisions this plan takes (read first)

**D-1 — what a DECISION is (moves to a system).** Any of, over domain
values (entities, slices, brands, stored SCREAMING tags, counts and money
the domain owns):

1. a **state choice** with precedence between domain states (a pass is
   `FROZEN` before `OWES` before `EXPIRING`; a tile is hollow before
   upcoming before past);
2. **what is owed or earned** — a sum, difference, min/max, clamp or
   ratio over domain values (the bill vs a share, a voucher total, a ring
   fraction, what remains to a level);
3. **qualification / eligibility** — a predicate combining domain facts
   (a whole party, a clean record, a booker's own words, can still move);
4. **which items exist or are hidden** by a domain rule (which wallet
   discs, which marks, which records are held, which families an ended
   season keeps);
5. an **ordering or grouping rule** over domain items (soonest first,
   shelf order, acts-first then closest, by closing year);
6. a **threshold** other than the zero form (≥ 2 no-shows, the 7-day
   birthday notice, `> 1` locations) — a floor that only spares a
   redundant word (the month heading's «1 посещение» over its one row) is
   display policy, D-2.4;
7. a **duplicated rule constant** (`EARLY_BIRD_LAST_MINUTE`,
   `NEW_RECORD_DAYS`, `RECORD_ORDER`, `'9999-12-31'`, `'series-welcome'`,
   `CHANGE_ORDER`).

**D-2 — what is WORDING (stays in the presenter).**

1. **tag → word tables** and narrowing on a system's tag to pick words,
   icons, tones or DS tokens (`MEDAL_STATES`, `streakPeriodMarkWords`, the
   FreezeReason sentence ladder);
2. **the zero form of ONE system-given count** — `n === 0` / `n > 0` on a
   single count to omit a cell, print «никой» or a first-visit sentence
   (history's no-show cell, records' `lifetimeVisitsCompleted > 0` rows,
   `others > 0 → «още N»`, `peers > 0`). A test that COMBINES facts, or any
   other threshold, is D-1;
3. **form choices** for a value already decided: one figure vs a range
   when `min === max`, the sign glyph of a negative balance, the year shown
   outside today's year, weekday vs date face from `withinWeek`, plural
   agreement, joins, capitalisation, first names, `Math.abs` for agreement;
4. **display caps and layout** — `RAIL_LIMIT`, `CLOSE_LIMIT` (passed into
   the system as a `limit`), the month heading's figure floor
   (`visit-sections.ts` `atLeast = 2`, passed into
   `VisitListSystem.workedFigure` as today), `SECTION_FOLD_OVER`, `capsulesRun`'s 4 / 3 +
   «+N», `PHOTO_RAIL_LIMIT`, the waitlist «още N» past 3, the five activity
   rows, `PENDING_RING` geometry, `Math.max(1, total)` divide guards;
5. **host catalogue lookups** — a name, cover or URL the host contract
   (`ClientCardCatalog`, `VisitLookup`) does or does not answer (no name →
   no row): display data presence, never a domain rule;
6. **UI read-state** — `LoadSlice`/`LoadState`/`PagingState`
   (`@creativo/shared/view-state`, which ecs-core cannot import), `online`,
   `settled`, `statsKnown`, the current/selected appointment, the surface
   (`staff`, slot `LAST`/`NEXT`, `markNew` placement), the viewer's
   permission flags (`clientWords`, R15);
7. **feature-flag gating of a whole section** (composition). Where a flag
   COMBINES with a domain rule (rhythm on = flag ∧ rule in force ∧
   enabled), the system takes the flag as a boolean input — the
   `ClientGlanceSystem.holdings` precedent;
8. **boundary parsing** — `LocalDate.parse` of a raw `today` string, the
   `CustomerId.of` of a raw option, `shopDayOf(instant, zone)` turning a
   stamp into a shop day (Law 7: systems are zone-blind — the presenter
   converts and hands the system a `LocalDate`). The raw `nowMs`/`today`
   threads themselves are the Law 7.4 T1 pass (HANDOFF §3.3), not this one.

**D-3 — borderline rows ruled** (every other row follows D-1/D-2):

| Row                                                                                                                           | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Why                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formatDurationRange` `min === max` (catalog:182)                                                                             | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | form choice (D-2.3)                                                                                                                                                                                                                          |
| `visit-sections.ts` floor `atLeast = 2`                                                                                       | STAYS (revised)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | display policy (D-2.4): it spares «1 посещение» over the one row that already says it (visit-sections.ts:61-79); the system already takes the floor as an input (`workedFigure(rows, atLeast)`), like `CLOSE_LIMIT`                          |
| the glance's current appointment excluded from the upcoming list (gl:501) and from the featured visit (cc:381)                | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | D-2.6 — the visit on screen is UI read-state, and `context.appointmentId` is a raw `string` (T1 thread) a system may not take (Law 7.4); the presenter drops it before calling the system                                                    |
| visit-card `amountOf` reading `row.trailingFact` back (card:271)                                                              | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | it re-reads the row's worded figure, which the row takes from the new `subjectFigure`; switching to the system directly would print a figure on a card whose row is the current visit (the row prints «Този час» there) — a behaviour change |
| visit-card waitlist days from `row.lines.at(-1)` (card:246)                                                                   | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | wording reuse of the row's line                                                                                                                                                                                                              |
| waitlist day runs, the weekday face only when BOTH ends are `withinWeek`, cap 3 (row:623)                                     | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `dayRuns`/`withinWeek` already systems; face and cap are D-2.3/D-2.4                                                                                                                                                                         |
| the title / waitlist services `distinct` over looked-up NAMES (row:307, :603)                                                 | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | name-level dedupe of display text; moving it to ids changes output when two ids share a name                                                                                                                                                 |
| `visitZoneOf` (row:269)                                                                                                       | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | lookup plumbing (D-2.8)                                                                                                                                                                                                                      |
| `wallet` `openPeriod` reading `input.inChairToday` (wallet:786, :823)                                                         | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | the presenter reads the same INPUT the system read to pick a caption; re-tagging `StreakSystem.track` would change an existing system output                                                                                                 |
| `wallet` `walletActivity` `whole = entries.length < WALLET_ACTIVITY_READ`, ledger `whole = next === null`                     | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | paging facts of the read (D-2.6), not a domain judgement                                                                                                                                                                                     |
| ledger `activityGroups` dropping an empty month (ledger:537), `textOf` (ledger:74), `reversalDraft`'s day lookup (ledger:266) | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | presence of a system answer / label-param normalisation / a lookup                                                                                                                                                                           |
| `achievements` `artOwnersOf` face ownership (ach:554), face-clash rank (ach:1012)                                             | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | visual distinctness of discs (D-2.4)                                                                                                                                                                                                         |
| `medals` «Сезони» chip existence (medals:754)                                                                                 | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ORs two system answers (`windowsOn`, `archivedFor`) for navigation                                                                                                                                                                           |
| `medal-detail` `rewardOf` PERK filter (md:872)                                                                                | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | worded by `awardKind` tag                                                                                                                                                                                                                    |
| `records` `THEMES` grouping, featured-excluded-from-group (rec:519)                                                           | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | page layout of vm rows; the rhythm gate reads the system verdict                                                                                                                                                                             |
| `records` `firstVisit` source precedence (rec:377) and `featuredOf`'s printability filter (rec:143)                           | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | both hang on `recordCardVm` returning null on a host lookup (D-2.5); moving them half would change which source wins (§7 R-9)                                                                                                                |
| `records` «Ритъм сега» `current > 0`, `lifetimeVisitsCompleted > 0` rows                                                      | STAYS (zero form, D-2.2)                                                                                                                                                                                                                                                                                                                                                                                                                                                              | the rhythm-on half MOVES (`StreakRuleSystem.isOnOn`)                                                                                                                                                                                         |
| `history` `historyCells` `> 0` cells, `visitsPaging` `visits === 0` end label                                                 | STAYS (zero form)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `cadenceWeeks` and the CLEAN note MOVE                                                                                                                                                                                                       |
| `history` `HISTORY_PAGE_SIZE`/`FILTER_REFILL_*` constants (hist:31)                                                           | STAYS this pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | read policy, not a view decision — carried (§8 OQ-6)                                                                                                                                                                                         |
| `client-card` `photoRailVm` exclusion + cap (cc:424), `capsulesRun` (cc:216)                                                  | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | UI selections + layout                                                                                                                                                                                                                       |
| `client-card` `isInChairToday` open predicate, `pauseOf`/`isBirthdayToday` wrappers                                           | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | already system verdicts behind a boundary parse                                                                                                                                                                                              |
| `glance` `medalsGlanceVm` absent when `earnedLevelCount === 0`                                                                | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | presence of a system answer                                                                                                                                                                                                                  |
| `glance` `pointsSentence` held-rewards filter by display NAME (gl:694)                                                        | STAYS as the caller's pre-filter                                                                                                                                                                                                                                                                                                                                                                                                                                                      | a RewardId key is a store-contract change — carried (§8 OQ-4); the reach choice MOVES                                                                                                                                                        |
| `loyalty` `ticketRefOf` group key from display words (loy:312)                                                                | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | a domain key needs a coupon id on `ClientCardGrant` — carried (§8 OQ-4)                                                                                                                                                                      |
| `loyalty` `ruleInForceOf`/`rhythmStateOf`/`offered`/`groupedGrants`                                                           | STAY as delegates                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | already system calls behind a parse                                                                                                                                                                                                          |
| `rhythm-rule.words` `graceDays > 0` clause (rr:212)                                                                           | STAYS (zero form)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |                                                                                                                                                                                                                                              |
| `admin-rhythm.words` `historyRow` publish-date-equals-effective-date, `withdrawn` (ar:673, :691)                              | STAY                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | say-the-date-once wording; presence of a stamp                                                                                                                                                                                               |
| `admin-rhythm.words` the `*Enabled` on/off rows                                                                               | STAY                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | do NOT switch them to `StreakRuleSummary` (§7 R-14)                                                                                                                                                                                          |
| `client-card.format.ts` `daysBetweenDays`/`dayPlus`                                                                           | STAY                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | enablers; `dayPlus` becomes dead after M-12 — the integrator deletes it only if no reader is left; `daysBetweenDays` is pinned by `client-card.words.spec.ts:1600`                                                                           |
| `client-pages.vm.ts` `WalletHolding`                                                                                          | STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | a section id in layout order                                                                                                                                                                                                                 |
| `client-pages.vm.ts` `BirthdayMoment`                                                                                         | MOVES to `@core/components` (`birthday-moment.data.ts`); the vm binds AND re-exports it — `import { BirthdayMoment } from '@core/components'; export { BirthdayMoment };` (a bare `export … from` binds nothing locally, and the file itself uses `BirthdayMoment.Today/Upcoming` in `birthdayMomentWords` and the type in `BirthdayVm`, client-pages.vm.ts:494-512) — so `client-card.store.spec.ts:110` keeps its import line and `birthdayMomentWords`/`BirthdayVm` stay untouched |
| the service-detail sheet's performer sort and bundle saving (`service-detail-sheet.component.ts:183-265`)                     | OUT OF SCOPE                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Angular component math, not a presenter — carried (§8 OQ-3). The catalog's anonymous offering (catalog:120) therefore STAYS: the sheet's saving reads it for an unperformed bundle                                                           |

**D-4 — systems extended, never copied (REUSE, NEVER COPY).** Every
decision lands in the system that already owns its concept; a new system
file exists only where no system owns the concept: `LoyaltyPassSystem`
(the pass — the canonical example of `presenters.md`), `WalletSystem` (the
wallet's discs and its write gate). The stamp card's clamp is helper math
of its own component: `PunchCard.progress` joins a NEW companion in the
existing `components/punch-card.data.ts` (Law 1 — the type has no
companion yet), never a `PunchCardSystem` file
(`ClientGlanceSystem.holdings` keeps its own `[0]` pick).
Extended: `VisitStorySystem`, `VisitListSystem`, `WaitlistSystem`,
`CatalogPricingSystem` (no change — reused from the content service),
`VoucherSystem`, `RewardSystem`, `TierSystem`, `LedgerSystem`,
`StreakSystem`, `StreakRuleSystem`, `RhythmDraftSystem`,
`StreakPreviewSystem`, `StreakPublishSystem`, `BadgeSystem`,
`StandingSystem`, `AchievementsSystem`, `SeasonSystem`,
`LoyaltyCatalogSystem`, `RecordsSystem`, `ClientStatsSystem`,
`ClientGlanceSystem`, `AgeSystem`, `CouponGrantSystem`, `PhoneSystem`;
component companions `ServiceComposition`, `Gamification`, `PunchCard`
(new).

Where a rule already exists in ecs-core, the new function COMPOSES it —
each contract of §2 names its reuse in a "composes" comment and its JSDoc,
and §5 check 6 greps that the named call appears in the new function's
body: `VoucherSystem.heldTotal` → `spendableSum`; `RewardSystem.pointsReach`
→ `bestAffordable`/`nextAffordable`; `RecordsSystem.yearsOfHistory` →
`RecordsSystem.years`; `AgeSystem.birthdayMoment` → `nextBirthday`;
`ClientGlanceSystem.repeatOffer` → `sameLegs`;
`VisitStorySystem.peerCountOf` → `peerCount`/`personKeyOf`;
`LoyaltyCatalogSystem.rhythmLive` → `StreakRuleSystem.isOnOn`;
`StreakSystem.outlook`'s weeks → `ClientStatsSystem.cadenceWeeks` (the one
home of `max(1, round(days/7))`); `StandingSystem.recentFreshLevelsByDay`
→ `recentLevelsByDay`; `StandingSystem.stripCue` →
`BadgeSystem.nextLevelNumber` + `StandingSystem.isNewSince`;
`VoucherSystem.held` and `soonestFirst` share one private by-last-day core.

**D-5 — additive only.** No existing system function changes its
signature or its output (their specs pin outputs with `toEqual`, e.g.
`visit-story.system.spec.ts:612` on `subjectStory`). Extensions are NEW
functions or NEW constants; a private helper may be exported (ledger's
`voidedIds`) or shared by an internal refactor that keeps every existing
output byte-identical (`statWindows` sharing a core with
`statWindowsOnDay`). No field is added to an existing returned struct
(`SubjectStory`, `SeriesStanding`, `TierProgress`, `StreakTrack`), no
value to an existing dictionary (`MedalState`, `StreakTrackMarkKind`).

**D-6 — exact ports, not look-alikes.** A moved decision is the
presenter's code ported onto branded inputs, line for line. Where the scouts
found a similar existing function that is NOT equivalent, the new function
sits beside it and its JSDoc names the difference: `completesWithVisit` ≠
`AchievementsSystem.countsToward`; `TierSystem.plate` ≠
`TierSystem.progress`; `VoucherSystem.heldTotal` ≠ the glance's
`ClientGlanceSystem.holdings` voucher sum; `StandingSystem.windowFamilies`
/ `neighboursOf` ≠ `familiesIn(SEASON)`; the rhythm outlook takes
`standingOf`'s live semantics, never `rhythmStateLine`'s dead branches
(§7 lists each).

**D-7 — new tag dictionaries are components.** Each new SCREAMING
dictionary is an `as const` object + type in
`libs/ecs-core/src/components/<name>.data.ts`, its field name
domain-prefixed (Law 6), no bare literal at a use site. A component never
imports a system-tier dictionary (`VisitRowOutcome`, `CancelledSide`,
`StreakTrackMarkKind` live in system files): the new dictionaries stand
alone. No new error is expected; if one is, it goes in
`libs/ecs-core/src/errors/<domain>.error.ts`.

**D-8 — systems return values, brands and tags — never words.** No
`string` result that a screen prints; counts, `LocalDate`, `Money`, ids,
fractions and tags only. Display caps arrive as a `limit` argument.

**D-9 — the presenter's exported surface is frozen.** Every function,
constant and type a spec, store, component, fixture or barrel imports from
a presenter or words file keeps its name and signature (string `today`
included) and becomes a thin delegate where its body moved:
`ringValueOf`, `shelfOrdered`, `completesWithThisVisit`, `countsToward`,
`detailActionOf`, `rhythmLiveOf`, `recordSetOn`, `isNewRecord`,
`recordsOf`, `isOneOff`, `isSingleLevel`, `latestEarned`, `earnedOnOf`,
`inEndedSeason`, `landsOn`, `soonSeriesIds`, `newestFaceLevel`,
`previousVisitOf`, `cadenceWeeks`, `effectiveReading`, `signedDelta`,
`changeWord`, `historyRows`, `visitsRows`, `servicePriceFrom`,
`serviceDurationRange`, `PENDING_RING`, `NEW_RECORD_DAYS`, `RECORD_ORDER`,
`CLOSE_LIMIT`, `SECTION_FOLD_OVER`, `CHIP_ALL`, `CHIP_SEASONS`, … The one
deletion: `servicesByBarber` (presenter + the landing re-export), whose only
caller (`team-showcase.component.ts:149`) moves to the content service; no
spec imports it.

**D-10 — the catalog view model carries the system's answers.**
`serviceToVm` holds the `Service` entity: it calls `CatalogPricingSystem`
ONCE and puts the answers on `ServiceVm` as REQUIRED plain fields
(`priceFrom`, `cardPrice`, `minutesRange`, EUR major units / minutes).
`servicePriceFrom` / `serviceDurationRange` read them; `serviceMeta` reads
`cardPrice`; both `pricedOf` shims (catalog.presenter.ts:312,
catalog-presenter.service.ts:93) and their `sure`/`termsOf`/`toMinor`
helpers, the `POSITIVE_INFINITY` sentinel, the `{0,0}` range and the
`{cheapestCents: 0, spread: false}` fallback are deleted. No dual shape:
the hand-authored landing `SERVICES` list (production code, only read by
`test-catalog.providers.ts`'s `serviceFromVm` and one spec's `.find` by id)
is retyped to a new source type without the figures; the five hand-built
`ServiceVm` literals in two COMPONENT specs gain the three fields with the
values the old shim computed — fixture data only, no expectation changes
(§4.3, §8 OQ-1).

**D-11 — `today` and zones stay at the presenter edge** (D-2.8). A
presenter that tolerated a bad `today` keeps tolerating it at its parse
(`spendableOf`'s "unparseable today → no vouchers"; `holdingsOf`'s
epoch-0 sentinel), then calls the system with a `LocalDate`. The AT_RISK
"weeks since the last visit" needs the last counted visit's shop day: the
presenter converts `lastQualifiedAtUtcMs` with `shopDayOf(…, zone)` and
passes `lastQualifiedOn: LocalDate | null`.

**D-12 — `client-card.store.ts` calls the wallet gate.** The store's
`rewardsUsable` (store:862, owner ∧ online ∧ ¬gone ∧ ¬paused) is the same
rule as the presenter's `canWrite`: both call `WalletSystem.writable`. The
presenter keeps calling its gate too (its specs feed `usableGrants`
directly, `wallet.presenter.spec.ts:601/741/1850/1873`).

**D-13 — frozen behaviour, no departure.** Every presenter spec passes
UNCHANGED except a re-targeted import line; every system spec keeps its
existing cases. The pass is briefed BEHAVIOUR IS FROZEN, so the two
tie-break departures an earlier draft accepted by its own default are
WITHDRAWN (revision of 2026-10-23), each without a second copy of a rule:

- **DEP-1 (withdrawn)** — the wallet's vouchers keep their tie order.
  `VoucherSystem.held(vouchers, today, idOrder)` owns the spendable filter
  and the by-last-day order (never-expiring last — the `'9999-12-31'`
  sentinel lives once, in the private core `soonestFirst` shares, its
  output byte-identical, D-5); the equal-day tie-break is a comparator
  PARAMETER (the `nextId`/`hash` precedent): the wallet passes its
  locale collation `(a, b) => a.localeCompare(b)` — locale-dependent, so it
  can never live in a system — and `soonestFirst` passes the code-unit
  order it has today.
- **DEP-2 (withdrawn)** — the glance's «next visit» keeps input order on
  equal starts: `VisitListSystem.upcomingSoonestFirst` is a STABLE sort on
  (localDate, startMinutes) only — the list's private `byStart`, without
  `byId` — and its JSDoc names the difference from the list's
  `soonestFirst` (which adds the id tie-break).
- **DEP-3 (pinned no-op)** — records' 12-month row (G-5) today goes
  through `ZonedTimeSystem.toUtc(day, 23:59, zone)` and is omitted when
  23:59 falls in a DST gap; `statWindowsOnDay` always yields the row. No
  supported zone has a transition at 23:xx (Europe/Sofia moves at
  03:00/04:00), so the difference is unreachable; recorded, spec'd as "not
  exercised" in §6.3, and not a behaviour change on any screen.

Everything else is byte-identical; the integrator proves it with the §6.3
smoke against a HEAD copy of `fd5f2a6`.

**D-14 — waves.** Wave 0 (ALONE) is ecs-core only: every new and extended
system, the component dictionaries and their specs, in six packages with
DISJOINT files (§3); no feature file changes. Wave 1 re-points the
presenters in six packages with disjoint files. The integrator (G) owns the
gate, the review checklist, the smoke and the ledger.

---

## 1. The decision inventory (re-verified on `fd5f2a6`)

Legend — **MOVE** (target function, §2 contract) · **DUP** (a copy of an
existing system rule/constant: delete, call the system) · **STAYS** rows
are ruled in D-2/D-3 and not repeated here. Spec hints are `spec:line`
in the subject's own spec unless named. "Port" = the system spec re-states
each listed presenter case as a value/tag assertion.

### 1.1 Catalog (`libs/features/shared/catalog/src/lib/content/`)

| ID  | file:line                                                 | Decision                                                                                                                                                                                           | Target                                                                                                                                                                                                                                                            | Pinned by                                                                                                               |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| C-1 | catalog.presenter.ts:312, catalog-presenter.service.ts:93 | `pricedOf` reverse-maps the VM to `CatalogPriced` (zero-inbound-mapping violation; hidden rules: the service's terms = first offering's base, variants = declared ∪ `byVariant` keys) — two copies | DUP → D-10: `serviceToVm` calls `CatalogPricingSystem.priceFrom`/`cardPrice`/`durationRange` on the `Service`; both shims deleted                                                                                                                                 | catalog-pricing.system.spec.ts (existing); service-tile, service-detail-sheet, service-row component specs; landing e2e |
| C-2 | catalog.presenter.ts:194                                  | `servicePriceFrom` → `POSITIVE_INFINITY` for a VM with no offering (an ordering sentinel)                                                                                                          | reads `vm.priceFrom` (= `CatalogPricingSystem.priceFrom(service)/100`, never empty for a `Service`)                                                                                                                                                               | as C-1                                                                                                                  |
| C-3 | catalog.presenter.ts:256                                  | `serviceDurationRange` → `{0,0}` with no offering                                                                                                                                                  | reads `vm.minutesRange` (= `durationRange`)                                                                                                                                                                                                                       | as C-1                                                                                                                  |
| C-4 | catalog-presenter.service.ts:56                           | `serviceMeta` fallback `{cheapestCents: 0, spread: false}`                                                                                                                                         | reads `vm.cardPrice` (= `cardPrice`)                                                                                                                                                                                                                              | client-onboarding, booking services step (component)                                                                    |
| C-5 | catalog.presenter.ts:239                                  | `servicesByBarber`: filter `offerings.length > 0`, then `indexOf` back-map                                                                                                                         | DUP → `LandingContentService.barberPrices(barberId)` = `CatalogPricingSystem.servicesByBarber(domainShelf, BarberId)` over the DOMAIN services whose ids the shelf holds (same set, same order), entries mapped to `{ service: vmById, terms: termsVmOf(terms) }` | catalog-pricing.system.spec.ts:87-91; team-showcase component spec / e2e                                                |
| C-6 | catalog.presenter.ts:106                                  | `UNSPECIFIED` composition draws as `SINGLE`                                                                                                                                                        | `ServiceComposition.drawnKind(kind)` (component companion)                                                                                                                                                                                                        | catalog-content.service.spec.ts                                                                                         |

### 1.2 Visits (`libs/features/shared/visits/src/lib/`)

| ID   | file:line                                                            | Decision                                                                                                                                 | Target                                                                                                                                                                                                                                                                                      | Pinned by                                                                                                            |
| ---- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| V-1  | visit-row.presenter.ts:303, :342-346, :362                           | `hollow` = CANCELLED ∨ NO_SHOW; tone precedence hollow > upcoming > past; `struck: hollow`                                               | `VisitStorySystem.toneOf(outcome, start, now): VisitTone` (+ `isVoid(outcome)` for `struck`)                                                                                                                                                                                                | row 293, 388, 412; client 895 (`visits-page` "strikes an hour that did not happen" is a BASELINE red — do not "fix") |
| V-2  | visit-row.presenter.ts:318 (+ :502-517), visit-card.presenter.ts:141 | status mark: NO_SHOW → noShow; OPEN ∧ PENDING → pending; card adds OPEN ∧ CONFIRMED                                                      | `VisitStorySystem.statusMark(outcome, bookingStatus): VisitStatusMark \| null` — NO_SHOW / PENDING / CONFIRMED only; the row keeps `cancelledWord` as its else-branch, the card keeps its OPEN/NEXT surface gate (§2.1 proves the equivalence)                                              | row 433, 388, 293, 895, 1045; card 237, 343, 354, 384, 451                                                           |
| V-3  | visit-row.presenter.ts:355                                           | upcoming row files under `UPCOMING_SECTION_KEY`, else `visitSectionKey`                                                                  | `VisitListSystem.rowSectionKey(upcoming, localDate, grain)`                                                                                                                                                                                                                                 | row 412, 447; visit-sections 81                                                                                      |
| V-4  | visit-row.presenter.ts:410                                           | `alone` = the story covers every seat                                                                                                    | `VisitStorySystem.isWholeParty(appointment, story)`                                                                                                                                                                                                                                         | row 515, 597, 767; card 289, 627                                                                                     |
| V-5  | visit-row.presenter.ts:460, :742                                     | the figure: only WORKED/CANCELLED carry one; whole party → bill total (discounts off), share → own seats' subtotal; null on a bill error | `VisitStorySystem.subjectFigure(appointment, story): Money \| null` (reuses `BillingSystem.evaluate`/`subtotalOf`) — `priceOf` deleted, the presenter formats                                                                                                                               | row 235, 293, 388, 412, 515; card 173, 304, 627                                                                      |
| V-6  | visit-row.presenter.ts:519                                           | which marks: only WORKED; PHOTOS when `photoCount > 0`; DISCOUNT when whole ∧ discounts; VOUCHER when whole ∧ a live redemption          | `VisitStorySystem.marksOf(appointment, story, photoCount): readonly VisitMark[]` in that order; the `words.voucher !== undefined` guard STAYS (spec 791)                                                                                                                                    | row 235, 597, 723, 745, 767, 791                                                                                     |
| V-7  | visit-row.presenter.ts:548                                           | the quote: note present ∧ `ownerUserId === subjectUserId` (the booker's words)                                                           | `VisitStorySystem.quotesBooker(appointment, subjectUserId)` = `contactNote !== null ∧ subjectUserId !== null ∧ ownerUserId === subjectUserId` (the null guard kept: an unclaimed party has `ownerUserId: null`, party.data.ts:41); `clientWords !== false` STAYS (viewer permission, D-2.6) | row 235, 614, 838; card 203, 478                                                                                     |
| V-8  | visit-row.presenter.ts:415, visit-card.presenter.ts:124              | the shop named only for WORKED with `locationCount > 1` — two copies                                                                     | `VisitStorySystem.namesShop(outcome, locationCount)`; the card keeps `staff ∧ last`                                                                                                                                                                                                         | row 280; card 282                                                                                                    |
| V-9  | visit-row.presenter.ts:312, visit-card.presenter.ts:96               | the subject's barbers, distinct in first-seat order — two copies                                                                         | `VisitStorySystem.subjectBarberIds(appointment, story)`                                                                                                                                                                                                                                     | row 647, 681, 930; card 390                                                                                          |
| V-10 | visit-row.presenter.ts:716                                           | the subject record: host-named id, else the ACCOUNT seat's `subjectCustomerId` for `subjectUserId`, else null                            | `VisitStorySystem.subjectRecordOf(appointment, named, userId)`; the `CustomerId.of` parse of the raw option STAYS                                                                                                                                                                           | row 515, 565; card 289                                                                                               |
| V-11 | visit-row.presenter.ts:760                                           | `peersOf`/`personSubjectOf` map seats → `PersonSubject` + an identity `own[]` before `peerCount`                                         | `VisitStorySystem.peerCountOf(appointment, story)` (person key from the seat itself, reusing `personKeyOf`)                                                                                                                                                                                 | row 515, 565; visit-story peerCount cases                                                                            |
| V-12 | visit-row.presenter.ts:597                                           | waitlist days ahead: `localDate >= today` (raw string compare), none ahead → all; unparsable today → all                                 | `WaitlistSystem.daysAhead(days, today: LocalDate \| null)` (`LocalDate.compare`)                                                                                                                                                                                                            | row 1149, 1115; card 576                                                                                             |
| V-13 | visit-row.presenter.ts:935                                           | dayparts: none when no days or ANY day whole; else `Daypart.touchedBy`                                                                   | `WaitlistSystem.daypartsWatched(days)`                                                                                                                                                                                                                                                      | row 1211                                                                                                             |
| V-14 | visit-row.presenter.ts:652                                           | waitlist sort point: first watched day at minute 0; none → epoch day 0 (`WAITLIST_UNDATED`)                                              | `WaitlistSystem.sortPoint(days): WallTime`                                                                                                                                                                                                                                                  | row 1255                                                                                                             |
| V-15 | visit-sections.ts:73                                                 | month heading figure from 2 up (default `atLeast = 2`)                                                                                   | STAYS (revised — D-2.4/D-3: display policy passed into `VisitListSystem.workedFigure` as `atLeast`, like `CLOSE_LIMIT`); no ecs-core change                                                                                                                                                 | visit-sections 258, 281, 306; visit-list 537; visits-browser 264                                                     |

### 1.3 Wallet, ledger, loyalty (`libs/features/staff/client-card/src/lib/`)

| ID   | file:line                                                                  | Decision                                                                                                                                                                                                                                                                                                                                                                                                    | Target                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Pinned by                                                                  |
| ---- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| W-1  | wallet.presenter.ts:194-217                                                | pass state: paused → FROZEN; points off → none; balance < 0 → OWES; balance > 0 ∧ noticeFrom ≤ today ≤ expireOn → EXPIRING; else none                                                                                                                                                                                                                                                                       | `LoyaltyPassSystem.passOf(account, view)` → `passState`                                                                                                                                                                                                                                                                                                                                                                                                                            | passVm 305, 317, 346, 365; walletVm 1850, 1892, 1921                       |
| W-2  | wallet.presenter.ts:233-269                                                | the figure: points off → `tierQualifying` (VISITS), else balance (POINTS); spendable = `max(0, balance)` (also :1055)                                                                                                                                                                                                                                                                                       | same call: `figure`, `passFigure`, `spendable`, `owed`, `lapsing`, `lapsesOn`                                                                                                                                                                                                                                                                                                                                                                                                      | passVm 278, 292, 305, 365; walletVm 1586                                   |
| W-3  | wallet.presenter.ts:182, :906                                              | a tier plate/ring only with tiers in the catalogue; which tier (override honoured) — two copies of the empty rule                                                                                                                                                                                                                                                                                           | `TierSystem.standingTier(state, tiers): TierId \| null`; the flag and catalogue-ready gates STAY (D-2.6/7)                                                                                                                                                                                                                                                                                                                                                                         | passVm 278, 398, 412; walletTierVm 1419                                    |
| W-4  | wallet.presenter.ts:289-356, :465                                          | spendable vouchers then a COPY of `soonestFirst` (`NEVER` sentinel, `localeCompare` ties)                                                                                                                                                                                                                                                                                                                   | `VoucherSystem.held(vouchers, today, idOrder)` — spendable, by last day (never-expiring last) through the core `soonestFirst` shares, equal-day ties by the CALLER's `idOrder` (the wallet passes its `localeCompare` collation — tie order unchanged, DEP-1 withdrawn); `NEVER` + the sort deleted; the bad-today → `[]` stays at the parse (D-11)                                                                                                                                | voucherVms 450, 485, 501; walletHoldings 516                               |
| W-5  | wallet.presenter.ts:318                                                    | untouched voucher = balance equals initial value                                                                                                                                                                                                                                                                                                                                                            | `VoucherSystem.untouched(voucher)`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | voucherVms 463; walletVm 1586                                              |
| W-6  | wallet.presenter.ts:460-477                                                | the holdings sum: spendable balances, two currencies → none, shown only from 2 held                                                                                                                                                                                                                                                                                                                         | `VoucherSystem.heldTotal(vouchers, today): Money \| null` — null below 2 spendable vouchers or with 2+ currencies (NOT the glance rule), else `spendableSum(vouchers, today, first.currency)`; it decides ONLY whether a total exists and its Money. The printed count stays `holdings.length` — every wallet holding, tickets and stamp cards included (wallet:476; spec 1745 pins «4 · 55,00 €» with 2 vouchers) — the section's own layout count (D-2.4), never a voucher count | walletVm 1719, 1732, 1759                                                  |
| W-7  | wallet.presenter.ts:366, :482; client-card.store.ts:862                    | tickets shown when owner ∧ ¬paused; writable when owner ∧ ¬gone ∧ online ∧ ¬paused — store copy                                                                                                                                                                                                                                                                                                             | `WalletSystem.ticketsShown(view)`, `WalletSystem.writable(view)`; the store calls `writable` (D-12)                                                                                                                                                                                                                                                                                                                                                                                | walletHoldings 601; walletActions 741; walletVm 1850, 1873                 |
| W-8  | wallet.presenter.ts:490-547                                                | which discs, in order: USE (writable ∧ ≥1 ready group; one grant id vs a count when > 1), CODE (writable), CATALOG (points ∧ catalogue stands), HISTORY (points)                                                                                                                                                                                                                                            | `WalletSystem.actions(view): WalletActions`; the tag → `'use'`/`'code'`/`'catalog'`/`'history'` id/icon/label/prominence table lives in wallet.presenter.ts                                                                                                                                                                                                                                                                                                                        | walletActions 670, 711, 734, 741, 749, 759, 776; walletVm 1785, 1850, 1873 |
| W-9  | wallet.presenter.ts:555                                                    | the catalogue section stands when Ready and something is offered and takeable                                                                                                                                                                                                                                                                                                                               | the domain half = `RewardSystem.tiles(...).length > 0`; the `LoadSlice` half STAYS                                                                                                                                                                                                                                                                                                                                                                                                 | walletActions 759; walletVm 1836                                           |
| W-10 | wallet.presenter.ts:993-1037, :1056                                        | reward tiles: offered today, keep where `affordable` ≠ null, within reach first then catalogue order; the within-reach count                                                                                                                                                                                                                                                                                | `RewardSystem.tiles(rewards, balance, today): RewardTiles` (`tiles`, `withinReach`); the cover lookup STAYS (host map)                                                                                                                                                                                                                                                                                                                                                             | rewardTiles 1443, 1478, 1499, 1522, 1544, 1574; walletVm 1586, 1836        |
| W-11 | wallet.presenter.ts:396-416                                                | stamp card: filled clamped to [0,size], left = max(0, size − filled), the sentence's count = max(1, left)                                                                                                                                                                                                                                                                                                   | `PunchCard.progress(card)` — a NEW companion on the existing `components/punch-card.data.ts` (Law 1, D-4); the flag gate STAYS (D-2.7)                                                                                                                                                                                                                                                                                                                                             | walletHoldings 627, 640; walletVm 1785                                     |
| W-12 | wallet.presenter.ts:843; glance.presenter.ts:627; records.presenter.ts:115 | the rhythm counts: flag ∧ rule in force ∧ enabled (∧ a held state for the wallet) — three copies                                                                                                                                                                                                                                                                                                            | `StreakRuleSystem.isOnOn(head, today, flag): boolean`; `StreakState.find` stays a component lookup. Records' copy reads NO flag — the store folds `loyalty.streaks` into `rhythm === null` — so records calls `isOnOn(input.rhythm, today, true)`; only the wallet and the glance pass `flags.streaks`                                                                                                                                                                             | walletRhythmVm 1296; glance 1221; records 487, 496-529                     |
| W-13 | wallet.presenter.ts:590-684 + loyalty.presenter.ts:187-240                 | the rhythm standing machine: paused; in chair / not started (`current > 0 ∨ lastQualifiedAtUtcMs ≠ null`); FROZEN; BROKEN repairable (`phaseRepairableUntil ≥ today`) vs final; held (`heldByAppointmentId ≠ null`); ACTIVE (due / none); AT_RISK (weeks = max(1, round(days/7)) — through `ClientStatsSystem.cadenceWeeks`, G-1's one home of the rule); IN_GRACE; the capsule and its urgency; `dueNamed` | `StreakSystem.outlook(state, view): StreakOutlookAnswer` — `standingOf`'s live path; `rhythmStateLine`'s dead paused/FROZEN/BROKEN branches are NOT ported (§7 R-6)                                                                                                                                                                                                                                                                                                                | walletRhythmVm 810, 878, 904, 929, 965, 999, 1121, 1152                    |
| W-14 | loyalty.presenter.ts:170-173; wallet.presenter.ts:871                      | due = in-chair due ?? `dueBy`; best shown only when `best > current` — two copies                                                                                                                                                                                                                                                                                                                           | `StreakSystem.record(state): number \| null`; `nextDue` in the outlook answer, GATED: `dueNamed ? (inChairDue ?? dueBy) : null` (wallet:863-868 passes `dueBy: null`/`inChairDue: null` unless `dueNamed` — a paused, FROZEN, BROKEN, HELD or not-started line has no «следващото до …»). `rhythmLabel` keeps its own reading of the arguments its other callers pass                                                                                                              | walletRhythmVm 810, 929, 1167                                              |
| W-15 | wallet.presenter.ts:875                                                    | protections shown when the rule grants them ∧ `freezesBanked > 0`                                                                                                                                                                                                                                                                                                                                           | `StreakSystem.protectionsHeld(state, summary): number \| null`                                                                                                                                                                                                                                                                                                                                                                                                                     | walletRhythmVm 1177                                                        |
| W-16 | wallet.presenter.ts:881                                                    | `upcoming.effectiveFromLocalDate > today` re-derives `StreakRuleSystem.upcomingOn`                                                                                                                                                                                                                                                                                                                          | DUP → delete the comparison                                                                                                                                                                                                                                                                                                                                                                                                                                                        | walletRhythmVm 1276                                                        |
| W-17 | wallet.presenter.ts:906-933                                                | ring: top when `next === null ∨ remaining === null ∨ atTop` (redundant), kept-at figure `currentAtLeast ?? value`                                                                                                                                                                                                                                                                                           | read `TierProgress.atTop` alone (atTop ⇔ next/remaining null — tier.system.ts:127); `TierSystem.keptAt(progress)`                                                                                                                                                                                                                                                                                                                                                                  | walletTierVm 1317, 1348, 1373, 1394, 1419                                  |
| W-18 | ledger.presenter.ts:80-86, :468                                            | `voidedIds` — a COPY of ledger.system.ts's private helper; struck rows: an event is struck when ANY of its entries was reversed (`event.entries.some(e => voided.has(e.id))`)                                                                                                                                                                                                                               | DUP → export `LedgerSystem.voided(entries): ReadonlySet<JournalEntryId>`; MOVE → `LedgerSystem.isStruck(event, voided): boolean` (rowOf reads it)                                                                                                                                                                                                                                                                                                                                  | ledger 495, 720, 745                                                       |
| W-19 | ledger.presenter.ts:303-453                                                | row classification with precedence (reverses first; REDEMPTION REVERSED/EXPIRED/spent; REWARD revoked/granted; TIER; ACHIEVEMENT level `paid = delta ≠ null`; POINTS_RULE + series → LEVEL paid; else by label, default CORRECTION)                                                                                                                                                                         | `LedgerSystem.lineOf(event, leading): LedgerLineAnswer` (`ledgerLine`, `paid`, `revoked`)                                                                                                                                                                                                                                                                                                                                                                                          | ledger 544–790 (every case), 878, 914, 1063; walletVm 1617                 |
| W-20 | ledger.presenter.ts:224                                                    | welcome = `seriesId === 'series-welcome'` (a magic id)                                                                                                                                                                                                                                                                                                                                                      | `LedgerSystem.WELCOME_SERIES_ID` + `isWelcome(level)` (grep: no other presenter hard-codes it)                                                                                                                                                                                                                                                                                                                                                                                     | ledger 878                                                                 |
| W-21 | ledger.presenter.ts:572                                                    | a month's net only under ALL and POINTS feeds                                                                                                                                                                                                                                                                                                                                                               | `LedgerSystem.netsUnder(feed)`                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ledger 1008                                                                |

### 1.4 Medals and achievements (`libs/features/staff/client-card/src/lib/`)

| ID   | file:line                                                          | Decision                                                                                                                                                                                                                                                                                               | Target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Pinned by                                                                                                              |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| M-1  | achievements.presenter.ts:140                                      | `EARLY_BIRD_LAST_MINUTE` copy                                                                                                                                                                                                                                                                          | DUP → `AchievementsSystem.EARLY_BIRD_LAST_MINUTE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | completesWithThisVisit cases                                                                                           |
| M-2  | achievements.presenter.ts:274, :265; medal-detail.presenter.ts:171 | latest earned (max stamp), earned-on by level, top earned (max level)                                                                                                                                                                                                                                  | `BadgeSystem.latestEarned`, `earnedOn`, `topEarned` (delegates kept)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ach medalVm; medals medalRingVm; md state line                                                                         |
| M-3  | achievements.presenter.ts:377, :387                                | one-off / single-level family                                                                                                                                                                                                                                                                          | `BadgeSystem.isOneOff`, `isSingleLevel` (on `BadgeLevel.isOneOff`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | medals medalRingVm; md progress/ladder                                                                                 |
| M-4  | achievements.presenter.ts:396                                      | in an ENDED season today                                                                                                                                                                                                                                                                               | `LoyaltyCatalogSystem.inEndedSeason(catalog, series, today)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | medals «no arc…»; ach scopePageVm; md state line                                                                       |
| M-5  | achievements.presenter.ts:413                                      | tenure level lands on: first visit + target, else today + max(0, target − value), never before today                                                                                                                                                                                                   | `BadgeSystem.landsOn(series, standing, firstVisitOn, today)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | medals «keeps the day fraction…»; md progress 2 cases                                                                  |
| M-6  | achievements.presenter.ts:432-504                                  | completes with this visit: retired/calendar out; season only while OPEN; yearly birthday act (birthday today ∧ last earned year < this year); one short; VisitsCompleted FIRST-non-null-scope precedence service › barber › location; EarlyBird earliest leg minute ≤ 600 (scopes ignored); else false | `AchievementsSystem.completesWithVisit(series, standing, lastEarned, draft, seasonPhase, today)` — an EXACT port, NOT `countsToward` (D-6, §7 R-1). `seasonPhase` is the phase of the series' season, `null` when that season does not resolve: when `series.seasonId !== null`, ANY phase but OPEN — null included — gives false (ach:448-453); a non-seasonal series ignores it                                                                                                                                                    | ach completesWithThisVisit (4); medals medalRingVm 2, AF 2; md «С това посещение»; client-card «the medal strip (G)» 2 |
| M-7  | achievements.presenter.ts:635                                      | caption state precedence                                                                                                                                                                                                                                                                               | `BadgeSystem.captionOf(...): MedalCaption` — it receives the UNGATED `BadgeSystem.landsOn(...)` (ach:654 calls `landsOn` directly), never medalVm's meter reading `toNext === null ? null : landsOn(…)` (ach:738)                                                                                                                                                                                                                                                                                                                    | ach medalVm; medals by size; ach scopePageVm                                                                           |
| M-8  | achievements.presenter.ts:698                                      | «ново»: EARNED ∧ latest ∧ `isNewSince` (the `markNew` placement STAYS)                                                                                                                                                                                                                                 | `StandingSystem.isFamilyNew(standing, latest, previousVisitAtUtcMs)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ach, medals sections/AF/medalScopeVm                                                                                   |
| M-9  | achievements.presenter.ts:704, :722                                | to-next exists (next ∧ target ∧ ¬ended); next level falls back to highest + 1                                                                                                                                                                                                                          | `BadgeSystem.toNext(standing, ended)`, `nextLevelNumber(standing)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | ach medalVm; medals «no arc…»                                                                                          |
| M-10 | achievements.presenter.ts:728, :805; medals.presenter.ts:168       | meter (PENDING / FRACTION clamp01 / NONE); face state (pending ∧ NOT_STARTED → IN_PROGRESS); ring's fourth state COMPLETE = EARNED ∧ next null                                                                                                                                                         | `BadgeSystem.meterOf` → `MedalMeter` + fraction; `faceState(standing, pending): MedalState`; `ringState(standing, pending): MedalRingState` (MEDAL_STATES gains a separate COMPLETE table — never a `MedalState` value, D-5)                                                                                                                                                                                                                                                                                                         | ach meter cases; medals medalRingVm 4 + «no medal on anything but…»; glance «the ring's four forms»                    |
| M-11 | achievements.presenter.ts:883                                      | shelf order: band (earned, in progress, not started), within band (−highest / −value÷target), catalogue index                                                                                                                                                                                          | `StandingSystem.shelfOrdered(families, progress)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ach shelfOrdered; medals sections/AG                                                                                   |
| M-12 | achievements.presenter.ts:920; medals.presenter.ts:662-707         | acts that complete this visit first, then closest levels, dedupe, limit (soon) — and «almost»: not the season track, not the rhythm shelf while the rhythm is off, acts first, closest(∞), pending then under way, never-begun dropped, limit — one acts-first rule                                    | `StandingSystem.soonIds(...)` and `StandingSystem.almostEarned(...)` sharing one private acts-first helper; their limit orders differ on purpose (§7 R-10). «Under way» is `progress.value > 0` (medals:704), NOT `medalState !== NOT_STARTED`: an earned family with value 0 is not «almost»                                                                                                                                                                                                                                        | client-card «medal strip (G)» 4; glance «names three medals…»; medals AF 7 + rhythm-off 1                              |
| M-13 | achievements.presenter.ts:987-1043                                 | latest tiles: a family on the newest day it moved, fresh only, empty days dropped                                                                                                                                                                                                                      | `StandingSystem.recentFreshLevelsByDay(progress)` built on `recentLevelsByDay(progress, MAX_SAFE_INTEGER)`: per day BOTH `levels` (all of the day's, existing order) and `fresh` (not on a newer day, same order), days with no fresh level dropped, no day limit. The presenter keeps `levels.length === 1` for single-vs-group and `levels.length` for «+N»/`dayGroupName`, `fresh` for the face; the face-clash rank, the host lookups and RAIL_LIMIT (a TILE cap applied after them) STAY (D-2.4)                                | client-card strip; glance 2                                                                                            |
| M-14 | achievements.presenter.ts:1089; medals.presenter.ts:445            | the running season (first OPEN SEASON), open then announced events — two copies                                                                                                                                                                                                                        | `LoyaltyCatalogSystem.windowsOn(catalog, today)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | medals AG/AH; client-card strip                                                                                        |
| M-15 | achievements.presenter.ts:1117-1192; medals.presenter.ts:604       | season track: value `trackValue ?? value`, ended keeps reached levels, max, pending, sentence state, remaining = max(1, …), drawn, finished, level > 0                                                                                                                                                 | `SeasonSystem.trackOutlook(...)` → `seasonTrackState` + figures (`levelsShown` reused for the ended cut)                                                                                                                                                                                                                                                                                                                                                                                                                             | medals AG 3; ach scopePageVm; medalScopeVm 2                                                                           |
| M-16 | achievements.presenter.ts:1273, :1541                              | archived seasons the client took part in; grouped by closing year newest first                                                                                                                                                                                                                         | `LoyaltyCatalogSystem.archivedFor(...)`, `SeasonSystem.byClosingYear(seasons)`                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ach scopePageVm 2; medals 2; medalScopeVm                                                                              |
| M-17 | achievements.presenter.ts:1339; medals.presenter.ts:420, :910      | earned families counted — three copies (one over VM strings)                                                                                                                                                                                                                                           | `StandingSystem.earnedAmong(families, progress)` (medalState === EARNED, §7 R-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ach «counts a group…»; medals sections/chips/AK/medalScopeVm                                                           |
| M-18 | achievements.presenter.ts:1359                                     | sections: MASTERY by service category then GENERAL; BARBERS: barber, location, rest; else one grid                                                                                                                                                                                                     | `StandingSystem.sectionsOf(kind, families, serviceCategoryOf: ReadonlyMap<ServiceId, ServiceCategoryId>)` (branded section keys) → `ScopeSection` tags                                                                                                                                                                                                                                                                                                                                                                               | ach scopePageVm 3; medalScopeVm                                                                                        |
| M-19 | achievements.presenter.ts:1453                                     | archived tile state from counts                                                                                                                                                                                                                                                                        | `StandingSystem.scopeMedalState(counts): MedalState`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ach archived event                                                                                                     |
| M-20 | achievements.presenter.ts:1517, :1609; medals.presenter.ts:413     | earned-only cut (ended season scope, related, rhythm-off shelf) — NOT inside `familiesIn`                                                                                                                                                                                                              | `StandingSystem.earnedOnly(families, progress)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ach ended season; medalScopeVm                                                                                         |
| M-21 | achievements.presenter.ts:1580                                     | neighbours (category: `familiesIn`; season: `familyIds` WITH the track, retired only if started, earned-only if ended), minus self, shelf order                                                                                                                                                        | `StandingSystem.neighboursOf(catalog, progress, series, today)`; RAIL/RELATED limits STAY                                                                                                                                                                                                                                                                                                                                                                                                                                            | md «the neighbours» 2                                                                                                  |
| M-22 | medals.presenter.ts:95, :113                                       | rhythm live: some head's rule in force today enabled; the caller flag can only switch it off                                                                                                                                                                                                           | `LoyaltyCatalogSystem.rhythmLive(catalog, today, flag)` = `flag ∧ catalog.streaks.some(h => StreakRuleSystem.isOnOn(h, today, true))` — built on W-12's `isOnOn`, never a second copy                                                                                                                                                                                                                                                                                                                                                | medals rhythmLiveOf 2; rhythm-off 1                                                                                    |
| M-23 | medals.presenter.ts:128                                            | ring arc from the last threshold won to the next; span ≤ 0 → null; clamp                                                                                                                                                                                                                               | `BadgeSystem.ringFraction(series, standing)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | medals ringValueOf 5; medalRingVm                                                                                      |
| M-24 | medals.presenter.ts:284, :292                                      | `RECORD_ORDER`, `NEW_RECORD_DAYS = 30` copies                                                                                                                                                                                                                                                          | DUP → `RecordsSystem.RECORD_ORDER`/`NEW_RECORD_DAYS` re-exported under the same names                                                                                                                                                                                                                                                                                                                                                                                                                                                | medals records; isNewRecord                                                                                            |
| M-25 | medals.presenter.ts:340-366                                        | which records hold something (value ≤ 0, year/service/on null → none)                                                                                                                                                                                                                                  | `RecordsSystem.isHeld(record)` per kind (§2.4 table: LONGEST_RHYTHM `value > 0` only — `on` may be null; MOST_VISITS_IN_YEAR `value > 0 ∧ year ≠ null`; FAVOURITE_SERVICE `value > 0 ∧ serviceId ≠ null`; FIRST_VISIT `on ≠ null`); the service-name lookup STAYS                                                                                                                                                                                                                                                                    | medals records 2; records.presenter specs                                                                              |
| M-26 | medals.presenter.ts:407-442, :874                                  | shelves: rhythm-off RHYTHM shelf cut to earned, RECORDS kind and empty shelves dropped                                                                                                                                                                                                                 | `StandingSystem.shelves(catalog, progress, today, rhythmLive)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | medals rhythm-off 3, chips 2, sections 1, medalScopeVm                                                                 |
| M-27 | medals.presenter.ts:469                                            | window families: the track (no retired filter) then `familiesIn(season)`                                                                                                                                                                                                                               | `StandingSystem.windowFamilies(catalog, progress, season, today)` (exact, §7 R-3)                                                                                                                                                                                                                                                                                                                                                                                                                                                    | medals collection 3                                                                                                    |
| M-28 | medals.presenter.ts:796                                            | anything under way                                                                                                                                                                                                                                                                                     | `StandingSystem.anyUnderWay(progress)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | medals empty page 2                                                                                                    |
| M-29 | medal-detail.presenter.ts:189                                      | can still move: ¬retired ∧ next ∧ ¬ended                                                                                                                                                                                                                                                               | `BadgeSystem.canStillMove(series, standing, ended)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | md progress, ladder, verb, detailActionOf                                                                              |
| M-30 | medal-detail.presenter.ts:214-293                                  | the worked visit as counted: own WORKED seats, min start, with company, start instant (`ZonedTimeSystem.toUtc` fallback `utcEpochMs`), weekday                                                                                                                                                         | `AchievementsSystem.workedVisitOf(appointment, subject: CustomerId): WorkedVisitFacts \| null` — the ZONE-FREE facts (serviceIds, barberIds, locationId, localDate, startMinutes = min worked start, weekday, arrivedAtUtcMs, withCompany). The presenter edge calls `ZonedTimeSystem.toUtc(localDate, startMinutes, zone)` (fallback `utcEpochMs`) for `startUtcMs` and spreads the facts into the `CountedVisit` — a system never converts zones (ecs-systems.md, F-28); `countsToward` keeps its exported signature as a delegate | md countsToward 9                                                                                                      |
| M-31 | medal-detail.presenter.ts:323-390                                  | the draft counts: visit, metric, target, can move, season OPEN; the min leg instant; defaults today / minute 1439 / Monday / location `''`                                                                                                                                                             | `AchievementsSystem.draftCountsToward(...)` + `AchievementsSystem.countedDraft(draft, today)` over BRANDED inputs only (§2.4) holding the defaults exactly (minute 1439, Monday, today, the empty location, instant 0); the edge does `draftStart(visit, zone)` and the `*RefId.of` parsing                                                                                                                                                                                                                                          | md progress 3, visits 1                                                                                                |
| M-32 | medal-detail.presenter.ts:410                                      | the service to add: ¬retired, SERVICE subject, can move, not in the draft (online/gone/paused and the host name STAY)                                                                                                                                                                                  | `AchievementsSystem.serviceToAdd(series, draftServiceIds, canMove)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | md detailActionOf 8                                                                                                    |
| M-33 | medal-detail.presenter.ts:447-530                                  | detail state line precedence                                                                                                                                                                                                                                                                           | `BadgeSystem.detailState(...)` → `MedalDetailState`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | md state line 9                                                                                                        |
| M-34 | medal-detail.presenter.ts:599-661                                  | progress card: one-off / complete / stopped / to next; left > 0; this visit → min(value + 1, target)                                                                                                                                                                                                   | `BadgeSystem.progressCard(...)` → `MedalProgressCard` + figures                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | md progress card 11                                                                                                    |
| M-35 | medal-detail.presenter.ts:669, :892                                | metric sets that count visits / count in visits                                                                                                                                                                                                                                                        | `Gamification.countsVisits(metric)`, `Gamification.isVisitKind(metric)` (+ `VISIT_COUNTING_METRICS`, `VISIT_KIND_METRICS`), `BadgeSystem.countsInVisits(series)`                                                                                                                                                                                                                                                                                                                                                                     | md «Как се печели» 1; ladder 1                                                                                         |
| M-36 | medal-detail.presenter.ts:753                                      | fallback barbers: subjects of live BARBER families, distinct, catalogue order                                                                                                                                                                                                                          | `LoyaltyCatalogSystem.barberIds(catalog)`; the host preference STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | md 2                                                                                                                   |
| M-37 | medal-detail.presenter.ts:942; achievements.presenter.ts:1122      | ended season keeps levels ≤ highest — two copies                                                                                                                                                                                                                                                       | `BadgeSystem.levelsShown(series, standing, ended)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | md ladder; ach ended season                                                                                            |
| M-38 | medal-detail.presenter.ts:946-985                                  | per rung: passed / next / later                                                                                                                                                                                                                                                                        | `BadgeSystem.ladder(...)` → `LadderRung`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | md ladder 5                                                                                                            |
| M-39 | medal-detail.presenter.ts:1013                                     | counted visits: the draft if it counts, then visits that count and sit inside the windows, newest first (the slice of 5 STAYS)                                                                                                                                                                         | `AchievementsSystem.countedVisits(...)` over `{ appointment, counted }` pairs the edge built (no zone)                                                                                                                                                                                                                                                                                                                                                                                                                               | md visits 9                                                                                                            |

### 1.5 Card, glance, records, history, visits page (`libs/features/staff/client-card/src/lib/`)

| ID   | file:line                                                     | Decision                                                                                                                                                                                                          | Target                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pinned by                                                                    |
| ---- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| G-1  | history.presenter.ts:40                                       | cadence → whole weeks, `round(d/7)`, at least 1                                                                                                                                                                   | `ClientStatsSystem.cadenceWeeks(days)` — the ONE home of `max(1, round(days/7))`, reused by `StreakSystem.outlook`'s AT_RISK weeks (W-13); the presenter export delegates                                                                                                                                                                                                                                                                                                     | glance 386; visits-page 393, 446                                             |
| G-2  | history.presenter.ts:98; visits-page.presenter.ts:213         | the note: FIRST_VISIT (visits 0) › CLEAN (no no-shows ∧ no client cancels) › NONE; visits-page re-derives CLEAN from cell presence                                                                                | `ClientStatsSystem.historyNote(stats): HistoryNote`                                                                                                                                                                                                                                                                                                                                                                                                                           | history 35, 45, 60; visits-page 393–547                                      |
| G-3  | history.presenter.ts:151; visits-page.presenter.ts:69         | each appointment once by id — a byte-for-byte copy                                                                                                                                                                | `VisitListSystem.distinctById(appointments)`; both exports stay as delegates                                                                                                                                                                                                                                                                                                                                                                                                  | history 73; visits-page 242                                                  |
| G-4  | visits-page.presenter.ts:264                                  | the filter in force is always offered, in menu order                                                                                                                                                              | `VisitListSystem.offeredWith(perspective, offered, inForce)`                                                                                                                                                                                                                                                                                                                                                                                                                  | visits-page 695, 707, 723, 750                                               |
| G-5  | records.presenter.ts:302, :368                                | the 12-month window at the card's today 23:59 (a `ShopNow` built through the zone)                                                                                                                                | `ClientStatsSystem.statWindowsOnDay(stats, today)` — zone-free (statWindows reads only `localDate` + `currentMinute`); the bad-today → no row stays at the parse; the DST-gap omission is DEP-3 (pinned no-op, D-13)                                                                                                                                                                                                                                                          | records 532, 557                                                             |
| G-6  | records.presenter.ts:407-416                                  | «Обичайни услуги» only when a usual service is not the favourite                                                                                                                                                  | `RecordsSystem.usualBeyondFavourite(usualKnown, favourite)` (catalogue-name filter first, STAYS)                                                                                                                                                                                                                                                                                                                                                                              | records 730, 760                                                             |
| G-7  | records.presenter.ts:455-478                                  | years: only on a complete history; this customer's WORKED visits; the stamped record year                                                                                                                         | `RecordsSystem.yearsOfHistory(customerId, appointments, records, complete)`                                                                                                                                                                                                                                                                                                                                                                                                   | records 779–954                                                              |
| G-8  | glance.presenter.ts:195-204; client-card.presenter.ts:171-181 | tenure: FIRST_VISIT when stats null ∨ visits 0 ∨ first day null; SINCE without cadence; SINCE_CADENCE — two copies                                                                                                | `ClientStatsSystem.tenureOf(stats): Tenure` (`tenureState`, `since`, `cadenceWeeks`); guest/settled/pause STAY. The card HEAD words SINCE and SINCE_CADENCE alike as `head.since` (cc:178 never words the cadence); only the hero words `sinceCadence`                                                                                                                                                                                                                        | glance 244, 331, 356, 369, 386, 395, 399; client-card 74, 123, 134, 145, 160 |
| G-9  | glance.presenter.ts:226-247                                   | the hero tier plate (TOP when current is the LAST step; HELD_ABOVE when next missing or not above; CLIMBING with remaining and clamped ratio)                                                                     | `TierSystem.plate(state, tiers): TierPlate \| null` — NOT `progress` (§7 R-2)                                                                                                                                                                                                                                                                                                                                                                                                 | glance 244, 413, 420, 437, 463, 492                                          |
| G-10 | glance.presenter.ts:115, :304                                 | the reliability capsule from 2 no-shows in 90 days                                                                                                                                                                | `ClientStatsSystem.NO_SHOW_WARNING_AT` + `noShowWarning(windows)`; the `ShopNow` built from `nowMs` STAYS (T1 pass)                                                                                                                                                                                                                                                                                                                                                           | glance 525, 544                                                              |
| G-11 | glance.presenter.ts:117, :370, :400                           | birthday moment: TODAY, or UPCOMING within 1..7 days                                                                                                                                                              | `AgeSystem.birthdayMoment(birth, today)` + `AgeSystem.BIRTHDAY_NOTICE_DAYS`; `BirthdayMoment` moves to components (D-3)                                                                                                                                                                                                                                                                                                                                                       | glance 589, 662, 675, 683, 705, 717, 736                                     |
| G-12 | glance.presenter.ts:426                                       | birthday grants leave the reward ticket only while today's card carries the gift                                                                                                                                  | `CouponGrantSystem.besideOccasionGift(grants, occasion, giftCarried)` (the complement of G-22, one private predicate)                                                                                                                                                                                                                                                                                                                                                         | glance 599, 619, 631, 749                                                    |
| G-13 | glance.presenter.ts:500                                       | the next card: upcoming rows but the current one, soonest first                                                                                                                                                   | `VisitListSystem.upcomingSoonestFirst(items, rowOf)` — the items whose row is upcoming, STABLE on (localDate, startMinutes) only (input order on ties, DEP-2 withdrawn); the presenter drops the current visit first (D-3, D-2.6), takes `[0]` for the card and hands the whole list to `glancePick`                                                                                                                                                                          | glance 814, 871, 909                                                         |
| G-14 | client-card.presenter.ts:373                                  | the featured visit: newest (`b.utcEpochMs - a.utcEpochMs` brand arithmetic) WORKED not current                                                                                                                    | `VisitStorySystem.lastWorked(appointments, outcomeOf)` — newest first by `UtcEpochMs.compare` (stable: equal instants keep input order, as today's `b − a` sort), the first whose `outcomeOf(a) === WORKED`. `lastWorkedVisit` keeps its signature (the store calls it with a `historyRowVms` lookup closure, store:637-641): it drops `currentAppointmentId` (D-2.6), calls `lastWorked(rest, a => rowOf(a).outcome)` and returns `{ appointment, row: rowOf(appointment) }` | glance 814, 871, 932                                                         |
| G-15 | glance.presenter.ts:513-541                                   | the waitlist card: none while paused; watching ∧ not lapsed ∧ not answered by an upcoming visit booked at/after it; newest first; others = n − 1                                                                  | `WaitlistSystem.glancePick(requests, upcoming, today, paused)`                                                                                                                                                                                                                                                                                                                                                                                                                | glance 960, 989, 1001                                                        |
| G-16 | glance.presenter.ts:694-708                                   | points sentence: costliest affordable → ENOUGH_FOR, else cheapest out of reach → MORE_TO with `cost − balance`, else none                                                                                         | `RewardSystem.pointsReach(rewards, balance, today)` composing `bestAffordable` → ENOUGH_FOR, else `nextAffordable` → MORE_TO with `short = cost − balance`, else NONE; the presenter still pre-filters by `offered(catalog, today)` and the held names (D-3)                                                                                                                                                                                                                  | glance 1061, 1078, 1087, 1102, 1126                                          |
| G-17 | glance.presenter.ts:840                                       | records line: FavouriteService › MostVisitsInYear › FirstVisit, LongestRhythm excluded, null-day FirstVisit and unnamed favourite dropped, at most 2                                                              | `RecordsSystem.GLANCE_LINE_ORDER` + `glanceLine(records, knownServiceIds, limit)`                                                                                                                                                                                                                                                                                                                                                                                             | glance 1492, 1511                                                            |
| G-18 | client-card.presenter.ts:313-327                              | «Пак същото»: last visit known, online, not gone, not the current, legs not empty, not already the draft's, one leg service still named                                                                           | `ClientGlanceSystem.repeatOffer(last, draft, knownServiceIds)` (online/gone are inputs, D-2.6)                                                                                                                                                                                                                                                                                                                                                                                | client-card 242, 277, 285, 305                                               |
| G-19 | client-card.presenter.ts:227                                  | the dialable number: account E.164 first, else the seat's `tel:`/digits; none without a digit                                                                                                                     | `PhoneSystem.dialable(accountPhone: E164 \| null, seatDigits: string \| null)` — precedence and the no-digit refusal; the seat's `tel:`/non-digit stripping is boundary parsing at the edge (D-2.8); the display fallback STAYS                                                                                                                                                                                                                                               | client-card 242, 312                                                         |
| G-20 | client-card.presenter.ts:458                                  | cue order: category shelf order (unknown → last) then series order                                                                                                                                                | `LoyaltyCatalogSystem.cueOrdered(catalog, series)`                                                                                                                                                                                                                                                                                                                                                                                                                            | client-card 413, 431; glance 1408, 1421                                      |
| G-21 | client-card.presenter.ts:499-570                              | the medal strip: completing (cue-ordered) › newest face › soon (minus newest), dedupe, cap 3; cue WITH_THIS_VISIT › NEW › CLOSE; level = next.level ?? highest + 1; markNew = slot 0 ∧ no completing ∧ the newest | `StandingSystem.strip(...)` + `StandingSystem.stripCue(...)` → `MedalCue` (§2.5, exact precedence and level sources: WITH_THIS_VISIT from the FIRST cue-ordered completing family and `nextLevelNumber`, or no level for a one-off; NEW from `newestFaceLevel`'s level and stamp; CLOSE from `soon[0]` with `next ≠ null ∧ target ≠ null`); the inputs come from M-6/M-12/M-13 delegates                                                                                      | client-card 397, 413, 431, 448; glance 1327–1462                             |
| G-22 | glance.presenter.ts:334-339, :372-377                         | the birthday card's gift: the ready grants and the bill's grants cut to the birthday-occasion ones before `glanceReward` — the other half of G-12's partition                                                     | `CouponGrantSystem.forOccasion(grants, occasion)` (the complement of `besideOccasionGift`, sharing one private predicate over `isOccasion`)                                                                                                                                                                                                                                                                                                                                   | glance 589, 599, 619, 631, 749                                               |

### 1.6 Rhythm words (`admin-rhythm.words.ts`, `rhythm-rule.words.ts`)

| ID  | file:line                       | Decision                                                                                                                                               | Target                                                                                                                                                                                                         | Pinned by                                           |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| R-1 | admin-rhythm.words.ts:491       | `toleranceExample`: due = clamp(round(28·(1 + p/100)), min, max) — a copy of the personal interval rule                                                | DUP → `StreakIntervalRule.daysFor` via `StreakRuleSystem.exampleDue(interval, habitDays)`; identical for integer percents (§7 R-13)                                                                            | admin-rhythm.words 419 (+ the English block 761)    |
| R-2 | rhythm-rule.words.ts:127        | which interval the sentence states: FIXED; PERSONAL only for a PERSONAL period with habit > 0; else FALLBACK                                           | `StreakRuleSystem.statedInterval(interval, period: StreakPeriodTerms \| null)` → `streakIntervalSource` (existing dictionary) + days; the `'fixed'\|'personal'\|'fallback'` key table STAYS                    | rhythm-rule.words 315, 329, 338, 347 (×6), 377, 390 |
| R-3 | admin-rhythm.words.ts:816-861   | `samplePeriods` rebuilds the track (closed periods; open mark only with `dueBy`; PROTECTED when FROZEN, else CURRENT) — a copy of `StreakSystem.track` | DUP → `StreakSystem.track(state, { today, inChairToday: false, paused: false, limit: periods.length + 1 })` ONLY after the integrator-confirmed equivalence check (§7 R-12); ids and the null-reason word STAY | admin-rhythm.words 656, 675                         |
| R-4 | admin-rhythm.words.ts:534, :620 | the history names changed parameters in the rule's order (NAME last), drops non-parameters, counts the rest                                            | `StreakRuleSystem.changesInRuleOrder(changed)` + `STREAK_RULE_PARAMETER_ORDER` in `streak-rule.data.ts` (NOT `changeFrom`'s order)                                                                             | admin-rhythm.words 494, 513                         |
| R-5 | admin-rhythm.words.ts:340       | effective day: TOMORROW (wins a tie) › FIRST_OF_MONTH › PICKED                                                                                         | `RhythmDraftSystem.effectiveChoiceOf(day, presets)` → `RhythmEffectiveChoice`; `effectiveReading` keeps its string signature                                                                                   | admin-rhythm.words 306, 321                         |
| R-6 | admin-rhythm.words.ts:778, :189 | each standing's movement `to − from`                                                                                                                   | `StreakPreviewSystem.movement(before, after)`; `signedDelta` stays the pinned wording helper                                                                                                                   | admin-rhythm.words 219, 571, 590, 618               |
| R-7 | admin-rhythm.words.ts:418, :594 | excuses on vs all                                                                                                                                      | `StreakRuleSystem.excuseCount(rule)`                                                                                                                                                                           | admin-rhythm.words 375, 399, 445                    |
| R-8 | admin-rhythm.words.ts:669       | published by the system = `publishedByUserId === 'system'`                                                                                             | `StreakPublishSystem.SYSTEM_PUBLISHER` + `isSystemPublisher(version)`                                                                                                                                          | admin-rhythm.words 494                              |

---

## 2. Contracts (wave 0 builds these; wave 1 builds against them)

Every function is a member of its `XSystem` const (or a component
companion), pure (Law 3), `readonly` parameters, branded in, values /
brands / tags out (D-8). Names are binding; parameter shapes are binding
where written; a package may add a structural slice type next to its
function. `today` is always `LocalDate`, `now` always `ShopNow`.

### 2.1 Visits (W0-A)

```ts
// components/visit-tone.data.ts
export const VisitTone = { Hollow: 'HOLLOW', Upcoming: 'UPCOMING', Past: 'PAST' } as const;   // field: visitTone
// components/visit-status-mark.data.ts
export const VisitStatusMark = { NoShow: 'NO_SHOW', Pending: 'PENDING', Confirmed: 'CONFIRMED' } as const; // visitStatusMark
// components/visit-mark.data.ts — in drawing order
export const VisitMark = { Photos: 'PHOTOS', Discount: 'DISCOUNT', Voucher: 'VOUCHER' } as const; // visitMark

// systems/visit-story.system.ts (VisitStorySystem) — new members
isVoid(outcome: VisitRowOutcome): boolean;                         // CANCELLED || NO_SHOW
toneOf(outcome: VisitRowOutcome, start: WallTime, now: ShopNow): VisitTone; // isVoid › isUpcoming › PAST
statusMark(outcome: VisitRowOutcome, bookingStatus: BookingStatus): VisitStatusMark | null;
  // NO_SHOW outcome → NO_SHOW; OPEN∧PENDING → PENDING; OPEN∧CONFIRMED → CONFIRMED; else null.
  // Row: NO_SHOW→noShow, PENDING→pending, otherwise its cancelledWord (unchanged else-branch).
  // Card: only OPEN outcome and slot NEXT; PENDING→pending, CONFIRMED→statusConfirmed ?? null.
isWholeParty(appointment: Appointment, story: SubjectStory): boolean;   // seatIndexes.length === seats.length
subjectFigure(appointment: Appointment, story: SubjectStory): Money | null;
  // WORKED or CANCELLED only; whole party → BillingSystem.evaluate total; share → subtotalOf(own seats); error → null
marksOf(appointment: Appointment, story: SubjectStory, photoCount: number): readonly VisitMark[];
quotesBooker(appointment: Appointment, subjectUserId: UserId | null): boolean;
  // contactNote !== null && subjectUserId !== null && ownerUserId === subjectUserId
  // (an unclaimed party — ownerUserId null — with a null subject does NOT quote: spec case)
namesShop(outcome: VisitRowOutcome, locationCount: number): boolean;           // WORKED ∧ count > 1
subjectBarberIds(appointment: Appointment, story: SubjectStory): readonly BarberId[]; // distinct, first-seat order
subjectRecordOf(appointment: Appointment, named: CustomerId | null | undefined, userId: UserId | null): CustomerId | null;
peerCountOf(appointment: Appointment, story: SubjectStory): number;    // persons not on story seats, once each
  // composes: VisitStorySystem.peerCount + personKeyOf (the person key from the seat itself)
lastWorked<A extends { readonly utcEpochMs: UtcEpochMs }>(appointments: readonly A[],
           outcomeOf: (appointment: A) => VisitRowOutcome): A | null;
  // newest first by UtcEpochMs.compare, STABLE (equal instants keep input order), the first whose
  // outcome is WORKED; outcomeOf is called lazily in that order. No subject record, no staff flag,
  // no exclusion: the caller's row (storyOf/subjectRecordOf, per appointment) is the outcome's
  // source, and the current visit is dropped by the caller (D-2.6).

// systems/visit-list.system.ts (VisitListSystem)
rowSectionKey(upcoming: boolean, localDate: LocalDate, grain: VisitGrain): string;
distinctById<A extends { readonly id: AppointmentId }>(appointments: readonly A[]): readonly A[]; // first wins, order kept
upcomingSoonestFirst<T>(items: readonly T[], rowOf: (item: T) => SectionRow): readonly T[];
  // the items whose row is upcoming, STABLE-sorted on (localDate, startMinutes) through the private
  // byStart only — input order on ties (NOT soonestFirst's byId tie-break; the JSDoc says so). No
  // inbound mapping: the glance hands its appointments and its rowOf as they are.
offeredWith(perspective: VisitPerspective, offered: readonly VisitFilter[], inForce: VisitFilter): readonly VisitFilter[];

// systems/waitlist.system.ts (WaitlistSystem)
daysAhead(days: readonly DayWindows[], today: LocalDate | null): readonly DayWindows[]; // none ahead → all; null → all
daypartsWatched(days: readonly DayWindows[]): readonly Daypart[];
sortPoint(days: readonly DayWindows[]): WallTime;                    // first day @0, none → epoch day 0 @0
glancePick(requests: readonly WaitlistRequest[], upcoming: readonly Pick<Appointment, 'bookedAtUtcMs'>[], // = upcomingSoonestFirst's list
           today: LocalDate, paused: boolean): { readonly newest: WaitlistRequest | null; readonly others: number };

// components/service-composition.data.ts (ServiceComposition companion)
drawnKind(kind: CompositionKind): typeof CompositionKind.Single | typeof CompositionKind.Bundle;
```

`DayWindows`, `Daypart`, `WallTime`, `SubjectStory` are the existing types;
`subjectStory` itself is untouched (D-5) — callers pass its result.

### 2.2 Wallet, ledger, tier, rewards, vouchers (W0-B)

```ts
// components/pass-state.data.ts
export const PassState = { Frozen: 'FROZEN', Owes: 'OWES', Expiring: 'EXPIRING', Clear: 'CLEAR' } as const; // passState
export const PassFigure = { Points: 'POINTS', Visits: 'VISITS' } as const;                               // passFigure
// systems/loyalty-pass.system.ts (NEW)
export type LoyaltyPassView = { readonly pointsOn: boolean; readonly paused: boolean; readonly today: LocalDate };
// (the canonical example of .claude/rules/presenters.md calls passOf(input.account) and reads
//  pass.points — this binding keeps `figure` (balance OR tierQualifying) and the `view`; the
//  example's one-line update is owner-flagged by G, §8 OQ-9)
export type LoyaltyPass = {
  readonly passState: PassState;          // paused→FROZEN; !pointsOn→CLEAR; <0→OWES; window→EXPIRING; else CLEAR
  readonly passFigure: PassFigure; readonly figure: number;  // balance, or tierQualifying with points off
  readonly spendable: number;             // max(0, balance)
  readonly owed: number | null;           // |balance| when OWES
  readonly lapsing: number | null; readonly lapsesOn: LocalDate | null; // EXPIRING only
};
LoyaltyPassSystem.passOf(account: PointsBalance & PointsExpiry & Pick<TierState,'tierQualifying'>, view): LoyaltyPass;
//   (use the existing component slice types of LoyaltyAccount; CLEAR → the presenter's null state line)

// components/wallet-action.data.ts — in disc order
export const WalletAction = { Use: 'USE', Code: 'CODE', Catalog: 'CATALOG', History: 'HISTORY' } as const; // walletAction
// systems/wallet.system.ts (NEW)
export type WalletView = { readonly isOwner: boolean; readonly visitGone: boolean; readonly online: boolean; readonly paused: boolean };
WalletSystem.ticketsShown(view): boolean;                 // isOwner ∧ ¬paused
WalletSystem.writable(view): boolean;                     // isOwner ∧ ¬visitGone ∧ online ∧ ¬paused
WalletSystem.actions(input: { writable; pointsOn; catalogStands; readyGrantIds: readonly CouponGrantId[] }):
  { readonly actions: readonly WalletAction[]; readonly useGrantId: CouponGrantId | null; readonly useCount: number | null };
//   readyGrantIds = the first grant id of each NOT-applied ticket group (the presenter collects them from RewardSystem.groupGrants)

// systems/voucher.system.ts (VoucherSystem)
held(vouchers: readonly GiftVoucher[], today: LocalDate,
     idOrder: (a: GiftVoucherId, b: GiftVoucherId) => number): readonly GiftVoucher[];
  // spendable, by last day (null = never, last) through the private core soonestFirst now shares
  // (soonestFirst passes the code-unit order: its output byte-identical, D-5); equal days → idOrder.
  // The wallet passes (a, b) => a.localeCompare(b): its tie order unchanged (DEP-1 withdrawn).
untouched(voucher: Pick<GiftVoucher,'balanceCents'|'initialValueCents'>): boolean;
heldTotal(vouchers: readonly GiftVoucher[], today: LocalDate): Money | null;
  // null below 2 spendable or with 2+ currencies; else composes spendableSum(vouchers, today, first.currency).
  // It decides only WHETHER a total exists and its Money; the printed count is the presenter's
  // holdings.length (every holding — tickets and stamps too; spec 1745 «4 · 55,00 €»).

// systems/reward.system.ts (RewardSystem)
tiles<R extends RedeemableRewardRef>(rewards: readonly R[], balance: number, today: LocalDate):
  { readonly tiles: readonly { readonly reward: R; readonly reach: RewardReach }[]; readonly withinReach: number };
//   offered → affordable ≠ null → stable partition within-reach first (catalogue order inside each half)
pointsReach<R extends RedeemableRewardRef>(rewards: readonly R[], balance: number, today: LocalDate):
  { readonly pointsReach: PointsReach; readonly reward: R | null; readonly short: number };
  // composes: bestAffordable(rewards, balance, today) → ENOUGH_FOR; else nextAffordable(...) → MORE_TO,
  // short = reward.cost - balance; else NONE (short 0). The caller pre-filters offered + held names (D-3).
// components/points-reach.data.ts
export const PointsReach = { EnoughFor: 'ENOUGH_FOR', MoreTo: 'MORE_TO', None: 'NONE' } as const;

// systems/tier.system.ts (TierSystem)
standingTier(state: TierState, tiers: readonly TierStepRef[]): TierId | null;   // null with no tiers
keptAt(progress: TierProgress): number;                                         // currentAtLeast ?? value
plate(state, tiers): { readonly tierPlateState: TierPlateState; readonly currentTierId: TierId;
  readonly nextTierId: TierId | null; readonly progress: number | null; readonly remaining: number | null } | null;
// components/tier-plate.data.ts
export const TierPlateState = { Top: 'TOP', HeldAbove: 'HELD_ABOVE', Climbing: 'CLIMBING' } as const;

// systems/ledger.system.ts (LedgerSystem)
voided(entries: readonly JournalEntry[]): ReadonlySet<JournalEntryId>;   // the existing private voidedIds, exported
  // (its element type narrowed from string to the brand — no output changes)
isStruck(event: LedgerEvent, voided: ReadonlySet<JournalEntryId>): boolean; // some entry of the event reversed
lineOf(event: LedgerEvent, leading: JournalEntry): { readonly ledgerLine: LedgerLine; readonly paid: boolean; readonly revoked: boolean };
WELCOME_SERIES_ID: BadgeSeriesId;     // 'series-welcome', branded ONCE through its companion
isWelcome(level: LedgerLevel): boolean;
netsUnder(feed: JournalFeed): boolean;                            // ALL or POINTS
// components/ledger-line.data.ts
export const LedgerLine = { Reversal: 'REVERSAL', RedemptionSpent: 'REDEMPTION_SPENT', RedemptionExpired: 'REDEMPTION_EXPIRED',
  RewardGranted: 'REWARD_GRANTED', RewardRevoked: 'REWARD_REVOKED', Tier: 'TIER', Level: 'LEVEL', VisitEarned: 'VISIT_EARNED',
  PointsRedeemed: 'POINTS_REDEEMED', Goodwill: 'GOODWILL', ServiceIssue: 'SERVICE_ISSUE', PointsExpired: 'POINTS_EXPIRED',
  DebtCleared: 'DEBT_CLEARED', Correction: 'CORRECTION' } as const;  // the presenter's draftOf/pointsDraft branches, one tag each
```

### 2.3 Rhythm (W0-C)

```ts
// components/streak-outlook.data.ts
export const StreakOutlook = { Paused: 'PAUSED', InChair: 'IN_CHAIR', NotStarted: 'NOT_STARTED', Frozen: 'FROZEN',
  BrokenRepairable: 'BROKEN_REPAIRABLE', BrokenFinal: 'BROKEN_FINAL', Held: 'HELD', Due: 'DUE', DueNone: 'DUE_NONE',
  AtRisk: 'AT_RISK', InGrace: 'IN_GRACE' } as const;                                   // streakOutlook
export const StreakCapsule = { Frozen: 'FROZEN', Broken: 'BROKEN', Held: 'HELD', AtRisk: 'AT_RISK', InGrace: 'IN_GRACE' } as const;
// systems/streak.system.ts (StreakSystem)
export type StreakOutlookView = { readonly today: LocalDate; readonly inChairDue: LocalDate | null;
  readonly paused: boolean; readonly lastQualifiedOn: LocalDate | null };              // D-11: the shop day, converted by the caller
export type StreakOutlookAnswer = {
  readonly streakOutlook: StreakOutlook;
  readonly day: LocalDate | null;          // the day the line names (in-chair due, dueBy, phaseDueBy, graceUntil, repairable, heldOn)
  readonly nextDue: LocalDate | null;      // dueNamed ? (inChairDue ?? dueBy) : null — GATED (wallet:863-868)
  readonly dueNamed: boolean;
  readonly streakCapsule: StreakCapsule | null;  readonly urgent: boolean;  // warning tone
  readonly weeksSinceLast: number;         // AT_RISK: ClientStatsSystem.cadenceWeeks(LocalDate.daysBetween(lastQualifiedOn, today)),
                                           // 0 when lastQualifiedOn null — the rule's ONE home is G-1 (W0-E)
};
outlook(state: StreakState, view: StreakOutlookView): StreakOutlookAnswer;   // wallet standingOf's live semantics, in its order
record(state: Pick<StreakState,'best'|'current'>): number | null;            // best when best > current
protectionsHeld(state: Pick<StreakState,'freezesBanked'>, summary: StreakRuleSummary): number | null;
//   StreakRuleSummary lives in streak-rule.system.ts: import type './streak-rule.system' (a type edge, no cycle)

// systems/streak-rule.system.ts (StreakRuleSystem)
isOnOn(head: StreakSchedule | null, today: LocalDate, flag: boolean): boolean;  // flag ∧ head ≠ null ∧ inForceOn(head,today).enabled
  // records passes flag = true (its store folds loyalty.streaks into rhythm === null); wallet and glance pass flags.streaks
statedInterval(interval: StreakIntervalRule, period: StreakPeriodTerms | null):
  { readonly streakIntervalSource: StreakIntervalSource; readonly intervalDays: number; readonly habitDays: number | null };
changesInRuleOrder(changed: readonly string[]): readonly StreakRuleParameter[];
excuseCount(rule: { readonly excuses: readonly StreakExcuse[] }): { readonly on: number; readonly all: number };
exampleDue(interval: StreakIntervalRule.Personal, habitDays: number): StreakIntervalRule.Period; // delegates daysFor
// components/streak-rule.data.ts: STREAK_RULE_PARAMETER_ORDER (admin-rhythm's CHANGE_ORDER, NAME last)

// systems/rhythm-draft.system.ts (RhythmDraftSystem)
effectiveChoiceOf(day: LocalDate, presets: { readonly tomorrow: LocalDate; readonly firstOfMonth: LocalDate }): RhythmEffectiveChoice;
// components/rhythm-effective.data.ts
export const RhythmEffectiveChoice = { Tomorrow: 'TOMORROW', FirstOfMonth: 'FIRST_OF_MONTH', Picked: 'PICKED' } as const;
// systems/streak-preview.system.ts
movement(before: StreakStandingCounts | null, after: StreakStandingCounts | null): StreakStandingCounts | null;
// systems/streak-publish.system.ts
SYSTEM_PUBLISHER: UserId;  isSystemPublisher(version: Pick<StreakDefinitionVersion,'publishedByUserId'>): boolean;
```

### 2.4 Medals — badges, achievements, records (W0-D1)

```ts
// components/medal-outlook.data.ts (NEW; badge-level.data.ts stays as is, D-5)
export const MedalCaption = { WithThisVisit: 'WITH_THIS_VISIT', None: 'NONE', LandsOn: 'LANDS_ON', NotYet: 'NOT_YET',
  ToLevel: 'TO_LEVEL', OnDay: 'ON_DAY', Complete: 'COMPLETE' } as const;               // medalCaption
export const MedalRingState = { NotStarted: 'NOT_STARTED', InProgress: 'IN_PROGRESS', Earned: 'EARNED', Complete: 'COMPLETE' } as const;
export const MedalMeter = { Pending: 'PENDING', Fraction: 'FRACTION', None: 'NONE' } as const;
export const MedalDetailState = { Retired: 'RETIRED', Repeated: 'REPEATED', SeasonEnded: 'SEASON_ENDED',
  OneOffEarned: 'ONE_OFF_EARNED', OneOffNotYet: 'ONE_OFF_NOT_YET', NotStarted: 'NOT_STARTED', UnderWay: 'UNDER_WAY',
  Complete: 'COMPLETE', CompleteSince: 'COMPLETE_SINCE', LevelSince: 'LEVEL_SINCE' } as const;
export const MedalProgressCard = { OneOff: 'ONE_OFF', Complete: 'COMPLETE', Stopped: 'STOPPED', ToNext: 'TO_NEXT' } as const;
export const LadderRung = { Passed: 'PASSED', Next: 'NEXT', Later: 'LATER' } as const;
export const MedalCue = { WithThisVisit: 'WITH_THIS_VISIT', New: 'NEW', Close: 'CLOSE' } as const;
export const ScopeSection = { ServiceCategory: 'SERVICE_CATEGORY', Barbers: 'BARBERS', Shops: 'SHOPS', General: 'GENERAL', Whole: 'WHOLE' } as const;
export const SeasonTrackState = { Ended: 'ENDED', Complete: 'COMPLETE', Pending: 'PENDING', ToNext: 'TO_NEXT' } as const;

// components/gamification.data.ts: VISIT_COUNTING_METRICS, VISIT_KIND_METRICS; Gamification.countsVisits, .isVisitKind

// systems/badge.system.ts (BadgeSystem) — over BadgeSeries / SeriesStanding / BadgeProgressShape / EarnedLevel
latestEarned(progress): EarnedLevel | null;  topEarned(progress): EarnedLevel | null;
earnedOn(progress, level: number): LocalDate | null;
isOneOff(series): boolean;  isSingleLevel(series): boolean;  countsInVisits(series): boolean;
landsOn(series, standing, firstVisitOn: LocalDate | null, today: LocalDate): LocalDate | null;
toNext(standing, ended: boolean): { readonly value: number; readonly target: number; readonly level: number } | null;
nextLevelNumber(standing): number;
meterOf(standing, toNext, pending: boolean): { readonly medalMeter: MedalMeter; readonly fraction: number };
faceState(standing, pending: boolean): MedalState;  ringState(standing, pending: boolean): MedalRingState;
ringFraction(series, standing): number | null;
captionOf(series, standing, latest, ended: boolean, pending: boolean, landsOn: LocalDate | null): MedalCaption;
  // landsOn = the UNGATED BadgeSystem.landsOn(...) (ach:654); the meter alone uses the gated
  // `toNext === null ? null : landsOn(...)` (ach:738)
canStillMove(series, standing, ended: boolean): boolean;
levelsShown(series, standing, ended: boolean): readonly BadgeLevel[];
ladder(series, standing, progress, canMove: boolean, ended: boolean):
  readonly { readonly level: BadgeLevel; readonly earned: EarnedLevel | null; readonly ladderRung: LadderRung }[];
detailState(series, standing, progress, ended: boolean, retired: boolean):
  { readonly medalDetailState: MedalDetailState; readonly day: LocalDate | null; readonly level: number; readonly count: number };
progressCard(series, standing, progress, canMove: boolean, landsOn: LocalDate | null, draftCounts: boolean):
  { readonly medalProgressCard: MedalProgressCard; readonly value: number; readonly target: number | null;
    readonly remaining: number | null; readonly projected: number | null; readonly unitShown: boolean };

// systems/achievements.system.ts (AchievementsSystem)
export type DraftVisit = { readonly serviceIds: readonly ServiceId[]; readonly barberIds: readonly BarberId[];
  readonly locationId: LocationId | null; readonly startMinutes: MinuteOfDay | null; readonly birthdayToday: boolean };
completesWithVisit(series, standing, lastEarned: EarnedLevel | null, draft: DraftVisit,
                   seasonPhase: SeasonPhase | null, today: LocalDate): boolean;   // EXACT port of ach:454, ≠ countsToward
  // seasonPhase = the phase of the series' season, null when it does not resolve. When
  // series.seasonId !== null, ANY value but OPEN — null included — gives false (ach:448-453);
  // spec case: a seasonal series with a null phase. A non-seasonal series ignores it.
export type WorkedVisitFacts = Omit<CountedVisit, 'startUtcMs'>;  // a system slice type, not a port
workedVisitOf(appointment: Appointment, subject: CustomerId): WorkedVisitFacts | null;
  // the subject's own WORKED seats (md:214-240): services, barbers, locationId, localDate, the MIN
  // worked start, weekday, arrivedAtUtcMs, withCompany. ZONE-FREE: the presenter edge adds
  // startUtcMs = ZonedTimeSystem.toUtc(localDate, startMinutes, zone) (fallback utcEpochMs) and
  // builds the CountedVisit — a system never converts zones (ecs-systems.md, F-28).
countedDraft(draft: { readonly start: { readonly localDate: LocalDate; readonly minute: MinuteOfDay;
                                        readonly utcMs: UtcEpochMs } | null;
                      readonly serviceIds: readonly ServiceId[]; readonly barberIds: readonly BarberId[];
                      readonly locationId: LocationId | null }, today: LocalDate): CountedVisit;
  // BRANDED inputs only; the defaults of md:381-390 byte for byte: no start → today, minute 1439,
  // Monday, instant 0; no shop → the empty location the presenter brands today. The edge runs
  // draftStart(visit, zone) and the *RefId.of parsing.
draftCountsToward(series, standing, draft: CountedVisit | null, seasonPhase: SeasonPhase | null, ended: boolean): boolean;
  // the same seasonal rule as completesWithVisit: seasonId ≠ null ∧ phase ≠ OPEN (null included) → false (md:351-356)
serviceToAdd(series, draftServiceIds: readonly ServiceId[], canMove: boolean): ServiceId | null;
countedVisits(series, window: SeasonWindow | null,
              visits: readonly { readonly appointment: Appointment; readonly counted: CountedVisit | null }[],
              today: LocalDate, current: CountedVisit | null, currentId: AppointmentId | null): readonly Appointment[];
  // the pairs are built at the edge (workedVisitOf + the zone); no zone parameter anywhere

// systems/records.system.ts (RecordsSystem)
isHeld(record: PersonalRecord): boolean;
  // per kind, exactly medals:340-366 (one spec case each):
  //   LONGEST_RHYTHM       value > 0              (`on` may be null — held, worded without a detail)
  //   MOST_VISITS_IN_YEAR  value > 0 ∧ year ≠ null
  //   FAVOURITE_SERVICE    value > 0 ∧ serviceId ≠ null   (the host name lookup stays in the presenter)
  //   FIRST_VISIT          on ≠ null
usualBeyondFavourite(usual: readonly ServiceId[], favourite: ServiceId | null): boolean;
yearsOfHistory(customerId: CustomerId, appointments: readonly Appointment[], records: readonly PersonalRecord[],
               complete: boolean): readonly RecordYear[] | null;
  // composes: ./client-stats.system subjectVisitOf → the WORKED RecordVisits → RecordsSystem.years(...)
GLANCE_LINE_ORDER: readonly PersonalRecordKind[];
glanceLine(records: readonly PersonalRecord[], knownServiceIds: ReadonlySet<ServiceId>, limit: number): readonly PersonalRecord[];
```

No §2.4 signature takes a `TimeZone` (revised): zone math lives only in
`zoned-time.system.ts` and is called at the boundary (Law 7,
`ecs-systems.md`; waitlist.system.ts:88, F-28 — no system but
`zoned-time` calls `ZonedTimeSystem.toUtc`). The medal-detail presenter
keeps its `ZonedTimeSystem.toUtc` / `draftStart` calls at the edge as it
has them today and hands the systems `CountedVisit`s / branded drafts.
`CountedVisit.startUtcMs` (achievements.system.ts:52) exists precisely so
the system RECEIVES the instant. (`PersonalRecordKind` is the existing
dictionary of `components/personal-record.data.ts`.)

### 2.5 Medals — standing, seasons, catalogue (W0-D2)

```ts
// systems/standing.system.ts (StandingSystem)
isFamilyNew(standing, latest: EarnedLevel | null, previousVisitAtUtcMs: UtcEpochMs | null): boolean;
shelfOrdered<S extends StandingSeriesRef>(families: readonly S[], progress: readonly StandingProgress[]): readonly S[];
soonIds(catalog, progress, today: LocalDate, completing: ReadonlySet<BadgeSeriesId>, limit: number): readonly BadgeSeriesId[];
almostEarned(catalog, progress, today, opts: { readonly completing: ReadonlySet<BadgeSeriesId>;
  readonly excludeSeriesId: BadgeSeriesId | null; readonly rhythmLive: boolean; readonly limit: number }): readonly BadgeSeriesId[];
  // under way = progress.value > 0 (medals:704), never medalState !== NOT_STARTED; spec: an earned family
  // with value 0 is not «almost»
recentFreshLevelsByDay(progress): readonly { readonly localDate: LocalDate;
  readonly levels: readonly EarnedDay.Level[];   // ALL of the day's, the existing order (single-vs-group, «+N»)
  readonly fresh: readonly EarnedDay.Level[];    // not on a newer day, same order (the face candidates)
}[];
  // composes recentLevelsByDay(progress, MAX_SAFE_INTEGER); days with fresh.length === 0 dropped; NO day
  // limit — RAIL_LIMIT caps TILES after the host lookups (D-2.4). Spec: a day of two levels, one of them
  // a family on a newer day, keeps levels.length 2 (a stack, «+1») with fresh.length 1.
earnedAmong(families, progress): number;  earnedOnly(families, progress): readonly S[];
sectionsOf(kind: BadgeCategoryKind, families, serviceCategoryOf: ReadonlyMap<ServiceId, ServiceCategoryId>):
  readonly { readonly scopeSection: ScopeSection; readonly key: BarberId | LocationId | ServiceCategoryId | null;
             readonly families: readonly S[] }[];
  // key = the section's branded id, null for GENERAL/WHOLE — never a raw string (Law 7.4); the edge
  // brands the host's category ids (ServiceCategoryId companion, D-2.8) when it builds the map
scopeMedalState(counts: FamilyCounts): MedalState;
neighboursOf(catalog, progress, series, today): readonly S[];       // self excluded, shelf order, NOT limited
shelves(catalog, progress, today, rhythmLive: boolean): readonly { readonly category: BadgeCategory; readonly families: readonly S[] }[];
windowFamilies(catalog, progress, season, today): readonly S[];     // the track (no retired filter) then familiesIn(season)
anyUnderWay(progress): boolean;
strip(input: { readonly completingFirst: BadgeSeriesId | null;   // ONE family: the first cue-ordered completer
  readonly newestSeriesId: BadgeSeriesId | null;                   // newestFaceLevel's family, when it resolves
  readonly soonIds: readonly BadgeSeriesId[]; readonly limit: number }):
  { readonly slots: readonly BadgeSeriesId[]; readonly markNewIndex: number | null };
  // slots = [completingFirst?, newest?, ...soonIds minus newest], deduped, sliced to limit (cc:507-523);
  // markNewIndex = 0 when completingFirst null ∧ slots[0] === newestSeriesId, else null
stripCue(input: {
  readonly completing: { readonly series: BadgeSeries; readonly standing: SeriesStanding } | null;
  readonly newest: { readonly level: number; readonly earnedAtUtcMs: UtcEpochMs } | null; // newestFaceLevel's
  readonly previousVisitAtUtcMs: UtcEpochMs | null;
  readonly closest: SeriesStanding | null;                         // soon[0]'s standing
}): { readonly medalCue: MedalCue | null; readonly level: number | null };
  // first match wins (cc:525-566): completing → WITH_THIS_VISIT, level = isOneOff(series) ? null
  //   : BadgeSystem.nextLevelNumber(standing); else newest ∧ isNewSince(newest.earnedAtUtcMs, previous)
  //   → NEW, level = newest.level (the face family's level on the newest day — NOT latestEarned, whose
  //   ties differ); else closest.next ≠ null ∧ closest.target ≠ null → CLOSE, level = next.level;
  //   else null. The presenter takes completingFirst as
  //   LoyaltyCatalogSystem.cueOrdered(catalog, families.filter(completesWithThisVisit))[0].

// systems/season.system.ts (SeasonSystem)
trackOutlook(track: BadgeSeries, standing, trackValue: number | null, trackLevel: number | null, phase: SeasonPhase, pending: boolean):
  { readonly seasonTrackState: SeasonTrackState; readonly levels: readonly BadgeLevel[]; readonly max: number;
    readonly drawn: number; readonly remaining: number; readonly finished: boolean; readonly level: number;
    readonly fromLevel: boolean };      // fromLevel: the «Ниво N · …» prefix (medals:604)
byClosingYear<N extends { readonly windowUntil: LocalDate }>(seasons: readonly N[]): readonly { readonly year: number; readonly seasons: readonly N[] }[];

// systems/loyalty-catalog.system.ts (LoyaltyCatalogSystem)
inEndedSeason(catalog, series: { readonly seasonId: SeasonId | null }, today): boolean;
windowsOn(catalog, today): { readonly season: Season | null; readonly events: readonly Season[] };
archivedFor(catalog, today, startedSeriesIds: ReadonlySet<BadgeSeriesId>, seasonProgressIds: ReadonlySet<SeasonId>): readonly Season[];
rhythmLive(catalog: { readonly streaks: … }, today, flag: boolean): boolean;
  // = flag && catalog.streaks.some(h => StreakRuleSystem.isOnOn(h, today, true)) — built on W0-C's
  // isOnOn (JSDoc says so); spec: agrees with isOnOn on the same catalogue
barberIds(catalog): readonly BarberId[];
cueOrdered<S extends CatalogSeriesRef>(catalog, series: readonly S[]): readonly S[];
```

W0-D2's cross-package edges inside wave 0 (§3, §6.1): `trackOutlook`
reuses `BadgeSystem.levelsShown`, `stripCue` calls
`BadgeSystem.nextLevelNumber` (and `isOneOff`) — W0-D1; `rhythmLive` is
built on `StreakRuleSystem.isOnOn` — W0-C. W0-D2 starts after W0-D1
reports `levelsShown` + `toNext` + `nextLevelNumber` + `isOneOff` and
W0-C reports `isOnOn`.

### 2.6 Stats, glance, age, grants, phone, punch cards (W0-E)

```ts
// components/client-history.data.ts
export const HistoryNote = { FirstVisit: 'FIRST_VISIT', Clean: 'CLEAN', None: 'NONE' } as const;          // historyNote
export const TenureState = { FirstVisit: 'FIRST_VISIT', Since: 'SINCE', SinceCadence: 'SINCE_CADENCE' } as const; // tenureState
// components/birthday-moment.data.ts — moved from client-pages.vm.ts, values identical
export const BirthdayMoment = { Today: 'TODAY', Upcoming: 'UPCOMING' } as const;                          // birthdayMoment

// systems/client-stats.system.ts (ClientStatsSystem)
cadenceWeeks(days: number): number;                        // max(1, round(days/7)) — the ONE home; StreakSystem.outlook reuses it
historyNote(stats: Pick<ClientStats,'lifetimeVisitsCompleted'|'lifetimeNoShows'|'lifetimeClientCancels'> | null): HistoryNote;
tenureOf(stats: Pick<ClientStats,'lifetimeVisitsCompleted'|'firstVisitLocalDate'|'avgCadenceDays'> | null):
  { readonly tenureState: TenureState; readonly since: LocalDate | null; readonly cadenceWeeks: number | null };
statWindowsOnDay(stats, today: LocalDate): StatWindows;    // = statWindows at today 23:59; shares statWindows' core (D-5)
NO_SHOW_WARNING_AT: 2;  noShowWarning(windows: StatWindows): number | null;

// systems/age.system.ts (AgeSystem)
BIRTHDAY_NOTICE_DAYS: 7;
birthdayMoment(birth: BirthDate, today: LocalDate):        // composes nextBirthday(...).inDays: 0 → TODAY, 1…7 → UPCOMING
  { readonly birthdayMoment: BirthdayMoment; readonly localDate: LocalDate; readonly age: number | null; readonly turning: number | null } | null;

// systems/coupon-grant.system.ts
besideOccasionGift<G extends { readonly couponOccasion: CouponOccasion | null }>(grants: readonly G[], occasion: CouponOccasion, giftCarried: boolean): readonly G[];
forOccasion<G extends { readonly couponOccasion: CouponOccasion | null }>(grants: readonly G[], occasion: CouponOccasion): readonly G[];
  // G-22: the complement of besideOccasionGift's cut; both share ONE private predicate over isOccasion
  // (match the grant type's real optionality — the presenter reads `grant.couponOccasion ?? null`)
// systems/client-glance.system.ts
repeatOffer(last: Pick<ClientStats,'lastVisitAppointmentId'|'lastVisitLocalDate'|'lastVisitLegs'>,
            draft: { readonly online: boolean; readonly gone: boolean; readonly currentAppointmentId: AppointmentId | null;
                     readonly legs: readonly GlanceLeg[] }, knownServiceIds: ReadonlySet<ServiceId>): boolean;
  // composes ClientGlanceSystem.sameLegs (the «already the draft's» refusal)
// systems/phone.system.ts
dialable(accountPhone: E164 | null, seatDigits: string | null):
  { readonly fromAccount: true; readonly e164: E164 } | { readonly fromAccount: false; readonly digits: string } | null;
  // account first; else the seat's digits (stripped of tel: and non-digits AT THE EDGE, D-2.8); none without a digit
// components/punch-card.data.ts — a NEW companion beside the existing type (Law 1; no system file)
export const PunchCard = {
  progress(card: PunchCard): { readonly filled: number; readonly left: number; readonly toNext: number },
  // filled clamped to [0, size]; left = max(0, size − filled); toNext = max(1, left)
} as const;
```

(Use each field's real stored name — `ClientStats` field names above are
the scouts' reading; the package confirms them.)

### 2.7 The presenter side (wave 1 builds against §2.1–§2.6)

- A presenter calls the system and maps its tag through ONE table of its
  own (`satisfies Record<Tag, …>`), e.g. `VISIT_TONE_WORDS = { HOLLOW:
'hollow', UPCOMING: 'upcoming', PAST: 'past' }` in
  `visit-row.presenter.ts`; `WALLET_ACTION_DISCS` in `wallet.presenter.ts`.
- New ServiceVm fields (D-10), in `catalog.vm.ts`:
  `readonly priceFrom: number` (EUR major), `readonly cardPrice: { readonly
cheapest: number; readonly spread: boolean }`, `readonly minutesRange: {
readonly from: number; readonly to: number }`; `landing-content.ts`'s
  `SERVICES` typed as `readonly ServiceSourceVm[]` (a sibling interface in
  catalog.vm.ts without the three fields; `ServiceVm extends
ServiceSourceVm`).

---

## 3. Packages

Wave 0 runs ALONE (no feature file changes) — its packages own disjoint
ecs-core files and run in parallel, with three declared edges (each
producer lands the named member FIRST and reports it; the consumer
imports it, never re-derives it — REUSE, NEVER COPY):

| Consumer                      | Waits for | Member(s)                                                          |
| ----------------------------- | --------- | ------------------------------------------------------------------ |
| W0-D2                         | W0-D1     | `BadgeSystem.levelsShown`, `toNext`, `nextLevelNumber`, `isOneOff` |
| W0-D2                         | W0-C      | `StreakRuleSystem.isOnOn` (for `rhythmLive`)                       |
| W0-C (only `outlook`'s weeks) | W0-E      | `ClientStatsSystem.cadenceWeeks`                                   |

No cycle: W0-D1, W0-E produce first; W0-C lands `isOnOn` before it needs
`cadenceWeeks`. `streak.system.ts` importing `./client-stats.system` is a
new sibling edge — neither imports the other today. Each package that
creates a file appends its export line to `libs/ecs-core/src/systems/index.ts`
/ `components/index.ts` (one `export * from './x';` line, alphabetical
neighbourhood; on an Edit conflict re-read and retry — never rewrite the
barrel). Wave 1 starts when every wave-0 package is green. Every package:
no `git commit/push/checkout/stash/reset`; undo by inverse edit;
`--skip-nx-cache` on typecheck; no emulator journey (integrator only).

**Per-package gate (every package, before reporting done):**
`pnpm nx run verify-tools:layering --skip-nx-cache`, `pnpm nx typecheck
<projects touched> --skip-nx-cache`, `pnpm nx lint <projects touched>`,
`pnpm nx test <projects touched>` (ecs-core for wave 0; plus the presenter
project for wave 1), baseline reds only.

### W0-A — visits systems · wave 0

**Owns:** `libs/ecs-core/src/systems/visit-story.system.ts` + spec,
`visit-list.system.ts` + spec, `waitlist.system.ts` + spec,
`components/visit-tone.data.ts`, `visit-status-mark.data.ts`,
`visit-mark.data.ts` (+ a spec each if the components convention has one),
`components/service-composition.data.ts` + spec (`drawnKind`).
**Brief:** implement §2.1 by porting V-1…V-14, G-3, G-4, G-13, G-14, G-15
and C-6 from the cited presenter lines (V-15 STAYS — no ecs-core change).
`subjectFigure` imports `./billing.system`; `lastWorked` takes the
caller's `outcomeOf` (no subject record, no staff flag, no exclusion —
§2.1); `upcomingSoonestFirst` shares the private `byStart`, never
`soonestFirst`'s `byId`; `peerCountOf` composes `peerCount`. Spec per function: purity (deepFreeze, same → same) and the
boundary cases of the pinning presenter cases (party share vs whole bill,
bill error → null, NO_SHOW/OPEN → null figure; marks order and the
taken-back redemption; guest quote; one vs two locations; a guest counted
by name once; the epoch-0 sort point; every day whole → no dayparts; none
ahead → all; unparsable today → all; `statusMark` × every outcome ×
PENDING/CONFIRMED; `toneOf` cancelled-upcoming is HOLLOW;
`upcomingSoonestFirst` keeps INPUT order on an equal day+minute and drops
non-upcoming items; `quotesBooker` unclaimed party (owner null) with a null
subject → false; `lastWorked` stable on equal instants, skipping a
non-WORKED newer one, calling `outcomeOf` no further than the first WORKED; `glancePick` paused/booked-after/lapsed/newest/others;
`offeredWith` in-force kept in menu order; `drawnKind(UNSPECIFIED)`).

### W0-B — wallet, vouchers, rewards, tiers, ledger · wave 0

**Owns:** NEW `systems/loyalty-pass.system.ts` + spec, NEW
`systems/wallet.system.ts` + spec, `voucher.system.ts` + spec,
`reward.system.ts` + spec, `tier.system.ts` + spec, `ledger.system.ts` +
spec, NEW `components/pass-state.data.ts`, `wallet-action.data.ts`,
`points-reach.data.ts`, `tier-plate.data.ts`, `ledger-line.data.ts`.
**Brief:** §2.2 by porting W-1…W-10, W-17…W-21, G-9, G-16 (W-11 is
W0-E's). `lineOf` keeps
the presenter's precedence and its CORRECTION default exactly (port every
ledger case 544–790, 878, 914 as a tag/paid/revoked assertion); `voided`
is the existing private helper exported, its old call sites unchanged.
`plate` is ported from glance:226-247 (top = current is the LAST step,
override → `progress: null`), never built on `progress()`. `heldTotal`
returns `Money | null` (null below 2 spendable or with 2+ currencies) and
composes `spendableSum`; it never returns a count. `held` takes the
`idOrder` comparator and shares a private by-last-day core with
`soonestFirst` (whose existing cases stay green untouched). `pointsReach`
takes `today` and composes `bestAffordable`/`nextAffordable`. `isStruck`
is ported with the ledger 495/720/745 cases; `WELCOME_SERIES_ID` is a
`BadgeSeriesId`. Specs:
purity + boundaries (balance −1/0/1; today = noticeFrom / = expireOn / the
day after; points off; paused wins; voucher expiring today kept,
yesterday dropped, never-expiring last, an equal-day tie decided by the
passed `idOrder` (both directions); untouched; two currencies; one held →
no total; tiles owing → reach from nothing, paused,
none takeable, catalogue order inside halves; pointsReach none/enough/
more with exact `short`; plate unknown tier / top / held above / ring
start at the threshold; standingTier no tiers / override; actions for a
companion, offline, gone visit, paused, one vs several ready, points off;
netsUnder each feed; isWelcome).

### W0-C — rhythm · wave 0

**Owns:** `systems/streak.system.ts` + spec, `streak-rule.system.ts` +
spec, `rhythm-draft.system.ts` + spec, `streak-preview.system.ts` + spec,
`streak-publish.system.ts` + spec, NEW `components/streak-outlook.data.ts`,
`rhythm-effective.data.ts`, `components/streak-rule.data.ts` (the order
constant; its spec if any).
**Brief:** §2.3 by porting W-12…W-16, R-1, R-2, R-4…R-8. Land
`StreakRuleSystem.isOnOn` FIRST and report it (W0-D2 waits on it).
`outlook`'s AT_RISK weeks call `ClientStatsSystem.cadenceWeeks` (W0-E —
wait for it; never a second `round(days/7)`); `nextDue` is gated on
`dueNamed`. `outlook` ports
`standingOf` (wallet:590-684) in its order, with the in-chair / not-started
line semantics of `rhythmStateLine` (loyalty:198-212) — the paused, FROZEN
and BROKEN branches of `rhythmStateLine` are dead (its only caller passes
`paused = false` and handles those itself) and are NOT ported; BROKEN is
repairable only when `phaseRepairableUntil ≥ today`. `started` =
`current > 0 ∨ lastQualifiedAtUtcMs ≠ null` exactly (spec 1121). R-3
needs no new code (track exists); add one `track` spec case for
`inChairToday: false, paused: false, dueBy: null`, and the FROZEN-open-mark
dating check of §7 R-12 as a spec over the admin sample's states. Specs:
purity + every walletRhythmVm case as an outlook assertion, weeks
rounding (3 days → 1, 10 → 1, 11 → 2), `nextDue` null for FROZEN / HELD
with `dueBy` set, `isOnOn` flag off / rule off /
unknown / another rhythm, `statedInterval` the six fallbacks, order NAME
last + unknown dropped + duplicates, the tomorrow-wins tie, movement with
a null side.

### W0-D1 — badges, achievements, records · wave 0

**Owns:** `systems/badge.system.ts` + spec, `achievements.system.ts` +
spec, `records.system.ts` + spec, NEW `components/medal-outlook.data.ts`
(+ type-spec proving each dictionary's values), `components/gamification.data.ts`

- spec (two metric sets + companion members).
  **Brief:** §2.4 by porting M-1…M-3, M-5…M-7, M-9, M-10, M-23, M-25,
  M-29…M-35, M-37…M-39, G-6, G-7, G-17 (M-4 is W0-D2's). M-1
  (`AchievementsSystem.EARLY_BIRD_LAST_MINUTE`, already exported at
  achievements.system.ts:66) and M-24 (`RecordsSystem.RECORD_ORDER` /
  `NEW_RECORD_DAYS`, already exported at records.system.ts:45-46) need no
  wave-0 code — only P4's re-point. Land `levelsShown`, `toNext`,
  `nextLevelNumber` and `isOneOff` FIRST and report them (W0-D2 waits on
  them). No signature takes a `TimeZone`: `workedVisitOf` returns the
  zone-free facts, `countedDraft` takes branded inputs, `countedVisits`
  takes the edge-built `{ appointment, counted }` pairs (§2.4). `completesWithVisit` is an EXACT port of
  achievements:432-504 (first-non-null-scope precedence, scopes ignored for
  early bird, false for weekend/on-time/party, the earliest leg MINUTE) —
  do not call `countsToward`; its JSDoc says why (§7 R-1, §8 OQ-2).
  `countedDraft` keeps md:381-390's defaults byte for byte (`LocationRefId.of('')`
  as today — check the brand's constructor accepts it the way the presenter
  does). Specs: purity + every pinning case listed in §1.4 as values/tags
  (birthday act same-year vs previous-year, season CLOSED/ANNOUNCED/OPEN,
  one short, the four metric switches, a seasonal series with a NULL phase
  → false in both `completesWithVisit` and `draftCountsToward`, landsOn
  never before today, `captionOf` with an ungated `landsOn` on an ended
  family, ladder of a single act, ring span ≤ 0, isHeld one case per kind
  incl. LONGEST_RHYTHM with `on: null` held, years only on a complete
  history + only WORKED + only this customer, `countedDraft`'s defaults
  with a null start and a null location).

### W0-D2 — standing, seasons, catalogue · wave 0 (after W0-D1's members and W0-C's `isOnOn`)

**Owns:** `systems/standing.system.ts` + spec, `season.system.ts` + spec,
`loyalty-catalog.system.ts` + spec.
**Brief:** §2.5 by porting M-4, M-8, M-11…M-22, M-26…M-28, M-36, G-20,
G-21. Keep the three season family lists distinct (§7 R-3): `familiesIn`
unchanged, `neighboursOf` uses `SeasonSystem.familyIds` WITH the track,
`windowFamilies` prepends the track WITHOUT the retired filter.
`earnedOnly` is a separate step, never inside `familiesIn`/`familyCounts`
(§7 R-5). `rhythmLive` is `flag ∧ some head isOnOn(h, today, true)` —
import W0-C's `isOnOn`; `recentFreshLevelsByDay` returns `levels` AND
`fresh` per day with no day limit (§2.5); `strip` takes ONE
`completingFirst`; `stripCue` follows §2.5's precedence and level sources
and calls `BadgeSystem.nextLevelNumber`; `almostEarned`'s under-way test
is `progress.value > 0`. `soonIds` limits `closestLevels` before merging the acts then
slices; `almostEarned` takes `closestLevels(∞)`, filters, partitions
pending → under way, then slices — share only the acts-first helper (§7
R-10). `strip` / `stripCue` take ids and standings only (no presenter import,
Law 8). Specs: purity + the pinning cases of §1.4/§1.5 (band order ties,
ended season scope, archived event counts, the rhythm-off shelf, «Сезони»
inputs, the medal strip's four cases, glance's three medals, a fresh-days
day whose second level is on a newer day — `levels` 2, `fresh` 1, an
earned value-0 family not «almost», `rhythmLive` agreeing with `isOnOn`,
`stripCue` NEW on equal stamps reading the given level).

### W0-E — stats, glance, age, grants, phone, punch cards · wave 0

**Owns:** `systems/client-stats.system.ts` + spec, `age.system.ts` + spec,
`coupon-grant.system.ts` + spec, `client-glance.system.ts` + spec,
`phone.system.ts` + spec, `components/punch-card.data.ts` (the NEW
`PunchCard` companion) + a NEW `punch-card.data.spec.ts`, NEW
`components/client-history.data.ts`, `components/birthday-moment.data.ts`.
**Brief:** §2.6 by porting G-1, G-2, G-5, G-8, G-10, G-11, G-12, G-18,
G-19, G-22, W-11. Land `ClientStatsSystem.cadenceWeeks` FIRST and report
it (W0-C waits on it). Compose, never re-loop: `birthdayMoment` on
`nextBirthday`, `repeatOffer` on `sameLegs`, `forOccasion` and
`besideOccasionGift` on one private predicate over `isOccasion`.
`dialable` takes `E164 | null` and the edge-stripped seat digits. `statWindowsOnDay` and `statWindows` share one private core;
`statWindows`' existing cases stay green untouched. `tenureOf` keeps the
hero's three-way FIRST_VISIT predicate; `historyNote` keeps visits 0 →
FIRST_VISIT (null stats count as 0) — two predicates, never one (§7 R-8).
`BirthdayMoment` values identical to client-pages.vm.ts:494. Specs: purity

- cadence 1/3/4/10/11 days, the three notes, tenure with null stats / zero
  visits / null first day / null cadence, 12-month boundary (the records
  cases 532/557), no-shows 1/2/older than 90 days/no stats, birthday today /
  in 1 / in 7 / in 8 / across the year end / 29 February, gift carried or
  not, `forOccasion` keeps only the occasion's grants (null occasion
  dropped), repeat offer's seven refusals, dialable account-first / seat
  digits / no digit, punch card full / over-full / empty.

### P1 — the catalog · wave 1

**Owns:** `libs/features/shared/catalog/src/lib/content/catalog.presenter.ts`,
`catalog.vm.ts`, `catalog-presenter.service.ts`, `catalog-content.service.ts`
(only if a VM call site needs it), `libs/features/marketing/landing/src/lib/content/landing-content.service.ts`,
`landing-content.ts`, `sections/team-showcase/team-showcase.component.ts`,
`test-catalog.providers.ts`, the shared catalog lib's `index.ts` (drop
`servicesByBarber`), and the FIXTURE literals only of
`service-detail-sheet.component.spec.ts` (SERVICE, SHAVE, BUNDLE) and
`service-row.component.spec.ts` (CUT, BUNDLE).
**Brief:** D-10 and C-1…C-6. `serviceToVm` computes the three fields from
`CatalogPricingSystem` on the `Service` (major units = cents / 100);
`servicePriceFrom`/`serviceDurationRange` read them; `serviceMeta` reads
`cardPrice`; delete both `pricedOf` + helpers. `compositionKind` via
`ServiceComposition.drawnKind`. The anonymous offering STAYS (D-3), its
comment re-worded ("the service detail sheet's bundle saving reads it").
`barberPrices(barberId)` on `LandingContentService` per C-5;
team-showcase calls it. Fixture fields = exactly what the deleted shim
returned for each literal (compute them from its code before deleting).
Gate: `pnpm nx test shared-catalog marketing-landing client-booking
client-onboarding` + `pnpm nx build web`.

### P2 — the visits lib · wave 1

**Owns:** `libs/features/shared/visits/src/lib/visit-row.presenter.ts`,
`visit-card/visit-card.presenter.ts`, `visit-sections.ts`, `visit-row.vm.ts`
(only if a table type is needed).
**Brief:** V-1…V-14 (V-15 STAYS: `visit-sections.ts` untouched). The row: `toneOf` → `VISIT_TONE_WORDS`;
`struck: VisitStorySystem.isVoid`; `statusMark` per §2.1; `isWholeParty`
for `alone`; `subjectFigure` + `formatCents` replaces `priceOf`; `marksOf`
→ icon/label table, the `words.voucher !== undefined` guard kept;
`quotesBooker` (its own `subjectUserId !== null` guard) ∧ `clientWords !== false`; `namesShop`; `subjectBarberIds`;
`subjectRecordOf` (raw `subjectCustomerId` parsed with `CustomerId.of` at
the edge as today) inside `storyOf`; `peerCountOf` (delete
`peersOf`/`personSubjectOf`); waitlist through `daysAhead` →
`daypartsWatched` → `sortPoint` in that order (filter first, §7 R-11;
delete `WAITLIST_UNDATED`). The card: `namesShop` + its staff ∧
last gate; `subjectBarberIds`; `statusMark` under OPEN ∧ NEXT; `amountOf`
STAYS (D-3). Gate: `pnpm nx test shared-visits
client-appointments staff-client-card`.

### P3 — wallet, ledger, loyalty, the store gate · wave 1

**Owns:** `libs/features/staff/client-card/src/lib/wallet.presenter.ts`,
`ledger.presenter.ts`, `loyalty.presenter.ts`, `client-card.store.ts` (the
`rewardsUsable` computed ONLY).
**Brief:** W-1…W-21. `passVm` from `LoyaltyPassSystem.passOf` (the
presenter keeps `signedFigureOf`, unit agreement, `dayShort`); tier plate
and ring via `standingTier` + `keptAt` + `atTop`; vouchers via `held(…, today, (a, b) => a.localeCompare(b))`
(the bad-today parse → `[]` kept; tie order unchanged), `untouched`,
`heldTotal` (its Money only — `walletSum`'s first argument stays
`holdings.length`, every holding); tickets and
discs via `WalletSystem` (a tag → disc table reproducing ids
`'use'|'code'|'catalog'|'history'`, icons, prominence, order); tiles via
`RewardSystem.tiles`; stamps via `PunchCard.progress`; rhythm via
`isOnOn(…, flags.streaks)` + `StreakState.find`, `StreakSystem.outlook`
(presenter converts `lastQualifiedAtUtcMs` with `shopDayOf` →
`lastQualifiedOn`, D-11; the track name reads the GATED `nextDue`),
`record`, `protectionsHeld`; delete the wallet:881 comparison. Keep
`rhythmStateLine` / `rhythmLabel` exported with their signatures as
delegates that word the outlook (glance/records/store may import them).
Ledger: `LedgerSystem.voided` (delete the copy), `isStruck` in `rowOf`
(no `.some` left), `lineOf` → one tag → draft table, `isWelcome`,
`netsUnder`. Store: `rewardsUsable` =
`context !== null && WalletSystem.writable({ isOwner: context.isOwner,
visitGone: context.gone, online: this._online(), paused: this.paused() })`.
Gate: `pnpm nx test staff-client-card` (alone if it times out).

### P4 — medals, achievements, medal detail · wave 1

**Owns:** `achievements.presenter.ts`, `medals.presenter.ts`,
`medal-detail.presenter.ts`.
**Brief:** M-1…M-39 against §2.4/§2.5, every exported name kept (D-9) as
a delegate with its `AchievementsData`/string-`today` signature; build
`DraftVisit` once per call at the edge (ZonedTimeSystem for the leg
minute as today); medal-detail keeps every zone conversion at its edge:
`AchievementsSystem.workedVisitOf` + its own `ZonedTimeSystem.toUtc` for
`startUtcMs` → the `CountedVisit`; `draftStart` + the `*RefId.of`
parsing → `countedDraft`'s branded input; the `{ appointment, counted }`
pairs → `countedVisits` (delete `LAST_MINUTE_OF_DAY`/`WEEKDAY_MONDAY` —
the defaults live in `countedDraft`); `captionOf` receives the UNGATED
`landsOn`, the meter the gated one; the latest tiles read
`recentFreshLevelsByDay`'s `levels` (single-vs-group, «+N») and `fresh`
(the face); `MEDAL_STATES` keeps its `Record<MedalState, …>` and a
second `MEDAL_RING_STATES: Record<MedalRingState, UiMedalState>` adds
`complete`; `NEW_RECORD_DAYS`/`RECORD_ORDER` re-exported from
`RecordsSystem`; the `artOwnersOf` cache and face logic untouched;
`medalScopeVm` counts with `earnedAmong` over series, never VM strings.
Gate: `pnpm nx test staff-client-card`.

### P5 — card, glance, records, history, visits page · wave 1

**Owns:** `client-card.presenter.ts`, `glance.presenter.ts`,
`records.presenter.ts`, `history.presenter.ts`, `visits-page.presenter.ts`,
`client-pages.vm.ts` (the `BirthdayMoment` re-export only).
**Brief:** G-1…G-21 + W-12's glance/records copies. `cadenceWeeks` export
delegates; `historyNote` drives the history facts AND visits-page's NO_RISK
note (cells unchanged, same ids and order); `historyRows`/`visitsRows`
via `distinctById` (both names kept); `offeredWith`; `statWindowsOnDay`
(drop `endOfDay`, `LAST_MINUTE`, the zone import if unused);
`usualBeyondFavourite`; `yearsOfHistory`; `tenureOf` in the hero and
`clientHeadVm` (the head words SINCE and SINCE_CADENCE alike as
`head.since` — never the cadence); `TierSystem.plate`; `noShowWarning`; `birthdayMoment`;
`forOccasion` in `birthdayVm` (both grant lists) and `besideOccasionGift`
in `grantsBesideBirthday`; `upcomingSoonestFirst` over the appointments
minus the current one (D-2.6) — `[0]` for the next card, the list for
`glancePick`; `lastWorked(rest, a => rowOf(a).outcome)` inside
`lastWorkedVisit` (signature kept: it drops `currentAppointmentId` first,
the store's lookup closure keeps working); `glancePick`;
`pointsReach(…, today)` (the offered + held-name pre-filter kept); records
calls `isOnOn(input.rhythm, today, true)` (no flag — the store folded it);
`dialable` (the edge strips the seat's `tel:`/non-digits); `glanceLine`; `repeatOffer`; `dialable`;
`cueOrdered`; `strip` + `stripCue` fed by P4's delegates
(`completesWithThisVisit`, `newestFaceLevel`, `soonSeriesIds`,
`previousVisitOf` — call them, never re-derive; `completingFirst` =
`cueOrdered(catalog, families.filter(completesWithThisVisit))[0]`).
`client-pages.vm.ts`: replace the `BirthdayMoment` declaration by
`import { BirthdayMoment } from '@core/components'; export {
BirthdayMoment };` — the file keeps using the name locally;
`birthdayMomentWords` and `BirthdayVm` untouched. Drop
`RECORD_LINE_ORDER` (→ `RecordsSystem.GLANCE_LINE_ORDER`). Gate: `pnpm nx
test staff-client-card`.

### P6 — rhythm words · wave 1

**Owns:** `libs/features/admin/loyalty/src/lib/admin-rhythm/admin-rhythm.words.ts`,
`libs/features/shared/visits/src/lib/rhythm-rule/rhythm-rule.words.ts`.
**Brief:** R-1…R-8. `effectiveReading`, `signedDelta`, `changeWord` keep
their signatures. R-3 (`samplePeriods` → `StreakSystem.track`) only if
W0-C's equivalence spec (§7 R-12) is green; otherwise leave `samplePeriods`
and record it in §9 as carried. Gate: `pnpm nx test admin-loyalty
shared-visits`.

### G — integrator · after wave 1

Runs §5 and §6, fills §9, rules any package conflict, updates HANDOFF §2
(the Law 10 row → "decision-extraction pass done") and §3.3 "Carried
forward" (§8's carried items). Owns no source file but the `client-card.format.ts`
`dayPlus` deletion if `grep -rn dayPlus libs` shows no reader.

---

## 4. Specs

### 4.1 New system specs (wave 0)

One `describe` per new function inside the existing `<system>.system.spec.ts`
(new spec files for `loyalty-pass`, `wallet`, and the component spec
`punch-card.data.spec.ts`), each with:
the purity case of `ecs-systems.md` (deepFreeze inputs, call twice,
`toEqual`), and the boundary cases listed per package in §3 — every
presenter case cited in §1 for that decision re-stated as a value/tag
assertion on the same fixture data (`@core/testing` loyalty fixtures —
Георги, Мартин — where the presenter spec used them). Never the wall
clock. New component dictionaries: a type-spec (or spec) that each
dictionary's values are the listed SCREAMING literals and that an entity
intersection using a new field is not `never` where one exists.

### 4.2 Presenter specs — UNCHANGED

Every `*.presenter.spec.ts`, `*.words.spec.ts`, `client-pages.vm.spec.ts`,
`visit-sections.spec.ts`, `day-range.spec.ts` passes unchanged; the only
permitted edit is an import line re-targeted to a moved name. Expected
count of such edits: 0 (D-9 keeps every exported name). Baseline red
`visits-page.presenter.spec.ts` "strikes an hour that did not happen"
stays red, unchanged.

### 4.3 Other spec edits (the complete list)

- `service-detail-sheet.component.spec.ts` (SERVICE, SHAVE, BUNDLE) and
  `service-row.component.spec.ts` (CUT, BUNDLE) — the three D-10 fields
  added to each literal, values = the old shim's answers; no expectation,
  no test body changes (§8 OQ-1).

Nothing else. A package that finds another spec needing an edit stops and
reports it (a hidden behaviour change).

---

## 5. Leftover checklist (integrator, after wave 1)

Run over the 24 presenter/words/format/vm files of §1 (bash, from the repo
root; `F` = the file list):

```bash
F=$(git ls-files 'libs/features/**/*.presenter.ts' 'libs/features/**/*.words.ts' \
  'libs/features/**/*.format.ts' 'libs/features/**/*.vm.ts' \
  libs/features/shared/catalog/src/lib/content/catalog-presenter.service.ts \
  libs/features/shared/visits/src/lib/visit-sections.ts | grep -v spec)
# 1. Deleted copies — expect 0 lines each:
grep -nE "pricedOf|POSITIVE_INFINITY|function voidedIds|const NEVER|'9999-12-31'|'series-welcome'|EARLY_BIRD_LAST_MINUTE *=|NEW_RECORD_DAYS *= *30|RECORD_ORDER *= *\[|CHANGE_ORDER|28 \* \(1|function priceOf|function peersOf|personSubjectOf|function endOfDay|NO_SHOW_CAPSULE_AT *=|BIRTHDAY_NOTICE_DAYS *=|RECORD_LINE_ORDER|WAITLIST_UNDATED|LAST_MINUTE_OF_DAY|WEEKDAY_MONDAY|const LAST_MINUTE\b|function isBirthdayGrant" $F
# 1b. The wallet's id collation is the ONE localeCompare left — expect exactly 1 line, inside the
#     comparator passed to VoucherSystem.held (D-13 DEP-1 withdrawn):
grep -nE "localeCompare" $F
# 1c. One home of the weeks rule in ecs-core — expect exactly 1 line (client-stats.system.ts):
grep -rnE "round\(.*/ *7\)" libs/ecs-core/src/systems --include='*.system.ts'
# 2. Brand arithmetic / raw date compares in presenters — expect 0:
grep -nE "utcEpochMs *-|UtcMs *-|\.localDate *[<>]=?|today *[<>]=?|[<>]=? *today\b|>= *noticeFrom|<= *expiresOn" $F
# 3. Domain sorts and filters — every hit reviewed; allowed only over WORDS or host lookups:
grep -nE "\.sort\(|\.filter\(|\.reduce\(|\.some\(|\.every\(|\.find\(" $F
# 4. Numeric thresholds and min/max — every hit reviewed against D-2.2/D-2.4 (zero form, layout, geometry):
grep -nE "Math\.(max|min|round|abs)|[^=!]==?= *[1-9]|> *[1-9]|>= *[1-9]|< *[1-9]|\.length *[<>]" $F
# 5. State choices on stored tags outside a tag→word table — every hit reviewed:
grep -nE "=== *(VisitRowOutcome|BookingStatus|StreakPhase|MedalState|SeasonPhase|JournalEffect|JournalFeed|CompositionKind|StreakIntervalSource|Metric|BadgeSubject|SeasonKind)\." $F
# 6. Every new system function has a caller and a spec — list each §2 name and grep both:
#    grep -rn "VisitStorySystem.toneOf" libs/features ; grep -n "toneOf" libs/ecs-core/src/systems/visit-story.system.spec.ts
# 7. Every "composes" line of §2 / D-4 holds — the named reuse appears in the new function's body, e.g.:
#    grep -n "spendableSum" libs/ecs-core/src/systems/voucher.system.ts   (inside heldTotal)
#    grep -n "bestAffordable\|nextAffordable" libs/ecs-core/src/systems/reward.system.ts (inside pointsReach)
#    likewise years/nextBirthday/sameLegs/peerCount/isOnOn/cadenceWeeks/recentLevelsByDay/nextLevelNumber
# 8. No zone in a system but zoned-time — expect only zoned-time.system.ts:
grep -lE "ZonedTimeSystem\.(toUtc|shopNow)\(" libs/ecs-core/src/systems/*.system.ts
```

Review rule for 3–5: a surviving hit is legal only when it (a) maps a
system's tag to words/icons/tokens, (b) is a zero-form test on ONE
system-given count, (c) is layout/geometry/a display cap, (d) filters a
host lookup's display data, or (e) is UI read-state — each recorded in §9
with its D-2 clause. Anything else is a missed decision: back to its
package.

Plus: `pnpm nx lint` green with `creativo/presenter-purity`,
`creativo/error-dictionary-home`, `creativo/no-sliced-ports`,
`creativo/no-generic-discriminator`; no new `*ErrorCode` outside
`src/errors`; no `Pick`/`Omit` of a `*Ports` type; every new dictionary
field domain-prefixed (no `kind`/`type`/`status`).

---

## 6. Integration and gates

### 6.1 Order

1. Wave 0: W0-A, W0-B, W0-C, W0-D1, W0-E in parallel; the three declared
   edges of §3 — W0-D2 after W0-D1's `levelsShown`/`toNext`/
   `nextLevelNumber`/`isOneOff` AND W0-C's `isOnOn`; W0-C's `outlook`
   weeks after W0-E's `cadenceWeeks`. The integrator runs the static gate (§6.2 lines
   1–6) on the wave-0 tree before wave 1 starts.
2. Wave 1: P1…P6 in parallel (disjoint files; P5 calls P4's exported
   delegates, whose signatures D-9 freezes, and P3's `rhythmStateLine`/
   `rhythmLabel`, likewise).
3. G: §5 checklist, the FULL gate, the smoke, §9.

### 6.2 The gate (HANDOFF §4, unchanged)

```bash
pnpm nx sync:check
pnpm nx run verify-tools:layering --skip-nx-cache
pnpm nx run-many -t typecheck --skip-nx-cache
pnpm nx run-many -t lint
pnpm nx run-many -t test --parallel=3          # re-run staff-client-card / staff-dashboard / marketing-landing alone on timeout
pnpm nx test ecs-core --coverage               # statements stay ≥ 97.85 %, files +2 (loyalty-pass, wallet; punch-card.data.ts gains a companion)
pnpm nx typecheck seed-tools
pnpm nx build web && pnpm run verify:bundle    # initial ≈ 604 kB; a growth beyond ~+3 kB raw gets a reason in §9
pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs
# runbook §4.0, §4.2–§4.5, §4.7, §4.8, §4.9 grep gates (counts as HANDOFF §4)
# ONE AT A TIME:
pnpm run verify:p0
pnpm run test:emulator
pnpm run e2e:web                               # exactly the 19 baseline failures, 41 passed
```

Baselines (not regressions): typecheck of `patterns`; `gauge.spec.ts` (4),
`visit-pills.spec.ts` (1), `visits-page.presenter.spec.ts` "strikes an
hour that did not happen" (1); e2e 19 (6 `*-screenshots`,
`landing.spec.ts:121`, 12 `client-card-glance.spec.ts` at `:343`/`:686`);
`appointments.spec.ts:152` and the landing-screenshots hero may flake
under load (re-run alone, `--repeat-each=3`). Test count: 10,888 + the new
system cases; a drop is a lost case.

### 6.3 Dev-stack smoke (the integrator, against a HEAD copy of `fd5f2a6`)

The UI residue plan's §8.1 method: emulators up, `pnpm run seed:dev`, the
integrated tree and a worktree-free HEAD copy of `fd5f2a6` served on the
same emulators; staff sign-in by custom token for `dev-staff-ivan` +
`window.__e2eSignIn`; record each screen's DOM signature (text + `data-*`
attributes of the region) in bg and en and diff. Screens:

1. **Staff client card — hero** (Георги, Мартин): tenure line (first visit
   / since / since + cadence), tier plate (top, climbing ring, held
   above), reliability capsule, birthday band/notice (Мартин), capsules
   run, «Пак същото», call/sms links.
2. **Wallet**: the pass (points / owes / expiring / frozen / points off),
   vouchers (order, untouched chip, the total), tickets, stamp card, the
   discs (USE/CODE/CATALOG/HISTORY for owner, companion, offline, paused),
   reward tiles, the rhythm section (track, outlook line, capsule, best,
   protections, upcoming rule), activity rows.
3. **Ledger page**: every row kind of Георги's journal, struck reversals,
   month nets under «Всички»/«Точки» and none under other pills.
4. **Medals page + a medal detail**: chips, sections (folded at 10), «Почти
   спечелени», season track + events + archive, the empty hint; one detail
   per kind (counted ladder, single act, tenure, season family): state
   line, progress card, ladder, «Как се печели», counted visits,
   neighbours, the add-service action.
5. **Records**: featured record, groups, the 12-month row, usual services,
   years chart.
6. **History / visits pages**: head facts and cells, filter menu (the one
   in force), sections and their figures (month ≥ 2, year ≥ 1), rows (tile
   tone, struck, status words, figure share vs bill, marks, quote, shop
   name with two locations), waitlist row, end label.
7. **Glance visit cards**: last (figure, photos), next (status capsule),
   waitlist card; the medal strip; the points sentence; the records line.
8. **Catalog**: `/book` services step (card meta «от …» with spread, a
   fixed price without «от»), the service detail sheet (duration range,
   from price, performers, bundle saving), the landing shelf tiles and the
   team showcase barber prices, onboarding's service grid.
9. **Client `/account` appointments list**: rows (upcoming tone, cancelled
   struck, status), the card.
10. **Admin rhythm page**: digest, the tolerance example, effective-day
    reading, the preview deltas, version history rows (first rule by the
    system, «и още N»), the sample track.

Every signature identical (no departure, D-13) but the now-label minute;
DEP-3 (a 23:59 DST gap) is unreachable on the seed's zone — record "not
exercised". Vouchers tied on one expiry day and two upcoming visits at the
same minute keep their `fd5f2a6` order.

---

## 7. Risks

- **R-1 `completesWithThisVisit` ≠ `countsToward`.** First-non-null-scope
  precedence vs AND of scopes; early bird ignores scopes; weekend/on-time/
  party false vs true; earliest leg MINUTE vs earliest INSTANT. Port
  exactly as a separate function (D-6); unifying them changes the glance
  strip, AF and four specs (§8 OQ-2).
- **R-2 `heroTier` ≠ `TierSystem.progress`.** Top = current is the last
  step (not next null); override → progress null (not a floor ring); ratio
  `(value − current.atLeast)/span`. `plate` is its own port.
- **R-3 three season family lists.** `familiesIn(SEASON)` excludes the
  track; `relatedOf` uses `familyIds` with it; `windowFamilies` prepends
  it without the retired filter. Collapsing them moves the neighbour rails
  and the collection figures.
- **R-4 two "earned" readings.** `familyCounts` counts `earned.length > 0`;
  the presenters count `medalState === EARNED`. `earnedAmong` takes the
  presenters'; equal while level numbers start at 1 (`shapeProblems`).
- **R-5 earned-only inside `familiesIn` would shrink archived tiles'
  «N от M».** Keep `earnedOnly` a separate step.
- **R-6 `rhythmStateLine`'s dead branches.** Its BROKEN branch names the
  repair day without the `≥ today` check; porting it would start naming a
  past day. `outlook` takes `standingOf`'s live path only.
- **R-7 additive only (D-5).** A field added to `SubjectStory`,
  `SeriesStanding`, `TierProgress`, a value added to `MedalState` or
  `StreakTrackMarkKind`, breaks existing `toEqual` specs and every
  `satisfies Record<…>` table.
- **R-8 two first-visit predicates.** Hero/head: stats null ∨ visits 0 ∨
  first day null. History/visits page: visits 0 (and the end label is
  null, not «Първо посещение», when visits > 0 with no first day).
  `tenureOf` and `historyNote` stay two functions.
- **R-9 records' first-visit precedence hangs on `recordCardVm`** (a host
  name lookup); moving half of it changes which source wins — STAYS (D-3).
- **R-10 soon vs almost limits.** `soonIds` limits before merging acts and
  slices again; `almostEarned` limits last after filtering and
  partitioning. Share only the acts-first helper.
- **R-11 waitlist order of derivation.** Filter ahead first, then
  dayparts, runs and the sort point — all from the filtered days.
- **R-12 `samplePeriods` vs `StreakSystem.track`.** `track` dates a FROZEN
  open mark at `phaseFrozenUntil` and draws it even with `dueBy` null;
  the sample dates it at `dueBy` and draws nothing without it. Equal only
  if the projector sets `dueBy = phaseFrozenUntil` while FROZEN. W0-C
  proves it with a spec over the projector's FROZEN states; if not
  provable, R-3 is carried, `samplePeriods` stays (P6).
- **R-13 toleranceExample rounding** moves from `round(28·(1+p/100))` to
  `daysFor`'s `round(28·(100+p)/100)`: identical for integer percents
  (28p ≡ 50 mod 100 has no integer solution). Recheck if the slider ever
  allows fractions.
- **R-14 admin rows vs `StreakRuleSummary`.** The summary nulls
  protections/hold at a max of 0; the rows read only the `*Enabled`
  flags. Do not switch sources.
- **R-15 catalog VM shape.** Required fields break hand-built literals
  (two component specs — fixed per §4.3) and the landing `SERVICES` list
  (retyped). The anonymous offering stays for the sheet's saving math.
- **R-16 the voucher bad-today path.** `spendableOf` returns `[]` on an
  unparsable today while `dayOf` elsewhere throws a defect; the parse stays
  at the presenter edge so neither path changes (D-11).
- **R-17 the ClientGlance voucher sum ≠ the wallet total.** First-currency
  sum vs mixed → null. Never reuse one for the other; the glance rule is
  left as is (§8 OQ-5).
- **R-18 cross-package edges in wave 1.** P5 reads P4's and P3's exported
  delegates; D-9 freezes their signatures, so P5 builds against the
  `fd5f2a6` signatures. A package that must change an exported signature
  stops and reports.
- **R-19 `staff-client-card` spec timeouts** under `run-many --parallel=3`
  — re-run alone before calling a regression.
- **R-20 barrel races in wave 0** — one-line appends, re-read on conflict;
  the layering verifier catches a duplicate home.

---

## 8. Open questions (owner) — with the default this plan applies

- **OQ-1 — component spec fixtures.** The catalog VM's three required
  figure fields mean five literals in two component specs gain fields
  (values only). Default: allowed (§4.3) — no expectation changes, and the
  alternative (optional fields + a kept reverse-mapping shim) keeps the
  copy this pass exists to delete.
- **OQ-2 — one "this visit counts" rule?** The cue rule
  (`completesWithVisit`) and the detail/count rule (`countsToward`) differ
  (R-1). Default: both kept, documented side by side; unifying them is an
  owner ruling with a visible change (glance strip, AF).
- **OQ-3 — the service detail sheet's math** (performers cheapest-first,
  bundle saving) is domain math in an Angular component, outside the
  presenter pass. Default: carried — `CatalogPricingSystem.performersByPrice`
  / `bundleSaving` in a follow-up, which then retires the anonymous
  offering.
- **OQ-4 — keys built from display words.** The grant group key (title +
  value label) and the glance's held rewards by NAME need a coupon id /
  `RewardId` on the card contracts. Default: carried (contract change).
- **OQ-5 — the glance voucher sum** adds the first currency only, the
  wallet refuses mixed currencies. Default: both kept as they are; the
  owner rules whether the glance should follow the wallet.
- **OQ-6 — read-policy constants in `history.presenter.ts`**
  (`HISTORY_PAGE_SIZE`, `FILTER_REFILL_*`). Default: left; they belong to
  the store or `PagingSystem` in the T1/paging follow-up.
- **OQ-7 — DEP-1 / DEP-2 tie orders.** Revised: WITHDRAWN (D-13) — the
  pass is frozen, the plan has no owner ruling to change a tie order. The
  wallet keeps its `localeCompare` ties (a comparator parameter of
  `VoucherSystem.held`), the glance keeps input order on equal starts
  (`upcomingSoonestFirst` is stable without `byId`). Whether the wallet
  and the glance should follow the list's code-unit / id tie-breaks is an
  owner question for later; default: no change.
- **OQ-9 — the canonical example of `presenters.md`.** It calls
  `LoyaltyPassSystem.passOf(input.account)` and reads `pass.points`; the
  landed binding is `passOf(account, view)` with `figure` (balance OR
  `tierQualifying` with points off — `points` would misname it). Default:
  the code follows §2.2; G owner-flags a one-line update of the rule
  file's example to the landed signature (no agent edits `.claude/rules`
  without the owner) and records it in §9.4.
- **OQ-8 — `samplePeriods` → `track`** if the equivalence of R-12 does not
  hold. Default: `samplePeriods` stays, carried.

---

## 9. Ledger (filled by the integrator)

Integrated 2026-10-23 on `main` (HEAD `fd5f2a6`, uncommitted tree) by G.
Every wave-0 and wave-1 package's files were in the tree as handed over; no
package conflict needed a ruling. The integrator's one source edit: the
`client-card.format.ts` `dayPlus` deletion (D-3 row; `grep -rn dayPlus libs
apps tools` showed no reader).

**Closed 2026-10-23 by the decision-extraction integrator (G2)**, who took
the packages' open notes, ran the FULL gate (the three emulator journeys
included) and the §6.3 dev-stack smoke (§9.3). Its edits, each re-gated:

- **The typecheck blind spot (P1).** `tsc --build` judged
  `marketing-landing`'s `tsconfig.spec.json` up to date from a stale
  `dist/out-tsc` buildinfo, so the static gate passed while
  `catalog-navigation.service.spec.ts` no longer compiled (TS2345 ×4: its
  helper hands `SERVICES` — now the figure-free `ServiceSourceVm` of §2.7 —
  to `CatalogNavigationService.open(service: ServiceVm)`). A type-only fix
  (§9.2); every typecheck of §9.3 ran after `rm -rf dist/out-tsc`.
- **One home for «Скоро» beside the newest (P5).** `medalStripVm` dropped
  the newest family from «Скоро» to find the cue's closest while
  `StandingSystem.strip` applied the same rule inside — a second copy.
  `strip` now also answers `closestId` («Скоро»'s first family beside the
  newest one's, whatever the limit) and the presenter reads it; the strip
  cases pin it and one new case covers the limit and the newest-only list
  (G-21).
- **The ledger's TIER narrowing (P3).** The presenter's
  `leading.journalEffect === JournalEffect.Tier ? … : defect(…)` became
  `JournalEffectRecord.isTier(leading)` — a guard on the component
  companion beside `movesBalance`, with its own case
  (`journal-effect.data.spec.ts`); check 5 has no ledger hit left (W-19).
- **The reserved publisher uid (W0-C's note).** `@core/testing`'s
  `FIXTURE_STREAK_FIRST_PUBLISHER` and the seed's `SEED_RULE_PUBLISHER`
  were two more `UserId.of('system')` copies; both now read
  `StreakPublishSystem.SYSTEM_PUBLISHER` (testing and the seed may import
  systems).
- **Docs.** `catalog-pricing.system.ts`'s JSDoc names its callers
  (`catalog.presenter.ts` `serviceToVm`, `LandingContentService.barberPrices`);
  this file's §0–§8 tables Prettier-aligned (whitespace only).

Rulings on the packages' other notes (no code):

- **Barrel lines (W0-A, W0-B, W0-C, W0-D1, W0-E).** Kept: §3 tells every
  package that creates a component or system file to append its own export
  line, and the files were outside the computed owned lists only.
- **Dictionary specs (W0-A, W0-B).** §4.1 asks for "a type-spec (or spec)"
  of each new dictionary's values; the system specs pin them (and
  `medal-outlook.type-spec.ts`) — accepted, no per-component spec added.
- **`CouponGrantSystem`'s `OccasionTagged = Partial<{ couponOccasion }>`
  (W0-E).** Kept: the host's `ClientCardGrant.couponOccasion` is optional,
  and `client-card.contracts.spec.ts` pins exactly that (`CouponOccasion |
null | undefined`, a grant built without it still a grant) — making it
  required is a spec change this pass may not make. Carried (§9.4).
- **`loyalty.presenter.ts` `stack` (P3)** — D-2.3 (one vs a count over
  `RewardSystem.groupGrants`' group), as §9.1.1 records. **`cueOrder` (P5)**
  — kept as the comparator over `cueOrdered` because
  `client-card.contracts.spec.ts` requires the export; it has no in-repo
  caller. **`completingOf` vs `medalStripVm`'s filter (P5)** — two
  compositions of the same per-family answer (a set for P4, the
  cue-ordered first family for the strip, §2.5's prescribed form); no rule
  is copied. **`signedDelta` (P6)** — kept for its pinned signature
  (`admin-rhythm.words.spec.ts`), wording only. **The `dayOf` parses
  (P3, P6)** — every caller passes a store `LocalDate`; nothing on screen
  changes. **The closed-mark words (P6)** — two word sources for one tag
  family, carried (§9.4).

### 9.1 Per decision

"Spec" names the `it` blocks the decision's system function gained in its
own spec (purity case included); the per-file totals are §9.1.2. "§5" names
the §5 grep hits on the presenter side (ruled in §9.1.1); "—" means none.

| ID   | Package                  | System function (file)                                                                                                                                                  | System spec cases added                                                                                                                                                                                                      | Presenter now calls                                                                                                                                                                                                                                           | §5 hits ruled                                             | Status                    |
| ---- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------- |
| C-1  | (no ecs-core change), P1 | `CatalogPricingSystem.priceFrom` / `cardPrice` / `durationRange` (catalog-pricing.system.ts, reused)                                                                    | none — its existing cases                                                                                                                                                                                                    | `catalog.presenter.ts` `serviceToVm` calls each ONCE onto the REQUIRED `ServiceVm.priceFrom` / `cardPrice` / `minutesRange` (D-10); both `pricedOf` shims, `sure`/`termsOf`/`toMinor`, the `POSITIVE_INFINITY`/`{0,0}`/`{cheapestCents: 0}` fallbacks deleted | check 1: 0                                                | DONE                      |
| C-2  | P1                       | `CatalogPricingSystem.priceFrom`                                                                                                                                        | —                                                                                                                                                                                                                            | `servicePriceFrom` reads `vm.priceFrom` (delegate kept, D-9)                                                                                                                                                                                                  | —                                                         | DONE                      |
| C-3  | P1                       | `CatalogPricingSystem.durationRange`                                                                                                                                    | —                                                                                                                                                                                                                            | `serviceDurationRange` reads `vm.minutesRange` (delegate kept)                                                                                                                                                                                                | —                                                         | DONE                      |
| C-4  | P1                       | `CatalogPricingSystem.cardPrice`                                                                                                                                        | —                                                                                                                                                                                                                            | `catalog-presenter.service.ts` `serviceMeta` reads `vm.cardPrice`                                                                                                                                                                                             | —                                                         | DONE                      |
| C-5  | P1                       | `CatalogPricingSystem.servicesByBarber` (reused)                                                                                                                        | existing (spec:87-91)                                                                                                                                                                                                        | `LandingContentService.barberPrices` ← `team-showcase.component.ts`; the presenter's `servicesByBarber` and its landing re-export deleted (D-9's one deletion)                                                                                                | —                                                         | DONE                      |
| C-6  | W0-A, P1                 | `ServiceComposition.drawnKind` (components/service-composition.data.ts)                                                                                                 | `drawnKind` (UNSPECIFIED → SINGLE, BUNDLE kept)                                                                                                                                                                              | `serviceToVm`                                                                                                                                                                                                                                                 | 5: catalog:129 (a)                                        | DONE                      |
| V-1  | W0-A, P2                 | `VisitStorySystem.toneOf`, `isVoid` (visit-story.system.ts); `VisitTone` (components/visit-tone.data.ts)                                                                | toneOf × outcome × upcoming/past, cancelled-upcoming HOLLOW, isVoid, dictionary values, purity                                                                                                                               | `visit-row.presenter.ts` (`VISIT_TONE_WORDS`, `struck: isVoid`)                                                                                                                                                                                               | —                                                         | DONE                      |
| V-2  | W0-A, P2                 | `VisitStorySystem.statusMark`; `VisitStatusMark`                                                                                                                        | every outcome × PENDING/CONFIRMED (the table), purity                                                                                                                                                                        | row (cancelledWord else-branch kept) and `visit-card.presenter.ts` (OPEN ∧ NEXT gate kept)                                                                                                                                                                    | —                                                         | DONE                      |
| V-3  | W0-A, P2                 | `VisitListSystem.rowSectionKey` (visit-list.system.ts)                                                                                                                  | upcoming key vs month/year keys, purity                                                                                                                                                                                      | row                                                                                                                                                                                                                                                           | —                                                         | DONE                      |
| V-4  | W0-A, P2                 | `VisitStorySystem.isWholeParty`                                                                                                                                         | whole vs share, purity                                                                                                                                                                                                       | row (`alone`)                                                                                                                                                                                                                                                 | —                                                         | DONE                      |
| V-5  | W0-A, P2                 | `VisitStorySystem.subjectFigure` (composes `BillingSystem`)                                                                                                             | share vs whole bill, bill error → null, OPEN/NO_SHOW → null, purity                                                                                                                                                          | row (`formatCents` of the Money; `priceOf` deleted); the card's `amountOf` reads the row back (D-3)                                                                                                                                                           | check 1: 0                                                | DONE                      |
| V-6  | W0-A, P2                 | `VisitStorySystem.marksOf`; `VisitMark`                                                                                                                                 | order PHOTOS › DISCOUNT › VOUCHER, only WORKED, share drops the bill marks, a taken-back redemption, purity                                                                                                                  | row (icon/label table; `words.voucher !== undefined` guard kept)                                                                                                                                                                                              | —                                                         | DONE                      |
| V-7  | W0-A, P2                 | `VisitStorySystem.quotesBooker`                                                                                                                                         | booker / other account / guest / unclaimed party with a null subject → false, purity                                                                                                                                         | row (∧ `clientWords !== false`, D-2.6)                                                                                                                                                                                                                        | —                                                         | DONE                      |
| V-8  | W0-A, P2                 | `VisitStorySystem.namesShop`                                                                                                                                            | one vs two locations, only WORKED                                                                                                                                                                                            | row; card (∧ staff ∧ last)                                                                                                                                                                                                                                    | —                                                         | DONE                      |
| V-9  | W0-A, P2                 | `VisitStorySystem.subjectBarberIds`                                                                                                                                     | distinct, first-seat order                                                                                                                                                                                                   | row; card                                                                                                                                                                                                                                                     | 4: row:373/376/384/474/485, card:100/101 (D-2.3)          | DONE                      |
| V-10 | W0-A, P2                 | `VisitStorySystem.subjectRecordOf`                                                                                                                                      | named / account seat / none                                                                                                                                                                                                  | row `storyOf` (`CustomerId.of` parse at the edge)                                                                                                                                                                                                             | —                                                         | DONE                      |
| V-11 | W0-A, P2                 | `VisitStorySystem.peerCountOf` (composes `peerCount` + `personKeyOf`)                                                                                                   | a guest counted by name once, own seats excluded, purity                                                                                                                                                                     | row (`peersOf`/`personSubjectOf` deleted)                                                                                                                                                                                                                     | check 1: 0                                                | DONE                      |
| V-12 | W0-A, P2                 | `WaitlistSystem.daysAhead` (waitlist.system.ts)                                                                                                                         | none ahead → all, null today → all, `LocalDate.compare` boundary                                                                                                                                                             | row                                                                                                                                                                                                                                                           | —                                                         | DONE                      |
| V-13 | W0-A, P2                 | `WaitlistSystem.daypartsWatched`                                                                                                                                        | no days / any whole day → none, touched parts                                                                                                                                                                                | row                                                                                                                                                                                                                                                           | —                                                         | DONE                      |
| V-14 | W0-A, P2                 | `WaitlistSystem.sortPoint`                                                                                                                                              | first day at minute 0, none → epoch day 0                                                                                                                                                                                    | row (`WAITLIST_UNDATED` deleted)                                                                                                                                                                                                                              | check 1: 0; 4: row:618 cap 3 (D-2.4)                      | DONE                      |
| V-15 | —                        | (STAYS, D-3: `visit-sections.ts` passes `atLeast = 2` into `VisitListSystem.workedFigure`)                                                                              | —                                                                                                                                                                                                                            | unchanged                                                                                                                                                                                                                                                     | —                                                         | STAYS                     |
| W-1  | W0-B, P3                 | `LoyaltyPassSystem.passOf` (NEW loyalty-pass.system.ts); `PassState` (components/pass-state.data.ts)                                                                    | paused wins, points off → CLEAR, balance −1/0/1, today = noticeFrom / = expireOn / the day after, purity                                                                                                                     | `wallet.presenter.ts` `passVm`                                                                                                                                                                                                                                | check 2: 0                                                | DONE                      |
| W-2  | W0-B, P3                 | `LoyaltyPassSystem.passOf` (`figure`, `passFigure`, `spendable`, `owed`, `lapsing`, `lapsesOn`); `PassFigure`                                                           | VISITS figure with points off, spendable `max(0, balance)`                                                                                                                                                                   | wallet (`signedFigureOf`, unit agreement, `dayShort` kept)                                                                                                                                                                                                    | 4: wallet:178/272 (D-2.3)                                 | DONE                      |
| W-3  | W0-B, P3                 | `TierSystem.standingTier` (tier.system.ts)                                                                                                                              | no tiers → null, override honoured, purity                                                                                                                                                                                   | wallet (two sites; flag + catalogue-ready gates kept)                                                                                                                                                                                                         | —                                                         | DONE                      |
| W-4  | W0-B, P3                 | `VoucherSystem.held` (voucher.system.ts; one private by-last-day core with `soonestFirst`, the `'9999-12-31'` sentinel once)                                            | expiring today kept, yesterday dropped, never-expiring last, an equal-day tie decided by the passed `idOrder` both ways; `soonestFirst`'s cases untouched                                                                    | wallet (`BY_ID_COLLATION` = `localeCompare`, DEP-1 withdrawn; bad today → `[]` at the parse, D-11)                                                                                                                                                            | check 1: 0; 1b: 1 (wallet:296)                            | DONE                      |
| W-5  | W0-B, P3                 | `VoucherSystem.untouched`                                                                                                                                               | balance = initial / spent                                                                                                                                                                                                    | wallet                                                                                                                                                                                                                                                        | —                                                         | DONE                      |
| W-6  | W0-B, P3                 | `VoucherSystem.heldTotal` (composes `spendableSum`)                                                                                                                     | one held → null, two currencies → null, sum of spendable only                                                                                                                                                                | wallet (`walletSum` count stays `holdings.length`)                                                                                                                                                                                                            | —                                                         | DONE                      |
| W-7  | W0-B, P3                 | `WalletSystem.ticketsShown`, `writable` (NEW wallet.system.ts)                                                                                                          | companion, offline, gone visit, paused, purity                                                                                                                                                                               | wallet; `client-card.store.ts` `rewardsUsable` (D-12)                                                                                                                                                                                                         | —                                                         | DONE                      |
| W-8  | W0-B, P3                 | `WalletSystem.actions`; `WalletAction` (components/wallet-action.data.ts)                                                                                               | disc order, one vs several ready (id vs count), points off, not writable                                                                                                                                                     | wallet (`WALLET_ACTION_DISCS` table: ids, icons, prominence)                                                                                                                                                                                                  | —                                                         | DONE                      |
| W-9  | W0-B, P3                 | `RewardSystem.tiles(...).tiles.length > 0` (the domain half)                                                                                                            | as W-10                                                                                                                                                                                                                      | wallet (the `LoadSlice` half stays, D-2.6)                                                                                                                                                                                                                    | 4: wallet:579 (b)                                         | DONE                      |
| W-10 | W0-B, P3                 | `RewardSystem.tiles` (reward.system.ts)                                                                                                                                 | owing → reach from nothing, paused, none takeable, catalogue order inside both halves, `withinReach`                                                                                                                         | wallet (cover lookup kept, D-2.5)                                                                                                                                                                                                                             | —                                                         | DONE                      |
| W-11 | W0-E, P3                 | `PunchCard.progress` (NEW companion, components/punch-card.data.ts)                                                                                                     | full / over-full / empty / negative, `toNext ≥ 1`, purity (NEW punch-card.data.spec.ts)                                                                                                                                      | wallet                                                                                                                                                                                                                                                        | —                                                         | DONE                      |
| W-12 | W0-C, P3, P5             | `StreakRuleSystem.isOnOn` (streak-rule.system.ts)                                                                                                                       | flag off / rule off / unknown head / another rhythm / in force                                                                                                                                                               | wallet + glance (`flags.streaks`), records (`true` — the store folded the flag)                                                                                                                                                                               | —                                                         | DONE                      |
| W-13 | W0-C, P3                 | `StreakSystem.outlook` (streak.system.ts; AT_RISK weeks compose `ClientStatsSystem.cadenceWeeks`); `StreakOutlook`, `StreakCapsule` (components/streak-outlook.data.ts) | every walletRhythmVm case as an outlook assertion, weeks rounding 3 → 1, 10 → 1, 11 → 2, BROKEN repairable only `≥ today`, `started` exactly, purity                                                                         | `loyalty.presenter.ts` `rhythmOutlookOf`/`rhythmLineOf` (`rhythmStateLine`/`rhythmLabel` kept as delegates), wallet (`lastQualifiedOn` via `shopDayOf`, D-11)                                                                                                 | —                                                         | DONE                      |
| W-14 | W0-C, P3                 | `StreakSystem.record`; the outlook's GATED `nextDue`                                                                                                                    | best > current only; `nextDue` null for FROZEN / HELD with `dueBy` set                                                                                                                                                       | loyalty, wallet (track name reads `nextDue`)                                                                                                                                                                                                                  | —                                                         | DONE                      |
| W-15 | W0-C, P3                 | `StreakSystem.protectionsHeld`                                                                                                                                          | rule grants none / banked 0 / banked n                                                                                                                                                                                       | wallet                                                                                                                                                                                                                                                        | —                                                         | DONE                      |
| W-16 | P3                       | (DUP of `StreakRuleSystem.upcomingOn`)                                                                                                                                  | —                                                                                                                                                                                                                            | the wallet:881 comparison deleted                                                                                                                                                                                                                             | check 2: 0                                                | DONE                      |
| W-17 | W0-B, P3                 | `TierProgress.atTop` (read alone), `TierSystem.keptAt`                                                                                                                  | `currentAtLeast ?? value`                                                                                                                                                                                                    | wallet ring                                                                                                                                                                                                                                                   | —                                                         | DONE                      |
| W-18 | W0-B, P3                 | `LedgerSystem.voided` (the private helper exported, element type `JournalEntryId`), `isStruck` (ledger.system.ts)                                                       | ledger 495/720/745 as values, purity                                                                                                                                                                                         | `ledger.presenter.ts` (copy deleted; `rowOf` reads `isStruck`, no `.some` left)                                                                                                                                                                               | check 1: 0                                                | DONE                      |
| W-19 | W0-B, P3                 | `LedgerSystem.lineOf`; `LedgerLine` (components/ledger-line.data.ts)                                                                                                    | every ledger case 544–790, 878, 914 as a tag/paid/revoked assertion, CORRECTION default, dictionary values                                                                                                                   | ledger (one tag → draft table)                                                                                                                                                                                                                                | — (G2: `JournalEffectRecord.isTier`, the companion guard) | DONE                      |
| W-20 | W0-B, P3                 | `LedgerSystem.WELCOME_SERIES_ID` (a `BadgeSeriesId`), `isWelcome`                                                                                                       | welcome vs other series                                                                                                                                                                                                      | ledger                                                                                                                                                                                                                                                        | check 1: 0                                                | DONE                      |
| W-21 | W0-B, P3                 | `LedgerSystem.netsUnder`                                                                                                                                                | each `JournalFeed`                                                                                                                                                                                                           | ledger                                                                                                                                                                                                                                                        | —                                                         | DONE                      |
| M-1  | P4                       | (DUP) `AchievementsSystem.EARLY_BIRD_LAST_MINUTE` — read inside `completesWithVisit`                                                                                    | —                                                                                                                                                                                                                            | the presenter copy deleted                                                                                                                                                                                                                                    | check 1: 0                                                | DONE                      |
| M-2  | W0-D1, P4                | `BadgeSystem.latestEarned`, `earnedOn`, `topEarned` (badge.system.ts; `topEarned` feeds `detailState`)                                                                  | max stamp / by level / max level, empty → null                                                                                                                                                                               | achievements (delegates `latestEarned`, `earnedOnOf`), medals                                                                                                                                                                                                 | —                                                         | DONE                      |
| M-3  | W0-D1, P4                | `BadgeSystem.isOneOff`, `isSingleLevel`                                                                                                                                 | one act / one level / ladder                                                                                                                                                                                                 | achievements (delegates `isOneOff`, `isSingleLevel`)                                                                                                                                                                                                          | —                                                         | DONE                      |
| M-4  | W0-D2, P4                | `LoyaltyCatalogSystem.inEndedSeason` (loyalty-catalog.system.ts)                                                                                                        | ended / open / no season                                                                                                                                                                                                     | achievements (`inEndedSeason` delegate)                                                                                                                                                                                                                       | —                                                         | DONE                      |
| M-5  | W0-D1, P4                | `BadgeSystem.landsOn`                                                                                                                                                   | first visit + target, today + remaining, never before today                                                                                                                                                                  | achievements (`landsOn` delegate; the meter reads it gated, the caption ungated)                                                                                                                                                                              | —                                                         | DONE                      |
| M-6  | W0-D1, P4                | `AchievementsSystem.completesWithVisit` (EXACT port, ≠ `countsToward`, JSDoc says why)                                                                                  | birthday act same/previous year, season CLOSED/ANNOUNCED/OPEN, a seasonal series with a NULL phase → false, one short, first-non-null scope precedence, early bird minute ≤ 600 ignoring scopes, weekend/on-time/party false | achievements (`completesWithThisVisit` delegate, `DraftVisit` built once at the edge)                                                                                                                                                                         | —                                                         | DONE                      |
| M-7  | W0-D1, P4                | `BadgeSystem.captionOf`; `MedalCaption` (components/medal-outlook.data.ts)                                                                                              | every caption, an ended family with an UNGATED `landsOn`                                                                                                                                                                     | achievements `medalVm`                                                                                                                                                                                                                                        | 5: ach:833/850/863 (a)                                    | DONE                      |
| M-8  | W0-D2, P4                | `StandingSystem.isFamilyNew` (standing.system.ts)                                                                                                                       | earned ∧ latest ∧ new since the previous visit                                                                                                                                                                               | achievements (`markNew` placement kept)                                                                                                                                                                                                                       | —                                                         | DONE                      |
| M-9  | W0-D1, P4                | `BadgeSystem.toNext`, `nextLevelNumber`                                                                                                                                 | next ∧ target ∧ ¬ended; highest + 1 fallback                                                                                                                                                                                 | achievements                                                                                                                                                                                                                                                  | —                                                         | DONE                      |
| M-10 | W0-D1, P4                | `BadgeSystem.meterOf`, `faceState`, `ringState`; `MedalMeter`, `MedalRingState`                                                                                         | PENDING / FRACTION clamp / NONE, pending NOT_STARTED → IN_PROGRESS, COMPLETE = EARNED ∧ next null                                                                                                                            | achievements, medals (`MEDAL_RING_STATES` second table; `MedalState` unchanged, D-5)                                                                                                                                                                          | 5: medals:213 (a)                                         | DONE                      |
| M-11 | W0-D2, P4                | `StandingSystem.shelfOrdered`                                                                                                                                           | band order and ties, catalogue index                                                                                                                                                                                         | achievements (`shelfOrdered` delegate)                                                                                                                                                                                                                        | —                                                         | DONE                      |
| M-12 | W0-D2, P4                | `StandingSystem.soonIds`, `almostEarned` (one private acts-first helper; limits differ, R-10)                                                                           | acts first, closest, dedupe, limit; an earned value-0 family not «almost»; the rhythm-off cut                                                                                                                                | achievements (`soonSeriesIds`), medals (`closeTiles`)                                                                                                                                                                                                         | —                                                         | DONE                      |
| M-13 | W0-D2, P4                | `StandingSystem.recentFreshLevelsByDay` (composes `recentLevelsByDay`)                                                                                                  | a day of two levels, one on a newer day: `levels` 2, `fresh` 1; empty days dropped; no day limit                                                                                                                             | achievements latest tiles (`levels` for single-vs-group and «+N», `fresh` for the face; RAIL_LIMIT after the lookups)                                                                                                                                         | 3: ach:1066, :1134; 4: ach:1031/1035 (D-2.4, D-3)         | DONE                      |
| M-14 | W0-D2, P4                | `LoyaltyCatalogSystem.windowsOn`                                                                                                                                        | first OPEN season, open then announced events                                                                                                                                                                                | achievements, medals                                                                                                                                                                                                                                          | —                                                         | DONE                      |
| M-15 | W0-D2, P4                | `SeasonSystem.trackOutlook` (season.system.ts; composes `BadgeSystem.levelsShown`); `SeasonTrackState`                                                                  | ENDED / COMPLETE / PENDING / TO_NEXT, `remaining ≥ 1`, `fromLevel`                                                                                                                                                           | achievements (`trackOutlookOf`), medals                                                                                                                                                                                                                       | —                                                         | DONE                      |
| M-16 | W0-D2, P4                | `LoyaltyCatalogSystem.archivedFor`, `SeasonSystem.byClosingYear`                                                                                                        | taken part / not, newest year first                                                                                                                                                                                          | achievements                                                                                                                                                                                                                                                  | —                                                         | DONE                      |
| M-17 | W0-D2, P4                | `StandingSystem.earnedAmong` (`medalState === EARNED`, R-4)                                                                                                             | counts over series, never VM strings                                                                                                                                                                                         | achievements, medals (`medalScopeVm` over series)                                                                                                                                                                                                             | —                                                         | DONE                      |
| M-18 | W0-D2, P4                | `StandingSystem.sectionsOf`; `ScopeSection`                                                                                                                             | MASTERY by service category then GENERAL; BARBERS barber/location/rest; one grid                                                                                                                                             | achievements (the edge brands the category ids)                                                                                                                                                                                                               | —                                                         | DONE                      |
| M-19 | W0-D2, P4                | `StandingSystem.scopeMedalState`                                                                                                                                        | counts → EARNED / IN_PROGRESS / NOT_STARTED                                                                                                                                                                                  | achievements archived tiles                                                                                                                                                                                                                                   | —                                                         | DONE                      |
| M-20 | W0-D2, P4                | `StandingSystem.earnedOnly` (never inside `familiesIn`, R-5)                                                                                                            | earned cut, order kept                                                                                                                                                                                                       | achievements, medals                                                                                                                                                                                                                                          | 5: ach:1590 (a — the system's phase tag picks the cut)    | DONE                      |
| M-21 | W0-D2, P4                | `StandingSystem.neighboursOf` (season list WITH the track, R-3)                                                                                                         | category and season neighbours, self excluded, shelf order, not limited                                                                                                                                                      | achievements `relatedOf` (RAIL/RELATED limits kept)                                                                                                                                                                                                           | 5: ach:1672 (a)                                           | DONE                      |
| M-22 | W0-D2, P4                | `LoyaltyCatalogSystem.rhythmLive` (composes `StreakRuleSystem.isOnOn`)                                                                                                  | flag off; agrees with `isOnOn`                                                                                                                                                                                               | medals (`rhythmLiveOf` delegate)                                                                                                                                                                                                                              | —                                                         | DONE                      |
| M-23 | W0-D1, P4                | `BadgeSystem.ringFraction`                                                                                                                                              | last threshold won → next, span ≤ 0 → null, clamp                                                                                                                                                                            | medals (`ringValueOf` delegate)                                                                                                                                                                                                                               | —                                                         | DONE                      |
| M-24 | P4                       | (DUP) `RecordsSystem.RECORD_ORDER` / `NEW_RECORD_DAYS` re-exported under the same names                                                                                 | — (existing)                                                                                                                                                                                                                 | medals                                                                                                                                                                                                                                                        | check 1: 0                                                | DONE                      |
| M-25 | W0-D1, P4                | `RecordsSystem.isHeld` (records.system.ts)                                                                                                                              | one case per kind, LONGEST_RHYTHM with `on: null` held                                                                                                                                                                       | medals (service-name lookup kept)                                                                                                                                                                                                                             | —                                                         | DONE                      |
| M-26 | W0-D2, P4                | `StandingSystem.shelves`                                                                                                                                                | rhythm-off RHYTHM shelf cut to earned, RECORDS and empty shelves dropped                                                                                                                                                     | medals                                                                                                                                                                                                                                                        | 3: medals:765/831/857 (e, and a system answer's ids)      | DONE                      |
| M-27 | W0-D2, P4                | `StandingSystem.windowFamilies` (the track without the retired filter, R-3)                                                                                             | track first, then `familiesIn(season)`                                                                                                                                                                                       | medals                                                                                                                                                                                                                                                        | —                                                         | DONE                      |
| M-28 | W0-D2, P4                | `StandingSystem.anyUnderWay`                                                                                                                                            | none / one under way                                                                                                                                                                                                         | medals                                                                                                                                                                                                                                                        | —                                                         | DONE                      |
| M-29 | W0-D1, P4                | `BadgeSystem.canStillMove`                                                                                                                                              | retired / no next / ended                                                                                                                                                                                                    | medal-detail                                                                                                                                                                                                                                                  | —                                                         | DONE                      |
| M-30 | W0-D1, P4                | `AchievementsSystem.workedVisitOf` (zone-free)                                                                                                                          | own WORKED seats, min start, company, weekday, none → null                                                                                                                                                                   | medal-detail (`ZonedTimeSystem.toUtc` at the edge → `CountedVisit`; `countsToward` keeps its signature)                                                                                                                                                       | —                                                         | DONE                      |
| M-31 | W0-D1, P4                | `AchievementsSystem.countedDraft`, `draftCountsToward`                                                                                                                  | the md:381-390 defaults with a null start and a null location; seasonal series with a NULL phase → false                                                                                                                     | medal-detail (`draftStart` + `*RefId.of` at the edge; `LAST_MINUTE_OF_DAY`/`WEEKDAY_MONDAY` deleted)                                                                                                                                                          | check 1: 0                                                | DONE                      |
| M-32 | W0-D1, P4                | `AchievementsSystem.serviceToAdd`                                                                                                                                       | retired / not SERVICE / cannot move / already in the draft                                                                                                                                                                   | medal-detail `detailActionOf` (online/gone/paused + host name kept)                                                                                                                                                                                           | —                                                         | DONE                      |
| M-33 | W0-D1, P4                | `BadgeSystem.detailState`; `MedalDetailState`                                                                                                                           | every state-line case                                                                                                                                                                                                        | medal-detail                                                                                                                                                                                                                                                  | —                                                         | DONE                      |
| M-34 | W0-D1, P4                | `BadgeSystem.progressCard`; `MedalProgressCard`                                                                                                                         | one-off / complete / stopped / to next, projected `min(value + 1, target)`                                                                                                                                                   | medal-detail                                                                                                                                                                                                                                                  | —                                                         | DONE                      |
| M-35 | W0-D1, P4                | `Gamification.countsVisits`, `isVisitKind` (+ `VISIT_COUNTING_METRICS`, `VISIT_KIND_METRICS`), `BadgeSystem.countsInVisits`                                             | each metric set                                                                                                                                                                                                              | medal-detail                                                                                                                                                                                                                                                  | —                                                         | DONE                      |
| M-36 | W0-D2, P4                | `LoyaltyCatalogSystem.barberIds`                                                                                                                                        | live BARBER families, distinct, catalogue order                                                                                                                                                                              | medal-detail (host preference kept)                                                                                                                                                                                                                           | —                                                         | DONE                      |
| M-37 | W0-D1, P4                | `BadgeSystem.levelsShown`                                                                                                                                               | ended keeps levels ≤ highest                                                                                                                                                                                                 | through `trackOutlook` and `ladder` (no presenter copy left)                                                                                                                                                                                                  | —                                                         | DONE                      |
| M-38 | W0-D1, P4                | `BadgeSystem.ladder`; `LadderRung`                                                                                                                                      | passed / next / later, a single act                                                                                                                                                                                          | medal-detail                                                                                                                                                                                                                                                  | —                                                         | DONE                      |
| M-39 | W0-D1, P4                | `AchievementsSystem.countedVisits`                                                                                                                                      | the draft first, inside the windows, newest first                                                                                                                                                                            | medal-detail (edge-built `{ appointment, counted }` pairs; the slice of 5 kept)                                                                                                                                                                               | —                                                         | DONE                      |
| G-1  | W0-E, P5                 | `ClientStatsSystem.cadenceWeeks` (client-stats.system.ts) — the ONE home of `max(1, round(days/7))`                                                                     | 1/3/4/10/11 days                                                                                                                                                                                                             | `history.presenter.ts` (`cadenceWeeks` delegate), visits-page; `StreakSystem.outlook`                                                                                                                                                                         | check 1c: 1                                               | DONE                      |
| G-2  | W0-E, P5                 | `ClientStatsSystem.historyNote`; `HistoryNote` (components/client-history.data.ts)                                                                                      | the three notes, null stats                                                                                                                                                                                                  | history (`historyNoteWords`), visits-page (no CLEAN from cell presence)                                                                                                                                                                                       | 3: visits-page:172/175 (b, a)                             | DONE                      |
| G-3  | W0-A, P5                 | `VisitListSystem.distinctById`                                                                                                                                          | first wins, order kept                                                                                                                                                                                                       | history, visits-page (both names kept)                                                                                                                                                                                                                        | —                                                         | DONE                      |
| G-4  | W0-A, P5                 | `VisitListSystem.offeredWith`                                                                                                                                           | the filter in force kept, menu order                                                                                                                                                                                         | visits-page                                                                                                                                                                                                                                                   | —                                                         | DONE                      |
| G-5  | W0-E, P5                 | `ClientStatsSystem.statWindowsOnDay` (one private core with `statWindows`)                                                                                              | the records 532/557 boundary                                                                                                                                                                                                 | `records.presenter.ts` (`endOfDay`, `LAST_MINUTE` deleted)                                                                                                                                                                                                    | check 1: 0                                                | DONE (DEP-3 pinned no-op) |
| G-6  | W0-D1, P5                | `RecordsSystem.usualBeyondFavourite`                                                                                                                                    | usual = favourite / beyond                                                                                                                                                                                                   | records (name filter first)                                                                                                                                                                                                                                   | —                                                         | DONE                      |
| G-7  | W0-D1, P5                | `RecordsSystem.yearsOfHistory` (composes `subjectVisitOf` + `years`)                                                                                                    | complete history only, only WORKED, only this customer, the stamped year                                                                                                                                                     | records                                                                                                                                                                                                                                                       | —                                                         | DONE                      |
| G-8  | W0-E, P5                 | `ClientStatsSystem.tenureOf`; `TenureState`                                                                                                                             | null stats / zero visits / null first day / null cadence                                                                                                                                                                     | glance hero, `client-card.presenter.ts` head (SINCE and SINCE_CADENCE alike as `head.since`)                                                                                                                                                                  | —                                                         | DONE                      |
| G-9  | W0-B, P5                 | `TierSystem.plate`; `TierPlateState` (≠ `progress`, R-2)                                                                                                                | unknown tier, top = last step, held above, ring start at the threshold, override → `progress: null`                                                                                                                          | `glance.presenter.ts`                                                                                                                                                                                                                                         | —                                                         | DONE                      |
| G-10 | W0-E, P5                 | `ClientStatsSystem.NO_SHOW_WARNING_AT`, `noShowWarning`                                                                                                                 | 1 / 2 / older than 90 days / no stats                                                                                                                                                                                        | glance (the `ShopNow` from `nowMs` kept, T1)                                                                                                                                                                                                                  | check 1: 0                                                | DONE                      |
| G-11 | W0-E, P5                 | `AgeSystem.birthdayMoment` (composes `nextBirthday`), `BIRTHDAY_NOTICE_DAYS`; `BirthdayMoment` (components/birthday-moment.data.ts)                                     | today / in 1 / in 7 / in 8 / across the year end / 29 February                                                                                                                                                               | glance; `client-pages.vm.ts` binds and re-exports `BirthdayMoment`                                                                                                                                                                                            | check 1: 0                                                | DONE                      |
| G-12 | W0-E, P5                 | `CouponGrantSystem.besideOccasionGift`                                                                                                                                  | gift carried or not                                                                                                                                                                                                          | glance `grantsBesideBirthday`                                                                                                                                                                                                                                 | check 1: 0                                                | DONE                      |
| G-13 | W0-A, P5                 | `VisitListSystem.upcomingSoonestFirst` (stable on `byStart`, no `byId`)                                                                                                 | INPUT order on an equal day+minute, non-upcoming dropped                                                                                                                                                                     | glance (the current visit dropped first, D-2.6)                                                                                                                                                                                                               | 3: glance:498 (e)                                         | DONE                      |
| G-14 | W0-A, P5                 | `VisitStorySystem.lastWorked`                                                                                                                                           | stable on equal instants, skips a newer non-WORKED, calls `outcomeOf` no further than the first WORKED                                                                                                                       | `client-card.presenter.ts` `lastWorkedVisit` (signature kept)                                                                                                                                                                                                 | 3: cc:407 (e)                                             | DONE                      |
| G-15 | W0-A, P5                 | `WaitlistSystem.glancePick`                                                                                                                                             | paused / booked-after / lapsed / newest / others                                                                                                                                                                             | glance                                                                                                                                                                                                                                                        | —                                                         | DONE                      |
| G-16 | W0-B, P5                 | `RewardSystem.pointsReach` (composes `bestAffordable` / `nextAffordable`); `PointsReach`                                                                                | none / enough / more with exact `short`                                                                                                                                                                                      | glance (offered + held-name pre-filter kept, D-3)                                                                                                                                                                                                             | 3: glance:683 (d)                                         | DONE                      |
| G-17 | W0-D1, P5                | `RecordsSystem.GLANCE_LINE_ORDER`, `glanceLine`                                                                                                                         | order, LONGEST_RHYTHM excluded, null-day FIRST_VISIT and unnamed favourite dropped, limit 2                                                                                                                                  | glance                                                                                                                                                                                                                                                        | check 1: 0                                                | DONE                      |
| G-18 | W0-E, P5                 | `ClientGlanceSystem.repeatOffer` (composes `sameLegs`)                                                                                                                  | the seven refusals                                                                                                                                                                                                           | client-card                                                                                                                                                                                                                                                   | —                                                         | DONE                      |
| G-19 | W0-E, P5                 | `PhoneSystem.dialable`                                                                                                                                                  | account first / seat digits / no digit                                                                                                                                                                                       | client-card (the seat's `tel:`/non-digits stripped at the edge)                                                                                                                                                                                               | —                                                         | DONE                      |
| G-20 | W0-D2, P5                | `LoyaltyCatalogSystem.cueOrdered`                                                                                                                                       | unknown category last, then series order                                                                                                                                                                                     | client-card                                                                                                                                                                                                                                                   | —                                                         | DONE                      |
| G-21 | W0-D2, P5, G2            | `StandingSystem.strip` (+ `closestId`, G2), `stripCue` (composes `BadgeSystem.nextLevelNumber` + `isNewSince`); `MedalCue`                                              | the medal strip's four cases, NEW on equal stamps reading the given level; `closestId` beside the newest, past the limit (G2)                                                                                                | client-card (`completingFirst` = `cueOrdered(…, families.filter(completesWithThisVisit))[0]`, P4's delegates)                                                                                                                                                 | 3: cc:541 (the plan's own composition, §2.5)              | DONE                      |
| G-22 | W0-E, P5                 | `CouponGrantSystem.forOccasion` (one private predicate with G-12 over `isOccasion`)                                                                                     | keeps only the occasion's grants, null occasion dropped                                                                                                                                                                      | glance `birthdayVm` (both grant lists)                                                                                                                                                                                                                        | —                                                         | DONE                      |
| R-1  | W0-C, P6                 | `StreakRuleSystem.exampleDue` (delegates `StreakIntervalRule.daysFor`)                                                                                                  | integer percents agree with the old rounding                                                                                                                                                                                 | `admin-rhythm.words.ts` `toleranceExample`                                                                                                                                                                                                                    | check 1: 0                                                | DONE                      |
| R-2  | W0-C, P6                 | `StreakRuleSystem.statedInterval`                                                                                                                                       | the six fallbacks, PERSONAL with habit > 0                                                                                                                                                                                   | `rhythm-rule.words.ts` (key table kept)                                                                                                                                                                                                                       | 5: rr:188 (a); 4: rr:88 (D-2.3)                           | DONE                      |
| R-3  | W0-C, P6                 | `StreakSystem.track` (no new code)                                                                                                                                      | the R-12 equivalence suite `StreakSystem.track ≡ the admin sample's track` + the `inChairToday: false, paused: false, dueBy: null` case                                                                                      | admin-rhythm `samplePeriods` delegates to `track` (OQ-8 NOT carried)                                                                                                                                                                                          | —                                                         | DONE                      |
| R-4  | W0-C, P6                 | `StreakRuleSystem.changesInRuleOrder` + `STREAK_RULE_PARAMETER_ORDER` (components/streak-rule.data.ts)                                                                  | NAME last, unknown dropped, duplicates                                                                                                                                                                                       | admin-rhythm                                                                                                                                                                                                                                                  | check 1: 0                                                | DONE                      |
| R-5  | W0-C, P6                 | `RhythmDraftSystem.effectiveChoiceOf`; `RhythmEffectiveChoice`                                                                                                          | the tomorrow-wins tie                                                                                                                                                                                                        | admin-rhythm (`effectiveReading` keeps its string signature)                                                                                                                                                                                                  | —                                                         | DONE                      |
| R-6  | W0-C, P6                 | `StreakPreviewSystem.movement`                                                                                                                                          | a null side                                                                                                                                                                                                                  | admin-rhythm (`signedDelta` kept)                                                                                                                                                                                                                             | —                                                         | DONE                      |
| R-7  | W0-C, P6                 | `StreakRuleSystem.excuseCount`                                                                                                                                          | on vs all                                                                                                                                                                                                                    | admin-rhythm                                                                                                                                                                                                                                                  | —                                                         | DONE                      |
| R-8  | W0-C, P6                 | `StreakPublishSystem.SYSTEM_PUBLISHER`, `isSystemPublisher`                                                                                                             | system vs a user                                                                                                                                                                                                             | admin-rhythm                                                                                                                                                                                                                                                  | 4: ar:675 (D-2.3)                                         | DONE                      |

#### 9.1.1 §5 review record

Run over the 26 presenter / words / format / vm files (`git ls-files -co`
of the §5 globs — the untracked files included):

| Check                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 deleted copies                       | 0 lines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1b `localeCompare`                     | exactly 1 — `wallet.presenter.ts:296` `BY_ID_COLLATION`, passed to `VoucherSystem.held` at :315                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 1c `round(…/7)` in ecs-core systems    | exactly 1 code line — `client-stats.system.ts:1215` (`cadenceWeeks`; :1208/:1210 are its JSDoc)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2 brand arithmetic / raw date compares | 0 lines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3 sorts and filters                    | 45 hits, all legal (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4 thresholds and min/max               | 36 hits, all legal (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5 state choices on stored tags         | 10 hits, all legal (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6 caller + spec per §2 name            | every §2 member has a production caller (a presenter, the store, or the composing system: `topEarned` → `detailState`, `levelsShown` → `trackOutlook`/`ladder`, `isVisitKind` → `countsInVisits`, `WELCOME_SERIES_ID` → `isWelcome`, `SYSTEM_PUBLISHER` → `isSystemPublisher`, `GLANCE_LINE_ORDER` → `glanceLine`, `NO_SHOW_WARNING_AT` → `noShowWarning`, `BIRTHDAY_NOTICE_DAYS` → `birthdayMoment`) and is named in its own spec                                                                                                                                                                                                                                                                             |
| 7 "composes"                           | every one holds inside the new function's body: `heldTotal` → `spendableSum`; `pointsReach` → `bestAffordable`/`nextAffordable`; `yearsOfHistory` → `subjectVisitOf` + `years`; `birthdayMoment` → `nextBirthday`; `repeatOffer` → `sameLegs`; `peerCountOf` → `peerCount`; `rhythmLive` → `isOnOn`; `outlook` → `cadenceWeeks`; `recentFreshLevelsByDay` → `recentLevelsByDay`; `stripCue` → `nextLevelNumber` + `isNewSince`; `trackOutlook` → `levelsShown`; `held` and `soonestFirst` → the private `byLastDay`; `statWindowsOnDay` and `statWindows` → the private `windowsAt`; `forOccasion` and `besideOccasionGift` → the private `madeFor` over `isOccasion`; `upcomingSoonestFirst` → `byStart` only |
| 8 zone in a system                     | `ZonedTimeSystem.(toUtc\|shopNow)(` in code only in `zoned-time.system.ts`; `achievements.system.ts` matches `grep -l` through two JSDoc lines (:80, :294) that say the EDGE adds the instant — it imports no zone code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| lint                                   | 46 projects, 0 errors (`presenter-purity`, `error-dictionary-home`, `no-sliced-ports`, `no-generic-discriminator` green); no new `*ErrorCode`; no `Pick`/`Omit` of a `*Ports` type; every new dictionary field domain-prefixed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Checks 3–5, every hit with its §5 clause — (a) a system tag → words/icons,
(b) the zero form of one system-given count, (c) layout/geometry/a display
cap, (d) a host lookup's display data, (e) UI read-state:

- **Joins of words** (`.filter(part !== null)` / `!== ''`) — (a)/(c), not a
  domain list: admin-rhythm.words 501, 639; rhythm-rule.words 219;
  visit-card 150, 175, 248; visit-row 331, 550; achievements 1326; ledger
  469, 474, 498; loyalty 90; wallet 266; client-card.format 327 (text spans
  by offset), 411.
- **Name-level dedupe of display text** (D-3 row: «the title / waitlist
  services `distinct` over looked-up NAMES»): admin-rhythm.words 1029,
  rhythm-rule.words 146.
- **Layout / display caps** (c): admin-rhythm.words 407 (slider marks up to
  the ruler's max); visit-row 618 (waitlist «още N» past 3, D-3);
  achievements 1031 (RAIL_LIMIT), 1035 (`levels.length === 1` single vs
  group, M-13's contract); client-card 228 (CAPSULE_LIMIT); medal-detail 675
  (cover grid); medals 487/489 (folded rows), 511 (SECTION_FOLD_OVER), 551
  (`Math.max(1, total)` divide guard).
- **Form choices** (D-2.3): visit-card 100/101, visit-row 373/376/384/474/485
  (one barber's name vs several — plural and avatar, over the system's
  `subjectBarberIds`); visit-card 194, 245 (D-3); client-card 133; loyalty
  97 (the «×N» stack only when a not-applied group holds more than one —
  one vs a count, over `RewardSystem.groupGrants`' group); admin-rhythm.words
  675 («и още N»); rhythm-rule.words 88 (a span said in days below two weeks,
  in weeks from there — the unit of an interval the system stated, never the
  cadence rule); client-card.format 167 (a numeral guard);
  client-card.words 1257/1259/1262/1264, glance 705, wallet 178/272
  (`Math.abs` for the sign glyph and agreement).
- **Zero form of one system-given count** (b): catalog 88 (`byVariant`
  present only with variants); visits-page 172 (the visits cell from the
  first visit on); wallet 579 (W-9: `tiles.length > 0`).
- **UI read-state** (e): glance 480 (the last visit's photos), 498 (the
  current visit dropped, D-3); client-card 407 (idem), 453/456 (photo rail
  exclusion, D-3); medals 746 (the chosen chip), 765 (the chosen category);
  wallet 1049 (`whole`, D-3).
- **Host lookups** (d): achievements 441 / records 396 (`PersonalRecord.find`,
  a component lookup), 1134 (the lead level on its day); ledger 182, 285,
  291; wallet 888 (the tier step by id); records 103 (THEMES, D-3); loyalty
  158 (`StreakState.find`, W-12's contract); glance 683 (held rewards by
  NAME, D-3 / OQ-4).
- **Composition of system answers**: achievements 595/596 (the art owners'
  retired-last walk, D-3 `artOwnersOf`), 1066 (face-clash rank, D-3);
  medals 831/857 (the scope page keeps the tiles of the shelf
  `StandingSystem.shelves` drew); client-card 541 (`completingFirst`, §2.5's
  own composition); visits-page 111 (`matchesVisitFilter` →
  `VisitListSystem.matches`), 175 (the risk cells by id — words).
- **Check 5** (a): catalog 129 (BUNDLE → `includes` on the VM);
  rhythm-rule.words 188; visit-row 444 (OPEN → the lead word); achievements
  833/850/863 and medals 213 (accessible names per `medalState`, the
  system's standing); achievements 1293 (ANNOUNCED → no count), 1590 (the
  system's ENDED phase picks `earnedOnly`), 1672 (event vs season icon).
  (G2: G's eleventh hit, ledger 419's TIER narrowing, is
  `JournalEffectRecord.isTier` now — no hit.)

No missed decision: nothing went back to a package.

#### 9.1.2 System spec cases added (new `it` blocks)

| Spec                              | New | Spec                             | New             |
| --------------------------------- | --- | -------------------------------- | --------------- |
| visit-story.system.spec.ts        | 41  | badge.system.spec.ts             | 49              |
| visit-list.system.spec.ts         | 12  | achievements.system.spec.ts      | 31              |
| waitlist.system.spec.ts           | 16  | records.system.spec.ts           | 15              |
| service-composition.data.spec.ts  | 1   | gamification.data.spec.ts        | 2               |
| loyalty-pass.system.spec.ts (NEW) | 9   | medal-outlook.type-spec.ts (NEW) | type assertions |
| wallet.system.spec.ts (NEW)       | 13  | standing.system.spec.ts          | 46 (+1 G2)      |
| voucher.system.spec.ts            | 8   | season.system.spec.ts            | 9               |
| reward.system.spec.ts             | 9   | loyalty-catalog.system.spec.ts   | 16              |
| tier.system.spec.ts               | 11  | client-stats.system.spec.ts      | 18              |
| ledger.system.spec.ts             | 15  | age.system.spec.ts               | 9               |
| streak.system.spec.ts             | 23  | coupon-grant.system.spec.ts      | 6               |
| streak-rule.system.spec.ts        | 21  | client-glance.system.spec.ts     | 9               |
| rhythm-draft.system.spec.ts       | 3   | phone.system.spec.ts             | 4               |
| streak-preview.system.spec.ts     | 4   | punch-card.data.spec.ts (NEW)    | 6               |
| streak-publish.system.spec.ts     | 3   | journal-effect.data.spec.ts      | 1 (G2)          |

410 new `it` blocks (428 tests with the `it.each` rows; G's 408/426 + G2's
two); every new
dictionary's values pinned (the system specs and `medal-outlook.type-spec.ts`).
Existing system spec cases: all kept and green — the only deletions in the
ecs-core spec diffs are re-grouped import lines, plus §9.2's one line.

### 9.2 Spec edits beyond §4.3 (expected: none)

Presenter specs: none — `git diff fd5f2a6` lists no `*.presenter.spec.ts`
(the 13 of them), `*.words.spec.ts`, `client-pages.vm.spec.ts`,
`visit-sections.spec.ts` or `day-range.spec.ts` (re-proved by G2 on the
closed tree: an empty diff); the feature-side spec diff is §4.3's fixture
literals — `service-detail-sheet.component.spec.ts` SERVICE, SHAVE, BUNDLE
and `service-row.component.spec.ts` CUT gain the three fields (12 added
lines, nothing removed; `service-row`'s BUNDLE spreads CUT and carries them
unchanged, the shim's answer for its identical offerings); values = the old
shim's answers, no expectation or test body touched — plus G2's one
type-only line set below.

| Spec                                                                                                            | Line    | Edit                                                                                                              | Reason                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visit-story.system.spec.ts` (ecs-core, existing case «decides a cancelled visit by the seat called off last…») | 551     | `const CANCELLED: BookingStatus = 'CANCELLED'` → `= BookingStatus.Cancelled`                                      | W0-A's import of the `BookingStatus` dictionary (value-identical; the case and its expectations unchanged)                                                                                                                                                                                                                         |
| `catalog-navigation.service.spec.ts` (marketing-landing; G2)                                                    | 3, 5, 8 | the import gains `type ServiceVm`; the `service()` helper is typed `: ServiceVm` and returns `found as ServiceVm` | §2.7 split `ServiceSourceVm` (the authored `SERVICES`, no figures) from `ServiceVm`; the navigation service holds the subject and never reads the three figures, so identity (`toBe`) and every expectation stay as they were — a type-only edit §4.3 missed (P1 reported it; the stale-buildinfo blind spot hid it from G's gate) |

The strip cases of `standing.system.spec.ts` are wave 0's own (new in this
pass, not an existing spec): G2's `closestId` field joined their six
`toEqual` answers, each the old `soon[0]`-minus-newest value — Мартин's is
`series-birthday`, the single act «Скоро» leads with on his birthday visit.

### 9.3 Gate record

| Gate                            | Result                                         | Numbers                                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sync:check                      | PASS                                           | workspace up to date (G, and G2 on the closed tree)                                                                                                                                                                                                                                                                                   |
| layering                        | PASS                                           | 664 files, 3,105 import edges in ecs-core (G: 3,104; G2's fixture imports `@core/systems`); 2,309 files scanned; (a)–(e) ok                                                                                                                                                                                                           |
| typecheck (skip cache)          | PASS (baseline only)                           | only `patterns` red (`section-header.spec.ts`, spec-only). G2 ran it after `rm -rf dist/out-tsc`: G's green run had read a stale buildinfo and missed `marketing-landing`'s spec (TS2345 ×4, fixed — §9 top, §9.2)                                                                                                                    |
| lint                            | PASS                                           | 46 projects, 0 errors (warnings only)                                                                                                                                                                                                                                                                                                 |
| test (run-many, `--parallel=3`) | PASS (baseline only)                           | 46 projects, 11,340 passed + exactly the 6 baseline reds (`gauge.spec.ts` 4, `visit-pills.spec.ts` 1, `visits-page.presenter.spec.ts` «strikes an hour that did not happen» 1); = 10,888 + 24 `lint-rules` cases of the Law 10 commit + 428 new ecs-core cases (G's 426 + G2's 2); `verify-tools` 79 node tests; no project timed out |
| ecs-core coverage               | PASS                                           | 275 files (+3: loyalty-pass, wallet, punch-card specs), 4,958 tests, 98.00 % statements (13,061/13,327; was 97.85 %), 98.90 % lines (11,341/11,467)                                                                                                                                                                                   |
| seed-tools typecheck            | PASS                                           |                                                                                                                                                                                                                                                                                                                                       |
| lint-rules test                 | PASS                                           | 13 files, 290 tests                                                                                                                                                                                                                                                                                                                   |
| build web / verify:bundle       | PASS                                           | initial 604.26 kB raw / 164.00 kB transfer (+0.06 kB on 604.20); the `gauge.css` 45-byte style-budget warning is pre-existing (no pass file); firestore, storage and libphonenumber-js out of the initial chunk                                                                                                                       |
| build functions + deps          | PASS                                           | the four runtime dependencies, as recorded, none forbidden                                                                                                                                                                                                                                                                            |
| runbook §4.2–§4.5, §4.7–§4.9    | PASS                                           | §4.2 28 `ok`, §4.3 22, §4.4 17, §4.5 6 (with the preamble's `STORE`), §4.7 24, §4.8 27, §4.9 25 (the four canaries flagged 4× under both base paths) — all equal to the reference (G and G2)                                                                                                                                          |
| verify:p0                       | PASS (G2)                                      | P0 exit criteria (a)–(f) all proved                                                                                                                                                                                                                                                                                                   |
| test:emulator                   | PASS (G2)                                      | 65 + 255, the reference                                                                                                                                                                                                                                                                                                               |
| e2e:web                         | PASS (G2, baseline only)                       | 41 passed + exactly the 19 baseline failures (6 `*-screenshots`, `landing.spec.ts:121`, the 12 `client-card-glance.spec.ts` runs of `:343`/`:686`, failing at `:384`/`:765` as on the earlier trees); no flake to re-run                                                                                                              |
| §5 checklist                    | PASS                                           | §9.1.1 (re-run by G2: 1 = 0, 1b = 1, 1c = 1, 2 = 0, 3 = 45, 4 = 36, 5 = 10, 8 = zoned-time + the two JSDoc lines)                                                                                                                                                                                                                     |
| §6.3 smoke (screens × bg/en)    | DOM differential PASS (G); dev-stack PASS (G2) | below                                                                                                                                                                                                                                                                                                                                 |

**The smoke, as run (emulator-free).** The dev-stack smoke of §6.3 needs the
emulators, which this package was told not to start (they share ports with
the three journeys). In its place, G ran a **DOM differential of every
spec** (component and store specs render; the presenter specs pin their
own words) of the nine projects whose screens
§6.3 lists — `staff-client-card` (screens 1–7), `shared-visits` (6, 9),
`shared-catalog`, `marketing-landing`, `client-booking`,
`client-onboarding` (8), `client-appointments` (9), `admin-loyalty` (10),
`staff-dashboard` — on a `git archive` copy of `fd5f2a6` and an rsync copy
of the integrated tree in the scratchpad (same `node_modules`, a recorder
appended to each copy's `test-setup.ts` that writes every
`TestBed.createComponent` fixture's final `outerHTML`, `_ngcontent`/
`_nghost`/`ng-reflect` attributes stripped, per test). Result: **2,611
tests, over 1,150 rendered DOMs, 35.6 MB of HTML — identical**, the specs'
bg and en cases alike. The one difference on the first pass,
`staff-time-grid.spec.ts` «edge auto-scroll … on the frames that follow»
(`--staff-event-top` 0.666667 vs 0.694444), is a frame-count artefact of
running both copies in parallel: re-run alone, twice per copy, both copies
print 0.666667 (no pass file is in the time grid). Ties: the vouchers keep
their `localeCompare` order through the comparator (§9.1 W-4, the spec's
both-directions case) and the glance's equal starts keep input order
(`upcomingSoonestFirst`'s stable case) — no departure (D-13). DEP-3 (a
23:59 DST gap) is not exercised: unreachable on `Europe/Sofia`.

**The dev-stack smoke, as run (G2).** After the three journeys, `pnpm run
dev` (the four emulators, `seed:dev`, the web on :4200) served the closed
tree and a `git archive` copy of `fd5f2a6` (node_modules symlinked) was
served on :4300 against the same emulators and seed. A Playwright script in
the scratchpad drove both with custom tokens minted as the e2e harness
mints them (`window.__e2eSignIn`: `dev-client-1` as client,
`dev-staff-ivan` as barber + admin), reading only, and wrote a DOM
signature per screen — every element, every attribute but Angular's
generated ones, ids, inline styles and URLs, and all text — in bg, then
en. 45 screens per language: the landing's `main` (the shelf tiles), its
service sheet for five services (from price with «от», the bundle's saving,
the performers' prices, the duration), the team showcase's barber sheet
(the barber's prices), `/book`'s services step (card prices, «от» only with
a spread); `/account` and `/account/appointments` (the rows' tone, struck
and status words, the card); and on the staff side, for Георги and for
Мартин each, the client card (hero, tenure line, tier plate, capsules, the
birthday band — Мартин's — the glance's last/next/waitlist cards, the medal
strip and its cue, the points sentence, the records line), the wallet (the
pass, vouchers, tickets, discs, reward tiles, the rhythm section), its
ledger, the medals page, the records page, eight medal details (counted
ladders, a single act, tenure, a barber, the rhythm), the running season's
scope page and one of its families' details, the history page and its
filter menu; and `/admin/loyalty/rhythm` (digest, tolerance example,
effective-day reading, preview, history rows, sample track). **Result: 90
signatures, 86 byte-identical; the other 4 — the history filter menu,
captured over the whole body — differ only in two «след N мин» / "in N
min." glosses of the staff agenda behind the sheet: the minutes between the
two runs, as the grid's now-label was on the earlier smokes.** The console
error sets are identical (68 «Transition was skipped», 54 image 404s).
Not smoked: onboarding's service grid (it needs a registration write; the
DOM differential and `auth-onboarding.spec.ts` cover it), a `/book` service
sheet (the step renders no details button, `[uiShowDetails]="false"`),
writes of any kind, DEP-3. The dev stack and the :4300 server were stopped
afterwards; the emulators keep no data (no import/export), so the seed
state is the committed seed's and every port is free.

### 9.4 Carried forward (to HANDOFF §3.3)

OQ-3 (the service detail sheet's performer sort and bundle saving →
`CatalogPricingSystem.performersByPrice`/`bundleSaving`, then the anonymous
offering goes), OQ-4 (keys built from display words: the grant group key,
the glance's held rewards by NAME — a contract change), OQ-5 (the glance
voucher sum vs the wallet total), OQ-6 (`HISTORY_PAGE_SIZE` /
`FILTER_REFILL_*` read policy), OQ-7 (tie orders — the wallet's
`localeCompare`, the glance's input order — an owner question; no change),
**OQ-9 (owner-flagged):** `.claude/rules/presenters.md`'s canonical example
still reads `LoyaltyPassSystem.passOf(input.account)` and `pass.points`;
the landed binding is `passOf(account, { pointsOn, paused, today })` with
`pass.figure` (balance, or `tierQualifying` with points off). **Applied at
landing** by the session that drafted Law 10: the example now calls
`LoyaltyPassSystem.passOf(input.account, { pointsOn, paused, today })` and
words `pass.figure` by `pass.passFigure` and `pass.passState`. OQ-8 is
NOT carried — R-12's equivalence held and `samplePeriods` delegates to
`StreakSystem.track`. Also carried: the T1 raw `today`/`nowMs` threads the
presenters still parse (D-2.8), incl. the glance's raw
`context.appointmentId` (D-3). G2 adds: `CouponGrantSystem`'s
`OccasionTagged` is `Partial<{ couponOccasion }>` because the host's
`ClientCardGrant.couponOccasion` is optional and pinned so by
`client-card.contracts.spec.ts` — when the owner makes that field required
(`CouponOccasion | null`), tighten the constraint and drop the `Partial`;
the sample's closed-mark words (`admin-rhythm.words.ts` `sampleClosed`)
and the wallet's (`wallet.presenter.ts` `closedPeriod`) word one tag family
from two word sources — one table would serve both (P6); `cueOrder` and
`signedDelta` stay exported only because their specs pin them (no in-repo
caller of `cueOrder`, `signedDelta` read by its spec alone). The stale
`catalog-pricing.system.ts` JSDoc G carried is fixed (G2).

### 9.5 Review round — the fixer (2026-10-23)

Five confirmed review findings, applied with behaviour frozen (every
presenter spec unchanged; `git diff fd5f2a6` still lists no
`*.presenter.spec.ts`, `*.words.spec.ts` or `*.vm.spec.ts`):

| Finding                                        | Change                                                                                                                                                                                                                                                                                                                                                                                                                                    | Spec                                                                                                                                                                                                                                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1.7 due-date precedence left in a presenter  | `StreakSystem.dueAfter(state, inChairDue)` — the in-chair due date, else `dueBy` — the one home of the rule; `outlook`'s gated `nextDue` composes it                                                                                                                                                                                                                                                                                      | `streak.system.spec.ts`: in chair wins, `dueBy` fallback, both null, purity                                                                                                                                                                                                        |
| `rhythmStateLine` / `rhythmLabel` (R-6)        | both uncalled delegates deleted from `loyalty.presenter.ts` (no caller anywhere; `rhythmStateLine` no longer worded its old switch); the wallet's one path stays `rhythmLineOf` + `rhythmTrackName` over `StreakSystem.outlook`; the `outlook` JSDoc no longer names them. The i18n key `clientCard.loyalty.rhythmLabel` stays (admin-rhythm reads it)                                                                                    | `client-card.contracts.spec.ts`: the two names leave the published-helper list (a name list, not a wording assertion; the header note says why)                                                                                                                                    |
| G-16 held-reward exclusion left in a presenter | `RewardSystem.pointsReachBeyondHeld(rewards, heldNames, locale, balance, today)`: `offered` today, minus every reward whose `name[locale]` is held on this visit, then `pointsReach`; the glance passes `catalog.rewards` and the held names and only words the answer (its `offered` import and the `.filter` are gone — §5 grep 3: 44). Still keyed by the coupon's stored NAME: a reward id on the grant is OQ-4's data change         | `reward.system.spec.ts`: held name excluded, none held, two held, all held / empty catalogue, English name only in `en`, owed balance, not offered (off, over), purity                                                                                                             |
| G-20 / closestLevels shelf rank, two copies    | `LoyaltyCatalogSystem.shelfRank(catalog, series)` — the shelf's `order`, `+Infinity` for no shelf or one the catalogue lacks; `cueOrdered` and `StandingSystem.closestLevels` (both tie-breaks) rank by it; the private `shelfOrder` closure is gone                                                                                                                                                                                      | `loyalty-catalog.system.spec.ts`: shelf order, null category, unknown category (and an empty catalogue), equal rank on one shelf, `cueOrdered`'s tie broken by series order, purity                                                                                                |
| M-31 fabricated draft brands, 1439 twice       | `AchievementsSystem.countedDraft(draft)` returns `CountedDraft` — a missing shop, day, minute, weekday or instant is `null`, never `LocationId.of('')`, a Monday, 1439 or the epoch (`today` dropped); `countsToward` reads the `CountableVisit` slice, where a `null` fact never counts; `MinuteOfDay.LAST` (1439 = `MINUTES_PER_DAY − 1`) is the one home of the day's last minute (`addClamped`, `ClientStatsSystem.statWindowsOnDay`) | `achievements.system.spec.ts`: the no-start/no-shop draft is all `null`; a no-start draft counts by services/barber/shop and never early, weekend, on time or party; a no-shop draft fails every shop-scoped family and counts the rest; `minute-of-day.primitive.spec.ts`: `LAST` |

Gate on the fixed tree (the FULL gate of HANDOFF §4): sync:check PASS;
layering 665 files, 3,107 import edges, (a)–(e) ok; typecheck after
`rm -rf dist/out-tsc` — `patterns` only; lint 46 projects, 0 errors;
`run-many -t test --parallel=3` exactly the 6 baseline reds, every project's
count equal to the decision-extraction tree's but ecs-core (4,958 → 4,989,
+31 cases); ecs-core coverage 275 files, 4,989 tests, 98.00 % statements
(13,080/13,346 — one run read 13,079: an unseeded property spec's wobble in
`client-stats.system.ts`, no touched line uncovered), 98.90 % lines
(11,357/11,483); seed-tools typecheck PASS; build web initial 604.28 kB
(164.06 kB transfer); `verify:bundle` PASS; build functions + the four
runtime dependencies; runbook §4.2 28 `ok`, §4.3 22, §4.4 17, §4.5 6, §4.7
24, §4.8 27, §4.9 25; §5 checklist 1 = 0, 1b = 1, 2 = 0, 3 = 44, 4 = 36,
5 = 10; `verify:p0` (a)–(f); `test:emulator` 65 + 255; `e2e:web` 41 passed

- exactly the 19 baseline failures (the glance runs still fail at
  `:384`/`:765`).

Left as it was: `loyalty.presenter.ts` `offered` (a one-line delegate to
`RewardSystem.offered`, no decision) now has no in-repo caller but the
contracts spec's published-helper list — like `cueOrder`/`signedDelta`
(§9.4), it stays while that list pins it.
