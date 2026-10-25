import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BookingLifecycle,
  BlockKind,
  CancelledBy,
  MinuteBlock,
  MinuteRange,
  CancellationReason,
  CancellationReasonSet,
  Seat,
  SeatOutcome,
  WriteAction,
  WriteOp,
} from '@core/components';
import type { Appointment } from '@core/entities';
import {
  BusyKey,
  AppointmentId,
  BarberId,
  SeatId,
  type LocalDate,
} from '@core/primitives';
import {
  deepFreeze,
  endMinute,
  FIXTURE_TIME_ZONE,
  localDate,
  minute,
  utcMs,
  type AppointmentFixtureOverrides,
  appointmentFixture,
  seatFixture,
  termsFixture,
} from '@core/testing';
import { BusySystem } from './busy.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The busy projection's rules, as `busyContributionsOf`/`mergeBusy` (the
 * legacy booking library, deleted in Phase 4b) and the rebuild trigger
 * (the retired `rebuild-busy.ts:85-123`, deleted in flip 1; now
 * `rebuild-busy.pipeline.ts`) state them: a seat projects its CHAIR time
 * (setup + service + cleanup), clipped to the shop day, onto its
 * appointment's ONE shop day (T7) — the cases of the legacy
 * `appointment-document.spec.ts` (deleted in Phase 4b; ledger
 * `docs/architecture/flips/phase-4b-delete.md` §11.1) "holds the chairs the
 * busy projection holds for the visit" — the merge leaks density never
 * count, and a document nothing live occupies is deleted, never written
 * empty. The zone never reaches the system: the busy day's `utcEpochMs` (its
 * first instant) comes from the pipeline's `startOfLocalDay`.
 */

const JUNE_1 = localDate('2026-06-01');
const JUNE_2 = localDate('2026-06-02');
const at = (hours: number, minutes = 0) => minute(hours * 60 + minutes);
const IVAN = BarberId.of('ivan');
const PETAR = BarberId.of('petar');

/** The pipeline's day-start stamp — the location's zone, once, at the boundary. */
const dayStart = (day: LocalDate) =>
  ZonedTimeSystem.startOfLocalDay(day, FIXTURE_TIME_ZONE);

function seat(
  id: string,
  barberId: BarberId,
  startMinutes: ReturnType<typeof at>,
  pads: { duration?: number; setup?: number; cleanup?: number } = {},
): Seat {
  const terms = termsFixture(
    1500,
    pads.duration ?? 30,
    pads.setup ?? 0,
    pads.cleanup ?? 0,
  );
  return seatFixture({
    seatId: SeatId.of(id),
    barberId,
    startMinutes,
    terms: Seat.termsOf(terms, null),
  });
}

function visit(
  id: string,
  seats: readonly Seat[],
  overrides: AppointmentFixtureOverrides = {},
): Appointment {
  return appointmentFixture({
    id: AppointmentId.of(id),
    localDate: JUNE_1,
    seats,
    busyKeys: [],
    ...overrides,
  });
}

const key = (barberId: BarberId, day: string) =>
  BusyKey.of(barberId, localDate(day));
const range = (start: number, end: number) =>
  MinuteRange.of(minute(start), endMinute(end));
const busy = (start: number, end: number) =>
  MinuteBlock.of(minute(start), endMinute(end), BlockKind.Busy);
const cancelledAt8 = BookingLifecycle.cancel(
  utcMs('2026-06-01T08:00:00+03:00'),
  CancellationReasonSet.of([CancellationReason.ClientChangedPlans]),
);

