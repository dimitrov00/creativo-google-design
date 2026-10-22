import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Injectable, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type Translation,
  type TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ClientCardStore } from '../client-card.store';
import { cardRuntimeProviders } from '../../testing/achievements-pages.rig';
import type { MedalsGlanceVm } from '../client-pages.vm';
import {
  MEDALS,
  MEDALS_GLANCE,
  tileOf,
} from '../../testing/client-pages.vm-fixtures';
import { catalogueOf, must } from '../../testing/client-card.fixtures';
import { cssRule } from '../../testing/css-rule';
import { stubResizeObserver } from '../../testing/achievements-pages.rig';
import { MedalsGlance } from './medals-glance';

/*
 * THE DRAWING of `lib-medals-glance` (client-card-revision-3 §2.1.3 G1,
 * §3.12): a hand-built model in, ONE white card out — three named medals
 * in a grid (never a rail), the cue, the records line as one button. The
 * medal's ring, its numeral and its row rule are the DS's and are pinned
 * in `medal.spec.ts`; here is what the card asks of them and what it adds.
 */

@Injectable()
class CatalogueLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(catalogueOf(lang === 'en' ? 'en' : 'bg'));
  }
}

@Component({
  imports: [MedalsGlance],
  template: `<lib-medals-glance
    [vm]="vm()"
    (openMedal)="medals.push($event)"
    (openRecords)="records = records + 1"
  />`,
})
class Host {
  readonly vm = signal<MedalsGlanceVm>(MEDALS_GLANCE.georgi);
  readonly medals: string[] = [];
  records = 0;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mount(vm: MedalsGlanceVm) {
  TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      ClientCardStore,
      ...cardRuntimeProviders(),
      ...provideTransloco({
        config: {
          availableLangs: ['bg', 'en'],
          defaultLang: 'bg',
          fallbackLang: 'bg',
          missingHandler: { logMissingKey: false },
        },
        loader: CatalogueLoader,
      }),
    ],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.vm.set(vm);
  fixture.detectChanges();
  await settle();
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    host.querySelector<T>(`[data-testid="${id}"]`);
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const render = async () => {
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  };
  return { fixture, host, byId, text, render, out: fixture.componentInstance };
}

const CSS = readFileSync(resolve(__dirname, 'medals-glance.css'), 'utf8');

describe('lib-medals-glance — Георги: three medals, a cue, two records', () => {
  it('is ONE white elevated card holding a grid of three, never a rail', async () => {
    const { byId, host } = await mount(MEDALS_GLANCE.georgi);
    const card = must(byId('client-achievements-strip'));
    expect(card.tagName).toBe('UI-CARD');
    expect(card.getAttribute('data-tone')).toBe('elevated');
    expect(card.getAttribute('data-padding')).toBe('comfortable');
    const grid = must(card.querySelector<HTMLElement>('ui-grid'));
    expect(grid.getAttribute('role')).toBe('list');
    expect(grid.getAttribute('aria-label')).toBe('Постижения');
    expect(grid.style.getPropertyValue('--ui-grid-columns')).toBe('3');
    // No gap: the tiles share the card's measure (82 at 330, §2.1.6), so
    // «Есен 2026» holds one line under its ring.
    expect(grid.getAttribute('data-spacing')).toBe('none');
    expect(host.querySelector('ui-scroll-row')).toBeNull();
  });

  it('names every medal at the large rung and captions none: the shared tile, each opening its family', async () => {
    const { byId, text, host, out, render } = await mount(MEDALS_GLANCE.georgi);
    const tiles = [...host.querySelectorAll('lib-achievement-tile')];
    expect(tiles).toHaveLength(3);
    for (const tile of tiles)
      expect(tile.getAttribute('role')).toBe('listitem');
    const ids = ['service-fade', 'barber-ivan', 'season-autumn-2026'];
    for (const [index, id] of ids.entries()) {
      const medal = must(byId<HTMLButtonElement>(`client-medal-${id}`), id);
      expect(medal.tagName).toBe('BUTTON');
      expect(medal.classList.contains('ui-medal')).toBe(true);
      expect(medal.getAttribute('data-control-size')).toBe('large');
      expect(medal.hasAttribute('data-tile')).toBe(true);
      expect(medal.closest('lib-achievement-tile')).toBe(tiles.at(index));
      expect(medal.querySelector('.ui-medal__caption')).toBeNull();
      expect(medal.querySelector('ui-gauge.ui-medal__ring')).not.toBeNull();
    }
    expect(
      tiles.map((tile) => text(tile.querySelector('.ui-medal__title'))),
    ).toEqual(['Фейд', 'С Иван', 'Есен 2026']);
    // The rim numeral is the highest earned level.
    expect(
      text(
        byId('client-medal-service-fade')?.querySelector('.ui-medal__level'),
      ),
    ).toBe('II');
    must(byId<HTMLButtonElement>('client-medal-barber-ivan')).click();
    await render();
    expect(out.medals).toEqual(['barber-ivan']);
  });

  it('says the cue in primary ink under the medals', async () => {
    const { byId, text } = await mount(MEDALS_GLANCE.georgi);
    const cue = must(byId('client-achievements-cue'));
    expect(cue.tagName).toBe('P');
    expect(text(cue)).toBe('С това посещение: Есен 2026, ниво II');
    expect(cue.getAttribute('data-font')).toBe('callout');
    expect(cue.hasAttribute('data-foreground-style')).toBe(false);
    const rule = cssRule(
      'medals-glance/medals-glance.css',
      '.medals-glance__cue',
    );
    expect(rule.get('margin')).toBe('var(--sys-space-regular) 0 0');
  });

  it('draws the records as facts of ONE quiet line that is ONE button to «Рекорди»', async () => {
    const { byId, text, out, render } = await mount(MEDALS_GLANCE.georgi);
    const line = must(byId<HTMLButtonElement>('client-records-line'));
    expect(line.tagName).toBe('BUTTON');
    expect(line.type).toBe('button');
    expect(line.hasAttribute('data-interactive')).toBe(true);
    expect(line.getAttribute('aria-label')).toBe(
      'Рекорди: любима услуга Фейд, най-много за година 13',
    );
    const facts = must(line.querySelector('.medals-glance__facts'));
    expect(facts.getAttribute('aria-hidden')).toBe('true');
    expect(facts.getAttribute('data-font')).toBe('subheadline');
    expect(facts.getAttribute('data-foreground-style')).toBe('secondary');
    // A line of facts (fact-line.css): the records are its items and the
    // «·» is the stylesheet's, drawn only between two facts on one line —
    // at 390, where the two do not share a line, no dot hangs at the
    // break (review 3, round 4).
    expect(facts.classList).toContain('fact-line');
    expect(
      [...facts.querySelectorAll('.fact-line__fact')].map((fact) => text(fact)),
    ).toEqual(['Любима услуга Фейд', 'Най-много за година 13']);
    expect(facts.textContent).not.toContain('·');
    expect(line.querySelector('.medals-glance__joint')).toBeNull();
    for (const [id, value] of [
      ['client-record-favouriteService', 'Фейд'],
      ['client-record-mostVisitsInYear', '13'],
    ] as const) {
      const fact = must(byId(id), id);
      expect(text(fact)).toBe(value);
      expect(fact.getAttribute('data-foreground-style')).toBe('primary');
      expect(fact.getAttribute('data-weight')).toBe('medium');
      expect(fact.closest('.fact-line__fact')).not.toBeNull();
    }
    // A record and its label are one word to the line breaker.
    expect(
      cssRule('medals-glance/medals-glance.css', '.medals-glance__record').get(
        'white-space',
      ),
    ).toBe('nowrap');
    // §2.1.1 draws no glyph on the line: the words are all there is.
    expect(line.querySelector('ui-icon')).toBeNull();
    line.click();
    await render();
    expect(out.records).toBe(1);
    expect(out.medals).toEqual([]);
  });

  it('marks a level earned since the last visit with the quiet «Ново»', async () => {
    const { byId, text } = await mount({
      ...MEDALS_GLANCE.georgi,
      tiles: [tileOf({ ...MEDALS.fade, caption: null, isNew: true })],
    });
    const marker = must(byId('client-medal-service-fade-marker'));
    expect(marker.hasAttribute('uimedalmarker')).toBe(true);
    expect(text(marker)).toBe('Ново');
  });
});

