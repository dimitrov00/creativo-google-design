import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LARGE_BOLD_TEXT_PX,
  REPO_ROOT,
  THEMES,
  THEME_FILES,
  accentRung,
  declared,
  foldSelector,
  groundsOf,
  lawRules,
  lawSources,
  lawStylesheets,
  lookup,
  opaque,
  over,
  paint,
  ruleBody,
  themeTokens,
  typeRole,
  type Paint,
} from './accent-spec-support';
import {
  WCAG_AA_LARGE_TEXT,
  WCAG_AA_TEXT,
  composite,
  contrastRatio,
  type Srgb,
} from './contrast';

/**
 * THE CALENDARS AND THE SCHEDULE'S MARKS UNDER THE ACCENT LAW (2026-10-06).
 *
 * `--sys-color-accent-label` was the accent cut darker for words (#b04100 in
 * light, #fb7735 in dark). The accent law retired it everywhere it was read
 * as a second, reddish orange — one orange; colour is a shape, words are ink
 * (`accent-rule.spec.ts` holds the law) — and kept it alive for three
 * calendar marks the owner had approved, while the schedule's now marks
 * printed small white figures on the solid accent as the law's recorded
 * breaches. The owner answered for the orange (revision 3 §1.4, Q1): the cut
 * is DELETED from both themes, and the five marks moved to forms the law
 * allows. These cases read the real tokens and the real rules and hold each
 * form to its own bar:
 *
 *   1. the chosen day of a date picker: a SOLID accent disc under a white
 *      number, 20px at weight 700 — a display figure (3.04:1 is large
 *      text's bar), which is why no grid may draw a badge smaller
 *   2. today in a date picker: the accent itself as a 20/700 number — a
 *      display figure on the page, a card, a sheet or a menu, never on a
 *      light grouped segment (2.84:1)
 *   3. today on the staff week strip: a bold number in ink with an accent
 *      dot under it; a chosen today: the accent disc with the NEAR-BLACK
 *      on-accent ink (6.16:1), the one small figure the system prints on
 *      the solid accent
 *   4. today's column head of the time grid: the accent's wash under a
 *      bold number in ink
 *   5. the now pill of the time grid and the now label of the timeline:
 *      the primary fill with the on-primary ink, beside the accent line
 *
 * Bare ink is held to 4.6:1: the AA floor plus a margin, so a rounding
 * difference in a renderer cannot tip a number back under 4.5.
 */
const FLOOR = 4.6;

const at = (path: string): string => resolve(REPO_ROOT, path);

const DATE_BADGE = 'libs/ui/patterns/src/lib/date-badge/date-badge.css';
const WEEK_STRIP =
  'libs/features/staff/dashboard/src/lib/staff-dashboard/staff-dashboard.chrome.css';
const TIME_GRID =
  'libs/features/staff/dashboard/src/lib/time-grid/staff-time-grid.css';
const TIME_GRID_STATE =
  'libs/features/staff/dashboard/src/lib/time-grid/staff-time-grid.state.css';
const TIMELINE =
  'libs/features/staff/dashboard/src/lib/timeline/staff-timeline.css';
const dateBadgeCss = at(DATE_BADGE);
const weekStripCss = at(WEEK_STRIP);
const dateTileCss = at('libs/ui/patterns/src/lib/date-tile/date-tile.css');
const gaugeCss = at('libs/ui/patterns/src/lib/gauge/gauge.css');
const couponCardCss = at(
  'libs/ui/patterns/src/lib/coupon-card/coupon-card.css',
);
const unitFieldCss = at('libs/ui/controls/src/lib/unit-field/unit-field.css');

const CHOSEN_DAY = ".ui-date-badge[data-state='selected']";
const PICKER_TODAY = ".ui-date-badge[data-today]:not([data-state='selected'])";
const STRIP_TODAY = '.staff-weeks__day[data-today] .staff-weeks__number';
const STRIP_CHOSEN_TODAY =
  '.staff-weeks__day[data-selected][data-today] .staff-weeks__number';
const GRID_TODAY =
  '.staff-grid__column-head[data-today] .staff-grid__column-day';