describe('BusySystem.contributionsOf — what a visit occupies', () => {
  it('claims the chair for setup + service + cleanup on the visit’s shop day', () => {
    const contributions = BusySystem.contributionsOf(
      visit('a', [seat('s1', IVAN, at(10), { setup: 5, cleanup: 10 })]),
    );
    expect(contributions).toEqual([
      {
        id: key(IVAN, '2026-06-01'),
        barberId: IVAN,
        localDate: '2026-06-01',
        spans: [range(9 * 60 + 55, 10 * 60 + 40)],
      },
    ]);
  });

  it('holds every seat’s chair, keyed by its barber and the visit’s day (property)', () => {
    const anySeat = fc.record({
      barber: fc.constantFrom(IVAN, PETAR),
      offset: fc.integer({ min: 0, max: 8 * 4 }),
      duration: fc.integer({ min: 5, max: 120 }),
      setup: fc.integer({ min: 0, max: 30 }),
      cleanup: fc.integer({ min: 0, max: 30 }),
    });
    fc.assert(
      fc.property(
        fc.array(anySeat, { minLength: 1, maxLength: 4 }),
        fc.constantFrom('2026-06-01', '2026-06-02', '2026-06-03'),
        (drafts, day) => {
          const seats = drafts.map((draft, index) =>
            seat(`s${index}`, draft.barber, at(9, draft.offset * 15), draft),
          );
          const contributions = BusySystem.contributionsOf(
            visit('p', seats, { localDate: localDate(day) }),
          );
          for (const placed of seats) {
            const found = contributions.find(
              (contribution) =>
                contribution.id === BusyKey.of(placed.barberId, localDate(day)),
            );
            expect(found?.spans).toContainEqual(Seat.chairTime(placed));
          }
          const ids = contributions.map((contribution) => contribution.id);
          expect(ids).toEqual([...new Set(ids)].sort());
        },
      ),
    );
  });

  it('clips chair time to the shop day — setup before midnight or cleanup past it never spills (T7)', () => {
    // The legacy table failed closed for a seat outside it; on the wall
    // clock every seat is on its visit's day, and its padded chair time is
    // clipped to [00:00, 24:00] exactly as the day table clipped it.
    const contributions = BusySystem.contributionsOf(
      visit('a', [
        seat('s1', IVAN, at(0, 5), { setup: 10 }),
        seat('s2', IVAN, at(23, 30), { cleanup: 30 }),
      ]),
    );
    expect(contributions.map((contribution) => contribution.spans)).toEqual([
      [range(0, 35), range(23 * 60 + 30, 1440)],
    ]);
  });
});

describe('BusySystem.mergeBusy and the stored blocks', () => {
  it('merges back-to-back seats into one span — density, never count', () => {
    expect(
      BusySystem.mergeBusy([range(600, 630)], [range(630, 660)], []),
    ).toEqual([range(600, 660)]);
  });

  it('takes out what a change removes', () => {
    expect(
      BusySystem.mergeBusy([range(600, 720)], [], [range(630, 660)]),
    ).toEqual([range(600, 630), range(660, 720)]);
  });

  it('stores wall-clock minutes inside the day, clipping chair time past midnight', () => {
    const late = visit('a', [
      seat('s1', IVAN, at(10)),
      seat('s2', IVAN, at(23, 30), { cleanup: 30 }),
    ]);
    expect(
      BusySystem.rebuild(key(IVAN, '2026-06-01'), [late], dayStart),
    ).toEqual(
      WriteOp.set(['barberBusy', key(IVAN, '2026-06-01')], {
        barberId: IVAN,
        localDate: JUNE_1,
        utcEpochMs: dayStart(JUNE_1),
        blocks: [busy(600, 630), busy(1410, 1440)],
      }),
    );
  });

  it('stores exactly the merged chair times — blocks ARE the spans (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 1380 }),
            fc.integer({ min: 1, max: 40 }),
          ),
          { minLength: 1, maxLength: 6 },
        ),
        (drafts) => {
          const seats = drafts.map(([start, length], index) =>
            seat(`s${index}`, IVAN, minute(start), { duration: length }),
          );
          const written = BusySystem.rebuild(
            key(IVAN, '2026-06-01'),
            [visit('p', seats)],
            dayStart,
          );
          const blocks =
            written !== null && written.writeAction === WriteAction.Set
              ? (written.body['blocks'] as readonly MinuteBlock[])
              : [];
          expect(
            blocks.map((block) => range(block.startMinutes, block.endMinutes)),
          ).toEqual(
            BusySystem.mergeBusy(
              seats.map((placed) => Seat.chairTime(placed)),
              [],
              [],
            ),
          );
        },
      ),
    );
  });

  it('keeps a span on the wall clock on the spring-forward day — the zone stays at the boundary', () => {
    // Europe/Sofia, 2026-03-29: 03:00 → 04:00. A 02:30–04:30 chair is two
    // clock hours on the shop's day (one elapsed hour, which only the
    // boundary's instants know); the busy day's first instant is that
    // day's midnight, from the pipeline.
    const spring = localDate('2026-03-29');
    const written = BusySystem.rebuild(
      key(IVAN, '2026-03-29'),
      [
        visit('a', [seat('s1', IVAN, at(2, 30), { duration: 120 })], {
          localDate: spring,
        }),
      ],
      dayStart,
    );
    expect(written).toEqual(
      WriteOp.set(['barberBusy', key(IVAN, '2026-03-29')], {
        barberId: IVAN,
        localDate: spring,
        utcEpochMs: dayStart(spring),
        blocks: [busy(150, 270)],
      }),
    );
  });
});

