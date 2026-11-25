import { describe, expect, it } from 'vitest';
import {
  AppointmentId,
  BarberId,
  LocationId,
  ServiceId,
  ServiceVariantId,
  UtcEpochMs,
} from '@core/primitives';
import {
  BookingLifecycle,
  CancellationReason,
  CancellationReasonSet,
  SameAgainReach,
  SeatLabel,
  type Seat,
  SeatOccupant,
  SeatRebook,
  type ShopNow,
} from '@core/components';
import type { Appointment } from '@core/entities';
import {
  FIXTURE_IDS,
  FIXTURE_NOW,
  FIXTURE_NOW_UTC_MS,
  appointmentFixture,
  barberFixture,
  deepFreeze,
  localDate,
  minute,
  seatFixture,
  serviceFixture,
} from '@core/testing';
import { SameAgainSystem } from './same-again.system';

const S = SameAgainSystem;
const HOUR_MS = 3_600_000;

const IVAN = FIXTURE_IDS.barber;
const PETAR = BarberId.of('b-petar');
const CUT = FIXTURE_IDS.service;
const BEARD = ServiceId.of('svc-beard');
const LONG = ServiceVariantId.of('var-long');
const OTHER_SHOP = LocationId.of('loc-north');

/** A visit `hoursAgo` before the pinned now, on the fixture shop's calendar. */
function visit(
  id: string,
  hoursAgo: number,
  lifecycle: BookingLifecycle,
  overrides: Partial<Appointment> = {},
): Appointment {
  const at = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -hoursAgo * HOUR_MS);
  const start = 540 - hoursAgo * 60;
  return appointmentFixture({
    id: AppointmentId.of(id),
    utcEpochMs: at,
    // Within the pinned day while the start stays at or after midnight;
    // the day before otherwise — what `wasHad` reads is the wall clock.
    localDate: start >= 0 ? FIXTURE_NOW.localDate : localDate('2026-09-20'),
    startMinutes: minute(start >= 0 ? start : 600),
    lifecycle,
    ...overrides,
  });
}

const completed = BookingLifecycle.complete(FIXTURE_NOW_UTC_MS);
const confirmed = BookingLifecycle.confirm(FIXTURE_NOW_UTC_MS);
const cancelled = (): BookingLifecycle =>
  BookingLifecycle.cancel(
    FIXTURE_NOW_UTC_MS,
    CancellationReasonSet.of([CancellationReason.ClientUnwell]),
  );

/** Every shop on the fixture clock. */
const everywhere = (): ShopNow | null => FIXTURE_NOW;

describe('SameAgainSystem.wasHad', () => {
  it('a completed visit was had, whatever its hour', () => {
    expect(S.wasHad(visit('a', 30, completed), FIXTURE_NOW)).toBe(true);
    const later = appointmentFixture({ lifecycle: completed });
    expect(S.wasHad(later, FIXTURE_NOW)).toBe(true);
  });

  it('a confirmed visit was had once it began on its shop’s clock', () => {
    expect(S.wasHad(visit('a', 1, confirmed), FIXTURE_NOW)).toBe(true);
    // Its start minute is the shop's "now": begun.
    expect(S.wasHad(visit('a', 0, confirmed), FIXTURE_NOW)).toBe(true);
  });

  it('a confirmed visit still to come was not', () => {
    const later = appointmentFixture({ lifecycle: confirmed });
    expect(S.wasHad(later, FIXTURE_NOW)).toBe(false);
  });

  it('pending, no-show and cancelled visits were not had', () => {
    const pending = BookingLifecycle.pending(FIXTURE_NOW_UTC_MS);
    const noShow = BookingLifecycle.noShow(FIXTURE_NOW_UTC_MS);
    expect(S.wasHad(visit('a', 5, pending), FIXTURE_NOW)).toBe(false);
    expect(S.wasHad(visit('a', 5, noShow), FIXTURE_NOW)).toBe(false);
    expect(S.wasHad(visit('a', 5, cancelled()), FIXTURE_NOW)).toBe(false);
  });
});

describe('SameAgainSystem.sourceOf', () => {
  it('picks the newest visit the person had, in any input order', () => {
    const older = visit('older', 30, completed);
    const newer = visit('newer', 2, confirmed);
    expect(S.sourceOf([older, newer], everywhere)?.id).toBe('newer');
    expect(S.sourceOf([newer, older], everywhere)?.id).toBe('newer');
  });

  it('skips a newer visit that did not happen, and one still to come', () => {
    const had = visit('had', 30, completed);
    const called = visit('called', 2, cancelled());
    const ahead = appointmentFixture({
      id: AppointmentId.of('ahead'),
      lifecycle: confirmed,
    });
    expect(S.sourceOf([ahead, called, had], everywhere)?.id).toBe('had');
  });

  it('judges each visit on its own shop’s clock, and skips a shop with none', () => {
    const elsewhere = visit('elsewhere', 2, completed, {
      locationId: OTHER_SHOP,
    });
    const here = visit('here', 30, completed);
    const nowOf = (locationId: LocationId): ShopNow | null =>
      locationId === OTHER_SHOP ? null : FIXTURE_NOW;
    expect(S.sourceOf([elsewhere, here], nowOf)?.id).toBe('here');
  });

  it('on an equal instant the smaller id wins', () => {
    const b = visit('b', 3, completed);
    const a = visit('a', 3, completed);
    expect(S.sourceOf([b, a], everywhere)?.id).toBe('a');
  });

  it('answers null when nothing was had', () => {
    expect(S.sourceOf([], everywhere)).toBeNull();
    expect(S.sourceOf([visit('c', 2, cancelled())], everywhere)).toBeNull();
  });
});

