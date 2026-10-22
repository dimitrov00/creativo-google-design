import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  memoryAppointmentPhotoPorts,
  memoryAppointmentReadPorts,
  FIXTURE_TODAY,
} from '@core/testing';
import { pluralForm } from '@creativo/infrastructure/i18n';
import { UiButton } from '@creativo/ui/controls';
import { appCatalogue } from '../testing/app-catalogue';
import { cssRule } from '../testing/css-rule';
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
import { VisitFilterMenu } from '../visit-filter-menu/visit-filter-menu';
import type { VisitListPaging, VisitListState } from '../visit-list/visit-list';
import { visitRowOf, visitWordsOf } from '../visit-row.presenter';
import type {
  VisitFilter,
  VisitListStyle,
  VisitPerspective,
  VisitSectionVm,
} from '../visit-row.vm';
import {
  sectionVisits,
  visitSectionLabel,
  workedVisitsDetail,
} from '../visit-sections';
import { VisitsBrowser, type VisitsBrowserBleed } from './visits-browser';

/*
 * THE BROWSER, DRAWN (revision 3 §3.11). Its public API is pinned apart,
 * by its metadata (`visits-browser.contract.spec.ts`); this is what it
 * mounts, and the scroll spy and the jump it owns.
 *
 * jsdom lays nothing out and observes nothing: the observer is a stand-in
 * that records what it was built with and wakes the spy when a case says
 * so; the headings' boxes are what the case lays out (`layOut`), and where
 * a case pins a length the computed style is handed to it.
 */

const CATALOGUES = { bg: appCatalogue('bg'), en: appCatalogue('en') };
const BG = catalogueTranslator(CATALOGUES.bg);
const NOW_MS = visitsNowMs(FIXTURE_TODAY);

// ── The observer's stand-in ─────────────────────────────────────────────

class FakeObserver {
  static readonly built: FakeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    FakeObserver.built.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  unobserve(): void {
    /* never asked for */
  }

