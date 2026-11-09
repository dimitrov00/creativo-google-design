import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO_ROOT,
  THEMES,
  declared,
  groundsOf,
  over,
  paint,
  readStylesheet,
  rulesOf,
  themeTokens,
  type CssRule,
  type Grounds,
  type Paint,
} from './accent-spec-support';
import {
  WCAG_AA_LARGE_TEXT,
  contrastRatio,
  oklab,
  oklabDistance,
  parseHex,
  type Srgb,
} from './contrast';
import type { UiTheme } from './theme';

/**
 * THE CHART PALETTE (docs/designs/staff-analytics-v2.md «Colour»): every
 * mark the chart kit paints is a token read through `[data-part]` in
 * libs/ui/charts/src/lib/charts.css. This spec reads that sheet as written
 * and pins, in both themes:
 *
 * 1. every part's paint — the `color-mix(…, N%, transparent)` greys
 *    composited over the page and the card, the hatch measured on its
 *    solid fill — at ≥ 3:1 (SC 1.4.11) against both grounds;
 * 2. every adjacent pair of parts a reader has to tell apart — the
 *    consecutive entries of the time bar's order and of the sources bar's,
 *    plus the comparison grey beside the accent — at ≥ 8 apart in OKLab
 *    (× 100), on both grounds;
 * 3. the hatch's lines at ≥ 3:1 on the fill they cross.
 *
 * The numbers the design asked for (50 / 32 / 18 %) could not clear 1: on
 * white the foreground needs ≥ 46 % to reach 3:1. The ramp is 76 / 62 /
 * 48 %; the README records what each measures.
 */

const CHARTS_CSS = 'libs/ui/charts/src/lib/charts.css';

/** The time bar's parts, baseline first; a reader tells each from its neighbour. */
const TIME_PARTS = [
  'worked',
  'no-show',
  'unmarked',
  'blocked',
  'unsold',
  'other',
] as const;
/** The sources bar's parts. */
const SOURCE_PARTS = ['online', 'staff', 'unknown'] as const;
const EVERY_PART = [...TIME_PARTS, ...SOURCE_PARTS, 'comparison'] as const;
/**
 * The WASHES: a part that is capacity rather than a thing of its own — the
 * free time, the worked hue pale (owner, 2026-11-09). Under 3:1 by design
 * and so never told by colour alone: every chart naming it carries a
 * legend and a table. Still ≥ DISTINCT from its neighbours, and from the
 * solid accent it is a wash of.
 */
const WASHES: readonly string[] = ['unsold'];

/** A readable step between two neighbouring marks, in OKLab × 100. */
const DISTINCT = 8;

const rules = rulesOf(
  readStylesheet(resolve(REPO_ROOT, CHARTS_CSS)),
  CHARTS_CSS,
);

/** The one rule that sets `--ui-chart-paint` for a part, by its hook. */
function paintRule(part: string): CssRule {
  const found = rules.filter(
    (rule) =>
      rule.selector.includes(`[data-part='${part}']`) &&
      declared(rule.body, '--ui-chart-paint') !== undefined,
  );
  if (found.length !== 1) {
    throw new Error(`${CHARTS_CSS} paints '${part}' ${found.length} times`);
  }
  return found[0] as CssRule;
}

function partPaint(part: string, theme: UiTheme): Paint {
  const value = declared(paintRule(part).body, '--ui-chart-paint') as string;
  return paint(value, themeTokens(theme));
}

/** The declared value of one property of one rule, found by its exact selector. */
function declaredOn(selector: string, property: string): string {
  const rule = rules.find((candidate) => candidate.selector === selector);
  if (rule === undefined) throw new Error(`${CHARTS_CSS} has no ${selector}`);
  const value = declared(rule.body, property);
  if (value === undefined) throw new Error(`${selector} sets no ${property}`);
  return value;
}

type Measured = {
  readonly part: string;
  readonly onPage: Srgb;
  readonly onSurface: Srgb;
  readonly pageRatio: number;
  readonly surfaceRatio: number;
};

function measure(part: string, theme: UiTheme, grounds: Grounds): Measured {
  const top = partPaint(part, theme);
  const onPage = over(top, grounds.page);
  const onSurface = over(top, grounds.surface);
  return {
    part,
    onPage,
    onSurface,
    pageRatio: contrastRatio(onPage, grounds.page),
    surfaceRatio: contrastRatio(onSurface, grounds.surface),
  };
}

const hex = (rgb: Srgb): string =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

