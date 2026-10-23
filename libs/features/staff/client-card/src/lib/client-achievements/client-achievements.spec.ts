import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cssRule } from '../../testing/css-rule';
import { PersonalRecordKind } from '@core/components';
import type { LoyaltyAccountReadPorts, LoyaltyCatalog } from '@core/ports';
import { BadgeSeriesId, Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { loyaltyCatalogFixture, localDate } from '@core/testing';
import { AchievementScope } from '../client-card.contracts';
import { ClientCardStore } from '../client-card.store';
import {
  GEORGI,
  GEORGI_LOYALTY,
  MARTIN,
  sofia,
  catalogPortsOf,
  georgiContext,
  loyaltyPortsOf,
  martinContext,
  must,
  subjectOf,
} from '../../testing/client-card.fixtures';
import {
  heldCatalogPorts,
  type MountOptions,
  PAGE_TITLE_ID,
  achievementsPageProviders,
  mountAchievementsPage,
  settle,
  stubResizeObserver,
} from '../../testing/achievements-pages.rig';
import { ClientAchievementsPage } from './client-achievements';

/*
 * «ПОСТИЖЕНИЯ», revision 3 (§2.3; R2-G, F9, F11): the page is mounted
 * over the REAL store on Георги's and Мартин's books. What the spec pins
 * is the page's own: the records FIRST as white cards with «Всички ›», the
 * category band in flow that filters everything under it, «Почти
 * спечелени», the season and the events as cards, the collection ring,
 * every category as a GRID on the medal grid's step (never a rail), the
 * fold past nine families, the archive row, every output, and every
 * state's grammar. The tiles' own look is the tile's (`achievement-tile.spec.ts`),
 * a category's body the scope's (`achievement-category.spec.ts`), the
 * words P3's (`medals.presenter.spec.ts`).
 */

/** Георги's card, opened from today's settled fade. */
const GEORGI_CARD: MountOptions = {
  subject: subjectOf(GEORGI),
  context: georgiContext(),
};

const STREAKS_OFF = {
  'client.profile': true,
  'loyalty.points': true,
  'loyalty.streaks': false,
  'loyalty.achievements': true,
  'loyalty.tiers': true,
};

async function mount(options: Partial<MountOptions> = {}) {
  const mounted = await mountAchievementsPage(ClientAchievementsPage, {
    ...GEORGI_CARD,
    ...options,
  });
  const scopes: AchievementScope[] = [];
  const medals: string[] = [];
  let records = 0;
  mounted.fixture.componentInstance.openScope.subscribe((scope) =>
    scopes.push(scope),
  );
  mounted.fixture.componentInstance.openMedal.subscribe((id) =>
    medals.push(id),
  );
  mounted.fixture.componentInstance.openRecords.subscribe(() => {
    records += 1;
  });
  /** The shelves (one category each) in page order, with what each draws. */
  const shelves = () =>
    mounted
      .all('ui-stack[data-testid^="achievements-shelf-"]')
      .map((shelf) => ({
        id: shelf.getAttribute('data-testid'),
        title: mounted.text(shelf.querySelector('h3')),
        count: mounted.text(shelf.querySelector('[uisectiondetail]')),
        tiles: shelf.querySelectorAll('lib-achievement-tile').length,
        fold: mounted.text(shelf.querySelector('[data-testid$="-all"]')),
      }));
  /** The chips' ids, in band order. */
  const chips = () =>
    mounted
      .all('[data-testid^="achievements-chip-"]')
      .map((chip) => chip.getAttribute('data-chip'));
  const pressed = () =>
    mounted
      .all('[data-testid^="achievements-chip-"][aria-pressed="true"]')
      .map((chip) => chip.getAttribute('data-chip'));
  return {
    ...mounted,
    scopes,
    medals,
    records: () => records,
    shelves,
    chips,
    pressed,
  };
}

/** A loyalty port whose family progress fails until it recovers: the catalogue loads, the progress does not. */
function progressFails(): LoyaltyAccountReadPorts & {
  readonly recover: () => void;
} {
  const inner = loyaltyPortsOf();
  let failing = true;
  return {
    loadLoyaltyAccount: (customerId) => inner.loadLoyaltyAccount(customerId),
    listBadgeProgress: async (customerId) =>
      failing
        ? Result.err(RepositoryError.unavailable())
        : inner.listBadgeProgress(customerId),
    listSeasonProgress: (customerId) => inner.listSeasonProgress(customerId),
    recover: () => {
      failing = false;
    },
  };
}

/** Георги's book with nothing earned and nothing under way: the first visit is all it knows. */
function nothingEarned(): LoyaltyAccountReadPorts {
  const georgi = GEORGI_LOYALTY;
  return loyaltyPortsOf([
    {
      ...georgi,
      account: {
        ...georgi.account,
        records: [
          {
            personalRecordKind: PersonalRecordKind.FirstVisit,
            value: 1,
            on: localDate('2026-09-21'),
            year: null,
            serviceId: null,
          },
        ],
        streaks: [],
      },
      badgeProgress: [],
      seasonProgress: [],
    },
  ]);
}

/** The published catalogue with «Специални» grown past nine families: the fold. */
function specialGrown(by: number): LoyaltyCatalog {
  const catalog = loyaltyCatalogFixture();
  const party = must(
    catalog.series.find((series) => series.id === 'series-party'),
    'the party family',
  );
  const extras = Array.from({ length: by }, (_, index) => ({
    ...party,
    id: BadgeSeriesId.of(`series-extra-${index + 1}`),
    title: { bg: `Допълнителен ${index + 1}`, en: `Extra ${index + 1}` },
    order: 10 + index + 1,
  }));
  return { ...catalog, series: [...catalog.series, ...extras] };
}

/**
 * jsdom scrolls nothing: the band's landing is what the page asks of it.
 * The frame stays ASYNCHRONOUS (a timer): Angular's zoneless scheduler
 * races a frame against a timer, and a frame that ran at once would
 * re-enter the check it was scheduled from.
 */
function stubScrolling() {
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    setTimeout(() => callback(0), 0);
    return 0;
  };
  return {
    scrollIntoView,
    restore: () => {
      window.requestAnimationFrame = raf;
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    },
  };
}