  disconnect(): void {
    this.disconnected = true;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /**
   * A heading crossed the band: the spy wakes. WHICH one is not said —
   * the spy reads the answer from the headings' own boxes (`layOut`), not
   * from what crossed.
   */
  fire(): void {
    this.callback([], this as unknown as IntersectionObserver);
  }

  /** The observer in force: the last one built that still watches. */
  static live(): FakeObserver {
    const live = FakeObserver.built.filter((each) => !each.disconnected);
    const last = live.at(-1);
    if (last === undefined) throw new Error('no observer is watching');
    return last;
  }
}

// ── The hosts ───────────────────────────────────────────────────────────

@Component({
  imports: [VisitsBrowser, VisitFilterMenu, UiButton],
  template: `
    <div class="scroller" [style.overflow-y]="scrolls() ? 'auto' : null">
      <lib-visits-browser
        [sections]="sections()"
        [perspective]="perspective()"
        [listStyle]="listStyle()"
        [state]="state()"
        [paging]="paging()"
        [testIdPrefix]="prefix()"
        [pills]="pills()"
        [bleed]="bleed()"
        [interactive]="interactive()"
        (openRow)="opened.push($event)"
        (loadMore)="loads = loads + 1"
        (retry)="retries = retries + 1"
      >
        @if (funnel()) {
          <lib-visit-filter
            visitPillsAction
            perspective="staff"
            testIdPrefix="history-filter"
            [(value)]="filter"
          />
        }
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
      </lib-visits-browser>
    </div>
  `,
})
class Host {
  readonly sections = signal<readonly VisitSectionVm[]>([]);
  readonly perspective = signal<VisitPerspective>('staff');
  readonly listStyle = signal<VisitListStyle>('insetGrouped');
  readonly state = signal<VisitListState>('ready');
  readonly paging = signal<VisitListPaging | null>(null);
  readonly prefix = signal<string | null>(null);
  readonly pills = signal(true);
  readonly bleed = signal<VisitsBrowserBleed>('container');
  readonly interactive = signal<boolean | null>(null);
  readonly funnel = signal(true);
  readonly scrolls = signal(true);
  readonly filter = signal<VisitFilter>('all');
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
  const q = <E extends HTMLElement = HTMLElement>(selector: string) =>
    host.querySelector<E>(selector);
  const all = <E extends HTMLElement = HTMLElement>(selector: string) => [
    ...host.querySelectorAll<E>(selector),
  ];
  const byId = <E extends HTMLElement = HTMLElement>(id: string) =>
    q<E>(`[data-testid="${id}"]`);
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  /** The pill the rail calls current, by its section's key. */
  const current = () =>
    q('[data-testid$="-pill"][data-selected]')?.getAttribute('data-section') ??
    null;
  return { fixture, host, q, all, byId, settle, current };
}

// ── The rows ────────────────────────────────────────────────────────────

const LABELS = {
  upcoming: BG('appointments.sections.upcoming'),
  section: (key: string) => visitSectionLabel(key, 'bg'),
};

/** The staff card's «Посещения»: by month, a heading counted from two worked visits up. */
let staffSections: readonly VisitSectionVm[];

/** «Моите часове»: the client's own rows, by month. */
function clientSections(): readonly VisitSectionVm[] {
  const words = visitWordsOf(BG, 'bg', 'client');
  return sectionVisits(
    GEORGI_VISITS.map((visit) =>
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
    ),
    { grain: 'month', testIdPrefix: 'appointments', labels: LABELS },
  );
}

beforeAll(async () => {
  const rows = await georgiStaffRows(
    {
      history: memoryAppointmentReadPorts(GEORGI_VISITS),
      photos: memoryAppointmentPhotoPorts(GEORGI_SHOTS),
    },
    { words: visitWordsOf(BG, 'bg', 'staff'), nowMs: NOW_MS, grain: 'month' },
  );
  staffSections = sectionVisits(rows, {
    grain: 'month',
    testIdPrefix: 'history',
    labels: {
      ...LABELS,
      detail: workedVisitsDetail((count) =>
        BG(`visits.section.visits.${pluralForm(count, 'bg')}`, { count }),
      ),
    },
  });
});

const STAFF_KEYS = ['upcoming', '2026-09', '2026-08', '2026-07', '2025-12'];

beforeEach(() => {
  FakeObserver.built.length = 0;
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** `scrollIntoView` is not jsdom's: a stand-in on every element, recorded. */
function standInScroll() {
  const scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: scrollIntoView,
    configurable: true,
    writable: true,
  });
  return scrollIntoView;
}

/** The host's clearance, as the engine would resolve it on a heading: px. */
function resolveClearance(px: string) {
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    (element: Element, pseudo?: string | null) => {
      const style = computed(element, pseudo);
      return element.hasAttribute('data-section-key')
        ? new Proxy(style, {
            get: (target, property) =>
              property === 'scrollMarginBlockStart'
                ? px
                : Reflect.get(target, property, target),
          })
        : style;
    },
  );
}

/**
 * jsdom lays nothing out: every heading's box is pinned here, by its key,
 * as the engine would report it against the viewport — and the scroller's
 * own, where a case stands the sheet's body below the viewport's top.
 * Every heading gets a box: one left at jsdom's zero would stand at the
 * line.
 */
function layOut(
  host: HTMLElement,
  tops: Readonly<Record<string, number>>,
  scrollerTop = 0,
): void {
  const boxes = new Map(Object.entries(tops));
  for (const anchor of host.querySelectorAll<HTMLElement>(
    '[data-section-key]',
  )) {
    const key = anchor.getAttribute('data-section-key') ?? '';
    const top = boxes.get(key);
    if (top === undefined) throw new Error(`no box for ${key}`);
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      top,
    } as DOMRect);
  }
  const scroller = host.querySelector('.scroller');
  if (scroller !== null) {
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
      top: scrollerTop,
    } as DOMRect);
  }
}

/**
 * The list scrolled so that `key`'s heading stands at the line (no
 * clearance pinned: the scroller's top): the headings before it above,
 * the ones after it below, a section's height apart.
 */
function scrolledTo(host: HTMLElement, key: string): void {
  const keys = [...host.querySelectorAll('[data-section-key]')].map(
    (anchor) => anchor.getAttribute('data-section-key') ?? '',
  );
  const at = keys.indexOf(key);
  if (at < 0) throw new Error(`no anchor ${key}`);
  layOut(
    host,
    Object.fromEntries(keys.map((each, index) => [each, (index - at) * 200])),
  );
}

