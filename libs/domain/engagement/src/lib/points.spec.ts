import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Points } from './points';
import { InsufficientPointsError, InvalidPointsError } from './points.errors';

/** Balances well inside the safe-integer range, so a sum never loses precision. */
const anyAmount = fc.nat({ max: 1_000_000_000 });
const anyPoints = anyAmount.map((amount) => Points.fromPrimitive(amount));

describe('Points.create', () => {
  it('accepts a non-negative integer', () => {
    const result = Points.create(100);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.amount).toBe(100);
    }
  });

  it('accepts zero', () => {
    expect(Points.create(0).isSuccess()).toBe(true);
  });

  it('rejects a negative amount', () => {
    const result = Points.create(-1);
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(InvalidPointsError);
    }
  });

  it('rejects a non-integer amount', () => {
    expect(Points.create(1.5).isFailure()).toBe(true);
  });
});

describe('Points.zero', () => {
  it('constructs zero points', () => {
    expect(Points.zero().amount).toBe(0);
  });
});

describe('Points.add / subtract', () => {
  it('adds two point amounts', () => {
    const a = Points.create(10);
    const b = Points.create(5);
    if (a.isFailure() || b.isFailure()) throw new Error('bad fixture');
    expect(a.value.add(b.value).amount).toBe(15);
  });

  it('subtract takes the amount off the balance', () => {
    const result = Points.fromPrimitive(10).subtract(Points.fromPrimitive(4));
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) expect(result.value.amount).toBe(6);
  });

  it('subtract REFUSES an over-spend instead of clamping it to zero', () => {
    // T2, R27: a clamp would make 5 points of the debit vanish, and the
    // ledger would no longer sum to the balance.
    const result = Points.fromPrimitive(5).subtract(Points.fromPrimitive(10));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(InsufficientPointsError);
      expect(result.error.code).toBe('engagement.points.insufficient');
      expect(result.error.requested).toBe(10);
      expect(result.error.balance).toBe(5);
      expect(result.error.params).toEqual({ requested: 10, balance: 5 });
    }
  });

  it('subtract may take the whole balance', () => {
    const result = Points.fromPrimitive(7).subtract(Points.fromPrimitive(7));
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess())
      expect(result.value.equals(Points.zero())).toBe(true);
  });

  it('equals compares by amount', () => {
    const a = Points.create(10);
    const b = Points.fromPrimitive(10);
    if (a.isFailure()) throw new Error('bad fixture');
    expect(a.value.equals(b)).toBe(true);
  });
});

describe('Points laws', () => {
  it('create accepts exactly the non-negative integers', () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.double()), (raw) => {
        const valid = Number.isInteger(raw) && raw >= 0;
        expect(Points.create(raw).isSuccess()).toBe(valid);
      }),
    );
  });

  it('add sums the amounts, commutes, associates and has zero as identity', () => {
    fc.assert(
      fc.property(anyPoints, anyPoints, anyPoints, (a, b, c) => {
        expect(a.add(b).amount).toBe(a.amount + b.amount);
        expect(a.add(b).equals(b.add(a))).toBe(true);
        expect(
          a
            .add(b)
            .add(c)
            .equals(a.add(b.add(c))),
        ).toBe(true);
        expect(a.add(Points.zero()).equals(a)).toBe(true);
      }),
    );
  });

  it('subtract refuses exactly when the result would be negative', () => {
    fc.assert(
      fc.property(anyPoints, anyPoints, (balance, taken) => {
        const result = balance.subtract(taken);
        expect(result.isFailure()).toBe(taken.amount > balance.amount);
      }),
    );
  });

  it('subtract never clamps: a success is the exact difference, a refusal names both sides', () => {
    fc.assert(
      fc.property(anyPoints, anyPoints, (balance, taken) => {
        const result = balance.subtract(taken);
        if (result.isSuccess()) {
          expect(result.value.amount).toBe(balance.amount - taken.amount);
        } else {
          expect(result.error).toBeInstanceOf(InsufficientPointsError);
          expect(result.error.requested).toBe(taken.amount);
          expect(result.error.balance).toBe(balance.amount);
        }
      }),
    );
  });

  it('subtract undoes add, and taking nothing changes nothing', () => {
    fc.assert(
      fc.property(anyPoints, anyPoints, (a, b) => {
        const back = a.add(b).subtract(b);
        expect(back.isSuccess() && back.value.equals(a)).toBe(true);
        const same = a.subtract(Points.zero());
        expect(same.isSuccess() && same.value.equals(a)).toBe(true);
      }),
    );
  });

  it('neither operation mutates its operands', () => {
    fc.assert(
      fc.property(anyAmount, anyAmount, (x, y) => {
        const a = Points.fromPrimitive(x);
        const b = Points.fromPrimitive(y);
        a.add(b);
        a.subtract(b);
        expect(a.amount).toBe(x);
        expect(b.amount).toBe(y);
      }),
    );
  });
});
