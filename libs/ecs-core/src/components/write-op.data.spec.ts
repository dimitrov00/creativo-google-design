import { describe, expect, it } from 'vitest';
import { WriteKind, WriteOp } from './write-op.data';

const path = ['barberBusy', 'b_ivan__2026-10-07'] as const;

describe('WriteOp factories', () => {
  it('set / create carry the whole body', () => {
    const body = { barberId: 'b_ivan', blocks: [] };
    expect(WriteOp.set(path, body)).toEqual({
      kind: WriteKind.Set,
      path,
      body,
    });
    expect(WriteOp.create(path, body)).toEqual({
      kind: WriteKind.Create,
      path,
      body,
    });
  });

  it('update carries the fields to merge', () => {
    expect(WriteOp.update(path, { 'bookingStatus.kind': 'confirmed' })).toEqual(
      {
        kind: WriteKind.Update,
        path,
        fields: { 'bookingStatus.kind': 'confirmed' },
      },
    );
  });

  it('remove is the Delete a plan uses when a day empties', () => {
    expect(WriteOp.remove(path)).toEqual({ kind: WriteKind.Delete, path });
  });

  it('accepts a nested path of alternating collections and ids', () => {
    const nested = ['clientStats', 'u_1', 'restricted', 'money'];
    expect(WriteOp.remove(nested).path).toEqual(nested);
  });
});

describe('WriteOp.isDelete', () => {
  it('is true only for a Delete', () => {
    const plan: readonly WriteOp[] = [
      WriteOp.set(path, {}),
      WriteOp.create(path, {}),
      WriteOp.update(path, {}),
      WriteOp.remove(path),
    ];
    expect(plan.map(WriteOp.isDelete)).toEqual([false, false, false, true]);
  });
});
