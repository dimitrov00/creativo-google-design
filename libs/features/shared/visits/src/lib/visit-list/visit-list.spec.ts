import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { UiButton } from '@creativo/ui/controls';
import {
  memoryAppointmentPhotoPorts,
  memoryAppointmentReadPorts,
  FIXTURE_TODAY,
} from '@core/testing';
import { pluralForm } from '@creativo/infrastructure/i18n';
import {
  GEORGI_SHOTS,
  GEORGI_UID,
  GEORGI_VISITS,
  VISITS_LOOKUP,
  catalogueTranslator,
  georgiStaffRows,
  provideVisitsCatalogues,
  visitsNowMs,
} from '../testing/visit-fixtures';
import { appCatalogue } from '../testing/app-catalogue';
import { visitRowOf, visitWordsOf } from '../visit-row.presenter';
import type {
  VisitListStyle,
  VisitPerspective,
  VisitRowVm,
  VisitSectionVm,
} from '../visit-row.vm';
import { cssRule } from '../testing/css-rule';
import {
  sectionVisits,
  visitSectionLabel,
  workedVisitsDetail,
} from '../visit-sections';
import {
  VisitList,
  type VisitListPaging,
  type VisitListState,
} from './visit-list';

const CATALOGUES = { bg: appCatalogue('bg'), en: appCatalogue('en') };
const BG = catalogueTranslator(CATALOGUES.bg);
const NOW_MS = visitsNowMs(FIXTURE_TODAY);

@Component({
  imports: [VisitList, UiButton],
  template: `
    <lib-visit-list
      [sections]="sections()"
      [perspective]="perspective()"
      [listStyle]="listStyle()"
      [state]="state()"
      [skeletonRows]="skeletonRows()"
      [paging]="paging()"
      (openRow)="opened.push($event)"
      (loadMore)="loads = loads + 1"
      (retry)="retries = retries + 1"
    >
      <p visitListEmpty data-testid="host-empty-text">
        Няма посещения за този филтър.
      </p>
      <button
        visitListEmpty
        uiActions
        type="button"
        uiButton
        uiButtonStyle="bordered"
        uiControlSize="regular"
        data-testid="history-filter-clear"
      >
        Покажи всички
      </button>
    </lib-visit-list>
  `,
})
class Host {
  readonly sections = signal<readonly VisitSectionVm[]>([]);
  readonly perspective = signal<VisitPerspective>('staff');
  readonly listStyle = signal<VisitListStyle>('plain');
  readonly state = signal<VisitListState>('ready');
  readonly skeletonRows = signal(5);
  readonly paging = signal<VisitListPaging | null>(null);
  readonly opened: string[] = [];
  loads = 0;
  retries = 0;
}

