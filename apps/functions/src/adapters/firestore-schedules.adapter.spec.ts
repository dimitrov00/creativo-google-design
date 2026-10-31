import type { Firestore } from 'firebase-admin/firestore';
import { vi } from 'vitest';
import { BarberId, BusyKey } from '@core/primitives';
import { RepositoryError, RepositoryErrorCode } from '@core/errors';
import { Collections } from '@core/entities';
import type { Log } from '@core/ports';
import {
  barberBusyDayFixture,
  barberScheduleFixture,
  FIXTURE_IDS,
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  recordingTelemetry,
  scheduleExceptionFixture,
  type SchedulingBusyCase,
  schedulingPortsContract,
  unguarded,
} from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { StoredDocumentSystem } from '@core/systems';
import { firestoreSchedulePorts } from './firestore-schedules.adapter';
import { bodyOf } from './store-answer';

/*
 * The scheduling server reads outside any transaction, over the in-memory
 * Admin SDK — and the third runner of the scheduling ports' busy contract
 * (`schedulingPortsContract`, beside the in-memory doubles and the browser
 * bundle): `loadBusyDay` hands back exactly what the projection stores, the
 * caller derives `busy` (released first, then padded).
 */

/**
 * The mechanics cases' log: they read through the test support's
 * `unguarded` registry (OR-33 — the registry and the log have no default),
 * so there is no refusal to report.
 */
const NO_LOG: Log = () => undefined;

const IVAN = BarberId.of('ivan');
const NIKO = BarberId.of('niko');
const contract = schedulingPortsContract({
  localDate: FIXTURE_TODAY,
  timeZone: FIXTURE_TIME_ZONE,
  barberId: IVAN,
  otherBarberId: NIKO,
});

function storeFor(entry: SchedulingBusyCase) {
  return createProjectionFirestore({
    [`${Collections.BarberBusy}/${entry.stored.id}`]: bodyOf(entry.stored),
  });
}

describe('firestoreSchedulePorts.loadBusyDay — the scheduling ports’ busy contract', () => {
  it.each(contract.cases.map((entry) => [entry.name, entry] as const))(
    '%s',
    async (_name, entry) => {
      const ports = firestoreSchedulePorts(
        storeFor(entry).db as unknown as Firestore,
        unguarded,
        NO_LOG,
      );
      expect(await contract.busyThroughLoad(ports.loadBusyDay, entry)).toEqual(
        entry.busy,
      );
    },
  );

  it('hands back the stored day exactly — no padding, no merging — and `null` for a free day', async () => {
    const day = barberBusyDayFixture();
    const fake = createProjectionFirestore({
      [`${Collections.BarberBusy}/${day.id}`]: bodyOf(day),
    });
    const ports = firestoreSchedulePorts(
      fake.db as unknown as Firestore,
      unguarded,
      NO_LOG,
    );
    expect(
      await ports.loadBusyDay(BusyKey.of(FIXTURE_IDS.barber, FIXTURE_TODAY)),
    ).toEqual({
      ok: true,
      value: day,
    });
    expect(await ports.loadBusyDay(BusyKey.of(NIKO, FIXTURE_TODAY))).toEqual({
      ok: true,
      value: null,
    });
  });
});

