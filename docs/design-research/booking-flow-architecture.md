# `/book` — booking flow architecture

Design record for goal 6.5 (`docs/migration/goals/06-feature-slices.md`).
Written 2026-07-29 alongside the Phase 0/1 landing; the owner rulings in §1
are settled and should not be relitigated.

---

## 1. Owner rulings (2026-07-29)

| #   | Ruling                                                                                                                                                                                                                                                                        | Consequence                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Party arrangements are flexible, not a mode.** The engine returns BOTH parallel (all seats one start, different barbers) and sequential (chained starts, one barber can serve two seats) arrangements; the UI shows what exists rather than asking the user to pick a mode. | `AvailabilityOption { envelope, assignments[] }` with a per-seat slot. The only scheduling invariant is **two assignments naming the same barber must not overlap** — which makes "father & son, same barber, back to back" a first-class case instead of an error.        |
| 2   | **The booking write goes through a Cloud Function** — `onCall` + `runTransaction` + a server-side availability re-check, with a public `busy` projection feeding the slot grid.                                                                                               | The current client `setDoc` path allows double-booking; `slot_unavailable` becomes a real, typed error with a bounce-back to the schedule step.                                                                                                                            |
| 3   | **`/book` is unguarded.** Browse and build anonymously; "Sign in to confirm" on review, draft surviving the round trip.                                                                                                                                                       | `BookingParty.ownerId: UserId \| null` + a one-way `claim()`. HIG: pair the auth prompt with its benefit rather than wall off window-shopping.                                                                                                                             |
| 4   | **Payment / deposit / tip deferred, seam left open.**                                                                                                                                                                                                                         | Per-seat price snapshots into `Seat.terms` (needed for totals anyway) so a `Payment` VO slots in later without a Firestore migration. Rewards/promo still land — `libs/domain/engagement` already has coupons, `DiscountApplication` and reward programs built and tested. |

Ruling 1 is the one that shapes everything: it is why barber and variant move
from the appointment root onto the seat, and why availability is an
assignment problem rather than a single-barber slot query.

---

## 2. What already existed

Worth stating, because it is much more than the placeholder suggested:

- `libs/application/booking` — a pure `advanceBookingFlow` machine, `CreateBookingUseCase`, `CancelAppointmentUseCase`, `ObserveUpcomingUseCase`, a `BookingDraftStore` port with a `sessionStorage` adapter.
- `libs/domain/scheduling` — `Appointment` (aggregate, status transition matrix), `Seat`/`SeatSubject`, `BookingParty` (with the §7.7 monotonic-`GuestId` fix), `TimeSlot`, `SeatLabel`, `WorkingHours`.
- `libs/domain/catalog` — `Service` with the FULL terms matrix (`variants`, per-barber `offerings` with sparse per-variant overrides, `termsFor(barber, variant)`, `priceRange`), plus a `conflictsWith` list that nothing consulted.
- `libs/domain/engagement` — coupons, `CouponValue`, `CouponGrant`, `DiscountApplication` (with the §7.4 deterministic-ordering fix), reward programs, milestones, invitations.

The three real gaps were: per-seat barber/variant, any availability engine at
all (`WorkingHours` was orphaned and cannot generate a slot), and waitlist.

---

## 3. Phase plan

Each phase is independently shippable behind the already-live `/book` route
and ends green on `pnpm nx run-many -t lint typecheck test`.

### Phase 0 — unblock _(landed)_

`pnpm nx sync` (the workspace was out of sync; ~15 libs had drifted or stale
references, four naming a `libs/features/marketing/shell` that does not
exist). Seeded `locations` with real hours/timezone/geo, populated
`locationIds` on barbers, and authored a real `conflictsWith` haircut family
— `svc-finish` deliberately one-way so symmetric normalisation is exercised
against seeded data. Added the `booking.*` i18n namespace to both locales.

**Note:** the sync UNMASKED eight pre-existing type errors and two lint
errors that the "workspace is out of sync" abort had been hiding — all in
spec/test-support files, all fixed in the same pass. `run-many -t lint
typecheck test` had not actually been runnable before this.

### Phase 1 — the shell walks _(landed)_

`BookingParty` gains `createAnonymous()`, `claim()`, `renameGuest()` and a
nullable owner. New `BookingCart` domain (`SeatKey`, `CartLineId`,
per-seat lines, monotonic line ids, `dropSeat`). The flow carries the cart
from `guests` onward and its errors became `DomainError` subclasses with
`booking.flow.*` codes. `BookingDraft` rewritten as the aggregates' own
`reconstitute` props, so the storage adapter is a JSON round-trip and the
domain owns validation. `BookingFlowStore` + the `?step=` history contract.
The party step.

### Phase 2 — cart, services step, conflicts _(landed)_

**Domain.** `service-conflicts.ts` in `domain/catalog` with three rules:
authored conflicts normalised symmetrically (a manager writes one
direction, not both), bundle↔member derived from `composition`, and
conflicts INHERITED through bundle membership. That third rule was found by
exercising the flow against real seeded data — without it a second haircut
could be smuggled in inside a bundle. It needs the catalog to resolve
members, so the functions take an optional `catalog` and degrade to the
shallow rule without one.

`Seat` gained `variantId`, `barberId`, `terms` **and its own `slot`**;
`Appointment` dropped root `barberId` and now DERIVES `timeSlot` as the
envelope over its seats, so the party block and the seats cannot disagree.
The one new invariant is `AppointmentBarberDoubleBookedError` — two
assignments naming the same barber must not OVERLAP, which is what makes
"same barber, back to back" legal and "same barber, same moment"
impossible. Also `barberIds()`, `subtotal()`, `longestSeatMinutes()` and a
mixed-currency guard. `ServiceTerms.fromMinorUnits` was added so callers
outside catalog never construct a kernel `Money` themselves.

