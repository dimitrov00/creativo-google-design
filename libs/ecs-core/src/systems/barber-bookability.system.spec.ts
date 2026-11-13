import { describe, expect, it } from 'vitest';
import {
  BarberPreference,
  BarberStatus,
  PlacementPolicy,
} from '@core/components';
import { BarberBookabilityReason, BarberId } from '@core/primitives';
import {
  barberFixture,
  deepFreeze,
  FIXTURE_NOW_UTC_MS,
  localDate,
  serviceFixture,
} from '@core/testing';
import { BarberBookabilitySystem } from './barber-bookability.system';

const { verdictOf } = BarberBookabilitySystem;
const client = PlacementPolicy.clientDefault();
const staff = PlacementPolicy.staffPlacement();
const day = localDate('2026-10-07');
const at = FIXTURE_NOW_UTC_MS;
const R = BarberBookabilityReason;

/** Ivan performs the fixture service (`serviceFixture` lists only him). */
const service = serviceFixture();
const ivan = barberFixture();

describe('BarberBookabilitySystem.verdictOf', () => {
  it('books a public barber inside their period, for a service they perform — named or «Който и да е»', () => {
    expect(verdictOf(ivan, service, client, null, day)).toBeNull();
    expect(
      verdictOf(ivan, service, client, BarberPreference.Specific, day),
    ).toBeNull();
    expect(verdictOf(ivan, service, client, BarberPreference.Any, day)).toBe(
      null,
    );
  });

  it('refuses a draft and a departed barber to everyone, staff included', () => {
    const draft = barberFixture(
      {},
      {
        barberStatus: BarberStatus.Draft,
        barberStatusChangedAtUtcMs: at,
        barberDraftTargetStatus: BarberStatus.Public,
      },
    );
    const departed = barberFixture(
      {},
      {
        barberStatus: BarberStatus.Departed,
        barberStatusChangedAtUtcMs: at,
        barberDepartedUserId: null,
        barberSessionsRevokedAtUtcMs: null,
        barberRehireStatus: BarberStatus.Public,
      },
    );
    for (const placement of [client, staff]) {
      expect(verdictOf(draft, service, placement, null, day)).toBe(R.NotReady);
      expect(verdictOf(departed, service, placement, null, day)).toBe(
        R.Departed,
      );
    }
  });

  it('lets staff book a staff-only barber, never a client online', () => {
    const student = barberFixture(
      {},
      { barberStatus: BarberStatus.StaffOnly, barberStatusChangedAtUtcMs: at },
    );
    expect(verdictOf(student, service, client, null, day)).toBe(R.StaffOnly);
    expect(verdictOf(student, service, staff, null, day)).toBeNull();
  });

  it('holds staff and clients alike to the working period, both ends inclusive', () => {
    const newcomer = barberFixture({
      barberStartsLocalDate: localDate('2026-12-01'),
      barberLastWorkingLocalDate: localDate('2026-12-31'),
    });
    for (const placement of [client, staff]) {
      expect(
        verdictOf(newcomer, service, placement, null, localDate('2026-11-30')),
      ).toBe(R.BeforeStart);
      expect(
        verdictOf(newcomer, service, placement, null, localDate('2026-12-01')),
      ).toBeNull();
      expect(
        verdictOf(newcomer, service, placement, null, localDate('2026-12-31')),
      ).toBeNull();
      expect(
        verdictOf(newcomer, service, placement, null, localDate('2027-01-01')),
      ).toBe(R.AfterLastDay);
    }
  });

  it('keeps a barber out of the pool from «Който и да е» seats only — a named seat still books them', () => {
    const outOfPool = barberFixture({ barberJoinsAnyPool: false });
    expect(
      verdictOf(outOfPool, service, client, BarberPreference.Any, day),
    ).toBe(R.NotInAnyPool);
    expect(
      verdictOf(outOfPool, service, client, BarberPreference.Specific, day),
    ).toBeNull();
    expect(verdictOf(outOfPool, service, client, null, day)).toBeNull();
  });

  it('refuses a barber the service does not list; a service that lists nobody is everyone’s', () => {
    const niko = barberFixture({ id: BarberId.of('b-niko') });
    expect(verdictOf(niko, service, staff, null, day)).toBe(R.DoesNotOffer);
    expect(
      verdictOf(niko, serviceFixture({ offerings: [] }), client, null, day),
    ).toBeNull();
  });

  it('answers the lifecycle before the period, the period before the pool, the pool before the offering', () => {
    const everythingWrong = barberFixture(
      {
        id: BarberId.of('b-niko'),
        barberJoinsAnyPool: false,
        barberStartsLocalDate: localDate('2027-01-01'),
      },
      { barberStatus: BarberStatus.StaffOnly, barberStatusChangedAtUtcMs: at },
    );
    expect(
      verdictOf(everythingWrong, service, client, BarberPreference.Any, day),
    ).toBe(R.StaffOnly);
    expect(
      verdictOf(everythingWrong, service, staff, BarberPreference.Any, day),
    ).toBe(R.BeforeStart);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const barber = deepFreeze(barberFixture({ barberJoinsAnyPool: false }));
    const frozen = deepFreeze(serviceFixture());
    const once = verdictOf(barber, frozen, client, BarberPreference.Any, day);
    expect(verdictOf(barber, frozen, client, BarberPreference.Any, day)).toBe(
      once,
    );
  });
});
