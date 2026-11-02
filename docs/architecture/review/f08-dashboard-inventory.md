# F-08 inventory: `staff-dashboard.ts` and `staff-dashboard.html`

Read on `main` (`d5294d29`, tree clean), 2026-11-02. Read-only: no build, no test.

Files: `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.ts` (`sd`, 6,679 lines, read in full), `staff-dashboard.html` (`html`, 1,604 lines, read in full). `ve` = `visit-editor/staff-visit-editor.ts`, `st` = `staff-day.store.ts`, both read only where a row points.

Rules applied: CLAUDE.md Law 10, `.claude/rules/{presenters,angular-ui,ecs-systems}.md`, law-10 plan §0 (D-1, D-2, D-3), pass C §0 and §1.1 (`PC-` prefix below, for example PC-D-3, S-20), pass D §0 D-6 and §1.2, owner rulings OR-*.

## How rulings were applied

Pass C ruled several rows "STAY this pass" only because they compared instants (OQ-14, PC-D-3). OQ-14 closed through pass D D-6, which moved those answers onto the wall clock but did not give them a system home. The code changed, and the ruling's stated reason went with it, so those rows are **DECISION** here (SD-1 to SD-4). That is my reading of "kept unless the code has changed". It is the main judgement call in this file.

Pass C rows ruled STAY for a reason that still holds stay **KEEP**: agenda layout, chip cap, `rosterExtent`, call loops. Two rows the prior F-08 sample flagged fall here. `:2776` and `:2741-2746` are **KEEP**, not breaches.

Rows ruled wording, such as `clientLabel` and `verbKey`, are **WORDING**: pass C called them not-a-decision and named a future presenter as their home.

## Counts

| Class    | Rows | Small | Medium | Large |
| -------- | ---- | ----- | ------ | ----- |
| DECISION | 14   | 11    | 3      | 0     |
| WORDING  | 32   | 24    | 7      | 1     |
| KEEP     | 34   | n/a   | n/a    | n/a   |

Prior sample, checked against the code:

| Sample site                    | Now at                   | Verdict                              |
| ------------------------------ | ------------------------ | ------------------------------------ |
| `:1630` upcoming before past   | `sd:1627-1636`           | DECISION, SD-1                       |
| `:2776` visits before gaps     | `sd:2776-2784`           | KEEP, PC-D-3 agenda layout, SD-47    |
| `:2741-2746` wholeShop         | `sd:2739-2746`           | KEEP, PC-D-3 agenda layout, SD-47    |
| `:~2672` next by `visits.find` | `sd:2670-2680`           | DECISION, SD-3                       |
| `:5668-5677` past filter/sort  | `sd:5672-5684` (drifted) | DECISION, SD-2                       |
| `:3803` verbKey                | `sd:3809-3826` (drifted) | WORDING, S-3 ruled it wording, SD-24 |
| `:3211` span                   | `sd:3209-3223`           | WORDING, SD-25                       |

---

## DECISION rows

### SD-1: the search's outward order

- **Lines:** `sd:1596-1604`, `sd:1627-1636`
- **Quote:** `if (a.hit.past !== b.hit.past) return a.hit.past ? 1 : -1;`
- **Class:** DECISION, D-1.5. PC-D-3 and S-16 carried it for instants only. Pass D D-6.3 (DEP-6) put it on `WallTime.compare` and left it in the component.
- **Owner:** `VisitStorySystem` (it holds `hasEnded`; the list system imports nothing from it, so story importing list is safe). No existing function answers it: `VisitListSystem.sections` uses private `soonestFirst`/`newestFirst` with an id tie-break and `SectionRow`, which would reorder exact ties.
- **Signature:**
  ```ts
  outwardFromNow<V extends { readonly localDate: LocalDate; readonly startMinutes: MinuteOfDay; readonly endMinutes: EndMinute }>(
    visits: readonly V[],
    nowOf: (visit: V) => ShopNow | null, // reader, the `rowOf` precedent (PC-D-6)
  ): readonly { readonly visit: V; readonly past: boolean }[]
  ```
- **Spec:** purity; end minute exactly now is past; running visit is on the future side and ordered soonest; `null` now is not past; two shops, each on its own clock (`spec:8497`); equal `WallTime` keeps input order; all past, all future, empty.
- **Risk:** low. The loop builds each hit's VM before the sort. Call the system on the matched appointments, then word. **Small.**

### SD-2: «Скорошни» begun visits, newest first

- **Lines:** `sd:5672-5684`
- **Quote:** `shopNow === null ? UtcEpochMs.compare(visit.utcEpochMs, nowUtcMs) < 0 : VisitListSystem.hasStarted(startOf(visit), shopNow)`
- **Class:** DECISION, D-1.4 and D-1.5. S-20 left it for OQ-14; D-6.2/DEP-7 moved it to the wall clock, keeping the pre-zone stamp rule.
- **Owner:** `VisitListSystem`. `isHistory` is NOT equivalent: it also admits a settled future visit. `recentAccounts` takes the result and is reused, not changed.
- **Signature:**
  ```ts
  begunNewestFirst<V extends { readonly locationId: LocationId; readonly localDate: LocalDate; readonly startMinutes: MinuteOfDay; readonly utcEpochMs: UtcEpochMs }>(
    visits: readonly V[],
    nowOf: (locationId: LocationId) => ShopNow | null,
    nowUtcMs: UtcEpochMs, // T2 stamp ordering, only where no zone is known
  ): readonly V[]
  ```
- **Spec:** purity; start minute equal to now is included; no zone uses strict `<` on the stamp; mixed zones; settled future visit excluded; ties stable (`spec:8554` block).
- **Risk:** low. Sits after `await ensureWindow()`, no signal is written by it. **Small.**

