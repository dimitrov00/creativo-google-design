import type { AppointmentReadPorts } from '@core/ports';
import { Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { VisitRowOutcome } from '@core/systems';
import { memoryAppointmentReadPorts } from '@core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GEORGI,
  GEORGI_NEXT_ID,
  MARTIN,
  NBSP_EURO,
  georgiContext,
  georgiHistory,
  heldProfilePortsOf,
  historyPortsOf,
  martinContext,
  martinHistory,
  must,
  subjectOf,
} from '../../testing/client-card.fixtures';
import {
  type MountOptions,
  PAGE_TITLE_ID,
  mountAchievementsPage,
} from '../../testing/achievements-pages.rig';
import { cssRule } from '../../testing/css-rule';
import { ClientHistoryPage } from './client-history';

/*
 * «ПОСЕЩЕНИЯ», revision 3 (§2.5): the page is mounted over the REAL store
 * and the real shared browser, on Георги's and Мартин's books. What the
 * spec pins is the page's own: the head's two quiet lines, the browser
 * mounted with the staff's inputs, the funnel pinned in the rail, the
 * empty under a filter, and every state's grammar. The rows' own look is
 * the shared lib's (`visit-row.spec.ts`), the presenter's words P5's
 * (`visits-page.presenter.spec.ts`).
 */

/**
 * The dev books, read in pages of ten (`APPOINTMENT_READ_PORTS` over the
 * `@core/testing` double); the reads named in `failing` (1-based) answer
 * an error.
 */
function tenAtATime(): AppointmentReadPorts & {
  readonly failing: Set<number>;
} {
  const inner = memoryAppointmentReadPorts([
    ...georgiHistory(),
    ...martinHistory(),
  ]);
  const failing = new Set<number>();
  let reads = 0;
  return {
    ...inner,
    failing,
    pageClientHistory: async (subjectCustomerId, beforeUtcMs) => {
      reads += 1;
      if (failing.has(reads)) return Result.err(RepositoryError.unavailable());
      return inner.pageClientHistory(subjectCustomerId, beforeUtcMs, 10);
    },
  };
}

/** A history that never answers: the first page's placeholders. */
function silent(): AppointmentReadPorts {
  return {
    ...memoryAppointmentReadPorts([]),
    pageClientHistory: () => new Promise(() => undefined),
  };
}

async function mount(options: Partial<MountOptions> = {}) {
  const mounted = await mountAchievementsPage(ClientHistoryPage, {
    subject: subjectOf(GEORGI),
    context: georgiContext(),
    ...options,
  });
  const click = async (testId: string) => {
    must(mounted.byId(testId), testId).click();
    await mounted.render();
  };
  /** The loaded rows' test ids, in page order. */
  const rows = () =>
    mounted
      .all('[data-testid^="history-row-"]:not([data-testid$="-quote"])')
      .map((row) => row.getAttribute('data-testid'));
  /** The sections' test ids, in page order. */
  const sections = () =>
    mounted
      .all('[data-testid="history-upcoming"], [data-testid^="history-month-"]')
      .map((section) => section.getAttribute('data-testid'));
  /** The pills' labels, in rail order. */
  const pills = () =>
    mounted
      .all('[data-testid="history-pill"]')
      .map((pill) => mounted.text(pill));
  /** A quiet line as drawn: its FACTS in line order, each one's whitespace folded (the dots between them are the stylesheet's). */
  const visibleFacts = (testId: string) =>
    mounted
      .all(`[data-testid="${testId}"] .fact-line__fact`)
      .map((fact) => mounted.text(fact));
  return { ...mounted, click, rows, sections, pills, visibleFacts };
}

const ADMIN = { uid: 'dev-admin', roles: ['admin'] } as const;

afterEach(() => {
  window.dispatchEvent(new Event('online'));
});

