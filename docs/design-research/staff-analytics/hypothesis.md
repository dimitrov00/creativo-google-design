# Staff analytics — working hypothesis

- **Date:** 2026-11-07
- **Status:** input to the brainstorm review. The owner delegated every open question
  ("pick your best recommendations and proceed"); each pick below states why.

## The problem

Barbers and the shop owner run the business from this app but cannot see how it is going.
Today the only figures are the day summary line in the schedule (tips, free minutes at one
chair) and the per-client numbers on the client card. Nobody can answer:

- a barber: "how much did I take this month, how much of my day sat empty, and where are my
  open hours next week?"
- the owner: "which chairs and hours are underused, which services earn the most per hour,
  are clients coming back, and is the shop growing?"

The owner asked for analytics that are fuller than Fresha's and Calendly's and presented like
Revolut's spending screens, with free time as a first-class figure.

## What exists to build on

- `docs/design-research/availability-and-statistics-design.md` §4 — a statistics model written
  before the ECS migration: how each kind of occupied time is classified (§4.1), exact metric
  formulas with benchmarks (§4.2: utilisation, RevPAH, no-show and cancellation rates,
  average ticket, fragmentation), three storage tiers (§4.3), cancellation handling (§4.4), and
  a privacy boundary (§4.7). Its file paths and class shapes are obsolete (pre-ECS); its
  definitions are not.
- Data already recorded on appointments: seat prices and currency, tips (`tipCents`),
  discounts and vouchers, `bookedAtUtcMs`, `arrivedAtUtcMs`, `bookedFromAppointmentId`
  (rebooking), booking origin, per-seat outcome (attended / no-show / cancelled with reason and
  side), lead-time samples (`barberLeadTimeSamples`), per-client projections (`clientStats`),
  the admin-managed visit rhythm per client (loyalty), weekly rosters with breaks and
  per-day departures, blocks (`scheduleExceptions`).
- `GridLayoutSystem` already computes a chair's holes per day, split into elapsed and
  sellable, and the agenda now lists both (2026-11-07).
- Laws that bind the design: pure systems compute every figure (Law 3); presenters only word
  it (Law 10); a derived value is stored only as a projection justified by a privacy boundary
  or a read fan-out, rebuilt by trigger, never `FieldValue.increment` (Law 5 and §4.3);
  money is integer cents in EUR; time math on the shop's wall clock.
- Roles in code: `client`, `barber`, `receptionist`, `content_manager`, `admin`, `sysadmin`.
  There is no `owner` role; `admin` is the owner/manager.

## Decisions taken for the owner

### 1. Who sees what

| Role                          | Sees                                                                                                                                                                                                       | Does not see                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `barber`                      | Everything about their OWN chair: takings, tips, worked/blocked/free time past and future, services, their clients, rebooking, no-shows. Shop context only as an unnamed figure ("shop average fill 72%"). | Any colleague's figures, names in rankings, shop revenue. |
| `receptionist`                | Operational, money-free: open time per chair for the coming days, fill per day, no-shows and late cancellations, waitlist matches.                                                                         | Revenue, tips, per-barber performance comparisons.        |
| `admin`                       | Everything, per barber and shop-wide, money included, plus export.                                                                                                                                         | —                                                         |
| `content_manager`, `sysadmin` | Nothing by default.                                                                                                                                                                                        | —                                                         |

Why: in a 2–6 chair shop a named league table between colleagues causes friction and is
employment-sensitive; an unnamed shop figure gives the barber a reference without a ranking.
The receptionist's job is filling chairs, so they need open time, not money.

### 2. Money

- Version 1 shows **takings** (what clients paid for the barber's services, after discounts,
  before vouchers are netted, in EUR) and **tips** as two separate figures. It does not call
  either "earnings".
- "My earnings" needs a pay model (commission %, chair rent or salary), which the app does not
  have. Version 2 adds a per-barber pay rule set by the admin and computes earnings with a pure
  system. Getting pay wrong costs trust, so it ships only after takings have been checked
  against real payouts.

### 3. The decisions analytics must drive

- **Barber:** fill my open hours this week; know which services earn the most per hour of my
  time; see which of my regulars are overdue (by their rhythm); see whether I am growing
  (this month vs last month and vs the same month last year).
- **Owner:** set rosters and hours (demand vs open time by weekday × hour); decide on hiring or
  cutting chair time (fill per chair); set prices and the service menu (revenue per hour by
  service, service mix); set a no-show / deposit policy (no-show and late-cancel rates); judge
  retention (share of new clients who return within 60 days, per barber); see where bookings
  come from (online, staff, walk-in).
