import {
  type BarberId,
  ExceptionEffect,
  type LocalDate,
  type LocationId,
  Result,
} from '@core/primitives';
import { SchedulingError } from '@core/errors';
import {
  ExceptionEffectRule,
  type ExceptionDetail,
  ExceptionReason,
  MinuteRange,
} from '@core/components';
import type { ScheduleException, ScheduleExceptionMeta } from '@core/entities';

/** A stored changed day's identity slice alone — its effect left behind for the next one. */
function metaOfStored(stored: ScheduleException): ScheduleExceptionMeta {
  return {
    id: stored.id,
    barberId: stored.barberId,
    localDate: stored.localDate,
    utcEpochMs: stored.utcEpochMs,
    locationId: stored.locationId,
  };
}

/** The block sheet's save, as {@link ScheduleExceptionSystem.blockSavePlan} reads it. */
export type BlockSaveInput = {
  /** Whether the sheet opened on a stored block, rather than a new one. */
  readonly editing: boolean;
  /** The sheet as it opened: whether it was all day, and its chairs. */
  readonly opened: {
    readonly allDay: boolean;
    readonly barberIds: readonly BarberId[];
  };
  /** The range the sheet opened on, parsed at the edge; `null` when it is no range of one day. */
  readonly openedRange: MinuteRange | null;
  /** The day shown behind the sheet: the day an edited range is lifted from. */
  readonly shownDay: LocalDate;
  /** What the sheet now says. */
  readonly saved: {
    readonly allDay: boolean;
    readonly barberIds: readonly BarberId[];
    readonly days: readonly LocalDate[];
  };
  /** The range it now says, parsed at the edge; `null` when it is no range of one day. */
  readonly savedRange: MinuteRange | null;
  /** A chair's home shop; `null` when it has none. */
  readonly homeOf: (barberId: BarberId) => LocationId | null;
};

/** A range to lift before anything is written. */
export type BlockLift = {
  readonly barberId: BarberId;
  readonly range: MinuteRange;
  readonly localDate: LocalDate;
};

/** One chair's write. No `ranges` means the whole day. */
export type BlockWrite = {
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  readonly ranges: readonly MinuteRange[];
  /** The one day this write names; `null` when it is a series over `days`. */
  readonly localDate: LocalDate | null;
  readonly days: readonly LocalDate[];
};

/**
 * What a block sheet's save costs: the writes and, for an edited range, the
 * lift they replace it with. One answer, so the store can land both in one
 * write. `writes` is `null` when nothing may be written: the saved range
 * cannot be read, or a saved chair has no home (`chairWithoutHome`), and then
 * nothing is lifted either.
 */
export type BlockSavePlan = {
  readonly lift: BlockLift | null;
  readonly writes: readonly BlockWrite[] | null;
  /** The first saved chair with no home shop: the save is refused whole. */
  readonly chairWithoutHome: BarberId | null;
};

/**
 * A staff editor's exception, sanitised to what the public may know, and the
 * merge arithmetic of the exception writer
 * (`schedule-exception-document.ts:78-91`, `:197-218`,
 * `schedule-exception-writer.adapter.ts:26-49`). Wall-clock minute ranges of
 * one shop day throughout — no instant, no zone.
 */
