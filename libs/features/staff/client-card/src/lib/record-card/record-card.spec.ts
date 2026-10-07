import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { cssRule } from '../../testing/css-rule';
import { stubResizeObserver } from '../../testing/achievements-pages.rig';
import { RECORD_CARD } from '../../testing/client-pages.vm-fixtures';
import type { RecordCardVm } from '../client-pages.vm';
import { RecordCard } from './record-card';

@Component({
  imports: [RecordCard],
  template: `
    <div role="list">
      <lib-record-card
        [vm]="vm()"
        newWord="Нов рекорд"
        data-testid="achievements-record-probe"
        (open)="opened.push($event)"
      />
    </div>
  `,
})
class Host {
  readonly vm = signal<RecordCardVm>(RECORD_CARD.longestRhythm);
  readonly opened: string[] = [];
}

async function mount(vm: RecordCardVm) {
  await TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.vm.set(vm);
  fixture.detectChanges();
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  return {
    fixture,
    text,
    tile: host.querySelector<HTMLElement>('lib-record-card'),
    card: host.querySelector<HTMLButtonElement>('button.record-card'),
    emblem: host.querySelector<HTMLElement>('ui-avatar.record-card__emblem'),
    label: host.querySelector<HTMLElement>('.record-card__label'),
    figure: host.querySelector<HTMLElement>('.record-card__figure'),
    detail: host.querySelector<HTMLElement>('.record-card__detail'),
    capsule: host.querySelector<HTMLElement>('.record-card__new'),
  };
}

/** The declarations of ONE rule of the card's stylesheet. */
function rule(selector: string): ReadonlyMap<string, string> {
  return cssRule('record-card/record-card.css', selector);
}

