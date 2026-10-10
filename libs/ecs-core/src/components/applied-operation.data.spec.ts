import { describe, expect, it } from 'vitest';
import { AppliedOperation } from './applied-operation.data';

const op = (id: string, revision: number): AppliedOperation => ({
  id,
  revision,
  digest: `d-${id}-${revision}`,
});

describe('AppliedOperation — the staff-edit ledger', () => {
  it('finds an operation by id, or nothing', () => {
    const ledger = [op('a', 1), op('b', 2)];
    expect(AppliedOperation.find(ledger, 'b')).toEqual(op('b', 2));
    expect(AppliedOperation.find(ledger, 'z')).toBeNull();
  });

  it('records the newest last and replaces an older entry under the same id', () => {
    const ledger = [op('a', 1), op('b', 2)];
    expect(AppliedOperation.append(ledger, op('a', 3))).toEqual([
      op('b', 2),
      op('a', 3),
    ]);
    expect(ledger).toEqual([op('a', 1), op('b', 2)]);
  });

  it('keeps only the newest CAP entries — the oldest fall off first', () => {
    let ledger: readonly AppliedOperation[] = [];
    for (let i = 0; i < AppliedOperation.CAP + 5; i++) {
      ledger = AppliedOperation.append(ledger, op(`op-${i}`, i));
    }
    expect(AppliedOperation.CAP).toBe(20);
    expect(ledger).toHaveLength(20);
    expect(ledger[0]).toEqual(op('op-5', 5));
    expect(ledger[19]).toEqual(op('op-24', 24));
  });
});
