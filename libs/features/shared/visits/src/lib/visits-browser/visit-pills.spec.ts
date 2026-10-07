import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UiButton, UiIcon } from '@creativo/ui/controls';
import { appCatalogue } from '../testing/app-catalogue';
import { cssAtRest, cssRule } from '../testing/css-rule';
import { provideVisitsCatalogues } from '../testing/visit-fixtures';
import type { VisitSectionVm } from '../visit-row.vm';
import { visitSectionLabel } from '../visit-sections';
import { VisitPills, type VisitPillsBleed } from './visit-pills';

const CATALOGUES = { bg: appCatalogue('bg'), en: appCatalogue('en') };

/** A section as the rail reads it: its key and its label. */
function section(key: string): VisitSectionVm {
  return {
    key,
    label: key === 'upcoming' ? 'Предстоящи' : visitSectionLabel(key, 'bg'),
    detail: null,
    rows: [],
    testId: `appointments-${key}`,
  };
}

const SECTIONS = ['upcoming', '2026-09', '2026-08', '2026-07'].map(section);

@Component({
  imports: [VisitPills],
  template: `
    <lib-visit-pills
      [sections]="sections()"
      [activeKey]="activeKey()"
      [bleed]="bleed()"
      [testIdPrefix]="prefix()"
      [loading]="loading()"
      (jump)="jumps.push($event)"
    />
  `,
})
class Host {
  readonly sections = signal<readonly VisitSectionVm[]>(SECTIONS);
  readonly activeKey = signal<string | null>('upcoming');
  readonly bleed = signal<VisitPillsBleed>('viewport');
  readonly prefix = signal('appointments');
  readonly loading = signal(false);
  readonly jumps: string[] = [];
}

/** The rail with ONE control pinned at its trailing end: the staff page's funnel. */
@Component({
  imports: [VisitPills, UiButton, UiIcon],
  template: `
    <lib-visit-pills
      bleed="container"
      testIdPrefix="history"
      [sections]="sections()"
      [activeKey]="sections()[0]?.key ?? null"
    >
      <button
        visitPillsAction
        type="button"
        uiButton
        uiButtonStyle="bordered"
        uiTint="neutral"
        uiControlSize="small"
        [uiIconOnly]="true"
        aria-label="Филтър"
        data-testid="pinned-control"
      >
        <ui-icon uiName="action.filter" />
      </button>
    </lib-visit-pills>
  `,
})
class PinnedHost {
  readonly sections = signal<readonly VisitSectionVm[]>(SECTIONS);
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
  const q = <E extends HTMLElement = HTMLElement>(selector: string) =>
    host.querySelector<E>(selector);
  const all = <E extends HTMLElement = HTMLElement>(selector: string) => [
    ...host.querySelectorAll<E>(selector),
  ];
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { fixture, host, q, all, settle };
}

const pillsCss = () =>
  readFileSync(resolve(__dirname, 'visit-pills.css'), 'utf8');

afterEach(() => vi.restoreAllMocks());

