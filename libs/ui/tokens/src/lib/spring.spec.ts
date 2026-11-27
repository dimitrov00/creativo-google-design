import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOKENS_DIR, stripCssComments } from './accent-spec-support';
import {
  SPRING_PRESETS,
  type SpringPresetName,
  springEasing,
  springProgress,
  springSettleMs,
} from './spring';

/*
 * The spring tokens are hand-written CSS. This recomputes each from its
 * SwiftUI parameters and fails when the committed token differs, so the
 * numbers in `tokens.css` are never taken on trust.
 */

const css = stripCssComments(
  readFileSync(join(TOKENS_DIR, 'tokens.css'), 'utf8'),
);

/** The first declaration of a token: the `:root` one, ahead of the fallback. */
function token(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  if (match?.[1] === undefined) throw new Error(`no token ${name}`);
  // Prettier sets a long `linear()` one stop per line.
  return match[1]
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .trim();
}

const names = Object.keys(SPRING_PRESETS) as SpringPresetName[];

describe('spring tokens', () => {
  it.each(names)('%s is the curve its parameters give', (name) => {
    const preset = SPRING_PRESETS[name];
    expect(token(`--sys-motion-spring-${name}-duration`)).toBe(
      `${springSettleMs(preset)}ms`,
    );
    expect(token(`--sys-motion-spring-${name}-easing`)).toBe(
      springEasing(preset),
    );
    expect(token(`--sys-motion-spring-${name}`)).toBe(
      `var(--sys-motion-spring-${name}-duration) var(--sys-motion-spring-${name}-easing)`,
    );
  });

  it.each(names)('%s covers most of its travel within 300 ms', (name) => {
    expect(springProgress(SPRING_PRESETS[name], 0.3)).toBeGreaterThan(0.85);
  });

  it('smooth never passes its target, snappy passes it by under one percent', () => {
    const peak = (name: SpringPresetName) =>
      Math.max(
        ...Array.from({ length: 1000 }, (_, ms) =>
          springProgress(SPRING_PRESETS[name], ms / 1000),
        ),
      );
    expect(peak('smooth')).toBeLessThanOrEqual(1);
    expect(peak('snappy')).toBeGreaterThan(1);
    expect(peak('snappy')).toBeLessThan(1.01);
  });
});
