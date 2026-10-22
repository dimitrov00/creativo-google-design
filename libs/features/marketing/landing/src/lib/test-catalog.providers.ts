import { Provider } from '@angular/core';
import { of } from 'rxjs';
import {
  CATALOG_PORTS,
  MEDIA_RESOLVE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import type { CatalogReadPorts, MediaResolvePorts } from '@core/ports';
import type { Barber, Service } from '@core/entities';
import {
  BarberOffering,
  BarberStatus,
  LocalizedText,
  ServiceComposition,
  ServiceStatus,
  ServiceTerms,
  ServiceVariant,
  type ServiceTermsInput,
} from '@core/components';
import {
  BarberId,
  Currency,
  MediaRefId,
  Result,
  ServiceCategoryId,
  ServiceId,
} from '@core/primitives';
import { BARBERS, SERVICES, type ServiceVm } from './content/landing-content';

/**
 * Serves the SAME bundled demo fixture the landing used to render
 * directly, but as real `Service`/`Barber` entities behind `CATALOG_PORTS`
 * — the catalogue's live streams, as a `CatalogReadPorts` bundle.
 *
 * Deliberately not hand-written stub objects: every figure goes through the
 * catalogue's own edge guards (`ServiceTerms.parse`, `ServiceVariant.parseAll`,
 * `BarberOffering.parseAll`, `LocalizedText.parse`), so these specs also prove
 * the entity → `ServiceVm` mapping, and any invariant the fixture violates
 * fails here instead of silently in production.
 */

const sure = <T, E>(result: Result<T, E>): T => {
  if (!result.ok) {
    throw new Error('landing test fixture violates a catalogue invariant');
  }
  return result.value;
};

/** `14.5` major EUR → `1450` cents. */
const cents = (major: number) => Math.round(major * 100);

/** One figure of the shelf fixture as the terms guard reads it — EUR, no pads. */
function termsInput(price: number, minutes: number): ServiceTermsInput {
  return {
    priceCents: cents(price),
    currency: Currency.EUR,
    durationMinutes: minutes,
    setupMinutes: 0,
    cleanupMinutes: 0,
  };
}

/** The flat cover fields of a fixture path — all seven `null` together when there is none (N9). */
function coverOf(
  service: ServiceVm,
): Pick<
  Service,
  | 'coverMediaId'
  | 'coverMediaPath'
  | 'coverMediaWidth'
  | 'coverMediaHeight'
  | 'coverMediaBlurhash'
  | 'coverMediaFocalX'
  | 'coverMediaFocalY'
> {
  return {
    coverMediaId: service.coverSrc
      ? MediaRefId.of(`media-${service.id}`)
      : null,
    coverMediaPath: service.coverSrc ?? null,
    coverMediaWidth: service.coverSrc ? 1200 : null,
    coverMediaHeight: service.coverSrc ? 1500 : null,
    coverMediaBlurhash: null,
    coverMediaFocalX: null,
    coverMediaFocalY: null,
  };
}

function serviceFromVm(vm: ServiceVm): Service {
  // The shelf fixture prices everything through `offerings`; the cheapest
  // one doubles as the service's own terms so a service is never priceless.
  const [first, ...rest] = vm.offerings;
  if (first === undefined) {
    throw new Error('landing test fixture lists a service nobody offers');
  }
  const cheapest = rest.reduce(
    (best, offering) =>
      offering.base.price < best.base.price ? offering : best,
    first,
  );
  const variants = sure(
    ServiceVariant.parseAll(
      vm.variants.map((variant) => ({
        variantId: variant.id,
        name: variant.name,
      })),
    ),
  );
  const offerings = sure(
    BarberOffering.parseAll(
      vm.offerings.map((offering) => ({
        barberId: offering.barberId,
        ...termsInput(offering.base.price, offering.base.minutes),
        overrides: Object.entries(offering.byVariant ?? {}).map(
          ([variantId, terms]) => ({
            variantId,
            ...termsInput(terms.price, terms.minutes),
          }),
        ),
      })),
      variants,
    ),
  );
  const composition: ServiceComposition =
    vm.kind === 'bundle'
      ? ServiceComposition.bundle(
          (vm.includes ?? []).map((id) => ServiceId.of(id)),
        )
      : ServiceComposition.single();
  return {
    id: ServiceId.of(vm.id),
    name: sure(LocalizedText.parse(vm.name)),
    description: sure(LocalizedText.parse(vm.description)),
    categoryId: ServiceCategoryId.of('cat-hair'),
    ...sure(
      ServiceTerms.parse(
        termsInput(cheapest.base.price, cheapest.base.minutes),
      ),
    ),
    variants,
    offerings,
    locationIds: [],
    conflictsWith: [],
    ...composition,
    upsellOnly: vm.upsellOnly,
    popular: false,
    serviceStatus: ServiceStatus.Active,
    sortOrder: 0,
    ...coverOf(vm),
  };
}

function barbers(): readonly Barber[] {
  return BARBERS.map((vm, index): Barber => ({
    id: BarberId.of(vm.id),
    name: sure(LocalizedText.parse(vm.name)),
    handle: vm.id,
    title: sure(LocalizedText.parse(vm.title)),
    bio: sure(LocalizedText.parse(vm.bio)),
    yearsExperience: null,
    locationIds: [],
    instagramHandle: null,
    barberStatus: BarberStatus.Active,
    sortOrder: index,
    avatarMediaId: MediaRefId.of(`media-barber-${vm.id}`),
    avatarMediaPath: vm.avatarSrc,
    avatarMediaWidth: 1200,
    avatarMediaHeight: 1500,
    avatarMediaBlurhash: null,
    avatarMediaFocalX: null,
    avatarMediaFocalY: null,
  }));
}

/**
 * The fixture catalogue as the live streams answer it. No shops: the
 * landing's locations are still hand-authored, and the shared
 * `CatalogContentService` it reads its services and barbers from subscribes
 * to that stream too. No categories: nothing on the landing groups by them.
 */
function fixtureCatalogPorts(): CatalogReadPorts {
  const services = SERVICES.map(serviceFromVm);
  const people = barbers();
  return {
    observeServices: () => of(Result.ok(services)),
    observeBarbers: () => of(Result.ok(people)),
    observeCategories: () => of(Result.ok([])),
    observeLocations: () => of(Result.ok([])),
  };
}

/** Echoes the ref's own path back as the URL — the fixture stores real `/work/*.jpg` paths. */
function fixtureMediaPorts(): MediaResolvePorts {
  return {
    resolveMedia: async (ref) =>
      Result.ok([{ width: ref.mediaWidth, url: ref.mediaPath }]),
  };
}

export function provideTestCatalog(): Provider[] {
  return [
    { provide: CATALOG_PORTS, useFactory: fixtureCatalogPorts },
    { provide: MEDIA_RESOLVE_PORTS, useFactory: fixtureMediaPorts },
  ];
}
