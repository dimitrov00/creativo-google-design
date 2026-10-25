import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { type Result } from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import type { StoredDocument } from '@core/systems';
import {
  appointmentFixture,
  barberBusyDayFixture,
  recordingTelemetry,
} from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { collection, doc, orderBy, query, where } =
  await import('firebase/firestore');
const {
  ListAdmission,
  UNGUARDED,
  admitted,
  attemptWrite,
  entityOf,
  guardedReads,
  keepAdmitted,
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

describe('the read-time guard (edge hardening D-1, D-3)', () => {
  /** A stored body — the entity minus its id. */
  const bodyOf = (entity: { readonly id: string }) =>
    Object.fromEntries(Object.entries(entity).filter(([key]) => key !== 'id'));
  const visit = (id: string): StoredDocument => ({
    ...appointmentFixture(),
    id,
  });
  const broken = (id: string): StoredDocument => ({
    ...appointmentFixture(),
    id,
    startMinutes: 'ten',
  });
  const guardWithLines = () => {
    const telemetry = recordingTelemetry();
    return { lines: telemetry.lines, guard: guardedReads(telemetry) };
  };
  const malformed = (path: string, reason: string) => ({
    errorCode: RepositoryErrorCode.Malformed,
    path,
    reason,
  });

  describe('admitted — the SINGLE rule', () => {
    it('admits a well-formed document as THE SAME OBJECT, absence as null', () => {
      const { lines, guard } = guardWithLines();
      const doc = visit('a1');
      const answer = admitted(doc, 'appointments', guard);
      expect(answer.ok && answer.value).toBe(doc);
      expect(admitted(null, 'appointments', guard)).toEqual({
        ok: true,
        value: null,
      });
      expect(lines).toEqual([]);
    });

    it('refuses a malformed one naming path and field, reported once', () => {
      const { lines, guard } = guardWithLines();
      expect(admitted(broken('a1'), 'appointments', guard)).toEqual({
        ok: false,
        error: malformed('appointments/a1', 'startMinutes'),
      });
      expect(lines).toEqual([
        {
          level: 'error',
          msg: 'malformed document refused',
          fields: { path: 'appointments/a1', field: 'startMinutes' },
        },
      ]);
    });

    it('reads an unguarded collection, and anything UNGUARDED, as stored', () => {
      const odd = { id: 'u1', roles: 'x' };
      const { guard } = guardWithLines();
      expect(admitted(odd, 'users', guard)).toEqual({ ok: true, value: odd });
      expect(admitted(broken('a1'), 'appointments', UNGUARDED).ok).toBe(true);
    });
  });

  describe('keepAdmitted — the LIST rule', () => {
    it('drops a bad row among good ones, answers the rest in order, reports each path once across calls', () => {
      const { lines, guard } = guardWithLines();
      const reported = new Set<string>();
      const rows = [visit('a1'), broken('a2'), visit('a3')];
      const once = keepAdmitted<StoredDocument>(
        rows,
        'appointments',
        guard,
        reported,
      );
      const twice = keepAdmitted<StoredDocument>(
        rows,
        'appointments',
        guard,
        reported,
      );
      for (const answer of [once, twice]) {
        expect(answer.ok && answer.value.map((row) => row.id)).toEqual([
          'a1',
          'a3',
        ]);
      }
      expect(once.ok && once.value[0]).toBe(rows[0]);
      expect(lines).toEqual([
        {
          level: 'error',
          msg: 'malformed document dropped',
          fields: { path: 'appointments/a2', field: 'startMinutes' },
        },
      ]);
    });

    it('answers the SAME array when nothing is dropped', () => {
      const { guard } = guardWithLines();
      const rows = [visit('a1'), visit('a2')];
      const answer = keepAdmitted(rows, 'appointments', guard, null);
      expect(answer.ok && answer.value).toBe(rows);
    });

    it('the systemic rule: every row dropped refuses with the first; an empty read is ok([])', () => {
      const { guard } = guardWithLines();
      expect(
        keepAdmitted([broken('a1'), broken('a2')], 'appointments', guard, null),
      ).toEqual({
        ok: false,
        error: malformed('appointments/a1', 'startMinutes'),
      });
      expect(keepAdmitted([], 'appointments', guard, null)).toEqual({
        ok: true,
        value: [],
      });
    });

    it('DropOnly drops and reports every bad row and never refuses — a part whose whole is judged elsewhere', () => {
      const { lines, guard } = guardWithLines();
      expect(
        keepAdmitted(
          [broken('a1'), broken('a2')],
          'appointments',
          guard,
          null,
          ListAdmission.DropOnly,
        ),
      ).toEqual({ ok: true, value: [] });
      const rows = [visit('a3'), broken('a4')];
      const kept = keepAdmitted<StoredDocument>(
        rows,
        'appointments',
        guard,
        null,
        ListAdmission.DropOnly,
      );
      expect(kept.ok && kept.value).toEqual([rows[0]]);
      expect(lines.map((line) => line.fields)).toEqual([
        { path: 'appointments/a1', field: 'startMinutes' },
        { path: 'appointments/a2', field: 'startMinutes' },
        { path: 'appointments/a4', field: 'startMinutes' },
      ]);
    });

    it('RefuseMalformed refuses the whole answer on one bad row among good ones', () => {
      const { lines, guard } = guardWithLines();
      expect(
        keepAdmitted(
          [visit('a1'), broken('a2'), visit('a3')],
          'appointments',
          guard,
          null,
          ListAdmission.RefuseMalformed,
        ),
      ).toEqual({
        ok: false,
        error: malformed('appointments/a2', 'startMinutes'),
      });
      expect(lines.map((line) => line.msg)).toEqual([
        'malformed document refused',
      ]);
    });
  });

  describe('the live and one-shot reads, guarded', () => {
    it('a live single emits the refusal, keeps listening, and emits ok once the document is fixed', () => {
      const day = barberBusyDayFixture();
      const path = `barberBusy/${day.id}`;
      const fake = new FakeFirestore({
        [path]: { ...bodyOf(day), localDate: '2026-9-28' },
      });
      const { lines, guard } = guardWithLines();
      const live = recorded(
        observeDoc(doc(asDb(fake), 'barberBusy', day.id), guard),
      );

      fake.set(path, { ...bodyOf(day), localDate: 'still wrong' });
      fake.set(path, bodyOf(day));

      expect(live.seen).toEqual([
        { ok: false, error: malformed(path, 'localDate') },
        { ok: false, error: malformed(path, 'localDate') },
        { ok: true, value: day },
      ]);
      expect(lines).toHaveLength(1);
      expect(fake.listening).toBe(1);
      live.stop();
    });

    it('a live list drops the bad row on every snapshot and reports it once', () => {
      const fake = new FakeFirestore({
        'appointments/a1': bodyOf(visit('a1')),
        'appointments/a2': bodyOf(broken('a2')),
      });
      const { lines, guard } = guardWithLines();
      const live = recorded(
        observeQuery<{ readonly id: string }>(
          collection(asDb(fake), 'appointments'),
          'appointments',
          guard,
        ),
      );

      fake.set('appointments/a3', bodyOf(visit('a3')));

      expect(
        live.seen.map((answer) =>
          answer.ok ? answer.value.map((row) => row.id) : answer,
        ),
      ).toEqual([['a1'], ['a1', 'a3']]);
      expect(lines.map((line) => line.fields)).toEqual([
        { path: 'appointments/a2', field: 'startMinutes' },
      ]);
      live.stop();
    });

    it('readDoc and readQuery answer the same rules once', async () => {
      const fake = new FakeFirestore({
        'appointments/a1': bodyOf(broken('a1')),
        'appointments/a2': bodyOf(visit('a2')),
      });
      const { guard } = guardWithLines();
      expect(
        await readDoc(doc(asDb(fake), 'appointments', 'a1'), guard),
      ).toEqual({
        ok: false,
        error: malformed('appointments/a1', 'startMinutes'),
      });
      const many = await readQuery<{ readonly id: string }>(
        collection(asDb(fake), 'appointments'),
        'appointments',
        guard,
      );
      expect(many.ok && many.value.map((row) => row.id)).toEqual(['a2']);
    });

    it('never guards a subcollection — its path is no registered collection', async () => {
      const fake = new FakeFirestore({
        'appointments/a1/notes/n1': { startMinutes: 'ten' },
      });
      const { guard } = guardWithLines();
      expect(
        await readDoc(
          doc(asDb(fake), 'appointments', 'a1', 'notes', 'n1'),
          guard,
        ),
      ).toEqual({ ok: true, value: { id: 'n1', startMinutes: 'ten' } });
    });
  });
});