describe('VisitPills · the rail', () => {
  it('is a navigation landmark, «Месеци», holding the DS scroll row', async () => {
    const { q } = await mount(Host);

    const nav = q('nav');
    expect(nav?.classList.contains('visit-pills')).toBe(true);
    expect(nav?.getAttribute('aria-label')).toBe('Месеци');
    const rail = q('[data-testid="appointments-pills"]');
    expect(rail?.tagName).toBe('UI-SCROLL-ROW');
    expect(rail?.parentElement).toBe(nav);
    expect(rail?.getAttribute('data-spacing')).toBe('compact');
    // On a page it runs to the viewport's edge…
    expect(rail?.getAttribute('data-full-bleed')).toBe('');
    expect(q('lib-visit-pills')?.getAttribute('data-bleed')).toBe('viewport');
  });

  it('runs to its container’s edge inside a sheet', async () => {
    const { q } = await mount(Host, (h) => h.bleed.set('container'));
    expect(
      q('[data-testid="appointments-pills"]')?.getAttribute('data-full-bleed'),
    ).toBe('container');
    expect(q('lib-visit-pills')?.getAttribute('data-bleed')).toBe('container');
  });

  it('draws one pill per section, in order, each a plain button that names its section', async () => {
    const { all } = await mount(Host);

    const pills = all<HTMLButtonElement>('[data-testid="appointments-pill"]');
    expect(pills.map((pill) => pill.getAttribute('data-section'))).toEqual([
      'upcoming',
      '2026-09',
      '2026-08',
      '2026-07',
    ]);
    expect(pills.map((pill) => pill.textContent?.trim())).toEqual([
      'Предстоящи',
      'Септември 2026 г.',
      'Август 2026 г.',
      'Юли 2026 г.',
    ]);
    for (const pill of pills) {
      expect(pill.tagName).toBe('BUTTON');
      expect(pill.type).toBe('button');
      expect(pill.classList.contains('visit-pills__pill')).toBe(true);
      // A pill NAVIGATES: it is never a toggle.
      expect(pill.hasAttribute('aria-pressed')).toBe(false);
      expect(pill.hasAttribute('role')).toBe(false);
    }
  });

  it('says where the page stands: the current pill alone wears `aria-current` and `data-selected`', async () => {
    const { fixture, all, settle } = await mount(Host);
    const state = () =>
      all('[data-testid="appointments-pill"]').map((pill) => [
        pill.getAttribute('data-section'),
        pill.getAttribute('aria-current'),
        pill.hasAttribute('data-selected'),
      ]);

    expect(state()).toEqual([
      ['upcoming', 'true', true],
      ['2026-09', null, false],
      ['2026-08', null, false],
      ['2026-07', null, false],
    ]);

    fixture.componentInstance.activeKey.set('2026-08');
    await settle();
    expect(state()).toEqual([
      ['upcoming', null, false],
      ['2026-09', null, false],
      ['2026-08', 'true', true],
      ['2026-07', null, false],
    ]);

    // No honest position: no pill is lit.
    fixture.componentInstance.activeKey.set(null);
    await settle();
    expect(state().some(([, current]) => current !== null)).toBe(false);
  });

  it('says which pill was tapped, and moves nothing itself', async () => {
    const { fixture, q, settle } = await mount(Host);
    q<HTMLButtonElement>('[data-section="2026-07"]')?.click();
    await settle();
    expect(fixture.componentInstance.jumps).toEqual(['2026-07']);
    // The host owns where the page stands: the tap lit nothing here.
    expect(q('[data-section="2026-07"]')?.hasAttribute('data-selected')).toBe(
      false,
    );
  });

  it('names its ids after the family its host asks for', async () => {
    const { q, all } = await mount(Host, (h) => h.prefix.set('history'));
    expect(q('[data-testid="history-pills"]')).not.toBeNull();
    expect(all('[data-testid="history-pill"]').length).toBe(4);
    expect(q('[data-testid="appointments-pills"]')).toBeNull();
  });

  it('draws no rail over no section', async () => {
    const { q } = await mount(Host, (h) => h.sections.set([]));
    expect(q('[data-testid="appointments-pills"]')).toBeNull();
    expect(q('.visit-pills__pill')).toBeNull();
  });
});

