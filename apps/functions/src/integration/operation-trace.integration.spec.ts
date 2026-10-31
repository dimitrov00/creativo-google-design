import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  AttemptOutcome,
  BarberPreference,
  Placement,
  RequestedSubjectRole,
} from '@core/components';
import { LogEvent, OperationId, Result } from '@core/primitives';
import { Callables } from '@core/ports';
import { Collections, type TriggerFailure } from '@core/entities';
import { LogDigestSystem } from '@core/systems';
import {
  barberFixture,
  barberScheduleFixture,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  locationFixture,
  pinnedNowUtcMs,
  serviceFixture,
} from '@core/testing';
import { consoleTelemetry } from '../adapters/console-telemetry.adapter';
import { hmacSha256Hex } from '../adapters/crypto.adapter';
import {
  type DeliveredEvent,
  retryingTrigger,
  type TriggerEdgePorts,
} from '../edge';
import { decodeCommitBooking } from '../wire/booking.wire';
import { bodyOf } from '../adapters/store-answer';

/**
 * ONE operation id, followed end to end against the REAL Firestore emulator
 * (audit-hardening WS-4.6 — the trace proof, brief §4 DoD): the deployed
 * `commitBooking` export — `callableEdge` → `wiredCallable` →
 * `bookAppointment`, the composition root's own wiring, only its Admin SDK
 * handle pointed at this spec's emulator app — books with a fixed
 * `attemptId`, and the same id is
 *   1. the outcome line's `operationId` (`callable.completed`, with the
 *      verified uid and the keyed digest of the decoded command);
 *   2. the appointment's `writeOperationId` (WS-4.3);
 *   3. every committed audit row's `auditOperationId` (WS-1, WS-4.4);
 *   4. the `writeOperationId` of the attempt line a `retryingTrigger` writes
 *      when its handler throws for that very document — beside the
 *      `documentPath` the delivery named (WS-4.3, DEP-19) — and of the dead
 *      letter it records for that PERMANENT failure (WS-6, DEP-23); an
 *      early TRANSIENT failure is rethrown and records none.
 * Every line is read where Cloud Logging would read it: off
 * `firebase-functions/logger`, through the console telemetry adapter.
 *
 * The clock: `Date` alone is faked, pinned at the fixture's "now" and left
 * advancing (`shouldAdvanceTime`), so the root's `Date.now()` clock books
 * the same Thursday whatever day the suite runs — and Firestore's timers
 * stay real.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-operation-trace';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

/** The emulator app's Firestore, handed to the composition root at the Admin SDK seam. */
const seam = vi.hoisted(() => ({ db: null as Firestore | null }));

vi.mock('../lib/firebase-admin', () => ({
  adminFirestore: () => {
    if (seam.db === null) throw new Error('the emulator app is not up yet');
    return seam.db;
  },
  adminAuth: () => ({}),
}));

import * as main from '../main';

/** The keys the root reads per call (Secret Manager in a deployment). */
const LOG_DIGEST_KEY = 'trace-log-digest-key';
const WALKIN_ID_KEY = 'trace-walkin-key';

/** The one operation this spec follows — the client-minted attempt id. */
const ATTEMPT_ID = 'attempt-trace-0123456789';
const OPERATION = OperationId.of(ATTEMPT_ID);
const APPOINTMENT_PATH = `${Collections.Appointments}/${ATTEMPT_ID}`;

/** The client's call component, as the booking flow sends it. */
const PAYLOAD = {
  locationId: FIXTURE_IDS.location,
  localDate: '2026-10-01',
  seats: [
    {
      lineId: 'line-1',
      serviceId: FIXTURE_IDS.service,
      variantId: null,
      barberId: FIXTURE_IDS.barber,
      barberPreference: BarberPreference.Specific,
      startMinutes: 600,
      subject: { requestedSubjectRole: RequestedSubjectRole.Self },
    },
  ],
  attemptId: ATTEMPT_ID,
  contact: null,
  bookedFromAppointmentId: null,
  placement: Placement.Self,
  onBehalfOfUserId: null,
} as const;

/** The callable request the platform hands the export: a signed-in client. */
const REQUEST = {
  data: PAYLOAD,
  auth: { uid: FIXTURE_IDS.client, token: { roles: [] } },
  rawRequest: {},
  acceptsStreaming: false,
} as unknown as CallableRequest<unknown>;

/** A deployed function's `run` — what the platform (and a spec) invokes. */
type Runnable = { readonly run: (request: unknown) => Promise<unknown> };

/** A logger level's spy — what the console telemetry adapter wrote through it. */
type LevelSpy = { readonly mock: { readonly calls: readonly unknown[][] } };

/** Every line one level received: its message and its payload. */
const linesOf = (
  spy: LevelSpy,
): readonly { readonly msg: unknown; readonly fields: unknown }[] =>
  spy.mock.calls.map(([msg, fields]) => ({ msg, fields }));

/** A logger level, silenced and recorded. */
const recorded = (level: 'info' | 'warn' | 'error'): LevelSpy =>
  vi.spyOn(logger, level).mockImplementation(() => undefined);

