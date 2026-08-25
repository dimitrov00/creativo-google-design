# Staff surfaces — what a staff account should see

**Status:** proposal, pending owner rulings (§10)
**Scope:** the `/staff` area — its navigation, its screens, and the domain gaps each one implies
**Date:** 2026-08-05

---

## 1. The one-paragraph shape

`/staff` today is one route rendering one component — the day sheet — for all five staff roles. That is the wrong shape, because a barber between cuts and an owner doing Sunday payroll share almost no needs. This proposal turns `/staff` into a **shell whose tab set is computed from the session's roles**, and fills it with five surfaces: **the day** (live, mostly built), **the client** (a visit sheet with history — the thing that turns a booking app into a shop tool), **the money** (revenue attribution now, tender-and-tip recording next, payment processing never on this pass), **the numbers** (the statistics fold is already written; it needs persistence and two screens), and **the shop** (roster, catalog, team, policy — four different products, staged). Feedback is proposed as a genuinely new bounded context, seat-scoped and private by default. The single most urgent item in the whole document is not a screen: three write-time fields and `SeatOutcome` are **unrecoverable if not captured now**, and every retention and quality metric downstream depends on them.

---

## 2. The central decision: role-shaped navigation, not permission-hidden UI

`STAFF_ROLES` is a five-member set — `barber | receptionist | content_manager | admin | sysadmin` ([user-role.ts:44](../../libs/domain/accounts/src/lib/user-role.ts:44)) — and `firestore.rules`' `isStaff()` mirrors it exactly. One route serves all of them ([app.routes.ts:89](../../apps/web/src/app/app.routes.ts:89)).

**Ruling: compute the tab set from roles. Never render a surface and disable it.**

A greyed-out "Revenue" tab tells a barber that shop revenue exists and is being kept from them, which is worse for morale than not offering it — and it invites the assumption that the boundary is cosmetic. It is not: it must be a `firestore.rules` boundary too (§9.1).

| Persona           | Roles               | Context                             | Home              | Must never see           |
| ----------------- | ------------------- | ----------------------------------- | ----------------- | ------------------------ |
| **The chair**     | `barber`            | Phone, one hand, ~30 s between cuts | _My day_          | Another barber's takings |
| **The counter**   | `receptionist`      | Desk, open-to-close                 | _Shop day_        | Payroll, margins         |
| **The office**    | `admin`, `sysadmin` | Laptop, weekly cadence              | _Insights_        | —                        |
| **The copy desk** | `content_manager`   | Occasional                          | `/admin/programs` | Client identities (§9.2) |

Proposed route tree — every leaf gets its own `rolesGuard`, matching the same grouping the rules enforce:

```
/staff                       barber receptionist admin sysadmin
  /staff/day                 …  the shop's day (existing dashboard, promoted)
  /staff/me                  barber              …  one lane, mine
  /staff/clients             receptionist admin  …  search, visit history, notes
  /staff/waitlist            receptionist admin  …  standing requests + live matches
  /staff/money               barber (own) · admin (shop)
  /staff/insights            admin sysadmin      …  barber sees own scorecard at /staff/me
  /staff/shop/*              admin sysadmin      …  roster · catalog · team · policy · audit
/admin/programs              content_manager admin sysadmin   (exists)
/admin                       admin sysadmin      impersonation (exists)
```

`content_manager` is deliberately absent from `/staff/*`. It is a copy-and-media role; see §9.2 for why its current access is a privacy problem.

---

## 3. What exists today — audited, not assumed

