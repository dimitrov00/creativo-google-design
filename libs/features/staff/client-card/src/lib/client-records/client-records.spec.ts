import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClientStatsRecord } from '@core/entities';
import type { ClientStatsReadPorts } from '@core/ports';
import { BarberId, ServiceId } from '@core/primitives';
import { PersonalRecordKind } from '@core/components';
import { memoryAppointmentReadPorts } from '@core/testing';
import {
  GEORGI,
  GEORGI_LOYALTY,
  MARTIN,
  catalogPortsOf,
  georgiContext,
  georgiHistory,
  historyPortsOf,
  loyaltyPortsOf,
  martinContext,
  martinHistory,
  must,
  statsOf,
  statsPortsOf,
  subjectOf,
  wallOf,
} from '../../testing/client-card.fixtures';
import {
  heldCatalogPorts,
  type MountOptions,
  PAGE_TITLE_ID,
  mountAchievementsPage,
} from '../../testing/achievements-pages.rig';
import { cssRule } from '../../testing/css-rule';
import { ClientRecordsPage } from './client-records';

/*
 * «РЕКОРДИ», revision 3 (§2.3.4): the page is mounted over the REAL store
 * on Георги's and Мартин's books, the VM the store's own (`records`, P3's
 * presenter over the achievements' data, the stats, the rule in force and
 * the loaded history). What the spec pins is the page's own: the head, the
 * hero card, the groups of inset rows and what leads them, «По години»,
 * and every state's grammar. The words of a row are P3's
 * (`records.presenter.spec.ts`).
 */

/** Георги's stats with one edit: what the book names and the seed does not. */
function statsWith(
  overrides: Partial<ClientStatsRecord>,
): ClientStatsReadPorts {
  return statsPortsOf([
    { ...statsOf(GEORGI, georgiHistory()), ...overrides },
    statsOf(MARTIN, martinHistory()),
  ]);
}

/** A client with an account and no record yet, no visit, no rhythm. */
function nobodyYet(): Pick<MountOptions, 'rig'> {
  const georgi = GEORGI_LOYALTY;
  return {
    rig: {
      loyalty: loyaltyPortsOf([
        {
          ...georgi,
          account: { ...georgi.account, records: [], streaks: [] },
          badgeProgress: [],
          seasonProgress: [],
        },
      ]),
      stats: statsPortsOf([]),
      history: historyPortsOf([]),
    },
  };
}

/** The two books, read ten at a time — older pages remain after the first. */
function pagesOfTen() {
  const inner = memoryAppointmentReadPorts([
    ...georgiHistory(),
    ...martinHistory(),
  ]);
  return {
    ...inner,
    pageClientHistory: (
      ...[subject, before]: Parameters<typeof inner.pageClientHistory>
    ) => inner.pageClientHistory(subject, before, 10),
  };
}

async function mount(options: Partial<MountOptions> = {}) {
  const mounted = await mountAchievementsPage(ClientRecordsPage, {
    subject: subjectOf(GEORGI),
    context: georgiContext(),
    ...options,
  });
  /** A row as drawn: its title, its quiet line, its figure, and what leads it. */
  const row = (id: string) => {
    const element = mounted.byId(`records-row-${id}`);
    if (element === null) return null;
    const disc = element.querySelector<HTMLElement>('ui-avatar');
    return {
      title: mounted.text(element.querySelector('.staff-event-head__title')),
      line: mounted.text(element.querySelector('.staff-event-head__line')),
      figure: mounted.text(element.querySelector('.client-records__figure')),
      // A picture's disc keeps the async image's placeholder until it
      // loads (jsdom never does): only a glyph disc names a glyph.
      glyph: disc?.hasAttribute('data-glyph')
        ? (disc
            .querySelector('.ui-avatar__fallback ui-icon')
            ?.getAttribute('data-name') ?? null)
        : null,
      picture: disc?.hasAttribute('data-glyph') === false,
      name: mounted.text(element.querySelector('[uivisuallyhidden]')),
      long: element.hasAttribute('data-long'),
      longAs: element.getAttribute('data-long'),
    };
  };
  /** The groups in page order, each with its rows' ids. */
  const groups = () =>
    mounted.all('[data-testid^="records-group-"]').map((group) => ({
      theme: group.getAttribute('data-testid')?.replace('records-group-', ''),
      title: mounted.text(group.querySelector('h3')),
      rows: [...group.querySelectorAll('[data-testid^="records-row-"]')].map(
        (element) => element.getAttribute('data-row'),
      ),
    }));
  return { ...mounted, row, groups };
}

