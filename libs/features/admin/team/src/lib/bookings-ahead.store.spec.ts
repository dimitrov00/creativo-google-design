import { TestBed } from '@angular/core/testing';
import type { BarberAheadPorts } from '@core/ports';
import {
  AppointmentId,
  BarberId,
  BusyKey,
  type LocalDate,
} from '@core/primitives';
import { appointmentFixture, localDate } from '@core/testing';
import { BARBER_AHEAD_PORTS } from '@creativo/infrastructure/firebase-app';
import { BookingsAheadStore } from './bookings-ahead.store';
import { teamBed } from './team-bed.spec-support';

/*
 * `BookingsAheadStore` — the visits a barber has ahead, read once and
 * kept: a later day is covered by what was read, an earlier one reads
 * again, a failure is said as one, and a late answer never replaces a
 * newer ask's.
 */

const IVAN = BarberId.of('ivan');
/** A live visit seating Ivan on `day`, keyed as the day's read finds it. */
const visit = (id: string, day: string) =>
  appointmentFixture({
    id: AppointmentId.of(id),
    localDate: localDate(day),
    barberIds: [IVAN],
    busyKeys: [BusyKey.of(IVAN, localDate(day))],
  });
/** The answers are promise chains: one macrotask lets them all land. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(options: Parameters<typeof teamBed>[0] = {}) {
  const bed = teamBed(options);
  TestBed.configureTestingModule({
    providers: [...bed.providers, BookingsAheadStore],
  });
  return { ...bed, store: TestBed.inject(BookingsAheadStore) };
}

/** The held visits, by id. */
const idsOf = (store: BookingsAheadStore): readonly string[] | null =>
  store.visits()?.map((entry) => entry.id) ?? null;

describe('BookingsAheadStore', () => {
  it('reads the visits after the day watched, and holds them oldest first', async () => {
    const { store, calls } = harness({
      visits: [
        visit('a-2', '2026-12-02'),
        visit('a-1', '2026-11-17'),
        visit('a-last', '2026-11-15'),
      ],
    });
    expect(store.visits()).toBeNull();

    store.watch(IVAN, localDate('2026-11-15'));
    // On its way: nothing is said yet.
    expect(store.visits()).toBeNull();
    await settled();

    expect(idsOf(store)).toEqual(['a-1', 'a-2']);
    expect(store.failed()).toBe(false);
    expect(calls.aheadAsked).toEqual([
      { barberId: IVAN, fromLocalDate: '2026-11-16' },
    ]);
  });

  it('a later day is covered by what is held: nothing is read again, and the answer stays', async () => {
    const { store, calls } = harness({ visits: [visit('a-1', '2026-11-17')] });
    store.watch(IVAN, localDate('2026-11-15'));
    await settled();
    const held = store.visits();

    store.watch(IVAN, localDate('2026-11-15'));
    store.watch(IVAN, localDate('2026-11-30'));
    await settled();

    expect(store.visits()).toBe(held);
    expect(calls.aheadAsked).toHaveLength(1);
  });

  it('an earlier day — or another barber — reads again from there', async () => {
    const { store, calls } = harness({
      visits: [visit('a-0', '2026-11-12'), visit('a-1', '2026-11-17')],
    });
    store.watch(IVAN, localDate('2026-11-15'));
    await settled();
    expect(idsOf(store)).toEqual(['a-1']);

    store.watch(IVAN, localDate('2026-11-10'));
    await settled();
    expect(idsOf(store)).toEqual(['a-0', 'a-1']);

    store.watch(BarberId.of('niko'), localDate('2026-11-20'));
    await settled();
    expect(idsOf(store)).toEqual([]);
    expect(calls.aheadAsked.map((ask) => ask.fromLocalDate)).toEqual([
      '2026-11-16',
      '2026-11-11',
      '2026-11-21',
    ]);
  });

  it('watching nothing forgets the last answer and reads nothing', async () => {
    const { store, calls } = harness({ visits: [visit('a-1', '2026-11-17')] });
    store.watch(IVAN, localDate('2026-11-15'));
    await settled();
    store.watch(IVAN, null);
    await settled();

    expect(store.visits()).toBeNull();
    expect(calls.aheadAsked).toHaveLength(1);
  });

  it('says a read that failed as a failure — never as «nothing is left» — and reads again when asked again', async () => {
    const { store, calls } = harness({ aheadFails: true });
    store.watch(IVAN, localDate('2026-11-15'));
    await settled();

    expect(store.failed()).toBe(true);
    expect(store.visits()).toBeNull();

    store.watch(IVAN, localDate('2026-11-20'));
    await settled();
    expect(calls.aheadAsked).toHaveLength(2);
  });

  it('an answer that comes back late never replaces a newer ask’s', async () => {
    /** Each busy-day read, held until the spec lets it answer. */
    const pending: { from: LocalDate; answer: () => void }[] = [];
    const slow: BarberAheadPorts = {
      loadBusyDaysFrom: (_barberId, fromLocalDate) =>
        new Promise((resolve) => {
          pending.push({
            from: fromLocalDate,
            answer: () => resolve({ ok: true, value: [] }),
          });
        }),
      loadBarberDay: async () => ({ ok: true, value: [] }),
    };
    const bed = teamBed();
    TestBed.configureTestingModule({
      providers: [
        ...bed.providers,
        { provide: BARBER_AHEAD_PORTS, useValue: slow },
        BookingsAheadStore,
      ],
    });
    const store = TestBed.inject(BookingsAheadStore);

    store.watch(IVAN, localDate('2026-11-15'));
    // An earlier day: a second read, which answers first.
    store.watch(IVAN, localDate('2026-11-01'));
    pending.at(1)?.answer();
    await settled();
    const newer = store.visits();
    pending.at(0)?.answer();
    await settled();

    expect(newer).toEqual([]);
    expect(store.visits()).toBe(newer);
  });
});
