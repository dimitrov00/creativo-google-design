import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryLoyaltyCatalogReader } from '@creativo/application/engagement/testing';
import type { AchievementScope } from '../client-card.contracts';
import {
  GEORGI,
  georgiContext,
  subjectOf,
} from '../../testing/client-card.fixtures';
import {
  HeldCatalogReader,
  type MountOptions,
  PAGE_TITLE_ID,
  mountAchievementsPage,
  stubResizeObserver,
} from '../../testing/achievements-pages.rig';
import { cssRule } from '../../testing/css-rule';
import { AchievementCategoryPage } from './achievement-category';

/*
 * ONE SCOPE, revision 3 (§2.3.2 «Grid metrics», §2.3.3): a category is a
 * CHIP of «Постижения» and this body is mounted in place under the band
 * (`embedded`: no headline of its own, the category's summary line over
 * its grids); a season, the archive and a day stay pushed pages. Every
 * grid is a white elevated card on the medal grid's STEP — three columns
 * on a phone (87 wide at 330, 102 at 390), four from 600, six in the
 * dialog where a sixth keeps its width — and every medal wears its ring.
 */

async function mount(
  scope: AchievementScope,
  options: Partial<MountOptions> = {},
) {
  const mounted = await mountAchievementsPage(AchievementCategoryPage, {
    subject: subjectOf(GEORGI),
    context: georgiContext(),
    ...options,
    inputs: { scope, ...options.inputs },
  });
  const scopes: AchievementScope[] = [];
  const medals: string[] = [];
  mounted.fixture.componentInstance.openScope.subscribe((next) =>
    scopes.push(next),
  );
  mounted.fixture.componentInstance.openMedal.subscribe((id) =>
    medals.push(id),
  );
  const sections = () =>
    mounted
      .all('[data-testid^="achievements-scope-section-"]')
      .map((section) => ({
        key: section.getAttribute('data-testid'),
        heading: mounted.text(section.querySelector('h3')),
        detail: mounted.text(section.querySelector('[uisectiondetail]')),
        tiles: [...section.querySelectorAll('button.ui-medal')].map((medal) =>
          medal.getAttribute('data-testid'),
        ),
      }));
  /** Every grid's step as drawn: its columns, and the card's padding over it. */
  const grids = () =>
    mounted
      .all<HTMLElement>('[data-testid^="achievements-scope-section-"] ui-grid')
      .map((grid) => ({
        columns: grid.style.getPropertyValue('--ui-grid-columns'),
        spacing: grid.getAttribute('data-spacing'),
        rowSpacing: grid.getAttribute('data-row-spacing'),
        inset: grid.getAttribute('data-inset'),
        padding: grid.closest('ui-card')?.getAttribute('data-padding') ?? null,
      }));
  return { ...mounted, scopes, medals, sections, grids };
}

const MASTERY: AchievementScope = {
  kind: 'category',
  categoryId: 'cat-mastery',
};

/** The ≥ 761 px dialog, as the sheet measures its presentation. */
function withDialog<T>(run: () => Promise<T>): Promise<T> {
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
  return run().finally(() => Reflect.deleteProperty(view, 'matchMedia'));
}

afterEach(() => {
  window.dispatchEvent(new Event('online'));
});

