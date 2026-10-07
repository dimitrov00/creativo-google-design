import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  InMemoryLoyaltyCatalogReader,
  InMemoryLoyaltyReader,
} from '@creativo/application/engagement/testing';
import {
  GEORGI,
  georgiContext,
  georgiOpenContext,
  subjectOf,
} from '../../testing/client-card.fixtures';
import {
  HeldCatalogReader,
  type MountOptions,
  PAGE_TITLE_ID,
  mountAchievementsPage,
} from '../../testing/achievements-pages.rig';
import { cssRule } from '../../testing/css-rule';
import { AchievementDetailPage } from './achievement-detail';

async function mount(seriesId: string, options: Partial<MountOptions> = {}) {
  const mounted = await mountAchievementsPage(AchievementDetailPage, {
    subject: subjectOf(GEORGI),
    context: georgiContext(),
    inputs: { seriesId },
    ...options,
  });
  const medals: string[] = [];
  const categories: string[] = [];
  mounted.fixture.componentInstance.openMedal.subscribe((id) =>
    medals.push(id),
  );
  mounted.fixture.componentInstance.openCategory.subscribe((id) =>
    categories.push(id),
  );
  return { ...mounted, medals, categories };
}

/** The body's own stylesheet, as the lib ships it. */
function stylesheet(): string {
  return readFileSync(resolve(__dirname, './achievement-detail.css'), 'utf8');
}

/** The declarations of ONE rule of the body's stylesheet, as an object. */
function rule(selector: string): Record<string, string> {
  return Object.fromEntries(
    cssRule('achievement-detail/achievement-detail.css', selector),
  );
}

afterEach(() => {
  window.dispatchEvent(new Event('online'));
});

describe('AchievementDetailPage — the stage (DA, DC, DD)', () => {
  it('stands the medal on the hero head’s stage, extraLarge, wearing its own ring', async () => {
    const { byId } = await mount('series-svc-fade');
    const head = byId('achievements-detail-head');
    expect(head?.getAttribute('data-headline-style')).toBe('hero');
    expect(head?.hasAttribute('data-media-stage')).toBe(true);
    expect(head?.hasAttribute('data-media')).toBe(true);
    // The head draws no ring of its own: the medal wears its own.
    const media = head?.querySelector('.ui-sheet-headline__media');
    expect(media?.getAttribute('aria-hidden')).toBe('true');
    expect(media?.querySelector(':scope > ui-gauge')).toBeNull();
    const medal = byId('achievements-detail-medal');
    expect(medal?.closest('.ui-sheet-headline__media')).toBe(media);
    expect(medal?.getAttribute('data-control-size')).toBe('extraLarge');
    expect(medal?.getAttribute('data-state')).toBe('earned');
    expect(medal?.querySelector('.ui-medal__level')?.textContent?.trim()).toBe(
      'II',
    );
    expect(medal?.querySelector('ui-gauge.ui-medal__ring')).not.toBeNull();
    // The face alone: no title, no caption of its own.
    expect(medal?.querySelector('.ui-medal__title')).toBeNull();
    expect(medal?.querySelector('.ui-medal__caption')).toBeNull();
    // The page does not rise: it is a medal's page, not a person's.
    expect(head?.getAttribute('style') ?? '').not.toContain(
      '--ui-sheet-headline-rise',
    );
  });

  it('names the family at the NAME’s rung, and says where it stands with the date as the fact', async () => {
    const { byId, text } = await mount('series-svc-fade');
    const title = byId('achievements-detail-title');
    expect(title?.tagName).toBe('H2');
    expect(title?.id).toBe(PAGE_TITLE_ID);
    expect(title?.getAttribute('data-font')).toBe('title');
    expect(text(title)).toBe('Фейд');
    const state = byId('achievements-detail-state');
    expect(state?.getAttribute('data-font')).toBe('callout');
    expect(state?.getAttribute('data-foreground-style')).toBe('secondary');
    expect(text(state)).toMatch(
      /^Майсторство · Ниво II · от \d+\.\d+\.\d{4} г\.$/,
    );
    const fact = state?.querySelector('.achievement-detail__fact');
    expect(fact?.getAttribute('data-foreground-style')).toBe('primary');
    expect(fact?.getAttribute('data-weight')).toBe('medium');
    expect(text(fact)).toMatch(/^\d+\.\d+\.\d{4} г\.$/);
  });
});

