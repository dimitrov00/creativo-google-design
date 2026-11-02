# F-08: the dashboard's wording moves into presenters

The owner ruled that domain rules and wording leave `staff-dashboard.ts` before feature work starts. `f-08-staff-decisions.md` records the decisions. This records the WORDING rows, SD-15 to SD-46 of `docs/architecture/review/f08-dashboard-inventory.md`. Every row was checked against the source first. All 32 moved. What a user sees did not change, and no existing assertion of `staff-dashboard.spec.ts` was edited.

`P` = `staff-day.presenter.ts`, `V` = `staff-day.vm.ts`, `C` = `staff-day-chrome.presenter.ts`, `S` = `staff-search.presenter.ts`, all in `libs/features/staff/dashboard/src/lib/staff-dashboard/`.

## The rows

| Row   | What                               | Now in                                                                                       |
| ----- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| SD-15 | The row's view model               | `P` `dayRowVm`; `DayRowVm` in `V`                                                            |
| SD-16 | Whose name the row prints          | `P` `dayRowVm`, `clientLabel`                                                                |
| SD-17 | The row's people                   | `P` `dayRowVm`, `people`                                                                     |
| SD-18 | The row's legs                     | `P` `dayRowVm`, `legs`                                                                       |
| SD-19 | «1/2» and «+1»                     | `P` `dayRowVm` `partyLabel`; `agendaCardVm` `guestsMark`                                     |
| SD-20 | The chair's price and tip          | `P` `seatsPrice`, `seatsTip`                                                                 |
| SD-21 | The tag                            | `P` `catalogTag`, reusing `shared/catalog-tag.words.ts`                                      |
| SD-22 | What settled the chair             | `P` `resolutionOf`, `stampLabel`                                                             |
| SD-23 | The bill's discounts and vouchers  | `P` `discountsOf`, `vouchersOf`; `DiscountProvenance.sliceOf`                                |
| SD-24 | A verb's word and red              | `P` `verbKeyOf`, `editorVerb`                                                                |
| SD-25 | «45 мин», «1 ч», «6 ч 30 мин»      | `shared/span.words.ts` `spanWords`                                                           |
| SD-26 | The relative time                  | `P` `whenWords`                                                                              |
| SD-27 | A state's glyph and word           | `V` `STATUS_ICONS`; `P` `stateLabel`, `stateIcon`                                            |
| SD-28 | The row's accessible name          | `P` `exceptionWord`, `rowStateNote`, `rowName`                                               |
| SD-29 | The card's lines, marks and foot   | `P` `factLines`, `rowMarks`, `footShown`, `endWords`, `agendaCardVm`; `V` `AgendaCardVm`     |
| SD-30 | A grid block                       | `P` `gridVisitEvent`, `gridBlockEvent`, `blockName`                                          |
| SD-31 | A grid column's head               | `C` `chairColumnHead`, `dateColumnHead`, `abbreviateWeekday`                                 |
| SD-32 | The all-day chips                  | `P` `offChairEntry`, `offDateEntry`, `allDayMoreEntry`                                       |
| SD-33 | The pill, region and zone labels   | `C` `periodLabelOf`, `zoneLabelOf`, `StaffChromeWords.gridRegion`                            |
| SD-34 | The week strip's cells             | `C` `weekCalendarOf`                                                                         |
| SD-35 | The search's match and highlight   | `S` `searchHits`, `matches`, `splitOnTerm`, `splitOnDigits`                                  |
| SD-36 | A visit's searchable fields        | `S` `searchableFields`                                                                       |
| SD-37 | The day's line                     | `P` `daySummaryWords`, `dayTipsWords`                                                        |
| SD-38 | A refusal's sentence               | `staff-day-error.words.ts` `refusalSentence`                                                 |
| SD-39 | «Скорошни» and the book            | `P` `recentClientOption`, `bookClientOption`                                                 |
| SD-40 | A shop's street line               | `C` `streetOf`, `shopOptionsOf`                                                              |
| SD-41 | The chair's service options        | `C` `serviceOptionsOf`                                                                       |
| SD-42 | The sheets' word fields            | `P` `visitEditorWords`, `peerRowOf`; `StaffDayWords.newVisitTitle`                           |
| SD-43 | The frame's neighbours             | `P` `occupantNeighbours`, `occupyingRows`                                                    |
| SD-44 | The toolbar and alert option lists | `C` `viewChoicesOf`, `viewSegmentsOf`, `scopeChoicesOf`, `discardActionsOf`, `zoneActionsOf` |
| SD-45 | Gap and group labels               | `P` `gapRowVm`, `wallClockLabel`; `GapRowVm.spanLabel`                                       |
| SD-46 | The chairs resting today           | `P` `restingChairs`                                                                          |

No decision turned up that the earlier stage missed, so no system was added for one.

## How the words and the clock reach a row

**Words.** `dayWords` and `chromeWords` are `computed()`s that read `copyTable()` and build a struct through `translate`. A presenter sees only the struct. `staff.visit.minutes` still comes raw off the loaded table, so the tag is withheld until it lands (review r4).

**Catalogue.** `catalogNames` and `DayRowContext.names` are lookups that read their signals when called, so the `computed` that calls the presenter follows a late catalogue.

**The tick.** The template prints `entry.card`, an `AgendaCardVm` built in `agenda`, which reads `nowUtcMs()` directly and through `lanes()`. Rows were already rebuilt on every tick, and `track entry.id` keeps each row's DOM node. A new page spec moves the clock and asserts the same node with a new gloss.

## Departures

**Reactivity (the one thing that differs: before the table loads, and on a language switch, when these labels now re-word at once).** `allDay`, `regionLabel`, `scopeLabel`, `daySummary`, `dayTips`, the grid's blocks, the row's unnamed-client word and the sheets' labels read `translate()` in a `computed`, so one built before the table landed could keep a key until something else invalidated it. They now rebuild when it lands. After load the words are the same.

**Delegates kept for the page's spec.** `statusWord`, `statusNote`, `rowLabel`, `whenLabel`, `rowIcons`, `hasFoot` and `chairMinutesOf` are one-line calls that only specs read. `agendaFlags()` reads `fields.isOn` per switch, because a spec patches `isOn`.

**KEEP rows that moved with their readers, unchanged.**

- SD-80 (`guestLabelOf`, `guestLabelsOf`) is now `staff-day-guest.words.ts`, because a presenter cannot import from the component.
- SD-61 to SD-65 sit inside `dayRowVm` and `gapRowVm`, where the old `toRow` held them.
- SD-47 to SD-51 and SD-77 to SD-79 stayed in the page and its template.

**Differs from what the inventory proposed.**

- SD-33. `dayLabel` is a direct `formatDayPill` call: a wrapper fails `creativo/no-identity-mapper`.
- `formatDayPill` and `formatDayPillRange` moved to `day-pill/day-pill.format.ts` so a presenter need not import a component file. `staff-day-pill.ts` re-exports them for the visit editor.
- `catalogue.spec-support.ts` holds the presenter specs' catalogue reader. `tsconfig.lib.json` excludes `*.spec-support.ts`, because it uses `node:fs`.

## For later, not done here

Bugs B1 to B7 stand. `footShown` keeps B2 and `dayRowVm` keeps B4, each as it was. The glyph tables are not unified with the editor's. `dayHealth` and `noticeReferenceLine` still call `translate` in a `computed`: neither is a row here.