afterEach(() => {
  window.dispatchEvent(new Event('online'));
});

describe('ClientAchievementsPage — the head and the records (AA–AE)', () => {
  it('heads the page with the sheet’s large title and the person, and names the page container by it', async () => {
    const { byId, text, host } = await mount();
    const title = byId('achievements-title');
    expect(title?.tagName).toBe('H2');
    expect(title?.id).toBe(PAGE_TITLE_ID);
    expect(title?.hasAttribute('uisheetlargetitle')).toBe(true);
    expect(title?.getAttribute('data-font')).toBe('largeTitle');
    expect(text(title)).toBe('Постижения');
    const subline = byId('achievements-subline');
    expect(text(subline)).toBe('Георги Петров');
    expect(subline?.getAttribute('data-font')).toBe('callout');
    expect(subline?.getAttribute('data-foreground-style')).toBe('secondary');
    // No figure in the head: the collection's count lives once, in the ring.
    expect(host.querySelector('ui-metric')).toBeNull();
    expect(byId('achievements-summary')).toBeNull();
    expect(byId('achievements-offline')).toBeNull();
    expect(byId('achievements-skeleton')).toBeNull();
    expect(byId('achievements-error')).toBeNull();
    // Never a rail: the grids are the page.
    expect(host.querySelector('ui-scroll-row')).toBeNull();
    expect(host.querySelector('lib-achievement-rail')).toBeNull();
  });

  it('puts the RECORDS FIRST: four white cards, 2 × 2, under «Рекорди» with «Всички ›» inside the column', async () => {
    const { byId, text, all, host } = await mount();
    const module = byId('achievements-records');
    // The first module after the head.
    expect(host.querySelector('ui-sheet-headline')?.nextElementSibling).toBe(
      module,
    );
    const header = module?.querySelector('ui-section-header');
    expect(header?.getAttribute('data-header-prominence')).toBe('increased');
    expect(header?.querySelector('.ui-section-header__glyph')).toBeNull();
    const h3 = header?.querySelector('h3');
    expect(text(h3)).toBe('Рекорди');
    const action = byId('achievements-records-all');
    expect(action?.hasAttribute('uisectionaction')).toBe(true);
    expect(action?.getAttribute('data-button-style')).toBe('plain');
    expect(action?.getAttribute('data-control-size')).toBe('small');
    expect(text(action)).toBe('Всички');
    expect(action?.getAttribute('aria-label')).toBe('Всички рекорди');
    expect(action?.querySelector('ui-icon')?.getAttribute('data-name')).toBe(
      'nav.disclosure',
    );
    const grid = module?.querySelector<HTMLElement>('ui-grid');
    expect(grid?.getAttribute('role')).toBe('list');
    expect(grid?.getAttribute('aria-labelledby')).toBe(h3?.id);
    expect(grid?.style.getPropertyValue('--ui-grid-columns')).toBe('2');
    expect(grid?.getAttribute('data-columns')).toBe('2');
    expect(grid?.getAttribute('data-spacing')).toBe('regular');
    expect(
      all('[data-testid^="achievements-record-"]').map((card) => [
        card.tagName,
        card.getAttribute('data-testid'),
      ]),
    ).toEqual([
      ['LIB-RECORD-CARD', 'achievements-record-longestRhythm'],
      ['LIB-RECORD-CARD', 'achievements-record-mostVisitsInYear'],
      ['LIB-RECORD-CARD', 'achievements-record-favouriteService'],
      ['LIB-RECORD-CARD', 'achievements-record-firstVisit'],
    ]);
    const rhythm = byId('achievements-record-longestRhythm');
    const button = rhythm?.querySelector('button.record-card');
    expect(button?.getAttribute('data-tone')).toBe('elevated');
    expect(button?.getAttribute('aria-label')).toBe(
      'Най-дълъг ритъм: 24 посещения, септември 2026 г., нов рекорд',
    );
    expect(text(button?.querySelector('.record-card__figure'))).toBe('24');
    expect(text(button?.querySelector('.record-card__new'))).toBe('Нов рекорд');
    // The favourite's hero is the SERVICE; the first visit is a card (one fact, once: no «Добре дошъл» caption says it any more).
    expect(
      text(
        byId('achievements-record-favouriteService')?.querySelector(
          '.record-card__figure',
        ),
      ),
    ).toBe('Фейд');
    expect(
      byId('achievements-record-favouriteService')
        ?.querySelector('ui-avatar')
        ?.hasAttribute('data-picture'),
    ).toBe(true);
    // The rows size to what they hold — each card is a subgrid of four of
    // them (record-card.spec) — and a lone odd card spans the row (the
    // stylesheet is the contract).
    expect(
      cssRule(
        'client-achievements/client-achievements.css',
        '.client-achievements__records',
      ).get('grid-auto-rows'),
    ).toBe('auto');
    expect(
      cssRule(
        'client-achievements/client-achievements.css',
        ".client-achievements__records[data-columns='2'] > .record-card-host:last-child:nth-child(odd)",
      ).get('grid-column'),
    ).toBe('1 / -1');
  });

  it('opens «Рекорди» from a record card and from «Всички ›»', async () => {
    const { byId, records } = await mount();
    byId('achievements-record-favouriteService')
      ?.querySelector('button')
      ?.click();
    expect(records()).toBe(1);
    byId('achievements-records-all')?.click();
    expect(records()).toBe(2);
  });

  it('hides «Най-дълъг ритъм» with `loyalty.streaks` off: three cards, the third spanning the row', async () => {
    const { all } = await mount({ rig: { flags: STREAKS_OFF } });
    expect(
      all('[data-testid^="achievements-record-"]').map((card) =>
        card.getAttribute('data-testid'),
      ),
    ).toEqual([
      'achievements-record-mostVisitsInYear',
      'achievements-record-favouriteService',
      'achievements-record-firstVisit',
    ]);
  });
});