describe('lib-client-history — the head', () => {
  it('heads the page with its name alone, at the sheet’s large title: the page names no person', async () => {
    const { host, byId, text } = await mount();
    expect(host.getAttribute('data-testid')).toBe('history-page');
    expect(host.hasAttribute('data-sheet-fade')).toBe(false);
    const title = must(byId('history-title'));
    expect(title.tagName).toBe('H2');
    expect(title.id).toBe(PAGE_TITLE_ID);
    expect(title.hasAttribute('uisheetlargetitle')).toBe(true);
    expect(title.getAttribute('data-font')).toBe('largeTitle');
    expect(text(title)).toBe('Посещения');
    expect(title.closest('ui-sheet-headline')).not.toBeNull();
    expect(text(byId('history-subline'))).not.toContain('Георги');
    // The stats band is gone: the figures are the line's.
    expect(byId('history-stats')).toBeNull();
    expect(host.querySelector('ui-metric')).toBeNull();
  });

  it('says the record in one quiet line — the figures in primary ink, each keeping its cell’s id — and reads it as one sentence', async () => {
    const { byId, text, visibleFacts, store } = await mount();
    const line = must(byId('history-subline'));
    expect(line.tagName).toBe('P');
    expect(line.closest('ui-sheet-headline')).not.toBeNull();
    expect(line.getAttribute('data-font')).toBe('callout');
    expect(line.getAttribute('data-foreground-style')).toBe('secondary');
    expect(line.classList).toContain('client-history__subline');
    // Said once, as a sentence; the runs are decoration to a reader.
    const sentence = must(line.querySelector('[uivisuallyhidden]'));
    expect(text(sentence)).toBe(store.visits().lineName);
    expect(text(sentence)).toMatch(
      /^Общо: 24 посещения, средно на \d+ седмиц[аи]$/,
    );
    // Two facts of one line, the dot between them drawn by the line
    // (fact-line.css), so a wrap parts between facts and hangs no dot.
    expect(visibleFacts('history-subline')).toEqual([
      '24 посещения',
      expect.stringMatching(/^през \d+ седмици$/),
    ]);
    expect(
      line
        .querySelector('[aria-hidden="true"]')
        ?.classList.contains('fact-line'),
    ).toBe(true);
    expect(cssRule('fact-line.css', '.fact-line')).toEqual(
      new Map([
        ['--fact-line-joint', 'calc(var(--sys-space-unit) * 3)'],
        ['display', 'flex'],
        ['flex-wrap', 'wrap'],
        ['align-items', 'baseline'],
        ['column-gap', 'var(--fact-line-joint)'],
        ['row-gap', '0'],
        ['overflow-x', 'clip'],
        ['overflow-y', 'visible'],
      ]),
    );
    expect(
      cssRule('fact-line.css', '.fact-line__fact:not(:first-child)::before'),
    ).toEqual(
      new Map([
        ['content', "'·' / ''"],
        ['position', 'absolute'],
        ['inset-inline-end', '100%'],
        ['inline-size', 'var(--fact-line-joint)'],
        ['text-align', 'center'],
      ]),
    );
    const visits = must(byId('history-count-visits'));
    expect(visits.tagName).toBe('SPAN');
    expect(text(visits)).toBe('24');
    expect(visits.getAttribute('data-foreground-style')).toBe('primary');
    expect(visits.getAttribute('data-weight')).toBe('medium');
    expect(visits.closest('[data-testid="history-subline"]')).toBe(line);
    expect(text(byId('history-count-cadence'))).toMatch(/^\d+$/);
    // A clean record: no risk figure joins the line.
    expect(byId('history-count-noShows')).toBeNull();
    expect(byId('history-count-cancelled')).toBeNull();
  });

  it('keeps the clean record’s words to the second line; a barber never sees the money', async () => {
    const { byId, text } = await mount();
    const facts = must(byId('history-facts'));
    expect(facts.tagName).toBe('P');
    expect(facts.closest('ui-sheet-headline')).not.toBeNull();
    expect(facts.getAttribute('data-font')).toBe('subheadline');
    expect(facts.getAttribute('data-foreground-style')).toBe('secondary');
    expect(text(facts)).toBe('Без неявявания и откази от клиента');
    expect(byId('history-spend')).toBeNull();
  });

  it('‹admin› · the sum runs on after the note, its figure the line’s one fact', async () => {
    const { byId, visibleFacts } = await mount({
      context: georgiContext({ viewer: ADMIN }),
    });
    const facts = must(byId('history-facts'));
    expect(facts.classList).toContain('fact-line');
    expect(visibleFacts('history-facts')).toEqual([
      'Без неявявания и откази от клиента',
      'похарчени общо 462,50 €',
    ]);
    const spend = must(byId('history-spend'));
    expect(spend.tagName).toBe('SPAN');
    expect(spend.closest('[data-testid="history-facts"]')).toBe(facts);
    expect(spend.getAttribute('data-foreground-style')).toBe('primary');
    expect(spend.getAttribute('data-weight')).toBe('medium');
    // `formatMoney` keeps the sign on the figure's line (a no-break space).
    expect(spend.textContent?.trim()).toBe(NBSP_EURO('462,50 €'));
  });

  it('is the same head in English', async () => {
    const { byId, text } = await mount({ lang: 'en' });
    expect(text(byId('history-title'))).toBe('Visits');
    expect(text(byId('history-count-visits'))).toBe('24');
  });
});