| Capability                                                  | State                                         | Where                                                                                                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Day sheet, lanes per barber                                 | **built**                                     | [staff-dashboard.ts](../../libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.ts), [staff-day.store.ts](../../libs/features/staff/dashboard/src/lib/staff-day.store.ts) |
| Lifecycle verbs (confirm/complete/no-show/cancel + reason)  | **built**, server-side + audited              | `transitionAppointment`                                                                                                                                                                    |
| Booking commit / cancel / reschedule                        | **built**, callable-only                      | [main.ts](../../apps/functions/src/main.ts)                                                                                                                                                |
| Availability engine, capacity rollups                       | **built**                                     | `rebuildCapacityOn{Busy,Exception,Location,Roster,Settings}Change`                                                                                                                         |
| Waitlist request / cancel / match                           | **built server-side, zero UI**                | `matchWaitlistOnBusyChange`                                                                                                                                                                |
| `BarberDayTotals` + `foldBarberDay`                         | **built**                                     | [barber-day-totals.ts](../../libs/domain/scheduling/src/lib/barber-day-totals.ts)                                                                                                          |
| Occupancy reasons, frozen classification, revenue per block | **built**                                     | `occupancy-block.ts`, `occupancy-class.ts`                                                                                                                                                 |
| Audit log (append-only)                                     | **written, never read**                       | `auditLog`, admin-only                                                                                                                                                                     |
| Booking policy as a tenant document                         | **built, no editor**                          | `settings/bookingPolicy`, `allow write: if isAdmin()`                                                                                                                                      |
| Impersonation, programs editor                              | **built**                                     | `/admin`, `/admin/programs`                                                                                                                                                                |
| Statistics **persistence** (day ledger, period rollups)     | **absent** — no collection, no rules, no port | —                                                                                                                                                                                          |
| `bookedAtMs`, `bookedFromAppointmentId`, `SeatOutcome`      | **absent**                                    | §6.1                                                                                                                                                                                       |
| Feedback / ratings                                          | **absent entirely**                           | §5                                                                                                                                                                                         |
| Tips, tender, payments                                      | **absent entirely**                           | §7                                                                                                                                                                                         |
| Roster editor, catalog editor, team/roles UI, client search | **absent**                                    | §8                                                                                                                                                                                         |

Two things in that table are easy to misread and worth stating plainly. The statistics **fold** is done — `foldBarberDay` even exceeds the original design with an overtime term (owner ruling R1). What is missing is somewhere to put the result and something to draw it. And the barber ratings visible on the marketing site are literals — `rating: 4.9` at [landing-content.ts:144](../../libs/features/marketing/landing/src/lib/content/landing-content.ts:144) — with no backing model. `catalog-to-vm.ts` deliberately declines to invent one.

---

## 4. Appointments — the spine

The day sheet is sound: real lanes, `canTransition`-driven verbs, no optimistic local mutation. Six gaps, ordered by revenue leaked.

**4.1 Walk-in in one tap.** `BookingOrigin: 'walk_in'` and `SeatLabel` (`'Walk-in 14:30'`) already exist in the model. An unrecorded walk-in is invisible revenue _and_ a permanent hole in every utilisation figure computed afterward. Note the constraint that makes this non-trivial: `appointments` is `allow create: if false` for everyone including staff, and the rules comment explains exactly why — a direct write updates no projection and double-books by construction. **The walk-in path must go through `commitBooking` with `origin: 'walk_in'`**, not around it.

**4.2 Now-line and "who's next."** The highest-value pixels on a barber's phone: the client currently in the chair, and the one after. Everything else on that screen is secondary.

**4.3 The visit sheet.** Tapping a row should open the person, not just the booking: last visit, what they had, with whom, contact notes, no-show count, rebooking status. The data exists today (`appointments` is staff-readable, `Seat.terms` is snapshotted); nothing assembles it. This is the single change that most raises the shop's opinion of the tool.

**4.4 Waitlist queue.** `requestWaitlist` / `cancelWaitlist` / `matchWaitlistOnBusyChange` all ship, and the rules already say staff may read all of them because _"who is waiting for Saturday" is a question the shop legitimately asks_. There is no screen. A match fires into a client's notification inbox and no one at the shop ever sees the demand signal.

**4.5 Absence entry.** `ScheduleException` models `break | time_off | sick | training | travel | admin`, and `rebuildCapacityOnExceptionChange` is wired. Blocking two hours is the second most common staff write after status changes, and today it requires editing Firestore by hand.

**4.6 Per-barber "my day."** Five lanes is the counter's view. The barber wants one lane — theirs — and the store already keys lanes by `barberId`, so this is a filter, not an architecture.

---

## 5. Feedback — a new bounded context

Nothing exists. Four rulings matter more than the screen does.

**5.1 Rate the seat, not the appointment.** Identical reasoning to `SeatOutcome`: a party of three has three barbers and three experiences. An appointment-level rating is unattributable the moment a party is mixed, which is exactly when quality signal matters most.

