import { Id, Result, fail, ok } from '@creativo/domain/kernel';
import { BarberId, LocationId } from '@creativo/domain/catalog';
import { CalendarDay } from './calendar-day';
import { LocalTimeRange } from './local-time-of-day';
import { EmptyExceptionRangesError } from './schedule-exception.errors';

export class ScheduleExceptionId extends Id<'ScheduleException'> {
  private constructor(value: string) {
    super(value);
  }
  static of(value: string): ScheduleExceptionId {
    return new ScheduleExceptionId(value);
  }
}

/**
 * Why a barber's normal roster does not apply on a specific day.
 *
 * Split along the axis that actually matters downstream — whether the time
 * was ever SELLABLE:
 *
 * - `closed` / `time_off` / `sick` / `training` / `travel` — the barber is not
 *   available. The time leaves the capacity denominator entirely, so a
 *   barber is never penalised in utilisation for hours nobody could have
 *   sold. Each stays visible as its own line.
 * - `hours` — a one-off different shift (late start, early finish, an extra
 *   Sunday). Replaces the pattern for that day; the time it does cover is
 *   fully sellable.
 * - `break` — a carve-out INSIDE the roster (lunch). The surrounding shift
 *   stays rostered; only the break is unavailable. Paid breaks stay in the
 *   denominator, unpaid ones do not — which is why `paid` is on the arm.
 *
 * `closed` is location-wide (a holiday, a refurb) and applies to every
 * barber; the rest are about one person.
 */
export type ScheduleExceptionKind =
  | { readonly kind: 'closed' }
  | { readonly kind: 'hours'; readonly ranges: readonly LocalTimeRange[] }
  | { readonly kind: 'time_off' }
  | { readonly kind: 'sick'; readonly paid: boolean }
  | { readonly kind: 'training'; readonly topic: string | null }
  | { readonly kind: 'travel'; readonly toLocationId: LocationId }
  | {
      readonly kind: 'break';
      readonly ranges: readonly LocalTimeRange[];
      readonly paid: boolean;
    }
  | {
      readonly kind: 'admin';
      readonly ranges: readonly LocalTimeRange[];
      readonly note: string;
    };

export interface ScheduleExceptionProps {
  readonly id: ScheduleExceptionId;
  readonly day: CalendarDay;
  /** `null` for a location-wide closure — it applies to everyone. */
  readonly barberId: BarberId | null;
  readonly locationId: LocationId;
  readonly detail: ScheduleExceptionKind;
}

/**
 * A dated deviation from the recurring roster.
 *
 * Exceptions are the ONLY sanctioned way to change what a past day looked
 * like: `StaffScheduleHistory` refuses retroactive amendment precisely so
 * that corrections land here, where they are explicit, dated and attributable
 * rather than a silent rewrite of a pattern.
 */
export class ScheduleException {
  private constructor(
    readonly id: ScheduleExceptionId,
    readonly day: CalendarDay,
    readonly barberId: BarberId | null,
    readonly locationId: LocationId,
    readonly detail: ScheduleExceptionKind,
  ) {}

  static create(
    props: ScheduleExceptionProps,
  ): Result<ScheduleException, EmptyExceptionRangesError> {
    // The three range-bearing arms are meaningless with nothing in them, and
    // an empty `hours` would silently mean "closed" — a second way to say one
    // thing, which is how two code paths start disagreeing.
    if ('ranges' in props.detail && props.detail.ranges.length === 0) {
      return fail(new EmptyExceptionRangesError(props.detail.kind));
    }
    return ok(
      new ScheduleException(
        props.id,
        props.day,
        props.barberId,
        props.locationId,
        props.detail,
      ),
    );
  }

  /** Applies to every barber at the location, rather than to one person. */
  isLocationWide(): boolean {
    return this.barberId === null;
  }

  appliesTo(barberId: BarberId): boolean {
    return this.barberId === null || this.barberId.equals(barberId);
  }

  /**
   * Does this remove the whole day rather than carve pieces out of it?
   * `closed`, `time_off`, `sick`, `training` and `travel` do; `hours`,
   * `break` and `admin` operate within a day that is still worked.
   */
  isWholeDay(): boolean {
    switch (this.detail.kind) {
      case 'closed':
      case 'time_off':
      case 'sick':
      case 'training':
      case 'travel':
        return true;
      default:
        return false;
    }
  }

  /** Does it REPLACE the pattern's ranges for the day? Only `hours` does. */
  replacesRoster(): boolean {
    return this.detail.kind === 'hours';
  }
}
