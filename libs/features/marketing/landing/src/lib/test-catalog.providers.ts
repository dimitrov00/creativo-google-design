import { Provider } from '@angular/core';
import { Observable, of } from 'rxjs';
import {
  Barber,
  CATALOG_READER,
  type CatalogReader,
  MEDIA_READER,
  MediaRef,
  type MediaReader,
  type MediaVariant,
  Service,
  ok,
  type Result,
} from '@creativo/application/catalog';
import { BARBERS, SERVICES, type ServiceVm } from './content/landing-content';

/**
 * Serves the SAME bundled demo fixture the landing used to render
 * directly, but as real `Service`/`Barber` aggregates behind
 * `CATALOG_READER`.
 *
 * Deliberately not hand-written stub objects: round-tripping the fixture
 * through `Service.create` means these specs also prove the domain →
 * `ServiceVm` mapping, and any aggregate invariant the fixture violates
 * fails here instead of silently in production.
 */

const unwrap = <T>(result: { isSuccess(): boolean; value?: T }): T => {
  if (!result.isSuccess()) {
    throw new Error('landing test fixture violates a domain invariant');
  }
  return result.value as T;
};

/** `14.5` major EUR → `1450` minor. */
const minor = (major: number) => Math.round(major * 100);

function coverRefFor(service: ServiceVm): MediaRef | undefined {
  if (!service.coverSrc) return undefined;
  return unwrap(
    MediaRef.create({
      id: `media-${service.id}`,
      path: service.coverSrc,
      width: 1200,
      height: 1500,
    }),
  );
}

function serviceFromVm(vm: ServiceVm): Service {
  // The shelf fixture prices everything through `offerings`; the cheapest
  // one doubles as the aggregate's base terms so a service is never
  // priceless.
  const cheapest = vm.offerings.reduce(
    (best, offering) =>
      offering.base.price < best.base.price ? offering : best,
    vm.offerings[0]!,
  );
  return unwrap(
    Service.create({
      id: vm.id,
      name: vm.name,
      description: vm.description,
      categoryId: 'cat-hair',
      priceMinorUnits: minor(cheapest.base.price),
      currencyCode: 'EUR',
      durationMinutes: cheapest.base.minutes,
      variants: vm.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
      })),
      offerings: vm.offerings.map((offering) => ({
        barberId: offering.barberId,
        base: {
          priceMinorUnits: minor(offering.base.price),
          currencyCode: 'EUR',
          durationMinutes: offering.base.minutes,
        },
        ...(offering.byVariant
          ? {
              byVariant: Object.fromEntries(
                Object.entries(offering.byVariant).map(([id, terms]) => [
                  id,
                  {
                    priceMinorUnits: minor(terms.price),
                    currencyCode: 'EUR',
                    durationMinutes: terms.minutes,
                  },
                ]),
              ),
            }
          : {}),
      })),
      cover: coverRefFor(vm),
      locationIds: [],
      conflictsWith: [],
      composition:
        vm.kind === 'bundle'
          ? { kind: 'bundle', includes: [...(vm.includes ?? [])] }
          : { kind: 'single' },
      upsellOnly: vm.upsellOnly,
      popular: false,
      status: 'active',
      sortOrder: 0,
    }),
  );
}

function barbers(): readonly Barber[] {
  return BARBERS.map((vm, index) =>
    unwrap(
      Barber.create({
        id: vm.id,
        name: vm.name,
        handle: vm.id,
        title: vm.title,
        bio: vm.bio,
        avatar: unwrap(
          MediaRef.create({
            id: `media-barber-${vm.id}`,
            path: vm.avatarSrc,
            width: 1200,
            height: 1500,
          }),
        ),
        locationIds: [],
        status: 'active',
        sortOrder: index,
      }),
    ),
  );
}

class FixtureCatalogReader implements Partial<CatalogReader> {
  private readonly services = SERVICES.map(serviceFromVm);
  private readonly people = barbers();

  listActiveServices(): Observable<Result<readonly Service[], never>> {
    return of(ok(this.services));
  }
  listActiveBarbers(): Observable<Result<readonly Barber[], never>> {
    return of(ok(this.people));
  }
}

/** Echoes the ref's own path back as the URL — the fixture stores real `/work/*.jpg` paths. */
class FixtureMediaReader implements MediaReader {
  async resolve(
    ref: MediaRef,
  ): Promise<Result<readonly MediaVariant[], never>> {
    return ok([{ width: ref.width, url: ref.path }]);
  }
}

export function provideTestCatalog(): Provider[] {
  return [
    { provide: CATALOG_READER, useClass: FixtureCatalogReader },
    { provide: MEDIA_READER, useClass: FixtureMediaReader },
  ];
}