describe('VisitPills · a pill', () => {
  it('is the client page’s capsule: 36 tall, `subheadline` at 600, on the control fill', () => {
    // At rest: the same pill is ruled once more under reduced motion.
    const pill = cssRule(cssAtRest(pillsCss()), '.visit-pills__pill');
    expect(pill.get('min-block-size')).toBe('var(--control-size-small)');
    expect(pill.get('padding-inline')).toBe('var(--sys-space-regular)');
    expect(pill.get('border-radius')).toBe('var(--control-radius-capsule)');
    expect(pill.get('background')).toBe('var(--sys-color-fill)');
    expect(pill.get('color')).toBe('var(--sys-color-foreground)');
    expect(pill.get('font')).toBe('var(--sys-font-subheadline)');
    expect(pill.get('font-weight')).toBe('600');
    // The `font` shorthand resets the app's figures: said again after it.
    expect(pill.get('font-variant-numeric')).toBe('tabular-nums');
    expect(pill.get('white-space')).toBe('nowrap');
    expect(pill.get('flex')).toBe('0 0 auto');
  });

  it('inverts the current one: the primary fill under its own ink', () => {
    const current = cssRule(pillsCss(), '.visit-pills__pill[data-selected]');
    expect(current.get('background')).toBe('var(--sys-color-primary)');
    expect(current.get('color')).toBe('var(--sys-color-on-primary)');
  });

  it('wears the house state layer, which the original lacked: hover for a pointer, the press for a thumb', async () => {
    const { all } = await mount(Host);
    // The ONE hover and press grammar of the system, through its own
    // modifier: every pill, the current one included.
    expect(
      all('.visit-pills__pill').every((pill) =>
        pill.hasAttribute('data-interactive'),
      ),
    ).toBe(true);

    // …and that grammar is what the spec asks of a pill. jsdom lays nothing
    // out, so the DS's own stylesheet is the contract.
    const grammar = readFileSync(
      resolve(__dirname, '../../../../../../ui/modifiers/modifiers.css'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ');
    // The layer is a `::after` that starts clear…
    expect(grammar).toMatch(
      /\[data-interactive\]::after \{[^}]*background: transparent;/,
    );
    // …fills on hover only where a pointer can hover…
    expect(grammar).toMatch(
      /@media \(hover: hover\) \{ \[data-interactive\]:not\([^)]*\):hover::after \{ background: var\(--sys-state-layer-hover\); \} \}/,
    );
    // …and on a press everywhere: the ungated mirror a thumb sees.
    const press =
      /\[data-interactive\]:not\([^)]*\):active::after \{ background: var\(--sys-state-layer-press\);/;
    expect(grammar).toMatch(press);
    const gated = [...grammar.matchAll(/@media \(hover: hover\) \{(.*?\}) \}/g)]
      .map(([, body]) => body)
      .join(' ');
    expect(gated).not.toMatch(press);

    // The pill's own sheet invents no hover, no press and no ring.
    const own = pillsCss().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(own).not.toMatch(/:hover|:active|:focus/);
  });

  it('stills its own transition for a person who asked for less motion', () => {
    const css = pillsCss()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{ \.visit-pills__pill \{ transition: none; \} \}/,
    );
  });
});