describe('lib-client-history — the browser', () => {
  it('mounts the client’s own browser: inset grouped rows by month under the jump pills, this visit marked, the end on the first visit', async () => {
    const { host, byId, text, sections, rows, pills, store } = await mount();
    const browser = must(host.querySelector('lib-visits-browser'));
    expect(browser.getAttribute('data-perspective')).toBe('staff');
    expect(browser.getAttribute('data-bleed')).toBe('container');
    expect(browser.classList).toContain('client-history__browser');
    const list = must(byId('history-list'));
    expect(
      list.closest('lib-visit-list')?.getAttribute('data-list-style'),
    ).toBe('insetGrouped');
    // «Предстоящи», then the months newest first — the store's sections, in
    // the DOM in that order, each a segmented group under its heading.
    const vm = store.visits();
    expect(sections()).toEqual(vm.sections.map((section) => section.testId));
    expect(sections()[0]).toBe('history-upcoming');
    expect(
      sections()
        .slice(1)
        .every((id) => /^history-month-\d{4}-\d{2}$/.test(id ?? '')),
    ).toBe(true);
    expect(sections().length).toBeGreaterThan(2);
    for (const section of vm.sections) {
      const element = must(byId(section.testId), section.testId);
      const head = must(element.querySelector('ui-section-header'));
      expect(head.getAttribute('data-header-prominence')).toBe('standard');
      expect(head.hasAttribute('data-pinned')).toBe(false);
      expect(element.querySelector('ul[uilistgroup]')).not.toBeNull();
      // «3 посещения» prints only from two worked visits up.
      const worked = section.rows.filter(
        (row) => row.outcome === VisitRowOutcome.Worked,
      );
      const detail = text(head.querySelector('[uisectiondetail]'));
      expect([section.key, detail]).toEqual([
        section.key,
        worked.length >= 2 ? `${worked.length} посещения` : null,
      ]);
    }
    // The pills: one per section, the first current, the rail a landmark.
    // (The month's «г.» hangs on a no-break space; `text` folds it.)
    expect(pills()).toEqual(
      vm.sections.map((section) => section.label.replace(/\s+/g, ' ')),
    );
    const rail = must(byId('history-pills'));
    expect(rail.closest('nav')?.getAttribute('aria-label')).toBe('Месеци');
    const first = must(host.querySelector('[data-testid="history-pill"]'));
    expect(first.hasAttribute('data-selected')).toBe(true);
    expect(first.getAttribute('aria-current')).toBe('true');
    // The rows: every visit, the next one first, static (old R7).
    expect(rows()).toHaveLength(25);
    expect(rows()[0]).toBe(`history-row-${GEORGI_NEXT_ID}`);
    const current = must(byId('history-row-appt-dev-1'));
    expect(current.tagName).toBe('UI-LIST-ROW');
    // The staff's fact ends the second line; the face keeps the edge.
    expect(text(current.querySelector('[data-fact="badge"]'))).toBe('Този час');
    expect(current.querySelector('[data-trailing="badge"]')).toBeNull();
    // The barber's face keeps the trailing edge, as on the client's list.
    expect(current.querySelector('[data-trailing="barber"]')).not.toBeNull();
    // The foot: the list was walked down to its first visit.
    expect(text(byId('history-end'))).toMatch(
      /^Първо посещение: \d{1,2}\.\d{2}\.\d{4} г\.$/,
    );
    expect(byId('history-more')).toBeNull();
  });

  it('pins the funnel at the rail’s trailing end, and narrows in memory to the outcomes the book holds', async () => {
    const { byId, click, sections, rows, pills, all } = await mount();
    const funnel = must(byId('history-filter'));
    expect(funnel.closest('.visit-pills__action')).not.toBeNull();
    expect(funnel.closest('nav')).toBe(
      must(byId('history-pills')).closest('nav'),
    );
    expect(funnel.getAttribute('data-control-size')).toBe('small');
    expect(funnel.getAttribute('aria-label')).toBe('Филтър: Всички');
    expect(funnel.hasAttribute('data-filtering')).toBe(false);
    await click('history-filter');
    // Георги's book, read to its end, holds no no-show and no cancellation:
    // those options are absent, never disabled (the line says «Без …»).
    expect(
      all('[data-testid^="history-filter-"]').map((option) =>
        option.getAttribute('data-testid'),
      ),
    ).toEqual([
      'history-filter-all',
      'history-filter-upcoming',
      'history-filter-completed',
    ]);
    await click('history-filter-upcoming');
    expect(sections()).toEqual(['history-upcoming']);
    expect(rows()).toEqual([`history-row-${GEORGI_NEXT_ID}`]);
    expect(pills()).toEqual(['Предстоящи']);
    expect(byId('history-filter')?.hasAttribute('data-filtering')).toBe(true);
    expect(byId('history-filter')?.getAttribute('aria-label')).toBe(
      'Филтър: Предстоящи',
    );
  });

  it('shows no funnel when no choice would narrow the book — every visit worked, none ahead — and the pills stay', async () => {
    const history = historyPortsOf(
      georgiHistory().filter((visit) => visit.id !== GEORGI_NEXT_ID),
    );
    const { byId, rows, pills } = await mount({ rig: { history } });
    expect(rows()).toHaveLength(24);
    // «Минали» would list the same 24 rows: no menu of «Всички» alone.
    expect(byId('history-filter')).toBeNull();
    expect(pills().length).toBeGreaterThan(1);
    expect(pills()[0]).not.toBe('Предстоящи');
    expect(byId('history-facts')).not.toBeNull();
  });
});

