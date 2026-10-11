import {
  FieldPath,
  FieldValue,
  type Firestore,
} from 'firebase-admin/firestore';
import { RepositoryError, RepositoryErrorCode, Result } from '@core/primitives';
import { type DocPath, WriteOp } from '@core/components';
import { QueryOp } from '@core/entities';
import { type ReadTx } from '@core/ports';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import {
  FIELD_SET_AND_DELETED,
  firestoreCommitPlan,
} from './firestore-tx.adapter';

type Doc = Record<string, unknown>;

function store(seed: Record<string, Doc> = {}) {
  const fake = createProjectionFirestore(seed);
  return {
    fake,
    commit: firestoreCommitPlan(fake.db as unknown as Firestore),
  };
}

const APPT: DocPath = ['appointments', 'a1'];
const BUSY: DocPath = ['barberBusy', 'b_ivan__2026-10-07'];

describe('firestore-tx adapter (CommitPlan over the Admin SDK)', () => {
  describe('the read half', () => {
    it('reads a document as its entity — the body plus its id — and an absent one as null', async () => {
      const { commit } = store({ 'appointments/a1': { ownerUserId: 'u1' } });
      const result = await commit(
        async (tx) => ({
          present: await tx.get(APPT),
          absent: await tx.get(['appointments', 'nope']),
        }),
        (snapshot) => Result.ok({ snapshot, writes: [] }),
      );
      expect(result).toEqual({
        ok: true,
        value: {
          snapshot: {
            present: { id: 'a1', ownerUserId: 'u1' },
            absent: null,
          },
        },
      });
    });

    it('getAll keeps positions, absent documents included, and asks nothing for none', async () => {
      const { commit } = store({
        'barberBusy/k1': { blocks: [] },
        'barberBusy/k3': { blocks: [1] },
      });
      const result = await commit(
        async (tx) => ({
          some: await tx.getAll([
            ['barberBusy', 'k1'],
            ['barberBusy', 'k2'],
            ['barberBusy', 'k3'],
          ]),
          none: await tx.getAll([]),
        }),
        (snapshot) => Result.ok({ snapshot, writes: [] }),
      );
      expect(result.ok && result.value.snapshot).toEqual({
        some: [{ id: 'k1', blocks: [] }, null, { id: 'k3', blocks: [1] }],
        none: [],
      });
    });

    it('queries as data — where (dotted fields too), orderBy either way, limit', async () => {
      const { commit } = store({
        'appointments/a1': {
          busyKeys: ['k'],
          status: { kind: 'pending' },
          startMs: 3,
        },
        'appointments/a2': {
          busyKeys: ['k'],
          status: { kind: 'confirmed' },
          startMs: 1,
        },
        'appointments/a3': {
          busyKeys: ['k'],
          status: { kind: 'cancelled' },
          startMs: 2,
        },
        'appointments/a4': {
          busyKeys: ['other'],
          status: { kind: 'pending' },
          startMs: 0,
        },
        'appointments/a5': {
          busyKeys: ['k'],
          status: { kind: 'pending' },
          startMs: 9,
        },
      });
      const result = await commit(
        (tx: ReadTx) =>
          tx.query<{ readonly id: string }>({
            collection: ['appointments'],
            where: [
              { field: 'busyKeys', op: QueryOp.ArrayContains, value: 'k' },
              {
                field: 'status.kind',
                op: QueryOp.In,
                value: ['pending', 'confirmed'],
              },
            ],
            orderBy: [{ field: 'startMs', descending: true }],
            limit: 2,
          }),
        (rows) => Result.ok({ ids: rows.map((row) => row.id), writes: [] }),
      );
      expect(result).toEqual({ ok: true, value: { ids: ['a5', 'a1'] } });
    });
  });

  describe('the write half', () => {
    it('applies Set, Create, Update and Delete in one transaction and answers the decision without its plan', async () => {
      const { fake, commit } = store({
        'appointments/a1': {
          bookingStatus: 'PENDING',
          note: 'keep',
        },
        'barberBusy/old': { blocks: [1] },
      });
      const result = await commit(
        async (tx) => tx.get<Doc>(APPT),
        (appointment) =>
          Result.ok({
            appointmentId: appointment?.['id'],
            writes: [
              WriteOp.update(APPT, { bookingStatus: 'CONFIRMED', revision: 2 }),
              WriteOp.set(BUSY, { blocks: [{ startMinutes: 600 }] }),
              WriteOp.create(['auditLog', 'row-1'], {
                action: 'booking.confirmed',
              }),
              WriteOp.remove(['barberBusy', 'old']),
            ],
          }),
      );
      expect(result).toEqual({ ok: true, value: { appointmentId: 'a1' } });
      expect(fake.docs.get('appointments/a1')).toEqual({
        bookingStatus: 'CONFIRMED',
        note: 'keep',
        revision: 2,
      });
      expect(fake.docs.get('barberBusy/b_ivan__2026-10-07')).toEqual({
        blocks: [{ startMinutes: 600 }],
      });
      expect(fake.docs.get('auditLog/row-1')).toEqual({
        action: 'booking.confirmed',
      });
      expect(fake.docs.has('barberBusy/old')).toBe(false);
    });

    it('Set replaces the whole document — never a merge', async () => {
      const { fake, commit } = store({
        'barberBusy/k': { blocks: [1], stale: true },
      });
      await commit(
        async () => null,
        () =>
          Result.ok({
            writes: [WriteOp.set(['barberBusy', 'k'], { blocks: [] })],
          }),
      );
      expect(fake.docs.get('barberBusy/k')).toEqual({ blocks: [] });
    });

    it('writes each Update key as ONE root field — a dot is part of the name, never a path into a map (Law 5)', async () => {
      const { fake, commit } = store({ 'settings/x': { a: { b: 1, c: 2 } } });
      await commit(
        async () => null,
        () =>
          Result.ok({
            writes: [
              WriteOp.update(['settings', 'x'], {
                'a.b': 10,
                'odd/key*': 'kept literally',
                fresh: { nested: true },
              }),
            ],
          }),
      );
      expect(fake.docs.get('settings/x')).toEqual({
        a: { b: 1, c: 2 },
        'a.b': 10,
        'odd/key*': 'kept literally',
        fresh: { nested: true },
      });
    });

    it('replaces a root map whole — an Update never merges into a nested map', async () => {
      const { fake, commit } = store({
        'settings/x': { rates: { client: 1, staff: 2 } },
      });
      await commit(
        async () => null,
        () =>
          Result.ok({
            writes: [
              WriteOp.update(['settings', 'x'], { rates: { client: 5 } }),
            ],
          }),
      );
      expect(fake.docs.get('settings/x')).toEqual({ rates: { client: 5 } });
    });

    it('hands the SDK single-segment FieldPaths only', async () => {
      const calls: unknown[][] = [];
      const db = {
        doc: (path: string) => ({ path }),
        runTransaction: async (
          fn: (tx: {
            update: (...args: unknown[]) => void;
          }) => Promise<unknown>,
        ) => fn({ update: (...args: unknown[]) => void calls.push(args) }),
      } as unknown as Firestore;
      await firestoreCommitPlan(db)(
        async () => null,
        () =>
          Result.ok({
            writes: [WriteOp.update(['settings', 'x'], { 'a.b': 1, c: 2 })],
          }),
      );
      const [[, first, , second]] = calls as [
        [unknown, FieldPath, unknown, FieldPath],
      ];
      expect(first.isEqual(new FieldPath('a.b'))).toBe(true);
      expect(first.isEqual(new FieldPath('a', 'b'))).toBe(false);
      expect(second.isEqual(new FieldPath('c'))).toBe(true);
    });

    it('removes each deleteFields key at the root — a variant transition leaves one variant (Law 6)', async () => {
      const { fake, commit } = store({
        'appointments/a1': {
          bookingStatus: 'CONFIRMED',
          confirmedAtUtcMs: 1,
          localDate: '2026-10-07',
        },
      });
      const before = {
        bookingStatus: 'CONFIRMED',
        confirmedAtUtcMs: 1,
        localDate: '2026-10-07',
      };
      const after = {
        bookingStatus: 'CANCELLED',
        cancelledAtUtcMs: 2,
        cancellationReason: 'ILLNESS',
        localDate: '2026-10-07',
      };
      const result = await commit(
        async () => null,
        () =>
          Result.ok({
            writes: [
              WriteOp.transition(
                APPT,
                {
                  bookingStatus: 'CANCELLED',
                  cancelledAtUtcMs: 2,
                  cancellationReason: 'ILLNESS',
                },
                WriteOp.variantFieldsToDelete(before, after),
              ),
            ],
          }),
      );
      expect(result.ok).toBe(true);
      expect(fake.docs.get('appointments/a1')).toEqual(after);
    });

    it('hands the SDK each deleted key as a single-segment FieldPath with FieldValue.delete()', async () => {
      const calls: unknown[][] = [];
      const db = {
        doc: (path: string) => ({ path }),
        runTransaction: async (
          fn: (tx: {
            update: (...args: unknown[]) => void;
          }) => Promise<unknown>,
        ) => fn({ update: (...args: unknown[]) => void calls.push(args) }),
      } as unknown as Firestore;
      await firestoreCommitPlan(db)(
        async () => null,
        () =>
          Result.ok({
            writes: [WriteOp.transition(['settings', 'x'], {}, ['a.b'])],
          }),
      );
      const [[, path, value]] = calls as [[unknown, FieldPath, unknown]];
      expect(path.isEqual(new FieldPath('a.b'))).toBe(true);
      expect(
        value instanceof FieldValue && value.isEqual(FieldValue.delete()),
      ).toBe(true);
    });

    it('refuses a key both set and deleted as a value, applying nothing of the plan', async () => {
      const { fake, commit } = store({ 'appointments/a1': { n: 1 } });
      const result = await commit(
        async () => null,
        () =>
          Result.ok({
            writes: [
              WriteOp.set(BUSY, { blocks: [] }),
              WriteOp.transition(APPT, { n: 2 }, ['n']),
            ],
          }),
      );
      expect(result).toEqual({
        ok: false,
        error: {
          errorCode: RepositoryErrorCode.WriteFailed,
          path: 'appointments/a1',
          reason: FIELD_SET_AND_DELETED,
        },
      });
      expect(fake.writes).toEqual([]);
      expect(fake.docs.get('appointments/a1')).toEqual({ n: 1 });
    });

    it('an Update with no fields writes nothing', async () => {
      const { fake, commit } = store();
      const result = await commit(
        async () => null,
        () =>
          Result.ok({
            writes: [
              WriteOp.update(['settings', 'none'], {}),
              WriteOp.transition(['settings', 'none'], {}, []),
            ],
          }),
      );
      expect(result.ok).toBe(true);
      expect(fake.writes).toEqual([]);
    });
  });

  describe('refusals and conflicts', () => {
    it('a refusal writes nothing and comes back as it was decided', async () => {
      const { fake, commit } = store({ 'appointments/a1': { v: 1 } });
      const refusal = { code: 'booking.cancel.not_cancellable' } as const;
      const result = await commit(
        async (tx) => tx.get(APPT),
        () => Result.err(refusal),
      );
      expect(result).toEqual({ ok: false, error: refusal });
      expect(fake.writes).toEqual([]);
    });

    it('ALREADY_EXISTS on a Create comes back as a value — and nothing of the plan is applied', async () => {
      const { fake, commit } = store({ 'auditLog/row-1': { action: 'first' } });
      const result = await commit(
        async () => null,
        () =>
          Result.ok({
            writes: [
              WriteOp.set(BUSY, { blocks: [] }),
              WriteOp.create(['auditLog', 'row-1'], { action: 'again' }),
            ],
          }),
      );
      expect(result).toEqual({
        ok: false,
        error: RepositoryError.alreadyExists('auditLog/row-1'),
      });
      expect(fake.docs.get('auditLog/row-1')).toEqual({ action: 'first' });
      expect(fake.docs.has('barberBusy/b_ivan__2026-10-07')).toBe(false);
    });

    /**
     * A store that RUNS the transaction callback — so the plan is applied
     * against a minimal tx and the adapter has seen its Creates — and then
     * refuses the commit with ALREADY_EXISTS in `message`'s words.
     */
    const refusingAfterThePlan = (message: string): Firestore =>
      ({
        doc: (path: string) => ({ path }),
        runTransaction: async (
          fn: (tx: Record<string, () => void>) => Promise<unknown>,
        ) => {
          const noop = (): void => undefined;
          await fn({ set: noop, create: noop, update: noop, delete: noop });
          throw Object.assign(new Error(message), { code: 6 });
        },
      }) as unknown as Firestore;

    it.each([
      [
        'production',
        '6 ALREADY_EXISTS: Document already exists: projects/demo/databases/(default)/documents/users/u-1',
      ],
      [
        'the emulator',
        '6 ALREADY_EXISTS: entity already exists: EntityRef[partitionRef=dev~demo, path=/users/u-1]',
      ],
    ])(
      'names the refused document from the message %s writes, over the plan’s own single Create',
      async (_store, message) => {
        const result = await firestoreCommitPlan(refusingAfterThePlan(message))(
          async () => null,
          () =>
            Result.ok({
              writes: [WriteOp.create(['users', 'u-9'], { roles: [] })],
            }),
        );
        expect(result).toEqual({
          ok: false,
          error: RepositoryError.alreadyExists('users/u-1'),
        });
      },
    );

    it('falls back to the plan’s one Create when the message names no document', async () => {
      const result = await firestoreCommitPlan(
        refusingAfterThePlan('6 ALREADY_EXISTS'),
      )(
        async () => null,
        () =>
          Result.ok({
            writes: [
              WriteOp.set(BUSY, { blocks: [] }),
              WriteOp.create(['users', 'u-9'], { roles: [] }),
            ],
          }),
      );
      expect(result).toEqual({
        ok: false,
        error: RepositoryError.alreadyExists('users/u-9'),
      });
    });

    it('falls back to no path when neither the message nor a single Create names it', async () => {
      const result = await firestoreCommitPlan(
        refusingAfterThePlan('6 ALREADY_EXISTS'),
      )(
        async () => null,
        () =>
          Result.ok({
            writes: [
              WriteOp.create(['users', 'u-8'], { roles: [] }),
              WriteOp.create(['users', 'u-9'], { roles: [] }),
            ],
          }),
      );
      expect(result).toEqual({
        ok: false,
        error: RepositoryError.alreadyExists(null),
      });
    });

    it('answers no path when the store refuses before any plan was applied', async () => {
      const db = {
        runTransaction: async () => {
          throw Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 });
        },
      } as unknown as Firestore;
      const result = await firestoreCommitPlan(db)(
        async () => null,
        () => Result.ok({ writes: [] }),
      );
      expect(result).toEqual({
        ok: false,
        error: RepositoryError.alreadyExists(null),
      });
    });

    it('an Update of an absent document rejects (NOT_FOUND) — infrastructure, not an answer', async () => {
      const { fake, commit } = store();
      await expect(
        commit(
          async () => null,
          () =>
            Result.ok({
              writes: [
                WriteOp.set(BUSY, { blocks: [] }),
                WriteOp.update(['appointments', 'gone'], { revision: 2 }),
              ],
            }),
        ),
      ).rejects.toMatchObject({ code: 5 });
      expect(fake.writes).toEqual([]);
    });

    it('any other store failure rejects, for the edge to map once', async () => {
      const db = {
        runTransaction: async () => {
          throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
        },
      } as unknown as Firestore;
      await expect(
        firestoreCommitPlan(db)(
          async () => null,
          () => Result.ok({ writes: [] }),
        ),
      ).rejects.toMatchObject({ code: 14 });
    });
  });

  it('runs read, then decide, inside the one transaction', async () => {
    const order: string[] = [];
    const { commit } = store({ 'appointments/a1': { v: 1 } });
    await commit(
      async (tx) => {
        order.push('read');
        return tx.get(APPT);
      },
      () => {
        order.push('decide');
        return Result.ok({ writes: [] });
      },
    );
    expect(order).toEqual(['read', 'decide']);
  });
});