async function mount(setup: (host: Host) => void) {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [provideVisitsCatalogues(CATALOGUES)],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  setup(fixture.componentInstance);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(selector: string) =>
    host.querySelector<T>(selector);
  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    q<T>(`[data-testid="${id}"]`);
  const text = (selector: string) =>
    q(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  return { fixture, host, q, byId, text };
}

/** The staff card's history sections: by year, the worked visits counted in each heading. */
function historySections(rows: readonly VisitRowVm[]) {
  return sectionVisits(rows, {
    grain: 'year',
    testIdPrefix: 'history',
    labels: {
      upcoming: BG('appointments.sections.upcoming'),
      section: (key) => visitSectionLabel(key, 'bg'),
      detail: (sectionRows) => {
        const worked = sectionRows.filter(
          (row) => row.outcome === 'worked',
        ).length;
        return worked === 0
          ? null
          : BG(`visits.section.visits.${pluralForm(worked, 'bg')}`, {
              count: worked,
            });
      },
    },
  });
}

let staffSections: readonly VisitSectionVm[];

beforeAll(async () => {
  const rows = await georgiStaffRows(
    {
      history: memoryAppointmentReadPorts(GEORGI_VISITS),
      photos: memoryAppointmentPhotoPorts(GEORGI_SHOTS),
    },
    { words: visitWordsOf(BG, 'bg', 'staff'), nowMs: NOW_MS },
  );
  staffSections = historySections(rows);
});

describe('VisitList · the staff history (plain, by year)', () => {
  it('heads each year with a pinned list label that names its own list', async () => {
    const { host, byId, text } = await mount((h) =>
      h.sections.set(staffSections),
    );

    expect(byId('history-list')).not.toBeNull();
    const sections = [
      ...host.querySelectorAll<HTMLElement>('.visit-list__section'),
    ].map((section) => section.getAttribute('data-testid'));
    expect(sections).toEqual([
      'history-upcoming',
      'history-year-2026',
      'history-year-2025',
    ]);

    const header =
      byId('history-year-2026')?.querySelector('ui-section-header');
    expect(header?.getAttribute('data-header-prominence')).toBe('standard');
    expect(header?.hasAttribute('data-pinned')).toBe(true);
    const heading = header?.querySelector('h3[uititle]');
    expect(heading?.id).toBe('visit-section-2026');
    expect(heading?.getAttribute('data-section-key')).toBe('2026');
    expect(heading?.textContent?.trim()).toBe('2026');
    expect(
      header?.querySelector('[uisectiondetail]')?.textContent?.trim(),
    ).toBe('2 посещения');

    // The upcoming run is a promise, not a record: no count on its head.
    expect(text('[data-testid="history-upcoming"] h3')).toBe('Предстоящи');
    expect(
      byId('history-upcoming')?.querySelector('[uisectiondetail]'),
    ).toBeNull();
    expect(
      byId('history-year-2025')?.querySelector('[uisectiondetail]')
        ?.textContent,
    ).toContain('1 посещение');
  });

  it('sets the rows on the page: a real list of read rows, no segment fill', async () => {
    const { byId } = await mount((h) => h.sections.set(staffSections));

    const list = byId('history-year-2026')?.querySelector('ul');
    expect(list?.getAttribute('role')).toBe('list');
    expect(list?.classList.contains('ui-list-group')).toBe(false);
    expect(list?.getAttribute('aria-labelledby')).toBe('visit-section-2026');
    const items = [...(list?.children ?? [])];
    expect(items.every((item) => item.tagName === 'LIB-VISIT-ROW')).toBe(true);
    expect(
      items.every((item) => item.getAttribute('role') === 'listitem'),
    ).toBe(true);
    // Newest first under a year; the upcoming run soonest first.
    expect(
      items.map((item) =>
        item.querySelector('[data-testid]')?.getAttribute('data-testid'),
      ),
    ).toEqual([
      'history-row-appt-sep',
      'history-row-appt-aug',
      'history-row-appt-jul-cancelled',
      'history-row-appt-jul-no-show',
    ]);
    expect(
      [
        ...(byId('history-upcoming')?.querySelectorAll(
          '[data-testid^="history-row-"]',
        ) ?? []),
      ].map((row) => row.getAttribute('data-testid')),
    ).toEqual(['history-row-appt-today', 'history-row-appt-oct']);
  });

  it('opens nothing from a staff row', async () => {
    const { fixture, host } = await mount((h) => h.sections.set(staffSections));
    expect(host.querySelector('lib-visit-row button')).toBeNull();
    host
      .querySelector<HTMLElement>('[data-testid="history-row-appt-sep"]')
      ?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.opened).toEqual([]);
  });

  it('stands five placeholder rows in the rows’ own shape while the first page loads', async () => {
    const { byId, q } = await mount((h) => {
      h.state.set('loading');
      h.sections.set(staffSections);
    });

    const skeleton = byId('history-skeleton');
    expect(skeleton?.getAttribute('aria-busy')).toBe('true');
    const rows = skeleton?.querySelectorAll('ui-list-row') ?? [];
    expect(rows.length).toBe(5);
    expect(rows[0]?.getAttribute('data-size')).toBe('regular');
    expect(rows[0]?.querySelector('ui-skeleton[uileading]')).not.toBeNull();
    expect(q('[data-testid="history-list"]')).toBeNull();
  });

  it('draws as many placeholders as it is asked for', async () => {
    const { byId } = await mount((h) => {
      h.state.set('loading');
      h.skeletonRows.set(3);
    });
    expect(
      byId('history-skeleton')?.querySelectorAll('ui-list-row').length,
    ).toBe(3);
  });

  it('says the history did not load, with the one retry', async () => {
    const { fixture, byId } = await mount((h) => h.state.set('error'));

    const notice = byId('history-error');
    expect(notice?.tagName).toBe('UI-NOTICE');
    expect(notice?.getAttribute('aria-label')).toBe(
      'Посещенията не се заредиха.',
    );
    expect(notice?.textContent).toContain('Посещенията не се заредиха.');
    const retry = byId<HTMLButtonElement>('history-retry');
    expect(retry?.hasAttribute('uinoticeactions')).toBe(true);
    expect(retry?.textContent?.trim()).toBe('Опитай пак');
    expect(retry?.getAttribute('data-tint')).toBe('neutral');

    retry?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.retries).toBe(1);
  });

  it('words its empty in the host’s own words, the host’s action beneath', async () => {
    const { byId } = await mount((h) => h.sections.set([]));

    const empty = byId('history-empty');
    expect(empty?.tagName).toBe('UI-EMPTY-STATE');
    expect(
      empty?.querySelector('[data-testid="host-empty-text"]'),
    ).not.toBeNull();
    const clear = empty?.querySelector('[data-testid="history-filter-clear"]');
    expect(clear?.parentElement).toBe(empty);
    expect(byId('history-list')).toBeNull();
  });

  it('hugs the empty’s action to its label on the copy’s leading edge, never a full-width bar', async () => {
    const { byId } = await mount((h) => h.sections.set([]));
    expect(byId('history-empty')?.classList).toContain('visit-list__empty');
    const css = readFileSync(resolve(__dirname, 'visit-list.css'), 'utf8');
    const rule = /\.visit-list__empty\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/align-items:\s*flex-start;/);
  });
});