- **Receptionist:** today's and tomorrow's open time to fill; who is on the waitlist for it.

A figure that does not feed one of these decisions is out.

### 4. Free time, exactly

- **Rostered time** = the barber's working windows for the day (pattern plus departures).
- **Worked time** = visits that happened, including their setup/cleanup padding.
- **Blocked time** = blocks and paid breaks the shop chose: shown as its own category, never as
  free and never as worked (per §4.1: a block consumes sellable time).
- **Unpaid breaks, days off, sick** = excluded from capacity entirely.
- **Free time** = rostered − worked − blocked − excluded, split in two:
  - **Unsold** (past): time that could have been sold and was not. Reported per day/week.
  - **Open** (future): time that can still be sold, counted only in holes at least as long as
    the shortest service.
- **Slivers**: holes shorter than the shortest service, reported as their own figure
  ("time lost to gaps too short to book"). A large sliver total is a scheduling problem (buffers,
  step size), not a demand problem; the screen says which one it is.
- No-show time is shown apart from free time: the chair was booked and the client did not
  come.

### 5. Where it lives

- **An "Анализи" screen** per role, reached from the shell menu: a period switcher (week,
  month, year, custom), a hero figure with its change against the previous period, then cards.
  Presentation follows Revolut's spending screens: one big number, a bar chart over periods,
  "by category" lists with share bars.
- **Every figure drills down to the visits behind it** (Revolut: category → transactions). A
  number that cannot be opened is not trusted.
- **Inline figures where the work happens**: the schedule's day summary (exists), the client
  card (exists), open-time hints on the week strip.
- **A weekly digest** on Monday morning (in-app card, optional push): last week in three
  sentences and this week's open hours with the emptiest day.
- **CSV export** for the admin (accountant, payroll).

### 6. Scale and history

- Expect 1–3 locations and 2–10 barbers per tenant in year one; 8–15 visits per barber per day.
- History starts when the shop starts using the app. Imported legacy visits count if the
  legacy migration brings them; otherwise the first comparisons are empty and say so.
- Comparisons: previous period and the same period last year.
- **Small-sample honesty**: a rate is shown only when its base is large enough (for example 20
  visits); below that the screen shows the counts ("2 of 9") instead of a percentage.

### 7. How this beats Fresha, Booksy and Calendly

Checked against `competitor-research.md` (same folder). What it found that shapes the
claims: salon tools build reports for the owner and give the barber a cut-down or separate view
(Square Team, Booksy wallet, Boulevard "Self" tier); only theCut puts the barber's numbers on
the phone's home screen; Fresha's retention reports sit behind a paid add-on; no salon tool
ships goals (Uber/Lyft do); Boulevard users ask for period-over-period change and call the
reports "raw data"; trust breaks when totals disagree between screens; and products define
rebooking and utilisation differently, so every figure here must state its definition. The
claims to test:

1. Every number opens to the visits that make it up.
2. Forward-looking, not only reports: open hours for the next 7 days and clients due back,
   with a one-tap path to fill them (share a slot, message a client).
3. Built for the barber's phone first; the competitors' reports are owner/desktop tools.
4. Plain-language findings ("Thursdays after 15:00 were empty 4 weeks in a row") computed by
   systems, worded by presenters.
5. Honest about small numbers (point 6 above).

## Storage sketch (to be tested by the review)

- Pure systems fold appointments, rosters and blocks into a **barber-day figure set** (the
  §4.2 totals, rebuilt for the ECS laws).
- A **monthly projection per barber** (and one per location) stores the folded figures, because
  a month screen would otherwise read ~250 appointments and 30 rosters on every open (Law 5
  read fan-out). Rebuilt by a trigger on appointment, block and roster writes, recomputed from
  source, never incremented. Week and year views fold the month and day figures on read.
- Security rules: a barber reads only projections with their own `barberId`; the receptionist
  reads money-free projections; the admin reads all.

## Success measures

- Share of barbers who open the analytics screen at least weekly after 4 weeks.
- Unsold hours per barber per week trending down over 3 months.
- Weekly digest open rate.
- The admin's takings total matches the shop's cash/card records for a month (correctness gate
  before "earnings" ships).

## Out of scope for version 1

Payroll and commission payouts; marketing campaigns; retail/product sales (the app sells
services only); an AI chat over the data; a data warehouse (BigQuery); client-facing analytics.
