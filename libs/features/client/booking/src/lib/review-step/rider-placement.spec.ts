import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { MoveRider, ScheduleSelection } from '@core/components';
import { BarberId, CartLineId, LocationId, ServiceId } from '@core/primitives';
import {
  duration,
  endMinute,
  localDate,
  minute,
  minuteCount,
  minuteDelta,
} from '@core/testing';
import { placeRiders } from './rider-placement';

/**
 * A selection whose seats start at `starts` — minutes of the shop day, 45
 * minutes each, with Ivan. The envelope is not what riders are placed by —
 * any valid one will do.
 */
function selection(starts: readonly number[]): ScheduleSelection {
  const first = starts.at(0) ?? 14 * 60;
  return {
    locationId: LocationId.of('loc-center'),
    localDate: localDate('2026-08-04'),
    startMinutes: minute(first),
    endMinutes: endMinute(first + 45),
    assignments: starts.map((start, index) => ({
      lineId: CartLineId.forSequence(index + 1),
      barberId: BarberId.of('ivan'),
      startMinutes: minute(start),
      endMinutes: endMinute(start + 45),
    })),
  };
}

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

/** `HH:MM` on the shop's wall clock, as minutes from its midnight. */
const minuteOf = (hour: number, minutes = 0) => hour * 60 + minutes;

describe('placeRiders — the server’s shift, on the shop’s wall clock, for the review card', () => {
  it('seats a side-by-side companion at the booker’s new start', () => {
    const [placed] = placeRiders(selection([minuteOf(14)]), [rider(0)]);
    expect(placed?.startMinutes).toBe(minuteOf(14));
  });

  it('keeps a companion straight after the booker straight after them', () => {
    const [placed] = placeRiders(selection([minuteOf(14)]), [rider(45)]);
    expect(placed?.startMinutes).toBe(minuteOf(14, 45));
  });

  it('anchors on the EARLIEST seat the cart holds, whatever order it lists them in', () => {
    const [placed] = placeRiders(selection([minuteOf(15), minuteOf(14, 30)]), [
      rider(-30),
    ]);
    expect(placed?.startMinutes).toBe(minuteOf(14));
  });

  it('places nobody when there is no seat to anchor to', () => {
    expect(placeRiders(selection([]), [rider(0)])).toEqual([]);
  });

  it('preserves every rider’s distance from the cart’s first seat (property)', () => {
    fc.assert(
      fc.property(
        // The booker's new start, in quarter hours across the working day…
        fc
          .integer({ min: 9 * 4, max: 17 * 4 })
          .map((quarters) => quarters * 15),
        // …and each rider's stored distance from them, in five-minute steps.
        fc.array(
          fc.integer({ min: -24, max: 24 }).map((steps) => steps * 5),
          { maxLength: 4 },
        ),
        (startMinutes, offsets) => {
          const placed = placeRiders(
            selection([startMinutes]),
            offsets.map(rider),
          );
          expect(
            placed.map((entry) => (entry.startMinutes ?? NaN) - startMinutes),
          ).toEqual(offsets);
        },
      ),
    );
  });
});