### SD-3: the chair's next visit

- **Lines:** `sd:2670-2680`
- **Quote:** `visits.find((row) => !row.terminal && !VisitListSystem.hasStarted(WallTime.of(row.localDate, row.startMinute), shopNow))`
- **Class:** DECISION, D-1.1 and D-1.3 (S-15 CARRY closed by D-6.3, DEP-2).
- **Owner:** `VisitListSystem`. `nextUpcoming` is NOT equivalent: it reads root status and picks the minimum by start across shops. This rule reads the chair's status and chair's start and takes the first in lane order. D-6.3 pins that order for a sequential second leg, so do not "simplify" onto `nextUpcoming`.
- **Signature:**
  ```ts
  firstOpenInChair<T>(
    items: readonly T[],
    chairOf: (item: T) => { readonly bookingStatus: BookingStatus; readonly start: WallTime },
    now: ShopNow,
  ): T | null
  ```
  Use the reader so the system is not shaped after `DayRowVm` (PC-D-5 forbids that).
- **Spec:** start equal to now is not next; settled first row skipped; lane order beats start order; other day; empty (`spec:8398`, `:8425`).
- **Risk:** low. The result only sets `isNext` by id. **Small.**

### SD-4: live, in the chair now

- **Lines:** `sd:3748`
- **Quote:** `live: started && !ended && !BookingLifecycle.isSettled(chairLifecycle)`
- **Class:** DECISION, D-1.3. PC-D-2.12 says a comparison that combines `started ∧ ¬ended ∧ ¬settled` is D-1. S-14 CARRY closed by DEP-1, which named this formula.
- **Owner:** `VisitStorySystem`. `ClientGlanceSystem.isInChairToday` is a different question (today, not now).
- **Signature:**
  ```ts
  isInChair(chair: { readonly bookingStatus: BookingStatus }, start: WallTime, end: WallEnd, now: ShopNow | null): boolean
  ```
  Composes `VisitListSystem.hasStarted`, `hasEnded`, `BookingLifecycle.isSettled`.
- **Spec:** start equal to now true; end equal to now false; end 1440; settled false; other day; `null` false (`spec:8379`, `:8387`).
- **Risk:** none. **Small.**

### SD-5: the row's clock ladder

- **Lines:** `sd:3179-3206`, `sd:2319-2322`, `html:778-782`
- **Quote:** `if (entry.live) … if (entry.arrived && !entry.terminal) … return relativeTime(…)` and `row.arrived && !row.terminal ? 'visit.arrived' : …`
- **Class:** DECISION, D-1.1: hollow before live before arrived before countdown is a precedence between domain states, the same shape as D-1's own example. The arrival test is written twice in this file.
- **Owner:** `VisitStorySystem`; new `components/chair-moment.data.ts` (D-7).
- **Signature:**
  ```ts
  chairMoment(chair: { readonly bookingStatus: BookingStatus }, arrivedAtUtcMs: UtcEpochMs | null, inChair: boolean): ChairMoment // HOLLOW | IN_CHAIR | ARRIVED | SCHEDULED
  arrivedOpen(chair: { readonly bookingStatus: BookingStatus }, arrivedAtUtcMs: UtcEpochMs | null): boolean // the grid's glyph
  ```
- **Spec:** cancelled with an arrival stamp is hollow; arrived and live gives IN_CHAIR but `arrivedOpen` true (the grid shows the arrival glyph then, the card shows time left); completed with a stamp is SCHEDULED, today's relative phrase; no stamp; no-show.
- **Risk:** medium. `whenLabel` and `stateLabel` are template methods, evaluated on change detection with `nowUtcMs()`. Moving the tag into `toRow` must keep the tick reaching the row. **Medium.**

### SD-6: is this chair off all day

- **Lines:** `sd:2200`, `sd:2225`, `sd:6216-6222`; copy at `st:1696-1703`
- **Quote:** `lane.rostered.length === 0 && !lane.failed`
- **Class:** DECISION, D-1.3. PC-D-3 kept `rostered.length === 0` as a zero form, but OR-2 then added `!failed`, and a test that combines facts is D-1. Three sites now answer three ways (see Duplicates).
- **Owner:** `RosterSystem`.
- **Signature:** `offAllDay(lane: { readonly rostered: readonly MinuteRange[]; readonly failed: boolean }): boolean`. `BarberDayLane` passes as is.
- **Spec:** roster empty; roster empty and failed; roster present; roster empty with bookings (the chip says off, `offToday` does not).
- **Risk:** low if ported per site. Unifying `offOn` changes DEP-4 behaviour on a failed lane, so that part needs an owner ruling (Bug B3). **Small.**

### SD-7: lift scope on the block sheet

- **Lines:** `sd:6350`
- **Quote:** `const wholeDay = edit.allDay || this.offOn(barberId, dayKey);`
- **Class:** DECISION, D-1.3. The comment at `sd:6209-6215` names the domain reason: the store refuses a range lift on a closed day.
- **Owner:** `ScheduleExceptionSystem`.
- **Signature:** `liftsWholeDay(allDayBlock: boolean, chairOff: boolean): boolean`, with `chairOff` from SD-6.
- **Spec:** the four combinations.
- **Risk:** low. The arming state (`blockLiftArmed`) stays in the component. **Small.**

### SD-8: the block sheet's write plan

