import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from 'firebase-functions';
import { type CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { BookingPolicy } from '@creativo/domain/scheduling';
import { seatOutcomeFromDocument } from '@creativo/application/booking';
import { createProjectionFirestore } from '../../test-support/fake-projection-firestore';
import { cancelAppointment } from './cancel-appointment';
import { loadBookingPolicy } from './load-booking-policy';
import { transitionAppointment } from './transition-appointment';

/**
 * THE RULE IN FORCE (2026-09-25). Every path that cancels a seat stamps the
 * free-cancellation window it read on that seat, so the cancellation is
 * judged by the rule it was made under — never by whatever the owner sets
 * the window to afterwards.
 */

const fake = vi.hoisted(() => ({
  db: null as unknown,
  windowHours: 24,
}));

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../firebase-admin', () => ({ adminFirestore: () => fake.db }));
vi.mock('./load-booking-policy', () => ({
  loadBookingPolicy: vi.fn(async () => policyWithWindow(fake.windowHours)),
}));
vi.mock('./audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./audit')>();
  // The row is the audit spec's business; here only the appointment is.
  return { ...actual, appendAudit: vi.fn(async () => undefined) };
});

function policyWithWindow(cancellationWindowHours: number): BookingPolicy {
  const defaults = BookingPolicy.default();
  const policy = BookingPolicy.create({
    maxPartySize: defaults.maxPartySize,
    slotStepMinutes: defaults.slotStepMinutes,
    minLeadMinutes: defaults.minLeadMinutes,
    horizonMonths: defaults.horizonMonths,
    cancellationWindowHours,
    maxFlexibleDays: defaults.maxFlexibleDays,
    autoConfirm: defaults.autoConfirm,
  });
  if (policy.isFailure()) throw new Error('bad fixture');
  return policy.value;
}

const APPT = 'appt-1';
const PATH = `appointments/${APPT}`;
const SLOT = {
  startIso: '2030-01-15T10:00:00.000+02:00',
  endIso: '2030-01-15T10:30:00.000+02:00',
  zone: 'Europe/Sofia',
};

function seat(id: string, userId: string, outcome: Record<string, unknown>) {
  return {
    id,
    subject: {
      kind: 'account',
      userId,
      relationship: userId === 'ana' ? 'self' : 'companion',
    },
    slot: SLOT,
    barberId: id === 's1' ? 'ivan' : 'niko',
    outcome,
  };
}

