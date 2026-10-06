import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LAW_ROOTS,
  REPO_ROOT,
  THEMES,
  THEME_FILES,
  accentRung,
  declared,
  foldSelector,
  groundsOf,
  isDisplayType,
  lawRules,
  lawSources,
  lawStylesheets,
  lengthPx,
  literalsOf,
  lookup,
  opaque,
  openingTags,
  paint,
  percentage,
  themeTokens,
  typeRole,
  type CssRule,
  type TemplateTag,
} from './accent-spec-support';
import {
  WCAG_AA_LARGE_TEXT,
  WCAG_AA_TEXT,
  composite,
  contrastRatio,
  type Srgb,
} from './contrast';

/**
 * THE ACCENT LAW (2026-09-29; client card revision 3 §1): the owner asked
 * for the main accent in place of its darker, reddish cut.
 *
 *   One orange. Colour is a shape; words are ink.
 *
 * 1. Everything you SEE as colour (a fill, a wash, a ring, a track, a dot,
 *    a disc, a glyph) is `--sys-color-accent`, the same value in both
 *    themes. There is no darker or lighter cut of it.
 * 2. Words are ink: primary, or secondary where they are quiet. A small
 *    word is never tinted; it takes an orange THING beside it.
 * 3. A DISPLAY FIGURE may itself be the accent: 24px and over, or 18.66px
 *    at weight 700 and over. On white or an elevated surface in light; on
 *    any opaque surface in dark. Never on a grey segment, a fill or a wash.
 * 4. On the SOLID accent: white marks and white display figures only.
 * 5. One slab per page (guarded by each page's own spec, where a page is).
 *
 * These cases read the tree as it is written: every stylesheet and every
 * template under the DS, the features and the two apps, their comments
 * stripped. The two recorded tables (`ACCENT_INK_ALLOWED`,
 * `ON_ACCENT_ALLOWED`) are the law's only exceptions; a NEW rule of either
 * kind fails until it is added to its table WITH a reason.
 *
 * Out of reach, by construction: an ink a component takes through its own
 * hook (`--ui-avatar-ink: var(--sys-color-accent)`). The component's spec
 * holds what the hook paints.
 */

/** The AA floor plus a margin, so a renderer's rounding cannot tip a word under 4.5. */
const FLOOR = 4.6;

const at = (path: string): string => resolve(REPO_ROOT, path);

const BUTTON = 'libs/ui/controls/src/lib/button/button.css';
const BADGE = 'libs/ui/controls/src/lib/badge/badge.css';
const CHIP = 'libs/ui/controls/src/lib/chip/chip.css';
const DATE_TILE = 'libs/ui/patterns/src/lib/date-tile/date-tile.css';
const DATE_BADGE = 'libs/ui/patterns/src/lib/date-badge/date-badge.css';
const MODIFIERS = 'libs/ui/modifiers/modifiers.css';
const SHEET_PILL =
  'libs/features/staff/dashboard/src/lib/shared/staff-sheet-pill.css';

// ── 1 · The label inks have no readers, and are not declared ──────────