describe('VisitsBrowser · the body of both visit screens', () => {
  it('mounts the pills over the list, a section’s gap apart', async () => {
    const { q } = await mount((h) => h.sections.set(staffSections));

    const browser = q('lib-visits-browser');
    expect(browser?.getAttribute('data-perspective')).toBe('staff');
    expect(browser?.getAttribute('data-bleed')).toBe('container');
    expect(
      [...(browser?.children ?? [])].map((child) => child.tagName),
    ).toEqual(['LIB-VISIT-PILLS', 'LIB-VISIT-LIST']);

    const css = readFileSync(resolve(__dirname, 'visits-browser.css'), 'utf8');
    const host = cssRule(css, ':host');
    expect(host.get('display')).toBe('flex');
    expect(host.get('flex-direction')).toBe('column');
    // 24: the gap between the list's own sections, so the first heading
    // stands under the rail as every heading stands under a group.
    expect(host.get('gap')).toBe('var(--sys-space-comfortable)');
  });

  it('draws the staff history as the client’s screen: one pill a section, inset groups, read rows', async () => {
    const { q, all, byId } = await mount((h) => h.sections.set(staffSections));

    expect(byId('history-pills')).not.toBeNull();
    expect(
      all('[data-testid="history-pill"]').map((pill) =>
        pill.getAttribute('data-section'),
      ),
    ).toEqual(STAFF_KEYS);
    // In a sheet the rail runs to the sheet's edge.
    expect(byId('history-pills')?.getAttribute('data-full-bleed')).toBe(
      'container',
    );

    const list = q('lib-visit-list');
    expect(list?.getAttribute('data-list-style')).toBe('insetGrouped');
    expect(list?.getAttribute('data-perspective')).toBe('staff');
    expect(byId('history-list')).not.toBeNull();
    expect(
      all('.visit-list__section').map((section) =>
        section.getAttribute('data-testid'),
      ),
    ).toEqual([
      'history-upcoming',
      'history-month-2026-09',
      'history-month-2026-08',
      'history-month-2026-07',
      'history-month-2025-12',
    ]);
    expect(
      byId('history-month-2026-09')?.querySelector('ul')?.className,
    ).toContain('ui-list-group');
    // Read rows, the staff's fact at the end of their second line.
    expect(q('lib-visit-row button')).toBeNull();
    expect(
      byId('history-row-appt-sep')?.querySelector('[data-fact="amount"]'),
    ).not.toBeNull();
  });

  it('draws «Моите часове» with today’s ids, to the viewport’s edge, its rows the controls', async () => {
    const { fixture, all, byId, settle } = await mount((h) => {
      h.perspective.set('client');
      h.bleed.set('viewport');
      h.funnel.set(false);
      h.sections.set(clientSections());
    });

    const rail = byId('appointments-pills');
    expect(rail?.tagName).toBe('UI-SCROLL-ROW');
    expect(rail?.getAttribute('data-full-bleed')).toBe('');
    const pills = all('[data-testid="appointments-pill"]');
    expect(pills.map((pill) => pill.getAttribute('data-section'))).toEqual(
      STAFF_KEYS,
    );
    expect(pills[0]?.hasAttribute('data-selected')).toBe(true);
    expect(byId('appointments-list')).not.toBeNull();
    // Nothing pinned: the rail is the page's, whole. A host that projects
    // its control under a condition leaves the condition's own anchor (a
    // comment) in the slot, and the column is EMPTY all the same.
    const column = (fixture.nativeElement as HTMLElement).querySelector(
      '.visit-pills__action',
    );
    expect(column?.childElementCount).toBe(0);
    expect(column?.textContent).toBe('');
    expect(column?.matches(':empty')).toBe(true);

    byId<HTMLButtonElement>('appointment-row')?.click();
    await settle();
    expect(fixture.componentInstance.opened).toEqual(['appt-today']);
  });

  it('names its ids after the family its host asks for', async () => {
    const { byId } = await mount((h) => {
      h.prefix.set('medal-visits');
      h.sections.set(staffSections);
    });
    expect(byId('medal-visits-pills')).not.toBeNull();
    expect(byId('medal-visits-list')).not.toBeNull();
    expect(byId('history-pills')).toBeNull();
  });

  it('draws the list alone when its host wants no pills', async () => {
    const { q, byId } = await mount((h) => {
      h.pills.set(false);
      h.sections.set(staffSections);
    });
    expect(q('lib-visit-pills')).toBeNull();
    expect(byId('history-list')).not.toBeNull();
    // Nothing to follow: nothing is watched.
    expect(FakeObserver.built).toEqual([]);
  });

  it('hands the list’s events on, under the list’s own names', async () => {
    const { fixture, byId, settle } = await mount((h) => {
      h.sections.set(staffSections);
      h.paging.set({ kind: 'more', endLabel: null });
    });
    byId<HTMLButtonElement>('history-more')?.click();
    await settle();
    expect(fixture.componentInstance.loads).toBe(1);

    fixture.componentInstance.state.set('error');
    await settle();
    byId<HTMLButtonElement>('history-retry')?.click();
    await settle();
    expect(fixture.componentInstance.retries).toBe(1);
  });

  it('makes the staff’s rows controls when its host says so (owner question Q6)', async () => {
    const { fixture, byId, settle } = await mount((h) => {
      h.interactive.set(true);
      h.sections.set(staffSections);
    });
    const row = byId<HTMLButtonElement>('history-row-appt-aug');
    expect(row?.tagName).toBe('BUTTON');
    row?.click();
    await settle();
    expect(fixture.componentInstance.opened).toEqual(['appt-aug']);
  });
});