/**
 * What the rebuild pipeline writes for one appointment write: `rebuild` of
 * every busy document either side touches (`affectedKeys`), from `live`.
 */
function rebuildPlan(
  before: Appointment | null,
  after: Appointment | null,
  live: readonly Appointment[],
): readonly WriteOp[] {
  const writes: WriteOp[] = [];
  for (const busyKey of BusySystem.affectedKeys(before, after)) {
    const write = BusySystem.rebuild(busyKey, live, dayStart);
    if (write !== null) writes.push(write);
  }
  return writes;
}

describe('BusySystem.rebuild over the affected keys — a rebuild, not a subtraction', () => {
  const morning = visit('a', [seat('s1', IVAN, at(10))]);
  const noon = visit('b', [seat('s2', IVAN, at(10, 30))]);

  it('recomputes the document from every live visit on it', () => {
    expect(rebuildPlan(null, morning, [morning, noon])).toEqual([
      WriteOp.set(['barberBusy', key(IVAN, '2026-06-01')], {
        barberId: IVAN,
        localDate: '2026-06-01',
        utcEpochMs: dayStart(JUNE_1),
        blocks: [busy(600, 660)],
      }),
    ]);
  });

  it('frees a cancelled visit’s slot — the event the waitlist listens for', () => {
    const cancelled = visit('a', morning.seats, { lifecycle: cancelledAt8 });
    expect(rebuildPlan(morning, cancelled, [cancelled, noon])).toEqual([
      WriteOp.set(['barberBusy', key(IVAN, '2026-06-01')], {
        barberId: IVAN,
        localDate: '2026-06-01',
        utcEpochMs: dayStart(JUNE_1),
        blocks: [busy(630, 660)],
      }),
    ]);
  });

  it('deletes a document nothing live occupies, rather than writing it empty', () => {
    const cancelled = visit('a', morning.seats, { lifecycle: cancelledAt8 });
    const plan = rebuildPlan(morning, cancelled, [cancelled]);
    expect(plan).toEqual([
      WriteOp.remove(['barberBusy', key(IVAN, '2026-06-01')]),
    ]);
    expect(plan.every((op) => op.writeAction === WriteAction.Delete)).toBe(
      true,
    );
  });

  it('frees the old day and fills the new one when a visit moves', () => {
    const moved = visit('a', [seat('s1', IVAN, at(10))], {
      localDate: JUNE_2,
    });
    const plan = rebuildPlan(morning, moved, [moved]);
    expect(plan.map((op) => [op.writeAction, op.path[1]])).toEqual([
      [WriteAction.Delete, key(IVAN, '2026-06-01')],
      [WriteAction.Set, key(IVAN, '2026-06-02')],
    ]);
  });

  it('reads the stored mirror when the visit carries one', () => {
    const mirrored = {
      ...morning,
      busyKeys: [key(PETAR, '2026-06-03')],
    };
    expect(BusySystem.affectedKeys(mirrored, null)).toEqual([
      key(PETAR, '2026-06-03'),
    ]);
    expect(BusySystem.affectedKeys(morning, null)).toEqual([
      key(IVAN, '2026-06-01'),
    ]);
  });

  it('unions the keys a refused side salvaged — distinct, sorted, beside both sides (edge-hardening D-3)', () => {
    const moved = visit('a', [seat('s1', IVAN, at(10))], {
      localDate: JUNE_2,
    });
    expect(
      BusySystem.affectedKeys(null, moved, [
        key(PETAR, '2026-06-03'),
        key(IVAN, '2026-06-02'),
        key(IVAN, '2026-06-01'),
        key(PETAR, '2026-06-03'),
      ]),
    ).toEqual([
      key(IVAN, '2026-06-01'),
      key(IVAN, '2026-06-02'),
      key(PETAR, '2026-06-03'),
    ]);
    // A deleted malformed visit: no side admitted, its salvaged keys alone.
    expect(
      BusySystem.affectedKeys(null, null, [key(IVAN, '2026-06-01')]),
    ).toEqual([key(IVAN, '2026-06-01')]);
    // The two-argument call is unchanged: nothing salvaged.
    expect(BusySystem.affectedKeys(morning, moved)).toEqual(
      BusySystem.affectedKeys(morning, moved, []),
    );
    expect(BusySystem.affectedKeys(null, null)).toEqual([]);
  });

  it('is pure with salvaged keys: same input → same output, inputs untouched', () => {
    const before = deepFreeze(morning);
    const salvaged = deepFreeze([
      key(PETAR, '2026-06-03'),
      key(IVAN, '2026-06-01'),
    ]);
    const once = BusySystem.affectedKeys(before, null, salvaged);
    expect(BusySystem.affectedKeys(before, null, salvaged)).toEqual(once);
    expect(once).toEqual([key(IVAN, '2026-06-01'), key(PETAR, '2026-06-03')]);
    expect(salvaged).toEqual([
      key(PETAR, '2026-06-03'),
      key(IVAN, '2026-06-01'),
    ]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const before = deepFreeze(morning);
    const live = deepFreeze([morning, noon]);
    const once = rebuildPlan(before, before, live);
    expect(rebuildPlan(before, before, live)).toEqual(once);
    expect(before).toEqual(morning);
    expect(live).toEqual([morning, noon]);
  });
});

describe('BusySystem.chairOccupants — what occupies a chair beside a placement (DEP-2)', () => {
  const ROOT_AT = utcMs('2026-06-01T07:00:00+03:00');
  const ids = (occupants: ReturnType<typeof BusySystem.chairOccupants>) =>
    occupants.map(({ appointment, seat: held }) => [
      appointment.id,
      held.seatId,
    ]);

  it('keeps the barber’s seats of every other appointment whose ROOT is live', () => {
    const pending = visit('p', [seat('p1', IVAN, at(9))], {
      lifecycle: BookingLifecycle.pending(ROOT_AT),
    });
    const confirmed = visit('c', [
      seat('c1', IVAN, at(10)),
      seat('c2', PETAR, at(10)),
      seat('c3', IVAN, at(11)),
    ]);
    expect(
      ids(BusySystem.chairOccupants([pending, confirmed], IVAN, null)),
    ).toEqual([
      ['p', 'p1'],
      ['c', 'c1'],
      ['c', 'c3'],
    ]);
    expect(
      ids(BusySystem.chairOccupants([pending, confirmed], PETAR, null)),
    ).toEqual([['c', 'c2']]);
  });

  it('drops a settled root — completed, no-show, cancelled — as the busy projection does', () => {
    const settled = [
      visit('done', [seat('d1', IVAN, at(9))], {
        lifecycle: BookingLifecycle.complete(ROOT_AT),
      }),
      visit('gone', [seat('g1', IVAN, at(10))], {
        lifecycle: BookingLifecycle.noShow(ROOT_AT),
      }),
      visit('off', [seat('o1', IVAN, at(11))], { lifecycle: cancelledAt8 }),
    ];
    expect(BusySystem.chairOccupants(settled, IVAN, null)).toEqual([]);
  });

  it('keeps a split party’s chair whose seats were all cancelled inside a CONFIRMED root', () => {
    const cancelledSeat = seatFixture({
      seatId: SeatId.of('s1'),
      barberId: IVAN,
      startMinutes: at(10),
      outcome: SeatOutcome.cancelled(
        ROOT_AT,
        CancelledBy.Client,
        CancellationReason.ClientChangedPlans,
        null,
      ),
    });
    const split = visit('split', [cancelledSeat, seat('s2', PETAR, at(10))]);
    expect(ids(BusySystem.chairOccupants([split], IVAN, null))).toEqual([
      ['split', 's1'],
    ]);
    // The busy projection counts the same chair.
    expect(
      BusySystem.rebuild(key(IVAN, '2026-06-01'), [split], dayStart)
        ?.writeAction,
    ).toBe(WriteAction.Set);
  });

  it('leaves out the appointment on the sheet, and only it', () => {
    const mine = visit('mine', [seat('m1', IVAN, at(10))]);
    const theirs = visit('theirs', [seat('t1', IVAN, at(10))]);
    expect(
      ids(
        BusySystem.chairOccupants(
          [mine, theirs],
          IVAN,
          AppointmentId.of('mine'),
        ),
      ),
    ).toEqual([['theirs', 't1']]);
    expect(BusySystem.chairOccupants([], IVAN, null)).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const day = deepFreeze([
      visit('a', [seat('a1', IVAN, at(10))]),
      visit('b', [seat('b1', IVAN, at(11))], { lifecycle: cancelledAt8 }),
    ]);
    const snapshot = structuredClone(day);
    const once = BusySystem.chairOccupants(day, IVAN, AppointmentId.of('x'));
    expect(BusySystem.chairOccupants(day, IVAN, AppointmentId.of('x'))).toEqual(
      once,
    );
    expect(day).toEqual(snapshot);
  });
});
