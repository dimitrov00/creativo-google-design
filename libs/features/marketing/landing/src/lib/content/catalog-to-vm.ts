import type { Barber, Service } from '@creativo/application/catalog';
import type {
  BarberVm,
  Localized,
  ServiceOfferingVm,
  ServiceTermsVm,
  ServiceVm,
  ServiceVariantVm,
} from './landing-content';

/**
 * Domain → view model, so the landing renders the REAL catalog while its
 * components keep binding the `ServiceVm`/`BarberVm` shapes they were
 * written against. The view models stay: what changed is their source.
 *
 * The catalog cannot answer everything a marketing page shows. Art
 * direction — a barber's selected-work gallery, their one-line craft
 * summary, the avatar focal point — is editorial copy with no business
 * meaning, so it stays hand-authored here, keyed by id, and is merged onto
 * whatever the catalog returns. `rating` is the one field that simply
 * disappears: `Barber` refuses to model it ("fabricated ratings read as a
 * scam"), and inventing one at the presentation layer would be the same
 * lie one layer up.
 */

/** Editorial extras the catalog has no business carrying, keyed by barber id. */
export interface BarberArtDirection {
  readonly specialty: Localized;
  readonly gallery: readonly string[];
  readonly objectPosition: string;
}

/** Editorial extras keyed by service id. */
export interface ServiceArtDirection {
  readonly gallery: readonly string[];
}

const DEFAULT_OBJECT_POSITION = '50% 25%';

function localized(text: { en: string; bg: string }): Localized {
  return { en: text.en, bg: text.bg };
}

/** `Money` → the VM's major-unit number (`1450` minor → `14.5`). */
function termsToVm(terms: {
  price: { toMajorUnits(): number };
  durationMinutes: number;
}): ServiceTermsVm {
  return { price: terms.price.toMajorUnits(), minutes: terms.durationMinutes };
}

function offeringToVm(
  offering: Service['offerings'][number],
  /** The service's DOMAIN variants — `termsFor` takes the id VO, not the slug. */
  variants: readonly Service['variants'][number][],
): ServiceOfferingVm {
  const byVariant: Record<string, ServiceTermsVm> = {};
  for (const variant of variants) {
    // Ask the offering for every declared variant and let its own sparse
    // fallback decide. Terms equal to base are still written out: the VM's
    // helpers read this map directly and have no fallback of their own.
    byVariant[variant.id.value] = termsToVm(offering.termsFor(variant.id));
  }
  return {
    barberId: offering.barberId.value,
    base: termsToVm(offering.base),
    ...(variants.length > 0 ? { byVariant } : {}),
  };
}

export function serviceToVm(
  service: Service,
  coverSrc: string | undefined,
  art: ServiceArtDirection | undefined,
): ServiceVm {
  const variants: ServiceVariantVm[] = service.variants.map((variant) => ({
    id: variant.id.value,
    name: localized(variant.name),
    // The icon is a rendering choice, not catalog data; length is the only
    // axis the seed declares, and `skin` was never wired to anything.
    icon: 'length',
  }));

  const offerings = service.offerings.map((offering) =>
    offeringToVm(offering, service.variants),
  );

  return {
    id: service.id.value,
    kind: service.composition.kind,
    name: localized(service.name),
    description: localized(service.description),
    ...(coverSrc ? { coverSrc } : {}),
    variants,
    // A service nobody is priced for yet still has to show a price, so its
    // `baseTerms` stands in as a single anonymous offering. Without this
    // the VM's `servicePriceFrom` would fold an empty list.
    offerings:
      offerings.length > 0
        ? offerings
        : [{ barberId: '', base: termsToVm(service.baseTerms) }],
    ...(service.composition.kind === 'bundle'
      ? { includes: service.composition.includes.map((id) => id.value) }
      : {}),
    upsellOnly: service.upsellOnly,
    gallery: art?.gallery ?? [],
  };
}

export function barberToVm(
  barber: Barber,
  avatarSrc: string | undefined,
  art: BarberArtDirection | undefined,
): BarberVm {
  return {
    id: barber.id.value,
    name: localized(barber.name),
    title: localized(barber.title),
    bio: localized(barber.bio),
    avatarSrc: avatarSrc ?? '',
    objectPosition: art?.objectPosition ?? DEFAULT_OBJECT_POSITION,
    // No `rating` — see the note at the top of this file.
    specialty: art?.specialty ?? localized(barber.title),
    gallery: art?.gallery ?? [],
  };
}