describe('AchievementCategoryPage — a category, pushed', () => {
  it('heads the scope with its name, and counts what was EARNED in one quiet line', async () => {
    const { byId, text, host } = await mount(MASTERY);
    expect(host.hasAttribute('data-embedded')).toBe(false);
    const title = byId('achievements-scope-title');
    expect(title?.tagName).toBe('H2');
    expect(title?.id).toBe(PAGE_TITLE_ID);
    expect(title?.getAttribute('data-font')).toBe('largeTitle');
    expect(text(title)).toBe('Майсторство');
    const subline = byId('achievements-scope-subline');
    expect(text(subline)).toBe('Майсторство · 3 от 9 спечелени');
    expect(subline?.getAttribute('data-font')).toBe('callout');
    expect(subline?.getAttribute('data-foreground-style')).toBe('secondary');
    expect(byId('achievements-scope-track')).toBeNull();
    expect(byId('achievements-scope-ended')).toBeNull();
  });

  it('sections mastery by what the families are about, each a quiet list label over a white card of medals', async () => {
    const { byId, sections } = await mount(MASTERY);
    expect(sections()).toEqual([
      {
        key: 'achievements-scope-section-hair',
        heading: 'Коса',
        detail: '1 от 5',
        tiles: [
          'achievements-scope-series-svc-fade',
          'achievements-scope-series-svc-classic-cut',
          'achievements-scope-series-svc-scissor-trim',
          'achievements-scope-series-svc-modern-cut',
          'achievements-scope-series-svc-father-son',
        ],
      },
      {
        key: 'achievements-scope-section-beard',
        heading: 'Брада',
        detail: '1 от 2',
        tiles: [
          'achievements-scope-series-svc-beard',
          'achievements-scope-series-svc-finish',
        ],
      },
      {
        key: 'achievements-scope-section-care',
        heading: 'Грижа',
        detail: '0 от 1',
        tiles: ['achievements-scope-series-svc-full-care'],
      },
      {
        key: 'achievements-scope-section-general',
        heading: 'Общи',
        detail: '1 от 1',
        tiles: ['achievements-scope-series-explorer'],
      },
    ]);
    const hair = byId('achievements-scope-section-hair');
    const header = hair?.querySelector('ui-section-header');
    expect(header?.getAttribute('data-header-prominence')).toBe('standard');
    // The grid is a white elevated card (R2-E), never a muted one.
    const card = hair?.querySelector('ui-card');
    expect(card?.getAttribute('data-tone')).toBe('elevated');
    const grid = hair?.querySelector('ui-grid');
    expect(grid?.getAttribute('role')).toBe('list');
    expect(grid?.hasAttribute('data-adaptive')).toBe(false);
    expect(grid?.getAttribute('aria-labelledby')).toBe(
      header?.querySelector('h3')?.id,
    );
    expect(
      [...(grid?.children ?? [])].every(
        (tile) => tile.getAttribute('role') === 'listitem',
      ),
    ).toBe(true);
    // Every medal in its ring: the earned one's arc, the not-started one's
    // dashed silhouette with its monogram and first requirement.
    const fade = byId('achievements-scope-series-svc-fade');
    expect(fade?.getAttribute('data-state')).toBe('earned');
    expect(fade?.getAttribute('data-control-size')).toBe('large');
    expect(
      fade
        ?.querySelector('ui-gauge.ui-medal__ring')
        ?.getAttribute('data-gauge-style'),
    ).toBe('circularCapacity');
    expect(fade?.querySelector('.ui-medal__level')?.textContent?.trim()).toBe(
      'II',
    );
    const classic = byId('achievements-scope-series-svc-classic-cut');
    expect(classic?.getAttribute('data-state')).toBe('notStarted');
    expect(
      classic
        ?.querySelector('ui-gauge.ui-medal__ring')
        ?.getAttribute('data-extent'),
    ).toBe('dashed');
    expect(
      classic?.querySelector('.ui-medal__monogram')?.textContent?.trim(),
    ).toBe('К');
    expect(
      classic?.querySelector('.ui-medal__caption')?.textContent?.trim(),
    ).toBe('0/3 до I');
  });

  it('sections the barbers’ shelf into barbers, shops and the rest', async () => {
    const { sections, byId, text } = await mount({
      kind: 'category',
      categoryId: 'cat-barbers',
    });
    expect(text(byId('achievements-scope-subline'))).toBe(
      'Бръснари и салони · 2 от 7 спечелени',
    );
    expect(
      sections().map((section) => [section.heading, section.detail]),
    ).toEqual([
      ['Бръснари', '1 от 3'],
      ['Салони', '1 от 2'],
      ['Общи', '0 от 2'],
    ]);
  });

  it('draws a shelf with nothing to split as one grid named by the page’s title', async () => {
    const { byId, sections } = await mount({
      kind: 'category',
      categoryId: 'cat-special',
    });
    const [only] = sections();
    expect(sections()).toHaveLength(1);
    expect(only?.heading).toBeNull();
    const section = byId('achievements-scope-section-cat-special');
    expect(section?.querySelector('ui-section-header')).toBeNull();
    expect(
      section?.querySelector('ui-grid')?.getAttribute('aria-labelledby'),
    ).toBe(PAGE_TITLE_ID);
  });

  it('lays every section on the same step — three columns on a phone, the card’s regular padding — so a short section lines up with the ones above it', async () => {
    const { grids } = await mount(MASTERY);
    expect(grids()).toHaveLength(4);
    for (const grid of grids()) {
      expect(grid).toEqual({
        columns: '3',
        spacing: 'compact',
        rowSpacing: 'regular',
        inset: null,
        padding: 'regular',
      });
    }
  });

  it('lays the step the measured column holds: three of 87 at 330 (the card’s padding given to the tiles), three at 390, four from 600', async () => {
    const observers = stubResizeObserver();
    try {
      const { grids, host, render, fixture } = await mount(MASTERY);
      expect(observers.observed()).toEqual([host]);
      // A 330 phone's 295 pt column: three, the card's padding 12 (compact + tight inside).
      observers.resize(295);
      await render();
      expect(grids()[0]).toEqual({
        columns: '3',
        spacing: 'tight',
        rowSpacing: 'regular',
        inset: 'tight',
        padding: 'compact',
      });
      expect(
        cssRule(
          'achievement-category/achievement-category.css',
          ".achievement-category__grid[data-inset='tight']",
        ).get('padding'),
      ).toBe('var(--sys-space-tight)');
      // A 390 phone's 355: three, every section alike.
      observers.resize(355);
      await render();
      expect(grids().map((grid) => grid.columns)).toEqual(['3', '3', '3', '3']);
      expect(grids()[0]?.padding).toBe('regular');
      // A sheet from 600: four, the card's comfortable padding.
      observers.resize(600);
      await render();
      expect(grids()[0]).toEqual({
        columns: '4',
        spacing: 'regular',
        rowSpacing: 'comfortable',
        inset: null,
        padding: 'comfortable',
      });
      fixture.destroy();
      expect(observers.observed()).toEqual([]);
    } finally {
      observers.restore();
    }
  });

  it('lays four across the ≥ 761 px dialog’s nominal column, and six where a sixth keeps its width', async () => {
    await withDialog(async () => {
      const observers = stubResizeObserver();
      try {
        const { grids, render } = await mount(MASTERY);
        // The visit sheet's own dialog: 528 wide, a sixth would be 67.
        expect(grids()[0]?.columns).toBe('4');
        observers.resize(528);
        await render();
        expect(grids()[0]?.columns).toBe('4');
        // A wider dialog: six of 96 and more.
        observers.resize(720);
        await render();
        expect(grids()[0]?.columns).toBe('6');
      } finally {
        observers.restore();
      }
    });
  });

  it('opens a family’s detail from its medal', async () => {
    const { byId, medals, scopes } = await mount(MASTERY);
    byId('achievements-scope-series-svc-beard')?.click();
    expect(medals).toEqual(['series-svc-beard']);
    expect(scopes).toEqual([]);
  });

  it('follows its scope when the editor hands it another', async () => {
    const { fixture, byId, text, render } = await mount(MASTERY);
    fixture.componentRef.setInput('scope', {
      kind: 'category',
      categoryId: 'cat-rhythm',
    });
    await render();
    expect(text(byId('achievements-scope-title'))).toBe('Ритъм');
    expect(byId('achievements-scope-section-hair')).toBeNull();
  });
});