describe('RecordCard (§2.3.2 AE, §3.14)', () => {
  it('is the list item, and draws the record as ONE white elevated card that is a button', async () => {
    const { tile, card } = await mount(RECORD_CARD.longestRhythm);
    expect(tile?.getAttribute('role')).toBe('listitem');
    expect(tile?.classList).toContain('record-card-host');
    expect(card?.tagName).toBe('BUTTON');
    expect(card?.getAttribute('type')).toBe('button');
    expect(card?.classList).toContain('ui-card');
    expect(card?.getAttribute('data-tone')).toBe('elevated');
    expect(card?.getAttribute('data-padding')).toBe('regular');
    expect(card?.hasAttribute('data-interactive')).toBe(true);
    expect(card?.getAttribute('data-kind')).toBe('longestRhythm');
    // The button is ONE sentence; its parts are hidden from a reader.
    expect(card?.getAttribute('aria-label')).toBe(
      'Най-дълъг ритъм: 23, септември 2026 г., нов рекорд',
    );
    for (const part of card?.querySelectorAll(':scope > *') ?? []) {
      expect(part.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('stacks the emblem, the label, the figure and one quiet detail, each at its rung (§2.0)', async () => {
    const { card, emblem, label, figure, detail, text } = await mount(
      RECORD_CARD.mostVisitsInYear,
    );
    expect(
      [...(card?.children ?? [])].map((part) =>
        [...part.classList].find((name) => name.startsWith('record-card__')),
      ),
    ).toEqual([
      'record-card__emblem',
      'record-card__label',
      'record-card__figure-row',
      'record-card__detail',
    ]);
    expect(emblem?.getAttribute('data-control-size')).toBe('large');
    expect(text(label)).toBe('Най-много за година');
    expect(label?.getAttribute('data-font')).toBe('callout');
    expect(label?.getAttribute('data-weight')).toBe('semibold');
    expect(text(figure)).toBe('13');
    expect(figure?.getAttribute('data-font')).toBe('title2');
    expect(text(detail)).toBe('2025 г.');
    expect(detail?.getAttribute('data-font')).toBe('footnote');
    expect(detail?.getAttribute('data-foreground-style')).toBe('secondary');
    // Figures are tabular (the stylesheet is the contract: jsdom lays nothing out).
    expect(rule('.record-card__figure').get('font-variant-numeric')).toBe(
      'tabular-nums',
    );
    expect(rule('.record-card__detail').get('font-variant-numeric')).toBe(
      'tabular-nums',
    );
  });

  it('draws the emblem as a MARK: the record’s glyph, white on the solid accent (§1 rule 4)', async () => {
    const { emblem } = await mount(RECORD_CARD.firstVisit);
    expect(emblem?.hasAttribute('data-picture')).toBe(false);
    expect(emblem?.getAttribute('aria-hidden')).toBe('true');
    const glyph = emblem?.querySelector('.ui-avatar__fallback ui-icon');
    expect(glyph?.getAttribute('data-name')).toBe('loyalty.record.firstVisit');
    expect(emblem?.querySelector('.ui-avatar__media img')).toBeNull();
    // The tint rides the avatar's own ink hook; the disc is the accent.
    const mark = rule('.record-card__emblem:not([data-picture])');
    expect(mark.get('background')).toBe('var(--sys-color-accent)');
    expect(mark.get('--ui-avatar-ink')).toBe('var(--sys-color-on-accent)');
    // The glyph at the prominent rung (24 on the 52 disc).
    expect(rule('.record-card__emblem .ui-icon').get('font-size')).toBe(
      'var(--ui-icon-large)',
    );
  });

  it('puts the SERVICE in the emblem’s place for a favourite: its cover, and no mark', async () => {
    const { emblem, figure, detail, text } = await mount(
      RECORD_CARD.favouriteService,
    );
    expect(emblem?.hasAttribute('data-picture')).toBe(true);
    expect(emblem?.querySelector('ui-async-image')).not.toBeNull();
    expect(emblem?.querySelector('.ui-avatar__fallback ui-icon')).toBeNull();
    // The figure is the service's name, the detail its count.
    expect(text(figure)).toBe('Фейд');
    expect(text(detail)).toBe('23 пъти');
  });

  it('sets a WORD figure — the favourite’s service — on the rung its own measured width holds (headline · body · callout, at 600), and a number on the display rung at every width (review 3, F1)', async () => {
    const observers = stubResizeObserver();
    try {
      const word = await mount(RECORD_CARD.favouriteService);
      // Until measured: a phone's 2-up card, the headline.
      expect(word.figure?.getAttribute('data-font')).toBe('headline');
      expect(word.figure?.getAttribute('data-weight')).toBe('semibold');
      expect(word.figure?.hasAttribute('data-word')).toBe(true);
      expect(observers.observed()).toContain(word.tile);
      // A 390 phone's 170: the headline; a 330 phone's 140 does not hold
      // «подстрижка» at 18 — the body rung; the dialog's 4-up 120 not at
      // the body rung either — the callout.
      observers.resize(170);
      word.fixture.detectChanges();
      expect(word.figure?.getAttribute('data-font')).toBe('headline');
      observers.resize(140);
      word.fixture.detectChanges();
      expect(word.figure?.getAttribute('data-font')).toBe('body');
      expect(word.figure?.getAttribute('data-weight')).toBe('semibold');
      observers.resize(120);
      word.fixture.detectChanges();
      expect(word.figure?.getAttribute('data-font')).toBe('callout');
      expect(word.figure?.getAttribute('data-weight')).toBe('semibold');

      TestBed.resetTestingModule();
      const number = await mount(RECORD_CARD.longestRhythm);
      observers.resize(120);
      number.fixture.detectChanges();
      expect(number.figure?.getAttribute('data-font')).toBe('title2');
      expect(number.figure?.hasAttribute('data-weight')).toBe(false);
      expect(number.figure?.hasAttribute('data-word')).toBe(false);
    } finally {
      observers.restore();
    }
    // A word wraps only between its words, balanced, never inside one (the
    // stylesheet is the contract); a number's rule is untouched; the line
    // shrinks to the card rather than running past its padding.
    const wordRule = rule('.record-card__figure[data-word]');
    expect(wordRule.get('hyphens')).toBe('manual');
    expect(wordRule.get('text-wrap')).toBe('balance');
    expect(wordRule.get('overflow-wrap')).toBe('break-word');
    expect(
      rule('.record-card__label, .record-card__figure').get('min-inline-size'),
    ).toBe('0');
  });

  it('wears the capsule «Нов рекорд» beside the figure within thirty days of the record, and nothing otherwise', async () => {
    const fresh = await mount(RECORD_CARD.longestRhythm);
    expect(fresh.card?.hasAttribute('data-new')).toBe(true);
    expect(fresh.text(fresh.capsule)).toBe('Нов рекорд');
    expect(fresh.capsule?.classList).toContain('ui-badge');
    expect(fresh.capsule?.getAttribute('data-tone')).toBe('accent');
    expect(fresh.capsule?.parentElement?.classList).toContain(
      'record-card__figure-row',
    );
    expect(fresh.capsule?.previousElementSibling).toBe(fresh.figure);

    TestBed.resetTestingModule();
    const old = await mount(RECORD_CARD.mostVisitsInYear);
    expect(old.card?.hasAttribute('data-new')).toBe(false);
    expect(old.capsule).toBeNull();
    expect(old.card?.querySelector('.ui-badge')).toBeNull();
  });

  it('binds the detail’s «г.» to its year on the card, and leaves the card’s sentence plain (review 3, F13)', async () => {
    const { detail, card } = await mount(RECORD_CARD.longestRhythm);
    expect(detail?.textContent).toBe('септември 2026\u00a0г.');
    expect(card?.getAttribute('aria-label')).toContain('септември 2026 г.');
  });

  it('leaves the detail out when the record has none', async () => {
    const { detail, card } = await mount({
      ...RECORD_CARD.firstVisit,
      detail: null,
    });
    expect(detail).toBeNull();
    expect(card?.children).toHaveLength(3);
  });

  it('hands the record’s id to its page on a tap', async () => {
    const { fixture, card } = await mount(RECORD_CARD.favouriteService);
    card?.click();
    expect(fixture.componentInstance.opened).toEqual(['favouriteService']);
  });

  it('is a subgrid of four of the grid’s rows, so a row’s emblems, labels, figures and dates each share one line; wraps a long label inside the card; is an origin the editor can return to', () => {
    // The host hands four of the grid's rows to the card; the card lays its
    // four parts on them, each at its row's top, a tight step between.
    const host = rule(':host');
    expect(host.get('display')).toBe('grid');
    expect(host.get('grid-row')).toBe('span 4');
    expect(host.get('grid-template-rows')).toBe('subgrid');
    const card = rule('.record-card');
    expect(card.get('display')).toBe('grid');
    expect(card.get('grid-row')).toBe('span 4');
    expect(card.get('grid-template-rows')).toBe('subgrid');
    expect(card.get('row-gap')).toBe('var(--sys-space-tight)');
    expect(card.get('align-items')).toBe('start');
    expect(card.get('scroll-margin-block')).toBe(
      'var(--modal-sheet-origin-margin)',
    );
    expect(card.get('text-align')).toBe('start');
    // A long label wraps inside the card rather than widening it.
    const words = rule('.record-card__label, .record-card__figure');
    expect(words.get('overflow-wrap')).toBe('anywhere');
    expect(words.get('max-inline-size')).toBe('100%');
    // The capsule's line wraps rather than widening the card.
    expect(rule('.record-card__figure-row').get('flex-wrap')).toBe('wrap');
    // The date never leaves «г.» alone on a line.
    expect(rule('.record-card__detail').get('text-wrap')).toBe('pretty');
  });
});