/** Ana and Bob, far in the future, one of them possibly already resolved. */
function storedParty(
  second: Record<string, unknown> = { kind: 'scheduled' },
): Record<string, unknown> {
  return {
    ownerUserId: 'ana',
    status: { kind: 'confirmed' },
    timeSlot: SLOT,
    seats: [
      seat('s1', 'ana', { kind: 'scheduled' }),
      seat('s2', 'bob', second),
    ],
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

let store: ReturnType<typeof createProjectionFirestore>;

function outcomes(): Record<string, unknown>[] {
  const seats = (store.docs.get(PATH)?.['seats'] ?? []) as Record<
    string,
    unknown
  >[];
  return seats.map((entry) => entry['outcome'] as Record<string, unknown>);
}

/** The next policy read throws, the way a Firestore outage would. */
function policyReadFailsOnce(): void {
  vi.mocked(loadBookingPolicy).mockRejectedValueOnce(
    new Error('14 UNAVAILABLE: settings/bookingPolicy'),
  );
}

beforeEach(() => {
  vi.mocked(loadBookingPolicy).mockClear();
  vi.mocked(logger.warn).mockClear();
  fake.windowHours = 24;
  store = createProjectionFirestore();
  fake.db = store.db;
});

describe('cancelAppointment — the client’s own cancel', () => {
  it('stamps the window it was allowed under on every seat it closes', async () => {
    fake.windowHours = 6;
    store.docs.set(PATH, storedParty());

    await cancelAppointment.run(request({ appointmentId: APPT }, client));

    expect(outcomes()).toEqual([
      expect.objectContaining({
        kind: 'cancelled',
        by: 'client',
        windowHours: 6,
      }),
      expect.objectContaining({
        kind: 'cancelled',
        by: 'client',
        windowHours: 6,
      }),
    ]);
  });

  it('writes a stamp the shared mapper reads back as that window', async () => {
    fake.windowHours = 36;
    store.docs.set(PATH, storedParty());

    await cancelAppointment.run(request({ appointmentId: APPT }, client));

    const read = seatOutcomeFromDocument(
      outcomes()[0],
      { kind: 'cancelled', reason: 'unspecified' },
      0,
    );
    expect(read.kind === 'cancelled' && read.window?.hours).toBe(36);
  });

  it('leaves a seat resolved before it — and that seat’s own stamp — alone', async () => {
    const earlier = {
      kind: 'cancelled',
      atMs: 1,
      by: 'staff',
      reason: { kind: 'client_unwell' },
      windowHours: 48,
    };
    store.docs.set(PATH, storedParty(earlier));

    await cancelAppointment.run(request({ appointmentId: APPT }, client));

    expect(outcomes()[0]).toMatchObject({ windowHours: 24 });
    expect(outcomes()[1]).toEqual(earlier);
  });

  /*
   * The window is the rule THIS path enforces: without it nobody can say
   * whether the client may still cancel for free, so a failed read refuses
   * the cancel rather than letting it through unjudged (round 2, 2026-09-25).
   */
  it('refuses the cancel, and writes nothing, when the policy cannot be read', async () => {
    policyReadFailsOnce();
    store.docs.set(PATH, storedParty());

    // `unavailable` under its own code — a moment's retry is the advice —
    // never the bare `internal` a rejected read surfaced as, and never the
    // read's own message.
    const refusal = await cancelAppointment
      .run(request({ appointmentId: APPT }, client))
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(refusal).toBeInstanceOf(HttpsError);
    expect(refusal).toMatchObject({
      code: 'unavailable',
      details: { code: 'booking.cancel.policy_unavailable' },
    });
    expect(String((refusal as Error).message)).not.toContain('UNAVAILABLE');

    expect(outcomes()).toEqual([{ kind: 'scheduled' }, { kind: 'scheduled' }]);
    expect(store.docs.get(PATH)?.['status']).toEqual({ kind: 'confirmed' });
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'cancellation policy unread; cancel refused',
      expect.objectContaining({
        code: 'booking.cancel.policy_unavailable',
        resourceId: APPT,
      }),
    );
  });
});

describe('transitionAppointment — the shop cancelling, often on the client’s word', () => {
  it('stamps the window in force on a party cancel', async () => {
    fake.windowHours = 12;
    store.docs.set(PATH, storedParty());

    await transitionAppointment.run(
      request(
        {
          appointmentId: APPT,
          to: 'cancelled',
          reasonCode: 'client_changed_plans',
        },
        staff,
      ),
    );

    expect(outcomes()).toEqual([
      expect.objectContaining({
        kind: 'cancelled',
        by: 'staff',
        reason: { kind: 'client_changed_plans' },
        windowHours: 12,
      }),
      expect.objectContaining({ kind: 'cancelled', windowHours: 12 }),
    ]);
  });

  it('stamps the window in force on one person’s seat', async () => {
    fake.windowHours = 2;
    store.docs.set(PATH, storedParty());

    await transitionAppointment.run(
      request(
        {
          appointmentId: APPT,
          to: 'cancelled',
          seatId: 's2',
          reasonCode: 'client_unwell',
        },
        staff,
      ),
    );

    expect(outcomes()).toEqual([
      { kind: 'scheduled' },
      expect.objectContaining({
        kind: 'cancelled',
        reason: { kind: 'client_unwell' },
        windowHours: 2,
      }),
    ]);
  });

  it('stamps a shop-side cancel too — every cancellation carries its window', async () => {
    fake.windowHours = 8;
    store.docs.set(PATH, storedParty());

    await transitionAppointment.run(
      request(
        {
          appointmentId: APPT,
          to: 'cancelled',
          reasonCode: 'staff_barber_absence',
        },
        staff,
      ),
    );

    expect(outcomes()).toEqual([
      expect.objectContaining({
        reason: { kind: 'staff_barber_absence' },
        windowHours: 8,
      }),
      expect.objectContaining({ windowHours: 8 }),
    ]);
  });

  /*
   * BUSINESS DECISION (round 2, 2026-09-25): the shop may always move its
   * own book, so a policy read that fails does not refuse the shop's cancel.
   * The seats are stamped UNKNOWN — what every cancellation before the stamp
   * already says, judged by the current window — and a warning is logged.
   */
  it('still cancels the party when the policy cannot be read, stamping the window unknown', async () => {
    policyReadFailsOnce();
    store.docs.set(PATH, storedParty());

    await transitionAppointment.run(
      request(
        {
          appointmentId: APPT,
          to: 'cancelled',
          reasonCode: 'client_changed_plans',
        },
        staff,
      ),
    );

    expect(store.docs.get(PATH)?.['status']).toEqual({
      kind: 'cancelled',
      reason: 'client_changed_plans',
    });
    for (const outcome of outcomes()) {
      expect(outcome).toMatchObject({
        kind: 'cancelled',
        by: 'staff',
        reason: { kind: 'client_changed_plans' },
      });
      // Omitted, never `null` — the bytes of an unstamped row.
      expect(Object.keys(outcome)).not.toContain('windowHours');
      const read = seatOutcomeFromDocument(
        outcome,
        { kind: 'cancelled', reason: 'client_changed_plans' },
        0,
      );
      expect(read.kind === 'cancelled' && read.window).toBeNull();
    }
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        code: 'booking.transition.window_unread',
        resourceId: APPT,
      }),
    );
  });

  it('still cancels one person’s seat when the policy cannot be read', async () => {
    policyReadFailsOnce();
    store.docs.set(PATH, storedParty());

    await transitionAppointment.run(
      request(
        {
          appointmentId: APPT,
          to: 'cancelled',
          seatId: 's2',
          reasonCode: 'client_unwell',
        },
        staff,
      ),
    );

    const [first, second] = outcomes();
    expect(first).toEqual({ kind: 'scheduled' });
    expect(second).toMatchObject({
      kind: 'cancelled',
      reason: { kind: 'client_unwell' },
    });
    expect(Object.keys(second ?? {})).not.toContain('windowHours');
    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(1);
  });

  it('reads no policy and stamps no window for a verb that is not a cancel', async () => {
    store.docs.set(PATH, storedParty());

    await transitionAppointment.run(
      request({ appointmentId: APPT, to: 'completed' }, staff),
    );

    expect(outcomes()).toEqual([
      expect.not.objectContaining({ windowHours: expect.anything() }),
      expect.not.objectContaining({ windowHours: expect.anything() }),
    ]);
    expect(outcomes().map((outcome) => outcome['kind'])).toEqual([
      'worked',
      'worked',
    ]);
    expect(vi.mocked(loadBookingPolicy)).not.toHaveBeenCalled();
  });
});
