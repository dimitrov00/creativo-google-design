import { describe, expect, it } from 'vitest';
import {
  AttemptOutcome,
  BarberPreference,
  BookingLifecycle,
  BookingPolicy,
  ClientStatsOutcome,
  ClientStatsPolicy,
  Placement,
  PolicyPass,
  PreciseInstant,
  SeatOccupant,
  SeatOutcome,
  SubjectRelationship,
  WriteAction,
  WriteOp,
} from '@core/components';
import {
  AppointmentId,
  type CustomerId,
  Result,
  SeatId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { type Appointment, Collections } from '@core/entities';
import type { CommitPlan } from '@core/ports';
import {
  bodyOf,
  appointmentFixture,
  customerOf,
  endMinute,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TIME_ZONE,
  localDate,
  locationFixture,
  memoryDefaultLocationPorts,
  memoryLocationLoadPorts,
  memoryProgramsWorld,
  memoryStore,
  type MemoryStore,
  memoryTxPorts,
  minute,
  recordingTelemetry,
  seatFixture,
} from '@core/testing';
import {
  clientHistory,
  clientStatsPaths,
  projectClientStats,
  recomputeClientStats,
} from './project-client-stats.pipeline';

/*
 * The client projection (`recompute-client-stats.ts`,
 * `dispatch-client-projections.ts`): every client record a write can have
 * moved is recomputed ON ITS OWN, in its own transaction — the history
 * (`subjectCustomerIds array-contains`), the stored pair, then the pass
 * guard, the projection clock and the revision guard. The statistics and
 * the guards' math are `ClientStatsSystem`'s and
 * `PolicyRecomputeJobSystem`'s specs; this one asserts the read set, the
 * plans that reached the commit, and how failures are reported.
 */

const CLIENT = FIXTURE_IDS.customer;
const COMPANION_USER = UserId.of('u-companion');
const COMPANION = customerOf(COMPANION_USER);
const WORKED_AT = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -3_600_000);

/** A worked party visit: the client and a companion, each with a seat. */
function partyVisit(
  id = 'appt-party',
  day = localDate('2026-09-21'),
): Appointment {
  const seats = [
    seatFixture({
      seatId: SeatId.of('seat-1'),
      outcome: SeatOutcome.worked(WORKED_AT),
    }),
    seatFixture({
      seatId: SeatId.of('seat-2'),
      barberId: FIXTURE_IDS.barber,
      startMinutes: minute(630),
      occupant: SeatOccupant.account(
        COMPANION_USER,
        COMPANION,
        SubjectRelationship.Companion,
      ),
      outcome: SeatOutcome.worked(WORKED_AT),
    }),
  ];
  return appointmentFixture({
    id: AppointmentId.of(id),
    localDate: day,
    seats,
    endMinutes: endMinute(660),
    subjectUserIds: [COMPANION_USER, FIXTURE_IDS.client].sort(),
    subjectCustomerIds: [CLIENT, COMPANION].sort(),
    lifecycle: BookingLifecycle.complete(WORKED_AT),
  });
}

function storeOf(appointments: readonly Appointment[]): MemoryStore {
  return memoryStore(
    appointments.map((appointment) => ({
      path: [Collections.Appointments, appointment.id],
      body: bodyOf(appointment),
    })),
  );
}

/**
 * The shop's clock a client is judged on (Law 7.2, F-4 — a stats record
 * names no shop): the default location's, the fixture shop on
 * `FIXTURE_TIME_ZONE`.
 */
const ZONE_PORTS = {
  ...memoryLocationLoadPorts(
    memoryProgramsWorld({ locations: [locationFixture()] }),
  ),
  ...memoryDefaultLocationPorts(),
};

function rig(store: MemoryStore, commit?: CommitPlan) {
  const tx = memoryTxPorts(store);
  const telemetry = recordingTelemetry();
  let policyReads = 0;
  const ports = {
    ...tx,
    ...(commit === undefined ? {} : { commit }),
    ...telemetry,
    ...ZONE_PORTS,
    loadPolicy: async () => {
      policyReads += 1;
      return Result.ok(BookingPolicy.DEFAULT);
    },
  };
  return {
    tx,
    ports,
    run: projectClientStats(ports),
    policyReads: () => policyReads,
  };
}

const sorted = (...ids: CustomerId[]) => [...ids].sort();

