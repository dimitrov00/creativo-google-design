import { describe, expect, it } from 'vitest';
import { WriteAction, WriteOp } from './write-op.data';

const path = ['barberBusy', 'b_ivan__2026-10-07'] as const;

describe('WriteOp factories', () => {
  it('uses the SCREAMING writeAction tags (Law 6)', () => {
    expect(Object.values(WriteAction)).toEqual([
      'SET',
      'CREATE',
      'UPDATE',
      'DELETE',
    ]);
  });

  it('set / create carry the whole body', () => {
    const body = { barberId: 'b_ivan', blocks: [] };
    expect(WriteOp.set(path, body)).toEqual({
      writeAction: WriteAction.Set,
      path,
      body,
    });
    expect(WriteOp.create(path, body)).toEqual({
      writeAction: WriteAction.Create,
      path,
      body,
    });
  });

  it('update carries ROOT fields to merge and deletes nothing', () => {
    expect(WriteOp.update(path, { bookingStatus: 'CANCELLED' })).toEqual({
      writeAction: WriteAction.Update,
      path,
      fields: { bookingStatus: 'CANCELLED' },
      deleteFields: [],
    });
  });

  it('transition sets the new variant and deletes the old one’s leftovers', () => {
    expect(
      WriteOp.transition(
        path,
        { bookingStatus: 'CANCELLED', cancelledAtUtcMs: 2 },
        ['confirmedAtUtcMs'],
      ),
    ).toEqual({
      writeAction: WriteAction.Update,
      path,
      fields: { bookingStatus: 'CANCELLED', cancelledAtUtcMs: 2 },
      deleteFields: ['confirmedAtUtcMs'],
    });
  });

  it('transition is data: a key in both lists is kept as given (adapters refuse it)', () => {
    const op = WriteOp.transition(path, { a: 1 }, ['a']);
    expect(op.fields).toEqual({ a: 1 });
    expect(op.deleteFields).toEqual(['a']);
  });

  it('remove is the Delete a plan uses when a day empties', () => {
    expect(WriteOp.remove(path)).toEqual({
      writeAction: WriteAction.Delete,
      path,
    });
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

describe('WriteOp.variantFieldsToDelete', () => {
  it('lists the keys of the old variant the new one does not declare', () => {
    const confirmed = {
      bookingStatus: 'CONFIRMED',
      confirmedAtUtcMs: 1,
      localDate: '2026-10-07',
    };
    const cancelled = {
      bookingStatus: 'CANCELLED',
      cancelledAtUtcMs: 2,
      cancellationReason: 'ILLNESS',
      localDate: '2026-10-07',
    };
    expect(WriteOp.variantFieldsToDelete(confirmed, cancelled)).toEqual([
      'confirmedAtUtcMs',
    ]);
    expect(WriteOp.variantFieldsToDelete(cancelled, confirmed)).toEqual([
      'cancelledAtUtcMs',
      'cancellationReason',
    ]);
  });

  it('keeps a key the new variant declares as null', () => {
    expect(WriteOp.variantFieldsToDelete({ a: 1, b: 2 }, { a: null })).toEqual([
      'b',
    ]);
  });

  it('is empty between equal shapes, and pure', () => {
    const before = Object.freeze({ a: 1 });
    const after = Object.freeze({ a: 2 });
    expect(WriteOp.variantFieldsToDelete(before, after)).toEqual([]);
    expect(WriteOp.variantFieldsToDelete(before, after)).toEqual(
      WriteOp.variantFieldsToDelete(before, after),
    );
  });
});