describe('AchievementCategoryPage — a category, embedded under the chips (§2.3.3)', () => {
  it('draws no headline and no notice of its own: the summary line, then the grids on the same step', async () => {
    const { host, byId, text, sections, grids } = await mount(MASTERY, {
      inputs: { embedded: true },
    });
    expect(host.hasAttribute('data-embedded')).toBe(true);
    expect(host.querySelector('ui-sheet-headline')).toBeNull();
    expect(host.querySelector('h2')).toBeNull();
    expect(byId('achievements-scope-title')).toBeNull();
    const subline = byId('achievements-scope-subline');
    expect(text(subline)).toBe('Майсторство · 3 от 9 спечелени');
    expect(subline?.getAttribute('data-font')).toBe('callout');
    expect(subline?.getAttribute('data-foreground-style')).toBe('secondary');
    expect(host.firstElementChild).toBe(subline);
    expect(sections().map((section) => section.heading)).toEqual([
      'Коса',
      'Брада',
      'Грижа',
      'Общи',
    ]);
    expect(grids().every((grid) => grid.columns === '3')).toBe(true);
    // Offline the page above says so, once.
    window.dispatchEvent(new Event('offline'));
    expect(byId('achievements-offline')).toBeNull();
  });

  it('sits closer to its grids than a pushed page’s modules (the stylesheet is the contract)', () => {
    expect(
      cssRule('achievement-category/achievement-category.css', ':host').get(
        'gap',
      ),
    ).toBe('var(--sys-space-loose)');
    expect(
      cssRule(
        'achievement-category/achievement-category.css',
        ':host([data-embedded])',
      ).get('gap'),
    ).toBe('var(--sys-space-comfortable)');
  });
});

