import { Provider } from '@angular/core';
import { of } from 'rxjs';
import {
  CATALOG_PORTS,
  MEDIA_RESOLVE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import type { CatalogReadPorts, MediaResolvePorts } from '@core/ports';
import type { Barber, Service, ShopLocation } from '@core/entities';
import {
  BarberOffering,
  BarberStatus,
  CompositionKind,
  DayHours,
  E164,
  GeoPoint,
  LocalizedText,
  LocationStatus,
  MediaRef,
  ServiceComposition,
  ServiceStatus,
  ServiceTerms,
  ServiceVariant,
  type ServiceTermsInput,
  VenuePhone,
} from '@core/components';
import {
  BarberId,
  Currency,
  LocalDate,
  LocationId,
  MediaRefId,
  Result,
  ServiceCategoryId,
  ServiceId,
  UtcEpochMs,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  CATALOG_ART,
  type CatalogArt,
} from '@creativo/features/shared/catalog';
import { LANDING_WORK_SHOTS } from '../lib/content/landing-content';
import {
  type AuthoredService,
  type AuthoredShop,
  type AuthoredTerms,
  BARBERS,
  SERVICES,
  SHOPS,
  WORK_SHOTS,
} from './landing-catalog';

/**
 * Serves the authored demo catalogue (`landing-catalog.ts`) as real
 * `Service`/`Barber` entities behind `CATALOG_PORTS` — the catalogue's live
 * streams, as a `CatalogReadPorts` bundle.
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

/** One figure of the shelf fixture as the terms guard reads it — EUR, no pads. */
function termsInput(terms: AuthoredTerms): ServiceTermsInput {
  return {
    priceCents: terms.priceCents,
    currency: Currency.EUR,
    durationMinutes: terms.minutes,
    setupMinutes: 0,
    cleanupMinutes: 0,
  };
}

/** The flat cover fields of a fixture path — all seven `null` together when there is none (N9). */
function coverOf(
  service: AuthoredService,
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

function serviceFromVm(vm: AuthoredService): Service {
  // The shelf fixture prices everything through `offerings`; the cheapest
  // one doubles as the service's own terms so a service is never priceless.
  const [first, ...rest] = vm.offerings;
  if (first === undefined) {
    throw new Error('landing test fixture lists a service nobody offers');
  }
  const cheapest = rest.reduce(
    (best, offering) =>
      offering.base.priceCents < best.base.priceCents ? offering : best,
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
        ...termsInput(offering.base),
        overrides: Object.entries(offering.byVariant ?? {}).map(
          ([variantId, terms]) => ({
            variantId,
            ...termsInput(terms),
          }),
        ),
      })),
      variants,
    ),
  );
  const composition: ServiceComposition =
    vm.compositionKind === CompositionKind.Bundle
      ? ServiceComposition.bundle(
          (vm.includes ?? []).map((id) => ServiceId.of(id)),
        )
      : ServiceComposition.single();
  return {
    id: ServiceId.of(vm.id),
    name: sure(LocalizedText.parse(vm.name)),
    description: sure(LocalizedText.parse(vm.description)),
    categoryId: ServiceCategoryId.of('cat-hair'),
    ...sure(ServiceTerms.parse(termsInput(cheapest.base))),
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
    writeOperationId: null,
  };
}

function barbers(): readonly Barber[] {
  return BARBERS.map((vm, index): Barber => ({
    id: BarberId.of(vm.id),
    name: sure(LocalizedText.parse(vm.name)),
    title: sure(LocalizedText.parse(vm.title)),
    bio: sure(LocalizedText.parse(vm.bio)),
    yearsExperience: null,
    locationIds: [],
    instagramHandle: null,
    barberJoinsAnyPool: true,
    sortOrder: index,
    barberStatus: BarberStatus.Public,
    barberStatusChangedAtUtcMs: sure(UtcEpochMs.of(1704067200000)),
    barberStartsLocalDate: sure(LocalDate.parse('2024-01-01')),
    barberLastWorkingLocalDate: null,
    barberPastPeriods: [],
    avatarMediaId: MediaRefId.of(`media-barber-${vm.id}`),
    avatarMediaPath: vm.avatarSrc,
    avatarMediaWidth: 1200,
    avatarMediaHeight: 1500,
    avatarMediaBlurhash: null,
    avatarMediaFocalX: null,
    avatarMediaFocalY: null,
    writeOperationId: null,
  }));
}

