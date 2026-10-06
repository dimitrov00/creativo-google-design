import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  WCAG_AA_TEXT,
  composite,
  contrastRatio,
  parseHex,
  relativeLuminance,
  type Srgb,
} from './contrast';

const channel = fc.double({ min: 0, max: 255, noNaN: true });
const srgb: fc.Arbitrary<Srgb> = fc.tuple(channel, channel, channel);
const alpha = fc.double({ min: 0, max: 1, noNaN: true });

describe('parseHex', () => {
  it('reads #rrggbb in either case', () => {
    expect(parseHex('#f26b22')).toEqual([242, 107, 34]);
    expect(parseHex('#F26B22')).toEqual([242, 107, 34]);
  });

  it('refuses anything that is not a six-digit literal', () => {
    for (const value of ['f26b22', '#f62', '#f26b22ff', 'var(--x)', '']) {
      expect(() => parseHex(value)).toThrow(/#rrggbb/);
    }
  });
});

describe('relativeLuminance', () => {
  it('spans 0 (black) to 1 (white)', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 10);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white and 1:1 for a colour on itself', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 10);
    expect(contrastRatio([242, 107, 34], [242, 107, 34])).toBe(1);
  });

  it('matches the WCAG reference: #777777 on white just misses 4.5', () => {
    const ratio = contrastRatio(parseHex('#777777'), parseHex('#ffffff'));
    expect(ratio).toBeCloseTo(4.48, 2);
    expect(ratio).toBeLessThan(WCAG_AA_TEXT);
  });

  // The measurement that opened the bug: axe on /account, light theme,
  // foreground #c14b0b on background #fdede4 (the bordered 12% wash on a
  // white card) = 4.3:1. The composite must land on the colour axe
  // reported and the ratio on its number, or every figure in the token
  // comments is measured on a different scale from the audit. The unrounded
  // wash gives 4.31; the hex axe prints (#fdede4) gives 4.30 — both are
  // the reported 4.3, and both fail.
  it('reproduces the axe measurement of the old bordered label', () => {
    const wash = composite(parseHex('#f26b22'), 0.12, parseHex('#ffffff'));
    expect(wash.map(Math.round)).toEqual(parseHex('#fdede4'));
    const unrounded = contrastRatio(parseHex('#c14b0b'), wash);
    const printed = contrastRatio(parseHex('#c14b0b'), parseHex('#fdede4'));
    expect(unrounded).toBeCloseTo(4.31, 2);
    expect(printed).toBeCloseTo(4.3, 2);
    expect(Math.max(unrounded, printed)).toBeLessThan(WCAG_AA_TEXT);
  });

  it('is symmetric and bounded to 1–21', () => {
    fc.assert(
      fc.property(srgb, srgb, (a, b) => {
        const ratio = contrastRatio(a, b);
        expect(ratio).toBe(contrastRatio(b, a));
        expect(ratio).toBeGreaterThanOrEqual(1);
        expect(ratio).toBeLessThanOrEqual(21 + 1e-9);
      }),
    );
  });
});

describe('composite', () => {
  it('is the ground at 0 and the paint at 1', () => {
    fc.assert(
      fc.property(srgb, srgb, (top, under) => {
        expect(composite(top, 0, under)).toEqual([...under]);
        expect(composite(top, 1, under)).toEqual([...top]);
      }),
    );
  });

  it('stays between the ground and the paint on every channel', () => {
    fc.assert(
      fc.property(srgb, alpha, srgb, (top, a, under) => {
        const out = composite(top, a, under);
        const channels = [
          [out[0], top[0], under[0]],
          [out[1], top[1], under[1]],
          [out[2], top[2], under[2]],
        ] as const;
        for (const [value, paint, ground] of channels) {
          expect(value).toBeGreaterThanOrEqual(Math.min(paint, ground) - 1e-9);
          expect(value).toBeLessThanOrEqual(Math.max(paint, ground) + 1e-9);
        }
      }),
    );
  });

  it('refuses an alpha outside 0–1', () => {
    for (const bad of [-0.01, 1.01, Number.NaN]) {
      expect(() => composite([0, 0, 0], bad, [255, 255, 255])).toThrow(
        RangeError,
      );
    }
  });
});
