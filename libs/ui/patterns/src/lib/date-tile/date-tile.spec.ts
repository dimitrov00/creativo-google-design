import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import {
  UiDateTile,
  type UiDateTileControlSize,
  type UiDateTileTone,
} from './date-tile';

const css = readFileSync(resolve(__dirname, 'date-tile.css'), 'utf8');

@Component({
  imports: [UiDateTile],
  template: `
    <ui-date-tile
      [uiDay]="day()"
      [uiCaption]="caption()"
      [uiTone]="tone()"
      [uiControlSize]="size()"
      data-testid="tile"
    />
    <ui-date-tile uiDay="2" uiCaption="окт." data-testid="defaults" />
  `,
})
class Host {
  readonly day = signal<string | number>(4);
  readonly caption = signal('септ.');
  readonly tone = signal<UiDateTileTone>('upcoming');
  readonly size = signal<UiDateTileControlSize>('large');
}

function render() {
  TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const tile = root.querySelector('[data-testid="tile"]') as HTMLElement;
  const defaults = root.querySelector(
    '[data-testid="defaults"]',
  ) as HTMLElement;
  return { fixture, host: fixture.componentInstance, tile, defaults };
}

describe('UiDateTile', () => {
  it('stamps the word over the day, as decoration — the row says the date in words', () => {
    const { tile } = render();
    expect(tile.classList.contains('ui-date-tile')).toBe(true);
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.querySelector('.ui-date-tile__caption')?.textContent).toBe(
      'септ.',
    );
    expect(tile.querySelector('.ui-date-tile__day')?.textContent).toBe('4');
    const order = [...tile.children].map((child) => child.className);
    expect(order).toEqual(['ui-date-tile__caption', 'ui-date-tile__day']);
  });

  it('is a past, regular stamp unless told otherwise', () => {
    const { defaults } = render();
    expect(defaults.dataset['tone']).toBe('past');
    expect(defaults.dataset['controlSize']).toBe('regular');
  });

  it('stamps every tone and both sizes', () => {
    const { tile, fixture, host } = render();
    for (const tone of ['upcoming', 'past', 'hollow'] as const) {
      host.tone.set(tone);
      fixture.detectChanges();
      expect(tile.dataset['tone']).toBe(tone);
    }
    for (const size of ['regular', 'large'] as const) {
      host.size.set(size);
      fixture.detectChanges();
      expect(tile.dataset['controlSize']).toBe(size);
    }
    host.day.set('12');
    fixture.detectChanges();
    expect(tile.querySelector('.ui-date-tile__day')?.textContent).toBe('12');
  });

  describe('the stylesheet', () => {
    /** The declarations of one rule, found by its exact selector (the accent-label spec's reader). */
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      if (start < 0) throw new Error(`date-tile.css has no "${selector}" rule`);
      return css.slice(start, css.indexOf('}', start));
    };

    it('sits on the control ladder: 44, or 52', () => {
      expect(rule('.ui-date-tile')).toContain(
        'inline-size: var(--control-size-regular)',
      );
      expect(rule(".ui-date-tile[data-control-size='large']")).toContain(
        'inline-size: var(--control-size-large)',
      );
    });

    it('keeps the upcoming stamp’s accent wash and prints it in ink: the day primary, its word the fill’s secondary', () => {
      // The accent law (2026-09-29): the wash is the colour, words are ink.
      const upcoming = rule(".ui-date-tile[data-tone='upcoming']");
      expect(upcoming).toContain(
        'background: color-mix(in srgb, var(--sys-color-accent) 16%, transparent)',
      );
      expect(upcoming).toContain(
        'color: var(--sys-color-secondary-label-on-fill)',
      );
      expect(
        rule(".ui-date-tile[data-tone='upcoming'] .ui-date-tile__day"),
      ).toContain('color: var(--sys-color-foreground)');
    });

    it('names no cut of the accent and paints the accent as a wash only', () => {
      const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(bare).not.toContain('--sys-color-accent-label');
      expect(bare).not.toMatch(/(?<![\w-])color:\s*var\(--sys-color-accent\)/);
      expect(bare.match(/var\(--sys-color-accent\)/g)).toHaveLength(1);
    });

    it('prints an upcoming and a past stamp in the same two inks: the wash alone says «ahead»', () => {
      for (const tone of ['upcoming', 'past']) {
        expect(rule(`.ui-date-tile[data-tone='${tone}']`)).toContain(
          'color: var(--sys-color-secondary-label-on-fill)',
        );
        expect(
          rule(`.ui-date-tile[data-tone='${tone}'] .ui-date-tile__day`),
        ).toContain('color: var(--sys-color-foreground)');
      }
    });

    it('draws a past stamp on the control fill and a hollow one as a ring', () => {
      expect(rule('.ui-date-tile')).toContain(
        'background: var(--sys-color-fill)',
      );
      const hollow = rule(".ui-date-tile[data-tone='hollow']");
      expect(hollow).toContain('background: none');
      expect(hollow).toContain(
        'var(--sys-stroke-mark) var(--sys-color-separator)',
      );
    });

    it('prints a past stamp’s day in the primary ink and its word in the fill’s secondary ink', () => {
      // The dark secondary ink was 3.70:1 on the fill over a card (axe,
      // 2026-09-28); accent-label.spec measures the token on every fill.
      expect(rule(".ui-date-tile[data-tone='past']")).toContain(
        'color: var(--sys-color-secondary-label-on-fill)',
      );
      expect(
        rule(".ui-date-tile[data-tone='past'] .ui-date-tile__day"),
      ).toContain('color: var(--sys-color-foreground)');
    });

    it('keeps a past stamp’s square on a muted card as an opaque chip, never the hollow ring', () => {
      // The fill over the card's grey is 1.08:1 in light, so the stamp
      // stands off the card on the surface — and it is a stamp that
      // HAPPENED: the ring is the «did not happen» form, `hollow`'s alone.
      const onMuted = rule(
        ".ui-card[data-tone='muted'] .ui-date-tile[data-tone='past']",
      );
      expect(onMuted).toContain('background: var(--sys-color-surface)');
      expect(onMuted).not.toContain('box-shadow');
      const ringed = [...css.matchAll(/([^{}]+)\{[^}]*box-shadow[^}]*\}/g)].map(
        ([, selector]) =>
          (selector as string).replace(/\/\*[\s\S]*?\*\//g, '').trim(),
      );
      expect(ringed).toEqual([".ui-date-tile[data-tone='hollow']"]);
    });
  });
});