- **Lines:** `sd:6309-6337`
- **Quote:** `if (edit.blockId !== null && !edit.allDay) { … clearBlock … }` then `only !== undefined ? blockTime : blockSeries`
- **Class:** DECISION, PC-D-1.3 write plans ("which commands a draft costs, in which order"). No pass names `commitBlock`, so it is unruled. Confidence medium: PC-D-3 keeps the dashboard's call loops, and the loops here do stay. Only the plan moves.
- **Owner:** `ScheduleExceptionSystem`, with the `schedule-blocks.pipeline.ts` use case.
- **Signature:**
  ```ts
  blockSavePlan(
    edited: { readonly barberId: BarberId; readonly range: MinuteRange; readonly day: LocalDate } | null,
    allDay: boolean,
    range: MinuteRange | null,
    chairs: readonly { readonly barberId: BarberId; readonly locationId: LocationId | null }[],
    days: readonly LocalDate[],
  ): { readonly lift: … | null; readonly writes: readonly { barberId: BarberId; locationId: LocationId; ranges: readonly MinuteRange[]; days: readonly LocalDate[] }[] }
  ```
- **Spec:** edited range lifts first; edited all-day lifts nothing; new block; one day vs series; a chair with no home is skipped; empty `ranges` means whole day.
- **Risk:** medium. It interleaves awaits and stops early on a refusal. Bug B6 lives here. **Medium.**

### SD-9: which offers a chair's menu holds

- **Lines:** `sd:1947-1983`
- **Quote:** `if (vm.variants.length > 0) { return vm.variants.map(…) }` with the comment "offered per variant … and never bare: the server refuses a seat whose price the variant would move"
- **Class:** DECISION, D-1.4. The refusal it mirrors is `party-admission.system.ts:180-186`.
- **Owner:** `OfferingPriceSystem`. `termsFor` is composed. No existing enumerator.
- **Signature:** `offersOf(service: PricedService, barberId: BarberId): readonly { readonly variantId: ServiceVariantId | null; readonly terms: ServiceTerms }[]`. `PricedService` may need widening to carry variants (PC-D-5a allows widening).
- **Spec:** no variants gives one bare offer; variants give never a bare one; a non-performing chair gets the service's own terms; an unpriced variant falls to base.
- **Risk:** low. Names stay in the presenter (SD-41). **Small.**

### SD-10: who wears the booking's contact

- **Lines:** `sd:3626-3646`, `sd:5610-5613`
- **Quote:** `seat.subjectRelationship === SubjectRelationship.Companion ? { … phone: null … } : { … label: contactName … phone: phoneLabel … }`
- **Class:** DECISION, D-1.3 ("a booker's own words"), borderline; see Unsure. It looks like tag narrowing (D-2.1), but it decides which person holds a phone number, a rule OR-43/DEP-5 call privacy. It also disagrees in the same function with `selfSeat` at `sd:3718` (`Seat.isOwnAccount`) for a `CLIENT` relationship.
- **Owner:** `Seat` companion, beside `isOwnAccount`. `ClientQuerySystem.bookerOf` is private and answers per visit, not per seat.
- **Signature:** `Seat.isCompanion(seat: AccountOccupant): boolean`, and `Seat.wearsBookingContact(seat: AccountOccupant): boolean`.
- **Spec:** `SELF`, `COMPANION`, `CLIENT`, anonymous, walk-in (`spec:7495`).
- **Risk:** low. Exact port keeps `CLIENT` wearing the contact. **Small.**

### SD-11: a chair's seats and its span

- **Lines:** `sd:3528-3537`, also `sd:3005`, `sd:4972-4974`
- **Quote:** `const startMinute = first?.startMinutes ?? appointment.startMinutes;` and `last === undefined ? appointment.endMinutes : Seat.endMinutes(last)`
- **Class:** DECISION, PC-D-1.2 (interval, what occupies the chair). The single-field filter alone would be a lookup; the span with its envelope fallback is the rule.
- **Owner:** `Seat` companion. `BusySystem.chairOccupants` is NOT equivalent (root-live filter, exclusion). `IntervalSetSystem.hull` is NOT equivalent on seats out of order, so port first and last exactly (PC-D-6).
- **Signature:**
  ```ts
  Seat.ofChair<S extends { readonly barberId: BarberId }>(seats: readonly S[], barberId: BarberId): readonly S[]
  Seat.chairSpan(seats: readonly ChairGeometry[], envelope: { readonly startMinutes: MinuteOfDay; readonly endMinutes: EndMinute }): MinuteRange
  ```
- **Spec:** one seat; sequential seats; no seat falls to the envelope; closing midnight.
- **Risk:** low. `rowShape` reads the same fields. **Small.**

### SD-12: what a rebooking carries

- **Lines:** `sd:5526-5533`; the other rule is `ve:7528-7560`
- **Quote:** `{ ...leg, seatId: SeatId.of(…), overridden: false }`
- **Class:** DECISION, PC-D-1.3 and D-1.7. Two live rules disagree: `Запиши пак` keeps the stored price label and minutes and clears the mark, while «Повтори» re-reads today's catalogue price and sets `overridden` when the minutes differ. The id format stays, UR-11.
- **Owner:** `VisitDraftSystem`.
- **Signature:** `rebookLegs<L extends { readonly seatId: SeatId; readonly overridden: boolean }>(legs: readonly L[], mint: (leg: L, index: number) => SeatId): readonly L[]`, an exact port. Unifying with `repeatLast` is a behaviour change and needs a DEP.
- **Spec:** fresh ids; order kept; mark cleared; input untouched (`spec:6306` block).
- **Risk:** medium, because of the owner question (Bug B5). **Medium.**

### SD-13: the chair's at-work windows

