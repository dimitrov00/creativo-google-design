# The staff sheets' known bugs (B1 to B7, BUG-1 to BUG-9)

Fixes for the bugs listed in `docs/architecture/review/f08-dashboard-inventory.md` and `f08-editor-inventory.md`. Each bug got a spec that failed before its fix. BUG-3 was already fixed.

## Dashboard

| Bug | Reproduced | What changed                                                                                                                                                                                    | What a user sees                                                                                                                                                                                                             |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Yes        | `blockInsteadFromEditor` holds the range in `blockAfterCancel`, naming its visit. A landed cancel opens the block sheet only for that visit; `dismissCancel` drops it.                          | «Откажи и блокирай» asks the reason first. The block sheet opens only once that visit's cancel landed. Dismissing or a refusal leaves the visit as it was, and another visit's cancel landing changes nothing on this sheet. |
| B2  | Yes        | `footShown` and the card share `printedTag`.                                                                                                                                                    | A cancelled row with only a tag has no empty foot. It shows only with the avatar switch on, since otherwise the state glyph sits on the foot.                                                                                |
| B3  | Yes, both  | `offOn` asks `RosterSystem.offAllDay`, and `rosteredNowhere` is gone. A lane says `rosterRead`, which `offAllDay` needs.                                                                        | A chair whose read failed is not called off, and gets no whole-day lift. While the roster is unread or failed, no chair is drawn as off.                                                                                     |
| B4  | Yes        | The row names a companions-only chair from `companionNames`. A new `contactLabel` keeps the booker's name for what sits beside his number and account: the call button, photos and a rebooking. | The son's card prints the son. A seat holds no name for a companion: until his profile answers, or for an account that never registered, the row still prints the booker.                                                    |
| B5  | Yes        | `VisitDraftSystem.rebook` over `pastLegsOnCatalogue`, the rule «Запиши пак» and «Повтори» now share. An unread catalogue keeps every leg. `leftOffNoticeOf` words the rest.                     | A rebooked draft shows today's price on its chair. A service the catalogue really no longer sells is left off, a line says so, and the span follows the legs that remain.                                                    |
| B6  | Yes        | `moveScheduleBlock` lifts and writes in one `writeScheduleException` transaction. `LocationScopeSystem.homeOrFirst` picks the shop. `StaffDayStore.saveBlocks` runs the plan.                   | A refused edit keeps the old block. A chair serving every shop is filed at the first shop. Only a deployment with no shop at all leaves the sheet open on `staff.day.blockFailed`.                                           |
| B7  | Yes        | `titleFieldOf` in the search presenter.                                                                                                                                                         | The hit's title is the contact, else the seat's person, else «Клиент без име». Another field takes it only with no person at all.                                                                                            |

**B5, traced.** `StaffEditPlanSystem.bookingRequest` sends no price and no minutes. `BookingDecisionSystem` prices the seat with `OfferingPriceSystem.termsFor` and refuses a service it cannot find. So the old price was never what got charged.

**B5, what is left off.** Only a catalogue that answered can say a service is gone (`servicesKnown`); pending or failed, the legs stay as stored. The sheet's line:

- bg «Вече не е в каталога: {{services}}. Избери друга услуга.»
- en "No longer in the catalogue: {{services}}. Pick another service."
- With no name at hand, since a seat holds only the id of a service gone from the catalogue: bg «Услуга от това посещение вече не е в каталога. Избери друга.», en "A service from this visit is no longer in the catalogue. Pick another."

**B6, how.** The port takes many keys in one transaction, so one atomic write was available. The sibling option, writing before lifting, was not needed. An edited block on several chairs now lands whole or not at all. A new block stays one pass per chair. The emulator suite runs the move over the real adapter.

**B6, the shop.** `locationIds: []` means every location and `homeOf` leaves the fallback to its caller. The page already starts a new visit at the first shop for such a chair, so the block is filed there too. Nothing reads an exception's `locationId` beyond storing it.

## Visit editor

