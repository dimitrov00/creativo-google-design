import { describe, expect, it } from 'vitest';
import { BarberId, CartLineId, LocationId } from '@core/primitives';
import type { CartLocatedOption } from '@core/systems';
import { at, localDate, until } from '@core/testing';
import { toScheduleSelection } from './booking-time-sheet';

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
    // offers such a start (one with no instant is not listed), and a
    // hand-made one is refused `DST_GAP_INVALID_TIME` at the ingestion
    // boundary (Phase 4a 4A-2 (a)) — the selection itself is wall clock only.
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
