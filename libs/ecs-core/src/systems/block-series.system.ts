import {
  BlockSeriesScope,
  type MinuteRange,
  RecurrenceEnd,
  RecurrenceEndRule,
  RecurrenceRule,
} from '@core/components';
import type { BlockSeries, BlockSeriesMeta } from '@core/entities';
import type { SchedulingError } from '@core/errors';
import {
  type BarberId,
  type BlockSeriesId,
  LocalDate,
  type LocationId,
  Result,
} from '@core/primitives';
import { RecurrenceSystem } from './recurrence.system';

/**
 * What an edit of a repeating block writes: the days whose series range is
 * LIFTED, the range then written on each of them (`null` — lifted only, a
 * removal), the series documents as they stand after (`series`) and the ones
 * deleted (`dropped`). One answer, so the pipeline lands it in one
 * transaction.
 */
export type BlockSeriesEdit = {
  readonly days: readonly LocalDate[];
  readonly range: MinuteRange | null;
  readonly series: readonly BlockSeries[];
  readonly dropped: readonly BlockSeriesId[];
};

/** The days a series that never ends writes next, and the series that lists them. */
export type BlockSeriesTopUp = {
  readonly days: readonly LocalDate[];
  readonly series: BlockSeries;
};

/** The series' identity with a rule laid on it — every end field the rule's own. */
function withRule(meta: BlockSeriesMeta, rule: RecurrenceRule): BlockSeries {
  return {
    ...meta,
    ...RecurrenceRule.patternOf(rule),
    recurrenceInterval: rule.recurrenceInterval,
    ...RecurrenceEndRule.sliceOf(rule),
  };
}

/** The identity slice of a series, as a fresh struct. */
function metaOf(series: BlockSeries): BlockSeriesMeta {
  return {
    id: series.id,
    barberId: series.barberId,
    locationId: series.locationId,
    startMinutes: series.startMinutes,
    endMinutes: series.endMinutes,
    startLocalDate: series.startLocalDate,
    localDates: series.localDates,
  };
}

/** A series that ended on `last`: the same days, the end said as that day. */
function endingOn(series: BlockSeries, last: LocalDate): RecurrenceRule {
  return {
    ...RecurrenceRule.patternOf(series),
    recurrenceInterval: series.recurrenceInterval,
    ...RecurrenceEndRule.until(last),
  };
}

/**
 * A CHAIR'S REPEATING BLOCK — a lunch break every weekday, an admin hour
 * every Monday (owner, 2026-11-06: "a lunch break is a recurring blocker").
 * The series is the staff's memory of which written days belong together;
 * each day's public effect stays a blocked range of its own exception
 * document. Pure: the ids come from `nextId`, today from the caller.
 */