afterEach(() => {
  window.dispatchEvent(new Event('online'));
});

describe('ClientRecordsPage — Георги', () => {
  it('heads the page with the sheet’s large title and the person, and names the page container by it', async () => {
    const { byId, text } = await mount();
    const title = byId('records-title');
    expect(title?.tagName).toBe('H2');
    expect(title?.id).toBe(PAGE_TITLE_ID);
    expect(title?.hasAttribute('uisheetlargetitle')).toBe(true);
    expect(title?.getAttribute('data-font')).toBe('largeTitle');
    expect(text(title)).toBe('Рекорди');
    expect(title?.closest('ui-sheet-headline')).not.toBeNull();
    const subline = byId('records-subline');
    expect(text(subline)).toBe('Георги Петров');
    expect(subline?.getAttribute('data-font')).toBe('callout');
    expect(subline?.getAttribute('data-foreground-style')).toBe('secondary');
    expect(byId('records-offline')).toBeNull();
    expect(byId('records-skeleton')).toBeNull();
    expect(byId('records-error')).toBeNull();
    expect(byId('records-empty')).toBeNull();
  });

  it('features the newest record as the page’s ONE hero figure on a white card: the mark, the figure, its words, its day, «Нов рекорд»', async () => {
    const { byId, text } = await mount();
    const featured = byId('records-featured');
    expect(featured?.tagName).toBe('UI-CARD');
    expect(featured?.getAttribute('data-tone')).toBe('elevated');
    expect(featured?.getAttribute('data-padding')).toBe('comfortable');
    expect(featured?.getAttribute('role')).toBe('group');
    expect(featured?.getAttribute('data-kind')).toBe('longestRhythm');
    expect(featured?.hasAttribute('data-new')).toBe(true);
    expect(featured?.getAttribute('aria-label')).toBe(
      'Най-дълъг ритъм: 24 поредни посещения в ритъм, септември 2026 г., нов рекорд',
    );
    // Its parts are hidden from a reader: the sentence says it once.
    for (const part of featured?.querySelectorAll(':scope > *') ?? []) {
      expect(part.getAttribute('aria-hidden')).toBe('true');
    }
    const emblem = featured?.querySelector('ui-avatar.client-records__emblem');
    expect(emblem?.getAttribute('data-control-size')).toBe('large');
    expect(emblem?.hasAttribute('data-picture')).toBe(false);
    expect(
      emblem
        ?.querySelector('.ui-avatar__fallback ui-icon')
        ?.getAttribute('data-name'),
    ).toBe('loyalty.record.longestRhythm');
    const capsule = byId('records-featured-new');
    expect(text(capsule)).toBe('Нов рекорд');
    expect(capsule?.getAttribute('data-tone')).toBe('accent');
    // The figure at the page's one display rung; the words under it at body, the day quiet.
    const figure = byId('records-featured-figure');
    expect(text(figure)).toBe('24');
    expect(figure?.getAttribute('data-font')).toBe('largeTitle');
    const words = figure?.nextElementSibling;
    expect(text(words)).toBe('поредни посещения в ритъм');
    expect(words?.getAttribute('data-font')).toBe('body');
    const day = words?.nextElementSibling;
    expect(text(day)).toBe('септември 2026 г.');
    expect(day?.getAttribute('data-font')).toBe('subheadline');
    expect(day?.getAttribute('data-foreground-style')).toBe('secondary');
    // The mark: the accent behind a white glyph, through the avatar's own ink hook.
    const mark = cssRule(
      'client-records/client-records.css',
      '.client-records__emblem:not([data-picture])',
    );
    expect(mark.get('background')).toBe('var(--sys-color-accent)');
    expect(mark.get('--ui-avatar-ink')).toBe('var(--sys-color-on-accent)');
  });

  it('groups the rows by theme under increased headings, the featured record not repeated, a group without a row absent', async () => {
    const { groups, byId, all } = await mount();
    expect(groups()).toEqual([
      { theme: 'rhythm', title: 'Ритъм', rows: ['currentRhythm'] },
      {
        theme: 'visits',
        title: 'Посещения',
        rows: ['totalVisits', 'last12Months', 'mostVisitsInYear', 'firstVisit'],
      },
      { theme: 'favourites', title: 'Любими', rows: ['favouriteService'] },
    ]);
    expect(byId('records-row-longestRhythm')).toBeNull();
    const rhythm = byId('records-group-rhythm');
    const header = rhythm?.querySelector('ui-section-header');
    expect(header?.getAttribute('data-header-prominence')).toBe('increased');
    expect(header?.querySelector('[uisectionaction]')).toBeNull();
    const list = rhythm?.querySelector('ul');
    expect(list?.classList).toContain('ui-list-group');
    expect(list?.getAttribute('aria-labelledby')).toBe(
      header?.querySelector('h3')?.id,
    );
    // Static rows in this round: no state layer, no chevron.
    for (const li of all('[data-testid^="records-row-"]')) {
      expect(li.tagName).toBe('LI');
      expect(li.classList).toContain('ui-list-row');
      expect(li.getAttribute('data-size')).toBe('regular');
      expect(li.hasAttribute('data-interactive')).toBe(false);
      expect(
        li.querySelector('ui-icon[data-name="nav.disclosure"]'),
      ).toBeNull();
      // The title wraps and the value gives way: never an ellipsis at 330.
      expect(li.hasAttribute('data-label-wraps')).toBe(true);
      expect(li.hasAttribute('data-trailing-wraps')).toBe(true);
      expect(li.getAttribute('data-trailing-prominence')).toBe('primary');
    }
  });

  it('leads a row with a WHITE disc and the accent glyph, the title and its quiet line as one head, the figure at the trailing edge', async () => {
    const { row, byId } = await mount();
    expect(row('currentRhythm')).toEqual({
      title: 'Ритъм сега',
      line: expect.stringMatching(/^от .+ г\.$/),
      figure: '24',
      glyph: 'loyalty.record.currentRhythm',
      picture: false,
      name: expect.stringMatching(/^Ритъм сега: 24 посещения, от .+ г\.$/),
      long: false,
      longAs: null,
    });
    expect(row('totalVisits')).toMatchObject({
      title: 'Общо посещения',
      line: null,
      figure: '24',
      glyph: 'loyalty.record.totalVisits',
    });
    expect(row('last12Months')).toMatchObject({
      title: 'Последните 12 месеца',
      figure: '14',
      glyph: 'loyalty.record.last12Months',
    });
    expect(row('mostVisitsInYear')).toMatchObject({
      title: 'Най-много за година',
      line: '2025 г.',
      figure: '13',
      glyph: 'loyalty.record.mostVisitsInYear',
    });
    // A date with its year is a LONG value: under its title on a 330 phone.
    expect(row('firstVisit')).toMatchObject({
      title: 'Първо посещение',
      figure: '6.03.2025 г.',
      glyph: 'loyalty.record.firstVisit',
      long: true,
    });
    const li = byId('records-row-currentRhythm');
    const disc = li?.querySelector('ui-avatar');
    expect(disc?.hasAttribute('uileading')).toBe(true);
    expect(disc?.getAttribute('data-control-size')).toBe('regular');
    expect(disc?.getAttribute('aria-hidden')).toBe('true');
    const head = li?.querySelector('lib-staff-event-head');
    expect(head?.getAttribute('aria-hidden')).toBe('true');
    expect(head?.getAttribute('data-size')).toBe('regular');
    const figure = li?.querySelector('.client-records__figure');
    expect(figure?.hasAttribute('uitrailing')).toBe(true);
    expect(figure?.getAttribute('data-font')).toBe('headline');
    expect(figure?.getAttribute('aria-hidden')).toBe('true');
    // The disc is white (the elevated surface in dark) with the glyph in the accent.
    const white = cssRule(
      'client-records/client-records.css',
      '.client-records__disc[data-glyph]',
    );
    expect(white.get('background')).toBe('var(--sys-color-surface-elevated)');
    expect(white.get('--ui-avatar-ink')).toBe('var(--sys-color-accent)');
    expect(
      cssRule(
        'client-records/client-records.css',
        '.client-records__figure',
      ).get('font-variant-numeric'),
    ).toBe('tabular-nums');
  });

  it('puts the SERVICE’s cover on the favourite’s row, the barber’s face on his, and the usual services under their title at 330', async () => {
    const { row, groups } = await mount({
      rig: {
        stats: statsWith({
          preferredBarberId: BarberId.of('ivan'),
          usualServiceIds: [
            ServiceId.of('svc-fade'),
            ServiceId.of('svc-beard'),
          ],
        }),
      },
    });
    expect(groups()[2]?.rows).toEqual([
      'favouriteService',
      'preferredBarber',
      'usualServices',
    ]);
    expect(row('favouriteService')).toMatchObject({
      title: 'Любима услуга',
      line: '24 пъти',
      figure: 'Фейд',
      glyph: null,
      picture: true,
      long: false,
    });
    expect(row('preferredBarber')).toMatchObject({
      title: 'Бръснар по избор',
      figure: 'Иван',
      glyph: null,
      picture: true,
    });
    expect(row('usualServices')).toMatchObject({
      title: 'Обичайни услуги',
      figure: 'Фейд · Оформяне на брада',
      glyph: 'loyalty.record.usualServices',
      long: true,
      longAs: 'always',
    });
    // On the narrow step the long value wraps under the title, starting where it starts.
    const under = cssRule(
      'client-records/client-records.css',
      '.client-records__row[data-long] > .client-records__figure',
    );
    expect(under.get('flex-basis')).toBe('100%');
    expect(under.get('text-align')).toBe('start');
    expect(
      cssRule(
        'client-records/client-records.css',
        '.client-records__row[data-long]',
      ).get('flex-wrap'),
    ).toBe('wrap');
    // A service's name goes under its title at EVERY width (review 3, F6:
    // beside it, «Любима услуга» broke one word a line at 390); a date
    // («13 май 2025 г.», 14) only on a narrow column.
    expect(
      cssRule(
        'client-records/client-records.css',
        ".client-records__row[data-long='always']",
      ).get('flex-wrap'),
    ).toBe('wrap');
    expect(
      cssRule(
        'client-records/client-records.css',
        ".client-records__row[data-long='always'] > .client-records__figure",
      ).get('flex-basis'),
    ).toBe('100%');
    // A group measures its own column — a 330 phone's, the dialog's halves.
    expect(
      cssRule(
        'client-records/client-records.css',
        '.client-records__groups > *',
      ).get('container'),
    ).toBe('records-group / inline-size');
  });

  it('puts a two-digit-day date under its title on a PHONE’s column too: «14.05.2025 г.» beside «Първо посещение» broke the title at 390', async () => {
    // No first-visit record on the account: the row reads the stats' day.
    const georgi = GEORGI_LOYALTY;
    const { row } = await mount({
      rig: {
        loyalty: loyaltyPortsOf([
          {
            ...georgi,
            account: {
              ...georgi.account,
              records: georgi.account.records.filter(
                (record) =>
                  record.personalRecordKind !== PersonalRecordKind.FirstVisit,
              ),
            },
          },
        ]),
        stats: statsWith({
          firstVisitLocalDate: wallOf('2025-05-14T10:00:00').localDate,
          firstVisitStartMinutes: wallOf('2025-05-14T10:00:00').minute,
        }),
      },
    });
    expect(row('firstVisit')).toMatchObject({
      title: 'Първо посещение',
      figure: '14.05.2025 г.',
      long: true,
      longAs: 'phone',
    });
    // The stylesheet's step for it: under the title up to a 360 column —
    // a 390 phone's 355 and a 393's 358 — beside it from a 402's 367.
    const css = readFileSync(
      resolve(__dirname, 'client-records.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    const step =
      /@container records-group \(max-width: 22\.5rem\) \{([\s\S]*?)\n\}/u.exec(
        css,
      );
    expect(step?.[1]).toContain(".client-records__row[data-long='phone'] {");
    expect(step?.[1]).toContain(
      ".client-records__row[data-long='phone'] > .client-records__figure {",
    );
    const under = cssRule(
      'client-records/client-records.css',
      ".client-records__row[data-long='phone'] > .client-records__figure",
    );
    expect(under.get('flex-basis')).toBe('100%');
    expect(under.get('text-align')).toBe('start');
    expect(
      cssRule(
        'client-records/client-records.css',
        ".client-records__row[data-long='phone']",
      ).get('flex-wrap'),
    ).toBe('wrap');
  });

  it('draws «По години» as ONE white card of a bar per year, the record year wearing the emblem, each row a meter', async () => {
    const { byId, text, all } = await mount();
    const module = byId('records-years');
    expect(text(module?.querySelector('h3'))).toBe('По години');
    const card = module?.querySelector('ui-card');
    expect(card?.getAttribute('data-tone')).toBe('elevated');
    expect(card?.getAttribute('data-padding')).toBe('comfortable');
    expect(card?.getAttribute('role')).toBe('list');
    expect(card?.getAttribute('aria-labelledby')).toBe(
      module?.querySelector('h3')?.id,
    );
    const years = all('[data-testid^="records-year-"]');
    expect(years.map((year) => year.getAttribute('data-testid'))).toEqual([
      'records-year-2026',
      'records-year-2025',
    ]);
    const best = byId('records-year-2025');
    expect(best?.getAttribute('role')).toBe('listitem');
    expect(best?.hasAttribute('data-record')).toBe(true);
    const bar = best?.querySelector('ui-gauge');
    expect(bar?.getAttribute('data-gauge-style')).toBe('linearCapacity');
    expect(bar?.getAttribute('data-control-size')).toBe('small');
    expect(bar?.getAttribute('role')).toBe('meter');
    expect(bar?.getAttribute('aria-valuetext')).toBe(
      '2025: 13 посещения, рекорд',
    );
    expect(bar?.getAttribute('aria-valuenow')).toBe('13');
    expect(text(best?.querySelector('.client-records__year-count'))).toBe('13');
    expect(
      best
        ?.querySelector('.client-records__year-mark')
        ?.getAttribute('data-name'),
    ).toBe('loyalty.record.mostVisitsInYear');
    const running = byId('records-year-2026');
    expect(running?.hasAttribute('data-record')).toBe(false);
    expect(running?.querySelector('.client-records__year-mark')).toBeNull();
    expect(text(running?.querySelector('.client-records__year-count'))).toBe(
      '11',
    );
    // ONE axis: the card is the grid, every row a subgrid of its columns,
    // so the emblem widens no bar's count column but every row's (review 3).
    expect(
      cssRule(
        'client-records/client-records.css',
        '.client-records__years',
      ).get('display'),
    ).toBe('grid');
    const year = cssRule(
      'client-records/client-records.css',
      '.client-records__year',
    );
    expect(year.get('grid-template-columns')).toBe('subgrid');
    expect(year.get('grid-column')).toBe('1 / -1');
    expect(
      cssRule(
        'client-records/client-records.css',
        '.client-records__year-count',
      ).get('justify-content'),
    ).toBe('flex-end');
  });

  it('lays the groups 2-up in the ≥ 761 px dialog, and keeps every module at the stack’s gap (the stylesheet is the contract)', () => {
    expect(
      cssRule('client-records/client-records.css', ':host').get('gap'),
    ).toBe('var(--sys-space-loose)');
    // The groups: one column on a phone, 2-up from 761 (two rules share
    // the selector, so the sheet itself is read).
    const sheet = readFileSync(
      resolve(__dirname, './client-records.css'),
      'utf8',
    );
    expect(sheet).toMatch(
      /@media \(min-width: 761px\) \{\s*\.client-records__groups \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    // A long name wraps; nothing is cut.
    const subline = cssRule(
      'client-records/client-records.css',
      '.client-records__subline',
    );
    expect(subline.get('text-wrap')).toBe('balance');
    expect(subline.get('overflow-wrap')).toBe('break-word');
  });

  it('words the page in English too', async () => {
    const { byId, text, groups } = await mount({ lang: 'en' });
    expect(text(byId('records-title'))).toBe('Records');
    expect(groups().map((group) => group.title)).toEqual([
      'Rhythm',
      'Visits',
      'Favourites',
    ]);
    expect(text(byId('records-years')?.querySelector('h3'))).toBe('By year');
  });
});

describe('ClientRecordsPage — Мартин in the chair', () => {
  it('features his newest record and names him', async () => {
    const { byId, text, groups } = await mount({
      subject: subjectOf(MARTIN),
      context: martinContext(),
    });
    expect(text(byId('records-subline'))).toBe('Мартин Илиев');
    const featured = byId('records-featured');
    const kind = featured?.getAttribute('data-kind');
    expect(kind).not.toBeNull();
    // The featured record's row is not repeated in its group.
    expect(groups().flatMap((group) => group.rows)).not.toContain(kind);
  });
});

describe('ClientRecordsPage — states', () => {
  it('holds a shaped placeholder — one block, two groups of two rows — while the reads are on their way, then lands', async () => {
    const catalog = heldCatalogPorts();
    const { byId, text, render } = await mount({ rig: { catalog } });
    expect(text(byId('records-title'))).toBe('Рекорди');
    expect(text(byId('records-subline'))).toBe('Георги Петров');
    const skeleton = byId('records-skeleton');
    expect(skeleton?.getAttribute('aria-busy')).toBe('true');
    expect(skeleton?.querySelectorAll('ui-skeleton')).toHaveLength(7);
    expect(byId('records-featured')).toBeNull();

    catalog.answer();
    await render();
    expect(byId('records-skeleton')).toBeNull();
    expect(byId('records-featured')).not.toBeNull();
  });

  it('says the loyalty did not load, and reads it again on «Опитай пак» (the records ride the account’s read)', async () => {
    const catalog = catalogPortsOf().failWith();
    const { byId, text, render } = await mount({ rig: { catalog } });
    const notice = byId('records-error');
    expect(notice?.tagName).toBe('UI-NOTICE');
    expect(notice?.getAttribute('aria-label')).toBe('Лоялността не се зареди.');
    expect(text(byId('records-retry'))).toBe('Опитай пак');
    expect(byId('records-featured')).toBeNull();

    catalog.recover();
    byId('records-retry')?.click();
    await render();
    expect(byId('records-error')).toBeNull();
    expect(byId('records-featured')).not.toBeNull();
  });

  it('says the records come with the first visits when there is no record yet', async () => {
    const { byId, text } = await mount(nobodyYet());
    expect(text(byId('records-empty'))).toBe(
      'Рекордите идват с първите посещения.',
    );
    expect(byId('records-featured')).toBeNull();
    expect(byId('records-groups')).toBeNull();
    expect(byId('records-years')).toBeNull();
  });

  it('is the empty page for a person with no loyalty account', async () => {
    const { byId } = await mount({
      rig: { loyalty: loyaltyPortsOf([]) },
    });
    expect(byId('records-empty')).not.toBeNull();
    expect(byId('records-error')).toBeNull();
  });

  it('drops the «Ритъм» group with `loyalty.streaks` off, and features another record', async () => {
    const { byId, groups } = await mount({
      rig: {
        flags: {
          'client.profile': true,
          'loyalty.points': true,
          'loyalty.streaks': false,
          'loyalty.achievements': true,
          'loyalty.tiers': true,
        },
      },
    });
    expect(groups().map((group) => group.theme)).toEqual([
      'visits',
      'favourites',
    ]);
    expect(byId('records-featured')?.getAttribute('data-kind')).not.toBe(
      'longestRhythm',
    );
  });

  it('shows the saved figures offline, under the offline notice', async () => {
    const { byId, fixture, text } = await mount();
    window.dispatchEvent(new Event('offline'));
    fixture.detectChanges();
    const notice = byId('records-offline');
    expect(text(notice)).toBe('Без връзка · запазени данни');
    expect(notice?.previousElementSibling?.tagName).toBe('UI-SHEET-HEADLINE');
    expect(byId('records-featured')).not.toBeNull();

    window.dispatchEvent(new Event('online'));
    fixture.detectChanges();
    expect(byId('records-offline')).toBeNull();
  });

  it('leaves «По години» out while older pages of the history are still to be read, so a year is never under-counted', async () => {
    const { byId, store } = await mount({
      rig: {
        history: pagesOfTen(),
      },
    });
    expect(store.historyComplete()).toBe(false);
    expect(byId('records-years')).toBeNull();
    expect(must(byId('records-featured'))).not.toBeNull();
  });
});
