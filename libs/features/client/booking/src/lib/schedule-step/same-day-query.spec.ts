import { describe, expect, it } from 'vitest';
import {
  BookingCart,
  BookingPolicy,
  CalendarDay,
  type ChairTime,
  Interval,
  type MoveRider,
  type ObserveDayAvailabilityInput,
  type Result,
  ZonedDateTime,
} from '@creativo/application/booking';
import { BarberId, LocationId, ServiceId } from '@creativo/application/catalog';
import { sameDayQuery } from './same-day-query';

const ZONE = 'Europe/Sofia';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const cart = BookingCart.empty();
const policy = BookingPolicy.default();
const services = [] as const;
const ivan = unwrap(BarberId.create('ivan'));
const riders: readonly MoveRider[] = [
  {
    serviceId: unwrap(ServiceId.create('svc-beard')),
    barberId: ivan,
    offsetMinutes: 0,
    terms: { durationMinutes: 45, padBeforeMinutes: 0, padAfterMinutes: 0 },
  },
];
const release: readonly ChairTime[] = [
  { barberId: ivan, occupied: Interval.of(0, 45 * 60_000) },
];
const withinMs: readonly Interval[] = [Interval.of(0, 60 * 60_000)];

/**
 * EVERY field of the query, optional ones included: `Required` makes a
 * field added to `ObserveDayAvailabilityInput` fail this spec's type check
 * until it has a value here, and then the per-field test below proves the
 * comparator tells it apart. A fresh literal each call, the way a computed
 * mints one per recompute.
 */
function query(
  change: Partial<ObserveDayAvailabilityInput> = {},
): Required<ObserveDayAvailabilityInput> {
  return {
    cart,
    services,
    barberIds: [unwrap(BarberId.create('ivan'))],
    locationId: unwrap(LocationId.create('loc-center')),
    day: unwrap(CalendarDay.create('2026-08-20', ZONE)),
    policy,
    now: unwrap(ZonedDateTime.fromISO('2026-08-03T09:00:00.000+03:00', ZONE)),
    maxOptions: 50,
    withinMs,
    riders,
    release,
    ...change,
  };
}

/** For every field, a value that asks a different question. */
const DIFFERENT: Required<ObserveDayAvailabilityInput> = {
  cart: BookingCart.empty(),
  services: [],
  barberIds: [unwrap(BarberId.create('niko'))],
  locationId: null,
  day: unwrap(CalendarDay.create('2026-08-21', ZONE)),
  // Another policy, not `default()` again: that is one shared instance.
  policy: unwrap(
    BookingPolicy.create({
      maxPartySize: 5,
      slotStepMinutes: 15,
      minLeadMinutes: 0,
      horizonMonths: 2,
      maxFlexibleDays: 7,
      autoConfirm: true,
      cancellationWindowHours: 24,
    }),
  ),
  now: unwrap(ZonedDateTime.fromISO('2026-08-03T09:01:00.000+03:00', ZONE)),
  maxOptions: 51,
  withinMs: [...withinMs],
  riders: [...riders],
  release: [...release],
};

describe('sameDayQuery — one structural identity for every day query', () => {
  it('holds two fresh literals asking the same question equal', () => {
    expect(sameDayQuery(query(), query())).toBe(true);
  });

  it.each(Object.entries(DIFFERENT))(
    'tells a query apart by `%s` — no field of the query is ignored',
    (field, value) => {
      const change = { [field]: value } as Partial<ObserveDayAvailabilityInput>;
      expect(sameDayQuery(query(), query(change))).toBe(false);
    },
  );

  it('asks nothing new of a pool listed in the same order by fresh ids', () => {
    expect(
      sameDayQuery(
        query(),
        query({ barberIds: [unwrap(BarberId.create('ivan'))] }),
      ),
    ).toBe(true);
  });

  it('equals `null` only to `null`, so readiness always passes', () => {
    expect(sameDayQuery(null, null)).toBe(true);
    expect(sameDayQuery(null, query())).toBe(false);
    expect(sameDayQuery(query(), null)).toBe(false);
  });
});
