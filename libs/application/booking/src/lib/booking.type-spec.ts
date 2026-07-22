/**
 * Compile-only assertions (no runtime `it`/`expect`) proving the
 * primitive-obsession ban holds across this lib's ports/use-cases. Never
 * executed by Vitest — named `*.type-spec.ts` so the `{test,spec}` glob
 * doesn't pick it up — exists purely so `tsc` fails if one of these
 * invariants regresses.
 */
import { AppointmentId } from '@creativo/domain/scheduling';
import { BarberId } from '@creativo/domain/catalog';
import { AppointmentRepository } from './ports/appointment-repository.port';
import { CancelAppointmentInput } from './use-cases/cancel-appointment.use-case';

declare const repo: AppointmentRepository;

// (a) A plain `string` is rejected where a branded ID is expected.

// @ts-expect-error — a bare string is not an AppointmentId.
const _appointmentIdFromString: AppointmentId = 'appt_1';

// @ts-expect-error — a bare string is not a BarberId.
const _barberIdFromString: BarberId = 'barber_1';

// (b) This context's branded types are not interchangeable with each other.

declare const appointmentId: AppointmentId;
declare const barberId: BarberId;

// @ts-expect-error — AppointmentId cannot substitute where a BarberId is expected.
const _barberIdFromAppointmentId: BarberId = appointmentId;

// @ts-expect-error — BarberId cannot substitute where an AppointmentId is expected.
const _appointmentIdFromBarberId: AppointmentId = barberId;

// (c) Port methods reject a plain string in place of the branded id.

// @ts-expect-error — findById takes an AppointmentId, not a bare string.
repo.findById('appt_1');

// (d) CancelAppointmentInput.appointmentId is branded, not a bare string.

const _cancelInput: CancelAppointmentInput = {
  // @ts-expect-error — appointmentId must be an AppointmentId, not a bare string.
  appointmentId: 'appt_1',
  reason: 'no longer needed',
};
void _cancelInput;

export {};
