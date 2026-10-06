import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { ok } from '@creativo/domain/kernel';
import { BookingPolicy } from '@creativo/domain/scheduling';
import { createProjectionFirestore } from '../../test-support/fake-projection-firestore';
import { appendAudit } from './audit';
import { cancelAppointment } from './cancel-appointment';
import { clearArrival } from './clear-arrival';
import { commitBooking, toSeats } from './commit-booking';
import { markArrived } from './mark-arrived';
import { recordSeatTip } from './record-seat-tip';
import { moveAudit, rescheduleAppointment } from './reschedule-appointment';
import {
  staffEditAppointment,
  staffEditChangeKey,
  toOperationId,
} from './staff-edit-appointment';
import { transitionAppointment } from './transition-appointment';
import type { RescheduleBookingUseCase } from '../../use-cases/reschedule-booking.use-case';

/**
 * Every booking callable writes its audit row AFTER its commit and AWAITS
 * it: the caller hears "done" only once the row is written, and a failed
 * write is logged, never thrown over an act that already happened.
 */

const fake = vi.hoisted(() => ({
  db: null as unknown,
  commit: vi.fn(),
  staffEdit: vi.fn(),
  // Typed as the use case's own `execute`: an answer that leaves out a
  // field the use case always sets (`replayedAttempt`) does not compile.
  reschedule: vi.fn<RescheduleBookingUseCase['execute']>(),
}));

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../firebase-admin', () => ({ adminFirestore: () => fake.db }));
vi.mock('./load-booking-policy', () => ({
  // Read at call time, long after the import below has bound it.
  loadBookingPolicy: async () => BookingPolicy.default(),
}));
vi.mock('./audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./audit')>();
  // The real writer by default; a spec holds or breaks it where it needs to.
  return { ...actual, appendAudit: vi.fn(actual.appendAudit) };
});
vi.mock('../../use-cases/commit-booking.use-case', () => ({
  CommitBookingUseCase: class {
    execute = fake.commit;
  },
}));
vi.mock('../../use-cases/staff-edit-appointment.use-case', () => ({
  StaffEditAppointmentUseCase: class {
    execute = fake.staffEdit;
  },
}));
vi.mock('../../use-cases/reschedule-booking.use-case', () => ({
  RescheduleBookingUseCase: class {
    execute = fake.reschedule;
  },
}));

const APPT = 'appt-1';

/** The stored visit every transactional callable reads: Ana, one seat. */
function storedVisit(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ownerUserId: 'ana',
    status: { kind: 'confirmed' },
    arrivedAt: null,
    timeSlot: {
      startIso: '2030-01-15T10:00:00.000+02:00',
      endIso: '2030-01-15T10:30:00.000+02:00',
      zone: 'Europe/Sofia',
    },
    seats: [
      {
        id: 's1',
        subject: { kind: 'account', userId: 'ana', relationship: 'self' },
        slot: {
          startIso: '2030-01-15T10:00:00.000+02:00',
          endIso: '2030-01-15T10:30:00.000+02:00',
          zone: 'Europe/Sofia',
        },
        outcome: { kind: 'scheduled' },
      },
    ],
    ...overrides,
  };
}

const staff = { uid: 'dev-staff-ivan', token: { roles: ['barber'] } };
const client = { uid: 'ana', token: { roles: ['client'] } };

function request(
  data: Record<string, unknown>,
  auth: { uid: string; token: object },
): CallableRequest {
  return { data, auth } as unknown as CallableRequest;
}

interface Case {
  readonly name: string;
  readonly action: string;
  readonly stored?: Record<string, unknown>;
  readonly call: () => Promise<unknown>;
  readonly answer: unknown;
}

