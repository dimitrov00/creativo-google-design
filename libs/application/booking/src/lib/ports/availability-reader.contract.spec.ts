import { describe, expect, it } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { BarberId, LocationId } from '@creativo/domain/catalog';
import { CalendarDay, Interval, paddedBusy } from '@creativo/domain/scheduling';
import {
  type AvailabilityReaderBusyCase,
  InMemoryAvailabilityReader,
  availabilityReaderBusyCases,
} from './availability-reader.contract';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const ZONE = 'Europe/Sofia';
const day = unwrap(CalendarDay.create('2026-08-03', ZONE));
const ivan = unwrap(BarberId.create('ivan'));
const niko = unwrap(BarberId.create('niko'));
const center = unwrap(LocationId.create('loc-center'));
const CASES = availabilityReaderBusyCases({
  day,
  barberId: ivan,
  otherBarberId: niko,
});

/** Ivan's day as `reader` answers it for one case. */
async function busyOf(
  reader: (entry: AvailabilityReaderBusyCase) => InMemoryAvailabilityReader,
  entry: AvailabilityReaderBusyCase,
): Promise<readonly Interval[] | undefined> {
  const result = unwrap(
    await firstValueFrom(
      reader(entry).observeDay(center, day, [ivan], entry.release),
    ),
  );
  return result.find((barber) => barber.barberId.equals(ivan))?.busy;
}

/** The whole shop day, and Ivan's stored geometry for one case. */
function storedFor(entry: AvailabilityReaderBusyCase) {
  return new InMemoryAvailabilityReader(() => [
    {
      barberId: ivan,
      windows: [{ interval: day.bounds(), locationId: center }],
      spans: entry.spans,
      turnaroundMinutes: entry.turnaroundMinutes,
    },
  ]);
}

describe('availabilityReaderBusyCases — the port’s busy contract', () => {
  it.each(CASES.map((entry) => [entry.name, entry] as const))(
    'answers as the domain rule does: %s',
    (_name, entry) => {
      // The hand-worked answer IS `paddedBusy`: the contract and the rule
      // the server decides by cannot drift apart.
      expect(
        paddedBusy({
          barberId: ivan,
          spans: entry.spans,
          turnaroundMinutes: entry.turnaroundMinutes,
          release: entry.release,
        }),
      ).toEqual(entry.busy);
    },
  );

  it('catches a reader that ignores the release', () => {
    // What the Firestore adapter did for a round: pad the stored spans and
    // drop `release`. At least one case must tell it apart, or the contract
    // proves nothing about the defect it exists for.
    const releaseBlind = CASES.filter(
      (entry) =>
        JSON.stringify(
          paddedBusy({
            barberId: ivan,
            spans: entry.spans,
            turnaroundMinutes: entry.turnaroundMinutes,
          }),
        ) !== JSON.stringify(entry.busy),
    );
    expect(releaseBlind.map((entry) => entry.name)).toContain(
      'the moved visit’s own chair is released BEFORE padding, and the neighbour keeps its turnaround',
    );
  });

  it('catches a reader that releases AFTER padding', () => {
    // Subtracting the chair from the padded geometry frees the neighbour's
    // turnaround — the other way to get the release wrong.
    const releasedLate = CASES.filter((entry) => {
      const padded = paddedBusy({
        barberId: ivan,
        spans: entry.spans,
        turnaroundMinutes: entry.turnaroundMinutes,
      });
      const own = (entry.release ?? [])
        .filter((chair) => chair.barberId.equals(ivan))
        .map((chair) => chair.occupied);
      return (
        JSON.stringify(Interval.subtract(padded, own)) !==
        JSON.stringify(entry.busy)
      );
    });
    expect(releasedLate.length).toBeGreaterThan(0);
  });
});

describe('InMemoryAvailabilityReader — held to the contract', () => {
  it.each(CASES.map((entry) => [entry.name, entry] as const))(
    '%s',
    async (_name, entry) => {
      expect(await busyOf(storedFor, entry)).toEqual(entry.busy);
    },
  );

  it('narrows windows to the shop asked about and leaves out a barber with none there', async () => {
    const mladost = unwrap(LocationId.create('loc-mladost'));
    const reader = new InMemoryAvailabilityReader(() => [
      {
        barberId: niko,
        windows: [{ interval: day.bounds(), locationId: mladost }],
        spans: [],
        turnaroundMinutes: 0,
      },
      {
        barberId: ivan,
        windows: [{ interval: day.bounds(), locationId: center }],
        spans: [],
        turnaroundMinutes: 0,
      },
    ]);

    const atCenter = unwrap(
      await firstValueFrom(reader.observeDay(center, day, [ivan, niko])),
    );
    const anywhere = unwrap(
      await firstValueFrom(reader.observeDay(null, day, [niko, ivan])),
    );

    expect(atCenter.map((barber) => barber.barberId.value)).toEqual(['ivan']);
    // Barber order is id order, whatever order they were asked for in.
    expect(anywhere.map((barber) => barber.barberId.value)).toEqual([
      'ivan',
      'niko',
    ]);
    expect(reader.released).toEqual([undefined, undefined]);
  });
});
