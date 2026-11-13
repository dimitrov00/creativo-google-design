import { describe, expect, it } from 'vitest';
import { BarberId, ServiceId } from '@core/primitives';
import {
  barberFixture,
  deepFreeze,
  FIXTURE_TERMS,
  serviceFixture,
} from '@core/testing';
import { CatalogListingSystem } from './catalog-listing.system';

const ivan = BarberId.of('b-ivan');
const petar = BarberId.of('b-petar');
const offering = (barberId: BarberId) => ({
  barberId,
  overrides: [],
  ...FIXTURE_TERMS,
});

describe('CatalogListingSystem.listedServices', () => {
  const listed = [barberFixture({ id: ivan })];
  const everyone = serviceFixture({ id: ServiceId.of('svc-a'), offerings: [] });
  const ivansOnly = serviceFixture({
    id: ServiceId.of('svc-b'),
    offerings: [offering(ivan)],
  });
  const shared = serviceFixture({
    id: ServiceId.of('svc-c'),
    offerings: [offering(petar), offering(ivan)],
  });
  const petarsOnly = serviceFixture({
    id: ServiceId.of('svc-d'),
    offerings: [offering(petar)],
  });

  it('keeps a service everyone performs, and one only listed barbers perform — the same objects', () => {
    const out = CatalogListingSystem.listedServices(
      [everyone, ivansOnly],
      listed,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(everyone);
    expect(out[1]).toBe(ivansOnly);
  });

  it('drops an unlisted performer from a shared service, and drops a service only unlisted barbers perform', () => {
    const out = CatalogListingSystem.listedServices(
      [shared, petarsOnly],
      listed,
    );
    expect(out.map((service) => service.id)).toEqual([ServiceId.of('svc-c')]);
    expect(out[0]?.offerings.map((entry) => entry.barberId)).toEqual([ivan]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const services = deepFreeze([everyone, shared, petarsOnly]);
    const barbers = deepFreeze(listed);
    const once = CatalogListingSystem.listedServices(services, barbers);
    expect(CatalogListingSystem.listedServices(services, barbers)).toEqual(
      once,
    );
  });
});