describe('1 · the label cuts of the accent', () => {
  /** The files that READ a token (`var(--name`), the theme files' own declarations left out. */
  const readersOf = (token: string): string[] => [
    ...new Set(
      lawStylesheets()
        .filter(({ file }) => !THEME_FILES.includes(file))
        .filter(({ css }) => css.includes(`var(${token}`))
        .map(({ file }) => file),
    ),
  ];

  it('reads the four roots the law binds', () => {
    expect(LAW_ROOTS).toEqual([
      'libs/ui',
      'libs/features',
      'apps/web/src',
      'apps/showcase/src',
    ]);
    // Enough of the tree was found to mean something.
    expect(lawStylesheets().length).toBeGreaterThan(100);
  });

  it('no stylesheet reads --sys-color-promo-label', () => {
    expect(readersOf('--sys-color-promo-label')).toEqual([]);
  });

  it('no stylesheet reads --sys-color-on-promo', () => {
    expect(readersOf('--sys-color-on-promo')).toEqual([]);
  });

  it('no stylesheet reads --sys-color-accent-label, and neither theme declares it', () => {
    // §1.4, owner question Q1, answered for the orange (2026-10-06): the
    // date badge and the staff week strip moved to the law's own forms
    // (accent-label.spec.ts holds them), and the darker cut is gone.
    expect(readersOf('--sys-color-accent-label')).toEqual([]);
    for (const theme of THEMES) {
      expect(themeTokens(theme).has('--sys-color-accent-label')).toBe(false);
    }
  });

  it('no template and no component names a label cut either', () => {
    const named = lawSources()
      .filter(({ file }) => !file.endsWith('.css'))
      .filter(({ text }) =>
        /var\(--sys-color-(?:accent-label|promo-label|on-promo)/.test(text),
      )
      .map(({ file }) => file);
    expect(named).toEqual([]);
  });
});

// ── 2 · Where the accent may stand as a mark or a display figure ──────

describe.each(THEMES)('2 · the accent as a mark, %s theme', (theme) => {
  const tokens = themeTokens(theme);
  const accent = opaque('--sys-color-accent', tokens);
  const grounds = groundsOf(theme);

  it('is one orange: the same value in both themes, and the promo is its alias', () => {
    expect(lookup('--sys-color-accent', tokens)).toBe('#f26b22');
    expect(lookup('--sys-color-promo', tokens)).toBe('var(--sys-color-accent)');
  });

  it.each([
    ['the page', grounds.page],
    ['a card or the sheet', grounds.surface],
    ['an elevated card', grounds.elevated],
  ] as const)(`reads at ${WCAG_AA_LARGE_TEXT}:1 on %s`, (_, ground) => {
    expect(contrastRatio(accent, ground)).toBeGreaterThanOrEqual(
      WCAG_AA_LARGE_TEXT,
    );
  });

  if (theme === 'light') {
    it('does NOT on the muted card or a list group’s segment: the exclusion is a recorded fact', () => {
      // 2.84:1 on #f7f7f7. A ring, a bar or a display figure stands on a
      // white or elevated card; a glyph in a grey segment sits on a white
      // disc.
      expect(contrastRatio(accent, grounds.segment)).toBeLessThan(
        WCAG_AA_LARGE_TEXT,
      );
    });

    it('is never small text: under 4.5:1 on every light ground', () => {
      for (const ground of Object.values(grounds) as Srgb[]) {
        expect(contrastRatio(accent, ground)).toBeLessThan(WCAG_AA_TEXT);
      }
    });
  } else {
    it('reads at 3:1 on the segment too: in dark every opaque surface carries it', () => {
      expect(contrastRatio(accent, grounds.segment)).toBeGreaterThanOrEqual(
        WCAG_AA_LARGE_TEXT,
      );
    });
  }
});

// ── 3 · Ink on every accent wash ──────────────────────────────────────

/**
 * The washes words are printed on, each read from the rule (or the token)
 * that paints it. A new wash under words joins this list, and its
 * stylesheet the test target's inputs in project.json.
 */
const WASHES: Readonly<Record<string, (theme: 'light' | 'dark') => number>> = {
  'the bordered button at rest': (theme) =>
    accentRung(at(BUTTON), ".ui-button[data-button-style='bordered']", theme),
  'the bordered button under the pointer': (theme) =>
    accentRung(
      at(BUTTON),
      ".ui-button[data-button-style='bordered']:hover:not(:disabled)",
      theme,
    ),
  'the bordered button pressed': (theme) =>
    accentRung(
      at(BUTTON),
      ".ui-button[data-button-style='bordered']:active:not(:disabled)",
      theme,
    ),
  'the bordered button selected': (theme) =>
    accentRung(
      at(BUTTON),
      ".ui-button[data-button-style='bordered'][data-selected]",
      theme,
    ),
  'the upcoming date tile': (theme) =>
    accentRung(at(DATE_TILE), ".ui-date-tile[data-tone='upcoming']", theme),
  'the accent capsule': (theme) =>
    accentRung(at(BADGE), ".ui-badge[data-tone='accent']", theme),
  'the tinted chip, selected': (theme) =>
    accentRung(at(CHIP), ".ui-chip[data-tint='accent'][data-selected]", theme),
  'the staff sheet’s open pill': (theme) =>
    accentRung(
      at(SHEET_PILL),
      ".staff-sheet__pill[aria-expanded='true'], .staff-sheet__pill:not([aria-expanded]):focus-within",
      theme,
    ),
  '--sys-alpha-tint': (theme) =>
    percentage('var(--sys-alpha-tint)', themeTokens(theme)),
  '--sys-alpha-segment-selected': (theme) =>
    percentage('var(--sys-alpha-segment-selected)', themeTokens(theme)),
};

describe.each(THEMES)('3 · ink on the accent’s washes, %s theme', (theme) => {
  const tokens = themeTokens(theme);
  const accent = opaque('--sys-color-accent', tokens);
  const ink = opaque('--sys-color-foreground', tokens);
  const grounds = Object.entries(groundsOf(theme)) as [string, Srgb][];

  it.each(Object.entries(WASHES))(
    `the primary ink reads at ${FLOOR}:1 on %s, over every ground`,
    (_, rung) => {
      const share = rung(theme);
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThan(0.5);
      for (const [, ground] of grounds) {
        expect(
          contrastRatio(ink, composite(accent, share, ground)),
        ).toBeGreaterThanOrEqual(FLOOR);
      }
    },
  );

  it('with room to spare: the worst pairing is far over the floor, so a wash is free to be what looks right', () => {
    const worst = Math.min(
      ...Object.values(WASHES).flatMap((rung) =>
        grounds.map(([, ground]) =>
          contrastRatio(ink, composite(accent, rung(theme), ground)),
        ),
      ),
    );
    // 14.51:1 in light (18% over a segment), 9.72:1 in dark (20% over an
    // elevated card).
    expect(worst).toBeGreaterThanOrEqual(theme === 'light' ? 14.5 : 9.7);
  });

  it('the accent itself fails as a word on its own washes: why the label is ink', () => {
    if (theme !== 'light') return;
    for (const rung of Object.values(WASHES)) {
      for (const [, ground] of grounds) {
        expect(
          contrastRatio(accent, composite(accent, rung(theme), ground)),
        ).toBeLessThan(WCAG_AA_LARGE_TEXT);
      }
    }
  });

  it(`the upcoming date tile’s word, in the fill’s secondary ink, reads at ${FLOOR}:1 on its wash`, () => {
    const word = opaque('--sys-color-secondary-label-on-fill', tokens);
    const share = accentRung(
      at(DATE_TILE),
      ".ui-date-tile[data-tone='upcoming']",
      theme,
    );
    for (const [, ground] of grounds) {
      expect(
        contrastRatio(word, composite(accent, share, ground)),
      ).toBeGreaterThanOrEqual(FLOOR);
    }
  });
});

describe('3 · the washes, read from their rules', () => {
  it('keeps the bordered style’s identity: 12% at rest, deeper when pressed, the press mirroring the hover', () => {
    const washes = new Map(Object.entries(WASHES));
    const rung = (name: string): number => washes.get(name)?.('light') ?? NaN;
    expect(rung('the bordered button at rest')).toBe(0.12);
    expect(rung('the bordered button pressed')).toBe(
      rung('the bordered button under the pointer'),
    );
    expect(rung('the bordered button selected')).toBeGreaterThan(
      rung('the bordered button at rest'),
    );
  });

  it('prints those washes in ink, never in the accent', () => {
    const ink = (file: string, selector: string): string | undefined =>
      declared(
        lawRules().find(
          (rule) =>
            rule.file === file && rule.selector === foldSelector(selector),
        )?.body ?? '',
        'color',
      );
    expect(ink(BUTTON, ".ui-button[data-button-style='bordered']")).toBe(
      'var(--sys-color-foreground)',
    );
    expect(ink(CHIP, ".ui-chip[data-tint='accent'][data-selected]")).toBe(
      'var(--sys-color-foreground)',
    );
    expect(
      ink(DATE_TILE, ".ui-date-tile[data-tone='upcoming'] .ui-date-tile__day"),
    ).toBe('var(--sys-color-foreground)');
    expect(ink(DATE_TILE, ".ui-date-tile[data-tone='upcoming']")).toBe(
      'var(--sys-color-secondary-label-on-fill)',
    );
  });
});

// ── 4 · White on the solid accent: marks and display figures ──────────

describe.each(THEMES)('4 · white on the solid accent, %s theme', (theme) => {
  const tokens = themeTokens(theme);

  it('reads as a mark or a display figure (3:1), and never as small words (under 4.5:1)', () => {
    const white = opaque('--sys-color-on-accent', tokens);
    const accent = paint(lookup('--sys-color-accent', tokens), tokens);
    expect(accent.alpha).toBe(1);
    const ratio = contrastRatio(white, accent.rgb);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_LARGE_TEXT);
    expect(ratio).toBeLessThan(WCAG_AA_TEXT);
  });
});