describe('VisitList · the foot', () => {
  it('offers the next page, hugged and centred', async () => {
    const { fixture, byId } = await mount((h) => {
      h.sections.set(staffSections);
      h.paging.set({ kind: 'more', endLabel: null });
    });

    const more = byId<HTMLButtonElement>('history-more');
    expect(more?.textContent?.trim()).toBe('Покажи още');
    expect(more?.getAttribute('data-button-style')).toBe('bordered');
    expect(more?.getAttribute('data-tint')).toBe('neutral');
    expect(more?.closest('ui-stack')?.getAttribute('data-alignment')).toBe(
      'center',
    );
    more?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.loads).toBe(1);
  });

  it('turns its own ring while the page is on its way, and asks nothing twice', async () => {
    const { fixture, byId } = await mount((h) => {
      h.sections.set(staffSections);
      h.paging.set({ kind: 'loading', endLabel: null });
    });

    const more = byId<HTMLButtonElement>('history-more');
    expect(more?.getAttribute('aria-busy')).toBe('true');
    expect(more?.querySelector('.ui-button__progress')).not.toBeNull();
    more?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.loads).toBe(0);
  });

  it('says the next page did not come, and tries it again', async () => {
    const { fixture, byId } = await mount((h) => {
      h.sections.set(staffSections);
      h.paging.set({ kind: 'failed', endLabel: null });
    });

    expect(byId('history-more-failed')?.textContent?.trim()).toBe(
      'Още посещения не се заредиха.',
    );
    expect(byId('history-more-failed')?.getAttribute('role')).toBe('status');
    expect(byId('history-more')).toBeNull();
    byId<HTMLButtonElement>('history-more-retry')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.loads).toBe(1);
  });

  it('ends in the host’s words, and says nothing when it has none', async () => {
    const endLabel = BG('clientCard.history.end', { date: '6.03.2025 г.' });
    const { fixture, byId } = await mount((h) => {
      h.sections.set(staffSections);
      h.paging.set({ kind: 'end', endLabel });
    });
    expect(byId('history-end')?.textContent?.trim()).toBe(endLabel);
    expect(byId('history-end')?.getAttribute('data-text-alignment')).toBe(
      'center',
    );

    fixture.componentInstance.paging.set({ kind: 'end', endLabel: null });
    fixture.detectChanges();
    expect(byId('history-end')).toBeNull();
    expect(fixture.nativeElement.querySelector('.visit-list__foot')).toBeNull();
  });

  it('closes nothing that is not there: no end under a list a filter emptied, but a page still to read stays', async () => {
    const endLabel = BG('clientCard.history.end', { date: '6.03.2025 г.' });
    const { fixture, byId } = await mount((h) => {
      h.sections.set([]);
      h.paging.set({ kind: 'end', endLabel });
    });
    expect(byId('history-empty')).not.toBeNull();
    expect(byId('history-end')).toBeNull();
    expect(fixture.nativeElement.querySelector('.visit-list__foot')).toBeNull();

    // An older page may still hold what the filter asks for.
    fixture.componentInstance.paging.set({ kind: 'more', endLabel: null });
    fixture.detectChanges();
    expect(byId('history-more')).not.toBeNull();
  });
});