/** A demo shop as the `locations` read answers it — every figure through its edge guard. */
function shopFromVm(vm: AuthoredShop, index: number): ShopLocation {
  return {
    id: LocationId.of(vm.id),
    name: sure(LocalizedText.parse(vm.name)),
    shortName: null,
    address: sure(LocalizedText.parse(vm.address)),
    mapUrl: null,
    photos: vm.photos.map((path, photo) =>
      sure(
        MediaRef.parse({
          mediaId: MediaRefId.of(`media-${vm.id}-${photo}`),
          mediaPath: path,
          mediaWidth: 1200,
          mediaHeight: 1500,
          mediaBlurhash: null,
          mediaFocalX: null,
          mediaFocalY: null,
        }),
      ),
    ),
    openingHours: sure(DayHours.parseWeek(vm.week)),
    timeZone: sure(ZonedTimeSystem.checkZone('Europe/Sofia')),
    locationStatus: LocationStatus.Active,
    sortOrder: index + 1,
    ...sure(GeoPoint.parse(vm.latitude, vm.longitude)),
    ...sure(VenuePhone.of(sure(E164.parse(vm.phoneE164)), vm.phoneDisplay)),
    coverMediaId: null,
    coverMediaPath: null,
    coverMediaWidth: null,
    coverMediaHeight: null,
    coverMediaBlurhash: null,
    coverMediaFocalX: null,
    coverMediaFocalY: null,
  };
}

/**
 * The fixture catalogue as the live streams answer it — the demo barbers,
 * services and shops. No categories: nothing on the landing groups by them.
 */
function fixtureCatalogPorts(): CatalogReadPorts {
  const services = SERVICES.map(serviceFromVm);
  const people = barbers();
  const shops = testShops();
  return {
    observeServices: () => of(Result.ok(services)),
    observeBarbers: () => of(Result.ok(people)),
    observeCategories: () => of(Result.ok([])),
    observeLocations: () => of(Result.ok(shops)),
  };
}

/** The demo shops as the `locations` read answers them, in their `sortOrder`. */
export function testShops(): readonly ShopLocation[] {
  return SHOPS.map(shopFromVm);
}

/** The catalogue a fresh project answers: every read answered, nothing stored. */
function emptyCatalogPorts(): CatalogReadPorts {
  return {
    observeServices: () => of(Result.ok([])),
    observeBarbers: () => of(Result.ok([])),
    observeCategories: () => of(Result.ok([])),
    observeLocations: () => of(Result.ok([])),
  };
}

/** The demo art direction: each demo barber's specialty and gallery, each demo service's gallery. */
const DEMO_ART: CatalogArt = {
  barbers: Object.fromEntries(
    BARBERS.map((barber) => [
      barber.id,
      {
        specialty: barber.specialty,
        gallery: barber.gallery,
        objectPosition: barber.objectPosition,
      },
    ]),
  ),
  services: Object.fromEntries(
    SERVICES.map((service) => [service.id, { gallery: service.gallery }]),
  ),
};

/** Echoes the ref's own path back as the URL — the fixture stores real `/work/*.jpg` paths. */
function fixtureMediaPorts(): MediaResolvePorts {
  return {
    resolveMedia: async (ref) =>
      Result.ok([{ width: ref.mediaWidth, url: ref.mediaPath }]),
  };
}

/**
 * The demo catalogue — barbers, services, shops — behind the catalogue's
 * ports, with the demo art and work strip behind the seams production
 * leaves empty (`CATALOG_ART`, `LANDING_WORK_SHOTS`).
 */
export function provideTestCatalog(): Provider[] {
  return [
    { provide: CATALOG_PORTS, useFactory: fixtureCatalogPorts },
    { provide: MEDIA_RESOLVE_PORTS, useFactory: fixtureMediaPorts },
    { provide: CATALOG_ART, useValue: DEMO_ART },
    { provide: LANDING_WORK_SHOTS, useValue: WORK_SHOTS },
  ];
}

/**
 * A fresh project's catalogue: every read answers, and nothing is stored —
 * no barber, service or shop, no art, no work shots (staging on
 * 2026-11-19).
 */
export function provideEmptyCatalog(): Provider[] {
  return [
    { provide: CATALOG_PORTS, useFactory: emptyCatalogPorts },
    { provide: MEDIA_RESOLVE_PORTS, useFactory: fixtureMediaPorts },
  ];
}