describe('firestoreSchedulePorts — rosters, exceptions and the rostered population', () => {
  const schedule = barberScheduleFixture();
  const exception = scheduleExceptionFixture();
  const fake = createProjectionFirestore({
    [`${Collections.BarberSchedules}/${schedule.id}`]: bodyOf(schedule),
    [`${Collections.BarberSchedules}/niko`]: bodyOf(
      barberScheduleFixture({ id: NIKO }),
    ),
    [`${Collections.ScheduleExceptions}/${exception.id}`]: bodyOf(exception),
  });
  const ports = firestoreSchedulePorts(
    fake.db as unknown as Firestore,
    unguarded,
    NO_LOG,
  );

  it('reads a roster by the barber’s id, `null` when unrostered', async () => {
    expect(await ports.loadSchedule(FIXTURE_IDS.barber)).toEqual({
      ok: true,
      value: schedule,
    });
    expect(await ports.loadSchedule(BarberId.of('nobody'))).toEqual({
      ok: true,
      value: null,
    });
  });

  it('reads an exception by the day’s busy key, `null` when the day is as rostered', async () => {
    expect(
      await ports.loadScheduleException(
        BusyKey.of(FIXTURE_IDS.barber, FIXTURE_TODAY),
      ),
    ).toEqual({ ok: true, value: exception });
    expect(
      await ports.loadScheduleException(BusyKey.of(NIKO, FIXTURE_TODAY)),
    ).toEqual({ ok: true, value: null });
  });

  it('lists the rostered barbers — the roster ids, bodies not read', async () => {
    expect(await ports.listBarbers()).toEqual({
      ok: true,
      value: [FIXTURE_IDS.barber, NIKO],
    });
  });

  it('answers a read that throws as a value, the canonical code its reason', async () => {
    const broken = createProjectionFirestore();
    vi.spyOn(broken.db, 'collection').mockImplementation(() => {
      throw Object.assign(new Error('10 ABORTED'), { code: 10 });
    });
    const failing = firestoreSchedulePorts(
      broken.db as unknown as Firestore,
      unguarded,
      NO_LOG,
    );
    expect(await failing.loadSchedule(FIXTURE_IDS.barber)).toEqual({
      ok: false,
      error: RepositoryError.readFailed(
        `${Collections.BarberSchedules}/${FIXTURE_IDS.barber}`,
        'aborted',
      ),
    });
    expect(await failing.listBarbers()).toEqual({
      ok: false,
      error: RepositoryError.readFailed(Collections.BarberSchedules, 'aborted'),
    });
  });
});

describe('firestoreSchedulePorts, guarded — a busy day is a SINGLE read (edge hardening D-3)', () => {
  const KEY = BusyKey.of(FIXTURE_IDS.barber, FIXTURE_TODAY);
  const guarded = (body: Record<string, unknown>) => {
    const telemetry = recordingTelemetry();
    const fake = createProjectionFirestore({
      [`${Collections.BarberBusy}/${KEY}`]: body,
    });
    return {
      telemetry,
      ports: firestoreSchedulePorts(
        fake.db as unknown as Firestore,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
    };
  };

  it('answers a malformed busy day as REPOSITORY_MALFORMED naming path and field, logged once', async () => {
    const { telemetry, ports } = guarded({
      ...bodyOf(barberBusyDayFixture()),
      blocks: [{ startMinutes: 600, endMinutes: 630, blockKind: 'LUNCH' }],
    });
    expect(await ports.loadBusyDay(KEY)).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.Malformed,
        path: `${Collections.BarberBusy}/${KEY}`,
        reason: 'blocks[0].blockKind',
      },
    });
    expect(telemetry.lines).toEqual([
      {
        level: 'error',
        msg: 'malformed document refused',
        fields: {
          path: `${Collections.BarberBusy}/${KEY}`,
          field: 'blocks[0].blockKind',
        },
      },
    ]);
  });

  it('reads a well-formed day — and an absent one — exactly as before, logging nothing', async () => {
    const day = barberBusyDayFixture();
    const { telemetry, ports } = guarded(bodyOf(day));
    expect(await ports.loadBusyDay(KEY)).toEqual({ ok: true, value: day });
    expect(await ports.loadBusyDay(BusyKey.of(NIKO, FIXTURE_TODAY))).toEqual({
      ok: true,
      value: null,
    });
    expect(telemetry.lines).toEqual([]);
  });

  it('leaves the unguarded collections as stored — a roster is read as it always was', async () => {
    const telemetry = recordingTelemetry();
    const fake = createProjectionFirestore({
      [`${Collections.BarberSchedules}/${FIXTURE_IDS.barber}`]: { odd: true },
    });
    const ports = firestoreSchedulePorts(
      fake.db as unknown as Firestore,
      StoredDocumentSystem.guardOf,
      telemetry.log,
    );
    expect(await ports.loadSchedule(FIXTURE_IDS.barber)).toEqual({
      ok: true,
      value: { id: FIXTURE_IDS.barber, odd: true },
    });
  });
});