/** The opaque grounds a calendar or a schedule is drawn on, by name. */
function grounds(theme: 'light' | 'dark'): Readonly<Record<string, Srgb>> {
  const tokens = themeTokens(theme);
  const { page, surface, segment, elevated } = groundsOf(theme);
  return {
    page,
    'card or sheet surface': surface,
    'grouped segment': segment,
    'elevated card': elevated,
    'menu material over the page': over(
      paint(lookup('--sys-material-fill', tokens), tokens),
      page,
    ),
  };
}

/** Every rule in the tree whose `color` reads the token, as `file · selector`. */
function inkedWith(token: string): string[] {
  // The token whole: `--sys-color-on-accent` is not `--sys-color-on-accent-ink`.
  // eslint-disable-next-line security/detect-non-literal-regexp -- a token name these specs spell.
  const reads = new RegExp(`var\\(\\s*${token}\\s*[,)]`);
  return lawRules()
    .filter((rule) => reads.test(declared(rule.body, 'color') ?? ''))
    .map((rule) => `${rule.file} · ${rule.selector}`)
    .sort();
}

describe('the label ink is gone', () => {
  it('is declared by neither theme', () => {
    for (const theme of THEMES) {
      expect(themeTokens(theme).has('--sys-color-accent-label')).toBe(false);
    }
    for (const { file, css } of lawStylesheets()) {
      if (THEME_FILES.includes(file)) {
        expect(css).not.toContain('--sys-color-accent-label');
      }
    }
  });

  it('is read by no stylesheet and named by no template', () => {
    const readers = lawStylesheets()
      .filter(({ css }) => css.includes('var(--sys-color-accent-label'))
      .map(({ file }) => file);
    expect(readers).toEqual([]);
    const named = lawSources()
      .filter(({ file }) => !file.endsWith('.css'))
      .filter(({ text }) => text.includes('--sys-color-accent-label'))
      .map(({ file }) => file);
    expect(named).toEqual([]);
  });
});

// ── 1 · The date badge: the chosen day, and today ──────────────────────

describe('the date badge', () => {
  const base = ruleBody(dateBadgeCss, '.ui-date-badge');

  it('draws every day at the picker’s 20px and regular weight: a size, not a hook', () => {
    expect(declared(base, 'font')).toBe('var(--sys-font-title3)');
    // Apple's inline picker: the month rests at 400, which today and the
    // chosen day step up from. Every grid, not the month picker alone.
    expect(declared(base, 'font-weight')).toBe('400');
    const role = typeRole(lookup('--sys-font-title3', themeTokens('light')));
    expect(role?.px).toBeGreaterThanOrEqual(LARGE_BOLD_TEXT_PX);
    // The old `--ui-date-badge-font` hook let a grid draw a month smaller
    // than the chosen day's white number can bear; nothing names it now.
    const hooked = lawStylesheets()
      .filter(({ css }) => css.includes('--ui-date-badge-font'))
      .map(({ file }) => file);
    expect(hooked).toEqual([]);
  });

  describe('the chosen day', () => {
    const body = ruleBody(dateBadgeCss, CHOSEN_DAY);

    it('is a solid accent disc under a white number at weight 700', () => {
      expect(declared(body, 'background')).toBe('var(--sys-color-accent)');
      expect(declared(body, 'color')).toBe('var(--sys-color-on-accent)');
      expect(Number(declared(body, 'font-weight'))).toBeGreaterThanOrEqual(700);
    });

    it.each(THEMES)(
      'reads as large text and nothing smaller on the disc, %s theme: the 20px is load-bearing',
      (theme) => {
        const tokens = themeTokens(theme);
        const ratio = contrastRatio(
          opaque('--sys-color-on-accent', tokens),
          opaque('--sys-color-accent', tokens),
        );
        expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_LARGE_TEXT);
        expect(ratio).toBeLessThan(WCAG_AA_TEXT);
      },
    );

    it('is the only chosen-day rule: a chosen today wears the same disc', () => {
      // `:not(…)` is a negation, not a match: today's own rule names the
      // chosen state only to step aside from it.
      const todayAndChosen = lawRules().filter((rule) => {
        const named = rule.selector.replace(/:not\([^)]*\)/g, '');
        return (
          rule.file === DATE_BADGE &&
          named.includes('[data-today]') &&
          named.includes("[data-state='selected']")
        );
      });
      expect(todayAndChosen).toEqual([]);
    });
  });

  describe('today, not chosen', () => {
    const body = ruleBody(dateBadgeCss, PICKER_TODAY);

    it('is the accent itself as a number at weight 700, with no disc of its own', () => {
      expect(declared(body, 'color')).toBe('var(--sys-color-accent)');
      expect(Number(declared(body, 'font-weight'))).toBeGreaterThanOrEqual(700);
      expect(declared(body, 'background')).toBeUndefined();
    });

    it.each(
      Object.entries(grounds('light')).filter(
        ([name]) => name !== 'grouped segment',
      ),
    )(
      `reads as large text (${WCAG_AA_LARGE_TEXT}:1) on the %s in light`,
      (_, ground) => {
        const accent = opaque('--sys-color-accent', themeTokens('light'));
        expect(contrastRatio(accent, ground)).toBeGreaterThanOrEqual(
          WCAG_AA_LARGE_TEXT,
        );
      },
    );

    it('does NOT on the light grouped segment: a picker never sits in a grey list group', () => {
      const accent = opaque('--sys-color-accent', themeTokens('light'));
      const [, segment] = Object.entries(grounds('light')).find(
        ([name]) => name === 'grouped segment',
      ) as [string, Srgb];
      expect(contrastRatio(accent, segment)).toBeLessThan(WCAG_AA_LARGE_TEXT);
    });

    it.each(Object.entries(grounds('dark')))(
      `reads as large text (${WCAG_AA_LARGE_TEXT}:1) on the %s in dark`,
      (_, ground) => {
        const accent = opaque('--sys-color-accent', themeTokens('dark'));
        expect(contrastRatio(accent, ground)).toBeGreaterThanOrEqual(
          WCAG_AA_LARGE_TEXT,
        );
      },
    );
  });
});

