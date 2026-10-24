import { describe, expect, it } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { BlockKind, MinuteBlock, type MinuteRange } from '@core/components';
import { Result, BarberId, type TimeZone } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { type BarberBusyDay, Collections } from '@core/entities';
import type { LoadBusyDay, ObserveBusyDay } from '@core/ports';
import { AvailabilitySystem, IntervalSetSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  endMinute,
  localDate,
  memoryStore,
  minute,
  type MemoryStore,
  utcMs,
} from './test-support';
import { deepFreeze } from './deep-freeze';
import {
  memoryLoadBusyDay,
  memoryObserveBusyDay,
} from './booking-core.fixtures';
import {
  type SchedulingBusyCase,
  schedulingPortsContract,
} from './scheduling.port.contract';

/*
 * The contract's own spec, and its first runner: the in-memory port
 * doubles. The cases are `availabilityReaderBusyCases`' (the legacy
 * `availability-reader.contract.spec.ts` checks the same answers against
 * `paddedBusy`), now over the raw `LoadBusyDay`/`ObserveBusyDay` streams,
 * on the shop's wall clock.
 */

const ivan = BarberId.of('ivan');
const niko = BarberId.of('niko');
const contract = schedulingPortsContract({
  localDate: FIXTURE_TODAY,
  timeZone: FIXTURE_TIME_ZONE,
  barberId: ivan,
  otherBarberId: niko,
});
const CASES = contract.cases;
const named = CASES.map((entry) => [entry.name, entry] as const);

/** A store holding exactly the case's stored day, frozen: a port may not write into what it reads. */
function storeFor(entry: SchedulingBusyCase): MemoryStore {
  const { id, ...body } = entry.stored;
  return memoryStore([
    { path: [Collections.BarberBusy, id], body: deepFreeze({ ...body }) },
  ]);
}

/** Ivan's `busy` padded first and released after — the order the contract forbids. */
function releasedLate(entry: SchedulingBusyCase): readonly MinuteRange[] {
  const padded = AvailabilitySystem.paddedBusy(
    ivan,
    { blocks: entry.spans },
    entry,
    [],
  );
  const own = (entry.release ?? []).filter((chair) => chair.barberId === ivan);
  return IntervalSetSystem.subtract(padded, own);
}

/** A port that cannot read. */
const readFailed = (): Result<never, RepositoryError> =>
  Result.err(RepositoryError.readFailed(null, 'offline'));

describe('schedulingPortsContract — the busy cases', () => {
  it('keeps the legacy contract’s six cases, by name and in order', () => {
    expect(CASES.map((entry) => entry.name)).toEqual([
      'nothing handed back: every span padded by the turnaround',
      'an empty release is the ordinary booking',
      'the moved visit’s own chair is released BEFORE padding, and the neighbour keeps its turnaround',
      'somebody else’s chair frees none of this barber’s time',
      'a visit that was the whole day leaves the day free',
      'every chair of a party is released, one barber’s share at a time',
    ]);
  });

  it('places every case on the asked day, under the one busy key', () => {
    // 2026-09-28 00:00 EEST — the day's first instant, the one the
    // projection stamps.
    const dayStart = utcMs('2026-09-28T00:00:00+03:00');
    expect(contract.localDate).toBe(FIXTURE_TODAY);
    expect(contract.dayStartUtcMs).toBe(dayStart);
    expect(contract.key).toBe(`ivan__${FIXTURE_TODAY}`);
    for (const entry of CASES) {
      expect(entry.stored).toMatchObject({
        id: contract.key,
        barberId: ivan,
        localDate: FIXTURE_TODAY,
        utcEpochMs: dayStart,
      });
    }
  });

  it.each(named)(
    'stores the spans as the projection does, and reads them back: %s',
    (_name, entry) => {
      const normalized = IntervalSetSystem.normalize(entry.spans);
      // Stored: normalized, each a BUSY block on the wall clock.
      expect(entry.stored.blocks).toEqual(
        normalized.map((range) => ({ ...range, blockKind: BlockKind.Busy })),
      );
      // Read back: the blocks ARE the spans — no conversion in between.
      expect(
        AvailabilitySystem.paddedBusy(ivan, entry.stored, null, []),
      ).toEqual(normalized);
    },
  );

  it.each(named)('answers as the systems do: %s', (_name, entry) => {
    // The hand-worked answer IS the derivation over the stored day, and
    // the server's own rule over the spans: the cases, the stored shape
    // and the systems cannot drift apart.
    expect(contract.busyOf(entry.stored, entry)).toEqual(entry.busy);
    expect(
      AvailabilitySystem.paddedBusy(
        ivan,
        { blocks: entry.spans },
        entry,
        entry.release ?? [],
      ),
    ).toEqual(entry.busy);
  });

  it('reads no document as a free day, whatever is handed back', () => {
    for (const entry of CASES) expect(contract.busyOf(null, entry)).toEqual([]);
  });

  it('answers a missing hand-back and an empty one alike', () => {
    const [missing, empty] = CASES;
    expect(missing?.release).toBeNull();
    expect(empty?.release).toEqual([]);
    expect(missing?.busy).toEqual(empty?.busy);
  });

  it('catches a port or a caller that ignores the release', () => {
    // What the legacy Firestore adapter did for a round: pad the stored
    // spans and drop the hand-back. At least one case must tell it apart.
    const blind = CASES.filter(
      (entry) =>
        JSON.stringify(
          AvailabilitySystem.paddedBusy(
            ivan,
            { blocks: entry.spans },
            entry,
            [],
          ),
        ) !== JSON.stringify(entry.busy),
    );
    expect(blind.map((entry) => entry.name)).toContain(
      'the moved visit’s own chair is released BEFORE padding, and the neighbour keeps its turnaround',
    );
  });

  it('catches a caller that releases AFTER padding', () => {
    // Subtracting the chair from the padded geometry frees the neighbour's
    // turnaround — the other way to get the release wrong.
    const late = CASES.filter(
      (entry) =>
        JSON.stringify(releasedLate(entry)) !== JSON.stringify(entry.busy),
    );
    expect(late.length).toBeGreaterThan(0);
  });

  it('catches a port that pads what it stores', () => {
    // A port that hands back the padded geometry gets the turnaround twice.
    const padded = CASES.filter((entry) => {
      const twice: BarberBusyDay = {
        ...entry.stored,
        blocks: entry.busy.map((range) =>
          MinuteBlock.of(
            minute(range.startMinutes),
            endMinute(range.endMinutes),
            BlockKind.Busy,
          ),
        ),
      };
      return (
        JSON.stringify(contract.busyOf(twice, entry)) !==
        JSON.stringify(entry.busy)
      );
    });
    expect(padded.length).toBeGreaterThan(0);
  });

  it('refuses a zone it cannot place the cases in', () => {
    expect(() =>
      schedulingPortsContract({
        localDate: localDate('2026-09-28'),
        timeZone: 'Nowhere/Atlantis' as TimeZone,
        barberId: ivan,
        otherBarberId: niko,
      }),
    ).toThrow(/cannot place 2026-09-28 in Nowhere\/Atlantis/);
  });
});

