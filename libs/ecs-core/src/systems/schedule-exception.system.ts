import { ExceptionEffect, Result, type BarberId } from '@core/primitives';
import { type SchedulingError } from '@core/errors';
import {
  ExceptionEffectRule,
  type ExceptionDetail,
  ExceptionReason,
  MinuteRange,
} from '@core/components';

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
   * Is the exception shop-wide (`schedule-exception.ts:107-112`)? A closure
   * with no barber applies to every chair at the location; under D16(b) it
   * reaches storage fanned out, one `CLOSED` effect per barber, so every
   * reader below the writer sees a barber's own exception.
   */
  isLocationWide(barberId: BarberId | null): boolean {
    return barberId === null;
  },

  /** Does an exception scoped to `scope` (`null`: shop-wide) apply to this barber? */
  appliesTo(scope: BarberId | null, barberId: BarberId): boolean {
    return scope === null || scope === barberId;
  },

  /**
   * Does the detail remove the whole day rather than carve pieces out of it
   * (`schedule-exception.ts:110-121`)? The five whole-day reasons do;
   * `HOURS`, `BREAK` and `ADMIN` operate within a day that is still worked.
   */
  isWholeDay(detail: ExceptionDetail): boolean {
    switch (detail.exceptionReason) {
      case ExceptionReason.Closed:
      case ExceptionReason.TimeOff:
      case ExceptionReason.Sick:
      case ExceptionReason.Training:
      case ExceptionReason.Travel:
        return true;
      default:
        return false;
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
} as const;
