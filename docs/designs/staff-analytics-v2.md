# Staff Analytics v2

- **Author:** Dimitar Dimitrov (owner) with Claude
- **Status:** Approved — EGM review concluded 2026-11-08 (Stages 5–9; the findings and their resolutions are in `docs/design-research/staff-analytics/review-v2/`)
- **Date:** 2026-11-08
- **Predecessor:** [concepts_brief_v2.md](../design-research/staff-analytics/concepts_brief_v2.md); the shipped v1 design [staff-analytics.md](./staff-analytics.md) and its record [2026-11-08-staff-analytics.md](../architecture/decisions/2026-11-08-staff-analytics.md)
- **Supersedes:** in the v1 record, D1's "Nothing is written" and D7's storage and sealing rows; in the v1 design, "Reads and cost", Alternative C's reason for rejection and the Future Improvements list. v1's Non-Goal "Earnings and pay" promised pay in v2; v2 does not deliver it (see Non-Goals).

---

## Overview

Staff Analytics v1 shipped on 2026-11-08: one screen, «Анализи», that a barber or the admin
opens for a week or a month; one callable computes its report by re-reading every visit of
the period, and the screen draws the figures as rows in one grey. The owner's first reading
of it asked for six things, in the owner's words, and this document is the plan for them:

1. graphs instead of rows, creative, understandable at a glance, with colour that explains
   (Goals 3 and 4 state the measurable form);
2. a day, a week, a month and a year;
3. the later stages the v1 design listed — stored daily figures, same period last year,
   custom ranges, goals, export — and a decision on pay and sealing;
4. one tap from the schedule, where staff spend the day;
5. exportable reports;
6. an answer on whether «Към 11:40» means the figures are rebuilt live on every open.

**The proposed solution.** Keep v1's model — one read-only callable, the report cached on
the device and painted before the call, the visibility table, the agreement specs that
prove the figures add up — and change four things:

1. every past barber-day becomes one small stored document, written by the triggers that
   already run on each booking and by a nightly sweep, so that any period up to a year reads
   days instead of visits;
2. three chart components join the design system (a fourth, the radar, in a later PR) and
   the screen is redrawn around seven questions, each answered by one chart and one
   sentence;
3. a toolbar button on the schedule opens the screen on the schedule's barber and day;
4. `DAY`, `YEAR` and `CUSTOM` spans with a comparison against the previous period.

Goals and a CSV export follow; pay and sealing get a design of their own.

**The answer to item 6.** «Към 11:40» is the time the server computed the report, not a
clock. Nothing is live: the screen paints the cached report, then makes one request. The
cost is that request — about 1,000 document reads for a barber-month and 11,500 for the
shop-month, because the server re-reads the period's visits each time. Stored days cut that
to about 260 and 2,100, make the year possible, and the stamp becomes «Обновено преди 2 мин».

## The Problem

### The screen does not explain

v1's screen prints every figure as text or a grey bar; nothing on it is distinguishable by
colour. "Where the time went" is a flat bar in greys and a list of minutes; "fill by
weekday" is seven rows with a thin bar each; services and clients are rows. A barber reading
it has to turn numbers into a picture themselves: which hours are empty, whether this month
is better than last, which weekday to push bookings into. The reference apps the owner
named (Revolut among them) draw the picture — a figure over a line, a breakdown as a stacked
bar, a grid for "when" — and use colour to say what a mark means. v1 refused colour because
the design system's accent rule (`libs/ui/tokens/src/lib/accent-rule.spec.ts`) reserves one
orange for chrome.

### Every open re-reads the period

v1 computes on demand and stores nothing, by decision (v1 record D1): a month is read from
its ~400 visits per barber on every open. That met the 1.5 s / 4 s budgets for a week or a
month at greenfield volume. At ~5,000 visits per barber-year (50,000 for the shop) a year or
a custom range is not expected to fit those budgets, and stepping between days costs a month
each. The v1 record named the upgrade path — a stored figure set per barber-day — and set
its trigger: "the year view, same-period-last-year or custom ranges are built". v2 builds
them. This is Law 5's read-fan-out case — a year reads 5,000 visits per barber — met in Law
5's prescribed form: a projection that a trigger rebuilds and a TTL expires.

### Analytics lives two taps away from the day

The schedule is the screen staff work from. v1 reaches «Анализи» only through the shell
menu, and it opens on the month, not on the day the person was looking at. The search on
the schedule is the existing precedent: a tap on the toolbar, an animated hand-off, the same
place on return.

### The later stages are undefined

The v1 design listed v1.1, v1.2 and v2 items without a design for any of them: goals,
written findings, year view, custom ranges, pay rules and earnings, export, sealing. Some of
them (pay) carry legal weight and a precondition that has not happened yet (the
reconciliation gate: v1's success measure that a month of real takings and tips, less
voucher draws, agrees with the till within 2 %). This document decides which ship in v2,
which fold into something simpler, and which get their own design.

## Terms

