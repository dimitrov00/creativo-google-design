export * from './lib/ports/catalog-reader.port';
export * from './lib/ports/media-reader.port';
export * from './lib/use-cases/get-barber-profile.errors';
export * from './lib/use-cases/get-barber-profile.use-case';
export * from './lib/use-cases/list-services-grouped-by-category.use-case';

// Facade re-export (blueprint §1.2 layering) — see
// `libs/application/identity`'s identical re-export for the full rationale;
// `type:feature` libs (the onboarding services step, the booking wizard)
// need `ServiceId` and friends nameable without reaching past this layer.
export * from '@creativo/domain/catalog';