describe('VisitList · «Моите часове» (inset grouped, by month)', () => {
  function clientSections(): readonly VisitSectionVm[] {
    const words = visitWordsOf(BG, 'bg', 'client');
    const rows = GEORGI_VISITS.map((visit) =>
      visitRowOf(
        visit,
        {
          perspective: 'client',
          grain: 'month',
          subjectUserId: GEORGI_UID,
          currentAppointmentId: null,
          nowMs: NOW_MS,
          locale: 'bg',
          words,
        },
        VISITS_LOOKUP,
      ),
    );
    return sectionVisits(rows, {
      grain: 'month',
      labels: {
        upcoming: BG('appointments.sections.upcoming'),
        section: (key) => visitSectionLabel(key, 'bg'),
      },
    });
  }

  it('runs each month as one segmented group under a quiet label, with the year in it', async () => {
    const { byId, host } = await mount((h) => {
      h.perspective.set('client');
      h.listStyle.set('insetGrouped');
      h.sections.set(clientSections());
    });

    expect(byId('appointments-list')).not.toBeNull();
    const september = host.querySelector('h3[data-section-key="2026-09"]');
    // Intl's own form: a narrow no-break space before «г.».
    expect(september?.textContent?.trim()).toBe('Септември 2026\u202fг.');
    const header = september?.closest('ui-section-header');
    expect(header?.hasAttribute('data-pinned')).toBe(false);
    // The client's list counts nothing in its headings.
    expect(header?.querySelector('[uisectiondetail]')).toBeNull();

    const group = host.querySelector(
      'ul[aria-labelledby="visit-section-2026-09"]',
    );
    expect(group?.classList.contains('ui-list-group')).toBe(true);
    expect(
      group?.querySelectorAll('[data-testid="appointment-row"]').length,
    ).toBe(1);
    // A month before the year's: last December is its own section, never a
    // second «Декември» under this year.
    expect(
      host.querySelector('h3[data-section-key="2025-12"]')?.textContent?.trim(),
    ).toBe('Декември 2025\u202fг.');
  });

  it('opens the tapped visit by its id', async () => {
    const { fixture, host } = await mount((h) => {
      h.perspective.set('client');
      h.listStyle.set('insetGrouped');
      h.sections.set(clientSections());
    });

    host
      .querySelector<HTMLButtonElement>(
        '[data-testid="appointment-row"][data-appointment-id="appt-sep"]',
      )
      ?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.opened).toEqual(['appt-sep']);
  });

  it('stands its placeholders in a segmented group, like the rows they stand for', async () => {
    const { byId } = await mount((h) => {
      h.perspective.set('client');
      h.listStyle.set('insetGrouped');
      h.state.set('loading');
    });
    const group = byId('appointments-skeleton')?.querySelector('ui-list-group');
    expect(group?.querySelectorAll(':scope > ui-list-row').length).toBe(5);
  });
});

// ── Revision 3 (§2.5, §3.11): the staff history is the client's screen ──

@Component({
  imports: [VisitList],
  template: `
    <lib-visit-list
      [sections]="sections()"
      [perspective]="perspective()"
      listStyle="insetGrouped"
      [state]="state()"
      [interactive]="interactive()"
      [skeletonRows]="skeletonRows()"
      [skeletonGroups]="skeletonGroups()"
      (openRow)="opened.push($event)"
    />
  `,
})
class BrowserHost {
  readonly sections = signal<readonly VisitSectionVm[]>([]);
  readonly perspective = signal<VisitPerspective>('staff');
  readonly state = signal<VisitListState>('ready');
  readonly interactive = signal<boolean | null>(null);
  readonly skeletonRows = signal(2);
  readonly skeletonGroups = signal(2);
  readonly opened: string[] = [];
}

async function mountBrowserHost(setup: (host: BrowserHost) => void) {
  await TestBed.configureTestingModule({
    imports: [BrowserHost],
    providers: [provideVisitsCatalogues(CATALOGUES)],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  }).compileComponents();
  const fixture = TestBed.createComponent(BrowserHost);
  setup(fixture.componentInstance);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    host.querySelector<T>(`[data-testid="${id}"]`);
  return { fixture, host, byId };
}