**5.2 Private by default; publishing is a separate, moderated act.** Feedback is first an internal quality signal. Auto-publishing to the marketing site is a legal and human problem the first time a named one-star lands. Proposed states: `submitted → triaged → (published | withheld)`, with publication requiring an admin action and stripping the author to a first name.

**5.3 Trigger on `outcome: 'worked'`, ~2 h later, through the existing inbox.** `NotificationKind` is a closed union and would gain one arm. Anonymous seats have no channel and simply cannot be asked — that is honest, and the response-rate denominator must exclude them rather than quietly counting them as silence.

**5.4 The product is the triage queue, not the average.** A 4.7 mean tells an owner nothing actionable. A list of everything ≤ 3★ with a _"we called them"_ resolution is a retention machine: a bad visit caught inside a day is usually a saved client. Build the queue first and the aggregate second.

Barbers should see their own verbatims. Withholding them reads as management keeping a file, and the motivating effect of a good one is most of the reason to collect them at all.

Per-visit NPS is spam. If a shop-level "would you recommend us" is wanted, ask it monthly at most.

---

## 6. Statistics — surfacing, plus one urgent debt

**6.1 The debt. Do this before any screen.**

> Three fields and one union are **unrecoverable if not captured at write time**. There is no query, backfill, or repair that reconstructs them later.
>
> - `bookedAtMs` — `Appointment` currently carries no temporal metadata at all, so **booking lead time is uncomputable and always will be** for everything booked before the field lands.
> - `bookedFromAppointmentId` — rebooking rate, the single best retention predictor a barbershop has (30–40 % typical, 65 %+ elite).
> - a daily first-available lead-time sample — forward-looking; destroyed the instant someone books.
> - `SeatOutcome` — without it, a party where one guest no-shows has **no representable state**: mark the appointment `no_show` and two completed services and their revenue vanish; mark it `completed` and the no-show is invisible. `Appointment.status` becomes a derived summary of its seats.
>
> Every day this waits is a day of history that cannot be bought back.

**6.2 Persistence.** The fold exists; give it somewhere to live — `barberDayLedger/{barberId}__{day}`, then `barberPeriodStats` and `shopPeriodStats` rolled from the day ledgers by recompute (never `FieldValue.increment`; the ban and its reasoning are already argued in the availability design). All three need `firestore.rules` entries, all staff-only, and the day ledger is the staff-side sibling of the public `barberBusy` doc — it carries reasons, revenue, and identity, and must never be confused with it.

The built `BarberDayTotals` is missing five members the metric set needs: `cancelledCount`, `lateCancelledCount`, `appointmentCount` (average ticket — a party of three is _one_ ticket), `anonymousSeatCount`, and `sellableGapCount` (fragmentation). Add them to the fold before persisting, or the ledger's schema churns immediately.

**6.3 Two screens, not twenty tiles.**

_Barber scorecard (own, on `/staff/me`)_ — utilisation, idle gaps and fragmentation, no-show rate, rebooking rate, average service value. Framed as coaching. The classification already rules `training` and `travel` out of the denominator because _punishing a barber for a shop decision is wrong_; keep that reasoning visible in the copy, or the screen will be read as surveillance.

_"Where did the sellable hours go" (owner)_ — one stacked bar: rostered → productive / buffer / no-show / admin-blocked / idle. That picture is the whole business. The fragmentation ratio is what distinguishes 60 % utilisation as one three-hour hole (a **demand** problem — marketing) from eight twenty-minute slivers (a **scheduling** problem — fixable in `slotStepMinutes` and buffers). No other single chart separates those two.

---

## 7. Revenue and tips — the honest split

**There is no payment layer.** `Money`, `ServiceTerms.price` and `OccupancyBlock.revenueMinorUnits` all exist; nothing collects anything. So this is two products with a factor-of-twenty cost difference between them.

**(a) Revenue attribution** — _what the book earned_. Derivable now from the commit-time `Seat.terms` snapshot plus outcome. No provider, no PCI, no reconciliation, no refunds. Gives the owner their numbers and payroll its basis.

**(b) Payments and tips** — needs a tender model: what was actually taken, by which method, what discount applied, what tip, what VAT. A real project with an external dependency.

