import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { RepositoryErrorCode, Result, UserId } from '@core/primitives';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { waitlistReadPorts } = await import('./waitlist.adapter');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

/** Everything a stream said, in order. */
function recorded<T>(stream: {
  subscribe: (next: (value: T) => void) => { unsubscribe(): void };
}) {
  const seen: T[] = [];
  const subscription = stream.subscribe((value) => seen.push(value));
  return { seen, stop: () => subscription.unsubscribe() };
}

describe('waitlistReadPorts.observeMyWaitlistRequests', () => {
  it('answers the account’s own requests, newest first — index #17', () => {
    const older = {
      ownerUserId: 'u-georgi',
      waitlistStatus: 'OPEN',
      createdAtUtcMs: 100,
    };
    const newer = {
      ownerUserId: 'u-georgi',
      waitlistStatus: 'MATCHED',
      createdAtUtcMs: 200,
    };
    const fake = new FakeFirestore({
      'waitlistRequests/w-older': older,
      'waitlistRequests/w-newer': newer,
      'waitlistRequests/w-theirs': {
        ownerUserId: 'u-martin',
        waitlistStatus: 'OPEN',
        createdAtUtcMs: 300,
      },
    });

    const mine = recorded(
      waitlistReadPorts(asDb(fake)).observeMyWaitlistRequests(
        UserId.of('u-georgi'),
      ),
    );

    expect(mine.seen).toEqual([
      Result.ok([
        { id: 'w-newer', ...newer },
        { id: 'w-older', ...older },
      ]),
    ]);
    expect(fake.reads).toEqual([
      {
        kind: 'listen',
        path: 'waitlistRequests',
        constraints: [
          'ownerUserId == "u-georgi"',
          'orderBy createdAtUtcMs desc',
        ],
      },
    ]);
  });

  it('answers a refused listen as the port’s RepositoryError', () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const mine = recorded(
      waitlistReadPorts(asDb(fake)).observeMyWaitlistRequests(
        UserId.of('u-georgi'),
      ),
    );

    expect(mine.seen).toEqual([
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'waitlistRequests',
        reason: 'permission-denied',
      }),
    ]);
  });
});