**Feature.** `OnboardingServiceCard` promoted to `cr-service-card` in
`features/shared/catalog` (onboarding switched, duplicate deleted);
`cr-service-detail-sheet` gained a `[sheet-configure]` slot and
`uiVariantsPresentation` so the SAME sheet becomes "add to bag" with live
variant + barber pickers and a price that moves with them. New
`CatalogContentService` extracted when booking became the third consumer of
the same catalog + media-cache loading. Services step with person-scope
chips, blocked-card treatment and the bag sheet.

**Selection is a count, not a boolean** — a seat may hold two lines of one
service, so the card chip shows a number past one.

### Phase 3 — availability

**Superseded by
[availability-and-statistics-design.md](./availability-and-statistics-design.md)**
(2026-07-29), which is the binding design after a research pass into how the
model survives changing service durations and changing barber schedules, and
how per-barber statistics fall out of the same artefact.

The one-line summary: **one document per (barber, calendar day), holding
rostered working windows plus typed busy intervals — never a slot list.**
Intervals are duration-agnostic, so a catalog edit cannot stale them; windows
are materialised from an immutable effective-dated schedule version, so an
hours edit cannot rewrite history. The same document answers "when can I
book?" and "why was Ivan busy?".

### Phase 4 — review, confirm, authoritative write

`createBooking` callable with `runTransaction` and a server-side re-check;
`BookingGateway` port + callable adapter; `slot_unavailable` bounce-back.
DS: `ui-labeled-content`, `ui-empty-state`. Review + confirmed steps.

### Phase 5 — waitlist

`time-window.ts`, `waitlist-pref.ts` (monotonic ids — v2's bug 7.7 has an
unfixed half here), `waitlist-request.ts`, `waitlist-match.ts`. Multi-select
calendar → one summary row per day → per-day window sheet, presets first.
The "we found a match" sheet jumps straight to review.

### Phase 6 — money

Wire `QuoteBookingUseCase` to the existing `ApplyDiscountsUseCase`. Two live
gaps to close there: `DiscountInput` needs `combinability` (an `exclusive`
coupon silently stacks today) and `Coupon` needs a `code` field so the
already-written `VoucherCode` VO has a redemption path.

---

## 4. UX decisions worth keeping

- **The party step opens already answered.** "How many guests?" is the wrong
  first question — the common answer is _just me_, and asking implies work.
  You appear alone on a list with one way to add someone. Adding opens no
  sheet: it appends a guest with a placeholder name and focuses an inline
  field. A modal to collect one word is the friction HIG asks us to remove.
- **The cap explains itself.** At `MAX_PARTY_SIZE` the add row is not
  rendered and a quiet `aria-live` counter states why. A disabled control
  that never says why is a defect (the onboarding services-cap precedent).
- **Conflicts do not disable the card.** A blocked service dims via the
  foreground role (never opacity) and carries a badge, but still OPENS —
  because the explanation has to be reachable. Inside, the primary is
  disabled and a `ui-status-indicator` names the blockers, with a "Replace
  it" action that swaps in one dispatch.
- **Variant selection is inline in the sheet, not a menu.** `ui-menu`'s own
  docblock rules menus out for value selection, and the variant _changes the
  price on the CTA_ — a menu would hide that relationship behind a dismissal.
- **The waitlist is never offered before the user has seen there is nothing.**
  Offering it up front advertises failure.
- **No confetti on the waitlist terminal.** Celebrating a non-booking is
  dishonest, and the confetti moment has to stay rare enough to mean
  something.

---

## 5. Two DS changes made in Phase 1

1. **`lib-booking-step-layout`** (feature-local, not `libs/ui`): the shared
   measure column + spacer + action bar. It exists because
   `ui-page-action-bar` only pins as the last child of the full-height
   column, so the bar cannot live inside a step's content column. `/auth`
   solves this by repeating the wrapper in every `@switch` arm; five booking
   steps would make that five copies of one measure. **Every step using it
   must set `:host { display: contents }`** or its own host becomes the flex
   item and the bar strands under the last row.

2. **`nx typecheck` does NOT catch Angular template errors.** It runs
   `tsc --build`, not the Angular compiler, so a missing component import
   or a bad binding passes typecheck and only fails at build. Run
   `pnpm nx build web` as part of verifying any template change — two
   rounds of template errors reached the browser before this was noticed.

3. **`ui-list-row`'s trailing-slot ink now guards DS controls**
   (`:not(.ui-button):not([data-foreground-style])`) — the same guard the
   global bare-anchor rule already carries. Previously the slot's
   secondary-label colour outranked a button's own ink on equal specificity
   by mere import order, painting a `uiRole="destructive"` remove button
   grey. Trailing _detail_ is de-emphasised; controls are not.

---

## 6. Still open

- **Who authors barber schedules?** `barberSchedules` needs a write surface:
  a staff admin UI (new work), a `tools/` script, or derive from
  `Location.hours` until an admin exists. Also: are buffers per-barber (a
  fixed turnaround) or per-service (cleanup after a colour)? The
  `StaffSchedule` shape assumes per-barber.
- **How does a waitlist match reach the user?** The only sender in the repo
  is `ConsoleLogOtpSender` and `NOTIFICATION_READER` is a declared stub, so
  Phase 5 either needs a delivery lane or ships "check back in the app".
- **Do guests need real names?** If "Guest 2" is acceptable the inline rename
  is polish; if the barber's day-sheet needs real names, the party step needs
  required-field validation and review needs to surface what is missing.
- **Waitlist as files in `libs/domain/scheduling` or its own lib?** Currently
  planned as files in scheduling — every waitlist invariant is scheduling
  vocabulary. Splitting later costs a generator run; unifying later costs a
  rename across imports.