- **Lines:** `sd:2119-2131`
- **Quote:** `lanes.flatMap((lane) => [...lane.rostered, ...lane.blocks])`
- **Class:** DECISION, PC-D-1.2, confidence medium. S-12's STAYS reason (anchored minutes over 1440) is gone: `IntervalSetSystem.normalize` already runs here. What remains is the rule that at-work means rostered plus carved time.
- **Owner:** `RosterSystem`, composing `IntervalSetSystem.normalize`.
- **Signature:** `atWork(lanes: readonly { readonly rostered: readonly MinuteRange[]; readonly blocks: readonly MinuteRange[] }[]): readonly MinuteRange[]`
- **Spec:** overlapping shifts merge; block inside and outside roster; no lanes; end 1440.
- **Risk:** low. The trailing `.map` renames fields for `OpenWindow`; that is the F-10 family, fix it in the grid's struct, not here. **Small.**

### SD-14: the shop's dial code with its fallback

- **Lines:** `sd:5765-5767`; copies at `ve:3144-3148`, `ve:4696-4698`
- **Quote:** `PhoneSystem.countryCallingCode(this.deployment.defaultCountry) ?? ClientQuerySystem.DEFAULT_CALLING_CODE`
- **Class:** DECISION, D-1.7, a rule written three times.
- **Owner:** `ClientQuerySystem`, which holds the constant.
- **Signature:** `callingCodeOf(country: <the type countryCallingCode takes>): string`
- **Spec:** known country; unknown country; `null`.
- **Risk:** none. Check first that `client-query.system.ts` importing `PhoneSystem` respects the F6 lazy-chunk ruling; if not, home it in `PhoneSystem` with the default passed in. **Small.**

---

## WORDING rows

Target files, all new unless named. `P` = `staff-dashboard/staff-day.presenter.ts`, `V` = `staff-dashboard/staff-day.vm.ts`, `S` = `staff-dashboard/staff-search.presenter.ts`, `C` = `staff-dashboard/staff-day-chrome.presenter.ts`.

Purity shapes every row here. `creativo/presenter-purity` forbids Angular, so `translate`, `catalog.findService`, `content.text` and `fields.isOn` must arrive as a words struct, lookups and a flags struct. The precedent is `day-health/day-health.presenter.ts`.

The main trap: `translate()` reads no signal. Words must be built from `copyTable()` inside the `computed()`, or review r4's bug returns (`sd:1125-1136`, «−staff.visit.minutes» at first paint).

The page's spec reaches many of these by name (`statusWord` 8 times, `statusNote` 2, `hasFoot`, `reversibleSave`), so PC-D-9 thin delegates apply.