// ── 5 · The accent as `color` ─────────────────────────────────────────

interface Allowed {
  readonly file: string;
  readonly selector: string;
  readonly reason: string;
}

const where = (rule: Pick<CssRule, 'file' | 'selector'>): string =>
  `${rule.file} · ${rule.selector}`;

const paintsWith = (rule: CssRule, token: RegExp): boolean =>
  token.test(declared(rule.body, 'color') ?? '');

/**
 * A GLYPH selector: the rule's last compound names an icon or a part that
 * is a mark by its own name. State and structure after the name
 * (`:first-child`, `[data-selected]`, `:not(…)`) do not change what it is.
 */
function endsInGlyph(selector: string): boolean {
  return selector.split(',').every((one) => {
    const last =
      one
        .trim()
        .split(/[\s>+~]+/)
        .pop() ?? '';
    // The compound's NAME: what stands before its first state or
    // attribute (`.ui-icon:first-child` → `.ui-icon`).
    const name = last.slice(0, last.search(/[:[]|$/));
    return (
      name === '.ui-icon' ||
      name.endsWith('.ui-icon') ||
      /__(?:glyph|check|mark)$/.test(name) ||
      last.includes('[data-icon-only]')
    );
  });
}

/** The rule sets a display type in its own body: a role, or a size with its weight. */
function setsDisplayType(rule: CssRule): boolean {
  const tokens = themeTokens('light');
  const role = /var\((--sys-font-[\w-]+)\)/.exec(
    declared(rule.body, 'font') ?? '',
  )?.[1];
  const base = role ? typeRole(lookup(role, tokens)) : null;
  const px = lengthPx(declared(rule.body, 'font-size') ?? '') ?? base?.px ?? 0;
  const weight = Number(declared(rule.body, 'font-weight') ?? base?.weight);
  if (px === 0) return false;
  return isDisplayType({ px, weight: Number.isFinite(weight) ? weight : 400 });
}

/**
 * THE RECORDED EXCEPTIONS: rules that paint the accent as `color`, whose
 * selector does not end in a glyph's name and whose body sets no display
 * type. Each is a glyph all the same, or a display figure whose size its
 * base rule sets, and says why.
 */
const ACCENT_INK_ALLOWED: readonly Allowed[] = [
  {
    file: DATE_BADGE,
    selector: ".ui-date-badge[data-today]:not([data-state='selected'])",
    reason:
      'today in a date picker: the badge’s own 20px number (`--sys-font-title3`, set once in its base rule) at weight 700, a display figure; accent-label.spec.ts holds the size and the grounds',
  },
  {
    file: MODIFIERS,
    selector: "[data-foreground-style='accent'][data-foreground-style]",
    reason:
      'the foreground modifier: whatever wears it is held by guard 6 (a ui-icon, or a display font)',
  },
  {
    file: MODIFIERS,
    selector: "[data-foreground-style='promo'][data-foreground-style]",
    reason: 'the same modifier in the promo hue; guard 6 holds its wearers',
  },
  {
    file: BUTTON,
    selector: ".ui-button[data-button-style='glass'][data-selected]",
    reason:
      'an icon-only toggle over media: the glyph is the button’s only content, `aria-pressed` and the wash carry the state',
  },
  {
    file: 'libs/features/client/appointments/src/lib/client-appointments/client-appointments.css',
    selector: '.appointments-views__option[data-selected]',
    reason:
      'the list / calendar view toggle: an icon-only option, its glyph on the white thumb',
  },
  {
    file: 'libs/features/marketing/landing/src/lib/sections/services/service-tile.component.ts',
    selector: '.cr-services__bundle-chip',
    reason:
      'the bundle tell on a service tile: an icon-only disc, the glyph on a solid surface',
  },
  {
    file: 'apps/showcase/src/app/pages/controls/async-image/async-image.page.css',
    selector: '.async-image__placeholder',
    reason: 'a showcase placeholder: it holds one glyph and no words',
  },
];

const ACCENT = /var\(\s*--sys-color-(?:accent|promo)\s*[,)]/;

describe('5 · the accent as `color`', () => {
  const painted = lawRules().filter((rule) => paintsWith(rule, ACCENT));
  const isAllowed = (rule: CssRule): boolean =>
    ACCENT_INK_ALLOWED.some(
      (row) => row.file === rule.file && row.selector === rule.selector,
    );

  it('finds the rules it is about', () => {
    expect(painted.length).toBeGreaterThan(5);
  });

  it('every rule that paints the accent as `color` is a glyph, a display figure, or recorded with its reason', () => {
    const outlaws = painted
      .filter(
        (rule) =>
          !endsInGlyph(rule.selector) &&
          !setsDisplayType(rule) &&
          !isAllowed(rule),
      )
      .map((rule) => `${where(rule)} (line ${rule.line})`);
    expect(outlaws).toEqual([]);
  });

  it('no cut of the accent is mixed into an ink', () => {
    const mixed = lawRules()
      .filter((rule) =>
        /color-mix\([^;]*--sys-color-(?:accent|promo)\b/.test(
          declared(rule.body, 'color') ?? '',
        ),
      )
      .map(where);
    expect(mixed).toEqual([]);
  });

  it('keeps the table true: every row names a rule the tree still holds, and says why', () => {
    for (const row of ACCENT_INK_ALLOWED) {
      expect(row.reason.length).toBeGreaterThan(20);
      expect(painted.map(where)).toContain(where(row));
    }
  });

  it('keeps the table short: a row a glyph selector or a display type already clears is removed', () => {
    const needless = painted
      .filter(isAllowed)
      .filter((rule) => endsInGlyph(rule.selector) || setsDisplayType(rule))
      .map(where);
    expect(needless).toEqual([]);
  });

  it('reads a glyph by the END of its selector, whatever state follows the name', () => {
    for (const glyph of [
      '.staff-sheet__pill[aria-expanded="true"] .ui-icon',
      ".ui-chip[data-tint='accent'][data-selected] > .ui-icon:first-child",
      ".ui-badge[data-tone='accent']:not([data-on-media]) .ui-badge__glyph",
      '.booking-pick__check',
      '.ui-medal__mark[data-state="earned"]',
      '.a .ui-icon, .b:focus-within .ui-icon',
    ]) {
      expect(endsInGlyph(glyph)).toBe(true);
    }
    for (const words of [
      '.ui-coupon-card__value',
      '.ui-icon + .label',
      '.my-ui-icon',
      '.a .ui-icon, .b .title',
      '.ui-date-tile[data-tone="upcoming"]',
    ]) {
      expect(endsInGlyph(words)).toBe(false);
    }
  });

  it('reads a display type from the rule’s own font: 24px, or 18.66px in bold', () => {
    const rule = (body: string): CssRule => ({
      file: 'x.css',
      selector: '.x',
      body,
      line: 1,
    });
    const display = (body: string): boolean => setsDisplayType(rule(body));
    expect(display('font: var(--sys-font-title2); color: x;')).toBe(true);
    expect(display('font: var(--sys-font-title);')).toBe(true);
    expect(display('font: var(--sys-font-largeTitle);')).toBe(true);
    expect(display('font: var(--sys-font-extraLargeTitle);')).toBe(true);
    // title3 is 20px at 600: a display figure only in bold.
    expect(display('font: var(--sys-font-title3);')).toBe(false);
    expect(display('font: var(--sys-font-title3); font-weight: 700;')).toBe(
      true,
    );
    expect(display('font: var(--sys-font-headline); font-weight: 700;')).toBe(
      false,
    );
    expect(display('font: var(--sys-font-callout);')).toBe(false);
    expect(display('font-size: 1.5rem;')).toBe(true);
    expect(display('color: var(--sys-color-accent);')).toBe(false);
  });
});

// ── 6 · Templates: the foreground style's wearers ─────────────────────

/** The type roles that are display figures as they are. */
const DISPLAY_ROLES: ReadonlySet<string> = new Set([
  'title2',
  'title',
  'largeTitle',
  'extraLargeTitle',
  'display',
]);

function wearsDisplayType(tag: TemplateTag): boolean {
  const fonts = literalsOf(tag, 'uiFont');
  if (fonts.length === 0) return false;
  const weights = literalsOf(tag, 'uiWeight');
  const bold = weights.length > 0 && weights.every((w) => w === 'bold');
  return fonts.every(
    (font) => DISPLAY_ROLES.has(font) || (font === 'title3' && bold),
  );
}

function tintedTags(text: string, file: string): TemplateTag[] {
  return openingTags(text, file).filter((tag) =>
    literalsOf(tag, 'uiForegroundStyle').some(
      (style) => style === 'accent' || style === 'promo',
    ),
  );
}

describe('6 · `uiForegroundStyle` accent and promo, in every template', () => {
  const templates = lawSources().filter(
    ({ file, text }) =>
      !file.endsWith('.css') && text.includes('uiForegroundStyle'),
  );

  it('finds the templates it is about', () => {
    expect(templates.length).toBeGreaterThan(20);
    expect(
      templates.flatMap(({ file, text }) => tintedTags(text, file)).length,
    ).toBeGreaterThan(5);
  });

  it('is worn by a ui-icon or by a display figure, written or bound, and by nothing else', () => {
    const outlaws = templates
      .flatMap(({ file, text }) => tintedTags(text, file))
      .filter((tag) => tag.name !== 'ui-icon' && !wearsDisplayType(tag))
      .map(
        (tag) =>
          `${tag.file}:${tag.line} <${tag.name}> ${literalsOf(tag, 'uiFont').join('|') || 'no uiFont'}`,
      );
    expect(outlaws).toEqual([]);
  });

  it('reads an attribute and a literal inside a bound expression alike', () => {
    const tags = (template: string): string[] =>
      tintedTags(template, 'x.html')
        .filter((tag) => tag.name !== 'ui-icon' && !wearsDisplayType(tag))
        .map((tag) => tag.name);

    expect(tags('<span uiForegroundStyle="accent">x</span>')).toEqual(['span']);
    expect(
      tags(
        `<span [uiForegroundStyle]="row.applied ? 'promo' : 'secondary'">x</span>`,
      ),
    ).toEqual(['span']);
    expect(
      tags(
        '<p uiText uiFont="footnote" uiForegroundStyle="promo" class="a > b">x</p>',
      ),
    ).toEqual(['p']);
    expect(
      tags(
        '<strong uiText uiFont="title3" uiForegroundStyle="accent">x</strong>',
      ),
    ).toEqual(['strong']);

    // The wearers the law names.
    expect(tags('<ui-icon uiName="a.b" uiForegroundStyle="accent" />')).toEqual(
      [],
    );
    expect(
      tags(
        `<ui-icon uiName="a.b" [uiForegroundStyle]="on ? 'accent' : 'secondary'" />`,
      ),
    ).toEqual([]);
    expect(
      tags(
        '<span uiText uiFont="title2" uiForegroundStyle="promo">−20 %</span>',
      ),
    ).toEqual([]);
    expect(
      tags(
        '<span uiText uiFont="title3" uiWeight="bold" uiForegroundStyle="accent">x</span>',
      ),
    ).toEqual([]);
    // Ink is free, and a comment is not a template.
    expect(tags('<span uiForegroundStyle="primary">x</span>')).toEqual([]);
    expect(tags('<!-- <span uiForegroundStyle="accent">x</span> -->')).toEqual(
      [],
    );
  });
});

// ── 7 · White on the accent ───────────────────────────────────────────

/**
 * THE RECORDED TABLE: every rule that inks in `--sys-color-on-accent`. On
 * the solid accent white is a MARK or a DISPLAY FIGURE (3.04:1), never
 * small words. The law's three known breaches (the schedule's now marks,
 * §1.4, owner question Q1) left the table on 2026-10-06 when the owner
 * answered for the orange: they are the primary fill now, and the week
 * strip's chosen today takes the near-black `--sys-color-on-accent-ink`
 * (accent-label.spec.ts holds both). The table holds no breach.
 */
const ON_ACCENT_ALLOWED: readonly Allowed[] = [
  // Marks: a glyph or a check on a solid disc.
  {
    file: 'libs/ui/patterns/src/lib/medal/medal.css',
    selector: ".ui-medal[data-state='earned'] .ui-medal__disc",
    reason: 'the earned medal’s face: a glyph on the solid disc, a mark',
  },
  {
    // §3.8's fourth state draws its face "as earned", in a full ring.
    file: 'libs/ui/patterns/src/lib/medal/medal.css',
    selector: ".ui-medal[data-state='complete'] .ui-medal__disc",
    reason: 'the complete medal’s face: a glyph on the solid disc, a mark',
  },
  {
    file: 'libs/ui/patterns/src/lib/gauge/gauge.css',
    selector: '.ui-gauge__slot[data-filled] .ui-gauge__disc',
    reason: 'a filled stamp: a glyph on the solid disc, a mark',
  },
  {
    file: 'libs/ui/patterns/src/lib/gauge/gauge.css',
    selector: '.ui-gauge__check',
    reason: 'the check on a level passed: a mark',
  },
  {
    file: 'libs/ui/controls/src/lib/count-stepper/count-stepper.css',
    selector: '.ui-count-stepper__add[data-added]',
    reason: 'the added state’s check on the solid disc: a mark',
  },
  {
    file: 'libs/ui/controls/src/lib/map/map.css',
    selector: '.ui-map__indicator[data-active]',
    reason: 'the active off-screen indicator: a glyph on the solid disc',
  },
  {
    file: 'libs/ui/controls/src/lib/map/map.css',
    selector: '.ui-map__pin[data-active] .ui-map__pin-icon',
    reason: 'the active pin’s glyph: a mark',
  },
  {
    file: 'libs/features/shared/catalog/src/lib/gallery/showcase-gallery.component.css',
    selector: '.showcase-gallery__check',
    reason: 'the chosen frame’s check: a mark',
  },
  {
    file: 'libs/features/shared/catalog/src/lib/service-card/service-card.component.css',
    selector: '.cr-service-card__check[data-selected]',
    reason: 'the chosen service’s check: a mark',
  },
  {
    file: 'libs/features/client/appointments/src/lib/client-appointments/client-appointments.css',
    selector: '.appointments__add.ui-button',
    reason: 'the round add button: a plus on the solid disc, a mark',
  },
  {
    file: 'libs/ui/patterns/src/lib/pass-card/pass-card.css',
    selector: '.ui-pass-card__mark',
    reason: 'the shop’s logo on the pass’s field: a mark',
  },
  // Display figures.
  {
    file: DATE_BADGE,
    selector: ".ui-date-badge[data-state='selected']",
    reason:
      'the chosen day of a date picker: a bold 20px number on the solid disc, a display figure (the badge draws at 20px in every grid)',
  },
  {
    file: 'libs/ui/patterns/src/lib/coupon-card/occasion-band.css',
    selector: '.ui-occasion-band__title',
    reason: 'the occasion’s title, title2 24/700: a display figure',
  },
  {
    file: 'libs/ui/patterns/src/lib/pass-card/pass-card.css',
    selector: '.ui-pass-card__figure',
    reason: 'the pass’s balance, largeTitle 36/800: a display figure',
  },
  {
    file: 'libs/ui/patterns/src/lib/pass-card/pass-card.css',
    selector: '.ui-pass-card__unit',
    reason: 'the balance’s unit, title3 at weight 700: a display figure',
  },
];

const ON_ACCENT = /var\(\s*--sys-color-on-accent\s*[,)]/;

describe('7 · white on the accent', () => {
  const painted = lawRules().filter((rule) => paintsWith(rule, ON_ACCENT));

  it('finds the rules it is about', () => {
    expect(painted.length).toBeGreaterThan(5);
  });

  it('every rule that inks in --sys-color-on-accent is recorded, with its reason', () => {
    const recorded = ON_ACCENT_ALLOWED.map(where);
    const outlaws = painted
      .filter((rule) => !recorded.includes(where(rule)))
      .map((rule) => `${where(rule)} (line ${rule.line})`);
    expect(outlaws).toEqual([]);
  });

  it('keeps the table true: a row names a rule its stylesheet still holds', () => {
    // A stylesheet that inks nothing in the on-accent white yet (a
    // skeleton whose drawing has not landed) holds no row to account.
    const inking = new Set(painted.map((rule) => rule.file));
    const stale = ON_ACCENT_ALLOWED.filter((row) => inking.has(row.file))
      .filter((row) => !painted.map(where).includes(where(row)))
      .map(where);
    expect(stale).toEqual([]);
    for (const row of ON_ACCENT_ALLOWED) {
      expect(row.reason.length).toBeGreaterThan(20);
    }
  });

  it('the tinted chip left the table: its selection is a wash under ink', () => {
    expect(ON_ACCENT_ALLOWED.some((row) => row.file === CHIP)).toBe(false);
    expect(painted.some((rule) => rule.file === CHIP)).toBe(false);
  });

  it('holds no breach: the deferred rows left when the owner answered for the orange', () => {
    expect(
      ON_ACCENT_ALLOWED.filter((row) => row.reason.startsWith('DEFERRED')),
    ).toEqual([]);
    // The schedule's three marks and the week strip print nothing white on
    // the solid accent any more (accent-label.spec.ts holds their forms).
    expect(
      painted
        .filter((rule) =>
          rule.file.startsWith('libs/features/staff/dashboard/'),
        )
        .map(where),
    ).toEqual([]);
  });
});
