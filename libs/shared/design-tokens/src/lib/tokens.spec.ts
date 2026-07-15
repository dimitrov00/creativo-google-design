import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const tokensDir = resolve(__dirname, '../../tokens');

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(tokensDir, relativePath), 'utf8'));
}

function collectLeafPaths(node: unknown, path: string[] = []): string[] {
  if (node === null || typeof node !== 'object') return [];
  const record = node as Record<string, unknown>;
  if ('$value' in record) return [path.join('.')];
  return Object.entries(record)
    .filter(([key]) => !key.startsWith('$'))
    .flatMap(([key, value]) => collectLeafPaths(value, [...path, key]));
}

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;
const ALIAS_PATTERN = /^\{color\.([a-zA-Z0-9]+)\.([a-zA-Z0-9]+)\}$/;

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Resolves a semantic color token's $value — either a literal hex or a `{color.<group>.<step>}` core-ramp alias — to a literal hex string. */
function resolveColorHex(
  value: string,
  core: Record<string, Record<string, { $value: string }>>,
): string {
  if (HEX_PATTERN.test(value)) return value;
  const match = ALIAS_PATTERN.exec(value);
  if (!match) throw new Error(`Unresolvable color value: "${value}"`);
  const [, group, step] = match;
  return core[group][step].$value;
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
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

describe('design tokens', () => {
  it('light and dark semantic themes define the exact same set of color tokens', () => {
    const light = collectLeafPaths(readJson('semantic/light.json')).sort();
    const dark = collectLeafPaths(readJson('semantic/dark.json')).sort();
    expect(dark).toEqual(light);
  });

  it('every semantic color token is either a valid hex color or a resolvable core-ramp alias', () => {
    const core = readJson('core/color.json')['color'] as Record<
      string,
      Record<string, unknown>
    >;

    for (const file of ['semantic/light.json', 'semantic/dark.json']) {
      const semantic = readJson(file);
      const color = semantic['color'] as Record<string, { $value: string }>;
      for (const [name, token] of Object.entries(color)) {
        if (name.startsWith('$')) continue;
        const value = token.$value;
        if (HEX_PATTERN.test(value)) continue;

        const match = ALIAS_PATTERN.exec(value);
        expect(
          match,
          `${file}: ${name} = "${value}" should be a hex color or {color.<group>.<step>}`,
        ).not.toBeNull();
        const [, group, step] = match!;
        expect(
          Object.prototype.hasOwnProperty.call(core, group),
          `${file}: ${name} references unknown core color group "${group}"`,
        ).toBe(true);
        expect(
          Object.prototype.hasOwnProperty.call(core[group], step),
          `${file}: ${name} references unknown step "${step}" in core color group "${group}"`,
        ).toBe(true);
      }
    }
  });

  it('dark theme: every derived --cr-color-surface-N stays >= WCAG AA (4.5:1) against foreground text', () => {
    // Dark theme tints --cr-color-surface-N toward surface-tint per elevation
    // tier (build.mjs's appendDerivedSurfaceTokens, tinted: true) — light
    // theme does not (see the flat-alias test below), per
    // docs/design-research/elevation-surface-case-study.md.
    const core = readJson('core/color.json')['color'] as Record<
      string,
      Record<string, { $value: string }>
    >;
    const alpha = readJson('core/surface-alpha.json')['alpha'] as Record<
      string,
      { $value: string }
    >;
    const alphaSteps = Object.keys(alpha)
      .filter((key) => !key.startsWith('$'))
      .map((key) => Number(alpha[key].$value.replace('%', '')));

    const color = readJson('semantic/dark.json')['color'] as Record<
      string,
      { $value: string }
    >;
    // build.mjs's appendDerivedSurfaceTokens mixes from surface-plain, not
    // surface directly — dark theme's surface-plain equals surface, but
    // testing the actual mixing base keeps this test honest if that ever
    // changes.
    const surfacePlain = hexToRgb(
      resolveColorHex(color['surface-plain'].$value, core),
    );
    const surfaceTint = hexToRgb(
      resolveColorHex(color['surface-tint'].$value, core),
    );
    const foreground = hexToRgb(
      resolveColorHex(color['foreground'].$value, core),
    );

    for (const percent of alphaSteps) {
      const mixed = mixSrgb(surfaceTint, surfacePlain, percent);
      expect(
        contrastRatio(mixed, foreground),
        `semantic/dark.json: surface-plain tinted ${percent}% toward surface-tint should stay >= 4.5:1 against foreground`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('light theme: surface-plain (which --cr-color-surface-N flatly aliases, untinted) stays >= WCAG AA (4.5:1) against foreground text', () => {
    const core = readJson('core/color.json')['color'] as Record<
      string,
      Record<string, { $value: string }>
    >;
    const color = readJson('semantic/light.json')['color'] as Record<
      string,
      { $value: string }
    >;
    const surfacePlain = hexToRgb(
      resolveColorHex(color['surface-plain'].$value, core),
    );
    const foreground = hexToRgb(
      resolveColorHex(color['foreground'].$value, core),
    );

    expect(
      contrastRatio(surfacePlain, foreground),
      'semantic/light.json: surface-plain should stay >= 4.5:1 against foreground',
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('core color primitive groups never collide with a semantic alias name', () => {
    const core = Object.keys(readJson('core/color.json')['color'] as object);
    const semanticNames = collectLeafPaths(readJson('semantic/light.json')).map(
      (p) => p.split('.')[1],
    );
    for (const name of semanticNames) {
      expect(
        core,
        `core/color.json should not define a group named "${name}"`,
      ).not.toContain(name);
    }
  });
});