describe('VisitPills · one control, pinned at the rail’s trailing end', () => {
  it('sets the projected control in the band’s trailing column, after the rail', async () => {
    const { q } = await mount(PinnedHost);

    const nav = q('nav.visit-pills');
    const action = q('.visit-pills__action');
    expect(action?.parentElement).toBe(nav);
    expect(action?.previousElementSibling).toBe(
      q('[data-testid="history-pills"]'),
    );
    expect(
      action?.querySelector('[data-testid="pinned-control"]'),
    ).not.toBeNull();
    expect(action?.childElementCount).toBe(1);
  });

  it('is a grid of the rail and the control; the control keeps the trailing track', () => {
    const band = cssRule(pillsCss(), '.visit-pills');
    expect(band.get('display')).toBe('grid');
    expect(band.get('grid-template-columns')).toBe('minmax(0, 1fr) auto');
    expect(band.get('align-items')).toBe('center');
    // The rail's height, pills or none: 36 and the ring's air.
    expect(band.get('min-block-size')).toBe(
      'calc( var(--control-size-small) + 2 * var(--sys-space-tight) )',
    );
    expect(cssRule(pillsCss(), '.visit-pills__rail').get('grid-column')).toBe(
      '1',
    );
    expect(cssRule(pillsCss(), '.visit-pills__action').get('grid-column')).toBe(
      '2',
    );
  });

  it('leaves the column EMPTY without a control, so the band can tell', async () => {
    const { q } = await mount(Host);
    const action = q('.visit-pills__action');
    // Nothing inside, not even a text node: `:empty` holds.
    expect(action?.childNodes.length).toBe(0);
    expect(action?.matches(':empty')).toBe(true);
    expect(
      cssRule(pillsCss(), '.visit-pills__action:empty').get('display'),
    ).toBe('none');
  });

  it('ends the rail before the control, under a short fade, and bleeds on its leading side alone', () => {
    const pinned = cssRule(
      pillsCss(),
      '.visit-pills:has(> .visit-pills__action:not(:empty)) > .visit-pills__rail',
    );
    expect(pinned.get('--visit-pills-fade')).toBe(
      'var(--sys-space-comfortable)',
    );
    expect(pinned.get('inline-size')).toBe('auto');
    expect(pinned.get('margin-inline')).toBe(
      'calc(-1 * var(--ui-scroll-row-gutter)) 0',
    );
    // The fade is the rail's own trailing padding: the last pill scrolls
    // clear of it.
    expect(pinned.get('padding-inline-end')).toBe('var(--visit-pills-fade)');
    expect(pinned.get('scroll-padding-inline-end')).toBe(
      'var(--visit-pills-fade)',
    );
    expect(pinned.get('mask-image')).toBe(
      'linear-gradient( to left, transparent, #000 var(--visit-pills-fade) )',
    );
  });

  it('keeps the control when a filter leaves no section: the way back out is on it', async () => {
    const { q } = await mount(PinnedHost, (h) => h.sections.set([]));
    expect(q('[data-testid="history-pills"]')).toBeNull();
    expect(q('nav.visit-pills')).not.toBeNull();
    expect(
      q('.visit-pills__action [data-testid="pinned-control"]'),
    ).not.toBeNull();
  });

  it('is not there at all when it holds neither a pill nor a control', () => {
    // Asked of the column whether it is EMPTY, never of what it holds: the
    // control is the host's element, outside this view's scope.
    expect(
      cssRule(
        pillsCss(),
        '.visit-pills:not( :has(> .visit-pills__rail, > .visit-pills__action:not(:empty)) )',
      ).get('display'),
    ).toBe('none');
    // The host is no box of its own, so no gap is left behind it.
    expect(cssRule(pillsCss(), ':host').get('display')).toBe('contents');
  });
});

describe('VisitPills · the gutter', () => {
  it('starts the first pill on the content column of a page, as a length', () => {
    const viewport = cssRule(
      pillsCss(),
      ":host([data-bleed='viewport']) .visit-pills__rail",
    );
    expect(viewport.get('--ui-scroll-row-gutter')).toBe(
      'var( --visit-pills-gutter, calc( max((100vw - var(--sys-container-content)) / 2, 0px) + var(--sys-space-regular) ) )',
    );
  });

  it('takes the sheet’s inset inside a sheet, unless its host names a gutter', () => {
    const container = cssRule(
      pillsCss(),
      ":host([data-bleed='container']) .visit-pills__rail",
    );
    expect(container.get('--ui-scroll-row-gutter')).toBe(
      'var( --visit-pills-gutter, var(--ui-sheet-inset, var(--sys-space-regular)) )',
    );
  });
});

describe('VisitPills · while the first page loads', () => {
  it('stands three capsules at the pills’ own height in the rail’s place', async () => {
    const { q, all } = await mount(Host, (h) => {
      h.loading.set(true);
      h.sections.set([]);
    });

    const stand = q('[data-testid="appointments-pills-skeleton"]');
    expect(stand?.getAttribute('aria-hidden')).toBe('true');
    expect(stand?.classList.contains('visit-pills__rail')).toBe(true);
    const capsules = all<HTMLElement>(
      '[data-testid="appointments-pills-skeleton"] > ui-skeleton',
    );
    expect(capsules.length).toBe(3);
    for (const capsule of capsules) {
      expect(capsule.getAttribute('data-radius')).toBe('capsule');
      expect(capsule.style.blockSize).toBe('var(--control-size-small)');
    }
    expect(q('[data-testid="appointments-pills"]')).toBeNull();
    expect(q('.visit-pills__pill')).toBeNull();
  });

  it('draws the placeholders, never the pills, even over sections it already holds', async () => {
    const { q } = await mount(Host, (h) => h.loading.set(true));
    expect(q('[data-testid="appointments-pills-skeleton"]')).not.toBeNull();
    expect(q('.visit-pills__pill')).toBeNull();
  });
});