describe('VisitsBrowser · one control at the rail’s end', () => {
  it('pins the host’s funnel in the band’s trailing column, at the rail’s own height', async () => {
    const { q, byId } = await mount((h) => h.sections.set(staffSections));

    const funnel = byId('history-filter');
    expect(funnel?.closest('.visit-pills__action')).not.toBeNull();
    expect(funnel?.closest('lib-visit-pills')).toBe(q('lib-visit-pills'));
    // 36, the pills' height, read off the slot it was projected into.
    expect(funnel?.getAttribute('data-control-size')).toBe('small');
  });

  it('keeps the funnel over a filtered empty, the pills gone, the host’s own words under it', async () => {
    const { byId, all } = await mount((h) => {
      h.filter.set('no_show');
      h.sections.set([]);
    });

    expect(byId('history-pills')).toBeNull();
    expect(all('[data-testid="history-pill"]')).toEqual([]);
    const funnel = byId('history-filter');
    expect(funnel).not.toBeNull();
    expect(funnel?.hasAttribute('data-filtering')).toBe(true);
    expect(funnel?.querySelector('.visit-filter__dot')).not.toBeNull();

    const empty = byId('history-empty');
    expect(empty?.tagName).toBe('UI-EMPTY-STATE');
    expect(
      empty?.querySelector('[data-testid="host-empty-text"]'),
    ).not.toBeNull();
    expect(
      empty?.querySelector('[data-testid="history-filter-clear"]'),
    ).not.toBeNull();
  });
});

describe('VisitsBrowser · the states', () => {
  it('stands three pill capsules over two groups of two rows while the first page loads', async () => {
    const { byId, all } = await mount((h) => h.state.set('loading'));

    expect(
      byId('history-pills-skeleton')?.querySelectorAll('ui-skeleton').length,
    ).toBe(3);
    expect(byId('history-pills')).toBeNull();
    const groups = all(
      '[data-testid="history-skeleton"] .visit-list__placeholder-group',
    );
    expect(groups.length).toBe(2);
    expect(
      groups.map((group) => group.querySelectorAll('ui-list-row').length),
    ).toEqual([2, 2]);
    // The funnel is the host's to show or not; projected, it stands.
    expect(byId('history-filter')).not.toBeNull();
    expect(FakeObserver.built).toEqual([]);
  });

  it('draws no pill over a list that did not load, even for sections it still holds', async () => {
    const { byId, all } = await mount((h) => {
      h.state.set('error');
      h.sections.set(staffSections);
    });
    expect(all('[data-testid="history-pill"]')).toEqual([]);
    expect(byId('history-pills-skeleton')).toBeNull();
    expect(byId('history-error')).not.toBeNull();
    expect(byId('history-retry')?.textContent?.trim()).toBe('Опитай пак');
    expect(FakeObserver.built).toEqual([]);
  });
});