const CASES: readonly Case[] = [
  {
    name: 'commitBooking',
    action: 'booking.committed',
    call: () =>
      commitBooking.run(request({ locationId: 'loc-1', seats: [] }, client)),
    answer: { appointmentId: APPT },
  },
  {
    name: 'staffEditAppointment',
    action: 'booking.staff_move',
    stored: storedVisit(),
    call: () =>
      staffEditAppointment.run(
        request(
          {
            appointmentId: APPT,
            command: { kind: 'move', startIso: '2030-01-15T11:00:00+02:00' },
          },
          staff,
        ),
      ),
    answer: { appointmentId: APPT, revision: 4 },
  },
  {
    name: 'rescheduleAppointment',
    action: 'booking.rescheduled',
    stored: storedVisit(),
    call: () =>
      rescheduleAppointment.run(
        request(
          { appointmentId: APPT, locationId: 'loc-1', seats: [] },
          client,
        ),
      ),
    answer: { appointmentId: APPT },
  },
  {
    name: 'transitionAppointment',
    action: 'booking.staff_confirmed',
    stored: storedVisit({ status: { kind: 'pending' } }),
    call: () =>
      transitionAppointment.run(
        request({ appointmentId: APPT, to: 'confirmed' }, staff),
      ),
    answer: { appointmentId: APPT, to: 'confirmed' },
  },
  {
    name: 'cancelAppointment',
    action: 'booking.cancelled',
    stored: storedVisit(),
    call: () => cancelAppointment.run(request({ appointmentId: APPT }, client)),
    answer: { appointmentId: APPT },
  },
  {
    name: 'markArrived',
    action: 'booking.staff_arrived',
    stored: storedVisit(),
    call: () => markArrived.run(request({ appointmentId: APPT }, staff)),
    answer: { appointmentId: APPT, alreadyArrived: false },
  },
  {
    name: 'clearArrival',
    action: 'booking.staff_unarrived',
    stored: storedVisit({
      arrivedAt: { iso: '2030-01-15T09:55:00.000Z', zone: 'Europe/Sofia' },
    }),
    call: () => clearArrival.run(request({ appointmentId: APPT }, staff)),
    answer: { appointmentId: APPT, alreadyClear: false },
  },
  {
    name: 'recordSeatTip',
    action: 'booking.tip_recorded',
    stored: storedVisit({ status: { kind: 'completed' } }),
    call: () =>
      recordSeatTip.run(
        request(
          { appointmentId: APPT, seatId: 's1', amountMinorUnits: 500 },
          staff,
        ),
      ),
    answer: { appointmentId: APPT, seatId: 's1', unchanged: false },
  },
];

/** Has `promise` settled after the event loop has had every chance to? */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  return done;
}

let store: ReturnType<typeof createProjectionFirestore>;

beforeEach(() => {
  vi.mocked(appendAudit).mockClear();
  vi.mocked(logger.error).mockClear();
  fake.commit.mockResolvedValue(ok({ appointmentId: APPT }));
  fake.staffEdit.mockResolvedValue(ok({ appointmentId: APPT, revision: 4 }));
  fake.reschedule.mockResolvedValue(
    ok({
      appointmentId: APPT,
      revision: 4,
      subjectUserIds: ['ana'],
      replayed: false,
      replayedAttempt: false,
    }),
  );
  store = createProjectionFirestore();
  fake.db = store.db;
});

describe.each(CASES)('$name — the audit row, after the commit', (spec) => {
  beforeEach(() => {
    if (spec.stored) store.docs.set(`appointments/${APPT}`, spec.stored);
  });

  it('answers only once the row is written', async () => {
    let release: () => void = () => undefined;
    vi.mocked(appendAudit).mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    const answer = spec.call();

    expect(await settled(answer)).toBe(false);
    expect(vi.mocked(appendAudit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(appendAudit).mock.calls[0]?.[0]).toMatchObject({
      action: spec.action,
      resourceId: APPT,
    });
    release();
    await expect(answer).resolves.toEqual(spec.answer);
  });

  it('still succeeds when the audit write fails, and says so in the log', async () => {
    const failing = store.db as unknown as { batch: () => unknown };
    failing.batch = () => ({
      set: () => undefined,
      create: () => undefined,
      commit: async () => {
        throw Object.assign(new Error('unavailable'), { code: 14 });
      },
    });

    await expect(spec.call()).resolves.toEqual(spec.answer);
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      'audit write failed',
      expect.objectContaining({ action: spec.action, resourceId: APPT }),
    );
  });
});

function auditRows(): Record<string, unknown>[] {
  return [...store.docs.entries()]
    .filter(([path]) => path.startsWith('auditLog/'))
    .map(([, row]) => row);
}

/**
 * Run `act` with every audit batch failing on a transient error (gRPC 14)
 * — the first attempt's `appendAudit` losing its rows after the commit.
 */
async function withAuditDown<T>(act: () => Promise<T>): Promise<T> {
  const db = store.db as unknown as { batch: () => unknown };
  const healthy = db.batch;
  db.batch = () => ({
    set: () => undefined,
    create: () => undefined,
    commit: async () => {
      throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    },
  });
  try {
    return await act();
  } finally {
    db.batch = healthy;
  }
}

