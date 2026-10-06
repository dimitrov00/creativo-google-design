import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { UiIconName } from '@creativo/ui/icons';
import { UiBadge } from './badge';
import type { UiBadgeTone } from './badge';

@Component({
  imports: [UiBadge],
  template: `<span uiBadge [uiTone]="tone()">New</span>`,
})
class HostComponent {
  readonly tone = signal<UiBadgeTone>('neutral');
}

describe('UiBadge', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
  });

  it('defaults to the neutral tone as a data-* attribute', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(el.classList.contains('ui-badge')).toBe(true);
    expect(el.getAttribute('data-tone')).toBe('neutral');
  });

  it('writes tone as a data-* attribute when changed', async () => {
    fixture.detectChanges();
    fixture.componentInstance.tone.set('destructive');
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(el.getAttribute('data-tone')).toBe('destructive');
  });

  it('draws no glyph and no media flag unless asked — the badge it always was', () => {
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(el.querySelector('ui-icon')).toBeNull();
    expect(el.childElementCount).toBe(0);
    expect(el.textContent?.trim()).toBe('New');
    expect(el.hasAttribute('data-on-media')).toBe(false);
  });
});

/** The glyph grammar and the label over media (2026-09-28). */
@Component({
  imports: [UiBadge],
  template: `
    <span
      uiBadge
      data-testid="badge"
      uiTone="accent"
      [uiIcon]="icon()"
      [uiOnMedia]="onMedia()"
      >Злато</span
    >
  `,
})
class GlyphHost {
  readonly icon = signal<UiIconName | null>('loyalty.tier');
  readonly onMedia = signal(false);
}

describe('UiBadge · glyph and media', () => {
  let fixture: ComponentFixture<GlyphHost>;
  const badge = (): HTMLElement =>
    fixture.nativeElement.querySelector('[data-testid="badge"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GlyphHost],
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    }).compileComponents();
    fixture = TestBed.createComponent(GlyphHost);
    fixture.detectChanges();
  });

  it('leads with a decorative glyph that rides the caption size', () => {
    const glyph = badge().firstElementChild as HTMLElement;
    expect(glyph.tagName).toBe('UI-ICON');
    expect(glyph.classList.contains('ui-badge__glyph')).toBe(true);
    expect(glyph.getAttribute('data-name')).toBe('loyalty.tier');
    expect(glyph.getAttribute('aria-hidden')).toBe('true');
    // Unscaled: 1em of the caption face, never a ladder rung of its own.
    expect(glyph.hasAttribute('data-scale')).toBe(false);
    expect(badge().textContent?.trim()).toBe('Злато');

    fixture.componentInstance.icon.set(null);
    fixture.detectChanges();
    expect(badge().querySelector('ui-icon')).toBeNull();
  });

  it('stamps data-on-media for a label over media', () => {
    expect(badge().hasAttribute('data-on-media')).toBe(false);
    fixture.componentInstance.onMedia.set(true);
    fixture.detectChanges();
    expect(badge().getAttribute('data-on-media')).toBe('');
  });
});

/*
 * THE FACES, READ FROM THE STYLESHEET. jsdom resolves no `color-mix`, so the
 * wash is held where it is written — and where its token is.
 */
