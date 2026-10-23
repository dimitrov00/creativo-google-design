import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import {
  EndReasonFields,
  ImpersonationScope,
  ImpersonationStatus,
} from '@core/components';
import {
  ImpersonationSessionId,
  Result,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import type { ImpersonationSession } from '@core/entities';
import { impersonationSessionFixture, utcMs } from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { impersonationReadPorts } = await import('./impersonation.adapter');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

/** Everything a stream said, in order. */
function recorded<T>(stream: {
  subscribe: (next: (value: T) => void) => { unsubscribe(): void };
}) {
  const seen: T[] = [];
  const subscription = stream.subscribe((value) => seen.push(value));
  return { seen, stop: () => subscription.unsubscribe() };
}

/** A session's document body: the entity minus its id (Law 5). */
function bodyOf(session: ImpersonationSession): object {
  const { id, ...body } = session;
  expect(typeof id).toBe('string');
  return body;
}

const pathOf = (session: ImpersonationSession) =>
  `impersonationSessions/${session.id}`;

/** The fake holding `sessions` as stored. */
function storeOf(...sessions: readonly ImpersonationSession[]): FakeFirestore {
  return new FakeFirestore(
    new Map(sessions.map((session) => [pathOf(session), bodyOf(session)])),
  );
}

const ADMIN = UserId.of('u-admin');
const ACTIVE = impersonationSessionFixture();

/** `session`, ended at `at` for `reason` — the `ENDED` variant's keys flat at the root. */
function ended(
  session: ImpersonationSession,
  at: UtcEpochMs,
  reason: EndReasonFields,
): ImpersonationSession {
  return {
    ...session,
    impersonationStatus: ImpersonationStatus.Ended,
    endedAtUtcMs: at,
    ...reason,
  };
}

/** The admin's earlier session, ended by the admin a minute in. */
const ENDED = ended(
  impersonationSessionFixture({ id: ImpersonationSessionId.of('imp-ended') }),
  utcMs('2026-09-28T06:01:00+00:00'),
  EndReasonFields.adminEnded(ADMIN),
);

describe('impersonationReadPorts.observeActiveImpersonation — index #9, live', () => {
  it('asks adminUserId ==, impersonationStatus == ACTIVE, limit 1 — and answers the flat body as stored', () => {
    const fake = storeOf(ACTIVE);

    const active = recorded(
      impersonationReadPorts(asDb(fake)).observeActiveImpersonation(ADMIN),
    );

    expect(active.seen).toEqual([Result.ok(ACTIVE)]);
    expect(fake.reads).toEqual([
      {
        kind: 'listen',
        path: 'impersonationSessions',
        constraints: [
          'adminUserId == "u-admin"',
          'impersonationStatus == "ACTIVE"',
          'limit 1',
        ],
      },
    ]);
    active.stop();
  });

  it('answers null when the admin has no ACTIVE session — an ended one and another admin’s are not it', () => {
    const othersSession = impersonationSessionFixture({
      id: ImpersonationSessionId.of('imp-other'),
      adminUserId: UserId.of('u-other-admin'),
      impersonationScope: ImpersonationScope.Write,
    });
    const fake = storeOf(ENDED, othersSession);

    const active = recorded(
      impersonationReadPorts(asDb(fake)).observeActiveImpersonation(ADMIN),
    );

    expect(active.seen).toEqual([Result.ok(null)]);
    active.stop();
  });

  it('a session ending arrives live: the ACTIVE body, then null', () => {
    const fake = storeOf(ACTIVE);
    const active = recorded(
      impersonationReadPorts(asDb(fake)).observeActiveImpersonation(ADMIN),
    );

    fake.set(
      pathOf(ACTIVE),
      bodyOf(
        ended(
          ACTIVE,
          utcMs('2026-09-28T06:10:00+00:00'),
          EndReasonFields.expired(),
        ),
      ),
    );

    expect(active.seen).toEqual([Result.ok(ACTIVE), Result.ok(null)]);
    active.stop();
  });

  it('writes nothing from the browser — the bundle’s one member is a read, no session and no audit row', () => {
    const fake = storeOf(ACTIVE);
    const ports = impersonationReadPorts(asDb(fake));

    recorded(ports.observeActiveImpersonation(ADMIN)).stop();

    expect(Object.keys(ports)).toEqual(['observeActiveImpersonation']);
    expect(fake.writes).toEqual([]);
  });

  it('answers a refused read as the port’s RepositoryError', () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const active = recorded(
      impersonationReadPorts(asDb(fake)).observeActiveImpersonation(ADMIN),
    );

    expect(active.seen).toEqual([
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'impersonationSessions',
        reason: 'permission-denied',
      }),
    ]);
  });
});