export const BlockSeriesSystem = {
  /**
   * The series a day's blocked range belongs to: its chair's, listing the
   * day, over exactly its minutes — or `null`, a block of its own. A day the
   * desk moved alone left the list, so it answers `null` too.
   */
  memberOf(
    series: readonly BlockSeries[],
    barberId: BarberId,
    localDate: LocalDate,
    range: MinuteRange,
  ): BlockSeries | null {
    for (let i = 0; i < series.length; i++) {
      const candidate = series[i] as BlockSeries;
      if (
        candidate.barberId === barberId &&
        candidate.startMinutes === range.startMinutes &&
        candidate.endMinutes === range.endMinutes &&
        candidate.localDates.includes(localDate)
      ) {
        return candidate;
      }
    }
    return null;
  },

  /**
   * The series as a screen read it still stands in `stored`: the same days,
   * the same minutes — else somebody moved, cut or lifted it meanwhile.
   */
  stands(stored: BlockSeries | null, read: BlockSeries): boolean {
    if (
      stored === null ||
      stored.startMinutes !== read.startMinutes ||
      stored.endMinutes !== read.endMinutes ||
      stored.localDates.length !== read.localDates.length
    ) {
      return false;
    }
    for (let i = 0; i < read.localDates.length; i++) {
      if (stored.localDates[i] !== read.localDates[i]) return false;
    }
    return true;
  },

  /**
   * A new series from the block sheet: the rule bound to its first day
   * (`RecurrenceSystem.series` — its refusals are the sheet's to say), the
   * days it writes now (a series that never ends: up to the horizon).
   */
  create(input: {
    readonly id: BlockSeriesId;
    readonly barberId: BarberId;
    readonly locationId: LocationId;
    readonly range: MinuteRange;
    readonly startLocalDate: LocalDate;
    readonly rule: RecurrenceRule;
  }): Result<BlockSeries, SchedulingError> {
    const bound = RecurrenceSystem.series(input.startLocalDate, input.rule);
    if (!bound.ok) return bound;
    return Result.ok(
      withRule(
        {
          id: input.id,
          barberId: input.barberId,
          locationId: input.locationId,
          startMinutes: input.range.startMinutes,
          endMinutes: input.range.endMinutes,
          startLocalDate: input.startLocalDate,
          localDates: bound.value.localDates,
        },
        input.rule,
      ),
    );
  },

  /**
   * An edit of one of the series' days, reaching as far as `scope` says —
   * a move or a resize (`range`), or a removal (`range` `null`).
   *
   * - «Само този ден» (`ThisDay`): the day's series range is lifted and the
   *   new one written on it alone; the day leaves the series, which goes
   *   when it has no day left.
   * - «Този и следващите» (`Following`): every listed day from that one on
   *   is lifted and rewritten; the series is CUT — the old one keeps the
   *   days before and ends on the last of them, and the new minutes start a
   *   series of their own from that day, on the same rule (one that never
   *   ended still never ends; any other ends on its last listed day). A cut
   *   at the series' first day leaves nothing of the old one.
   */
  edit(
    series: BlockSeries,
    fromLocalDate: LocalDate,
    scope: BlockSeriesScope,
    range: MinuteRange | null,
    nextId: () => BlockSeriesId,
  ): BlockSeriesEdit {
    if (scope === BlockSeriesScope.ThisDay) {
      const left = series.localDates.filter((day) => day !== fromLocalDate);
      return {
        days: [fromLocalDate],
        range,
        series: left.length > 0 ? [{ ...series, localDates: left }] : [],
        dropped: left.length > 0 ? [] : [series.id],
      };
    }
    const before: LocalDate[] = [];
    const after: LocalDate[] = [];
    for (let i = 0; i < series.localDates.length; i++) {
      const day = series.localDates[i] as LocalDate;
      if (day < fromLocalDate) before.push(day);
      else after.push(day);
    }
    const out: BlockSeries[] = [];
    const dropped: BlockSeriesId[] = [];
    const last = before[before.length - 1];
    if (last === undefined) {
      dropped.push(series.id);
    } else {
      out.push(
        withRule(
          { ...metaOf(series), localDates: before },
          endingOn(series, last),
        ),
      );
    }
    const tail = after[after.length - 1];
    if (range !== null && tail !== undefined) {
      const rule: RecurrenceRule =
        series.recurrenceEnd === RecurrenceEnd.Never
          ? {
              ...RecurrenceRule.patternOf(series),
              recurrenceInterval: series.recurrenceInterval,
              ...RecurrenceEndRule.never(),
            }
          : endingOn(series, tail);
      out.push(
        withRule(
          {
            id: nextId(),
            barberId: series.barberId,
            locationId: series.locationId,
            startMinutes: range.startMinutes,
            endMinutes: range.endMinutes,
            startLocalDate: fromLocalDate,
            localDates: after,
          },
          rule,
        ),
      );
    }
    return { days: after, range, series: out, dropped };
  },

  /**
   * A series that never ends, written ahead (the daily job): the days its
   * rule selects after the last one written, up to `today` +
   * `RecurrenceRule.WRITE_AHEAD_DAYS`, in the series' own rhythm
   * (`RecurrenceSystem.occurrencesFrom`); the list keeps the days from
   * today on, so the document never grows past the horizon. `null` when
   * there is nothing to write or forget — or the series ends.
   */
  topUp(series: BlockSeries, today: LocalDate): BlockSeriesTopUp | null {
    if (series.recurrenceEnd !== RecurrenceEnd.Never) return null;
    const written = series.localDates[series.localDates.length - 1];
    const next =
      written === undefined || written < today
        ? today
        : LocalDate.addDays(written, 1);
    const days = RecurrenceSystem.occurrencesFrom(
      series,
      series.startLocalDate,
      next,
      LocalDate.addDays(today, RecurrenceRule.WRITE_AHEAD_DAYS),
    );
    const kept = series.localDates.filter((day) => day >= today);
    if (days.length === 0 && kept.length === series.localDates.length) {
      return null;
    }
    return { days, series: { ...series, localDates: [...kept, ...days] } };
  },
} as const;
