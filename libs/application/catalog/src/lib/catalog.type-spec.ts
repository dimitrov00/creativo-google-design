/**
 * Compile-only assertions (no runtime `it`/`expect`) proving the
 * primitive-obsession ban holds across this lib's ports/use-cases. Never
 * executed by Vitest — named `*.type-spec.ts` so the `{test,spec}` glob
 * doesn't pick it up — exists purely so `tsc` fails if one of these
 * invariants regresses.
 */
import { BarberId, ServiceId } from '@creativo/domain/catalog';
import { CatalogReader } from './ports/catalog-reader.port';

declare const reader: CatalogReader;

// (a) A plain `string` is rejected where a branded ID is expected.

// @ts-expect-error — a bare string is not a BarberId.
const _barberIdFromString: BarberId = 'barber_1';

// @ts-expect-error — a bare string is not a ServiceId.
const _serviceIdFromString: ServiceId = 'service_1';

// (b) This context's branded types are not interchangeable with each other.

declare const barberId: BarberId;
declare const serviceId: ServiceId;

// @ts-expect-error — BarberId cannot substitute where a ServiceId is expected.
const _serviceIdFromBarberId: ServiceId = barberId;

// @ts-expect-error — ServiceId cannot substitute where a BarberId is expected.
const _barberIdFromServiceId: BarberId = serviceId;

// (c) Port methods reject a plain string in place of the branded id.

// @ts-expect-error — findBarberById takes a BarberId, not a bare string.
reader.findBarberById('barber_1');

// @ts-expect-error — findServiceById takes a ServiceId, not a bare string.
reader.findServiceById('service_1');

export {};