// ── 2 · The staff week strip: a dot for today, dark ink on a chosen today ─

describe('the staff week strip', () => {
  it('draws today as a bold number in ink with an accent dot under it', () => {
    const number = ruleBody(weekStripCss, STRIP_TODAY);
    expect(declared(number, 'color')).toBe('var(--sys-color-foreground)');
    expect(Number(declared(number, 'font-weight'))).toBeGreaterThanOrEqual(700);
    expect(declared(number, 'background')).toBeUndefined();
    const dot = ruleBody(weekStripCss, `${STRIP_TODAY}::after`);
    expect(declared(dot, 'content')).toBe("''");
    expect(declared(dot, 'background')).toBe('var(--sys-color-accent)');
  });

  it.each(THEMES)(
    `the dot is a mark (${WCAG_AA_LARGE_TEXT}:1) on the page, a surface and an elevated card, %s theme`,
    (theme) => {
      const accent = opaque('--sys-color-accent', themeTokens(theme));
      const strip = Object.entries(grounds(theme)).filter(([name]) =>
        ['page', 'card or sheet surface', 'elevated card'].includes(name),
      );
      expect(strip).toHaveLength(3);
      for (const [, ground] of strip) {
        expect(contrastRatio(accent, ground)).toBeGreaterThanOrEqual(
          WCAG_AA_LARGE_TEXT,
        );
      }
    },
  );

  it('draws a chosen today in the near-black on-accent ink, and drops the dot', () => {
    const number = ruleBody(weekStripCss, STRIP_CHOSEN_TODAY);
    expect(declared(number, 'color')).toBe('var(--sys-color-on-accent-ink)');
    const dot = ruleBody(weekStripCss, `${STRIP_CHOSEN_TODAY}::after`);
    expect(declared(dot, 'content')).toBe('none');
  });

  it('the chosen today’s disc is the accent', () => {
    const disc = ruleBody(
      weekStripCss,
      '.staff-weeks__week:has([data-selected][data-today]) .staff-weeks__marker-disc::before',
    );
    expect(declared(disc, 'background')).toBe('var(--sys-color-accent)');
  });

  describe.each(THEMES)('--sys-color-on-accent-ink, %s theme', (theme) => {
    const tokens = themeTokens(theme);

    it(`reads as text (${WCAG_AA_TEXT}:1) on the solid accent — the one small figure the system prints there`, () => {
      expect(
        contrastRatio(
          opaque('--sys-color-on-accent-ink', tokens),
          opaque('--sys-color-accent', tokens),
        ),
      ).toBeGreaterThanOrEqual(FLOOR);
    });

    it('is one value in both themes, as the accent is', () => {
      expect(lookup('--sys-color-on-accent-ink', tokens)).toBe(
        lookup('--sys-color-on-accent-ink', themeTokens('light')),
      );
      expect(lookup('--sys-color-accent', tokens)).toBe(
        lookup('--sys-color-accent', themeTokens('light')),
      );
    });

    if (theme === 'dark') {
      it('is not this theme’s foreground, which would fail on the accent', () => {
        expect(
          contrastRatio(
            opaque('--sys-color-foreground', tokens),
            opaque('--sys-color-accent', tokens),
          ),
        ).toBeLessThan(WCAG_AA_LARGE_TEXT);
      });
    }
  });

  it('the on-accent ink has exactly one reader: the strip’s chosen today', () => {
    expect(inkedWith('--sys-color-on-accent-ink')).toEqual([
      `${WEEK_STRIP} · ${STRIP_CHOSEN_TODAY}`,
    ]);
  });
});

