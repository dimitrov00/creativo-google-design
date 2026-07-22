/**
 * Compile-only type-level assertions (blueprint §2.2/§7): a plain string
 * must never satisfy a branded id, and distinct branded ids must never
 * be structurally interchangeable — including across bounded contexts.
 * This file has no runtime assertions — `tsc` failing on a missing
 * `@ts-expect-error` IS the test.
 */
import { ServiceId } from '@creativo/domain/catalog';
import { AppointmentId, GuestId, SeatId } from './ids';

function takesAppointmentId(_id: AppointmentId): void {
  // no-op — signature-only fixture
}

function takesSeatId(_id: SeatId): void {
  // no-op — signature-only fixture
}

// (a) a bare string is rejected wherever a branded id is expected.
// @ts-expect-error — a raw string is not an AppointmentId
takesAppointmentId('not-an-appointment-id');
// @ts-expect-error — a raw string is not a SeatId
takesSeatId('not-a-seat-id');

// (b) the goal's canonical cross-context example: a ServiceId (from
// @creativo/domain/catalog) cannot substitute where an AppointmentId is
// required, even though both ultimately wrap a plain string.
declare const serviceId: ServiceId;
// @ts-expect-error — ServiceId cannot substitute where AppointmentId is required
takesAppointmentId(serviceId);

// (c) this context's own distinct branded ids are not interchangeable.
declare const guestId: GuestId;
// @ts-expect-error — GuestId cannot substitute where SeatId is required
takesSeatId(guestId);