describe('VisitsBrowser · the scroll spy', () => {
  it('watches every section heading, against the scroller it rides in', async () => {
    const { q, all } = await mount((h) => h.sections.set(staffSections));

    const observer = FakeObserver.live();
    expect(
      observer.observed.map((anchor) =>
        anchor.getAttribute('data-section-key'),
      ),
    ).toEqual(STAFF_KEYS);
    expect(observer.observed).toEqual(all('h3[data-section-key]'));
    // Inside a sheet the viewport never scrolls: the sheet's body does.
    expect(observer.options.root).toBe(q('.scroller'));
    expect(observer.options.threshold).toBe(0);
  });

  it('watches against the viewport on a page, where nothing above it scrolls', async () => {
    await mount((h) => {
      h.scrolls.set(false);
      h.sections.set(staffSections);
    });
    expect(FakeObserver.live().options.root).toBeNull();
  });

  it('draws its band under the host’s chrome: the heading’s own resolved clearance, in px', async () => {
    // The host states `--visit-list-anchor-clearance` in any unit; an
    // observer takes px, and the heading's scroll margin resolves to it.
    resolveClearance('96px');
    await mount((h) => h.sections.set(staffSections));
    // …and runs to the scroller's foot: a heading crossing the line, down
    // or up, or the foot, wakes the spy.
    expect(FakeObserver.live().options.rootMargin).toBe('-96px 0px 0px 0px');
  });

  it('rounds a clearance the sheet’s chrome resolves to a fraction, and stands at the top with none', async () => {
    resolveClearance('69.59375px');
    const first = await mount((h) => h.sections.set(staffSections));
    expect(FakeObserver.live().options.rootMargin).toBe('-70px 0px 0px 0px');
    first.fixture.destroy();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();

    FakeObserver.built.length = 0;
    await mount((h) => h.sections.set(staffSections));
    expect(FakeObserver.live().options.rootMargin).toBe('-0px 0px 0px 0px');
  });

  it('calls the list’s first section current until the page says otherwise', async () => {
    const { current } = await mount((h) => h.sections.set(staffSections));
    expect(current()).toBe('upcoming');
  });

  it('follows the scroll down: the section at the chrome’s line is current, its heading under the chrome or at the line', async () => {
    resolveClearance('96px');
    const { host, current, settle } = await mount((h) =>
      h.sections.set(staffSections),
    );

    // September's heading slid under the bar (above the line at 96) and
    // August's stands in the clear below it: September's rows are at the
    // line, so September is where we are — not the heading in the clear.
    layOut(host, {
      upcoming: -300,
      '2026-09': 40,
      '2026-08': 240,
      '2026-07': 480,
      '2025-12': 720,
    });
    FakeObserver.live().fire();
    await settle();
    expect(current()).toBe('2026-09');

    // A heading a jump sent to the line, landed half a pixel low, is AT it.
    layOut(host, {
      upcoming: -500,
      '2026-09': -200,
      '2026-08': 96.5,
      '2026-07': 336,
      '2025-12': 576,
    });
    FakeObserver.live().fire();
    await settle();
    expect(current()).toBe('2026-08');
  });

  it('follows the scroll back up, to the first section once the list’s head is in view', async () => {
    resolveClearance('96px');
    const { host, current, settle } = await mount((h) =>
      h.sections.set(staffSections),
    );
    layOut(host, {
      upcoming: -900,
      '2026-09': -600,
      '2026-08': -300,
      '2026-07': 0,
      '2025-12': 300,
    });
    FakeObserver.live().fire();
    await settle();
    expect(current()).toBe('2026-07');

    // Back up past two headings — neither of which need have crossed the
    // observer's band: the last one above the line is August.
    layOut(host, {
      upcoming: -500,
      '2026-09': -200,
      '2026-08': 60,
      '2026-07': 360,
      '2025-12': 660,
    });
    FakeObserver.live().fire();
    await settle();
    expect(current()).toBe('2026-08');

    // At the top every heading stands below the line (the head and the
    // rail are above them): the first section, as before any scroll.
    layOut(host, {
      upcoming: 302,
      '2026-09': 430,
      '2026-08': 546,
      '2026-07': 663,
      '2025-12': 779,
    });
    FakeObserver.live().fire();
    await settle();
    expect(current()).toBe('upcoming');
  });

  it('measures the line from the scroller it rides in, not from the viewport', async () => {
    resolveClearance('110px');
    const { host, current, settle } = await mount((h) =>
      h.sections.set(staffSections),
    );
    // The sheet's body starts 200 under the viewport's top: its line is
    // at 310, and August's heading at 300 is above it. Measured from the
    // viewport the line would be at 110, and only «Предстоящи» above it.
    layOut(
      host,
      {
        upcoming: -100,
        '2026-09': 150,
        '2026-08': 300,
        '2026-07': 400,
        '2025-12': 600,
      },
      200,
    );
    FakeObserver.live().fire();
    await settle();
    expect(current()).toBe('2026-08');
  });

  it('settles when the scroller says its scroll ended, though no heading crossed the band', async () => {
    const { host, q, current, settle } = await mount((h) =>
      h.sections.set(staffSections),
    );
    scrolledTo(host, '2026-07');
    q('.scroller')?.dispatchEvent(new Event('scrollend'));
    await settle();
    expect(current()).toBe('2026-07');
  });

  it('settles on the window’s scroll end on a page', async () => {
    const { host, current, settle } = await mount((h) => {
      h.scrolls.set(false);
      h.sections.set(staffSections);
    });
    scrolledTo(host, '2026-08');
    window.dispatchEvent(new Event('scrollend'));
    await settle();
    expect(current()).toBe('2026-08');
  });

  it('lets go of the headings and of the scroller when it is destroyed', async () => {
    const { fixture, q } = await mount((h) => h.sections.set(staffSections));
    const observer = FakeObserver.live();
    const scroller = q('.scroller');
    if (scroller === null) throw new Error('no scroller');
    const unlisten = vi.spyOn(scroller, 'removeEventListener');
    fixture.destroy();
    expect(observer.disconnected).toBe(true);
    expect(unlisten).toHaveBeenCalledWith('scrollend', expect.any(Function));
  });
});