// ── 3 · The schedule: today's column head, the now pill, the now label ─

describe('the schedule’s marks', () => {
  it('today’s column head is the accent’s wash under a bold number in ink', () => {
    const body = ruleBody(at(TIME_GRID), GRID_TODAY);
    expect(declared(body, 'color')).toBe('var(--sys-color-foreground)');
    expect(Number(declared(body, 'font-weight'))).toBeGreaterThanOrEqual(700);
    expect(foldSelector(declared(body, 'background') ?? '')).toBe(
      'color-mix(in srgb, var(--sys-color-accent) var(--sys-alpha-tint), transparent)',
    );
  });

  it.each(THEMES)(
    `the ink reads at ${FLOOR}:1 on that wash over every ground, %s theme`,
    (theme) => {
      const tokens = themeTokens(theme);
      const ink = opaque('--sys-color-foreground', tokens);
      const accent = opaque('--sys-color-accent', tokens);
      const share = accentRung(at(TIME_GRID), GRID_TODAY, theme);
      expect(share).toBeGreaterThan(0);
      for (const ground of Object.values(grounds(theme))) {
        expect(
          contrastRatio(ink, composite(accent, share, ground)),
        ).toBeGreaterThanOrEqual(FLOOR);
      }
    },
  );

  it.each([
    ['the time grid’s now pill', TIME_GRID_STATE, '.staff-grid__now-label'],
    ['the timeline’s now label', TIMELINE, '.staff-timeline__now-label'],
  ] as const)(
    '%s is the primary fill with the on-primary ink: the dock’s form',
    (_, file, selector) => {
      const body = ruleBody(at(file), selector);
      expect(declared(body, 'background')).toBe('var(--sys-color-primary)');
      expect(declared(body, 'color')).toBe('var(--sys-color-on-primary)');
    },
  );

  it.each(THEMES)(
    `the on-primary ink reads at ${FLOOR}:1 on the primary, %s theme`,
    (theme) => {
      const tokens = themeTokens(theme);
      expect(
        contrastRatio(
          opaque('--sys-color-on-primary', tokens),
          opaque('--sys-color-primary', tokens),
        ),
      ).toBeGreaterThanOrEqual(FLOOR);
    },
  );

  it('prints no small white figure on the solid accent any more', () => {
    const onAccent = inkedWith('--sys-color-on-accent').filter((rule) =>
      [WEEK_STRIP, TIME_GRID, TIME_GRID_STATE, TIMELINE].some((file) =>
        rule.startsWith(`${file} ·`),
      ),
    );
    expect(onAccent).toEqual([]);
  });
});

