import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoveRider } from '@core/components';
import { BarberId, CartLineId, LocationId, ServiceId } from '@core/primitives';
import { type CartLocatedOption, ZonedTimeSystem } from '@core/systems';
import {
  at,
  deepFreeze,
  duration,
  endMinute,
  localDate,
  minute,
  minuteCount,
  minuteDelta,
  unwrapOk,
  until,
  utcMs,
} from '@core/testing';
import {
  type TimedOption,
  timedOptionsOf,
  toScheduleSelection,
} from './booking-time-sheet';

/*
 * The one place an offer on the shop's wall clock becomes the selection the
 * flow machine holds — the shop day and its minutes, exactly as offered
 * (Law 7.3). The commit's pipeline places them on the absolute timeline
 * ONCE, with the location's zone; nothing here reads a zone.
 */

/** A father at 10:00 with Ivan and his guest straight after with Niko, at the Centre. */
const OPTION: CartLocatedOption = {
  locationId: LocationId.of('loc-center'),
  option: {
    startMinutes: at(10),
    endMinutes: until(11),
    assignments: [
      {
        lineId: CartLineId.of('line-1'),
        barberId: BarberId.of('ivan'),
        barberIndex: 0,
        startMinutes: at(10),
        endMinutes: until(10, 30),
      },
      {
        lineId: CartLineId.of('line-2'),
        barberId: BarberId.of('niko'),
        barberIndex: 1,
        startMinutes: at(10, 30),
        endMinutes: until(11),
      },
    ],
  },
};

/** The lines the bag holds. */
const KNOWN = new Map([
  ['line-1', CartLineId.forSequence(1)],
  ['line-2', CartLineId.forSequence(2)],
]);

describe('toScheduleSelection — an offer, as the flow machine takes it', () => {
  it('keeps every minute on the shop’s wall clock, the envelope and each seat alike', () => {
    const selection = toScheduleSelection(
      OPTION,
      localDate('2026-09-29'),
      (raw) => KNOWN.get(raw) ?? null,
    );

    expect(selection?.locationId).toBe('loc-center');
    expect(selection?.localDate).toBe('2026-09-29');
    expect(selection?.startMinutes).toBe(10 * 60);
    expect(selection?.endMinutes).toBe(11 * 60);
    expect(
      selection?.assignments.map((assignment) => [
        assignment.lineId,
        assignment.barberId,
        assignment.startMinutes,
        assignment.endMinutes,
      ]),
    ).toEqual([
      [KNOWN.get('line-1'), 'ivan', 10 * 60, 10 * 60 + 30],
      [KNOWN.get('line-2'), 'niko', 10 * 60 + 30, 11 * 60],
    ]);
  });

  it('refuses an offer naming a line the bag no longer holds', () => {
    expect(
      toScheduleSelection(OPTION, localDate('2026-09-29'), (raw) =>
        raw === 'line-1' ? (KNOWN.get(raw) ?? null) : null,
      ),
    ).toBeNull();
  });

  it('keeps a spring-forward minute as the wall clock says it — the commit’s pipeline is what refuses it', () => {
    // 2027-03-28: Sofia's clocks jump from 03:00 to 04:00. The sheet never
    // offers such a start (`timedOptionsOf` lists no party the zone erases
    // a start of), and a hand-made one is refused `DST_GAP_INVALID_TIME` at
    // the ingestion boundary (Phase 4a 4A-2 (a)) — the selection itself is
    // wall clock only.
    const gap: CartLocatedOption = {
      ...OPTION,
      option: {
        ...OPTION.option,
        startMinutes: at(3, 30),
        endMinutes: until(4),
        assignments: [
          {
            ...(OPTION.option
              .assignments[0] as CartLocatedOption['option']['assignments'][number]),
            startMinutes: at(3, 30),
            endMinutes: until(4),
          },
        ],
      },
    };
    const selection = toScheduleSelection(
      gap,
      localDate('2027-03-28'),
      (raw) => KNOWN.get(raw) ?? null,
    );
    expect(selection?.localDate).toBe('2027-03-28');
    expect(selection?.startMinutes).toBe(3 * 60 + 30);
  });
});

/*
 * OR-7: the sheet offers only the starts the server accepts for EVERY seat —
 * the whole party framed on the shop's clock as the reschedule frames it
 * (`MoveSystem.partyStarts` → `ZonedTimeSystem.frameShopDay`), not only the
 * envelope's start. 2027-03-28 in Sofia: 03:00 → 04:00, so 03:00–03:59 is no
 * time at all that day; 2027-03-27 is an ordinary Saturday (EET, +02:00).
 */

const SOFIA = unwrapOk(ZonedTimeSystem.checkZone('Europe/Sofia'));
const GAP_DAY = localDate('2027-03-28');
const ORDINARY_DAY = localDate('2027-03-27');

/** An arrangement at the Centre: one half-hour seat per start, in order. */
function option(...starts: readonly number[]): CartLocatedOption {
  return {
    locationId: LocationId.of('loc-center'),
    option: {
      startMinutes: minute(Math.min(...starts)),
      endMinutes: endMinute(Math.max(...starts) + 30),
      assignments: starts.map((start, index) => ({
        lineId: CartLineId.of(`line-${index + 1}`),
        barberId: BarberId.of(index === 0 ? 'ivan' : 'niko'),
        barberIndex: index,
        startMinutes: minute(start),
        endMinutes: endMinute(start + 30),
      })),
    },
  };
}

