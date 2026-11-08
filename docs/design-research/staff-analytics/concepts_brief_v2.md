# Staff analytics v2 — concepts brief

- **Author:** Dimitar Dimitrov, with Claude
- **Date:** 2026-11-08
- **Predecessor:** `docs/designs/staff-analytics.md` (v1, PRs #39–#43) and the ADR
  `docs/architecture/decisions/2026-11-08-staff-analytics.md`
- **Inputs:** `hypothesis-v2.md`, `brainstorm_review_report_v2.md` (six lenses: 15 blockers,
  31 majors, 22 nits — every blocker is resolved below and every major is either taken or
  answered), `mobbin-inspiration-v2.md`, `chart-library-survey.md`
- **Next:** `/egm-draft` → `docs/designs/staff-analytics-v2.md`

## Overview

v1 shipped a staff analytics screen that computes a week or a month on every open by
re-reading every visit of the period, and draws the figures as rows of text in one grey.
The owner's first reading of it asked for six things: graphs that explain, colour that
explains, day/week/month/year, the v1.2 and v2 stages, a tap from the schedule, exportable
reports — and an answer on whether «Към 11:40» means figures are rebuilt live at Firestore's
expense (they are not: it is the time the server computed the answer; the cost is the
request, 1,000–11,500 reads, because every open re-reads the period's visits).

v2 keeps v1's model — one read-only callable, the device cache painted before the request,
the visibility table, the agreement specs — and changes the source of past days, the drawing,
the entry point and the periods. Each past barber-day becomes one stored document, written
by the triggers that already run on every booking, so that every period up to a year reads
days instead of visits. Three chart components are added to the design system and the screen
is redrawn around seven questions. Pay and sealing get a design of their own.

## Traceability

| Owner's ask                                   | Decisions  | Success measure                                                                                                         |
| --------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1. Graphs, not rows; creative, understandable | D2, D3, D4 | Every figure that varies over time or across parts is a chart; a tester names the busiest hour and the best day unaided |
| 2. Day, week, month, year                     | D1, D9     | YEAR for a barber under 1.5 s p95 and for the shop under 4 s p95; DAY under 1 s                                         |
| 3. v1.2 and v2 stages                         | D1, D6, D7 | Year view, same period last year, custom range, goals, CSV ship; pay has its own design                                 |
| 4. A tap from the schedule                    | D5         | Tap → first frame from cache with no frame over 16.7 ms at 4× throttle; Back restores `?day&view&barber`                |
| 5. Exportable                                 | D7         | A CSV of days and services shares from the phone; no client name leaves the device                                      |
| 6. The cost of «Към 11:40»                    | D1, D4     | A barber-month open costs ≤ 250 reads (from ~1,000); the stamp reads «Обновено преди N мин»                             |

## Goals and non-goals for v2

**Goals**

1. Past days are stored on event and never computed twice (D1).
2. Every open of any span reads at most ~2 documents per barber-day plus the live days (D1).
3. The screen answers seven questions with charts, each carrying one sentence (D4).
4. Analytics opens from the schedule's toolbar in one tap and returns to the same day (D5).
5. A barber sets a monthly takings range as a goal; the admin sets the shop's (D6).
6. The days and the services of any period export as CSV (D7).

**v1 non-goals, their fate**

| v1 non-goal                              | v2    | By                                                                                |
| ---------------------------------------- | ----- | --------------------------------------------------------------------------------- |
| Earnings and pay                         | Holds | D8: its own design after the reconciliation gate                                  |
| A security boundary on money             | Holds | day documents and goals are callable-only (deny-all rules), not a boundary change |
| Ranking barbers on a barber's screen     | Holds | D4: the radar is admin-only; a barber never sees another barber's figure          |
| One free-time number for `capacity`      | Holds |                                                                                   |
| Changing the roster permission           | Holds |                                                                                   |
| Storing the private reason for a block   | Holds |                                                                                   |
| Push, retail, campaigns, AI chat, client | Holds |                                                                                   |

**v1 Future Improvements, their fate**

| Item                                             | v2                                              |
| ------------------------------------------------ | ----------------------------------------------- |
| Shop reference for a barber (≥ 3 contribute)     | Deferred: a barber's radar needs it; after v2   |
| First-visit return as a fixed figure             | Deferred                                        |
| Overdue regulars by rhythm                       | Dropped from analytics (the client card's job)  |
| Weekday × hour demand grid                       | In v2 (D4)                                      |
| Monday in-app card, receptionist's card          | Deferred                                        |
| Per-day stored figures → year, last year, custom | In v2 (D1, D9)                                  |
| Goals                                            | In v2 (D6)                                      |
| Written findings                                 | Folded into each chart's sentence (D6)          |
| Pay rule and earnings; CSV; sealing              | CSV in v2 (D7); pay and sealing own design (D8) |

## Decisions

Ordered by dependency: storage, then drawing, then the screen, then entry, then the rest.

### D1 — Past days are stored on event; the two live days are read

**What is stored.** `analyticsDays/{barberId}__{localDate}` (the id is the existing
`BusyKey`), one flat `AnalyticsDay` slice (`components/analytics-day.data.ts`, prefix
`day`): the ten `ChairDay` parts as `MinuteCount` (on a past day `bookedAhead` and `open`
are 0 by construction), the outside-hours fields, `dayTakingsCents` + `currency` (euro cents
after `inEuroCents`, at the stored rate — a later rate change leaves past days as they were,
accepted), `dayTipsCents`, `dayServices: readonly { serviceId; workedSeatCount; takingsCents;
serviceMinutes }[]`, three flat origin counts, `dayWorkedSeatCount`, `dayNoShowCount`,
`dayRebookedBase`, `dayRebookedCount`, `dayLateCancellationCount`, `dayExcludedVisitCount`,
`dayHourWorked: readonly MinuteCount[]` (24 entries, worked minutes per hour, for the
heatmap), `barberId`, `localDate`, `dayDefinitionVersion`, `dayComputedAtUtcMs`. No client
name, no seat row. One document per barber-day across locations (v1's clock approximation,
the first stretch's location).

**Which days.** A barber-day `d` is _past_ when `d + 1 < ShopNow.localDate` at every
location where the barber has a stretch on `d` — two days back, so that the rebooking
window (a follow-up booked by the end of `d + 1`) has closed. Today and yesterday are read
live from visits (~15 documents each per barber) and added with the same systems. "Past" is
the word; "closed" stays the v1 departure kind.

**Who writes.** Never the callable: it keeps its read-only contract and no partial report
guarantee. Three writers, all through one pipeline `writeAnalyticsDay` that re-reads the
day's visits, roster and departures inside a transaction and refuses to overwrite a document
computed after its own source read (stamp ordering, Law 7 T2):

1. the existing appointment trigger (`rebuildBusyOnAppointmentChange` reads the day's visits
   already; `decodeRebuildBusyEvent` yields `before.busyKeys ∪ after.busyKeys`, i.e. every
   day touched, including a moved or re-staffed visit) — it writes the busy projection and,
   for each key whose day is past, the analytics day; a follow-up written or cancelled also
   rebuilds its source visit's day (`bookedFromAppointmentId` → one read → its keys);
2. the departure trigger (`scheduleExceptions`, one `localDate`) for a past day;
3. a nightly sweep at 04:30 `CRON_TIME_ZONE` (the next free slot; the cron-zone comment's
   count updated) over the last 7 days: writes the days that became past since the last run
   and any day whose `dayDefinitionVersion` is stale or whose document is missing — this is
   what makes a failed run self-heal.

Product rules that keep rebuilds bounded: the rostered minutes of a past day are the roster
as it stood when the day became past (a backdated roster, location-hours or settings edit
does not rewrite history); a late cancellation is judged by the seat's stored window, else
the policy at the time of the write. No rebuild fans out beyond the days an event names.

**Reading.** The callable reads day documents for the past days of the period and of the
comparison period, visits for today and yesterday, and keeps v1's live reads for the next 7
days (open hours) and the follow-ups of the live days only. A missing or version-stale day
is computed live from its visits (bounded, ≤ 60) and counted in `AnalyticsReported.
missingDays`; the sweep writes it that night. `ANALYTICS_DEFINITION_VERSION` becomes 2; a
formula change bumps it and the sweep rewrites the reach; nothing is backfilled by hand.

**Cost (10 barbers, 15 seats a day).** Barber-month: 1 user + ~29 days + ~30 live visits +
~29 comparison days + ~10 follow-ups + ~100 ahead ≈ **200** (from ~1,000). Shop-month ≈ 290

- 300 + 290 + 1,070 ≈ **2,000** (from 11,500). Barber-year ≈ 730 + ~150 ≈ **900**; shop-year
  ≈ 7,300 + ~1,400 ≈ **8,700** — today's shop-month cost, under the 4 s budget. Stepping between
  days: one document per barber per step, and each step's report is cached on the device.
  Writes: one small document per booking, inside a trigger that already runs, plus the sweep's
  ~10 a night. The live "next 7 days" read is now the largest share of a barber's open; it is
  the next lever and stays as v1 built it.

**Operations.** TTL by the repo's convention: a `RetentionAnchor.analyticsDays(localDate)`
variant, the eighth formula (anchor + 25 months, from `localDate`, never from the write time),
the eighth `fieldOverrides` `ttl: true` entry, the runbook's "7 of 7" → "8 of 8";
`fieldOverrides` with `indexes: []` on `dayServices` and `dayHourWorked`; composite
`(barberId ASC, localDate ASC)`; the shop reads one `localDate` range over the collection
(the tenant's), `limit` at 366 × barbers + 1 (`overBound` past it); `match
/analyticsDays/{dayId} { allow read, write: if false; }`; `REACH_MONTHS` 12 → 24 so "same
period last year" has its base. A functions flag `analytics.storedDays` makes the callable
ignore day documents (the kill switch). `BackfillJobName.AnalyticsDays` walks appointments
by `busyKeys` pages, re-runnable per `dayDefinitionVersion`; at greenfield volume it is the
seed's 109 visits. Log events: `AnalyticsDayWritten` (barberId, localDate, source, visitCount,
durationMs), a sweep summary, `missingDays` on `AnalyticsReported`; never money.

**The G5 case.** A month assembled from day documents plus the two live days equals the
same month computed from visits, over the September fixture (`@core/testing`, now = the
28th 09:00: 26 past days, 2 live, 2 future). A property: `AnalyticsDaySystem.fold(day)` then
`sum(days)` equals `report(visits)` for every generated day set.

**Fires the ADR's own trigger.** ADR D1 named this set as the upgrade path when "the year
view, same-period-last-year or custom ranges are built"; v2 builds them. D1 earns its trigger,
sweep and TTL from the year view, not from $2 a month — the cost drop is a consequence. The
ADR's "Nothing is written" and D7's storage rows, and the design's "Reads and cost" and
Alternative C's rejection reason, are superseded by the records of this work (D10).

**Counter-argument (the zoom-out lens).** Lazy write-on-read with invalidation by delete
needs no sweep and no backfill. Rejected: it makes the read callable a writer and leaves a
day with no event (a rostered day without a booking) to be computed on every open until
someone reads it; the sweep costs ten writes a night.

### D2 — Three chart components in `@creativo/ui/charts`, built as the screen needs them

A new library `libs/ui/charts` (`scope:shared, type:ui`), SVG drawn from Angular templates,
CSS-styled, inputs are plain display structs (`type:ui` cannot import ecs-core; the presenter
in `libs/features/staff/analytics` does every bucketing and normalisation):

- `ui-bar-chart` — vertical or horizontal, single, stacked or 100 % stacked, ranked;
  promoted from `lib-analytics-time-bar` and the page's share bars (zero new drawing on day
  one); a legend-as-table slot;
- `ui-line-chart` — one series plus a grey comparison series, dashed average rule,
  right-edge labels only, a tap readout that does not fight page scroll;
- `ui-heatmap` — a CSS grid of tinted cells with row and column labels.

Rings reuse `ui-gauge` (`circularCapacity`: `role="meter"`, a tint variable, built), not
`ui-progress-ring` (a label ring for progress, no meter role). The radar (`ui-radar`) is
built in the PR that ships the admin radar; the calendar heatmap and sparkline are cut (D4).
Geometry is a display module in the library (`linearScale`, `niceTicks`, `linePath`,
`stackOffsets`, later `polygon`), specified by its own tests. Each chart is `role="img"`
with the presenter's one-sentence label; a hidden table only where a figure is not printed
beside the chart. One showcase page for the three; Playwright screenshots in both themes
are an owner-machine gate, not CI. Motion: CSS transitions on `@property` values, cross-fade
instead of path morph, off under reduced motion. Bundle: ~25–40 kB raw against the route's
81 kB headroom; a dated ceiling raise only if measured over.

Survey rubric with the missing row (engineering days to the first shipped screen, 20 %):
hand-built and Chart.js draw level; the hand-built set wins on the rows that are CSS here
(theme, reduced motion, the `ui-*` contract) and on screen readers, and loses two weeks.
Cutting to three components takes most of those weeks back.

**Counter-argument.** Chart.js 4 in `@defer` reaches the same screen in a week and costs
the ceiling nothing. Rejected for the reasons above, with the admission that a canvas would
have looked the same to the owner on day one.

### D3 — Colour that explains, from tokens that exist

Zero new hues. Chart marks (`fill`/`stroke`, never `color`, so `accent-rule` §5 stays
green) use:

- the accent for the one series that matters: worked time, this period, the selected bar;
- `--sys-color-destructive` for no-show minutes and `--sys-color-warning` for unmarked
  minutes — they are states, printed with their legend word, never colour alone;
- an ordered ramp of the foreground (`color-mix` at 50 / 32 / 18 % with a 1 px separator
  edge; the 32 % floor for any bar that must be read against the surface) for blocked,
  unsold and other, in that order, and for "previous / average / context";
- `--sys-identity-0..4` for per-barber series (the barber's chair colour in the schedule;
  "whose chair, never what state");
- a one-hue ramp of the accent for intensity (the heatmap);
- `--sys-color-success` / `--sys-color-destructive` only for change, with an arrow; the
  chip's words stay ink (`--sys-color-destructive-label` is the ink cut; no success-label
  token exists, so the glyph carries the colour).

Booking origins use accent (online), 50 % grey (from the shop), 18 % grey (unknown): no two
adjacent charts share a meaning for one hue, because the bar-part set and the origin set
never sit side by side. The set (accent, destructive, warning, 50 %, 32 %, 18 %; light and
dark) is validated once with the dataviz validator script and pinned by
`libs/ui/tokens/src/lib/chart-palette.spec.ts` on the existing `contrast.ts`; the chart
stylesheets join the tokens test target's inputs.

**Why not six categorical hues.** The only categorical sets on the screen are per-barber
(identity tones exist) and origin (three values). The bar parts are states with an order;
the research itself says ordered data takes a ramp. The owner's complaint — one grey for
everything — is answered by meaning (orange earned, red lost, amber needs a mark, grey
nothing happened) and by the charts, not by more hues. **Counter-argument:** a part palette
is what Revolut's category ring does. If the redrawn screen still reads flat to the owner,
D3-1's gate (twelve pinned values, the validator) opens a categorical set in a later PR.

### D4 — Seven questions, seven charts

| Question                        | Scope                    | Spans           | Element                       | Form                                                                                                                                                                            | Colour                                    | Opens to                          |
| ------------------------------- | ------------------------ | --------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------- |
| How much, and vs the comparison | all                      | D W M Y C       | `ui-metric` + `ui-line-chart` | hero figure; a line of days (W, M, C ≤ 93 days), weeks (C > 93) or months (Y); the comparison period as a grey line; a dashed average rule; D shows the hero and the delta only | accent + grey; change success/destructive | seat rows (v1 drill-down)         |
| Where the time went             | all                      | D W M Y C       | `ui-bar-chart` stacked        | D: one tall segmented bar (the v1 time bar, promoted); W/M/C: a bar per day; Y: a bar per month; the legend is the breakdown table beneath                                      | accent, destructive, warning, three greys | day rows (v1 drill-down)          |
| When the chair is busy          | all                      | W M Y C         | `ui-heatmap`                  | weekday × hour of worked minutes; one sentence names the busiest and the emptiest hour (`AnalyticsHourSystem.peak`, ties → earliest)                                            | accent ramp                               | —                                 |
| Free time ahead                 | all                      | always (next 7) | `ui-metric` + `ui-bar-chart`  | hero of open minutes; seven bars; the emptiest in accent, the rest grey                                                                                                         | grey, one accent                          | the schedule, `?free=1` (v1 link) |
| Which services sell             | all                      | D W M Y C       | `ui-bar-chart` ranked         | horizontal bars, largest first, € and count on the row; € per hour of service stays on the row                                                                                  | accent                                    | seat rows by service              |
| Do clients come back            | all                      | W M Y C         | three `ui-metric` tiles       | rebooked %, no-show %, late cancellations; delta vs the comparison; a verdict word; «изчаква» under the G6 base of 20                                                           | ink; change success/destructive           | the rows behind each              |
| Where bookings come from        | admin-shop               | W M Y C         | thin segmented bar            | three rows with swatches                                                                                                                                                        | accent, 50 %, 18 %                        | —                                 |
| How each barber does (PR 5)     | admin-barber, admin-shop | M Y C           | `ui-radar`                    | five axes per barber, values computed server-side (D9); the comparison period as a grey outline; a subtitle naming the base in words                                            | accent fill, grey outline, identity tone  | the barber's scope                |

Cut from the hypothesis, with the reason: compare two barbers (the scope picker does it);
fill by weekday as a 100 % stack (the heatmap's column totals and v1's weekday share bars);
the calendar heatmap and "the year" section (row 1 draws months; which day of the year sold
most is decoration); sparklines in the client tiles (twelve periods under the base are
mostly `null`; a delta and a verdict answer the question).

The radar is admin-only in v2 (the v1 non-goal holds). Its base is the best among the shop's
barbers whose figure meets its sample floor; a figure under the floor is drawn as a missing
axis with a word, never 0; every value is a system decision (`AnalyticsRadarSystem`) so the
maximum never reaches a barber's device. A barber's own radar against the other barbers'
average is the deferred v1.1 reference.

Freshness: «Обновено преди 2 мин» (presenter formatting of `reportComputedAtUtcMs` with
`now` as an input — Law 7 T2 "staleness budgets", display only; ADR D6's refusal of a reuse
window is untouched) with an ⓘ: «Цифрите се изчисляват при отваряне от записаните дни».

Period control: segments «Ден · Седмица · Месец · Година», a «‹ period ›» stepper with the
forward arrow disabled at today, and a «…» pill for a custom range that becomes a «По избор
· Изчисти» chip; a «Сравни с: предходния период ⌄ / същия период миналата година» chip.

### D5 — A toolbar button, the router's transition, the route

A chart icon button in the schedule's top trailing cluster, between the view menu and the
scope avatar (that cluster shows at every width; search sits there only from 600 px and in
the bottom bar on a phone). It navigates to `/staff/analytics?span=DAY&from=<the schedule's
day>&barber=<id>` where `barber` is the schedule's selected barber when the caller is admin,
else the caller's own `linkedBarberId`; when the schedule shows every chair, an admin opens
the shop scope and a barber their own. Nothing wraps the navigation in
`startViewTransition`: the router's `withViewTransitions` already runs one, and the platform
allows one at a time (the search morph works because it is an in-page state change). The
toolbar button and the analytics headline share a `view-transition-name` only if the morph
is shown to look right on a phone; otherwise the house cross-fade. The analytics chunk is
prefetched on idle so the old snapshot never freezes on a cold load. Back restores the
schedule from its own query (`?day&view&barber`); an e2e proves the deferred URL write of
`staff-day.store.ts` cannot fire mid-navigation and that the `?free=1` round trip still
clears the parameter.

Measured in PR 1 on the 4× throttle production build: forward (tap → first frame) and back
(tap → schedule interactive, reads issued). If Back's re-mount shows, a detach/attach
`RouteReuseStrategy` for the schedule route only, which also keeps scroll.

**Counter-argument.** The research's own pattern 11 (a modal page launched from the
toolbar, like search) closes to the exact place and never re-mounts. Rejected for deep links
and the period in the URL, the back stack, and analytics' own stacked sheets (drill-downs,
info, export); the performance claim against the sheet is not asserted — it is measured.

### D6 — Goals; findings fold into the charts

A goal is a takings range for a month (never one imposed number), stored as
`analyticsGoals/{barberId}__{YYYY-MM}` for a barber and `analyticsGoals/shop__{YYYY-MM}` for
the shop (callable-only, deny-all rules; a `MonthKey` brand, which `CapacityMonthId` becomes
or joins), set through one `setAnalyticsGoal` callable (a barber for themselves, an admin
for the shop) with an audit row, returned with the report (+1 read). Drawn as a `ui-gauge`
ring of the month's pace with the sentence «n от m работни дни · на път / под темпото». Goals
never sit on the user record (readable by colleagues through `worksTheBook`, bound to the
account, per-admin for the shop).

Written findings as a separate system are cut: each chart carries one sentence worded by
`analytics.presenter.ts` from values the report already holds (the delta chip, the heatmap's
hour, the line's peak, the goal pace). Law 10 holds: the system returns tags and figures,
the presenter words them.

### D7 — Export is CSV

A CSV of day rows and service rows for the open period (no client name, no seat), through a
`Blob`, `navigator.share` with `canShare({ files })` detection and an `<a download>`
fallback; the admin may export seat-level rows without names (appointmentId, date, service,
net, tip). An `AnalyticsExported` log event (uid, scope, period, row count; no money). Print
to PDF and a share card are deferred until asked for after CSV ships.

### D8 — Pay and sealing: their own design

Cut from v2 to one sentence: `docs/designs/staff-pay.md`, its own review, after the
reconciliation gate (a month of real takings within 2 % of the till — a calendar event, not
code). Decided now so that nothing in v2 blocks it: the pay record lives at
`barbers/{id}/restricted/pay` as a second named match (deny-all, callable-only, like the
link; the entity comment and `role.rules-parity.spec.ts` updated), earnings reach a barber
only through `staffAnalytics`, and a seal is its own snapshot document
(`analyticsSeals/{barberId}__{YYYY-MM}` holding the sealed figures, the rule applied,
`definitionVersion`, `sealedAtUtcMs`, `sealedByUserId`, no TTL) while day documents stay a
rebuildable cache — the screen shows the sealed figure and says when the live one differs.
The v1 non-goal "Earnings and pay" holds through v2.

### D9 — The callable v2 contract and catalogue version 2

`AnalyticsSpan.Day | Week | Month | Year | Custom`; `AnalyticsCall` gains `toLocalDate:
LocalDate | null` (CUSTOM only) and `analyticsComparison: 'PREVIOUS' | 'SAME_LAST_YEAR'`,
both decoded in `analytics.wire.ts`. `AnalyticsPeriod.of`: DAY any day in reach; YEAR
January 1; CUSTOM `from ≤ to`, ≤ 366 days; reach 24 months. `previous()`: for DAY the
same weekday a week earlier; for CUSTOM the same length ending the day before; SAME_LAST_YEAR
the same dates. The URL mirrors the call: `?span&from&to&barber`, read by a
`bindRouteInputs`-style reader and written back by the store as the schedule does for
`?day`; a barber's `?barber=` is ignored; the device-cache key encodes span, from, to and
comparison. `ANALYTICS_DEFINITION_VERSION = 2`; every new `report*` field in `decodeReport`.
New catalogue rows, each with formula, includes, excludes, base gate: hour buckets (worked
minutes per weekday × hour), busiest / emptiest hour, the radar's five axes — € per hour of
service (v1's `takingsPerHourCents`), fill (worked ÷ rostered), rebooking rate (v1),
reliability (100 − no-show rate, absolute, never normalised), tips rate (tips ÷ takings, base
20 seats) — normalised 0–100 against the best among barbers meeting the floor, `null` when
under the floor or when the best is 0. Wire skew: an old functions deploy refuses a new span
with `ANALYTICS_INVALID_INPUT`, so functions deploy before web.

### D10 — Records

A new ADR `docs/architecture/decisions/2026-11-09-staff-analytics-v2.md` (Date, Predecessor,
Supersedes: ADR D1's "Nothing is written", ADR D7's storage and sealing rows); a status banner
in the 2026-11-08 ADR naming it. A new design `docs/designs/staff-analytics-v2.md` with v1
as Predecessor; a banner in v1 marking "Reads and cost", Alternative C's reason, the
Non-Goals' pay line and Future Improvements as superseded. i18n, the e2e and
`production-deploy.md` (the eighth TTL group, the composite, the sweep, the triggers, the
deploy order) in the records PR.

## Risks and mitigations

| Risk                                                       | Mitigation                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A day document out of step with its visits                 | stamp ordering in the writer; the sweep's version/missing repair; `missingDays` logged; the G5 case |
| A `definitionVersion` bump against 25 months of documents  | stale = missing (live), the sweep rewrites the reach; never a hand backfill                         |
| The view transition stutters on a phone                    | measured in PR 1; the house cross-fade is the fallback                                              |
| The kit costs more weeks than the screen                   | three components, built as the screen needs them; Chart.js remains the recorded fallback            |
| The screen still reads flat with zero new hues             | D3's gate opens a validated categorical set in a later PR                                           |
| Client names in an export                                  | CSV carries days and services only; seat rows admin-only, nameless; `AnalyticsExported` logged      |
| Yesterday and today disagree with a document after an edit | both are live by rule; day documents start two days back                                            |

## Alternatives weighed

- Increment counters on each booking — banned (a lost or duplicate trigger leaves a figure with no source).
- Store today too, with clock-free hour buckets split by "now" at read — workable, rejected: the split approximates seats to hours and `barberBusy` already holds today's intervals; two live days cost ~30 reads.
- Lazy write-on-read by the callable — rejected (D1).
- Chart.js 4 in `@defer` — rejected (D2), recorded as the fallback.
- ECharts — covers every form at 7–8× the route's headroom; ApexCharts 8 — no longer MIT.
- Six categorical hues — deferred behind a gate (D3).
- A full-screen sheet from the schedule, like search — rejected (D5).
- Goals on the user record — rejected (D6).
- Print-to-PDF and a share card — deferred (D7).
- Pay and sealing inside v2 — rejected (D8).
- A separate drill-down callable — still rejected (v1 Alternative M); rows read live on tap.

## Staging

| PR  | Deliverables                                                                                                                                            | Depends on | Gate                                                     | Deploy                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------- | ------------------------------- |
| 1   | Schedule toolbar button, URL state (`?span&from&barber` for WEEK/MONTH), freshness wording, chunk prefetch, the two measurements                        | —          | e2e: entry, Back restores, `?free=1` round trip          | web                             |
| 2   | `@creativo/ui/charts` (bar, line, heatmap), the palette spec, one showcase page; the redrawn WEEK/MONTH screen on live data; hour buckets computed live | 1          | component specs, presenter specs, axe, the v1 e2e kept   | functions → web                 |
| 3   | DAY span (live visits), the comparison chip (PREVIOUS)                                                                                                  | 2          | pipeline + wire specs                                    | functions → web                 |
| 4a  | `AnalyticsDay`, the writer pipeline, the trigger and sweep exports, TTL formula, rules, indexes, flag, backfill job, logs — dark (flag off)             | 3          | G5 day case, trigger wire spec, rules integration, P2/P3 | indexes+TTL → rules → functions |
| 4b  | The read path: day documents + two live days, YEAR, CUSTOM, SAME_LAST_YEAR, reach 24, version 2                                                         | 4a         | the G5 property, agreement e2e, budgets                  | functions → web                 |
| 5   | The admin radar: `AnalyticsRadarSystem`, `ui-radar`, its showcase page                                                                                  | 4b         | purity + boundary specs (zero best, under floor)         | functions → web                 |
| 6   | Goals: `analyticsGoals`, `setAnalyticsGoal`, the ring                                                                                                   | 4b         | rules integration, audit row spec                        | rules → functions → web         |
| 7   | CSV export, `AnalyticsExported`                                                                                                                         | 2          | e2e share/download                                       | web                             |
| 8   | Records: the v2 ADR, the v2 design, banners, i18n, `production-deploy.md`                                                                               | all        | runbook gates                                            | —                               |

Pay and sealing: `docs/designs/staff-pay.md`, after the reconciliation gate.

## Open questions, with the hypothesised answer

1. (D3) If the owner wants hue-per-part after seeing PR 2: the categorical set is chosen
   outside the accent's warm sector (h 25–95, the identity block's exclusion), validated, and
   pinned — a later PR, not a redesign.
2. (D1) Whether `dayHourWorked` stores worked or occupied minutes — worked (what the heatmap
   asks: when the chair earns).
3. (D5) Whether the schedule's `RouteReuseStrategy` is worth its complexity — decided by PR
   1's Back measurement.
4. (D9) The CUSTOM cap of 366 days: 366 × barbers reads for the shop (~3,700) — fine.