| ID    | Lines                                                                                          | Quote                                                              | Why it is wording                                                                                 | Target and field                                           | Risk and effort                                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SD-15 | `sd:3522-3803`, types `sd:485-721`                                                             | `private toRow(appointment, barberId, nowUtcMs, shopNow)`          | The whole row view model. May call systems; holds no rule once SD-3, 4, 5, 10, 11 are out         | `P` `dayRowVm(input): DayRowVm`; `V` holds `DayRowVm`      | High. Called from `lanes`, `eventsFor`, `rowFor` (outside any computed). `DayRowVm` is also `StaffEditRowFacts` input (pass D D-10.1). Reads `companionNames`, `copyTable`. **Large** |
| SD-16 | `sd:3579-3584`                                                                                 | `(allGuests ? guestLabels.join(' + ') : contactName) ?? …`         | PC-D-3: wording of whose name prints, "belongs in a future staff-day presenter"                   | `P`, `clientLabel`                                         | Low. Bug B4. **Small**                                                                                                                                                                |
| SD-17 | `sd:3609-3658`                                                                                 | `const personOf = (seat: Seat): VisitEditorClientOption`           | Person option mapping; dedupe is already `personKeyOf` (S-21); the rule is SD-10                  | `P`, `people[]`                                            | Medium. `legs` reads `personOf(seat).id`, and the `people` keys seed the editor draft. **Medium**                                                                                     |
| SD-18 | `sd:3770-3796`                                                                                 | `legs: seats.map((seat) => { … })`                                 | Leg option mapping; calls `Seat.overridden`, `termsFor`                                           | `P`, `legs[]`                                              | Low. **Small**                                                                                                                                                                        |
| SD-19 | `sd:3704`, `sd:2451`, `html:737`                                                               | `seatCount > 1 ? \`${seats.length}/${seatCount}\` : null`          | Form of one count; PC-D-3 keeps the sibling `seatsHere > 1` as D-2.4/D-2.2                        | `P`, `partyLabel`, `guestsMark`                            | Low. **Small**                                                                                                                                                                        |
| SD-20 | `sd:2462-2498`                                                                                 | `formatCents(sum.value.amountCents, …)`                            | Formats system sums; `tipsOf` decides                                                             | `P`, `priceLabel`, `tipLabel`                              | Low. **Small**                                                                                                                                                                        |
| SD-21 | `sd:3472-3520`                                                                                 | `catalogTagWords(VisitDraftSystem.minutesDelta(…), …)`             | The arithmetic is the system's (D-6.3 DEP-8); the rest is words and a catalogue lookup            | `P`, `tag`, reuse `shared/catalog-tag.words.ts`            | Medium. This is the r4 regression's own site (`copyOf` withholds the tag until the table lands). **Medium**                                                                           |
| SD-22 | `sd:3409-3420`, `sd:3437-3459`                                                                 | `this.stampWall(atUtcMs)?.localDate === visitLocalDate`            | `chairResolution` decides; words and a form choice (D-2.3)                                        | `P`, `resolution`                                          | Low. **Small**                                                                                                                                                                        |
| SD-23 | `sd:6643-6679`                                                                                 | `function discountsOf(appointment)`                                | Option mapping outside a presenter. `provenanceOf` is a slice copy belonging on the companion     | `P`, `discounts`, `vouchers`; `DiscountProvenance.sliceOf` | Low. **Small**                                                                                                                                                                        |
| SD-24 | `sd:3809-3826`, `sd:4356-4367`                                                                 | `return 'staff.day.act.reopen'`; `destructive: verb === Cancelled` | S-3: `verbKey` STAYS as wording; the pair picks a word and a DS role (D-2.1)                      | `P`, `VisitEditorVerb.label`, `.destructive`               | Low. **Small**                                                                                                                                                                        |
| SD-25 | `sd:3209-3223`, used `html:666`                                                                | `"45 мин" / "1 ч" / "6 ч 30 мин"`                                  | Form choice (D-2.3)                                                                               | new `shared/span.words.ts`, `spanWords(minutes, words)`    | Low. No other copy found in the feature. **Small**                                                                                                                                    |
| SD-26 | `sd:3179-3206` after SD-5                                                                      | `relativeTime(entry.startUtcMs, this.nowUtcMs(), lang, 'short')`   | D-6.4/T2: the countdown stays on instants; only its words move                                    | `P`, `whenLabel`, `now` as input                           | Low once SD-5 lands. Keep the tick. **Small**                                                                                                                                         |
| SD-27 | `sd:823-829`, `sd:3152-3177`                                                                   | `STATUS_ICONS`, `stateLabel`, `stateIcon`                          | Tag tables (D-2.1), two for one family (UR-3)                                                     | `V` table; `P`, `stateLabel`, `stateIcon`, `statusIcon`    | Low. Editor copies, see Duplicates. **Small**                                                                                                                                         |
| SD-28 | `sd:3232-3241`, `sd:3281-3297`                                                                 | `status === Confirmed \|\| status === Completed → null`            | A tag table with silent entries (D-2.1). `statusNote` only forwards                               | `P`, `rowLabel`                                            | Low. Spec reads them by name. **Small**                                                                                                                                               |
| SD-29 | `sd:3116-3140`, `sd:3317-3368`, `html:809-886`                                                 | `hasFoot`, `rowIcons`, `factLines`, `endLabel`                     | Display composition under flags (D-2.7); `hollowStatus` hides the tag by a system verdict (D-2.1) | `P`, `foot`, `lines`, `marks`                              | Medium. `AgendaFields` is a signal store and the template repeats `hasFoot`'s test. A display struct removes that copy and fixes Bug B2. **Medium**                                   |
| SD-30 | `sd:2285-2397`, `sd:2439-2459`                                                                 | `accessibleName: this.blockName(row, lane.barberId)`               | Grid event mapping; the block's name; `hasEnded` already a system call                            | `P`, `GridEvent`                                           | Medium. Calls `toRow`, so move with SD-15. **Medium**                                                                                                                                 |
| SD-31 | `sd:2011-2105`, `sd:1025-1028`, `sd:2507-2547`                                                 | `title`, `shortTitle`, `initial`, `abbreviateWeekday`              | Column titles; weekday form choice                                                                | `P`, `GridColumn`; helpers in `C`                          | Medium. Filters and `worksDay` stay as they are. Column ids are read back by `openAllDay`. **Medium**                                                                                 |
| SD-32 | `sd:2185-2267`                                                                                 | `label: this.transloco.translate('staff.day.offChip', …)`          | Chip wording. Cap 3 is PC-D-3; the off test is SD-6                                               | `P`, `allDay`                                              | Low. **Small**                                                                                                                                                                        |
| SD-33 | `sd:2154-2158`, `sd:2556-2592`, `sd:4378-4387`                                                 | `formatDayPill(first, this.content.locale())`                      | Formatting through shared helpers                                                                 | `C`, `periodLabel`, `regionLabel`, `zoneLabel`, `dayLabel` | Low. **Small**                                                                                                                                                                        |
| SD-34 | `sd:2837-2866`                                                                                 | `initial: formatWallClock(key, null, locale, …)`                   | Labels; the 13-week window is a display cap (D-2.4)                                               | `C`, `weekCalendar`                                        | Low, but keep it apart from `weekStrip`. The split is a measured fix (`sd:2820-2836`). **Small**                                                                                      |
| SD-35 | `sd:946-1014`, `sd:1576-1623`                                                                  | `splitOnTerm`, `splitOnDigits`, `matches`                          | PC-D-3: bg collation match and highlight runs are not decisions and can never live in a system    | `S`, `SearchHitVm`                                         | Medium. Restructures the search loop with SD-1. **Medium**                                                                                                                            |
| SD-36 | `sd:1640-1673`                                                                                 | `out.push({ label: SearchField.Client, value: … })`                | Text projection from entity and host lookups (D-2.5). See Unsure                                  | `S`, `searchableFields`                                    | Low. Bug B7. **Small**                                                                                                                                                                |
| SD-37 | `sd:2968-3021`                                                                                 | `translate('staff.day.daySummaryFree', …)`                         | Words over `totalMinutes`, `recordedTipsTotal` (S-18, S-19); the scope gate stays                 | `P`, `summary`, `tips`                                     | Low. **Small**                                                                                                                                                                        |
| SD-38 | `sd:6541-6544`, `sd:6562-6605`                                                                 | `describeError(error)`                                             | Refusal to sentence, with the `from`/`to` status words                                            | new `staff-day-error.words.ts`, `refusalSentence`          | Low. **Small**                                                                                                                                                                        |
| SD-39 | `sd:5685-5725`                                                                                 | `meta: this.transloco.translate('staff.visit.lastVisit', …)`       | Option mapping over `recentAccounts`, `bookAccounts`                                              | `P`, `recent[]`, `book[]`                                  | Low. **Small**                                                                                                                                                                        |
| SD-40 | `sd:451-454`, `sd:1868-1877`                                                                   | `streetOf(address)`                                                | Display form of an address                                                                        | `C`, `shopOptions`                                         | Low. **Small**                                                                                                                                                                        |
| SD-41 | `sd:1941-1983` after SD-9                                                                      | `label: \`${name} · ${this.content.text(variant.name)}\``          | Names and `content.price` over system terms                                                       | `C`, `VisitEditorServiceOption`                            | Low. **Small**                                                                                                                                                                        |
| SD-42 | `sd:4260-4274`, `sd:4291`, `sd:4305-4307`, `sd:4324-4326`, `sd:5383`, `sd:5415`                | `clientMeta: row.rebooked ? translate(…) : null`                   | Word fields inside the two editor VMs                                                             | `P`, `visitEditorWords`; assembly stays in the computed    | Medium. Comment at `sd:4275-4289`: this VM is the draft's baseline, and anything the draft moves must not feed it. **Medium**                                                         |
| SD-43 | `sd:3985-3993`, `sd:6025-6031`                                                                 | `name: appointment.contactName ?? translate(unnamedClient)`        | Neighbour names over `chairOccupants` (DEP-2)                                                     | `P`, `FrameNeighbour`                                      | Low. **Small**                                                                                                                                                                        |
| SD-44 | `sd:1824-1835`, `sd:1851-1860`, `sd:1988-2001`, `sd:4447-4477`, `sd:6408-6445`, `sd:6479-6491` | `viewChoices`, `viewSegments`, `scopeChoices`, `discardActions`    | Chrome option lists with words                                                                    | `C`                                                        | Low. **Small**                                                                                                                                                                        |
| SD-45 | `sd:2635-2652`, `sd:2761-2764`                                                                 | `startLabel`, `timeLabel`                                          | Gap and group labels; the layout itself is SD-47                                                  | `P`, `GapRowVm`, `AgendaGroupVm`                           | Low. Move with SD-15. **Small**                                                                                                                                                       |
| SD-46 | `sd:3043-3058`                                                                                 | `name: vm ? this.content.text(vm.name) : id`                       | Name mapping over `offToday`                                                                      | `P`, `resting`                                             | Low. **Small**                                                                                                                                                                        |

