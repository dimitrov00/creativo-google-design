export * from './lib/ports/appointment-repository.port';
export * from './lib/ports/booking-draft';
export * from './lib/ports/booking-draft-store.errors';
export * from './lib/ports/booking-draft-store.port';
export * from './lib/use-cases/cancel-appointment.errors';
export * from './lib/use-cases/cancel-appointment.use-case';
export * from './lib/use-cases/create-booking.errors';
export * from './lib/use-cases/create-booking.use-case';
export * from './lib/use-cases/observe-upcoming.use-case';
export * from './lib/flow/booking-flow.errors';
export * from './lib/flow/booking-flow';

// Facade re-export (blueprint §1.2 layering) — see
// `libs/application/identity`'s identical re-export for the full rationale;
// the `client/account` dashboard (goal 6.3) needs `Appointment`/`TimeSlot`/
// `Seat` nameable without reaching past this layer.
export * from '@creativo/domain/scheduling';
// `Result`/`ok`/`fail`/`DomainError` (blueprint §2.1) are the one piece of
// `domain/kernel` every port/use-case above is built from — re-exported
// for the same reason as `identity`'s identical block: the `client/
// appointments` feature (goal 6.4) narrates cancel-flow errors and builds
// port-shaped `Result`s in tests without an illegal `type:domain` import
// of its own.
export type { DomainError, Result } from '@creativo/domain/kernel';
export { ok, fail } from '@creativo/domain/kernel';
