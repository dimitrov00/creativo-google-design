import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { RepositoryErrorCode, type Result } from '@core/primitives';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { collection, doc, orderBy, query, where } =
  await import('firebase/firestore');
const {
  attemptWrite,
  entityOf,
  observeDoc,
  observeQuery,
  readDoc,
  readQuery,
  reasonOf,
} = await import('./observe');

type Thing = {
  readonly id: string;
  readonly rank: number;
  readonly tag: string;
};

/** Every answer a stream gave, in order. */
function recorded<T>(stream: {
  subscribe: (next: (value: T) => void) => { unsubscribe(): void };
}) {
  const seen: T[] = [];
  const subscription = stream.subscribe((value) => seen.push(value));
  return { seen, stop: () => subscription.unsubscribe() };
}

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

describe('observe — the document is the entity', () => {
  it('spreads the body beside its id, and nothing else', () => {
    expect(entityOf<Thing>('t1', { rank: 2, tag: 'a' })).toEqual({
      id: 't1',
      rank: 2,
      tag: 'a',
    });
  });

  it('reads a failure’s reason as Firestore’s code, else its message', () => {
    expect(reasonOf({ code: 'permission-denied' })).toBe('permission-denied');
    expect(reasonOf(new Error('boom'))).toBe('boom');
    expect(reasonOf('???')).toBeNull();
  });
});

describe('observeDoc', () => {
  it('emits the entity, then every change, and null once the document is gone', () => {
    const fake = new FakeFirestore({ 'things/t1': { rank: 1, tag: 'a' } });
    const live = recorded(observeDoc<Thing>(doc(asDb(fake), 'things', 't1')));

    fake.set('things/t1', { rank: 2, tag: 'b' });
    fake.delete('things/t1');

    expect(live.seen).toEqual([
      { ok: true, value: { id: 't1', rank: 1, tag: 'a' } },
      { ok: true, value: { id: 't1', rank: 2, tag: 'b' } },
      { ok: true, value: null },
    ]);
    live.stop();
    expect(fake.listening).toBe(0);
  });

  it('answers a refused listen with the flat RepositoryError naming the path', () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });
    const live = recorded(observeDoc<Thing>(doc(asDb(fake), 'things', 't1')));

    expect(live.seen).toEqual([
      {
        ok: false,
        error: {
          errorCode: RepositoryErrorCode.ReadFailed,
          path: 'things/t1',
          reason: 'permission-denied',
        },
      },
    ]);
    live.stop();
  });

  describe('a healable failure', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('listens again on the backoff schedule, as subscribeWithRetry does', () => {
      const fake = new FakeFirestore({ 'things/t1': { rank: 1, tag: 'a' } });
      const live = recorded(observeDoc<Thing>(doc(asDb(fake), 'things', 't1')));

      fake.failWith({ code: 'unavailable' });
      fake.recover();
      vi.advanceTimersByTime(500);

      expect(live.seen.map((answer) => answer.ok)).toEqual([true, false, true]);
      live.stop();
    });
  });
});

describe('observeQuery', () => {
  it('emits the query’s entities in its own order, again on every change under the collection', () => {
    const fake = new FakeFirestore({
      'things/a': { rank: 3, tag: 'x' },
      'things/b': { rank: 1, tag: 'x' },
      'things/c': { rank: 2, tag: 'y' },
    });
    const live = recorded(
      observeQuery<Thing>(
        query(
          collection(asDb(fake), 'things'),
          where('tag', '==', 'x'),
          orderBy('rank'),
        ),
        'things',
      ),
    );

    fake.set('things/d', { rank: 0, tag: 'x' });

    const ids = live.seen.map((answer) =>
      answer.ok ? answer.value.map((thing) => thing.id) : null,
    );
    expect(ids).toEqual([
      ['b', 'a'],
      ['d', 'b', 'a'],
    ]);
    live.stop();
  });

  it('answers a refused listen with the collection’s path', () => {
    const fake = new FakeFirestore().failWith({ code: 'failed-precondition' });
    const live = recorded(
      observeQuery<Thing>(collection(asDb(fake), 'things'), 'things'),
    );

    expect(live.seen[0]).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'things',
        reason: 'failed-precondition',
      },
    });
    live.stop();
  });
});

describe('readDoc and readQuery — once', () => {
  it('reads a document as its entity, or null', async () => {
    const fake = new FakeFirestore({ 'things/t1': { rank: 1, tag: 'a' } });

    expect(await readDoc<Thing>(doc(asDb(fake), 'things', 't1'))).toEqual({
      ok: true,
      value: { id: 't1', rank: 1, tag: 'a' },
    });
    expect(await readDoc<Thing>(doc(asDb(fake), 'things', 'nope'))).toEqual({
      ok: true,
      value: null,
    });
  });

  it('reads a query as its entities', async () => {
    const fake = new FakeFirestore({
      'things/a': { rank: 2, tag: 'x' },
      'things/b': { rank: 1, tag: 'x' },
    });

    const answer = await readQuery<Thing>(
      query(collection(asDb(fake), 'things'), orderBy('rank')),
      'things',
    );

    expect(answer.ok && answer.value.map((thing) => thing.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('turns a refused read into a failed Result, never a rejection', async () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const one: Result<Thing | null, unknown> = await readDoc<Thing>(
      doc(asDb(fake), 'things', 't1'),
    );
    const many = await readQuery<Thing>(
      collection(asDb(fake), 'things'),
      'things',
    );

    expect(one).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'things/t1',
        reason: 'permission-denied',
      },
    });
    expect(many).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'things',
        reason: 'permission-denied',
      },
    });
  });
});

describe('attemptWrite', () => {
  it('answers ok once the write lands', async () => {
    expect(await attemptWrite('things/t1', async () => undefined)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('turns a refused write into REPOSITORY_WRITE_FAILED naming the path', async () => {
    const answer = await attemptWrite('things/t1', async () => {
      throw { code: 'permission-denied' };
    });

    expect(answer).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.WriteFailed,
        path: 'things/t1',
        reason: 'permission-denied',
      },
    });
  });
});