describe('lib-medals-glance — the first level', () => {
  it('draws one medal, no cue and no records line', async () => {
    const { byId, host } = await mount(MEDALS_GLANCE.first);
    expect(host.querySelectorAll('lib-achievement-tile')).toHaveLength(1);
    expect(byId('client-medal-welcome')?.getAttribute('data-state')).toBe(
      'complete',
    );
    expect(byId('client-achievements-cue')).toBeNull();
    expect(byId('client-records-line')).toBeNull();
    expect(host.querySelector('[data-testid^="client-record-"]')).toBeNull();
  });
});

describe('lib-medals-glance — the law', () => {
  it('declares no colour and no font: the card, the rings and the ink are the DS’s', () => {
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/(^|[^-])color\s*:(?!\s*inherit)/m);
    expect(rules).not.toMatch(/\bbackground\s*:(?!\s*none)/);
    expect(rules).not.toMatch(/\bfont\s*:(?!\s*inherit)/);
    expect(rules).not.toMatch(
      /--ui-medal-meter|\.ui-medal__marker|--ui-medal-marker-room/,
    );
  });

  it('the records button hugs its words and keeps its state layer inside the card', () => {
    const rule = cssRule(
      'medals-glance/medals-glance.css',
      '.medals-glance__records',
    );
    expect(rule.get('align-self')).toBe('flex-start');
    expect(rule.get('position')).toBe('relative');
    // The compact step taken back on both sides is inside the card's
    // comfortable padding; the words keep the card's measure.
    expect(rule.get('margin')).toBe(
      'var(--sys-space-compact) calc(-1 * var(--sys-space-compact)) 0',
    );
    expect(rule.get('max-inline-size')).toBe(
      'calc(100% + 2 * var(--sys-space-compact))',
    );
    expect(rule.get('padding')).toBe(
      'var(--sys-space-tight) var(--sys-space-compact)',
    );
  });
});

describe('lib-medals-glance — the narrow column (review 3, F3)', () => {
  it('pads the card regular where a comfortable third of the column would cut «Рожден ден», comfortable again where it holds', async () => {
    const observers = stubResizeObserver();
    try {
      const { byId, host, render } = await mount(MEDALS_GLANCE.georgi);
      const card = () => must(byId('client-achievements-strip'));
      expect(new Set(observers.observed())).toEqual(
        new Set([host.querySelector('lib-medals-glance')]),
      );
      // A 330 phone's 295: a comfortable third is 82 — «Рожден / ден в…».
      observers.resize(295);
      await render();
      expect(card().getAttribute('data-padding')).toBe('regular');
      // A 390 phone's 355: 102.
      observers.resize(355);
      await render();
      expect(card().getAttribute('data-padding')).toBe('comfortable');
    } finally {
      observers.restore();
    }
  });
});
