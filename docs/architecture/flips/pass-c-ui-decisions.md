# Pass C — components, stores, pipelines, adapters and the edge decide nothing

**Date:** 2026-10-24 · **Status:** DONE — integrated 2026-10-24, the FULL
gate of HANDOFF §4 green (baseline reds only), the §6.3 DOM differential and
the §6.4 dev-stack smoke showing only DEP differences (§9); landed as the
"Pass C" commit. Written on `main` at `2bd2354`
(the ECS migration complete; Law 10.2 pass `fe4635a`; pass A `99a60fa`;
pass B `6b1a7a8`; the constitution's D1–D29 commit `2bd2354`; tree clean).
Line numbers are hints on `2bd2354` and drift as packages land. ·
**Law:** `CLAUDE.md` Laws 1–10 and `.claude/rules/*.md`: `ecs-systems.md`
(Law 3: pure, branded in and out, `now` is an input, purity spec; zero
inbound mapping), `ecs-pipelines.md` (Law 4: read → decide (a system) →
write; no business math in a pipeline), `ecs-components.md` (tag
dictionaries are `as const` components), `ecs-layering.md` (Law 8 tiers,
one home per name, all pipelines in `@core/pipelines`), `ecs-ports.md`
(Law 9), `angular-ui.md` ("a `computed()` calls a system for anything
derived") and `presenters.md` (Law 10: wording stays in presenters and
words files). This plan never overrides them. ·
**Sources:** `docs/architecture/HANDOFF.md` §3.3 (pass B's "For pass C —
KEEP-FOR-C" list, the carried items), §4 (gate and baselines), §5
(operating rules); `docs/architecture/flips/law-10-decision-extraction.md`
§0 (the decision / wording / read-state line, D-1 … D-3, reused here by
reference); the audit's pass-C findings (`c-findings.json`: findings 1, 15–20,
24, 29/78, 48, 63–68, 70–75, 77, 82; plausible defects 1–5; carried OQ-3,
OQ-6, the rhythm closed-mark sources); the seven scout inventories the
workflow handed in (staff-dashboard, visit-editor, staff-day-rest,
client-catalog, admin-marketing-shell, pipelines-adapters-edge,
systems-vocab), each row re-read against the code here. Where this plan
re-rules a scout row, §1 says so.

**What this is.** The Law 10.2 pass moved every decision out of the
PRESENTERS. Pass C does the same for the other places a decision can still
hide: Angular components and their templates, stores, browser use cases in
stores and feature helpers, `@core/pipelines` bodies, adapters and the
functions edge. Every domain decision — a state or lifecycle verb, what is
owed or earned, what qualifies, which items exist, an ordering, a threshold,
a sum or min/max over domain values, interval algebra, money arithmetic,
date arithmetic on wall-clock values, a duplicated rule constant — is
answered by an ecs-core system (or a component companion's helper) and
reaches the caller as a value or a SCREAMING tag. Components and stores keep
UI read-state and wiring; pipelines keep read → decide → write; adapters
keep SDK I/O; the edge validates foreign input once with the companion's
guard. Domain vocabularies are never re-declared in features.

**This pass ends** when every §1 row marked MOVE or WIRE is answered by an
ecs-core system or companion function with a purity + boundary spec, every
caller reads that answer, every UI/pipeline/adapter copy is deleted (or is a
named delegate of D-9), the §5 checklist finds no leftover, every existing
spec passes unchanged except import/wiring lines and the spec cases a
DEPARTURE names, the §6.3 DOM differential shows differences only where a
DEP says so, and the §6.4 dev-stack smoke matches `2bd2354` but for the
DEPs.

---

## 0. Decisions this plan takes (read first)

**D-1 — what a DECISION is.** Exactly the law-10 plan's D-1 (state choice
with precedence; what is owed or earned; qualification; which items exist;
ordering or grouping; a threshold other than the zero form; a duplicated rule
constant), applied to components, templates, stores, pipelines, adapters and
the edge. Pass C adds:

1. **lifecycle legality** — which verbs a row may offer, which one leads,
   which seats a verb addresses, what undoes it;
2. **interval algebra and occupancy** — merge, hull, complement, overlap,
   containment, "what occupies the chair";
3. **write plans** — which commands a draft costs, in which order;
4. **the system-signature defect** — a system input that renames entity
   fields so every caller renames before the call (Law 3 zero inbound
   mapping) is fixed in the SYSTEM's signature, never at the callers.

**D-2 — what is NOT a decision** (stays where it is). The law-10 plan's D-2
(tag → word tables; the zero form of ONE system-given count; form choices;
display caps and layout; host catalogue lookups; UI read-state; feature-flag
gating; boundary parsing), plus:

9. **orchestration** — await order, generation and "the flow let go of this
   while the read was out" guards, pending/error maps, retries that only
   re-issue a call, signal writes, `awaitRow`/`rowWatch` listeners, the
   store's in-flight dedupe;
10. **SDK I/O in an adapter** — the query filter that implements a port's
    documented contract (`observeAppointmentPhotos`'s `byTaken` order,
    emulating an `orderBy`), chunking `IN` reads at 30, transport-failure
    classification;
11. **edge shape validation** — field presence, payload caps (contact name
    120, phone 32, email 254, note 400), wire codes, refusal re-coders;
12. **a single comparison of two primitives through their own order** —
    `localDate < today` (the `LocalDate` JSDoc sanctions string order),
    `endMs <= nowMs` on the minute tick: reading a primitive's order is not a
    rule to extract; a comparison that COMBINES facts (`started ∧ ¬ended ∧
¬settled`) is D-1;
13. **pixel geometry** — `proportionalBox`, extents, column caps, gesture
    physics, `Math.max(0, delta)` drawing clamps.

**D-3 — borderline rows ruled** (every other row follows D-1/D-2):

| Row                                                                                                                                                                                    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staff-time-grid.ts` `proportionalBox` (KEEP-FOR-C names `IntervalSetSystem.clip`)                                                                                                     | STAYS (D-2.13). `clip` drops a non-overlapping range and requires `EndMinute ≤ 1440`; the grid keeps a zero-height box and draws past midnight (`staff-time-grid.spec.ts:116`). Wiring `clip` would clamp late cuts at 24:00.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `staff-timeline.ts` `closedRuns` (KEEP-FOR-C names `IntervalSetSystem.clip`)                                                                                                           | WIRE `GridLayoutSystem.closedRuns` — the same clamp + merge + complement the time grid already calls (`staff-time-grid.ts:2307`); verified equivalent for unsorted, overlapping, touching, out-of-extent and empty windows.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| dashboard search text match (bg collation substring), `splitOnTerm`/`splitOnDigits` highlighting                                                                                       | STAYS (locale collation can never live in a system — the law-10 DEP-1 ruling; the highlight runs are wording of display text). The **≥ 4 bare digits** threshold and the digit-run match MOVE (`SearchFieldsSystem.digitQuery`/`digitsMatch`). Never `ClientQuerySystem.phoneSegments` — a different rule for a different search.                                                                                                                                                                                                                                                                                                                                   |
| dashboard `past = endMs <= nowMs` (grid, search, rows), `live`, `isNext`, the search's outward order, «Скорошни»'s past filter and newest-first order                                  | STAY this pass (D-2.12) — CARRIED (§8 OQ-14). Every one compares a visit's start/end INSTANT with `nowMs`. "Has the visit started/ended" is not on the T2 elapsed-time list (Law 7.3, `flatten-spec.md` §2.3), so its only lawful system home is the wall-clock pair `VisitStorySystem.hasStarted`/`hasEnded(WallTime, ShopNow)` (E-10, E-13, C-22). Adopting that pair on the dashboard changes the answers inside a DST fall-back hour and across shops of different zones — a behaviour change the frozen brief does not allow. An instant-based copy of the rule is never homed in a system.                                                                    |
| dashboard `rosterExtent` (`sd:2387`, min start over every visible roster window)                                                                                                       | STAYS (D-2.13 — the scroll anchor of a day with no now-line; only its start survives). Its windows' ends are anchored minutes that may pass 1440, which `MinuteRange` cannot hold.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| the plain E.164 `tel:${phoneE164}` href (footer `site-footer.component.ts:123`, `booking-error-message.ts:73`, the client card presenter, the editor template, the appointments sheet) | STAYS everywhere (D-2 — URL formatting of a stored canonical value, no decision). R-24 is kept only because the landing PARSES a display string into E.164 (`replace(/[^+\d]/g, '')`), which `E164`'s constructor owns; `callHref` there is incidental reuse.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `staff-day.store.ts` `adoptPhoto` (the library picture onto a visit)                                                                                                                   | MOVES with Y-2: `attach-visit-photo.pipeline.ts` also exports `adoptVisitPhoto` (no bytes, no guard, `PhotoOrigin.Library`), and both use ONE private record builder (id from `nextId`, then `takenByUserId`, then `takenAtUtcMs = nowUtcMs`, in that order). The photo record is assembled in one tier.                                                                                                                                                                                                                                                                                                                                                            |
| KEEP-FOR-C `AppointmentLifecycleSystem.confirm` / `complete` / `markNoShow` / `cancel` / `reopenNoShow` / `reopenSettled` / `markSeatOutcome`                                          | NOT a copy — KEEP-PARKED (§9.6). They are entity WRITE verbs over `transitionAt`, the same graph the server's `transition` already runs. The browser never writes an appointment; it calls the transition callable. What the dashboard re-implements is READ-ONLY legality, which S-2…S-5 and E-26 home beside them (`offeredVerbs`, `leadVerb`, `transitionSeats`, `inverseOf`, `exitVerbs`), composing `canTransition`, `reopenable` and `SeatOutcome.hasSeatMeaning`. Deleting the seven verbs and their spec cases is an owner call, not this pass's.                                                                                                           |
| KEEP-FOR-C `OfferingPriceSystem.isPerformedBy`                                                                                                                                         | WIRE (C-5): the services step's named-barber branch is gated by `barberId !== null && OfferingPriceSystem.isPerformedBy(service, barberId)`, exactly today's `vm.offerings.find(…barberId)` test. A named barber who does not perform the service falls to the "anyone" quote as today, never to `termsFor`'s service-terms fallback.                                                                                                                                                                                                                                                                                                                               |
| KEEP-FOR-C `VoucherSystem.redeem`                                                                                                                                                      | NOT a copy — KEEP-PARKED (§9.6). The editor's draw is a non-refusing PREVIEW (`coverage` through the new `cascade`, E-1); the server settles with `VoucherSystem.settle` inside `BillingSystem.settleVouchers`. `redeem` is a refusing balance write with no caller on either side.                                                                                                                                                                                                                                                                                                                                                                                 |
| KEEP-FOR-C `IntervalSetSystem.clip`                                                                                                                                                    | NOT wired — KEEP-PARKED (§9.6). Row 1 of this table keeps `proportionalBox` (clip would clamp late cuts at 24:00), and `closedRuns` wires `GridLayoutSystem.closedRuns`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| dashboard `durationMinutes` / `catalogTag` span measured on instants                                                                                                                   | STAYS this pass; carried (§8 OQ-14). `DurationMinutes.between` on the wall clock differs on a DST-crossing visit — a behaviour change the frozen brief does not allow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| dashboard `clientLabel` precedence (who a chair is named after, owner 2026-09-03)                                                                                                      | STAYS — wording of whose NAME prints; belongs in a future staff-day presenter (finding 63's wording half, carried).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| dashboard agenda layout (visits before gaps, `barberName` order, elapsed holes dropped at shop scope)                                                                                  | STAYS (D-2.4 — page layout of display rows; the law-10 D-3 "records THEMES" precedent).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| dashboard `allDay` chip cap 3, `seatsHere > 1` share, `rostered.length === 0` chip                                                                                                     | STAYS (D-2.4 / D-2.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| dashboard / editor `MIN_TYPED_MINUTES = 10`, discount `DiscountKind` mode, tip tile ids, slider geometry                                                                               | STAYS (UI read-state / typing UX).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `staff-visit-editor.html:2059` `uiShops().length > 1`                                                                                                                                  | MOVES — `LocationScopeSystem.isMultiShop(count)`, bound as a `computed` boolean; `VisitStorySystem.namesShop` composes it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `client-auth.html:399` `sendCount() >= 3`                                                                                                                                              | STAYS — presentational session state by `docs/design-research/auth-flow-design.md` (:227, "escalation after 3"). Carried (§8 OQ-13).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `booking-flow.store.ts` `commit` / `rereadMove` / `rescheduleFrom` / `submitWaitlist` / landings                                                                                       | STAY (D-2.9). Their decisions are already systems (`BookingCartSystem.toCommitSeats`, `MoveSystem.facts`, `BookingFlowSystem.next`); what remains interleaves store-state checks between awaits (review spec `:381` pins the reread-before-back order). Moving them would split one signal transaction across two files. The duplicated predicates inside (`isTerminal`, the draft-origin precedence) MOVE. §8 OQ-10.                                                                                                                                                                                                                                               |
| dashboard `act()` / `confirmCancel` per-seat call loops and the save/undo orchestration                                                                                                | The DECISIONS move (`transitionSeats`, `inverseOf`, `staffCancelReason`, the frame/undo rules); the call loops STAY in the component this pass (D-2.9: they re-issue a store call per seat and read the store's pending maps). The save/undo use case moves with `commandsFor` in pass D (D-11).                                                                                                                                                                                                                                                                                                                                                                    |
| `staff-day.store.ts` `promos` sorted by name with `localeCompare('bg')`                                                                                                                | STAYS (locale collation; D-2.4 display order). The code-less filter STAYS as the option VM's type narrowing (the adapter row below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `staff-day.store.ts` `grants`/`promos` option VM mapping                                                                                                                               | STAYS this pass (Law 10 wording move, carried with the editor VM reshape — D-11). The expiry rule inside MOVES (`CouponGrantSystem.expiresAtUtcMs`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `staff-day.store.ts` lane boundary (instants ↔ minutes, `rangesOn`, `instantOn`)                                                                                                       | STAYS (D-2.8 boundary conversion; the minute math is `GridLayoutSystem`'s).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `appointment-photos.adapter.ts` `isShot` filter                                                                                                                                        | The RULE moves to the companion guard `PhotoOrigin.countsForClient`; the adapter's count/list keep applying it (a count cannot be filtered after the read). The `byTaken` order STAYS (D-2.10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `coupons-vouchers.adapter.ts` `listOpenCoupons` code filter                                                                                                                            | STAYS (D-2.10 — the port contract: "a grant-only coupon is not on offer", pinned on purpose by `coupons-vouchers.adapter.spec.ts:87-94`). Plausible defect 5 is closed the other way round: the `@core/testing` double (`port-doubles.ts:495`) also drops code-less coupons (`port-doubles.spec.ts:606` stays green — its open coupon has a code), and the port's JSDoc (`engagement.port.ts:62`, "Every enabled coupon") is corrected to "every enabled coupon that carries a code". The store's `coupon.code === null` inside the promo option mapping stays as the VM build's type narrowing (the option-VM row below; D-11). No `DiscountSystem.counterOffers`. |
| `booking-read-set.pipeline.ts` `isReadableId` / functions `isDocumentId`                                                                                                               | STAYS this pass — Firestore path knowledge, not a domain decision; moving it into the tx adapter changes the null branches of `edit`'s read. Carried (§8 OQ-11).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `match-waitlist`/`rebuild-capacity` past-day skips (`localDate < today`)                                                                                                               | STAY (D-2.12).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `match-waitlist` `notify`'s explicit OPEN re-check                                                                                                                                     | STAYS — not provably redundant with the `WaitlistLifecycle` graph (`match-waitlist.pipeline.spec.ts:321` pins it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `reschedule` `standingOf` vs `edit` `subjectOfSeat`                                                                                                                                    | STAY as two rules — they answer for different callers (client intent vs staff); unifying changes answers for `CLIENT`-relationship seats. Carried.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `admin-rhythm` refusal wording (`admin.rhythm.refused.*`, the `StaffEditError` cross-wire)                                                                                             | STAYS (wording; a Law 10 hygiene item) — carried. The refusal GUARD moves (`StreakPublishError.guard`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `client-appointments.ts` `toVisit`/`buildMonth` mappers, `STATUS_TONES`                                                                                                                | STAY this pass (finding 74's wording half: a presenter move, not a decision). The history rule, the move verdict, the month span and the bill sum MOVE.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `catalog.presenter.ts` `formatPrice` (second money formatter), per-call `Intl` builders                                                                                                | STAY (finding 75: wording/performance, no decision). Carried.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `booking-time-sheet.ts` `timedOptions` dropping a DST-gap start                                                                                                                        | STAYS (D-2.8 — the zone conversion at the edge; a system may not hold a zone).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `booking-flow.store.ts` `partySize = guests + 1`                                                                                                                                       | STAYS — equal to `partySeats(party).length` only while the client party holds no companion; an exact port would be a new function for one line. Carried.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `history.presenter.ts` `HISTORY_PAGE_SIZE` / `FILTER_REFILL_*` (carried OQ-6)                                                                                                          | MOVE to `client-card.store.ts` beside `refill` (read policy, its only reader). No behaviour change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| the rhythm closed-mark word sources (`admin-rhythm.words.ts` `sampleClosed`, `wallet.presenter.ts` `closedPeriod`)                                                                     | MOVE to ONE wording helper in `@creativo/features/shared/visits` (wording, not a decision — but the carried duplicate). Id suffix, month form and day form are parameters so both DOMs stay byte-identical.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**D-4 — systems extended, never copied (REUSE, NEVER COPY).** Every
decision lands in the system that already owns its concept. New system
files only where none owns it: `CatalogSystem` (`catalog.system.ts`: the
shelf and the category grouping), `MediaSystem` (`media.system.ts`: the
upload guard both the avatar and the visit photo answer), `RetentionSystem`
(`retention.system.ts`: TTL instants). New component dictionaries: D-7.
Extended: `AppointmentLifecycleSystem`, `AppointmentEditSystem`,
`VisitStorySystem`, `VisitListSystem`, `VisitDraftSystem`,
`ClientQuerySystem`, `SearchFieldsSystem`, `LocationScopeSystem`,
`BillingSystem`, `DiscountSystem`, `VoucherSystem`, `CouponGrantSystem`,
`GridLayoutSystem`, `IntervalSetSystem`, `ScheduleExceptionSystem`,
`ShopZoneSystem`, `RosterSystem`, `AvailabilitySystem`, `CapacitySystem`,
`BookingDecisionSystem`, `CatalogPricingSystem`, `BookingCartSystem`,
`MoveSystem`, `CalendarGridSystem`, `StreakPublishSystem`,
`StreakPreviewSystem`, `RhythmDraftSystem`, `StreakRuleSystem`,
`StreakSystem`, `AgeSystem`, `ProfileEditSystem`, `OnboardingFlowSystem`,
`AvatarSystem`, `ZonedTimeSystem`, `TriggerAttemptSystem`,
`PolicyRecomputeJobSystem`, `BackfillPlanSystem`, `AuditSystem`,
`PagingSystem`, `WaitlistSystem`, `ClientStatsSystem`; component companions
`BookingLifecycle`, `SeatOutcome`, `Seat`, `BookingCall`, `CouponValue`,
`VoucherCode`, `VoucherRedemption`, `PhotoOrigin`, `PlacementPolicy`,
`BookingPolicy`, `Party`, `BookingContact`, `FlexibleWhen`, `BookingDraft`,
`StreakRule`/`StreakQualifierRule`, `Role` helpers; primitives `TimeZone`
(`UTC`) and `LocalDate` (`later`); the error companions `RepositoryError`
(`guard`), `StreakPublishError` (`guard`), `MediaError` (photo codes).
Where a rule already exists the new function COMPOSES it, named in its
JSDoc and checked by §5 item 7.

**D-5 — additive, with two kinds of sanctioned signature change.** No
existing system function changes its OUTPUT except where a DEP says so.
Signatures change only to (a) WIDEN a parameter (contravariant — every
existing caller still compiles: `BookingLifecycle.isSettled`/`isLive` to
`{ readonly bookingStatus: BookingStatus }`, `DiscountSystem.samePromise` to
`DiscountProvenance & CouponValue`), or (b) fix a zero-inbound-mapping defect (D-1.4): the system reads the
stored slice as it is and every renaming caller is re-pointed IN THE SAME
PACKAGE (§2 lists each signature and every caller; a caller outside ecs-core
is a named call-line edit inside the wave-0 package, D-13). A (b) fix also
re-shapes the ARGUMENTS of every existing spec call and the field names of
every fixture typed by the old input; those edits are wiring, listed per
file in §4.3, with every expectation byte-identical. A system input is
never re-shaped after a feature view model — only toward the stored slice.

**D-6 — exact ports, not look-alikes.** A moved decision is the caller's
code ported onto branded inputs, line for line; where a similar existing
function is NOT equivalent, the new one sits beside it and its JSDoc names
the difference (`BillingSystem.recordedTipsTotal` ≠ `tipsOf`, which skips
another currency; `VisitStorySystem.hasStarted` (start ≤ now) ≠
`!isUpcoming` (`isUpcoming` is start ≥ now on an OPEN row — at the start
minute a visit has begun AND is still filed upcoming; the two answer
different questions, C-22); `VisitDraftSystem.overrideFor` (the frame:
against `max(raw leg sum, GRAIN)`) ≠ `typedOverrideFor` (the typed figure:
against the raw leg sum, 0 with no legs) ≠ `durationOverrideOf` (30-minute
default);
`AppointmentLifecycleSystem.inverseOf` has NO reopen-day guard, unlike
`reopenSettled`). Where a caller's rule is locale- or zone-bound, the system
takes it as a parameter (the law-10 `idOrder`/`rowOf` precedent): a
`promiseOf`, `instantOf` or `rowOf` reader handed in by the caller is not
inbound mapping.

**D-7 — new tag dictionaries are components** (`libs/ecs-core/src/components/<name>.data.ts`,
`as const` object + type, SCREAMING values, domain-prefixed field names):
`staff-verb.data.ts` (`ArrivalVerb` — moved from the feature's
`row-verb.ts`, values unchanged `ARRIVED`/`UNARRIVED` — and the type
`StaffVerb = BookingStatus | ArrivalVerb`; it also receives
`MarkArrivalAction` — `ARRIVE`/`CLEAR`, field `markArrivalAction`, values
unchanged — moved out of `mark-arrival.pipeline.ts`, so no tag dictionary
stays in the pipelines tier), `grid-placement.data.ts`
(`PlacementVerdict` — moved from `grid-gesture.ts`, values unchanged),
`shop-coverage.data.ts` (`ShopCoverage` — moved from
`booking-schedule-step.ts`, values unchanged), `seat-arrangement.data.ts`
(`SeatArrangement { Parallel: 'PARALLEL', Sequential: 'SEQUENTIAL' }`
replacing the time sheet's lower-case `'parallel'|'sequential'`, which only
picks a heading word — no DOM attribute prints it; the package proves it by
grep), `opening-hours.data.ts` gains `ShopOpening` (moved from
`locations.component.ts`, values unchanged) with `SHOP_CLOSES_SOON_MINUTES =
60`, `streak-rule.data.ts` gains `StreakPublishConsent { AtOnce:
'AT_ONCE', Ask: 'ASK', AskSwitch: 'ASK_SWITCH' }`, NEW
`retention-group.data.ts` (`RetentionGroup`, one SCREAMING value per TTL
group, field `retentionGroup` — the `RetentionAnchor` discriminator of
P-34), and in primitives (the base tag dictionaries, beside
`VoucherRefusal`) NEW `media-refusal.data.ts` (`MediaRefusal { NotAnImage:
'NOT_AN_IMAGE', TooLarge: 'TOO_LARGE' }` — the neutral answer of
`MediaSystem.check`, which the avatar and the visit photo each wrap in their
own error). **Deliberate exception:** dictionaries ALREADY homed in a system
file (`CancelledSide`, `VisitRowOutcome`, `VisitTone`, `BillPending`,
`TipPreset`, `LedgerVerdict`, …; the staff ones pinned to their homes by
`components/staff-ui-dictionaries.type-spec.ts`) keep their home this pass,
`chairResolution`'s `CancelledSide` included. D-7 governs what pass C
creates or lifts out of features. Moving one member would split the family
and touch `shared/visits` import lines no package owns. The family-wide
re-home to components is carried (§9.6). Each feature that
declared the moved dictionary re-binds and re-exports it from
`@core/components` (the law-10 `BirthdayMoment` precedent) so its importers
and specs keep their import lines. New errors go in `errors/*.error.ts`
only (`media.error.ts` photo codes).

**D-8 — systems return values, brands and tags — never words.** The
walk-in word, a locale, a zone and a display cap arrive as inputs.

**D-9 — frozen feature surfaces.** A feature name a spec, template or
another file imports keeps its name and signature and becomes a thin
delegate of the system (not a copy of the rule): `hollowStatus`
(shared/visits — `status != null && BookingLifecycle.didNotHappen({ bookingStatus: status })`),
`reversibleSave` (dashboard — delegates to `AppointmentEditSystem.undoable`),
`ArrivalVerb` / `RowVerb` (`row-verb.ts` re-binds `ArrivalVerb` and aliases
`RowVerb = StaffVerb`; `ROW_VERB_WORD` stays), `PlacementVerdict`
(`grid-gesture.ts` re-exports), `ShopCoverage` (schedule step re-exports),
`AchievementMetricWord` (`client-card.words.ts`: `export type
AchievementMetricWord = Metric;`, `client-card.words.spec.ts:1131`
untouched), the rhythm preview names its specs import
(`streakFactsReader`, `rhythmPreviewSource`, `rhythmPreviewReadsFacts`,
`sampleRhythmFacts`, `sampleRhythmRun`, `RHYTHM_PREVIEW_*` — delegates or
re-exports from `admin-rhythm.preview.ts`). A feature helper whose WHOLE
body moves is deleted and its spec's import lines re-point
(`day-availability.ts`, `own-profile.ts`'s `saveOwnProfile` re-exported
from `account-state`'s barrel so its three callers keep their import lines,
`rhythm-service-groups.ts`). (Review round 2, §9.8 R2-3: the re-export is
gone — `saveOwnProfile` is a closure now, and its callers are stores that
import it from `@core/pipelines`.)

**D-10 — browser use cases moved into `@core/pipelines`** (Law 8.4; finding
15), each a factory over named port bundles (Law 9 — a subset no bundle
names is split in its port file, never `Pick`ed):
`writeScheduleBlocks` / `clearScheduleBlock` (`schedule-blocks.pipeline.ts`,
the decide handed into `writeScheduleException`'s transaction as today);
`attachVisitPhoto` (`attach-visit-photo.pipeline.ts`, the `uploadAvatar`
twin; `downscaleImage` stays in the store and runs BEFORE the call, so the
guard judges the downscaled blob as today; the guard runs BEFORE `nextId`
and `nowUtcMs` are read — a refused photo uses up no id, as
`st:1494-1505` does today) and `adoptVisitPhoto` (the library picture: no
bytes, no guard), sharing one private record builder; `appendTeamNote`
(`append-team-note.pipeline.ts`: read → `VisitSidesSystem.appendedNote` →
write); `loadHeldGrants` (`load-held-grants.pipeline.ts`: read → usable now →
read coupons → `CouponGrantSystem.held` join); `publishRhythmDraft` /
`withdrawRhythm` (`rhythm-publish.pipeline.ts`: gate → call → answer
mapping incl. throw → `RepositoryError.writeFailed(null, 'threw')` and the
TOO_EARLY re-derivation; the store keeps intent ids, generation, floor,
rebase/adopt and settle); `readRhythmPreviewFacts` / `rhythmPreviewSource`
(`rhythm-preview.pipeline.ts`, the `walk === started` race semantics
unchanged); `observeShopDay` (`shop-day.pipeline.ts`: `observeDayDocs`
and `observeCapacityEntries` only, over `ShopDayStreamPorts` /
`CapacityStreamPorts` — rxjs is lawful in pipelines,
`ensure-session-ready.pipeline.ts` precedent; the key PLANNING
`dayDocsKey`/`sameDayDocsKey` is a decision — which documents a day reads,
a moved visit's own shop by id only for a move at a named shop, barbers in
code-unit order — and moves to `BookingCartSystem` with the `DayQuery` /
`DayDocs` / `BarberDayDocs` / `DayDocsKey` types, so no system imports
`@core/pipelines`);
`saveOwnProfile` (`save-own-profile.pipeline.ts`, over `GatewayPorts`, the
refusal allowlist with it). Not moved: D-3's booking-flow and dashboard
loop rulings.

**D-11 — the pass-D boundary (CARRIED, decision named, not moved here).**
A decision whose inputs are a raw VM contract that needs contract-wide
branding (string ids, draft-local ids told apart by spelling, prices as
display labels) is carried to pass D, which brands those contracts:
the dashboard's `commandsFor` write plan (incl. REPRICE gated on
`priceLabel !== before.priceLabel`, serial leg placement, subject choice,
ladder pins) and its `saveFromEditor`/`offerSaveUndo` use case; the editor's
`savedShape`/`dirty` (the same knowledge — moved together or not at all);
`createFromEditor`'s booking request (owner by id spelling); the editor's
`withoutClient`, `repeatLast`, `unserved`/`saveable`, `addCountedService`,
`cardContextOf` party rules (draft ids); `catalogueTotalLabel` and
`snapshotCommitOf` (money re-parsed from labels — needs `priceCents` on
legs, the HANDOFF "staff dashboard's raw `priceCents`" follow-up); the
editor discount VM reshape (`VisitEditorDiscount`/`Value` → `DiscountProvenance
& CouponValue`) and the store's option-VM presenter; the client-option VM's
optional `email?` (`VisitEditorClientOption`, `client-query.ts`'s
`RankableClient`) made a required `email: string | null` so `toRankable`
can go (E-22 — it touches spec fixtures typed by that VM); `EditCommandRequest`'s
`AddSeat`'s `AccountOccupant` raw-id reshape; `actorRoles: readonly
string[]`. Inside those functions pass C still wires what has a home
(`DiscountSystem.samePromise` via the edge parse, `VoucherCode.sameCover`,
`VisitDraftSystem.PLACEHOLDER_CLIENT_ID` / `accountKeyOf`).

**D-12 — frozen behaviour; the one exception.** Every screen renders the
same DOM, every callable and trigger answers the same, every stored document
is the same, every existing spec passes unchanged except import/wiring
lines — EXCEPT where two live rules for the same decision disagree today:
ONE rule survives (by default the ecs-core/server rule; the other where the
evidence shows it is the owner's), each a numbered DEPARTURE (end of this
plan): DEP-1 who cancelled (incl. the mixed-actor chair), DEP-2 what occupies the chair for a placement,
DEP-3 the save receipt's undo, DEP-4 "is the chair off all day", DEP-5 a
recent visit's client account, DEP-6 the manual percent range (edge rule
survives — no change), DEP-7 the upload size boundary, DEP-8 the
onboarding card's price/duration, DEP-9 the services step's "anyone" quote,
DEP-10 the bundle saving's arithmetic, DEP-11 the editor's last visit date
order (pinned no-op), DEP-12 the editor's same-promise rule (pinned no-op),
DEP-13 the trigger event-time parse (telemetry only), DEP-14 the empty
staff batch's field (pinned no-op). Disagreements whose fix needs a new read
or an owner ruling are NOT departures here — they are carried (§8 OQ-3
`staffWalkIn`/D18, OQ-4 the account's next visit, OQ-5 the OTP cooldown).

**D-13 — waves.** Wave 0 (ALONE) is ecs-core: every system, component,
error and pipeline addition with its specs, in ten packages with DISJOINT
files (§3). Wave 0 keeps the whole tree compiling: (a) additions and
widenings break nobody; (b) a zero-inbound-mapping signature fix edits the
exact feature/app CALL LINES that would break (named in §3 — wave 1 then
owns those files); (c) a name a wave-1 consumer still imports stays as a
transitional delegate (`UTC_ZONE = TimeZone.UTC`, the pipeline's
`repositoryFailure`/`decisiveAttemptFailure` delegating to
`TriggerAttemptSystem`), deleted in wave 2. Wave 1 re-points the consumers
in eight packages with disjoint files; three staff-dashboard packages share
one Nx project and exchange three declared cross-sites (§3 "C1–C3"). Wave 2
is the integrator's deletion of the transitional names and the copies no
wave-1 package could own.

---

## 1. The decision inventory (re-verified on `2bd2354`)

Ruling: **MOVE** (a new/extended system function), **WIRE** (an existing
function, exact), **STAYS** (D-2/D-3), **CARRY** (D-11 or §8). File
abbreviations: `sd` = `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.ts`,
`ve` = `…/visit-editor/staff-visit-editor.ts`, `st` = `…/staff-day.store.ts`.
The specs column names the cases that pin the decision today; the system
spec ports them as value/tag assertions.

### 1.1 Staff dashboard (`sd`, `staff-dashboard.html`)

| ID   | Site                                                                                                                                                                         | Decision                                                                                  | Ruling               | Target                                                                                                                                                                                                                                                                                                   | Pinned by (`staff-dashboard.spec.ts` unless named)         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| S-1  | sd:785 `isTerminalStatus` (used :3672, :3720, :6212)                                                                                                                         | settled predicate (name contradicts `isTerminal`)                                         | WIRE                 | `BookingLifecycle.isSettled` (widened, D-5); delete the local                                                                                                                                                                                                                                            | :1423, :2033, :3560, :3639, :3686, :3019                   |
| S-2  | sd:975 `OFFERED` + :3603-3620 legal set + same-day edge                                                                                                                      | lifecycle legality incl. the reopen edge                                                  | MOVE                 | `AppointmentLifecycleSystem.offeredVerbs` over `reopenable` (shared with `reopenSettledSlice`); `today` = `store.shopNow().localDate` (rows on the shown day: identical)                                                                                                                                 | :2011, :2033; port `reopenSettled` cases                   |
| S-3  | sd:992 `primaryVerb`                                                                                                                                                         | lead-verb precedence ladder                                                               | MOVE                 | `AppointmentLifecycleSystem.leadVerb` → `StaffVerb \| null`; `ArrivalVerb` to `@core/components` (D-7); `verbKey` STAYS (wording)                                                                                                                                                                        | :2011, :2033; editor :330, :1526 via `ArrivalVerb`         |
| S-4  | sd:367 `seatScopeOf` + :3784 "CONFIRMED addresses the root"                                                                                                                  | party-vs-seat fan-out                                                                     | MOVE                 | `AppointmentLifecycleSystem.transitionSeats` over `SeatOutcome.hasSeatMeaning`; the loop STAYS (D-3)                                                                                                                                                                                                     | :2033, :2259, :2743, :2805                                 |
| S-5  | sd:3824 `offerUndo` inverse                                                                                                                                                  | lifecycle inverse                                                                         | MOVE                 | `AppointmentLifecycleSystem.inverseOf` (no day guard, D-6)                                                                                                                                                                                                                                               | none — new system cases                                    |
| S-6  | sd:5317 `confirmCancel` reason rule                                                                                                                                          | OTHER with no words → no code                                                             | MOVE                 | `BookingCall.staffCancelReason` beside `clientCancel`; the loop/retry set/note append STAY (D-3)                                                                                                                                                                                                         | :2423-:2824 «Друго…» block, :2259                          |
| S-7  | sd:3365 `resolutionOf`                                                                                                                                                       | who cancelled; the settling stamp; distinct reasons                                       | MOVE                 | `VisitStorySystem.chairResolution` composing `rootStory`, `decisiveCancellationIndex`, `distinct`; `by` becomes `CancelledSide \| null` — **DEP-1** (incl. the mixed-actor chair); `CancelledSide` keeps its system-file home (D-7 exception); the reason WORDS stay                                     | :2191 (changes, DEP-1), :3593, :3625; new mixed-actor case |
| S-8  | sd:3966-3982, :4067-4080, :5453-5463, :6193-6212 neighbours                                                                                                                  | what occupies the chair for a placement                                                   | MOVE                 | `BookingLifecycle.isLive` at all four sources — **DEP-2**; the CHAIR's summarized status at the two DayRowVm sources (anchor day :4067, create :5453), the ROOT `appointment.bookingStatus` at the two appointment sources (stepped day :3968, block other-day :6207 — what the block path does today)   | :3019, :1930; new split-party case                         |
| S-9  | sd:301 `reversibleSave` (called :4482)                                                                                                                                       | which save has an undo                                                                    | MOVE                 | `AppointmentEditSystem.undoable(rootStatus, commands)`; `reversibleSave` a delegate (D-9) fed `{ bookingStatus: row.rootBookingStatus }` — **DEP-3**; `DayRowVm` gains `rootBookingStatus`                                                                                                               | :5667-:5695 (unchanged)                                    |
| S-10 | sd:6756-6776 `sameDiscount`/`sameDiscounts`/`sameCodes`                                                                                                                      | is the drafted bill the stored one                                                        | WIRE                 | `DiscountSystem.samePromise` (widened) through the edge parse `promiseOf(discount)`; `VoucherCode.sameCover` (normalize then in-order equal)                                                                                                                                                             | :5697, :4823                                               |
| S-11 | sd:6744 `vouchersOf` `amountCents + balanceAfterCents`                                                                                                                       | what this visit may still draw                                                            | MOVE                 | `VoucherRedemption.drawableCents`                                                                                                                                                                                                                                                                        | :4823                                                      |
| S-12 | sd:2056-2090 `openWindowsOf` merge                                                                                                                                           | interval normalisation                                                                    | STAYS                | the merge runs on the dashboard's ANCHORED minutes (`minuteOfDay`, :2360: an after-midnight shift end reads > 1440, kept on purpose), which `MinuteRange`'s `EndMinute ≤ 1440` cannot hold; clamping would change the raw OUTSIDE verdict past midnight (Y-14, §7 R-6). Carried with OQ-14               | :3174, :3360, :3293                                        |
| S-13 | sd:3992, :4177, :5512, :6178 roster extent                                                                                                                                   | min start / max end over windows                                                          | MOVE                 | `IntervalSetSystem.hull` → `MinuteRange \| null`; each caller keeps its own empty fallback (0–1440 vs the owner's 0–0); `rosterExtent` (:2387) STAYS (D-3, scroll anchor)                                                                                                                                | :3822, :2997, :1930                                        |
| S-14 | sd:3671-3672 `live`                                                                                                                                                          | in the chair now (instants)                                                               | CARRY                | §8 OQ-14 (D-3): compares instants with `nowMs`; the lawful system home is the wall-clock `hasStarted ∧ ¬hasEnded ∧ ¬settled`, a DST-hour behaviour change                                                                                                                                                | :1661, :1737, :1803                                        |
| S-15 | sd:2645 `isNext`                                                                                                                                                             | first ¬settled starting strictly after now (instants)                                     | CARRY                | §8 OQ-14 (D-3), as S-14                                                                                                                                                                                                                                                                                  | none                                                       |
| S-16 | sd:1592 search ordering                                                                                                                                                      | future soonest, then past newest (instants, `+∞` before the zone)                         | CARRY                | §8 OQ-14 (D-3), as S-14; the `past` flag and the order keep reading the one `endInstantOf`                                                                                                                                                                                                               | :3480, :3504                                               |
| S-17 | sd:882-950, :1557 search match; `staff-dashboard.html:362` / sd:1543 term length                                                                                             | ≥ 4 bare digits threshold + digit-run match; the ≥ 2 term threshold (template + computed) | MOVE                 | `SearchFieldsSystem.digitQuery` / `digitsMatch`; `SearchFieldsSystem.TERM_MIN = 2` + `termSearchable(term)`, each site keeping its own operand (the template a computed boolean over `term().trim()`, the results computed its lowercased term) — one constant; text collation + highlighting STAY (D-3) | :3480, :3504                                               |
| S-18 | sd:2963 `dayTips`                                                                                                                                                            | strict one-currency tip sum                                                               | MOVE                 | `BillingSystem.recordedTipsTotal(seats)` (≠ `tipsOf`, D-6)                                                                                                                                                                                                                                               | none — new system cases                                    |
| S-19 | sd:2932 `daySummary` minutes                                                                                                                                                 | sum of gap minutes                                                                        | MOVE                 | `GridLayoutSystem.totalMinutes(gaps)`; the `scope === null` gate STAYS                                                                                                                                                                                                                                   | :1711-:1731                                                |
| S-20 | sd:5752 `browseClients` + :6714 `accountOf`                                                                                                                                  | recent/book accounts: distinct, booker identity, named, cap                               | MOVE                 | `ClientQuerySystem.recentAccounts(orderedPast, limit)` / `bookAccounts(newestFirst)` — identity **DEP-5**; cap 8 is an input. The `utcEpochMs < now` filter and the newest-first instant sort STAY in the component (D-3, OQ-14) and hand the ordered list in                                            | :4561, :4739                                               |
| S-21 | sd:3575-3580 people dedupe; :3646 `selfSeat`                                                                                                                                 | one entry per person; holds an own-account seat                                           | WIRE / MOVE          | dedupe keyed by `VisitStorySystem.personKeyOf` (emitted ids unchanged: `guest-<label>`); `Seat.isOwnAccount(seat)`                                                                                                                                                                                       | :6821, :6898, :6149                                        |
| S-22 | sd:3714 `overridden`                                                                                                                                                         | override mark                                                                             | WIRE                 | `Seat.overridden`                                                                                                                                                                                                                                                                                        | :6028                                                      |
| S-23 | sd:843 `GRAIN_MINUTES_FOR_KIND`, :5550 `nowSnapped`, :5614 `Math.max(span, 5)`, :5483 `?? 30`, :4730/:5999 `'primary'`                                                       | duplicated constants                                                                      | WIRE / MOVE          | `VisitDraftSystem.GRAIN_MINUTES` + `snapUp` (new), `DEFAULT_SPAN_MINUTES`, `PLACEHOLDER_CLIENT_ID`                                                                                                                                                                                                       | :6130, :5853, :6149                                        |
| S-24 | sd:5998-5999 `isAccount` (id spelling); :5660 guest skip                                                                                                                     | account vs walk-in by the id's spelling                                                   | MOVE                 | `VisitDraftSystem.accountKeyOf(clientId)` + `GUEST_KEY_PREFIX` (shared with the editor E-18); the origin tag is pass D                                                                                                                                                                                   | :6149, :6219                                               |
| S-25 | sd:5994, :5471, :6430 default shop (`locationIds[0]`)                                                                                                                        | the chair's home shop                                                                     | MOVE                 | `LocationScopeSystem.homeOf(barber)`                                                                                                                                                                                                                                                                     | :6130, :6149                                               |
| S-26 | sd:6339 `offOn`                                                                                                                                                              | the chair is off all day                                                                  | MOVE                 | roster-empty everywhere (no system — the store's system answer read in its zero form) — **DEP-4**                                                                                                                                                                                                        | :2977, :3136, :6624                                        |
| S-27 | sd:2032 week lane filter (copy of `st:2050`)                                                                                                                                 | which chairs are drawn                                                                    | MOVE                 | `RosterSystem.worksDay(rosteredCount, appointmentCount)` shared with Y-12                                                                                                                                                                                                                                | :3360, :3174                                               |
| S-28 | `staff-dashboard.html:764/:852` `hollowStatus`                                                                                                                               | did not happen                                                                            | WIRE                 | `hollowStatus` delegate (D-9) over `BookingLifecycle.didNotHappen`; template unchanged (the `hasFoot` coupling stays as is)                                                                                                                                                                              | :1423, :3639, :3686, :3560                                 |
| S-29 | sd:814 `statusOf`                                                                                                                                                            | BookingStatus guard copy                                                                  | MOVE                 | `isBookingStatus(value)` in `primitives/booking-status.data.ts` (shared with the wire F-10)                                                                                                                                                                                                              | refusal-wording cases                                      |
| S-30 | sd:2652-2668 `LaneVm.extentLabel`, `visitCount`                                                                                                                              | no reader                                                                                 | DELETE               | (dead; not moved)                                                                                                                                                                                                                                                                                        | none                                                       |
| S-31 | sd:4660 `commandsFor`, :4450 save/undo, :5986 `createFromEditor`, :2744 agenda layout, :3728 word helpers, :3887 read-state, :1872 terms (pass A), :6807 `toDiscountRequest` | write plan / wording / read-state / wire shaping                                          | CARRY (D-11) / STAYS | —                                                                                                                                                                                                                                                                                                        | —                                                          |

### 1.2 Visit editor (`ve`, `staff-visit-editor.html`, `client-query.ts`)

| ID   | Site                                                                                                                                                                                                                                                     | Decision                                                                                                                                                                                                                          | Ruling       | Target                                                                                                                                                                                                                                                                                                                                                                                          | Pinned by (`staff-visit-editor.spec.ts` unless named)                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| E-1  | ve:5804 `evaluate` re-sort; :5912 `voucherLines`; :6135 `dockDue`; :6083 `discountSummary` took; :6262 `nothingLeft`                                                                                                                                     | the drafted bill: line order, voucher cascade ×2, what came off, nothing left to cover                                                                                                                                            | MOVE         | `BillingSystem.draftBill(subtotal, discounts, voucherAvailable)` composing `DiscountSystem.apply` + `DiscountSystem.ordered` + `VoucherSystem.cascade`; `toCouponValue` stays the edge parse; every input line kept (zeros too)                                                                                                                                                                 | :4893, :4528, :4791, :5104, :5304, :5506, :5561, describe :2043             |
| E-2  | ve:5026 `offerBlocked`                                                                                                                                                                                                                                   | eligibility                                                                                                                                                                                                                       | WIRE         | `Combinability.canAdd` (the VM's `exclusive` → `Combinability` at the edge); `applied` short-circuit STAYS                                                                                                                                                                                                                                                                                      | :4893, :4791                                                                |
| E-3  | ve:7344 `samePromise` (used by `addDiscount` :6181)                                                                                                                                                                                                      | same promise twice                                                                                                                                                                                                                | WIRE         | `DiscountSystem.samePromise` (widened) through `promiseOf` — **DEP-12**                                                                                                                                                                                                                                                                                                                         | :7505, :4528, :4893                                                         |
| E-4  | ve:6178 `addDiscount`                                                                                                                                                                                                                                    | what the set becomes                                                                                                                                                                                                              | MOVE         | `DiscountSystem.withAdded(current, candidate, promiseOf)` (exclusive replaces all, an exclusive line gives way, a manual figure replaces the manual figure, same promise no-op)                                                                                                                                                                                                                 | :4893, :4995, :5304, :7505                                                  |
| E-5  | ve:4985 `promoChoices` hide rule                                                                                                                                                                                                                         | a held coupon's code is not offered again                                                                                                                                                                                         | MOVE         | `DiscountSystem.offerablePromos(promos, heldCouponIds, couponIdOf)`                                                                                                                                                                                                                                                                                                                             | :4791 (order); new system case for the hide                                 |
| E-6  | ve:5494, :5529, :6239, :6267 `trim().toUpperCase()`                                                                                                                                                                                                      | code normalisation copy                                                                                                                                                                                                           | WIRE         | `VoucherCode.normalize`                                                                                                                                                                                                                                                                                                                                                                         | :4995, :5088, :5226                                                         |
| E-7  | ve:5439 `figureRead` (> 0 whole percent, > 0 cents)                                                                                                                                                                                                      | manual figure range                                                                                                                                                                                                               | MOVE         | `CouponValue.manualPercentOff` / `fixedAmount` — **DEP-6** (no change). The digit strip (`raw.replace(/[^\d]/g, '')`, so «1.5» reads 15) STAYS in the editor (string handling, D-2.8); `manualPercentOff` receives the stripped integer, never `Number(raw)`                                                                                                                                    | :5304, :5750                                                                |
| E-8  | ve:5420 `cappedFigure`                                                                                                                                                                                                                                   | clamp percent ≤ 100, amount ≤ subtotal                                                                                                                                                                                            | MOVE         | `BillingSystem.capManual(value, subtotal)`; the string handling (a run under the cap returned untouched) STAYS                                                                                                                                                                                                                                                                                  | :5304                                                                       |
| E-9  | ve:3024 `settled`; ve:3041 `gone`                                                                                                                                                                                                                        | settled; the edit lock                                                                                                                                                                                                            | WIRE / MOVE  | `BookingLifecycle.isSettled` (widened); `AppointmentEditSystem.locksEdits(status)`, which `guard` calls                                                                                                                                                                                                                                                                                         | :1599, :6634, :2809, :3080; :6469, :6485, :2435, :2499, :3994, :5506, :7912 |
| E-10 | ve:3119 `exits` `started`                                                                                                                                                                                                                                | has the visit started (equal minute counts)                                                                                                                                                                                       | MOVE         | `VisitStorySystem.hasStarted(start: WallTime, now: ShopNow)` (compare ≤ 0, ≠ `!isUpcoming`); `nowMinute === null` on today stays "not started" at the edge                                                                                                                                                                                                                                      | :1555, :1586, :1599                                                         |
| E-11 | ve:3066 `resolutionKey` `by === 'client'`                                                                                                                                                                                                                | lower-case copy of the side vocabulary                                                                                                                                                                                            | MOVE         | `VisitEditorResolution.by: CancelledSide \| null`, narrow on `CancelledSide.Client` (cross-site C1, DEP-1)                                                                                                                                                                                                                                                                                      | :6634-:6697; fixtures :2508, :2816, :3087, :4012, :6650 (value renames)     |
| E-12 | ve:2711 `frameVerdict`                                                                                                                                                                                                                                   | half-open overlap / containment                                                                                                                                                                                                   | WIRE         | `MinuteRange.overlaps` / `contains` on the edge-parsed span; which neighbours count is S-8/DEP-2; it keeps reading the SEEDED day (§8 OQ-9)                                                                                                                                                                                                                                                     | none pinned — add a verdict case                                            |
| E-13 | ve:2595 `frameColumns` neighbour `past`                                                                                                                                                                                                                  | ended on the wall clock                                                                                                                                                                                                           | MOVE         | `VisitStorySystem.hasEnded(end: WallTime, now: ShopNow)`; the surplus clamp STAYS (D-2.13)                                                                                                                                                                                                                                                                                                      | :6735, :6702, :6711                                                         |
| E-14 | ve:2362 span; :3599 `onFrameDraft`; :3686 `setDuration`; :2358 `legSum`                                                                                                                                                                                  | span floor and the two override rules                                                                                                                                                                                             | MOVE         | `VisitDraftSystem.editorSpan(override, legs)`; `overrideFor(span, legs)` for the frame (null when span === max(raw leg sum, GRAIN)) and `typedOverrideFor(minutes, legs)` for the typed figure (null when minutes === raw leg sum — 0 with no legs: typing 5 on a leg-less draft stores 5, as today) — exact, D-6; delete `legSum`                                                              | :976, :1737, :1903, :5721, :5730                                            |
| E-15 | ve:2417 `commitEnd`; :1157 `GRAIN_MINUTES`                                                                                                                                                                                                               | end before start = next day, snap, floor                                                                                                                                                                                          | MOVE         | `VisitDraftSystem.spanToEnd(start, typedEnd)` + `snap`; `GRAIN_MINUTES` from `VisitDraftSystem`                                                                                                                                                                                                                                                                                                 | :6431, :1903, :5730                                                         |
| E-16 | ve:2059 `catalogSum` builds `CatalogLegMinutes`                                                                                                                                                                                                          | per-leg catalogue lookup into `catalogMinutesOf`                                                                                                                                                                                  | STAYS        | D-2 host catalogue lookup: both callers compute `catalogMinutes` per element (editor `catalogTermsOf(leg)?.minutes ?? leg.catalogMinutes`; dashboard `chairMinutesOf(seat, barberId)`) and build branded `DurationMinutes` legs at their edge — not a renaming defect. `CatalogLegMinutes` and both call lines unchanged                                                                        | :6537                                                                       |
| E-17 | `staff-visit-editor.html:2059` `uiShops().length > 1`                                                                                                                                                                                                    | threshold in a template                                                                                                                                                                                                           | MOVE         | `LocationScopeSystem.isMultiShop(count)` bound as a computed                                                                                                                                                                                                                                                                                                                                    | :2809, :2608, :2649                                                         |
| E-18 | ve:958 `accountIdOf` + `'primary'` ×5 + `'guest-'` mint                                                                                                                                                                                                  | identity by id spelling                                                                                                                                                                                                           | MOVE         | `VisitDraftSystem.accountKeyOf` / `GUEST_KEY_PREFIX` / `PLACEHOLDER_CLIENT_ID` (ids stay byte-identical)                                                                                                                                                                                                                                                                                        | :5850, :5987, :7476                                                         |
| E-19 | ve:739 `refusal`, :5706 `codeState` `'void'\|'expired'\|'empty'`                                                                                                                                                                                         | lower-case copy of `VoucherRefusal`                                                                                                                                                                                               | MOVE         | carry `VoucherRefusal`; `codeNote` words keyed on it (cross-site C2)                                                                                                                                                                                                                                                                                                                            | :5205                                                                       |
| E-20 | ve:7212 `lastVisitDate`                                                                                                                                                                                                                                  | newest worked visit, wall-clock order                                                                                                                                                                                             | WIRE         | `VisitStorySystem.lastWorked` via the card presenter's `lastWorkedVisit` — **DEP-11**                                                                                                                                                                                                                                                                                                           | :7423                                                                       |
| E-21 | ve:4361 `openNewClient` `phoneDigits.length >= 5`                                                                                                                                                                                                        | prefill threshold                                                                                                                                                                                                                 | MOVE         | `ClientQuerySystem.PREFILL_PHONE_DIGITS` + `prefillsPhone(parsed)`                                                                                                                                                                                                                                                                                                                              | :3507, :5812                                                                |
| E-22 | `client-query.ts:116` `toRankable`                                                                                                                                                                                                                       | normalises the VM's optional `email?` → null                                                                                                                                                                                      | STAYS        | the system's `RankableClient` keeps every field present (no optional field in a system input — 0 today); the optional field is the VM's defect, reshaped with the editor VM in pass D (D-11)                                                                                                                                                                                                    | `client-query.spec.ts`, :3198                                               |
| E-23 | ve:747 `discountValueOf` imported by `st:109`                                                                                                                                                                                                            | a mapper exported from a component file                                                                                                                                                                                           | MOVE (file)  | to `visit-editor/visit-editor-discount.ts` (cross-site C3); the VM reshape CARRY                                                                                                                                                                                                                                                                                                                | —                                                                           |
| E-24 | ve:1936 `savedShape`/`dirty`, :1268 `withoutClient`, :3972 leg mutators, :6385 `unserved`/`saveable`, :958→:6690 `cardContextOf`, :7126 `repeatLast`, :7094 `addCountedService`, :6471 `catalogueTotalLabel`, :1378 `snapshotCommitOf`, :645 discount VM | draft rules over raw ids / labels                                                                                                                                                                                                 | CARRY (D-11) | —                                                                                                                                                                                                                                                                                                                                                                                               | —                                                                           |
| E-25 | ve:4441 section gating (E-26 aside); :4785 tip entry; :4911 UI modes; :6056 wording; ve:3785 `figureOf` per-call `Intl`                                                                                                                                  | composition / read-state / wording                                                                                                                                                                                                | STAYS        | —                                                                                                                                                                                                                                                                                                                                                                                               | —                                                                           |
| E-26 | ve:3119-3180 `exits`                                                                                                                                                                                                                                     | which lifecycle verbs the sheet offers as exits, in order: ARRIVED and COMPLETED never; CONFIRMED ("reinstate") only when the chair is not PENDING; NO_SHOW only once started; CANCELLED last; «rebook» only when settled ∧ ¬gone | MOVE         | `AppointmentLifecycleSystem.exitVerbs(chairStatus, offered: readonly StaffVerb[], started, settled, gone)` → `{ verbs: readonly StaffVerb[]; rebook: boolean; cancel: boolean }`, ported exactly (UI-only legality: the server's no-show takes no start input); `started` from E-10, `settled`/`gone` from E-9; the component keeps only the exit ids, icons, labels and the cancel scope words | :1555, :1586, :1599 + every exits case; new system cases                    |

### 1.3 Staff day store, time grid, timeline, block editor

| ID   | Site                                                                                                                      | Decision                                                       | Ruling      | Target                                                                                                                                                                                                                                                                                                     | Pinned by                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Y-1  | st:185 `MAX_PHOTO_BYTES`, :192 `photoUploadRefusal`                                                                       | upload guard, bare lower-case refusals                         | MOVE        | `MediaSystem.check(file, maxBytes)` → `MediaRefusal \| null` + `MediaSystem.PHOTO_MAX_BYTES`; `attachVisitPhoto` wraps the tag in the new `MediaError` photo codes — **DEP-7**; the store keeps answering `false`                                                                                          | `appointment-photos.adapter.spec.ts:207` (comment); new system cases                    |
| Y-2  | st:1484 `attachPhoto`; st:1525 `adoptPhoto`                                                                               | browser use case; the photo record built twice                 | MOVE        | `attachVisitPhoto` / `adoptVisitPhoto` pipelines (D-10, one private record builder; guard before `nextId`/`nowUtcMs`); `downscaleImage` stays in the store                                                                                                                                                 | `staff-dashboard.spec.ts:4368`; the adopt cases                                         |
| Y-3  | st:2232 `writeBlocks` decide closure                                                                                      | CLOSED replaces, range merges, CLOSED keeps                    | MOVE        | `ScheduleExceptionSystem.block` + `writeScheduleBlocks` pipeline                                                                                                                                                                                                                                           | `staff-dashboard.spec.ts:3067`, `:3097`, `:3136`                                        |
| Y-4  | st:2296 `clearBlock` decide closure                                                                                       | delete / refuse on CLOSED / delete on empty / HOURS vs BLOCKED | MOVE        | `ScheduleExceptionSystem.unblock` + `clearScheduleBlock` pipeline                                                                                                                                                                                                                                          | `staff-dashboard.spec.ts:2977`; new system cases                                        |
| Y-5  | st:2245 zone pick; :907 page zone                                                                                         | named shop's zone, else the default                            | MOVE        | `ShopZoneSystem.zoneOr(named, fallback)` / `zoneOfScope(named, firstListed, fallback)` (shared with C-15)                                                                                                                                                                                                  | `staff-dashboard.spec.ts:901`                                                           |
| Y-6  | st:737 `laneGeometryOf`                                                                                                   | barber-day assembly (3rd copy); `spans: busyDay?.blocks`       | MOVE        | `RosterSystem.shopHoursOn` (the build) + `AvailabilitySystem.paddedBusy` reading the stored slices (D-5b); the all-shops filter and carve-outs stay the store's                                                                                                                                            | `lane-geometry.spec.ts:48`                                                              |
| Y-7  | st:120 `grantExpiresOn`                                                                                                   | which grants lapse                                             | MOVE        | `CouponGrantSystem.expiresAtUtcMs(grant)`; the store turns it into a shop day (D-2.8)                                                                                                                                                                                                                      | `staff-dashboard.spec.ts:6719`                                                          |
| Y-8  | st:1666 promos `coupon.code === null` + adapter :85                                                                       | which coupons are counter offers                               | STAYS       | the adapter's filter is the port contract (D-3, D-2.10); the double and the port JSDoc align to it (W0-F); the store's check is the option VM's type narrowing                                                                                                                                             | `coupons-vouchers.adapter.spec.ts:87-94` (unchanged)                                    |
| Y-9  | st:1463 `visitPhotos` by `takenAtUtcMs`                                                                                   | stamp order                                                    | STAYS       | the adapter's `byTaken` order (D-2.10), documented on `ObserveAppointmentPhotos` (`notes-photos.port.ts:19`) and honoured by the `@core/testing` double (stable, by `takenAtUtcMs` — W0-F); the store's re-sort is then DELETED as a second copy of the port contract, after W1-S1 re-runs the photo cases | `staff-dashboard.spec.ts:4368` and every photo case                                     |
| Y-10 | st:178 `VOUCHER_REFUSAL_WORD`                                                                                             | lower-case vocabulary copy                                     | MOVE        | return `VoucherRefusal` (cross-site C2)                                                                                                                                                                                                                                                                    | editor :5205                                                                            |
| Y-11 | st:1733 `saveTeamNote`; :1419 `teamNoteOf`; :1762 `appendTeamNote`                                                        | stored-note rule copy; read-decide-write                       | WIRE / MOVE | `VisitSidesSystem.storedNote` (exact; `teamNoteOf` keeps returning the untrimmed text); `appendTeamNote` pipeline (D-10)                                                                                                                                                                                   | `staff-dashboard.spec.ts:2550`, `:2567`, `:2576`, `:2614`, `:5326`, `:5339`, `:5409`    |
| Y-12 | st:2050 `workingLanes` / :2057 `offToday`                                                                                 | which chairs are drawn                                         | MOVE        | `RosterSystem.worksDay(rosteredCount, appointmentCount)` (S-27 shares it)                                                                                                                                                                                                                                  | `staff-dashboard.spec.ts:3174`                                                          |
| Y-13 | st:1609 `loadGrants`                                                                                                      | read → usable → read → join                                    | MOVE        | `loadHeldGrants` pipeline over `CouponGrantSystem.held`                                                                                                                                                                                                                                                    | `staff-dashboard.spec.ts:817-826`, `:6719`                                              |
| Y-14 | `staff-time-grid.ts:1400` `draftVerdict`                                                                                  | SHORT ≤ floor, then first non-GAP overlap, then OUTSIDE        | MOVE        | `GridLayoutSystem.placementVerdict` on RAW integer minutes (never `MinuteRun`, whose end clamps at 1440); `PlacementVerdict` to `@core/components` (D-7)                                                                                                                                                   | `staff-time-grid.spec.ts:1649`, `:1028`, `:1042`, `:1070`; `staff-timeline.spec.ts:197` |
| Y-15 | `staff-timeline.ts:415` `draftVerdict` + :352 `collides`                                                                  | the same verdict across every chair; per-bar collision         | MOVE        | `GridLayoutSystem.placementVerdict` (multi-column) + `GridLayoutSystem.collides`                                                                                                                                                                                                                           | `staff-timeline.spec.ts:197`, `:211`, `:244`, `:300`                                    |
| Y-16 | `staff-timeline.ts:1081` `closedRuns`                                                                                     | complement of windows (KEEP-FOR-C)                             | WIRE        | `GridLayoutSystem.closedRuns`; the time grid's `trackStart`/`trackEnd`/`toMinuteRun` boundary helpers move to a shared `time-grid/minute-run.ts`                                                                                                                                                           | `staff-timeline.spec.ts:160`, `:300`                                                    |
| Y-17 | `staff-time-grid.html:266/:294` `hollowStatus`                                                                            | did not happen                                                 | WIRE        | the D-9 delegate; template unchanged                                                                                                                                                                                                                                                                       | `staff-time-grid.spec.ts:1843`                                                          |
| Y-18 | `staff-block-editor.ts:1127` `collisions`                                                                                 | `allDay \|\| overlap`                                          | MOVE        | `GridLayoutSystem.collides` with the whole day as the all-day span                                                                                                                                                                                                                                         | `staff-block-editor.spec.ts:296`, `:225`                                                |
| Y-19 | `staff-block-editor.ts:200` `GRAIN_MINUTES`/`snap`, :471/:481 typed pair                                                  | the 5-minute grain + the typed pair                            | MOVE        | `VisitDraftSystem.GRAIN_MINUTES`/`snap`/`typedStart`/`typedEnd`; `parseClock` STAYS                                                                                                                                                                                                                        | `staff-block-editor.spec.ts:183`; `staff-time-grid.spec.ts:851`, `:1582`                |
| Y-20 | `grid-gesture.ts:291` `snapTo`                                                                                            | the grid quantum (host-given)                                  | STAYS       | host-fed pitch; the hosts feed it from `VisitDraftSystem.GRAIN_MINUTES`                                                                                                                                                                                                                                    | `grid-gesture.spec.ts`                                                                  |
| Y-21 | `staff-time-grid.ts:2509` `proportionalBox`                                                                               | pixel placement                                                | STAYS       | D-3                                                                                                                                                                                                                                                                                                        | `staff-time-grid.spec.ts:116`, `:374`, `:397`, `:418`                                   |
| Y-22 | block-repeat wrappers, `monthlyDays`, `daysPhrase`, `frameRosterStart`, `TIMELINE_FROM_CHAIRS`, extents, day-pill parsing | already systems / read-state / wording                         | STAYS       | —                                                                                                                                                                                                                                                                                                          | —                                                                                       |
| Y-23 | `row-verb.ts` `ArrivalVerb` beside `MarkArrivalAction`                                                                    | vocabulary twice; a dictionary in the pipelines tier           | MOVE (file) | `ArrivalVerb` AND `MarkArrivalAction` to `staff-verb.data.ts`, values and fields unchanged (no tag changes); `mark-arrival.pipeline.ts` and `booking.wire.ts:53` import it from `@core/components`                                                                                                         | editor/dashboard verb specs; mark-arrival pipeline and wire specs (import lines)        |

### 1.4 Client card (`libs/features/staff/client-card/src/lib/`)

| ID  | Site                                                               | Decision                                                    | Ruling      | Target                                                                                                                                                          | Pinned by                                                          |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| K-1 | `client-card.store.ts:1841` `roles.includes('admin')`              | who reads the spend (admin ONLY, `firestore.rules:285-293`) | MOVE        | `SPEND_ROLES = [Role.Admin]` + `seesClientSpend(roles)` in `role.data.ts` — NOT `isAdmin` (adds sysadmin)                                                       | `client-card.store.spec.ts:475`                                    |
| K-2 | store :572, :1067 `!roles.includes('sysadmin')`                    | the client's own words kept from a sysadmin (R15)           | MOVE        | `readsClientWords(roles)` in `role.data.ts`                                                                                                                     | `visits-page.presenter.spec.ts:252`                                |
| K-3 | store :730 `previousVisitAtMs`                                     | the visit «Ново» is measured from                           | MOVE        | `ClientStatsSystem.previousVisit(stats, current, instantOf)` — the store hands the instant reader (zone at the edge, D-6), so the order stays the instant order | `client-card.store.spec.ts:428`; `client-achievements.spec.ts:709` |
| K-4 | store :1140 `rhythmHead`                                           | the head the account holds a state for, else the first      | MOVE        | `StreakSystem.headOf(heads, states)`                                                                                                                            | rhythm/wallet cases (`client-card.store.spec.ts:1397`)             |
| K-5 | store :966 overview reward gate inner `!this.paused()`             | second spelling of `WalletSystem.writable`                  | WIRE        | `this.rewardsUsable()` inside the gate branch only (the outer LOADING structure untouched)                                                                      | `client-card.store.spec.ts:581`, `:1781`, `:1748`                  |
| K-6 | `history.presenter.ts:36-42` paging constants                      | read policy in a presenter (OQ-6)                           | MOVE (file) | to `client-card.store.ts` (D-3)                                                                                                                                 | `client-card.store.spec.ts:1176`, `:1201`, `:1218`                 |
| K-7 | `client-card.words.ts:132` `AchievementMetricWord` + bare literals | `Metric` copied                                             | MOVE        | switch on `Metric.*`; `AchievementMetricWord = Metric` (D-9)                                                                                                    | `client-card.words.spec.ts:1130-1131`                              |
| K-8 | components, templates, load gates, `PHOTOS_LIMIT`                  | read-state / layout                                         | STAYS       | —                                                                                                                                                               | —                                                                  |

### 1.5 Client booking, catalog, appointments, account, profile, onboarding, auth

| ID   | Site                                                                                                                                                                                                                                                                          | Decision                                                                      | Ruling                        | Target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pinned by                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| C-1  | `booking-review-step.ts:654` `totalLabel`                                                                                                                                                                                                                                     | whole-booking total (KEEP-FOR-C)                                              | WIRE                          | `BookingTotalSystem.total` (exact)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `booking-total.system.spec.ts`; e2e journeys                               |
| C-2  | review :470-553 per-seat totals; :561 SELF first                                                                                                                                                                                                                              | per-seat subtotals (KEEP-FOR-C); booker first                                 | WIRE / MOVE                   | `BookingTotalSystem.seatSubtotals`; `BookingCartSystem.bookerFirst(seatKeys)` (stable SELF-to-front)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | review group-order cases                                                   |
| C-3  | review :439 `saveNote`                                                                                                                                                                                                                                                        | trim, truncate, blank → none                                                  | MOVE                          | `BookingContact.withNote(contact, raw)` (truncate, as today — `create` refuses over 200; D-6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | review note cases                                                          |
| C-4  | `booking-services-step.ts:669` `performerOptions`; bag `:536`; `service-detail-sheet.component.ts:183`                                                                                                                                                                        | performers cheapest first; `termsFor` copied on the VM (KEEP-FOR-C, OQ-3)     | MOVE                          | `CatalogPricingSystem.performersByPrice(service, variantId)` on the `Service` entity (`catalog.findService`); host barber lookups STAY                                                                                                                                                                                                                                                                                                                                                                                                                                        | services-step :507, :546; sheet specs                                      |
| C-5  | services :827 `livePrice`, :858 `priceRangeLabel`                                                                                                                                                                                                                             | named barber vs "anyone"; "anyone" min/max                                    | WIRE                          | the named branch gated by `OfferingPriceSystem.isPerformedBy` (KEEP-FOR-C, D-3) and priced by `OfferingPriceSystem.price`; anyone: `TermsSpanSystem.spanFor` + `isPricePoint`/`priceBounds` — **DEP-9**; point-vs-range form STAYS                                                                                                                                                                                                                                                                                                                                            | bag :903, :932                                                             |
| C-6  | sheet :229-266 `savings`                                                                                                                                                                                                                                                      | bundle saving (OQ-3)                                                          | MOVE                          | `CatalogPricingSystem.bundleSaving(bundle, members)` in integer cents — **DEP-10**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | sheet :222, :253                                                           |
| C-7  | services :442 `nextGuestNumber`                                                                                                                                                                                                                                               | guest prefix parsed in a feature                                              | MOVE                          | `Party.labelNumberAfter(party)` — today's rule (highest PRESENT + 2), §8 OQ-6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | services :382, :445, :845                                                  |
| C-8  | services :558 `nextEmptySeat`                                                                                                                                                                                                                                                 | next seat without a service, after the active one, wrapping                   | MOVE                          | `BookingCartSystem.nextSeatWithoutService(party, cart, after)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | services :766, :810, :845                                                  |
| C-9  | services :961 `replaceBlockers` by localised NAME                                                                                                                                                                                                                             | which lines a swap drops                                                      | WIRE                          | `ServiceConflictSystem.conflictingWith(...)` ids (identical while names are unique)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | services :692, :725                                                        |
| C-10 | `booking-flow.store.ts:884`, `:1263` terminal re-spelled                                                                                                                                                                                                                      | `isTerminal` copy                                                             | WIRE                          | `BookingFlowSystem.isTerminal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | store :1447                                                                |
| C-11 | store :1257 `persist` draft-origin precedence                                                                                                                                                                                                                                 | reschedule ▸ bookedFrom ▸ fresh                                               | MOVE                          | `BookingDraft.of(state, contact, day, moving, source)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | store :1342, :1355, :1367, :1582                                           |
| C-12 | store :972 `restoreFromWaitlist` earliest day                                                                                                                                                                                                                                 | min over dates                                                                | MOVE                          | `FlexibleWhen.firstLocalDate(when)` (a MIN scan, never `[0]`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | store :1859                                                                |
| C-13 | `client-booking.ts:274-302` refusal precedence                                                                                                                                                                                                                                | stored move refusal ▸ carried out of reach                                    | MOVE                          | `MoveSystem.refusalOf(moveRefusal, carriedInReach)`; the known-read gating STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | client-booking move-refusal cases                                          |
| C-14 | `carried-reach.ts:56`, `rider-placement.ts:24` map before the system                                                                                                                                                                                                          | inbound mapping                                                               | MOVE                          | `MoveSystem.carriedSeatsInReach` takes `Pick<Barber,'id'>[]`/`Pick<ShopLocation,'id'>[]`; `placeRiders` takes `Pick<SeatAssignment,'startMinutes'>[]` (D-5b); wrappers deleted in wave 1                                                                                                                                                                                                                                                                                                                                                                                      | `rider-placement.spec.ts:62`, `:73`; carried-reach spec                    |
| C-15 | `booking-schedule-step.ts:239` zone precedence                                                                                                                                                                                                                                | chosen ▸ first listed ▸ default                                               | MOVE                          | `ShopZoneSystem.zoneOfScope` (Y-5 shares it; the server's two-step `zoneOf` unchanged)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | schedule step clock; `booking-time-sheet.spec.ts:46`                       |
| C-16 | schedule :326 `shopCoverage`; :925 dictionary                                                                                                                                                                                                                                 | verdict ladder; vocabulary in a component                                     | MOVE                          | `BookingCartSystem.shopCoverage(serving, chosen, chosenListed)`; `ShopCoverage` to components (D-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | schedule :477, :495, :524, :549, :566, :586, :619                          |
| C-17 | schedule :575 `isBookable`                                                                                                                                                                                                                                                    | in range ∧ (exact answer ▸ today ∨ free > 0)                                  | MOVE                          | `AvailabilitySystem.dayBookable(inRange, exact, isToday, freeMinutes)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | schedule :477, :658                                                        |
| C-18 | `availability-month.ts:85` horizon                                                                                                                                                                                                                                            | before today or past the horizon                                              | MOVE                          | `CalendarGridSystem.inWindow(day, today, horizonEnd)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | schedule day greying                                                       |
| C-19 | `day-availability.ts` (whole file)                                                                                                                                                                                                                                            | the booking grid's sandwich (finding 15/16/17/19)                             | MOVE                          | `shop-day.pipeline.ts` (observes only); `BookingCartSystem.dayDocsKey`/`sameDayDocsKey` + the `DayQuery`/`DayDocs`/`BarberDayDocs`/`DayDocsKey` TYPES (`type`, never `interface`) in `booking-cart.system.ts`; `RosterSystem.shopHoursOn`; `MoveSystem.releaseOn`; `BookingCartSystem.barberDays` (incl. the ported `offeredShopHours`: listed shops, plus a moved visit's named shop listed or not, replacing its listed entry) / `dayOptions`; `CapacitySystem.freeMinutesByDay`; `capacityMonthsOf` → `LeadTimeSystem.monthKeysBetween` (exact). File deleted              | `day-availability.spec.ts` (imports re-pointed); schedule :658, :670, :687 |
| C-20 | `booking-time-sheet.ts:376` `arrangementKind`                                                                                                                                                                                                                                 | parallel vs sequential                                                        | MOVE                          | `BookingCartSystem.arrangementOf(assignments)` → `SeatArrangement` (D-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | new system cases                                                           |
| C-21 | `booking-contact-sheet.ts:287` `profileNameFrom`; :162/:177 differs                                                                                                                                                                                                           | full name split                                                               | MOVE                          | `ProfileEditSystem.nameFromFull(typed, storedLastName)`; differs checks via `namesChanged`; `canSave` STAYS (draft gating)                                                                                                                                                                                                                                                                                                                                                                                                                                                    | contact-sheet :163, :195, :203, :215, :300                                 |
| C-22 | `appointments.store.ts:188` history                                                                                                                                                                                                                                           | settled ∨ begun (start ≤ now) — which rows of the history READ enter the page | MOVE                          | `VisitListSystem.isHistory(appointment, now)` = `isSettled ∨ VisitStorySystem.hasStarted(start, now)` (composes, one ≤ rule). Not a DEP: the page files every row by the presenter's `isUpcoming` (start ≥ now) after an id-dedupe merge with the upcoming read (`client-appointments.ts:407-425`, "filed by its own start"), so a start-minute visit admitted by the store is shown once, filed upcoming — admission vs filing, two questions, no DOM consequence; the store spec pins start == now as begun on purpose (`appointments.store.spec.ts:237`, 'begun' at 09:00) | `appointments.store.spec.ts:237`                                           |
| C-23 | `client-appointments.ts:413` merge                                                                                                                                                                                                                                            | distinct by id (KEEP-FOR-C)                                                   | WIRE                          | `VisitListSystem.distinctById`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | list rendering                                                             |
| C-24 | appointments :692 `openVisitTotal`                                                                                                                                                                                                                                            | one-currency sum                                                              | WIRE                          | `BillingSystem.subtotalOf(seats)` (exact)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | :1004                                                                      |
| C-25 | appointments :935-966 `canMove`/`shopMovesOnly`/`windowClosed`                                                                                                                                                                                                                | combined move verdict                                                         | MOVE                          | `MoveSystem.clientMove(appointment, policy, nowUtcMs, owner)` → `MOVABLE \| SHOP_ONLY \| NONE` + `windowClosed` computed EXACTLY as today (`isLive ∧ ¬BookingPolicy.mayCancelAt(policy, start, now)` — FALSE on a NaN start, as today: `UtcEpochMs.compare` reads NaN as equal, so `mayCancelAt` answers true; corrected by W0-D), never derived from `mayCancel`'s refusal code                                                                                                                                                                                              | :937, :953, :973, :1124, :1133, :1173, :1185                               |
| C-26 | appointments :543 month run                                                                                                                                                                                                                                                   | min/max over visit months                                                     | MOVE                          | `CalendarGridSystem.monthSpan(localDates, anchorMonth, back, ahead)`; the 240 guard and bucketing STAY                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | :1305                                                                      |
| C-27 | appointments :845 `.ics` end                                                                                                                                                                                                                                                  | instant arithmetic                                                            | MOVE                          | `UtcEpochMs.plusMinutes` via `TimeCoordinate.endUtcMs(appointment)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | visit-ics spec                                                             |
| C-28 | `client-account.ts:247-260` next visit                                                                                                                                                                                                                                        | soonest first; no start ≥ now test                                            | WIRE / CARRY                  | the ordering WIRES `VisitListSystem.upcomingSoonestFirst(value, (a) => ({ id: a.id, localDate: a.localDate, startMinutes: a.startMinutes, sectionKey: '', upcoming: true }))[0]` — the same stable day-then-minute sort (finding 74's fix; `glance.presenter.ts:497` precedent), no behaviour change; the missing now-filter stays CARRIED (§8 OQ-4, needs every listed shop's zone)                                                                                                                                                                                          | `client-account.spec.ts:337`, `:543`                                       |
| C-29 | `client-profile.ts:239` `canSave` changed                                                                                                                                                                                                                                     | partial copy of `decide`'s unchanged test                                     | MOVE                          | `ProfileEditSystem.namesChanged` / `birthChanged`, which `decide` composes (local answer kept — no DEP)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | profile save-gating cases                                                  |
| C-30 | `profile.store.ts:94` double avatar check                                                                                                                                                                                                                                     | the pipeline checks again                                                     | WIRE                          | KEEP the store's pre-check, on `AvatarSystem.check(file)`'s new signature: it answers a refused file's code BEFORE the session check (`IdentifierMissing`) and raises no `pending` for a refused file — dropping it changes both, and `profile.store.spec.ts:207` (session active) does not decide the order, so the freeze does                                                                                                                                                                                                                                              | `profile.store.spec.ts:207` (unchanged)                                    |
| C-31 | `account-state/own-profile.ts:30`                                                                                                                                                                                                                                             | browser use case                                                              | MOVE                          | `saveOwnProfile` pipeline (D-10); `nameRefusalCodes` STAYS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `own-profile.spec.ts`                                                      |
| C-32 | `account-state/age-day.ts:19` (+ two pipelines)                                                                                                                                                                                                                               | the day a birth date is judged on (3 homes)                                   | MOVE                          | `AgeSystem.judgedOn(nowUtcMs)` on `TimeZone.UTC`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `age-day.spec.ts:12`, `:18`                                                |
| C-33 | `client-onboarding.ts:658` `serviceMeta`                                                                                                                                                                                                                                      | card price/duration — a second rule                                           | WIRE                          | `CatalogPricingSystem.cardPrice` / `durationRange` — **DEP-8**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | none pinned                                                                |
| C-34 | onboarding :416 `remainingPersonalizeSteps`; `session-identity.service.ts:269` `nextOpenStep`                                                                                                                                                                                 | open completion items → steps (twice)                                         | MOVE                          | `OnboardingFlowSystem.openPersonalizeSteps(completion)` (returns `[]` when nothing is left; the store's full-plan fallback unchanged)                                                                                                                                                                                                                                                                                                                                                                                                                                         | onboarding-flow.store :145; `site-menu.component.spec.ts:408`              |
| C-35 | `client-auth.ts:370` `otpLength = 6`                                                                                                                                                                                                                                          | constant copy                                                                 | WIRE                          | `OTP_CODE_DIGITS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | OTP entry cases                                                            |
| C-36 | `auth-flow.store.ts:22` cooldown 30 s vs server 60 s                                                                                                                                                                                                                          | rule disagreement needing a ruling                                            | CARRY                         | §8 OQ-5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                                                                          |
| C-37 | `catalog.presenter.ts:126` anonymous offering                                                                                                                                                                                                                                 | hidden `termsFor` fallback                                                    | DELETE (wave 2, if no reader) | after C-4/C-5/C-6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | sheet :222, :253                                                           |
| C-38 | `site-footer.component.ts:12`, `age-day.ts:1` `UTC_ZONE`                                                                                                                                                                                                                      | tier home                                                                     | MOVE                          | `TimeZone.UTC` (primitives); `UTC_ZONE` deleted in wave 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `site-footer.component.spec.ts:126`, `:139`                                |
| C-39 | booking-flow `commit`/`rereadMove`/`rescheduleFrom`/`submitWaitlist`, `partySize`, waitlisted/time-sheet person labels, `booking-error-message.ts` call href (the plain `tel:` form, D-3), catalog content `mediaRefOf`, onboarding cap, auth escalation, services read-state | orchestration / display / wording                                             | STAYS                         | D-3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                          |

### 1.6 Admin rhythm, marketing, shell, shared visits

| ID   | Site                                                                                                      | Decision                                                    | Ruling         | Target                                                                                                                                                                                                                                                 | Pinned by (`admin-rhythm.store.spec.ts` unless named)              |
| ---- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| R-1  | store :1160, :617 `canSave`, :1292 preview gate                                                           | nothing to publish (three copies)                           | MOVE           | `StreakPublishSystem.publishable(assessment, published)`                                                                                                                                                                                               | :1606, :1614, :874, :1144, :1181, :2011                            |
| R-2  | store :1163                                                                                               | too early (copy of `decide`'s guard)                        | MOVE           | one private guard in `streak-publish.system.ts`, called by `decide` and `StreakPublishSystem.gate(assessment, published, effectiveFrom)`                                                                                                               | :1244, :1628; system decide cases                                  |
| R-3  | store :1187 TOO_EARLY re-derivation                                                                       | the strictest day this side knows (pinned on purpose)       | MOVE           | `StreakPublishSystem.refusedEarliest(direction, refusedDay, today, policy)` — exact                                                                                                                                                                    | :1492, :1518                                                       |
| R-4  | store :331 `laterOf`, :577-595 `earliestDay`/`effectiveFrom`                                              | max of days; the floor counts only for the same direction   | MOVE           | `LocalDate.later(a, b)`; `StreakPublishSystem.effectiveDay(chosen, assessment, floor, tomorrow)`                                                                                                                                                       | describe :1196-:1263, :1518                                        |
| R-5  | store :299 `headAfterPublish`, :1184 `waits`                                                              | next head; waits                                            | MOVE           | `StreakPublishSystem.headAfter(head, rule, transition, today)` extracted from `decide` (both call it)                                                                                                                                                  | :1266, :1312, :1371, :1415, :1441                                  |
| R-6  | store :321 `headAfterWithdrawal`, :1250 waiting pick                                                      | which version waits; next head                              | WIRE / MOVE    | `StreakPublishSystem.withdraw` for the next head; `StreakPublishSystem.waitingOn(head, published, today)` shared with `withdraw`                                                                                                                       | describe :1863-:2000                                               |
| R-7  | store :334 `staleAgainst` base version                                                                    | copy of `assess`'s base version                             | MOVE           | `StreakPublishSystem.baseVersionOf(head, published)`                                                                                                                                                                                                   | :1669, :1724, :1808                                                |
| R-8  | store :492 presets                                                                                        | tomorrow, first of next month                               | MOVE           | `RhythmDraftSystem.effectivePresets(today)`                                                                                                                                                                                                            | :862; page :694                                                    |
| R-9  | store :567 `dirty`                                                                                        | INVALID ∨ changed                                           | MOVE           | `StreakPublishSystem.isDraftDirty(assessment)`                                                                                                                                                                                                         | :1106, :1167, :1644; page :900-:907                                |
| R-10 | store :770 remembered interval; :994/:954 carry-over                                                      | draft rules                                                 | MOVE           | `RhythmDraftSystem.remember(remembered, held)`; `RhythmDraftSystem.carryOver(draft, madeOn, now, remembered, choices)`; the day-turn detection STAYS                                                                                                   | :1126, describe :1790-:1862, :1669, :1708                          |
| R-11 | store :1146 `send`, :1243 `callOff`                                                                       | browser use case                                            | MOVE           | `publishRhythmDraft` / `withdrawRhythm` pipelines (D-10)                                                                                                                                                                                               | describes :1265-:1642, :1863-:2000; page :719-:899                 |
| R-12 | store :210 `PUBLISH_REFUSALS`                                                                             | vocabulary guard                                            | MOVE           | `StreakPublishError.guard(error)` = exactly `Object.values(StreakPublishErrorCode)` (not the wire's ANSWERED subset)                                                                                                                                   | page :845, :863, :876; :1534                                       |
| R-13 | `admin-rhythm.preview.ts:182` `rhythmPreviewReadsFacts`                                                   | copy of `estimate`'s qualifier check                        | MOVE           | `StreakPreviewSystem.readsFacts(inForce, draft)`; `estimate` calls it                                                                                                                                                                                  | preview :403-:416; :2111                                           |
| R-14 | preview :229 `sampleRhythmFacts`, :268 `sampleRhythmRun`                                                  | the invented client (6 on time, late = 2×)                  | MOVE           | `StreakPreviewSystem.sampleFacts(rule, today, dayStart)` / `sampleRun(rule, today, dayStart)`; the store binds `dayStart` to the zone                                                                                                                  | preview :517-:637; :2404-:2443; words spec :39                     |
| R-15 | preview :108 walk + :77 `streakFactsReader`                                                               | browser read pipeline; what counts as a visit fact          | MOVE           | `rhythm-preview.pipeline.ts`; `StreakPreviewSystem.factsOfStats(record, dayStart)`; `RHYTHM_PREVIEW_DELAY_MS` STAYS                                                                                                                                    | preview :178-:401                                                  |
| R-16 | `admin-rhythm.ts:301` `weeks`                                                                             | `daysFor` copy                                              | WIRE           | `RhythmDraftSystem.weeksOf(StreakIntervalRule.daysFor(draft, null).days)`                                                                                                                                                                              | page :581, :629                                                    |
| R-17 | page :754 `save` consent; :773 undo offered                                                               | which change asks first; undo only for looser/neutral waits | MOVE           | `StreakRuleSystem.publishConsent(direction)` → `StreakPublishConsent`; `StreakPublishSystem.undoOffered(direction, waits)`                                                                                                                             | page :720, :745, :778                                              |
| R-18 | page :488 history sort                                                                                    | newest first                                                | MOVE           | `StreakPublishSystem.historyNewestFirst(versions)`                                                                                                                                                                                                     | page :445                                                          |
| R-19 | `rhythm-service-groups.ts:21`                                                                             | categories by `sortOrder`, services under each              | MOVE           | `CatalogSystem.byCategory(categories, services)`; file deleted                                                                                                                                                                                         | `rhythm-service-groups.spec.ts:37` (import re-pointed); sheet :396 |
| R-20 | `admin-rhythm-sheet.ts:67` `SHOP_EXCUSES`, :314 `shopExcuseOff`                                           | constant copy + the shop-excuse coverage                    | MOVE           | `StreakRule.coversShopExcuses(excuses)` (shared with `summary().shopExcuses`); the P9 display order STAYS, built from `STREAK_SHOP_EXCUSES` members                                                                                                    | sheet :326                                                         |
| R-21 | sheet :273 last service cannot be removed                                                                 | a SERVICES qualifier names ≥ 1                              | MOVE           | `StreakQualifierRule.toggleService(ids, id)`                                                                                                                                                                                                           | sheet :396                                                         |
| R-22 | `admin-rhythm.words.ts:842` `sampleClosed` vs `wallet.presenter.ts:667` `closedPeriod`                    | two word sources (carried)                                  | MOVE (wording) | one helper in `shared/visits` (D-3); DOMs byte-identical                                                                                                                                                                                               | `admin-rhythm.words.spec.ts:657-:679`; wallet rhythm-mark cases    |
| R-23 | `locations.component.ts:502` `statusFor`, :90 `ShopOpening`, :110 threshold, :112-135 tables, :569 parser | the shop open/closes-soon machine                           | MOVE           | `RosterSystem.shopOpeningAt(week, localDate, minute)`; `ShopOpening` + `SHOP_CLOSES_SOON_MINUTES` in `opening-hours.data.ts`; the tables become static `DayHours[]` (Monday-first minutes) on the landing entries; the template prints exactly `HH:MM` | `locations.component.spec.ts:172-:270`, `:14`                      |
| R-24 | locations :561 `phoneHref`                                                                                | tel href from a DISPLAY string                              | WIRE           | parse the display number once with `E164`'s constructor, then `ShopReachSystem.callHref({ phoneE164 })` (the other `tel:${phoneE164}` sites are D-3's plain form)                                                                                      | `locations.component.spec.ts:14`                                   |
| R-25 | `landing-content.service.ts:56` shelf; :79 barber prices re-filter                                        | which services are on the shelf                             | MOVE           | `CatalogSystem.shelf(services)` once; `barberPrices` passes the same list to `servicesByBarber`                                                                                                                                                        | services-section / team-showcase specs                             |
| R-26 | `staff-event-head.ts:21` `hollowStatus`                                                                   | `isVoid` copy on `BookingStatus`                            | MOVE           | delegate to `BookingLifecycle.didNotHappen` (D-9)                                                                                                                                                                                                      | `staff-event-head.spec.ts:151-:156` (unchanged)                    |
| R-27 | marketing courses/events/careers, admin programs, shell identity, guards, app-chrome                      | already guards / read-state / wording                       | STAYS          | —                                                                                                                                                                                                                                                      | —                                                                  |

### 1.7 Pipelines, adapters, the functions edge

| ID   | Site                                                                                                                                                                                                                                       | Decision                                                                                  | Ruling        | Target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pinned by                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| P-1  | `appointment-edit.system.ts:62` `EditCommandRequest` 11 arms; pipeline :436-445 identity copies (finding 1)                                                                                                                                | variants declared twice                                                                   | MOVE          | the fold's input references `BookingCall.EditCommand.Move \| Reprice \| Redurate \| Restaff \| RemoveSeat \| Relocate`; only Resize (EndMinute), AddSeat (worked stamp, occupant) and the payload-less Discounts/Vouchers arms declared once in `edit-command.data.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `appointment-dictionaries.type-spec.ts:237`, edit specs                           |
| P-2  | `edit-appointment.pipeline.ts:552` `foldOnClock` (KEEP-FOR-C)                                                                                                                                                                              | the batch fold on the running day                                                         | MOVE          | `AppointmentEditSystem.foldCommands(appointment, commands, customerIds, resolve)` — the zone-dependent DST check + instant stay in the pipeline's `resolve` callback (Law 7.3); `fold` composes; delete `foldOnClock`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | system :120, :734, :919, :960; pipeline :333, :538                                |
| P-3  | pipeline :439 `requestOf` pure parts                                                                                                                                                                                                       | resize end `daysBetween*1440 + atMinutes`, `minutes ≤ 0` refused; the added-seat occupant | MOVE          | `AppointmentEditSystem.resizeEndOf(runningDay, localDate, atMinutes)` / `addedOccupantOf(subject, owner, seatId)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | pipeline :333, :417, :889                                                         |
| P-4  | pipeline :520 `workedAtUtcMs` raw ms                                                                                                                                                                                                       | T2 arithmetic                                                                             | MOVE          | `UtcEpochMs.plusMinutes` inside the resolver                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | add-seat on a finished visit                                                      |
| P-5  | pipeline :609 `addedAccountsOf` vs `accountSubjects`                                                                                                                                                                                       | one rule, two inputs                                                                      | MOVE          | `AppointmentEditSystem.addedAccounts(commands, owner)`; `accountSubjects` deleted if no caller remains                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | pipeline :889                                                                     |
| P-6  | pipeline :240 `lastDiscounts`/`pendingVouchersOf`/`relocatedTo`                                                                                                                                                                            | the batch's last word                                                                     | MOVE          | `AppointmentEditSystem.lastDiscounts` / `pendingVouchers` / `relocatedTo`; `fold` reuses `relocatedTo`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | pipeline :736, :759                                                               |
| P-7  | pipeline :218/:232 `STAFF_VERB`/`verbOf`                                                                                                                                                                                                   | audit verb                                                                                | MOVE          | `AppointmentEditSystem.auditVerb(commands)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | pipeline audit-row cases                                                          |
| P-8  | pipeline :351, reschedule :235 `.slice(0, 16)`                                                                                                                                                                                             | digest length ×2                                                                          | MOVE          | `AppointmentEditSystem.digestOf(hex)` (`DIGEST_LENGTH = 16`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | reschedule :272, :300                                                             |
| P-9  | pipeline :706-:723 `reversedAtUtcMs === null`                                                                                                                                                                                              | live redemption copy                                                                      | WIRE          | `VoucherRedemption.isLive`, `readRedemptionVouchers`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | voucher settle cases                                                              |
| P-10 | pipeline :835 `spanOf`, :969-976 sold spans before `guard` (finding 17)                                                                                                                                                                    | seat end ×2; inbound mapping                                                              | MOVE          | `AppointmentEditSystem.guard(state, localDate, seats, arrival)` reads `Pick<Seat,'startMinutes'\|'durationMinutes'>[]`, end by `EndMinute.after` with the clamp booking-decision uses (never `Seat.endMinutes`, which throws past midnight); `SeatingRuleSystem.spanOf(seat, subject)` shared with booking-decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | system guard cases                                                                |
| P-11 | pipeline :840 `resolvedGrantOf`, :862 `resolvedCodeOf`                                                                                                                                                                                     | label fallback; a gone coupon is stackable                                                | MOVE          | `CouponGrantSystem.resolved(grant, coupon, nowUtcMs)`; `DiscountSystem.resolvedCode(coupon, code)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | pipeline :736, :759                                                               |
| P-12 | pipeline :906 pending discounts                                                                                                                                                                                                            | manual fixed amount takes the first seat's currency                                       | MOVE          | `BillingSystem.pendingDiscounts(requests, grants, codes, currency)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | billing manual cases (:405)                                                       |
| P-13 | pipeline :984 fresh seat on a rostered chair                                                                                                                                                                                               | qualification                                                                             | MOVE          | `AppointmentEditSystem.freshSeatsRostered(seats, freshSeatIds, schedules)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | pipeline :668                                                                     |
| P-14 | pipeline :1027 inline policy; book :170 `placementPolicyOf`                                                                                                                                                                                | the staff placement preset (live values)                                                  | MOVE          | `PlacementPolicy.staffPlacement()` (`allowConflictingServices: true`) + `withOverlap`; `staffWalkIn` UNTOUCHED (§8 OQ-3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | book :371; `placement-policy.data.spec.ts:21` unchanged                           |
| P-15 | pipeline :1065 slot → overlap                                                                                                                                                                                                              | names the resize edge for a lone RESIZE                                                   | MOVE          | `AppointmentEditSystem.overlapOf(error, commands)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | pipeline :417                                                                     |
| P-16 | pipeline :1085 carry outcomes/tips back; :1108 NEEDS_CONTACTS; :1007 terms overrides                                                                                                                                                       | plan assembly rules                                                                       | MOVE          | `AppointmentEditSystem.carryBack(decided, folded)`, `termsOverridesOf(seats, freshSeatIds)`; `CustomerRecordSystem.missingContacts(added, customers, contacts)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | pipeline :889                                                                     |
| P-17 | book :190 `frameWallClock` (book, reschedule ×2, edit)                                                                                                                                                                                     | earliest start + DST check at ingestion                                                   | MOVE (split)  | `frameWallClock` STAYS the one shared pipeline-tier ingestion helper (book, reschedule, edit already import it) and keeps the parsing (`LocalDate.parse`, `MinuteOfDay.of`, null slots — every slot null when the day is no day); it hands branded input to NEW `ZonedTimeSystem.frameShopDay(localDate: LocalDate \| null, starts: readonly (MinuteOfDay \| null)[], zone: TimeZone)`, which holds the earliest-start choice and the DST check; `ShopDayFrame` to a component                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | book :566, :578, :585; reschedule :458, :507                                      |
| P-18 | reschedule :644 retired carried seats + cart-alone retry ladder; :686 seats after; :420 listed target in the read half                                                                                                                     | decision ladder in a pipeline                                                             | MOVE          | `MoveSystem.decideCarried(plan, offered, decide)` (higher-order, pure); `MoveSystem.seatsAfter(decided, plan)`; the listed-target rule into `MoveSystem.plan`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | reschedule :364, :388, :421, :476, :550, :659, :668, :685                         |
| P-19 | `transition-appointment.pipeline.ts:128/:251/:273`                                                                                                                                                                                         | reinstate / reopen / ends-cancelled predicates                                            | MOVE          | `AppointmentLifecycleSystem.isReinstatement` / `readsShopToday` / `endsCancelled`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | transition :315, :376, :393, :408                                                 |
| P-20 | transition :110, `appointments.adapter.ts:25`, `rebuild-busy.pipeline.ts:63` `LIVE_STATUSES`                                                                                                                                               | constant ×3                                                                               | MOVE          | `BookingLifecycle.LIVE_STATUSES` (order and values byte-equal: index #6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | transition :408; adapter observeUpcoming                                          |
| P-21 | `record-seat-tip.pipeline.ts:86`                                                                                                                                                                                                           | the whole tip decision                                                                    | MOVE          | `BillingSystem.recordTip(appointment, seatId, tipCents)` (null = unchanged)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | record-seat-tip :69, :118, :130, :150, :171                                       |
| P-22 | `cancel-waitlist.pipeline.ts:62`                                                                                                                                                                                                           | cancel verdicts                                                                           | MOVE          | `WaitlistSystem.cancel(request, ownerUserId, atUtcMs)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | cancel-waitlist :77, :104, :115, :129                                             |
| P-23 | `continue-policy-recompute.pipeline.ts:242/:292/:296`                                                                                                                                                                                      | idle; stall dedupe                                                                        | MOVE          | `PolicyRecomputeJobSystem.isIdle` / `shouldRecordStall`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | continue :525, :580, :663                                                         |
| P-24 | `project-client-stats.pipeline.ts:320-357`, `run-backfill.pipeline.ts:250` (KEEP-FOR-C)                                                                                                                                                    | the attempt verdict judged by a repository error's reason                                 | MOVE          | `TriggerAttemptSystem.decisiveFailure` / `attemptFailure` read a `RepositoryError`'s `reason`; `TriggerAttemptSystem.repositoryFailure`; `RepositoryError.guard` (the one guard); pipeline copies deleted (wave-2 for the exported names)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | continue :580, :613, :643; run-backfill :617; trigger-attempt spec (new cases)    |
| P-25 | project-client-stats :376, `backfill-plan.system.ts:310` chunk width                                                                                                                                                                       | `chunkSize` copies                                                                        | WIRE          | `WorkBudgetSystem.chunkSize`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | project :158                                                                      |
| P-26 | project-client-stats :192 `clientStatsOf`                                                                                                                                                                                                  | which visits count toward spend                                                           | MOVE          | `ClientStatsSystem.billedHistory(history)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | project :158, :212, :295                                                          |
| P-27 | run-backfill :198 `backfillChangeKey`; :212 `backfillContext`; :176 `mirrorRowOf`                                                                                                                                                          | one logical change; outcome; read model                                                   | MOVE          | `AuditSystem.backfillChangeKey(page, actor)`; `BackfillPlanSystem.outcomeOf(page)` / `mirrorRowOf(appointment)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | run-backfill :276, :434, :455, :547, :569, :591                                   |
| P-28 | `match-waitlist.pipeline.ts:149` `loadDay`; `booking-read-set.pipeline.ts:281-297`; `rebuild-capacity.pipeline.ts:193-200` (finding 16/17)                                                                                                 | barber-day build; renames into systems                                                    | MOVE          | `RosterSystem.shopHoursOn`; `AvailabilitySystem.paddedBusy`, `BookingDecisionSystem` (`schedules`, `busy`) and `CapacitySystem.planBarberCapacity` (`shops`, `busy`) read the stored slices (D-5b); each caller keeps its own shop filter                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | match-waitlist :467-:575; booking-read-set :146, :178; rebuild-capacity :124-:199 |
| P-29 | booking-read-set :281, `request-waitlist.pipeline.ts:150` ACTIVE filter                                                                                                                                                                    | bookable services ×2                                                                      | MOVE          | `PartyAdmissionSystem.bookableServices(services)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | booking-read-set :146; request-waitlist :302                                      |
| P-30 | `booking-read-set.pipeline.ts:398` `UTC_ZONE`; `complete-registration`/`update-profile` age day                                                                                                                                            | tier home; triplicated rule                                                               | MOVE          | `TimeZone.UTC`; `AgeSystem.judgedOn`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | registration / profile age cases                                                  |
| P-31 | `sample-lead-time.pipeline.ts:75` threshold                                                                                                                                                                                                | free-minute threshold from the policy                                                     | MOVE          | `BookingPolicy.freeThreshold(policy)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | sample-lead-time threshold case                                                   |
| P-32 | `appointment-photos.adapter.ts:46` `isShot`                                                                                                                                                                                                | which photos count                                                                        | MOVE          | `PhotoOrigin.countsForClient(origin)`; the adapter's count/list apply it; the `@core/testing` double honours it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | adapter count/list cases                                                          |
| P-33 | `client-stats.adapter.ts:29`, `loyalty.adapter.ts:65`, `streak-definitions.adapter.ts:20`                                                                                                                                                  | page-size guard ×3                                                                        | MOVE          | `PagingSystem.pageSizeOf(raw)` (total: non-finite → 1); `pageSize` UNCHANGED (its NaN pass-through is load-bearing for `appointments.adapter.ts:82`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | adapter page cases                                                                |
| P-34 | `firestore-ttl.adapter.ts:47`                                                                                                                                                                                                              | retention policy, raw ms                                                                  | MOVE          | `RetentionSystem.purgeAtUtcMs(anchor: RetentionAnchor)` — a union discriminated by `retentionGroup` (`RetentionGroup`, D-7) with one branded variant per group (`BARBER_BUSY { localDate }`, `CAPACITY { monthFirstDay }`, `WAITLIST_REQUESTS { localDates }`, `NOTIFICATIONS { sentAtUtcMs }`, `LEAD_TIME_SAMPLES { localDate }`, `OTPS { expiresAtUtcMs }`, `IMPERSONATION_SESSIONS { endedAtUtcMs \| null; expiresAtUtcMs \| null }`); the system holds the seven formulas and constants (last day of the month, latest day with the epoch floor, the ended-else-expires anchor) over `UtcEpochMs.plusDays`/`plusHours` and `LocalDate` math. The adapter keeps `groupOf`, the field reads and parsing (`fieldOf`, `localDateOf`, unparseable list entries skipped, a missing/invalid field → `null` with no system call — exactly today's branches, incl. an impersonation `endedAtUtcMs` that is a non-finite number → `null`, never a fall-through to `expiresAtUtcMs`), `Timestamp`, `withPurgeAt`, and still exports `purgeAtFor` (the seed loads it) | `firestore-ttl.adapter.spec.ts:16-:144`                                           |
| P-35 | `booking.wire.ts:712-762` manual percent range                                                                                                                                                                                             | domain range at the edge                                                                  | MOVE          | `CouponValue.manualPercentOff` (integer 1–100) + `fixedAmount`, called by the wire and `BillingSystem.manualValue` — **DEP-6**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `booking.wire.spec.ts:1227-:1238`, `:1274`, `:1303`                               |
| P-36 | `booking.wire.ts:782` `voucherCodesOf` no voucher twice                                                                                                                                                                                    | qualification at the edge                                                                 | MOVE          | `VoucherCode.distinct(codes)`; the edge keeps answering field `codes`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | wire `codes` case                                                                 |
| P-37 | `edge.ts:893` `Date.parse(event.time)`                                                                                                                                                                                                     | event time parsed twice, two rules                                                        | WIRE          | `ZonedTimeSystem.parseOffsetIso` via the wire's `eventInstantOf` — **DEP-13**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `edge.spec.ts:1096`, `:1144`                                                      |
| P-38 | `triggers.wire.ts:34` imports `repositoryFailure` from `@core/pipelines`                                                                                                                                                                   | re-point                                                                                  | WIRE          | `TriggerAttemptSystem.repositoryFailure`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | triggers wire specs                                                               |
| P-39 | `isReadableId`/`isDocumentId`; `standingOf` vs `subjectOfSeat`; `notify` OPEN check; past-day skips; refusal re-coders; contact caps; `caller-roles`; scheduling adapter; `busyMergeWrites`; `admitPlacement`; request-waitlist shop parse | infrastructure knowledge / two-caller rules / edge shape                                  | STAYS / CARRY | D-3, §8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                                                                                 |

### 1.8 System signatures and vocabularies (systems-vocab scout, folded into the rows above)

Zero-inbound-mapping fixes (D-5b): `BookingDecisionSystem` `DecisionSchedule`
/ `DecisionBusyDay` (P-28), `CapacitySystem` `CapacityShopWeek` /
`CapacityBusyDay` (P-28), `AvailabilitySystem.paddedBusy` (P-28, Y-6, C-19),
`RosterSystem.ShopHours` build (P-28), `AppointmentEditSystem.guard` (P-10),
`AvatarSystem.check` → `{ type, size }` (Y-1),
`MoveSystem.carriedSeatsInReach` / `placeRiders` (C-14). Not done (optional, internal,
no caller renames): `AchievementsSystem.countedDraft`'s nested start,
`DiscountSystem.inputOf` field names, `VisitDraftSystem.catalogMinutesOf`
(E-16: its callers do a catalogue lookup, not a rename), `ClientQuerySystem.rank`
(E-22: the optional field is the VM's). Vocabularies (finding 48): `Metric`
(K-7), raw role strings (K-1, K-2), guest/placeholder spelling (S-24, E-18,
C-7), `VoucherRefusal` (Y-10, E-19), `CancelledSide` (S-7, E-11; home kept, D-7 exception), `MarkArrivalAction` (Y-23),
`BookingStatus` guard (S-29, P-35's wire `BOOKING_STATUSES`).

---

## 2. Contracts (wave 0 builds these; wave 1 builds against them)

Branded in, branded out; tags from `as const` component dictionaries; every
function has a purity spec (deepFreeze inputs, call twice, `toEqual`) and
the boundary cases listed. `X.y` means a member of the `X` companion object.

### 2.1 Lifecycle and story (W0-A)

```ts
// components/booking-lifecycle.data.ts
BookingLifecycle.isSettled(l: { readonly bookingStatus: BookingStatus }): boolean   // widened, body unchanged
BookingLifecycle.isLive(l: { readonly bookingStatus: BookingStatus }): boolean      // widened, body unchanged
BookingLifecycle.didNotHappen(l: { readonly bookingStatus: BookingStatus }): boolean // CANCELLED ∨ NO_SHOW
BookingLifecycle.LIVE_STATUSES: readonly BookingStatus[]                            // [PENDING, CONFIRMED], this order
// primitives/booking-status.data.ts
export function isBookingStatus(value: unknown): value is BookingStatus
// components/staff-verb.data.ts (NEW)
export const ArrivalVerb = { Arrived: 'ARRIVED', Unarrived: 'UNARRIVED' } as const; export type StaffVerb = BookingStatus | ArrivalVerb;
export const MarkArrivalAction = { Arrive: 'ARRIVE', Clear: 'CLEAR' } as const;  // moved from mark-arrival.pipeline.ts, values unchanged
// components/seat-outcome.data.ts
SeatOutcome.hasSeatMeaning(to: BookingStatus): boolean   // true exactly where outcomeForStatus is non-null (spec: every status)
// components/seat.data.ts
Seat.isOwnAccount(seat: Seat): boolean                    // ACCOUNT ∧ SELF
// components/booking-call.data.ts
BookingCall.staffCancelReason(picked: CancellationReason | null, note: string): CancellationReason | null  // OTHER only with words
// systems/appointment-lifecycle.system.ts
reopenable(rootStatus: BookingStatus, visitLocalDate: LocalDate | null, today: LocalDate | null): boolean // reopenSettledSlice calls it
offeredVerbs(chair: BookingLifecycle, root: { readonly bookingStatus: BookingStatus }, visitLocalDate: LocalDate, today: LocalDate | null): readonly BookingStatus[] // OFFERED order, canTransition, + CONFIRMED when chair ∈ {COMPLETED,CANCELLED} ∧ root === chair ∧ reopenable
leadVerb(chair: BookingLifecycle, legal: readonly BookingStatus[], arrived: boolean): StaffVerb | null  // the five arms of primaryVerb, in order
transitionSeats(to: BookingStatus, chairSeatIds: readonly SeatId[], partySize: number): readonly SeatId[] // [] = the root
inverseOf(did: StaffVerb, wholeParty: boolean): StaffVerb | null   // COMPLETED/NO_SHOW/CANCELLED → CONFIRMED, ARRIVED → UNARRIVED; no day guard
exitVerbs(chairStatus: BookingStatus, offered: readonly StaffVerb[], started: boolean, settled: boolean, gone: boolean): { verbs: readonly StaffVerb[]; rebook: boolean; cancel: boolean }
  // E-26, ported from ve:3119-3180: offered order; ARRIVED/COMPLETED dropped; CONFIRMED only when chairStatus ≠ PENDING; NO_SHOW only when started;
  // CANCELLED never in `verbs` (`cancel` = it was offered, drawn last); rebook = settled ∧ ¬gone
  // review round (§9.7 F-6): exitVerbs(chairStatus, offered, started) — settled/gone derived from chairStatus
  // (BookingLifecycle.isSettled ∧ ¬didNotHappen, the edit lock's predicate): rebook exactly on a COMPLETED chair
// the seven KEEP-FOR-C write verbs (confirm … markSeatOutcome) are untouched — KEEP-PARKED (D-3)
isReinstatement(appointment, request) / readsShopToday(appointment, request) / endsCancelled(before, after): boolean // ported from transition-appointment
// systems/visit-story.system.ts
chairResolution(status: BookingStatus, seats: readonly Seat[]): { bookingStatus; cancelledBy: CancelledSide | null; atUtcMs: UtcEpochMs; reasons: readonly CancellationReason[] } | null
  // null unless CANCELLED/NO_SHOW with a stamp; cancelledBy = rootStory(CANCELLED, seats).cancelledBy (DEP-1); atUtcMs = max stamp;
  // reasons = distinct non-UNSPECIFIED in seat order (composes rootStory, decisiveCancellationIndex, distinct)
  // CancelledSide keeps its home in this file (D-7 exception)
hasStarted(start: WallTime, now: ShopNow): boolean  // compare ≤ 0 — THE one "has the visit begun" rule in ecs-core
hasEnded(end: WallTime, now: ShopNow): boolean      // ported from frameColumns' `past`
// no instant-based visit-vs-now function is added (inChairAt / nextUnstarted / outwardFromNow dropped: D-3, §8 OQ-14)
// systems/visit-list.system.ts
isHistory(a: BookingLifecycle & { readonly localDate: LocalDate; readonly startMinutes: MinuteOfDay }, now: ShopNow): boolean // isSettled ∨ VisitStorySystem.hasStarted (composes)
```

`rebuild-busy` and `transition` read `LIVE_STATUSES`; `mark-arrival` and
`booking.wire.ts:53` import `MarkArrivalAction` from `@core/components`;
transition reads its
three predicates; transition's UTC fallback reads `TimeZone.UTC` (edge on
W0-F).

### 2.2 Staff draft and people (W0-V)

```ts
// systems/visit-draft.system.ts
GRAIN_MINUTES = 5; snap(minute: number): number; snapUp(minute: number): number
typedStart(range, minute) / typedEnd(range, minute)        // the block editor's typed-pair clamps, exact
// review round (§9.7 F-3, F-12): snap/snapUp(minute: MinuteOfDay): number (a TRACK minute out, [0, 1440]);
// typedStart/typedEnd(range: TrackSpan, minute: MinuteOfDay): TrackSpan (DraftMinutePair deleted — R-6's track
// exception: 23:58 typed snaps to 1440 and pushes the end to 1445, never clamped); floorSpan(minutes: number):
// DurationMinutes (max(GRAIN, minutes), no snap — the frame and the dashboard's spans); typedSpan(typed: number):
// DurationMinutes (floorSpan(snap(typed)) — the typed duration's ingestion; spanToEnd, editorSpan, overrideFor compose them)
editorSpan(override: DurationMinutes | null, legs): DurationMinutes   // override ?? max(legMinutes(legs), GRAIN)
overrideFor(span: DurationMinutes, legs): DurationMinutes | null      // the frame (onFrameDraft): span === max(raw leg sum, GRAIN) ? null : span
typedOverrideFor(minutes: DurationMinutes, legs): DurationMinutes | null // the typed figure (setDuration): minutes === raw leg sum (0 with no legs) ? null : minutes
spanToEnd(start: MinuteOfDay, typedEnd: MinuteOfDay): DurationMinutes // before start = next day; snapped; floored at GRAIN
// catalogMinutesOf / CatalogLegMinutes UNCHANGED (E-16 STAYS)
GUEST_KEY_PREFIX = 'guest-'; accountKeyOf(clientId: string): UserId | null // placeholder or guest → null; the rest through UserId.parse (a refusal → null)
// systems/location-scope.system.ts
homeOf(barber: { readonly locationIds: readonly LocationId[] }): LocationId | null
isMultiShop(locationCount: number): boolean      // VisitStorySystem.namesShop composes it (edge to W0-A)
// systems/client-query.system.ts
// rank / RankableClient UNCHANGED (E-22 STAYS; no optional field in a system input)
PREFILL_PHONE_DIGITS = 5; prefillsPhone(parsed): boolean
recentAccounts(orderedPast: readonly Appointment[], limit: number): readonly AccountPick[] // input order kept, distinct, booker identity (DEP-5), cap
bookAccounts(newestFirst: readonly Appointment[]): readonly AccountPick[]               // input order kept, distinct named
  // the caller's `utcEpochMs < now` filter and newest-first instant sort stay in the component (D-3, OQ-14)
  // review round (§9.7 F-7): bookAccounts<V extends BookVisit>(visits) orders the book itself, newest contact
  // first by UtcEpochMs.compare (stable); the dashboard hands the window unsorted. (The «Скорошни» filter/sort stays, OQ-14.)
// systems/search-fields.system.ts
DIGIT_QUERY_MIN = 4; digitQuery(raw: string): string | null; digitsMatch(field: string, digits: string): boolean
TERM_MIN = 2; termSearchable(term: string): boolean   // length ≥ TERM_MIN on the caller's own operand
// pipelines/append-team-note.pipeline.ts (NEW)  appendTeamNote(ports: <the note bundle>) => (cmd) => Result<…>
```

### 2.3 Money and discounts (W0-B)

```ts
// systems/discount.system.ts
ordered(inputs: readonly DiscountInput[]): readonly DiscountInput[]      // the private compareByTotalOrder, stable
samePromise(a: DiscountProvenance & CouponValue, b: DiscountProvenance & CouponValue): boolean // widened
withAdded<D>(current: readonly D[], candidate: D, promiseOf: (d: D) => DiscountPromise): readonly D[]
offerablePromos<P>(promos: readonly P[], heldCouponIds: readonly CouponId[], couponIdOf: (p: P) => CouponId): readonly P[]
resolvedCode(coupon: Coupon, code: VoucherCode): ResolvedCode
// systems/voucher.system.ts
cascade(available: readonly PriceCents[], due: Money): { covers: readonly Money[]; left: readonly Money[]; dueAfter: Money } // composes coverage; settleVouchers' step 2 calls it
// systems/billing.system.ts
draftBill(subtotal: Money | null, discounts: readonly DiscountInput[], voucherAvailable: readonly PriceCents[]): DraftBill
  // { lines: { id: AppliedDiscountId; amountCents: PriceCents }[] (every input, total order, zeros kept, 0 with no subtotal);
  //   discountTotalCents; totalCents | null; covers; left; voucherTotalCents; balanceDueCents | null; takenCents }
capManual(value: CouponValue.Manual, subtotal: Money): CouponValue.Manual
recordedTipsTotal(seats: readonly Seat[]): Money | null                 // strict: a second currency → null
recordTip(appointment: Appointment, seatId: SeatId, tipCents: PriceCents | null): Result<{ seats; auditAction } | null, SchedulingError.AppointmentUnknownSeat>
pendingDiscounts(requests, resolvedGrants, resolvedCodes, currency): PendingDiscounts
manualValue(...)  // now calls CouponValue.manualPercentOff
// systems/coupon-grant.system.ts
expiresAtUtcMs(grant: GrantLifecycle): UtcEpochMs | null                // ACTIVE ∧ EXPIRES_AT
resolved(grant: CouponGrant, coupon: Coupon | null, nowUtcMs): ResolvedGrant
held(grants: readonly CouponGrant[], coupons: readonly Coupon[]): readonly HeldGrant[] // join; a gone coupon drops its grant
// components
CouponValue.manualPercentOff(raw: number): Result<CouponValue.PercentOff, …>  // integer 1–100; percentOff unchanged (0–100)
VoucherCode.sameCover(a: readonly string[], b: readonly string[]): boolean      // normalize, then in-order equal
VoucherCode.distinct(codes): Result<readonly VoucherCode[], …>                 // no voucher twice, no blanks
VoucherRedemption.drawableCents(r): PriceCents                                  // balanceAfterCents + restoreDelta(r)
// pipelines: record-seat-tip calls recordTip; NEW load-held-grants.pipeline.ts
```

### 2.4 Grid, intervals, schedule exceptions (W0-G)

```ts
// components/grid-placement.data.ts (NEW): PlacementVerdict (SHORT/OVERLAP/OUTSIDE, moved)
GridLayoutSystem.placementVerdict(block: { readonly id: string; readonly startMinute: number; readonly endMinute: number }, columns: readonly { events: readonly { id; gridEvent; startMinute: number; endMinute: number }[]; open: readonly { startMinute: number; endMinute: number }[] }[], floor: DurationMinutes): { placementVerdict: PlacementVerdict | null; hit: { column: number; event: number } | null }
  // RAW integer minutes (never MinuteRun — its end clamps at 1440 and would flip SHORT and OUTSIDE past midnight):
  // 1. endMinute − startMinute ≤ floor → SHORT; 2. columns empty → null (the grid's "no editable column");
  // 3. the FIRST non-GAP event ≠ block.id with half-open overlap, in column/event order → OVERLAP + hit;
  // 4. OUTSIDE iff !columns.every(c => c.open.some(w => w.startMinute ≤ start ∧ end ≤ w.endMinute)); else null
// review round (§9.7 F-9): GridLayoutSystem.frameVerdict(block: TrackSpan, neighbours: readonly TrackSpan[], shift: TrackSpan | null)
  // the visit sheet's line: placementVerdict's overlap and containment on raw track minutes, no SHORT, no OUTSIDE when
  // shift is null; the editor narrows on PlacementVerdict (FrameVerdict/frameVerdictWords deleted)
// review round (§9.7 F-8): BusySystem.chairOccupants(appointments, barberId, excludeId): readonly { appointment; seat }[]
  // what occupies a chair beside a placement — every seat of a ROOT-live appointment, self excluded (DEP-2 amended)
GridLayoutSystem.collides(event: RunEvent, band: MinuteRun): boolean   // non-GAP ∧ half-open overlap
GridLayoutSystem.totalMinutes(gaps: readonly LaneGap[]): MinuteCount
IntervalSetSystem.hull(ranges: readonly MinuteRange[]): MinuteRange | null
ScheduleExceptionSystem.block(existing: ScheduleException | null, ranges: readonly MinuteRange[], meta: ScheduleExceptionMeta): Result<ScheduleException | null, SchedulingError>
ScheduleExceptionSystem.unblock(existing: ScheduleException | null, range: MinuteRange | null): Result<ScheduleException | null, SchedulingError>
ShopZoneSystem.zoneOr(named: ShopLocation | null, fallback: TimeZone | null): TimeZone | null
ShopZoneSystem.zoneOfScope(named: ShopLocation | null, firstListed: ShopLocation | null, fallback: TimeZone | null): TimeZone | null // zoneOf unchanged
// pipelines/schedule-blocks.pipeline.ts (NEW): writeScheduleBlocks(ports: ScheduleExceptionPorts), clearScheduleBlock(ports)
```

The per-day `null` meanings stay exact: `block` → `null` = keep the stored
document; `unblock` → `null` = delete. The store keeps the "invalid" vs
"failed" `_absenceError` words.

### 2.5 Roster, availability, capacity, decisions (W0-R)

```ts
RosterSystem.shopHoursOn(locations: readonly Pick<ShopLocation, 'id' | 'openingHours'>[], localDate: LocalDate): readonly ShopHours[]
  // a loop over the existing shopDayHours (composes; input order); no listed filter — the caller's (PartyAdmissionSystem.shopListed in barberDays)
RosterSystem.worksDay(rosteredCount: number, appointmentCount: number): boolean
RosterSystem.shopOpeningAt(week: readonly DayHours[], localDate: LocalDate, minute: MinuteOfDay): { shopOpening: ShopOpening; atMinutes: MinuteOfDay | EndMinute | null; localDate: LocalDate }
  // ≤ 60 min left → CLOSES_SOON; open → CLOSES_AT; before opening → OPENS_AT; forward scan ≤ 7 days (same weekday next week included) → OPENS_ON; none → OPENS_AT with null
// components/opening-hours.data.ts: ShopOpening (moved), SHOP_CLOSES_SOON_MINUTES = 60
AvailabilitySystem.paddedBusy(barberId: BarberId, busy: Pick<BarberBusyDay, 'blocks'> | null, schedule: Pick<BarberSchedule, 'turnaroundMinutes'> | null, release: readonly ChairTime[]) // null busy = no spans, null schedule = ZERO turnaround
AvailabilitySystem.dayBookable(inRange: boolean, exact: boolean | null, isToday: boolean, freeMinutes: number): boolean
  // review round (§9.7 F-11): freeMinutes: MinuteCount, compared with MinuteCount.ZERO; the schedule step keeps the
  // ReadonlyMap<LocalDate, MinuteCount> freeMinutesByDay answers, and AvailabilityDayCell.freeMinutes is a MinuteCount
CapacitySystem.planBarberCapacity({ shops: readonly Pick<ShopLocation, 'id' | 'openingHours'>[]; busy: readonly Pick<BarberBusyDay, 'localDate' | 'blocks'>[]; … })
CapacitySystem.freeMinutesByDay(entries, from: LocalDate, to: LocalDate, barberIds, locationId): ReadonlyMap<LocalDate, number> // ported capacityByDay
BookingDecisionSystem: schedules: readonly Pick<BarberSchedule, 'id' | 'versions' | 'turnaroundMinutes'>[]; busy: readonly Pick<BarberBusyDay, 'barberId' | 'localDate' | 'blocks'>[] // matched on barberId + localDate
PartyAdmissionSystem.bookableServices(services: readonly (Service | null)[]): readonly Service[]
```

Callers re-pointed in W0-R: `booking-read-set` (`bookingSnapshotOf` loops
deleted), `rebuild-capacity`, `match-waitlist`, `request-waitlist`,
`capacity.system.ts`/`booking-decision.system.ts` internals,
`scheduling.port.contract(.spec).ts`; outside ecs-core, the call LINES only:
`staff-day.store.ts` `laneGeometryOf`'s `paddedBusy` call (:766-771) and
`day-availability.ts`'s (:303-308).

### 2.6 Client booking and catalog (W0-D)

```ts
CatalogPricingSystem.performersByPrice<S extends CatalogPriced>(service: S, variantId: ServiceVariantId | null): readonly { barberId: BarberId; terms: ServiceTerms }[] // performerIds + termsFor, stable on priceCents, [] with none
CatalogPricingSystem.bundleSaving(bundle, members: readonly CatalogPriced[]): { savedCents: PriceCents; savedMinutes: number } | null // integer cents; ≤ 0 → null
CatalogSystem.shelf(services: readonly Service[]): readonly Service[]                 // !upsellOnly, input order
CatalogSystem.byCategory(categories, services): readonly { category; services }[]    // both by sortOrder
BookingCartSystem.nextSeatWithoutService(party, cart, after: SeatKeyText): SeatKeyText | null
BookingCartSystem.shopCoverage(serving: readonly LocationId[] | null, chosen: LocationId | null, chosenListed: boolean): { shopCoverage: ShopCoverage; targetId: LocationId | null }
BookingCartSystem.arrangementOf(assignments): SeatArrangement
BookingCartSystem.bookerFirst(seatKeys): readonly SeatKeyText[]
BookingCartSystem.barberDays(...) / dayOptions(...)    // ported from day-availability.ts, over RosterSystem.shopHoursOn + paddedBusy (edge on W0-R);
  // barberDays holds offeredShopHours: listed shops, then a moved visit's NAMED shop (listed or not) replacing its listed entry
  // review round (§9.7 F-1): RosterSystem.offeredWindows(input) / offeredCarveOuts(input) — the roster kept to the shops
  // input.shopHours names ([] = not on the day); barberDays, match-waitlist loadDay and laneGeometryOf all call them
BookingCartSystem.dayDocsKey(query) / sameDayDocsKey(a, b)   // moved from day-availability.ts: barbers in code-unit order, namedLocationId only for a move at a named shop
export type DayQuery / DayDocs / BarberDayDocs / DayDocsKey  // `type`s in booking-cart.system.ts (verbatim fields; interface → type)
MoveSystem.releaseOn(...); refusalOf(stored: MoveRefusalReason | null, carriedInReach: boolean): MoveRefusalReason | null
MoveSystem.clientMove(appointment, policy, nowUtcMs, owner): { clientMove: ClientMove; windowClosed: boolean } // ClientMove dictionary in a component;
  // windowClosed = BookingLifecycle.isLive(a) ∧ ¬BookingPolicy.mayCancelAt(policy, start, now) exactly (NaN start → false: compare reads NaN as equal)
MoveSystem.carriedSeatsInReach(riders, activeBarbers: readonly Pick<Barber, 'id'>[], services, activeShops: readonly Pick<ShopLocation, 'id'>[] | null) // D-5b
MoveSystem.placeRiders(assignments: readonly Pick<SeatAssignment, 'startMinutes'>[], riders)                          // D-5b
MoveSystem.decideCarried(plan, offered, decide); seatsAfter(decided, plan); plan(...) gains the listed-target rule
CalendarGridSystem.monthSpan(localDates, anchorMonth, back, ahead); inWindow(day, today, horizonEnd)
Party.labelNumberAfter(party): number; BookingContact.withNote(contact, raw); FlexibleWhen.firstLocalDate(when); BookingDraft.of(...)
TimeCoordinate.endUtcMs(a): UtcEpochMs   // utcEpochMs + duration via UtcEpochMs.plusMinutes
// components/shop-coverage.data.ts (moved), seat-arrangement.data.ts (NEW), client-move.data.ts (NEW)
// pipelines/shop-day.pipeline.ts (NEW): observeDayDocs, observeCapacityEntries only (imports the types from @core/systems)
// reschedule-appointment.pipeline.ts reads decideCarried/seatsAfter, digestOf (edge W0-P1); it keeps importing frameWallClock
```

### 2.7 Rhythm (W0-E)

```ts
StreakPublishSystem.publishable(a: StreakDraftAssessment, published: boolean): boolean
StreakPublishSystem.gate(a, published, effectiveFrom: LocalDate): Result<StreakDraftAssessment.Valid | null, StreakPublishError> // INVALID; nothing → null; too early (the shared private guard)
StreakPublishSystem.refusedEarliest(direction, refusedDay: LocalDate, today: LocalDate, policy): LocalDate // later(earliestEffectiveDay(…clientsSeeRhythm: true), refused + 1)
StreakPublishSystem.effectiveDay(chosen, a, floor: { day; direction } | null, tomorrow): { earliest; effectiveFrom }
StreakPublishSystem.headAfter(head, rule, transition, today): Result<{ head; waits }, StreakPublishError> // decide calls it
  // review round (§9.7 F-4/F-10): StreakPublishSystem.waits(version: { effectiveFromLocalDate }, today): boolean — headAfter's
  // `waits` and publishRhythmDraft's receipt both call it
StreakPublishSystem.waitingOn(head, published, today); baseVersionOf(head, published); isDraftDirty(a); undoOffered(direction, waits); historyNewestFirst(versions)
StreakRuleSystem.publishConsent(direction): StreakPublishConsent
StreakPreviewSystem.readsFacts(inForce, draft); sampleFacts(rule, today, dayStart); sampleRun(rule, today, dayStart); factsOfStats(record, dayStart)
RhythmDraftSystem.effectivePresets(today); remember(remembered, held); carryOver(draft, madeOn, now, remembered, choices)
StreakRule.coversShopExcuses(excuses); StreakQualifierRule.toggleService(ids, id)
StreakSystem.headOf(heads, states): StreakDefinition | null
StreakPublishError.guard(error: { errorCode: string }): error is StreakPublishError
LocalDate.later(a, b): LocalDate
// pipelines/rhythm-publish.pipeline.ts, rhythm-preview.pipeline.ts (NEW)
```

The double assessment stays: the store's computed assesses with
`picked ?? tomorrow`, the publish re-assesses with `effectiveFrom` — `gate`
is called on the second (§7 R-9).

### 2.8 Identity, media, time, roles (W0-F)

```ts
TimeZone.UTC                                       // checked brand inside time-zone.primitive.ts
AgeSystem.judgedOn(nowUtcMs: UtcEpochMs): LocalDate
ProfileEditSystem.namesChanged(stored, first, last); birthChanged(stored, birth); nameFromFull(typed, storedLastName) // decide composes the first two
OnboardingFlowSystem.openPersonalizeSteps(completion: ProfileCompletion | null): readonly PersonalizeStep[]
MediaSystem.check(file: { readonly type: string; readonly size: number }, maxBytes: number): MediaRefusal | null // type first, then size (≥ max refused — DEP-7)
// primitives/media-refusal.data.ts (NEW): MediaRefusal { NotAnImage: 'NOT_AN_IMAGE', TooLarge: 'TOO_LARGE' } — neutral, never a 'PHOTO' or 'AVATAR' code
MediaSystem.PHOTO_MAX_BYTES = 8 MiB; AvatarSystem.check(file: { type; size }) wraps the tag into AccountsError (codes unchanged)
MediaError: MEDIA_PHOTO_NOT_AN_IMAGE, MEDIA_PHOTO_TOO_LARGE (maxBytes) — attachVisitPhoto wraps the tag into them
PhotoOrigin.countsForClient(origin): boolean      // + the @core/testing photo double honours it
SPEND_ROLES = [Role.Admin]; seesClientSpend(roles: readonly string[]); readsClientWords(roles: readonly string[]) // role.data.ts
// pipelines: update-profile, complete-registration (judgedOn), upload-avatar (new check signature),
// NEW save-own-profile.pipeline.ts, NEW attach-visit-photo.pipeline.ts (attachVisitPhoto: guard → nextId → nowUtcMs → upload → save;
//   adoptVisitPhoto: nextId → nowUtcMs → save; one private record builder)
// testing/port-doubles.ts: the photo double honours countsForClient AND answers observeAppointmentPhotos stably by takenAtUtcMs;
//   the coupon double's listOpenCoupons drops code-less coupons (the adapter's contract)
// ports: notes-photos.port.ts documents the byTaken order; engagement.port.ts ListOpenCoupons says "…that carries a code"
```

Call LINES outside ecs-core: `profile.store.ts:95-98`,
`client-onboarding.ts:724-727` (`AvatarSystem.check(file)`).

### 2.9 Staff edit and booking server (W0-P1)

`AppointmentEditSystem.foldCommands`, `resizeEndOf`, `addedOccupantOf`,
`addedAccounts`, `lastDiscounts`, `pendingVouchers`, `relocatedTo`,
`auditVerb`, `digestOf`/`DIGEST_LENGTH`, `freshSeatsRostered`, `overlapOf`,
`carryBack`, `termsOverridesOf`, `undoable(rootStatus, commands)`,
`locksEdits(status)` (`guard` calls it), `guard`'s seat-slice signature;
`SeatingRuleSystem.spanOf` (shared with booking-decision — booking-decision
is W0-R's file: W0-P1 adds `spanOf` and W0-R re-points booking-decision's
`standingSpans` after it lands; declared edge);
`CustomerRecordSystem.missingContacts`; `ZonedTimeSystem.frameShopDay`
(branded in — `frameWallClock` stays the parsing helper, P-17);
`PlacementPolicy.staffPlacement`; `edit-command.data.ts` holds the
genuinely different arms once. `edit-appointment.pipeline.ts` ends as read →
`foldCommands`/`decide` → write; `book-appointment.pipeline.ts` reads
`staffPlacement`/`clientDefault`, and its `frameWallClock` parses then calls
`frameShopDay`. The empty-batch field is
`commands` (DEP-14).

### 2.10 Operations (W0-P2)

`TriggerAttemptSystem.repositoryFailure`, `decisiveFailure`/`attemptFailure`
judging a `RepositoryError` by `reason` (existing cases unchanged; new cases
for a repository error), `RepositoryError.guard(value: unknown)`;
`PolicyRecomputeJobSystem.isIdle`, `shouldRecordStall`;
`BackfillPlanSystem.outcomeOf`, `mirrorRowOf`, `chunk` on `chunkSize`;
`AuditSystem.backfillChangeKey`; `PagingSystem.pageSizeOf`;
`WaitlistSystem.cancel`; `ClientStatsSystem.billedHistory`,
`previousVisit(stats, current, instantOf)`; `BookingPolicy.freeThreshold`;
NEW `RetentionSystem.purgeAtUtcMs(anchor: RetentionAnchor)` (P-34: a
`retentionGroup`-discriminated union of branded anchors from NEW
`components/retention-group.data.ts`) with the seven retention figures as
named constants; the adapter parses. The pipelines `project-client-stats`,
`continue-policy-recompute`, `sweep-policy-recompute`, `run-backfill`,
`cancel-waitlist`, `sample-lead-time` re-point; `repositoryFailure` and
`decisiveAttemptFailure` stay exported from `project-client-stats.pipeline.ts`
as one-line delegates for wave 1 (`triggers.wire.ts`), deleted in wave 2.

---

## 3. Packages

Every package: no `git commit/push/checkout/stash/reset/worktree add`; undo
by inverse edit; `rm -rf dist/out-tsc` before a run-many typecheck;
`--skip-nx-cache` on typecheck; no emulator, dev server or `seed:dev`
(integrator only); no runbook grep gate (they write a canary — integrator
only); no `pnpm install/add/remove`, no `nx reset`; `grep -r` (not `git
grep`) for every "no caller" proof. A package that finds another spec
needing an edit beyond §4.3 STOPS and reports it (a hidden behaviour
change). Each package that creates a file appends ONE `export * from './x';`
line to its tier barrel (re-read and retry on conflict; never rewrite a
barrel).

**Per-package gate:** `pnpm nx run verify-tools:layering --skip-nx-cache`;
`pnpm nx typecheck <projects touched> --skip-nx-cache`; `pnpm nx lint
<projects touched>`; `pnpm nx test <projects touched>`; baseline reds only.
Wave 1's three staff packages: `staff-dashboard`'s typecheck may fail ONLY
at the cross-sites C1–C3 owned by a sibling (listed below); its tests still
run (Vitest transpiles without typechecking) and must pass.

**Wave-0 declared edges** (the producer lands the member FIRST and reports
it; the consumer imports it, never re-derives it):

| Consumer          | Waits for | Member(s)                                                                                     |
| ----------------- | --------- | --------------------------------------------------------------------------------------------- |
| W0-A, W0-R, W0-P1 | W0-F      | `TimeZone.UTC`                                                                                |
| W0-A              | W0-V      | `LocationScopeSystem.isMultiShop` (for `namesShop`)                                           |
| W0-D              | W0-R      | `RosterSystem.shopHoursOn`, the new `paddedBusy` signature                                    |
| W0-D              | W0-P1     | `AppointmentEditSystem.digestOf`                                                              |
| W0-P1             | W0-B      | `CouponGrantSystem.resolved`, `DiscountSystem.resolvedCode`, `BillingSystem.pendingDiscounts` |
| W0-R              | W0-P1     | `SeatingRuleSystem.spanOf` (booking-decision's `standingSpans`)                               |
| W0-B              | (none)    | —                                                                                             |

No cycle: W0-F, W0-V, W0-B produce first; W0-P1 produces `digestOf` and
`spanOf` before it needs W0-B's members.

**Wave-1 cross-sites** (staff-dashboard project):

- **C1** `VisitEditorResolution.by: CancelledSide | null` — W1-S2 changes
  the type in `ve`; W1-S3 produces `chairResolution(...).cancelledBy`.
- **C2** `VisitEditorCodeResult.refusal` / `codeState` carry
  `VoucherRefusal` — W1-S2 changes the types; W1-S1's `resolveVoucher`
  returns the tag.
- **C3** `discountValueOf` lives in `visit-editor/visit-editor-discount.ts`
  (W1-S2 creates it, moving the function unchanged); W1-S1 re-points
  `st:109`'s import line.

### W0-A — lifecycle, story, staff verbs · wave 0

**Owns:** `libs/ecs-core/src/components/booking-lifecycle.data.ts`,
NEW `components/staff-verb.data.ts`, `components/seat-outcome.data.ts`,
`components/seat.data.ts`, `components/booking-call.data.ts`,
`primitives/booking-status.data.ts`, `systems/appointment-lifecycle.system.ts`,
`systems/visit-story.system.ts`, `systems/visit-list.system.ts`,
`pipelines/transition-appointment.pipeline.ts`, `pipelines/rebuild-busy.pipeline.ts`,
`pipelines/mark-arrival.pipeline.ts`, and the outside CALL LINE
`apps/functions/src/wire/booking.wire.ts:53` (the `MarkArrivalAction` import
only) (+ each file's spec / type-spec). **Brief:** §2.1 by porting S-1…S-7,
S-21, S-29, E-10, E-13, E-26, C-22, P-19, P-20, Y-23's `MarkArrivalAction`
move from the cited lines;
`offeredVerbs` reuses the `reopenable` predicate extracted from
`reopenSettledSlice` (one guard); `leadVerb` the five `primaryVerb` arms;
`inverseOf` carries NO day guard; `exitVerbs` ports `ve:3119-3180`
exactly; `isHistory` composes `hasStarted`; NO instant-based visit-vs-now
function (S-14…S-16 are carried, D-3); `chairResolution` composes
`rootStory`, `decisiveCancellationIndex`, `distinct` (DEP-1) and returns
`CancelledSide` from its existing home (D-7 exception). `namesShop` composes
`LocationScopeSystem.isMultiShop` once W0-V lands it. Specs: purity +
`offeredVerbs` × every chair/root status × today/off-day/null; `leadVerb`
all five arms + null; `transitionSeats` CONFIRMED → [], whole party → [],
share → ids; `inverseOf` each verb × whole/part; `hasSeatMeaning` ≡
`outcomeForStatus !== null` for every status; `chairResolution`
STAFF+CLIENT_UNWELL → CLIENT, every UNSPECIFIED/OTHER by `cancelledBy`, two
seats latest wins, two seats of mixed actors in both orders (DEP-1), NO_SHOW
→ null side, live → null; `exitVerbs` every chair status × started ×
settled/gone (PENDING drops reinstate, NO_SHOW only once started, rebook
only settled ∧ ¬gone, cancel flagged not listed); `hasStarted`/`hasEnded`
at the minute, the day before/after; `isHistory` at start == now → true; `didNotHappen` truth
table (port `staff-event-head.spec.ts:151-156`); `staffCancelReason` OTHER
blank / OTHER words / a code / null.

### W0-V — staff draft, people, search · wave 0

**Owns:** `systems/visit-draft.system.ts`, `systems/client-query.system.ts`,
`systems/search-fields.system.ts`, `systems/location-scope.system.ts`, NEW
`pipelines/append-team-note.pipeline.ts` (+ specs). **Brief:** §2.2 by
porting S-17 (incl. `TERM_MIN`), S-20 (DEP-5), S-23…S-25, E-14, E-15,
E-17, E-18, E-21, Y-19 exactly (D-6: `overrideFor` compares the frame span
to `max(raw leg sum, GRAIN)`, `typedOverrideFor` the typed figure to the
RAW leg sum — 0 with no legs; `spanToEnd` wraps a before-start end by +1440
then snaps and floors). E-16 and E-22 STAY: `catalogMinutesOf` and `rank`
keep their signatures. `accountKeyOf` returns `UserId | null` (prove by
grep of the mint sites that no caller holds an empty client id — the one
raw id `UserId.parse` refuses; else stop and report). `recentAccounts`
keeps the caller's order (the instant filter and sort stay in the
component) and reads the booker (`ownerUserId`, else the SELF account seat) with the booker's
contact — DEP-5. The note pipeline types its ports by the existing note
bundle (split it in its port file if no bundle names the read+write pair).
Specs: purity + grain/snap edges (0, 4, 5, 1439), typed pair clamps (start
past end, end before start, floor 0), `overrideFor` at the floor and
"no legs, frame span 5" (→ null: span equals max(0, 5)), `typedOverrideFor`
"no legs, typed 5" (→ 5) and at the raw sum (→ null), past-midnight end,
`accountKeyOf` placeholder/guest/uid/unparseable, `homeOf` none/one/many,
`isMultiShop` 0/1/2, `prefillsPhone` 4/5 digits, recent: input order kept,
distinct, cap, companion-first party (DEP-5), `digitQuery` 3/4 digits,
separators, `termSearchable` 1/2 characters.

### W0-B — money, discounts, vouchers, grants · wave 0

**Owns:** `systems/billing.system.ts`, `systems/discount.system.ts`,
`systems/voucher.system.ts`, `systems/coupon-grant.system.ts`,
`components/coupon-value.data.ts`, `components/voucher-code.data.ts`,
`components/voucher-redemption.data.ts`, `pipelines/record-seat-tip.pipeline.ts`,
NEW `pipelines/load-held-grants.pipeline.ts` (+ specs). **Brief:** §2.3 by
porting E-1…E-8, S-10, S-11, S-18, Y-7, Y-13, P-11, P-12, P-21,
P-35, P-36. `draftBill` lists EVERY input line in total order with its
amount (zeros kept; all at 0 with no subtotal — `DiscountSystem.apply`
drops zeros, so `draftBill` re-joins by id); `cascade` is the one in-order
cascade and `settleVouchers`' step 2 calls it with output byte-identical
(its existing cases green untouched). `withAdded` keeps both editor paths:
the card path guards with `Combinability.canAdd` at the caller; the typed
code path replaces (port both, §7 R-5). `manualPercentOff` = integer 1–100;
`percentOff` unchanged; the editor's digit strip stays at its edge (E-7). Lands `resolved`, `resolvedCode`, `pendingDiscounts`
first (W0-P1 waits). Specs: purity + the E-1 fixtures (21,85 € / 22,40 €;
the voucher chain −10,00/«остават 0,00», −15,20/«остават 34,80», then
−25,20 after removing v1 — as cents), zero-amount line kept, no subtotal,
two currencies, `capManual` 101 % / over-subtotal / under, `recordTip`
unknown seat / unchanged / cleared / recorded, manual 0 / 12.5 / 100 / 101,
codes duplicate with case and spaces, `expiresAtUtcMs` every lifecycle,
`held` gone coupon, `samePromise` stale
grant value (DEP-12).

### W0-G — grid, intervals, schedule exceptions, zones · wave 0

**Owns:** `systems/grid-layout.system.ts`, `systems/interval-set.system.ts`,
`systems/schedule-exception.system.ts`, `systems/shop-zone.system.ts`, NEW
`components/grid-placement.data.ts`, NEW `pipelines/schedule-blocks.pipeline.ts`
(+ specs). **Brief:** §2.4 by porting Y-3…Y-5, Y-14, Y-15, Y-18, S-13,
S-19; `placementVerdict` reproduces both the grid's single-column and the
timeline's every-chair precedence on RAW integer minutes (SHORT at span ≤
floor; an empty column list → null; the FIRST non-GAP overlap in
column/event order; OUTSIDE iff NOT every column has an open window
containing the block — `!columns.every(c => c.open.some(contains))`); the pipeline hands `block`/`unblock` into
`writeScheduleException`'s transaction (Law 4) per day. Specs: purity +
verdict precedence, a GAP never collides, own id excluded, empty columns → null after SHORT, REQUIRED past-midnight
cases on raw minutes (23:25–00:15 keeps today's verdict; 1405–1455 against a
window ending 1440 → OUTSIDE; 1430–1460 with floor 15 → not SHORT; §7 R-6),
one chair shut for part of the block among open ones → OUTSIDE, `hull` empty /
one / disjoint; `block` [] on any → CLOSED, merge, CLOSED already covers →
null; `unblock` null range → null, CLOSED refuses EMPTY_RANGES, last range →
null, HOURS stays HOURS, BLOCKED stays BLOCKED; `zoneOr`/`zoneOfScope`
every precedence step.

### W0-R — roster, availability, capacity, decisions · wave 0

**Owns:** `systems/roster.system.ts`, `systems/availability.system.ts`,
`systems/capacity.system.ts`, `systems/booking-decision.system.ts`,
`systems/party-admission.system.ts`, `components/opening-hours.data.ts`,
`pipelines/booking-read-set.pipeline.ts`, `pipelines/match-waitlist.pipeline.ts`,
`pipelines/rebuild-capacity.pipeline.ts`, `pipelines/request-waitlist.pipeline.ts`,
`testing/scheduling.port.contract.ts` (+ its spec), and the two outside
CALL LINES `libs/features/staff/dashboard/src/lib/staff-day.store.ts:766-771`
and `libs/features/client/booking/src/lib/schedule-step/day-availability.ts:303-308`
(+ specs). **Brief:** §2.5 (P-28, P-29, R-23's system, S-27/Y-12,
C-17, C-19's capacity part): the systems read the stored slices; delete
every rename (`bookingSnapshotOf`'s two loops, rebuild-capacity's two maps,
match-waitlist's); `booking-decision`'s internal `paddedBusy`/shop-hours
build and `standingSpans` re-point (the latter onto `SeatingRuleSystem.spanOf`
once W0-P1 lands it); `UTC_ZONE` becomes `export const UTC_ZONE: TimeZone =
TimeZone.UTC;` with a "transitional, deleted in wave 2" JSDoc; `shopOpeningAt`
ports `statusFor` exactly on minutes (same-weekday-next-week wrap, null time
on a week with no open day). Specs: purity + `paddedBusy` null busy / null
schedule / release (the existing calls re-shaped to the positional
arguments as §4.3 lists, expectations byte-identical); `shopHoursOn`
composes `shopDayHours`, closed day, input order; `worksDay` 0/0, 0/1, 1/0;
`shopOpeningAt` port `locations.component.spec.ts:172-270` (19:10 closes
soon, 08:30 opens, 20:30 → next day, noon open, Sunday); `freeMinutesByDay`;
`dayBookable` truth table; `bookableServices` null/inactive.

### W0-D — client booking, catalog, moves · wave 0

**Owns:** `systems/catalog-pricing.system.ts`, NEW `systems/catalog.system.ts`,
`systems/booking-cart.system.ts`, `systems/move.system.ts`,
`systems/calendar-grid.system.ts`, `components/party.data.ts`,
`components/booking-contact.data.ts`, `components/flexible-when.data.ts`,
`components/booking-draft.data.ts`, `components/time-coordinate.data.ts`,
NEW `components/shop-coverage.data.ts`, NEW `components/seat-arrangement.data.ts`,
NEW `components/client-move.data.ts`, NEW `pipelines/shop-day.pipeline.ts`
(observes only),
`pipelines/reschedule-appointment.pipeline.ts`, and the outside CALL LINES
of `libs/features/client/booking/src/lib/client-booking/carried-reach.ts`
and `libs/features/client/booking/src/lib/review-step/rider-placement.ts`
(the body forwards the arrays as they are) (+ specs). **Brief:** §2.6 by
porting C-2's order, C-3, C-4, C-6, C-7, C-8, C-11…C-14, C-16, C-18…C-20,
C-25…C-27, P-18 and C-19's observe/plan/decide parts (logic ported
verbatim from `day-availability.ts` — `interface` becomes `type`, as no
`export interface` exists in ecs-core; the types and `dayDocsKey` /
`sameDayDocsKey` land in `booking-cart.system.ts`, the observes in the
pipeline; the feature file stays until W1-B deletes it). `barberDays`
carries `offeredShopHours`' named-shop rule; `clientMove` computes
`windowClosed` exactly as today (`isLive ∧ ¬mayCancelAt`). `performersByPrice` reproduces the cheapest-first STABLE sort
(ties keep declaration order) on `priceCents`; `bundleSaving` the anonymous
offering's no-performer case on the service's own terms (DEP-10: integer
cents). `labelNumberAfter` keeps highest PRESENT + 2. `firstLocalDate` is
a MIN scan. Specs: purity + performers none/one/tie/variant/base;
bundle no saving / exact sum (null) / member missing a barber; `shelf`;
`byCategory` (port `rhythm-service-groups.spec.ts:37`); next seat wrap,
party of one; coverage ladder (port the schedule-step cases as tags);
arrangement one / parallel / sequential; `clientMove` every branch incl.
NaN start (`windowClosed` false — `mayCancelAt` waves it through, as today); `dayDocsKey` barber order, named shop only
with a release; `barberDays` with an UNLISTED named shop (offered, clamped to
its own hours) and a listed one (replaced, not doubled); month span widening; `inWindow` edges; `refusalOf` precedence;
`decideCarried` retired service / cart alone refuses / carried refuses;
`labelNumberAfter` after a removal (today's answer).

### W0-E — rhythm · wave 0

**Owns:** `systems/streak-publish.system.ts`, `systems/streak-preview.system.ts`,
`systems/rhythm-draft.system.ts`, `systems/streak-rule.system.ts`,
`systems/streak.system.ts`, `components/streak-rule.data.ts`,
`components/streak-qualifier.data.ts`, `errors/streak-publish.error.ts`,
`primitives/local-date.primitive.ts`, NEW `pipelines/rhythm-publish.pipeline.ts`,
NEW `pipelines/rhythm-preview.pipeline.ts` (+ specs). **Brief:** §2.7 by
porting R-1…R-18, R-20, R-21, K-4; `decide`/`withdraw`/`assess`/`estimate`/`summary`
call the extracted helpers with outputs byte-identical (their existing
cases green untouched); the publish pipeline maps a throw to
`RepositoryError.writeFailed(null, 'threw')` and re-derives TOO_EARLY via
`refusedEarliest`; the preview pipeline moves the walk and the memo with the
`walk === started` race unchanged; `RHYTHM_PREVIEW_PAGE_SIZE/PAGES/CAP` move
with it. Specs: purity + every store case cited in R-1…R-10 restated as
values; `guard` every code vs a `RepositoryError`; `later` both orders and
equal; `sampleFacts` port preview :517-637; `readsFacts` both rules ×
qualifier; consent per direction; `headOf` held / none.

### W0-F — identity, media, time, roles · wave 0

**Owns:** `primitives/time-zone.primitive.ts`, `systems/age.system.ts`,
`systems/profile-edit.system.ts`, `systems/onboarding-flow.system.ts`,
`systems/avatar.system.ts`, NEW `systems/media.system.ts`, NEW
`primitives/media-refusal.data.ts`, `errors/media.error.ts`, `components/photo-origin.data.ts`,
`components/role.data.ts`, `pipelines/update-profile.pipeline.ts`,
`pipelines/complete-registration.pipeline.ts`, `pipelines/upload-avatar.pipeline.ts`,
NEW `pipelines/save-own-profile.pipeline.ts`, NEW
`pipelines/attach-visit-photo.pipeline.ts`, the photo double in
`testing/port-doubles.ts` (count/list on `countsForClient`;
`observeAppointmentPhotos` answered stably by `takenAtUtcMs`) and the coupon
double's `listOpenCoupons` line (drops code-less coupons), the JSDoc of
`ports/notes-photos.port.ts` `ObserveAppointmentPhotos` (the `byTaken`
order) and of `ports/engagement.port.ts` `ListOpenCoupons` ("…that carries a
code"), and the outside CALL LINES
`libs/features/client/profile/src/lib/profile.store.ts:95-98` and
`libs/features/client/onboarding/src/lib/client-onboarding/client-onboarding.ts:724-727`
(+ specs). **Brief:** §2.8 by porting Y-1, Y-2, K-1, K-2, C-21, C-29,
C-31, C-32, C-34, P-30, P-32; lands `TimeZone.UTC` FIRST (three packages
wait); `MediaSystem.check` answers a neutral `MediaRefusal | null` and
refuses `size >= maxBytes` (DEP-7 — the storage.rules `<` rule;
`avatar.system.spec.ts:21` changes on purpose); `AvatarSystem.check` wraps
the tag into its `AccountsError` codes, `attachVisitPhoto` into the new
`MediaError` photo codes; `saveOwnProfile` moves with the refusal
allowlist; `attachVisitPhoto` takes the DOWNSCALED blob and runs the guard
BEFORE reading `nextId`/`nowUtcMs`; `adoptVisitPhoto` shares the record
builder; `openPersonalizeSteps` returns `[]` when nothing is
open. Specs: purity + media type-before-size, `size == max` refused,
`max − 1` passes; `judgedOn` at UTC midnight (port `age-day.spec.ts`);
`namesChanged`/`birthChanged`/`nameFromFull` (port contact-sheet cases);
roles: admin / sysadmin / receptionist; `countsForClient` per origin;
both wrappings of `MediaRefusal` (avatar → `AccountsError`, photo →
`MediaError`); attach pipeline refusal (neither `nextId` nor `nowUtcMs`
called) / upload failure / save; adopt pipeline record (Library origin, id
then stamps); the doubles: photos out of order come back by
`takenAtUtcMs`, a code-less ENABLED coupon is not listed.

### W0-P1 — staff edit and booking server · wave 0

**Owns:** `systems/appointment-edit.system.ts`, `systems/zoned-time.system.ts`,
`systems/seating-rule.system.ts`, `systems/customer-record.system.ts`,
`components/placement-policy.data.ts`, `components/edit-command.data.ts`,
`pipelines/edit-appointment.pipeline.ts`, `pipelines/book-appointment.pipeline.ts`
(+ specs incl. `appointment-dictionaries.type-spec.ts`). **Brief:** §2.9 by
porting P-1…P-17 and S-9's `undoable`, E-9's `locksEdits`. P-17 is a
split: `frameWallClock` stays in `book-appointment.pipeline.ts` as the
parsing helper (reschedule and edit keep importing it) and calls
`ZonedTimeSystem.frameShopDay` on branded input. The pipeline's
`resolve` callback keeps the DST check and the worked instant (Law 7.3);
everything else in the fold is the system's. Lands `digestOf` and
`spanOf` early (W0-D, W0-R wait); consumes W0-B's
`resolved`/`resolvedCode`/`pendingDiscounts`. `staffWalkIn` and its spec
UNTOUCHED (§8 OQ-3). Specs: purity + port every fold case; `resizeEndOf`
across days, `≤ 0`, past 1440; occupant SELF+owner / guest / no owner;
`undoable` root COMPLETED + ADD_SEAT → false, otherwise true; `frameShopDay`
earliest start, gap refused, fall-back earlier offset, a null day (no
instant, nothing refused), null slots skipped; `overlapOf` lone
resize vs batch; `staffPlacement` values.

### W0-P2 — operations · wave 0

**Owns:** `systems/trigger-attempt.system.ts`, `systems/policy-recompute-job.system.ts`,
`systems/backfill-plan.system.ts`, `systems/audit.system.ts`,
`systems/paging.system.ts`, `systems/waitlist.system.ts`,
`systems/client-stats.system.ts`, NEW `systems/retention.system.ts`, NEW
`components/retention-group.data.ts`, `errors/repository.error.ts`, `components/booking-policy.data.ts`,
`pipelines/project-client-stats.pipeline.ts`, `pipelines/continue-policy-recompute.pipeline.ts`,
`pipelines/sweep-policy-recompute.pipeline.ts`, `pipelines/run-backfill.pipeline.ts`,
`pipelines/cancel-waitlist.pipeline.ts`, `pipelines/sample-lead-time.pipeline.ts`
(+ specs). **Brief:** §2.10 by porting P-22…P-27, P-31, P-33's system,
P-34's system, K-3; `decisiveFailure`'s existing cases unchanged, new
cases for a `RepositoryError` (reason `unavailable` → TRANSIENT);
`repositoryFailure`/`decisiveAttemptFailure` stay exported as delegates;
`previousVisit` takes the store's `instantOf` so the order stays the
instant order; `RetentionSystem.purgeAtUtcMs(anchor)` takes a typed,
branded `RetentionAnchor` (never a `DocBody` or a path string — parsing is
the adapter's, W1-F) and reproduces all seven formulas
(`firestore-ttl.adapter.spec.ts:16-144` restated as anchors → instants,
incl. the epoch floor of a request watching no day and the
ended-else-expires impersonation anchor). Specs:
purity + the cited pipeline cases as values.

### W1-S1 — staff store, time grid, timeline, block editor · wave 1

**Owns:** `libs/features/staff/dashboard/src/lib/staff-day.store.ts`,
`row-verb.ts`, `time-grid/**`, `timeline/**`, `block-editor/**`, NEW
`time-grid/minute-run.ts`, `src/index.ts`. **Brief:** re-point Y-1…Y-7,
Y-10…Y-19, Y-23 and the C2/C3 sites (Y-8 STAYS; Y-9's adapter order stays, the store's re-sort goes):
`photoUploadRefusal`/`MAX_PHOTO_BYTES` deleted (the store calls
`attachVisitPhoto`, and `adoptPhoto` calls `adoptVisitPhoto`; no reader of
`photoUploadRefusal` remains — grep); `writeBlocks`/`clearBlock` call the
pipelines (same port, same key order — `staff-dashboard.spec.ts:3082`);
`laneGeometryOf` calls `shopHoursOn` (its all-shops input unchanged);
`grantExpiresOn` deleted; `resolveVoucher` returns `VoucherRefusal`;
`visitPhotos` re-sort deleted only AFTER running every photo case
(`staff-dashboard.spec.ts:4368` and the rest) against W0-F's ordered double
— a red one stops the deletion and is reported; `saveTeamNote` on `storedNote`;
`appendTeamNote`/`loadGrants` call the pipelines; `workingLanes`/`offToday`
on `worksDay`; the grid's and timeline's verdicts on `placementVerdict`;
`closedRuns` on the system via the shared `minute-run.ts` (the verdicts
feed `placementVerdict` RAW minutes, never `toMinuteRun`'s clamped run);
block editor
collisions and grain on the systems; `row-verb.ts` re-binds `ArrivalVerb`
from `@core/components`, `RowVerb = StaffVerb`; `grid-gesture.ts`
re-exports `PlacementVerdict`. Specs: no edit.

### W1-S2 — visit editor · wave 1

**Owns:** `libs/features/staff/dashboard/src/lib/visit-editor/**` (+ NEW
`visit-editor-discount.ts`). **Brief:** re-point E-1…E-21, E-23 and E-26
(E-16, E-22, E-24, E-25 untouched): `evaluate`/`voucherLines`/`dockDue`/`discountSummary`/`adoptCode`
read `draftBill`; `offerBlocked` → `Combinability.canAdd`; `samePromise`
deleted for the system via the ONE edge parse `promiseOf(discount)` beside
`toCouponValue`; `addDiscount` → `withAdded`; `promoChoices` →
`offerablePromos`; codes → `VoucherCode.normalize`; `figureRead` →
`manualPercentOff`/`fixedAmount` on the DIGIT-STRIPPED integer (the strip
stays); `cappedFigure` → `capManual`; `settled`, `gone`, `exits` (the verb
legality on `exitVerbs`; ids, icons and labels stay), `frameVerdict`,
`frameColumns`, spans, `onFrameDraft` → `overrideFor`, `setDuration` →
`typedOverrideFor`, grain, the shop row (`isMultiShop` computed), identity
keys, `refusal`/`codeState` (C2), `lastVisitDate` (DEP-11), prefill
threshold; `catalogSum` and `toRankable` untouched; `by: CancelledSide |
null` (C1); `discountValueOf`
moved unchanged to `visit-editor-discount.ts` (C3). Spec edits: the five
`by:` fixture literals (§4.3). Run `pnpm nx build web` (templates).

### W1-S3 — staff dashboard · wave 1

**Owns:** `libs/features/staff/dashboard/src/lib/staff-dashboard/**`.
**Brief:** re-point S-1…S-29 (S-30 delete; S-31 untouched but its inner
wiring per D-11: `samePromise`, `sameCover`, `PLACEHOLDER_CLIENT_ID`,
`accountKeyOf`): `isTerminalStatus`, `primaryVerb`, `OFFERED`,
`seatScopeOf` (decision via `transitionSeats`), `resolutionOf` (via
`chairResolution`; the reason WORDS and `whenLabel` formatting stay),
neighbours on `isLive` at all four sources (DEP-2), `DayRowVm.rootBookingStatus`

- `reversibleSave` delegate (DEP-3), `offOn` roster-empty (DEP-4, the
  lift row's icon and label included), `browseClients` on
  `recentAccounts`/`bookAccounts` (DEP-5; the instant filter and sort stay and
  hand the ordered list in), extents on `hull` (not `rosterExtent`), the
  search digit rule and `TERM_MIN` (template bound to a computed boolean),
  `dayTips`, `daySummary`, people dedupe, `selfSeat`, `overridden`,
  constants, home shop, week lane filter, `statusOf`. Untouched (D-3 /
  OQ-14): `openWindowsOf`, `rosterExtent`, `live`, `isNext`, the search's
  outer order, the `tel:` href, the `catalogMinutesOf` call line. Spec
  edits: §4.3 only.
  Run `pnpm nx build web`.

### W1-K — client card · wave 1

**Owns:** `libs/features/staff/client-card/**` EXCEPT
`src/lib/wallet.presenter.ts` and its spec. **Brief:** K-1…K-7.
`client-card.words.ts`' `achievementMetricWord` switches on `Metric.*`.
Spec edits: none.

### W1-B — client booking · wave 1

**Owns:** `libs/features/client/booking/**`. **Brief:** C-1…C-20 EXCEPT
C-4's service-detail-sheet half and C-6 (both in `shared/catalog`, W1-C's)
(C-39 untouched): review totals/seat order/note; services performers (C-4's
`booking-services-step.ts` half and the bag), price (named barber gated on
`isPerformedBy`), guest number/next seat/blockers; booking-flow store `isTerminal`,
`persist`, `restoreFromWaitlist`; client-booking refusal; delete the
`carried-reach.ts`/`rider-placement.ts` wrappers if nothing but their
specs read them — else keep them as forwarders (their specs import them);
schedule step zone/coverage/bookable/month window; DELETE `day-availability.ts`
and re-point `booking-schedule-step.ts`, `booking-time-sheet.ts` and
`day-availability.spec.ts`'s import lines to `@core/pipelines`/`@core/systems`;
time-sheet arrangement; contact-sheet name rule. `ShopCoverage` re-bound and
re-exported (D-9). Spec edits: import lines only. Run `pnpm nx build web`.

### W1-C — client pages, catalog sheet, shell, event head · wave 1

**Owns:** `libs/features/client/appointments/**`, `client/account/**`,
`client/profile/**`, `client/account-state/**`, `client/onboarding/**`, `client/auth/**`,
`libs/features/shared/catalog/**`, `libs/features/shared/shell/**`,
`libs/features/shared/visits/src/lib/event-head/**`. **Brief:** C-22…C-35 (C-28: the ordering only; its now-filter stays
carried), C-38, R-26, and C-4's `service-detail-sheet.component.ts` half +
C-6: appointments history, merge, total, move verdict (`windowClosed`
exact), months, `.ics`; `/account`'s next visit on
`upcomingSoonestFirst(…)[0]`; profile save gate; the store's avatar
pre-check KEPT on `AvatarSystem.check(file)` (C-30); `own-profile.ts` re-exports `saveOwnProfile` from
`@core/pipelines` (three callers keep their import — superseded by §9.8 R2-3); `age-day.ts` on
`judgedOn`; onboarding meta (DEP-8) and steps; session identity's
`nextOpenStep` = first of `openPersonalizeSteps` (fallback AVATAR as
today); auth `OTP_CODE_DIGITS`; service-detail sheet performers (C-4's
sheet half) and saving (C-6, DEP-10); the footer's `tel:` stays (D-3); footer `TimeZone.UTC`; `hollowStatus` delegate. The anonymous
offering stays (wave 2). Spec edits: none (DEP-8 adds a case). Run
`pnpm nx build web`.

### W1-R — admin rhythm, marketing landing, the rhythm mark words · wave 1

**Owns:** `libs/features/admin/loyalty/**`, `libs/features/marketing/landing/**`,
`libs/features/staff/client-card/src/lib/wallet.presenter.ts` (+ spec), NEW
`libs/features/shared/visits/src/lib/rhythm-rule/rhythm-closed-mark.words.ts`
(+ spec) and its line in `libs/features/shared/visits/src/index.ts`.
**Brief:** R-1…R-25 (R-26/R-27 not yours): the store calls the gate,
helpers and pipelines (keeping intent ids, generation, `_floor`,
rebase/adopt, settle); `admin-rhythm.preview.ts` keeps `rhythmPreviewOf`,
`RHYTHM_PREVIEW_DELAY_MS` and D-9 delegates for the names its specs import;
the page's weeks, consent, undo, history order; the sheet's excuses and
toggle; `rhythm-service-groups.ts` deleted (its spec's import re-pointed to
`CatalogSystem.byCategory`); the closed-mark helper takes the id suffix,
month form and day form as parameters and reads `streakPeriodMarkWords`
(both DOMs byte-identical — run both words specs); landing `statusFor` on
`shopOpeningAt` with static `DayHours[]` entries (equal to the seed's) and an
explicit zero-padded `HH:MM` print (never a locale formatter that could
yield `8:00 PM`); `phoneHref` on `callHref`; the shelf on `CatalogSystem.shelf`.
Spec edits: import lines only. Run `pnpm nx build web`.

### W1-F — functions edge and infrastructure adapters · wave 1

**Owns:** `apps/functions/src/**`, `libs/infrastructure/**`. **Brief:**
P-20 (adapter `LIVE_STATUSES` → `BookingLifecycle.LIVE_STATUSES`), P-32
(photos adapter on `countsForClient`), P-33 (three adapters on
`pageSizeOf`), P-34 (`firestore-ttl.adapter.ts` parses each group's fields
into a branded `RetentionAnchor` and calls `RetentionSystem.purgeAtUtcMs`;
`purgeAtFor` still exported with its signature; null branches exact), P-35 (`discountsOf` decodes shape and calls
`CouponValue.manualPercentOff`/`fixedAmount`, answering field `discounts`
exactly as today), P-36, P-37 (`retryingTrigger` reads the wire's
`eventInstantOf`), P-38, and the wire's `BOOKING_STATUSES` → `isBookingStatus`.
`listOpenCoupons` keeps its code filter (Y-8 STAYS) and
`coupons-vouchers.adapter.spec.ts:87-94` stays green untouched.
Spec edits: none (`booking.wire.spec.ts:1227-1238` stays green — DEP-6 is a
no-change departure). Run `pnpm nx build functions && node
tools/verify/p0/check-functions-deps.mjs`.

### G — integrator · wave 2 + gates

**Owns:** the wave-2 deletions — `UTC_ZONE` (booking-read-set), the
`repositoryFailure`/`decisiveAttemptFailure` delegates
(project-client-stats), `AppointmentEditSystem.accountSubjects` if no caller,
the catalog presenter's anonymous offering (`catalog.presenter.ts:126`) and
`byVariant` if `grep -r` shows no reader, `photoUploadRefusal` if any
survivor; §5, §6, §9; HANDOFF §2/§3.3 updates; rules any package conflict.

---

## 4. Specs

### 4.1 New system specs (wave 0)

One `describe` per new function inside the existing `<system>.system.spec.ts`
(new spec files for `catalog`, `media`, `retention`, the new pipelines and
the new component dictionaries), each with the purity case of
`ecs-systems.md` and the boundary cases of its package brief — every
feature/pipeline case cited in §1 for that decision restated as a
value/tag assertion on the same fixture data. Never the wall clock. New
dictionaries get a type-spec of their literals. The moved pipelines carry
their specs' cases; a spec that moves is a file move with import lines
changed, cases byte-identical.

### 4.2 Existing specs — UNCHANGED except import/wiring lines

Every feature, store, presenter, words, pipeline, adapter and wire spec
passes unchanged; permitted edits are import lines re-targeted to a moved
name, the spec-file moves of §4.1, and — counted as wiring — the CALL-SHAPE
edits of a D-5(b) signature fix listed in §4.3 (argument shape and fixture
field names only; every expectation byte-identical; each line recorded in
§9.2). Baseline reds stay red, unchanged.

### 4.3 Spec edits by DEPARTURE or cross-site (the complete list)

- `staff-dashboard.spec.ts:2191` — `cancelledByStaff` → `cancelledByClient`
  (DEP-1; its fixture :2050-2064 is a STAFF stamp with `CLIENT_UNWELL`).
- `staff-visit-editor.spec.ts:2508`, `:2816`, `:3087`, `:4012`, `:6650` —
  fixture `by: 'client'` → `CancelledSide.Client`, `by: 'staff'` →
  `CancelledSide.Shop` (C1/DEP-1; expectations unchanged; `:6672` `by: null`
  unchanged).
- `avatar.system.spec.ts:21` — a file of exactly `MAX_BYTES` is refused
  (DEP-7).
- **Call-shape edits of the D-5(b) fixes (wiring, expectations
  byte-identical; the owning wave-0 package edits them):**
  - W0-F `avatar.system.spec.ts:16`, `:19-21`, `:28-31`, `:41-44`, `:55` —
    `{ contentType, sizeBytes }` → `{ type, size }` (`AvatarSystem.check`).
  - W0-D `move.system.spec.ts:178-215` — `placeRiders([at(14)], …)` →
    assignments `{ startMinutes }` (`at()` builds the slice; the `[]` case
    unchanged); the `carriedSeatsInReach` cases' barber/shop arrays →
    `{ id }` slices.
  - W0-R `availability.system.spec.ts:1405-1510`, `:1675`, `:2205-2218`,
    `waitlist.system.spec.ts:639`, `testing/scheduling.port.contract.spec.ts:58`,
    `:111`, `:127`, `:153` and `testing/scheduling.port.contract.ts:267` —
    `paddedBusy({ barberId, spans, turnaroundMinutes, release })` → the
    positional `(barberId, busy, schedule, release)` (null busy / null
    schedule where the old call passed `[]` / ZERO, R-8).
  - W0-R `capacity.system.spec.ts:135`, `:212`, `:421` — busy fixtures
    `spans:` → `blocks:`; its `shops: [{ locationId, week }]` fixtures (from
    `:105`) → `{ id, openingHours }`; `booking-decision.system.spec.ts:420`
    `busyDay` `{ id, spans }` → `{ barberId, localDate, blocks }` and its
    `schedules` fixtures `barberId` → `id`; the pipeline specs that build
    those inputs (`booking-read-set`, `match-waitlist`, `rebuild-capacity`)
    only where they call the system directly.
  - Any further call-shape hit of these four signatures found by `grep -rn`
    is listed in §9.2 by the package with the same rule; a hit that needs
    an EXPECTATION change stops the package (a hidden behaviour change).
- `@core/testing` doubles (W0-F): the photo double's order and the coupon
  double's code filter change no spec expectation (`port-doubles.spec.ts:606`
  green); a red photo case stops W1-S1's re-sort deletion (Y-9).
- New cases (added, never edited): `staff-dashboard.spec.ts` — a chair
  whose two seats were cancelled by different actors, in both orders, reads
  the last-cancelled seat's side (DEP-1), a settled neighbour neither drawn
  nor «застъпване» on the visit sheet and a split party whose chair is all
  cancelled inside a live root (DEP-2, per-source status), a split party's
  save receipt (DEP-3), a stood-down chair with bookings lifts the whole day
  and its `staff-block-lift` row shows the off icon and «liftDay» label
  (DEP-4), a companion-first party in «Скорошни» (DEP-5);
  `staff-visit-editor.spec.ts` — the frame verdict note (unpinned today);
  `client-onboarding.spec.ts` — the card meta from `cardPrice` (DEP-8);
  `booking-services-step.spec.ts` — the "anyone" CTA with an offering of a
  barber outside the active list (DEP-9).

Nothing else. A package that finds another spec needing an edit stops and
reports it.

---

## 5. Leftover checklist (integrator, after wave 2)

```bash
F='libs/features apps/functions/src libs/infrastructure'
# 1. Deleted copies — expect 0 lines each:
grep -rn "isTerminalStatus\|function primaryVerb\|const OFFERED\|function seatScopeOf\|cancellations.every" libs/features
grep -rn "photoUploadRefusal\|MAX_PHOTO_BYTES\|grantExpiresOn\|VOUCHER_REFUSAL_WORD\|laterOf\|PUBLISH_REFUSALS\|SHOP_EXCUSES =\|CENTER_SCHEDULE\|MLADOST_SCHEDULE\|capacityMonthsOf\|GRAIN_MINUTES_FOR_KIND\|otpLength = 6" libs/features
grep -rn "length >= 2\|length < 2" libs/features/staff/dashboard/src/lib/staff-dashboard   # the search term threshold → TERM_MIN
grep -rn "function samePromise\|function sameDiscount\|function sameCodes\|function closedRuns\|function isRepositoryError\|function decisiveAttemptFailure\|UTC_ZONE" libs apps
grep -rn "'primary'\|startsWith('guest-')\|replace('guest-'" libs/features
grep -rn "trim().toUpperCase()" libs/features
grep -rn "roles.includes('" libs/features
grep -rn "'client.visits.completed'" libs/features/staff/client-card/src/lib/client-card.words.ts
grep -rn "spans: .*blocks\|barberId: schedule.id\|locationId: location.id, week" libs/ecs-core/src
grep -rn "EndMinute.ofProven(seat.startMinutes" libs/ecs-core/src/pipelines
grep -rn "\.slice(0, 16)" libs/ecs-core/src/pipelines
grep -rn "Number.isFinite(raw) ? PagingSystem" libs/infrastructure
grep -rn "Date.parse(" apps/functions/src/edge.ts
grep -rn "MS_PER_DAY\|MS_PER_HOUR" apps/functions/src/adapters/firestore-ttl.adapter.ts
grep -rn "percent > 0" apps/functions/src/wire
grep -rn "const LIVE_STATUSES" libs apps
grep -rn "HISTORY_PAGE_SIZE\|FILTER_REFILL" libs/features/staff/client-card/src/lib/history.presenter.ts
grep -rn "isShot\b" libs/infrastructure
grep -rn "allowConflictingServices: staffPlacement\|allowConflictingServices: true" libs/ecs-core/src/pipelines
grep -rn "export const MarkArrivalAction\|export const [A-Z][A-Za-z]* = {" libs/ecs-core/src/pipelines   # no dictionary in the pipelines tier
grep -rn "^export interface" libs/ecs-core/src
grep -rn "\.sort(" libs/features/staff/dashboard/src/lib/staff-day.store.ts | grep -i "taken"   # the photo re-sort
grep -rn "ZonedTimeSystem.toUtc" libs/ecs-core/src/pipelines/book-appointment.pipeline.ts   # frameWallClock only parses now
grep -rn "KEEP_DAYS\|OTP_KEEP_HOURS\|latestDay\|lastDayOfMonth" apps/functions/src/adapters/firestore-ttl.adapter.ts
# 2. Money / intervals in components and stores — every hit reviewed (D-2.13 geometry or a STAYS row only):
grep -rn "Math.max(0, Math.min(\|Math.min(...\|Math.max(...\|reduce((sum\|reduce((total" libs/features --include=*.ts | grep -v "\.spec\.\|presenter\|words"
# 3. Sorts and filters in components/stores — every hit reviewed (allowed: words, host lookups, D-3 rows):
grep -rn "\.sort(\|localeCompare(" libs/features --include=*.ts | grep -v "\.spec\.\|presenter\|words\|\.vm\."
# 4. Stored-tag state choices outside a word table — every hit reviewed:
grep -rn "bookingStatus === BookingStatus\.\|=== BookingStatus\." libs/features --include=*.ts | grep -v "\.spec\."
# 5. Re-declared vocabularies — expect 0:
grep -rn "'void' | 'expired'\|'client' | 'staff'\|'parallel' | 'sequential'\|'not_an_image'" libs/features | grep -v "/testing/\|\.spec\."
#    (test support and specs excluded: `shared/visits/src/lib/testing/visit-fixtures.ts:180` and
#    `visit-row.presenter.spec.ts:159` keep their `'client' | 'staff'` fixture parameter — no package owns them, §4.2)
# 6. Every new system function has a caller and a spec — for each §2 name:
#    grep -rn "AppointmentLifecycleSystem.offeredVerbs" libs apps ; grep -n "offeredVerbs" libs/ecs-core/src/systems/appointment-lifecycle.system.spec.ts
# 7. Every "composes" holds — the named reuse appears in the body:
#    chairResolution→rootStory/decisiveCancellationIndex/distinct; draftBill→apply/ordered/cascade; cascade→coverage;
#    settleVouchers→cascade; offeredVerbs→reopenable; reopenSettledSlice→reopenable; gate→the shared guard; decide→headAfter;
#    namesShop→isMultiShop; decide (profile)→namesChanged/birthChanged; performersByPrice→performerIds/termsFor; AvatarSystem.check→MediaSystem.check;
#    isHistory→hasStarted (and no second start≤now comparison in visit-list); shopHoursOn→shopDayHours; barberDays→shopHoursOn;
#    attachVisitPhoto/adoptVisitPhoto→the one record builder; frameWallClock→frameShopDay; exitVerbs (E-26) in the editor's exits
# 8. Zones in systems — every hit reviewed; allowed: zoned-time (frameShopDay included), shop-zone, age (judgedOn on TimeZone.UTC only)
#    and the files that already named TimeZone on 2bd2354 (diff the list against `git grep -l TimeZone 2bd2354 -- libs/ecs-core/src/systems`):
grep -rln "TimeZone\b" libs/ecs-core/src/systems --include=*.system.ts
# 9. KEEP-FOR-C — each has a production caller now:
#    expected WIRED (≥ 1 production caller each):
for n in "BookingTotalSystem.total" "BookingTotalSystem.seatSubtotals" "TriggerAttemptSystem.decisiveFailure" "VoucherSystem.coverage" "DiscountSystem.samePromise" "OfferingPriceSystem.performerIds" "OfferingPriceSystem.isPerformedBy" "AppointmentEditSystem.fold"; do echo "$n"; grep -rln "$n" libs apps | grep -v "\.spec\." ; done
#    expected KEEP-PARKED (0 production callers; each recorded in §9.6 with its D-3 reason — a hit here is a copy to review):
for n in confirm complete markNoShow cancel reopenNoShow reopenSettled markSeatOutcome; do echo "AppointmentLifecycleSystem.$n"; grep -rn "AppointmentLifecycleSystem\.$n\b" libs apps | grep -v "\.spec\." ; done
for n in "VoucherSystem.redeem" "IntervalSetSystem.clip"; do echo "$n"; grep -rln "$n" libs apps | grep -v "\.spec\." ; done
# 10. No Pick/Omit of a *Ports type; no ../ in ecs-core; no class outside Angular — the lint and layering gates.
```

Record each hit of 2–4 in §9.1.1 with its ruling.

---

## 6. Integration and gates

### 6.1 Order

1. **Wave 0:** W0-A, W0-V, W0-B, W0-G, W0-R, W0-D, W0-E, W0-F, W0-P1,
   W0-P2 in parallel with the §3 edges. The integrator runs the static gate
   (§6.2 lines 1–7) on the wave-0 tree — the whole tree compiles (D-13).
2. **Wave 1:** W1-S1, W1-S2, W1-S3, W1-K, W1-B, W1-C, W1-R, W1-F in
   parallel (C1–C3 declared).
3. **Wave 2 (G):** the deletions of §3 G, then §5, the FULL gate, §6.3,
   §6.4, §9.

### 6.2 The gate (HANDOFF §4, unchanged)

```bash
pnpm nx sync:check
pnpm nx run verify-tools:layering --skip-nx-cache
rm -rf dist/out-tsc && pnpm nx run-many -t typecheck --skip-nx-cache
pnpm nx run-many -t lint
pnpm nx run-many -t test --parallel=3          # re-run staff-dashboard / staff-client-card / marketing-landing alone on timeout
pnpm nx test ecs-core --coverage               # statements stay ≥ 98.00 %
pnpm nx typecheck seed-tools
pnpm nx build web && pnpm run verify:bundle    # initial ≈ 598 kB; growth beyond ~+3 kB gets a reason in §9
pnpm nx build functions && node tools/verify/p0/check-functions-deps.mjs
# runbook §4.0, §4.2–§4.5, §4.7, §4.8, §4.9 grep gates — never while a typecheck/lint/test runs
# ONE AT A TIME:
pnpm run verify:p0
pnpm run test:emulator
pnpm run e2e:web                               # exactly the 19 baseline failures, 41 passed
```

Baselines: typecheck of `patterns` only; `gauge.spec.ts` (4),
`visit-pills.spec.ts` (1), `visits-page.presenter.spec.ts` "strikes an
hour that did not happen" (1); e2e 19 (6 `*-screenshots`,
`landing.spec.ts:121`, 12 `client-card-glance.spec.ts` runs of `:343`/`:686`
failing at `:384`/`:765`); `appointments.spec.ts:152` and the
landing-screenshots hero may flake under load — re-run alone:
`START_LOGGING_EMULATOR=true pnpm exec firebase emulators:exec --only firestore,auth,functions,storage --project demo-creativo-test "pnpm nx e2e web -- e2e/<spec> --repeat-each=3"`.
Test count: 11,144 (pass-B tree) + the new cases; a drop is a lost case.

### 6.3 DOM differential (the integrator)

Against `git archive 2bd2354 | tar -x -C <scratch>/base` (no worktree, no
checkout), for every touched feature project (`staff-dashboard`,
`staff-client-card`, `client-booking`, `client-appointments`,
`client-account`, `client-profile`, `client-onboarding`, `client-auth`,
`client-account-state`, `shared-catalog`, `shared-shell`, `shared-visits`,
`admin-loyalty`, `marketing-landing`):

1. A scratch Vitest setup file (scratchpad only, never committed) patches
   `ComponentFixture.prototype.detectChanges` to record
   `this.nativeElement.outerHTML` after each call, keyed by
   `expect.getState().currentTestName` (last value wins), and writes the map
   to a JSON file per spec file in `afterAll`. Verify on one known spec that
   the capture is non-empty.
2. Run each project's specs on the base copy and on the integrated tree with
   that setup file (`pnpm exec vitest run --config <project vite config>
--setupFiles <scratch setup>` from each tree's root; install nothing —
   the base copy borrows the integrated tree's `node_modules` by symlink).
3. Normalise (strip `_ngcontent-*`, `_nghost-*`, `ng-reflect-*`, generated
   ids and comment anchors) and diff by `file > test name`.
4. Differences are allowed ONLY in tests a DEP names (§4.3) and in DEP-only
   new tests (absent on the base side) — explicitly: DEP-1's resolution head
   words/tone, DEP-2's frame neighbours and their aria summary, DEP-3's
   «Отмени», DEP-4's `staff-block-lift` row (icon `staff.off` and label
   `staff.block.liftDay` on a stood-down chair with bookings, on the shown
   day), DEP-5's «Скорошни» rows, DEP-8's card meta, DEP-9's CTA, DEP-10's
   capsule. Anything else is a regression — find the code, never the spec.

_As run (wave 2):_ Vitest 4 has no `--setupFiles` flag, so step 2 runs each
project through a scratch WRAPPER config (scratchpad only) that imports the
project's own `vite.config.mts`, appends the capture file to its
`test.setupFiles` and relaxes `server.fs` so a setup file outside the tree
loads: `pnpm exec vitest run --config <scratch>/<side>-<project>.vite.mts`
from each tree's root. The capture also records after
`ComponentFixture.whenStable()` (zoneless specs settle there). Step 3 also
strips `ui-confetti__particle` spans, whose sizes are `Math.random` — the
only nondeterministic markup the run met.

### 6.4 Dev-stack smoke (the integrator, against a HEAD copy of `2bd2354`)

The law-10 §6.3 method: emulators up, `pnpm run seed:dev`, the integrated
tree and the `2bd2354` copy served on the same emulators; staff sign-in by
custom token for `dev-staff-ivan` + `window.__e2eSignIn`; record each
screen's DOM signature (text + `data-*` of the region) in bg and en; diff.

1. **Staff day grid and timeline:** lanes (incl. an off chair), the week
   view, closed shading, live/next cards, hatched past blocks, the day
   summary and tips line, the drag verdicts (short / overlap / outside) on
   the grid and the timeline, the block sheet with collisions and the
   whole-day lift (DEP-4 on a stood-down chair with bookings).
2. **The visit editor:** verbs (lead + overflow) on pending / confirmed /
   arrived / completed / no-show / cancelled chairs, the same-day reopen,
   the cancel sheet («Друго…» with and without words), the resolution head
   (DEP-1), discounts (cards, typed code, exclusive, manual percent/amount
   with the cap), vouchers (cascade, «остават», nothing left), tip, add
   service, the frame (DEP-2 next to a completed visit), the shop row with
   one and two shops, the save receipt and its «Отмени» (DEP-3 on a split
   party), «Скорошни» (DEP-5).
3. **The booking flow:** services (performer order, «Добави» price for one
   barber and for anyone — DEP-9, guest add/remove numbering, conflicts
   swap), bag, time (dayparts, parallel/sequential heading, shop coverage
   notice, greyed days), review (per-seat subtotals, total, note), the move
   flow and its refusals.
4. **The service detail sheet:** performers, duration range, from price,
   the bundle saving (DEP-10 on an exact-sum bundle if the seed has one).
5. **The landing:** locations (status line at the shop clock, week table,
   tel link), the services shelf, the team showcase prices.
6. **Client appointments and account:** list and calendar (history split at
   the start minute, months run), the sheet (total, move/cancel/shop-only,
   window closed), `/account`'s card; profile save gate; onboarding service
   grid (DEP-8) and resume step; the OTP screen.
7. **Admin rhythm:** save looser/stricter/switch, the too-early answer, the
   withdraw, history order, the preview and the sample track, the services
   and excuses sheets.
8. **The client card pages:** wallet (rhythm marks — byte-identical to the
   admin sample's words), history paging/refill, «Ново», spend for admin vs
   sysadmin vs receptionist.

Every signature identical but the DEP rows and the now-label minute.

---

## 7. Risks

- **R-1 The staff sheet pair is one Nx project in three packages.** C1–C3
  are the only cross-sites; anything else crossing `sd`/`ve`/`st` is a
  package overstepping. Typecheck goes green only after all three land.
- **R-2 Scripted edits on 6,800/7,400-line files.** Bound every scripted
  edit at function/comment boundaries and assert counts (owner memory:
  scripted-edit guardrails); prefer Edit with unique anchors.
- **R-3 `chairResolution` input.** Pass the CHAIR's seats (as
  `resolutionOf` does), not the whole party — passing all seats would change
  the head for split parties beyond DEP-1.
- **R-4 The reopen edge's `today`.** `offeredVerbs` reads the visit's
  `localDate` against `shopNow().localDate`; `rowFor` builds rows of other
  loaded days whose verbs are never offered (they feed undo commands only) —
  do not "fix" `rowFor` to reuse the sheet's verbs.
- **R-5 Two editor add paths.** A card pick of an exclusive offer is
  BLOCKED (`canAdd`); a typed code resolving to an exclusive coupon
  REPLACES (`withAdded`). Both stay; the typed-exclusive path is unpinned —
  W0-B adds the system case.
- **R-6 Past-midnight blocks.** `placementVerdict` takes RAW integer
  minutes for the block, the events and the open windows — never
  `MinuteRun`, whose end `toMinuteRun` clamps at 1440 (a clamp would turn
  1405–1455 against a window ending 1440 from OUTSIDE to inside, and
  1430–1460 with floor 15 into SHORT). Today's `draftVerdict` compares raw
  numbers; the 23:25–00:15 and the two clamp cases are REQUIRED W0-G spec
  cases, and W1-S1 runs `staff-time-grid.spec.ts:116`. `openWindowsOf`
  keeps its anchored raw minutes for the same reason (S-12). The review
  round (§9.7) adds two documented members of the same exception:
  `GridLayoutSystem.frameVerdict` (the visit sheet's line, on raw track
  minutes like `placementVerdict`) and `VisitDraftSystem`'s grain —
  `snap`/`snapUp` take a `MinuteOfDay` and answer a TRACK minute in
  `[0, 1440]` (a half rounds up: 1439 → 1440, which no `MinuteOfDay`
  holds, while 0 stays 0, which no `EndMinute` holds), and the block
  sheet's typed pair is a `TrackSpan` (a start typed at 23:58 snaps to
  1440 and pushes the end to 1445 — clamping would change the sheet);
  `floorSpan` takes a raw drawn span (a frame's end minus its start may
  run past midnight).
- **R-7 `hasFoot` coupling.** The dashboard's `hasFoot` counts
  `entry.tag !== null` while the template hides the tag on hollow rows;
  the template keeps calling the `hollowStatus` delegate unchanged — do not
  fold hollowness into `toRow`'s `tag` (`:1571` guards it).
- **R-8 `paddedBusy`'s null semantics.** booking-decision passed turnaround
  ZERO for a missing schedule and `[]` for a missing busy day; the new
  signature encodes both as `null`. Port every caller's fallback exactly.
- **R-9 Rhythm double assessment.** `assess` runs twice (the computed with
  `picked ?? tomorrow`, the publish with `effectiveFrom`); `gate` runs on
  the second, or the overnight too-early guard silently disappears. The
  client refuses TOO_EARLY even for an unpublished shop where the server
  skips the notice check — keep it (`admin-rhythm.store.spec.ts:1335`).
- **R-10 `StreakPublishError.guard`** must match exactly
  `Object.values(StreakPublishErrorCode)`, never the wire's ANSWERED subset,
  or toast routing changes.
- **R-11 Closed-mark merge.** The ids differ (admin appends the index), the
  month and day forms differ, the admin hard-codes the mark literals; all
  parameters, or both DOMs change.
- **R-12 Landing `HH:MM`.** `formatMinute` may be locale-sensitive (en could
  print `8:00 PM`); the component pads explicitly. The weekday index is
  Sunday-first in the component, Monday-first in `DayHours` — map once.
- **R-13 `UTC_ZONE` and `repositoryFailure` delegates** exist only between
  waves 0 and 2; the layering verifier's one-home rule holds because the
  system members live under their companion names.
- **R-14 Money formatting.** Moving catalog figures onto `PriceCents` +
  `currency` formats through `formatCents(cents, currency, locale)` —
  identical for EUR; a non-EUR service would print its own currency (no
  such service in the seed).
- **R-15 The anonymous offering** carries `termsFor`'s "service's own
  terms" fallback for `livePrice` and the bundle saving; it is deleted only
  in wave 2, after both readers moved.
- **R-16 `PagingSystem.pageSize`** keeps passing NaN through
  (`appointments.adapter.ts:82` relies on `limit(NaN)` throwing →
  `readFailed`); only the new `pageSizeOf` is total.
- **R-17 `purgeAtFor`** stays exported from the TTL adapter with its
  signature (`tools/seed/load-domain.mjs:84`, `tools/seed-dev-catalog.mjs:193`).
- **R-18 `LIVE_STATUSES`** order and values stay byte-equal (index #6; the
  emulator does not enforce composites).
- **R-19 Photos and coupons doubles.** The photo double starts honouring
  `countsForClient` and answers `observeAppointmentPhotos` stably by
  `takenAtUtcMs` (the adapter's `byTaken`, now written on the port); the
  coupon double drops code-less coupons (the adapter's contract); fixtures that pre-filtered by hand
  (`visit-fixtures.ts:576-581`) stay valid; a spec relying on the double
  counting every photo would show here first — report, do not edit.
- **R-20 There is no `staff-day.store.spec.ts`.** Store decisions are pinned
  only through `staff-dashboard.spec.ts`, `lane-gaps`/`lane-geometry`
  specs; the system specs carry the new pins.

---

## 8. Open questions (owner) — with the default this plan applies

- **OQ-1 (DEP-1)** — "Отказан от клиента/от салона" means the side the
  REASON puts it on (the card rows and the statistics), not who pressed the
  button. Default: the system rule. If the owner meant the actor, the card's
  words change instead.
- **OQ-2 (DEP-2)** — what occupies the chair for a placement is the
  server's busy rule (`BookingLifecycle.isLive`), not
  `GridLayoutSystem.occupiedIntervals` (the idle-gap record, which keeps
  completed and no-show visits). Default: `isLive`.
- **OQ-3 (D18)** — `PlacementPolicy.staffWalkIn()` (owner D18:
  `allowConflictingServices: false`) has no caller; both live staff paths
  allow conflicting services (the component's own JSDoc: "the shop's own
  book need not obey"). Default: frozen live rule via
  `PlacementPolicy.staffPlacement()`; `staffWalkIn` and its spec untouched
  until the owner rules (apply D18 = a behaviour change; or delete the
  preset).
- **OQ-4** — `/account`'s «Предстоящ час» may show a still-CONFIRMED visit
  whose start has passed (the appointments page lists it as past). Fixing it
  needs every listed shop's zone. Default: carried, unchanged.
- **OQ-5** — the OTP resend: client 30 s (design doc) vs server 60 s
  (`OtpLimits.ResendWindowMinutes`). Default: carried, unchanged.
- **OQ-6** — the guest label number: highest present + 2 (today) vs the
  monotonic counter (the code comment's intent). Default: today's rule, in
  `Party.labelNumberAfter`.
- **OQ-7 (DEP-4)** — "off all day" = roster empty. Default: applied.
- **OQ-8 (DEP-5)** — a recent visit's client is the booker
  (client-card-redesign §3.1.4). Default: applied.
- **OQ-9** — the editor's frame verdict reads the SEEDED day after a re-date.
  Default: unchanged.
- **OQ-10** — the booking-flow store's orchestration stays in the store
  (D-3). Default: stays.
- **OQ-11** — `isReadableId` (Firestore path rules) in the pipeline tier.
  Default: carried.
- **OQ-12** — D-11's pass-D list (the write plan, the save use case, the
  editor VM reshape, draft-id rules, prices from labels). Default: pass D.
- **OQ-13** — the OTP escalation `sendCount >= 3`. Default: display, stays.
- **OQ-14** — the dashboard's instant-measured durations/spans AND its
  instant visit-vs-now answers (Law 7.3): `live`, `isNext`, `past`, the
  search's outward order (with its `+∞` before the zone), «Скорошни»'s
  past filter and newest-first order, and the anchored-minute
  `openWindowsOf` merge. The lawful home is the wall-clock pair
  `VisitStorySystem.hasStarted`/`hasEnded`; adopting it changes answers in a
  DST fall-back hour and across zones. Default: carried, unchanged; no
  instant-based copy is homed in a system.

---

## 9. Ledger (filled by the integrator)

Filled on the wave-2 tree (2026-10-24, on `2bd2354` + waves 0–2), then
closed by the integrator's second round the same day: the two rows the first
round left OPEN — E-13's inexact port and C-4's sheet half with C-6 (DEP-10)
— landed, every package note was resolved (fixed, recorded here, or carried
in §9.6 with its reason), the FULL gate ran (§9.3), and the §6.3
differential and §6.4 smoke were re-run on the closed tree (§9.4, §9.5).
Every "caller" below was re-proven with `grep -rn` over `libs apps` (specs,
type-specs and `src/testing/` excluded; the §5 item 6 census of the 180 §2
names is the proof file of the run).

### 9.1 Per decision

| ID              | Package             | System function                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Caller re-pointed                                                                                                                            | Copy deleted                                                                                                                                                                                     | Spec cases                                                                                              |
| --------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| S-1             | W0-A · W1-S3        | `BookingLifecycle.isSettled` (widened)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `sd` terminal/verb rows                                                                                                                      | `isTerminalStatus`                                                                                                                                                                               | existing; `booking-lifecycle.data.spec.ts`                                                              |
| S-2             | W0-A · W1-S3        | `AppointmentLifecycleSystem.offeredVerbs` over the extracted `reopenable` (also `reopenSettledSlice`'s guard)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `sd` sheet verbs (`today` = `shopNow().localDate`)                                                                                           | `OFFERED` + the legal-set block                                                                                                                                                                  | `appointment-lifecycle.system.spec.ts` (every chair/root × today/off-day/null)                          |
| S-3             | W0-A · W1-S3        | `leadVerb` → `StaffVerb \| null`; `ArrivalVerb` to `staff-verb.data.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `sd` (`verbKey` stays wording)                                                                                                               | `primaryVerb`                                                                                                                                                                                    | five arms + null                                                                                        |
| S-4             | W0-A · W1-S3        | `transitionSeats` over `SeatOutcome.hasSeatMeaning`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `sd` `transitionSeatsOf` (a two-line delegate; the per-seat loop stays, D-3)                                                                 | `seatScopeOf`                                                                                                                                                                                    | CONFIRMED → [], whole party → [], share → ids                                                           |
| S-5             | W0-A · W1-S3        | `inverseOf` (no day guard)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `sd` `act()` → `offerUndo`                                                                                                                   | the inline inverse                                                                                                                                                                               | each verb × whole/part                                                                                  |
| S-6             | W0-A · W1-S3        | `BookingCall.staffCancelReason`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `sd` `confirmCancel`                                                                                                                         | the OTHER-with-no-words rule                                                                                                                                                                     | four cases                                                                                              |
| S-7             | W0-A · W1-S3        | `VisitStorySystem.chairResolution` (composes `rootStory` → `decisiveCancellationIndex`, `distinct`) — DEP-1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `sd` `resolutionOf` (words + `whenLabel` stay)                                                                                               | `cancellations.every`                                                                                                                                                                            | DEP-1 cases incl. mixed actors both orders; `:2191` flipped                                             |
| S-8             | W1-S3               | `BookingLifecycle.isLive` at all four neighbour sources — DEP-2; review round: `BusySystem.chairOccupants` (root-live seats, self excluded) at all FIVE sources, one rule (§9.7 F-8, DEP-2 amended)                                                                                                                                                                                                                                                                                                                                                                                                                                          | `sd` anchor day, stepped day, create, block                                                                                                  | the unfiltered neighbour lists                                                                                                                                                                   | two new dashboard cases                                                                                 |
| S-9             | W0-P1 · W1-S3       | `AppointmentEditSystem.undoable(rootStatus, commands)` — DEP-3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `reversibleSave` delegate; `DayRowVm.rootBookingStatus`                                                                                      | the chair-status rule                                                                                                                                                                            | `:5667-:5695` unchanged; one new case                                                                   |
| S-10            | W0-B · W1-S3        | `DiscountSystem.samePromise` (widened), `VoucherCode.sameCover`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `sd` bill-equality via the edge parse                                                                                                        | `sameDiscount`/`sameDiscounts`/`sameCodes`                                                                                                                                                       | discount + voucher-code specs                                                                           |
| S-11            | W0-B · W1-S3        | `VoucherRedemption.drawableCents`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `sd` `vouchersOf`                                                                                                                            | `amountCents + balanceAfterCents`                                                                                                                                                                | component spec                                                                                          |
| S-13            | W0-G · W1-S3        | `IntervalSetSystem.hull` — DEP-15 (a window closing at midnight)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `sd` four extents via `rosterHull` (each keeps its empty fallback)                                                                           | the min/max scans                                                                                                                                                                                | empty / one / disjoint                                                                                  |
| S-17            | W0-V · W1-S3        | `SearchFieldsSystem.digitQuery`/`digitsMatch`/`termSearchable`/`TERM_MIN`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `sd` search + the template's computed boolean                                                                                                | `length >= 2`, the digit threshold                                                                                                                                                               | 3/4 digits, separators, 1/2 chars                                                                       |
| S-18            | W0-B · W1-S3        | `BillingSystem.recordedTipsTotal` (≠ `tipsOf`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `sd` `dayTips`                                                                                                                               | the strict one-currency sum                                                                                                                                                                      | new system cases                                                                                        |
| S-19            | W0-G · W1-S3        | `GridLayoutSystem.totalMinutes`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `sd` `daySummary`                                                                                                                            | the gap reduce                                                                                                                                                                                   | grid-layout spec                                                                                        |
| S-20            | W0-V · W1-S3        | `ClientQuerySystem.recentAccounts`/`bookAccounts` — DEP-5; review round: `bookAccounts` orders the book itself (§9.7 F-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `sd` `browseClients` (instant filter + sort stay, OQ-14)                                                                                     | `accountOf`                                                                                                                                                                                      | DEP-5 new case; client-query spec                                                                       |
| S-21            | W1-S3               | `VisitStorySystem.seatPersonKey` (the existing person key — §1's `personKeyOf` names the subject-level twin); `Seat.isOwnAccount`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `sd` people dedupe, `selfSeat`                                                                                                               | the hand-built keys                                                                                                                                                                              | seat + story specs                                                                                      |
| S-22            | W1-S3               | `Seat.overridden`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `sd` override mark                                                                                                                           | the inline compare                                                                                                                                                                               | existing                                                                                                |
| S-23            | W0-V · W1-S3        | `VisitDraftSystem.GRAIN_MINUTES`/`snapUp`/`DEFAULT_SPAN_MINUTES`/`PLACEHOLDER_CLIENT_ID`; review round: `floorSpan` for the rebook and block-to-visit spans (§9.7 F-3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `sd`                                                                                                                                         | `GRAIN_MINUTES_FOR_KIND`, `?? 30`, `'primary'`                                                                                                                                                   | visit-draft spec                                                                                        |
| S-24            | W0-V · W1-S3        | `VisitDraftSystem.accountKeyOf` + `GUEST_KEY_PREFIX`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `sd` `isAccount`, guest skip                                                                                                                 | the id-spelling tests                                                                                                                                                                            | placeholder/guest/uid/unparseable                                                                       |
| S-25            | W0-V · W1-S3        | `LocationScopeSystem.homeOf`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `sd` three sites                                                                                                                             | `locationIds[0]`                                                                                                                                                                                 | none/one/many                                                                                           |
| S-26            | W1-S3               | roster-empty (the store's lane answer, zero form) — DEP-4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `sd` `offOn`                                                                                                                                 | the `resting()` shown-day rule                                                                                                                                                                   | DEP-4 new case                                                                                          |
| S-27            | W0-R · W1-S3        | `RosterSystem.worksDay`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `sd` week lane filter                                                                                                                        | the copy of `st:2050`                                                                                                                                                                            | 0/0, 0/1, 1/0                                                                                           |
| S-28            | W1-C                | `BookingLifecycle.didNotHappen`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `hollowStatus` delegate (`staff-event-head.ts`)                                                                                              | the `isVoid` copy                                                                                                                                                                                | event-head spec unchanged                                                                               |
| S-29            | W0-A · W1-S3 · W1-F | `isBookingStatus`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `sd` `statusOf`; `booking.wire.ts`                                                                                                           | the guard copies + `BOOKING_STATUSES`                                                                                                                                                            | `booking-status.data.spec.ts`                                                                           |
| S-30            | W1-S3               | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                            | `LaneVm.extentLabel`, `visitCount` (dead)                                                                                                                                                        | —                                                                                                       |
| E-1             | W0-B · W1-S2        | `BillingSystem.draftBill` (composes `apply`, `ordered`, `cascade`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `evaluate`, `voucherLines`, `dockDue`, `discountSummary`, `nothingLeft`                                                                      | the re-sort and both cascades                                                                                                                                                                    | the E-1 fixtures as cents                                                                               |
| E-2             | W1-S2               | `Combinability.canAdd`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `offerBlocked`                                                                                                                               | the exclusive test                                                                                                                                                                               | existing                                                                                                |
| E-3/E-4         | W0-B · W1-S2        | `DiscountSystem.samePromise`, `withAdded` — DEP-12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `addDiscount` via `promiseOf` (`visit-editor-discount.ts`)                                                                                   | the local `samePromise`                                                                                                                                                                          | stale-grant case; typed-exclusive replace                                                               |
| E-5             | W0-B · W1-S2        | `DiscountSystem.offerablePromos`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `promoChoices`                                                                                                                               | the hide rule                                                                                                                                                                                    | new hide case                                                                                           |
| E-6             | W1-S2               | `VoucherCode.normalize`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | four code sites                                                                                                                              | `trim().toUpperCase()` ×4                                                                                                                                                                        | existing                                                                                                |
| E-7/E-8         | W0-B · W1-S2        | `CouponValue.manualPercentOff`/`fixedAmount`; `BillingSystem.capManual` — DEP-6 (no change)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `figureRead`, `cappedFigure` (digit strip stays)                                                                                             | the range + clamp                                                                                                                                                                                | 0 / 12.5 / 100 / 101; caps                                                                              |
| E-9             | W0-P1 · W1-S2       | `BookingLifecycle.isSettled`; `AppointmentEditSystem.locksEdits` (`guard` calls it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `settled`, `gone`                                                                                                                            | the inline tests                                                                                                                                                                                 | existing                                                                                                |
| E-10            | W0-A · W1-S2        | `VisitStorySystem.hasStarted` (one body: `VisitListSystem.hasStarted`, homed in the lower file to avoid a story→list cycle)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `started`                                                                                                                                    | the minute compare                                                                                                                                                                               | at the minute, day before/after                                                                         |
| E-11            | W1-S2               | `CancelledSide` (C1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `resolutionKey`                                                                                                                              | `'client'` literal                                                                                                                                                                               | five fixture renames (§4.3)                                                                             |
| E-12            | W1-S2               | `MinuteRange.overlaps`/`contains`; review round: `GridLayoutSystem.frameVerdict` over `PlacementVerdict` (§9.7 F-9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `frameVerdict`                                                                                                                               | the inline overlap                                                                                                                                                                               | new frame-verdict case                                                                                  |
| E-13            | W0-A · W1-S2 · G    | `VisitStorySystem.hasEnded` on the frame's clock day (today — a frame carries a clock only then, OQ-9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `frameColumns` neighbour `past`                                                                                                              | the inline rule                                                                                                                                                                                  | `:6735`, `:6702`, `:6711` unchanged; the re-dated-draft test identical to `2bd2354` again (§9.4)        |
| E-14/E-15       | W0-V · W1-S2        | `editorSpan`, `overrideFor`, `typedOverrideFor`, `spanToEnd`, `snap`, `GRAIN_MINUTES`; review round: `floorSpan`/`typedSpan` (§9.7 F-3, F-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | span, `onFrameDraft`, `setDuration`, `commitEnd`                                                                                             | `legSum`, the local grain                                                                                                                                                                        | grain/snap/typed edges                                                                                  |
| E-17            | W0-V · W1-S2        | `LocationScopeSystem.isMultiShop` (computed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | the shop row                                                                                                                                 | `uiShops().length > 1`                                                                                                                                                                           | 0/1/2                                                                                                   |
| E-18            | W0-V · W1-S2        | `accountKeyOf`, `GUEST_KEY_PREFIX`, `PLACEHOLDER_CLIENT_ID`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | identity keys                                                                                                                                | `accountIdOf`'s spelling tests, `'primary'` ×5                                                                                                                                                   | visit-draft spec                                                                                        |
| E-19            | W1-S1 · W1-S2       | `VoucherRefusal` (C2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `refusal`/`codeState`/`codeNote`                                                                                                             | `'void'\|'expired'\|'empty'`                                                                                                                                                                     | refusal table re-keyed (§9.2)                                                                           |
| E-20            | W1-S2               | `VisitStorySystem.lastWorked` — DEP-11 (no-op)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `lastVisitDate`                                                                                                                              | the local order                                                                                                                                                                                  | `:7423` unchanged                                                                                       |
| E-21            | W0-V · W1-S2        | `ClientQuerySystem.prefillsPhone`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `openNewClient`                                                                                                                              | `>= 5`                                                                                                                                                                                           | 4/5 digits                                                                                              |
| E-23            | W1-S2 · W1-S1       | — (file move, C3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `st` import → `visit-editor-discount.ts`                                                                                                     | —                                                                                                                                                                                                | —                                                                                                       |
| E-26            | W0-A · W1-S2        | `AppointmentLifecycleSystem.exitVerbs`; review round: rebook derived from `chairStatus` (§9.7 F-6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `exits` (ids, icons, labels stay)                                                                                                            | the legality ladder                                                                                                                                                                              | every chair × started × settled/gone                                                                    |
| Y-1/Y-2         | W0-F · W1-S1        | `MediaSystem.check` + `PHOTO_MAX_BYTES` — DEP-7; `attachVisitPhoto`/`adoptVisitPhoto` (one record builder `visitPhotoFacts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `attachPhoto`, `adoptPhoto`                                                                                                                  | `photoUploadRefusal`, `MAX_PHOTO_BYTES`                                                                                                                                                          | media + attach pipeline specs                                                                           |
| Y-3/Y-4         | W0-G · W1-S1        | `ScheduleExceptionSystem.block`/`unblock`; `writeScheduleBlocks`/`clearScheduleBlock`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `writeBlocks`, `clearBlock`                                                                                                                  | the decide closures                                                                                                                                                                              | schedule-exception + pipeline specs                                                                     |
| Y-5             | W0-G · W1-S1        | `ShopZoneSystem.zoneOr`/`zoneOfScope`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | the two zone picks                                                                                                                           | the precedence ladders                                                                                                                                                                           | every step                                                                                              |
| Y-6             | W0-R · W1-S1        | `RosterSystem.shopHoursOn`; `paddedBusy` on stored slices; review round: `RosterSystem.offeredWindows`/`offeredCarveOuts` (§9.7 F-1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `laneGeometryOf`                                                                                                                             | the third barber-day build                                                                                                                                                                       | lane-geometry spec                                                                                      |
| Y-7             | W0-B · W1-S1        | `CouponGrantSystem.expiresAtUtcMs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | grant expiry                                                                                                                                 | `grantExpiresOn`                                                                                                                                                                                 | every lifecycle                                                                                         |
| Y-9             | W0-F · W1-S1        | the port's `byTaken` order (doubles honour it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —                                                                                                                                            | the store's re-sort                                                                                                                                                                              | photo cases green on the ordered double                                                                 |
| Y-10            | W1-S1               | `VoucherRefusal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `resolveVoucher`                                                                                                                             | `VOUCHER_REFUSAL_WORD`                                                                                                                                                                           | editor `:5205`                                                                                          |
| Y-11            | W0-V · W1-S1        | `VisitSidesSystem.storedNote`; `appendTeamNote`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `saveTeamNote`, `appendTeamNote`                                                                                                             | the stored-note copy                                                                                                                                                                             | append pipeline spec                                                                                    |
| Y-12            | W0-R · W1-S1        | `RosterSystem.worksDay`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `workingLanes`, `offToday`                                                                                                                   | the inline test                                                                                                                                                                                  | shared with S-27                                                                                        |
| Y-13            | W0-B · W1-S1        | `loadHeldGrants` over `CouponGrantSystem.held`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `loadGrants`                                                                                                                                 | the read-join                                                                                                                                                                                    | held / gone coupon                                                                                      |
| Y-14/Y-15       | W0-G · W1-S1        | `GridLayoutSystem.placementVerdict` (raw minutes), `collides`; `PlacementVerdict` to components                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | grid + timeline `draftVerdict`                                                                                                               | both verdict ladders                                                                                                                                                                             | past-midnight required cases                                                                            |
| Y-16            | W1-S1               | `GridLayoutSystem.closedRuns` via `time-grid/minute-run.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | timeline                                                                                                                                     | `closedRuns`                                                                                                                                                                                     | existing                                                                                                |
| Y-17            | W1-C                | `hollowStatus` delegate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | grid template unchanged                                                                                                                      | —                                                                                                                                                                                                | existing                                                                                                |
| Y-18            | W0-G · W1-S1        | `GridLayoutSystem.spansOverlap` (exported; neighbours carry no `gridEvent`, so not `collides`) with the whole day as the all-day span                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | block editor `collisions`                                                                                                                    | `allDay \|\| overlap`                                                                                                                                                                            | block-editor spec unchanged                                                                             |
| Y-19            | W0-V · W1-S1        | `GRAIN_MINUTES`/`snap`/`typedStart`/`typedEnd`; review round: `MinuteOfDay` in, the pair a `TrackSpan` (§9.7 F-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | block editor                                                                                                                                 | the local grain + pair clamps                                                                                                                                                                    | typed-pair clamps                                                                                       |
| Y-23            | W0-A · W1-S1 · W1-F | `ArrivalVerb`, `MarkArrivalAction` in `staff-verb.data.ts` (review round: the wire's `CallStateWord.Arrived`/`Unarrived` read `ArrivalVerb`, §9.7 F-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `row-verb.ts` (re-bind, `RowVerb = StaffVerb`), `mark-arrival`, `booking.wire.ts`                                                            | the pipelines-tier dictionary                                                                                                                                                                    | `staff-verb.data.spec.ts`                                                                               |
| K-1/K-2         | W0-F · W1-K         | `seesClientSpend`, `readsClientWords` (`role.data.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `client-card.store.ts`                                                                                                                       | `roles.includes(…)`                                                                                                                                                                              | admin / sysadmin / receptionist                                                                         |
| K-3             | W0-P2 · W1-K        | `ClientStatsSystem.previousVisit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | store «Ново»                                                                                                                                 | `previousVisitAtMs`                                                                                                                                                                              | client-stats spec                                                                                       |
| K-4             | W0-E · W1-K         | `StreakSystem.headOf`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `rhythmHead`                                                                                                                                 | the head pick                                                                                                                                                                                    | held / none                                                                                             |
| K-5             | W1-K                | `rewardsUsable()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | overview gate                                                                                                                                | the second `!paused()`                                                                                                                                                                           | existing                                                                                                |
| K-6             | W1-K                | — (file move)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `client-card.store.ts`                                                                                                                       | presenter constants                                                                                                                                                                              | existing                                                                                                |
| K-7             | W1-K                | `Metric.*`; `AchievementMetricWord = Metric`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `client-card.words.ts`                                                                                                                       | the bare literals                                                                                                                                                                                | words spec unchanged                                                                                    |
| C-1/C-2         | W1-B                | `BookingTotalSystem.total`/`seatSubtotals` (KEEP-FOR-C WIRED); `BookingCartSystem.bookerFirst`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | review step                                                                                                                                  | `totalLabel` math, per-seat sums, SELF-first                                                                                                                                                     | existing                                                                                                |
| C-3             | W0-D · W1-B         | `BookingContact.withNote`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `saveNote`                                                                                                                                   | trim/truncate/blank                                                                                                                                                                              | contact spec                                                                                            |
| C-4             | W0-D · W1-B · G     | `CatalogPricingSystem.performersByPrice`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | services step + bag; the service sheet's `performers` (G: the entity from `CatalogContentService.findService`, the host barber lookup stays) | `performerOptions` sort; the sheet's float sort                                                                                                                                                  | performers spec; sheet specs unchanged (providers added, §9.2)                                          |
| C-5             | W1-B                | `OfferingPriceSystem.isPerformedBy` (KEEP-FOR-C WIRED), `price`; `TermsSpanSystem.spanFor` — DEP-9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `livePrice`, `priceRangeLabel`                                                                                                               | the active-list min/max                                                                                                                                                                          | DEP-9 new case                                                                                          |
| C-6             | W0-D · G            | `CatalogPricingSystem.bundleSaving` — DEP-10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | the sheet's `savings` (members = the bundle's listed members' entities; `savedCents` printed by `CatalogWording.priceCents`)                 | the float sum                                                                                                                                                                                    | system spec; sheet `:222`, `:253` unchanged; one new DEP-10 case                                        |
| C-7/C-8/C-9     | W0-D · W1-B         | `Party.labelNumberAfter`, `nextSeatWithoutService`, `ServiceConflictSystem.conflictingWith`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | services step                                                                                                                                | the guest parse, the seat walk, the name match                                                                                                                                                   | existing                                                                                                |
| C-10/C-11/C-12  | W0-D · W1-B         | `BookingFlowSystem.isTerminal`, `BookingDraft.of`, `FlexibleWhen.firstLocalDate`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | flow store                                                                                                                                   | the re-spelled terminal set, origin ladder, `[0]`                                                                                                                                                | existing                                                                                                |
| C-13/C-14       | W0-D · W1-B         | `MoveSystem.refusalOf`; `carriedSeatsInReach`/`placeRiders` on stored slices                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `client-booking.ts`; the two wrappers kept as one-line forwarders (production importers)                                                     | the inbound maps                                                                                                                                                                                 | rider/reach specs                                                                                       |
| C-15…C-18       | W0-D · W0-R · W1-B  | `zoneOfScope`, `shopCoverage` (`ShopCoverage` to components), `dayBookable` (review round: `MinuteCount` in, §9.7 F-11), `CalendarGridSystem.inWindow`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | schedule step, month                                                                                                                         | the ladders                                                                                                                                                                                      | coverage tags                                                                                           |
| C-19            | W0-D · W0-R · W1-B  | `shop-day.pipeline.ts`; `BookingCartSystem.dayDocsKey`/`barberDays`/`dayOptions`; `CapacitySystem.freeMinutesByDay`; `LeadTimeSystem.monthKeysBetween`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | schedule step + time sheet                                                                                                                   | `day-availability.ts` (file deleted)                                                                                                                                                             | `day-availability.spec.ts` (aliases)                                                                    |
| C-20            | W0-D · W1-B         | `BookingCartSystem.arrangementOf` → `SeatArrangement`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | time sheet                                                                                                                                   | `arrangementKind`                                                                                                                                                                                | new system cases                                                                                        |
| C-21/C-29       | W0-F · W1-B · W1-C  | `ProfileEditSystem.nameFromFull`/`namesChanged`/`birthChanged` (`decide` composes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | contact sheet, profile                                                                                                                       | the split + differs                                                                                                                                                                              | contact-sheet cases ported                                                                              |
| C-22            | W0-A · W1-C         | `VisitListSystem.isHistory` (composes `hasStarted`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `appointments.store.ts`                                                                                                                      | the inline ≤                                                                                                                                                                                     | start == now → true                                                                                     |
| C-23/C-24       | W1-C                | `VisitListSystem.distinctById`, `BillingSystem.subtotalOf`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | appointments page                                                                                                                            | merge, `openVisitTotal`                                                                                                                                                                          | existing                                                                                                |
| C-25/C-26/C-27  | W0-D · W1-C         | `MoveSystem.clientMove` (`windowClosed` exact), `CalendarGridSystem.monthSpan`, `TimeCoordinate.endUtcMs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | appointments page                                                                                                                            | the verdict trio, month run, `.ics` math                                                                                                                                                         | every branch incl. NaN start                                                                            |
| C-28            | W1-C                | `VisitListSystem.upcomingSoonestFirst(…)[0]`; review round: `VisitListSystem.soonestFirstByStart(…)[0]`, no forged row (§9.7 F-2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `/account`                                                                                                                                   | the hand sort                                                                                                                                                                                    | existing                                                                                                |
| C-30/C-31/C-32  | W0-F · W1-C         | `AvatarSystem.check({ type, size })`; `saveOwnProfile` (re-exported by `own-profile.ts`); `AgeSystem.judgedOn`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | profile store, account-state                                                                                                                 | the use case, three age-day homes                                                                                                                                                                | judgedOn at UTC midnight                                                                                |
| C-33/C-34/C-35  | W1-C                | `CatalogPricingSystem.cardPrice`/`durationRange` — DEP-8; `OnboardingFlowSystem.openPersonalizeSteps`; `OTP_CODE_DIGITS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | onboarding, session identity, auth                                                                                                           | `priceRange`/`durationRange` second rule, two step lists, `otpLength = 6`                                                                                                                        | DEP-8 new case                                                                                          |
| C-37            | G                   | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                            | the anonymous offering DELETED (`grep -rn "\.offerings" libs/features`: no production reader once C-4/C-6 landed); the presenter's per-variant map `byVariant` DELETED (no reader of the output) | sheet specs unchanged                                                                                   |
| C-38            | W0-F · W1-C · G     | `TimeZone.UTC`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | footer, age day, seed spec                                                                                                                   | `UTC_ZONE` (G)                                                                                                                                                                                   | footer spec                                                                                             |
| R-1…R-21        | W0-E · W1-R         | review round: `StreakPublishSystem.waits` for the receipt's `waits` (§9.7 F-4/F-10); `StreakPublishSystem.publishable`/`gate`/`refusedEarliest`/`effectiveDay`/`headAfter`/`waitingOn`/`baseVersionOf`/`isDraftDirty`/`undoOffered`/`historyNewestFirst`; `StreakRuleSystem.publishConsent`; `StreakPreviewSystem.readsFacts`/`sampleFacts`/`sampleRun`/`factsOfStats`; `RhythmDraftSystem.effectivePresets`/`remember`/`carryOver`/`weeksOf`; `StreakRule.coversShopExcuses`; `StreakQualifierRule.toggleService`; `StreakPublishError.guard`; `LocalDate.later`; `CatalogSystem.byCategory`; `rhythm-publish` / `rhythm-preview` pipelines | admin rhythm store, page, sheet, preview (D-9 delegates kept)                                                                                | `laterOf`, `PUBLISH_REFUSALS`, `SHOP_EXCUSES =`, `rhythm-service-groups.ts` (file deleted), the store's use cases                                                                                | ported store/page/preview cases                                                                         |
| R-22            | W1-R                | `rhythm-closed-mark.words.ts` (wording, one helper)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `admin-rhythm.words.ts`, `wallet.presenter.ts`                                                                                               | `sampleClosed`/`closedPeriod` bodies                                                                                                                                                             | both words specs + 6 new                                                                                |
| R-23/R-24/R-25  | W0-R · W1-R         | `RosterSystem.shopOpeningAt` (`ShopOpening` + `SHOP_CLOSES_SOON_MINUTES` to components); `E164` + `ShopReachSystem.callHref`; `CatalogSystem.shelf`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | landing locations, content service                                                                                                           | `statusFor`, the tables, `CENTER_SCHEDULE`/`MLADOST_SCHEDULE`, the parser, the shelf re-filter                                                                                                   | `locations.component.spec.ts` unchanged                                                                 |
| R-26            | W1-C                | `BookingLifecycle.didNotHappen`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `hollowStatus`                                                                                                                               | `isVoid` copy                                                                                                                                                                                    | unchanged                                                                                               |
| P-1…P-17        | W0-P1               | `AppointmentEditSystem.foldCommands`/`resizeEndOf`/`addedOccupantOf`/`addedAccounts`/`lastDiscounts`/`pendingVouchers`/`relocatedTo`/`auditVerb`/`digestOf`/`freshSeatsRostered`/`overlapOf`/`carryBack`/`termsOverridesOf`/`guard` (seat slice); `SeatingRuleSystem.spanOf`; `CustomerRecordSystem.missingContacts`; `ZonedTimeSystem.frameShopDay`; `PlacementPolicy.staffPlacement`; `edit-command.data.ts` arms once                                                                                                                                                                                                                     | edit / book / reschedule pipelines                                                                                                           | `foldOnClock`, `.slice(0, 16)`, the inline policy, `toUtc` in `frameWallClock`; `accountSubjects` (G — dead)                                                                                     | every fold case ported                                                                                  |
| P-18            | W0-D                | `MoveSystem.decideCarried`/`seatsAfter`/`plan`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | reschedule pipeline                                                                                                                          | the retry ladder                                                                                                                                                                                 | reschedule cases                                                                                        |
| P-19/P-20       | W0-A · W1-F         | `isReinstatement`/`readsShopToday`/`endsCancelled`; `BookingLifecycle.LIVE_STATUSES`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | transition, rebuild-busy, appointments adapter                                                                                               | three `LIVE_STATUSES`                                                                                                                                                                            | lifecycle spec                                                                                          |
| P-21            | W0-B                | `BillingSystem.recordTip`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | record-seat-tip                                                                                                                              | the tip decision                                                                                                                                                                                 | four branches                                                                                           |
| P-22…P-27, P-31 | W0-P2               | `WaitlistSystem.cancel`; `PolicyRecomputeJobSystem.isIdle`/`shouldRecordStall`; `TriggerAttemptSystem.repositoryFailure`/`decisiveFailure` (KEEP-FOR-C WIRED) + `RepositoryError.guard`; `WorkBudgetSystem.chunkSize`; `ClientStatsSystem.billedHistory`; `AuditSystem.backfillChangeKey`; `BackfillPlanSystem.outcomeOf`/`mirrorRowOf`; `BookingPolicy.freeThreshold`                                                                                                                                                                                                                                                                       | the six ops pipelines; `triggers.wire.ts` (W1-F)                                                                                             | `isRepositoryError`, the verdict copies; the `repositoryFailure`/`decisiveAttemptFailure` delegates (G)                                                                                          | trigger-attempt new cases                                                                               |
| P-28/P-29/P-30  | W0-R · W0-F         | review round: `RosterSystem.offeredWindows` in `loadDay` (§9.7 F-1); `RosterSystem.shopHoursOn`, `paddedBusy`/`BookingDecisionSystem`/`CapacitySystem` on stored slices; `PartyAdmissionSystem.bookableServices`; `TimeZone.UTC`, `AgeSystem.judgedOn`                                                                                                                                                                                                                                                                                                                                                                                       | booking-read-set, match-waitlist, rebuild-capacity, request-waitlist, registration, profile                                                  | the rename loops; `UTC_ZONE` (G)                                                                                                                                                                 | §4.3 call shapes                                                                                        |
| P-32…P-38       | W0-F · W0-P2 · W1-F | `PhotoOrigin.countsForClient`; `PagingSystem.pageSizeOf`; `RetentionSystem.purgeAtUtcMs`; `CouponValue.manualPercentOff` (DEP-6), `VoucherCode.distinct`; `eventInstantOf` (DEP-13); `TriggerAttemptSystem.repositoryFailure`                                                                                                                                                                                                                                                                                                                                                                                                                | photos, three paging adapters, TTL adapter (`purgeAtFor` kept), `booking.wire.ts`, `edge.ts`, `triggers.wire.ts`                             | `isShot`, the guard copies, `MS_PER_*`/`KEEP_DAYS`, `percent > 0`, `Date.parse(`                                                                                                                 | adapter/wire/edge specs unchanged                                                                       |
| G-1             | G                   | `CouponValue.positiveAmount` (the figure `fixedAmount` composes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `booking.wire.ts` `manualDiscountOf`                                                                                                         | the placeholder `MANUAL_GUARD_CURRENCY` (W1-F's note)                                                                                                                                            | `coupon-value.data.spec.ts` (accepts 1/1000, refuses 0/−1/−500 as `fixedAmount` does, purity)           |
| G-2             | G                   | the five pipeline-tier outcome dictionaries → components (`policy-recompute-outcome.data.ts`: `PolicyStartOutcome`/`PolicyStepOutcome`/`PolicySweepOutcome`; `client-stats-outcome.data.ts`; `capacity-trigger.data.ts`) — §5 item 1 to zero                                                                                                                                                                                                                                                                                                                                                                                                 | the five pipelines, `triggers.wire.ts`                                                                                                       | the pipelines-tier homes                                                                                                                                                                         | `stats-ops-dictionaries.type-spec.ts` (satisfies, Holds, SCREAMING); import lines only elsewhere (§9.2) |
| G-3             | G                   | — (one home)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | the editor and the dashboard read `MONEY_CODE` and `discountValueOf` from `visit-editor-discount.ts`                                         | `PROMISE_CURRENCY`, the editor's own `MONEY_CODE`, the transitional `discountValueOf` re-export (W1-S2/W1-S3 notes)                                                                              | —                                                                                                       |
| G-4             | G                   | — (the C-31 spec move completed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —                                                                                                                                            | `own-profile.spec.ts`'s byte-identical `saveOwnProfile` describe (its home is `save-own-profile.pipeline.spec.ts`, W0-F's note)                                                                  | −10 duplicate blocks, 0 lost                                                                            |

STAYS / CARRY rows (S-12, S-14…S-16, S-31, E-16, E-22, E-24, E-25, Y-8,
Y-20…Y-22, K-8, C-36, C-39, R-27, P-39) are unchanged by design (D-2, D-3,
D-11, §8).

#### 9.1.1 §5 review record

1. **Deleted copies** — every grep 0 production lines but these, ruled:
   `day-availability.spec.ts:63` binds `capacityMonthsOf =
LeadTimeSystem.monthKeysBetween` (a spec-local alias so the cases stay
   byte-identical — wiring, not a copy); the `'primary'` hits are the
   `emphasis`/`uiForegroundStyle` display tokens and the dashboard spec's
   placeholder-id fixtures (no production client-id literal); the three
   `.slice(0, 16)` hits are pipeline SPECS computing their expected digest;
   `const LIVE_STATUSES` is its one home (`booking-lifecycle.data.ts`). The
   five `export const … = {` hits the first round carried
   (`PolicySweepOutcome`, `PolicyStepOutcome`, `PolicyStartOutcome`,
   `ClientStatsOutcome`, `CapacityTrigger` — pre-pass-C, in no §1 row) were
   MOVED to components in the second round (G-2), so the grep reads 0, as
   it does for `MarkArrivalAction`. `capacityMonthsOf` reads 0 too: the
   spec-local alias in `day-availability.spec.ts` now binds the system's own
   name (`const { monthKeysBetween } = LeadTimeSystem`).
2. **Money / intervals in components and stores** — 67 hits (68 before the
   sheet's float saving went), all reviewed:
   pixel geometry and scroll/gesture clamps (D-2.13: header, visit list
   skeletons, pills, gallery, map bounds, swipe, time grid, timeline,
   `minute-run.ts`'s clamps, grid-gesture), layout caps (client loyalty,
   achievement detail), the slider geometry and typed-figure handling in the
   editor (D-3 row 15), `openWindowsOf`'s merge (S-12), `rosterExtent` (D-3),
   the instant-measured durations (D-3, OQ-14), `span()` wording, the
   picker count, test fixtures. The one open copy the first round found —
   `service-detail-sheet.component.ts:266`, the float bundle saving — is gone
   (C-6).
3. **Sorts and filters** — 21 hits (22 before the sheet's sort went), all
   reviewed: agenda layout (D-3), the
   search's outer order and «Скорошни»'s newest-first (D-3, OQ-14),
   `openWindowsOf` and the week column merge (display), the promos'
   `localeCompare('bg')` (D-3), the time grid's packer input, the rhythm
   sheet's P9 display order (R-20 STAYS), a highlight-run sort in
   `client-card.format.ts` (wording), the catalogue cache key, fixtures, the
   saved-shape discount sort inside `sd`'s snapshot (D-11 carry). The open
   copy the first round found — `service-detail-sheet.component.ts:199`, the
   performers sort — is gone (C-4's sheet half).
4. **Stored-tag state choices** — 24 hits, all reviewed: wording tables and
   icon/tone picks (`stateLabel`, `stateIcon`, `statusWord`, `verbKey`,
   `resolutionKey`/`Tone`/`Icon`), verb dispatch in `act()` and the exits'
   id/icon mapping (D-2.9, E-26), `destructive` (UI), `requestVerb` (the
   head's confirm, E-25 gating), and `actFromSheet`'s sheet dismissal on
   CANCELLED ∨ NO_SHOW (UI read-state; the set equals
   `BookingLifecycle.didNotHappen` — carried as a wiring candidate, §9.6).
5. **Re-declared vocabularies** (testing and specs excluded) — 0.
6. **Every new system function has a caller and a spec** — the 180 §2 names
   censused: every one has ≥ 1 production caller (the three with none under
   their dotted name are composed inside their own system —
   `reopenable`, `PREFILL_PHONE_DIGITS`, `barberDays` via `dayOptions`) and
   ≥ 1 ecs-core spec file; `CatalogPricingSystem.bundleSaving`, the one the
   first round found callerless, is called by the service sheet (C-6), and
   the second round's `CouponValue.positiveAmount` by the wire (G-1).
7. **Composes** — all hold (bodies read): `chairResolution` → `rootStory`
   (→ `decisiveCancellationIndex`) + `distinct`; `draftBill` → `apply`,
   `ordered`, `cascade`; `cascade` → `coverage`; `settleVouchers` →
   `cascade`; `offeredVerbs` and `reopenSettledSlice` → `reopenable`; `gate`
   → the private `tooEarlyFor` `decide` also calls; `decide` → `headAfter`;
   `namesShop` → `isMultiShop`; profile `decide` → `namesChanged` /
   `birthChanged`; `performersByPrice` → `performerIds` / `termsFor`;
   `AvatarSystem.check` → `MediaSystem.check`; `isHistory` →
   `VisitListSystem.hasStarted` (the ONE body; `VisitStorySystem.hasStarted`
   delegates to it — homed in the lower file, no second ≤ in visit-list);
   `shopHoursOn` → `shopDayHours`; `barberDays` → `shopHoursOn` (via
   `offeredShopHours`) + `paddedBusy`; `attachVisitPhoto` /
   `adoptVisitPhoto` → `visitPhotoFacts`; `frameWallClock` →
   `frameShopDay`; the editor's `exits` → `exitVerbs`.
8. **Zones in systems** — `age.system.ts` (on `TimeZone.UTC` only) is the
   one file added to `2bd2354`'s list (`programs`, `shop-zone`,
   `zoned-time`). Clean.
9. **KEEP-FOR-C** — WIRED, ≥ 1 production caller each:
   `BookingTotalSystem.total`/`seatSubtotals` (review step),
   `TriggerAttemptSystem.decisiveFailure` (continue-policy-recompute,
   project-client-stats), `VoucherSystem.coverage` (`VoucherSystem.cascade`),
   `DiscountSystem.samePromise` (`sd`, `visit-editor-discount.ts`),
   `OfferingPriceSystem.performerIds` (`performersByPrice`),
   `OfferingPriceSystem.isPerformedBy` (services step),
   `AppointmentEditSystem.fold` (edit pipeline via `foldCommands`).
   KEEP-PARKED, 0 production callers each, as §9.6 records:
   `AppointmentLifecycleSystem.confirm`/`complete`/`markNoShow`/`cancel`/
   `reopenNoShow`/`reopenSettled`/`markSeatOutcome`, `VoucherSystem.redeem`,
   `IntervalSetSystem.clip`.
10. **Lint and layering** — `pnpm nx run-many -t lint` 43 projects, 0
    errors (`creativo/no-sliced-ports`, the tier cages and the presenter
    purity rule included); `verify-tools:layering` OK.

#### 9.1.2 System spec cases added (new `it` blocks)

Static count of `it(`/`test(` blocks against `2bd2354`: **+682 in
ecs-core** (+575 in 54 modified spec files, +107 in 15 new spec files —
`catalog`, `media`, `retention`, the eight new pipelines, `staff-verb`,
`retention-group`, `booking-status`; four new type-specs carry no `it`),
net of the one `accountSubjects` case G deleted with its member; **+15
outside** (dashboard 6 DEP cases, editor 1 frame-verdict case, services
step 1 DEP-9, onboarding 1 DEP-8, `rhythm-closed-mark.words.spec.ts` 6).
The second round added +3 in ecs-core (`CouponValue.positiveAmount`, G-1)
and +2 outside (the service sheet's DEP-10 case; `SEAT_ARRANGEMENT_WORDS`
pinned in `booking-words.spec.ts`, W1-B's note), and removed the 4 blocks
(10 runtime cases) of `own-profile.spec.ts`'s `saveOwnProfile` describe —
byte-identical to the moved `save-own-profile.pipeline.spec.ts` (G-4), so
no case is lost. No other modified spec file lost a block. Runtime:
**11,883 passed** + the 6 baseline reds (the first round's log sums to
11,885 — its "11,824" was a mis-sum; the second round's −2 is G-4's −10 and
+8 new; pass B's record: 11,144).

### 9.2 Spec edits beyond §4.3 (expected: none)

Each is wiring or a dead-code deletion — no expectation VALUE changed:

- `booking-read-set.pipeline.spec.ts` — `snapshot.schedules[0]?.barberId` →
  `.id` and a busy fixture `{ id, spans }` → `{ ...barberBusyDayFixture(),
blocks }` (W0-R, D-5(b): the snapshot now carries the stored slices; the
  asserted value is the same barber id).
- `booking-cart.system.spec.ts` — its `paddedBusy` helper call re-shaped to
  the positional signature (W0-R's rule, §4.3's "any further call-shape
  hit").
- `appointment-edit.system.spec.ts` — the guard's `sold` helper re-shaped to
  the seat slice (W0-P1, §2.9 "`guard`'s seat-slice signature"); and the
  `accountSubjects` case deleted with the dead member (G, §3).
- `staff-visit-editor.spec.ts` — the voucher refusal table's inputs
  `'empty'|'expired'|'void'` → `VoucherRefusal.*` (C2's fixture rename,
  beside §4.3's five `by:` renames; the words asserted unchanged).
- `avatar.system.spec.ts` — DEP-7 realised as two lines: the old
  "exactly MAX passes" case now probes `MAX_BYTES − 1`, and a NEW case pins
  exactly `MAX_BYTES` refused (§4.3 said `:21` flips — same rule, one more
  case).
- `day-availability.spec.ts`, `rhythm-service-groups.spec.ts` — the
  planned import re-points written as spec-local aliases of the system
  names (`const { barberDays, … } = BookingCartSystem`), so every case body
  is byte-identical.
- `tools/seed/seed-data.spec.mjs` — `UTC_ZONE` → `TimeZone.UTC` (G, the
  wave-2 deletion).
- Comment-only: `age.system.spec.ts` (`UTC_ZONE` named in a block comment),
  `appointment-photos.adapter.spec.ts` (the guard that stops a bad photo is
  now `attachVisitPhoto`'s `MediaSystem.check`).
- Import lines only: `mark-arrival.pipeline.spec.ts`, `booking.wire.spec.ts`,
  `admin-rhythm-sheet.spec.ts`.

Second round (the integrator, closing the OPEN items and the package notes):

- `service-detail-sheet.component.spec.ts` — `render()` provides the
  catalogue the sheet now reads (`CATALOG_PORTS` = `memoryCatalogReadPorts`
  over the fixtures' stored twins, `MEDIA_RESOLVE_PORTS` =
  `memoryMediaResolvePorts()`) — wiring, every existing expectation
  byte-identical (`'Спестяваш 5,00 €'`, `'Иван Колев'`); one NEW case, DEP-10
  (1,10 € + 2,20 € apart, 3,30 € together: no capsule).
- `own-profile.spec.ts` — the `saveOwnProfile` describe deleted: it was
  byte-identical to `save-own-profile.pipeline.spec.ts`, where W0-F moved the
  use case with its cases (C-31, §4.1 "a spec that moves is a file move");
  the file keeps `nameRefusalCodes` (G-4).
- `day-availability.spec.ts` — the alias `capacityMonthsOf` renamed to the
  system's own `monthKeysBetween` (its declaration and its one call), so §5
  item 1 reads 0.
- Import lines only (G-2, the five dictionaries' new home):
  `sweep-`, `continue-`, `start-policy-recompute.pipeline.spec.ts`,
  `project-client-stats.pipeline.spec.ts`, `rebuild-capacity.pipeline.spec.ts`,
  `triggers.wire.spec.ts`, `rebuild-capacity.integration.spec.ts`,
  `project-client-stats.integration.spec.ts`.
- New cases only: `coupon-value.data.spec.ts` (G-1), `booking-words.spec.ts`
  (`SEAT_ARRANGEMENT_WORDS`); new type-spec lines only:
  `loyalty-dictionaries.type-spec.ts` (`StreakPublishConsent`, W0-E's note),
  `stats-ops-dictionaries.type-spec.ts` (G-2).
- `schedule-blocks.pipeline.spec.ts` (a NEW wave-0 file) — its helper's
  parameter `hours` → `hour`: the runbook's §4.2/§4.5 "removed document keys"
  gate matched the fixed string `hours:` (the second round's only grep-gate
  failure).

### 9.3 Gate record

Static gate on the wave-2 tree (2026-10-24), §6.2 lines 1–9:
`nx sync:check` up to date; `verify-tools:layering` OK; typecheck after
`rm -rf dist/out-tsc` with `--skip-nx-cache` — only `patterns` (the
baseline `findLast`); lint 43 projects, 0 errors; test 43 projects
**11,824 passed + exactly the 6 baseline reds** (a mis-sum: the run's log
sums to 11,885 — §9.1.2) (`gauge.spec.ts` 4,
`visit-pills.spec.ts` 1, `visits-page.presenter.spec.ts` "strikes an hour
that did not happen" 1); `ecs-core --coverage` 289 files, 5,622 tests,
**98.20 %** statements (≥ 98.00 %); `seed-tools` typecheck; `lint-rules`
13 files 290 tests; `lint:styles`; `build web` initial **599.95 kB**
(+2.02 kB on pass B's 597.93 kB — the new ecs-core members the initial
chunk's features call; under the ~+3 kB line; the `gauge.css` budget warning is
`libs/ui`'s, untouched by pass C) + `verify:bundle` OK; `build functions` + the
deps check (the same four runtime dependencies). **Not run by G** (the
brief keeps them for the orchestrator/fixer): the runbook grep gates,
`verify:p0`, `test:emulator`, `e2e:web`.

**The FULL gate on the closed tree (the integrator's second round,
2026-10-24), one command at a time:** `nx sync:check` up to date;
`verify-tools:layering` OK (703 files, 3,304 import edges in
`libs/ecs-core/src`); typecheck after `rm -rf dist/out-tsc` with
`--skip-nx-cache` — only `patterns` (the baseline `findLast`); lint 43
projects, 0 errors; test 42 runs **11,883 passed + exactly the 6 baseline
reds**; `ecs-core --coverage` 289 files, 5,628 tests, **98.21 %**
statements (13,766/14,016); `seed-tools` typecheck; `lint-rules` 13 files,
290 tests; `build web` initial **599.95 kB** (162.41 kB transfer; the same
`gauge.css` budget warning) + `verify:bundle` OK; `build functions` + the
deps check (the same four runtime dependencies); the runbook grep gates
§4.0 + §4.2 **28** `ok`, §4.3 **22**, §4.4 **17**, §4.5 **6**, §4.7 **24**,
§4.8 **27**, §4.9 **25**, 0 FAIL (the first run caught `hours:` in a new
spec helper, §9.2; no canary left behind); `verify:p0` (a)–(f) pass;
`test:emulator` **65 + 253** (pass B's record — the impersonation adapter's
integration spec went with pass B); `e2e:web` **41 passed + exactly the 19
baseline failures** (6 `*-screenshots`, `landing.spec.ts:121`, 12
`client-card-glance.spec.ts` runs of `:343`/`:686` failing at
`:384`/`:765`) — no flake to re-run.

One integrator ruling was needed for the gate: the wave-0/wave-1 seam
`AttachVisitPhotoCommand.width`/`height` were typed `number` while the
store hands the downscaler's `number | null` (the record has always stored
`null` for an unreadable size — `st:1506` on `2bd2354`); the command now
types them `number | null` (`attach-visit-photo.pipeline.ts`, a type-only
widening; behaviour identical).

### 9.4 DOM differential record (§6.3)

14 projects on both trees (base `git archive 2bd2354`, the integrated tree),
the wrapper-config method of §6.3; every base and integrated spec run green
but the two baseline reds inside these projects (`visit-pills`,
`visits-page.presenter`), identical on both sides. **59 spec files, 1,196
captured tests: 4 changed, 9 new (DEP-only), 0 base-only.**

| Test                                                                                                                             | Difference                                    | Ruling                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staff-dashboard.spec.ts` › reads a chair by its own seats' outcomes once all of them are resolved                               | head `cancelledByStaff` → `cancelledByClient` | DEP-1 (`:2191`, §4.3) — allowed                                                                                                                                                    |
| `booking-services-step.spec.ts` › skips the variant select entirely when the service declares none                               | «Добави» `13,00 €` → `13,00 € – 14,50 €`      | DEP-9's CTA — allowed: the fixture publishes no barber VMs, so every performer of `beard` is off the active list (the DEP's exact case); the plan expected it only in the new case |
| `booking-services-step.spec.ts` › the bag › reopens a line in the full sheet, scoped to the person who holds it                  | the same CTA difference                       | DEP-9 — allowed (same cause)                                                                                                                                                       |
| `staff-visit-editor.spec.ts` › the draft › survives a new VM for the same appointment                                            | a frame neighbour LOSES `data-past`           | **REGRESSION (E-13), OPEN** — see below                                                                                                                                            |
| 9 new tests (6 dashboard DEP-1…DEP-5 cases, the editor's frame-verdict case, the DEP-8 onboarding case, the DEP-9 services case) | absent on base                                | DEP-only — allowed                                                                                                                                                                 |

**The E-13 regression.** `2bd2354` marks a frame neighbour past when
`draft.dayKey < vm.todayKey || (vm.nowMinute !== null && neighbour.endMinute
<= vm.nowMinute)` — the neighbours and the clock are the SEEDED day's (§8
OQ-9). W1-S2 calls `VisitStorySystem.hasEnded({ localDate: draft.dayKey,
minute }, now)`, which puts the seeded day's neighbours on the DRAFT's day:
after a re-date to tomorrow a neighbour that ended before now stops being
past (and the grid's drag guards read `past`). The exact port keeps the
system call and the seeded day: `past = dayGone || (now !== null &&
end.ok && VisitStorySystem.hasEnded({ localDate: <vm.dayKey parsed>,
minute: end.value }, now))` with `dayGone = draft.dayKey < vm.todayKey` —
equal to the base on every input (`vm.nowMinute` is non-null only when
`vm.dayKey` is today). Not edited by G (W1-S2's file; §9.6).

DEP-4's `staff-block-lift` row, DEP-5's «Скорошни» rows and DEP-8's card meta
show only in their new tests; DEP-10's capsule shows nowhere because C-6
never landed (§9.6).

**Re-run on the closed tree (the integrator's second round).** A fresh
`git archive 2bd2354` under the scratchpad's `c-diff/base` (node_modules
symlinked), the same capture and normalisation, the 14 projects on both
trees: every run green but the same two baseline reds on both sides
(`visits-page.presenter`, `visit-pills`). **59 spec files, 1,197 captured
tests: 3 changed, 10 new (DEP-only), 0 base-only** — DEP-1's head
(`staff-dashboard.spec.ts` › reads a chair by its own seats' outcomes…),
DEP-9's CTA twice (`booking-services-step.spec.ts`, the two tests above);
the new tests are the first round's nine plus the sheet's DEP-10 case. The
E-13 regression is GONE: `staff-visit-editor.spec.ts` › the draft ›
survives a new VM for the same appointment renders byte-identically to
`2bd2354` (the neighbour keeps `data-past`). The service sheet's own tests
(the accent-law capsule «Спестяваш 5,00 €», the members, the performer
cards) and every host that renders it (landing, booking, onboarding)
render identically: C-4's and C-6's sheet port changes no DOM but the
DEP-10 case. DEP-15 (a roster window closing at midnight) is in no spec on
either side.

### 9.5 Smoke record (§6.4)

The first round deferred it (both open items changed smoke screens). **Run
by the integrator's second round on the closed tree, after the emulator
journeys:** `pnpm run dev` (the four emulators, `seed:dev`, the web on
:4200) served the integrated tree, and the `git archive` copy of `2bd2354`
(`c-diff/base`, node_modules symlinked) was served on :4300 against the
same emulators and seed. A Playwright script in the scratchpad
(`c-smoke/smoke.mjs` + `landing.mjs`, node_modules symlinked) drove both,
reading only, with custom tokens minted as the e2e harness mints them
(`window.__e2eSignIn`: `dev-client-1` as client, `dev-staff-ivan` as barber

- admin), and wrote a DOM signature per screen (every element, every
  attribute but Angular's generated ones, ids, inline styles and URLs, and
  all text) in bg, then en. **64 screens per language, 128 signatures per
  side:** the landing's `main` (the locations' status lines, week tables and
  `tel:` links, the shelf, the team), the service detail sheet for all eight
  shelf services (performer cards in price order, duration, «от» price, the
  Full-care bundle's «Спестяваш 1,50 €» — C-4/C-6 on the stored entities),
  the team's barber sheet (the barber's prices), `/book`'s services step;
  `/account` and `/account/appointments`; on the staff side the day,
  three-day, week and agenda views (lanes incl. the off chair, closed
  shading, the day summary and tips line, live/next cards), the visit sheet
  of every agenda row (nine chairs: confirmed, completed, no-show, a guest's
  — verbs, the resolution head, the frame and its neighbours, the money
  rows), the create sheet and the block sheet; for Георги and Мартин the
  client card, wallet, ledger, medals, records, eight medal details, the
  season and one family, the history page and its filter menu; and
  `/admin/loyalty/rhythm`. **Result: 94 byte-identical; 22 differ only by the
  clock between the two runs (the now-label minute and `data-near-now`, the
  relative glosses «преди/след N …», the agenda's live/next flip of the 15:15
  visit, the create sheet's drafted start and its overlap note — the
  now-side ran at 14:53, the 2bd2354 side at 15:14); 12 differ by DEP-2 —
  the visit sheets of six chairs (bg + en) no longer draw or narrate a
  settled neighbour: Георги Петров's COMPLETED 10:00–10:45 visit on Ivan's
  chair and Кирил Тодоров's NO_SHOW 11:00–11:30 on Stefan's, so the frame's
  `neighbour-N` ids renumber and its aria summary drops them; nothing else.**
  The create and block sheets list the same neighbours on both sides (they
  always took live visits only). The console sets match but one more
  «Transition was skipped» on one side (navigation timing). Not smoked:
  writes of any kind (DEP-3's receipt, DEP-4's whole-day lift, a save), a
  re-dated draft (E-13 is pinned by the §6.3 re-run), DEP-5 (no
  companion-first party in the seed), DEP-15 (no roster closing at midnight
  in the seed), onboarding's service grid (a registration write; DEP-8 is
  pinned by its new spec case). The dev stack and the :4300 server were
  stopped afterwards; the emulators keep no data (no import/export), so the
  seed state is the committed seed's and every port is free.

### 9.6 Carried forward (to HANDOFF §3.3)

**The first round's two OPEN items — CLOSED by the integrator's second
round:** (1) E-13 — the frame's neighbours are measured on the frame's clock
day (`frameColumns`: a gone draft day, or `VisitStorySystem.hasEnded` on
today's date, since a frame carries a clock only for today — §8 OQ-9), equal
to `2bd2354` on every input and byte-identical in the §6.3 re-run; (2) C-4's
sheet half and C-6 (DEP-10) — `ServiceDetailSheetComponent` reads the stored
`Service` (`CatalogContentService.findService`) and asks
`CatalogPricingSystem.performersByPrice` / `bundleSaving`, prints the saved
cents through `CatalogWording.priceCents` (`formatPriceCents`), and the
presenter's anonymous offering is deleted (C-37).

KEEP-PARKED (confirmed by §5 item 9 — 0 production callers each), owner
call to delete: `AppointmentLifecycleSystem.confirm` / `complete` /
`markNoShow` / `cancel` / `reopenNoShow` / `reopenSettled` /
`markSeatOutcome` (entity write verbs; the browser calls the callable),
`VoucherSystem.redeem` (the editor previews with `coverage`/`cascade`, the
server settles with `settle`), `IntervalSetSystem.clip` (`proportionalBox`
stays, D-3).

Carried:

- The system-file dictionary family (`CancelledSide`, `VisitRowOutcome`,
  `VisitTone`, `BillPending`, `TipPreset`, `LedgerVerdict`, …) →
  components (D-7 exception). (The five pipeline-tier outcome dictionaries
  moved to components in the second round, G-2.)
- OQ-14's instant answers on the dashboard (S-12, S-14…S-16, S-20's order)
  and the instant-measured durations.
- The client-option VM's optional `email?` (E-22, D-11) and the rest of
  D-11's pass-D list (OQ-12).
- `actFromSheet`'s sheet dismissal on CANCELLED ∨ NO_SHOW — the set is
  `BookingLifecycle.didNotHappen`; wire it in the next staff-day pass (UI
  read-state today, §5 item 4).
- §8's open questions OQ-1…OQ-14 with their defaults as applied.
- `catalog.presenter.ts` `formatPrice` and per-call `Intl` builders
  (finding 75, D-3) — `formatPriceCents` (the sheet's saving) rides on it.
- From the package notes, none a decision left in a feature: the team note's
  record `{ id, text, authorUserId, writtenAtUtcMs }` is built by both
  `appendTeamNote` and the store's `saveTeamNote` (Y-11 kept the save in the
  store) — one builder once the save use case moves (pass D, W0-V);
  `VoucherCode.distinct` answers a repeated code as
  `ENGAGEMENT_VOUCHER_CODE_INVALID` — a dedicated duplicate code is the
  errors tier's call (no callable answer changes: the wire answers field
  `codes`, W0-B); `BookingFlowState.isTerminal` (component, the explicit
  pair) and `BookingFlowSystem.isTerminal` (the spine) are two spellings of
  one rule, and making the component's a type guard deletes the flow
  store's `isOpen` narrowing delegate (W1-B); the editor's `shopNowAt` fills
  `ShopNow.utcEpochMs` from `CLOCK_PORTS` inside a `computed()` (never read
  by `hasStarted`/`hasEnded`) — the VM should carry the store's `ShopNow`
  (pass D's VM reshape, W1-S2); `ShopDayFrame` stays in
  `booking-read-set.pipeline.ts` (P-17 not moved: `frameShopDay` answers the
  instant only, W0-P1); `day-availability.spec.ts` and
  `rhythm-service-groups.spec.ts` keep exercising the moved ecs-core names
  through spec-local aliases (their subject files are deleted; their cases
  are restated in `shop-day.pipeline.spec.ts` / `catalog.system.spec.ts`)
  — fold or delete them in a spec-tidy pass (W1-R); the dashboard spec's
  local `HeldGrant` interface could import `@core/systems`' (W0-B);
  `GridLayoutSystem.closedRuns` works on `MinuteRun` (ends stop at 1440) —
  a timeline host feeding anchored ends past midnight would need a
  `TrackSpan` variant (Y-16 residual, W1-S1).

**Behaviour notes the packages recorded — identical on every reachable
input (no DEP):** `writeScheduleBlocks` builds each day's identity
(`ZonedTimeSystem.startOfLocalDay`) also for a day kept as stored — pure and
total for a valid zone (W0-G); `placementSliceOf` brands the floor with
`DurationMinutes.of`, so a NaN/Infinity floor reads no verdict — every host
passes 5 or 10 (W1-S1); `appendTeamNote` reads the author before the note
(W1-S1/W0-V) and the adopted photo document's key order follows the shared
record builder (a Firestore map has no order); the editor's `promiseOf`
defects on a drafted line whose value cannot parse back, `exits` returns `[]`
for a non-new visit with no status, `frameVerdict` gives no OUTSIDE when the
roster window is not one day's range, `figureRead` refuses > 100 (the field
caps at the keystroke), `lastVisitDate` orders by `utcEpochMs` (DEP-11)
(W1-S2); `nextOpenStep` answers `'avatar'` while the completion loads — its
only reader renders inside `@if (identity.completion())` (W1-C, C-34);
`BillingSystem.subtotalOf` clamps a non-safe-integer sum to zero (W1-C,
C-24); the client card parses the host's raw `appointmentId` with
`AppointmentId.parse` — a string it refuses can equal no stored id (W1-K,
K-3); the rhythm withdrawal's head reuses the stored CURRENT element instead
of a re-normalised copy, deep-equal for every head the publish pipeline or
the seed writes (W1-R, R-6); the TTL adapter's instant fields parse through
`UtcEpochMs.of`, so a fractional or out-of-range stored instant no longer
stamps (every writer stores `nowUtcMs()`; before, a fractional one stamped
and an out-of-range one threw) (W1-F, P-34); `MoveSystem.clientMove`'s
`windowClosed` is FALSE on a NaN start, exactly as today (W0-D — §1's
wording corrected).

---

### 9.7 Review round — the fixer (2026-10-24)

The review of the closed tree confirmed twelve findings (two of them one
defect, F-4 = F-10); the fixer applied every one, with the reviewers'
corrected fixes. No new DEPARTURE: F-8 AMENDS DEP-2 (the one place two live
rules still decided one question — see DEP-2); every other fix is
behaviour-identical, its spec cases pinning the old answers.

| F         | Finding                                                                                                                              | System function (new or changed)                                                                                                                                                                          | Callers re-pointed                                                                                                                                                                                                                                                                                                                                      | Copy deleted                                                                                   | Spec cases                                                                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1       | the barber-day assembly's offered-shop filter in three places (P-28, Y-6)                                                            | `RosterSystem.offeredWindows` / `offeredCarveOuts` (the private `offersShop` and its "absent shop reads as no bound" comment moved from `booking-cart.system.ts`)                                         | `BookingCartSystem.barberDays` (keeps `windowsAt` and the paired busy), `match-waitlist` `loadDay`, `staff-day.store` `laneGeometryOf`                                                                                                                                                                                                                  | the `listedShops` array and loop, both `offered` Set `.filter`s, `booking-cart`'s `offersShop` | `roster.system.spec.ts` +5 (lane-geometry.spec.ts:48's three shops, the carve-out at a hidden shop, every shop offered, `[]` = not on the day, purity); `lane-geometry.spec.ts`, the match-waitlist and booking-cart specs unchanged                                      |
| F-2       | C-28 forged a `SectionRow` (`sectionKey: ''`, `upcoming: true`) to reuse `upcomingSoonestFirst`                                      | `VisitListSystem.soonestFirstByStart` (stable, day then minute; `byStart` widened to the wall-clock slice)                                                                                                | `client-account.ts` next visit                                                                                                                                                                                                                                                                                                                          | the forged row                                                                                 | `visit-list.system.spec.ts` +4 (order, tie keeps input order, empty, purity)                                                                                                                                                                                              |
| F-3       | the one-grain floor copied at four call sites                                                                                        | `VisitDraftSystem.floorSpan` (no snap) and `typedSpan` (`floorSpan(snap(typed))`); `editorSpan`, `overrideFor`, `spanToEnd` compose them                                                                  | the editor's `onFrameDraft` (`floorSpan`), `commitDuration` and `typeDuration` (`typedSpan` — at ≥ 10 typed minutes the floor never bites, so it is the old snap alone), the dashboard's `rebookFromEditor` and `draftVisitOn` (`floorSpan`)                                                                                                            | the four inline `Math.max(GRAIN, …)`                                                           | `visit-draft.system.spec.ts` +5 (0, 2, 3, 5, 7, −15, past-midnight span; typed 0/2/3/5/7/7.5→10/8/−7/−30/47/2000; a property ≥ 3; the span rules compose them; purity)                                                                                                    |
| F-4, F-10 | `rhythm-publish` compared `effectiveFromLocalDate > today` inline (R-5)                                                              | `StreakPublishSystem.waits(version, today)` — `headAfter`'s `waits`                                                                                                                                       | `publishRhythmDraft`                                                                                                                                                                                                                                                                                                                                    | the inline comparison                                                                          | `streak-publish.system.spec.ts` +3 (yesterday/today false, tomorrow true; equals `headAfter`'s; purity)                                                                                                                                                                   |
| F-5       | the wire's `CallStateWord` hand-copied `ArrivalVerb`'s values                                                                        | —                                                                                                                                                                                                         | `booking.wire.ts` `CallStateWord.Arrived`/`Unarrived` = `ArrivalVerb.*` (`Resolved` stays the wire's)                                                                                                                                                                                                                                                   | the two literals                                                                               | none (values unchanged; `booking.wire.spec.ts` unchanged)                                                                                                                                                                                                                 |
| F-6       | `exitVerbs` took `settled`/`gone` derived from its own `chairStatus` (E-26)                                                          | `AppointmentLifecycleSystem.exitVerbs(chairStatus, offered, started)` — rebook = `BookingLifecycle.isSettled ∧ ¬didNotHappen` (the edit lock's predicate) of the chair                                    | the editor's `exits` (its `settled`/`gone` computeds stay for the head and the row locks)                                                                                                                                                                                                                                                               | the two parameters                                                                             | `appointment-lifecycle.system.spec.ts`: the rebook cases now driven by `chairStatus` (COMPLETED rebooks; CANCELLED, NO_SHOW, CONFIRMED, PENDING do not, started or not), the status × started table, the purity call — same answers for every reachable input             |
| F-7       | the dashboard sorted the window newest-first before `bookAccounts` (S-20)                                                            | `ClientQuerySystem.bookAccounts<V extends BookVisit>(visits)` sorts a copy by `UtcEpochMs.compare` (stable) itself; `BookVisit = AccountVisit & { utcEpochMs }`                                           | `staff-dashboard.ts` hands `store.window()` unsorted                                                                                                                                                                                                                                                                                                    | the component's sort                                                                           | `client-query.system.spec.ts` +2 (a shuffled window still files the newest named visit; equal instants keep input order); the old "keeps the order handed in" case retitled "at one instant" (its fixtures share one instant), body unchanged                             |
| F-8       | DEP-2 still two rules (chair summary vs root) and the selection copied at five sites                                                 | `BusySystem.chairOccupants(appointments, barberId, excludeId)` → `{ appointment, seat }[]`                                                                                                                | all five neighbour sources (`occupantNeighbours` for the probe's documents, `occupyingRows` for the agenda's rows over the store lane's documents)                                                                                                                                                                                                      | the five inline filters                                                                        | `busy.system.spec.ts` +5; `staff-dashboard.spec.ts` split-party case flipped on purpose (DEP-2)                                                                                                                                                                           |
| F-9       | the visit sheet re-declared `FrameVerdict` (CONFLICT/OUTSIDE_ROSTER) beside `PlacementVerdict` and decided the verdict inline (E-12) | `GridLayoutSystem.frameVerdict(block, neighbours, shift)` — `placementVerdict`'s overlap and containment on raw track minutes, no SHORT, no OUTSIDE against an unreadable shift                           | the editor's `frameVerdict` (it keeps reading the SEEDED day's neighbours and roster, §8 OQ-9; `readableShiftOf` is its edge parse of the roster pair — `shiftOf` ∧ `MinuteOfDay`/`EndMinute`, the old `dayRangeOf` rule); the template narrows on `PlacementVerdict`; `data-verdict` still prints `conflict`/`outsideRoster` (`placementVerdictWords`) | `FrameVerdict`, `frameVerdictWords`, `dayRangeOf`, the inline `MinuteRange` overlap/contains   | `grid-layout.system.spec.ts` +8 (incl. a property: the system ≡ the old editor body, verbatim, for every day-range neighbour and shift); `staff-visit-editor.spec.ts` +1 (a clash wins over leaving the shift)                                                            |
| F-11      | `dayBookable` took a raw `number` for `CapacityEntry.freeMinutes`                                                                    | `AvailabilitySystem.dayBookable(…, freeMinutes: MinuteCount)` vs `MinuteCount.ZERO`                                                                                                                       | the schedule step's `capacityByDay` keeps `ReadonlyMap<LocalDate, MinuteCount>`; `AvailabilityDayCell.freeMinutes: MinuteCount` (`?? MinuteCount.ZERO`)                                                                                                                                                                                                 | —                                                                                              | `availability.system.spec.ts` `dayBookable` block: figures through `minuteCount()`/`MinuteCount.ZERO`                                                                                                                                                                     |
| F-12      | the grain API raw both ways                                                                                                          | `snap`/`snapUp(minute: MinuteOfDay): number` (track minute out), `typedStart`/`typedEnd(range: TrackSpan, minute: MinuteOfDay): TrackSpan` — the R-6 track exception documented on the functions (§7 R-6) | the block editor's `parseClock` answers `MinuteOfDay` (`MinuteOfDay.of`, the same `[0, 1440)` it checked); the editor's `commitStart` parses with `startMinuteOf`; the dashboard's `nowSnapped` with `MinuteOfDay.ofProven`                                                                                                                             | `DraftMinutePair` (the pair is `grid-layout`'s `TrackSpan`)                                    | `visit-draft.system.spec.ts`: the snaps take `minute(…)` (1437/1438/1439 and 1435/1436/1439 pinned; the property over `[0, 1439]` also bounds both in `[0, 1440]`), the typed pair +1 (23:58/23:59 → 1440–1445, 23:50 kept under a 1440 end; a typed end of 23:59 → 1440) |

Not taken, by the corrected fixes' own leave: F-1's optional
`CartBarberDay | null` helper (windows + `paddedBusy`) — the waitlist match
loads the busy day only for the barbers `offeredWindows` keeps, between the
two steps, so each caller still reads "not on the day" off the returned
array's length; F-12's `snapSpan` — `typedSpan` covers both typed-duration
sites (F-3), so no third grain function was added.

Spec cases: **+34** (`it` blocks: +33 in ecs-core, +1 in the editor spec);
spec edits beyond new cases: the DEP-2 flip (above), F-6's rebook cases
(re-driven by the status, same answers), F-7's retitle, F-11's branded
figures, F-12's `minute(…)` arguments — every expectation VALUE that was
pinned before is pinned still, except DEP-2's split-party case, flipped on
purpose. §5 items 2/3/4 re-run: **65 / 20 / 24** hits (was 67 / 21 / 24 —
the commit-duration `Math.max(…`, the verdict's `Math.min(end …`, and the
book's sort are gone), the rest as ruled in §9.1.1.

**Gate (the fixer, on the reviewed tree, one command at a time):**
`nx sync:check` up to date; `verify-tools:layering` OK (703 files, 3,305
import edges); typecheck after `rm -rf dist/out-tsc` with `--skip-nx-cache`
— only `patterns` (the baseline `findLast`); lint 43 projects, 0 errors;
test **11,917 passed + exactly the 6 baseline reds** (+34 on 11,883);
`ecs-core --coverage` 289 files, **5,661 tests, 98.21 %** statements
(13,791/14,042); `seed-tools` typecheck; `lint-rules` 13 files, 290 tests;
`lint:styles`; `build web` initial **599.95 kB** (162.39 kB transfer; the
same `gauge.css` budget warning) + `verify:bundle` OK; `build functions` +
the deps check (the same four runtime dependencies); the runbook grep gates
§4.0 + §4.2 **28** `ok`, §4.3 **22**, §4.4 **17**, §4.5 **6**, §4.7 **24**,
§4.8 **27**, §4.9 **25**, 0 FAIL, no canary left behind; `verify:p0`
(a)–(f) pass; `test:emulator` **65 + 253**; `e2e:web` **41 passed +
exactly the 19 baseline failures** (6 `*-screenshots`, `landing.spec.ts:121`,
12 `client-card-glance.spec.ts` runs failing at `:384`/`:765`) — no flake.
The §6.3 DOM differential and the §6.4 smoke were not re-run by the fixer:
the only DOM-visible change is DEP-2's amendment (a split party's chair
whose own seats are settled inside a live root, on the anchor day and the
create and block frames of the shown day).

### 9.8 Review round 2 — the fixer (2026-10-24)

A second review of the reviewed tree confirmed three findings (R2-1 minor,
R2-2 debt, R2-3 minor); the fixer applied each with its corrected fix. No
DEPARTURE: every answer, document and DOM is unchanged.

| F    | Finding                                                                                                                                                                                            | System / pipeline (new or changed)                                                                                                                                                                                       | Callers re-pointed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Copy deleted                                                                                                                             | Spec cases                                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-1 | the transition callable's decoder hand-listed the four statuses the shop may name (`STAFF_TRANSITIONS`, "every status but PENDING") — a dictionary copy at the edge                                | `BookingLifecycle.isTransitionTarget(raw: unknown): raw is BookingStatus` over a module-level `TRANSITION_TARGETS`, the deduplicated destinations of the `TRANSITIONS` graph (`targetsOf`) — computed, never hand-listed | `booking.wire.ts` `decodeTransition`: `BookingLifecycle.isTransitionTarget(raw) ? raw : null` (a PENDING request still answers `BOOKING_TRANSITION_INVALID_INPUT`, `booking.wire.spec.ts:690` unchanged)                                                                                                                                                                                                                                                                                                                                                                                               | `STAFF_TRANSITIONS`                                                                                                                      | `booking-lifecycle.data.spec.ts` +5 (the four targets true; PENDING false; `'cancelled'`, `''`, `null`, `undefined`, `3`, an object false; ≡ "reachable by `canTransition` from some state" for every status; purity) |
| R2-2 | two components (`booking-schedule-step.ts`, `booking-time-sheet.ts`) consumed `@core/pipelines`' `observeDayDocs` / `observeCapacityEntries`, and the contact sheet its `saveOwnProfile` (Law 8.2) | —                                                                                                                                                                                                                        | `BookingDayStore` (`schedule-step/booking-day.store.ts`, provided by `ClientBooking` beside `BookingFlowStore`): `capacityEntries(months)`, `dayDocs(key)`, `daysDocs(keys)` — `toSignal(toObservable(…))` with the SAME structural `distinctUntilChanged` and `switchMap` rules, called from the components' field initializers (their injection context, so the listeners still live and die with the component); `BookingContactStore` (`contact-sheet/booking-contact.store.ts`, provided by `BookingContactSheet`): `writeProfileName(contact)` — the sheet's former `writeProfile` body verbatim | the three components' stream pipes and their `@core/pipelines` imports; the sheet's `writeProfile`, `GATEWAY_PORTS` injection            | none (wiring only: `ClientBooking` mounts both specs' components with its providers; the contact-sheet spec's `AccountStateService` / `GATEWAY_PORTS` doubles reach the sheet-provided store unchanged)               |
| R2-3 | `saveOwnProfile` took its ports as a first parameter, not a closure (Law 4)                                                                                                                        | `saveOwnProfile = (ports: SaveOwnProfilePorts) => async (edits) => …` (same body; the JSDoc paragraph justifying the old shape deleted)                                                                                  | `profile.store.ts` and `onboarding-flow.store.ts` import it from `@core/pipelines` and call `saveOwnProfile(this.gateway)(edits)`; `BookingContactStore` builds the closure once as a field                                                                                                                                                                                                                                                                                                                                                                                                            | `own-profile.ts`'s `export { saveOwnProfile } from '@core/pipelines'` (D-9's re-export — its reason, the first-parameter shape, is gone) | `save-own-profile.pipeline.spec.ts`: `saveOwnProfile(gateway)(EDITS)` at its four call lines (wiring only; every expectation unchanged)                                                                               |

Re-runnable checks: `grep -rn "STAFF_TRANSITIONS" apps libs` → 0;
`grep -rln "@core/pipelines" libs/features apps/web` minus specs → stores,
`admin-rhythm.preview.ts`, `app.config.ts`, `guards/session.ts` — no
`@Component` file; `grep -rn "saveOwnProfile" libs/features/client/account-state/src/lib/*.ts`
→ the spec's comment only. §5 items 2/3/4/5 re-run: **65 / 20 / 24 / 0**
(unchanged).

**Gate (the fixer, one command at a time):** `nx sync:check` up to date;
`verify-tools:layering` OK (703 files, 3,305 import edges — unchanged);
typecheck after `rm -rf dist/out-tsc` with `--skip-nx-cache` — only
`patterns` (the baseline `findLast`); lint 43 projects, 0 errors; test
**11,922 passed + exactly the 6 baseline reds** (+5 on 11,917);
`ecs-core --coverage` 289 files, **5,666 tests, 98.22 %** statements
(13,806/14,056); `seed-tools` typecheck; `lint-rules` 13 files, 290 tests;
`lint:styles`; `build web` initial **600.15 kB** (162.49 kB transfer, +0.20
kB: the lifecycle guard in the components tier; the same `gauge.css` budget
warning) + `verify:bundle` OK; `build functions` + the deps check (the same
four runtime dependencies); the runbook grep gates §4.0 + §4.2 **28** `ok`,
§4.3 **22**, §4.4 **17**, §4.5 **6**, §4.7 **24**, §4.8 **27**, §4.9 **25**,
0 FAIL, no canary left behind; `verify:p0` (a)–(f) pass; `test:emulator`
**65 + 253**; `e2e:web` **41 passed + exactly the 19 baseline failures**
(6 `*-screenshots`, `landing.spec.ts:121`, 12 `client-card-glance.spec.ts`
runs failing at `:384`/`:765`) — no flake. The §6.3 differential and the
§6.4 smoke were not re-run: no change is DOM-visible.

## DEPARTURES

Each is the D-12 exception: two live rules for one decision today; one
survives.

**DEP-1 — who cancelled (the visit sheet's resolution head).**
_Before:_ `sd:3365` `resolutionOf` reads `'client'` only when EVERY
cancelled seat on the chair has `cancelledBy === CLIENT`, else `'staff'`.
_After:_ `VisitStorySystem.chairResolution` → `rootStory(CANCELLED,
chairSeats).cancelledBy`: the side of the LAST-cancelled seat by
`ClientStatsSystem.clientCaused` — the reason first (`CLIENT_CHANGED_PLANS`/
`CLIENT_UNWELL` → client; `STAFF_BARBER_ABSENCE`/`STAFF_SHOP_CLOSURE` → shop;
`NO_SHOW_CONVERTED` → shop), then `UNSPECIFIED`/`OTHER` by `cancelledBy`.
_Evidence:_ the card's visit rows word `CancelledSide` with the same
«Отказан от клиента / от салона» (`visit-row.presenter.ts:220`, spec
`:1048-1052`), and the statistics (R33) count by it; a desk-filed
`CLIENT_UNWELL` cancel reads «от клиента» on the card and «от салона» on the
sheet today. The 2026-09-11 owner ask was only to SHOW the resolution.
The every-seat rule IS written down on purpose — `resolutionOf`'s own
docblock (`sd:3352-3362`): "a cancellation is the client's act only when
every seat says so" — but that docblock is the implementer's, not an owner
ruling (the owner quote it cites is about showing the head), it predates
the card's `CancelledSide` and the R33 statistics, and both surfaces print
the SAME words («Отказан от клиента / от салона», `staff.visit.resolution.
cancelledByClient`/`cancelledByStaff` ↔ the card's `cancelledBy`), so they
answer one question. The alternative — typing the sheet's side as the
stored actor `CancelledBy` and keeping the every-seat rule — would leave the
card and the sheet printing different answers under the same words.
_Survives:_ the system rule. _Affected:_ the sheet head's words and tone on
(a) a cancelled chair whose reason and `cancelledBy` disagree, and (b) a
chair whose seats were cancelled by DIFFERENT actors: today always «от
салона» (not every seat says CLIENT); after, `clientCaused` of the
LAST-cancelled seat (reason first, its actor only for UNSPECIFIED/OTHER) —
e.g. client first, then staff with UNSPECIFIED → «от салона» (unchanged);
staff first, then client with UNSPECIFIED → «от клиента» (changed). _Specs:_
`staff-dashboard.spec.ts:2191` flips; the editor fixtures of §4.3 rename
values; a NEW mixed-actor case (both orders) is added (§4.3). §8 OQ-1.

**DEP-2 — what occupies the chair for a placement** (amended by the
review round, §9.7 F-8). _Before (`2bd2354`), five sources, three rules:_
the visit sheet's anchor day (`sd:4067-4080`, the agenda's `DayRowVm` rows)
took EVERY other visit row — completed, no-show, cancelled; its stepped day
or chair (`sd:3968-3982`, the probe's appointments) took every other
appointment's seats in the chair, whatever the root's status; the create
sheet (`sd:5453-5463`) and the block sheet's shown day (`sd:6193-6212`) took
the rows whose CHAIR status is live (`!entry.terminal` over the chair's
`SeatOutcome.summarize`); the block sheet's other day (`sd:6211`) took the
seats of appointments whose ROOT is live. The editor's `frameVerdict` raises
«Застъпва се с …» against whatever it is handed. _First round:_ all five
filtered on `BookingLifecycle.isLive`, but the three row sources read the
chair's summary and the two appointment sources the root — still two rules
(a split party whose chair is all cancelled inside a live root was dropped
on the anchor day and the create frame and kept on a stepped day).
_After (the review round):_ ONE rule, the server's, homed once as
`BusySystem.chairOccupants(appointments, barberId, excludeId)` — every seat
the barber holds on an appointment whose ROOT is live, other than the visit
on the sheet — and called by all five sources: the two appointment sources
directly (`occupantNeighbours`, one neighbour per seat, as before); the
three row sources over the store lane's appointments the rows were drawn
from (`occupyingRows`: the agenda's visit rows whose appointment occupies,
one neighbour per row, as before — the drawn shapes and words unchanged).
_Evidence:_ the server refuses a staff save on overlap only against the busy
projection, which keeps every seat of a live ROOT, whatever the seat's own
outcome (`BusySystem.rebuild`, `busy.system.ts:209`;
`edit-appointment.pipeline.ts:1043-1072`); the owner-era block rule says a
cancelled or no-showed seat is stranded by nothing (83bcf21);
`GridLayoutSystem.occupiedIntervals` answers a different question (the
idle-gap record) and adopting it would ADD completed and no-show neighbours
to the create and block sheets. _Survives:_ the server's collision rule.
_Affected, against `2bd2354`:_ the existing-visit sheet (anchor and stepped
day) stops drawing and warning against a visit whose ROOT is settled
(completed, no-show, cancelled), and its aria frame summary loses it; on
the create sheet and the block sheet's shown day, a split party's chair
whose own seats are all settled inside a LIVE root is now drawn (and warned
against, on the create sheet) — the busy projection counts it, so the
server would refuse the overlap — and a chair whose summary still reads
live inside a settled root stops being drawn (the projection frees it);
the block sheet's other day is unchanged.
_Specs:_ `staff-dashboard.spec.ts` "draws no settled visit around the
block, and warns of no overlap with one (DEP-2)" (first round, unchanged);
the split-party case flipped on purpose — it read "by its own status on the
shown day, and by the root on a stepped one" and now asserts the chair is
kept on the anchor day, the stepped day, the create frame and the block
frame alike; `busy.system.spec.ts` `chairOccupants` (5 cases: root-live
seats, settled roots dropped, the split party kept — and `rebuild` counts
it — self excluded, purity). §8 OQ-2.

**DEP-3 — the save receipt's «Отмени» after a seat was added.** _Before:_
`reversibleSave` keys on the CHAIR's summarized status (`row.bookingStatus`
= COMPLETED). _After:_ on the ROOT appointment's `bookingStatus`
(`AppointmentEditSystem.undoable`). _Evidence:_ the server marks an added
seat WORKED — so its removal is refused — iff the ROOT is COMPLETED
(`appointment-edit.system.ts:381`; RemoveSeat refuses a non-SCHEDULED seat
at `:546`). _Survives:_ the server's rule. _Affected:_ split parties only —
a chair fully worked inside a still-live party regains «Отмени» (the server
accepts it); a root COMPLETED with this chair all cancelled loses one the
server would refuse. _Specs:_ `:5667-5695` unchanged (they call the
delegate with `{ bookingStatus }`); a new case added.

**DEP-4 — "is the chair off all day".** _Before:_ `sd:6339` `offOn` reads
`resting()` on the shown day (no roster AND no appointments) and
`rostered.length === 0` on every other day; a chair stood down all day that
still holds bookings is "not off" only on the shown day, so «Премахни»
lifts a RANGE, which the store's decide refuses on a CLOSED day
(`SCHEDULING_SCHEDULE_EXCEPTION_EMPTY_RANGES`). _After:_ roster empty
everywhere — the rule of the other days and of the all-day chip
(`sd:2177`). _Evidence:_ two local rules for one question; the shown-day rule
produces a refused write. _Survives:_ roster empty. _Affected:_ the block
sheet on the shown day for a stood-down chair with bookings: `offOn` also
feeds the editor's `dayIsOff` (`sd:6150`), so (a) «Премахни» becomes the
whole-day lift, which lands, and (b) the lift row's icon becomes `staff.off`
(was `booking.blocked` unless the draft is all-day) and its label
`staff.block.liftDay` (was `staff.block.lift`) — `staff-block-editor.html:
700-708`. _Specs:_ `:2977`, `:3136`, `:6624` unchanged; a new case asserts
the whole-day lift AND `staff-block-lift`'s label; that DOM difference is
allowed in §6.3. §8 OQ-7.

**DEP-5 — a recent visit's client account («Скорошни», the omnibox
book).** _Before:_ `sd:6714` `accountOf` pairs the FIRST account seat's uid
(possibly a companion's) with the BOOKER's `contactName`/`contactPhone`.
_After:_ `ClientQuerySystem.recentAccounts`/`bookAccounts` pair the booker's
account (`ownerUserId`, else the SELF account seat) with the booker's
contact; a visit with neither contributes no account. _Evidence:_ the
dashboard's own `toRow` rule (`sd:3550-3572`, client-card-redesign §3.1.4,
the P0 audit defect): a companion never wears the booker's name or number —
picking the son's uid under the father's name books the son as the father.
_Survives:_ §3.1.4. _Affected:_ the add-client page's «Скорошни» and book
for parties whose first account seat is a companion. _Specs:_ `:4561`,
`:4739` unchanged (self-seat fixtures); a new case added. §8 OQ-8.

**DEP-6 — the manual discount's percent range (no observable change).**
_Before/after:_ the edge (`booking.wire.ts:742-754`) refuses 0 % and
fractions; the editor (`ve:5439`) refuses 0 % and never sees a fraction —
`figureRead` strips every non-digit first («1.5» reads 15; «12.5» becomes
125, which `cappedFigure` snaps to «100» at the keystroke), and that strip
stays in the editor (E-7), so `manualPercentOff` receives the stripped
integer; the domain guard
`CouponValue.percentOff` accepts 0–100 inclusive with fractions. _Evidence
for the edge:_ `booking.wire.spec.ts:1227-1238` pins 12.5 % refused on
purpose; the owner's slider wording ("the floor writes a zero, which
promises nothing", `ve:5624`); `CouponValue.fixedAmount`'s JSDoc ("a
zero-value coupon is a modelling error"). _Survives:_ the edge rule, homed
once as `CouponValue.manualPercentOff` (integer 1–100) and called by the
wire, `BillingSystem.manualValue` and the editor; `percentOff` keeps 0–100
for stored coupons (`coupon-value.data.spec.ts:11` unchanged). _Affected:_
nothing. _Specs:_ none changed.

**DEP-7 — the upload size boundary (visit photos and avatars).** _Before:_
the client guards refuse `size > MAX` (8 MiB photos, 5 MiB avatars), so a
file of exactly MAX passes and Storage rejects it with a raw
permission-denied (`storage.rules:44`, `:67`: `size < MAX`). _After:_
`MediaSystem.check` refuses `size >= MAX`. _Evidence:_ `AvatarSystem`'s
JSDoc says it MIRRORS `storage.rules` so a bad file fails fast with a
domain refusal. _Survives:_ the server's rule. _Affected:_ a file of exactly
the limit after downscaling: the photo's `attachPhoto` returns `false`
either way (no DOM change); the avatar shows its "too large" words instead of
the storage-failure words. _Specs:_ `avatar.system.spec.ts:21` flips.

**DEP-8 — the onboarding service card's price and duration.** _Before:_
`client-onboarding.ts:658-682` uses `OfferingPriceSystem.priceRange`/
`durationRange` over every term (the service's own terms even when
performers exist, every override incl. variants no longer declared).
_After:_ `CatalogPricingSystem.cardPrice`/`durationRange` — the rule the
booking grid card, the landing tile and the service-detail sheet (which
onboarding opens one tap later) already use (law-10 D-10; `formatServiceMeta`'s
"ONE definition, because there were three"). _Survives:_ the system rule.
_Affected:_ `/onboarding` service cards where the service's own terms or a
stale override lie outside the bookable terms. _Specs:_ none pinned; a new
case added.

**DEP-9 — the services step's quote for "anyone".** _Before:_
`booking-services-step.ts:858-871` takes min/max over performers whose
barber is in the ACTIVE barber list (while `livePrice` takes the min over
all offerings). _After:_ `TermsSpanSystem.spanFor(service, variant, null)` —
every offering — the bag sheet's quote for the same line. _Survives:_ the
system rule (the add sheet and the bag agree). _Affected:_ the «Добави …»
CTA for a service that keeps an offering of a barber outside the active
list. _Specs:_ none pinned (bag `:903`/`:932` already pin the system rule);
a new case added.

**DEP-10 — the bundle saving's arithmetic.** _Before:_ the sheet sums float
EUR major units, so a bundle priced exactly at its members' sum can leave a
float epsilon > 0 and print a «спестяваш 0,00 €» capsule. _After:_
`CatalogPricingSystem.bundleSaving` in integer cents returns `null` there.
_Survives:_ exact arithmetic on the same rule. _Affected:_ only that capsule.
_Specs:_ `service-detail-sheet.component.spec.ts:222`, `:253` unchanged.

**DEP-11 — the editor's announced last visit (pinned no-op).** _Before:_
`ve:7212` orders WORKED rows by `(localDate, startMinutes)`. _After:_
`VisitStorySystem.lastWorked` (by `utcEpochMs`, the card's featured-visit
rule its own docblock claims to follow). _Survives:_ the system rule.
_Affected:_ only visits in different zones or inside a DST fall-back hour —
unreachable on the seed's single zone. _Specs:_ `:7423` unchanged.

**DEP-12 — the editor's "same promise" (pinned no-op).** _Before:_ grant
and code lines compared by `grantId`/`code` only, manual lines by
`JSON.stringify(value)`. _After:_ `DiscountSystem.samePromise` (provenance +
method rank + magnitude). _Differs:_ only for a grant/code line whose stored
value differs from the offer — unreachable: `grantChoices`/`promoChoices`
mark such a line `applied`, so `applyOffer` returns before `addDiscount`.
_Survives:_ the system rule. _Specs:_ `:7505`, `:4893` unchanged.

**DEP-13 — a trigger delivery's event time (telemetry only).** _Before:_
`edge.ts:893` reads `Date.parse(event.time)`; `triggers.wire.ts:118` reads
`ZonedTimeSystem.parseOffsetIso`. _After:_ both the latter. _Differs:_ only
for an offset-less or malformed time (Date.parse reads a bare local time in
the host zone; `parseOffsetIso` refuses → `ageMs: null`). _Affected:_ the
operator attempt line's `ageMs` only. _Specs:_ `edge.spec.ts:1096`, `:1144`
unchanged.

**DEP-14 — the empty staff batch's field (pinned no-op).** _Before:_
`foldOnClock` refuses an empty batch as field `command`
(`edit-appointment.pipeline.ts:567`); `AppointmentEditSystem.fold` and the
wire say `commands` (system spec `:919`; `booking.wire.ts:1008` refuses
first). _After:_ `commands`. _Affected:_ no callable answer (the wire
answers first). _Specs:_ none pin `command`.

**DEP-15 — where a roster window closing at midnight ends (the visit,
create and block sheets' shift).** Ruled by the integrator on W1-S3's and
W0-G's notes. _Before:_ the four extents (`sd:3987`/`:3992`, `:4085`/`:4177`,
`:5451`/`:5512`, `:6171`/`:6178` on `2bd2354`) read each window's end with
`minuteAt(endMs)` — the END's own minute of day, so a window that closes at
the closing midnight ends at **0**, and `Math.max` over the ends counts that
0: a single window 10:00–24:00 gave the frame `rosterStartMinute 600,
rosterEndMinute 0` (an inverted shift: the editor's `shiftOf` drops it and
draws the whole day open, its summary reads «10:00 – 00:00»), and a split
day 09:00–12:00 + 14:00–24:00 gave an end of **12:00**. _After:_
`rosterHull` reads each window as the column's own shading and `blocksFor`
already read it — the end anchored on the start's day (`minuteOfDay(endMs,
startMs)`), so midnight is 1440 — and `IntervalSetSystem.hull` takes the
earliest start and the latest end; a window no `MinuteRange` can hold (a
whole civil day `[0, 0)`, unanchorable) adds nothing and the caller's
fallback applies (0–1440 for the visit and create frames, as before for an
empty roster; 0–0 for the block sheet, the same answer `2bd2354` gave).
_Evidence:_ two live readings of ONE window's end inside one dashboard — the
grid column shades the shift to 24:00 while the sheet framed it as ending at
0 (or at the first window's end); the editor's own comment on `shiftOf`
records that a chair rostered to midnight "had every minute of its day
drawn closed" before it was patched to fall back to an open day.
`MinuteRange`/`EndMinute` model an end of 1440 and cannot hold 0.
_Survives:_ the anchored reading (the column's). _Affected:_ only a chair
whose roster window ends at the closing midnight (no seeded shop or roster
does — the seed's hours end at 19:00–20:00): its visit and create frames
shade the hours before the shift, `frameVerdict` can say «извън смяната»
before it, and the aria summary reads «… – 24:00»; the block sheet's lane
reads the same end. _Specs:_ none pin it on either side (§9.4); the
`IntervalSetSystem.hull` cases (empty / one / disjoint) pin the system.