describe('AchievementDetailPage — the progress (DE)', () => {
  it('prints the count ONCE, at the page’s hero rung, with what it counts and what remains', async () => {
    const { host, byId, text } = await mount('series-svc-fade');
    const card = byId('achievements-detail-progress');
    expect(card?.getAttribute('data-tone')).toBe('elevated');
    expect(card?.getAttribute('data-padding')).toBe('comfortable');
    expect(card?.getAttribute('role')).toBe('group');
    const metric = card?.querySelector('ui-metric');
    expect(metric?.getAttribute('data-control-size')).toBe('extraLarge');
    expect(card?.getAttribute('aria-labelledby')).toBe(metric?.id);
    expect(text(metric?.querySelector('.ui-metric__value'))).toBe('24');
    expect(text(metric?.querySelector('.ui-metric__unit'))).toBe('от 25');
    expect(text(metric?.querySelector('.ui-metric__caption'))).toBe(
      'посещения с фейд',
    );
    expect(metric?.getAttribute('aria-label')).toBe(
      '24 от 25 посещения с фейд',
    );
    const remaining = byId('achievements-detail-remaining');
    expect(remaining?.getAttribute('data-font')).toBe('callout');
    expect(remaining?.getAttribute('data-weight')).toBe('semibold');
    expect(text(remaining)).toBe('Още 1 до ниво III');
    expect(byId('achievements-detail-this-visit')).toBeNull();
    // The count lives here and nowhere else on the page: one metric, and
    // neither the state line nor the ladder repeats «24 от 25».
    expect(host.querySelectorAll('ui-metric')).toHaveLength(1);
    expect(text(byId('achievements-detail-state'))).not.toMatch(/\b24\b|от 25/);
    expect(text(byId('achievements-detail-levels'))).not.toMatch(/24 от 25/);
  });

  it('says this visit counts when its services already hold the counted one, and draws NO verb in the body', async () => {
    const { host, byId, text } = await mount('series-svc-fade', {
      context: georgiOpenContext(),
    });
    const line = byId('achievements-detail-this-visit');
    expect(line?.getAttribute('data-foreground-style')).toBe('secondary');
    expect(text(line)).toBe('С това посещение: 25 от 25');
    // DV-C: the dock carries the verb, never the body.
    expect(byId('staff-visit-detail-add')).toBeNull();
    const verbs = [...host.querySelectorAll('button')].filter((button) =>
      /Добави/u.test(button.textContent ?? ''),
    );
    expect(verbs).toEqual([]);
  });
});

