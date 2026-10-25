import type { AppointmentId } from '@core/primitives';
import type { BookingCart } from './booking-cart.data';
import type { Party } from './party.data';
import type { ScheduleSelection } from './schedule-selection.data';

/**
 * What the confirmation screen renders — deliberately NOT an appointment:
 * the server builds that from server-resolved terms, and the browser
 * rebuilding one would describe what was REQUESTED. The `appointmentId` is
 * the receipt; the rest is what the client already agreed to. In-memory UI
 * state (F-8): it keeps its named references. Split out of
 * `booking-flow.data.ts` (pass D, D-7).
 */
export type BookingConfirmation = {
  readonly appointmentId: AppointmentId;
  readonly party: Party;
  readonly cart: BookingCart;
  readonly selection: ScheduleSelection;
};
