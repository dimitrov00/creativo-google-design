import { describe, expect, it } from 'vitest';
import { CartLineId as FlowLineId } from '@creativo/application/booking';
import { BarberId, CartLineId, LocationId } from '@core/primitives';
import type { CartLocatedOption } from '@core/systems';
import { FIXTURE_TIME_ZONE, at, localDate, until } from '@core/testing';
import { toScheduleSelection } from './booking-time-sheet';

/*
 * The one place an offer on the shop's wall clock becomes the selection the
 * flow machine holds (Phase 4: instants) — and so the instants the wire's
 * `startIso` is written from. Every minute is placed on the absolute
 * timeline ONCE, with the shop's zone.
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

const KNOWN = new Map([
  ['line-1', FlowLineId.fromSequence(1)],
  ['line-2', FlowLineId.fromSequence(2)],
]);

describe('toScheduleSelection — an offer, as the flow machine takes it', () => {
  it('places every minute on the shop’s clock, the envelope and each seat alike', () => {
    const selection = toScheduleSelection(
      OPTION,
      localDate('2026-09-29'),
      FIXTURE_TIME_ZONE,
      (raw) => KNOWN.get(raw) ?? null,
    );

    expect(selection?.locationId.value).toBe('loc-center');
    expect(selection?.timeSlot.start.toISO()).toBe(
      '2026-09-29T10:00:00.000+03:00',
    );
    expect(selection?.timeSlot.end.toISO()).toBe(
      '2026-09-29T11:00:00.000+03:00',
    );
    expect(
      selection?.assignments.map((assignment) => [
        assignment.lineId.value,
        assignment.barberId.value,
        assignment.slot.start.toISO(),
        assignment.slot.end.toISO(),
      ]),
    ).toEqual([
      [
        KNOWN.get('line-1')?.value,
        'ivan',
        '2026-09-29T10:00:00.000+03:00',
        '2026-09-29T10:30:00.000+03:00',
      ],
      [
        KNOWN.get('line-2')?.value,
        'niko',
        '2026-09-29T10:30:00.000+03:00',
        '2026-09-29T11:00:00.000+03:00',
      ],
    ]);
  });

  it('refuses an offer naming a line the bag no longer holds', () => {
    expect(
      toScheduleSelection(
        OPTION,
        localDate('2026-09-29'),
        FIXTURE_TIME_ZONE,
        (raw) => (raw === 'line-1' ? (KNOWN.get(raw) ?? null) : null),
      ),
    ).toBeNull();
  });

  it('refuses a minute the spring-forward gap erased — never a time that does not exist', () => {
    // 2027-03-28: Sofia's clocks jump from 03:00 to 04:00.
    const gap: CartLocatedOption = {
      ...OPTION,
      option: {
        ...OPTION.option,
        startMinutes: at(3, 30),
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
    expect(
      toScheduleSelection(
        gap,
        localDate('2027-03-28'),
        FIXTURE_TIME_ZONE,
        (raw) => KNOWN.get(raw) ?? null,
      ),
    ).toBeNull();
  });
});