const MOVE_ATTEMPT = 'attempt-move-0123456789';
const OPERATION = 'operation-0123456789abcdef';

describe('booking callables — one logical change, one row per person', () => {
  it('commitBooking: a replayed attempt finds its row written and adds none', async () => {
    const call = () =>
      commitBooking.run(
        request(
          { locationId: 'loc-1', seats: [], attemptId: 'attempt-0123456789ab' },
          client,
        ),
      );
    await call();
    // The use case answers a replay with the SAME appointment id.
    await call();

    expect(auditRows()).toHaveLength(1);
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
  });

  it('staffEditAppointment: the same edit logged twice is one row; the next edit is another', async () => {
    store.docs.set(`appointments/${APPT}`, storedVisit());
    const call = () =>
      staffEditAppointment.run(
        request(
          {
            appointmentId: APPT,
            command: { kind: 'move', startIso: '2030-01-15T11:00:00+02:00' },
          },
          staff,
        ),
      );
    await call();
    await call(); // the use case answered revision 4 again
    expect(auditRows()).toHaveLength(1);

    fake.staffEdit.mockResolvedValueOnce(
      ok({ appointmentId: APPT, revision: 5 }),
    );
    await call();
    expect(auditRows()).toHaveLength(2);
    expect(auditRows().map((row) => row['context'])).toEqual(
      expect.arrayContaining([{ revision: '4' }, { revision: '5' }]),
    );
  });

  it('rescheduleAppointment: names the carried companion, and a replayed move logs nothing more', async () => {
    store.docs.set(`appointments/${APPT}`, storedVisit());
    fake.reschedule.mockResolvedValue(
      ok({
        appointmentId: APPT,
        revision: 4,
        subjectUserIds: ['ana', 'son'],
        replayed: false,
        replayedAttempt: false,
      }),
    );
    const call = () =>
      rescheduleAppointment.run(
        request(
          { appointmentId: APPT, locationId: 'loc-1', seats: [] },
          client,
        ),
      );
    await call();

    expect(vi.mocked(appendAudit).mock.calls[0]?.[0].subjects).toContainEqual({
      kind: 'account',
      userId: 'son',
    });
    expect(
      auditRows()
        .map((row) => row['targetUserId'])
        .sort(),
    ).toEqual(['ana', 'son']);

    // Unnamed, so the use case cannot say the attempt wrote.
    fake.reschedule.mockResolvedValue(
      ok({
        appointmentId: APPT,
        revision: 4,
        subjectUserIds: ['ana', 'son'],
        replayed: true,
        replayedAttempt: false,
      }),
    );
    vi.mocked(appendAudit).mockClear();
    await expect(call()).resolves.toEqual({ appointmentId: APPT });
    expect(vi.mocked(appendAudit)).not.toHaveBeenCalled();
    expect(auditRows()).toHaveLength(2);
  });

  it('rescheduleAppointment: a retry after the visit changed again is still ONE move, one row per person', async () => {
    // The move stamped revision 4; a staff note then bumped the visit to 5.
    // The client's retry finds the visit already where it asked — `replayed`
    // at the CURRENT revision, which the move never stamped. Keying a row by
    // it would log the one move twice.
    store.docs.set(`appointments/${APPT}`, storedVisit());
    const call = () =>
      rescheduleAppointment.run(
        request(
          { appointmentId: APPT, locationId: 'loc-1', seats: [] },
          client,
        ),
      );
    await call();
    fake.reschedule.mockResolvedValue(
      ok({
        appointmentId: APPT,
        revision: 5,
        subjectUserIds: ['ana'],
        replayed: true,
        replayedAttempt: false,
      }),
    );
    await call();

    expect(auditRows()).toHaveLength(1);
    expect(auditRows()[0]?.['context']).toEqual({ revision: '4' });
  });

  it('rescheduleAppointment: a first-time "move" to where the visit already is logs no move', async () => {
    store.docs.set(`appointments/${APPT}`, storedVisit());
    fake.reschedule.mockResolvedValue(
      ok({
        appointmentId: APPT,
        revision: 3,
        subjectUserIds: ['ana'],
        replayed: true,
        replayedAttempt: false,
      }),
    );

    await expect(
      rescheduleAppointment.run(
        request(
          { appointmentId: APPT, locationId: 'loc-1', seats: [] },
          client,
        ),
      ),
    ).resolves.toEqual({ appointmentId: APPT });
    expect(vi.mocked(appendAudit)).not.toHaveBeenCalled();
    expect(auditRows()).toHaveLength(0);
  });

  it('rescheduleAppointment: a move whose rows were lost gets them from its retry — once', async () => {
    // A move that committed must end with its rows (ruling 2026-09-25). The
    // first attempt commits and its audit write fails; the client's retry,
    // under the SAME attempt id, is answered as a replay — nothing is moved
    // twice, but the rows are re-attempted under the move's own key.
    store.docs.set(`appointments/${APPT}`, storedVisit());
    const call = () =>
      rescheduleAppointment.run(
        request(
          {
            appointmentId: APPT,
            locationId: 'loc-1',
            seats: [],
            attemptId: MOVE_ATTEMPT,
          },
          client,
        ),
      );
    fake.reschedule.mockResolvedValue(
      ok({
        appointmentId: APPT,
        revision: 4,
        subjectUserIds: ['ana', 'son'],
        replayed: false,
        replayedAttempt: false,
      }),
    );
    await expect(withAuditDown(call)).resolves.toEqual({ appointmentId: APPT });
    expect(auditRows()).toHaveLength(0);

    // A staff note has bumped the visit to 5 since. The ledger remembers the
    // attempt, so the use case answers with the revision the ORIGINAL move
    // stamped (4), never the visit's current one, and the rows name it.
    fake.reschedule.mockResolvedValue(
      ok({
        appointmentId: APPT,
        revision: 4,
        subjectUserIds: ['ana', 'son'],
        replayed: true,
        replayedAttempt: true,
      }),
    );
    await expect(call()).resolves.toEqual({ appointmentId: APPT });
    expect(vi.mocked(appendAudit).mock.calls.at(-1)?.[0].changeKey).toBe(
      `move:${MOVE_ATTEMPT}`,
    );
    expect(
      auditRows()
        .map((row) => row['targetUserId'])
        .sort(),
    ).toEqual(['ana', 'son']);
    expect(auditRows().map((row) => row['context'])).toEqual([
      { loggedOn: 'retry', revision: '4' },
      { loggedOn: 'retry', revision: '4' },
    ]);

    // Every later retry finds the rows there and writes nothing.
    await call();
    expect(auditRows()).toHaveLength(2);
    expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(1);
  });

  it('rescheduleAppointment: a retry of a move that WAS logged adds nothing, and keeps its revision', async () => {
    store.docs.set(`appointments/${APPT}`, storedVisit());
    const call = () =>
      rescheduleAppointment.run(
        request(
          {
            appointmentId: APPT,
            locationId: 'loc-1',
            seats: [],
            attemptId: MOVE_ATTEMPT,
          },
          client,
        ),
      );
    await call();
    // The ledger remembers the attempt: the ORIGINAL move's revision.
    fake.reschedule.mockResolvedValue(
      ok({
        appointmentId: APPT,
        revision: 4,
        subjectUserIds: ['ana'],
        replayed: true,
        replayedAttempt: true,
      }),
    );
    await call();

    expect(vi.mocked(appendAudit)).toHaveBeenCalledTimes(2);
    expect(auditRows()).toHaveLength(1);
    expect(auditRows()[0]?.['context']).toEqual({ revision: '4' });
    expect(vi.mocked(logger.error)).not.toHaveBeenCalled();
  });

  it('staffEditAppointment: a re-sent intent is logged under its name — a lost row filled, none doubled', async () => {
    store.docs.set(`appointments/${APPT}`, storedVisit());
    const call = () =>
      staffEditAppointment.run(
        request(
          {
            appointmentId: APPT,
            command: { kind: 'move', startIso: '2030-01-15T11:00:00+02:00' },
            operationId: OPERATION,
          },
          staff,
        ),
      );
    fake.staffEdit.mockResolvedValue(
      ok({ appointmentId: APPT, revision: 4, replayed: false }),
    );
    await withAuditDown(call);
    expect(auditRows()).toHaveLength(0);

    // The re-send: the use case found the intent in the visit's ledger and
    // answered with the revision the first send stamped — nothing applied.
    fake.staffEdit.mockResolvedValue(
      ok({ appointmentId: APPT, revision: 4, replayed: true }),
    );
    await expect(call()).resolves.toEqual({ appointmentId: APPT, revision: 4 });
    expect(fake.staffEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ operationId: OPERATION }),
    );
    expect(vi.mocked(appendAudit).mock.calls.at(-1)?.[0].changeKey).toBe(
      `operation:${OPERATION}`,
    );
    // The row the first send would have written: same action, same person,
    // same revision.
    expect(auditRows()).toEqual([
      expect.objectContaining({
        action: 'booking.staff_move',
        targetUserId: 'ana',
        context: { revision: '4' },
      }),
    ]);

    await call();
    expect(auditRows()).toHaveLength(1);
  });

  it('staffEditAppointment: two intents are two rows even when one revision number answers both', async () => {
    // Keyed by the NAME, not the number: the second intent is its own change
    // whatever revision the use case reports for it.
    store.docs.set(`appointments/${APPT}`, storedVisit());
    const send = (operationId: string) =>
      staffEditAppointment.run(
        request(
          {
            appointmentId: APPT,
            command: { kind: 'move', startIso: '2030-01-15T11:00:00+02:00' },
            operationId,
          },
          staff,
        ),
      );
    await send(OPERATION);
    await send('operation-fedcba9876543210');

    expect(auditRows()).toHaveLength(2);
  });

  it('markArrived: a second tap writes neither a stamp nor a row', async () => {
    store.docs.set(`appointments/${APPT}`, storedVisit());
    const call = () => markArrived.run(request({ appointmentId: APPT }, staff));
    await call();
    await expect(call()).resolves.toMatchObject({ alreadyArrived: true });

    expect(auditRows()).toHaveLength(1);
  });

  it('recordSeatTip: the same figure again is no change — no write, no row', async () => {
    const stored = storedVisit({ status: { kind: 'completed' } });
    const seats = stored['seats'] as Record<string, unknown>[];
    store.docs.set(`appointments/${APPT}`, {
      ...stored,
      seats: seats.map((seat) => ({ ...seat, tipMinorUnits: 500 })),
    });

    await expect(
      recordSeatTip.run(
        request(
          { appointmentId: APPT, seatId: 's1', amountMinorUnits: 500 },
          staff,
        ),
      ),
    ).resolves.toEqual({ appointmentId: APPT, seatId: 's1', unchanged: true });
    expect(vi.mocked(appendAudit)).not.toHaveBeenCalled();
    expect(auditRows()).toHaveLength(0);
  });

  it('recordSeatTip: record, clear, record again are three changes and three rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      store.docs.set(
        `appointments/${APPT}`,
        storedVisit({ status: { kind: 'completed' } }),
      );
      const tip = (amountMinorUnits: number | null) =>
        recordSeatTip.run(
          request(
            { appointmentId: APPT, seatId: 's1', amountMinorUnits },
            staff,
          ),
        );

      vi.setSystemTime(new Date('2030-01-15T10:40:00.000Z'));
      await tip(500);
      vi.setSystemTime(new Date('2030-01-15T10:40:03.000Z'));
      await tip(null);
      vi.setSystemTime(new Date('2030-01-15T10:40:09.000Z'));
      await tip(500);

      expect(auditRows().map((row) => row['action'])).toEqual([
        'booking.tip_recorded',
        'booking.tip_cleared',
        'booking.tip_recorded',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('toSeats — the preference is read, never invented (§11.2 #6)', () => {
  const seat = (extra: Record<string, unknown>) => ({
    lineId: 'l1',
    serviceId: 'cut',
    barberId: 'ivan',
    startIso: '2030-01-15T10:00:00+02:00',
    subject: { kind: 'self' },
    ...extra,
  });

  it('carries «Всеки» and a named barber through', () => {
    expect(toSeats([seat({ barberPref: 'any' })])[0]?.barberPref).toBe('any');
    expect(toSeats([seat({ barberPref: 'specific' })])[0]?.barberPref).toBe(
      'specific',
    );
  });

  it('leaves an absent or unknown preference absent', () => {
    expect(toSeats([seat({})])[0]).not.toHaveProperty('barberPref');
    expect(toSeats([seat({ barberPref: 'whoever' })])[0]).not.toHaveProperty(
      'barberPref',
    );
  });
});

describe('moveAudit — how a move is logged', () => {
  it('keys a move that wrote by its attempt, else by the revision it stamped', () => {
    const wrote = { revision: 4, replayed: false, replayedAttempt: false };
    expect(moveAudit(wrote, MOVE_ATTEMPT)).toEqual({
      changeKey: `move:${MOVE_ATTEMPT}`,
      context: { revision: '4' },
    });
    expect(moveAudit(wrote, undefined)).toEqual({
      changeKey: 'revision:4',
      context: { revision: '4' },
    });
  });

  it('re-attempts a replay of an attempt that wrote under its key, naming the revision it stamped', () => {
    expect(
      moveAudit(
        { revision: 7, replayed: true, replayedAttempt: true },
        MOVE_ATTEMPT,
      ),
    ).toEqual({
      changeKey: `move:${MOVE_ATTEMPT}`,
      context: { loggedOn: 'retry', revision: '7' },
    });
  });

  it('logs nothing for a replay whose attempt never wrote — the visit already stood there', () => {
    expect(
      moveAudit(
        { revision: 7, replayed: true, replayedAttempt: false },
        MOVE_ATTEMPT,
      ),
    ).toBeNull();
  });

  // `replayedAttempt: true`, so only the missing attempt id can say "nothing":
  // the stored revision is the only other key, and a staff note between the
  // move and its retry would make that a fresh one — one move, two rows.
  it('logs nothing for a replay with no attempt to key it by, even one that says it re-attempted', () => {
    expect(
      moveAudit(
        { revision: 7, replayed: true, replayedAttempt: true },
        undefined,
      ),
    ).toBeNull();
  });
});

describe('the staff intent name on the wire', () => {
  it('keeps an absent name absent, and hands anything else on as a string to check', () => {
    expect(toOperationId(undefined)).toBeNull();
    expect(toOperationId(null)).toBeNull();
    expect(toOperationId(OPERATION)).toBe(OPERATION);
    // Not dropped: a name the use case cannot accept is refused by name.
    expect(toOperationId(42)).toBe('');
    expect(toOperationId({ id: OPERATION })).toBe('');
  });

  it('keys the rows by the name when there is one, else by the revision', () => {
    expect(staffEditChangeKey(OPERATION, 4)).toBe(`operation:${OPERATION}`);
    expect(staffEditChangeKey(null, 4)).toBe('revision:4');
  });

  it('hands the use case exactly that', async () => {
    store.docs.set(`appointments/${APPT}`, storedVisit());
    await staffEditAppointment.run(
      request(
        {
          appointmentId: APPT,
          command: { kind: 'move', startIso: '2030-01-15T11:00:00+02:00' },
          operationId: 17,
        },
        staff,
      ),
    );
    expect(fake.staffEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ operationId: '' }),
    );

    await staffEditAppointment.run(
      request(
        {
          appointmentId: APPT,
          command: { kind: 'move', startIso: '2030-01-15T11:00:00+02:00' },
        },
        staff,
      ),
    );
    expect(fake.staffEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ operationId: null }),
    );
  });
});

