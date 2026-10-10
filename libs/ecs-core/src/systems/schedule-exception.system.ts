import {
  ExceptionEffect,
  ExceptionEffectKind,
} from '../components/exception-effect.data';
import {
  type ExceptionDetail,
  ExceptionReason,
} from '../components/exception-detail.data';
import { MinuteRange } from '../components/minute-range.data';
import { Result } from '../components/result.data';
import type { SchedulingError } from '../components/scheduling-errors.data';
import type { BarberId } from '../entities/barber.entity';

/**
 * A staff editor's exception, sanitised to what the public may know, and the
 * merge arithmetic of the exception writer
 * (`schedule-exception-document.ts:78-91`, `:197-218`,
 * `schedule-exception-writer.adapter.ts:26-49`).
 */
export const ScheduleExceptionSystem = {
  /**
   * **The GDPR boundary.** The reasoned detail → the PUBLIC effect: `closed`,
   * `time_off`, `sick`, `training` and `travel` all collapse to the SAME
   * `closed` effect, so the public document cannot tell an ill barber from
   * one on holiday — not by field, not by absence of a field, not by
   * inference; `break` and `admin` collapse to `blocked`; `hours` stays
   * `hours`. Written as an exhaustive switch so a new reason cannot reach
   * storage without someone deciding how it is sanitised. Ranges come back
   * normalized; a range-bearing detail with none is refused
   * (`scheduling.schedule_exception.empty_ranges`).
   */
  publicEffect(
    detail: ExceptionDetail,
  ): Result<ExceptionEffect, SchedulingError> {
    switch (detail.kind) {
      case ExceptionReason.Closed:
      case ExceptionReason.TimeOff:
      case ExceptionReason.Sick:
      case ExceptionReason.Training:
      case ExceptionReason.Travel:
        return Result.ok(ExceptionEffect.closed());
      case ExceptionReason.Hours:
        return ExceptionEffect.hours(detail.ranges);
      case ExceptionReason.Break:
      case ExceptionReason.Admin:
        return ExceptionEffect.blocked(detail.ranges);
    }
  },

  /**
   * Is the exception shop-wide (`schedule-exception.ts:107-112`)? A closure
   * with no barber applies to every chair at the location; under D16(b) it
   * reaches storage fanned out, one `closed` effect per barber, so every
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
   * `hours`, `break` and `admin` operate within a day that is still worked.
   */
  isWholeDay(detail: ExceptionDetail): boolean {
    switch (detail.kind) {
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
   * ranges the stored effect has, as a `blocked` effect — or `null` when a
   * whole-day `closed` already covers every minute, so the ranges add nothing
   * and must not demote the day to a partial block. A stored `hours` day's
   * ranges join the union, exactly as the writer has always merged them.
   */
  addRanges(
    existing: ExceptionEffect | null,
    add: readonly MinuteRange[],
  ): Result<ExceptionEffect.Blocked, SchedulingError> | null {
    if (existing !== null && existing.kind === ExceptionEffectKind.Closed) {
      return null;
    }
    const current = existing === null ? [] : existing.ranges;
    return ExceptionEffect.blocked(ScheduleExceptionSystem.merge(current, add));
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