| Bug   | Reproduced    | What changed                                                                                                              | What a user sees                                                                             |
| ----- | ------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| BUG-1 | Yes           | `VisitDraftSystem.storedSeats` feeds `LegRowVm.stored`; the template offers the chip only on an added seat.               | See below.                                                                                   |
| BUG-2 | Yes           | The same flag.                                                                                                            | See below.                                                                                   |
| BUG-3 | Already fixed | Nothing. Pinned by «previews what «Приложи» will do» in `staff-visit-editor.spec.ts`.                                     | Unchanged.                                                                                   |
| BUG-4 | Yes           | The list moved to `chairOptionsOf` in the presenter, and asks by the chair's own key.                                     | The roster-less chair list shows the chair once. Fallback path only.                         |
| BUG-5 | Yes           | `sameSave` and `commandsFor` share `sameDiscounts`.                                                                       | Reordering discounts no longer raises «Запази» over a batch that sends nothing.              |
| BUG-6 | Yes           | `FRAME_MIN_MINUTES` is gone. The frame binds the grain, as the block sheet does.                                          | The frame's drag stops at 5 minutes, where a typed length does, not 10.                      |
| BUG-7 | Yes           | `lastVisitDate` reads `intlLocale`.                                                                                       | English says «4 September», not «September 4».                                               |
| BUG-8 | Yes           | `formatCurrencyUnit` in `@creativo/ui/wall-clock`. The key `staff.visit.currencySymbol` left bg and en.                   | A BGN bill's typed tip and discount read «лв.», not «€». EUR bills read as before.           |
| BUG-9 | Yes           | `photoPersonOf`: the client record, the visit's account holder, a guest's draft key, then the label where there is no id. | Two people of one name no longer share a face. A companion the book does not list keeps his. |

**BUG-1 and BUG-2, checked first.** Another person: not dirty, nothing sent. Another variant with equal minutes: not dirty, nothing sent. Another variant with different minutes: dirty, and only a `REDURATE` goes, while the price stays behind because `typedPriceCents` is null. The plan's spec pins all three.

**What the staff member now sees.** On a visit already saved:

- The round face chip («За кого») and the variants chip are gone from each service row.
- The row's line still prints the variant and, on a party, whose seat it is. A gone visit's row reads the same way.
- The «−» stays.
- If the visit's only person holds a stored seat, their row on the add-client page is ticked and disabled, and the card has no «Махни от посещението». Adding another person, for a seat added for them, still works.

**How to change either.** Take the stored seat off with «−» and add the service again. That saves, as `REMOVE_SEAT` and `ADD_SEAT`. Once «−» has taken the person's last stored seat they can be unticked too, and whoever is added instead sits on the new seat.

On a seat just added, and on every seat of a new or rebooked visit, both chips stay and work. After a save, an added seat becomes a stored one and loses them.

**BUG-1, what still moves a stored seat.** A party's person still leaves with their stored seats, by the row's «−» or the add-client page. That saves for real as `REMOVE_SEAT`, and the owner's 2026-09-24 ruling is pinned by its specs. `pinnedPerson` holds only the last person, the one case that put a seat on the placeholder for someone else to take. `adoptPlaceholderLegs` also leaves a stored seat alone.

**BUG-6, the value.** Five minutes. The server admits any positive length (`DurationMinutes.of` in `placed`), `typedSpan` already writes 5, and the grain is what the block sheet's frame uses. `MIN_TYPED_MINUTES` stays at 10: it is when a half-typed figure applies, not a floor.

## Reported, not changed

- **«Повтори» on an unread catalogue** still does nothing, since its offers are empty. The rule above covers «Запиши пак».
- **Rebooked and repeated minutes.** The booking request carries no minutes, so the server books the catalogue's length. «Запиши пак» and «Повтори» show the stored one, so a stretched visit can show 45 minutes and book 30.
- **`offToday` in the store** still calls a chair resting while the roster is unread or failed. That is the question the ruling left alone.
- **A companion beside a guest,** with the booker in another chair, still prints the booker. B4 covered a chair holding only companions.
- **A roster read failing** has no line in the day's health rows; only an appointment read does.
- **`staff.day.blockFailed`** says "Try again", which will not help a deployment with no shop. New words would need bg and en.
