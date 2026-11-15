import { describe, expect, it } from 'vitest';
import { BookingLifecycle } from '@core/components';
import {
  AppointmentId,
  BarberId,
  BusyKey,
  type LocalDate,
  Result,
} from '@core/primitives';
import { RepositoryError, RepositoryErrorCode } from '@core/errors';
import type { Appointment, BarberBusyDay } from '@core/entities';
import {
  appointmentFixture,
  barberBusyDayFixture,
  FIXTURE_NOW_UTC_MS,
  localDate,
  minute,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { listBookingsAhead } from './list-bookings-ahead.pipeline';

/*
 * `listBookingsAhead` (team onboarding D10): the bookings a barber's last
 * working day would leave behind — the busy days after it in ONE read, a
 * day's visits for each day that holds a block, and the visits the system
 * keeps, oldest first.
 */

const IVAN = BarberId.of('ivan');
const LAST = localDate('2026-11-15');

const busy = (day: string, over: Partial<BarberBusyDay> = {}): BarberBusyDay =>
  barberBusyDayFixture({ barberId: IVAN, localDate: localDate(day), ...over });
const visit = (
  id: string,
  day: string,
  over: Parameters<typeof appointmentFixture>[0] = {},
): Appointment =>
  appointmentFixture({
    id: AppointmentId.of(id),
    localDate: localDate(day),
    barberIds: [IVAN],
    ...over,
  });

function rig(options: {
  readonly busyDays?: readonly BarberBusyDay[];
  readonly visits?: readonly Appointment[];
  readonly busyFails?: boolean;
  /** The day whose visits cannot be read. */
  readonly failingDay?: string;
}) {
  /** Every busy-day read: whose days, from which day on. */
  const asked: { barberId: BarberId; from: LocalDate }[] = [];
  /** Every day's visits read, by key, in order. */
  const read: BusyKey[] = [];
  return {
    asked,
    read,
    run: listBookingsAhead({
      loadBusyDaysFrom: async (barberId, from) => {
        asked.push({ barberId, from });
        return options.busyFails === true
          ? Result.err(RepositoryError.readFailed('barberBusy', 'unavailable'))
          : Result.ok(
              (options.busyDays ?? []).filter((day) => day.localDate >= from),
            );
      },
      loadBarberDay: async (key) => {
        read.push(key);
        const { localDate: day } = BusyKey.split(key);
        return day === options.failingDay
          ? Result.err(
              RepositoryError.readFailed('appointments', 'unavailable'),
            )
          : Result.ok(
              (options.visits ?? []).filter((v) => v.localDate === day),
            );
      },
    }),
  };
}

/** The answered visits, by id. */
const idsOf = (visits: readonly Appointment[]): readonly string[] =>
  visits.map((visit) => visit.id);

describe('listBookingsAhead', () => {
  it('reads the busy days from the day AFTER the last day, then only the days that hold a block — and answers what is left, oldest first', async () => {
    const { asked, read, run } = rig({
      busyDays: [
        busy('2026-11-15'),
        busy('2026-11-17'),
        busy('2026-11-18', { blocks: [] }),
        busy('2026-12-02'),
      ],
      visits: [
        visit('a-last', '2026-11-15'),
        visit('a-3', '2026-12-02'),
        visit('a-2', '2026-11-17', { startMinutes: minute(15 * 60) }),
        visit('a-1', '2026-11-17', { startMinutes: minute(9 * 60) }),
      ],
    });

    expect(idsOf(unwrapOk(await run(IVAN, LAST)))).toEqual([
      'a-1',
      'a-2',
      'a-3',
    ]);
    expect(asked).toEqual([{ barberId: IVAN, from: '2026-11-16' }]);
    expect(read).toEqual([
      BusyKey.of(IVAN, localDate('2026-11-17')),
      BusyKey.of(IVAN, localDate('2026-12-02')),
    ]);
  });

  it('answers nothing left for a barber booked on no later day — and reads no visit', async () => {
    const { read, run } = rig({ busyDays: [busy('2026-11-15')] });
    expect(unwrapOk(await run(IVAN, LAST))).toEqual([]);
    expect(read).toEqual([]);
  });

  it('a busy day whose visits are all cancelled or finished leaves nothing', async () => {
    const { run } = rig({
      busyDays: [busy('2026-11-17')],
      visits: [
        visit('a-done', '2026-11-17', {
          lifecycle: BookingLifecycle.complete(FIXTURE_NOW_UTC_MS),
        }),
      ],
    });
    expect(unwrapOk(await run(IVAN, LAST))).toEqual([]);
  });

  it('a read that fails is the answer’s refusal — never «nothing is left»', async () => {
    expect(
      unwrapErr(await rig({ busyFails: true }).run(IVAN, LAST)).errorCode,
    ).toBe(RepositoryErrorCode.ReadFailed);
    expect(
      unwrapErr(
        await rig({
          busyDays: [busy('2026-11-17'), busy('2026-12-02')],
          visits: [visit('a-1', '2026-11-17')],
          failingDay: '2026-12-02',
        }).run(IVAN, LAST),
      ).errorCode,
    ).toBe(RepositoryErrorCode.ReadFailed);
  });
});