describe('VisitList · the staff history as the client’s screen (inset grouped, by month)', () => {
  let monthSections: readonly VisitSectionVm[];

  beforeAll(async () => {
    const rows = await georgiStaffRows(
      {
        history: memoryAppointmentReadPorts(GEORGI_VISITS),
        photos: memoryAppointmentPhotoPorts(GEORGI_SHOTS),
      },
      {
        words: visitWordsOf(BG, 'bg', 'staff'),
        nowMs: NOW_MS,
        grain: 'month',
      },
    );
    monthSections = sectionVisits(rows, {
      grain: 'month',
      testIdPrefix: 'history',
      labels: {
        upcoming: BG('appointments.sections.upcoming'),
        section: (key) => visitSectionLabel(key, 'bg'),
        detail: workedVisitsDetail((count) =>
          BG(`visits.section.visits.${pluralForm(count, 'bg')}`, { count }),
        ),
      },
    });
  });

  it('runs each month as one segmented group of read rows, its heading in flow', async () => {
    const { host, byId } = await mountBrowserHost((h) =>
      h.sections.set(monthSections),
    );

    expect(
      [...host.querySelectorAll<HTMLElement>('.visit-list__section')].map(
        (section) => section.getAttribute('data-testid'),
      ),
    ).toEqual([
      'history-upcoming',
      'history-month-2026-09',
      'history-month-2026-08',
      'history-month-2026-07',
      'history-month-2025-12',
    ]);
    const header = byId('history-month-2026-09')?.querySelector(
      'ui-section-header',
    );
    expect(header?.getAttribute('data-header-prominence')).toBe('standard');
    expect(header?.hasAttribute('data-pinned')).toBe(false);
    const group = byId('history-month-2026-07')?.querySelector('ul');
    expect(group?.classList.contains('ui-list-group')).toBe(true);
    expect(group?.getAttribute('aria-labelledby')).toBe(
      'visit-section-2026-07',
    );
    // Read rows: nothing to press, as the staff's perspective has it.
    expect(host.querySelector('lib-visit-row button')).toBeNull();
    expect(
      [...(group?.querySelectorAll('ui-list-row') ?? [])].map((row) =>
        row.getAttribute('data-testid'),
      ),
    ).toEqual([
      'history-row-appt-jul-cancelled',
      'history-row-appt-jul-no-show',
    ]);
  });

  it('counts a month in its heading only from two worked visits up', async () => {
    const { byId } = await mountBrowserHost((h) =>
      h.sections.set(monthSections),
    );
    // One worked visit a month, at a barber's cadence: the headings stand
    // alone, as the client's do.
    for (const id of [
      'history-month-2026-09',
      'history-month-2026-08',
      'history-month-2026-07',
    ]) {
      expect(byId(id)?.querySelector('[uisectiondetail]')).toBeNull();
    }
  });

  it('makes its rows controls when the host says so, and opens the tapped one by its id', async () => {
    const { fixture, host } = await mountBrowserHost((h) => {
      h.sections.set(monthSections);
      h.interactive.set(true);
    });
    const row = host.querySelector<HTMLButtonElement>(
      'button[data-testid="history-row-appt-sep"]',
    );
    expect(row?.hasAttribute('data-interactive')).toBe(true);
    row?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.opened).toEqual(['appt-sep']);
  });

  it('makes a client’s rows read rows when the host says so', async () => {
    const { fixture, host } = await mountBrowserHost((h) => {
      h.perspective.set('client');
      h.interactive.set(false);
      h.sections.set(monthSections);
    });
    expect(host.querySelector('button')).toBeNull();
    host.querySelector<HTMLElement>('ui-list-row')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.opened).toEqual([]);
  });

  it('stands its placeholders as the list stands: groups, each under its heading’s line', async () => {
    const { byId } = await mountBrowserHost((h) => h.state.set('loading'));

    const skeleton = byId('history-skeleton');
    expect(skeleton?.getAttribute('aria-busy')).toBe('true');
    const groups = [
      ...(skeleton?.querySelectorAll(
        ':scope > .visit-list__placeholder-group',
      ) ?? []),
    ];
    expect(groups.length).toBe(2);
    for (const group of groups) {
      expect(group.getAttribute('aria-hidden')).toBe('true');
      // The heading's line, then the rows in their segmented group.
      expect(group.firstElementChild?.tagName).toBe('UI-SKELETON');
      expect(
        group.firstElementChild?.classList.contains(
          'visit-list__placeholder-heading',
        ),
      ).toBe(true);
      expect(group.querySelectorAll('ui-list-group > ui-list-row').length).toBe(
        2,
      );
    }
  });

  it('heads a single placeholder group with nothing: a bare run of rows, as it always was', async () => {
    const { byId } = await mountBrowserHost((h) => {
      h.state.set('loading');
      h.skeletonGroups.set(1);
      h.skeletonRows.set(5);
    });
    const skeleton = byId('history-skeleton');
    expect(
      skeleton?.querySelector('.visit-list__placeholder-heading'),
    ).toBeNull();
    expect(skeleton?.querySelectorAll('ui-list-row').length).toBe(5);
  });

  it('spaces the placeholder groups as the sections they stand for', () => {
    const css = readFileSync(resolve(__dirname, 'visit-list.css'), 'utf8');
    // A section's gap between groups, a compact one under a heading: the
    // list's own rhythm (`ui-stack` comfortable / compact).
    expect(cssRule(css, '.visit-list__placeholders').get('gap')).toBe(
      'var(--sys-space-comfortable)',
    );
    expect(cssRule(css, '.visit-list__placeholder-group').get('gap')).toBe(
      'var(--sys-space-compact)',
    );
  });
});