describe('lib-client-history — paging', () => {
  it('reads older visits a page at a time, then says where the history begins', async () => {
    const history = tenAtATime();
    const { byId, text, click, rows } = await mount({ rig: { history } });
    expect(rows()).toHaveLength(10);
    const more = must(byId<HTMLButtonElement>('history-more'));
    expect(text(more)).toBe('Покажи още');
    expect(byId('history-end')).toBeNull();

    await click('history-more');
    expect(rows()).toHaveLength(20);
    await click('history-more');
    expect(rows()).toHaveLength(25);
    expect(byId('history-more')).toBeNull();
    expect(text(byId('history-end'))).toMatch(/^Първо посещение: /);
  });

  it('offers the whole list back when a filter finds nothing: the pills go, the funnel stays, no list is closed', async () => {
    const history = tenAtATime();
    const { byId, text, click, rows } = await mount({ rig: { history } });
    // Older pages remain, and a past outcome may be among them: offered.
    await click('history-filter');
    expect(byId('history-filter-no_show')).not.toBeNull();
    await click('history-filter-no_show');
    expect(rows()).toEqual([]);
    const empty = must(byId('history-empty'));
    expect(empty.tagName).toBe('UI-EMPTY-STATE');
    expect(text(byId('history-filter-empty'))).toBe(
      'Няма посещения за този филтър.',
    );
    expect(text(byId('history-filter-clear'))).toBe('Покажи всички');
    // The way out hugs its words, as every button does.
    expect(byId('history-filter-clear')?.classList).toContain(
      'client-history__clear',
    );
    expect(
      cssRule(
        'client-history/client-history.css',
        '.client-history__clear',
      ).get('align-self'),
    ).toBe('flex-start');
    // No section, no pill — but the funnel keeps the band: the way back
    // out is on it.
    expect(byId('history-pills')).toBeNull();
    expect(byId('history-filter')).not.toBeNull();
    expect(byId('history-filter')?.hasAttribute('data-filtering')).toBe(true);
    // The tap read the book to its end; no end closes a list the filter
    // emptied.
    expect(byId('history-more')).toBeNull();
    expect(byId('history-end')).toBeNull();

    await click('history-filter-clear');
    expect(rows()).toHaveLength(25);
    expect(byId('history-pills')).not.toBeNull();
    expect(byId('history-filter')?.hasAttribute('data-filtering')).toBe(false);
    expect(byId('history-filter-empty')).toBeNull();
    expect(text(byId('history-end'))).toMatch(/^Първо посещение: /);
  });

  it('says so when an older page did not come, keeps the rows, and reads it again', async () => {
    const history = tenAtATime();
    history.failing.add(2);
    const { byId, text, click, rows } = await mount({ rig: { history } });
    await click('history-more');
    expect(rows()).toHaveLength(10);
    expect(text(byId('history-more-failed'))).toBe(
      'Още посещения не се заредиха.',
    );
    expect(text(byId('history-more-retry'))).toBe('Опитай пак');

    await click('history-more-retry');
    expect(rows()).toHaveLength(20);
    expect(byId('history-more-failed')).toBeNull();
    expect(byId('history-more')).not.toBeNull();
  });

  it('offline · keeps the saved rows, says so, and offers no page it cannot read', async () => {
    const history = tenAtATime();
    const { byId, render, rows } = await mount({ rig: { history } });
    window.dispatchEvent(new Event('offline'));
    await render();
    const notice = must(byId('history-offline'));
    expect(notice.tagName).toBe('UI-NOTICE');
    expect(notice.getAttribute('aria-label')).toBe(
      'Без връзка · запазени данни',
    );
    expect(rows()).toHaveLength(10);
    expect(byId('history-more')).toBeNull();
    // The filter works on what is loaded.
    expect(byId('history-filter')).not.toBeNull();
    expect(byId('history-pills')).not.toBeNull();
  });
});