v1's Terms hold — visit, seat, follow-up, departure, roster, hole, `ShopNow`, hero,
callable ([staff-analytics.md, Terms](./staff-analytics.md#terms)). These are added or
changed:

- **Drill-down** — the sheet of rows (seats or days) that a figure opens to, whose total
  equals the figure (v1's G4).
- **Stretch** — one rostered working window of a barber at one location on one day; a day
  may hold several (two locations, a split shift).
- **Busy key** — `{barberId}__{localDate}` (`BusyKey`), the id of a `barberBusy` day and now
  of a day document.
- **Span** — the kind of period: `DAY`, `WEEK`, `MONTH`, `YEAR` or `CUSTOM` (any `from ≤ to`
  of at most 366 days). v1 had `WEEK` and `MONTH`.
- **Comparison period** — the previous period of the same span: for `DAY`, the same weekday
  a week earlier; for `WEEK`/`MONTH`/`YEAR`, the one before; for `CUSTOM`, the same length
  ending the day before. "Same period last year" is not in v2 (Future Improvements). A
  comparison period that starts before the reach is not read: its figures are `null` and
  the chip says so.
- **Counterpart day** — the day in the comparison period that today is compared with: the
  same position in that period (for `DAY`, the same weekday a week earlier). Its seats count
  up to the current minute (v1's hero rule).
- **Reach** — how far back a period may start: 12 months, as v1.
- **Past day** — a barber-day `d` with `d + 1 < today` at every location where the barber
  has a stretch on `d` — two days back, so that the rebooking window (a follow-up booked by
  the end of `d + 1`) has closed. For a day with no stretch at any location, "past" is judged
  on the default location's clock. This is the one rule; the day's chair-time partition
  keeps v1's first-stretch clock. A past day's figures change only when a visit of that day,
  or a follow-up booked from it, is edited, or when the definition version changes. (v1's
  "closed day" keeps its meaning: a barber-day with a `CLOSED` departure — the barber's day
  off.)
- **Live day** — every day of the period that is not past: normally today and yesterday,
  three when the barber's locations lie in different time zones. Their figures are computed
  from their visits on every open, because some parts of a day change with the clock (open
  time becomes unsold time; a booking that ended becomes unmarked) and because the rebooking
  window is still open. The screen's "today" is the default location's clock.
- **Day document** — `analyticsDays/{busyKey}`, the entity `BarberAnalyticsDay =
BarberAnalyticsDayMeta & DayFigures`: one past barber-day's figures, written for every
  past calendar day of every barber record, zeros included, by a trigger or the recompute;
  never by the callable, never read by a client directly. "Day document" in prose
  throughout.
- **Recompute** — `startAnalyticsRecompute` / `continueAnalyticsRecompute`: a budgeted pass
  over the job document `backfillJobs/analyticsRecompute` that hands eligible days to
  `writeAnalyticsDay`, one page of `PAGE_SIZE = 100` keys per step, resumed from a cursor
  until done. Its contract is in "The recompute's job document".
- **Sweep** — the 04:30 `CRON_TIME_ZONE` schedule that starts a recompute.
- **Eligible** — a past day whose document is missing or carries an older
  `dayDefinitionVersion`, among the keys of the pass's extent: the window from the day
  before the last completed pass's date to today (an outage widens the window by itself),
  or the full reach when the job document's recorded definition version or barber-id list
  differs from the current one. A step reads its page's documents by id and hands only the
  eligible keys to the writer. One mechanism: there is no backfill job, no seed writer, no
  retry list and no count query.
- **Definition version** — `ANALYTICS_DEFINITION_VERSION`, 2 from PR 4a. A bump makes the
  whole reach eligible; the next recompute rewrites it, and the callable computes a missing
  day live meanwhile.
- **Flag** — `analytics.storedDays` (`FlagName.AnalyticsStoredDays`): on means day documents
  are read; off means `loadAnalyticsDays` is not called and every past day is computed live
  (one read path). It is a build-time manifest flag (`config/feature-flags.json` per
  environment, written into the functions' environment at build; the emulator project
  `demo-creativo-test` reads the `development` map): turning it on in production is a
  manifest edit and a functions redeploy, not a runtime toggle.
- **Hour buckets** — `dayHourWorked` and `dayHourRostered`: 24 integers each, the minutes of
  worked (attended) and rostered time overlapping `[h:00, h+1:00)` on the wall clock, so a
  DST day is 24 buckets too. Worked, not occupied: a no-show hour is not busy.
- **Chart kit** — `@creativo/ui/charts`: `ui-bar-chart`, `ui-line-chart`, `ui-heatmap` in PR
  2, `ui-radar` in PR 5; SVG drawn from Angular templates, styled by CSS tokens.
- **Dock** — the screen's bottom action bar (`ui-page-action-bar`), which the analytics page
  gains in PR 7 for «Експорт». A sheet's bottom button row is "the sheet's action row".
- **Open-hours card** — v1's card of bookable open minutes in the next 7 days, redrawn with
  seven bars.
- **The morph** — the shared `view-transition-name` between the schedule's chart button and
  the analytics headline, so one grows into the other on navigation.
- **Goal** — a takings range for one month, set by a barber for themselves or by the admin
  for the shop; never a single imposed number.
- **Export** — a CSV of the open period's day rows and service rows, shared from the phone.

## Goals

1. **Past days are stored on event and recomputed only on cause.** A past day is rewritten
   only when one of its visits or follow-ups is edited or its definition version changes.
   Measure: the agreement spec proves a month assembled from day documents plus the live
   days equals the same month computed from visits; `AnalyticsReported.missingDays` is 0 in
   steady state.
2. **Past days of every span are read as day documents, not visits.** Measure: a
   barber-month open costs ≤ 300 reads, the fixed reads of every open (the barber records,
   the locations, the roster, the policy) included (v1: ~1,000); a shop-month ≤ 2,500 (v1:
   11,500); `YEAR` answers under 1.5 s p95 for a barber and 4 s for the shop; `DAY` under
   1 s.
3. **Seven questions, seven charts, each with one sentence.** Measure: a tester who has not
   seen the screen names the busiest hour, the emptiest weekday and whether the month is up
   or down without reading a number.
4. **Colour explains without new hues.** Measure: every chart mark uses an existing token by
   meaning (accent = earned, red = lost, hatched amber = needs a mark, grey = nothing
   happened, identity tone = whose chair); `chart-palette.spec.ts` pins each mark's contrast
   against both surfaces and the distinguishability of every adjacent pair of parts in both
   themes; the accent-rule spec stays green.
5. **One tap from the schedule, and back to the same day.** Measure: tap → first frame from
   the cache with no frame over 16.7 ms at 4× CPU throttle on a production build; Back
   restores the schedule's `?day&view&barber`; the e2e proves both.
6. **A monthly goal per barber and for the shop.** Measure: the goal ring shows the month's
   pace; the goal is readable only through the callable.
7. **The days and services of any period export as CSV.** Measure: a share sheet opens on a
   phone with the file; on a desktop browser it downloads; no client name is in it.

## Non-Goals

- **Earnings, pay rules and sealing** — their own design, `docs/designs/staff-pay.md` (to be
  written), after the reconciliation gate (The Problem). v1 promised pay in v2; v2 does not
  deliver it.
- **A security boundary on money.** Unchanged from v1: every book-working role reads every
  appointment. Day documents and goals are callable-only, which is a storage choice, not a
  boundary change.
- **Ranking barbers on a barber's screen.** Unchanged. The radar is admin-only; a barber's
  report never carries another barber's figure.
- **"Same period last year".** Not until a year of stored days exists (Future
  Improvements): the wire decodes `analyticsComparison` and refuses `SAME_LAST_YEAR` with
  `ANALYTICS_INVALID_INPUT` until then; reach stays 12 months; the TTL is 13 months.
- **Storing live days.** They are always read live.
- **A separate drill-down call.** Seat rows behind a figure are still read live from the
  visits when tapped, as in v1.
- **Written findings as a separate system.** Each chart carries one sentence worded from
  values the report already holds; no "insights" engine.
- **Six categorical hues.** Deferred behind a gate (Open Questions).
- **Print to PDF, a share card, PNG export, a seat-level CSV.** Deferred until asked for
  after the CSV ships (Future Improvements).
- **Rewriting history after a roster, location-hours or cancellation-policy edit.** A past
  day's rostered minutes are the roster as it stood when the day became past; a late
  cancellation is judged by the window stamped on the seat at cancellation
  (`ClientStatsPolicy.isLateCancellation`), so a policy edit changes no stored count.
- **Compare two barbers side by side, fill by weekday as a 100 % stack, a calendar heatmap,
  sparklines in the client tiles, a "year" section** — cut as duplicates of other charts or
  decoration.
- **v1's other non-goals hold**: one free-time number for `capacity`, the roster permission,
  the private reason for a block, push notifications, retail, campaigns, an AI chat, a data
  warehouse, client-facing analytics.

## Decisions

One line each; the section named elaborates.

- **D1 — Past days are stored on event; the live days are read.** Every past calendar day
  of every barber record is one day document, written by the appointment and departure
  triggers and the recompute; the callable never writes. → Technical Plan, "Shape" and
  "The day document".
- **D2 — Three chart components of our own, built as the screen needs them**, a fourth for
  the radar; `ui-gauge` for rings. → "The screen", "Chart kit".
- **D3 — Colour by meaning from existing tokens, zero new hues**; a hatch where two warm
  tokens would touch. → "The screen", "Colour".
- **D4 — Seven questions, seven charts, one sentence each.** → "The screen", "The seven
  questions".
- **D5 — A toolbar button on the schedule, the router's own transition, a route.** →
  "Entry from the schedule".
- **D6 — Goals are a monthly range in `analyticsGoals`, shown on the month span; findings
  fold into the charts.** → Technical Plan, "Goals (PR 6)".
- **D7 — Export is one CSV through a shared browser helper.** → "Export (PR 7)".
- **D8 — Pay and sealing are their own design.** → Non-Goals, Alternative L.
- **D9 — The callable v2 contract and catalogue version 2**: `DAY`/`YEAR`/`CUSTOM`, the
  previous period as the comparison, the new figures. → "The callable v2 contract and
  catalogue version 2".
- **D10 — Records**: `docs/architecture/decisions/2026-11-09-staff-analytics-v2.md` and
  this design supersede the named parts of v1. → Detailed Implementation Plan, PR 8.
- **D11 — `CapacityMonthId` becomes `MonthKey`, repo-wide**: one brand for `YYYY-MM`; a
  second brand would need a cast wherever a month crosses from capacity to goals. →
  "Goals (PR 6)".

## Open Questions

- **Hue-per-part later?** If the owner wants a categorical colour per chair-time part after
  seeing the redrawn screen, the set is chosen outside the accent's warm sector (hue 25–95,
  the identity block's exclusion), validated by the dataviz skill's `validate_palette.js`
  (run by hand, outside the repository) and pinned by `chart-palette.spec.ts` — one later
  PR, not a redesign.
- **`RouteReuseStrategy` for the schedule?** Decided by PR 1's Back measurement: if Back's
  re-mount of the schedule drops a frame over 16.7 ms at 4× CPU throttle on a production
  build, a detach/attach strategy for that one route (which also keeps scroll) is added;
  otherwise not. **Decided 2026-11-08 (PR 1): added** — Back re-mounted the schedule in one
  52–64 ms task at 4× and re-issued five to eight reads; with the strategy Back issues none
  (`docs/design-research/staff-analytics/perf/pr1-entry.md`). The morph was not kept: the
  forward path's first render already exceeds the rule without it, so the root cross-fade
  stays.

## Critical User Journeys (CUJs)

v1's CUJs 1, 4, 5 and 6 hold unchanged; v1's CUJs 2 and 3 are restated here as CUJs 3
and 8.

### CUJ 1: A barber checks today from the schedule

- **Given**: a linked barber on the schedule, on today, their own chair selected; PR 3 has
  shipped (until then the button opens the week that holds the day).
- **When**: they tap the chart button in the toolbar.
- **Then**: «Анализи» opens on `DAY` for today and for that barber, the cached report
  paints at once, the fresh one replaces it, and the day shows the hero, the tall segmented
  time bar, the services and the open-hours card. Back returns to the schedule on the same
  day and view (period picks inside analytics replace the URL rather than push it).

### CUJ 2: A barber reads the month as a picture

- **Given**: the screen open on `MONTH`.
- **When**: they scroll through the takings line, the time bars and the heatmap.
- **Then**:
  - the line shows each day's takings, last month as a grey line, and a dashed average;
  - the stacked bars show, day by day, accent worked time, red no-shows, hatched amber
    unmarked visits and grey blocked/unsold/other;
  - under the bars a table names each part with its minutes and share;
  - one sentence under the heatmap names the busiest and the emptiest hour;
  - tapping a bar opens the day's rows.

### CUJ 3: A barber fills an empty afternoon (v1's CUJ 2, kept)

- **Given**: the open-hours card shows seven bars, the emptiest in the accent.
- **When**: they tap that bar.
- **Then**: the schedule opens on that day in the agenda view with free time drawn
  (`?free=1`), and leaving the schedule clears it.

### CUJ 4: The admin looks at the year

- **Given**: an admin on the shop scope.
- **When**: they pick «Година».
- **Then**: the line draws twelve months and the time bars show a bar per month; the answer
  arrives under 4 s and costs about 5,000 reads (≈ 8,700 once a comparison year exists; v1
  would re-read ~50,000 visits); the comparison chip reads «няма данни за сравнение» until
  the stored days reach back a year, because the previous year starts before the reach;
  stepping back further than the reach is not offered.

### CUJ 5: The admin compares the barbers

- **Given**: the admin on the shop scope, `MONTH`.
- **When**: they scroll to «Как се справя всеки».
- **Then**: one radar per barber: four axes normalised 0–100 against the best barber
  meeting the sample floor (€ per hour of service, fill, rebooking, tips rate), reliability
  absolute, a subtitle saying so in words, the previous month as a grey outline on the same
  base, an axis under the floor drawn as missing with a word. Tapping a radar switches the
  scope to that barber.

### CUJ 6: A barber sets a goal

- **Given**: a barber on `MONTH`, the current month.
- **When**: they tap the goal ring's «Задай цел» and enter a range, e.g. 1 800–2 200 €.
- **Then**: `setAnalyticsGoal` stores it for that month with an audit row; the ring shows the
  pace («12 от 22 работни дни · на път»); colleagues cannot read it; the admin sees it only
  on that barber's scope.

### CUJ 7: The admin exports the month

- **Given**: the admin on the shop scope, `MONTH`.
- **When**: they tap «Експорт» in the dock.
- **Then**: the phone's share sheet opens with `creativo-analytics-2026-11-01-2026-11-30.csv`
  (days per barber and the shop's services, no client names); on a desktop browser the
  file downloads.

### CUJ 8: A figure is questioned and checked (v1's CUJ 3, kept)

- **Given**: a past month on the screen.
- **When**: the barber taps the takings figure.
- **Then**: the seat rows of the month are read live and their total equals the figure. If
  a visit of that month was edited seconds ago and the trigger has not yet rewritten the
  day, the rows page says so («Цифрата е от 11:40; редовете са към момента»), and the next
  open after the rewrite agrees.

### CUJ 9: A visit of a past day is edited

- **Given**: a visit three weeks ago marked as a no-show by mistake.
- **When**: the receptionist marks it attended.
- **Then**: the appointment trigger rebuilds that barber-day's document from its visits in
  the same run that rebuilds the busy projection; the next open of any period containing
  that day shows the corrected figure; nothing else is recomputed.

## Technical Plan (Architecture)

### Shape

v1's shape stands: one read-only callable, `staffAnalytics`, answers a report for one scope
and one period; the device caches it; the screen paints the cache and then asks. v2 adds
four things: a **write path** — `writeAnalyticsDay`, fed by the existing triggers and the
recompute — that keeps one document per past barber-day; a **read path** that assembles a
period from those documents plus the live days; a **chart kit** and an **entry** on the
schedule; and, later, one new callable (`setAnalyticsGoal`) and a client-side export. New
pipelines: `writeAnalyticsDay`, `startAnalyticsRecompute`, `continueAnalyticsRecompute`,
`setAnalyticsGoal`.

```text
WRITE PATH (on event)                                READ PATH (on open)

appointments/{id} write ──┐                          schedule toolbar ─► /staff/analytics?span&from&to&barber
scheduleExceptions write ─┼─► writeAnalyticsDay ───► analyticsDays/{barberId}__{localDate}
04:30 sweep ─► recompute ─┘   (one transaction        ▲                 │
   (eligible days, in          per past day)          │ the recompute    │ reads ≤ 366 per barber
    budgeted steps)                                   │ repairs          ▼
                                                 staffAnalytics ◄── visits of the live days
                                                      │             next 7 days (live, as v1)
                                                      ▼
                                               AnalyticsReport v2 ──► device cache ──► screen (charts)
```

**Who writes what, in order.** The appointment trigger (`rebuildBusyOnAppointmentChange`)
already recomputes `barberBusy` for every busy key that either side of a write names
(`before.busyKeys ∪ after.busyKeys`, derived inside `rebuildBusy` by
`BusySystem.affectedKeys`). The composition root hands the same decoded command
(`RebuildBusyCommand`: both sides, the salvaged keys, the refusal) to two pipelines: the busy
rebuild, and `writeAnalyticsDay`, whose `'APPOINTMENT'` command carries those sides and
calls `BusySystem.affectedKeys` itself — each pipeline derives its own keys from the sides,
as the busy pipeline's rule says. When the written visit is a follow-up
(`bookedFromAppointmentId` set), the writer also rebuilds that source visit's past day. The
departure trigger (`scheduleExceptions`) runs the writer for its one key. The sweep starts
a recompute, which writes the eligible days (Terms) in budgeted steps. The callable never
writes.

**Failure semantics.** Inside the appointment trigger the two answers are joined by
`combinedReport(busy, day)` in `triggers.wire.ts`: `attemptFailure =
TriggerAttemptSystem.decisiveFailure([...busyFailures, ...dayFailures])`, no survived
failure; the writer runs whatever the busy rebuild answered. A transient failure redelivers
the whole event and both rebuilds run again (both are idempotent); a decisive one (a
malformed document) logs `AnalyticsDayWriteFailed` with the key and is an accepted residual
— if the malformed document is the visit or the departure, fixing it fires the same
trigger; otherwise the day is rewritten on its next edit or the next version bump (Risks).

**Stamp ordering.** `writeAnalyticsDay` takes `sourceReadUtcMs = ports.nowUtcMs()` before
its first read. Outside the transaction, through the named bundles: the barber's roster,
the policy, the locations, and `loadVisitsByBusyKeys([key])` to learn the day's visit ids.
Inside one `commit` per day: `tx.query(visitsOnBusyDay(key))` — `busyKeys array-contains
key`, no status filter so cancelled visits are included, `limit VISITS_PER_BARBER_DAY + 1`
(one row over the cap answers `RepositoryError.readFailed(path, 'resource-exhausted')`);
the follow-ups of those ids as `tx.query` with `QueryOp.In` in chunks of 30
(`BackfillPlanSystem.chunk`); `tx.get` of the existing day document, of
`appointments/{sourceAppointmentId}` when the command names one, and of
`scheduleExceptions/{key}`. The decide step folds and writes only if the existing
document's `dayComputedAtUtcMs` is earlier than `sourceReadUtcMs`. Two writers racing leave
the later computation; neither can overwrite a newer one with older reads (Law 7 T2, stamp
ordering). Clock skew between two function instances is assumed sub-second; the residual —
an older computation winning a race — is accepted and rewritten on the day's next edit
(Risks).

### The day document

`analyticsDays/{busyKey}`. Entity `BarberAnalyticsDay = BarberAnalyticsDayMeta & DayFigures`
(`entities/barber-analytics-day.entity.ts`; `BarberAnalyticsDayMeta = { id:
BarberAnalyticsDayId }`, an id companion whose text is the busy key). One per-day family,
composed by intersection (Law 6): `DayRow` is the row the answer carries — the identity,
every part and the money; `DayFigures = DayRow & DayCounts & DayServices & DayHours` is the
stored body (`components/day-figures.data.ts`). The answer's rows are produced by the
declared projection `DayFigures.rowOf<T extends DayRow>(figures: T): DayRow`, never a
field-copying mapper.

| Slice                    | Fields                                                                                                                                                                                                                                          | Type                                                                      | Note                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `BarberAnalyticsDayMeta` | `id`                                                                                                                                                                                                                                            | `BarberAnalyticsDayId`                                                    | the document id, the busy key's text                                                                                        |
| `DayRow`                 | `barberId`, `localDate`                                                                                                                                                                                                                         | `BarberId`, `LocalDate`                                                   | the query keys; on a per-month row (spans over 93 days) `localDate` is the month's first day                                |
| `DayRow`                 | `dayRosteredMinutes`; the ten parts `dayWorkedMinutes`, `dayNoShowMinutes`, `dayUnmarkedMinutes`, `dayBookedAheadMinutes`, `dayHeldMinutes`, `dayBlockedMinutes`, `dayBreakMinutes`, `dayShortGapMinutes`, `dayUnsoldMinutes`, `dayOpenMinutes` | `MinuteCount`                                                             | `ChairDay`'s sum and parts; a stored past day carries `dayBookedAheadMinutes: 0` and `dayOpenMinutes: 0` (one hidden class) |
| `DayRow`                 | `dayClosedDayMinutes`                                                                                                                                                                                                                           | `MinuteCount`                                                             | v1's `reportClosedDayMinutes` per day; not a `ChairDay` part                                                                |
| `DayRow`                 | `dayTakingsCents`, `dayTipsCents`, `currency`                                                                                                                                                                                                   | `PriceCents`, `Currency`                                                  | euro cents after `ClientStatsSystem.inEuroCents` (the system's fixed changeover rate)                                       |
| `DayCounts`              | `dayOutsideHoursMinutes`, `dayOutsideHoursSeatCount`                                                                                                                                                                                            | `MinuteCount`, count                                                      | a worked seat on a day with no stretch lands here, through the visit's key                                                  |
| `DayCounts`              | `dayExcludedVisitCount`, `dayWorkedSeatCount`, `dayNoShowCount`, `dayNoShowBase`, `dayRebookedBase`, `dayRebookedCount`, `dayLateCancellationCount`                                                                                             | counts                                                                    | rebooking final from two days back (Terms, "Past day"); late cancellation by the seat's stamped window                      |
| `DayCounts`              | `dayOnlineVisitCount`, `dayStaffVisitCount`, `dayUnknownOriginVisitCount`                                                                                                                                                                       | counts                                                                    | the three `BookingOrigin`s, flat                                                                                            |
| `DayServices`            | `dayServices`                                                                                                                                                                                                                                   | `readonly { serviceId; workedSeatCount; takingsCents; serviceMinutes }[]` | the ratio per hour is derived, never stored; `fieldOverrides` `indexes: []`                                                 |
| `DayHours`               | `dayHourWorked`, `dayHourRostered`                                                                                                                                                                                                              | `readonly MinuteCount[]`                                                  | 24 entries each (Terms, "Hour buckets"); `fieldOverrides` `indexes: []` on both                                             |
| (meta)                   | `dayDefinitionVersion`, `dayComputedAtUtcMs`                                                                                                                                                                                                    | number, `UtcEpochMs`                                                      | the version it was computed under; the writer's `sourceReadUtcMs`                                                           |

**As built in PR 4a (2026-11-08):** the hours slice is named `DayHourBuckets` (the
barrel already exports an opening-hours `DayHours`); `fold` takes no `nowByLocation` —
past-ness is decided once by `daysOf` and carried as `AnalyticsDay.pastDay`, so the fold is
zone-blind; and because a day document knows no other barber's seats, the shop's
`reportExcludedVisitCount` and `reportOrigins` count a visit once **per barber in scope with
a worked seat on it** (v1 counted a cross-barber party once) — property P1 forces it, and the
shop's figure is now the sum of its barbers'. Single-barber scopes are unchanged.

No client name, no seat row, no `locationId`: one document per barber-day across
locations. A barber at two locations on one day has one document; "past" is judged at
every stretch location (Terms), while the chair-time partition inside it keeps v1's
first-stretch clock. `purgeAt` is the adapter's TTL stamp outside the type:
`RetentionGroup.AnalyticsDays`, anchor `RetentionAnchor.analyticsDays(localDate)`, formula in
`RetentionSystem.purgeAtUtcMs`: UTC midnight of `localDate` + 400 days (13 months), anchored
on `localDate` so a rebuild never extends it.

### The recompute's job document

`backfillJobs/analyticsRecompute`, entity `AnalyticsRecomputeJob`
(`entities/analytics-recompute-job.entity.ts`, on the `PolicyRecomputeJob` model): `id:
AnalyticsRecomputeJobId` (`FIXED = 'analyticsRecompute'`), `recomputeJobName:
'ANALYTICS_DAYS'` (`RecomputeJobName.AnalyticsDays`, the existing dictionary in
`policy-recompute-job.entity.ts` extended), `jobDefinitionVersion`, `jobBarberIds` (the
sorted list the last pass walked), `jobWindowFromLocalDate`, `jobCursor: BusyKey | null`,
`jobFullReach`, `jobStartedAtUtcMs`, `jobUpdatedAtUtcMs`, `jobFinishedAtUtcMs: UtcEpochMs |
null`, `jobStepKey`, `jobStalledAtUtcMs: UtcEpochMs | null`, `jobLastFailureCode`,
`jobChecked`, `jobWritten`, `jobFailed`, `jobSteps`. Only the recompute writes it.

The contract (`AnalyticsRecomputeJobSystem`, `systems/analytics-recompute-job.system.ts`,
reusing the policy job system's `stepKeyOf`/`sameStep` compare-and-set and
`shouldRecordStall`/`stall`):

- **Keys** are enumerated date-ascending, then barber in `jobBarberIds` order; a page is
  `PAGE_SIZE = 100` keys; `jobCursor` is the last key handled.
- **A step** (`continueAnalyticsRecompute`, fired by the job document's write) takes the
  next page, reads its documents by id (`loadAnalyticsDaysByKeys`, the Admin SDK's `getAll`
  over ≤ 100 refs), hands the eligible keys (missing or version-stale) to `writeAnalyticsDay`,
  adds to `jobChecked`/`jobWritten`/`jobFailed`, advances the cursor and writes the job
  document under the compare-and-set step key — which fires the next step until the extent
  is exhausted, when it records `jobFinishedAtUtcMs`, the version and the barber list.
- **The start** (`startAnalyticsRecompute`, from the sweep): no job document, or
  `jobFinishedAtUtcMs` set → a new pass with `extentOf`'s extent; a pass unfinished and
  `jobUpdatedAtUtcMs` older than `STALE_AFTER_MS = 15 min` → a nudge (rewrite
  `jobUpdatedAtUtcMs`, clear the stall, keep the cursor), which fires the next step; a pass
  unfinished and fresh → no write.
- **`extentOf(job, now, barberIds)`**: the full reach when there is no job, when
  `jobDefinitionVersion ≠ ANALYTICS_DEFINITION_VERSION`, or when the sorted barber lists
  differ; otherwise the window from `localDateOf(jobFinishedAtUtcMs, defaultZone) − 1` to
  today.

### Systems (pure)

- **`AnalyticsHourSystem`** (`systems/analytics-hour.system.ts`, PR 2):
  `HourDay = { localDate; worked: readonly MinuteCount[]; rostered: readonly MinuteCount[] }`
  (24 each); `bucketsOf(seats: readonly MinuteSpan[], stretches: readonly MinuteSpan[]) →
HourDay` (the minutes of overlap with each `[h:00, h+1:00)`); `grid(days: readonly
HourDay[]) → readonly HourCell[]` (weekday × hour); `peak(cells) → { busiest: { weekday,
hour } | null, emptiest: … }` over cells with any rostered minutes, ties to the earliest,
  `null` under 7 rostered days. `StaffAnalyticsSystem.daysOf` returns each day's offered
  stretches on `AnalyticsDay` as `stretches: readonly MinuteSpan[]` so PR 2 can bucket live
  days.
- **`DayFiguresSystem`** (`systems/day-figures.system.ts`, PR 4a):
  `fold(input) → DayFigures` where `input = { day: AnalyticsDay; visits: readonly
AnalyticsVisit[]; followUps; policy; nowByLocation }` (`AnalyticsDay` is v1's per-day
  system input `ChairDay & { closedDayMinutes }` plus the stretches above; the seats come
  with the visits); `hourBuckets` delegates to `AnalyticsHourSystem.bucketsOf`;
  `sum(figures: readonly DayFigures[]) → DayFigures` (integer sums, the service rows merged
  by `serviceId`, the per-hour ratio derived). Property **P1**, pinned by the agreement
  spec: `sum(days.map(fold)) + live === report(visits)` over the fixture month, as the
  pairs in plan item 51.
- **`StaffAnalyticsSystem`** (changed): `report(input)` takes `pastDays: readonly DayFigures[]`
  beside the live `days`/`visits` and builds `reportDayRows` as `DayFigures.rowOf(fold(…))`
  for live days; `isPastDay(localDate, nowByLocation, stretches)` (the rule in Terms);
  `comparisonOf(period)`; `periodInSpan` and `stepsOf` per "The callable v2 contract";
  `VISITS_PER_BARBER_DAY = 60` beside `RATE_BASE` (the adapter imports it); the hero's
  "compared days up to the current minute" keeps v1's rule for today against the
  counterpart day, whose visits are read live (~15 documents) — so no per-hour money is
  stored.
- **`AnalyticsRecomputeJobSystem`** (PR 4a) — the contract above.
- **`AnalyticsRadarSystem`** (`systems/analytics-radar.system.ts`, PR 5):
  `bestOf(barbers: readonly BarberFigures[]) → RadarBest` — `{ takingsPerHour; fill;
rebooking; tipsRate }`, each the maximum among barbers meeting that axis's floor or
  `null`; `axes(figures: BarberFigures, best: RadarBest) → RadarRow` — four values
  normalised 0–100 and reliability absolute, each `null` under the base or when the best is
  `null` or 0; the comparison period's figures are normalised against this period's best,
  so the two polygons share a base. Runs on the server; the maximum never leaves it.
- **`AnalyticsPeriod`** (changed): `AnalyticsSpan.Day | Year | Custom`;
  `of(span, from, to)` — `DAY` any day in reach, `YEAR` from 1 January, `CUSTOM` `from ≤ to`
  and ≤ `CUSTOM_MAX_DAYS = 366`; `previous(period)` per span (Terms, "Comparison period");
  `REACH_MONTHS` stays 12; `isComparable(period, today)` is false when the comparison
  period starts before the reach.

### Pipelines

- **`writeAnalyticsDay`** (`pipelines/write-analytics-day.pipeline.ts`, new): the command is
  a union on `analyticsDaySource` (`AnalyticsDaySource = { Appointment: 'APPOINTMENT',
Departure: 'DEPARTURE', Recompute: 'RECOMPUTE' }`): the `'APPOINTMENT'` variant carries
  `RebuildBusyCommand`'s sides and the pipeline derives its keys with
  `BusySystem.affectedKeys` (the refusal is the answer only when no day is left, as the busy
  pipeline rules) and the source visit's id from either side's `bookedFromAppointmentId`;
  the `'DEPARTURE'` and `'RECOMPUTE'` variants carry `keys`. For each key whose day is past:
  the reads and the `commit` of "Stamp ordering" → `DayFiguresSystem.fold` → one
  `WriteOp.set` guarded by the stamp rule, or none. Logs `AnalyticsDayWritten` per day and
  `AnalyticsDayWriteFailed` per failure. Ports: `CommitPorts & ShopDayReadPorts &
AnalyticsReadPorts & PolicyReadPorts & LocationLoadPorts & DefaultLocationPorts &
ClockPorts & LogPorts`.
- **`startAnalyticsRecompute` / `continueAnalyticsRecompute`**
  (`pipelines/*-analytics-recompute.pipeline.ts`, new) — the contract in "The recompute's
  job document". Logs a per-step line and `AnalyticsRecomputeDone` (barbers, days checked,
  days written, failures, steps). Ports: `AnalyticsRecomputeJobPorts & AnalyticsDayReadPorts
& CommitPorts & LocationLoadPorts & DefaultLocationPorts & ClockPorts & LogPorts` plus the
  writer's.
- **`staffAnalytics`** (changed; its bundle gains `FlagsPorts`):
  1. after the scope, splits the period's days into past days and live days;
  2. with `FlagName.AnalyticsStoredDays` on (read inside the handler), reads past days as
     documents (`loadAnalyticsDays(barberIds, from, to)`); with it off, treats every past day
     as missing;
  3. a missing or version-stale past day is computed live from its visits (bounded by the
     existing `loadVisitsByBusyKeys` caps) and counted in `missingDays`; a live fallback
     that would exceed the adapter's caps answers the existing `resource-exhausted` refusal
     and the screen shows «Опитай по-късно» — possible before the recompute's first pass,
     on the day after a version bump until that night's pass finishes, and with the flag
     off on a long span;
  4. the comparison period is read the same way, or skipped when it starts before the
     reach (its fields `null`);
  5. live days: visits by busy key, as v1 (their follow-ups are not read: a live day is
     never in the rebooking base); on `DAY`, nothing beyond the day, its counterpart and
     the next 7 days;
  6. the next 7 days as v1;
  7. on `MONTH`, the scope's goal (+1 read; `null` on other spans);
  8. the report (below) and `AnalyticsReported` with `missingDays`, `span`, `comparison`.
- **`setAnalyticsGoal`** (`pipelines/set-analytics-goal.pipeline.ts`, PR 6): command
  `SetAnalyticsGoalCall = { scopeBarberId: BarberId | null; goalMonth: MonthKey;
goalLowCents: PriceCents; goalHighCents: PriceCents }` (the currency is `'EUR'`, fixed by
  the pipeline); the caller is judged by `callerOf` and `scopeOf` first (v1's codes), then
  `GoalForbidden` only when a barber names another scope; one transaction writing
  `analyticsGoals/{key}` and an audit row (`AuditAction.AnalyticsGoalSet`, variant fields
  `goalKey`, `goalScopeBarberId`, `goalMonth`, `goalLowCents`, `goalHighCents`); answer
  `{ goalKey: AnalyticsGoalKey; goalSetAtUtcMs: UtcEpochMs }`; refusals
  `ANALYTICS_GOAL_FORBIDDEN`, `ANALYTICS_GOAL_INVALID_RANGE` (low ≤ high, both > 0, the
  current or the next month). Registered as `Callables.SetAnalyticsGoal`, App Check token
  `Standard`, `OPERATION_ID_FIELD: 'operationId'`.

### Ports

- `AnalyticsDayReadPorts = { loadAnalyticsDays(barberIds, fromLocalDate, toLocalDate);
loadAnalyticsDaysByKeys(keys) }` — the range: one barber `barberId == … and localDate in
[from, to]` over the new composite, the shop one `localDate` range over the collection,
  `limit` 366 × barbers + 1 (past it the adapter answers `overBound`, `RepositoryError`
  `resource-exhausted`, and the callable answers that refusal, never a truncated report);
  by keys: `getAll` over ≤ 100 refs.
- `AnalyticsRecomputeJobPorts = { loadAnalyticsRecomputeJob() }` (the write goes through
  `CommitPorts`, as the policy job's does); served by `firestore-jobs.adapter.ts`, whose
  factory's return type gains the bundle.
- `AnalyticsGoalPorts = { loadAnalyticsGoal(key) }` for the callable; the writer goes
  through `CommitPorts`.
- `AnalyticsCallPorts` (web) gains `setAnalyticsGoal`.
- The web's `AnalyticsCacheKey` stays `AnalyticsCall & { userId }`; the call now carries
  `toLocalDate` and the constant `analyticsComparison: 'PREVIOUS'`, so the storage key
  encodes them; `sameCall` compares them.
- No port for the export: the CSV is built on the device and handed to a browser helper
  ("Export (PR 7)").

### The callable v2 contract and catalogue version 2

`AnalyticsCall = { scopeBarberId: BarberId | null; fromLocalDate; toLocalDate: LocalDate |
null; analyticsSpan: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'CUSTOM'; analyticsComparison:
'PREVIOUS' | 'SAME_LAST_YEAR' }`, every field decoded in `analytics.wire.ts`;
`toLocalDate` is `null` unless the span is `CUSTOM` — a non-null `to` on another span, or
`null` on `CUSTOM`, is `invalidInput('toLocalDate')`; `SAME_LAST_YEAR` is refused with
`ANALYTICS_INVALID_INPUT` in v2; an old functions deploy refuses the new fields the same
way, so functions deploy before web. `ANALYTICS_DEFINITION_VERSION = 2` from PR 4a.

**As built in PR 4b (2026-11-09):** a barber-day counts from exactly one source — its
current day document when one exists, else live (the hero's cut day is always counted from
visits up to the current minute); `reportMissingDays` counts the period's past days computed
live. Under the flag a barber scope's `reportSeatRows` carry only the live and fallback days'
seats — a stored day's visits are not read (Reads and cost), so the takings drill-down of a
long span lists the live days' seats under the period's total; the drill-down of stored days
is left to a later PR. From `YEAR` the switcher's `WEEK`/`MONTH` is the one holding 1 January;
a custom range is never derived from a day (the sheet alone makes one). The switcher's «…»
pill is a bordered icon button beside the four segments; `CUSTOM` is on when no segment is.

Span changes on the screen (`StaffAnalyticsSystem.periodInSpan`, `stepsOf`): → `DAY`:
today when inside the current period, else the period's first day; → `WEEK`/`MONTH`: the
one holding the current period's first day; → `YEAR`: the year holding it; → `CUSTOM`: the
range sheet opens and the period changes only on «Приложи»; `stepsOf` on `CUSTOM` shifts
by the range's length, forward disabled past today. The report gains, each a catalogue row
with formula, includes, excludes and base gate:

| Field                                                                                                                                    | Definition                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reportAnalyticsComparison`, `reportComparisonFromLocalDate`, `reportComparisonToLocalDate` (`null` when not comparable)                 | the comparison period the hero and the line use                                                                                                                                                                                                                                                 |
| `reportSeries: readonly { localDate; takingsCents; comparisonTakingsCents: PriceCents \| null }[]`                                       | the line's points: one per day (WEEK, MONTH, CUSTOM ≤ 93 days; DAY has one entry and the presenter draws no line), per ISO week (CUSTOM > 93; a partial first or last week's `localDate` is the period's first day or that week's Monday), per month (YEAR); the comparison aligned by position |
| `reportTimeSeries: readonly { localDate; workedMinutes; noShowMinutes; unmarkedMinutes; blockedMinutes; unsoldMinutes; otherMinutes }[]` | the stacked bars (the six bar parts), same grain as `reportSeries`; DAY has one entry                                                                                                                                                                                                           |
| `reportDayRows: readonly DayRow[]`                                                                                                       | per day for spans ≤ 93 days; per month beyond (`localDate` = the month's first day; a month in YEAR opens the MONTH span); `DayFigures.rowOf` of the stored body, or of the live day's fold                                                                                                     |
| `reportHourGrid: readonly { weekday; hour; workedMinutes; rosteredMinutes }[]` (≤ 168)                                                   | the heatmap: per weekday and wall-clock hour, the minutes of worked and rostered time overlapping `[h:00, h+1:00)`, summed over the period's days of that weekday                                                                                                                               |
| `reportBusiestWeekday`, `reportBusiestHour`, `reportEmptiestWeekday`, `reportEmptiestHour`                                               | `AnalyticsHourSystem.peak`: the cell with the highest and the lowest `worked ÷ rostered` among cells with rostered minutes, ties to the earliest; `null` under 7 rostered days                                                                                                                  |
| `reportAheadDays: readonly { localDate; openMinutes }[]` (7)                                                                             | the open-hours card's bars (v1 had the total and the emptiest only)                                                                                                                                                                                                                             |
| `reportBarbers` (changed, PR 5)                                                                                                          | `BarberFigures` gains `serviceMinutes`, `workedSeatCount` and `rosteredDayCount`; `reportComparisonBarbers: readonly BarberFigures[]` carries the comparison period's                                                                                                                           |
| `reportRadars: readonly RadarRow[]` (shop scope, PR 5)                                                                                   | flat: `{ barberId; takingsPerHour; fill; rebooking; tipsRate; reliability; comparisonTakingsPerHour; comparisonFill; comparisonRebooking; comparisonTipsRate; comparisonReliability }`, each `number \| null`; `reportRadarBase: 'BEST_OF_SHOP' \| 'TOO_FEW_BARBERS'` (`RadarBase`)             |
| `reportMissingDays`                                                                                                                      | past days computed live because no current document exists (the screen says nothing; the log counts them)                                                                                                                                                                                       |
| `reportGoalLowCents`, `reportGoalHighCents` (`null` off MONTH), `reportGoalPaceTag` (PR 6)                                               | the month's goal and the pace: `expectedLow/High = goalLow/High × daysWorkedSoFar ÷ daysRosteredInMonth` (days with a stretch, up to and including today); takings ≥ expectedHigh → `AHEAD`, ≥ expectedLow → `ON_TRACK`, else `BEHIND`; `NONE` = no goal, not MONTH, or no rostered day yet     |

Radar axes (admin-shop, MONTH / YEAR / CUSTOM): € per hour of service (`takingsCents ÷
serviceMinutes × 60`, base 20 worked seats), fill (`worked ÷ rostered`, base 7 rostered
days), rebooking rate (v1, base 20), tips rate (`tips ÷ takings`, base 20 worked seats) —
each normalised `value ÷ best × 100` where best is the maximum among barbers meeting the
floor; reliability (`(1 − noShowRate) × 100`, base 20) absolute, never divided by the best.
`null` axes are drawn as missing with the word «малко данни». A barber's report carries no
radar.

**As built in PR 5 (2026-11-09):** a comparison axis is not clamped by the system (a previous
month better than this month's best reads over 100) — the element clamps the drawing to the
ring; the radar's words and figures sit at each axis's outer end, not on the moving vertex;
`RATE_BASE` lives on `AnalyticsRadarSystem` (the staff system imports it, the other way would
cycle); the comparison barbers' time parts and `rosteredDayCount` come from the comparison's
stored days alone (no roster is read for the comparison), so with the flag off their fill and
rebooking read `null`; a shop of one barber has the base «твърде малко бръснари» and no
radar; with two barbers under every floor the two radars show «малко данни» per axis.

### Visibility

Unchanged ([v1's table](./staff-analytics.md#visibility)). Day documents and goals are
callable-only, so nothing a client can read is added. A barber's radar is not built in v2;
the admin's radar carries every barber of the shop, as the v1 shop report already carries
`reportBarbers`.

### The screen

#### Chart kit

`libs/ui/charts` (`@creativo/ui/charts`, the Nx project `charts`, tags `scope:shared,
type:ui`), SVG from Angular templates, every input a plain display struct built by the
presenter. The kit's own part vocabulary, because `type:ui` cannot import ecs-core:
`UiChartPart = { Worked: 'worked', NoShow: 'no-show', Unmarked: 'unmarked', Blocked:
'blocked', Unsold: 'unsold', Other: 'other', Online: 'online', Staff: 'staff', Unknown:
'unknown', Comparison: 'comparison' } as const` — the strings the feature's
`BAR_PART_HOOKS` table already maps `AnalyticsBarPart` to.

| Element         | Inputs                                                                                                                                                                                                                                                                                                       | Draws                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `ui-bar-chart`  | `uiBars: readonly { label: string; parts: readonly { part: UiChartPart; value: number }[] }[]`, `uiOrientation: 'vertical' \| 'horizontal'`, `uiStacking: 'stacked' \| 'single'`, `uiRanked: boolean`, `uiHighlightIndex: number \| null`, `uiValueText: readonly string[]` (one per bar), `uiLabel: string` | rectangles on a baseline, a legend content slot; tap → `(uiBarPicked)` with the index  |
| `ui-line-chart` | `uiPoints: readonly { label: string; value: number; comparison: number \| null }[]`, `uiAverage: number \| null`, `uiValueText: readonly string[]`, `uiLabel: string`                                                                                                                                        | one line, a grey comparison line, a dashed average rule, right-edge labels only        |
| `ui-heatmap`    | `uiRows: readonly string[]`, `uiColumns: readonly string[]`, `uiCells: readonly { row: number; column: number; value: number; max: number }[]`, `uiLabel: string`                                                                                                                                            | a CSS grid of cells tinted on `--ui-cell-strength`                                     |
| `ui-radar`      | `uiAxes: readonly { label: string; value: number \| null; comparison: number \| null }[]`, `uiLabel: string` (PR 5)                                                                                                                                                                                          | a polygon on five axes, label and value outside each vertex, a grey comparison outline |

Geometry lives in `libs/ui/charts/src/lib/geometry/*.ts` (`linearScale`, `linePath`,
`stackOffsets`, later `polygonPoints`), pure and specified; the width comes from one new
`elementWidth(): Signal<number>` helper in `libs/ui/layout` (`0` where `ResizeObserver` is
absent). Colour is CSS only: `[data-part]` on marks maps to tokens in the kit's stylesheet;
`fill`/`stroke`, never `color`. Motion: bar heights transition; a series change and the
line's path cross-fade; nothing under reduced motion. Accessibility: `role="img"` +
`uiLabel`; a `uiVisuallyHidden` table when the figures are not printed beside the chart. A
tap readout is deferred until a screen shows the line is unreadable without one.

#### The seven questions, and the admin's radar (PR 5)

| Question                        | Scope      | Spans     | Element                                    | Form                                                                                                                  | Opens to                          |
| ------------------------------- | ---------- | --------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| How much, and vs the comparison | all        | D W M Y C | `ui-metric` (hero) + `ui-line-chart`       | hero figure; a line of days / weeks / months, the comparison in grey, a dashed average                                | seat rows (v1 drill-down)         |
| Where the time went             | all        | D W M Y C | `ui-bar-chart` stacked                     | D: one vertical stacked bar; W/M/C: a bar per day; Y: a bar per month; the legend is the breakdown table beneath      | day rows (v1 drill-down)          |
| When the chair is busy          | all        | W M Y C   | `ui-heatmap`                               | weekday × hour of worked over rostered minutes; one sentence names the busiest and the emptiest hour                  | —                                 |
| Free time ahead                 | all        | always    | `ui-metric` + `ui-bar-chart`               | the open-hours card: a hero of open minutes in the next 7 days; seven bars, the emptiest in the accent, the rest grey | the schedule, `?free=1` (v1 link) |
| Which services sell             | all        | D W M Y C | `ui-bar-chart` ranked                      | horizontal bars, largest first, € and count on the row; € per hour of service on the row                              | seat rows by service              |
| Do clients come back            | all        | W M Y C   | three `ui-metric` tiles                    | rebooked %, no-show %, late cancellations; delta vs the comparison; a verdict word; «изчаква» under v1's base of 20   | the rows behind each              |
| Where bookings come from        | admin-shop | W M Y C   | `ui-bar-chart`, one horizontal stacked bar | three rows with swatches under it                                                                                     | —                                 |

| The admin's radar (PR 5) | Scope      | Spans | Element    | Form                                                                                                                               | Opens to           |
| ------------------------ | ---------- | ----- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| How each barber does     | admin-shop | M Y C | `ui-radar` | five axes per barber (the contract); the comparison period as a grey outline on the same base; a subtitle naming the base in words | the barber's scope |

On `DAY` the first question shows the hero and the delta only (no line); the second is one
`ui-bar-chart` with a single vertical stacked bar. v1's `lib-analytics-time-bar` is removed
from the WEEK/MONTH template in PR 2 and deleted in PR 3.

#### Sections in order

Test ids are kept where v1 had them.

1. the bar with the back button;
2. the head: `analytics-title`, the freshness line «Обновено преди N мин» with ⓘ («Цифрите се
   изчисляват при отваряне от записаните дни»);
3. the period control: `analytics-span` with four segments, the stepper, the «…»
   custom-range pill opening `analytics-range-sheet` (two `ui-date-field`s and «Приложи» in
   the sheet's action row; the store's `computed` runs `AnalyticsPeriod.of(Custom, from, to)`
   and `isWithinRange` over the fields' parts and the sheet only reads the `Result`: a
   `from` after `to` is swapped, a day before the reach says `range.beforeReach`, a day after
   today `range.afterToday`, over 366 days `range.tooLong`, and «Приложи» is disabled on any
   refusal), the comparison chip («спрямо предходния период», or «няма данни за сравнение»
   when the comparison starts before the reach);
4. the admin's scope tiles (`analytics-scopes`);
5. notices and placeholders;
6. the seven questions in the table's order;
7. the admin's radars (PR 5);
8. on `MONTH`, the goal ring, `ui-gauge` with `uiGaugeStyle="circularCapacity"` (PR 6);
9. the dock with «Експорт» (PR 7).

The drill-down sheet (`analytics-rows`) is unchanged.

#### Colour

Worked and "this period" in the accent; no-show in `--sys-color-destructive`; unmarked in
`--sys-color-warning` under a diagonal hatch, because warning (hue ≈ 36°) sits beside the
accent (hue ≈ 21°) in every bar; blocked, unsold, other in the foreground ramp (50 / 32 /
18 %); every part with a 1 px separator edge; the comparison line in the 32 % grey;
per-barber series in `--sys-identity-0..4` in the catalogue's barber order; the heatmap on
the accent at 10–100 % strength; change chips with an arrow glyph in success/destructive
and ink words. `libs/ui/tokens/src/lib/chart-palette.spec.ts` pins, in both themes, the
contrast of each mark colour (the `color-mix` greys composited over `--sys-color-background`
and `--sys-color-surface`; the hatch measured on its solid fill) at ≥ 3:1, and the
distinguishability of each adjacent pair of parts — consecutive entries of `[worked,
no-show, unmarked, blocked, unsold, other]` and `[online, staff, unknown]`, plus the
comparison grey beside the accent — as the Euclidean distance in OKLab × 100 ≥ 8.

**Measured in PR 2 (2026-11-08): the foreground ramp is 76 / 62 / 48 %, not 50 / 32 / 18 %.**
On white the foreground has to be mixed at 46 % or more to clear 3:1 (32 % reads 2.09:1,
18 % 1.48:1), so the lightest grey is 48 % and the other two step up by 14 — the design's
direction kept (blocked heaviest, unsold lighter, other lightest), every adjacent pair ≥ 10.7
in OKLab × 100 in both themes, the comparison line at the same 48 %. The spec pins the
measured values (`libs/ui/charts/README.md` lists them).

#### Freshness

«Обновено преди N мин» is the presenter's formatting of `reportComputedAtUtcMs` with `now`
as an input (Law 7 T2, a staleness budget; display only). The presenter branches on
`UtcEpochMs.elapsedMs`: under one minute or a negative age → `status.justNow` («току-що»);
under one hour → `relativeTime(…, 'short')` wrapped as `status.updatedAgo` («Обновено
{age}»); the same shop day (the date parts of `formatInstant` on the default location's
zone equal) → «в HH:MM»; otherwise «на dd.MM в HH:MM». The store re-reads `now` every 60
seconds while the page is attached, so the line ticks.

#### State and URL

`StaffAnalyticsStore` gains `pickedTo` (PR 4b) and `bindAnalyticsRouteInputs`, a reader of
`?span&from&to&barber` on the schedule's `route-inputs.ts` pattern: the URL is an input and
the store's output; a barber's `?barber=` is ignored; an unknown `span` reads as the
current month; each pick replaces the URL (`replaceUrl`), so Back returns to the schedule,
not through the picks; the store never rewrites a URL it did not pick, and its first
write-back — the deferred write after the first non-null request — writes the period's
first day. The comparison is the constant `PREVIOUS` until a second value is enabled — no
picker, no state. The cache key encodes the span, the two dates and the comparison.

### Entry from the schedule

A chart icon button (`staff-analytics-open`, a new `ui-icon` glyph `analytics.chart`) in the
schedule's top trailing cluster — the order becomes view · chart · find · who — at every
width. It navigates with `router.navigate(['/staff/analytics'], { queryParams })` and
nothing else: the router's `withViewTransitions` runs the one transition the platform
allows. The morph (Terms) is kept only if no frame exceeds 16.7 ms during the transition at
4× CPU throttle on a production build in PR 1; otherwise the root cross-fade. The analytics
chunk is prefetched on idle from the schedule by a `@defer (when false; prefetch on idle)
{ <lib-staff-analytics /> }` block, so the route's lazy load hits the prefetched chunk. The
query: `from=<the schedule's day>`; `span=WEEK` (the week that holds the day) in PR 1 and
`span=DAY` from PR 3, when the store accepts it; `barber=` (a) the schedule's selected
barber when an admin views one chair, (b) absent when an admin views every chair (the shop
scope), (c) absent for a barber (their own). Back restores the schedule from its own
`?day&view&barber`.

### Goals (PR 6)

`analyticsGoals/{key}` where `key` is `{barberId}__{YYYY-MM}` or `shop__{YYYY-MM}`
(`AnalyticsGoalKey` primitive); body `{ barberId: BarberId | null, goalMonth: MonthKey,
goalLowCents, goalHighCents, currency, goalSetByUserId, goalSetAtUtcMs }`; rules
`allow read, write: if false`. `MonthKey` is `CapacityMonthId` renamed (D11);
`LocalDate.monthKey()` returns it. The callable reads the scope's goal on `MONTH` only and
returns it with the report; the ring and «Задай цел» (offered on the current or the next
month) are shown on `MONTH` only; the presenter words the pace (`goalPaceTag` is the
system's, the formula in the contract). The call and its answer are in "Pipelines".

### Export (PR 7)

Client-side: the export presenter builds one file of two blocks separated by a blank line.
Block 1, header `вид;бръснар;дата;работено мин;неявяване мин;немаркирано мин;блокирано
мин;почивка мин;непродадено мин;друго мин;оборот;бакшиш`, one row per day row with `вид =
ДЕН`; block 2, header `вид;бръснар;услуга;посещения;оборот;минути услуга`, one row per
service row with `вид = УСЛУГА` — on a barber scope that barber's rows, on the shop scope
the shop-wide `reportServices` with `бръснар = Всички`. The barber is the catalogue's name in
the report's barber order; money through `formatCents` without the sign; dates
`YYYY-MM-DD`; rows in the report's order; UTF-8 with a BOM, `;` separator, quoted fields.
File name `creativo-analytics-<from>-<to>.csv`, handed to `shareOrDownloadFile(name,
blob): Promise<'SHARED' | 'DOWNLOADED' | 'CANCELLED'>` in `libs/infrastructure/web-storage`
(`navigator.share` with `canShare({ files })` over `new File([blob], name, { type:
blob.type })`; `AbortError` → `CANCELLED`; any other share failure → an `<a download>`);
the client card's JSON download and the client appointments' `.ics` download move onto the
same helper. No port and no token, because a browser download has no domain meaning; no
log, because the server cannot verify a count the device reports and the client-issue
channel is for defects.

### Reads and cost

| Request (10 barbers, 15 seats a day) | v1                            | v2                                                                                                                                                        |
| ------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixed reads of every open            | ~15                           | 1 user + 10 barber records + ≤ 3 locations + roster(s) + 1 policy ≈ **15–25**                                                                             |
| Barber: one day (past)               | — (v1 read the month: ~1,000) | fixed + 1 day + 1 comparison day + ~100 ahead + ~7 ahead departures ≈ **130**                                                                             |
| Barber: one day (today)              | — (v1 read the month: ~1,000) | fixed + ~15 visits + departure + ~15 counterpart visits + ahead ≈ **160**                                                                                 |
| Barber: one month                    | ~1,000                        | fixed + ~29 days + ~30 live visits + ~15 counterpart visits + ~29 comparison days + ahead + 1 goal ≈ **260**                                              |
| Barber: one year (no comparison yet) | —                             | fixed + ~365 days + ~30 live + ahead ≈ **520** (≈ 890 once a comparison year exists)                                                                      |
| Admin: shop month                    | ~11,500                       | fixed + ~290 + ~300 live + ~150 counterpart + ~290 + ~1,070 ahead ≈ **2,100**                                                                             |
| Admin: shop year (no comparison yet) | —                             | fixed + ~3,650 + ~300 + ~1,070 ≈ **5,000** (≈ 8,700 once a comparison year exists) — measured in PR 4b                                                    |
| Each booking write                   | +0                            | +~35 reads (the day's visits twice, their follow-ups, the source visit, the roster, the departure, the locations) + 1 write, past days only               |
| Nightly pass                         | —                             | the window's documents by id (~70 at 10 barbers after a normal night) + the writes ≈ **80**; a full-reach pass ≈ 3,650 on a version or barber-list change |

After this change the live "next 7 days" read is the largest share of a barber's open; it
stays as v1 built it and is the next cost to reduce. If PR 4b measures the shop-year over
the 4 s budget, Alternative O (a month document) is the recorded next step.

### Errors

`AnalyticsErrorCode` gains `GoalForbidden` → `'ANALYTICS_GOAL_FORBIDDEN'` and
`GoalInvalidRange` → `'ANALYTICS_GOAL_INVALID_RANGE'`, mapped in `edge.ts`'s
`ANALYTICS_WIRE` to `permission-denied` and `invalid-argument`; the `InvalidInput` struct's
`field` names the new fields and the refused `SAME_LAST_YEAR`; `PeriodOutOfRange` covers
`CUSTOM_MAX_DAYS`. The writer and the recompute answer `RepositoryError`s only.

### Observability

`LogEvent.AnalyticsDayWritten` (barberId, localDate, source, visitCount, durationMs),
`AnalyticsDayWriteFailed` (the key, the code), `AnalyticsRecomputeDone` (barbers, checked,
written, failures, steps); `AnalyticsReported` gains `missingDays`, `span`, `comparison`.
Never money. An oncall answers "which day is stale and why" from `AnalyticsDayWriteFailed`

- `missingDays`; a `missingDays` that does not fall after a night means the recompute did
  not finish.

## Alternatives Considered

The brief's "Alternatives weighed" ([concepts_brief_v2.md](../design-research/staff-analytics/concepts_brief_v2.md)),
each with its reason, plus the ones drafting and review raised.

### Alternative A: Increment counters on each booking

- **Pros**: no recompute; one `FieldValue.increment` per write.
- **Cons**: a duplicated or lost trigger leaves a figure with no source to recompute from;
  moves, re-staffing and cancellations need subtraction, which drifts.
- **Reason for Rejection**: banned by the v1 design (§4.3 of
  [the earlier statistics design](../design-research/availability-and-statistics-design.md),
  kept in v1): every displayed figure must be recomputable from its source. A day document
  is recomputed whole from its visits.

### Alternative B: Store today too, with clock-free hour buckets split by "now" at read

- **Pros**: every open reads only documents; one booking updates today's document.
- **Cons**: the split approximates seats to hour buckets, so unsold/open and
  unmarked/booked-ahead disagree with the schedule's own free-time figure by up to an hour;
  the rebooking window is still open; `barberBusy` already holds today's intervals.
- **Reason for Rejection**: the live days cost ~30 reads and keep the figures exact; the
  agreement with the schedule's day summary (v1's G5) would not survive bucketing.

### Alternative C: The callable writes a missing day lazily on read; triggers invalidate by delete

- **Pros**: no sweep; the first reader pays once.
- **Cons**: turns the read-only callable into a writer (idempotency class, the "no partial
  report" guarantee); a read racing a trigger's delete can write a stale document last.
- **Reason for Rejection**: the recompute covers the reach in budgeted steps and self-heals;
  the callable's contract stays read-only; stamp ordering is one rule instead of a delete
  protocol.

### Alternative D: Rebuild past days on roster, location-hours and policy edits

- **Pros**: history always reflects the current roster and policy.
- **Cons**: a backdated roster edit touches every day from its effective date — up to ~365
  rebuilds from one write, inside a trigger timeout; capacity needed five triggers and a
  sweep for the same reason; a policy edit changes no stored count, because the window is
  stamped on the seat.
- **Reason for Rejection**: the product rule "a past day's rostered minutes are the roster
  as it stood when the day became past" is cheaper and defensible for pay; a departure is
  one day and stays a trigger.

### Alternative E: Chart.js 4 inside `@defer`

- **Pros**: MIT, CSP-clean (no `eval`, no CSS injection), 64 kB gzipped, costs the route
  ceiling nothing in a deferred chunk, a first chart in a day.
- **Cons**: a canvas — theme, reduced motion and the `ui-*` contract are CSS here and each
  comes back as JavaScript; a bitmap is unreadable to screen readers; no heatmap; a second
  rendering model in the design system.
- **Reason for Rejection**: on the survey's five-row rubric (bundle 25 / CSP 15 /
  design-system fit 25 / phone performance 20 / maintenance 15) plus the row the brief added
  (engineering days to the first shipped screen, 20 %, the five rows re-weighted to 80 %),
  the two draw level on delivery and the hand-built kit wins on fit; cutting the kit to
  three elements takes back most of the weeks. Recorded as the fallback if the kit is not
  ready when the redrawn screen is.

### Alternative F: ECharts, ApexCharts, ngx-charts, Vega-Lite, uPlot, Chartist, Frappe

- **Pros**: ECharts covers every form; the wrappers give Angular bindings for free.
- **Cons**: ECharts is 632 kB raw, 7–8× the route's headroom; ApexCharts 8 is no longer MIT
  and needs an OEM licence for a product used by others; ngx-charts and the wrappers add
  Angular peers for nothing an `effect()` does not; Vega's default compiler needs `Function`
  (blocked by `script-src`); uPlot refuses animation and has no radar or heatmap; Chartist
  and Frappe lack radar and heatmap and Frappe 2.0 is still a release candidate.
- **Reason for Rejection**: each fails at least one of bundle, licence, CSP or coverage.

### Alternative G: Six categorical hues for the chair-time parts

- **Pros**: hue-per-part "colour that explains", Revolut's category ring.
- **Cons**: the parts are states with an order, not categories; six new tokens in a system
  that has refused colour for a year; a validator step and twelve pinned values before the
  first chart.
- **Reason for Rejection**: deferred behind a gate (Open Questions): meaning-colours from
  existing tokens first; a validated set if the redrawn screen still reads flat.

### Alternative H: A full-screen sheet from the schedule, like search

- **Pros**: closes to the exact place, never re-mounts the schedule; the research's own
  pattern 11.
- **Cons**: analytics stacks its own sheets (drill-downs, info, export); the period would
  have no URL; the schedule's listeners and DOM stay alive under a chart-heavy screen.
- **Reason for Rejection**: deep links, a back stack and the period in the URL. The
  performance claim is not asserted; PR 1 measures Back's re-mount and adds a
  `RouteReuseStrategy` for the schedule only if it shows.

### Alternative I: Goals on the user record

- **Pros**: no new collection; one read.
- **Cons**: readable by every book-working role (`users/{uid}` `allow get … worksTheBook()`);
  bound to the account, so a re-link moves it to the wrong barber; the shop has no user
  record; one month of history.
- **Reason for Rejection**: readable by colleagues and bound to the account;
  `analyticsGoals/{key}`, callable-only and keyed by month, has neither flaw.

### Alternative J: Written findings as a system of their own

- **Pros**: one place for every sentence.
- **Cons**: restates the delta chip, the heatmap's hour, the line's peak and the goal pace
  the reader just looked at; a system, a presenter and half a PR for four sentences.
- **Reason for Rejection**: every finding restates a value already on the screen; each
  chart carries its sentence instead, worded by the presenter from the report's values.

### Alternative K: Print to PDF and a share card beside CSV

- **Pros**: the owner said "exportable"; a PDF is what an accountant asks for.
- **Cons**: page breaks, hidden chrome, SVG in print and iOS Safari's print path; a share
  card needs computed-style inlining of every `fill`/`stroke`/`font`, `canvas.toBlob` and
  `canShare` detection, plus a card design nobody asked for; a seat-level CSV needs a read
  path a shop span does not have.
- **Reason for Rejection**: CSV first (0 bytes); PDF when asked for after CSV ships.

### Alternative L: Pay and sealing inside v2

- **Pros**: one design for every stage the owner named.
- **Cons**: a pay rate on `barbers/{id}` is public; sealing contradicts a rebuildable cache
  and a TTL; "net takings" undefined; the reconciliation gate is a calendar event that has
  not happened; versioning, currency, proration and the label's legal weight each need a
  decision.
- **Reason for Rejection**: the public pay rate and the undefined base alone rule it out
  before the gate; `docs/designs/staff-pay.md` (to be written) decides it with its own
  review.

### Alternative M: A separate drill-down callable (v1's Alternative M, revisited)

- **Pros**: the report answer stays small on every span.
- **Cons**: a second call per tap; rows and figure computed at different instants.
- **Reason for Rejection**: still rejected; rows are read live on tap, and the rows page says
  when its rows and the figure differ by a trigger's lag.

### Alternative N: Per-hour takings in the day document, for the hero's up-to-the-minute comparison

- **Pros**: no live read of the counterpart day.
- **Cons**: 24 more money fields per document for one figure; an hour's granularity against
  v1's seat-end rule.
- **Reason for Rejection**: the counterpart day's ~15 visits are read live; the rule stays
  exact and the document stays small.

### Alternative O: One document per barber-month, the `capacity/{YYYY-MM}` precedent

- **Pros**: a sorted `entries[]` of per-day structs, rebuilt by dropping a day's entry and
  writing the array whole (the `capacity` pattern); a barber-year reads 12 documents and a
  shop-year ~120 against 365 / 3,650 — about 30× fewer reads, and the shop-year no longer
  depends on a 3,650-document range query.
- **Cons**: every booking rewrites a ~45 kB month document (write amplification ×30 on
  bytes); stamp ordering must live per entry inside one document; a month of departures
  edited in one batch makes one barber-month a hot document; a TTL purges a month whole;
  the day is the unit every trigger already names.
- **Reason for Rejection**: the day document keeps the write unit equal to the event and
  the ordering rule to one stamp, and the cost table keeps the shop-year inside the 4 s
  budget on paper. PR 4b measures it; if the shop-year misses the budget, the month document
  is the recorded next step.

### Alternative P: Rebooking and late cancellation computed live; day documents store only clock-free facts

- **Pros**: fewer writers (no follow-up path), no two-day lag — a past day is final the day
  after; the brainstorm review's preferred cut.
- **Cons**: a `YEAR` span needs the follow-ups of ~365 days — ~165 `in` chunks for one
  barber (5,000 visits ÷ 30), one `bookedAtUtcMs` range of ~24,000 rows for the shop — on
  every open.
- **Reason for Rejection**: the year's follow-up reads; storing the two counts from two days
  back costs one trigger path and ~10 reads per booking.

## Risks & Mitigations

| Risk                                                         | Effect                                                                  | Mitigation                                                                                                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A day document out of step with its visits                   | a wrong figure until rewritten                                          | stamp ordering in the writer; `missingDays` logged; the agreement spec                                                                                                    |
| Clock skew between two function instances on the stamp       | an older computation wins a race                                        | assumed sub-second; the residual is accepted: the day is rewritten on its next edit; the race window is one trigger run                                                   |
| A decisive write failure (a malformed roster or location)    | that day stale                                                          | accepted residual: `AnalyticsDayWriteFailed` names the key; rewritten on the day's next edit or the next version bump                                                     |
| A definition-version bump against the whole reach            | every past day eligible at once; opens cost v1's reads until that night | one recompute pass that night; the callable computes live meanwhile; never a hand backfill                                                                                |
| The recompute fails for several nights                       | `missingDays` rises; opens cost v1's reads                              | `AnalyticsRecomputeDone` absent or `missingDays` rising is the alert; the pass resumes from its cursor; the window widens by itself                                       |
| A trigger race on a past day (two edits in a minute)         | the later run's reads must win                                          | the stamp rule inside one transaction; both runs idempotent                                                                                                               |
| The shop-year read (~3,650 documents) against the 4 s budget | the YEAR span unusable for the admin                                    | measured in PR 4b; Alternative O is the recorded next step                                                                                                                |
| A 366-day `CUSTOM` for the shop                              | ~3,700 reads                                                            | the cap and the `limit`; the same measurement                                                                                                                             |
| The flag off after YEAR/CUSTOM ship                          | a long span answers «Опитай по-късно»                                   | the flag is the dark-launch gate; the read path's rollback is a redeploy of the previous functions build                                                                  |
| The view transition stutters on a phone; Back re-mounts      | a dropped frame on the owner's own rule                                 | measured in PR 1 at 4× throttle; the house cross-fade is the fallback; `RouteReuseStrategy` if Back shows                                                                 |
| The kit costs more weeks than the screen                     | PR 2 late                                                               | three components, built as the screen needs them; Chart.js remains the recorded fallback                                                                                  |
| The screen still reads flat with zero new hues               | the owner's first ask unmet                                             | the hue gate (Open Questions) opens a validated categorical set in a later PR                                                                                             |
| Warning and accent adjacent in every bar                     | unmarked time reads as worked time                                      | the hatch and the separator edge; the pairwise distance pin in `chart-palette.spec.ts`                                                                                    |
| A year report in the device cache                            | a quota error, no first-frame paint                                     | answers are ≤ ~100 kB (`DayRow`, not `DayFigures`, in the answer); a quota error is ignored as v1; the fresh answer paints when it arrives                                |
| Client names in an export                                    | PII off the device                                                      | the CSV carries days and services only; no seat rows                                                                                                                      |
| First open with no cache; a cache from an older definition   | a blank first frame; a stale report                                     | as v1: the placeholder, the version in the cache key; a cached entry the decoder refuses is deleted and answers `REPOSITORY_MALFORMED`, which the store paints as nothing |
| `in` / `array-contains-any` 30-value chunking                | a visit counted twice                                                   | as v1: `mergeVisits`                                                                                                                                                      |
| Money on a shared device; a stale account link               | another person's figures                                                | as v1: the cache keyed by uid and cleared on sign-out; the callable re-judges the stored link                                                                             |

## Non-Functional Requirements

- **Security & Privacy**: `analyticsDays` and `analyticsGoals` are deny-all in rules and
  read only by the callables through the Admin SDK; a day document holds no client name
  and no seat; the export carries days and services only; goals are keyed by barber
  record, not account, so a re-link cannot move one; a barber's report never carries
  another barber's figure (no radar on a barber's report). Money never enters a log line.
- **Performance & Latency**:
  - callable p95 ≤ 1.5 s for a barber on any span and ≤ 4 s for the shop on any span; `DAY`
    ≤ 1 s;
  - tap from the schedule → first frame from the cache with no frame over 16.7 ms at 4×
    CPU throttle on a production build;
  - the chart kit ≤ 40 kB raw inside the analytics route's 1,680,000-byte ceiling (a dated
    raise only if measured over);
  - the writer's extra cost per booking ≤ 35 reads + 1 write; the nightly pass ≤ 100 reads
    in steady state;
  - the answer ≤ ~100 kB on any span (`DayRow` per day up to 93 days, per month beyond; the
    series ≤ 366 points; the hour grid ≤ 168 cells); the device cache keeps 6 entries as v1,
    a year report among them.
- **Rollout & Rollback**: PR order is the rollout. The stored-days PR deploys indexes + TTL
  (wait for `docs/production-deploy.md` §P2 and §P3 — the production runbook's gates that
  every TTL policy and composite index is active; its counts move from 7 to 8 TTL policies
  and from 24 to 25 composites), then rules, then functions with the flag off: the writers
  and the recompute run from that deploy, so the reach fills the first night. Production
  turns the flag on by a second functions deploy of PR 4b's build with the manifest key
  `true`, after the first nightly recompute has logged `AnalyticsRecomputeDone`. Rollback of
  the read path is a redeploy of the previous functions build; the flag is the dark-launch
  gate. The callable PRs deploy functions before web (an old function refuses the new
  fields with `ANALYTICS_INVALID_INPUT`). The web entry and screen PRs roll back by
  redeploying the previous web build; day documents and goals stay, unread.

## Additional Resources

- v1: [staff-analytics.md](./staff-analytics.md),
  [2026-11-08-staff-analytics.md](../architecture/decisions/2026-11-08-staff-analytics.md),
  [implementation_checklist.md](../design-research/staff-analytics/review/implementation_checklist.md)
- v2 research: [hypothesis-v2.md](../design-research/staff-analytics/hypothesis-v2.md),
  [brainstorm_review_report_v2.md](../design-research/staff-analytics/brainstorm_review_report_v2.md),
  [concepts_brief_v2.md](../design-research/staff-analytics/concepts_brief_v2.md),
  [mobbin-inspiration-v2.md](../design-research/staff-analytics/mobbin-inspiration-v2.md),
  [chart-library-survey.md](../design-research/staff-analytics/chart-library-survey.md)
- v2 review (Stages 5–9, their resolutions and the accepted trade-offs):
  `docs/design-research/staff-analytics/review-v2/`
- The schedule's search: [staff-search-spotlight.md](./staff-search-spotlight.md),
  [staff-search-tokens.md](./staff-search-tokens.md)
- Repository rules: `CLAUDE.md` Laws 3–10; `.claude/rules/firestore-layout.md`,
  `ecs-pipelines.md`, `ecs-ports.md`; [firestore-runbook.md](../architecture/firestore-runbook.md)
  §2.1 (TTL); [production-deploy.md](../production-deploy.md) §3.1
- The dataviz method (chart forms, marks, colour) — the dataviz skill bundled with Claude
  Code; its `scripts/validate_palette.js` is run once by hand on the mark colours, outside
  the repository; the repository's gate is `chart-palette.spec.ts`

## Future Improvements

- **"Same period last year"**, reach 24 months and a 25-month TTL — in the PR that lands
  after a full year of stored days (November 2027); raising the TTL re-stamps every
  document, because `purgeAt` is anchored on `localDate`.
- **A barber's own radar** against the other barbers' average, shown from three
  contributors (v1.1's reference) — once the admin radar has lived a month.
- **Hue-per-part**: a validated categorical set if the meaning-colours still read flat
  (Open Questions).
- **The next-7-days read** as a stored projection (the largest share of a barber's open).
- **A tap readout on the line**, if a screen shows the right-edge labels are not enough.
- **A seat-level CSV**, per-barber service rows on the shop export, print to PDF, a share
  card — when asked for and the purpose is stated.
- **Pay rules, earnings, sealing**: `docs/designs/staff-pay.md` (to be written). A
  suggestion for it: the rule at `barbers/{id}/restricted/pay` as a second named deny-all
  match, and a seal as its own snapshot document.
- **First-visit return, overdue regulars, the Monday card, the receptionist's forward
  open-time card** (v1.1 items, deferred).

---

## Detailed Implementation Plan

One PR per row, in dependency order. Every file is listed under the PR that touches it; a
file touched twice is listed under each. Each PR commits and pushes at every green boundary
(typecheck, lint, test, layering, the e2e it names), opens against `main`, and lowers any
`max-lines` cap a file shrinks under. "The three specs" below are the presenter, the store
and the page specs of item 11. Pay and sealing: Non-Goals, D8.

| PR  | Deliverables                                                                                                                | Depends on | Gate                                                                                    | Deploy                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | schedule toolbar button, URL state, freshness wording, chunk prefetch, the two measurements                                 | —          | e2e: entry, Back restores, `?free=1` round trip                                         | web                                                           |
| 2   | `@creativo/ui/charts` (bar, line, heatmap), the palette spec, one showcase page; the redrawn WEEK/MONTH screen on live data | 1          | component, presenter and axe specs pass; the v1 e2e passes                              | functions → web                                               |
| 3   | the DAY span, the comparison chip, the button switched to DAY, the time bar deleted                                         | 2          | pipeline and wire specs; a DAY e2e                                                      | functions → web                                               |
| 4a  | day documents, written but not read: `DayFigures`, the writer, the recompute, the triggers, TTL, rules, indexes, the flag   | 3          | property P1 on the fixture month; the trigger wire spec; the rules integration spec     | indexes + TTL (production-deploy §P2/§P3) → rules → functions |
| 4b  | the read path: day documents + live days, YEAR, CUSTOM; the flag on                                                         | 4a         | property P2; the agreement e2e; the budgets; the shop-year measurement                  | functions → web                                               |
| 5   | the admin radar                                                                                                             | 4b         | purity and boundary specs                                                               | functions → web                                               |
| 6   | goals                                                                                                                       | 4b         | the rules integration spec; the audit row spec; the client booking lib's lint and tests | rules → functions → web                                       |
| 7   | CSV export, the shared download helper                                                                                      | 2          | the share/download e2e                                                                  | web                                                           |
| 8   | records                                                                                                                     | all        | the runbook gates                                                                       | —                                                             |

### PR 1 — The schedule entry, URL state, freshness wording

1. `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.html` (Modify)
   — Angular template. The chart button `staff-analytics-open` in the top trailing cluster
   after the view menu, before search (view · chart · find · who);
   `(click)="openAnalytics()"`; a `@defer (when false; prefetch on idle) { <lib-staff-analytics /> }`
   block that prefetches the analytics chunk (the dashboard imports `StaffAnalyticsPage`;
   `type:feature` may import `type:feature`).
2. `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.ts` (Modify) —
   `openAnalytics()` builds `{ span: 'WEEK', from: store.dayKey() ?? store.todayKey(), barber }`
   where `barber` is (a) `store.scope()` when an admin views one chair, (b) absent when an
   admin views every chair, (c) absent for a barber; then `router.navigate`. No
   `startViewTransition`. PR 3 switches the span to `DAY`.
3. `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.chrome.css`
   (Modify; the `view-transition-name` line conditional on item 14, which runs first) —
   the button's position in the cluster; `view-transition-name: staff-analytics-head` on
   the button if the morph is kept.
4. `apps/web/src/styles.css` (Modify, conditional on item 14) — `::view-transition-group(staff-analytics-head)`
   timing beside the search's.
5. `libs/ui/icons/src/lib/manifest/icon-vocabulary.ts` (Modify) — the semantic key
   `analytics.chart` → Material `bar_chart`; `pnpm icons:glyphs` regenerates the glyph set;
   `icon-vocabulary.spec.ts` pins the name.
6. `libs/features/staff/analytics/src/lib/staff-analytics.store.ts` (Modify):
   - (a) `applyRouteSpan`, `applyRouteFrom`, `applyRouteTo`, `applyRouteBarber`; the store
     accepts `WEEK`/`MONTH` and any `from` (the week or month that holds it) in PR 1; an
     unknown `span` reads as the current month; `DAY`/`YEAR`/`CUSTOM` arrive in PR 3/4b;
   - (b) the `published()` record — what the store last wrote to the URL, so its own echo
     is not read as a request (the schedule store's guard);
   - (c) a deferred `replaceUrl` write after each pick; the first write-back is the deferred
     write after the first non-null request and writes the period's first day; the store
     never rewrites a URL it did not pick;
   - (d) a `nowUtcMs` signal re-read every 60 s while attached (`effect` + `setInterval`,
     cleared in `DestroyRef.onDestroy`), so the freshness line ticks.
7. `libs/features/staff/analytics/src/lib/staff-analytics-page/route-inputs.ts` (Create) —
   `bindAnalyticsRouteInputs(page, store)`, following the schedule's `route-inputs.ts`:
   untracked store calls; an absent query parameter arrives as `undefined` and is passed to
   the store as `null`; never a navigation inside the first activation.
8. `libs/features/staff/analytics/src/lib/staff-analytics-page/staff-analytics.page.ts`
   (Modify) — the four route-bound `input()`s (`span`, `from`, `to`, `barber`) and the
   binder call in the constructor; `withComponentInputBinding` is already on.
9. `libs/features/staff/analytics/src/lib/analytics.presenter.ts` (Modify) — `statusOf`
   words the four branches of "Freshness": the presenter branches on
   `UtcEpochMs.elapsedMs`; `status.justNow` under a minute or for a negative age;
   `relativeTime(…, 'short')` (`@creativo/infrastructure/i18n`) wrapped as
   `status.updatedAgo` for 1–59 minutes; `formatInstant`'s time for the same shop day and
   its date + time otherwise; plus the ⓘ text.
10. `libs/features/staff/analytics/src/lib/analytics.words.ts` (Modify) — the keys
    `status.justNow`, `status.updatedAgo` («Обновено {age}»), `status.updatedAt` («Обновено
    в {time}»), `status.updatedOn` («Обновено на {date} в {time}»), `status.info`, under
    the existing `staffAnalytics.status.*` family; `libs/infrastructure/i18n/src/assets/i18n/bg.json`
    and `en.json` (Modify) — those keys and `staff.day.analyticsLabel`.
11. `libs/features/staff/analytics/src/lib/analytics.presenter.spec.ts`,
    `staff-analytics.store.spec.ts`, `staff-analytics-page/staff-analytics.page.spec.ts`
    (Modify) — the wording branches, the tick, the URL sync (URL → store, store → URL, the
    echo guard).
12. `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.spec.ts` (Modify)
    — the button exists for a barber and an admin; the navigation's query in cases (a)–(c)
    of item 2.
13. `apps/web/e2e/staff-analytics.spec.ts` (Modify) — a case from the schedule:
    - (a) an admin on a day with one chair selected taps the button → the URL on arrival,
      before the store's first write-back, is `/staff/analytics?span=WEEK&from=<day>&barber=<id>`;
    - (b) a barber → the same without `barber`;
    - (c) a pick inside analytics rewrites the URL to the period's first day;
    - (d) Back restores the schedule's `?day&view&barber`; the `?free=1` round trip still
      clears; the menu case is kept.
14. `docs/design-research/staff-analytics/perf/pr1-entry.md` (Create) — two measurements
    on the 4× throttle production build: forward (tap → first frame) and Back (tap →
    schedule interactive, with the reads it issues). The morph is kept only if no frame
    exceeds 16.7 ms during the transition. If Back's re-mount drops a frame over 16.7 ms:
    `apps/web/src/app/schedule-reuse.strategy.ts` (Create) and `apps/web/src/app/app.config.ts`
    (Modify) add a detach/attach `RouteReuseStrategy` keyed on the one route path
    `staff/schedule` (one detached handle), with a spec.

### PR 2 — The chart kit and the redrawn WEEK/MONTH screen

15. `libs/ui/charts/` (Create, the Nx project `charts`: `nx g @nx/angular:library charts --directory=libs/ui/charts --tags=scope:shared,type:ui --prefix=ui --unitTestRunner=vitest --style=css`,
    the flags `libs/ui/patterns` was generated with; the `nx-generate` skill first, per
    CLAUDE.md §6): `project.json`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`,
    `vite.config.mts`, `eslint.config.mjs` (extends `#eslint-config`, the `ui`
    selector-prefix rules copied from `libs/ui/patterns/eslint.config.mjs`),
    `src/index.ts`, `src/test-setup.ts`, `README.md` (the elements, the inputs, the colour
    mapping, the accessibility contract); `src/lib/chart-part.ts` (Create) — the
    `UiChartPart` dictionary.
16. `tsconfig.base.json` (Modify) — `@creativo/ui/charts` beside the other `@creativo/ui/*`
    paths.
17. `libs/ui/layout/src/lib/resize/element-width.ts` + `.spec.ts` (Create) —
    `elementWidth(element: Signal<ElementRef | undefined>): Signal<number>` over
    `ResizeObserver`, `0` where the API is absent; `libs/ui/layout/src/index.ts` (Modify) —
    export it.
18. `libs/ui/charts/src/lib/geometry/linear-scale.ts`, `line-path.ts`, `stack-offsets.ts`
    - a spec each (Create) — pure display geometry over numbers.
19. `libs/ui/charts/src/lib/bar-chart/bar-chart.ts`, `.html`, `.css`, `.spec.ts` (Create)
    — `ui-bar-chart` with the Chart kit table's inputs; marks: 4 px rounded data ends, 2 px
    gaps in the surface colour, a legend content slot `[uiChartLegend]`; `(uiBarPicked)`
    emits the index; bar heights transition on a CSS `@property`.
20. `libs/ui/charts/src/lib/line-chart/line-chart.ts`, `.html`, `.css`, `.spec.ts` (Create)
    — `ui-line-chart` with the comparison series, the average rule, right-edge labels; a
    path change cross-fades.
21. `libs/ui/charts/src/lib/heatmap/heatmap.ts`, `.html`, `.css`, `.spec.ts` (Create) —
    `ui-heatmap` as a CSS grid, `--ui-cell-strength` per cell.
22. `libs/ui/charts/src/lib/charts.css` (Create) — the `[data-part]` → token mapping for
    every `UiChartPart` value (accent, destructive, warning + the hatch pattern, the three
    foreground grades, the comparison grey), the heatmap ramp, the separator edge,
    reduced-motion; imported by each element's stylesheet.
23. `libs/ui/tokens/src/lib/chart-palette.spec.ts` (Create) — parses the `[data-part]`
    rules of `libs/ui/charts/src/lib/charts.css`, composites each `color-mix(…, N %,
transparent)` over `--sys-color-background` and `--sys-color-surface` with `composite`
    (`contrast.ts`), measures the hatch on its solid fill, and pins contrast ≥ 3:1 and the
    adjacent-pair OKLab distance × 100 ≥ 8 for the two ordered lists and the (comparison
    grey, accent) pair, in both themes.
24. `apps/showcase/src/app/pages/controls/charts/charts.page.ts`, `.html`, `.css` (Create)
    — one page demonstrating the three elements in every variant;
    `apps/showcase/src/app/app.routes.ts` (Modify) — the lazy route `controls/charts`;
    `apps/showcase/src/app/pages/controls/controls.page.ts` (Modify) — the index entry;
    `apps/showcase/e2e/design-system.spec.ts` (Modify) — `charts` in `CONTROL_ROUTES`, both
    themes' baselines generated on the owner's machine.
25. `libs/ecs-core/src/systems/analytics-hour.system.ts` + `.spec.ts` (Create) — `HourDay`,
    `bucketsOf(seats: readonly MinuteSpan[], stretches: readonly MinuteSpan[])` (a spec case
    for a stretch crossing an hour boundary), `grid(days)`, `peak(cells)` (ties → earliest;
    `null` under 7 rostered days); purity.
26. `libs/ecs-core/src/systems/staff-analytics.system.ts` (Modify) — `daysOf` returns each
    day's offered stretches as `stretches: readonly MinuteSpan[]` on `AnalyticsDay`;
    `report` fills `reportSeries`, `reportTimeSeries`, `reportHourGrid`, the
    busiest/emptiest fields and `reportAheadDays` from the live visits (PR 2 computes
    everything live, as v1); `staff-analytics.system.spec.ts` (Modify) — the new fields'
    cases.
27. `libs/ecs-core/src/components/analytics-report.data.ts` (Modify) — the new fields and
    row types; `analytics-call.data.ts` (Modify) — `decodeReport` reads them; the version
    stays 1 until PR 4a, and a cached entry the decoder refuses is deleted and answers
    `Result.err` (`REPOSITORY_MALFORMED`), which the store paints as nothing (pinned in the
    adapter spec of item 74); `analytics-call.data.spec.ts`,
    `analytics-dictionaries.type-spec.ts` and `libs/ecs-core/src/testing/analytics-report.fixtures.ts`
    (Modify).
28. `libs/ecs-core/src/systems/index.ts`, `components/index.ts` (Modify) — exports.
29. `apps/functions/src/main.spec.ts` (Modify) — the answer's new fields in the wire pin
    (the call shape is v1's in PR 2).
30. `libs/features/staff/analytics/src/lib/analytics.vm.ts` (Modify) — the display structs
    the charts take (`AnalyticsSeriesVm`, `AnalyticsTimeSeriesVm`, `AnalyticsHeatmapVm`,
    `AnalyticsAheadVm`, `AnalyticsServicesBarsVm`, the sentence fields); `BAR_PART_HOOKS`
    stays as the `AnalyticsBarPart → UiChartPart` table; the rows-based
    `AnalyticsShareGroupVm` kept for the origins' rows.
31. `libs/features/staff/analytics/src/lib/analytics.presenter.ts` (Modify) — maps the
    report's series 1:1 to the chart inputs with span-dependent labels and `valueText`,
    the sentences (the heatmap's hour from the report's tags, the hero's delta), the
    open-hours bars with the emptiest highlighted; every decision read from the report.
32. `libs/features/staff/analytics/src/lib/staff-analytics-page/staff-analytics.page.html`,
    `.css`, `.ts` (Modify) — the seven questions' sections drawn with the kit's elements;
    the v1 test ids kept (`analytics-takings` and its digit elements, `analytics-open`,
    `analytics-hero`, `analytics-scopes`, `data-load`); `lib-analytics-time-bar` is removed
    from this template (its legend becomes the bar chart's `[uiChartLegend]` content) and
    stays in the tree until PR 3 deletes it.
33. `libs/features/staff/analytics/src/lib/analytics-time-bar/analytics-time-bar.css`
    (Modify) — the six `[data-part=…]` background rules are deleted (the kit's `charts.css`
    owns the mapping; `BAR_PART_HOOKS`'s values are the kit's vocabulary).
34. `libs/features/staff/analytics/src/lib/analytics.words.ts`, `bg.json`, `en.json`
    (Modify) — the chart labels, the sentences, the legend words.
35. `libs/features/staff/analytics/src/lib/analytics.presenter.spec.ts`,
    `staff-analytics-page/staff-analytics.page.spec.ts` (Modify) — the chart inputs per
    grain; axe on the redrawn page.
36. `tools/verify/bundle/budgets.json` (Modify, conditional) — a dated raise of the
    analytics route's ceiling only if `pnpm run verify:bundle` measures over 1,680,000 bytes.
37. `apps/web/e2e/staff-analytics.spec.ts` (Modify) — the v1 cases pass on the redrawn
    page; a case that the time bars' legend sums equal the period's rostered minutes.
38. `libs/features/staff/dashboard/src/lib/staff-analytics.agreement.spec.ts` (Modify) —
    v1 G5's case (unsold + open = the schedule's free minutes) over the new series fields.

### PR 3 — The DAY span and the comparison chip

39. `libs/ecs-core/src/components/analytics-period.data.spec.ts` (Create) — `of` and
    `previous` for DAY, `previous` for WEEK/MONTH, `isComparable`;
    `analytics-period.data.ts` (Modify) — `AnalyticsSpan.Day`; `dayOf`; `of` accepts any
    day for DAY; `previous` for DAY (the same weekday a week earlier); `isComparable`.
40. `libs/ecs-core/src/components/analytics-call.data.ts` (Modify) — `analyticsComparison`
    on the call (`PREVIOUS` accepted, `SAME_LAST_YEAR` refused as `invalidInput` with the
    `field` `'analyticsComparison'`); `analytics-report.data.ts` (Modify) —
    `reportAnalyticsComparison` and the comparison range fields;
    `analytics-report.fixtures.ts` (Modify).
41. `libs/ecs-core/src/systems/staff-analytics.system.ts` (Modify) — `periodInSpan` → DAY
    (today when inside the period, else its first day) and `stepsOf` for DAY; the DAY
    report (one `reportSeries` entry and one `reportTimeSeries` entry, the hero's
    counterpart day); the `null` comparison when not comparable;
    `staff-analytics.system.spec.ts` (Modify).
42. `libs/ecs-core/src/pipelines/staff-analytics.pipeline.ts` (Modify) — the DAY read set:
    the day, its counterpart and the next 7 days, no follow-ups and no other
    previous-period visits; `staff-analytics.pipeline.spec.ts` (Modify).
43. `apps/functions/src/wire/analytics.wire.ts` + `.spec.ts` (Modify) — decode
    `analyticsComparison` and the DAY span; `apps/functions/src/main.spec.ts` (Modify).
44. `libs/features/staff/analytics/src/lib/staff-analytics.store.ts` (Modify) — DAY in the
    period control and the URL; `analytics.presenter.ts` (Modify) — the DAY screen (hero +
    delta, one vertical stacked `ui-bar-chart`, services, the open-hours card; no line, no
    heatmap), the «няма данни за сравнение» chip; `staff-analytics.page.html` (Modify) —
    the third segment («Ден»), the comparison chip; `analytics.words.ts`, `bg.json`,
    `en.json` (Modify); the three specs (Modify).
45. `libs/features/staff/analytics/src/lib/analytics-time-bar/*` (Delete) — the DAY screen
    uses the kit; `analytics.vm.ts` (Modify) — `AnalyticsBarSegmentVm` folds into the bar
    chart's input.
46. `libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.ts` + `.spec.ts`
    (Modify) — the button sends `span=DAY`.
47. `apps/web/e2e/staff-analytics.spec.ts` (Modify) — a DAY case from the schedule's entry
    (`?span=DAY`).

### PR 4a — Day documents, written but not read

48. `libs/ecs-core/src/components/day-figures.data.ts` + `.spec.ts` (Create):
    - (a) `DayRow = { barberId; localDate; dayRosteredMinutes; dayWorkedMinutes;
dayNoShowMinutes; dayUnmarkedMinutes; dayBookedAheadMinutes; dayHeldMinutes;
dayBlockedMinutes; dayBreakMinutes; dayShortGapMinutes; dayUnsoldMinutes; dayOpenMinutes;
dayClosedDayMinutes; dayTakingsCents; dayTipsCents; currency }`, `DayCounts`,
      `DayServices`, `DayHours`, `DayFigures` as their intersection;
    - (b) the companion: `empty(barberId, localDate)`, `is`,
      `rowOf<T extends DayRow>(x: T): DayRow`;
    - (c) `analytics-report.data.ts` (Modify) — `AnalyticsReport.DayRow` removed,
      `reportDayRows: readonly DayRow[]`, `ANALYTICS_DEFINITION_VERSION = 2`;
      `analytics-call.data.ts` (Modify) — its `dayRowOf` decoder reads the renamed fields;
    - (d) `libs/features/staff/analytics/src/lib/analytics.presenter.ts` and
      `analytics.vm.ts` (Modify) — the renamed fields; `analytics-report.fixtures.ts`
      (Modify).
49. `libs/ecs-core/src/primitives/ids.primitive.ts` + `.spec.ts` (Modify) —
    `BarberAnalyticsDayId` (`idCompanion`), `AnalyticsRecomputeJobId` (`idCompanion`, `FIXED
= 'analyticsRecompute'`).
50. `libs/ecs-core/src/entities/barber-analytics-day.entity.ts` + `.type-spec.ts` (Create)
    — `BarberAnalyticsDayMeta = { id: BarberAnalyticsDayId }`; `BarberAnalyticsDay =
BarberAnalyticsDayMeta & DayFigures`; not `never`, flat, disjoint;
    `libs/ecs-core/src/entities/analytics-recompute-job.entity.ts` + `.type-spec.ts`
    (Create) — the job entity of "The recompute's job document";
    `libs/ecs-core/src/entities/policy-recompute-job.entity.ts` (Modify) —
    `RecomputeJobName.AnalyticsDays: 'ANALYTICS_DAYS'` (the analytics entity imports it as a
    sibling); `entities/collections.ts` (Modify) — `AnalyticsDays: 'analyticsDays'`,
    `ANALYTICS_RECOMPUTE_DOC = AnalyticsRecomputeJobId.FIXED`.
51. `libs/ecs-core/src/components/retention-group.data.ts` (Modify) —
    `RetentionGroup.AnalyticsDays` and `RetentionAnchor.analyticsDays(localDate)`, and its
    collection list; `retention-group.data.spec.ts`, `retention-group.type-spec.ts`
    (Modify); `libs/ecs-core/src/systems/retention.system.ts` + `.spec.ts` (Modify) — an
    eighth retention formula, `ANALYTICS_DAYS_KEEP_DAYS = 400`, the table and the "seven"
    in the doc comment; `apps/functions/src/adapters/firestore-ttl.adapter.ts` + `.spec.ts`
    (Modify) — the `analyticsDays` segment reads `localDate`, the "seven" in its comment;
    `docs/architecture/firestore-runbook.md` §2.1 and `.claude/rules/firestore-layout.md`
    (Modify) — the eighth TTL group.
52. `libs/ecs-core/src/systems/day-figures.system.ts` + `.spec.ts` (Create) — `fold(input)`
    over `{ day; visits; followUps; policy; nowByLocation }`, `hourBuckets` (delegating to
    `AnalyticsHourSystem.bucketsOf`), `sum`; purity; property **P1** as a fast-check
    property over generated day sets: each `day*Minutes` sum ↔ `report*Minutes`;
    `dayTakingsCents`/`dayTipsCents` ↔ `reportTakingsCents`/`reportTipsCents`;
    `dayExcludedVisitCount` ↔ `reportExcludedVisitCount`; `dayRebookedBase`/`Count` ↔
    `reportRebookedBase`/`Count`; `dayNoShowCount`/`Base` ↔ `reportNoShowCount`/`Base`;
    `dayLateCancellationCount` ↔ `reportLateCancellationCount`; the three origin counts ↔
    `reportOrigins`; `dayServices` merged by `serviceId` ↔ `reportServices` minus the
    derived ratio; `dayHourWorked`/`Rostered` ↔ `reportHourGrid`; with the live days added
    on the report's side.
53. `libs/ecs-core/src/systems/analytics-recompute-job.system.ts` + `.spec.ts` (Create) —
    `extentOf`, `nextPage`, `stepKeyOf`/`sameStep`, `shouldRecordStall`/`stall`, `finish`
    per the contract (the policy system's members reused by import, not copied); purity;
    the cases: no job, a finished job, a stale unfinished job, a fresh unfinished job, a
    version change, a barber-list change.
54. `libs/ecs-core/src/systems/staff-analytics.system.ts` (Modify) — `isPastDay`;
    `VISITS_PER_BARBER_DAY = 60` beside `RATE_BASE`; `report` builds `reportDayRows` as
    `DayFigures.rowOf(DayFiguresSystem.fold(…))` per live day and the `AnalyticsFigure.TIME`
    drill-down reads the renamed fields; `staff-analytics.system.spec.ts` (Modify) — the
    two-locations case, the stretch-less day, money per day row.
55. `libs/ecs-core/src/ports/analytics.port.ts` (Modify) — `LoadAnalyticsDays`,
    `LoadAnalyticsDaysByKeys`, `AnalyticsDayReadPorts`; `LoadAnalyticsRecomputeJob`,
    `AnalyticsRecomputeJobPorts`; `ports/index.ts` (Modify);
    `libs/ecs-core/src/testing/analytics-doubles.ts` (Modify) — `memoryAnalyticsDayPorts(state:
{ days?; job? })` with a query log.
56. `libs/ecs-core/src/pipelines/write-analytics-day.pipeline.ts` + `.spec.ts` (Create) —
    the writer: the `AnalyticsDaySource` union command, the keys from
    `BusySystem.affectedKeys` for `'APPOINTMENT'`, the source visit's id from either side,
    the reads and the `commit` of "Stamp ordering" (`visitsOnBusyDay(key)` with `limit
VISITS_PER_BARBER_DAY + 1`, the follow-ups as `tx.query` in chunks of 30 via
    `BackfillPlanSystem.chunk`, the three `tx.get`s); stamp ordering proven (an older
    `sourceReadUtcMs` never overwrites a newer document); a non-past day is skipped; a
    stretch-less past day writes zeros; a cancelled follow-up rewrites the source day; one
    row over the cap answers `readFailed(…, 'resource-exhausted')`; a failure is collected,
    not fatal.
57. `libs/ecs-core/src/pipelines/start-analytics-recompute.pipeline.ts`,
    `continue-analytics-recompute.pipeline.ts` + a spec each (Create) — the contract (a
    pinned `nowUtcMs` across two zones; a missed night widens the window; a version-stale
    day; a running pass not started twice; the stale nudge; the cursor resumes; a page's
    documents read by keys and only the eligible handed to the writer).
58. `libs/ecs-core/src/pipelines/index.ts` (Modify) — exports.
59. `libs/ecs-core/src/primitives/log-event.data.ts` + `.spec.ts` (Modify) —
    `AnalyticsDayWritten`, `AnalyticsDayWriteFailed`, `AnalyticsRecomputeDone`.
60. `apps/functions/src/adapters/firestore-analytics.adapter.ts` + `.spec.ts` (Modify) —
    `loadAnalyticsDays` (one barber: the composite; the shop: the `localDate` range, `limit`
    366 × barbers + 1, `overBound`), `loadAnalyticsDaysByKeys` (`getAll` over ≤ 100 refs);
    the module-private `VISITS_PER_BARBER_DAY` replaced by the system's;
    `apps/functions/src/adapters/firestore-jobs.adapter.ts` + `.spec.ts` (Modify) —
    `loadAnalyticsRecomputeJob`, the factory's return type `BackfillJobPorts &
CallerRolesPorts & AnalyticsRecomputeJobPorts`; `firestore-ports.ts` (Modify) — the
    served `FirestorePorts` intersection gains the two bundles.
61. `apps/functions/src/wire/triggers.wire.ts` + `.spec.ts` (Modify) —
    `decodeAnalyticsDayEvent` for the departure trigger (one key or none);
    `combinedReport(busy, day)` for the appointment trigger; `decodeAnalyticsStepEvent` for
    the job document's write.
62. `apps/functions/src/main.ts` (Modify):
    - (a) `rebuildBusyOnAppointmentChange` runs `rebuildBusy` and `writeAnalyticsDay` (its
      `'APPOINTMENT'` command from the same `decodeRebuildBusyEvent` answer), settles the
      attempt with `combinedReport`;
    - (b) `writeAnalyticsDayOnExceptionChange = onDocumentWritten({ document: EXCEPTION_DOC, retry: true }, …)`;
    - (c) `continueAnalyticsRecomputeOnJobWrite = onDocumentWritten({ document: ANALYTICS_RECOMPUTE_JOB_DOC, retry: true }, …)`
      — `ANALYTICS_RECOMPUTE_JOB_DOC` a `main.ts`-local path
      `` `${Collections.BackfillJobs}/${ANALYTICS_RECOMPUTE_DOC}` `` on the
      `POLICY_RECOMPUTE_JOB_DOC` model, with the policy recompute's timeout and memory;
    - (d) `sweepAnalyticsDaysDaily = onSchedule({ schedule: 'every day 04:30', timeZone: CRON_TIME_ZONE, retryCount: 3 }, …)`
      calling `startAnalyticsRecompute`;
    - (e) `apps/functions/src/lib/cron-zone.ts` (Modify) — the comment's schedule count, +1;
    - (f) `apps/functions/src/main.spec.ts` (Modify) — the `EXPORTS` pin, the
      `FLIPPED_EXPORTS` length, the `ENDPOINTS` rows, the `every day 04:30` slot.
63. `libs/ecs-core/src/components/feature-flags.data.ts` + `.spec.ts` (Modify) —
    `FlagName.AnalyticsStoredDays: 'analytics.storedDays'`, `ALL_OFF`;
    `apps/functions/src/lib/flags.ts` + `.spec.ts` (Modify) — the `ANALYTICS_STORED_DAYS`
    param in `FLAG_PARAMS`; `config/feature-flags.json` (Modify) — the key `false` in all
    three environments (the manifest spec pins that every key is a `FlagName`); PR 4a's
    integration specs run flag-off.
64. `firestore.rules` (Modify) — `match /analyticsDays/{dayId} { allow read, write: if false; }`
    with the convention comment;
    `libs/infrastructure/firestore/src/lib/firestore.rules.integration.spec.ts` (Modify) —
    a client read and write of `analyticsDays` are denied (run by `pnpm nx run
firestore:test-integration`).
65. `firestore.indexes.json` (Modify) — the composite `(barberId ASC, localDate ASC)` on
    `analyticsDays`; `fieldOverrides`: `analyticsDays.purgeAt` with `ttl: true`;
    `analyticsDays.dayServices`, `.dayHourWorked` and `.dayHourRostered` each with
    `indexes: []`; `tools/verify/ops/retention.spec.mjs` (Modify) — an eighth TTL group.
66. `docs/production-deploy.md` (Modify) — §P2 "7 of 7" → "8 of 8"; §P3 24 → 25
    composites; §3.1 the new composite and TTL; the recompute's two exports and the sweep
    in the functions list; the flag and the first nightly recompute.
67. `apps/functions/src/integration/write-analytics-day.integration.spec.ts` and
    `analytics-recompute.integration.spec.ts` (Create, run by `pnpm nx run
functions:test-integration`) — the appointment trigger writes a past day's document and
    skips a live day; the departure trigger rewrites its day; a cancelled follow-up rewrites
    the source day; the recompute writes a missing day, a stretch-less day and a
    version-stale one, and widens its window after a missed night.
68. `libs/ecs-core/src/testing/analytics.fixtures.ts` (Modify) — the fixture month's day
    documents (`fold` over its past days; the fixture's `now` is the 28th 09:00, so days ≤
    the 26th are folded); `libs/ecs-core/src/pipelines/staff-analytics.agreement.spec.ts`
    (Modify) — property P1 run on `ANALYTICS_FIXTURE_MONTH` (PR 4a's gate).

### PR 4b — The read path: YEAR, CUSTOM

69. `libs/ecs-core/src/components/analytics-period.data.ts` + `.spec.ts` (Modify) — `Year`,
    `Custom`, `of(span, from, to)` (YEAR from 1 January), `previous` for CUSTOM,
    `CUSTOM_MAX_DAYS = 366`, their cases.
70. `libs/ecs-core/src/components/analytics-call.data.ts` (Modify) — `toLocalDate` and its
    rule (`null` unless `CUSTOM`); `analytics-report.data.ts` (Modify) — `reportMissingDays`;
    the grain of `reportSeries` and `reportDayRows` per span in the type's JSDoc (a
    per-month row's `localDate` is the month's first day; a partial week's is the period's
    first day or the week's Monday); `analytics-report.fixtures.ts` (Modify).
71. `libs/ecs-core/src/pipelines/staff-analytics.pipeline.ts` + `.spec.ts` (Modify) —
    `StaffAnalyticsPorts` gains `FlagsPorts`; the past/live split; `loadAnalyticsDays` when
    `flagOn(FlagName.AnalyticsStoredDays)`, read inside the handler; the live fallback for a
    missing day and its bound rule; the comparison period by the same path or skipped;
    `AnalyticsReported` gains `missingDays`, `span`, `comparison`; `analytics-doubles.ts`
    (Modify).
72. `libs/ecs-core/src/systems/staff-analytics.system.ts` + `.spec.ts` (Modify) —
    `report` over `pastDays: DayFigures[]` + live days; monthly grain for YEAR; weekly grain
    for CUSTOM > 93 days; day rows per month beyond 93 days; `periodInSpan` → YEAR (the
    year holding the period's first day) and → WEEK/MONTH; `stepsOf` on CUSTOM (shift by
    the range's length, forward disabled past today).
73. `libs/ecs-core/src/errors/analytics.error.ts` (Modify) — `invalidInput`'s `field`
    accepts `'toLocalDate'`; `periodOutOfRange` covers the cap.
74. `apps/functions/src/wire/analytics.wire.ts` + `.spec.ts` (Modify) — the full v2 call
    decoded; `apps/functions/src/main.ts` (Modify) — `analyticsPorts = once(() => ({
...serverPorts(), ...paramFlagsPorts() }))` (the `streakPorts` precedent) and
    `staffAnalytics` rewired onto it; `main.spec.ts` (Modify) — the pin.
75. `libs/infrastructure/web-storage/src/lib/local-storage-analytics-cache.adapter.ts` +
    `.spec.ts` (Modify) — the key encodes `to` and the comparison; `sameCall` compares
    them; the spec pins that a refused entry is deleted and answers `Result.err`
    (`REPOSITORY_MALFORMED`), and that `VERSION_PREFIX` (built from
    `ANALYTICS_DEFINITION_VERSION`) drops the v1 entries.
76. `libs/features/staff/analytics/src/lib/staff-analytics-page/analytics-range-sheet.ts`,
    `.html`, `.css`, `.spec.ts` (Create) — a `ui-modal-sheet` with two `ui-date-field`s
    (`from`, `to`) and «Приложи» in the sheet's action row; the sheet reads the store's
    `Result` (item 77) and the words `staffAnalytics.range.beforeReach`, `range.afterToday`,
    `range.tooLong`; «Приложи» disabled on any refusal;
    `libs/features/staff/analytics/src/lib/analytics.presenter.ts` (Modify) —
    `partsToLocalDate(parts: UiDateFieldParts): LocalDate | null`.
77. `libs/features/staff/analytics/src/lib/staff-analytics.store.ts` (Modify) — `pickedTo`
    beside `pickedFrom`; a `computed` running `AnalyticsPeriod.of(Custom, from, to)` and
    `isWithinRange` over the sheet's fields (a `from` after `to` swapped by a named
    companion), the `Result` the sheet reads; the «Година» segment (the fourth) and the
    «…» pill; `analytics.presenter.ts`, `analytics.vm.ts`, `staff-analytics-page/*`,
    `analytics.words.ts`, `bg.json`, `en.json` + the three specs (Modify) — the YEAR screen
    (months; a month opens the MONTH span), the CUSTOM screen.
78. `config/feature-flags.json` (Modify) — `analytics.storedDays` is `true` in development
    (the e2e's `demo-creativo-test` project reads that map) and staging in this PR;
    production is switched on by a second functions deploy of this PR's build with the key
    `true`, after production-deploy §P2/§P3 have run and the first nightly recompute has
    logged `AnalyticsRecomputeDone`.
79. `apps/web/e2e/support/seed-firestore.ts` (Modify) — `startAnalyticsRecompute(now)`
    writes `backfillJobs/analyticsRecompute` as a new full-reach pass through the Admin SDK
    (the same body `startAnalyticsRecompute` writes), which fires
    `continueAnalyticsRecomputeOnJobWrite` in the functions emulator; `waitForAnalyticsRecompute()`
    polls the document until `jobFinishedAtUtcMs` is set. No functions export, no `runJob`
    change, no pin change.
80. `apps/web/e2e/staff-analytics.spec.ts` (Modify) — before the YEAR case the harness
    calls the two helpers of item 79; YEAR for the admin; a custom range through the
    sheet; the «няма данни за сравнение» chip on a year; `missingDays` is not asserted in
    e2e.
81. `libs/ecs-core/src/pipelines/staff-analytics.agreement.spec.ts` (Modify) — property
    **P2**: through `staffAnalytics(ports)` over the fixture month, the flag's two settings
    answer equal reports, and a month from day documents plus the live days equals the
    month from visits (PR 4b's agreement gate).
82. `docs/design-research/staff-analytics/perf/pr4b-year.md` (Create) — the shop-year and
    barber-year p95 on the emulator with the seed and after deploy, against the budgets;
    the Alternative O decision.

### PR 5 — The admin radar

83. `libs/ecs-core/src/systems/analytics-radar.system.ts` + `.spec.ts` (Create) —
    `bestOf → RadarBest`, `axes(figures, best) → RadarRow`; a `null` best → `null`; under
    the base → `null`; reliability absolute; the comparison on the same base; purity.
84. `libs/ecs-core/src/components/analytics-report.data.ts`, `analytics-call.data.ts`
    (Modify) — `BarberFigures` gains `serviceMinutes`, `workedSeatCount` and
    `rosteredDayCount`; `reportComparisonBarbers`; `RadarRow`, `reportRadars`, `RadarBase`
    and `reportRadarBase`; `staff-analytics.system.ts` (Modify) — fills them for the shop
    scope only; the system, call and dictionary specs and `analytics-report.fixtures.ts`
    (Modify).
85. `libs/ui/charts/src/lib/radar/radar.ts`, `.html`, `.css`, `.spec.ts` (Create) —
    `ui-radar`; `geometry/polygon-points.ts` + `.spec.ts` (Create);
    `apps/showcase/src/app/pages/controls/charts/charts.page.ts`, `.html`, `.css` (Modify) —
    the radar demo; `design-system.spec.ts` baselines regenerated.
86. `libs/features/staff/analytics/src/lib/analytics.vm.ts`, `analytics.presenter.ts`,
    `staff-analytics-page/*`, `analytics.words.ts` (the two `RadarBase` sentences),
    `bg.json`, `en.json` + the three specs (Modify) — the «Как се справя всеки» section for
    the admin's shop scope; tapping a radar picks the scope.
87. `apps/web/e2e/staff-analytics.spec.ts` (Modify) — the admin sees one radar per barber;
    a barber's page has none.

### PR 6 — Goals

88. `libs/ecs-core/src/primitives/ids.primitive.ts` + `.spec.ts` and `ids.type-spec.ts`
    (Modify) — `CapacityMonthId` renamed `MonthKey` (`YYYY-MM`); `AnalyticsGoalKey`
    (`{barberId|shop}__{YYYY-MM}`). The rename's other files (compiler-checked):
    `local-date.primitive.ts` (`monthKey()`), `capacity-month.entity.ts`,
    `scheduling.port.ts`, `shop-day.pipeline.ts` and its spec, `rebuild-capacity.pipeline.ts`
    and its spec, `sample-lead-time.pipeline.spec.ts`, `capacity.system.ts` and its spec,
    `lead-time.system.ts`, `libs/ecs-core/src/testing/port-doubles.spec.ts`,
    `libs/features/client/booking/src/lib/schedule-step/availability-month.ts`,
    `booking-day.store.ts` and `booking-schedule-step.spec.ts`,
    `libs/infrastructure/firestore/src/lib/scheduling.adapter.spec.ts` and
    `scheduling.adapter.integration.spec.ts`,
    `apps/functions/src/adapters/firestore-capacity.adapter.spec.ts`,
    `apps/functions/src/integration/rebuild-capacity.integration.spec.ts`. The client
    booking lib's lint and tests join PR 6's gate.
89. `libs/ecs-core/src/components/analytics-goal.data.ts` and its `.spec.ts` (Create) — the
    `AnalyticsGoal` slice (`goal` prefix) and companion;
    `libs/ecs-core/src/components/analytics-goal-call.data.ts` and its `.spec.ts` (Create)
    — `SetAnalyticsGoalCall`, its answer and `decodeSet`; `entities/analytics-goal.entity.ts`
    - type-spec (Create); `collections.ts` (Modify) — `AnalyticsGoals`.
90. `libs/ecs-core/src/errors/analytics.error.ts` (Modify) — `GoalForbidden`,
    `GoalInvalidRange`; `apps/functions/src/edge.ts` + `.spec.ts` (Modify) — the two codes
    in `ANALYTICS_WIRE` (`permission-denied`, `invalid-argument` with `field`);
    `components/audit-context.data.ts` (Modify) — `AuditAction.AnalyticsGoalSet` and its
    `AuditContext` variant (`goalKey`, `goalScopeBarberId`, `goalMonth`, `goalLowCents`,
    `goalHighCents`); `firestore.indexes.json` (Modify) — those `auditLog.goal*` fields with
    `indexes: []`.
91. `libs/ecs-core/src/ports/analytics.port.ts` (Modify) — `LoadAnalyticsGoal`,
    `AnalyticsGoalPorts`; `AnalyticsCallPorts` gains `setAnalyticsGoal`; `ports/callables.ts`
    (Modify) — `Callables.SetAnalyticsGoal: 'setAnalyticsGoal'` and its `CallableWire` entry,
    `OPERATION_ID_FIELD: 'operationId'`, `CALLABLE_APP_CHECK_TOKEN: AppCheckTokenUse.Standard`,
    the `CALLABLE_ANSWER_DECODERS` entry; `analytics-doubles.ts` (Modify).
92. `libs/ecs-core/src/pipelines/set-analytics-goal.pipeline.ts` + `.spec.ts` (Create) —
    the caller rule and the refusals of "Pipelines"; `staff-analytics.pipeline.ts` (Modify)
    — reads the scope's goal on `MONTH` only; `staff-analytics.system.ts` (Modify) —
    `goalPaceOf(takings, goal, daysWorkedSoFar, daysRosteredInMonth)` → the tag, the
    contract's formula; `analytics-report.fixtures.ts` (Modify).
93. `apps/functions/src/wire/analytics.wire.ts` + `.spec.ts` (Modify) —
    `decodeSetAnalyticsGoal`, each field through its primitive guard;
    `apps/functions/src/main.ts` + `main.spec.ts` (Modify) — the callable export;
    `firestore-analytics.adapter.ts` (Modify) — `loadAnalyticsGoal`.
94. `firestore.rules` (Modify) — `match /analyticsGoals/{goalId} { allow read, write: if false; }`;
    `firestore.rules.integration.spec.ts` (Modify) — a client read and write of
    `analyticsGoals` are denied.
95. `libs/infrastructure/firebase-app/src/lib/analytics-call.adapter.ts` (Modify) — the
    web's `ANALYTICS_CALL_PORTS` bundle gains `setAnalyticsGoal`.
96. `libs/features/staff/analytics/src/lib/analytics-goal-sheet/analytics-goal-sheet.ts`,
    `.html`, `.css`, `.spec.ts` (Create) — a `ui-modal-sheet` with two `ui-amount-field`s
    (low, high) and «Запази» in the sheet's action row.
97. `libs/features/staff/analytics/src/lib/staff-analytics.store.ts` (`setGoal`),
    `analytics.vm.ts` (the goal struct), `analytics.presenter.ts` (the pace sentence),
    `staff-analytics-page/staff-analytics.page.html` and `.ts` (the ring section on
    `MONTH`, `ui-gauge` with `uiGaugeStyle="circularCapacity"`, and «Задай цел» on the
    current or next month), `analytics.words.ts`, `bg.json`, `en.json` + the three specs
    (Modify).
98. `apps/web/e2e/staff-analytics.spec.ts` (Modify) — a barber sets a range and sees the
    pace; an admin sets the shop's.

### PR 7 — CSV export

99. `libs/infrastructure/web-storage/src/lib/share-or-download-file.ts` + `.spec.ts`
    (Create) — `shareOrDownloadFile(name, blob): Promise<'SHARED' | 'DOWNLOADED' | 'CANCELLED'>`
    as "Export (PR 7)" specifies; `libs/infrastructure/web-storage/src/index.ts` (Modify) —
    export it; `libs/infrastructure/web-storage/README.md` (Create) — the lib's storage
    adapters and its browser file helper;
    `libs/features/staff/client-card/src/lib/client-card/client-card.ts` and
    `libs/features/client/appointments/src/lib/client-appointments/client-appointments.ts`
    (Modify) — their inline download code is replaced by a call to it.
100. `libs/features/staff/analytics/src/lib/analytics-export.presenter.ts` + `.spec.ts`
     (Create) — the two blocks' rows and text per the schema in "Export (PR 7)" (the shop's
     block 2 shop-wide with `бръснар = Всички`); pure.
101. `libs/features/staff/analytics/src/lib/staff-analytics.store.ts`,
     `staff-analytics-page/*`, `analytics.words.ts`, `bg.json`, `en.json` + the three specs
     (Modify) — the dock (`ui-page-action-bar`) with «Експорт»; the page calls the helper.
102. `apps/web/e2e/staff-analytics.spec.ts` (Modify) — the download fallback produces a
     file whose first line is `вид;бръснар;дата;работено мин;неявяване мин;немаркирано
мин;блокирано мин;почивка мин;непродадено мин;друго мин;оборот;бакшиш` and whose line
     count is days × barbers + services (per barber on a barber scope, shop-wide on the
     shop scope) + 2 headers + 1 blank; no client name in it.

### PR 8 — Records

103. `docs/architecture/decisions/2026-11-09-staff-analytics-v2.md` (Create) — the v2 ADR
     (Date, Predecessor, Supersedes); `docs/architecture/decisions/2026-11-08-staff-analytics.md`
     (Modify) — a status banner naming it.
104. `docs/designs/staff-analytics-v2.md` (Modify) — this document, status Implemented, the
     PR numbers; `docs/designs/staff-analytics.md` (Modify) — a "superseded by v2" banner on
     "Reads and cost", Alternative C's rejection reason, the Non-Goals' pay line and Future
     Improvements.
105. `docs/design-research/staff-analytics/review-v2/implementation_checklist.md` (Create)
     — the review findings, the accepted trade-offs, and how each was closed.
106. `libs/features/staff/analytics/README.md` (Modify) — the v2 screen and the kit.
107. `docs/production-deploy.md` (Modify) — one checklist block with the v2 deploy order
     (indexes + TTL → rules → functions → web; the flag flip by a second functions deploy).

### Verification Plan

- **Compilation/Build**: `pnpm nx run-many -t typecheck`; `pnpm nx build web` (the
  template errors `typecheck` does not see); `pnpm nx build functions`;
  `pnpm run verify:bundle` (builds the web app with `--stats-json` and checks the analytics
  route against its ceiling).
- **Unit Tests**: `pnpm nx run-many -t test` — the geometry specs; every system's purity
  and boundary cases (DST day, a `null` best, the base of 20, two zones, a stretch-less
  day, a missed night); `write-analytics-day.pipeline.spec.ts` stamp ordering; the
  recompute's extents, cursor, stale nudge and budget; property P1 (items 52, 68) and
  property P2 (item 81); the presenter specs pinning every chart input per grain and every
  sentence; `chart-palette.spec.ts` (contrast and adjacent-pair distance).
- **Static Analysis & Linting**: `pnpm nx run-many -t lint` (presenter purity on the
  presenters and the export presenter; `no-sliced-ports`; `query-needs-limit` on the new
  adapter reads and the writer's queries); `pnpm nx run verify-tools:layering`;
  `pnpm nx run verify-tools:runbook-gates` (the gates that refuse retired document keys and
  legacy spellings, run over the new fixture and component names).
- **Test Coverage Requirement**: the repo's `coverage` CI job as it stands; the new
  systems at 100 % branch coverage (they are pure).
- **E2E/Integration**: `pnpm nx run functions:test-integration` (the two specs of item 67);
  `pnpm nx run firestore:test-integration` (the `analyticsDays` and `analyticsGoals`
  denials of items 64 and 94); `pnpm run e2e:web` — `staff-analytics.spec.ts` (the entry
  and Back, the `?free=1` round trip, DAY from the schedule, YEAR and CUSTOM for the admin
  after the recompute helpers of item 79, the empty comparison chip, the radar per barber,
  a goal's pace, the CSV's header and lines), `staff-client-roles.spec.ts` unchanged;
  `apps/showcase` baselines on the owner's machine (`@screenshot` is not a CI gate). Never
  run the full e2e suite and `run-many -t test` at the same time.
- **Measured**: PR 1's two timings on the 4× throttle production build, recorded in
  `perf/pr1-entry.md`; PR 4b's shop-year and barber-year p95 in `perf/pr4b-year.md`; the
  callable's p95 per span from `AnalyticsReported.durationMs` in Cloud Logging after
  deploy; `missingDays` at 0 after the first nightly recompute.

---

_Drafted with EGM_