describe('oklab', () => {
  it('runs black to white along lightness alone', () => {
    const [black] = oklab([0, 0, 0]);
    const [white, a, b] = oklab([255, 255, 255]);
    expect(black).toBeCloseTo(0, 6);
    expect(white).toBeCloseTo(1, 3);
    expect(a).toBeCloseTo(0, 3);
    expect(b).toBeCloseTo(0, 3);
  });

  it('matches the reference for the accent and is symmetric as a distance', () => {
    const accent = parseHex('#f26b22');
    const [lightness, a, b] = oklab(accent);
    expect(lightness).toBeCloseTo(0.684, 2);
    expect(a).toBeGreaterThan(0); // towards red
    expect(b).toBeGreaterThan(0); // towards yellow
    expect(oklabDistance(accent, parseHex('#c62828'))).toBeCloseTo(
      oklabDistance(parseHex('#c62828'), accent),
      10,
    );
    expect(oklabDistance(accent, accent)).toBe(0);
  });
});

describe('the chart palette', () => {
  it('paints every part of the vocabulary exactly once', () => {
    for (const part of EVERY_PART) expect(paintRule(part)).toBeDefined();
  });

  for (const theme of THEMES) {
    describe(theme, () => {
      const grounds = groundsOf(theme);
      const measured = new Map<string, Measured>(
        EVERY_PART.map((part) => [part, measure(part, theme, grounds)]),
      );
      const at = (part: string): Measured => measured.get(part) as Measured;

      it('clears 3:1 on the page and on the card for every part', () => {
        for (const part of EVERY_PART) {
          if (WASHES.includes(part)) continue;
          const { pageRatio, surfaceRatio, onPage } = at(part);
          expect(
            pageRatio,
            `${part} ${hex(onPage)} on the page`,
          ).toBeGreaterThanOrEqual(WCAG_AA_LARGE_TEXT);
          expect(surfaceRatio, `${part} on the card`).toBeGreaterThanOrEqual(
            WCAG_AA_LARGE_TEXT,
          );
        }
      });

      it('tells every adjacent pair of the time bar and the sources bar apart, and the comparison from the accent', () => {
        const consecutive = (
          parts: readonly string[],
        ): readonly (readonly [string, string])[] =>
          parts
            .slice(1)
            .map((part, i) => [parts.at(i) as string, part] as const);
        const pairs: readonly (readonly [string, string])[] = [
          ...consecutive(TIME_PARTS),
          ...consecutive(SOURCE_PARTS),
          ['comparison', 'worked'],
          // A wash is told from the solid it is a wash of.
          ...WASHES.map((wash) => [wash, 'worked'] as const),
        ];
        for (const [a, b] of pairs) {
          expect(
            oklabDistance(at(a).onPage, at(b).onPage),
            `${a} · ${b} on the page`,
          ).toBeGreaterThanOrEqual(DISTINCT);
          expect(
            oklabDistance(at(a).onSurface, at(b).onSurface),
            `${a} · ${b} on the card`,
          ).toBeGreaterThanOrEqual(DISTINCT);
        }
      });

      it('hatches the unmarked part in the surface over the warning fill, ≥ 3:1', () => {
        const tokens = themeTokens(theme);
        const fill = paint(
          declaredOn('.ui-chart-hatch__ground', 'fill'),
          tokens,
        );
        const line = paint(
          declaredOn('.ui-chart-hatch__line', 'stroke'),
          tokens,
        );
        expect(fill.alpha).toBe(1);
        expect(line.alpha).toBe(1);
        expect(fill.rgb).toEqual(partPaint('unmarked', theme).rgb);
        expect(contrastRatio(line.rgb, fill.rgb)).toBeGreaterThanOrEqual(
          WCAG_AA_LARGE_TEXT,
        );
      });

      it('shares one paint between the parts the design pairs', () => {
        expect(at('online').onPage).toEqual(at('worked').onPage);
        expect(at('unknown').onPage).toEqual(at('other').onPage);
        expect(at('comparison').onPage).toEqual(at('other').onPage);
      });

      it('is the ramp the README records', () => {
        const rounded = (ratio: number): number =>
          Math.round(ratio * 100) / 100;
        const recorded: readonly (readonly [string, number, number])[] =
          theme === 'light'
            ? [
                ['blocked', 8.74, 8.74],
                ['staff', 5.25, 5.25],
                ['other', 3.31, 3.31],
              ]
            : [
                ['blocked', 10.14, 9.2],
                ['staff', 6.83, 6.5],
                ['other', 4.35, 4.4],
              ];
        for (const [part, page, surface] of recorded) {
          expect(rounded(at(part).pageRatio), `${part} page`).toBe(page);
          expect(rounded(at(part).surfaceRatio), `${part} card`).toBe(surface);
        }
      });
    });
  }
});
