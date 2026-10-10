import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BookingStatus } from '../components/booking-status.data';
import { BusyKey } from '../components/busy-key.data';
import { DayKey } from '../components/day-key.data';
import { DayOffset } from '../components/day-offset.data';
import { BlockKind, MinuteBlock } from '../components/minute-block.data';
import { Seat, SeatId } from '../components/seat.data';
import { ServiceTerms } from '../components/service-terms.data';
import { TimeInterval } from '../components/time-interval.data';
import { WriteKind, WriteOp } from '../components/write-op.data';
import {
  AppointmentId,
  type AppointmentEntity,
} from '../entities/appointment.entity';
import { BarberId } from '../entities/barber.entity';
import {
  appointmentFixture,
  dayTableFixture,
  deepFreeze,
  seatFixture,
} from '../testing';
import { BusySystem } from './busy.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The busy projection's rules, as `busyContributionsOf`/`mergeBusy`
 * (application/booking) and the rebuild trigger (`rebuild-busy.ts:85-123`)
 * state them: a seat projects its CHAIR time (setup + service + cleanup)
 * onto its sold start's day — the cases of appointment-document.spec.ts
 * "holds the chairs the busy projection holds for the visit" — the merge
 * leaks density never count, and a document nothing live occupies is
 * deleted, never written empty.
 */

const DAYS = dayTableFixture('2026-06-01', '2026-06-03');
const day = (key: string) => DayOffset.find(DayKey.of(key), DAYS) as DayOffset;
const JUNE_1 = day('2026-06-01');
const at = (hours: number, minutes = 0, on: DayOffset = JUNE_1) =>
  ZonedTimeSystem.instantOf(on, hours * 60 + minutes);
const IVAN = BarberId.of('ivan');
const PETAR = BarberId.of('petar');

function seat(
  id: string,
  barberId: BarberId,
  startMs: number,
  pads: { duration?: number; setup?: number; cleanup?: number } = {},
): Seat {
  const terms = ServiceTerms.of(
    1500,
    'EUR',
    pads.duration ?? 30,
    pads.setup ?? 0,
    pads.cleanup ?? 0,
  );
  return seatFixture({
    id: SeatId.of(id),
    barberId,
    startMs,
    terms: Seat.termsOf(terms, null),
  });
}

function visit(
  id: string,
  seats: readonly Seat[],
  overrides: Partial<AppointmentEntity> = {},
): AppointmentEntity {
  return appointmentFixture({
    id: AppointmentId.of(id),
    seats,
    busyKeys: [],
    zone: 'Europe/Sofia',
    ...overrides,
  });
}

const key = (barberId: BarberId, dayKey: string) =>
  BusyKey.of(barberId, DayKey.of(dayKey));
const busy = (startMinutes: number, endMinutes: number) =>
  MinuteBlock.of(startMinutes, endMinutes, BlockKind.Busy);

describe('BusySystem.contributionsOf — what a visit occupies', () => {
  it('claims the chair for setup + service + cleanup on the sold start’s day', () => {
    const contributions = BusySystem.contributionsOf(
      visit('a', [seat('s1', IVAN, at(10), { setup: 5, cleanup: 10 })]),
      DAYS,
    );
    expect(contributions).toEqual([
      {
        id: key(IVAN, '2026-06-01'),
        barberId: IVAN,
        dayKey: '2026-06-01',
        zone: 'Europe/Sofia',
        spans: [TimeInterval.of(at(9, 55), at(10, 40))],
      },
    ]);
  });

  it('holds every seat’s chair, keyed by its barber and day (property)', () => {
    const anySeat = fc.record({
      barber: fc.constantFrom(IVAN, PETAR),
      offset: fc.integer({ min: 0, max: 8 * 4 }),
      dayIndex: fc.integer({ min: 0, max: 2 }),
      duration: fc.integer({ min: 5, max: 120 }),
      setup: fc.integer({ min: 0, max: 30 }),
      cleanup: fc.integer({ min: 0, max: 30 }),
    });
    fc.assert(
      fc.property(
        fc.array(anySeat, { minLength: 1, maxLength: 4 }),
        (drafts) => {
          const seats = drafts.map((draft, index) =>
            seat(
              `s${index}`,
              draft.barber,
              at(9, draft.offset * 15, DAYS[draft.dayIndex] as DayOffset),
              draft,
            ),
          );
          const contributions = BusySystem.contributionsOf(
            visit('p', seats),
            DAYS,
          );
          for (const placed of seats) {
            const dayKey = ZonedTimeSystem.dayKeyOf(placed.startMs, DAYS);
            const found = contributions.find(
              (contribution) =>
                contribution.id ===
                BusyKey.of(placed.barberId, dayKey as DayKey),
            );
            expect(found?.spans).toContainEqual(Seat.chairTime(placed));
          }
          const ids = contributions.map((contribution) => contribution.id);
          expect(ids).toEqual([...new Set(ids)].sort());
        },
      ),
    );
  });

  it('projects nothing for a seat the day table does not cover — it frees, never invents', () => {
    const outside = seat('s1', IVAN, at(10) - 30 * 86_400_000);
    expect(BusySystem.contributionsOf(visit('a', [outside]), DAYS)).toEqual([]);
  });
});