describe('VisitPills · the current pill stays in sight', () => {
  /** A box on the inline axis; the rail reads nothing else. */
  const box = (left: number, right: number) =>
    ({
      left,
      right,
      top: 0,
      bottom: 36,
      width: right - left,
      height: 36,
    }) as DOMRect;

  async function mountLaidOut(railScrollLeft: number) {
    const mounted = await mount(Host);
    const rail = mounted.q('[data-testid="appointments-pills"]') as HTMLElement;
    const scrollTo = vi.fn();
    Object.defineProperty(rail, 'scrollTo', { value: scrollTo });
    Object.defineProperty(rail, 'scrollLeft', { value: railScrollLeft });
    // A 390 phone: the rail spans the screen, 16 of gutter each side.
    rail.style.paddingInlineStart = '16px';
    rail.style.paddingInlineEnd = '16px';
    vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue(box(0, 390));
    const lay = (key: string, left: number, right: number) =>
      vi
        .spyOn(
          mounted.q(`[data-section="${key}"]`) as HTMLElement,
          'getBoundingClientRect',
        )
        .mockReturnValue(box(left, right));
    return { ...mounted, rail, scrollTo, lay };
  }

  it('follows a pill that the page’s scroll made current past the rail’s trailing edge', async () => {
    const { fixture, scrollTo, lay, settle } = await mountLaidOut(0);
    lay('2026-07', 420, 540);

    fixture.componentInstance.activeKey.set('2026-07');
    await settle();
    // It comes to the rail's leading gutter (16): one of the rail's own
    // snap points, so the scroll rests where it was sent.
    expect(scrollTo).toHaveBeenCalledWith({ left: 404, behavior: 'smooth' });
  });

  it('follows one that is only partly in sight, under the trailing fade', async () => {
    const { fixture, scrollTo, lay, settle } = await mountLaidOut(120);
    lay('2026-08', 300, 380);

    fixture.componentInstance.activeKey.set('2026-08');
    await settle();
    expect(scrollTo).toHaveBeenCalledWith({ left: 404, behavior: 'smooth' });
  });

  it('follows one that is current past the leading edge, back to the gutter', async () => {
    const { fixture, scrollTo, lay, settle } = await mountLaidOut(300);
    lay('2026-09', -120, -10);

    fixture.componentInstance.activeKey.set('2026-09');
    await settle();
    expect(scrollTo).toHaveBeenCalledWith({ left: 164, behavior: 'smooth' });
  });

  it('moves nothing for a pill that is whole inside the rail', async () => {
    const { fixture, scrollTo, lay, settle } = await mountLaidOut(0);
    lay('2026-09', 140, 300);

    fixture.componentInstance.activeKey.set('2026-09');
    await settle();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('jumps without the glide for a person who asked for less motion', async () => {
    const { fixture, scrollTo, lay, settle } = await mountLaidOut(0);
    lay('2026-07', 420, 540);
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
      })),
    );

    fixture.componentInstance.activeKey.set('2026-07');
    await settle();
    expect(scrollTo).toHaveBeenCalledWith({ left: 404, behavior: 'auto' });
    vi.unstubAllGlobals();
  });

  it('never pulls the page: the rail is moved by its own `scrollTo`, on its inline axis alone', () => {
    const source = readFileSync(resolve(__dirname, 'visit-pills.ts'), 'utf8')
      // The reason is written in a comment; the code must not call it.
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toContain('scrollIntoView');
    expect(source).toContain('rail.scrollTo({ left');
  });
});