describe('badge.css', () => {
  function stylesheet(path: string): string {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the DS's own stylesheets.
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\(\s/g, '(')
      .replace(/\s\)/g, ')');
  }

  const css = stylesheet(resolve(__dirname, 'badge.css'));
  const tokens = stylesheet(
    resolve(__dirname, '../../../../tokens/tokens.css'),
  );

  /** One rule's declarations, found by its exact (whitespace-folded) selector. */
  function rule(selector: string): Map<string, string> {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line security/detect-non-literal-regexp -- an escaped selector from this spec, over the DS's own stylesheet.
    const match = new RegExp(
      `(?:^|[{};])\\s*${escaped}\\s*\\{([^{}]*)\\}`,
    ).exec(css);
    if (!match) throw new Error(`no rule «${selector}» in badge.css`);
    const found = new Map<string, string>();
    for (const declaration of (match[1] as string).split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      found.set(
        declaration.slice(0, colon).trim(),
        declaration.slice(colon + 1).trim(),
      );
    }
    return found;
  }

  it('washes every tone with the one tint token, still 14% — pixel-identical', () => {
    expect(tokens).toContain('--sys-alpha-tint: 14%;');
    expect(css).not.toMatch(/\b14%/);
    for (const tone of ['accent', 'success', 'warning', 'destructive']) {
      expect(
        rule(`.ui-badge[data-tone='${tone}']`).get('--ui-badge-tint'),
      ).toBe(
        `color-mix(in srgb, var(--sys-color-${tone}) var(--sys-alpha-tint), transparent)`,
      );
    }
  });

  /*
   * THE ACCENT LAW (2026-09-29): one orange; colour is a shape, words are
   * ink. The accent capsule's words are the primary ink on its wash, its
   * glyph is the main accent, and its solid face is the primary fill.
   */
  const ACCENT_GLYPH =
    ".ui-badge[data-tone='accent']:not([data-on-media]):not([data-prominence='increased']) .ui-badge__glyph";

  it('prints the accent tone’s words in the primary ink, on the accent’s wash', () => {
    const accent = rule(".ui-badge[data-tone='accent']");
    expect(accent.get('--ui-badge-ink')).toBe('var(--sys-color-foreground)');
    expect(accent.get('--ui-badge-tint')).toBe(
      'color-mix(in srgb, var(--sys-color-accent) var(--sys-alpha-tint), transparent)',
    );
    // No cut of the accent is mixed anywhere: there is one orange.
    expect(css).not.toMatch(/var\(--sys-color-accent\) 60%/);
    expect(css).not.toContain('--sys-color-accent-label');
  });

  it('keeps the other three tones on their own ink recipe', () => {
    for (const tone of ['success', 'warning', 'destructive']) {
      const face = rule(`.ui-badge[data-tone='${tone}']`);
      expect(face.get('--ui-badge-ink')).toBe(
        `color-mix(in srgb, var(--sys-color-${tone}) 60%, var(--sys-color-foreground))`,
      );
      expect(face.get('--ui-badge-solid')).toBe(`var(--sys-color-${tone})`);
      expect(face.get('--ui-badge-on-solid')).toBe(
        'var(--sys-color-on-accent)',
      );
    }
  });

  it('draws the accent tone’s solid face as the primary fill: a count is ink on ink', () => {
    const accent = rule(".ui-badge[data-tone='accent']");
    expect(accent.get('--ui-badge-solid')).toBe('var(--sys-color-primary)');
    expect(accent.get('--ui-badge-on-solid')).toBe(
      'var(--sys-color-on-primary)',
    );
    const increased = rule(".ui-badge[data-prominence='increased']");
    expect(increased.get('background')).toBe('var(--ui-badge-solid)');
    expect(increased.get('color')).toBe('var(--ui-badge-on-solid)');
    // The white on-accent ink is small text nowhere on the accent tone.
    expect([...accent.values()]).not.toContain('var(--sys-color-on-accent)');
  });

  it('draws the accent tone’s glyph in the main accent, and nowhere else', () => {
    expect(rule(ACCENT_GLYPH).get('color')).toBe('var(--sys-color-accent)');
    // The one rule in the sheet that paints the accent as `color`.
    expect(css.match(/(?<![\w-])color: var\(--sys-color-accent\)/g)).toEqual([
      'color: var(--sys-color-accent)',
    ]);
  });

  it('keeps ONE ink for words and glyph on the media capsule and on the solid face', () => {
    const badge = document.createElement('span');
    badge.className = 'ui-badge';
    badge.dataset['tone'] = 'accent';
    badge.dataset['prominence'] = 'standard';
    const glyph = badge.appendChild(document.createElement('ui-icon'));
    glyph.className = 'ui-icon ui-badge__glyph';
    expect(glyph.matches(ACCENT_GLYPH)).toBe(true);

    badge.dataset['prominence'] = 'decreased';
    expect(glyph.matches(ACCENT_GLYPH)).toBe(true);

    badge.dataset['prominence'] = 'increased';
    expect(glyph.matches(ACCENT_GLYPH)).toBe(false);

    badge.dataset['prominence'] = 'standard';
    badge.dataset['onMedia'] = '';
    expect(glyph.matches(ACCENT_GLYPH)).toBe(false);
    // …and the media capsule's one ink is the near-black of the canvas.
    expect(rule('.ui-badge[data-on-media]').get('--ui-badge-ink')).toBe(
      'var(--sys-color-media-canvas)',
    );

    // Another tone's glyph rides its capsule's ink, as it always did.
    delete badge.dataset['onMedia'];
    badge.dataset['tone'] = 'success';
    expect(glyph.matches(ACCENT_GLYPH)).toBe(false);
  });

  it('turns the standard face into the white media capsule, after every tone', () => {
    const media = rule('.ui-badge[data-on-media]');
    expect(media.get('--ui-badge-tint')).toBe('var(--sys-color-on-media)');
    expect(media.get('--ui-badge-ink')).toBe('var(--sys-color-media-canvas)');
    expect(css.indexOf('.ui-badge[data-on-media] {')).toBeGreaterThan(
      css.indexOf(".ui-badge[data-tone='destructive'] {"),
    );
    expect(
      rule(".ui-badge[data-prominence='decreased'][data-on-media]").get(
        'color',
      ),
    ).toBe('var(--sys-color-on-media-muted)');
  });

  it('lifts a neutral capsule off a muted card with the control fill — the card’s own colour is its face', () => {
    // The neutral face and the muted card are both surface-secondary: the
    // «Злато» tier vanished there until a feature repainted the tint.
    expect(rule('.ui-badge').get('--ui-badge-tint')).toBe(
      'var(--sys-color-surface-secondary)',
    );
    const cardCss = readFileSync(
      resolve(__dirname, '../../../../patterns/src/lib/card/card.css'),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(cardCss).toMatch(
      /\.ui-card\[data-tone='muted'\] \{ background: var\(--sys-color-surface-secondary\);/,
    );
    const onMuted = rule(
      ".ui-card[data-tone='muted'] .ui-badge[data-tone='neutral']:not([data-on-media])",
    );
    expect(onMuted.get('--ui-badge-tint')).toBe('var(--sys-color-fill)');
    expect(onMuted.get('--ui-badge-solid')).toBe('var(--sys-color-fill)');
    // A capsule over media keeps its white face: the rule steps aside.
    const card = document.createElement('div');
    card.className = 'ui-card';
    card.dataset['tone'] = 'muted';
    const [plain, media] = [0, 1].map(() => {
      const badge = document.createElement('span');
      badge.className = 'ui-badge';
      badge.dataset['tone'] = 'neutral';
      return card.appendChild(badge);
    }) as [HTMLElement, HTMLElement];
    media.dataset['onMedia'] = '';
    const selector =
      ".ui-card[data-tone='muted'] .ui-badge[data-tone='neutral']:not([data-on-media])";
    expect(plain.matches(selector)).toBe(true);
    expect(media.matches(selector)).toBe(false);
  });
});