describe('AchievementDetailPage — «Как се печели» (DF)', () => {
  it('says ONE sentence chosen by the metric, shows the counted service as a picture, who and where, and the exclusion once', async () => {
    const { byId, text } = await mount('series-svc-fade');
    const how = byId('achievements-detail-how');
    const heading = how?.querySelector('ui-section-header h3');
    expect(
      how
        ?.querySelector('ui-section-header')
        ?.getAttribute('data-header-prominence'),
    ).toBe('increased');
    expect(text(heading)).toBe('Как се печели');
    expect(how?.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(how?.querySelector('ui-card')?.getAttribute('data-tone')).toBe(
      'elevated',
    );
    const sentence = byId('achievements-detail-how-sentence');
    expect(sentence?.getAttribute('data-font')).toBe('body');
    expect(text(sentence)).toBe(
      'Всяко посещение с фейд се брои, щом приключи.',
    );
    // One service: one cover across the card, named and priced under it.
    const cover = byId('achievements-detail-count-svc-fade');
    expect(cover?.tagName).toBe('FIGURE');
    const covers = how?.querySelector<HTMLElement>(
      '.achievement-detail__covers',
    );
    expect(covers?.style.getPropertyValue('--ui-grid-columns')).toBe('1');
    // A cover is a picture, not a control: no scrim, no ring, no button.
    const media = cover?.querySelector('ui-media-card');
    expect(media).not.toBeNull();
    expect(media?.querySelector('[uioverlay="scrim-media"]')).toBeNull();
    expect(cover?.querySelector('button, a')).toBeNull();
    const words = cover?.querySelector('figcaption');
    expect(text(words?.querySelector('[data-font="subheadline"]'))).toBe(
      'Фейд',
    );
    // The who line names the barbers as one mark, then the words.
    const who = byId('achievements-detail-who');
    expect(who?.querySelector('ui-avatar-group')?.getAttribute('role')).toBe(
      'group',
    );
    expect(
      who?.querySelector('ui-avatar-group')?.getAttribute('data-control-size'),
    ).toBe('small');
    expect(text(who?.querySelector('[data-font="callout"]'))).toBe(
      'При всеки бръснар · във всеки салон',
    );
    // The exclusion, once, quiet.
    const excluded = byId('achievements-detail-excluded');
    expect(excluded?.getAttribute('data-font')).toBe('footnote');
    expect(text(excluded)).toBe('Отменени часове и неявявания не се броят.');
    expect(
      [...(how?.querySelectorAll('p') ?? [])].filter((p) =>
        /не се броят/u.test(p.textContent ?? ''),
      ),
    ).toHaveLength(1);
  });

  it('words the rhythm family by the rule in force, and shows no picture for it', async () => {
    const { byId, text } = await mount('series-rhythm');
    const sentence = text(byId('achievements-detail-how-sentence'));
    expect(sentence).toMatch(/\.$/);
    expect(
      byId('achievements-detail-how')?.querySelector('ui-media-card'),
    ).toBeNull();
    expect(byId('achievements-detail-excluded')).toBeNull();
  });
});

describe('AchievementDetailPage — «Нива» (DH)', () => {
  it('draws the levels as a ladder of medals: passed ones complete with their numeral, the next and the later ones dashed', async () => {
    const { byId, text } = await mount('series-svc-fade');
    const ladder = byId('achievements-detail-ladder');
    expect(text(ladder?.querySelector('ui-section-header h3'))).toBe('Нива');
    const levels = byId('achievements-detail-levels');
    expect(levels?.tagName).toBe('OL');
    const rows = [...(levels?.querySelectorAll('li') ?? [])];
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'achievements-detail-level-1',
      'achievements-detail-level-2',
      'achievements-detail-level-3',
      'achievements-detail-level-4',
      'achievements-detail-level-5',
    ]);
    expect(rows.map((row) => row.getAttribute('data-tone'))).toEqual([
      'passed',
      'passed',
      'next',
      'later',
      'later',
    ]);
    const medals = rows.map((row) => row.querySelector('ui-medal'));
    expect(medals.map((medal) => medal?.getAttribute('data-state'))).toEqual([
      'complete',
      'complete',
      'notStarted',
      'notStarted',
      'notStarted',
    ]);
    expect(
      medals.map((medal) => medal?.getAttribute('data-control-size')),
    ).toEqual(Array.from({ length: 5 }, () => 'regular'));
    expect(
      medals.map((medal) => text(medal?.querySelector('.ui-medal__level'))),
    ).toEqual(['I', 'II', null, null, null]);
    // The words: the level and its threshold, the reward, the day it was earned.
    const titles = rows.map((row) =>
      text(row.querySelector('.achievement-detail__level-title')),
    );
    expect(titles[0]).toMatch(/^Ниво I · \d+ посещения/u);
    expect(titles[2]).toMatch(/^Ниво III · \d+ посещения/u);
    expect(
      rows.map((row) =>
        row
          .querySelector('.achievement-detail__level-title')
          ?.getAttribute('data-foreground-style'),
      ),
    ).toEqual(['primary', 'primary', 'primary', 'secondary', 'secondary']);
    expect(
      rows.map((row) =>
        text(row.querySelector('.achievement-detail__level-date')),
      ),
    ).toEqual([
      expect.stringMatching(/^\d+\.\d+\.\d{4}( г\.)?$/),
      expect.stringMatching(/^\d+\.\d+\.\d{4}( г\.)?$/),
      null,
      null,
      null,
    ]);
    // The house row grammar: the level's line whole on top, then the reward
    // and, at the trailing edge, the day — in that reading order.
    const words = rows[1]?.querySelector('.achievement-detail__level-words');
    expect([...(words?.children ?? [])].map((part) => part.className)).toEqual([
      'achievement-detail__level-title',
      'achievement-detail__level-facts',
    ]);
    expect(
      [
        ...(words?.querySelector('.achievement-detail__level-facts')
          ?.children ?? []),
      ].map((part) => part.className),
    ).toEqual([
      'achievement-detail__level-reward',
      'achievement-detail__level-date',
    ]);
    // Each row is one sentence to a screen reader; its picture is hidden.
    // The presenter binds a count to its noun with a no-break space.
    expect(rows[1]?.getAttribute('aria-label')).toMatch(
      /^Ниво II, \d+\sпосещения.*спечелено на /u,
    );
    expect(medals[1]?.getAttribute('aria-hidden')).toBe('true');
    expect(
      rows[1]
        ?.querySelector('.achievement-detail__level-words')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');
  });
});

