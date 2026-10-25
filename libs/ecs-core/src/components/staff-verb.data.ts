import { type BookingStatus, Tag } from '@core/primitives';
import { ArrivalVerb } from './arrival-verb.data';
import { BookingLifecycle } from './booking-lifecycle.data';

/**
 * What a staff row can DO: a lifecycle move — the `BookingStatus` the
 * transition callable is asked for — or one of the arrival stamps
 * (`ArrivalVerb`). What `AppointmentLifecycleSystem.leadVerb` / `inverseOf` /
 * `exitVerbs` answer in.
 */
export type StaffVerb = BookingStatus | ArrivalVerb;

export const StaffVerb = {
  /**
   * Does acting with `verb` settle the visit as one that did NOT happen —
   * a move to `CANCELLED` or `NO_SHOW` (`BookingLifecycle.didNotHappen`)?
   * An arrival stamp never does: it is no lifecycle move. What closes the
   * staff sheet behind a terminal act (the dashboard's `actFromSheet`).
   */
  didNotHappen(verb: StaffVerb): boolean {
    return Tag.has(ArrivalVerb, verb)
      ? false
      : BookingLifecycle.didNotHappen({ bookingStatus: verb });
  },
} as const;
