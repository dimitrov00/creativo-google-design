import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { UiIconName } from '@creativo/ui/icons';
import {
  WCAG_AA_TEXT,
  composite,
  contrastRatio,
  parseHex,
  type Srgb,
  type UiTheme,
} from '@creativo/ui/tokens';
import { UiAvatar, type UiAvatarSize } from './avatar';

@Component({
  imports: [UiAvatar],
  template: `<ui-avatar
    [uiSrc]="src()"
    [uiName]="name()"
    [uiIcon]="icon()"
    [uiControlSize]="'large'"
  />`,
})
class HostComponent {
  readonly src = signal<string | null>(null);
  readonly name = signal('Ada Lovelace');
  readonly icon = signal<UiIconName | null>(null);
}

describe('UiAvatar', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('writes size as a data-* attribute', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('ui-avatar');
    expect(el.classList.contains('ui-avatar')).toBe(true);
    expect(el.getAttribute('data-control-size')).toBe('large');
  });

  it('renders the uppercased two-word monogram when there is no src', () => {
    // Apple-monogram grammar: first letters of the first two words.
    fixture.detectChanges();
    const fallback: HTMLElement = fixture.nativeElement.querySelector(
      '.ui-avatar__fallback',
    );
    expect(fallback.textContent?.trim()).toBe('AL');
  });

  it('renders the AsyncImage img when a src is provided', async () => {
    fixture.detectChanges();
    fixture.componentInstance.src.set('https://example.com/a.png');
    fixture.detectChanges();
    await fixture.whenStable();
    const img: HTMLImageElement | null = fixture.nativeElement.querySelector(
      '.ui-avatar .ui-async-image__image',
    );
    expect(img).not.toBeNull();
    expect(img?.getAttribute('alt')).toBe('Ada Lovelace');
    // AsyncImage parity: the monogram stays in the DOM as the placeholder —
    // it cross-fades out once the image loads and persists on error.
    expect(
      fixture.nativeElement.querySelector('.ui-avatar__fallback'),
    ).not.toBeNull();
  });

  /* A disc that stands for something other than a person — "anyone", a team,
     an unassigned lane. It replaces the monogram rather than joining it: the
     glyph IS the identity here, so a name alongside it would be two answers
     to the same question. */
  it('renders a glyph in place of the monogram when uiIcon is set', () => {
    fixture.componentInstance.icon.set('booking.anyBarber');
    fixture.detectChanges();
    const fallback: HTMLElement = fixture.nativeElement.querySelector(
      '.ui-avatar__fallback',
    );
    expect(fallback.querySelector('.ui-icon')).not.toBeNull();
    expect(fallback.textContent?.trim()).not.toBe('AL');
  });

  // It is a PLACEHOLDER like the monogram, so real bytes still win.
  it('keeps the glyph behind a real src', async () => {
    fixture.componentInstance.icon.set('booking.anyBarber');
    fixture.componentInstance.src.set('https://example.com/a.png');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('.ui-async-image__image'),
    ).not.toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   THE MONOGRAM'S LEGIBILITY, READ FROM THE TOKENS (2026-10-06).

   The monogram is drawn at the host's ink on a film of that same ink at
   the theme's fill alpha (avatar.css) — which, for the ink every page,
   card and row hands it (the foreground), IS the control fill under the
   primary ink. These cases read the real theme files and hold that pair,
   and the two other inks the system sanctions for a monogram, to SC 1.4.3
   on every opaque ground in both themes:

     · the foreground — `currentColor` on a page, a card, a segment, a sheet
     · the quiet rung — `--sys-color-secondary-label-on-fill`, the one
       secondary ink cut for words ON a fill (the plain secondary label
       falls under AA on the avatar's own film over a dark segment, which
       the last case records as the reason)
     · the inverted pair — the on-primary ink a selected chip or list row
       hands it, on the primary fill

   The portrait tier (112, a 36px monogram) is large text by WCAG and could
   claim 3:1; it is held to 4.5 like the rest, because the number is the
   same ink the small tiers draw.

   What the recipe cannot answer is an ANCESTOR'S OPACITY: a parent at
   `opacity: .55` multiplies the foreground to 4.14:1 on the light page
   (5.49 in dark), and no ink the theme owns clears AA through that — the
   darkest light ink is the foreground itself. A row that recedes does it
   by form or by the foreground role, never by opacity (list-row.css says
   the same of its detail); axe flags the monogram as visible text even
   though it is aria-hidden.

   Read in miniature here rather than imported: the tokens lib keeps its
   spec reader (`accent-spec-support.ts`) out of its index on purpose, and
   the module-boundary lint bars a relative import of it. The grammar is
   the theme files' own — a hex, `transparent`, a `var()`, a two-paint
   `color-mix(in srgb …)` — and a value written any other way throws.
   ═══════════════════════════════════════════════════════════════════════ */

const TOKENS_DIR = resolve(__dirname, '../../../../tokens');
const AVATAR_CSS = resolve(__dirname, 'avatar.css');
const THEMES: readonly UiTheme[] = ['light', 'dark'];
const SIZES: readonly UiAvatarSize[] = [
  'small',
  'regular',
  'large',
  'extraLarge',
];
/** The AA floor plus the house margin, so a renderer's rounding cannot tip a number back under 4.5. */
const FLOOR = 4.6;
/** WCAG's large text: 24px, or 14pt (18.66px) at weight 700 and over. */
const LARGE_TEXT_PX = 24;
const LARGE_BOLD_TEXT_PX = (14 * 96) / 72;

type Tokens = ReadonlyMap<string, string>;

interface Paint {
  readonly rgb: Srgb;
  readonly alpha: number;
}

const fold = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Comments out, whitespace folded: one line a regex can read. */
const stylesheet = (path: string): string =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the design system's own stylesheets, named by this spec.
  fold(readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' '));

