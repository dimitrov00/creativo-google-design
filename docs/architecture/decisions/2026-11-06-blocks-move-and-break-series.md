# Blocked time moves like a visit; a break series — ruling (2026-11-06)

> **Status: RULED and BUILT (2026-11-06), all four rulings.** Ruling 4 adds
> the `blockSeries` collection, its rules, the `(barberId, startLocalDate
desc)` index and the `topUpBlockSeriesDaily` schedule: deploy the rules,
> the indexes and the functions together.
> The owner: "should breaks be event blocks or shift related? … a block and a
> break are the same, no? … build it, and revisit the recurrence — a lunch
> break is a recurring blocker." Rubric of `2026-10-26-owner-rulings.md`:
> **C** correctness · **T** one source of truth · **U** UX · **M** simplicity
> · **R** reversibility.

## References (Mobbin, iOS)

- **Tiimo** — editing a repeating item asks «Update this only · Update all
  future · Update all».
- **Notion** (cadence) — «Every 1 week», weekday discs, «Starting», «Ending:
  Never», and a «Next occurrence» line.
- **Neo Financial**, **Venmo** — the rule said back in one sentence above
  the apply («Repeats every 2 weeks on Sunday», «… and ends Jun 30»).
- **Monzo** — «Stops repeating: Never · On a date».
- **Discord**, **Joi**, **Google Calendar** — presets first («Weekly on
  Tuesday», «Every weekday (Monday to Friday)»), «Custom…» last.

## Ruling

1. **A break IS blocked time** (T). The domain already says so: a break is
   a schedule exception's range with reason «Почивка» and a paid flag. The
   roster's split shift (two segments, a gap between) stays for the shop's
   own closed hours — it changes every week at once, so a day never drags
   it. A barber's lunch belongs in blocked time, where it moves.
2. **Blocked time moves like a visit on the grid** (U, R). A hold lifts a
   block not yet past (`movableIdsOf`); a drag moves it, a handle resizes
   it, and the release SAVES — the block sheet's own edit, lift the old
   range and write the new in one write (`moveScheduleBlock` via
   `saveBlocks`) — with «Промените са запазени · Отмени», the same move
   reversed (`blockDropOf`). It may cover a visit (the grid hatches it, as
   the block sheet does), never the chair's other blocked time that day:
   the two would MERGE into one range and the way back could not part them
   — it goes back down with «Блокираното време не може да застъпва друго
   блокирано време.»
3. **Today a dragged series day moves alone** (C). A series is written day
   by day and no series is stored (§9 D16(b)), so nothing knows which days
   belong together: a drag edits the one day it is on.
4. **The series is stored, and an edit asks how far it reaches** (U, C):
   - A staff-only `blockSeries/{seriesId}` document: the chair, the shop,
     the rule, the range's minutes, the reason and the paid flag, and the
     days it has written. The public exception document is unchanged (the
     effect stays sanitised, D16(b)); a day's range belongs to a series
     while its day is listed there and its minutes are the series'. A day
     moved alone leaves the series (Google's "this event" exception).
   - A tap or a drag on a series day asks, as Apple Calendar does, «Само
     този ден · Този и следващите» — never «Всички»: past days are the
     record, and rewriting them changes nothing a barber can use. «Този и
     следващите» splits the series at that day (the old one ends the day
     before, a new one carries the new minutes).
   - «Без край» joins the end (Monzo's «Never»): the series writes a
     rolling horizon (26 weeks) and a daily scheduled job writes ahead, so
     the booking grid, the capacity trigger and the commit re-check keep
     reading days, as they do now.
   - The «Повтаряне» page leads with presets — «Всеки делничен ден
     (пон–пет)», «Всяка седмица в {ден}», «Всеки ден», «По избор…» — and
     the custom page is Notion's: interval, weekday discs, start, end
     («Без край · На дата · След N пъти»), with the rule said back in one
     line above the dock («Повтаря се всеки делничен ден, без край»).

## As built

- `BlockSeries` (`block-series.entity.ts`), `RecurrenceEnd.NEVER`, the
  scope dictionary (`BlockSeriesScope`) and `BlockSeriesSystem` (`memberOf`,
  `create`, `edit`, `topUp`, `stands`); `RecurrenceSystem.occurrencesFrom`
  keeps a series' rhythm when it is written ahead.
- `createBlockSeries`, `editBlockSeries` (refuses a series another device
  changed, `SCHEDULING_BLOCK_SERIES_MOVED`) and `topUpBlockSeries` over
  `writeBlockSeries`, ONE transaction for the days and the series.
- The desk: `BlockSeriesFlow` asks «Само този ден · Този и следващите ·
  Отказ» from the block sheet's «Запази» and «Премахни» and from a drag on
  the grid; a new repeating block is saved as a series per chair. The
  repeat page's end menu leads with «Без край», which says «от пн, 9.11 ·
  без край» instead of a count.
- Found while testing: a chair whose weekly hours already split at lunch
  (Иван 9–13, 14–18) shows no 13:00 block — the gap is closed time. That is
  ruling 1's line between the two kinds of break, seen live.