export const ScheduleExceptionSystem = {
  /**
   * Does the sheet's lift take the WHOLE day: an all-day block, or a chair off
   * all day. The store refuses a range lift on a closed day, so a closed day's
   * only lift is the whole one.
   */
  liftsWholeDay(allDayBlock: boolean, chairOff: boolean): boolean {
    return allDayBlock || chairOff;
  },

  /**
   * THE BLOCK SHEET'S WRITE PLAN. An edited range is lifted where it was, its
   * first chair on the shown day, and written where it now is; an edited
   * all-day block lifts nothing here, and neither does a range or a chair that
   * cannot be read, or a save that names no day. Each saved chair writes once,
   * in order, on its home shop. A chair with no home refuses the whole save
   * rather than be skipped. A saved range that cannot be read writes and lifts
   * nothing. One day is a single write and any other count a series. An
   * all-day save writes no `ranges`.
   */
  blockSavePlan(input: BlockSaveInput): BlockSavePlan {
    const { editing, opened, openedRange, saved, savedRange } = input;
    if (!saved.allDay && savedRange === null) {
      return { lift: null, writes: null, chairWithoutHome: null };
    }
    const ranges: readonly MinuteRange[] =
      saved.allDay || savedRange === null ? [] : [savedRange];
    const days = saved.days;
    const localDate = days.length === 1 ? (days[0] as LocalDate) : null;
    const writes: BlockWrite[] = [];
    for (let i = 0; i < saved.barberIds.length; i++) {
      const barberId = saved.barberIds[i] as BarberId;
      const locationId = input.homeOf(barberId);
      if (locationId === null) {
        return { lift: null, writes: null, chairWithoutHome: barberId };
      }
      writes.push({ barberId, locationId, ranges, localDate, days });
    }
    const from = opened.barberIds[0];
    const lift: BlockLift | null =
      editing &&
      !opened.allDay &&
      openedRange !== null &&
      from !== undefined &&
      writes.length > 0 &&
      days.length > 0
        ? { barberId: from, range: openedRange, localDate: input.shownDay }
        : null;
    return { lift, writes, chairWithoutHome: null };
  },

  /**
   * **The GDPR boundary.** The reasoned detail → the PUBLIC effect: `CLOSED`,
   * `TIME_OFF`, `SICK`, `TRAINING` and `TRAVEL` all collapse to the SAME
   * `CLOSED` effect, so the public document cannot tell an ill barber from
   * one on holiday — not by field, not by absence of a field, not by
   * inference; `BREAK` and `ADMIN` collapse to `BLOCKED`; `HOURS` stays
   * `HOURS`. Written as an exhaustive switch so a new reason cannot reach
   * storage without someone deciding how it is sanitised. Ranges come back
   * normalized; a range-bearing detail with none is refused
   * (`SCHEDULING_SCHEDULE_EXCEPTION_EMPTY_RANGES`).
   */
  publicEffect(
    detail: ExceptionDetail,
  ): Result<ExceptionEffectRule, SchedulingError> {
    switch (detail.exceptionReason) {
      case ExceptionReason.Closed:
      case ExceptionReason.TimeOff:
      case ExceptionReason.Sick:
      case ExceptionReason.Training:
      case ExceptionReason.Travel:
        return Result.ok(ExceptionEffectRule.closed());
      case ExceptionReason.Hours:
        return ExceptionEffectRule.hours(detail.exceptionRanges);
      case ExceptionReason.Break:
      case ExceptionReason.Admin:
        return ExceptionEffectRule.blocked(detail.exceptionRanges);
    }
  },

  /**
   * The union of a day's blocks (`coalesceRanges`): sorted, overlapping AND
   * touching spans merged, empties dropped. Inputs are read, never written.
   */
  merge(
    existing: readonly MinuteRange[],
    add: readonly MinuteRange[],
  ): readonly MinuteRange[] {
    return MinuteRange.normalize([...existing, ...add]);
  },

  /**
   * What a day holds once `add` is blocked out of it
   * (`schedule-exception-writer.adapter.ts:26-49`): the union with whatever
   * ranges the stored effect has, as a `BLOCKED` effect — or `null` when a
   * whole-day `CLOSED` already covers every minute, so the ranges add nothing
   * and must not demote the day to a partial block. A stored `HOURS` day's
   * ranges join the union, exactly as the writer has always merged them.
   */
  addRanges(
    existing: ExceptionEffectRule | null,
    add: readonly MinuteRange[],
  ): Result<ExceptionEffectRule.Blocked, SchedulingError> | null {
    if (
      existing !== null &&
      existing.exceptionEffect === ExceptionEffect.Closed
    ) {
      return null;
    }
    const current = existing === null ? [] : existing.exceptionRanges;
    return ExceptionEffectRule.blocked(
      ScheduleExceptionSystem.merge(current, add),
    );
  },

  /**
   * The day's blocks minus one — matched on its edges, not its identity
   * (`withoutRange`). Every other range is kept, in order.
   */
  withoutRange(
    ranges: readonly MinuteRange[],
    gone: MinuteRange,
  ): readonly MinuteRange[] {
    const kept: MinuteRange[] = [];
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i] as MinuteRange;
      if (
        range.startMinutes === gone.startMinutes &&
        range.endMinutes === gone.endMinutes
      ) {
        continue;
      }
      kept.push(range);
    }
    return kept;
  },

  /**
   * What ONE barber-day becomes when the staff block time on it
   * (`staff-day.store.ts` `writeBlocks`' decide, run per day inside the
   * exception writer's transaction). `ranges` empty stands the whole day
   * down: `CLOSED` REPLACES whatever the day held. Otherwise the ranges
   * MERGE into the stored blocks ({@link addRanges}): a stored `HOURS` or
   * `BLOCKED` day's ranges join the union as a `BLOCKED` day, and a day
   * already off whole stays as it is.
   *
   * `ok(null)` means KEEP the stored document unchanged (a whole-day
   * `CLOSED` already covers every minute asked for); any other `ok` is the
   * day's new body under `meta`. A merge with no range left refuses
   * (`SCHEDULING_SCHEDULE_EXCEPTION_EMPTY_RANGES`) and nothing is written.
   */
  block(
    existing: ScheduleException | null,
    ranges: readonly MinuteRange[],
    meta: ScheduleExceptionMeta,
  ): Result<ScheduleException | null, SchedulingError> {
    const effect: Result<ExceptionEffectRule, SchedulingError> | null =
      ranges.length === 0
        ? Result.ok(ExceptionEffectRule.closed())
        : ScheduleExceptionSystem.addRanges(existing, ranges);
    if (effect === null) return Result.ok(null);
    if (!effect.ok) return effect;
    return Result.ok({ ...meta, ...effect.value });
  },

  /**
   * What ONE barber-day becomes when a block is lifted (`staff-day.store.ts`
   * `clearBlock`'s decide). `ok(null)` means DELETE the day's document: the
   * day-wide lift (`range` `null`), a day with nothing stored, and a lift
   * that leaves no range. A day off WHOLE has no ranges to lift one from —
   * the range form refuses it (`SCHEDULING_SCHEDULE_EXCEPTION_EMPTY_RANGES`
   * on `CLOSED`) and the day-wide lift is the honest path. Otherwise the
   * range is removed by its edges ({@link withoutRange}) and the day keeps
   * its effect — `HOURS` stays `HOURS`, `BLOCKED` stays `BLOCKED` — under
   * its stored identity.
   */
  unblock(
    existing: ScheduleException | null,
    range: MinuteRange | null,
  ): Result<ScheduleException | null, SchedulingError> {
    if (range === null || existing === null) return Result.ok(null);
    if (existing.exceptionEffect === ExceptionEffect.Closed) {
      return Result.err(
        SchedulingError.scheduleExceptionEmptyRanges(ExceptionEffect.Closed),
      );
    }
    const left = ScheduleExceptionSystem.withoutRange(
      existing.exceptionRanges,
      range,
    );
    if (left.length === 0) return Result.ok(null);
    const effect =
      existing.exceptionEffect === ExceptionEffect.Hours
        ? ExceptionEffectRule.hours(left)
        : ExceptionEffectRule.blocked(left);
    if (!effect.ok) return effect;
    return Result.ok({ ...metaOfStored(existing), ...effect.value });
  },
} as const;