describe('AchievementCategoryPage — a season', () => {
  it('puts the running season’s medal in its ring and its step track above its families on a white card: the ladder is drawn HERE', async () => {
    const { byId, text, sections } = await mount({
      kind: 'season',
      seasonId: 'season-2026-autumn',
    });
    expect(text(byId('achievements-scope-title'))).toBe('Есен 2026');
    expect(text(byId('achievements-scope-subline'))).toBe('1.09 – 30.11');
    const track = byId('achievements-scope-track');
    expect(track?.tagName).toBe('UI-CARD');
    expect(track?.getAttribute('data-tone')).toBe('elevated');
    expect(track?.getAttribute('data-padding')).toBe('comfortable');
    const meter = track?.querySelector('ui-gauge[data-gauge-style="steps"]');
    expect(meter?.getAttribute('role')).toBe('meter');
    expect(meter?.getAttribute('aria-label')).toBe('Есен 2026');
    expect(meter?.getAttribute('aria-valuetext')).toBe(
      'Още 1 посещение до III',
    );
    expect(meter?.getAttribute('aria-valuenow')).toBe('2');
    const medal = track?.querySelector('ui-medal');
    expect(medal?.getAttribute('aria-hidden')).toBe('true');
    expect(medal?.getAttribute('data-control-size')).toBe('large');
    expect(medal?.querySelector('ui-gauge.ui-medal__ring')).not.toBeNull();
    // The level once on the row: the steps' current node prints «II», so
    // the medal leading them draws no rim.
    expect(medal?.querySelector('.ui-medal__level')).toBeNull();
    expect(
      text(
        meter?.querySelector(
          ".ui-gauge__step[data-state='current'] .ui-gauge__node",
        ),
      ),
    ).toBe('II');
    const sentence = track?.querySelector('p');
    expect(text(sentence)).toBe('Още 1 посещение до III');
    expect(sentence?.getAttribute('aria-hidden')).toBe('true');
    expect(byId('achievements-scope-ended')).toBeNull();
    expect(sections()).toHaveLength(1);
    expect(sections()[0]?.tiles).toHaveLength(4);
  });

  it('lists only what was earned in an ended season, its track the levels reached; the level it closed on is drawn, not written', async () => {
    const { byId, text, sections } = await mount({
      kind: 'season',
      seasonId: 'season-2026-summer',
    });
    expect(text(byId('achievements-scope-title'))).toBe('Лято 2026');
    expect(text(byId('achievements-scope-subline'))).toBe('1.06 – 31.08');
    expect(text(byId('achievements-scope-ended'))).toBe('Сезонът приключи.');
    const track = byId('achievements-scope-track');
    expect(track?.querySelector('p')).toBeNull();
    const steps = [...(track?.querySelectorAll('.ui-gauge__step') ?? [])];
    expect(
      steps.map((step) =>
        step.querySelector('.ui-gauge__check')
          ? '✓'
          : text(step.querySelector('.ui-gauge__node')),
      ),
    ).toEqual(['✓', '✓', '✓']);
    expect(steps.map((step) => step.getAttribute('data-state'))).toEqual([
      'reached',
      'reached',
      'current',
    ]);
    expect(text(track?.querySelector('ui-medal .ui-medal__level'))).toBe('III');
    expect(sections()[0]?.tiles).toEqual([
      'achievements-scope-series-2026-summer-each-month',
    ]);
  });
});