/** The cascade as the page applies it: dark overrides light overrides base. */
function themeTokens(theme: UiTheme): Tokens {
  const files = ['tokens.css', 'theme-light.css'];
  if (theme === 'dark') files.push('theme-dark.css');
  const found = new Map<string, string>();
  for (const file of files) {
    const css = stylesheet(resolve(TOKENS_DIR, file));
    for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      found.set(name as string, (value as string).trim());
    }
  }
  return found;
}

function lookup(name: string, tokens: Tokens): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`${name} is not declared`);
  return value;
}

/** `4%`, or a `var()` that resolves to one, as a 0–1 share. */
function share(value: string, tokens: Tokens): number {
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  const literal = alias ? lookup(alias[1] as string, tokens) : value;
  const percent = Number(/^([\d.]+)%$/.exec(literal)?.[1]);
  if (!Number.isFinite(percent)) throw new Error(`not a percentage: ${value}`);
  return percent / 100;
}

/**
 * The colour grammar the theme files use, as a straight-alpha paint. A
 * `color-mix()` interpolates with premultiplied alpha (CSS Color 5), which
 * is what makes `foreground 4%, transparent` the foreground at alpha .04.
 */
function paint(value: string, tokens: Tokens): Paint {
  if (value === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  if (value.startsWith('#')) return { rgb: parseHex(value), alpha: 1 };
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  if (alias) return paint(lookup(alias[1] as string, tokens), tokens);
  const mix = /^color-mix\( ?in srgb, (.+) (\S+), (.+?) ?\)$/.exec(value);
  if (!mix) throw new Error(`unsupported colour value: ${value}`);
  const top = paint(mix[1] as string, tokens);
  const p = share(mix[2] as string, tokens);
  const under = paint(mix[3] as string, tokens);
  const alpha = top.alpha * p + under.alpha * (1 - p);
  const blend = (t: number, u: number): number =>
    alpha === 0 ? 0 : (t * top.alpha * p + u * under.alpha * (1 - p)) / alpha;
  return {
    rgb: [
      blend(top.rgb[0], under.rgb[0]),
      blend(top.rgb[1], under.rgb[1]),
      blend(top.rgb[2], under.rgb[2]),
    ],
    alpha,
  };
}

function opaque(name: string, tokens: Tokens): Srgb {
  const resolved = paint(lookup(name, tokens), tokens);
  if (resolved.alpha !== 1) throw new Error(`${name} is not opaque`);
  return resolved.rgb;
}

/**
 * The opaque grounds an avatar is set on, by name — the house set the
 * tokens lib's own specs measure against. Not the segmented control's
 * raised thumb: no avatar rides a view toggle, and the quiet rung would
 * read 2.86:1 on it in dark.
 */
function groundsOf(theme: UiTheme): ReadonlyMap<string, Srgb> {
  const tokens = themeTokens(theme);
  return new Map([
    ['page', opaque('--sys-color-background', tokens)],
    ['card or sheet surface', opaque('--sys-color-surface', tokens)],
    ['grouped segment', opaque('--sys-color-surface-secondary', tokens)],
    ['elevated card', opaque('--sys-color-surface-elevated', tokens)],
  ]);
}

/** The monogram's ratio: the ink against its own film at the fill alpha over the ground. */
function monogram(ink: Srgb, ground: Srgb, tokens: Tokens): number {
  const film = composite(ink, share('var(--sys-alpha-fill)', tokens), ground);
  return contrastRatio(ink, film);
}

/** The worst reading of one ink over every ground of a theme. */
function worstOf(ink: string, theme: UiTheme): number {
  const tokens = themeTokens(theme);
  const rgb = opaque(ink, tokens);
  return Math.min(
    ...[...groundsOf(theme).values()].map((ground) =>
      monogram(rgb, ground, tokens),
    ),
  );
}

/** `weight size/line family` → px (a rem taken as the root's 16px) and weight. */
function typeRole(shorthand: string): {
  readonly px: number;
  readonly weight: number;
} {
  const match = /^(\d{3}) ([\d.]+)rem\//.exec(shorthand);
  if (!match) throw new Error(`not a font shorthand: ${shorthand}`);
  return { weight: Number(match[1]), px: Number(match[2]) * 16 };
}

/** Each tier's font token, as avatar.css stamps it. */
function tiers(): ReadonlyMap<UiAvatarSize, string> {
  const found = new Map<UiAvatarSize, string>();
  const rule =
    /\.ui-avatar\[data-control-size='(\w+)'\] \{[^}]*font: var\((--sys-font-\w+)\);/g;
  for (const [, size, font] of stylesheet(AVATAR_CSS).matchAll(rule)) {
    found.set(size as UiAvatarSize, font as string);
  }
  return found;
}

describe('the monogram is legible', () => {
  it('is the host ink on a film of that ink at the fill alpha — the rule the numbers read', () => {
    const css = stylesheet(AVATAR_CSS);
    expect(css).toMatch(
      /\.ui-avatar \{[^}]*background: color-mix\( ?in srgb, var\(--ui-avatar-ink, currentColor\) var\(--sys-alpha-fill\), transparent ?\);/,
    );
    expect(css).toMatch(
      /\.ui-avatar__fallback \{ color: var\(--ui-avatar-ink, currentColor\); \}/,
    );
  });

  it('holds every tier to the small-text bar, the 112 portrait included', () => {
    const tokens = themeTokens('light'); // the type ladder is theme-free
    expect([...tiers().keys()]).toEqual(SIZES);
    for (const [size, font] of tiers()) {
      const role = typeRole(lookup(font, tokens));
      const display =
        role.px >= LARGE_TEXT_PX ||
        (role.px >= LARGE_BOLD_TEXT_PX && role.weight >= 700);
      // Only the portrait draws display type; the bar below is one for all.
      expect(display, `${size} draws ${role.px}px at ${role.weight}`).toBe(
        size === 'extraLarge',
      );
    }
    expect(FLOOR).toBeGreaterThan(WCAG_AA_TEXT);
  });

  it.each(THEMES)(
    'clears AA for every sanctioned ink on every ground in %s',
    (theme) => {
      const tokens = themeTokens(theme);
      const inks: ReadonlyMap<string, Srgb> = new Map([
        ['the foreground', opaque('--sys-color-foreground', tokens)],
        [
          'the quiet rung',
          opaque('--sys-color-secondary-label-on-fill', tokens),
        ],
      ]);
      for (const [inkName, ink] of inks) {
        for (const [groundName, ground] of groundsOf(theme)) {
          expect(
            monogram(ink, ground, tokens),
            `${inkName} on the ${groundName} in ${theme}`,
          ).toBeGreaterThanOrEqual(FLOOR);
        }
      }
      // The inverted pair a selected chip or list row hands it: the film
      // follows the ink, so the on-primary monogram sits on a light film
      // over the primary fill.
      expect(
        monogram(
          opaque('--sys-color-on-primary', tokens),
          opaque('--sys-color-primary', tokens),
          tokens,
        ),
        `the on-primary ink on the primary fill in ${theme}`,
      ).toBeGreaterThanOrEqual(FLOOR);
    },
  );

  it('is why the quiet rung is the on-fill secondary and not the plain label', () => {
    for (const theme of THEMES) {
      expect(
        worstOf('--sys-color-secondary-label-on-fill', theme),
      ).toBeGreaterThanOrEqual(FLOOR);
    }
    // The plain secondary label on the avatar's own film over the dark
    // grouped segment reads 4.13:1 — the reason the on-fill cut exists.
    expect(
      Math.min(
        ...THEMES.map((theme) => worstOf('--sys-color-secondary-label', theme)),
      ),
    ).toBeLessThan(WCAG_AA_TEXT);
  });
});