describe('the projection fake — create() as the Admin SDK has it', () => {
  it('refuses a create onto an existing document with ALREADY_EXISTS', async () => {
    const ref = (
      store.db as unknown as {
        collection: (name: string) => {
          doc: (id: string) => { create: (data: object) => Promise<void> };
        };
      }
    )
      .collection('auditLog')
      .doc('row-1');
    await ref.create({ n: 1 });
    await expect(ref.create({ n: 2 })).rejects.toMatchObject({ code: 6 });
    expect(store.docs.get('auditLog/row-1')).toEqual({ n: 1 });
  });

  it('writes nothing from a batch whose create collides — with the store or with itself', async () => {
    type Ref = { readonly path: string };
    const db = store.db as unknown as {
      collection: (name: string) => { doc: (id: string) => Ref };
      batch: () => {
        set: (ref: Ref, data: object) => void;
        create: (ref: Ref, data: object) => void;
        commit: () => Promise<void>;
      };
    };
    const rows = db.collection('auditLog');
    store.docs.set('auditLog/taken', { n: 0 });

    const colliding = db.batch();
    colliding.create(rows.doc('fresh'), { n: 1 });
    colliding.create(rows.doc('taken'), { n: 2 });
    await expect(colliding.commit()).rejects.toMatchObject({ code: 6 });
    expect(store.docs.has('auditLog/fresh')).toBe(false);
    expect(store.docs.get('auditLog/taken')).toEqual({ n: 0 });

    const twice = db.batch();
    twice.set(rows.doc('twin'), { n: 1 });
    twice.create(rows.doc('twin'), { n: 2 });
    await expect(twice.commit()).rejects.toMatchObject({ code: 6 });
    expect(store.docs.has('auditLog/twin')).toBe(false);

    const clean = db.batch();
    clean.create(rows.doc('fresh'), { n: 1 });
    clean.set(rows.doc('taken'), { n: 3 });
    await clean.commit();
    expect(store.docs.get('auditLog/fresh')).toEqual({ n: 1 });
    expect(store.docs.get('auditLog/taken')).toEqual({ n: 3 });
  });
});