describe('AchievementDetailPage — the visits that counted (DI) and the neighbours (DJ)', () => {
  it('lists the counted visits as static staff rows in an inset group, five at most', async () => {
    const { byId, text } = await mount('series-svc-fade');
    const list = byId('achievements-detail-visits');
    expect(list?.tagName).toBe('UL');
    expect(list?.classList.contains('ui-list-group')).toBe(true);
    const heading = list?.closest('section')?.querySelector('h3');
    expect(text(heading)).toBe('Броени посещения');
    expect(list?.getAttribute('aria-labelledby')).toBe(heading?.id);
    const rows = [...(list?.querySelectorAll('lib-visit-row') ?? [])];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
    for (const row of rows) {
      expect(row.getAttribute('role')).toBe('listitem');
      expect(row.querySelector('button')).toBeNull();
    }
  });

  it('shows the family’s neighbours as ONE grid row of three, never a rail; a tap asks for theirs, «Всички» for the category', async () => {
    const { byId, text, medals, categories } = await mount('series-svc-fade');
    const related = byId('achievements-detail-related');
    const heading = related?.querySelector('ui-section-header h3');
    expect(text(heading)).toBe('Още от Майсторство');
    expect(related?.querySelector('ui-scroll-row')).toBeNull();
    const grid = related?.querySelector<HTMLElement>('ui-grid');
    expect(grid?.getAttribute('role')).toBe('list');
    expect(grid?.style.getPropertyValue('--ui-grid-columns')).toBe('3');
    expect(grid?.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(grid?.closest('ui-card')?.getAttribute('data-padding')).toBe(
      'regular',
    );
    const tiles = [...(grid?.querySelectorAll('lib-achievement-tile') ?? [])];
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(3);
    expect(byId('achievements-detail-related-series-svc-fade')).toBeNull();
    for (const tile of tiles) {
      expect(
        tile
          .querySelector('button.ui-medal')
          ?.getAttribute('data-control-size'),
      ).toBe('large');
    }
    byId('achievements-detail-related-series-svc-beard')?.click();
    expect(medals).toEqual(['series-svc-beard']);
    const all = byId('achievements-detail-related-all');
    expect(all?.hasAttribute('uisectionaction')).toBe(true);
    expect(all?.getAttribute('data-control-size')).toBe('small');
    expect(all?.getAttribute('data-button-style')).toBe('plain');
    expect(text(all)).toBe('Всички');
    expect(all?.getAttribute('aria-describedby')).toBe(heading?.id);
    all?.click();
    expect(categories).toHaveLength(1);
    expect(categories[0]).toBeTruthy();
  });

  it('offers no «Всички» for a season’s family, which has no chip', async () => {
    const { byId, text } = await mount('series-2026-summer-each-month');
    expect(text(byId('achievements-detail-related')?.querySelector('h3'))).toBe(
      'Още от Лято 2026',
    );
    expect(byId('achievements-detail-related-all')).toBeNull();
  });

  it('follows its family when the editor replaces it with a neighbour', async () => {
    const { fixture, byId, text, render } = await mount('series-svc-fade');
    fixture.componentRef.setInput('seriesId', 'series-svc-beard');
    await render();
    expect(text(byId('achievements-detail-title'))).toBe('Оформяне на брада');
    expect(byId('achievements-detail-related-series-svc-fade')).not.toBeNull();
  });
});

describe('AchievementDetailPage — other families', () => {
  it('draws a family not started whole: the dashed silhouette, «0 от 3», every rung dashed, the first said in primary ink', async () => {
    const { byId, text } = await mount('series-svc-classic-cut');
    expect(text(byId('achievements-detail-state'))).toBe(
      'Майсторство · още не е започнато',
    );
    const medal = byId('achievements-detail-medal');
    expect(medal?.getAttribute('data-state')).toBe('notStarted');
    expect(medal?.querySelector('.ui-medal__level')).toBeNull();
    const metric = byId('achievements-detail-progress')?.querySelector(
      'ui-metric',
    );
    expect(text(metric?.querySelector('.ui-metric__value'))).toBe('0');
    expect(text(metric?.querySelector('.ui-metric__unit'))).toMatch(/^от \d+$/);
    const rows = [
      ...(byId('achievements-detail-levels')?.querySelectorAll('li') ?? []),
    ];
    expect(rows.length).toBeGreaterThan(0);
    expect(
      new Set(
        rows.map((row) =>
          row.querySelector('ui-medal')?.getAttribute('data-state'),
        ),
      ),
    ).toEqual(new Set(['notStarted']));
    expect(rows[0]?.getAttribute('data-tone')).toBe('next');
    expect(
      rows.slice(1).every((row) => row.getAttribute('data-tone') === 'later'),
    ).toBe(true);
    // The requirement is never hidden; a service without art has no cover
    // (never a name under no picture), and keeps the sentence and the who line.
    expect(byId('achievements-detail-how-sentence')).not.toBeNull();
    expect(byId('achievements-detail-count-svc-classic-cut')).toBeNull();
    expect(
      byId('achievements-detail-how')?.querySelector('ui-media-card'),
    ).toBeNull();
    expect(byId('achievements-detail-who')).not.toBeNull();
    expect(byId('achievements-detail-visits')).toBeNull();
  });

  it('draws a one-off: the date as the figure, one «Награда» row, a complete medal', async () => {
    const { byId, text } = await mount('series-welcome');
    const metric = byId('achievements-detail-progress')?.querySelector(
      'ui-metric',
    );
    expect(text(metric?.querySelector('.ui-metric__value'))).toMatch(
      /^\d+\.\d+\.\d{4} г\.$/,
    );
    expect(metric?.querySelector('.ui-metric__unit')).toBeNull();
    expect(byId('achievements-detail-remaining')).toBeNull();
    const rows = [
      ...(byId('achievements-detail-levels')?.querySelectorAll('li') ?? []),
    ];
    expect(rows).toHaveLength(1);
    expect(
      text(rows[0]?.querySelector('.achievement-detail__level-title')),
    ).toBe('Награда');
    expect(rows[0]?.querySelector('ui-medal')?.getAttribute('data-state')).toBe(
      'complete',
    );
    expect(byId('achievements-detail-medal')?.getAttribute('data-state')).toBe(
      'complete',
    );
  });
});

describe('AchievementDetailPage — states', () => {
  it('holds the stage with a disc, a line and two blocks while the family is on its way', async () => {
    const catalog = new HeldCatalogReader();
    const { byId, text, render } = await mount('series-svc-fade', {
      rig: { catalog },
    });
    expect(text(byId('achievements-detail-title'))).toBe('Постижения');
    const head = byId('achievements-detail-head');
    expect(head?.getAttribute('data-headline-style')).toBe('hero');
    expect(head?.hasAttribute('data-media')).toBe(true);
    expect(head?.hasAttribute('data-media-stage')).toBe(true);
    expect(
      head?.querySelector('.ui-sheet-headline__media ui-skeleton'),
    ).not.toBeNull();
    expect(
      head?.querySelector('.achievement-detail__state-skeleton'),
    ).not.toBeNull();
    expect(byId('achievements-detail-state')).toBeNull();
    const blocks = byId('achievements-detail-skeleton');
    expect(blocks?.getAttribute('aria-busy')).toBe('true');
    expect(blocks?.querySelectorAll('ui-skeleton')).toHaveLength(2);
    expect(byId('achievements-detail-progress')).toBeNull();

    catalog.answer();
    await render();
    expect(text(byId('achievements-detail-title'))).toBe('Фейд');
    expect(byId('achievements-detail-skeleton')).toBeNull();
    expect(head?.querySelector('ui-skeleton')).toBeNull();
    expect(byId('achievements-detail-medal')).not.toBeNull();
    expect(byId('achievements-detail-progress')).not.toBeNull();
  });

  it('says the achievements did not load, and reads them again', async () => {
    const catalog = new InMemoryLoyaltyCatalogReader().failWith();
    const { byId, text, render } = await mount('series-svc-fade', {
      rig: { catalog },
    });
    expect(text(byId('achievements-error')?.querySelector('p'))).toBe(
      'Постиженията не се заредиха.',
    );
    // Not a medal's page: the standard head, so the bar's word does not
    // float under the hero's empty media box.
    const head = byId('achievements-detail-head');
    expect(head?.getAttribute('data-headline-style')).toBe('standard');
    expect(head?.hasAttribute('data-media')).toBe(false);
    expect(head?.hasAttribute('data-media-stage')).toBe(false);
    expect(byId('achievements-detail-progress')).toBeNull();
    catalog.recover();
    byId('achievements-retry')?.click();
    await render();
    expect(byId('achievements-error')).toBeNull();
    expect(text(byId('achievements-detail-title'))).toBe('Фейд');
    expect(head?.getAttribute('data-headline-style')).toBe('hero');
    expect(head?.hasAttribute('data-media-stage')).toBe(true);
  });

  it('draws nothing false for a family the catalogue does not hold', async () => {
    const { byId, text } = await mount('series-gone');
    expect(byId('achievements-error')).not.toBeNull();
    expect(text(byId('achievements-detail-title'))).toBe('Постижения');
    expect(byId('achievements-detail-ladder')).toBeNull();
  });

  it('is absent for a person with no loyalty account', async () => {
    const { byId, text } = await mount('series-svc-fade', {
      rig: { loyalty: new InMemoryLoyaltyReader() },
    });
    expect(text(byId('achievements-empty'))).toBe(
      'Първото постижение идва с първото посещение.',
    );
    expect(byId('achievements-detail-medal')).toBeNull();
    expect(
      byId('achievements-detail-head')?.getAttribute('data-headline-style'),
    ).toBe('standard');
  });

  it('shows the saved standing offline, under the offline notice', async () => {
    const { byId, fixture } = await mount('series-svc-fade');
    window.dispatchEvent(new Event('offline'));
    fixture.detectChanges();
    expect(byId('achievements-offline')?.previousElementSibling?.tagName).toBe(
      'UI-SHEET-HEADLINE',
    );
    expect(byId('achievements-detail-ladder')).not.toBeNull();
  });
});

describe('AchievementDetailPage — the stylesheet', () => {
  it('spaces the modules at the sheet’s module gap and reads its own column', () => {
    expect(rule(':host')).toMatchObject({
      display: 'flex',
      'flex-direction': 'column',
      gap: 'var(--sys-space-loose)',
      'container-type': 'inline-size',
    });
    expect(rule('.achievement-detail__module')).toMatchObject({
      'grid-template-columns': 'minmax(0, 1fr)',
      gap: 'var(--sys-space-compact)',
    });
    // Never an `auto` track: the staff rows' min-content is wider than a
    // 330 column, and an `auto` track would let the list stand past the edge.
    // (The pair has a second rule inside the container query: read the sheet.)
    expect(stylesheet()).toMatch(
      /\.achievement-detail__pair \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
  });

  it('sets the ladder’s rows at 68, a compact step apart: the level’s line whole on top, the reward and the day under it, the day tabular at the trailing edge', () => {
    expect(rule('.achievement-detail__level')).toMatchObject({
      'min-block-size': 'calc(var(--sys-space-unit) * 17)',
      'grid-template-columns': 'auto minmax(0, 1fr)',
      'column-gap': 'var(--sys-space-regular)',
    });
    expect(rule('.achievement-detail__levels')).toMatchObject({
      gap: 'var(--sys-space-compact)',
    });
    expect(rule('.achievement-detail__level-words')).toMatchObject({
      'grid-template-columns': 'minmax(0, 1fr)',
      'row-gap': 'var(--sys-space-tight)',
    });
    // The second line wraps as a whole: the day drops under the reward at
    // 330, still at the trailing edge, rather than the reward parting.
    expect(rule('.achievement-detail__level-facts')).toMatchObject({
      display: 'flex',
      'flex-wrap': 'wrap',
      'justify-content': 'space-between',
    });
    expect(rule('.achievement-detail__level-date')).toMatchObject({
      'margin-inline-start': 'auto',
      'font-variant-numeric': 'tabular-nums',
      'white-space': 'nowrap',
    });
  });

  it('keeps a fact of the state line whole', () => {
    expect(rule('.achievement-detail__fact')).toMatchObject({
      'white-space': 'nowrap',
    });
  });

  it('pairs the modules side by side only in a wide column', () => {
    const css = stylesheet();
    expect(css).toMatch(/@container \(inline-size >= 30rem\)/);
    expect(css).toMatch(
      /\.achievement-detail__pair \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
    );
  });

  it('declares no colour, no font shorthand and no size of a DS part’s own: both themes are the system’s', () => {
    const css = stylesheet().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(?:rgb|hsl|oklch|color-mix)\(/);
    expect(css).not.toMatch(/--sys-color-/);
    expect(css).not.toMatch(/^\s*font:/m);
    expect(css).not.toMatch(/\.ui-[a-z-]+__/);
  });
});
