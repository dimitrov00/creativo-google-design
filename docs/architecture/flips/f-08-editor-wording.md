# F-08: the visit editor's wording moves into presenters

The owner ruled that wording leaves `staff-visit-editor.ts` before feature work starts. This records the WORDING rows of `docs/architecture/review/f08-editor-inventory.md`, VE-11 to VE-41, plus VE-42 and VE-43, which the earlier KEEP rulings covered only for pass C's scope. Every row was checked against the source first. The decisions had already moved (`f-08-staff-decisions.md`).

`staff-visit-editor.spec.ts` is unchanged: not one line, so every DOM and text assertion passes as it stood.

## The rows

Files are in `libs/features/staff/dashboard/src/lib/visit-editor/`: `visit-editor.vm.ts` (types and tag tables), and the presenters `visit-editor.presenter.ts` (E), `visit-discount.presenter.ts` (D), `visit-client-row.presenter.ts` (C).

| Row   | What it words                                 | Now in                                                                                                                                               |
| ----- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| VE-11 | The words a presenter takes                   | `VisitEditorWords` (vm), `visitEditorWordsOf` (E), the component's `copyTable` and `words`                                                           |
| VE-12 | A percent as a figure                         | D `percentLabel`, `percentOffLabel`, `PERCENT_MARKS`                                                                                                 |
| VE-13 | A coupon's value line                         | D `couponValueLine`, `nameSaysRule`                                                                                                                  |
| VE-14 | The offers' cards                             | D `promoOfferVm`, `grantOfferVm`; `OfferChoice` (vm), now with `accessibleName`, `blockedName`, `removeName`                                         |
| VE-15 | A discount ticket                             | D `discountLineVm`                                                                                                                                   |
| VE-16 | A voucher ticket                              | D `voucherLineVm`                                                                                                                                    |
| VE-17 | The add row's whisper                         | D `discountWhisper`                                                                                                                                  |
| VE-18 | The discount row, spoken                      | D `discountRowName`                                                                                                                                  |
| VE-19 | The discount page's promise                   | D `discountApplyVm`                                                                                                                                  |
| VE-20 | The note under the code field                 | D `codeNoteOf`; `DiscountCodeState` (vm)                                                                                                             |
| VE-21 | The dock's bill                               | D `dockBillVm`                                                                                                                                       |
| VE-22 | The rulers' texts and marks                   | D `percentValueText`, `amountValueText`, `amountMarks`                                                                                               |
| VE-23 | The tip's presets and tiles                   | D `tipPresetsVm`, `tipTilesVm`; `amount` stays beside the words                                                                                      |
| VE-24 | The tip row                                   | D `tipReadoutOf`, `tipRowName`                                                                                                                       |
| VE-25 | The «Вид» pop-up                              | D `discountKindOptions`, `discountKindLabelOf`, `discountKindName`                                                                                   |
| VE-26 | The pop-ups' options                          | E `timingOptions`, `shopViews`, `photoDoors`, `dayRelatives`                                                                                         |
| VE-27 | The «Салон» row                               | E `shopReadoutOf`, `shopRowName`                                                                                                                     |
| VE-28 | The frame's narration                         | E `frameSummaryOf`                                                                                                                                   |
| VE-29 | The line under the frame                      | E `frameVerdictVm`; the verdict's call stays (VE-53)                                                                                                 |
| VE-30 | The catalogue tag and note                    | `shared/catalog-tag.words.ts` `catalogNoteWords`, beside `catalogTagWords`                                                                           |
| VE-31 | A leg's line                                  | E `legRowsVm`, `LegRowVm.line`                                                                                                                       |
| VE-32 | A leg's lookups                               | E `legRowsVm`, the component's `legRows`; `serviceOptionLine`, `servicePersonOf`                                                                     |
| VE-33 | The bar's titles                              | E `sheetTitleOf`, `editorPageTitleOf`; `sheetTitle` and `pageTitle` stay public under their names                                                    |
| VE-34 | The head of a settled chair                   | E `resolutionHeadOf`; `RESOLUTION_HEADS`, `ResolutionWord` (vm)                                                                                      |
| VE-35 | The line under a person's name                | E `clientLineOf`                                                                                                                                     |
| VE-36 | A person row                                  | C `clientRowVm`; `ClientRowVm` (vm)                                                                                                                  |
| VE-37 | The search glyph and the create row           | C `searchGlyphOf`, `createPartsOf`, `createLinesOf`, `createRowNameOf`                                                                               |
| VE-38 | The service page's promise                    | E `serviceApplyVm`                                                                                                                                   |
| VE-39 | The repeated visit's day                      | `shared/visits` `lastVisitDayOf`, on the visit clock's rule, extracted as `yearOutsideNow`                                                           |
| VE-40 | The names and lines the template concatenated | Struct fields (`forWhomName`, `variantName`, `removeName`, `accessibleName`, `blockedName`, `caption`); E `removeClientName`, `callName`, `peerLine` |
| VE-41 | The tables and display types                  | `visit-editor.vm.ts`, except `WALLET_TILE_WORDS` (below)                                                                                             |
| VE-42 | The rows' reading of the bill                 | D `discountSummaryVm`, `linesRowName`                                                                                                                |
| VE-43 | The exits                                     | E `visitExitsVm`, which calls `AppointmentLifecycleSystem.exitVerbs` itself                                                                          |