describe('lib-client-history — its states', () => {
  it('loading · the line’s placeholder, three pill capsules and two groups of two rows; nothing to filter yet', async () => {
    const { byId, all, text } = await mount({
      rig: { history: silent() },
      settle: false,
    });
    expect(text(byId('history-title'))).toBe('Посещения');
    expect(byId('history-subline-skeleton')?.getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(byId('history-subline')).toBeNull();
    expect(byId('history-facts')).toBeNull();
    expect(
      all('[data-testid="history-pills-skeleton"] ui-skeleton'),
    ).toHaveLength(3);
    expect(byId('history-skeleton')?.getAttribute('aria-busy')).toBe('true');
    expect(
      all('[data-testid="history-skeleton"] .visit-list__placeholder-group'),
    ).toHaveLength(2);
    expect(all('[data-testid="history-skeleton"] ui-list-row')).toHaveLength(4);
    expect(byId('history-filter')).toBeNull();
    expect(byId('history-pills')).toBeNull();
  });

  it('loading · says the record once it is known, while the list is still on its way', async () => {
    const { byId, text } = await mount({ rig: { history: silent() } });
    expect(byId('history-skeleton')).not.toBeNull();
    expect(byId('history-subline-skeleton')).toBeNull();
    expect(text(byId('history-count-visits'))).toBe('24');
    expect(byId('history-facts')).not.toBeNull();
  });

  it('loading · waits for the profile like the whole card (the D-9 gate)', async () => {
    const profiles = heldProfilePortsOf();
    const { byId, render } = await mount({ rig: { profiles } });
    expect(byId('history-skeleton')).not.toBeNull();
    profiles.answer();
    await render();
    expect(byId('history-skeleton')).toBeNull();
    expect(byId('history-list')).not.toBeNull();
  });

  it('failed · the browser’s one notice and «Опитай пак», the record still said above it', async () => {
    const history = historyPortsOf([...georgiHistory()]).failWith();
    const { byId, text, click, rows } = await mount({ rig: { history } });
    const notice = must(byId('history-error'));
    expect(notice.tagName).toBe('UI-NOTICE');
    expect(text(notice.querySelector('p'))).toBe('Посещенията не се заредиха.');
    expect(text(byId('history-count-visits'))).toBe('24');
    expect(byId('history-filter')).toBeNull();
    expect(byId('history-pills')).toBeNull();

    history.recover();
    await click('history-retry');
    expect(byId('history-error')).toBeNull();
    expect(rows()).toHaveLength(25);
    expect(byId('history-pills')).not.toBeNull();
  });

  it('Мартин · a cancellation the shop made is struck in the full ink, never counted as a visit, and no fact of his', async () => {
    const { byId, text, store } = await mount({
      subject: subjectOf(MARTIN),
      context: martinContext(),
    });
    const cancelled = must(byId('history-row-appt-hist-c2-11'));
    expect(
      cancelled
        .querySelector('lib-staff-event-head')
        ?.hasAttribute('data-struck'),
    ).toBe(true);
    // One mark for one fact: never struck AND faded.
    expect(cancelled.hasAttribute('data-receded')).toBe(false);
    const month = must(
      store
        .visits()
        .sections.find((section) =>
          section.rows.some((row) => row.id === 'appt-hist-c2-11'),
        ),
    );
    const worked = month.rows.filter(
      (row) => row.outcome === VisitRowOutcome.Worked,
    ).length;
    expect(
      text(byId(month.testId)?.querySelector('[uisectiondetail]') ?? null),
    ).toBe(worked >= 2 ? `${worked} посещения` : null);
    // The shop cancelled, not the client: no risk figure in the line.
    expect(byId('history-count-cancelled')).toBeNull();
  });
});

describe('lib-client-history — the stylesheet as a contract', () => {
  // jsdom lays nothing out: the stylesheet is what the spec checks.
  it('spaces the head, the notice and the browser a section apart', () => {
    expect(
      cssRule('client-history/client-history.css', ':host').get('gap'),
    ).toBe('var(--sys-space-comfortable)');
  });

  it('never cuts HB, and balances nothing: both lines wrap BETWEEN their facts (fact-line.css), a fact inside itself only where its words must', () => {
    const line = cssRule(
      'client-history/client-history.css',
      '.client-history__subline',
    );
    // Balanced, the line broke inside a fact; the facts are the items now.
    expect(line.has('text-wrap')).toBe(false);
    expect(line.get('overflow-wrap')).toBe('break-word');
    for (const cut of ['white-space', 'text-overflow', 'overflow']) {
      expect([cut, line.has(cut)]).toEqual([cut, false]);
    }
    const facts = cssRule(
      'client-history/client-history.css',
      '.client-history__facts',
    );
    expect(facts.has('text-wrap')).toBe(false);
    expect(facts.get('overflow-wrap')).toBe('break-word');
  });

  it('lands the browser’s anchors at the sheet’s clear top, under the bar and its fade', () => {
    const browser = cssRule(
      'client-history/client-history.css',
      '.client-history__browser',
    );
    expect(browser.get('--visit-list-anchor-clearance')).toContain(
      'var( --modal-sheet-clear-top,',
    );
  });
});
