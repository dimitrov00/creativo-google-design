import { describe, expect, it } from 'vitest';
import { unwrapErr, unwrapOk } from '@core/testing';
import { PriceCents } from './price-cents.primitive';

const c = (raw: number) => unwrapOk(PriceCents.signed(raw));

describe('PriceCents — money in minor units', () => {
  it('of takes a non-negative safe integer, folding -0', () => {
    expect(PriceCents.of(2800)).toEqual({ ok: true, value: 2800 });
    expect(Object.is(unwrapOk(PriceCents.of(-0)), 0)).toBe(true);
    for (const raw of [-1, 28.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(unwrapErr(PriceCents.of(raw))).toEqual({
        errorCode: 'PRIMITIVE_PRICE_CENTS_INVALID',
        raw,
        brand: 'PriceCents',
      });
    }
  });

  it('signed takes a delta or a balance below zero', () => {
    expect(PriceCents.signed(-500)).toEqual({ ok: true, value: -500 });
    expect(PriceCents.signed(0.5).ok).toBe(false);
  });

  it('ZERO, add, sub (signed) and sum', () => {
    expect(PriceCents.add(PriceCents.ZERO, c(2800))).toBe(2800);
    expect(PriceCents.sub(c(1000), c(2800))).toBe(-1800);
    expect(Object.is(PriceCents.sub(c(0), c(0)), 0)).toBe(true);
    expect(PriceCents.sum([c(2800), c(1500), c(-300)])).toBe(4000);
    expect(PriceCents.sum([])).toBe(0);
  });
});

describe('PriceCents.is — the read-time door of a price (edge hardening D-1)', () => {
  it('is ⇔ of (never signed) over the numbers', () => {
    for (const raw of [
      0,
      -0,
      2800,
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER + 2,
    ]) {
      expect(PriceCents.is(raw), String(raw)).toBe(PriceCents.of(raw).ok);
    }
    // A signed amount is a balance, not a price: the door is `of`'s.
    expect(PriceCents.signed(-100).ok).toBe(true);
    expect(PriceCents.is(-100)).toBe(false);
  });

  it('is answers false for every other type', () => {
    for (const raw of [null, undefined, '2800', {}, [], true]) {
      expect(PriceCents.is(raw)).toBe(false);
    }
  });
});