describe('AchievementCategoryPage — the archive and a day', () => {
  it('files the ended seasons by year, each opening its own season', async () => {
    const { byId, text, sections, scopes, medals } = await mount({
      kind: 'archive',
    });
    expect(text(byId('achievements-scope-title'))).toBe(
      'Минали сезони и събития',
    );
    expect(text(byId('achievements-scope-subline'))).toBe('Георги Петров');
    expect(sections()).toEqual([
      {
        key: 'achievements-scope-section-2026',
        heading: '2026',
        detail: null,
        tiles: ['achievements-scope-season-2026-summer'],
      },
    ]);
    const summer = byId('achievements-scope-season-2026-summer');
    expect(summer?.querySelector('.ui-medal__title')?.textContent?.trim()).toBe(
      'Лято 2026',
    );
    expect(
      summer?.querySelector('.ui-medal__caption')?.textContent?.trim(),
    ).toBe('1.06 – 31.08');
    summer?.click();
    expect(scopes).toEqual([
      { kind: 'season', seasonId: 'season-2026-summer' },
    ]);
    expect(medals).toEqual([]);
  });

  it('lists the families a day moved', async () => {
    const { byId, text, sections } = await mount({
      kind: 'day',
      day: '2026-09-28',
    });
    expect(text(byId('achievements-scope-title'))).toBe('Спечелени на 28.09');
    expect(sections()[0]?.tiles).toEqual([
      'achievements-scope-series-rhythm',
      'achievements-scope-series-2026-autumn-track',
      'achievements-scope-series-2026-autumn-early',
    ]);
  });

  it('never marks a scope’s medal «Ново»: the overview is where a level is new', async () => {
    const today = await mount({ kind: 'day', day: '2026-09-28' });
    const grids = today.all('.achievement-category__grid');
    expect(grids.length).toBeGreaterThan(0);
    expect(
      grids.some((grid) => grid.querySelector('[uimedalmarker]') !== null),
    ).toBe(false);
  });
});

describe('AchievementCategoryPage — states', () => {
  it('titles the archive at once and holds six discs on a white card while the catalogue is on its way', async () => {
    const catalog = new HeldCatalogReader();
    const { byId, text, render } = await mount(
      { kind: 'archive' },
      { rig: { catalog } },
    );
    expect(text(byId('achievements-scope-title'))).toBe(
      'Минали сезони и събития',
    );
    const skeleton = byId('achievements-scope-skeleton');
    expect(skeleton?.tagName).toBe('UI-CARD');
    expect(skeleton?.getAttribute('data-tone')).toBe('elevated');
    expect(skeleton?.getAttribute('aria-busy')).toBe('true');
    expect(
      skeleton?.querySelectorAll('ui-skeleton[data-radius="capsule"]'),
    ).toHaveLength(6);

    catalog.answer();
    await render();
    expect(byId('achievements-scope-skeleton')).toBeNull();
    expect(byId('achievements-scope-section-2026')).not.toBeNull();
  });

  it('keeps the collection’s name on a category until its data lands', async () => {
    const { byId, text } = await mount(MASTERY, {
      rig: { catalog: new HeldCatalogReader() },
    });
    expect(text(byId('achievements-scope-title'))).toBe('Постижения');
    expect(text(byId('achievements-scope-subline'))).toBe('Георги Петров');
  });

  it('says the achievements did not load, and reads them again', async () => {
    const catalog = new InMemoryLoyaltyCatalogReader().failWith();
    const { byId, render, text } = await mount(MASTERY, { rig: { catalog } });
    expect(byId('achievements-error')?.getAttribute('aria-label')).toBe(
      'Постиженията не се заредиха.',
    );
    expect(text(byId('achievements-retry'))).toBe('Опитай пак');
    catalog.recover();
    byId('achievements-retry')?.click();
    await render();
    expect(byId('achievements-error')).toBeNull();
    expect(byId('achievements-scope-section-hair')).not.toBeNull();
  });

  it('draws nothing false for a scope the catalogue does not hold', async () => {
    const { byId, text, sections } = await mount({
      kind: 'category',
      categoryId: 'cat-gone',
    });
    expect(byId('achievements-error')).not.toBeNull();
    expect(sections()).toEqual([]);
    expect(text(byId('achievements-scope-title'))).toBe('Постижения');
  });

  it('shows the saved medals offline, under the offline notice', async () => {
    const { byId, fixture } = await mount(MASTERY);
    window.dispatchEvent(new Event('offline'));
    fixture.detectChanges();
    expect(byId('achievements-offline')?.previousElementSibling?.tagName).toBe(
      'UI-SHEET-HEADLINE',
    );
    expect(byId('achievements-scope-section-hair')).not.toBeNull();
  });
});