---

## KEEP rows

| ID    | Lines                                                                                 | Quote                                                                                            | Ruling or clause                                          | Why                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SD-47 | `sd:2737-2785`                                                                        | `return !(wholeShop && !entry.sellable)`, visits before gaps, `barberName` order, group by start | PC-D-3 agenda layout, D-2.4                               | Named row: page layout of display rows. Flag gate is D-2.7                                                                                             |
| SD-48 | `sd:2657-2659`                                                                        | `[...visits, ...gaps].sort(…)`                                                                   | PC-D-3, pass D T-9                                        | Layout of the run, stable by minute                                                                                                                    |
| SD-49 | `sd:2407-2421`                                                                        | `rosterExtent`                                                                                   | PC-D-3 `rosterExtent`                                     | Scroll anchor of a day with no now-line                                                                                                                |
| SD-50 | `sd:1035`, `sd:2243-2263`                                                             | `ALL_DAY_CHIP_CAP`                                                                               | PC-D-3, D-2.4                                             | Display cap                                                                                                                                            |
| SD-51 | `html:725`, `html:737`                                                                | `entry.seatsHere > 1`                                                                            | PC-D-3, D-2.4/D-2.2                                       | Named row                                                                                                                                              |
| SD-52 | `sd:3832-3901`, `sd:5191-5290`                                                        | `for (const seatId of seatIds)`, `landed`, `cancelNoteFiled`                                     | PC-D-3, D-2.9; S-4, S-5, S-6                              | Call loops stay; legality is already `transitionSeats`, `inverseOf`, `staffCancelReason`                                                               |
| SD-53 | `sd:4615-4705`, `sd:4806-4893`                                                        | `saveFromEditor`, `offerSaveUndo`                                                                | OR-4 (plan in `savePlan`, sequence in `saveVisitEdit`)    | Only outcome-on-screen is left                                                                                                                         |
| SD-54 | `sd:4767-4777`                                                                        | `commandsFor`                                                                                    | OR-4, D-9                                                 | One-line delegate kept for specs                                                                                                                       |
| SD-55 | `sd:382-387`                                                                          | `reversibleSave`                                                                                 | S-9, PC-D-9                                               | Delegate of `undoable`; only specs call it                                                                                                             |
| SD-56 | `sd:399-410`, `sd:4858-4864`                                                          | `isOverlapOffer`, `isStaleRefusal`, one retry                                                    | PC-D-2.9                                                  | "Retries that only re-issue a call"                                                                                                                    |
| SD-57 | `sd:416-448`, `sd:4925-4931`, `sd:5013-5035`                                          | `rowShape`, `awaitRow`, revision wait                                                            | PC-D-2.9 (`awaitRow`/`rowWatch` named)                    | Listener catch-up, not a rule                                                                                                                          |
| SD-58 | `sd:905-913`                                                                          | `minuteRangeOf`                                                                                  | D-2.8                                                     | Boundary parse off the anchored axis through brand constructors                                                                                        |
| SD-59 | `sd:3541-3549`, `sd:2374-2379`, `sd:2767-2772`                                        | `hasStarted`, `hasEnded` calls                                                                   | D-6.3                                                     | Already the system's answer                                                                                                                            |
| SD-60 | `sd:2798-2799`, `sd:2933-2938`                                                        | `agendaNowIndex`, `isNowAnchor`                                                                  | DEP-4, PC-D-2.13                                          | Where the page scrolls to                                                                                                                              |
| SD-61 | `sd:2647`                                                                             | `past: !gap.sellable`                                                                            | D-2.1                                                     | Reads a system answer (`sellableAt`)                                                                                                                   |
| SD-62 | `sd:3800`                                                                             | `legal.filter((verb) => verb !== primary)`                                                       | law-10 D-3 medals chip precedent                          | Combines two system answers for a menu                                                                                                                 |
| SD-63 | `sd:3686`, `sd:3760`, `sd:3705`                                                       | `arrivedAtUtcMs !== null`, `bookedFromAppointmentId !== null`, note trim                         | D-2.2, D-2.8                                              | Presence of a stored fact; a word-less normalisation                                                                                                   |
| SD-64 | `sd:3754`, `sd:341`                                                                   | `endMinute >= 24 * 60`                                                                           | PC-D-2.12                                                 | One primitive compared. Hygiene: `EndMinute` could export a `CLOSING` constant; 1440 is spelled in many files                                          |
| SD-65 | `sd:3741-3743`, `sd:5404`                                                             | `first?.currency ?? Currency.EUR`                                                                | no ruling; D-2.5 by analogy                               | A chair with no seats has nothing to read. See Unsure                                                                                                  |
| SD-66 | `sd:5368-5373`, `sd:6329-6331`                                                        | `homeOf(chairBarber) ?? locations()[0]?.id`                                                      | S-25, `homeOf` JSDoc "each caller keeps its own fallback" | Named                                                                                                                                                  |
| SD-67 | `sd:4100-4104`, `sd:5353`, `sd:6045-6053`                                             | `roster?.startMinutes ?? MIDNIGHT`                                                               | S-13                                                      | Each caller keeps its own empty fallback                                                                                                               |
| SD-68 | `sd:4329-4332`, `sd:1508-1511`                                                        | `stampWall(...)?.minute ?? MIDNIGHT`                                                             | D-6.6                                                     | The lawful stamp reading                                                                                                                               |
| SD-69 | `sd:5441-5450`                                                                        | `createChair`                                                                                    | D-2.6                                                     | The sheet's default subject; editable, nothing stored                                                                                                  |
| SD-70 | `sd:4260-4267`                                                                        | `peers` filter                                                                                   | D-2.6                                                     | Rows beside the one on screen                                                                                                                          |
| SD-71 | `sd:4574-4579`, `sd:4571`                                                             | `verb !== row.primary && !row.overflow.some(…)`                                                  | PC-D-2.9                                                  | Guards a late emit against verbs systems already offered                                                                                               |
| SD-72 | `sd:4508-4540`                                                                        | coupon first, then voucher                                                                       | PC-D-2.9                                                  | Await order. See Unsure                                                                                                                                |
| SD-73 | `sd:1314-1344`                                                                        | `Principal.hasAnyRole(principal, Roles.MONEY)`                                                   | D-2.6, Law 9 wiring                                       | Companion answers                                                                                                                                      |
| SD-74 | `sd:1374-1417`, `sd:5057-5071`                                                        | `clientCardCatalog`, library dedupe by URL                                                       | D-2.5                                                     | Host catalogue lookups                                                                                                                                 |
| SD-75 | `sd:6260-6284`, `sd:6148`                                                             | `dayRaw !== this.store.dayKey()`                                                                 | DEP-11                                                    | Named                                                                                                                                                  |
| SD-76 | `sd:2174-2176`                                                                        | `deviceZone() === store.zone() ? '' : zoneLabel()`                                               | D-2.3, pass D T-17                                        | Form choice                                                                                                                                            |
| SD-77 | `sd:2968-2982`                                                                        | `scope === null`, `freeMinutes === 0`                                                            | S-19, D-2.2                                               | Gate named; zero form                                                                                                                                  |
| SD-78 | `sd:3000-3008`                                                                        | `seat.barberId === lane.barberId` in `dayTips`                                                   | S-18                                                      | The sum landed; the gather reuses SD-11's `Seat.ofChair` if it lands                                                                                   |
| SD-79 | `html:510-512`, `html:994-997`, `html:1418-1419`, `html:913`, `html:976`, `html:1515` | `store.isToday() ? 'staff.day.offToday.' : …`                                                    | `angular-ui.md` template layer, D-2.6, D-2.1              | `t()` key choices on UI state and one tag; none combines domain facts                                                                                  |
| SD-80 | `sd:6613-6635`                                                                        | `guestLabelOf`, `guestLabelsOf`                                                                  | D-2.1                                                     | Tag narrowing that reads a field. Hygiene: belongs on the `Seat` companion. `GuestLabelSystem.namedGuests` takes `SubjectInput`, so it is no duplicate |

