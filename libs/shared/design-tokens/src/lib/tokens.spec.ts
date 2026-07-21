import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { motion } from './motion';

const cssDir = resolve(__dirname, '../../css');

function readCss(fileName: string): string {
  return readFileSync(resolve(cssDir, fileName), 'utf8');
}

/** All `--cr-*` custom property declarations in a CSS file, name → value. */
function collectCustomProperties(css: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const match of css.matchAll(/(--cr-[\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1] as string, (match[2] as string).trim());
  }
  return declarations;
}

function colorTokenNames(css: string): string[] {
  return [...collectCustomProperties(css).keys()]
    .filter((name) => name.startsWith('--cr-color-'))
    .sort();
}

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mirrors CSS `color-mix(in srgb, a p%, b)`: plain linear interpolation per channel. */
function mixSrgb(a: Rgb, b: Rgb, percentA: number): Rgb {
  const t = percentA / 100;
  return [
    a[0] * t + b[0] * (1 - t),
    a[1] * t + b[1] * (1 - t),
    a[2] * t + b[2] * (1 - t),
  ];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const [rs, gs, bs] = [r, g, b].map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

function requireHex(
  declarations: Map<string, string>,
  name: string,
  file: string,
): Rgb {
  const value = declarations.get(name);
  if (value === undefined || !HEX_PATTERN.test(value)) {
    throw new Error(`${file}: ${name} should be a literal 6-digit hex color`);
  }
  return hexToRgb(value);
}

describe('design tokens', () => {
  it('light and dark themes define the exact same set of color tokens', () => {
    expect(colorTokenNames(readCss('dark.css'))).toEqual(
      colorTokenNames(readCss('light.css')),
    );
  });

  it('every color token is a literal hex or a var()/color-mix expression', () => {
    for (const file of ['light.css', 'dark.css']) {
      const declarations = collectCustomProperties(readCss(file));
      for (const [name, value] of declarations) {
        if (!name.startsWith('--cr-color-')) continue;
        const valid =
          HEX_PATTERN.test(value) ||
          value.startsWith('var(--cr-') ||
          value.startsWith('color-mix(');
        expect(
          valid,
          `${file}: ${name} = "${value}" should be a 6-digit hex, a var(--cr-…) alias, or a color-mix() expression`,
        ).toBe(true);
      }
    }
  });

  it('dark theme: every --cr-color-surface-N tint stays >= WCAG AA (4.5:1) against foreground text', () => {
    // Dark theme tints surface-plain toward surface-tint per elevation tier
    // (see dark.css's surface-1..5 color-mix ramp); light theme keeps flat
    // aliases instead (tested below), per
    // docs/design-research/elevation-surface-case-study.md.
    const core = collectCustomProperties(readCss('tokens.css'));
    const alphaSteps = [...core.entries()]
      .filter(([name]) => /^--cr-alpha-\d$/.test(name))
      .map(([, value]) => Number(value.replace('%', '')));
    expect(alphaSteps.length).toBeGreaterThan(0);

    const dark = collectCustomProperties(readCss('dark.css'));
    const surfacePlain = requireHex(
      dark,
      '--cr-color-surface-plain',
      'dark.css',
    );
    const surfaceTint = requireHex(dark, '--cr-color-surface-tint', 'dark.css');
    const foreground = requireHex(dark, '--cr-color-foreground', 'dark.css');

    for (const percent of alphaSteps) {
      const mixed = mixSrgb(surfaceTint, surfacePlain, percent);
      expect(
        contrastRatio(mixed, foreground),
        `dark.css: surface-plain tinted ${percent}% toward surface-tint should stay >= 4.5:1 against foreground`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('light theme: surface-plain (which --cr-color-surface-N flatly aliases, untinted) stays >= WCAG AA (4.5:1) against foreground text', () => {
    const light = collectCustomProperties(readCss('light.css'));
    const surfacePlain = requireHex(
      light,
      '--cr-color-surface-plain',
      'light.css',
    );
    const foreground = requireHex(light, '--cr-color-foreground', 'light.css');

    expect(
      contrastRatio(surfacePlain, foreground),
      'light.css: surface-plain should stay >= 4.5:1 against foreground',
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('dark theme surface-N ramp references the alpha tokens rather than hardcoding percentages', () => {
    const dark = collectCustomProperties(readCss('dark.css'));
    for (let tier = 1; tier <= 5; tier++) {
      const value = dark.get(`--cr-color-surface-${tier}`);
      expect(
        value,
        `dark.css: --cr-color-surface-${tier} should mix via var(--cr-alpha-${tier})`,
      ).toContain(`var(--cr-alpha-${tier})`);
    }
  });

  it('highlight is a surface with an explicit paired foreground in both themes', () => {
    // The expressive yellow must never be used as text; consumers pair
    // highlight + highlight-foreground, so both keys must exist per theme
    // and keep >= 4.5:1 against each other.
    for (const file of ['light.css', 'dark.css']) {
      const declarations = collectCustomProperties(readCss(file));
      const highlight = requireHex(declarations, '--cr-color-highlight', file);
      const highlightForeground = requireHex(
        declarations,
        '--cr-color-highlight-foreground',
        file,
      );
      expect(
        contrastRatio(highlight, highlightForeground),
        `${file}: highlight-foreground should stay >= 4.5:1 on highlight`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every --cr-text-* role defines a full font shorthand plus a tracking token', () => {
    // Roles are `font` shorthands (weight size/line-height family) so a
    // role can never be half-applied — see the case study's F2 finding.
    const core = collectCustomProperties(readCss('tokens.css'));
    const roleNames = [...core.keys()].filter(
      (name) => name.startsWith('--cr-text-') && !name.endsWith('-tracking'),
    );
    expect(roleNames.length).toBeGreaterThan(0);

    for (const role of roleNames) {
      const value = core.get(role) ?? '';
      expect(
        /\/\s*[\d.]+/.test(value),
        `${role} should bundle a line-height (size/line-height syntax)`,
      ).toBe(true);
      expect(
        value.includes('var(--cr-font-family-'),
        `${role} should end in a font-family token`,
      ).toBe(true);
      expect(
        core.has(`${role}-tracking`),
        `${role} should have a matching ${role}-tracking token`,
      ).toBe(true);
    }
  });

  it('motion.ts mirrors the --cr-motion-* CSS tokens exactly', () => {
    // WAAPI call sites read `motion` from TS; CSS reads var(--cr-motion-*).
    // Both must change together — this is the only guard.
    const core = collectCustomProperties(readCss('tokens.css'));

    const cssDurations = new Map(
      [...core.entries()]
        .filter(([name]) => name.startsWith('--cr-motion-duration-'))
        .map(([name, value]) => [
          name.replace('--cr-motion-duration-', ''),
          Number(value.replace('ms', '')),
        ]),
    );
    expect(Object.fromEntries(cssDurations)).toEqual(motion.duration);

    const cssEasings = new Map(
      [...core.entries()]
        .filter(([name]) => name.startsWith('--cr-motion-easing-'))
        .map(([name, value]) => [
          name.replace('--cr-motion-easing-', ''),
          value,
        ]),
    );
    expect(Object.fromEntries(cssEasings)).toEqual(motion.easing);
  });
});
