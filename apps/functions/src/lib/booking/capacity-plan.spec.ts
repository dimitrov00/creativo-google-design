import { describe, expect, it } from 'vitest';
import { Result } from '@creativo/domain/kernel';
import type { LocationDayHours } from '@creativo/domain/catalog';
import {
  CalendarDay,
  StaffScheduleHistory,
  WeeklyPattern,
} from '@creativo/domain/scheduling';
import {
  type PersistedSlot,
  exceptionFromDocument,
} from '@creativo/application/booking';
import {
  type CapacityPlanInput,
  dayKeysBetween,
  horizonSpanEndKey,
  planBarberCapacity,
} from './capacity-plan';

const ZONE = 'Europe/Sofia';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('fixture setup failed');
  return result.value;
}

/** Mon-first: open six days 09:00–17:00, closed Sunday. */
function hours(opens = '09:00', closes = '17:00'): readonly LocationDayHours[] {
  return [
    ...Array.from({ length: 6 }, () => ({
      kind: 'open' as const,
      opens,
      closes,
    })),
    { kind: 'closed' as const },
  ];
}

function schedule(
  segments: readonly { start: string; end: string; locationId: string }[],
  turnaroundMinutes = 0,
) {
  const day = segments.map((segment) => ({ ...segment }));
  const pattern = unwrap(
    WeeklyPattern.create({
      byWeekday: {
        monday: day,
        tuesday: day,
        wednesday: day,
        thursday: day,
        friday: day,
        saturday: day,
      },
    }),
  );
  return {
    history: StaffScheduleHistory.startingWith(
      pattern,
      unwrap(CalendarDay.create('2026-01-01', ZONE)),
    ),
    turnaroundMinutes,
  };
}

function busy(from: string, to: string, dayKey: string): PersistedSlot {
  return {
    startIso: `${dayKey}T${from}:00+03:00`,
    endIso: `${dayKey}T${to}:00+03:00`,
    zone: ZONE,
  };
}

/** 2026-08-03 is a Monday. */
function input(overrides: Partial<CapacityPlanInput> = {}): CapacityPlanInput {
  return {
    barberId: 'b1',
    dayKeys: ['2026-08-03'],
    zone: ZONE,
    schedule: schedule([{ start: '09:00', end: '17:00', locationId: 'loc-a' }]),
    hoursByLocation: new Map([['loc-a', hours()]]),
    busyByDay: new Map(),
    exceptionByDay: new Map(),
    ...overrides,
  };
}

function entryFor(
  plans: ReturnType<typeof planBarberCapacity>,
  dayKey: string,
) {
  for (const plan of plans) {
    const found = plan.entries.find((entry) => entry.dayKey === dayKey);
    if (found) return found;
  }
  throw new Error(`no entry for ${dayKey}`);
}

