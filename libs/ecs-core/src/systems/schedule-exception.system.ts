import { ExceptionEffect, Result } from '@core/primitives';
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

/**
 * A staff editor's exception, sanitised to what the public may know, and the
 * merge arithmetic of the exception writer
 * (`schedule-exception-document.ts:78-91`, `:197-218`,
 * `schedule-exception-writer.adapter.ts:26-49`). Wall-clock minute ranges of
 * one shop day throughout — no instant, no zone.
 */
export const ScheduleExceptionSystem = {
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