describe('one operation id, from the callable to a trigger’s attempt line (emulator)', () => {
  let db: Firestore;
  let info: LevelSpy;
  let error: LevelSpy;

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
    seam.db = db;
  });

  afterAll(async () => {
    seam.db = null;
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(FIXTURE_NOW_UTC_MS);
    vi.stubEnv('LOG_DIGEST_KEY', LOG_DIGEST_KEY);
    vi.stubEnv('WALKIN_ID_KEY', WALKIN_ID_KEY);
    info = recorded('info');
    recorded('warn');
    error = recorded('error');
    await fetch(
      `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    const seeds: readonly (readonly [string, Record<string, unknown>])[] = [
      [
        `${Collections.Locations}/${FIXTURE_IDS.location}`,
        bodyOf(locationFixture()),
      ],
      [`${Collections.Barbers}/${FIXTURE_IDS.barber}`, bodyOf(barberFixture())],
      [
        `${Collections.Services}/${FIXTURE_IDS.service}`,
        bodyOf(serviceFixture()),
      ],
      [
        `${Collections.BarberSchedules}/${FIXTURE_IDS.barber}`,
        bodyOf(barberScheduleFixture()),
      ],
      // The account a first booking copies its contact from.
      [
        `${Collections.Users}/${FIXTURE_IDS.client}`,
        {
          firstName: 'Maria',
          lastName: 'Ivanova',
          phone: '+359888123456',
          email: null,
        },
      ],
    ];
    for (const [path, body] of seeds) await db.doc(path).set(body);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('carries the attempt id through the outcome line, the stored visit, its audit rows and a failed trigger attempt on it', async () => {
    // ── 1. the callable, as the platform invokes the deployed export ──
    const answer = await (main.commitBooking as unknown as Runnable).run(
      REQUEST,
    );
    expect(answer).toEqual({ appointmentId: ATTEMPT_ID });

    const decoded = decodeCommitBooking(REQUEST);
    if (!decoded.ok) throw new Error('the spec’s own payload must decode');
    const outcome = linesOf(info).filter(
      (line) => line.msg === LogEvent.CallableCompleted,
    );
    expect(outcome).toEqual([
      {
        msg: LogEvent.CallableCompleted,
        fields: {
          callable: Callables.CommitBooking,
          operationId: OPERATION,
          uid: FIXTURE_IDS.client,
          roles: [],
          // Added to the scope by the root after the decode, then the line's own.
          inputDigest: LogDigestSystem.digestOf(decoded.value, (input) =>
            hmacSha256Hex(LOG_DIGEST_KEY, input),
          ),
          errorCode: null,
          wireStatus: 'ok',
          durationMs: expect.any(Number),
        },
      },
    ]);
    expect(linesOf(error)).toEqual([]);

    // ── 2. the stored visit names the call that wrote it ──
    const visit = await db.doc(APPOINTMENT_PATH).get();
    expect(visit.get('writeOperationId')).toBe(OPERATION);

    // ── 3. the rows committed with the act name the same operation ──
    const rows = (await db.collection(Collections.AuditLog).get()).docs;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.get('auditOperationId'))).toEqual(
      rows.map(() => OPERATION),
    );

    // ── 4. a trigger woken by that write fails, and its line joins back ──
    // The dead letter is recorded, not written: its own adapter has its own
    // emulator spec (`firestore-trigger-failures.adapter.integration.spec.ts`).
    const deadLetters: TriggerFailure[] = [];
    const triggerEdge: TriggerEdgePorts = {
      ...consoleTelemetry(),
      nowUtcMs: pinnedNowUtcMs(FIXTURE_NOW_UTC_MS),
      writeTriggerFailure: async (failure) => {
        deadLetters.push(failure);
        return Result.ok(undefined);
      },
    };
    const failing = retryingTrigger(
      { fn: 'operationTraceProbe', timeoutSeconds: null },
      triggerEdge,
      async (): Promise<void> => {
        throw Object.assign(new Error('the probe refuses this document'), {
          code: 'failed-precondition',
        });
      },
    );
    const delivery: DeliveredEvent & {
      readonly document: string;
      readonly data: { readonly before: undefined; readonly after: unknown };
    } = {
      id: 'event-trace-1',
      // One second before the pinned "now" (2026-09-28T09:00:00+03:00) — the attempt's age.
      time: '2026-09-28T05:59:59.000Z',
      document: APPOINTMENT_PATH,
      data: { before: undefined, after: visit },
    };
    // A permanent failure is logged and settled — never rethrown.
    await expect(failing(delivery)).resolves.toBeUndefined();

    expect(
      linesOf(error).filter(
        (line) => line.msg === LogEvent.TriggerAttemptFailed,
      ),
    ).toEqual([
      {
        msg: LogEvent.TriggerAttemptFailed,
        fields: {
          fn: 'operationTraceProbe',
          eventId: 'event-trace-1',
          outcome: AttemptOutcome.Permanent,
          errorCode: 'failed-precondition',
          ageMs: 1_000,
          documentPath: APPOINTMENT_PATH,
          writeOperationId: OPERATION,
        },
      },
    ]);
    // …and the dead letter it leaves joins back the same way (WS-6, DEP-23).
    expect(deadLetters).toEqual([
      expect.objectContaining({
        id: 'event-trace-1',
        fn: 'operationTraceProbe',
        documentPath: APPOINTMENT_PATH,
        attemptOutcome: AttemptOutcome.Permanent,
        writeOperationId: OPERATION,
      }),
    ]);

    // ── 5. an early TRANSIENT failure is redelivered, never dead-lettered ──
    const unavailable = Object.assign(new Error('the probe is busy'), {
      code: 'unavailable',
    });
    const busy = retryingTrigger(
      { fn: 'operationTraceProbe', timeoutSeconds: null },
      triggerEdge,
      async (): Promise<void> => {
        throw unavailable;
      },
    );
    await expect(busy({ ...delivery, id: 'event-trace-2' })).rejects.toBe(
      unavailable,
    );
    expect(deadLetters.map((failure) => failure.id)).toEqual(['event-trace-1']);
  });
});
