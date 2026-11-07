# Staff Analytics

- **Author:** Dimitar Dimitrov (owner) with Claude
- **Status:** Reviewed (2026-11-07). Open code-level findings: [implementation_checklist.md](../design-research/staff-analytics/review/implementation_checklist.md)
- **Date:** 2026-11-07
- **Predecessor:** [concepts_brief.md](../design-research/staff-analytics/concepts_brief.md)

---

## Overview

Staff Analytics adds one screen, «Анализи» (Analytics), to the staff app. A barber opens it on
their phone between clients and sees, for this week or this month: the money their worked seats
brought in (takings), the tips on top, how their rostered time was used, the bookable hours they still have
in the next seven days, which services earn the most per hour of service, and how many clients
rebooked. The admin (the shop owner) sees the same figures for every barber and for the whole
shop, plus fill by weekday and where bookings came from.

Every figure has a written definition in a versioned
[metric catalogue](#the-metric-catalogue-version-1) and opens to the seats or
days that make it up; those rows add up to the figure. For each barber-day, unsold + open time
equals the free minutes of the schedule's day summary, and takings agree with the client card's
lifetime spend to within one cent per worked seat.

**The proposed solution.** One set of written definitions; one pure system that puts each
rostered minute of a barber's day into exactly one part, built on the schedule's existing
free-time code; one shared rule that splits a bill's discount across its seats; and one server
call that computes a period's figures from the stored appointments, rosters and departures and
returns them with their own drill-down rows. The screen shows the report cached on the device,
then replaces it when the answer arrives.

This is version 1 of a staged plan; later stages are listed under
[Future Improvements](#future-improvements).

## The Problem

### The people who run the shop cannot see how it is going

The app currently shows two kinds of figures: the schedule's day summary (tips, free minutes at
one barber) and per-client numbers on the client card. Neither answers the questions the staff
ask:

- A barber: "How much did I take this month, compared with last month? How much of my day sat
  empty? Where are my bookable hours next week? Which of my services pay best for the time they
  take? Do my clients rebook?"
- The owner: "Which barbers and which weekdays are underused? Which barber is filling their
  time? Where do bookings come from?"

Without these answers, rosters, prices and opening hours are set by feel, and an empty Thursday
afternoon goes unnoticed until the month is over.

### What the competitors leave open

From [competitor-research.md](../design-research/staff-analytics/competitor-research.md): Fresha,
Square, Boulevard and Booksy build their reports for the owner. The barber gets a cut-down view
(Booksy's personal wallet), a separate app (Square Team) or a permission tier that does not reach
the phone (Boulevard "Self"). Fresha's retention reports need its paid Insights add-on. Boulevard
users ask for period-over-period change and call its reports "raw data". Square users report
totals that differ between its mobile app and dashboard. The products define the same metric
differently: rebooking is "within 24 hours of the visit ending" at Square, "same day" at
Boulevard and "any future appointment" at Fresha. Of the products surveyed, only theCut, a
barber-only app, puts the barber's own figures on the phone's home screen.

### Why a simple dashboard is not enough

A rate counts something — visits for rebooking, seats for no-shows. Below 20 of them, one more
or one fewer moves the rate by 5 points or more, so a percentage on a small base misleads; from
20 up, one moves it by at most 5. The code also holds two definitions of free time — the schedule's
20-minute sellable floor and the `capacity` projection's padded minutes with no floor — and the
[earlier statistics design](../design-research/availability-and-statistics-design.md) §4 and the
[brainstorm hypothesis](../design-research/staff-analytics/hypothesis.md) each proposed
another. Discounts apply to a whole bill with no per-seat
split. A screen built on that state would print numbers that disagree with the schedule.

## Terms

- **Shop**: the tenant — all its locations and barbers. Every figure is computed on each
  appointment's own shop date (`localDate`), so the shop needs no single time zone.
- **Barber record**: a `barbers/{BarberId}` document — one barber's column in the schedule. An
  account is _linked_ to a barber record.
- **Visit**: one appointment (one booking, possibly a party). **Seat**: one person's service on a
  visit, with its own barber, price, tip, chair time and outcome. Money and count figures drill
  down to seats; time figures drill down to days.
- **Follow-up**: a booking made from an earlier visit (`bookedFromAppointmentId` names that visit).
  An _account_ is linked to a barber record; a _follow-up_ comes from a visit.
- **Seat outcome** (`attendanceState`): `SCHEDULED`, `WORKED`, `NO_SHOW`, `CANCELLED`.
- **Chair time** (`Seat.chairTime`): setup + service + cleanup minutes of a seat.
- **Roster**: a barber's weekly pattern of working hours and breaks (`barberSchedules`).
  **Departure**: a per-day exception to the roster (`scheduleExceptions`) of one of three kinds —
  `CLOSED` (no work that day, e.g. a day off), `BLOCKED` (ranges taken out of the day, e.g. a
  2-hour meeting) or `HOURS` (the day's hours replaced, e.g. 12:00–18:00 instead of 10:00–19:00).
  Only the effect is stored, never the reason (decision D16(b),
  [ecs-migration.md](../architecture/ecs-migration.md) §9).
- **Hole**: rostered time with nothing in it — no block, no break, no seat holding the chair (the
  schedule's screens call it a free gap). The schedule draws holes of at least 20 minutes (`GridLayoutSystem`,
  `SHORTEST_SELLABLE_MINUTES = 20`).
- **`ShopNow`**: the shop's local date and minute for a location
  (`{ localDate, currentMinute, utcEpochMs }`), derived once per request from the location's time
  zone. It splits a day into past and future.
- **Compute (fold)**: derive totals from the stored records when asked, without storing the
  result.
- **Hero**: the large takings figure at the top of the screen.
- **Current (unfinished) period**: the week or month that contains today.
- **System / pipeline / port / callable**: the codebase's layers ([CLAUDE.md](../../CLAUDE.md)). A _system_
  is pure functions over plain data (no I/O, no clock); a _pipeline_ reads through _ports_ (plain
  function types an adapter implements), calls systems, and writes; a _callable_ is a Firebase
  HTTPS function wired to a pipeline.
- **Laws 3, 5, 7, 10**: the repository laws in [CLAUDE.md](../../CLAUDE.md). Systems are pure (3).
  Firestore stores a derived value only when "a privacy boundary, a busy screen's read fan-out or
  a transaction's conflict set requires it" (5). Time math uses the shop's wall clock; stored
  instants are compared only for the closed list of rules in
  [flatten-spec.md](../architecture/flatten-spec.md) §2.3 T2, and a pipeline converts an instant
  to a shop date once at its boundary (7). Presenters word what systems decided and decide
  nothing (10).
- **Roles that work the book**: `barber`, `receptionist`, `admin`, `sysadmin` (`Roles.BOOK`) —
  each of them can currently read every appointment.

## Goals

- **G1 — The barber's own figures on the phone.** For the current or a previous week or month:
  takings, tips, the time breakdown of the [catalogue](#the-metric-catalogue-version-1), bookable
  open hours in the next 7 days, seats by service with takings per hour of service, rebooked,
  no-shows and late cancellations.
- **G2 — The owner's view of every barber.** The admin sees the G1 figures per barber and for
  the shop, plus fill by weekday and the booking-origin split.
- **G3 — One definition per figure, stated on the screen.** Every v1 figure has a catalogue entry
  (formula, inclusions, exclusions); an ⓘ button shows it in words.
- **G4 — Every figure opens to its source.** For one barber, every figure opens to its seats or
  days; in shop scope, every figure opens to its per-barber split, carried in the same report. The
  listed rows add up to the figure.
- **G5 — Named figures agree.** For each barber-day, unsold + open equals the schedule's day
  summary free minutes; the seat nets behind takings and the client card's lifetime spend agree to
  within one cent per worked seat (the client card rounds per visit, analytics per seat, so a
  visit with n worked seats may differ by up to n cents). A spec pins
  both on one fixture.
- **G6 — Honest about small numbers.** A count rate (rebooked: visits; no-shows: seats) appears
  only when its base reaches 20; below that the counts show ("2 of 9"). Minute and money ratios
  (fill, takings per hour of service) always show, with their base beside them. First-month and empty periods have their own
  [states](#the-screen).
- **G7 — No lag.** With a cached report, the tap's first frame shows it; with none, the layout
  shows placeholder figures and fills in when the answer arrives. The budgets are in
  [Non-Functional Requirements](#non-functional-requirements).
- **G8 — Free time the barber can act on.** Bookable open hours ahead lead in one tap to the
  emptiest day in the schedule.

**How success is measured.**

- From the fourth week after release, at least 50% of linked barbers request their report in at
  least 3 of every 4 weeks (distinct uid per ISO week over the `AnalyticsReported` log event).
- Unsold hours per barber-week fall at least 10% against the first full month's baseline within
  3 months.
- Unmarked time (past visits not marked worked or no-show) stays at or below 5% of past booked
  time.
- Reconciliation gate before earnings: for one month, takings + tips − voucher draws are within
  2% of the shop's own cash + card total, and every difference above €20 is explained (vouchers,
  unrecorded payments).

## Non-Goals

- **Earnings and pay.** No commission, chair rent or salary model in v1; the screen says
  "takings", never "earnings". Pay comes in v2 after the reconciliation gate.
- **A security boundary on money.** Every role that works the book can read every appointment
  with its prices and tips (`firestore.rules:297`). v1 does not change that; the
  [visibility table](#visibility) is enforced by what the callable returns. Any money that is
  derived and stored later goes in a `restricted/` subdocument, as `clientStats` does.
- **Ranking barbers on a barber's screen.** Barbers see only themselves in v1.
- **One free-time number for `capacity`.** The `capacity` projection keeps its own figure: it is
  the public "can a client book" number, padded by the turnaround and limited to the booking
  horizon. Analytics reports how the barber's time was used. No screen shows the two side by side.
- **Changing the roster permission.** `mayEditRoster` (`firestore.rules:63`) stays as it is in v1.
- **Later stages** — see [Future Improvements](#future-improvements).
- **Push notifications, retail sales, marketing campaigns, an AI chat over the data, a data
  warehouse, client-facing analytics.**
- **Storing the private reason for a block** (sick, training): decision D16(b) stands.

## Decisions

- **Which barber a signed-in account is** → `linkedBarberId` on the user record, set through
  `setRoles`; see [Which barber the caller is](#which-barber-the-caller-is).
- **Rebooking** → a follow-up booked by the end of the next shop day; see the
  [catalogue](#the-metric-catalogue-version-1).
- **Vouchers** → a payment, not a discount: a voucher-funded seat counts in takings in full,
  because the client received the service at that price and the shop was paid in advance.
- **Usage measurement** → the callable's `AnalyticsReported` log event; see
  [Observability](#observability).
- **Multi-location barbers** → one combined view across locations, because the questions in
  [The Problem](#the-problem) are about the barber, not the place; the shop is the tenant.

## Open Questions

- **Legacy data.** Does any visit history from before this app exist and get imported? If it
  does, its seats must carry prices and outcomes to count; otherwise the first months show "no
  comparison yet". (The repository's stance is greenfield, with no production users.)

## Critical User Journeys (CUJs)

### CUJ 1: A barber checks their month between clients

- **Given**: Ivan is a barber whose account is linked to his barber record; it is 14:05 on a
  Thursday; his next client is at 14:30.
- **When**: He opens the menu and taps «Анализи» (Analytics).
- **Then**: The first frame shows his last cached report with the time it was computed ("as of
  09:12"); when the answer arrives, the figures update. The hero shows this month's takings so
  far and the change against the same days of last month; tips sit on their own line. The time
  bar shows his month up to now in five segments and "other"; under it, "still ahead": booked and
  open hours to the end of the month. Nothing on the screen names another barber.

### CUJ 2: A barber fills an empty afternoon

- **Given**: The screen shows "6 ч 30 мин" (6 h 30 min) bookable in the next 7 days, most on
  Tuesday.
- **When**: Ivan taps the open-hours card.
- **Then**: The schedule opens at
  `/staff/schedule?day=<Tuesday>&view=agenda&barber=ivan&free=1`: Tuesday's agenda for his
  barber record, with free time drawn as rows for this page load only (his stored free-time
  preference is not changed, and the parameter leaves the URL once applied). Each free row offers
  «Нов час · Блокирай време» (New visit · Block time). The agenda is the view that draws free
  time; the grid views do not.

### CUJ 3: A figure is questioned and checked

- **Given**: The admin sees Niko's takings for October as 2 340,00 €.
- **When**: She opens Niko in the scope picker and taps the figure.
- **Then**: A list of Niko's worked seats in October opens — date, client, service and the
  takings each seat contributed after its share of the bill's discount; a party shows one row per
  seat of Niko's; the footer reads 2 340,00 €. The ⓘ button gives the definition in words.

### CUJ 4: The owner compares barbers and weekdays

- **Given**: The admin opens «Анализи» for last month with the shop in scope.
- **When**: She reads fill by weekday, then switches the scope picker from barber to barber.
- **Then**: She sees that Thursdays ran at 45% fill across the shop, and for each barber their
  takings, time breakdown and rebooked share.

### CUJ 5: A new barber in their first week

- **Given**: Stefan joined on Monday: 9 worked seats, 1 no-show.
- **When**: He opens «Анализи».
- **Then**: Takings, tips and the time breakdown show as for any barber; rebooked and no-show read
  as counts ("3 of 9 rebooked", "1 no-show") with a note that a rate appears from 20; the
  comparison line says there is no previous period yet.

### CUJ 6: A barber whose account is not linked

- **Given**: Mira holds the barber role but no admin has linked her account to a barber record.
- **When**: She opens «Анализи».
- **Then**: The screen says her account is not linked to a barber yet and to ask the owner; no
  figures show, and any cached report for her account is deleted.

## Technical Plan (Architecture)

### Shape

The screen asks one callable, `staffAnalytics`, for a report covering one scope (the caller's
own barber record, a chosen barber, or the shop for the admin) and one period (a week or a
month). Its pipeline reads the caller's user record, the period's appointments, the barbers'
rosters and departures, the locations and the cancellation policy; derives `ShopNow` per location
once; hands plain data to pure systems; and returns the report. Nothing is written to Firestore.
The pipeline merges every read by appointment id before computing, so a party split across
barbers is counted once. For a
single-barber scope the report carries its own seat rows and day rows, so a drill-down filters
rows already on the device and always adds up to the figure it came from. A shop-scope report
carries a bounded per-barber list (`barbers: readonly BarberFigures[]`, one entry per barber
record) with every figure for each barber, so choosing a barber shows their figures at once.

```text
«Анализи» screen ── 1. paint cached report (key: version/uid/scope/period) and its time
       │
       └─ 2. callableClient(Callables.StaffAnalytics) ─► functions: staffAnalytics (onCall)
                                                          │ wire: signed in? token role in
                                                          │       ANALYTICS_SELF ∪ ANALYTICS_SHOP?
                                                          ▼
                                       @core/pipelines staffAnalytics(ports)(cmd, caller)
                                          read users/{caller}: stored roles, accountStatus,
                                               linkedBarberId → decide scope or refuse
                                          read appointments by busyKeys (≤30 keys a query)
                                               + the next 7 days for the open-hours card
                                          read follow-ups: barber → bookedFromAppointmentId in […]
                                                           shop → bookedAtUtcMs range
                                          read barberSchedules/{id}, scheduleExceptions
                                               (barberId, localDate range), locations, policy
                                          ShopNow per location; follow-ups' booking dates
                                               (ZonedTimeSystem, once, at this boundary)
                                          systems: ChairTimeSystem · MoneyAllocationSystem
                                                   · StaffAnalyticsSystem
                                                                                    log AnalyticsReported (counts, minutes; no money)
                                          return AnalyticsReport (definitionVersion,
                                                 computedAtUtcMs, rows)
                                                          │
  3. screen replaces the cache ◄──────────────────────────┘
```

### Visibility

Roles are the caller's **stored** roles and `accountStatus` on their user record.

| Caller                                          | Requested scope                    | Result                                                                              |
| ----------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| signed out                                      | any                                | the route guard sends them to sign in (`ANALYTICS_UNAUTHENTICATED` at the callable) |
| a blocked account (any role)                    | any                                | `ANALYTICS_FORBIDDEN`                                                               |
| admin (with or without the barber role)         | the shop                           | figures with per-barber totals                                                      |
| admin                                           | a barber record                    | that barber's report with rows                                                      |
| admin                                           | an id that is not a barber record  | `ANALYTICS_SCOPE_UNKNOWN`                                                           |
| barber, linked                                  | their own barber record            | the report with rows                                                                |
| barber, linked                                  | another barber record, or the shop | `ANALYTICS_FORBIDDEN`                                                               |
| barber, not linked                              | any                                | `ANALYTICS_BARBER_NOT_LINKED`                                                       |
| receptionist, content_manager, sysadmin, client | any                                | `ANALYTICS_FORBIDDEN`                                                               |

Two role sets in `roles.data.ts`: `Roles.ANALYTICS_SELF = [barber]` and
`Roles.ANALYTICS_SHOP = [admin]`. The sysadmin, the vendor's support role, is excluded, as
`Roles.SPEND` excludes it from client spend. `Roles.MONEY` names who may spend the
shop's money (discounts, vouchers); reading billed takings is a different permission and does not
need it. Because the pipeline judges the stored roles, a demoted account's next request is
judged on its new roles and a blocked account's is refused; on a refusal the screen deletes the
cached report for that account. The
appointments themselves stay readable to every role that works the book.

### The metric catalogue, version 1

`definitionVersion = 1` travels in every report; changing a formula raises it and invalidates
cached reports. A figure about a barber counts the seats whose `barberId` is that barber.

**Time: one partition of every rostered minute.** For each barber-day, every minute of rostered
time belongs to exactly one part, decided in this order:

1. **Occupied** — inside the _union_ of the chair time of the seats that hold the barber's chair
   (`GridLayoutSystem.occupiedIntervals`, unchanged). Every seat of a visit that is not wholly
   cancelled holds the chair, a cancelled one included, as in the server's busy projection.
   Overlapping seats count once. A minute covered by several seats takes the first of:
   **worked** (`WORKED`), **no-show** (`NO_SHOW`), **unmarked** (`SCHEDULED`, before the current
   minute), **booked ahead** (`SCHEDULED`, at or after the current minute), **held** (a
   `CANCELLED` seat on a visit that is not wholly cancelled). A seat placed over a block or a
   break counts here, so worked time is never lost.
2. **Blocked** — inside a `BLOCKED` departure range.
3. **Break** — inside a roster break (`ScheduleVersion.breaks`, or the day's `dayBreakRanges`).
4. **Hole** — everything else, split into **short gaps** (holes under 20 minutes), **open** (the
   part at or after the current minute of a hole the schedule still offers — `sellableAt` marks
   it `sellable`, at least 20 minutes left) and **unsold** (the rest of every hole of 20 minutes
   or more: its past part, and the future tail of one with under 20 minutes left). The holes are the schedule's own:
   the schedule subtracts blocks, breaks and occupied time alike, so the order above does not
   change them.

So for every barber-day:
`rostered = worked + no-show + unmarked + booked ahead + held + blocked + break + short gaps + unsold + open`.
A property-based spec over generated days checks it.

| Figure                       | Formula                                                                                                                                                                                                                                                                                                         | Includes                                                                                                                                                                                                                                        | Excludes                                                                                              | Shown as                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Rostered time**            | Roster version in force for the weekday, overridden by an `HOURS` departure, ∩ the hours of the **active** locations, the ones the schedule offers (from `RosterSystem`'s offered windows, carve-outs and breaks); inactive locations are read only for their time zones                                        | every working day in the period                                                                                                                                                                                                                 | `CLOSED` days (0)                                                                                     | basis of the time bar                       |
| **Closed days**              | Days with a `CLOSED` departure, with the minutes the roster would have given                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                                               | —                                                                                                     | the day rows                                |
| **Worked outside hours**     | Chair time of `WORKED` seats outside the barber's rostered start and end, and the count of those seats                                                                                                                                                                                                          | —                                                                                                                                                                                                                                               | —                                                                                                     | the day rows                                |
| **The time bar**             | —                                                                                                                                                                                                                                                                                                               | up to the current minute, five segments — worked, no-show, unmarked, blocked, unsold — and one "other" (held + short gaps) that opens to its parts in the day rows; under it one "still ahead" line (booked ahead and open to the period's end) | breaks, closed days and worked outside hours (in the day rows, and in the bar's ⓘ text)               | stacked bar + one line                      |
| **Bookable open hours**      | Open time over the next 7 shop days from today                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                               | —                                                                                                     | the open-hours card                         |
| **Emptiest day**             | The day of those 7 with the most bookable open minutes; a tie goes to the earliest                                                                                                                                                                                                                              | —                                                                                                                                                                                                                                               | —                                                                                                     | the card's target                           |
| **Fill** (admin, by weekday) | Past time only: (worked + no-show + unmarked) ÷ (rostered − break)                                                                                                                                                                                                                                              | blocked, held, unsold, short gaps in the denominator                                                                                                                                                                                            | future time                                                                                           | % per weekday, with its hours               |
| **Takings**                  | Σ over `WORKED` seats of the seat's net (`MoneyAllocationSystem`): the bill's discount split pro rata over the billed seats (those `BillingSystem.subtotalOf` sums) by largest remainder; each net converted to euro cents                                                                                      | voucher-funded seats in full                                                                                                                                                                                                                    | tips; visits `BillingSystem` cannot evaluate (their count is shown)                                   | money, change vs the previous period (hero) |
| **Tips**                     | Σ `tipCents` of `WORKED` seats                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                               | —                                                                                                     | money                                       |
| **Seats by service**         | Per service: `WORKED` seat count; takings; takings per hour of service = takings ÷ (Σ `durationMinutes` ÷ 60)                                                                                                                                                                                                   | —                                                                                                                                                                                                                                               | setup and cleanup minutes                                                                             | rows with a share bar and the hours         |
| **Rebooked**                 | Of the barber's visits A in the period with at least one `WORKED` seat of theirs **whose window has ended** (A's shop date + 1 day is before today): the share with a follow-up F where `F.bookedFromAppointmentId = A.id`, F's booking shop date ≤ A's shop date + 1 day, and F not `CANCELLED` at report time | follow-ups made by the barber («Запиши пак», Book again) or by the client in the app («book again»); a shared visit counts for each barber with a `WORKED` seat on it                                                                           | follow-ups with no `bookedAtUtcMs`; later bookings not made from A; visits whose window is still open | rate from a base of 20, else "n of m"       |
| **No-shows**                 | Count of `NO_SHOW` seats; rate = no-show ÷ (worked + no-show)                                                                                                                                                                                                                                                   | —                                                                                                                                                                                                                                               | —                                                                                                     | count; rate from 20                         |
| **Late cancellations**       | `CANCELLED` seats that `ClientStatsSystem.clientCaused` blames on the client and `ClientStatsPolicy.isLateCancellation` judges late                                                                                                                                                                             | the seat's stored cancellation window, else the current policy's                                                                                                                                                                                | seats with no `bookedAtUtcMs`; cancellations the reason blames on the shop                            | count                                       |
| **Booking origin** (admin)   | Visits by `placement`: `SELF` = online, `STAFF` = staff                                                                                                                                                                                                                                                         | —                                                                                                                                                                                                                                               | — (`null` = unknown)                                                                                  | share bars                                  |

The rebooking rule compares shop dates, not instants: the pipeline converts each follow-up's
`bookedAtUtcMs` to the shop date once, at its boundary, as Law 7 allows. It is close to Square's
"within 24 hours of the visit ending" but not identical.

Fill example: 8 h rostered, 30 min break, 1 h blocked, 5 h worked, 30 min no-show → 5.5 ÷ 7.5 =
73%.

**Comparison (the hero only).** The hero's change compares Σ takings of `WORKED` seats over the
compared days: for the current (unfinished) period, days 1..today against days 1..min(today, its
length) of the previous one, where a seat on today or on its counterpart day counts once it has
ended by the current minute; days past the shorter period's end compare with nothing (on 31
March, days 1–28 compare with February's 1–28). A past period compares in full with the full
previous period. Weeks start on Monday (`LocalDate.startOfWeek`), months on the 1st
(`LocalDate.startOfMonth`). No other figure shows a change, so none is computed for the previous
period.

### New and changed systems (`@core/systems`, pure)

- **`ChairTimeSystem`** — `dayBreakdown(input): ChairDay`. Input: the barber-day's rostered
  time (`IntervalSetSystem.normalize(offeredWindows ∪ offeredCarveOuts ∪ offeredBreaks)` from
  `RosterSystem`'s existing exports — the uncarved, offered windows, shop filter included; a spec
  case confirms it), its blocked ranges, its breaks, the barber's seats on that day, and
  `ShopNow`. Output: the
  partition's minute parts plus _worked outside hours_. It imports its sibling `GridLayoutSystem`
  and calls `occupiedIntervals`, `holes` and `sellableAt` unchanged for the holes; the occupied
  parts (worked, no-show, unmarked, booked ahead, held) come from its own sweep over each seat's
  `Seat.chairTime`, since `occupiedIntervals` returns merged ranges without the seat.
- **`MoneyAllocationSystem`** — `seatNets(appointment): readonly SeatNet[]`: the pro-rata,
  largest-remainder split above, reading the bill through `BillingSystem`. It serves analytics
  only. `ClientStatsSystem`'s private `moneyOf` keeps its own pro-rata split, rounded per visit,
  and its stored projection is unchanged; the two agree to within one cent per worked seat, which the
  agreement spec checks. `moneyOf` moves onto the shared split the next time the client card
  changes.
- **`StaffAnalyticsSystem`** — `report(input, now): AnalyticsReport` turns `ChairDay`s and
  `SeatNet`s into every catalogue figure for the period and the hero's comparison, applies the
  base-20 rate gate, and attaches the rows. The report carries every decided value so the
  presenter only words it (Law 10): each rate (`null` below its base), the bar's segments for the
  past part of the period, fill per weekday, the hero's current and previous takings, and the
  emptiest day. The rows:
  day rows (≤ 31) always, seat rows for a single-barber scope. `rowsFor(report, figure, filter)`
  returns exactly the rows that sum to a figure; the presenter calls it on the device.

Each system has a spec with the purity case and the boundary cases (DST days, overlapping seats,
a seat across a block, a seat over a break, a seat outside hours, a cancelled seat in a live
party, a `CLOSED` day, a hole cut by the current minute), and `ChairTimeSystem` a property-based
spec that the partition always sums.

### Which barber the caller is

The link lives on the **user** record. `barbers/*` is publicly readable
(`firestore.rules:562-565`), so an account id stored there would publish every staff uid;
`users/{uid}` is readable by its owner and by the roles that work the book, and written only by
audited callables.

- A flat slice `StaffLink = { linkedBarberId: BarberId | null }` joins the `User` intersection.
  The writers that create a user document (the provisioning stub, complete-registration, the dev
  seed) write it as `null`; `setRoles` and erasure change it; a partial profile update does not
  touch it. Greenfield, so there is no backfill.
- **`setRoles` carries the link.** `RolesCall` gains `linkedBarberId`. A non-public lock document,
  `barbers/{barberId}/restricted/link = { userId }`, is read and written in the same transaction
  as the user's field, so two accounts can never hold one barber record — two admins linking at
  once would otherwise show one barber's figures to two accounts; the lock costs one document
  read and write per role change. `RoleAssignmentSystem.decide`
  gains a link outcome:
  - granting the barber role requires a barber record (`GOVERNANCE_ROLES_BARBER_LINK_REQUIRED`,
    context `targetUserId`); the transaction reads `barbers/{id}` and refuses a record that does
    not exist (`GOVERNANCE_ROLES_BARBER_UNKNOWN`); a link without the barber role is refused
    (`GOVERNANCE_ROLES_LINK_WITHOUT_BARBER`);
  - a barber record whose lock names another account is refused
    (`GOVERNANCE_ROLES_BARBER_ALREADY_LINKED`);
  - a change of the link alone commits even when the role set is unchanged;
    - an admin cannot change their own link (the roles guard refuses every self-target, which its
      last-admin rule relies on); an owner who also cuts hair picks their own barber record in the
      scope picker, which an admin has anyway; an admin's screen opens on the shop, and an admin with
      a linked barber record finds it first in the picker as «Аз» (Me);
  - an account holding the barber role with no link (made before this ships, or whose link was
    released) is "barber, not linked" (CUJ 6) until an admin links it;
  - a barber record that is retired (`barberStatus` not active) keeps its link, and its history
    stays reportable;
  - removing the barber role clears the link and its lock; blocking an account does not.
  - erasure never meets a link: it refuses staff accounts (`client-erasure.system.ts:341-348`),
    and a linked account holds the barber role. To erase a former barber, an admin first removes
    the role, which clears the link.
- `AuditContext.Profile` gains `profileLinkedBarberIdFrom` and `profileLinkedBarberIdTo`; a
  link-only change stamps `profileEditedAtUtcMs` like a role change.
- On the wire, an absent `linkedBarberId` means "unchanged" and `null` means "clear". The
  decisions of `setRoles`:

  | Roles                           | Link                               | Outcome                                          | Writes                                  | Audit row        | Sessions                                                |
  | ------------------------------- | ---------------------------------- | ------------------------------------------------ | --------------------------------------- | ---------------- | ------------------------------------------------------- |
  | unchanged                       | unchanged                          | nothing to do                                    | none                                    | none             | revoked (S-L-15: a retry finishes a revoke that failed) |
  | unchanged                       | set or changed                     | link changed                                     | user field, new lock, old lock released | one, link fields | revoked (S-L-15: `setRoles` revokes after every call)   |
  | unchanged                       | cleared (barber kept)              | link changed (barber, not linked)                | user field, lock released               | one              | revoked (S-L-15)                                        |
  | barber added                    | set                                | roles and link changed                           | roles, user field, lock                 | one              | revoked (as today)                                      |
  | barber added                    | absent or null                     | refused `GOVERNANCE_ROLES_BARBER_LINK_REQUIRED`  | none                                    | none             | —                                                       |
  | barber added or kept            | a record that does not exist       | refused `GOVERNANCE_ROLES_BARBER_UNKNOWN`        | none                                    | none             | —                                                       |
  | no barber role after the change | set                                | refused `GOVERNANCE_ROLES_LINK_WITHOUT_BARBER`   | none                                    | none             | —                                                       |
  | barber removed                  | any                                | roles changed, link cleared                      | roles, user field, lock released        | one              | revoked                                                 |
  | other roles changed             | unchanged                          | roles changed                                    | roles                                   | one              | revoked                                                 |
  | any                             | a record locked to another account | refused `GOVERNANCE_ROLES_BARBER_ALREADY_LINKED` | none                                    | none             | —                                                       |

  `setRoles` keeps its existing rule (S-L-15) of revoking the target's refresh tokens after every
  call, so a link change signs the barber out once; links are set rarely, and the rule keeps a
  failed revoke repairable by a retry. A retry of a committed change finds nothing to do and
  answers as committed.

- The barber record is chosen where roles are set (the client card's roles row): a picker of
  barber records appears when «Бръснар» (Barber) is ticked. No query over users by role is needed
  (that index is switched off, `firestore.indexes.json:926-929`).
- The barber's own app reads `linkedBarberId` from the user document the session already loads.
  No token claim (Alternative E).
- The dev seed links `dev-staff-ivan` to `ivan`.

### Reads and cost

| Request           | Reads (10 barbers, 15 seats a day, ~25 working days)                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Barber: one month | 1 user + ~400 visits + ~400 visits of the previous period (hero only) + ≤ 31 departures + 1 roster + ≤ 3 locations + 1 policy + follow-ups (≤ 15 `in` queries, ~40 results) + next 7 days (~100 visits, ≤ 7 departures) ≈ **1,000** |
| Admin: shop month | 1 user + ~4,000 visits + ~4,000 of the previous period + ~310 departures + 10 rosters + locations + policy + follow-ups (1 `bookedAtUtcMs` range query, ~2,000 results) + next 7 days (~1,000 + 70) ≈ **11,500**                    |

Visits are read with `busyKeys array-contains-any` over the scope's `barberId__localDate` keys,
at most 30 per query (a barber-month is 2 queries, a shop-month about 11), and merged by
appointment id. Cancelled visits keep their keys, so late cancellations are found. Departures use
the existing `(barberId, localDate)` index. Follow-ups: for one barber,
`bookedFromAppointmentId in [...]` chunks; for the shop, one `bookedAtUtcMs` range (period start to
end + 1 day), filtered to follow-ups — both default single-field indexes.

Opens: a barber about 3 a day, the admin about 5 shop views and 5 barber views a day; the screen
always asks for a fresh report on open, after painting the cached one (comparing stored
instants to skip a call would need a rule on Law 7's closed T2 list). At 10 barbers that is about 3M
reads a month (about $2 at Firestore's read price). No projection, trigger or TTL is added; the
signal to build stored per-day figures (Alternative C) is the time budget, not the read count.

### The screen

- Route `staff/analytics`, guarded by `activeGuard` and
  `rolesGuard(Roles.ANALYTICS_SELF ∪ Roles.ANALYTICS_SHOP)`, lazy-loading
  `libs/features/staff/analytics`. A menu row «Анализи» sits under «График» (Schedule) for those
  roles.
- Top to bottom: period switcher (Week | Month, ‹ › up to 12 months back); for the admin a scope
  picker (Shop · each barber); the hero (takings, change chip, tips line); the time bar with its
  legend and the "still ahead" line; the open-hours card; seats by service; rebooked, no-shows,
  late cancellations; for the admin in shop scope, fill by weekday and booking origin. Every
  figure has an ⓘ button with its definition.
- Drill-down: a pushed page listing the figure's rows — seats through `lib-visit-list`
  (`shared/visits`) or days with their parts — and a footer total. In shop scope a figure
  drills to the per-barber list in the same report; only a barber's seat rows need a fresh
  request, shown with its own computed time.
- States: see the table below.
- Presenter and words (Law 10): `analytics.presenter.ts` turns the report into the display struct
  and decides nothing; `analytics.vm.ts` holds the types and word tables.
- Cache: in `localStorage` behind `AnalyticsCachePorts`, every scope alike: figures and day rows
  only (seat rows, which carry client names, stay in memory); one entry per (scope, period), at
  most 6, key `creativo.analytics/<definitionVersion>/<uid>/<scope>/<period>`; a quota error is
  ignored; cleared on sign-out, account switch and refusal.
- Performance: the drill-down page is a `@defer` block. If the screen's open misses the frame
  budget when measured, its lower sections build in stages after the first frame with the
  schedule's `SHEET_STAGED` / `climbStages` helpers, moved then to `libs/ui/layout` so both
  features share them.

**Screen states.**

| State                                                 | What shows                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| Cached                                                | the cached figures and the time they were computed, then the update             |
| First open, no cache                                  | the layout with placeholder figures                                             |
| Call failed, cache shown                              | the cached figures and "could not update" with retry                            |
| Call failed, no cache                                 | a message and retry                                                             |
| `ANALYTICS_FORBIDDEN` / `ANALYTICS_BARBER_NOT_LINKED` | the refusal in words (CUJ 6); the cache for that account is deleted             |
| `ANALYTICS_PERIOD_OUT_OF_RANGE`                       | nothing; the switcher does not offer periods past 12 months back or after today |
| `ANALYTICS_SCOPE_UNKNOWN`                             | "this barber no longer exists", back to the shop                                |
| `ANALYTICS_UNAUTHENTICATED`                           | the sign-in redirect                                                            |
| Empty period                                          | "no visits in this period" with the rostered hours, if any                      |
| Small sample                                          | counts instead of rates (G6)                                                    |

### Existing screens

- **Two schedule changes, no change in behaviour.**
  - A new `?free=1` URL parameter, read once in the dashboard's route inputs, turns free time on
    for this page load through a new non-persisting `ScheduleStatusFilter.showFreeTimeOnce()`,
    then leaves the URL ([CUJ 2](#cuj-2-a-barber-fills-an-empty-afternoon)).
  - The pure part of the store's `laneGeometryOf` (rostered windows, carve-outs, breaks,
    occupied time for a barber-day) moves into `GridLayoutSystem.laneGeometry`, so the schedule
    and `ChairTimeSystem` compute holes from one function.

  The day summary keeps summing its gap rows (`GridLayoutSystem.totalMinutes`); because both
  use the same holes, that sum equals unsold + open for the day. The agreement spec, in the
  dashboard library, checks it through the store's own path, including a day at a shop the
  schedule does not offer.

- **The client card is unchanged.** Its lifetime spend and analytics' seat nets agree to within
  one cent per worked seat (G5).

### Errors

`@core/errors/analytics.error.ts`, `AnalyticsErrorCode`: `ANALYTICS_UNAUTHENTICATED`,
`ANALYTICS_FORBIDDEN`, `ANALYTICS_BARBER_NOT_LINKED`, `ANALYTICS_PERIOD_OUT_OF_RANGE` (more than
12 months back, or in the future), `ANALYTICS_SCOPE_UNKNOWN`, `ANALYTICS_INVALID_INPUT` (a malformed request). The link refusals
join the governance errors of `setRoles`. The UI words each as `errors.<errorCode>`.

### Observability

- The pipeline logs `LogEvent.AnalyticsReported` through `LogPorts` with uid, scope, period,
  `definitionVersion`, appointment count, duration and the minutes per part — no money, since
  logs are read by the vendor. The weekly-active success measure is a Cloud Logging query over that
  event (distinct uid per ISO week).
- Correctness checks: the partition spec, the agreement spec, and the drill-down footer, whose
  total must equal the figure.

## Risks & Mitigations

| Risk                                                                      | Effect                                     | Mitigation                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First open with no cache, and the call fails                              | Nothing to show                            | Error state with retry; no stale or partial figures                                                                                                                                                   |
| A cached report from an older definition                                  | Figures that no longer match the catalogue | The cache key carries `definitionVersion`; older entries are ignored                                                                                                                                  |
| Callable time and memory at the largest tenant (10 barbers × 3 locations) | Slow shop view                             | The [budgets](#non-functional-requirements), measured in the emulator and on the first deploy. If the shop view's p95 exceeds its budget for a week, build the per-day stored figures (Alternative C) |
| `array-contains-any` and `in` take at most 30 values                      | A query fails                              | Keys and ids are chunked at 30                                                                                                                                                                        |
| Reads grow with the shop                                                  | Cost                                       | ~3M reads a month at 10 barbers (about $2); the cache paints first, every open refreshes                                                                                                              |

| Visits nobody marks worked or no-show | Unmarked time takes a large share of the bar | The unmarked slice opens to its visits; the success measures track it at ≤ 5% of past booked time |
| Client names cached on a device after the client is erased | A name outlives the erasure | Seat rows are never cached; only figures and day rows are |
| Only follow-ups count as rebooked | Rebooking looks low when clients book later without «book again» | The ⓘ text says so |
| Departure or roster edited after the fact | Past figures change | Accepted in v1 (figures are recomputed, never stored); sealing comes with pay in v2 |
| A wrong or stale account link | A barber sees another barber's figures | Only an admin can link; one lock document per barber record; every change in the audit row; the link shows on the client card's roles row |
| Money cached on a shared device | Another user of the device sees it | Caches are keyed by uid and cleared on sign-out, account switch and refusal; seat rows (client names) are never cached |
| Token roles differ from stored roles | A demoted admin keeps access until the token refreshes | The pipeline judges the stored roles; a refusal deletes the cache |

## Alternatives Considered

### Alternative A: Monthly per-barber and per-location projections, rebuilt from source on every write

- **Pros**: one document read per scope and period.
- **Cons**: a rebuild reads the whole month: ~430 reads per write for a barber-month (visits and
  departures) and ~4,300 for the shop-month. At ~4,000 visit writes a month, about 18M reads a
  month before edits, against ~3M for computing on demand at the modelled opens — about six
  times more, rising with every edit. Unsold and open time depend on the clock, so a projection
  rebuilt only on writes is wrong as soon as time passes.
- **Reason for Rejection**: Law 5 permits a stored derived value only for privacy, read fan-out or
  a conflict set; here storing multiplies the reads instead of saving them, and cannot hold the
  clock-dependent figures.

### Alternative B: Incremented counters (`FieldValue.increment`)

- **Pros**: one cheap write per event.
- **Cons**: every edit, reschedule, cancellation and outcome change must apply exactly once and in
  order; one duplicate or lost trigger leaves a wrong number with no source to recompute from.
- **Reason for Rejection**: the earlier statistics design (§4.3) bans it for any displayed figure.

### Alternative C: A per-day stored figure set (`barberId__localDate`)

- **Pros**: a year view reads ≤ 366 small documents; cheap one-day rebuilds; drift checks.
- **Cons**: a trigger, a backfill, a recompute job and invalidation rules for roster and
  shop-hours edits, none of which a week or month view needs.
- **Reason for Rejection**: not needed for v1's periods; the upgrade path for the year view and
  when reads pass 1M a month.

### Alternative D: Compute on the client from the existing appointment listeners

- **Pros**: no callable; works offline.
- **Cons**: the whole period's visits (~400 for a barber, ~4,000 for the shop) loaded into the
  staff browser on each open.
- **Reason for Rejection**: it folds up to ~4,000 visits on the main thread of the device the
  no-lag goal protects.

### Alternative E: A token claim naming the caller's barber

- **Pros**: security rules could check "own barber" without a read.
- **Cons**: claims are minted only at sign-in (`verify-otp`, `complete-registration`), so a link
  made later is not in the token until the next sign-in; and the callable reads the caller's user
  document anyway for the stored roles.
- **Reason for Rejection**: no v1 rule needs it. Revisit when the roster rule's self-or-manager
  TODO (`firestore.rules:63`) is narrowed.

### Alternative F: Make money a security boundary now

- **Pros**: "barbers do not see colleagues' takings" would be enforced by rules.
- **Cons**: the visit sheet shows the bill to every role that works the book by design; every read
  port, the billing system, the visit editor and the client card would change.
- **Reason for Rejection**: it contradicts how the shop works today.

### Alternative G: Store the private reason for a block (amend D16(b))

- **Pros**: the bar could separate sick, time off, training and travel.
- **Cons**: sick leave is health data under GDPR Art. 9; D16(b) stores only the effect on purpose;
  `CLOSED` vs `BLOCKED` already gives the two categories the figures need.
- **Reason for Rejection**: more sensitive data for a distinction no v1 decision needs.

### Alternative H: Rebooking as "any later visit", "within 24 hours", or "booked on the same shop day"

- **Pros**: "any later visit" (Fresha) needs no window; "within 24 hours of the end" (Square) is a
  published benchmark; "same day" (Boulevard) reads naturally.
- **Cons**: "any later visit" mixes in clients who returned weeks later on their own — retention,
  not rebooking. "Within 24 hours" compares two stored instants, which Law 7's closed T2 list does
  not include. "Same day" misses a client who rebooks that evening from home after a late visit.
- **Reason for Rejection**: "by the end of the next shop day" compares shop dates only (the
  pipeline converts once at its boundary) and keeps the evening rebooking.

### Alternative I: Write a "rebooked" mirror onto the original visit when the follow-up is booked

- **Pros**: one field instead of follow-up queries.
- **Cons**: every booking made from a visit would also write that older visit inside the booking
  transaction, growing its conflict set.
- **Reason for Rejection**: the follow-up reads cost ≤ 30 small `in` queries for a barber-month
  and 2 range queries (~4,000 results) for a shop-month.

### Alternative J: A named league table between barbers, or matching Fresha report for report

- **Pros**: some shops motivate with rankings; a long report list sells.
- **Cons**: in a 2–6 barber shop a ranking names a colleague's numbers; fifty reports with
  differing definitions is the "raw data" complaint Boulevard users make.
- **Reason for Rejection**: the admin sees per-barber figures; barbers see themselves; breadth
  comes in stages on one catalogue.

### Alternative K: The account link on the barber record (the brief's choice)

- **Pros**: one place to read a barber's account.
- **Cons**: `barbers/*` is publicly readable, so every staff account id would be published.
- **Reason for Rejection**: the user record holds the link, with a non-public lock document under
  the barber record.

### Alternative L: Split the discount over worked seats only

- **Pros**: takings of worked seats always add up to what the bill charged for them.
- **Cons**: when a party member does not show, the whole discount lands on the others, moving
  money between barbers. Two seats at €20, €10 off, one no-show: a worked-only split gives the
  worked seat all €10 of the discount (takings €10); a pro-rata split gives it €5 (takings €15).
- **Reason for Rejection**: the pro-rata split over all billed seats keeps each seat's share
  fixed.

### Alternative M: A separate callable for drill-down rows

- **Pros**: smaller report answers.
- **Cons**: each tap re-reads the period (~430 or ~4,300 reads), and live rows can disagree with a
  cached hero figure.
- **Reason for Rejection**: rows ride inside the report, from the same snapshot.

### Alternative N: A separate `linkBarberAccount` callable

- **Pros**: the link is its own act with its own audit row.
- **Cons**: removing the barber role through `setRoles` would leave the link in place; it would
  duplicate `setRoles`' transaction, audit row and role check.
- **Reason for Rejection**: `setRoles` carries the link.

## Non-Functional Requirements

- **Security & Privacy**: the callable enforces the [visibility table](#visibility) on stored
  roles; a barber's report never contains another barber's figure; the link lives on the
  non-public user record with a non-public lock; the device cache is keyed by uid, holds no client
  names, and is cleared on sign-out.
- **Performance & Latency (the budgets)**: tap to first frame from the cache with no frame over
  16.7 ms at 4× CPU throttle on a production build; callable p95 ≤ 1.5 s for a barber-month and
  ≤ 4 s for a shop-month; callable server memory 512 MiB.
- **Rollout & Rollback**: a new route and menu row behind the role guards. Rollback removes the
  route and the row. What stays: `linkedBarberId` on user documents and the lock documents
  (unread once the route is gone) and device caches (ignored).

## Additional Resources

- [concepts_brief.md](../design-research/staff-analytics/concepts_brief.md),
  [hypothesis.md](../design-research/staff-analytics/hypothesis.md),
  [competitor-research.md](../design-research/staff-analytics/competitor-research.md),
  [mobbin-inspiration.md](../design-research/staff-analytics/mobbin-inspiration.md),
  [brainstorm_review_report.md](../design-research/staff-analytics/brainstorm_review_report.md)
- [availability-and-statistics-design.md](../design-research/availability-and-statistics-design.md)
  §4 — the earlier statistics model. Kept: blocks count in capacity while breaks and closed days do
  not; no counters; its no-show and cancellation rates. Replaced: its storage tiers (computed on
  demand in v1, a per-day figure set later). Dropped: the paid/unpaid and reason taxonomy
  (D16(b)).
- Review reports: [review/](../design-research/staff-analytics/review/).

## Future Improvements

- **v1.1**: the shop reference for a barber (the same figures averaged over the other barbers,
  shown only when at least three contribute). It needs the shop's figures, so it ships once a
  shop-month report with the reference stays under 4 s p95; first-visit return as a
  fixed figure ("clients first seen 60–90 days ago: n of m came back"); overdue regulars by their
  rhythm; weekday × hour demand grid; a Monday in-app card; the receptionist's forward open-time
  card.
- **v1.2**: the per-day stored figure set (Alternative C) → year view, same period last year,
  custom ranges; goals the barber sets; written findings computed by a system.
- **v2**: a per-barber pay rule and earnings; CSV export; sealing closed periods.

## Detailed Implementation Plan

Eight steps, in order: **1** core data, **2** core systems, **3** ports and pipelines, **4** server,
**5** rules and seed, **6** web, **7** the two schedule changes, **8** agreement, budgets, e2e,
rollout and the record. Every consumer of a changed type changes in the same step as the type,
so each step is green on its own: `pnpm nx run-many -t typecheck test lint -p <touched projects>`
and `pnpm nx run verify-tools:layering`.

### Target Files to Create/Modify

#### Step 1 — Core data and every consumer of its types

1. **`libs/ecs-core/src/errors/analytics.error.ts`** (Create) + spec
   - **Proposed Changes**: `AnalyticsErrorCode` — `ANALYTICS_UNAUTHENTICATED`,
     `ANALYTICS_FORBIDDEN`, `ANALYTICS_BARBER_NOT_LINKED` (context `userId`),
     `ANALYTICS_PERIOD_OUT_OF_RANGE` (context `fromLocalDate`), `ANALYTICS_SCOPE_UNKNOWN`
     (context `barberId`), `ANALYTICS_INVALID_INPUT` (context `field`); the flat union
     `AnalyticsError` and its factory companion. The spec pins every code and shape.
2. **`libs/ecs-core/src/errors/governance.error.ts`** (Modify) + spec — `SetRolesError` gains
   `GOVERNANCE_ROLES_BARBER_LINK_REQUIRED` (context `targetUserId`),
   `GOVERNANCE_ROLES_BARBER_UNKNOWN`, `GOVERNANCE_ROLES_LINK_WITHOUT_BARBER` and
   `GOVERNANCE_ROLES_BARBER_ALREADY_LINKED` (context
   `barberId`). Same step: **`apps/functions/src/edge.ts`** maps both (failed-precondition), and the
   edge refusal table spec gains their rows.
3. **`libs/ecs-core/src/errors/index.ts`** (Modify) — re-export item 1.
4. **`libs/ecs-core/src/components/staff-link.data.ts`** (Create) + spec — `StaffLink =
{ linkedBarberId: BarberId | null }`, `StaffLink.NONE`, a guard that reads an absent field as
   `null` (older documents).
5. **`libs/ecs-core/src/entities/user.entity.ts`** (Modify) — `User` gains `StaffLink`. Same step,
   every consumer of the `User` shape:
   - **`libs/ecs-core/src/entities/identity-entities.type-spec.ts`** — the slice in the not-`never`
     proof;
   - **`libs/ecs-core/src/systems/registration.system.ts`** + spec — the provisioning stub and the
     completed user carry `linkedBarberId: null`;
   - **`libs/ecs-core/src/pipelines/register-user.pipeline.ts`** and
     **`complete-registration.pipeline.ts`** specs — expected bodies gain the field;
   - **`tools/seed/fixtures/users.fixtures.ts`**, **`apps/web/e2e/support/seed-firestore.ts`**,
     **`tools/verify/p0/verify-p0.mjs`** — every seeded user body gains `linkedBarberId`
     (`'ivan'` for `dev-staff-ivan`, `null` otherwise).
6. **`libs/ecs-core/src/entities/barber-link.entity.ts`** (Create) — `BarberLink = { id: BarberId;
linkedUserId: UserId }`, the lock at `barbers/{id}/restricted/link`;
   **`entities/collections.ts`** (Modify) — `BARBER_LINK_DOC = 'link'`.
7. **`libs/ecs-core/src/components/roles.data.ts`** (Modify) + `roles.data.spec.ts` —
   `Roles.ANALYTICS_SELF = [Role.Barber]`, `Roles.ANALYTICS_SHOP = [Role.Admin]`; JSDoc: "used by
   the route guard, the menu and the callable's wire; the sysadmin excluded as in `SPEND`; reading
   billed takings is not `MONEY`". The spec pins both and the sysadmin's exclusion.
8. **`libs/ecs-core/src/components/roles-call.data.ts`** (Modify) + spec — the command gains an
   optional `linkedBarberId` (absent = unchanged, `null` = clear); `RolesCall.Changed` carries the
   resulting link. Same step: **`apps/functions/src/wire/governance.wire.ts`** + spec
   (`decodeSetRoles` parses it with `BarberId.parse`; `decodeChanged` returns it).
9. **`libs/ecs-core/src/components/audit-context.data.ts`** (Modify) — `AuditContext.Profile`
   gains `profileLinkedBarberIdFrom` and `profileLinkedBarberIdTo`. Same step:
   **`firestore.indexes.json`** — `fieldOverrides` switching single-field indexes off for both
   (audit blobs are never queried).
10. **`libs/ecs-core/src/components/analytics-period.data.ts`** (Create) + spec —
    `AnalyticsPeriod = DateRange & { analyticsSpan: AnalyticsSpan }` (`'WEEK' | 'MONTH'`);
    companion `weekOf` / `monthOf` on `LocalDate.startOfWeek` / `startOfMonth`, `previous`,
    `isWithinRange(period, today)` — `fromLocalDate ≥ startOfMonth(today) − 12 months` and
    `fromLocalDate ≤ today`.
11. **`libs/ecs-core/src/components/analytics-report.data.ts`** (Create) + type-spec — root
    `AnalyticsReport`, flat with prefixed fields: `reportDefinitionVersion`,
    `reportComputedAtUtcMs`, `reportScopeBarberId` (`BarberId | null` for the shop),
    `reportFromLocalDate`, `reportToLocalDate`, the ten partition minutes
    (`reportWorkedMinutes`, … `reportOpenMinutes`), `reportClosedDayMinutes`,
    `reportOutsideHoursMinutes`, `reportOutsideHoursSeats`, `reportTakingsCents`,
    `reportTipsCents`, `reportExcludedVisitCount`, `reportHeroCurrentCents`,
    `reportHeroPreviousCents | null` (`null` = no previous period), `reportRebookedRate | null`,
    `reportNoShowRate | null` (`null` below the base of 20), the past-only bar segments
    (`reportBarWorkedMinutes`, `reportBarNoShowMinutes`, `reportBarUnmarkedMinutes`,
    `reportBarBlockedMinutes`, `reportBarUnsoldMinutes`, `reportBarOtherMinutes`),
    `reportRebookedCount`, `reportRebookedBase`, `reportNoShowCount`, `reportNoShowBase`,
    `reportLateCancelCount`, `reportBookableOpenMinutes`, `reportEmptiestLocalDate | null`; 1-to-N
    lists `reportServices: ServiceRow[]`, `reportWeekdayFill: WeekdayFill[]`,
    `reportOrigins: OriginShare[]`, `reportBarbers: BarberFigures[]`, `reportDayRows:
AnalyticsDayRow[]`, `reportSeatRows: AnalyticsSeatRow[]`. One namespace declares each row type
    with its fields once; the `AnalyticsFigure` dictionary names each drillable figure. The
    type-spec proves no field collides.
12. **`libs/ecs-core/src/components/analytics-call.data.ts`** (Create) + spec — `AnalyticsCall`
    with namespace `AnalyticsCall.Request = { scopeBarberId: BarberId | null; period:
AnalyticsPeriod }` and its guard; the answer is `AnalyticsReport`.
13. **`libs/ecs-core/src/components/index.ts`** (Modify) — re-export items 4, 10–12.
14. **`libs/ecs-core/src/primitives/log-event.data.ts`** (Modify) — `LogEvent.AnalyticsReported`.

#### Step 2 — Core systems (`libs/ecs-core/src/systems`)

15. **`grid-layout.system.ts`** (Modify) + spec — `laneGeometry(input)`: the pure part of the
    dashboard store's `laneGeometryOf` (rostered windows, carve-outs, breaks and occupied time for
    a barber-day), moved here unchanged. Same step:
    **`libs/features/staff/dashboard/src/lib/staff-day.store.ts`** calls it; its specs stay green
    unchanged.
16. **`chair-time.system.ts`** (Create) + spec
    - **Proposed Changes**: `ChairTimeSystem.dayBreakdown(input): ChairDay`. Holes:
      `GridLayoutSystem.holes(offeredWindows, occupiedIntervals(visits, barberId, []))` — the
      carved windows (blocks and breaks out), no busy projection — then `sellableAt` with the
      seat's location's `ShopNow`. Rule 1, occupied parts: one sorted sweep over each seat's
      `Seat.chairTime`, a minute taking the first of worked → no-show → unmarked → booked ahead →
      held (a cancelled seat on a visit that is not wholly cancelled). Rule 2, on the remaining
      rostered minutes: blocked, then break. Rostered time from `laneGeometry`'s uncarved union.
    - **Spec**: purity; the ten parts sum to rostered time (fast-check property over generated
      days); boundary cases — DST days, overlapping seats, a seat across a block, a seat over a
      break, a seat outside hours, a cancelled seat on a completed visit, a `CLOSED` day, a hole
      with under 20 minutes left (unsold), a 19-minute hole (short gap).
17. **`money-allocation.system.ts`** (Create) + spec — `seatNets(appointment)` returns
    `{ allocation: 'ALLOCATED'; nets: readonly SeatNet[] } | { allocation: 'NOT_EVALUATED' }`,
    using `BillingSystem.evaluate` for the bill and largest remainder over the billed seats. The
    euro conversion `inEuroCents` is exported from `client-stats.system.ts` (its one home) and
    imported. Spec: purity; nets sum to the total; odd cent; fixed amount larger than a seat;
    free service; a no-show keeps its share; agreement with `ClientStatsSystem` spend within one
    cent per visit.
18. **`staff-analytics.system.ts`** (Create) + spec — `scopeOf(caller, request)` (the visibility
    table, all nine rows), `daysOf(period)`, `report(input, nowByLocation)` (every catalogue
    figure; `nowByLocation: readonly ShopNowAt[]`, `ShopNowAt = { locationId } & ShopNow`, a seat
    using its visit's location), `barSegments(report)` (the five segments and "other"),
    `rowsFor(report, figure, filter: AnalyticsRowFilter)` with `AnalyticsRowFilter =
{ serviceId: ServiceId | null; localDate: LocalDate | null; barberId: BarberId | null }`.
    Late cancellations through `ClientStatsSystem.clientCaused` and
    `ClientStatsPolicy.isLateCancellation`. `DEFINITION_VERSION = 1`. Spec: purity; each
    catalogue row hand-computed; the rate gate at 19/20; rebooked with an open window; the hero
    comparison on day 1, on 31 March and with an unfinished seat; `rowsFor` sums to every figure.
19. **`role-assignment.system.ts`** (Modify) + spec — `decide` takes the current link, the
    requested link and the involved locks, and returns the outcomes of the decision table in the
    specification; `changeOf` / `saveOf` handle a link-only change.
20. **`audit.system.ts`** (Modify) + spec — `planRolesChanged` accepts a link-only change and
    fills the two profile link fields; an unchanged roles-and-link pair stays a defect.
21. **`systems/index.ts`** (Modify) — export items 16–18.

#### Step 3 — Ports and pipelines (`libs/ecs-core/src`)

22. **`ports/analytics.port.ts`** (Create) — function types `LoadVisitsByBusyKeys(keys)`,
    `LoadFollowUpsFrom(appointmentIds)`, `LoadFollowUpsBookedIn(fromUtcMs, toUtcMs)`,
    `LoadDeparturesForBarber(barberId, from, to)`, `ListBarberRecords()` (every record, any
    status), `ListLocations()` (every location, any status — the active ones feed rostered time, as in the
    schedule; all of them feed time zones); bundle `AnalyticsReadPorts`; web
    bundles `AnalyticsCallPorts` (`requestReport`) and `AnalyticsCachePorts` (`readCachedReport`,
    `writeCachedReport`, `clearCachedReports`). The caller is read through the existing
    `LoadProfile` (`accounts.port.ts`).
23. **`ports/callables.ts`** (Modify) — `Callables.StaffAnalytics`; its `CallableWire` entry;
    `OPERATION_ID_FIELD` entry `null` (a read); App Check entry `Standard`; answer decoder.
24. **`ports/index.ts`** (Modify) — export item 22.
25. **`pipelines/staff-analytics.pipeline.ts`** (Create) + spec — dependency type
    `AnalyticsReadPorts & ProfileReadPorts & RosterReadPorts & PolicyReadPorts & ClockPorts &
LogPorts` (the bundles that hold `LoadProfile`, the roster read and the policy read). Steps:
    read the caller → `StaffAnalyticsSystem.scopeOf`; `AnalyticsPeriod.isWithinRange`; read
    barber records and locations; read visits by keys in chunks of 30 (the previous period's for
    the hero); read the next 7 days' visits and departures; merge visits by appointment id; read
    follow-ups (`in` chunks for a barber, one range for the shop) and keep those with a
    `bookedFromAppointmentId` in memory; derive `ShopNowAt` per location and the follow-ups'
    booking shop dates with `ZonedTimeSystem` once; call `report`; log `AnalyticsReported` with
    `uid, scope, periodFrom, periodTo, definitionVersion, visitCount, durationMs` and the minutes
    per part — no money. Spec: in-memory ports; every visibility row; chunking at 30; a party
    read from two chunks counted once; the log line's exact fields.
26. **`pipelines/set-roles.pipeline.ts`** (Modify) + spec — the transaction reads the new and the
    old lock (`barbers/{id}/restricted/link`), passes them to `decide`, writes the user field, the
    locks, the roles and the audit row per the decision table; a retry of a committed link-only
    change answers as committed.
27. **`pipelines/index.ts`** (Modify) — export item 25.

#### Step 4 — Server (`apps/functions/src`)

28. **`adapters/firestore-analytics.adapter.ts`** (Create) + spec — `firestoreAnalyticsPorts(db,
guardOf, log): AnalyticsReadPorts`. Every appointment read passes the stored-document guard
    (as `firestoreSchedulePorts` does). Each query is bounded: visit chunks `limit(keys × 60)`;
    follow-up chunks `limit(30 × 5)`; the shop's follow-up range `limit(20_000)` with a comment
    naming the tenant ceiling; departures `limit(31)`; barber records and locations carry the
    unbounded-ok comment (tenant-sized). Bodies spread, never mapped; failures through
    `store-answer.ts`.
29. **`adapters/firestore-ports.ts`** (Modify) — construct it there, the only production site,
    with the guard registry and the log.
30. **`wire/analytics.wire.ts`** (Create) + spec — signed in, token role in `ANALYTICS_SELF ∪
ANALYTICS_SHOP`, payload through the `AnalyticsCall.Request` guard
    (`ANALYTICS_INVALID_INPUT`).
31. **`main.ts`** (Modify) — `export const staffAnalytics = onCall({ …, memory: LARGE_MEMORY },
wiredCallable(plain(Callables.StaffAnalytics, null), root.ports, decodeStaffAnalytics, (ports,
cmd, caller) => staffAnalyticsPipeline(ports)(cmd, caller), refusalOf))`.
    **`main.spec.ts`** — the export list gains `staffAnalytics`.
32. **`edge.ts`** (Modify) — the refusal table maps every `AnalyticsErrorCode`
    (unauthenticated, permission-denied, failed-precondition for not-linked, invalid-argument for
    period, not-found for scope, invalid-argument for input).
33. **`integration/staff-analytics.integration.spec.ts`** (Create) — emulator: seed a month for
    two barbers; a barber gets their own report and is refused another's; the admin's shop report
    lists both and its takings equal their sum; two `setRoles` links to one barber record — the
    second is refused; a link-only change commits and writes one audit row. (The emulator does not
    enforce composite indexes; this checks query shapes and results only.)

#### Step 5 — Rules and seed

34. **`firestore.rules`** (Modify) — in `match /barbers/{barberId}`, a nested
    `match /restricted/{doc} { allow read, write: if false; }` with a comment;
    `linkedBarberId` added to the documented user key list. **The rules-unit spec** gains a case
    that a client read and a client write of `barbers/{id}/restricted/link` are denied.
35. **`tools/seed-dev-catalog.mjs`** (Modify) — the lock `barbers/ivan/restricted/link =
{ linkedUserId: 'dev-staff-ivan' }`.

#### Step 6 — Web

36. **`libs/features/staff/analytics/`** (Create with the `nx-generate` Angular library
    generator; tags `scope:app`, `type:feature`; alias `@creativo/features/staff/analytics`)
    - `staff-analytics.page.ts|html|css` — period switcher, admin scope picker, hero, time bar,
      open-hours card, by-service rows, rates, admin weekday fill and origins, every state of the
      states table; the route exported with `loadComponent`.
    - `staff-analytics.store.ts` — scope, period, report, load state; reads the cache, calls
      `requestReport` on every open, after painting the cache; deletes the cache on a refusal; the
      barber's own scope from the session's `linkedBarberId`.
    - `analytics.presenter.ts` + spec — display struct from the report, `barSegments` and
      `rowsFor`; seat rows through `visitRowOf` (`shared/visits`); decides nothing.
    - `analytics.vm.ts` — display types and word tables (titles, ⓘ definitions).
    - `analytics-time-bar/` — the bar component.
    - `analytics-rows-page/` — the drill-down page in a `@defer` block.
    - `src/index.ts` — the routes only.
37. **`libs/infrastructure/firebase-app/src/lib/analytics-call.adapter.ts`** (Create) + spec —
    `AnalyticsCallPorts` over `callableClient`.
38. **`libs/infrastructure/firebase-app/src/lib/ports.tokens.ts`** (Modify) —
    `ANALYTICS_CALL_PORTS = new InjectionToken<AnalyticsCallPorts>(…)`,
    `ANALYTICS_CACHE_PORTS = new InjectionToken<AnalyticsCachePorts>(…)`.
39. **`libs/infrastructure/web-storage/src/lib/local-storage-analytics-cache.adapter.ts`**
    (Create) + spec — key `creativo.analytics/<definitionVersion>/<uid>/<scope>/<period>`; at most
    6 entries, least recently written dropped; every read and write in try/catch; JSON decoded
    through the report's guard, a failed decode deletes the entry; figures and day rows only.
40. **`apps/web/src/app/app.config.ts`** (Modify) — provide the two tokens.
41. **`libs/features/shared/shell/src/lib/identity/session-identity.service.ts`** (Modify) + spec —
    exposes `linkedBarberId` from the session's own user document, and an `accountChanged`
    signal (sign-out or a different uid) on which the analytics cache is cleared.
42. **`apps/web/src/app/app.routes.ts`** (Modify) — `staff/analytics` with `activeGuard` and
    `rolesGuard` over the two role sets, `loadComponent`.
43. **`libs/features/shared/shell/src/lib/menu/site-menu.component.html|ts`** and
    **`header/site-header.component.ts|html`** (Modify) — the header passes an analytics-role flag;
    the menu shows «Анализи» under «График».
44. **`libs/features/staff/client-card/src/lib/client-roles.presenter.ts`** + spec,
    **`client-card.store.ts`**, and the roles row's template (Modify) — a barber-record picker
    (from the catalog's barber stream already provided to the card) when «Бръснар» is ticked; the
    linked record shown on the row; `setRoles` sends `linkedBarberId`.
    **`apps/web/e2e/staff-client-roles.spec.ts`** (Modify) — ticking «Бръснар» now needs a record.
45. **`libs/infrastructure/i18n/src/assets/i18n/bg.json`, `en.json`** (Modify) — the screen's
    words, every figure's title and ⓘ definition, `errors.ANALYTICS_*`, the two governance codes.

#### Step 7 — The two schedule changes

46. **`libs/features/staff/dashboard/src/lib/schedule-status-filter.ts`** (Modify) + spec —
    `showFreeTimeOnce()`: turns free time on without writing the stored preference.
47. **`libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.ts`** (Modify) +
    spec — the route inputs (`staff-dashboard.ts:806-815`) read `free=1` once, call
    `showFreeTimeOnce()`, and navigate with `free` removed (`replaceUrl`), so
    `queryParamsHandling: 'merge'` does not carry it on.

(The `laneGeometry` move is item 15.)

#### Step 8 — Agreement, budgets, e2e, rollout, record

48. **`libs/ecs-core/src/testing/analytics.fixtures.ts`** (Create) and **`testing/index.ts`**
    (Modify) — one fixture month: three barbers at two locations, a party split across two, a
    cancelled seat on a completed visit, a discount with an odd cent, a no-show, a block, a break,
    a seat over a break, an unmarked past visit, a follow-up, a day at a location the schedule
    does not offer.
49. **`libs/features/staff/dashboard/src/lib/staff-analytics.agreement.spec.ts`** (Create) — over
    the fixture, through the store's own path: day-summary minutes equal unsold + open per
    barber-day; seat nets and `ClientStatsSystem` spend agree within one cent per worked seat (the fixture includes a client with three seats on
    one visit and a BGN visit);
    `rowsFor` totals equal their figures.
50. **`tools/verify/bundle/budgets.json`** (Modify) — a route ceiling for
    `libs/features/staff/analytics/src/index.ts`, ~5% above its first production build, dated.
51. **`apps/web/e2e/staff-analytics.spec.ts`** (Create) — Ivan opens «Анализи» from the menu and
    sees the footer of takings equal the figure; an unlinked barber sees the not-linked state; the
    admin links a barber on the client card and sees their figures; the open-hours card opens the
    agenda with free rows.
52. **Rollout** — deploy order: `firestore.rules` and functions first (the callable and the
    `setRoles` change), then the web app; an older web app ignores `linkedBarberId`. **Rollback**:
    remove the route and the menu row; the callable and the field stay unread.
53. **`docs/architecture/decisions/2026-11-07-staff-analytics.md`** (Create) — the ADR: computed
    on demand, the user-side link and its lock, the `setRoles` decision table, rebooking on shop
    dates, the visibility rule as a product rule, the client card on its own split for now, and
    what §4 of the earlier statistics design is kept, replaced or dropped.

### Verification Plan

- **Compilation/Build**: `pnpm nx run-many -t typecheck`; `pnpm nx build web` (templates are only
  checked here); `pnpm nx build functions`.
- **Unit Tests**: `pnpm nx run ecs-core:test` (items 1–27, 48), `pnpm nx run functions:test`
  (items 2, 8, 28–32), `pnpm nx run staff-analytics:test`, `staff-dashboard:test` (items 15,
  46–47, 49), `client-card:test`, `shell:test`, `firebase-app:test`, `web-storage:test`.
- **Static Analysis & Linting**: `pnpm nx run-many -t lint` — includes `creativo/no-sliced-ports`,
  `creativo/presenter-purity`, the query-limit rule and the tier import restrictions;
  `pnpm nx run verify-tools:layering` — the tier hierarchy, runtime cycles, barrel contents and
  one home per exported name.
- **Test Coverage Requirement**: every catalogue formula has a hand-computed case;
  `ChairTimeSystem` has the sum property; `rowsFor` sums to every figure; every visibility row
  and every row of the `setRoles` decision table has a case.
- **E2E/Integration**: item 33 (`pnpm nx run functions:test-integration` against the emulators)
  and item 51 (`pnpm nx run web:e2e`), run alone, never in parallel with `run-many -t test`. The
  emulator does not enforce composite indexes; every new query uses an existing or default index
  (item 9 adds only `fieldOverrides`).
- **Performance**: open «Анализи» on the `web:build:csp-smoke` production build at 390×844 with 4×
  CPU throttle — first frame from cache within the tap's frame, no frame over 16.7 ms; if it
  misses, stage the lower sections with the schedule's `SHEET_STAGED` / `climbStages` helpers
  (moved then to `libs/ui/layout`). Callable p95 for a barber-month and a shop-month from the
  `AnalyticsReported` `durationMs` field, in the emulator and after the first deploy.
- **Correctness gate before v2**: one month of takings + tips − voucher draws against the shop's
  cash + card totals, within 2%, every difference above €20 explained.

---

_Drafted with EGM_