describe('projectClientStats', () => {
  it('recomputes every client record on a visit, each in its own transaction, both documents at version 1', async () => {
    const store = storeOf([partyVisit()]);
    const { tx, run } = rig(store);
    const answer = await run({ customerIds: sorted(CLIENT, COMPANION) });
    expect(answer).toEqual({
      ok: true,
      value: { written: 2, failures: [], attemptFailure: null },
    });
    expect(tx.plans).toHaveLength(2);
    for (const [index, customerId] of sorted(CLIENT, COMPANION).entries()) {
      const paths = clientStatsPaths(customerId);
      const plan = tx.plans[index] ?? [];
      expect(plan.map((write) => [write.writeAction, write.path])).toEqual([
        [WriteAction.Set, paths.stats],
        [WriteAction.Set, paths.money],
      ]);
      expect(plan[0]).toMatchObject({
        body: {
          customerId,
          lifetimeVisitsCompleted: 1,
          version: 1,
          updatedAtUtcMs: FIXTURE_NOW_UTC_MS,
          policyPassGeneration: null,
        },
      });
      expect(plan[1]).toMatchObject({
        body: { customerId, version: 1, lifetimeSpendCents: 2800 },
      });
      // The read set: the record's history (#19) and its stored pair.
      expect(tx.transactions[index]?.queries).toEqual([
        clientHistory(customerId),
      ]);
      expect(tx.transactions[index]?.reads).toEqual([paths.stats, paths.money]);
    }
  });

  it('writes nothing on a redelivery — the same answer bumps nothing', async () => {
    const store = storeOf([partyVisit()]);
    const { tx, run } = rig(store);
    await run({ customerIds: [CLIENT] });
    await run({ customerIds: [CLIENT] });
    expect(tx.plans[1]).toEqual([]);
  });

  it('exits before any read when the write moved nobody’s stats', async () => {
    const { tx, run, policyReads } = rig(storeOf([]));
    expect(await run({ customerIds: [] })).toEqual({
      ok: true,
      value: { written: 0, failures: [], attemptFailure: null },
    });
    expect(policyReads()).toBe(0);
    expect(tx.transactions).toEqual([]);
  });

  it.each([
    ['a permanent', 9, AttemptOutcome.Permanent],
    ['a transient', 14, AttemptOutcome.Transient],
  ])(
    'recomputes the rest of the party after %s failure, and reports it for the edge',
    async (_what, code, outcome) => {
      const store = storeOf([partyVisit()]);
      const tx = memoryTxPorts(store);
      const failure = Object.assign(new Error(`${code} FAILED`), { code });
      let calls = 0;
      const { run } = rig(store, (read, decide) => {
        calls += 1;
        return calls === 1 ? Promise.reject(failure) : tx.commit(read, decide);
      });
      const answer = await run({ customerIds: sorted(CLIENT, COMPANION) });
      expect(answer.ok && answer.value.written).toBe(1);
      expect(answer.ok && answer.value.failures).toEqual([failure]);
      expect(answer.ok && answer.value.attemptFailure).toMatchObject({
        error: failure,
        attemptOutcome: outcome,
      });
      expect(tx.plans).toHaveLength(1);
    },
  );

  it('names the barber asked for only on visits whose COMMIT stamped its placement — never an inference', async () => {
    const asked = (id: string, day: string, placement: Placement | null) =>
      appointmentFixture({
        id: AppointmentId.of(id),
        localDate: localDate(day),
        placement,
        inferredPlacement: placement === null ? Placement.Self : null,
        seats: [
          seatFixture({
            barberPreference: BarberPreference.Specific,
            outcome: SeatOutcome.worked(WORKED_AT),
          }),
        ],
        lifecycle: BookingLifecycle.complete(WORKED_AT),
      });
    const stamped = rig(
      storeOf([
        asked('a1', '2026-09-14', Placement.Self),
        asked('a2', '2026-09-21', Placement.Self),
      ]),
    );
    await stamped.run({ customerIds: [CLIENT] });
    expect(stamped.tx.plans[0]?.[0]).toMatchObject({
      body: { preferredBarberId: FIXTURE_IDS.barber },
    });

    const inferred = rig(
      storeOf([
        asked('a1', '2026-09-14', null),
        asked('a2', '2026-09-21', null),
      ]),
    );
    await inferred.run({ customerIds: [CLIENT] });
    expect(inferred.tx.plans[0]?.[0]).toMatchObject({
      body: { preferredBarberId: null },
    });
  });

  it('never runs the clock behind the stored answer', async () => {
    const later = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 60_000);
    const store = storeOf([partyVisit()]);
    const { run } = rig(store);
    await run({ customerIds: [CLIENT] });
    const statsPath = clientStatsPaths(CLIENT).stats.join('/');
    const moneyPath = clientStatsPaths(CLIENT).money.join('/');
    store.set(statsPath, {
      ...store.get(statsPath),
      updatedAtUtcMs: later,
      lifetimeVisitsCompleted: 7,
    });
    store.set(moneyPath, { ...store.get(moneyPath), updatedAtUtcMs: later });
    const second = rig(store);
    await second.run({ customerIds: [CLIENT] });
    expect(second.tx.plans[0]?.[0]).toMatchObject({
      body: { updatedAtUtcMs: later, version: 2, lifetimeVisitsCompleted: 1 },
    });
  });

  it('empties the stats of somebody who left every visit, rather than keeping stale numbers', async () => {
    const store = storeOf([partyVisit()]);
    await rig(store).run({ customerIds: [COMPANION] });
    store.delete(`${Collections.Appointments}/appt-party`);
    const { tx, run } = rig(store);
    await run({ customerIds: [COMPANION] });
    expect(tx.plans[0]?.[0]).toMatchObject({
      writeAction: WriteAction.Set,
      body: { lifetimeVisitsCompleted: 0, version: 2 },
    });
  });

  it('answers a policy it cannot read, recomputing nobody', async () => {
    const failure = RepositoryError.readFailed(
      'settings/bookingPolicy',
      'unavailable',
    );
    const tx = memoryTxPorts(storeOf([partyVisit()]));
    const run = projectClientStats({
      ...tx,
      ...recordingTelemetry(),
      ...ZONE_PORTS,
      loadPolicy: async () => Result.err(failure),
    });
    expect(await run({ customerIds: [CLIENT] })).toEqual({
      ok: false,
      error: failure,
    });
    expect(tx.transactions).toEqual([]);
  });

  it('answers a zone it cannot read as its store failure, recomputing nobody (4A-2 (e))', async () => {
    const failed = RepositoryError.readFailed('locations/loc-center', 'down');
    const tx = memoryTxPorts(storeOf([partyVisit()]));
    const run = projectClientStats({
      ...tx,
      ...recordingTelemetry(),
      ...memoryDefaultLocationPorts(),
      loadLocation: async () => Result.err(failed),
      loadPolicy: async () => Result.ok(BookingPolicy.DEFAULT),
    });
    expect(await run({ customerIds: [CLIENT] })).toEqual(Result.err(failed));
    expect(tx.transactions).toEqual([]);
  });
});

