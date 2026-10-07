import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { LoyaltyGlanceVm } from '../client-pages.vm';
import { LOYALTY_GLANCE } from '../../testing/client-pages.vm-fixtures';
import { must } from '../../testing/client-card.fixtures';
import { cssRule } from '../../testing/css-rule';
import { LoyaltyGlance } from './loyalty-glance';

/*
 * THE DRAWING of `lib-loyalty-glance` (client-card-revision-3 §2.1.3 F1,
 * §3.12): a hand-built model in, ONE white card and ONE button out. The
 * figure is the one orange on the card and it is a display figure; every
 * other word is ink; the facts keep the ids the first build gave them.
 * jsdom lays nothing out, so where a case pins HOW a part is laid out the
 * stylesheet is the contract.
 */

@Component({
  imports: [LoyaltyGlance],
  template: `<lib-loyalty-glance [vm]="vm()" (open)="opened = opened + 1" />`,
})
class Host {
  readonly vm = signal<LoyaltyGlanceVm>(LOYALTY_GLANCE.georgi);
  opened = 0;
}

async function mount(vm: LoyaltyGlanceVm) {
  TestBed.configureTestingModule({
    imports: [Host],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.vm.set(vm);
  fixture.detectChanges();
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    host.querySelector<T>(`[data-testid="${id}"]`);
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  return { fixture, host, byId, text, out: fixture.componentInstance };
}

const CSS = readFileSync(resolve(__dirname, 'loyalty-glance.css'), 'utf8');

describe('lib-loyalty-glance — Георги: points, a sentence, three holdings', () => {
  it('is ONE white elevated card that is ONE button, named by its sentence; its words are not heard twice', async () => {
    const { byId, text } = await mount(LOYALTY_GLANCE.georgi);
    const card = must(byId<HTMLButtonElement>('client-loyalty-points'));
    expect(card.tagName).toBe('BUTTON');
    expect(card.type).toBe('button');
    expect(card.classList.contains('ui-card')).toBe(true);
    expect(card.getAttribute('data-tone')).toBe('elevated');
    expect(card.getAttribute('data-padding')).toBe('comfortable');
    expect(card.hasAttribute('data-interactive')).toBe(true);
    expect(card.getAttribute('aria-label')).toBe(
      'Лоялност: 371 точки. Стигат за безплатно оформяне на брада. Ваучер 25,00 €, печати 3 от 10, ритъм 9 посещения.',
    );
    const words = must(card.querySelector('.loyalty-glance__words'));
    expect(words.getAttribute('aria-hidden')).toBe('true');
    // Three blocks, each on its own line: the figure, the sentence, the holdings.
    expect([...words.children].map((block) => text(block))).toEqual([
      // The figure and its unit are two spans on one baseline.
      '371точки',
      'Стигат за безплатно оформяне на брада',
      // The holdings' facts, their dots the line's own (fact-line.css).
      'Ваучер 25,00 €Печати 3 от 10Ритъм 9',
    ]);
  });

  it('sets the figure as a display figure in the accent, its unit quiet beside it', async () => {
    const { byId, text } = await mount(LOYALTY_GLANCE.georgi);
    const figure = must(byId('client-loyalty-points-figure'));
    expect(text(figure)).toBe('371');
    expect(figure.getAttribute('data-font')).toBe('title2');
    expect(figure.getAttribute('data-foreground-style')).toBe('accent');
    const unit = must(figure.nextElementSibling);
    expect(text(unit)).toBe('точки');
    expect(unit.getAttribute('data-font')).toBe('callout');
    expect(unit.getAttribute('data-foreground-style')).toBe('secondary');
    // The two stand on one baseline (the stylesheet is the contract).
    const row = cssRule(
      'loyalty-glance/loyalty-glance.css',
      '.loyalty-glance__figure',
    );
    expect(row.get('display')).toBe('flex');
    expect(row.get('align-items')).toBe('baseline');
  });

  it('says what the points buy in primary ink, under the figure', async () => {
    const { byId, text } = await mount(LOYALTY_GLANCE.georgi);
    const sentence = must(byId('client-loyalty-points-sentence'));
    expect(text(sentence)).toBe('Стигат за безплатно оформяне на брада');
    expect(sentence.getAttribute('data-font')).toBe('callout');
    expect(sentence.hasAttribute('data-foreground-style')).toBe(false);
  });

  it('lists the holdings as facts of one quiet line, each fact primary ink at weight 500 on its own id', async () => {
    const { byId, text } = await mount(LOYALTY_GLANCE.georgi);
    const line = must(byId('client-loyalty-holdings'));
    expect(line.getAttribute('data-font')).toBe('subheadline');
    expect(line.getAttribute('data-foreground-style')).toBe('secondary');
    // Three facts of one line (fact-line.css): the dots between them are
    // the line's, drawn only between two facts on one line.
    expect(line.classList).toContain('fact-line');
    expect(
      [...line.querySelectorAll('.fact-line__fact')].map((fact) => text(fact)),
    ).toEqual(['Ваучер 25,00 €', 'Печати 3 от 10', 'Ритъм 9']);
    for (const [id, value] of [
      ['client-loyalty-voucher', '25,00 €'],
      ['client-loyalty-stamps', '3 от 10'],
      ['client-loyalty-rhythm', '9'],
    ] as const) {
      const fact = must(byId(id), id);
      expect(text(fact)).toBe(value);
      expect(fact.getAttribute('data-foreground-style')).toBe('primary');
      expect(fact.getAttribute('data-weight')).toBe('medium');
      // A fact and its label are one word to the line breaker.
      expect(
        fact.parentElement?.classList.contains('loyalty-glance__holding'),
      ).toBe(true);
    }
    // No joint in the words: a wrapped line neither ends nor opens on a
    // dot — the dot of a fact that opens a line is clipped by the row.
    expect(line.textContent).not.toContain('·');
    expect(line.querySelector('.loyalty-glance__joint')).toBeNull();
    expect(cssRule('fact-line.css', '.fact-line').get('overflow-x')).toBe(
      'clip',
    );
    expect(
      cssRule(
        'fact-line.css',
        '.fact-line__fact:not(:first-child)::before',
      ).get('content'),
    ).toBe("'·' / ''");
    expect(
      cssRule(
        'loyalty-glance/loyalty-glance.css',
        '.loyalty-glance__holding',
      ).get('white-space'),
    ).toBe('nowrap');
  });

  it('a tap opens the wallet, once', async () => {
    const { byId, out, fixture } = await mount(LOYALTY_GLANCE.georgi);
    must(byId<HTMLButtonElement>('client-loyalty-points')).click();
    fixture.detectChanges();
    expect(out.opened).toBe(1);
  });

  it('wears the pass’s two discs as a wash, decoration only', async () => {
    const { byId } = await mount(LOYALTY_GLANCE.georgi);
    const discs = [
      ...must(byId('client-loyalty-points')).querySelectorAll(
        '.loyalty-glance__disc',
      ),
    ];
    expect(discs).toHaveLength(2);
    for (const disc of discs)
      expect(disc.getAttribute('aria-hidden')).toBe('true');
    const disc = cssRule(
      'loyalty-glance/loyalty-glance.css',
      '.loyalty-glance__disc',
    );
    expect(disc.get('background')).toContain(
      'var(--sys-color-accent) var(--sys-alpha-tint)',
    );
    expect(disc.get('pointer-events')).toBe('none');
    // The card clips them: nothing paints outside it.
    expect(
      cssRule('loyalty-glance/loyalty-glance.css', '.loyalty-glance__card').get(
        'overflow',
      ),
    ).toBe('clip');
  });
});

describe('lib-loyalty-glance — what is absent is absent', () => {
  it('«Още 42 до …» with one holding: one fact, no joint', async () => {
    const { byId, text, host } = await mount(LOYALTY_GLANCE.toNext);
    expect(text(byId('client-loyalty-points-figure'))).toBe('78');
    expect(text(byId('client-loyalty-points-sentence'))).toBe(
      'Още 42 до безплатно оформяне на брада',
    );
    expect(text(byId('client-loyalty-holdings'))).toBe('Ритъм 2');
    expect(byId('client-loyalty-voucher')).toBeNull();
    expect(byId('client-loyalty-stamps')).toBeNull();
    expect(host.querySelectorAll('.fact-line__fact')).toHaveLength(1);
  });

  it('with `loyalty.points` off the first holding leads as the figure: no unit, no sentence', async () => {
    const { byId, text, host } = await mount(LOYALTY_GLANCE.pointsOff);
    const figure = must(byId('client-loyalty-points-figure'));
    expect(text(figure)).toBe('25,00 €');
    expect(figure.getAttribute('data-foreground-style')).toBe('accent');
    expect(host.querySelector('.loyalty-glance__unit')).toBeNull();
    expect(byId('client-loyalty-points-sentence')).toBeNull();
    expect(
      [...host.querySelectorAll('.fact-line__fact')].map((fact) => text(fact)),
    ).toEqual(['Ваучер 25,00 €', 'Печати 3 от 10']);
  });

  it('with nothing held there is no holdings line', async () => {
    const { byId, text } = await mount(LOYALTY_GLANCE.bare);
    expect(text(byId('client-loyalty-points-figure'))).toBe('50');
    expect(byId('client-loyalty-points-sentence')).not.toBeNull();
    expect(byId('client-loyalty-holdings')).toBeNull();
  });
});

describe('lib-loyalty-glance — the law', () => {
  it('declares no `color:` and no `font:`: the figure’s orange is the display modifier on a title2, the wash is a background', () => {
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/(^|[^-])color\s*:/m);
    expect(rules).not.toMatch(/\bfont\s*:/);
    // The accent appears as a background only, inside a tint.
    for (const match of rules.matchAll(/var\(--sys-color-accent\)/g)) {
      const before = rules.slice(0, match.index);
      expect(before.lastIndexOf('background')).toBeGreaterThan(
        before.lastIndexOf('{'),
      );
    }
  });
});
