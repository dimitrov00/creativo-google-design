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
 * `BookingsAheadStore` — the bookings a last day would leave behind, asked
 * once per day picked: the answer in force, a failure said as one, and a
 * late answer never replacing a newer day's.
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

describe('BookingsAheadStore', () => {
  it('asks for the days after the one picked, and holds what they leave behind', async () => {
    const { store, calls } = harness({
      visits: [
        visit('a-1', '2026-11-17'),
        visit('a-2', '2026-12-02'),
        visit('a-last', '2026-11-15'),
      ],
    });
    expect(store.leftover()).toBeNull();

    store.ask(IVAN, localDate('2026-11-15'));
    // On its way: nothing is said yet.
    expect(store.leftover()).toBeNull();
    await settled();

    expect(store.leftover()).toEqual({
      leftoverCount: 2,
      leftoverLocalDates: ['2026-11-17', '2026-12-02'],
    });
    expect(store.failed()).toBe(false);
    expect(calls.aheadAsked).toEqual([
      { barberId: IVAN, fromLocalDate: '2026-11-16' },
    ]);
  });

  it('asking nothing forgets the last answer and reads nothing', async () => {
    const { store, calls } = harness({ visits: [visit('a-1', '2026-11-17')] });
    store.ask(IVAN, localDate('2026-11-15'));
    await settled();
    store.ask(IVAN, null);
    await settled();

    expect(store.leftover()).toBeNull();
    expect(calls.aheadAsked).toHaveLength(1);
  });

  it('says a read that failed as a failure — never as «nothing is left»', async () => {
    const { store } = harness({ aheadFails: true });
    store.ask(IVAN, localDate('2026-11-15'));
    await settled();

    expect(store.failed()).toBe(true);
    expect(store.leftover()).toBeNull();
  });

  it('an answer that comes back late never replaces a newer day’s', async () => {
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

    store.ask(IVAN, localDate('2026-11-15'));
    store.ask(IVAN, localDate('2026-12-31'));
    // The newer day answers first, then the older one lands late.
    pending.at(1)?.answer();
    await settled();
    const newer = store.leftover();
    pending.at(0)?.answer();
    await settled();

    expect(newer).toEqual({ leftoverCount: 0, leftoverLocalDates: [] });
    expect(store.leftover()).toBe(newer);
  });
});
