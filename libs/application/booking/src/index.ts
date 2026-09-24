export * from './lib/ports/appointment-document';
export * from './lib/ports/appointment-repository.port';
export * from './lib/ports/appointment-notes.port';
export * from './lib/ports/appointment-photos.port';
export * from './lib/ports/availability-reader.port';
export * from './lib/ports/booking-draft';
export * from './lib/ports/booking-gateway.port';
export * from './lib/ports/booking-policy-document';
export * from './lib/ports/capacity-document';
export * from './lib/ports/schedule-exception-document';
export * from './lib/ports/schedule-exception-writer.port';
export * from './lib/ports/booking-policy-reader.port';
export * from './lib/ports/waitlist-document';
export * from './lib/ports/waitlist-gateway.port';
export * from './lib/ports/booking-draft-store.errors';
export * from './lib/ports/booking-draft-store.port';
export * from './lib/use-cases/cancel-appointment.use-case';
export * from './lib/use-cases/create-booking.errors';
export * from './lib/use-cases/create-booking.use-case';
export * from './lib/use-cases/observe-availability.use-case';
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
// `ZonedDateTime` joins them for the same reason: the schedule step deals in
// instants end to end — "now" from the clock port, a slot start, a chip label
// — and it cannot reach past this facade for the kernel type that carries one.
export { ZonedDateTime } from '@creativo/domain/kernel';
// `Money`/`formatMoney` join them for the review step, which sums the
// per-barber terms each of its rows shows. Going through `Money.add` rather
// than adding minor units by hand is what makes a mixed-currency cart refuse
// to produce a total instead of producing a wrong one.
export { Money, formatMoney } from '@creativo/domain/kernel';