describe('recomputeClientStats — under a policy pass', () => {
  const policy = ClientStatsPolicy.forBooking(BookingPolicy.DEFAULT);
  const instant = (seconds: number) => {
    const at = PreciseInstant.of(seconds, 0);
    if (at === null) throw new Error('a broken fixture');
    return at;
  };
  const older = PolicyPass.of('evt-old', instant(1_700_000_000));
  const newer = PolicyPass.of('evt-new', instant(1_800_000_000));

  it('lets a newer pass restamp an unchanged answer — the stamp’s root fields alone', async () => {
    const store = storeOf([partyVisit()]);
    const { ports } = rig(store);
    await recomputeClientStats(ports, policy, CLIENT, null, FIXTURE_TIME_ZONE);
    const tx = memoryTxPorts(store);
    const outcome = await recomputeClientStats(
      { ...ports, commit: tx.commit },
      policy,
      CLIENT,
      newer,
      FIXTURE_TIME_ZONE,
    );
    expect(outcome).toEqual({ ok: true, value: ClientStatsOutcome.Unchanged });
    expect(tx.plans).toEqual([
      [
        WriteOp.update(clientStatsPaths(CLIENT).stats, {
          policyPassGeneration: 'evt-new',
          policyPassChangedAtSeconds: 1_800_000_000,
          policyPassChangedAtNanos: 0,
        }),
      ],
    ]);
  });

  it('writes nothing under an older pass than the stamp — the newer pass has the last word', async () => {
    const store = storeOf([partyVisit()]);
    const { ports } = rig(store);
    await recomputeClientStats(ports, policy, CLIENT, newer, FIXTURE_TIME_ZONE);
    const tx = memoryTxPorts(store);
    const outcome = await recomputeClientStats(
      { ...ports, commit: tx.commit },
      policy,
      CLIENT,
      older,
      FIXTURE_TIME_ZONE,
    );
    expect(outcome).toEqual({ ok: true, value: ClientStatsOutcome.Superseded });
    expect(tx.plans).toEqual([[]]);
  });
});