Read and not counted, as ordinary view state or plumbing: toolbar and scroll loops (`sd:1197-1304`, `sd:1751-1765`), route effects (`sd:1442-1477`), date, view and scope pickers (`sd:1775-1796`, `sd:6384-6405`, `sd:6424-6453`, `sd:6497-6527`), sheet trail and open or close state (`sd:4017-4032`, `sd:4389-4404`, `sd:4420-4494`, `sd:5473-5499`, `sd:6084-6100`, `sd:6166-6250`, `sd:6286-6291`), frame-day plumbing (`sd:4077-4184`), photo calls (`sd:5043-5124`), avatar and profile lookups (`sd:5571-5661`), client-search debounce and sequence (`sd:5760-5816`), `rowFor` (`sd:4943-4981`), `transitionOf`, the toast (`sd:3913-3999`), and the rest of `html` (structure and bindings).

---

## Duplicates with `staff-visit-editor.ts` and `staff-day.store.ts`

1. **Is the chair off** (SD-6). Three answers:
   - `sd:2200`, `sd:2225`: `rostered = 0 ∧ ¬failed`
   - `sd:6221`: `rostered = 0`
   - `st:1696-1703`: `¬failed ∧ ¬worksDay`, so bookings count
2. **Rebooking legs** (SD-12): `sd:5526-5533` vs `ve:7528-7560`. They disagree on price and on the override mark.
3. **Dial code fallback** (SD-14): `sd:5765-5767`, `ve:3144-3148`, `ve:4696-4698`.
4. **Cancelled and no-show glyphs and words** (SD-27): `sd:823-829` and `sd:3171-3177` vs `ve:3319-3350`, `ve:3424`, `ve:3464`. UR-3 asks for one table per tag family.
5. **`worksDay` lane filter**, the same call twice: `sd:2081-2086` and `st:1684-1686`. Not a copied rule (S-27 shares the system), but `workingLanes` could be reused for the date columns.
6. **Draft seat id spelling**: `sd:5529-5531` and `ve:4193-4195`. Kept on purpose by UR-11 (persisted format). Listed so nobody "fixes" it.

