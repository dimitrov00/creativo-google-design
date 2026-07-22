import { BarberId, LocationId, ServiceId } from './ids';

/**
 * Compile-time-only assertions for the primitive-obsession ban — no
 * runtime `expect()`/`it()`. Proves (a) a bare `string` cannot substitute
 * for a branded ID, and (b) this context's distinct branded ID types are
 * not interchangeable with each other, even though every one of them is
 * structurally just a wrapped `string` at runtime.
 */

declare function requireLocationId(id: LocationId): void;
declare function requireBarberId(id: BarberId): void;
declare function requireServiceId(id: ServiceId): void;

// (a) A plain string is rejected where a branded ID is expected.
// @ts-expect-error — a bare string is not a LocationId; it must be produced by LocationId.create()/generate().
requireLocationId('location_1');

// (b) This context's branded ID types are not interchangeable with one
// another, despite all being `Id<string>` subclasses under the hood.
const barberId: BarberId = BarberId.generate();
// @ts-expect-error — a BarberId cannot substitute for a LocationId.
requireLocationId(barberId);

const serviceId: ServiceId = ServiceId.generate();
// @ts-expect-error — nor can a ServiceId substitute for a BarberId.
requireBarberId(serviceId);

const locationId: LocationId = LocationId.generate();
// @ts-expect-error — nor can a LocationId substitute for a ServiceId.
requireServiceId(locationId);
