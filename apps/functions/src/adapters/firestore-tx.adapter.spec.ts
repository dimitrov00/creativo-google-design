import {
  FieldPath,
  FieldValue,
  type Firestore,
  Timestamp,
} from 'firebase-admin/firestore';
import { vi } from 'vitest';
import { Result } from '@core/primitives';
import {
  CancellationRefusalCode,
  RepositoryError,
  RepositoryErrorCode,
} from '@core/errors';
import { type DocPath, WriteOp } from '@core/components';
import { Collections, QueryOp } from '@core/entities';
import { type Log, type ReadTx } from '@core/ports';
import { StoredDocumentSystem } from '@core/systems';
import {
  appointmentFixture,
  recordingTelemetry,
  unguarded,
} from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import {
  admitStored,
  FIELD_SET_AND_DELETED,
  firestoreCommitPlan,
} from './firestore-tx.adapter';

type Doc = Record<string, unknown>;

/**
 * The mechanics cases' log: their partial bodies exercise the SDK plumbing
 * through the test support's `unguarded` registry (OR-33 — the registry and
 * the log have no default), so there is no refusal to report.
 */
const NO_LOG: Log = () => undefined;

function store(seed: Record<string, Doc> = {}) {
  const fake = createProjectionFirestore(seed);
  return {
    fake,
    commit: firestoreCommitPlan(
      fake.db as unknown as Firestore,
      unguarded,
      NO_LOG,
    ),
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

    it('queries as data — where on root keys, orderBy either way, limit', async () => {
      const { commit } = store({
        'appointments/a1': {
          busyKeys: ['k'],
          bookingStatus: 'PENDING',
          utcEpochMs: 3,
        },
        'appointments/a2': {
          busyKeys: ['k'],
          bookingStatus: 'CONFIRMED',
          utcEpochMs: 1,
        },
        'appointments/a3': {
          busyKeys: ['k'],
          bookingStatus: 'CANCELLED',
          utcEpochMs: 2,
        },
        'appointments/a4': {
          busyKeys: ['other'],
          bookingStatus: 'PENDING',
          utcEpochMs: 0,
        },
        'appointments/a5': {
          busyKeys: ['k'],
          bookingStatus: 'PENDING',
          utcEpochMs: 9,
        },
      });
      const result = await commit(
        (tx: ReadTx) =>
          tx.query<{ readonly id: string }>({
            collection: ['appointments'],
            where: [
              { field: 'busyKeys', op: QueryOp.ArrayContains, value: 'k' },
              {
                field: 'bookingStatus',
                op: QueryOp.In,
                value: ['PENDING', 'CONFIRMED'],
              },
            ],
            orderBy: [{ field: 'utcEpochMs', descending: true }],
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

    it('stamps the TTL purgeAt on every Set and Create of a TTL group, beside the entity body (F1-7)', async () => {
      const { fake, commit } = store();
      await commit(
        async () => null,
        () =>
          Result.ok({
            writes: [
              WriteOp.set(['barberBusy', 'b_ivan__2026-10-07'], {
                barberId: 'b_ivan',
                localDate: '2026-10-07',
                blocks: [],
              }),
              WriteOp.create(['users', 'u1', 'notifications', 'n1'], {
                sentAtUtcMs: 1_000,
              }),
              WriteOp.set(['appointments', 'a9'], { localDate: '2026-10-07' }),
            ],
          }),
      );
      const busy = fake.docs.get('barberBusy/b_ivan__2026-10-07');
      expect(busy?.['purgeAt']).toBeInstanceOf(Timestamp);
      expect((busy?.['purgeAt'] as Timestamp).toMillis()).toBe(
        Date.UTC(2026, 9, 7) + 30 * 86_400_000,
      );
      const note = fake.docs.get('users/u1/notifications/n1');
      expect((note?.['purgeAt'] as Timestamp).toMillis()).toBe(
        1_000 + 90 * 86_400_000,
      );
      // No TTL group, no stamp: the body is written exactly as planned.
      expect(fake.docs.get('appointments/a9')).toEqual({
        localDate: '2026-10-07',
      });
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
      await firestoreCommitPlan(
        db,
        unguarded,
        NO_LOG,
      )(
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
      await firestoreCommitPlan(
        db,
        unguarded,
        NO_LOG,
      )(
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
      const refusal = {
        errorCode: CancellationRefusalCode.NotCancellable,
      } as const;
      const result = await commit(
        async (tx) => tx.get(APPT),
        () => Result.err(refusal),
      );
      expect(result).toEqual({ ok: false, error: refusal });
      expect(fake.writes).toEqual([]);
    });

    describe('the versions a refused decide read (WS-4.2, RU-25)', () => {
      const VOUCHER_CODE = 'GIFT-SENTINEL-7Q2X';

      function logged(seed: Record<string, Doc>) {
        const fake = createProjectionFirestore(seed);
        const telemetry = recordingTelemetry();
        return {
          fake,
          telemetry,
          commit: firestoreCommitPlan(
            fake.db as unknown as Firestore,
            unguarded,
            telemetry.log,
          ),
        };
      }

      it('logs ONE document.versions_read line after a refused decide — the returned snapshots’ paths only, never a query value or a missed key', async () => {
        const { telemetry, commit } = logged({
          'appointments/a1': { v: 1 },
          'giftVouchers/gv-1': { code: VOUCHER_CODE },
          'barberBusy/k1': { blocks: [] },
        });
        const refusal = {
          errorCode: CancellationRefusalCode.NotCancellable,
        } as const;
        const result = await commit(
          async (tx) => {
            await tx.get(APPT);
            await tx.get(['giftVouchers', `missed-${VOUCHER_CODE}`]);
            await tx.getAll([
              ['barberBusy', 'k1'],
              ['barberBusy', 'k2'],
            ]);
            return tx.query({
              collection: ['giftVouchers'],
              where: [{ field: 'code', op: QueryOp.Eq, value: VOUCHER_CODE }],
              orderBy: [],
              limit: null,
            });
          },
          () => Result.err(refusal),
        );
        expect(result).toEqual({ ok: false, error: refusal });
        expect(telemetry.lines).toEqual([
          {
            level: 'warn',
            msg: 'document.versions_read',
            fields: {
              reads: [
                { path: 'appointments/a1', updateTimeMs: null },
                { path: 'barberBusy/k1', updateTimeMs: null },
                { path: 'giftVouchers/gv-1', updateTimeMs: null },
              ],
            },
          },
        ]);
        expect(JSON.stringify(telemetry.lines)).not.toContain(VOUCHER_CODE);
      });

      it('reads the store’s updateTime as epoch milliseconds, and caps a line at 50 reads', async () => {
        const seed: Record<string, Doc> = {};
        for (let i = 0; i < 60; i++) seed[`barberBusy/k${100 + i}`] = {};
        const { fake, telemetry } = logged(seed);
        const db = fake.db as unknown as {
          runTransaction: (
            fn: (tx: unknown) => Promise<unknown>,
          ) => Promise<unknown>;
        };
        const stamped = {
          ...db,
          runTransaction: (fn: (tx: unknown) => Promise<unknown>) =>
            db.runTransaction((tx) => {
              const inner = tx as {
                get: (target: unknown) => Promise<object>;
              };
              return fn({
                ...inner,
                get: async (target: unknown) => {
                  const snap = await inner.get(target);
                  return 'docs' in snap
                    ? snap
                    : { ...snap, updateTime: Timestamp.fromMillis(1_700) };
                },
              });
            }),
        };
        const commit = firestoreCommitPlan(
          stamped as unknown as Firestore,
          unguarded,
          telemetry.log,
        );
        await commit(
          async (tx) => {
            await tx.get(['barberBusy', 'k100']);
            return tx.query({
              collection: ['barberBusy'],
              where: [],
              orderBy: [],
              limit: null,
            });
          },
          () => Result.err({ errorCode: 'X' }),
        );
        const reads = (
          telemetry.lines[0]?.fields as {
            readonly reads: readonly { readonly updateTimeMs: unknown }[];
          }
        ).reads;
        expect(reads).toHaveLength(50);
        expect(reads[0]).toEqual({
          path: 'barberBusy/k100',
          updateTimeMs: 1_700,
        });
        expect(reads[1]).toEqual({
          path: 'barberBusy/k100',
          updateTimeMs: null,
        });
      });

      it('logs nothing when the decide answers', async () => {
        const { telemetry, commit } = logged({ 'appointments/a1': { v: 1 } });
        await commit(
          async (tx) => tx.get(APPT),
          () => Result.ok({ writes: [] }),
        );
        expect(telemetry.lines).toEqual([]);
      });
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
        const result = await firestoreCommitPlan(
          refusingAfterThePlan(message),
          unguarded,
          NO_LOG,
        )(
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
        unguarded,
        NO_LOG,
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
        unguarded,
        NO_LOG,
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
      const result = await firestoreCommitPlan(
        db,
        unguarded,
        NO_LOG,
      )(
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
        firestoreCommitPlan(
          db,
          unguarded,
          NO_LOG,
        )(
          async () => null,
          () => Result.ok({ writes: [] }),
        ),
      ).rejects.toMatchObject({ code: 14 });
    });
  });

  describe('guarded — a malformed document refuses the whole commit (edge hardening D-3)', () => {
    /** An appointment body as stored — the entity minus its id. */
    const appointmentBody = (): Doc =>
      Object.fromEntries(
        Object.entries(appointmentFixture()).filter(([key]) => key !== 'id'),
      );
    const APPT_ID = appointmentFixture().id;
    const STORED: DocPath = [Collections.Appointments, APPT_ID];
    const STORED_PATH = `${Collections.Appointments}/${APPT_ID}`;
    const malformedBody = (): Doc => ({ ...appointmentBody(), revision: -1 });

    function guarded(seed: Record<string, Doc> = {}) {
      const fake = createProjectionFirestore(seed);
      const telemetry = recordingTelemetry();
      return {
        fake,
        telemetry,
        commit: firestoreCommitPlan(
          fake.db as unknown as Firestore,
          StoredDocumentSystem.guardOf,
          telemetry.log,
        ),
      };
    }

    const refusal = (path: string, reason: string) => ({
      ok: false,
      error: { errorCode: RepositoryErrorCode.Malformed, path, reason },
    });

    const refusedLine = (path: string, field: string) => ({
      level: 'error',
      msg: 'malformed document refused',
      fields: { path, field },
    });

    it('admitStored — the reads outside a transaction: the same object when admitted or unguarded, the refusal logged once', () => {
      const telemetry = recordingTelemetry();
      const doc = { ...appointmentBody(), id: APPT_ID };
      const admitted = admitStored(
        StoredDocumentSystem.guardOf,
        Collections.Appointments,
        doc,
        telemetry.log,
      );
      expect(admitted.ok && admitted.value).toBe(doc);
      const bad = { ...malformedBody(), id: APPT_ID };
      for (const [guardOf, collection] of [
        [StoredDocumentSystem.guardOf, null],
        [StoredDocumentSystem.guardOf, Collections.Users],
        [unguarded, Collections.Appointments],
      ] as const) {
        const asStored = admitStored(guardOf, collection, bad, telemetry.log);
        expect(asStored.ok && asStored.value).toBe(bad);
      }
      expect(telemetry.lines).toEqual([]);
      expect(
        admitStored(
          StoredDocumentSystem.guardOf,
          Collections.Appointments,
          bad,
          telemetry.log,
        ),
      ).toEqual(refusal(STORED_PATH, 'revision'));
      expect(telemetry.lines).toEqual([refusedLine(STORED_PATH, 'revision')]);
    });

    it('a malformed appointment read with get: REPOSITORY_MALFORMED, decide never called, nothing written, one log line', async () => {
      const { fake, telemetry, commit } = guarded({
        [STORED_PATH]: malformedBody(),
      });
      const decide = vi.fn(() =>
        Result.ok({ writes: [WriteOp.set(BUSY, { blocks: [] })] }),
      );
      const result = await commit(async (tx) => tx.get(STORED), decide);
      expect(result).toEqual(refusal(STORED_PATH, 'revision'));
      expect(decide).not.toHaveBeenCalled();
      expect(fake.docs.has('barberBusy/b_ivan__2026-10-07')).toBe(false);
      expect(fake.docs.get(STORED_PATH)).toEqual(malformedBody());
      expect(telemetry.lines).toEqual([refusedLine(STORED_PATH, 'revision')]);
    });

    it('the same through getAll and query — the read callback finishes, the commit refuses', async () => {
      const seed = {
        [STORED_PATH]: malformedBody(),
        'customers/c1': { anything: true },
      };
      const viaGetAll = guarded(seed);
      const seen: unknown[] = [];
      const fromGetAll = await viaGetAll.commit(
        async (tx) => {
          const rows = await tx.getAll([
            ['users', 'u1'],
            STORED,
            ['barberBusy', 'k1'],
          ]);
          seen.push(rows);
          return rows;
        },
        () => Result.ok({ writes: [] }),
      );
      expect(fromGetAll).toEqual(refusal(STORED_PATH, 'revision'));
      // The refused document reads as null; the positions are kept.
      expect(seen).toEqual([[null, null, null]]);

      const viaQuery = guarded({
        [STORED_PATH]: malformedBody(),
        [`${Collections.Appointments}/appt-2`]: appointmentBody(),
      });
      const queried: unknown[] = [];
      const fromQuery = await viaQuery.commit(
        async (tx) => {
          const rows = await tx.query<{ readonly id: string }>({
            collection: [Collections.Appointments],
            where: [],
            orderBy: [],
            limit: null,
          });
          queried.push(rows.map((row) => row.id));
          return rows;
        },
        () => Result.ok({ writes: [] }),
      );
      expect(fromQuery).toEqual(refusal(STORED_PATH, 'revision'));
      expect(queried).toEqual([['appt-2']]);
      expect(viaQuery.telemetry.lines).toHaveLength(1);
    });

    it('the FIRST refusal wins, and the commit logs one line however many were read', async () => {
      const { telemetry, commit } = guarded({
        [STORED_PATH]: malformedBody(),
        'barberBusy/b_ivan__2026-10-07': { blocks: 'none' },
      });
      const result = await commit(
        async (tx) => {
          await tx.get(['barberBusy', 'b_ivan__2026-10-07']);
          return tx.get(STORED);
        },
        () => Result.ok({ writes: [] }),
      );
      expect(result).toEqual(
        refusal('barberBusy/b_ivan__2026-10-07', 'barberId'),
      );
      expect(telemetry.lines).toEqual([
        refusedLine('barberBusy/b_ivan__2026-10-07', 'barberId'),
      ]);
    });

    it('an unguarded collection reads as stored — a users body, a subcollection', async () => {
      const { telemetry, commit } = guarded({
        'users/u1': { roles: 'odd' },
        'users/u1/notifications/n1': { whatever: 1 },
      });
      const result = await commit(
        async (tx) => ({
          user: await tx.get(['users', 'u1']),
          note: await tx.get(['users', 'u1', 'notifications', 'n1']),
        }),
        (snapshot) => Result.ok({ snapshot, writes: [] }),
      );
      expect(result).toEqual({
        ok: true,
        value: {
          snapshot: {
            user: { id: 'u1', roles: 'odd' },
            note: { id: 'n1', whatever: 1 },
          },
        },
      });
      expect(telemetry.lines).toEqual([]);
    });

    it('a well-formed appointment reads as { id, ...body } — the very object decide receives', async () => {
      const { telemetry, commit } = guarded({
        [STORED_PATH]: appointmentBody(),
      });
      let read: unknown = null;
      let decided: unknown = undefined;
      const result = await commit(
        async (tx) => {
          read = await tx.get(STORED);
          return read;
        },
        (snapshot) => {
          decided = snapshot;
          return Result.ok({ writes: [] });
        },
      );
      expect(result.ok).toBe(true);
      expect(read).toEqual(appointmentFixture());
      expect(decided).toBe(read);
      expect(telemetry.lines).toEqual([]);
    });

    it('a contention re-run starts clean: a malformed read on attempt 1, repaired before attempt 2, decides', async () => {
      const telemetry = recordingTelemetry();
      const bodies = [malformedBody(), appointmentBody()];
      const decide = vi.fn((snapshot: unknown) =>
        Result.ok({ snapshot, writes: [] }),
      );
      const db = {
        doc: (path: string) => ({ path }),
        // The SDK re-runs the callback when the commit of an attempt
        // aborts — here, a concurrent repair of the document read.
        runTransaction: async (
          fn: (tx: unknown) => Promise<unknown>,
        ): Promise<unknown> => {
          let answer: unknown;
          for (const body of bodies) {
            answer = await fn({
              get: async () => ({
                exists: true,
                id: APPT_ID,
                data: () => body,
              }),
            });
          }
          return answer;
        },
      } as unknown as Firestore;
      const result = await firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      )(async (tx) => tx.get(STORED), decide);
      expect(decide).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        ok: true,
        value: { snapshot: appointmentFixture() },
      });
      // The answered attempt refused nothing, so nothing is logged.
      expect(telemetry.lines).toEqual([]);
    });

    it('two refusing attempts log ONE line — the answered one', async () => {
      const telemetry = recordingTelemetry();
      const db = {
        doc: (path: string) => ({ path }),
        runTransaction: async (
          fn: (tx: unknown) => Promise<unknown>,
        ): Promise<unknown> => {
          const tx = {
            get: async () => ({
              exists: true,
              id: APPT_ID,
              data: () => malformedBody(),
            }),
          };
          await fn(tx);
          return fn(tx);
        },
      } as unknown as Firestore;
      const result = await firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      )(
        async (tx) => tx.get(STORED),
        () => Result.ok({ writes: [] }),
      );
      expect(result).toEqual(refusal(STORED_PATH, 'revision'));
      expect(telemetry.lines).toEqual([refusedLine(STORED_PATH, 'revision')]);
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