No row was left unmoved. Each presenter has a `*.presenter.spec.ts` pinning its words in `bg` and `en`, built from the app's real catalogue (`src/lib/testing/visit-editor-words.ts`), so a key that either catalogue lacks fails there.

## VE-11: the words

`rawCopy` existed because `translate()` inside a tracked `computed()` once froze the tab. It read the table with no signal, so a `computed()` worded before the load kept the key until something else moved it.

The component now holds `copyTable = toSignal(selectTranslation())`, the dashboard's own, and a `words` computed over it. The table is the one tracked read. Every lookup runs `untracked`, including the ones a figure-bearing word makes later from inside another `computed()`. `wording` adds the currency and the locale, with an `equal` so a VM recompute is not new wording. `staff-visit-editor.words.spec.ts` pins the three behaviours: a key while the table is away, the word when it lands, one struct per table.

`rawCopy` stays for `resolveDragCopy`, its only caller, because the grid fills `{{minutes}}` itself and needs the raw string.

## Departures

**Language (the one sanctioned change).** With the table reactive, a language switch under an open sheet re-words these strings at once. They used to stay until something else invalidated them. `locale` reads the table too, so the money, `nameSaysRule` and the picker move with the words instead of staying in the first language for the sheet's life. A `computed()` read before the load (the shell's bound title) now corrects itself, where it used to keep the key.

**Fewer recomputes.** The menus' arrays (`variantChoices`) are stable between changes of the draft or the visit. They were a new array on every change detection. Nothing should see this but the menu's own input.

**`WALLET_TILE_WORDS` stays in the component.** It is a test-id table keyed by `WalletAnchor`, a value only the client card's barrel exports. Moving it would load the card's Angular library into a display model. `editorCardPages` stays for the same reason.

**`nameSaysRule` keeps a re-export from the component.** The spec and the lib's barrel name it there, and it let the spec stay untouched.

**`lastVisitDayOf` passes the raw language**, as before, so BUG-7 stands.

**`src/lib/testing/**` is excluded from `tsconfig.lib.json`**, as `shared/visits` already does: the fixture reads the catalogue with `node:fs`.

## Left where the rulings put them

`applied` and `blocked` on an offer are computed in the component and carried in (VE-49). So are the struck price's comparison (VE-74), the exits' `isNew` gate and `started` (VE-52), the verdict's `GridLayoutSystem` call (VE-53), and the camera's `isCameraSupported` read.

## Decisions

None found that the decisions stage missed. Three rows sit near the line of Law 10.2, kept as form choices as the inventory classed them: `discountWhisper`'s first not-applied grant, `legLine`'s minutes (`legs.length > 1` with no override), and the cancel's `peerCount > 0` with a non-empty name list (D-2.2, D-2.3, D-2.4).

## For later

Section E's bugs are not fixed (BUG-1 to BUG-9 less BUG-3, which the decisions stage settled). The glyph tables are not unified with the dashboard (DUP-1). `staff-block-editor.ts` still has its own `rawCopy` (DUP-7).