describe('SameAgainSystem.reachOf', () => {
  const ivan = barberFixture();
  const petar = barberFixture({ id: PETAR });
  const cut = serviceFixture();
  const beard = serviceFixture({ id: BEARD });

  it('SAME when every barber is listed and performs the service', () => {
    const reach = S.reachOf([seatFixture()], [ivan], [cut]);
    expect(reach).toEqual({
      sameAgainReach: SameAgainReach.Same,
      seatRebooks: [SeatRebook.Kept],
      awayBarberIds: [],
      goneServiceIds: [],
    });
  });

  it('a service with no listed performer is everyone’s', () => {
    const open = serviceFixture({ offerings: [] });
    const reach = S.reachOf([seatFixture()], [ivan], [open]);
    expect(reach.seatRebooks).toEqual([SeatRebook.Kept]);
  });

  it('a barber off the public list leaves the barber open', () => {
    const reach = S.reachOf([seatFixture()], [petar], [cut]);
    expect(reach.sameAgainReach).toBe(SameAgainReach.Changed);
    expect(reach.seatRebooks).toEqual([SeatRebook.AnyBarber]);
    expect(reach.awayBarberIds).toEqual([IVAN]);
  });

  it('a listed barber who no longer performs the service leaves it open too', () => {
    const petarsCut = serviceFixture({
      offerings: [{ ...cut.offerings[0]!, barberId: PETAR }],
    });
    const reach = S.reachOf([seatFixture()], [ivan, petar], [petarsCut]);
    expect(reach.seatRebooks).toEqual([SeatRebook.AnyBarber]);
  });

  it('a service no longer offered, or a retired variant, is gone', () => {
    const variantSeat = seatFixture({ variantId: LONG });
    expect(S.reachOf([seatFixture()], [ivan], [beard])).toEqual({
      sameAgainReach: SameAgainReach.None,
      seatRebooks: [SeatRebook.Gone],
      awayBarberIds: [],
      goneServiceIds: [CUT],
    });
    expect(S.reachOf([variantSeat], [ivan], [cut]).seatRebooks).toEqual([
      SeatRebook.Gone,
    ]);
  });

  it('a variant still offered is kept', () => {
    const withLong = serviceFixture({
      variants: [{ variantId: LONG } as never],
    });
    const seat = seatFixture({ variantId: LONG });
    expect(S.reachOf([seat], [ivan], [withLong]).seatRebooks).toEqual([
      SeatRebook.Kept,
    ]);
  });

  it('a party: CHANGED, each away barber and gone service once, in seat order', () => {
    const seats = [
      seatFixture(),
      seatFixture({ serviceId: BEARD }),
      seatFixture({
        serviceId: BEARD,
        occupant: SeatOccupant.anonymous(SeatLabel.of('Иван (син)')),
      }),
      seatFixture({ barberId: PETAR }),
    ];
    const bothCut = serviceFixture({
      offerings: [...cut.offerings, { ...cut.offerings[0]!, barberId: PETAR }],
    });
    const reach = S.reachOf(seats, [petar], [bothCut]);
    expect(reach).toEqual({
      sameAgainReach: SameAgainReach.Changed,
      seatRebooks: [
        SeatRebook.AnyBarber,
        SeatRebook.Gone,
        SeatRebook.Gone,
        SeatRebook.Kept,
      ],
      awayBarberIds: [IVAN],
      goneServiceIds: [BEARD],
    });
  });

  it('no seats: NONE', () => {
    expect(S.reachOf([], [ivan], [cut]).sameAgainReach).toBe(
      SameAgainReach.None,
    );
  });
});

describe('SameAgainSystem.rebookSeats', () => {
  const ivan = barberFixture();
  const cut = serviceFixture();

  it('keeps a kept seat as it is, opens an away barber, leaves a gone seat out', () => {
    const kept = seatFixture();
    const away = seatFixture({ barberId: PETAR });
    const gone = seatFixture({ serviceId: BEARD });
    const seats = S.rebookSeats([kept, away, gone], [ivan], [cut]);
    expect(seats).toHaveLength(2);
    expect(seats[0]).toBe(kept);
    expect(seats[1]).toEqual({ ...away, barberId: null });
  });

  it('nothing left: no seats', () => {
    expect(S.rebookSeats([seatFixture()], [ivan], [])).toEqual([]);
  });
});

describe('SameAgainSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const visits = deepFreeze([
      visit('a', 30, completed),
      visit('b', 2, confirmed),
    ]);
    const seats: readonly Seat[] = deepFreeze([
      seatFixture(),
      seatFixture({ barberId: PETAR }),
    ]);
    const barbers = deepFreeze([barberFixture()]);
    const services = deepFreeze([serviceFixture()]);
    expect(S.sourceOf(visits, everywhere)).toEqual(
      S.sourceOf(visits, everywhere),
    );
    expect(S.reachOf(seats, barbers, services)).toEqual(
      S.reachOf(seats, barbers, services),
    );
    expect(S.rebookSeats(seats, barbers, services)).toEqual(
      S.rebookSeats(seats, barbers, services),
    );
  });
});
