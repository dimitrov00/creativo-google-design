import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Points } from './points.data';

// The cases of `points.spec.ts`, on the brand.

/** Balances well inside the safe-integer range, so a sum never loses precision. */
const anyAmount = fc.nat({ max: 1_000_000_000 });
const anyPoints = anyAmount.map((amount) => Points.of(amount));

describe('Points.parse', () => {
  it.each([0, 1, 100])('accepts %s', (raw) => {
    expect(Points.parse(raw)).toEqual({ ok: true, value: raw });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %s',
    (raw) => {
      expect(Points.parse(raw)).toEqual({
        ok: false,
        error: { errorCode: 'ENGAGEMENT_POINTS_INVALID', attempted: raw },
      });
    },
  );

  it('folds a negative zero', () => {
    const parsed = Points.parse(-0);
    expect(parsed.ok && Object.is(parsed.value, 0)).toBe(true);
  });
});

describe('Points arithmetic', () => {
  it('starts from zero and adds', () => {
    expect(Points.zero()).toBe(0);
    expect(Points.add(Points.of(10), Points.of(5))).toBe(15);
  });

  it('takes the amount off the balance, the whole of it too', () => {
    expect(Points.sub(Points.of(10), Points.of(4))).toEqual({
      ok: true,
      value: 6,
    });
    expect(Points.sub(Points.of(7), Points.of(7))).toEqual({
      ok: true,
      value: 0,
    });
  });

  it('REFUSES an over-spend instead of clamping it to zero', () => {
    // T2, R27: a clamp would make 5 points of the debit vanish, and the
    // ledger would no longer sum to the balance.
    expect(Points.sub(Points.of(5), Points.of(10))).toEqual({
      ok: false,
      error: {
        errorCode: 'ENGAGEMENT_POINTS_INSUFFICIENT',
        requested: 10,
        balance: 5,
      },
    });
  });

  it('adds commutatively and associatively, with zero as identity', () => {
    fc.assert(
      fc.property(anyPoints, anyPoints, anyPoints, (a, b, c) => {
        expect(Points.add(a, b)).toBe(Points.add(b, a));
        expect(Points.add(Points.add(a, b), c)).toBe(
          Points.add(a, Points.add(b, c)),
        );
        expect(Points.add(a, Points.zero())).toBe(a);
      }),
    );
  });

  it('refuses exactly when the result would be negative, and never clamps', () => {
    fc.assert(
      fc.property(anyPoints, anyPoints, (balance, taken) => {
        const result = Points.sub(balance, taken);
        expect(result.ok).toBe(taken <= balance);
        if (result.ok) expect(result.value).toBe(balance - taken);
        else
          expect(result.error).toEqual({
            errorCode: 'ENGAGEMENT_POINTS_INSUFFICIENT',
            requested: taken,
            balance,
          });
      }),
    );
  });

  it('undoes add, and taking nothing changes nothing', () => {
    fc.assert(
      fc.property(anyPoints, anyPoints, (a, b) => {
        expect(Points.sub(Points.add(a, b), b)).toEqual({ ok: true, value: a });
        expect(Points.sub(a, Points.zero())).toEqual({ ok: true, value: a });
      }),
    );
  });
});