describe('memoryLoadBusyDay — held to the contract', () => {
  it.each(named)('%s', async (_name, entry) => {
    expect(
      await contract.busyThroughLoad(memoryLoadBusyDay(storeFor(entry)), entry),
    ).toEqual(entry.busy);
  });

  it('hands back the stored day unchanged, and `null` for a day nobody stored', async () => {
    const [entry] = CASES;
    if (entry === undefined) throw new Error('no case');
    const load = memoryLoadBusyDay(storeFor(entry));

    expect(await load(contract.key)).toEqual({ ok: true, value: entry.stored });
    expect(
      await load(
        schedulingPortsContract({
          localDate: localDate('2026-09-29'),
          timeZone: FIXTURE_TIME_ZONE,
          barberId: ivan,
          otherBarberId: niko,
        }).key,
      ),
    ).toEqual({ ok: true, value: null });
  });

  it('rejects with the port’s error, so a broken runner never passes', async () => {
    const [entry] = CASES;
    if (entry === undefined) throw new Error('no case');
    const failing: LoadBusyDay = async () => readFailed();

    await expect(contract.busyThroughLoad(failing, entry)).rejects.toThrow(
      /loadBusyDay\(ivan__2026-09-28\) failed/,
    );
  });
});

describe('memoryObserveBusyDay — held to the contract', () => {
  it.each(named)('%s', async (_name, entry) => {
    expect(
      await contract.busyThroughObserve(
        memoryObserveBusyDay(storeFor(entry)),
        entry,
      ),
    ).toEqual(entry.busy);
  });

  it('emits the stored day once, and `null` for an empty store', async () => {
    const [entry] = CASES;
    if (entry === undefined) throw new Error('no case');

    expect(
      await firstValueFrom(memoryObserveBusyDay(storeFor(entry))(contract.key)),
    ).toEqual({ ok: true, value: entry.stored });
    expect(
      await firstValueFrom(memoryObserveBusyDay(memoryStore())(contract.key)),
    ).toEqual({ ok: true, value: null });
  });

  it('reads the store when subscribed, not when the stream is asked for', async () => {
    const [entry] = CASES;
    if (entry === undefined) throw new Error('no case');
    const store = memoryStore();
    const stream = memoryObserveBusyDay(store)(contract.key);
    const { id, ...body } = entry.stored;
    store.set(`${Collections.BarberBusy}/${id}`, body);

    expect(await firstValueFrom(stream)).toEqual({
      ok: true,
      value: entry.stored,
    });
  });

  it('rejects with the stream’s error, so a broken runner never passes', async () => {
    const [entry] = CASES;
    if (entry === undefined) throw new Error('no case');
    const failing: ObserveBusyDay = () => of(readFailed());

    await expect(contract.busyThroughObserve(failing, entry)).rejects.toThrow(
      /observeBusyDay\(ivan__2026-09-28\) failed/,
    );
  });
});