describe('VisitsBrowser · the jump', () => {
  it('lights the tapped pill at once and scrolls its heading to the top of the band', async () => {
    const scrollIntoView = standInScroll();
    const { byId, q, current, settle } = await mount((h) =>
      h.sections.set(staffSections),
    );

    q<HTMLButtonElement>(
      '[data-testid="history-pill"][data-section="2026-07"]',
    )?.click();
    await settle();
    expect(current()).toBe('2026-07');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(
      byId('history-month-2026-07')?.querySelector('h3'),
    );
    // `start`: the heading's own scroll margin lands it clear of the chrome.
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
  });

  it('lands the headings clear of the host’s chrome: the list reads the host’s clearance', () => {
    const css = readFileSync(
      resolve(__dirname, '../visit-list/visit-list.css'),
      'utf8',
    );
    expect(
      cssRule(css, '[data-section-key]').get('scroll-margin-block-start'),
    ).toBe('var(--visit-list-anchor-clearance, 0px)');
  });

  /*
   * The FIRST pill brings the rail itself to the line, not its heading:
   * the heading stands a section's gap under the rail, so landing it at
   * the line put the rail under the host's chrome, the pill just tapped
   * cut in half by the fade (revision 3 final polish). The browser's own
   * top is the rail's, and it clears the chrome by the headings' length.
   */
  it('brings the rail itself to the line for the first pill, clear of the chrome like a heading', async () => {
    const scrollIntoView = standInScroll();
    const { host, q, current, settle } = await mount((h) =>
      h.sections.set(staffSections),
    );
    const first = staffSections[0]?.key;
    if (first === undefined) throw new Error('no first section');

    q<HTMLButtonElement>(
      `[data-testid="history-pill"][data-section="${first}"]`,
    )?.click();
    await settle();
    expect(current()).toBe(first);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(
      host.querySelector('lib-visits-browser'),
    );
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });

    // Any later pill still lands its own heading.
    q<HTMLButtonElement>(
      '[data-testid="history-pill"][data-section="2026-07"]',
    )?.click();
    await settle();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(scrollIntoView.mock.instances[1]).toBe(
      host.querySelector('[data-section-key="2026-07"]'),
    );

    const css = readFileSync(resolve(__dirname, 'visits-browser.css'), 'utf8');
    expect(cssRule(css, ':host').get('scroll-margin-block-start')).toBe(
      'var(--visit-list-anchor-clearance, 0px)',
    );
  });

  it('jumps without the glide for a person who asked for less motion', async () => {
    const scrollIntoView = standInScroll();
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
      })),
    );
    const { q, settle } = await mount((h) => h.sections.set(staffSections));
    q<HTMLButtonElement>('[data-section="2026-08"]')?.click();
    await settle();
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    });
  });

  it('holds the spy off while its own scroll passes the headings between, until the scroller says it ended', async () => {
    standInScroll();
    const { host, q, current, settle } = await mount((h) =>
      h.sections.set(staffSections),
    );

    q<HTMLButtonElement>('[data-section="2025-12"]')?.click();
    await settle();
    // On its way down the scroll crosses August and July: they light nothing.
    scrolledTo(host, '2026-08');
    FakeObserver.live().fire();
    scrolledTo(host, '2026-07');
    FakeObserver.live().fire();
    await settle();
    expect(current()).toBe('2025-12');

    // The scroller it rides in says the scroll ended: the spy is back —
    // and the tapped pill keeps its word until the next scroll.
    q('.scroller')?.dispatchEvent(new Event('scrollend'));
    await settle();
    expect(current()).toBe('2025-12');
    FakeObserver.live().fire();
    await settle();
    expect(current()).toBe('2026-07');
  });

  it('gives the spy back by the clock where the scroller never says its scroll ended', async () => {
    standInScroll();
    const { host, q, current, settle } = await mount((h) =>
      h.sections.set(staffSections),
    );
    scrolledTo(host, '2026-08');
    vi.useFakeTimers();

    q<HTMLButtonElement>('[data-section="2025-12"]')?.click();
    FakeObserver.live().fire();
    vi.advanceTimersByTime(1199);
    FakeObserver.live().fire();
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    await settle();
    expect(current()).toBe('2025-12');

    FakeObserver.live().fire();
    await settle();
    expect(current()).toBe('2026-08');
  });

  it('listens on the window on a page, where the viewport is the scroller', async () => {
    standInScroll();
    const { host, q, current, settle } = await mount((h) => {
      h.scrolls.set(false);
      h.sections.set(staffSections);
    });
    q<HTMLButtonElement>('[data-section="2025-12"]')?.click();
    await settle();
    scrolledTo(host, '2026-08');
    FakeObserver.live().fire();
    await settle();
    expect(current()).toBe('2025-12');

    window.dispatchEvent(new Event('scrollend'));
    FakeObserver.live().fire();
    await settle();
    expect(current()).toBe('2026-08');
  });
});

