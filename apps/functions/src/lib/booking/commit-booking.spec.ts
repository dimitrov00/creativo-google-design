import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { createProjectionFirestore } from '../../test-support/fake-projection-firestore';
import { commitBooking, toSeats } from './commit-booking';

/**
 * The guest's key, from the wire to the decision: `toSeats` is the only
 * door a guest's `guestKey` has into `decideBooking`, whose refusal of two
 * DIFFERENT guests under one label is dormant without it. Run through the
 * production path — the callable, the real `CommitBookingUseCase` and
 * `FirestoreBookingStore` — over an in-memory Firestore.
 */

const fake = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../firebase-admin', () => ({ adminFirestore: () => fake.db }));

const guest = (label: string, guestKey?: unknown) => ({
  lineId: `line-${String(guestKey)}`,
  serviceId: 'svc-fade',
  variantId: null,
  barberId: 'ivan',
  startIso: '2030-01-15T10:00:00.000+02:00',
  subject: {
    kind: 'guest',
    label,
    ...(guestKey === undefined ? {} : { guestKey }),
  },
});

describe('toSeats — the guest key', () => {
  it('passes a well-formed key through, beside the label', () => {
    expect(toSeats([guest('Мария', 'guest-3')])[0]?.subject).toEqual({
      kind: 'guest',
      label: 'Мария',
      guestKey: 'guest-3',
    });
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['not id-shaped', 'guest 3/../x'],
    ['too long', 'g'.repeat(65)],
    ['not a string', 3],
  ])(
    'drops a key that is %s — the guest is read by label alone',
    (_what, key) => {
      expect(toSeats([guest('Мария', key)])[0]?.subject).toEqual({
        kind: 'guest',
        label: 'Мария',
      });
    },
  );

  it('never reads a key off anybody but a guest', () => {
    const [seat] = toSeats([
      {
        ...guest('Мария', 'guest-3'),
        subject: { kind: 'self', guestKey: 'x' },
      },
    ]);
    expect(seat?.subject).toEqual({ kind: 'self' });
  });
});

describe('commitBooking — two different guests under one label', () => {
  beforeEach(() => {
    fake.db = createProjectionFirestore({
      'locations/loc-center': { timezone: 'Europe/Sofia', status: 'active' },
    }).db;
  });

  function commit(seats: readonly unknown[]) {
    return commitBooking.run({
      data: { locationId: 'loc-center', seats },
      auth: { uid: 'user-ana', token: { roles: ['client'] } },
    } as unknown as CallableRequest);
  }

  async function codeOf(call: Promise<unknown>) {
    const error: unknown = await call.then(
      () => null,
      (thrown: unknown) => thrown,
    );
    return (error as { details?: unknown } | null)?.details;
  }

  it('is refused whole, by name, rather than merged into one person', async () => {
    const details = await codeOf(
      commit([guest('Мария', 'guest-1'), guest('Мария', 'guest-2')]),
    );

    expect(details).toMatchObject({
      code: 'booking.commit.invalid_input',
      params: { field: 'guest_label' },
    });
  });

  it('is one guest with two services when the keys agree — not that refusal', async () => {
    const details = await codeOf(
      commit([guest('Мария', 'guest-1'), guest('Мария', 'guest-1')]),
    );

    // Past the label check, on to the catalogue — which this store leaves
    // empty, so the next thing the decision says is about the service.
    expect(details).toMatchObject({ code: 'booking.commit.unknown_service' });
  });
});