describe('planBarberCapacity', () => {
  it('yields the full rostered minutes on an empty day', () => {
    const plans = planBarberCapacity(input());
    expect(entryFor(plans, '2026-08-03').contribution).toEqual({
      'loc-a': 480,
    });
  });

  it('pads busy with the turnaround on both sides before subtracting', () => {
    const plans = planBarberCapacity(
      input({
        schedule: schedule(
          [{ start: '09:00', end: '17:00', locationId: 'loc-a' }],
          15,
        ),
        busyByDay: new Map([
          ['2026-08-03', [busy('10:00', '11:00', '2026-08-03')]],
        ]),
      }),
    );
    // 480 − (60 busy + 15 either side) = 390.
    expect(entryFor(plans, '2026-08-03').contribution).toEqual({
      'loc-a': 390,
    });
  });

  it('clamps rostered time to the shop published hours', () => {
    const plans = planBarberCapacity(
      input({ hoursByLocation: new Map([['loc-a', hours('09:00', '13:00')]]) }),
    );
    expect(entryFor(plans, '2026-08-03').contribution).toEqual({
      'loc-a': 240,
    });
  });

  it('splits a two-shop day per location', () => {
    const plans = planBarberCapacity(
      input({
        schedule: schedule([
          { start: '09:00', end: '13:00', locationId: 'loc-a' },
          { start: '14:00', end: '17:00', locationId: 'loc-b' },
        ]),
        hoursByLocation: new Map([
          ['loc-a', hours()],
          ['loc-b', hours()],
        ]),
      }),
    );
    expect(entryFor(plans, '2026-08-03').contribution).toEqual({
      'loc-a': 240,
      'loc-b': 180,
    });
  });

  // The archived-shop leak the adversarial review caught: an absent hours
  // entry means "no bound" to buildDayWindows, which must not let a retired
  // shop's chair sell unclamped hours into "any shop".
  it('drops segments at locations outside the active set entirely', () => {
    const plans = planBarberCapacity(
      input({
        schedule: schedule([
          { start: '09:00', end: '13:00', locationId: 'loc-a' },
          { start: '14:00', end: '17:00', locationId: 'loc-archived' },
        ]),
      }),
    );
    expect(entryFor(plans, '2026-08-03').contribution).toEqual({
      'loc-a': 240,
    });
  });

  it('deletes the entry for a day a published exception closes', () => {
    const exception = exceptionFromDocument({
      barberId: 'b1',
      dayKey: '2026-08-03',
      zone: ZONE,
      locationId: 'loc-a',
      effect: { kind: 'closed' },
    });
    expect(exception).not.toBeNull();
    const plans = planBarberCapacity(
      input({ exceptionByDay: new Map([['2026-08-03', exception]]) }),
    );
    expect(entryFor(plans, '2026-08-03').contribution).toBeNull();
  });

  it('replaces the roster with an hours exception', () => {
    const exception = exceptionFromDocument({
      barberId: 'b1',
      dayKey: '2026-08-03',
      zone: ZONE,
      locationId: 'loc-a',
      effect: { kind: 'hours', ranges: [{ from: '10:00', to: '12:00' }] },
    });
    const plans = planBarberCapacity(
      input({ exceptionByDay: new Map([['2026-08-03', exception]]) }),
    );
    expect(entryFor(plans, '2026-08-03').contribution).toEqual({
      'loc-a': 120,
    });
  });

  it('deletes every entry when the barber has no roster at all', () => {
    const plans = planBarberCapacity(
      input({ schedule: null, dayKeys: ['2026-08-03', '2026-08-04'] }),
    );
    expect(entryFor(plans, '2026-08-03').contribution).toBeNull();
    expect(entryFor(plans, '2026-08-04').contribution).toBeNull();
  });

  it('deletes the entry for a fully booked day rather than keeping zeros', () => {
    const plans = planBarberCapacity(
      input({
        busyByDay: new Map([
          ['2026-08-03', [busy('09:00', '17:00', '2026-08-03')]],
        ]),
      }),
    );
    expect(entryFor(plans, '2026-08-03').contribution).toBeNull();
  });

  it('deletes the entry on the shop rest day', () => {
    // 2026-08-09 is a Sunday: shop closed, roster has no sunday segments.
    const plans = planBarberCapacity(input({ dayKeys: ['2026-08-09'] }));
    expect(entryFor(plans, '2026-08-09').contribution).toBeNull();
  });

  it('groups a month-straddling span into sorted month plans', () => {
    const plans = planBarberCapacity(
      input({ dayKeys: ['2026-08-31', '2026-09-01', '2026-09-02'] }),
    );
    expect(plans.map((plan) => plan.month)).toEqual(['2026-08', '2026-09']);
    expect(plans[0]?.entries.map((entry) => entry.dayKey)).toEqual([
      '2026-08-31',
    ]);
    expect(plans[1]?.entries.map((entry) => entry.dayKey)).toEqual([
      '2026-09-01',
      '2026-09-02',
    ]);
  });
});

describe('dayKeysBetween', () => {
  it('walks the range inclusively', () => {
    expect(dayKeysBetween('2026-08-30', '2026-09-02')).toEqual({
      keys: ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'],
      truncated: false,
    });
  });

  it('flags truncation at 500 days instead of walking forever', () => {
    const result = dayKeysBetween('2026-01-01', '2030-01-01');
    expect(result.keys).toHaveLength(500);
    expect(result.truncated).toBe(true);
  });
});

describe('horizonSpanEndKey', () => {
  it('lands on the true last day of the following month', () => {
    // The failure this encodes: setUTCMonth(+1) on Jan 31 rolls THROUGH
    // short February and left its tail unmaterialized.
    expect(horizonSpanEndKey('2026-01-31')).toBe('2026-02-28');
    expect(horizonSpanEndKey('2024-01-31')).toBe('2024-02-29'); // leap
    expect(horizonSpanEndKey('2026-12-31')).toBe('2027-01-31'); // year roll
    expect(horizonSpanEndKey('2026-10-15')).toBe('2026-11-30'); // mid-month
  });
});