/** A seat a move carries: its kept distance from the party's earliest start. */
function rider(offsetMinutes: number): MoveRider {
  return {
    serviceId: ServiceId.of('svc-beard'),
    variantId: null,
    barberId: BarberId.of('petar'),
    offsetMinutes: minuteDelta(offsetMinutes),
    durationMinutes: duration(30),
    setupMinutes: minuteCount(0),
    cleanupMinutes: minuteCount(0),
  };
}

/** The offered envelopes, as minutes of the shop day. */
function offeredStarts(timed: readonly TimedOption[]): readonly number[] {
  return timed.map((entry) => entry.located.option.startMinutes);
}

describe('timedOptionsOf — the whole party on the shop’s clock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves an ordinary day as it was — every option, at its envelope’s instant', () => {
    const options = [option(10 * 60), option(10 * 60 + 30, 11 * 60)];

    const timed = timedOptionsOf(options, ORDINARY_DAY, SOFIA, []);

    expect(timed.map((entry) => entry.located)).toEqual(options);
    expect(timed.map((entry) => entry.startUtcMs)).toEqual([
      utcMs('2027-03-27T10:00:00.000+02:00'),
      utcMs('2027-03-27T10:30:00.000+02:00'),
    ]);
  });

  it('does not offer an envelope the zone erases', () => {
    const timed = timedOptionsOf(
      [option(2 * 60 + 30), option(3 * 60 + 30), option(4 * 60)],
      GAP_DAY,
      SOFIA,
      [],
    );

    expect(offeredStarts(timed)).toEqual([2 * 60 + 30, 4 * 60]);
    expect(timed.map((entry) => entry.startUtcMs)).toEqual([
      utcMs('2027-03-28T02:30:00.000+02:00'),
      utcMs('2027-03-28T04:00:00.000+03:00'),
    ]);
  });

  it('does not offer a party whose sequential second seat lands in the gap', () => {
    // 02:30 is a time that day; the seat straight after, at 03:15, is not —
    // the server would refuse the booking `DST_GAP_INVALID_TIME`.
    const timed = timedOptionsOf(
      [option(2 * 60, 2 * 60 + 30), option(2 * 60 + 30, 3 * 60 + 15)],
      GAP_DAY,
      SOFIA,
      [],
    );

    expect(offeredStarts(timed)).toEqual([2 * 60]);
  });

  it('does not offer a move whose carried companion lands in the gap', () => {
    // The companion went 90 minutes before the booker: a 05:00 start seats
    // them at 03:30, a minute the zone erases; 05:30 seats them at 04:00.
    const timed = timedOptionsOf(
      [option(5 * 60), option(5 * 60 + 30)],
      GAP_DAY,
      SOFIA,
      [rider(-90)],
    );

    expect(offeredStarts(timed)).toEqual([5 * 60 + 30]);
  });

  it('carries the party’s earliest instant on a companion-first move — the stored utcEpochMs (DEP-F6)', () => {
    const offered = option(11 * 60);

    const [timed] = timedOptionsOf([offered], ORDINARY_DAY, SOFIA, [
      rider(-90),
    ]);

    // The chip still reads the booker's 11:00; its instant is the
    // companion's 09:30, where the server's frame puts the visit.
    expect(timed?.located).toBe(offered);
    expect(timed?.startUtcMs).toBe(utcMs('2027-03-27T09:30:00.000+02:00'));
  });

  it('frames nothing for an option with no seat to anchor to', () => {
    const seatless = option(10 * 60);
    expect(
      timedOptionsOf(
        [{ ...seatless, option: { ...seatless.option, assignments: [] } }],
        ORDINARY_DAY,
        SOFIA,
        [rider(0)],
      ),
    ).toEqual([]);
  });

  it('frames a party once per call, and still answers every option it shares', () => {
    const toUtc = vi.spyOn(ZonedTimeSystem, 'toUtc');
    // One start on three chairs: three options, one minute to place.
    const options = [
      option(10 * 60),
      { ...option(10 * 60), locationId: LocationId.of('loc-south') },
      option(10 * 60),
    ];

    const timed = timedOptionsOf(options, ORDINARY_DAY, SOFIA, []);

    expect(timed.map((entry) => entry.located)).toEqual(options);
    expect(new Set(timed.map((entry) => entry.startUtcMs)).size).toBe(1);
    expect(toUtc).toHaveBeenCalledTimes(1);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const options = deepFreeze([
      option(2 * 60, 2 * 60 + 30),
      option(3 * 60 + 30),
      option(5 * 60),
    ]);
    const riders = deepFreeze([rider(-90), rider(15)]);

    const once = timedOptionsOf(options, GAP_DAY, SOFIA, riders);
    const twice = timedOptionsOf(options, GAP_DAY, SOFIA, riders);

    expect(twice).toEqual(once);
  });
});
