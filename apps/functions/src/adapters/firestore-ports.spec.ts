import type { Firestore } from 'firebase-admin/firestore';
import { expectTypeOf } from 'vitest';
import { Result, type TxPorts, WriteOp } from '@creativo/ecs-core';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { type FirestorePorts, firestorePorts } from './firestore-ports';
import { firestoreCommitPlan } from './firestore-tx.adapter';

describe('firestorePorts — the assembler', () => {
  const primitives = {
    nowMs: () => 1_760_000_000_000,
    nextId: () => 'id-1',
    hash: (input: string) => `h(${input})`,
  };

  it('assembles the transaction bundle: one commit port and the three primitives, as given', () => {
    const fake = createProjectionFirestore();
    const ports = firestorePorts(fake.db as unknown as Firestore, primitives);
    expect(Object.keys(ports).sort()).toEqual([
      'commit',
      'hash',
      'nextId',
      'nowMs',
    ]);
    expect(ports.nowMs).toBe(primitives.nowMs);
    expect(ports.nextId).toBe(primitives.nextId);
    expect(ports.hash).toBe(primitives.hash);
  });

  it('commits over the db it was given', async () => {
    const fake = createProjectionFirestore();
    const ports = firestorePorts(fake.db as unknown as Firestore, primitives);
    const result = await ports.commit(
      async () => null,
      () =>
        Result.ok({
          id: ports.nextId(),
          writes: [
            WriteOp.set(['barberBusy', ports.hash('k')], { blocks: [] }),
          ],
        }),
    );
    expect(result).toEqual({ ok: true, value: { id: 'id-1' } });
    expect(fake.docs.get('barberBusy/h(k)')).toEqual({ blocks: [] });
  });

  it('is typed as exactly the bundle it builds, and an unbuilt member does not compile', () => {
    // Compile-time, enforced by `nx typecheck functions` over this spec: the
    // assembler returns `FirestorePorts` (today `TxPorts`) and nothing wider.
    expectTypeOf(firestorePorts).returns.toEqualTypeOf<FirestorePorts>();
    expectTypeOf<FirestorePorts>().toEqualTypeOf<TxPorts>();

    // The extension point's promise: a member declared on `FirestorePorts`
    // that the assembler leaves out is a type error, not a runtime hole.
    const fake = createProjectionFirestore();
    const withoutHash = {
      commit: firestoreCommitPlan(fake.db as unknown as Firestore),
      nowMs: primitives.nowMs,
      nextId: primitives.nextId,
    };
    // @ts-expect-error — `hash` is declared on FirestorePorts and not built
    const unbuilt: FirestorePorts = withoutHash;
    expect(Object.keys(unbuilt)).not.toContain('hash');
  });
});
