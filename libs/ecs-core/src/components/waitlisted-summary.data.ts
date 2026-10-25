import type { LocationId, WaitlistRequestId } from '@core/primitives';
import type { BookingCart } from './booking-cart.data';
import type { FlexibleWhen } from './flexible-when.data';
import type { Party } from './party.data';

/**
 * What the waitlisted screen renders — the receipt for a watch on a set of
 * days. Split out of `booking-flow.data.ts` (pass D, D-7).
 */
export type WaitlistedSummary = {
  readonly requestId: WaitlistRequestId;
  readonly party: Party;
  readonly cart: BookingCart;
  readonly when: FlexibleWhen;
  readonly locationId: LocationId | null;
};