describe('BusySystem.mergeBusy and the stored blocks', () => {
  it('merges back-to-back seats into one span — density, never count', () => {
    expect(
      BusySystem.mergeBusy(
        [TimeInterval.of(at(10), at(10, 30))],
        [TimeInterval.of(at(10, 30), at(11))],
        [],
      ),
    ).toEqual([TimeInterval.of(at(10), at(11))]);
  });

  it('takes out what a change removes', () => {
    expect(
      BusySystem.mergeBusy(
        [TimeInterval.of(at(10), at(12))],
        [],
        [TimeInterval.of(at(10, 30), at(11))],
      ),
    ).toEqual([
      TimeInterval.of(at(10), at(10, 30)),
      TimeInterval.of(at(11), at(12)),
    ]);
  });

  it('stores wall-clock minutes inside the day, clipping a span past midnight', () => {
    const june2 = day('2026-06-02');
    expect(
      BusySystem.blocksOf(
        [
          TimeInterval.of(at(10), at(10, 30)),
          TimeInterval.of(at(23, 30), at(0, 30, june2)),
        ],
        JUNE_1,
      ),
    ).toEqual([busy(600, 630), busy(1410, 1440)]);
  });

  it('round-trips blocks and spans on an ordinary day (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc
            .tuple(
              fc.integer({ min: 0, max: 1400 }),
              fc.integer({ min: 1, max: 40 }),
            )
            .map(([start, length]) =>
              TimeInterval.of(at(0, start), at(0, start + length)),
            ),
          { maxLength: 6 },
        ),
        (spans) => {
          const blocks = BusySystem.blocksOf(spans, JUNE_1);
          expect(BusySystem.spansOf(blocks, JUNE_1)).toEqual(
            BusySystem.mergeBusy(spans, [], []),
          );
        },
      ),
    );
  });

  it('keeps a span’s real length on the spring-forward day', () => {
    // Europe/Sofia, 2026-03-29: 03:00 → 04:00. 02:30–04:30 is one real hour.
    const spring = dayTableFixture('2026-03-29')[0] as DayOffset;
    const span = TimeInterval.of(
      ZonedTimeSystem.instantOf(spring, 150),
      ZonedTimeSystem.instantOf(spring, 270),
    );
    expect(TimeInterval.durationMinutes(span)).toBe(60);
    const blocks = BusySystem.blocksOf([span], spring);
    expect(blocks).toEqual([busy(150, 270)]);
    expect(BusySystem.spansOf(blocks, spring)).toEqual([span]);
  });
});

describe('BusySystem.plan — a rebuild, not a subtraction', () => {
  const morning = visit('a', [seat('s1', IVAN, at(10))]);
  const noon = visit('b', [seat('s2', IVAN, at(10, 30))]);

  it('recomputes the document from every live visit on it', () => {
    const plan = BusySystem.plan(null, morning, [morning, noon], DAYS);
    expect(plan).toEqual([
      WriteOp.set(['barberBusy', key(IVAN, '2026-06-01')], {
        barberId: IVAN,
        dayKey: '2026-06-01',
        zone: 'Europe/Sofia',
        blocks: [busy(600, 660)],
      }),
    ]);
  });

  it('frees a cancelled visit’s slot — the event the waitlist listens for', () => {
    const cancelled = {
      ...morning,
      bookingStatus: BookingStatus.cancel(at(8), 'client'),
    };
    const plan = BusySystem.plan(morning, cancelled, [cancelled, noon], DAYS);
    expect(plan).toEqual([
      WriteOp.set(['barberBusy', key(IVAN, '2026-06-01')], {
        barberId: IVAN,
        dayKey: '2026-06-01',
        zone: 'Europe/Sofia',
        blocks: [busy(630, 660)],
      }),
    ]);
  });

  it('deletes a document nothing live occupies, rather than writing it empty', () => {
    const cancelled = {
      ...morning,
      bookingStatus: BookingStatus.cancel(at(8), 'client'),
    };
    const plan = BusySystem.plan(morning, cancelled, [cancelled], DAYS);
    expect(plan).toEqual([
      WriteOp.remove(['barberBusy', key(IVAN, '2026-06-01')]),
    ]);
    expect(plan.every((op) => op.kind === WriteKind.Delete)).toBe(true);
  });

  it('frees the old day and fills the new one when a visit moves', () => {
    const moved = visit('a', [seat('s1', IVAN, at(10, 0, day('2026-06-02')))]);
    const plan = BusySystem.plan(morning, moved, [moved], DAYS);
    expect(plan.map((op) => [op.kind, op.path[1]])).toEqual([
      [WriteKind.Delete, key(IVAN, '2026-06-01')],
      [WriteKind.Set, key(IVAN, '2026-06-02')],
    ]);
  });

  it('reads the stored mirror when the visit carries one', () => {
    const mirrored = {
      ...morning,
      busyKeys: [key(PETAR, '2026-06-03')],
    };
    expect(BusySystem.affectedKeys(mirrored, null, DAYS)).toEqual([
      key(PETAR, '2026-06-03'),
    ]);
    expect(BusySystem.affectedKeys(morning, null, DAYS)).toEqual([
      key(IVAN, '2026-06-01'),
    ]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const before = deepFreeze(morning);
    const live = deepFreeze([morning, noon]);
    const days = deepFreeze([...DAYS]);
    const once = BusySystem.plan(before, before, live, days);
    expect(BusySystem.plan(before, before, live, days)).toEqual(once);
    expect(before).toEqual(morning);
    expect(live).toEqual([morning, noon]);
  });
});
