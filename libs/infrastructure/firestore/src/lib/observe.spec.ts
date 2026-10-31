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
import { UNGUARDED } from '../testing/unguarded';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { collection, doc, orderBy, query, where } =
  await import('firebase/firestore');
const {
  AS_STORED,
  ListAdmission,
  admitCounted,
  admitted,
  attemptWrite,
  guardedReads,
  keepAdmitted,
  observeCountedQuery,
  observeDoc,
  observeQuery,
  readDoc,
  readQuery,
  readRawQuery,
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

  it('readRawQuery answers the rows as stored, in the query’s order, through no guard — the caller admits them', async () => {
    const fake = new FakeFirestore({
      'appointments/a1': { startMinutes: 'ten', utcEpochMs: 2 },
      'appointments/a2': { startMinutes: 600, utcEpochMs: 1 },
    });

    const rows = await readRawQuery(
      query(collection(asDb(fake), 'appointments'), orderBy('utcEpochMs')),
      'appointments',
    );

    expect(rows).toEqual({
      ok: true,
      value: [
        { id: 'a2', startMinutes: 600, utcEpochMs: 1 },
        { id: 'a1', startMinutes: 'ten', utcEpochMs: 2 },
      ],
    });
    expect(
      await readRawQuery(
        collection(
          asDb(new FakeFirestore().failWith({ code: 'unavailable' })),
          'appointments',
        ),
        'appointments',
      ),
    ).toEqual({
      ok: false,
      error: {
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'appointments',
        reason: 'unavailable',
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

    it('reads an unguarded collection, and anything the test support’s UNGUARDED reads, as stored', () => {
      const odd = { id: 'u1', roles: 'x' };
      const { guard } = guardWithLines();
      expect(admitted(odd, 'users', guard)).toEqual({ ok: true, value: odd });
      expect(admitted(broken('a1'), 'appointments', UNGUARDED).ok).toBe(true);
    });
  });

  describe('AS_STORED — the guard of a read that names none (OR-33)', () => {
    it('reads a collection the registry never guards as stored, reporting nothing', async () => {
      const odd = { id: 'u1', roles: 'x' };
      expect(admitted(odd, 'users', AS_STORED)).toEqual({
        ok: true,
        value: odd,
      });
      const fake = new FakeFirestore({
        'users/u1': { roles: 'x' },
        'locations/l1': { timeZone: 7 },
        'users/u1/notifications/n1': { startMinutes: 'ten' },
      });
      expect(await readDoc(doc(asDb(fake), 'users', 'u1'))).toEqual({
        ok: true,
        value: odd,
      });
      expect(
        await readQuery(collection(asDb(fake), 'locations'), 'locations'),
      ).toEqual({ ok: true, value: [{ id: 'l1', timeZone: 7 }] });
      expect(
        await readDoc(doc(asDb(fake), 'users', 'u1', 'notifications', 'n1')),
      ).toEqual({ ok: true, value: { id: 'n1', startMinutes: 'ten' } });
    });

    it('refuses to read a guarded collection unguarded — a defect, never a silent read', async () => {
      const fake = new FakeFirestore({
        'appointments/a1': bodyOf(visit('a1')),
      });
      for (const guarded of [
        'appointments',
        'customers',
        'barberBusy',
        'appointmentNotes',
      ]) {
        expect(() => admitted(visit('x'), guarded, AS_STORED)).toThrow(
          `defect: ${guarded} read without its guard`,
        );
        // A list asks for its guard before its first row: an empty read too.
        expect(() => admitCounted([], guarded, AS_STORED, null)).toThrow(
          `defect: ${guarded} read without its guard`,
        );
      }
      await expect(
        readDoc(doc(asDb(fake), 'appointments', 'a1')),
      ).rejects.toThrow('defect: appointments read without its guard');
      await expect(
        readQuery(collection(asDb(fake), 'customers'), 'customers'),
      ).rejects.toThrow('defect: customers read without its guard');
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

  describe('admitCounted — the LIST rule, counted (OR-2)', () => {
    it('keeps the SAME array and counts nothing on a clean read — guarded or not', () => {
      const { lines, guard } = guardWithLines();
      const rows = [visit('a1'), visit('a2')];
      const clean = admitCounted<StoredDocument>(
        rows,
        'appointments',
        guard,
        null,
      );
      expect(clean.ok && clean.value.kept).toBe(rows);
      expect(clean.ok && clean.value.dropped).toBe(0);
      // An unguarded collection is read as stored: the rows, uncounted.
      const odd = [{ id: 'u1', roles: 'x' }];
      const unguarded = admitCounted(odd, 'users', guard, null);
      expect(unguarded.ok && unguarded.value.kept).toBe(odd);
      expect(unguarded.ok && unguarded.value.dropped).toBe(0);
      expect(lines).toEqual([]);
    });

    it('counts every dropped row beside the rows it kept, in their order', () => {
      const { lines, guard } = guardWithLines();
      const rows = [broken('a1'), visit('a2'), broken('a3'), visit('a4')];
      const answer = admitCounted<StoredDocument>(
        rows,
        'appointments',
        guard,
        new Set<string>(),
      );
      expect(answer.ok && answer.value.kept).toEqual([rows[1], rows[3]]);
      expect(answer.ok && answer.value.dropped).toBe(2);
      // The admitted rows are the same objects.
      expect(answer.ok && answer.value.kept[0]).toBe(rows[1]);
      expect(lines.map((line) => line.fields)).toEqual([
        { path: 'appointments/a1', field: 'startMinutes' },
        { path: 'appointments/a3', field: 'startMinutes' },
      ]);
    });

    it('keeps the systemic rule and the strict list — the count rides only an answer', () => {
      const { guard } = guardWithLines();
      expect(
        admitCounted([broken('a1'), broken('a2')], 'appointments', guard, null),
      ).toEqual({
        ok: false,
        error: malformed('appointments/a1', 'startMinutes'),
      });
      expect(admitCounted([], 'appointments', guard, null)).toEqual({
        ok: true,
        value: { kept: [], dropped: 0 },
      });
      expect(
        admitCounted(
          [broken('a1'), broken('a2')],
          'appointments',
          guard,
          null,
          ListAdmission.DropOnly,
        ),
      ).toEqual({ ok: true, value: { kept: [], dropped: 2 } });
      expect(
        admitCounted(
          [visit('a1'), broken('a2')],
          'appointments',
          guard,
          null,
          ListAdmission.RefuseMalformed,
        ),
      ).toEqual({
        ok: false,
        error: malformed('appointments/a2', 'startMinutes'),
      });
    });

    it('keepAdmitted is its rows alone — the same drop, the same array', () => {
      const { guard } = guardWithLines();
      const rows = [visit('a1'), broken('a2'), visit('a3')];
      const counted = admitCounted<StoredDocument>(
        rows,
        'appointments',
        guard,
        null,
      );
      const kept = keepAdmitted<StoredDocument>(
        rows,
        'appointments',
        guard,
        null,
      );
      expect(kept.ok && kept.value).toEqual(counted.ok && counted.value.kept);
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

    it('a live COUNTED list counts the drops of every snapshot, and reports each once', () => {
      const fake = new FakeFirestore({
        'appointments/a1': bodyOf(visit('a1')),
        'appointments/a2': bodyOf(broken('a2')),
      });
      const { lines, guard } = guardWithLines();
      const live = recorded(
        observeCountedQuery<{ readonly id: string }>(
          collection(asDb(fake), 'appointments'),
          'appointments',
          guard,
        ),
      );

      fake.set('appointments/a3', bodyOf(broken('a3')));
      fake.set('appointments/a2', bodyOf(visit('a2')));

      expect(
        live.seen.map((answer) =>
          answer.ok
            ? {
                ids: answer.value.kept.map((row) => row.id),
                dropped: answer.value.dropped,
              }
            : answer,
        ),
      ).toEqual([
        { ids: ['a1'], dropped: 1 },
        { ids: ['a1'], dropped: 2 },
        { ids: ['a1', 'a2'], dropped: 1 },
      ]);
      expect(lines.map((line) => line.fields)).toEqual([
        { path: 'appointments/a2', field: 'startMinutes' },
        { path: 'appointments/a3', field: 'startMinutes' },
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
