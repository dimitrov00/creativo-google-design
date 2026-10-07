import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type BookingDraftRider,
  CartLineId,
  type Result,
  type ScheduleSelection,
  TimeSlot,
  ZonedDateTime,
} from '@creativo/application/booking';
import { BarberId, LocationId } from '@creativo/application/catalog';
import { placeRiders } from './rider-placement';

const ZONE = 'Europe/Sofia';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const at = (hour: number, minute = 0): ZonedDateTime =>
  unwrap(
    ZonedDateTime.fromParts(
      { year: 2026, month: 8, day: 4, hour, minute },
      ZONE,
    ),
  );

/** A selection whose seats start at `starts` (45 minutes each, with Ivan). */
function selection(starts: readonly ZonedDateTime[]): ScheduleSelection {
  const assignments = starts.map((start, index) => ({
    lineId: CartLineId.fromSequence(index + 1),
    barberId: unwrap(BarberId.create('ivan')),
    slot: unwrap(TimeSlot.of(start, start.plusMinutes(45))),
  }));
  // The envelope is not what riders are placed by — any valid slot will do.
  const first = starts.at(0) ?? at(14);
  return {
    locationId: unwrap(LocationId.create('loc-center')),
    timeSlot: unwrap(TimeSlot.of(first, first.plusMinutes(45))),
    assignments,
  };
}

function rider(offsetMinutes: number): BookingDraftRider {
  return {
    serviceId: 'svc-beard',
    variantId: null,
    barberId: 'petar',
    offsetMinutes,
    durationMinutes: 30,
    setupMinutes: 0,
    cleanupMinutes: 0,
  };
}

describe('placeRiders — the server’s shift, restated for the review card', () => {
  it('seats a side-by-side companion at the booker’s new start', () => {
    const [placed] = placeRiders(selection([at(14)]), [rider(0)]);
    expect(placed?.startMs).toBe(at(14).toMillis());
  });

  it('keeps a companion straight after the booker straight after them', () => {
    const [placed] = placeRiders(selection([at(14)]), [rider(45)]);
    expect(placed?.startMs).toBe(at(14, 45).toMillis());
  });

  it('anchors on the EARLIEST seat the cart holds, whatever order it lists them in', () => {
    const [placed] = placeRiders(selection([at(15), at(14, 30)]), [rider(-30)]);
    expect(placed?.startMs).toBe(at(14).toMillis());
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
          const start = at(0).plusMinutes(startMinutes);
          const placed = placeRiders(selection([start]), offsets.map(rider));
          expect(
            placed.map((entry) => entry.startMs - start.toMillis()),
          ).toEqual(offsets.map((offset) => offset * 60_000));
        },
      ),
    );
  });
});