describe('VisitsBrowser · when the sections change', () => {
  it('forgets the current pill when a filter changes the sections under it', async () => {
    const { fixture, host, current, all, settle } = await mount((h) =>
      h.sections.set(staffSections),
    );
    scrolledTo(host, '2026-08');
    FakeObserver.live().fire();
    await settle();
    expect(current()).toBe('2026-08');
    const before = FakeObserver.live();

    // «Неявявания»: July alone is left.
    fixture.componentInstance.sections.set(
      staffSections.filter((section) => section.key === '2026-07'),
    );
    await settle();
    expect(
      all('[data-testid="history-pill"]').map((pill) =>
        pill.getAttribute('data-section'),
      ),
    ).toEqual(['2026-07']);
    // The rail falls back to whatever the narrowed list starts with.
    expect(current()).toBe('2026-07');
    // …and the headings of the new list are the ones watched.
    expect(before.disconnected).toBe(true);
    expect(
      FakeObserver.live().observed.map((anchor) =>
        anchor.getAttribute('data-section-key'),
      ),
    ).toEqual(['2026-07']);

    // The filter lifted: a list that begins differently begins again.
    fixture.componentInstance.sections.set(staffSections);
    await settle();
    expect(current()).toBe('upcoming');
  });

  it('keeps the current pill when the next page adds sections at the end', async () => {
    const { fixture, host, current, settle } = await mount((h) =>
      h.sections.set(staffSections.slice(0, 3)),
    );
    scrolledTo(host, '2026-08');
    FakeObserver.live().fire();
    await settle();
    expect(current()).toBe('2026-08');

    // «Покажи още»: older months arrive under the ones on screen.
    fixture.componentInstance.sections.set(staffSections);
    await settle();
    expect(current()).toBe('2026-08');
    // The new headings are watched too.
    expect(FakeObserver.live().observed.length).toBe(STAFF_KEYS.length);
  });

  it('keeps it when only the rows of the same sections change', async () => {
    const { fixture, host, current, settle } = await mount((h) =>
      h.sections.set(staffSections),
    );
    scrolledTo(host, '2026-07');
    FakeObserver.live().fire();
    await settle();
    const watching = FakeObserver.live();

    // The same months, a row's words re-read (a photo was added).
    fixture.componentInstance.sections.set(
      staffSections.map((section) => ({ ...section, rows: [...section.rows] })),
    );
    await settle();
    expect(current()).toBe('2026-07');
    // Nothing moved: the same headings, the same observer.
    expect(FakeObserver.live()).toBe(watching);
  });
});
