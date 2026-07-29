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
// `Service.price` is a kernel `Money`, so any feature rendering a service
// needs the one sanctioned way to turn it into display text — re-exported
// for the same reason, and to keep ad-hoc `Intl.NumberFormat` calls (which
// drifted to a hardcoded `/ 100` and dropped fraction digits) out of
// components.
export { formatMoney } from '@creativo/domain/kernel';
