import { describe, expect, it } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { DayKey } from '../components/day-key.data';
import { TimeInterval } from '../components/time-interval.data';
import type { BarberBusyDayEntity } from '../entities/barber-busy-day.entity';
import { BarberId } from '../entities/barber.entity';
import { Collections } from '../ports/collections';
import { AvailabilitySystem } from '../systems/availability.system';
import { BusySystem } from '../systems/busy.system';
import { IntervalSetSystem } from '../systems/interval-set.system';
import {
  FIXTURE_TODAY,
  FIXTURE_ZONE,
  deepFreeze,
  memoryLoadBusyDay,
  memoryObserveBusyDay,
  memoryStore,
  type MemoryStore,
} from '../testing';
import {
  type SchedulingBusyCase,
  schedulingPortsContract,
} from './scheduling.port.contract';

/*
 * The contract's own spec, and its first runner: the in-memory port
 * doubles. The cases are `availabilityReaderBusyCases`' (the legacy
 * `availability-reader.contract.spec.ts` checks the same answers against
 * `paddedBusy`), now over the raw `LoadBusyDay`/`ObserveBusyDay` streams.
 */

const ivan = BarberId.of('ivan');
const niko = BarberId.of('niko');
const contract = schedulingPortsContract({
  dayKey: FIXTURE_TODAY,
  zone: FIXTURE_ZONE,
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
function releasedLate(entry: SchedulingBusyCase): readonly TimeInterval[] {
  const padded = AvailabilitySystem.paddedBusy({
    barberId: ivan,
    spans: entry.spans,
    turnaroundMinutes: entry.turnaroundMinutes,
    release: [],
  });
  const own = (entry.release ?? [])
    .filter((chair) => chair.barberId === ivan)
    .map((chair) => chair.occupied);
  return IntervalSetSystem.subtract(padded, own);
}

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
    expect(contract.day.dayKey).toBe(FIXTURE_TODAY);
    expect(contract.key).toBe(`ivan__${FIXTURE_TODAY}`);
    for (const entry of CASES) {
      expect(entry.stored).toMatchObject({
        id: contract.key,
        barberId: ivan,
        dayKey: FIXTURE_TODAY,
        zone: FIXTURE_ZONE,
      });
    }
  });

  it.each(named)(
    'stores the spans as the projection does, and reads them back: %s',
    (_name, entry) => {
      expect(BusySystem.spansOf(entry.stored.blocks, contract.day)).toEqual(
        IntervalSetSystem.normalize(entry.spans),
      );
    },
  );

  it.each(named)('answers as the systems do: %s', (_name, entry) => {
    // The hand-worked answer IS the derivation over the stored day, and
    // the server's own rule over the instants: the cases, the stored shape
    // and the systems cannot drift apart.
    expect(contract.busyOf(entry.stored, entry)).toEqual(entry.busy);
    expect(
      AvailabilitySystem.paddedBusy({
        barberId: ivan,
        spans: entry.spans,
        turnaroundMinutes: entry.turnaroundMinutes,
        release: entry.release ?? [],
      }),
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
          AvailabilitySystem.paddedBusy({
            barberId: ivan,
            spans: entry.spans,
            turnaroundMinutes: entry.turnaroundMinutes,
            release: [],
          }),
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
      const twice: BarberBusyDayEntity = {
        ...entry.stored,
        blocks: BusySystem.blocksOf(entry.busy, contract.day),
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
        dayKey: DayKey.of('2026-09-28'),
        zone: 'Nowhere/Atlantis',
        barberId: ivan,
        otherBarberId: niko,
      }),
    ).toThrow(/no day table/);
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
          dayKey: DayKey.of('2026-09-29'),
          zone: FIXTURE_ZONE,
          barberId: ivan,
          otherBarberId: niko,
        }).key,
      ),
    ).toEqual({ ok: true, value: null });
  });

  it('rejects with the port’s error, so a broken runner never passes', async () => {
    const [entry] = CASES;
    if (entry === undefined) throw new Error('no case');
    const failing = async () =>
      ({
        ok: false,
        error: { code: 'repo.read_failed', path: null, reason: 'offline' },
      }) as const;

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
    const failing = () =>
      of({
        ok: false,
        error: { code: 'repo.read_failed', path: null, reason: 'offline' },
      } as const);

    await expect(contract.busyThroughObserve(failing, entry)).rejects.toThrow(
      /observeBusyDay\(ivan__2026-09-28\) failed/,
    );
  });
});
