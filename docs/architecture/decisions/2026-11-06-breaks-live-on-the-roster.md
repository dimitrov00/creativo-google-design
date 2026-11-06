# A weekly break lives on the roster, not in day documents — ruling (2026-11-06)

> **Status: RULED and BUILT (2026-11-06).** Replaces ruling 4 of
> `2026-11-06-blocks-move-and-break-series.md` (its stored series —
> `blockSeries`, the daily write-ahead, `RecurrenceEnd.NEVER` — is reverted);
> rulings 1–3 of that record stand. The owner: "what do you mean by stored
> 131 days … it has to be very DOD … no redundant write operations … is it
> the same in Fresha?", then "yes rebuild it … barbers decide to work harder
> for winter … no lunch breaks for some specific days … removed day by day
> … booking an event inside breaks should still be allowed from the staff
> side … changing the breaks should affect how easy it is to book and move
> events, and lets the users see those slots are available." Rubric of
> `2026-10-26-owner-rulings.md`: **C** correctness · **T** one source of
> truth · **U** UX · **M** simplicity · **R** reversibility · **$** reads,
> writes, invocations.

## What ruling 4 built, and what it costs

Ruling 4 stores a weekday lunch with «Без край» like this:

- It writes one `scheduleExceptions/{barber__day}` document for every
  weekday in the next 26 weeks (`RecurrenceRule.WRITE_AHEAD_DAYS = 182`),
  which comes to 131 documents.
- The `blockSeries` document lists all 131 days in `localDates`.
- The daily `topUpBlockSeriesDaily` job adds one more day to each series
  that has no end.

Each day document is a separate Firestore write, and each write fires two
triggers:

- `rebuildCapacityOnExceptionChange` rebuilds capacity for one barber and
  one day (`CapacityTrigger.Day`). Its transaction reads the active
  locations, the roster, the busy day, the exceptions and the month
  document, and then rewrites the month document.
- The audit trigger for `scheduleExceptions` writes one audit row per
  document (`GovernedCollection.ScheduleExceptions`).

| One weekday lunch, no end, one barber                        | Ruling 4 (built)                                                 | Break on the roster (built)                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Documents written when it is created                         | 131 days + 1 series                                              | **1** (`barberSchedules/{barberId}`)                                              |
| Trigger invocations                                          | 262 (131 capacity + 131 audit)                                   | **2** (1 roster capacity rebuild + 1 audit)                                       |
| Document reads and writes, triggers included                 | about 1,300                                                      | about 60. One horizon rebuild reads about 50 documents and writes about 3 months. |
| Transactions on the same capacity month document             | about 131 at once. They conflict and retry.                      | 1                                                                                 |
| Every day after that                                         | 1 write-ahead per series: about 10 operations per series per day | **0**                                                                             |
| Moving it "this day and the following"                       | rewrites up to 131 documents, plus 262 triggers                  | 1 roster write, as a new version from that day                                    |
| Moving it "only this day"                                    | 1 day document                                                   | 1 day document (unchanged)                                                        |
| Extra reads for every reader (grid, /book, commit, capacity) | `blockSeries` listener (up to 100 documents per barber)          | **0**. The roster is already read everywhere.                                     |
| Memory on the client                                         | 131 day strings per series, plus each day's document             | 4 integers per weekday break                                                      |

Ruling 4 also writes 26 weeks ahead, while bookings open only
`BookingPolicy.horizonMonths` ahead (2 months by default). That means about
four months of day documents that nobody can book against.

Law 3 already asks for this: "Lazy evaluation: compute availability windows
… on demand from intervals; never pre-generate or persist slot grids." Ruling
4 stores the days ahead of time. The roster is the lazy form of the same
fact: one weekly pattern, expanded when a day is read.

## How other apps do it