describe('ClientAchievementsPage — the band (AC) and what it filters', () => {
  it('lays the category chips IN FLOW under the records, «Всички» pressed, and names the region under it by the chosen chip', async () => {
    const { byId, chips, pressed, host } = await mount();
    const band = byId('achievements-chips');
    expect(band?.tagName).toBe('LIB-ACHIEVEMENT-CHIPS');
    expect(byId('achievements-records')?.nextElementSibling).toBe(band);
    expect(band?.querySelector('ui-flow')?.getAttribute('role')).toBe(
      'toolbar',
    );
    expect(band?.querySelector('ui-flow')?.getAttribute('aria-label')).toBe(
      'Категории',
    );
    expect(chips()).toEqual([
      'all',
      'cat-milestones',
      'cat-mastery',
      'cat-barbers',
      'cat-rhythm',
      'cat-special',
      'seasons',
    ]);
    expect(pressed()).toEqual(['all']);
    // Heard with its count, printed without one.
    const mastery = byId('achievements-chip-cat-mastery');
    expect(mastery?.textContent?.trim()).toBe('Майсторство');
    expect(mastery?.getAttribute('aria-label')).toBe(
      'Майсторство, 3 от 9 спечелени',
    );
    const body = byId('achievements-body');
    expect(band?.nextElementSibling).toBe(body);
    expect(body?.tagName).toBe('SECTION');
    expect(body?.getAttribute('data-chip')).toBe('all');
    expect(body?.getAttribute('aria-labelledby')).toBe(
      byId('achievements-chip-all')?.id,
    );
    // Nothing is pinned: the band declares no position (the stylesheet is the contract).
    expect(host.querySelector('[data-pinned]')).toBeNull();
  });

  it('shows ONE category whole under a chip — the scope body embedded in place, the records still above, the page not moved', async () => {
    const { byId, text, store, render, pressed, shelves } = await mount();
    byId('achievements-chip-cat-mastery')?.click();
    await render();
    expect(store.medalsChip()).toBe('cat-mastery');
    expect(pressed()).toEqual(['cat-mastery']);
    expect(byId('achievements-body')?.getAttribute('data-chip')).toBe(
      'cat-mastery',
    );
    // The records stay where they are.
    expect(byId('achievements-records')).not.toBeNull();
    // The overview's modules give way to the category alone.
    expect(byId('achievements-close')).toBeNull();
    expect(byId('achievements-season')).toBeNull();
    expect(byId('achievements-events')).toBeNull();
    expect(byId('achievements-collection')).toBeNull();
    expect(byId('achievements-archive')).toBeNull();
    expect(shelves()).toEqual([]);
    const category = byId('achievements-category');
    expect(category?.tagName).toBe('LIB-ACHIEVEMENT-CATEGORY');
    expect(category?.hasAttribute('data-embedded')).toBe(true);
    expect(category?.querySelector('h2')).toBeNull();
    expect(text(byId('achievements-scope-subline'))).toBe(
      'Майсторство · 3 от 9 спечелени',
    );
    expect(
      [...(category?.querySelectorAll('h3') ?? [])].map((h3) => text(h3)),
    ).toEqual(['Коса', 'Брада', 'Грижа', 'Общи']);
    // Back to the overview.
    byId('achievements-chip-all')?.click();
    await render();
    expect(byId('achievements-category')).toBeNull();
    expect(byId('achievements-close')).not.toBeNull();
    expect(shelves()).toHaveLength(5);
  });

  it('shows the season, the events and the archive under «Сезони», and nothing else', async () => {
    const { byId, store, render, shelves } = await mount();
    store.setMedalsChip('seasons');
    await render();
    expect(byId('achievements-body')?.getAttribute('data-chip')).toBe(
      'seasons',
    );
    expect(byId('achievements-season')).not.toBeNull();
    expect(byId('achievements-events')).not.toBeNull();
    expect(byId('achievements-archive')).not.toBeNull();
    expect(byId('achievements-close')).toBeNull();
    expect(byId('achievements-collection')).toBeNull();
    expect(byId('achievements-category')).toBeNull();
    expect(shelves()).toEqual([]);
  });

  it('opens a family’s detail from a chip’s category and a scope from the chips’ season, as from the overview', async () => {
    const { byId, store, render, medals, scopes } = await mount();
    store.setMedalsChip('cat-mastery');
    await render();
    byId('achievements-scope-series-svc-beard')?.click();
    expect(medals).toEqual(['series-svc-beard']);
    store.setMedalsChip('seasons');
    await render();
    byId('achievements-season-season-2026-autumn')?.click();
    expect(scopes).toEqual([
      {
        achievementScope: AchievementScope.Season,
        seasonId: 'season-2026-autumn',
      },
    ]);
  });

  it('lands with the band under the bar when opened on a chip (the glance’s and a detail’s «Всички ›»), and not otherwise', async () => {
    const scrolling = stubScrolling();
    try {
      await TestBed.configureTestingModule({
        imports: [ClientAchievementsPage],
        providers: achievementsPageProviders(),
        errorOnUnknownElements: true,
        errorOnUnknownProperties: true,
      }).compileComponents();
      const transloco = TestBed.inject(TranslocoService);
      transloco.setActiveLang('bg');
      await firstValueFrom(transloco.selectTranslation('bg'));
      const store = TestBed.inject(ClientCardStore);
      store.open(GEORGI_CARD.subject, GEORGI_CARD.context);
      store.setMedalsChip('cat-mastery');
      const fixture = TestBed.createComponent(ClientAchievementsPage);
      fixture.componentRef.setInput('titleId', PAGE_TITLE_ID);
      fixture.detectChanges();
      await settle();
      fixture.detectChanges();
      await fixture.whenStable();
      await settle();
      expect(scrolling.scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrolling.scrollIntoView.mock.instances[0]).toBe(
        (fixture.nativeElement as HTMLElement).querySelector(
          'lib-achievement-chips',
        ),
      );
      expect(scrolling.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    } finally {
      scrolling.restore();
    }
  });

  it('keeps its chip across a push and back: the store holds it', async () => {
    const { byId, store, render, pressed } = await mount();
    byId('achievements-chip-cat-rhythm')?.click();
    await render();
    expect(store.medalsChip()).toBe('cat-rhythm');
    TestBed.resetTestingModule();
    expect(pressed()).toEqual(['cat-rhythm']);
  });
});

describe('ClientAchievementsPage — the overview (AF–AM, AJ)', () => {
  it('draws «Почти спечелени» as ONE row of three on a white card, no action, each tile a medal in its ring', async () => {
    const { byId, text, all } = await mount();
    const module = byId('achievements-close');
    const header = module?.querySelector('ui-section-header');
    expect(header?.getAttribute('data-header-prominence')).toBe('increased');
    expect(text(header?.querySelector('h3'))).toBe('Почти спечелени');
    expect(header?.querySelector('[uisectionaction]')).toBeNull();
    const card = module?.querySelector('ui-card');
    expect(card?.getAttribute('data-tone')).toBe('elevated');
    expect(card?.getAttribute('data-padding')).toBe('regular');
    const grid = card?.querySelector<HTMLElement>('ui-grid');
    expect(grid?.getAttribute('role')).toBe('list');
    expect(grid?.style.getPropertyValue('--ui-grid-columns')).toBe('3');
    expect(grid?.getAttribute('aria-labelledby')).toBe(
      header?.querySelector('h3')?.id,
    );
    expect(
      all('[data-testid="achievements-close"] button.ui-medal').map((medal) =>
        medal.getAttribute('data-testid'),
      ),
    ).toEqual([
      'achievements-close-series-svc-fade',
      'achievements-close-series-self-service',
      'achievements-close-series-weekend',
    ]);
    const fade = byId('achievements-close-series-svc-fade');
    expect(fade?.getAttribute('data-state')).toBe('earned');
    expect(fade?.getAttribute('data-control-size')).toBe('large');
    expect(fade?.querySelector('ui-gauge.ui-medal__ring')).not.toBeNull();
    expect(text(fade?.querySelector('.ui-medal__level'))).toBe('II');
    expect(text(fade?.querySelector('.ui-medal__title'))).toBe('Фейд');
    expect(text(fade?.querySelector('.ui-medal__caption'))).toBe(
      '24/25 до III',
    );
    // A level still to come is never «Ново».
    expect(module?.querySelector('[uimedalmarker]')).toBeNull();
  });

  it('draws the running season as ONE white card button: its medal in its ring beside one sentence, ALL its families three across a phone, the dates on the heading', async () => {
    const { byId, text } = await mount();
    const module = byId('achievements-season');
    expect(text(module?.querySelector('h3'))).toBe('Есен 2026');
    expect(text(module?.querySelector('[uisectiondetail]'))).toBe(
      '1.09 – 30.11',
    );
    const card = byId<HTMLButtonElement>(
      'achievements-season-season-2026-autumn',
    );
    expect(card?.tagName).toBe('BUTTON');
    expect(card?.getAttribute('type')).toBe('button');
    expect(card?.getAttribute('data-tone')).toBe('elevated');
    expect(card?.getAttribute('data-padding')).toBe('comfortable');
    expect(card?.hasAttribute('data-interactive')).toBe(true);
    expect(card?.getAttribute('aria-label')).toBe(
      'Есен 2026: ниво II, до 30 ноември',
    );
    // No ladder here: the I–V track is the season PAGE's.
    expect(
      card?.querySelector('ui-gauge[data-gauge-style="steps"]'),
    ).toBeNull();
    const medals = [...(card?.querySelectorAll('ui-medal') ?? [])];
    expect(medals[0]?.getAttribute('data-control-size')).toBe('large');
    expect(text(medals[0]?.querySelector('.ui-medal__level'))).toBe('II');
    expect(text(card?.querySelector('.client-achievements__sentence'))).toBe(
      'Ниво II · още 1 посещение до III',
    );
    const families = byId<HTMLElement>('achievements-season-families');
    expect(families?.tagName).toBe('UI-GRID');
    expect(families?.style.getPropertyValue('--ui-grid-columns')).toBe('3');
    expect(families?.getAttribute('data-spacing')).toBe('compact');
    expect(families?.getAttribute('aria-hidden')).toBe('true');
    expect(
      [...(families?.querySelectorAll('ui-medal') ?? [])].map((medal) => [
        medal.getAttribute('data-control-size'),
        medal.getAttribute('data-state'),
        text(medal.querySelector('.ui-medal__title')),
        text(medal.querySelector('.ui-medal__caption')),
      ]),
    ).toEqual([
      ['regular', 'complete', 'Есенно утро', '28.09'],
      ['regular', 'inProgress', 'Всеки есенен месец', '1/3'],
      ['regular', 'notStarted', 'Есенна брада', '0/2'],
      ['regular', 'notStarted', 'Приятел наесен', '0/1'],
    ]);
    // All of them: no «+N», no count caption.
    expect(byId('achievements-season-more')).toBeNull();
    expect(text(card)).not.toContain('Сезонни');
    expect(text(card)).not.toContain('30.11');
  });

  it('stacks the events as white card buttons: the name beside its date, all its families under them', async () => {
    const { byId, text } = await mount();
    const module = byId('achievements-events');
    const card = byId('achievements-event-event-2026-beard-week');
    expect(module?.contains(card)).toBe(true);
    expect(card?.tagName).toBe('BUTTON');
    expect(card?.getAttribute('data-tone')).toBe('elevated');
    expect(card?.getAttribute('aria-label')).toBe(
      'Седмица на брадата, 0 от 2, до 5 октомври',
    );
    const title = card?.querySelector('.client-achievements__event-title');
    expect(text(title)).toBe('Седмица на брадата');
    expect(title?.getAttribute('data-font')).toBe('headline');
    const when = title?.nextElementSibling;
    expect(text(when)).toBe('до 5.10');
    expect(when?.getAttribute('data-font')).toBe('subheadline');
    expect(when?.getAttribute('data-foreground-style')).toBe('secondary');
    expect(card?.querySelectorAll('ui-medal')).toHaveLength(2);
    // The season's own three columns: two families hug two tiles.
    expect(
      card
        ?.querySelector<HTMLElement>('ui-grid')
        ?.style.getPropertyValue('--ui-grid-columns'),
    ).toBe('3');
  });

  it('draws the collection as a ring with ONE number in its centre and two lines beside it, a meter heard as one sentence', async () => {
    const { byId, text } = await mount();
    const module = byId('achievements-collection');
    const ring = module?.querySelector('ui-gauge');
    expect(ring?.getAttribute('role')).toBe('meter');
    expect(ring?.getAttribute('data-gauge-style')).toBe('circularCapacity');
    expect(ring?.getAttribute('data-control-size')).toBe('large');
    expect(ring?.getAttribute('aria-valuenow')).toBe('15');
    expect(ring?.getAttribute('aria-valuemax')).toBe('38');
    expect(ring?.getAttribute('aria-valuetext')).toBe(
      'Колекция: 15 от 38 медала, 37 спечелени нива',
    );
    expect(text(ring?.querySelector('[uicurrentvaluelabel]'))).toBe('15');
    const lines = module?.querySelector(
      '.client-achievements__collection-lines',
    );
    expect(lines?.getAttribute('aria-hidden')).toBe('true');
    const [first, second] = [...(lines?.children ?? [])];
    expect(text(first)).toBe('от 38 медала');
    expect(first?.getAttribute('data-font')).toBe('callout');
    expect(first?.getAttribute('data-weight')).toBe('semibold');
    expect(text(second)).toBe('37 спечелени нива');
    expect(second?.getAttribute('data-font')).toBe('subheadline');
    expect(second?.getAttribute('data-foreground-style')).toBe('secondary');
    // A ring that stands alone takes the heavier stroke, on the gauge element itself.
    expect(ring?.classList).toContain('client-achievements__collection-ring');
    expect(
      cssRule(
        'client-achievements/client-achievements.css',
        '.client-achievements__collection-ring',
      ).get('--ui-gauge-stroke'),
    ).toBe('calc(var(--sys-space-unit) * 1.25)');
  });

  it('draws every category as a GRID on a white card, three across, its count as text on the heading, whole up to nine families', async () => {
    const { byId, text, shelves } = await mount();
    expect(shelves()).toEqual([
      {
        id: 'achievements-shelf-cat-milestones',
        title: 'Етапи',
        count: '3 от 5',
        tiles: 5,
        fold: null,
      },
      {
        id: 'achievements-shelf-cat-mastery',
        title: 'Майсторство',
        count: '3 от 9',
        tiles: 9,
        fold: null,
      },
      {
        id: 'achievements-shelf-cat-barbers',
        title: 'Бръснари и салони',
        count: '2 от 7',
        tiles: 7,
        fold: null,
      },
      {
        id: 'achievements-shelf-cat-rhythm',
        title: 'Ритъм',
        count: '2 от 3',
        tiles: 3,
        fold: null,
      },
      {
        id: 'achievements-shelf-cat-special',
        title: 'Специални',
        count: '3 от 7',
        tiles: 7,
        fold: null,
      },
    ]);
    expect(byId('achievements-shelf-cat-records')).toBeNull();
    const mastery = byId('achievements-shelf-cat-mastery');
    const header = mastery?.querySelector('ui-section-header');
    expect(header?.getAttribute('data-header-prominence')).toBe('increased');
    expect(header?.querySelector('.ui-section-header__glyph')).toBeNull();
    // The count is text, not a button.
    expect(header?.querySelector('button')).toBeNull();
    const card = mastery?.querySelector('ui-card');
    expect(card?.getAttribute('data-tone')).toBe('elevated');
    expect(card?.getAttribute('data-padding')).toBe('regular');
    const grid = card?.querySelector<HTMLElement>('ui-grid');
    expect(grid?.getAttribute('role')).toBe('list');
    expect(grid?.style.getPropertyValue('--ui-grid-columns')).toBe('3');
    expect(grid?.getAttribute('data-spacing')).toBe('compact');
    expect(grid?.getAttribute('data-row-spacing')).toBe('regular');
    expect(grid?.getAttribute('aria-labelledby')).toBe(
      header?.querySelector('h3')?.id,
    );
    // Earned first, then in progress, then the dashed silhouettes.
    expect(
      [...(grid?.querySelectorAll('button.ui-medal') ?? [])].map((medal) =>
        medal.getAttribute('data-state'),
      ),
    ).toEqual([
      'earned',
      'earned',
      'earned',
      'notStarted',
      'notStarted',
      'notStarted',
      'notStarted',
      'notStarted',
      'notStarted',
    ]);
    expect(
      byId('achievements-shelf-cat-mastery-series-svc-fade')?.tagName,
    ).toBe('BUTTON');
    expect(
      byId('achievements-shelf-cat-mastery-series-svc-classic-cut')
        ?.querySelector('ui-gauge.ui-medal__ring')
        ?.getAttribute('data-extent'),
    ).toBe('dashed');
    expect(text(byId('achievements-shelf-cat-mastery-all'))).toBeNull();
  });

  it('marks a level earned since the previous visit «Ново», in the band its row makes for it', async () => {
    const { byId, text } = await mount();
    const marker = byId('achievements-shelf-cat-rhythm-series-rhythm-marker');
    expect(text(marker)).toBe('Ново');
    expect(marker?.getAttribute('data-tone')).toBe('accent');
    expect(marker?.getAttribute('aria-hidden')).toBe('true');
    expect(
      byId('achievements-shelf-cat-rhythm-series-rhythm')?.getAttribute(
        'data-state',
      ),
    ).toBe('complete');
  });

  it('folds a category past nine families to two rows and «Покажи всички N», which chooses its chip and brings the band under the bar', async () => {
    const scrolling = stubScrolling();
    try {
      const { byId, text, store, render, shelves, pressed } = await mount({
        rig: { catalog: catalogPortsOf(specialGrown(3)) },
      });
      expect(
        shelves().find(
          (shelf) => shelf.id === 'achievements-shelf-cat-special',
        ),
      ).toEqual({
        id: 'achievements-shelf-cat-special',
        title: 'Специални',
        count: '3 от 10',
        tiles: 6,
        fold: 'Покажи всички 10',
      });
      const fold = byId('achievements-shelf-cat-special-all');
      expect(fold?.tagName).toBe('BUTTON');
      expect(fold?.getAttribute('data-button-style')).toBe('plain');
      expect(fold?.getAttribute('data-control-size')).toBe('regular');
      expect(fold?.closest('ui-card')).not.toBeNull();
      expect(
        cssRule(
          'client-achievements/client-achievements.css',
          '.client-achievements__fold',
        ).get('align-self'),
      ).toBe('center');
      fold?.click();
      await render();
      expect(store.medalsChip()).toBe('cat-special');
      expect(pressed()).toEqual(['cat-special']);
      expect(text(byId('achievements-scope-subline'))).toBe(
        'Специални · 3 от 10 спечелени',
      );
      // The category whole, no fold.
      expect(
        byId('achievements-category')?.querySelectorAll('button.ui-medal'),
      ).toHaveLength(10);
      await settle();
      expect(scrolling.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    } finally {
      scrolling.restore();
    }
  });

  it('ends on one lone row to the archive', async () => {
    const { byId, text, host } = await mount();
    const row = byId('achievements-archive');
    expect(row?.tagName).toBe('BUTTON');
    expect(row?.classList).toContain('ui-list-row');
    expect(row?.getAttribute('data-size')).toBe('large');
    expect(row?.hasAttribute('data-interactive')).toBe(true);
    expect(row?.closest('ul')?.classList).toContain('ui-list-group');
    expect(row?.getAttribute('aria-label')).toBe('Минали сезони и събития, 1');
    expect(text(row)).toBe('Минали сезони и събития 1');
    expect(
      host.querySelector('[data-testid="achievements-body"]')?.lastElementChild,
    ).toBe(row?.closest('ul'));
  });

  it('opens a family from a medal and a scope from everything else', async () => {
    const { byId, medals, scopes } = await mount();
    byId('achievements-close-series-svc-fade')?.click();
    byId('achievements-shelf-cat-barbers-series-barber-ivan')?.click();
    expect(medals).toEqual(['series-svc-fade', 'series-barber-ivan']);

    byId('achievements-season-season-2026-autumn')?.click();
    byId('achievements-event-event-2026-beard-week')?.click();
    byId('achievements-archive')?.click();
    expect(scopes).toEqual([
      {
        achievementScope: AchievementScope.Season,
        seasonId: 'season-2026-autumn',
      },
      {
        achievementScope: AchievementScope.Season,
        seasonId: 'event-2026-beard-week',
      },
      { achievementScope: AchievementScope.Archive },
    ]);
  });

  it('keeps every origin clear of the bar and the dock when the editor focuses it again', async () => {
    const { byId } = await mount();
    for (const id of [
      'achievements-records-all',
      'achievements-season-season-2026-autumn',
      'achievements-event-event-2026-beard-week',
      'achievements-archive',
    ]) {
      expect(byId(id)?.classList.contains('client-achievements__origin')).toBe(
        true,
      );
    }
    expect(
      byId('achievements-record-longestRhythm')?.classList.contains(
        'client-achievements__origin',
      ),
    ).toBe(true);
    expect(
      cssRule(
        'client-achievements/client-achievements.css',
        '.client-achievements__origin',
      ).get('scroll-margin-block'),
    ).toBe('var(--modal-sheet-origin-margin)');
    expect(
      byId('achievements-close-series-svc-fade')?.classList.contains(
        'achievement-tile__medal',
      ),
    ).toBe(true);
  });

  it('keeps the modules at the stack’s gap, and declares no font of its own (the stylesheet is the contract)', () => {
    expect(
      cssRule('client-achievements/client-achievements.css', ':host').get(
        'gap',
      ),
    ).toBe('var(--sys-space-loose)');
    expect(
      cssRule(
        'client-achievements/client-achievements.css',
        '.client-achievements__body',
      ).get('gap'),
    ).toBe('var(--sys-space-loose)');
  });

  it('words the page in English too', async () => {
    const { byId, text } = await mount({ lang: 'en' });
    expect(text(byId('achievements-title'))).toBe('Achievements');
    expect(text(byId('achievements-records')?.querySelector('h3'))).toBe(
      'Records',
    );
    expect(text(byId('achievements-close')?.querySelector('h3'))).toBe(
      'Almost earned',
    );
    expect(
      byId('achievements-chips')
        ?.querySelector('ui-flow')
        ?.getAttribute('aria-label'),
    ).toBe('Categories');
  });
});

describe('ClientAchievementsPage — the widths (§2.3.2 «Grid metrics»)', () => {
  it('lays three of 87 at 330 (the card’s padding given to the tiles), three at 390, four from 600 — the records two across until a card keeps 150', async () => {
    const observers = stubResizeObserver();
    try {
      const { byId, host, render } = await mount();
      // Measured twice — the grid's step and the families' columns — on the
      // one host; every record card measures itself for its word's rung.
      expect(observers.observed()).toContain(host);
      expect(new Set(observers.observed()).size).toBe(
        1 + host.querySelectorAll('lib-record-card').length,
      );
      const grid = () =>
        byId('achievements-shelf-cat-mastery')?.querySelector<HTMLElement>(
          'ui-grid',
        );
      const card = () =>
        byId('achievements-shelf-cat-mastery')?.querySelector('ui-card');
      const records = () =>
        byId('achievements-records')?.querySelector<HTMLElement>('ui-grid');
      const season = () => byId('achievements-season-season-2026-autumn');
      const families = () => byId<HTMLElement>('achievements-season-families');
      observers.resize(295);
      await render();
      expect(grid()?.style.getPropertyValue('--ui-grid-columns')).toBe('3');
      expect(grid()?.getAttribute('data-inset')).toBe('tight');
      expect(grid()?.getAttribute('data-spacing')).toBe('tight');
      expect(card()?.getAttribute('data-padding')).toBe('compact');
      expect(records()?.style.getPropertyValue('--ui-grid-columns')).toBe('2');
      // The season card gives its gap and a step of its padding to its three
      // families (93 of a 295); the stylesheet takes the step back.
      expect(season()?.getAttribute('data-padding')).toBe('regular');
      expect(families()?.style.getPropertyValue('--ui-grid-columns')).toBe('3');
      expect(families()?.getAttribute('data-spacing')).toBe('none');
      expect(families()?.getAttribute('data-bleed')).toBe('compact');
      expect(
        cssRule(
          'client-achievements/client-achievements.css',
          ".client-achievements__families[data-bleed='compact']",
        ).get('margin-inline'),
      ).toBe('calc(-1 * var(--sys-space-compact))');
      expect(
        cssRule(
          'client-achievements/client-achievements.css',
          ".client-achievements__grid[data-inset='tight']",
        ).get('padding'),
      ).toBe('var(--sys-space-tight)');
      observers.resize(355);
      await render();
      expect(grid()?.style.getPropertyValue('--ui-grid-columns')).toBe('3');
      expect(grid()?.hasAttribute('data-inset')).toBe(false);
      expect(card()?.getAttribute('data-padding')).toBe('regular');
      expect(season()?.getAttribute('data-padding')).toBe('comfortable');
      expect(families()?.style.getPropertyValue('--ui-grid-columns')).toBe('3');
      expect(families()?.getAttribute('data-spacing')).toBe('compact');
      expect(families()?.hasAttribute('data-bleed')).toBe(false);
      observers.resize(600);
      await render();
      expect(grid()?.style.getPropertyValue('--ui-grid-columns')).toBe('4');
      expect(card()?.getAttribute('data-padding')).toBe('comfortable');
      // A 600 column lays four medals, but four records would be 138 wide:
      // the records stay 2 × 2 (review 3, round 2).
      expect(records()?.style.getPropertyValue('--ui-grid-columns')).toBe('2');
      expect(records()?.getAttribute('data-columns')).toBe('2');
      expect(families()?.style.getPropertyValue('--ui-grid-columns')).toBe('4');
      // Four across only where a card keeps 150: four of 150 and three gaps.
      observers.resize(648);
      await render();
      expect(records()?.style.getPropertyValue('--ui-grid-columns')).toBe('4');
      observers.resize(647);
      await render();
      expect(records()?.style.getPropertyValue('--ui-grid-columns')).toBe('2');
      // «Почти спечелени» keeps its one row of three at every width.
      expect(
        byId('achievements-close')
          ?.querySelector<HTMLElement>('ui-grid')
          ?.style.getPropertyValue('--ui-grid-columns'),
      ).toBe('3');
    } finally {
      observers.restore();
    }
  });

  it('lays four across the ≥ 761 px dialog’s nominal column, the season’s families four too (never eight) — and the records two (a 528 column holds no four cards of 150)', async () => {
    const view = document.defaultView as Window;
    Object.defineProperty(view, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (media: string) => ({
        matches: media === '(min-width: 761px)',
        media,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    try {
      const { byId } = await mount();
      expect(
        byId('achievements-shelf-cat-mastery')
          ?.querySelector<HTMLElement>('ui-grid')
          ?.style.getPropertyValue('--ui-grid-columns'),
      ).toBe('4');
      expect(
        byId('achievements-records')
          ?.querySelector<HTMLElement>('ui-grid')
          ?.style.getPropertyValue('--ui-grid-columns'),
      ).toBe('2');
      expect(
        byId<HTMLElement>(
          'achievements-season-families',
        )?.style.getPropertyValue('--ui-grid-columns'),
      ).toBe('4');
    } finally {
      Reflect.deleteProperty(view, 'matchMedia');
    }
  });
});

describe('ClientAchievementsPage — Мартин in the chair on his birthday', () => {
  it('leads «Почти спечелени» with what this very visit completes, and names him', async () => {
    const { byId, text } = await mount({
      subject: subjectOf(MARTIN),
      context: martinContext(),
    });
    expect(text(byId('achievements-subline'))).toBe('Мартин Илиев');
    const first = byId('achievements-close')?.querySelector(
      'lib-achievement-tile button',
    );
    expect(first?.getAttribute('data-testid')).toBe(
      'achievements-close-series-birthday',
    );
    expect(text(first?.querySelector('.ui-medal__caption'))).toBe(
      'с това посещение',
    );
    expect(
      text(
        byId('achievements-record-longestRhythm')?.querySelector(
          '.record-card__figure',
        ),
      ),
    ).toBe('13');
  });
});

describe('ClientAchievementsPage — states (§2.3.5)', () => {
  it('holds shaped placeholders — four record blocks, two rows of chips, one grid of six discs — while the catalogue is on its way, then lands', async () => {
    const catalog = heldCatalogPorts();
    const { byId, all, render, text } = await mount({ rig: { catalog } });
    const skeleton = byId('achievements-skeleton');
    expect(skeleton?.getAttribute('aria-busy')).toBe('true');
    expect(
      skeleton
        ?.querySelector<HTMLElement>('ui-grid')
        ?.style.getPropertyValue('--ui-grid-columns'),
    ).toBe('2');
    expect(
      all(
        '[data-testid="achievements-skeleton"] ui-skeleton[data-radius="prominent"]',
      ),
    ).toHaveLength(4);
    expect(
      all(
        '[data-testid="achievements-skeleton"] ui-skeleton[data-radius="capsule"]',
      ),
    ).toHaveLength(7 + 6);
    expect(skeleton?.querySelector('ui-card')?.getAttribute('data-tone')).toBe(
      'elevated',
    );
    expect(byId('achievements-records')).toBeNull();
    expect(byId('achievements-chips')).toBeNull();
    expect(text(byId('achievements-title'))).toBe('Постижения');

    catalog.answer();
    await render();
    expect(byId('achievements-skeleton')).toBeNull();
    expect(byId('achievements-records')).not.toBeNull();
    expect(byId('achievements-chips')).not.toBeNull();
  });

  it('says the catalogue did not load, and reads it again on «Опитай пак»', async () => {
    const catalog = catalogPortsOf().failWith();
    const { byId, render, text } = await mount({ rig: { catalog } });
    const notice = byId('achievements-error');
    expect(notice?.tagName).toBe('UI-NOTICE');
    expect(notice?.getAttribute('aria-label')).toBe(
      'Постиженията не се заредиха.',
    );
    expect(text(notice?.querySelector('p'))).toBe(
      'Постиженията не се заредиха.',
    );
    const retry = byId('achievements-retry');
    expect(text(retry)).toBe('Опитай пак');
    expect(byId('achievements-records')).toBeNull();
    expect(byId('achievements-chips')).toBeNull();
    expect(text(byId('achievements-title'))).toBe('Постижения');

    catalog.recover();
    retry?.click();
    await render();
    expect(byId('achievements-error')).toBeNull();
    expect(byId('achievements-records')).not.toBeNull();
  });

  it('never draws a fake zero: failed progress under a loaded catalogue is the same notice', async () => {
    const loyalty = progressFails();
    const { byId, render } = await mount({ rig: { loyalty } });
    expect(byId('achievements-error')).not.toBeNull();
    expect(byId('achievements-close')).toBeNull();

    loyalty.recover();
    byId('achievements-retry')?.click();
    await render();
    expect(byId('achievements-error')).toBeNull();
    expect(byId('achievements-close')).not.toBeNull();
  });

  it('says how the first achievement comes when nothing is earned yet: the one record the book knows, no «Почти спечелени», the silhouettes still drawn', async () => {
    const { byId, text, all, shelves } = await mount({
      rig: { loyalty: nothingEarned() },
    });
    expect(
      all('[data-testid^="achievements-record-"]').map((card) =>
        card.getAttribute('data-testid'),
      ),
    ).toEqual(['achievements-record-firstVisit']);
    expect(byId('achievements-chips')).not.toBeNull();
    const hint = byId('achievements-first-hint');
    expect(text(hint)).toBe('Първото постижение идва с първото посещение.');
    expect(byId('achievements-body')?.firstElementChild).toBe(hint);
    expect(byId('achievements-close')).toBeNull();
    expect(byId('achievements-archive')).toBeNull();
    expect(shelves().length).toBeGreaterThan(0);
    expect(
      all('ui-stack[data-testid^="achievements-shelf-"] button.ui-medal').every(
        (medal) => medal.getAttribute('data-state') === 'notStarted',
      ),
    ).toBe(true);
  });

  it('draws no season card and no events once every window has closed; the archive counts them', async () => {
    const { byId, text } = await mount({
      rig: { nowMs: sofia('2027-01-15T12:00:00') },
    });
    expect(byId('achievements-season')).toBeNull();
    expect(byId('achievements-events')).toBeNull();
    expect(byId('achievements-archive')?.getAttribute('aria-label')).toBe(
      'Минали сезони и събития, 2',
    );
    expect(text(byId('achievements-archive'))).toBe(
      'Минали сезони и събития 2',
    );
  });

  it('shows «Ритъм» with only its earned families when `loyalty.streaks` is off', async () => {
    const { shelves, chips } = await mount({ rig: { flags: STREAKS_OFF } });
    expect(chips()).toContain('cat-rhythm');
    expect(
      shelves().find((shelf) => shelf.id === 'achievements-shelf-cat-rhythm'),
    ).toMatchObject({ tiles: 2 });
  });

  it('shows the saved figures offline, under the offline notice; every tile still opens its detail', async () => {
    const { byId, fixture, text, medals } = await mount();
    window.dispatchEvent(new Event('offline'));
    fixture.detectChanges();
    const notice = byId('achievements-offline');
    expect(notice?.getAttribute('aria-label')).toBe(
      'Без връзка · запазени данни',
    );
    expect(text(notice)).toBe('Без връзка · запазени данни');
    expect(notice?.previousElementSibling?.tagName).toBe('UI-SHEET-HEADLINE');
    expect(byId('achievements-records')).not.toBeNull();
    byId('achievements-close-series-svc-fade')?.click();
    expect(medals).toEqual(['series-svc-fade']);

    window.dispatchEvent(new Event('online'));
    fixture.detectChanges();
    expect(byId('achievements-offline')).toBeNull();
  });

  it('is absent for a person with no loyalty account: it says how the first achievement comes', async () => {
    const { byId, text } = await mount({
      rig: { loyalty: loyaltyPortsOf([]) },
    });
    expect(byId('achievements-records')).toBeNull();
    expect(byId('achievements-chips')).toBeNull();
    expect(byId('achievements-error')).toBeNull();
    expect(text(byId('achievements-empty'))).toBe(
      'Първото постижение идва с първото посещение.',
    );
  });
});
