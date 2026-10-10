import { describe, expect, it } from 'vitest';
import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import { Service } from '@creativo/domain/catalog';
import {
  BookingPolicy,
  CalendarDay,
  StaffScheduleHistory,
  WeeklyPattern,
} from '@creativo/domain/scheduling';
import {
  type BookingSnapshot,
  type RequestedSeat,
  type StaffTermsOverride,
  decideBooking,
} from './decide-booking';

/*
 * The Phase 2 shim's own fidelity cases: what the legacy `decideBooking`
 * wrote that the ecs-core structs alone cannot carry back, pinned against
 * the shim (decide-booking.spec.ts keeps its cases unchanged). Both were
 * found by a differential run of the legacy decision against the shim.
 */

const ZONE = 'Europe/Sofia';
const OWNER = 'user-1';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** 2026-08-03 is a Monday in Sofia — the fixture roster works Mondays. */
function at(hour: number): ZonedDateTime {
  return unwrap(
    ZonedDateTime.fromParts(
      { year: 2026, month: 8, day: 3, hour, minute: 0 },
      ZONE,
    ),
  );
}

const OPEN = { kind: 'open' as const, opens: '09:00', closes: '20:00' };

/** Ivan's fade: 45,00 € / 30 min, 10 minutes of cleanup. */
function fadeService(): Service {
  return unwrap(
    Service.create({
      id: 'svc-fade',
      name: { bg: 'Фейд', en: 'Fade' },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits: 4000,
      currencyCode: 'EUR',
      durationMinutes: 60,
      locationIds: ['loc-center'],
      conflictsWith: [],
      variants: [],
      offerings: [
        {
          barberId: 'ivan',
          base: {
            priceMinorUnits: 4500,
            currencyCode: 'EUR',
            durationMinutes: 30,
            cleanupMinutes: 10,
          },
        },
      ],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder: 1,
    }),
  );
}

function snapshot(): BookingSnapshot {
  const day = [{ start: '09:00', end: '18:00', locationId: 'loc-center' }];
  const pattern = unwrap(WeeklyPattern.create({ byWeekday: { monday: day } }));
  return {
    zone: ZONE,
    shopHours: [OPEN, OPEN, OPEN, OPEN, OPEN, OPEN, { kind: 'closed' }],
    services: [fadeService()],
    schedules: new Map([
      [
        'ivan',
        {
          history: StaffScheduleHistory.startingWith(
            pattern,
            unwrap(CalendarDay.create('2026-01-01', ZONE)),
          ),
          turnaroundMinutes: 0,
        },
      ],
    ]),
    busy: new Map(),
    exceptions: new Map(),
  };
}

const SEAT: RequestedSeat = {
  lineId: 'line-1',
  serviceId: 'svc-fade',
  variantId: null,
  barberId: 'ivan',
  startIso: at(12).toISO(),
  subject: { kind: 'self' },
};

/** A staff edit: the seat's stored terms carried as an override. */
function carry(override: StaffTermsOverride) {
  let counter = 0;
  return decideBooking(
    { locationId: 'loc-center', seats: [SEAT] },
    snapshot(),
    {
      now: at(8),
      policy: BookingPolicy.default(),
      nextId: () => `id-${counter++}`,
      ownerUserId: OWNER,
      allowOutsideWindow: true,
      termsOverrides: new Map([['line-1', override]]),
    },
  );
}

describe('decideBooking shim — carried terms rebuild as the legacy decision wrote them', () => {
  it('keeps the catalogue row, with ITS pads, as provenance when an override changes only cleanup', () => {
    const decision = unwrap(carry({ cleanupMinutes: 0 }));
    const [seat] = decision.appointment.seats;

    expect(seat?.terms.cleanupMinutes).toBe(0);
    expect(seat?.overridden()).toBe(true);
    expect(seat?.catalogTerms?.price.toMinorUnits()).toBe(4500);
    expect(seat?.catalogTerms?.durationMinutes).toBe(30);
    expect(seat?.catalogTerms?.cleanupMinutes).toBe(10);
  });

  it('records no provenance when the carried terms equal the catalogue', () => {
    const decision = unwrap(
      carry({
        priceMinorUnits: 4500,
        currencyCode: 'EUR',
        durationMinutes: 30,
        setupMinutes: 0,
        cleanupMinutes: 10,
      }),
    );
    expect(decision.appointment.seats[0]?.catalogTerms).toBeNull();
  });

  it('accepts a staff edit of a visit priced in leva, as the legacy kernel did', () => {
    const decision = unwrap(
      carry({
        priceMinorUnits: 3000,
        currencyCode: 'BGN',
        durationMinutes: 30,
        setupMinutes: 0,
        cleanupMinutes: 10,
      }),
    );
    const [seat] = decision.appointment.seats;

    expect(seat?.terms.price.toMinorUnits()).toBe(3000);
    expect(seat?.terms.price.currencyCode()).toBe('BGN');
  });
});
