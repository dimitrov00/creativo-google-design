import { describe, expect, it } from 'vitest';
import { BarberId, LocationId, ServiceId } from '@creativo/domain/catalog';
import { BarberDay } from './barber-day';
import {
  chairTimeUtilisation,
  committedButUnsellableMinutes,
  fragmentationRatio,
  utilisation,
} from './barber-day-totals';
import { CalendarDay } from './calendar-day';
import { AppointmentId, SeatId } from './ids';
import { Interval } from './interval';
import {
  OccupancyBlock,
  bufferBlockId,
  exceptionBlockId,
  serviceBlockId,
} from './occupancy-block';
import { OCCUPANCY_POLICY_VERSION, classifyOccupancy } from './occupancy-class';
import type { OccupancyReason } from './occupancy-reason';
import { RosterWindow } from './roster-window';
import { ScheduleExceptionId } from './schedule-exception';

const zone = 'Europe/Sofia';

function day(key = '2026-07-29'): CalendarDay {
  const result = CalendarDay.create(key, zone);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function locationId(): LocationId {
  const result = LocationId.create('loc-center');
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function barberId(): BarberId {
  const result = BarberId.create('ivan');
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function serviceId(): ServiceId {
  const result = ServiceId.create('svc-classic-cut');
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

/**
 * Local clock → epoch ms on the test day. Accepts fractional hours (`10.75`
 * is 10:45) so the fixtures read as durations rather than as clock arithmetic.
 */
function at(hour: number): number {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  const instant = day().startOfDay().atTime(whole, minutes);
  if (instant.isFailure()) throw new Error(`bad fixture: ${hour}`);
  return instant.value.toMillis();
}

function window(fromH: number, toH: number): RosterWindow {
  return {
    interval: Interval.of(at(fromH), at(toH)),
    locationId: locationId(),
  };
}

const SERVICE_REASON: OccupancyReason = {
  kind: 'service',
  appointmentId: AppointmentId.generate(),
  seatId: SeatId.generate(),
  serviceId: serviceId(),
  variantId: null,
  origin: 'online',
  outcome: 'worked',
};

function block(options: {
  id?: string;
  fromH: number;
  toH: number;
  reason?: OccupancyReason;
  revenueMinorUnits?: number;
  outsideWindow?: boolean;
}): OccupancyBlock {
  const reason = options.reason ?? SERVICE_REASON;
  return OccupancyBlock.classifying(
    {
      id: options.id ?? `blk-${options.fromH}-${options.toH}`,
      interval: Interval.of(at(options.fromH), at(options.toH)),
      locationId: locationId(),
      reason,
      revenueMinorUnits: options.revenueMinorUnits ?? 0,
      currencyCode: 'EUR',
      outsideWindow: options.outsideWindow ?? false,
    },
    OCCUPANCY_POLICY_VERSION,
  );
}

function dayWith(
  windows: readonly RosterWindow[],
  blocks: readonly OccupancyBlock[],
): BarberDay {
  const result = BarberDay.create({
    barberId: barberId(),
    day: day(),
    windows,
    blocks,
  });
  if (result.isFailure()) throw new Error(`bad fixture: ${result.error.code}`);
  return result.value;
}

describe('classifyOccupancy — the owner’s classification table', () => {
  const exceptionId = ScheduleExceptionId.of('exc-1');

  it('counts worked and scheduled service as productive, sellable time', () => {
    for (const outcome of ['worked', 'scheduled'] as const) {
      expect(classifyOccupancy({ ...SERVICE_REASON, outcome })).toEqual({
        capacity: 'scheduled',
        productive: true,
        paid: true,
      });
    }
  });

  it('keeps a NO-SHOW in the denominator but out of the numerator', () => {
    // The distinction the whole taxonomy exists for: "nobody booked" is a
    // marketing problem, "somebody booked and didn't come" is a deposits
    // problem, and a naive model shows both as idle time.
    expect(
      classifyOccupancy({ ...SERVICE_REASON, outcome: 'no_show' }),
    ).toEqual({ capacity: 'scheduled', productive: false, paid: true });
  });

  it('keeps an ADMIN block in the denominator', () => {
    // A manager reserving two hours consumed sellable time; excluding it
    // would let bad scheduling hide behind a block.
    expect(
      classifyOccupancy({
        kind: 'admin',
        absenceId: exceptionId,
        note: 'stocktake',
      }),
    ).toEqual({ capacity: 'scheduled', productive: false, paid: true });
  });

  it('splits breaks on whether the shop pays for them', () => {
    expect(classifyOccupancy({ kind: 'break', paid: true }).capacity).toBe(
      'scheduled',
    );
    expect(classifyOccupancy({ kind: 'break', paid: false }).capacity).toBe(
      'excluded',
    );
  });

  it('EXCLUDES time nobody could have sold', () => {
    // Punishing a barber's utilisation for a shop decision is wrong — these
    // stay visible as their own lines instead.
    for (const reason of [
      { kind: 'training', absenceId: exceptionId, topic: null },
      { kind: 'travel', absenceId: exceptionId, toLocationId: locationId() },
      { kind: 'time_off', absenceId: exceptionId },
      { kind: 'sick', absenceId: exceptionId, paid: true },
    ] as const) {
      expect(classifyOccupancy(reason).capacity).toBe('excluded');
      expect(classifyOccupancy(reason).productive).toBe(false);
    }
  });

  it('tracks who pays: unpaid sick and time off cost the shop nothing', () => {
    expect(
      classifyOccupancy({ kind: 'sick', absenceId: exceptionId, paid: false })
        .paid,
    ).toBe(false);
    expect(
      classifyOccupancy({ kind: 'time_off', absenceId: exceptionId }).paid,
    ).toBe(false);
    expect(
      classifyOccupancy({
        kind: 'training',
        absenceId: exceptionId,
        topic: null,
      }).paid,
    ).toBe(true);
  });
});

describe('OccupancyBlock', () => {
  it('FREEZES the classification at write time', () => {
    // The Seat.terms principle applied to policy: a rule change tomorrow must
    // not silently restate last July.
    const stored = OccupancyBlock.of({
      id: 'blk-1',
      interval: Interval.of(at(10), at(11)),
      locationId: locationId(),
      reason: { ...SERVICE_REASON, outcome: 'no_show' },
      // Deliberately NOT what today's policy would say.
      klass: { capacity: 'excluded', productive: true, paid: false },
      policyVersion: 0,
      revenueMinorUnits: 0,
      currencyCode: 'EUR',
      outsideWindow: false,
    });
    expect(stored.consumesCapacity()).toBe(false);
    expect(stored.isProductive()).toBe(true);
    expect(stored.policyVersion).toBe(0);
  });

  it('mints deterministic ids — the idempotency key', () => {
    expect(serviceBlockId('appt-1', 'seat-1')).toBe('svc:appt-1:seat-1');
    expect(bufferBlockId('appt-1', 'seat-1')).toBe('buf:appt-1:seat-1');
    expect(exceptionBlockId('exc-1')).toBe('exc:exc-1');
    expect(exceptionBlockId('exc-1', 2)).toBe('exc:exc-1:2');
  });

  it('reports exact minutes and optional revenue', () => {
    const worked = block({ fromH: 10, toH: 10.75, revenueMinorUnits: 1450 });
    expect(worked.minutes()).toBe(45);
    expect(worked.revenue()?.toMinorUnits()).toBe(1450);
    expect(block({ fromH: 10, toH: 11 }).revenue()).toBeNull();
  });
});

describe('BarberDay', () => {
  it('REFUSES two overlapping blocks — a barber in two chairs at once', () => {
    const result = BarberDay.create({
      barberId: barberId(),
      day: day(),
      windows: [window(9, 18)],
      blocks: [
        block({ id: 'a', fromH: 10, toH: 11 }),
        block({ id: 'b', fromH: 10.5, toH: 11.5 }),
      ],
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('scheduling.barber_day.block_collision');
    }
  });

  it('accepts abutting blocks — back-to-back is not a collision', () => {
    expect(
      BarberDay.create({
        barberId: barberId(),
        day: day(),
        windows: [window(9, 18)],
        blocks: [
          block({ id: 'a', fromH: 10, toH: 11 }),
          block({ id: 'b', fromH: 11, toH: 12 }),
        ],
      }).isSuccess(),
    ).toBe(true);
  });

  it('computes free time as windows minus busy', () => {
    const barberDay = dayWith([window(9, 18)], [block({ fromH: 10, toH: 11 })]);
    expect(barberDay.free()).toEqual([
      Interval.of(at(9), at(10)),
      Interval.of(at(11), at(18)),
    ]);
  });

  it('place() REPLACES by id, so a duplicated event is harmless', () => {
    // Deterministic ids plus replace-semantics is why this design needs no
    // processed-event table: applying the same event twice lands identically.
    const first = dayWith([window(9, 18)], []);
    const withBlock = first.place(block({ id: 'svc:a:1', fromH: 10, toH: 11 }));
    if (withBlock.isFailure()) throw new Error('bad fixture');
    const again = withBlock.value.place(
      block({ id: 'svc:a:1', fromH: 10, toH: 11 }),
    );
    if (again.isFailure()) throw new Error('bad fixture');

    expect(again.value.blocks).toHaveLength(1);
    expect(again.value.free()).toEqual(withBlock.value.free());
  });

  it('release() frees the slot again — a cancellation must not keep blocking', () => {
    const booked = dayWith(
      [window(9, 18)],
      [block({ id: 'svc:a:1', fromH: 10, toH: 11 })],
    );
    expect(booked.release('svc:a:1').free()).toEqual([
      Interval.of(at(9), at(18)),
    ]);
  });

  it('withWindows re-materialises the roster but KEEPS what is booked', () => {
    const booked = dayWith([window(9, 18)], [block({ fromH: 10, toH: 11 })]);
    const shrunk = booked.withWindows([window(9, 12)]);
    // The commitment survives a roster change — it is a fact about work.
    expect(shrunk.blocks).toHaveLength(1);
    expect(shrunk.free()).toEqual([
      Interval.of(at(9), at(10)),
      Interval.of(at(11), at(12)),
    ]);
  });

  it('sorts blocks chronologically so a rebuild is byte-stable', () => {
    const barberDay = dayWith(
      [window(9, 18)],
      [
        block({ id: 'late', fromH: 15, toH: 16 }),
        block({ id: 'early', fromH: 10, toH: 11 }),
      ],
    );
    expect(barberDay.blocks.map((b) => b.id)).toEqual(['early', 'late']);
  });
});

describe('BarberDay.toPublicProjection — the privacy boundary', () => {
  it('publishes geometry ONLY — no reasons, no ids, no revenue', () => {
    const barberDay = dayWith(
      [window(9, 18)],
      [
        block({ id: 'svc:a:1', fromH: 10, toH: 11, revenueMinorUnits: 1450 }),
        block({
          id: 'exc:1',
          fromH: 13,
          toH: 14,
          reason: {
            kind: 'sick',
            absenceId: ScheduleExceptionId.of('exc-1'),
            paid: true,
          },
        }),
      ],
    );
    const projection = barberDay.toPublicProjection();

    // Firestore rules cannot redact fields, so anything readable by an
    // anonymous visitor has to be in a document that simply does not contain
    // the secret. `sick` in particular is GDPR Art. 9 health data.
    const serialised = JSON.stringify(projection);
    expect(serialised).not.toContain('sick');
    expect(serialised).not.toContain('svc:a:1');
    expect(serialised).not.toContain('1450');
    expect(serialised).not.toContain('reason');
    // Pin the exact key set: one field added later (an appointmentId "for
    // debugging", a serviceId "for a nicer UI") silently publishes booking
    // history to the internet.
    expect(Object.keys(projection).sort()).toEqual([
      'barberId',
      'busy',
      'dayKey',
      'windows',
      'zone',
    ]);
  });

  it('MERGES busy intervals, so a visitor cannot count clients served', () => {
    const barberDay = dayWith(
      [window(9, 18)],
      [
        block({ id: 'a', fromH: 10, toH: 11 }),
        block({ id: 'b', fromH: 11, toH: 12 }),
        block({ id: 'c', fromH: 12, toH: 12.5 }),
      ],
    );
    // Three bookings, one published interval — density leaks (which anyone
    // learns by looking through the window), headcount does not.
    expect(barberDay.toPublicProjection().busy).toEqual([
      Interval.of(at(10), at(12.5)),
    ]);
  });
});

describe('BarberDay.totals — the numbers the owner asked for', () => {
  const exceptionId = ScheduleExceptionId.of('exc-1');

  it('folds a straightforward day', () => {
    const barberDay = dayWith(
      [window(9, 18)], // 9 hours rostered
      [
        block({ id: 'a', fromH: 10, toH: 11, revenueMinorUnits: 1450 }),
        block({ id: 'b', fromH: 14, toH: 15, revenueMinorUnits: 1300 }),
      ],
    );
    const totals = barberDay.totals();

    expect(totals.rosteredMinutes).toBe(540);
    expect(totals.scheduledMinutes).toBe(540);
    expect(totals.productiveMinutes).toBe(120);
    expect(totals.serviceCount).toBe(2);
    expect(totals.revenueMinorUnits).toBe(2750);
    expect(totals.idleMinutes).toBe(420);
    expect(utilisation(totals)).toBeCloseTo(120 / 540);
  });

  it('separates a no-show from idle time — the headline distinction', () => {
    const barberDay = dayWith(
      [window(9, 12)], // 180 minutes
      [
        block({ id: 'a', fromH: 9, toH: 10, revenueMinorUnits: 1450 }),
        block({
          id: 'b',
          fromH: 10,
          toH: 11,
          reason: { ...SERVICE_REASON, outcome: 'no_show' },
        }),
      ],
    );
    const totals = barberDay.totals();

    // The no-show occupied sellable time and produced nothing — visible as
    // its own line rather than merged into the 60 minutes nobody booked.
    expect(totals.noShowMinutes).toBe(60);
    expect(totals.noShowCount).toBe(1);
    expect(totals.idleMinutes).toBe(60);
    expect(totals.productiveMinutes).toBe(60);
    expect(totals.scheduledMinutes).toBe(180);
    expect(utilisation(totals)).toBeCloseTo(60 / 180);
  });

  it('drops unsellable time OUT of the denominator', () => {
    const barberDay = dayWith(
      [window(9, 18)], // 540 rostered
      [
        block({ id: 'a', fromH: 9, toH: 12, revenueMinorUnits: 4000 }),
        block({
          id: 'off',
          fromH: 14,
          toH: 18,
          reason: { kind: 'training', absenceId: exceptionId, topic: 'colour' },
        }),
      ],
    );
    const totals = barberDay.totals();

    expect(totals.excludedMinutes.training).toBe(240);
    // 540 rostered − 240 training = 300 sellable, of which 180 was worked.
    expect(totals.scheduledMinutes).toBe(300);
    expect(utilisation(totals)).toBeCloseTo(180 / 300);
    expect(committedButUnsellableMinutes(totals)).toBe(240);
  });

  it('counts OVERTIME in both numerator and denominator, so utilisation stays ≤ 100%', () => {
    // Owner ruling R1: staff may place work outside the roster. Without
    // adding it to the denominator too, this day would read 133%.
    const barberDay = dayWith(
      [window(9, 12)], // 180 rostered
      [
        block({ id: 'a', fromH: 9, toH: 12, revenueMinorUnits: 4000 }),
        block({
          id: 'early',
          fromH: 8,
          toH: 9,
          revenueMinorUnits: 1450,
          outsideWindow: true,
        }),
      ],
    );
    const totals = barberDay.totals();

    expect(totals.overtimeMinutes).toBe(60);
    expect(totals.productiveMinutes).toBe(240);
    expect(totals.scheduledMinutes).toBe(240);
    expect(utilisation(totals)).toBe(1);
  });

  it('shows what the buffer policy costs', () => {
    const barberDay = dayWith(
      [window(9, 12)],
      [
        block({ id: 'a', fromH: 9, toH: 10, revenueMinorUnits: 1450 }),
        block({
          id: 'buf',
          fromH: 10,
          toH: 10.25,
          reason: {
            kind: 'buffer',
            ofAppointmentId: AppointmentId.generate(),
            ofSeatId: SeatId.generate(),
          },
        }),
      ],
    );
    const totals = barberDay.totals();

    expect(totals.bufferMinutes).toBe(15);
    // The gap between the two is exactly the turnaround policy's cost.
    expect(utilisation(totals)).toBeCloseTo(60 / 180);
    expect(chairTimeUtilisation(totals)).toBeCloseTo(75 / 180);
  });

  it('reports idle fragmentation', () => {
    const barberDay = dayWith(
      [window(9, 18)],
      [
        block({ id: 'a', fromH: 10, toH: 11 }),
        block({ id: 'b', fromH: 13, toH: 14 }),
      ],
    );
    const totals = barberDay.totals();
    // 09–10, 11–13, 14–18.
    expect(totals.idleGapCount).toBe(3);
    expect(totals.longestIdleGapMinutes).toBe(240);
  });

  it('has NO utilisation on a day off, rather than 0%', () => {
    // Reporting 0% would defame a barber for a holiday.
    const off = dayWith([], []);
    expect(utilisation(off.totals())).toBeNull();
    expect(chairTimeUtilisation(off.totals())).toBeNull();
  });
});

describe('BarberDayTotals — tickets and fragmentation', () => {
  /** A service reason for a named booking — the arm, not the whole union. */
  function serviceFor(appointmentId: AppointmentId): OccupancyReason {
    return {
      kind: 'service',
      appointmentId,
      seatId: SeatId.generate(),
      serviceId: serviceId(),
      variantId: null,
      origin: 'online',
      outcome: 'worked',
    };
  }

  /** Two seats of ONE party, served back to back by this barber. */
  function partyOfTwo(): readonly OccupancyBlock[] {
    const appointmentId = AppointmentId.generate();
    return [
      block({
        id: 'blk-party-a',
        fromH: 10,
        toH: 10.5,
        reason: serviceFor(appointmentId),
        revenueMinorUnits: 1500,
      }),
      block({
        id: 'blk-party-b',
        fromH: 10.5,
        toH: 11,
        reason: serviceFor(appointmentId),
        revenueMinorUnits: 1500,
      }),
    ];
  }

  it('counts a party of two as two services but ONE ticket', () => {
    const totals = dayWith([window(9, 18)], partyOfTwo()).totals();
    expect(totals.serviceCount).toBe(2);
    expect(totals.appointmentCount).toBe(1);
  });

  it('counts two separate bookings as two tickets', () => {
    const totals = dayWith(
      [window(9, 18)],
      [
        block({ id: 'a', fromH: 10, toH: 10.5, revenueMinorUnits: 1500 }),
        block({
          id: 'b',
          fromH: 11,
          toH: 11.5,
          reason: serviceFor(AppointmentId.generate()),
          revenueMinorUnits: 1500,
        }),
      ],
    ).totals();
    expect(totals.appointmentCount).toBe(2);
  });

  /**
   * The diagnosis pair: identical idle MINUTES, opposite problems. One
   * three-hour hole is demand; three ten-minute slivers is scheduling.
   */
  it('separates one sellable hole from a run of unsellable slivers', () => {
    const oneHole = dayWith(
      [window(9, 12)],
      [block({ id: 'x', fromH: 9, toH: 9.5 })],
    ).totals('EUR', 15);
    expect(oneHole.idleGapCount).toBe(1);
    expect(oneHole.sellableGapCount).toBe(1);
    expect(fragmentationRatio(oneHole)).toBe(0);

    // 09:00–09:50, 10:00–10:50, 11:00–11:50 booked → three 10-minute gaps.
    const slivers = dayWith(
      [window(9, 12)],
      [
        block({ id: 'a', fromH: 9, toH: 9 + 50 / 60 }),
        block({ id: 'b', fromH: 10, toH: 10 + 50 / 60 }),
        block({ id: 'c', fromH: 11, toH: 11 + 50 / 60 }),
      ],
    ).totals('EUR', 15);
    expect(slivers.idleGapCount).toBe(3);
    expect(slivers.sellableGapCount).toBe(0);
    expect(fragmentationRatio(slivers)).toBe(1);
  });

  it('respects the shop’s own shortest sellable service', () => {
    // One 20-minute gap: sellable to a shop with a 15-minute trim, not to one
    // whose shortest service is half an hour.
    const gapped = dayWith(
      [window(9, 10)],
      [block({ id: 'a', fromH: 9, toH: 9 + 40 / 60 })],
    );
    expect(gapped.totals('EUR', 15).sellableGapCount).toBe(1);
    expect(gapped.totals('EUR', 30).sellableGapCount).toBe(0);
  });

  it('has NO fragmentation on a fully booked day, rather than 0', () => {
    const packed = dayWith([window(9, 10)], [block({ fromH: 9, toH: 10 })]);
    expect(packed.totals().idleGapCount).toBe(0);
    expect(fragmentationRatio(packed.totals())).toBeNull();
  });
});
