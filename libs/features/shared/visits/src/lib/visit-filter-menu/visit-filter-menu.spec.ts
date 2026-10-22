import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';
import { UiButton, type UiControlSize } from '@creativo/ui/controls';
import { FIXTURE_TODAY } from '@core/testing';
import {
  GEORGI_UID,
  GEORGI_VISITS,
  VISITS_LOOKUP,
  catalogueTranslator,
  provideVisitsCatalogues,
  visitsNowMs,
} from '../testing/visit-fixtures';
import { appCatalogue } from '../testing/app-catalogue';
import { cssRule } from '../testing/css-rule';
import { matchesVisitFilter } from '../visit-filter';
import { VisitList } from '../visit-list/visit-list';
import { visitRowOf, visitWordsOf } from '../visit-row.presenter';
import type { VisitFilter, VisitPerspective } from '../visit-row.vm';
import { sectionVisits, visitSectionLabel } from '../visit-sections';
import { VisitFilterMenu } from './visit-filter-menu';

const CATALOGUES = { bg: appCatalogue('bg'), en: appCatalogue('en') };
const BG = catalogueTranslator(CATALOGUES.bg);
const NOW_MS = visitsNowMs(FIXTURE_TODAY);

@Component({
  imports: [VisitFilterMenu],
  template: `
    <lib-visit-filter
      [perspective]="perspective()"
      [testIdPrefix]="prefix()"
      [offered]="offered()"
      [(value)]="filter"
    />
  `,
})
class MenuHost {
  readonly perspective = signal<VisitPerspective>('client');
  readonly prefix = signal('appointments-filter');
  readonly filter = signal<VisitFilter>('all');
  readonly offered = signal<readonly VisitFilter[] | null>(null);
}

/**
 * «Моите часове»'s funnel and list, rebuilt from the shared parts the way
 * the page composes them (§5.3.5): the menu two-way on the page's filter,
 * the rows narrowed with `matchesVisitFilter`, the filtered empty offering
 * the filter back.
 */
@Component({
  imports: [VisitFilterMenu, VisitList, UiButton],
  template: `
    <lib-visit-filter
      perspective="client"
      testIdPrefix="appointments-filter"
      [(value)]="filter"
    />
    <lib-visit-list
      perspective="client"
      listStyle="insetGrouped"
      [sections]="sections()"
    >
      <p visitListEmpty>{{ emptyText }}</p>
      <button
        visitListEmpty
        uiActions
        type="button"
        uiButton
        uiButtonStyle="bordered"
        uiControlSize="regular"
        data-testid="appointments-clear-filter"
        (click)="filter.set('all')"
      >
        {{ clearText }}
      </button>
    </lib-visit-list>
  `,
})
class PageHost {
  readonly filter = signal<VisitFilter>('all');
  /** The page's book; a spec narrows it to reach the filtered empty. */
  readonly visits = signal(GEORGI_VISITS);
  readonly emptyText = BG('appointments.empty.filtered');
  readonly clearText = BG('visits.filter.clear');
  private readonly words = visitWordsOf(BG, 'bg', 'client');
  private readonly rows = computed(() =>
    this.visits().map((visit) =>
      visitRowOf(
        visit,
        {
          perspective: 'client',
          grain: 'month',
          subjectUserId: GEORGI_UID,
          currentAppointmentId: null,
          nowMs: NOW_MS,
          locale: 'bg',
          words: this.words,
        },
        VISITS_LOOKUP,
      ),
    ),
  );
  readonly sections = computed(() =>
    sectionVisits(
      this.rows().filter((row) => matchesVisitFilter(row, this.filter())),
      {
        grain: 'month',
        labels: {
          upcoming: BG('appointments.sections.upcoming'),
          section: (key) => visitSectionLabel(key, 'bg'),
        },
      },
    ),
  );
}

async function mount<T>(component: new () => T, setup?: (host: T) => void) {
  await TestBed.configureTestingModule({
    imports: [component],
    providers: [provideVisitsCatalogues(CATALOGUES)],
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  }).compileComponents();
  const fixture = TestBed.createComponent(component);
  setup?.(fixture.componentInstance);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const byId = <E extends HTMLElement = HTMLElement>(id: string) =>
    host.querySelector<E>(`[data-testid="${id}"]`);
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { fixture, host, byId, settle };
}

