import { describe, expect, it } from 'vitest';
import type { BarberOffering } from '@core/components';
import { BarberId, Currency, ServiceId } from '@core/primitives';
import { TeamErrorCode } from '@core/errors';
import {
  deepFreeze,
  FIXTURE_IDS,
  serviceFixture,
  termsFixture,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { OfferingEditSystem } from './offering-edit.system';

const IVAN = FIXTURE_IDS.barber;
const NEW = BarberId.of('b-new');
const CUT = ServiceId.of('svc-cut');
const BEARD = ServiceId.of('svc-beard');
const SHAVE = ServiceId.of('svc-shave');

const offering = (barberId: BarberId, cents: number, minutes: number) => ({
  barberId,
  overrides: [],
  ...termsFixture(cents, minutes),
});
/** Terms as an editor types them. */
const typed = (
  barberId: BarberId,
  cents: number,
  minutes: number,
): BarberOffering.Input => ({
  barberId,
  overrides: [],
  priceCents: cents,
  currency: 'EUR',
  durationMinutes: minutes,
  setupMinutes: 0,
  cleanupMinutes: 0,
});

/** Ivan cuts and trims beards; nobody is listed for the shave. */
const catalogue = () => [
  serviceFixture({ id: CUT, offerings: [offering(IVAN, 2800, 30)] }),
  serviceFixture({ id: BEARD, offerings: [offering(IVAN, 1500, 20)] }),
  serviceFixture({ id: SHAVE, offerings: [] }),
];

describe('OfferingEditSystem.plan — a barber’s whole list', () => {
  it('adds the newcomer beside the others, on the services named', () => {
    const changes = unwrapOk(
      OfferingEditSystem.plan(catalogue(), NEW, [
        { serviceId: CUT, offering: typed(NEW, 2000, 45) },
      ]),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.serviceId).toBe(CUT);
    expect(changes[0]?.offerings.map((entry) => entry.barberId)).toEqual([
      IVAN,
      NEW,
    ]);
    expect(changes[0]?.offerings[1]).toMatchObject({
      priceCents: 2000,
      durationMinutes: 45,
    });
  });

  it('writes only what changes: a new price replaces in place, an unnamed service loses the barber, the same terms write nothing', () => {
    const changes = unwrapOk(
      OfferingEditSystem.plan(catalogue(), IVAN, [
        { serviceId: CUT, offering: typed(IVAN, 3000, 30) },
      ]),
    );
    expect(changes.map((change) => change.serviceId)).toEqual([CUT, BEARD]);
    expect(changes[0]?.offerings).toMatchObject([{ priceCents: 3000 }]);
    expect(changes[1]?.offerings).toEqual([]);

    expect(
      unwrapOk(
        OfferingEditSystem.plan(catalogue(), IVAN, [
          { serviceId: CUT, offering: typed(IVAN, 2800, 30) },
          { serviceId: BEARD, offering: typed(IVAN, 1500, 20) },
        ]),
      ),
    ).toEqual([]);
  });

  it('refuses a service named twice, another barber’s offering, terms the catalogue’s guard rejects, a foreign currency and an unknown service', () => {
    const refusal = (entries: Parameters<typeof OfferingEditSystem.plan>[2]) =>
      unwrapErr(OfferingEditSystem.plan(catalogue(), NEW, entries));
    expect(
      refusal([
        { serviceId: CUT, offering: typed(NEW, 2000, 30) },
        { serviceId: CUT, offering: typed(NEW, 2100, 30) },
      ]),
    ).toEqual({ errorCode: TeamErrorCode.InvalidInput, field: 'offerings' });
    expect(
      refusal([{ serviceId: CUT, offering: typed(IVAN, 2000, 30) }]),
    ).toEqual({ errorCode: TeamErrorCode.InvalidInput, field: 'offerings' });
    expect(
      refusal([{ serviceId: CUT, offering: typed(NEW, 2000, 0) }]),
    ).toEqual({ errorCode: TeamErrorCode.InvalidInput, field: 'offerings' });
    // Only EUR is priced today: another currency is the guard's refusal.
    expect(
      refusal([
        {
          serviceId: CUT,
          offering: { ...typed(NEW, 2000, 30), currency: 'USD' },
        },
      ]),
    ).toEqual({ errorCode: TeamErrorCode.InvalidInput, field: 'offerings' });
    // A service stored in another currency never takes a EUR offering.
    const inLeva = [
      serviceFixture({ id: CUT, currency: Currency.BGN, offerings: [] }),
    ];
    expect(
      unwrapErr(
        OfferingEditSystem.plan(inLeva, NEW, [
          { serviceId: CUT, offering: typed(NEW, 2000, 30) },
        ]),
      ),
    ).toEqual({ errorCode: TeamErrorCode.InvalidInput, field: 'currency' });
    const gone = ServiceId.of('svc-gone');
    expect(
      refusal([{ serviceId: gone, offering: typed(NEW, 2000, 30) }]),
    ).toEqual({ errorCode: TeamErrorCode.ServiceUnknown, serviceId: gone });
  });
});

describe('OfferingEditSystem.copied — «Копирай цените от»', () => {
  it('gives the newcomer the source’s terms on every service the source performs, and nothing else', () => {
    const changes = OfferingEditSystem.copied(catalogue(), IVAN, NEW);
    expect(changes.map((change) => change.serviceId)).toEqual([CUT, BEARD]);
    expect(changes[0]?.offerings).toEqual([
      offering(IVAN, 2800, 30),
      offering(NEW, 2800, 30),
    ]);
  });

  it('is a no-op the second time, and for a barber copying from themselves', () => {
    const copied = catalogue().map((service) => {
      const change = OfferingEditSystem.copied(catalogue(), IVAN, NEW).find(
        (entry) => entry.serviceId === service.id,
      );
      return change === undefined
        ? service
        : { ...service, offerings: change.offerings };
    });
    expect(OfferingEditSystem.copied(copied, IVAN, NEW)).toEqual([]);
    expect(OfferingEditSystem.copied(catalogue(), IVAN, IVAN)).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const services = deepFreeze(catalogue());
    expect(OfferingEditSystem.copied(services, IVAN, NEW)).toEqual(
      OfferingEditSystem.copied(services, IVAN, NEW),
    );
    expect(
      OfferingEditSystem.plan(services, NEW, [
        { serviceId: CUT, offering: typed(NEW, 2000, 45) },
      ]),
    ).toEqual(
      OfferingEditSystem.plan(services, NEW, [
        { serviceId: CUT, offering: typed(NEW, 2000, 45) },
      ]),
    );
  });
});