/**
 * THE SECONDARY INK ON A FILL (2026-09-28; both lifts since 2026-10-06). A
 * fill lifts its ground, and in dark the plain secondary ink fell under AA
 * on it — axe on the client card: a past date tile's word and day at 3.70:1
 * on the fill over a grouped segment and 4.38:1 over the sheet, a step node
 * still ahead and a coupon's detail chip the same. A VALUE PILL lifts
 * further: it paints the bordered button's rest fill, the foreground at
 * `--sys-alpha-interactive` (the visit editor's «Времетраене», the admin
 * page's «14 дни»), and there the plain ink read 3.27:1 in dark while a
 * quarter of the way to the foreground still read 4.43 — axe on the admin
 * page. `--sys-color-secondary-label-on-fill` is held to the floor on BOTH
 * lifts over every ground a filled mark or a pill is placed on, and the
 * marks that print words on either are read from their rules.
 */
describe.each(THEMES)(
  '--sys-color-secondary-label-on-fill, %s theme',
  (theme) => {
    const tokens = themeTokens(theme);
    const ink = opaque('--sys-color-secondary-label-on-fill', tokens);
    const fill = paint(lookup('--sys-color-fill', tokens), tokens);
    /** The bordered button's rest fill — what a value pill paints. */
    const pill = paint(
      'color-mix(in srgb, var(--sys-color-foreground) var(--sys-alpha-interactive), transparent)',
      tokens,
    );
    const { page, surface, segment, elevated } = groundsOf(theme);
    const grounds: Readonly<Record<string, Srgb>> = {
      page,
      'card or sheet surface': surface,
      'grouped segment': segment,
      'elevated card': elevated,
    };
    const lifts: Readonly<Record<string, Paint>> = {
      'the fill': fill,
      'a value pill': pill,
    };
    const cases = Object.entries(lifts).flatMap(([lift, top]) =>
      Object.entries(grounds).map(([ground, under]) => ({
        lift,
        ground,
        top,
        under,
      })),
    );

    it.each(cases)(
      `reads at ${FLOOR}:1 on $lift over the $ground`,
      ({ top, under }) => {
        expect(contrastRatio(ink, over(top, under))).toBeGreaterThanOrEqual(
          FLOOR,
        );
      },
    );

    it('stays a step under the primary ink', () => {
      const primary = opaque('--sys-color-foreground', tokens);
      expect(contrastRatio(ink, surface)).toBeLessThan(
        contrastRatio(primary, surface),
      );
    });

    if (theme === 'dark') {
      it('answers the axe findings: the plain secondary ink failed on the same fills', () => {
        const plain = opaque('--sys-color-secondary-label', tokens);
        expect(contrastRatio(plain, over(fill, segment))).toBeLessThan(
          WCAG_AA_TEXT,
        );
        expect(contrastRatio(plain, over(pill, segment))).toBeLessThan(
          WCAG_AA_TEXT,
        );
      });
    }
  },
);

describe('the words printed on a fill read the fill’s ink', () => {
  const color = (file: string, selector: string): string =>
    declared(ruleBody(file, selector), 'color') ?? '';

  it.each([
    ['a past date tile’s word', dateTileCss, ".ui-date-tile[data-tone='past']"],
    ['a step node still ahead', gaugeCss, '.ui-gauge__node'],
    ['a coupon’s detail chip', couponCardCss, '.ui-coupon-card__detail'],
  ] as const)('%s', (_, file, selector) => {
    expect(color(file, selector)).toBe(
      'var(--sys-color-secondary-label-on-fill)',
    );
  });

  // A unit field sits in a pill or on a bordered field, never on a bare
  // surface; its owner may take the unit's ink through the hook, and the
  // on-fill rung is what it reads when nobody does.
  it.each([
    ['a unit field’s unit', '.ui-unit-field__unit'],
    ['a unit field’s placeholder', '.ui-unit-field__native::placeholder'],
  ] as const)(
    '%s, unless its owner sets --ui-unit-field-unit-ink',
    (_, selector) => {
      // Prettier breaks the nested `var()` over lines; fold it as a selector.
      expect(foldSelector(color(unitFieldCss, selector))).toBe(
        'var(--ui-unit-field-unit-ink, var(--sys-color-secondary-label-on-fill))',
      );
    },
  );

  it('draws a past date tile’s day — the figure — in the primary ink', () => {
    expect(
      color(dateTileCss, ".ui-date-tile[data-tone='past'] .ui-date-tile__day"),
    ).toBe('var(--sys-color-foreground)');
  });
});