No duplicate found for `span`, `streetOf` or `guestLabelOf`. The bare `isSettled` calls at `sd:3748`, `sd:3801` and `ve:3283` share the system, so they are not copies.

---

## Bugs noticed in passing (not fixed; none run)

- **B1, `sd:6129-6140` block instead of cancel.** The doc says "the cancel, then the block sheet". `actFromSheet(row, Cancelled)` reaches `act()`, which only opens the reason sheet (`sd:3854-3865`) and returns. The block sheet then opens at once, under the still-open cancel sheet. Dismiss the cancel sheet and the visit stays live with a block sheet open on its range. The dashboard spec has no case for it (only `ve` spec `:1670` pins the emit). Highest-value bug here.
- **B2, `sd:3361` vs `html:861`.** `hasFoot` is true for any tag, but the template hides the tag on a hollow row. With every other foot switch off, a cancelled row with a tag draws an empty foot, the 8 px the comment says it prevents. The spec walks only the fixtures on screen. The comment at `sd:3354` cites `hasFootMatchesTheFoot`, a name that no longer exists.
- **B3, `sd:6221` ignores `failed`.** OR-2 says a failed lane is not off, and `allDay` obeys that, but `offOn` does not, so `dayIsOff` and the whole-day lift can fire on a chair whose read failed. Related, not run: while geometry is unread or failed (`st:1590-1596`, `NO_GEOMETRY`), `rostered` should be empty with `failed` false, so `allDay` may draw every chair as off.
- **B4, `sd:3579-3584`.** A chair holding only a companion account has no guest labels, so `clientLabel` falls to `contactName`. The son's agenda card prints the father's name, against the comment at `sd:3593` and `spec:7495`'s title. That spec pins `people[0]`, not the row.
- **B5, `sd:5526-5533`.** A rebooked draft keeps the old `priceLabel` while `StaffEditPlanSystem.bookingRequest` appears to send no price, so the sheet may show a price the server will not charge. Not traced to the server.
- **B6, `sd:6309-6337`.** An edited block is lifted, then written, in two calls. A refused write loses the old range. A chair with no home is skipped by `continue`, and the sheet still closes as if all landed.
- **B7, `sd:1570`.** `titleField = fields[0]` under the comment "the client is the title". An account seat with no `contactName` makes the service name the title.
- **Stale comments.** `sd:260-263` says nothing parses the row key back; `rowFor` does at `sd:4947-4949`. `sd:1154-1168` is `restoreFocusToRow`'s doc but sits above `anchoredDay`.
- **Dead code, by grep over `sd`, `html` and spec.** `fabActions`, `statusTone` with `STATUS_TONES`, `toggleMenu` with `openMenuId` and `DaySurface.Row`, `nowLabel`, `visitSheetBarber`. Delete rather than move: that removes SD-related wording work. `toggleDatePicker` and `blockLaneId` are spec-only.

---

## Unsure

- **The OQ-14 reading (SD-1 to SD-4).** If the owner treats "STAY in the component" as surviving pass D, these four become KEEP. I think they move: pass C's only stated reason was the instants, and F-08 lists them.
- **SD-10.** Tag narrowing (D-2.1) or qualification (D-1.3). It decides who holds a phone number, so I chose DECISION.
- **SD-8 and SD-13.** Both unruled, both confidence medium.
- **SD-36, `searchableFields`.** "Every field a search is allowed to look at" could be D-1.4. Pass C ruled only the match and the digit rule. I treated it as text projection.
- **SD-65, currency fallback, and SD-72, coupon before voucher.** Each carries a small domain flavour with no ruling naming it.
- **Line pins for specs** come from `grep` and the plan documents. I did not read the 8,813-line spec in full.
- **`PricedService` and `countryCallingCode`'s parameter type** were not read, so SD-9 and SD-14's signatures need checking when written.

## Suggested order

1. Delete the dead code.
2. Land the DECISION rows with their specs, smallest first, leaving the component as a caller. SD-6, SD-12 and B1 need owner answers first.
3. Land SD-15 and its family as one presenter, then re-point `lanes` and `eventsFor`, with the DOM differential WS-5 already requires.
4. Move the Small wording rows.
