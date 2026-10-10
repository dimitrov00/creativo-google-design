import { FieldPath } from 'firebase-admin/firestore';
import { QueryOp, RepositoryError, Result, WriteOp } from '@creativo/ecs-core';
import { createProjectionFirestore } from './fake-projection-firestore';

describe('FakeProjectionFirestore', () => {
  describe('as the CommitPlan double', () => {
    it('hands the read callback a ReadTx and records each attempt’s read set', async () => {
      const fake = createProjectionFirestore({ 'appointments/a1': { v: 1 } });
      await fake.commit(
        async (tx) => {
          await tx.get(['appointments', 'a1']);
          await tx.getAll([
            ['barberBusy', 'k1'],
            ['barberBusy', 'k2'],
          ]);
          return tx.query({
            collection: ['appointments'],
            where: [{ field: 'v', op: QueryOp.Eq, value: 1 }],
            orderBy: [],
            limit: null,
          });
        },
        () => Result.ok({ writes: [] }),
      );
      expect(fake.transactions).toHaveLength(1);
      expect(fake.transactions[0]?.reads).toEqual([
        ['appointments', 'a1'],
        ['barberBusy', 'k1'],
        ['barberBusy', 'k2'],
      ]);
      expect(fake.transactions[0]?.queries).toEqual([
        {
          collection: ['appointments'],
          where: [{ field: 'v', op: QueryOp.Eq, value: 1 }],
          orderBy: [],
          limit: null,
        },
      ]);
    });

    it('records every APPLIED plan — a refusal or a conflict adds none', async () => {
      const fake = createProjectionFirestore({ 'auditLog/taken': {} });
      const applied = [WriteOp.set(['barberBusy', 'k1'], { blocks: [] })];
      await fake.commit(
        async () => null,
        () => Result.ok({ writes: applied }),
      );
      await fake.commit(
        async () => null,
        () => Result.err({ code: 'booking.commit.slot_unavailable' }),
      );
      const conflict = await fake.commit(
        async () => null,
        () =>
          Result.ok({ writes: [WriteOp.create(['auditLog', 'taken'], {})] }),
      );
      expect(conflict.ok).toBe(false);
      expect(fake.plans).toEqual([applied]);
      expect(fake.docs.get('barberBusy/k1')).toEqual({ blocks: [] });
    });

    it('names the conflicting document of a plan that creates several, as the emulator does', async () => {
      const fake = createProjectionFirestore({ 'auditLog/taken': {} });
      const result = await fake.commit(
        async () => null,
        () =>
          Result.ok({
            writes: [
              WriteOp.create(['auditLog', 'fresh'], {}),
              WriteOp.create(['auditLog', 'taken'], {}),
            ],
          }),
      );
      expect(result).toEqual({
        ok: false,
        error: RepositoryError.alreadyExists('auditLog/taken'),
      });
      expect(fake.docs.has('auditLog/fresh')).toBe(false);
    });
  });

  describe('the Admin SDK surface the legacy specs use, unchanged', () => {
    it('keeps the object-form update a lenient shallow merge', async () => {
      const fake = createProjectionFirestore({ 'giftVouchers/v1': { a: 1 } });
      await fake.db.runTransaction(async (tx) => {
        tx.update(fake.db.collection('giftVouchers').doc('v1'), { b: 2 });
        tx.update(fake.db.collection('giftVouchers').doc('v2'), { c: 3 });
      });
      expect(fake.docs.get('giftVouchers/v1')).toEqual({ a: 1, b: 2 });
      expect(fake.docs.get('giftVouchers/v2')).toEqual({ c: 3 });
      expect(fake.writes).toEqual(['giftVouchers/v1', 'giftVouchers/v2']);
    });

    it('writes a FieldPath update at the root, and refuses a nested path (Law 5)', async () => {
      const fake = createProjectionFirestore({ 'settings/x': { a: { b: 1 } } });
      const ref = fake.db.doc('settings/x');
      await fake.db.runTransaction(async (tx) => {
        tx.update(ref, new FieldPath('a.b'), 2);
      });
      expect(fake.docs.get('settings/x')).toEqual({ a: { b: 1 }, 'a.b': 2 });
      await expect(
        fake.db.runTransaction(async (tx) => {
          tx.update(ref, new FieldPath('a', 'b'), 3);
        }),
      ).rejects.toThrow(/never dot paths/);
      expect(fake.docs.get('settings/x')).toEqual({ a: { b: 1 }, 'a.b': 2 });
    });

    it('makes a transaction atomic: a throw in the callback writes nothing', async () => {
      const fake = createProjectionFirestore();
      await expect(
        fake.db.runTransaction(async (tx) => {
          tx.set(fake.db.doc('settings/x'), { v: 1 });
          throw new Error('refused after staging');
        }),
      ).rejects.toThrow('refused after staging');
      expect(fake.docs.has('settings/x')).toBe(false);
    });

    it('still orders by document id and pages with startAfter', async () => {
      const fake = createProjectionFirestore({
        'clients/c': {},
        'clients/a': {},
        'clients/b': {},
      });
      const page = await fake.db
        .collection('clients')
        .where(FieldPath.documentId(), '>=', 'a')
        .orderBy(FieldPath.documentId())
        .startAfter('a')
        .limit(5)
        .get();
      expect(page.docs.map((doc) => doc.id)).toEqual(['b', 'c']);
    });

    it('batches stay all-or-nothing on a taken create', async () => {
      const fake = createProjectionFirestore({ 'auditLog/x': {} });
      const batch = fake.db.batch();
      batch.set(fake.db.doc('auditLog/y'), {});
      batch.create(fake.db.doc('auditLog/x'), {});
      await expect(batch.commit()).rejects.toMatchObject({ code: 6 });
      expect(fake.docs.has('auditLog/y')).toBe(false);
    });
  });
});