/**
 * THE DESTRUCTIVE INK (2026-10-06). Both themes declare a `-label` lift for
 * the destructive tone — the fill's red reads 3.12:1 on the dark card, so an
 * error printed in it was the least legible line on the sheet (axe on the
 * block sheet in dark: «Застъпва се с …» under the frame, serious ×2) — and
 * the `destructive` foreground style never read it. Every DS rule that
 * paints WORDS in the tone reads the lift now; the fill, the wash, a ring
 * and a glyph that stands alone keep `--sys-color-destructive`. The lift is
 * held to the floor on every opaque ground a line, a row, a menu item or a
 * field's error is drawn on, and on the destructive button's own wash.
 */
const DESTRUCTIVE_READERS = [
  [
    'libs/ui/modifiers/modifiers.css',
    "[data-foreground-style='destructive'][data-foreground-style]",
  ],
  [
    'libs/ui/patterns/src/lib/list-row/list-row.css',
    ".ui-list-row[data-role='destructive']",
  ],
  [
    'libs/ui/controls/src/lib/button/button.css',
    ".ui-button[data-role='destructive']",
  ],
  [
    'libs/ui/controls/src/lib/button/button.css',
    ".ui-button[data-button-style='glass'][data-role='destructive']",
  ],
  [
    'libs/ui/patterns/src/lib/menu/menu.css',
    ".ui-menu__item:not(.ui-list-row)[data-role='destructive']",
  ],
  [
    'libs/ui/patterns/src/lib/alert/alert.css',
    ".ui-alert__action[data-role='destructive']",
  ],
  [
    'libs/ui/patterns/src/lib/status-indicator/status-indicator.css',
    ".ui-status-indicator[data-tone='destructive']",
  ],
  [
    'libs/ui/controls/src/lib/date-field/date-field.css',
    '.ui-date-field__error',
  ],
  [
    'libs/ui/controls/src/lib/phone-field/phone-field.css',
    '.ui-phone-field__error',
  ],
] as const;

describe.each(THEMES)('--sys-color-destructive-label, %s theme', (theme) => {
  const tokens = themeTokens(theme);
  const ink = opaque('--sys-color-destructive-label', tokens);
  const tone = opaque('--sys-color-destructive', tokens);
  const { page, surface, segment, elevated } = groundsOf(theme);
  const grounds: Readonly<Record<string, Srgb>> = {
    page,
    'card or sheet surface': surface,
    'grouped segment': segment,
    'elevated card': elevated,
    'menu material over the page': over(
      paint(lookup('--sys-material-fill', tokens), tokens),
      page,
    ),
  };

  it.each(Object.entries(grounds))(
    `reads at ${FLOOR}:1 on the %s`,
    (_, ground) => {
      expect(contrastRatio(ink, ground)).toBeGreaterThanOrEqual(FLOOR);
    },
  );

  it.each(Object.entries(grounds))(
    `reads at ${FLOOR}:1 on the bordered destructive button’s wash over the %s`,
    (_, ground) => {
      // button.css: `color-mix(in srgb, var(--sys-color-destructive) 12%, transparent)`.
      expect(
        contrastRatio(ink, composite(tone, 0.12, ground)),
      ).toBeGreaterThanOrEqual(FLOOR);
    },
  );

  if (theme === 'dark') {
    it('answers the axe finding: the tone itself fails as a word on the card', () => {
      expect(contrastRatio(tone, segment)).toBeLessThan(WCAG_AA_TEXT);
      expect(contrastRatio(tone, surface)).toBeLessThan(WCAG_AA_TEXT);
    });
  }
});

describe('the destructive words read the lift, never the tone', () => {
  it.each(DESTRUCTIVE_READERS)('%s · %s', (file, selector) => {
    expect(declared(ruleBody(at(file), selector), 'color')).toBe(
      'var(--sys-color-destructive-label)',
    );
  });

  it('no stylesheet of the DS paints `color` with the tone itself', () => {
    const inked = inkedWith('--sys-color-destructive').filter((rule) =>
      rule.startsWith('libs/ui/'),
    );
    expect(inked).toEqual([]);
  });
});