**Recommendation: build (a) now, and add a "close the visit" step that _records_ tender without _processing_ it.** Completing a visit asks: cash / card / other, and tip. A Bulgarian barbershop takes mostly cash. This yields daily cash-up, a tip ledger, and a payroll basis for roughly five percent of the cost of a payment integration — and if a provider is integrated later, the recorded-tender model is exactly the shape the reconciliation reads.

Four rulings that prevent a rewrite:

1. **Tips attach to the seat**, not the appointment. The tip belongs to whoever did the work; on a mixed party an appointment-level tip is unsplittable.
2. **Tips never enter utilisation or RevPAH.** They are not shop revenue under most arrangements, and folding them in makes the capacity KPI unreadable. Separate column, always — alongside `revenueMinorUnits`, never inside it.
3. **Gross and net must both surface.** `libs/application/engagement` already has coupons, grants and `apply-discounts`. A visit that reports only the list price is a lying number the moment a coupon is redeemed.
4. **Commission percentage per barber** → _"what do I owe Ivan this week."_ This is the owner's actual weekly job and the thing that makes them open the app on a Sunday. It is also the reason `/staff/money` must be role-split at the rules layer, not the template layer.

---

## 8. "Managing everything" — four products, ranked

| #   | Surface            | State                                                                       | Why it ranks here                                                                                                                                                                                                                                               |
| --- | ------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Roster & hours** | Modelled + triggers wired; **no UI**                                        | Changing a barber's hours means hand-editing Firestore. `rebuildCapacityOnRosterChange` already reacts, so the UI is the only missing piece.                                                                                                                    |
| 2   | **Catalog**        | Seed script only ([seed-dev-catalog.mjs](../../tools/seed-dev-catalog.mjs)) | Terms resolve **per barber and per variant** (Ivan 35/50, Niko 30/45, Stefan flat 45). An editor that hides that axis produces wrong bookings, silently.                                                                                                        |
| 3   | **Team & roles**   | `grantRoles` / `blockUser` unbuilt                                          | Onboarding a new barber is currently impossible in-product.                                                                                                                                                                                                     |
| 4   | **Clients**        | `findClients` unbuilt                                                       | Merging an anonymous walk-in into a real account is the CRM primitive §4.3 and §5 both depend on.                                                                                                                                                               |
| 5   | **Booking policy** | Document + admin write rule exist; **no editor**                            | Target the _implemented_ shape — `maxPartySize`, `slotStepMinutes`, `minLeadMinutes`, `horizonMonths`, `cancellationWindowHours`, `maxFlexibleDays` — not the names in the older design doc. Show a preview: _"60-minute notice adds ≈ N bookable slots/week."_ |
| 6   | **Audit reader**   | Log written, **never read**                                                 | `auditLog` already records who cancelled what and why. A read-only admin view is nearly free and buys disproportionate trust.                                                                                                                                   |
| 7   | **Reminders**      | Absent                                                                      | The highest-ROI no-show reducer available. `NotificationKind` already has `appointment_reminder`; nothing schedules one. Must ride the campaign sender identity, never the OTP sender.                                                                          |

---

## 9. Cross-cutting constraints

**9.1 Every new surface needs its rules pair.** The guard/rules agreement is already load-bearing and commented as such in `app.routes.ts`. New collections (`barberDayLedger`, period stats, feedback, tender) all default-deny until explicitly opened, and the money surfaces need a _per-barber_ read boundary, not a blanket `isStaff()`.

**9.2 Two authorization findings worth fixing while the area is open.**

- `appointments` is `allow read: if isStaff()`, which includes `content_manager` — a copy-and-media role that can currently read every appointment, every client name, phone and note in the shop. Narrow it to the roles that work the book.
- `barberSchedules` and `scheduleExceptions` are `allow write: if isStaff()`, so any barber can rewrite any other barber's roster, and a `content_manager` can rewrite all of them. Utilisation history divides by these documents. Narrow to self-or-manager.

**9.3 GDPR.** `sick` is Article 9 special-category health data — the availability design already builds the entire public-projection boundary around keeping it out. The same discipline applies _inside_ staff surfaces: a receptionist sees "unavailable"; only a manager sees why. Feedback verbatims and client notes are personal data and need a stated retention policy before they are collected, not after.

