import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { BookingPolicy } from '@creativo/domain/scheduling';

/**
 * Where the tenant's booking policy comes from.
 *
 * Every number the flow used to hardcode — the party cap, the slot grid, the
 * lead time, **how many months ahead the calendar opens** — is tenant
 * configuration, and configuration that only a developer can change is not
 * configuration. This port is the seam an admin editor writes through; until
 * one exists the adapter answers with `BookingPolicy.default()` and nothing
 * downstream can tell the difference.
 *
 * An `Observable` rather than a promise for the same reason the availability
 * reader is one: a shop that extends its horizon while someone is scrolling
 * the calendar should see the extra months appear, not on the next reload.
 *
 * Deliberately NOT a `Result`: a policy that fails to load falls back to the
 * defaults rather than propagating an error, because the alternative is a
 * booking flow that cannot open at all. A tenant with no policy document is
 * the NORMAL case today, not a failure.
 */
export interface BookingPolicyReader {
  observe(): Observable<BookingPolicy>;
}

export const BOOKING_POLICY_READER = new InjectionToken<BookingPolicyReader>(
  'BookingPolicyReader',
);
