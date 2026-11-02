# F-08: the staff decisions move into ecs-core

The owner ruled that domain decisions leave `staff-dashboard.ts` and `staff-visit-editor.ts` before feature work starts. This records the DECISION rows of `docs/architecture/review/f08-dashboard-inventory.md` (SD) and `f08-editor-inventory.md` (VE). Every row was checked against the source first. All 24 moved. Wording rows and KEEP rows were not touched.

## The rows

| Row   | Question                              | Now answered by                                                                           |
| ----- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| SD-1  | The search's outward order            | `VisitStorySystem.outwardFromNow`                                                         |
| SD-2  | «Скорошни» begun visits, newest first | `VisitListSystem.begunNewestFirst`                                                        |
| SD-3  | The chair's next visit                | `VisitListSystem.firstOpenInChair`                                                        |
| SD-4  | Live, in the chair now                | `VisitStorySystem.isInChair`                                                              |
| SD-5  | The row's clock ladder                | `VisitStorySystem.chairMoment`, `arrivedOpen`; tags in `components/chair-moment.data.ts`  |
| SD-6  | Is this chair off all day             | `RosterSystem.offAllDay` (the band's two sites), `rosteredNowhere` (`offOn`)              |
| SD-7  | Lift scope on the block sheet         | `ScheduleExceptionSystem.liftsWholeDay`                                                   |
| SD-8  | The block sheet's write plan          | `ScheduleExceptionSystem.blockSavePlan`                                                   |
| SD-9  | Which offers a chair's menu holds     | `OfferingPriceSystem.offersOf`                                                            |
| SD-10 | Who wears the booking's contact       | `Seat.wearsBookingContact`, `Seat.isCompanion`                                            |
| SD-11 | A chair's seats and its span          | `Seat.ofChair`, `Seat.chairSpan`                                                          |
| SD-12 | What a rebooking carries              | `VisitDraftSystem.rebookLegs`                                                             |
| SD-13 | The chair's at-work windows           | `RosterSystem.atWork`                                                                     |
| SD-14 | The dial code with its fallback       | `PhoneSystem.callingCodeOr`                                                               |
| VE-1  | What a save carries                   | `StaffEditPlanSystem.sameSave`                                                            |
| VE-2  | What the dock previews                | `DiscountSystem.withAdded` (existing)                                                     |
| VE-3  | A note's stored form                  | `VisitSidesSystem.storedNote` (existing)                                                  |
| VE-4  | The typed start's bounds              | `VisitDraftSystem.typedStartBounds`                                                       |
| VE-5  | The frame's floor                     | `VisitDraftSystem.FRAME_MIN_MINUTES`                                                      |
| VE-6  | Is this code already on the bill      | `DiscountSystem.codeOnBill`                                                               |
| VE-7  | The same voucher twice                | `VoucherSystem.withAddedVoucher`                                                          |
| VE-8  | What a new visit will cost            | `BillingSystem.draftLegsTotal`                                                            |
| VE-9  | The inbound rename before a span call | `VisitEditorLeg` and `StaffEditDraft.Leg` carry `durationMinutes`; `legMinutesOf` is gone |
| VE-10 | The request's verb                    | `AppointmentLifecycleSystem.requestVerb`                                                  |

Deleted as dead, after a grep across `.ts` and `.html`, specs included: `fabActions`, `statusTone` with `STATUS_TONES`, `toggleMenu` with `openMenuId` and `DaySurface.Row`, `nowLabel`, `visitSheetBarber`, `setLegDuration`, `legDurationMenu`, `setLegBarber`, `clientHeadline`, `tipChoiceName`, `durationTouched`.

## Departures

**VE-2 (deliberate, BUG-3).** The dock's preview calls `DiscountSystem.withAdded`, as `addDiscount` does. With an exclusive coupon on the bill and a typed figure, the preview used to show both; it now shows the figure alone, which is what «Приложи» does. The spec is in `staff-visit-editor.spec.ts`.

A stored line that does not read still takes nothing in the preview, as in `evaluate`, so the preview cannot throw on every render. «Приложи» still refuses such a line, as it did.

**SD-8 (small).** The plan is computed before the first `await`, so a chair's home is read once, before the lift. It used to be read per chair, after the awaits. It differs only if the catalogue changes during the save.

No other behaviour changed. Bugs B1 to B7 and BUG-1, BUG-2, BUG-4 to BUG-9 stand as they were. SD-6's sites stay apart and SD-12 stays apart from `repeatLast`.

## Rows that differ from what the inventory proposed

- **SD-5.** Takes `arrived: boolean`, not `arrivedAtUtcMs`. The row already holds that fact (SD-63, KEEP), and `arrived && !settled` is the expression it replaces. A stamp test failed the page's spec, whose hand-built row has no stamp field: `undefined !== null`.
- **SD-6.** Added `rosteredNowhere`, so `offOn` has a named answer that still ignores `failed` (Bug B3). The store's copy at `staff-day.store.ts` is untouched: it is not in the two files and it answers a third way.
- **SD-8.** Takes an input struct and a `homeOf` reader, not a `chairs` list, so the page does not map to call it. The plan has `writes: null` for a saved range that cannot be read: the old code lifted, then stopped with the sheet open. A write carries `localDate` for the one-day case, or `null` for a series.
- **SD-9.** `PricedService` is unchanged, since it has no variants and other callers do not need them. A new `OfferedService` adds them, and `Service` passes as is. An offer returns the `variant` struct, not its id, because the page needs its name. It reads the entity's variants; `serviceVms` maps those one to one.
- **SD-10.** `Seat.isCompanion` is a plain boolean, not a type predicate, whose false branch would wrongly exclude account seats. The call site in `lookUpCompanions` narrows on `seatSubject` first.
- **SD-14.** Homed in `PhoneSystem` with the default passed in. `client-query.system.ts` does not import `phone.system.ts` today and this keeps it so, in the spirit of the F6 ruling. The parameter is `CountryIso2`, never `null`, so the spec's unsupported case is `XX` and there is no `null` case.
- **VE-1.** The slice carries `durationOverride`, not a computed `spanMinutes`, and the system works out the span, so `VisitDraft` passes with no copy. That needs VE-9, so VE-9 landed first. The comparison stays a `JSON.stringify` of the same shape, which is the exact port.
- **VE-5.** The component reads the constant into `frameMinMinutes` for the template. The defaults in `staff-time-grid.ts` and `staff-timeline.ts` are untouched.
- **VE-8.** Ignoring `leg.currency` is stated in the doc and the slice's type: the slice has no currency to read.
- **VE-9.** `StaffEditRowFacts.legs` is renamed too, because the row's legs pass into it. `VisitEditorServiceOption.minutes` and the client card's `ClientCardLeg.minutes` keep their names. The rename did not reach a stored document or the wire: `BookingCall` takes the value as before.
- **VE-10.** Takes a `verbOf` reader and returns the worded item, so the page does not `.map` before the call or `find` after it. `chairStatus` may be `null`, as a new visit's is.