**9.4 Never render a fabricated number.** The moment staff catch one invented statistic, they discount the entire surface — including the correct ones. The marketing site's hardcoded ratings should read as provisional until §5 makes them real.

**9.5 Two form factors.** The chair is a phone held in one hand between cuts; the office is a laptop. The existing standards hold: the 36/44/52 control scale, and every hover affordance carrying an ungated `:active` mirror so a tap shows what a hover would.

**9.6 Copy.** The day sheet earned real `staff.*` keys in both catalogs, unlike `/admin/programs`' hardcoded English. Anything a barber or receptionist reads between clients gets the same treatment; genuinely internal admin tooling may keep the English posture.

---

## 10. Open questions needing an owner ruling

1. **Does a barber see their own revenue, or only their own hours?** Changes the rules boundary and the payroll conversation. _Recommended: own revenue and own tips, never anyone else's._
2. **Commission model** — flat percentage, per-service, or tiered by volume? Determines whether commission lives on `Barber` or on `ServiceTerms`.
3. **Is feedback ever published to the marketing site?** If never, the model simplifies considerably. _Recommended: build private-only first; decide publication after three months of real data._
4. **Does `receptionist` get client notes?** They are the people most likely to need them and the people with the highest turnover.
5. **Tender recording — per seat or per appointment?** One party usually pays once, which argues appointment-level tender with seat-level tip attribution. _Recommended: that split._

---

## 11. Staging

| Phase | Contents                                                                                                                                      | Gate                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **A** | ~~`bookedAt`, `bookedFromAppointmentId`, daily lead-time sample, `SeatOutcome`~~ · `BarberDayTotals`: `appointmentCount` + `sellableGapCount` | **LANDED 2026-08-06.** See §11.1 for what was deliberately left out. |
| **B** | Staff shell + role-shaped nav; `/staff/me`; walk-in via `commitBooking`; visit sheet; waitlist queue; absence entry                           | The day-to-day tool. Highest user-visible value.                     |
| **C** | Close-the-visit (tender + tip, recorded not processed); barber daily take; owner cash-up                                                      | Needs ruling 1, 2 and 5.                                             |
| **D** | Day-ledger persistence → period rollups → barber scorecard → "where did the hours go"                                                         | Needs A to have been running long enough to have data.               |
| **E** | Feedback: seat-scoped, private, ≤3★ triage queue; publication flow last                                                                       | Needs ruling 3.                                                      |
| **F** | Roster editor, catalog editor, team/roles, policy editor, audit reader                                                                        | Also fixes §9.2.                                                     |

Phase A was the only one with a deadline, and it is a domain-and-write-path change with no UI attached — which makes it easy to defer and expensive to have deferred.

### 11.1 What Phase A left for Phase D

Three of the five `BarberDayTotals` members named in §6.2 are **not** in the fold, because each needs a fact the day document does not yet carry:

- **`cancelledCount` / `lateCancelledCount`** need `DayEvent`. A cancellation must REMOVE its occupancy block (the time genuinely returns to sellable, and availability depends on that) while still being COUNTED — which is only expressible as a second list beside `blocks`. That list does not exist yet. Note this is _not_ lost data: `SeatOutcome` now records every cancellation with its instant, its actor and a typed reason on the appointment, so the day ledger can be built from source when it lands.
- **`anonymousSeatCount`** needs a subject flag on `OccupancyReason`'s `service` arm. The reason carries `appointmentId` and `seatId` but says nothing about whether the seat had an account behind it, and the day document must never carry the `userId` that would answer it directly.

The two that did land — `appointmentCount` and `sellableGapCount` — were the ones derivable from what a block already knows, plus `fragmentationRatio` to make the second usable.

One correction to §6.1 as originally written: `bookedAt` is stored as a `ZonedDateTime` (persisted as `{iso, zone}`), not raw epoch milliseconds, because `Appointment` deals in zoned instants everywhere else and a staff surface has to render the booking time in shop time. `SeatOutcome.atMs` _is_ epoch milliseconds — it is an instant that only ever gets subtracted from another instant, and `OccupancyBlock` already stores its instants that way.