const optionIds = (host: HTMLElement, prefix: string) =>
  [...host.querySelectorAll(`[data-testid^="${prefix}-"]`)].map((option) =>
    option.getAttribute('data-testid'),
  );

const optionWords = (host: HTMLElement, prefix: string) =>
  [...host.querySelectorAll(`[data-testid^="${prefix}-"]`)].map((option) =>
    option.textContent?.replace(/\s+/g, ' ').trim(),
  );

describe('VisitFilterMenu', () => {
  it('is the house funnel: an icon-only bordered neutral 44 trigger that names the choice in force', async () => {
    const { byId } = await mount(MenuHost);

    const trigger = byId<HTMLButtonElement>('appointments-filter');
    expect(trigger?.type).toBe('button');
    expect(trigger?.getAttribute('data-button-style')).toBe('bordered');
    expect(trigger?.getAttribute('data-tint')).toBe('neutral');
    expect(trigger?.getAttribute('data-control-size')).toBe('regular');
    expect(trigger?.hasAttribute('data-icon-only')).toBe(true);
    expect(
      trigger?.querySelector('[data-name="action.filter"]'),
    ).not.toBeNull();
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.getAttribute('aria-label')).toBe('Филтър: Всички');
    expect(trigger?.hasAttribute('data-filtering')).toBe(false);
  });

  it('offers the client’s options in the client’s order and words, on the one choice menu', async () => {
    const { host } = await mount(MenuHost);

    expect(optionIds(host, 'appointments-filter')).toEqual([
      'appointments-filter-all',
      'appointments-filter-upcoming',
      'appointments-filter-completed',
      'appointments-filter-cancelled',
      'appointments-filter-no_show',
    ]);
    expect(optionWords(host, 'appointments-filter')).toEqual([
      'Всички',
      'Предстоящи',
      'Минали',
      'Отказани',
      'Пропуснати',
    ]);
    const all = host.querySelector('[data-testid="appointments-filter-all"]');
    expect(all?.closest('ui-choice-menu')).not.toBeNull();
    expect(all?.getAttribute('role')).toBe('menuitemradio');
    expect(all?.getAttribute('aria-checked')).toBe('true');
    expect(all?.querySelector('[data-name="checklist.done"]')).not.toBeNull();
  });

  it('offers a barber the record’s own order and word: «Неявявания» before «Отказани»', async () => {
    const { host, byId } = await mount(MenuHost, (h) => {
      h.perspective.set('staff');
      h.prefix.set('history-filter');
    });

    expect(byId('history-filter')).not.toBeNull();
    expect(optionIds(host, 'history-filter')).toEqual([
      'history-filter-all',
      'history-filter-upcoming',
      'history-filter-completed',
      'history-filter-no_show',
      'history-filter-cancelled',
    ]);
    expect(optionWords(host, 'history-filter')).toEqual([
      'Всички',
      'Предстоящи',
      'Минали',
      'Неявявания',
      'Отказани',
    ]);
  });

  it('opens from its trigger; a pick sets the host’s filter, closes, and turns the funnel accent', async () => {
    const { fixture, byId, settle } = await mount(MenuHost, (h) => {
      h.perspective.set('staff');
      h.prefix.set('history-filter');
    });
    const trigger = () => byId<HTMLButtonElement>('history-filter');

    trigger()?.click();
    await settle();
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');

    byId<HTMLButtonElement>('history-filter-no_show')?.click();
    await settle();
    expect(fixture.componentInstance.filter()).toBe('no_show');
    expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger()?.hasAttribute('data-filtering')).toBe(true);
    // Accent while it bites: the button's own tint, no neutral.
    expect(trigger()?.hasAttribute('data-tint')).toBe(false);
    expect(trigger()?.getAttribute('aria-label')).toBe('Филтър: Неявявания');
    expect(byId('history-filter-no_show')?.getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('leaves out what no row answers — absent, never disabled — but keeps «Всички» and the choice in force', async () => {
    const { fixture, host, byId, settle } = await mount(MenuHost, (h) => {
      h.perspective.set('staff');
      h.prefix.set('history-filter');
      // A book read to its end with no no-show and no cancellation in it.
      h.offered.set(['all', 'upcoming', 'completed']);
    });

    expect(optionIds(host, 'history-filter')).toEqual([
      'history-filter-all',
      'history-filter-upcoming',
      'history-filter-completed',
    ]);
    expect(host.querySelector('[aria-disabled="true"], [disabled]')).toBeNull();

    // The choice in force stays offered even once nothing answers it, so
    // the menu still shows what bites and the list can be widened again.
    fixture.componentInstance.filter.set('no_show');
    await settle();
    expect(optionIds(host, 'history-filter')).toEqual([
      'history-filter-all',
      'history-filter-upcoming',
      'history-filter-completed',
      'history-filter-no_show',
    ]);
    expect(byId('history-filter')?.getAttribute('aria-label')).toBe(
      'Филтър: Неявявания',
    );
  });

  it('follows the host when it resets the filter', async () => {
    const { fixture, byId, settle } = await mount(MenuHost, (h) =>
      h.filter.set('cancelled'),
    );
    expect(byId('appointments-filter')?.hasAttribute('data-filtering')).toBe(
      true,
    );
    fixture.componentInstance.filter.set('all');
    await settle();
    expect(byId('appointments-filter')?.hasAttribute('data-filtering')).toBe(
      false,
    );
    expect(byId('appointments-filter')?.getAttribute('data-tint')).toBe(
      'neutral',
    );
  });

  it('re-words itself when the language changes', async () => {
    const { host, settle } = await mount(MenuHost);
    TestBed.inject(TranslocoService).setActiveLang('en');
    await settle();
    expect(optionWords(host, 'appointments-filter')).toEqual([
      'All',
      'Upcoming',
      'Past',
      'Cancelled',
      'No-shows',
    ]);
    expect(
      host
        .querySelector('[data-testid="appointments-filter"]')
        ?.getAttribute('aria-label'),
    ).toBe('Filter: All');
  });
});

/** The funnel in the pill rail's trailing slot, as the staff card's «Посещения» projects it. */
@Component({
  imports: [VisitFilterMenu],
  template: `
    <lib-visit-filter
      visitPillsAction
      perspective="staff"
      testIdPrefix="history-filter"
      [controlSize]="controlSize()"
      [(value)]="filter"
    />
  `,
})
class PinnedHost {
  readonly filter = signal<VisitFilter>('all');
  readonly controlSize = signal<UiControlSize | null>(null);
}

describe('VisitFilterMenu · narrowed: the accent as a shape (revision 3 §1.3)', () => {
  it('wears a dot on its rim while a filter bites, and none while it does not', async () => {
    const { fixture, byId, settle } = await mount(MenuHost, (h) => {
      h.perspective.set('staff');
      h.prefix.set('history-filter');
    });
    const trigger = () => byId<HTMLButtonElement>('history-filter');
    expect(trigger()?.querySelector('.visit-filter__dot')).toBeNull();

    fixture.componentInstance.filter.set('no_show');
    await settle();
    const dot = trigger()?.querySelector('.visit-filter__dot');
    expect(dot).not.toBeNull();
    // A mark, not a word: the trigger's name says which filter bites.
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(dot?.textContent).toBe('');
    expect(trigger()?.getAttribute('aria-label')).toBe('Филтър: Неявявания');

    fixture.componentInstance.filter.set('all');
    await settle();
    expect(trigger()?.querySelector('.visit-filter__dot')).toBeNull();
  });

  it('keeps its glyph ink on the accent wash: the button’s own icon-only rule, no paint of its own', async () => {
    const { byId } = await mount(MenuHost, (h) => h.filter.set('cancelled'));
    const trigger = byId<HTMLButtonElement>('appointments-filter');
    // Bordered with no tint is the accent wash; icon-only keeps the
    // foreground glyph (button.css): nothing else names the control.
    expect(trigger?.getAttribute('data-button-style')).toBe('bordered');
    expect(trigger?.hasAttribute('data-tint')).toBe(false);
    expect(trigger?.hasAttribute('data-icon-only')).toBe(true);
    const glyph = trigger?.querySelector('ui-icon');
    expect(glyph?.getAttribute('data-name')).toBe('action.filter');
    expect(glyph?.hasAttribute('data-foreground-style')).toBe(false);

    const css = readFileSync(
      resolve(__dirname, 'visit-filter-menu.css'),
      'utf8',
    );
    // The stylesheet colours ONE thing, the dot, and as a fill.
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(
      /(^|[\s;{])color\s*:/,
    );
    const dot = cssRule(css, '.visit-filter__dot');
    expect(dot.get('background')).toBe('var(--sys-color-accent)');
    expect([dot.get('inline-size'), dot.get('block-size')]).toEqual([
      'var(--sys-size-dot)',
      'var(--sys-size-dot)',
    ]);
    expect(dot.get('border-radius')).toBe('50%');
    // Centred on the circle's rim at 45°, top trailing, at either rung.
    expect(dot.get('position')).toBe('absolute');
    expect(dot.get('inset-block-start')).toBe(
      'calc(14.64% - var(--sys-size-dot) / 2)',
    );
    expect(dot.get('inset-inline-end')).toBe(
      'calc(14.64% - var(--sys-size-dot) / 2)',
    );
    expect(dot.get('pointer-events')).toBe('none');
    expect(cssRule(css, '.visit-filter__trigger').get('position')).toBe(
      'relative',
    );
  });
});

describe('VisitFilterMenu · pinned at the pill rail’s end', () => {
  it('is the rail’s own height, 36, without being asked', async () => {
    const { byId } = await mount(PinnedHost);
    const trigger = byId<HTMLButtonElement>('history-filter');
    expect(trigger?.getAttribute('data-control-size')).toBe('small');
    expect(trigger?.hasAttribute('data-icon-only')).toBe(true);
    expect(trigger?.getAttribute('data-tint')).toBe('neutral');
    expect(trigger?.getAttribute('aria-label')).toBe('Филтър: Всички');
  });

  it('takes the rung its host names, in the rail or in a bar', async () => {
    const pinned = await mount(PinnedHost, (h) => h.controlSize.set('regular'));
    expect(
      pinned.byId('history-filter')?.getAttribute('data-control-size'),
    ).toBe('regular');
  });

  it('stays the bar’s 44 where nothing pins it', async () => {
    const { byId } = await mount(MenuHost);
    expect(byId('appointments-filter')?.getAttribute('data-control-size')).toBe(
      'regular',
    );
  });
});

describe('VisitFilterMenu · «Моите часове» rebuilt from the shared parts', () => {
  const rowIds = (host: HTMLElement) =>
    [...host.querySelectorAll('[data-testid="appointment-row"]')].map((row) =>
      row.getAttribute('data-appointment-id'),
    );

  it('narrows the list to the picked outcome through the funnel', async () => {
    const { host, byId, settle } = await mount(PageHost);
    expect(rowIds(host)).toHaveLength(GEORGI_VISITS.length);

    byId<HTMLButtonElement>('appointments-filter')?.click();
    await settle();
    byId<HTMLButtonElement>('appointments-filter-cancelled')?.click();
    await settle();
    expect(rowIds(host)).toEqual(['appt-jul-cancelled']);
    expect(byId('appointments-filter')?.getAttribute('aria-label')).toBe(
      'Филтър: Отказани',
    );

    byId<HTMLButtonElement>('appointments-filter')?.click();
    await settle();
    byId<HTMLButtonElement>('appointments-filter-upcoming')?.click();
    await settle();
    // The run ahead, soonest first: today's hour, then Friday's.
    expect(rowIds(host)).toEqual(['appt-today', 'appt-oct']);
  });

  it('offers the filter back when nothing matches it, and the way out clears the funnel', async () => {
    const { fixture, host, byId, settle } = await mount(PageHost, (h) => {
      // A book with nothing missed in it…
      h.visits.set(
        GEORGI_VISITS.filter((visit) => visit.bookingStatus !== 'NO_SHOW'),
      );
      // …asked for its no-shows.
      h.filter.set('no_show');
    });

    expect(rowIds(host)).toEqual([]);
    const empty = byId('appointments-empty');
    expect(empty?.textContent).toContain('Няма посещения за този филтър.');
    const clear = byId<HTMLButtonElement>('appointments-clear-filter');
    expect(clear?.textContent?.trim()).toBe('Покажи всички');

    clear?.click();
    await settle();
    expect(fixture.componentInstance.filter()).toBe('all');
    expect(byId('appointments-filter')?.hasAttribute('data-filtering')).toBe(
      false,
    );
    expect(rowIds(host)).toHaveLength(GEORGI_VISITS.length - 1);
  });
});