- **Fresha.** A lunch is a second shift on the same day of the
  [regular shift](https://www.fresha.com/help-center/knowledge-base/calendar/252-schedule-and-update-team-shifts),
  so the gap between the shifts is the break. The pattern repeats every 1–4
  weeks. Separately, Fresha has
  [repeating blocked time](https://www.fresha.com/help-center/knowledge-base/calendar/101628-create-and-manage-blocked-time-in-your-calendar)
  («Every day / week / month / custom»). Deleting one asks
  «only this · this and all future · all».
- **Timely.** A staff member's [regular breaks](https://help.gettimely.com/hc/en-gb/articles/360060713894)
  are set per weekday inside their normal working hours («+break», with a
  name, a start and an end). They are "automatically applied week to week"
  and shown on the calendar under their name. Clicking one on the calendar
  removes it from that day only.
- **Phorest** and **Salonist.** A break is part of the staff roster and has
  a paid flag
  ([Phorest](https://support.phorest.com/hc/en-us/articles/360016476479-How-do-I-add-a-break-to-the-Appointment-calendar)).
- **Mobbin.**
  - [Deputy](https://mobbin.com/screens/4e0c046f-0d60-4c98-a058-871e01bd7b90):
    the shift carries the break as a field («30 mins of Meal Break
    (unpaid)»).
  - [Remote](https://mobbin.com/screens/687db55b-8c66-4a10-a31c-9a6288f23e1e):
    a day's rows are typed «Regular hours · Break · Regular hours».
  - [7shifts](https://mobbin.com/screens/75dccce3-0628-4776-b1d6-a9f61ac00034):
    «Add break» on the shift.
  - [Calendly](https://mobbin.com/screens/ab293837-b671-4150-8919-1bb85f8db7d9)
    and [Turo](https://mobbin.com/screens/e8f28cb2-31a2-4565-9822-a81469aec389):
    a weekday holds several intervals («+»), and «Apply these hours to
    additional days» copies them.

In every one of these apps, a recurring break is part of the weekly pattern.
None of them shows any sign of writing a separate record for each future day.

## Ruling

1. **A weekly break is part of the roster** (T, $, M).
   - `ScheduleVersion` gains `breaks: readonly RosterBreak[]`, where
     `RosterBreak = { weekday, startMinutes, endMinutes }` (as built: no paid
     flag yet — nothing reads one).
   - The array is bounded (a few per weekday), lives beside `segments`, and
     is versioned with them by `effectiveFromLocalDate`.
   - A break over hours nobody works subtracts nothing and draws nothing (as
     built: clipped at read, not refused — a Mon–Fri lunch on a chair off on
     Wednesday is harmless).
   - `RosterSystem` subtracts breaks from working time wherever it builds
     the day today. Availability, capacity and the commit check get them
     with no extra read.
2. **The grid draws a roster break as a named block** («Обяд», «Почивка»),
   not as closed time. It can be dragged like any blocked time (ruling 2).
   A drag or a tap (which takes it off) asks «Само този ден · Този и
   следващите»:
   - «Само този ден» writes that day's document, as one change to that day:
     its break moves, or it has no break that day. The roster stays as it
     is. The open detail below covers how the day document says this.
   - «Този и следващите» amends the roster from that day
     (`ScheduleVersion.reviseFrom`): one write, and the history keeps past
     weeks as they were.
3. **«Без край» on the «Повтаряне» page IS a roster break.**
   - Offered only for a weekly pattern (every day, or weekdays every week —
     `RosterBreakSystem.standingWeekdays`): the sheet says «почивка в
     графика от {ден}» and saves one roster change per chair.
   - A repeating block that ends («На дата», «След брой пъти») is still
     written day by day, as before ruling 4 (capped at 366 days, as before;
     capping it at the booking horizon is left open).
4. **Remove ruling 4's machinery** (greenfield):
   - the `blockSeries` collection, its rules and index;
   - `topUpBlockSeriesDaily`;
   - `BlockSeriesSystem` and its pipelines and adapters;
   - `RecurrenceEnd.NEVER`;
   - `BlockSeriesFlow`'s series lookups. The scope question stays, now
     answered by the roster.
5. **A weekly hours editor with «＋ Почивка» per weekday** (Timely, 7shifts,
   Turo, Swarm) — BUILT (owner: "do this task here"). The ＋ menu's
   «Работно време» opens the scoped chair's week: one row per weekday (its
   shifts or «Почивен», its breaks under the name), «Бръснар» and «В сила
   от». A row pushes the weekday's page — «Работи», the shifts with
   «＋ Добави часове», the breaks with «＋ Почивка», «Същите часове и за»
   (weekday discs) — and «Запази» writes the whole week from «В сила от» on
   as ONE roster write (`setRosterWeek`). The seed's split shift (Иван 9–13,
   14–18) became 9–18 with a 13:00 lunch break, so the break shows as a
   named block.

## The day's own breaks

How a day records "this day's roster break moved or is gone": a root field
on the day's exception document, `dayBreakRanges: readonly MinuteRange[] |
null` (the `DayBreaks` slice):

- A list replaces the roster's breaks for that day, and an empty list means
  no break that day.
- `null` means the roster's breaks apply.
- A day that changes ONLY its breaks is the new effect `ROSTERED` (the
  roster's hours stand); a lift that leaves such a day nothing else keeps it
  `ROSTERED`, and handing the day back to the roster deletes it.
- It sits beside `exceptionEffect` and the day's blocked ranges, so a day can
  have both a moved lunch and a one-off block. It is the public effect, with
  no reason stored (D16(b)).

The alternative is an `HOURS` effect, whose ranges replace the roster for
that day. It was rejected: it cannot sit beside a `BLOCKED` range on the
same day, and the grid would lose the break's name.

## Costs and risks

- One more field on the roster version, and one optional field on the day
  document. Both are bounded, and neither is indexed. Rules and the seed
  change together.
- A roster amend rebuilds capacity across the barber's horizon in one pass.
  That already happens on every hours edit today, so it adds no new load.
- A break every second week is not covered by the roster yet: versions are
  weekly. Fresha handles it with a 1–4 week rotation. If a shop needs it,
  `RosterBreak` gains `everyWeeks` with an anchor date. That is not built
  until it is asked for.
- Not deployed yet, so nothing in production needs migrating.

## As built

- **Domain.** `RosterBreak` and `ScheduleVersion.breaks`
  (`ScheduleVersion.reviseFrom` revises every version from a day on);
  `DayBreaks` and `ExceptionEffect.ROSTERED` on `ScheduleException`;
  `RosterSystem` subtracts the day's breaks with the blocks
  (`buildDayWindows`, so `/book`, the commit re-check and capacity all see
  them at once) and draws them apart (`buildDayBreaks`, `offeredBreaks`,
  `rosterBreaksOn`); `RosterBreakSystem` (`revise`, `amend`, `wholeOf`,
  `dayWith`, `standingWeekdays`); `ScheduleExceptionSystem.withDayBreaks`.
- **Writes.** «Само този ден» — `writeDayBreaks` (one exception document,
  the client's existing door). «Този и следващите» and a new weekly break —
  the callable `amendRosterBreaks` (`amendRosterBreaks` pipeline, one roster
  write in one transaction; the roster still has no client writer). The
  capacity rebuild and the audit row ride the documents' own triggers.
- **Desk.** A lane carries `breaks` (drawn «Почивка», `break:<chair>:<day>:<start>`),
  `dayBreaks` and `breaksOwn`. A tap takes a break off and a drag moves it;
  both ask «Само този ден · Този и следващите · Отказ» (`BreakFlow`) unless
  the day already says its own breaks; «Отмени» reverses either. A visit
  dropped into a break opens its sheet, as into a block; a day without its
  break takes the drop at once. Staff may still book over a break
  (`allowOutsideWindow`), as before.
- **Creating one.** The block sheet's «Повтаряне» end menu leads with «Без
  край» when the rule is a weekly pattern (every day, or weekdays every
  week); the sheet says «почивка в графика от {день}» and saves ONE roster
  change per chair. Every other repeat is written day by day, as before.
- **Seed.** Иван's and Стефан's split shifts are one shift with a 13:00
  weekday lunch break.
- **Deploy.** Rules (`dayBreakRanges` key), the `dayBreakRanges` index
  override and the functions (the new callable) ship together; there is no
  scheduled job and no new collection.

### The hours editor (built)

- **Domain.** `RosterWeekSystem` (`weekOn`, `dayOf`, `withDay` keeping each
  shift's shop, `copyDay`, `validate` — shifts via `ShiftSegment.validate`
  with a 30-minute walk between shops, every break inside a shift of its
  weekday, `SCHEDULING_ROSTER_BREAK_OUTSIDE_SHIFT` — `setFrom`, `nextShift`,
  `nextBreak`, `endOf`); `ScheduleVersion.replaceFrom` (the week from a day
  on: the version in force closed the day before, later versions dropped,
  earlier weeks kept).
- **Write.** The callable `setRosterWeek` (`set-roster-week.pipeline.ts`,
  `decodeSetRosterWeek`): one transaction reads the roster and the shop for
  «today», refuses a past day, writes the roster whole; a chair with none
  starts one.
- **Sheet.** `lib-staff-hours-sheet` (`staff-hours-sheet/`), its words in
  `staff-hours.presenter.ts`; the draft lives in the sheet until «Запази».
  The store streams the chair's roster (`rosterOf`) and saves through one
  roster-callable writer it shares with `amendBreaks`.
