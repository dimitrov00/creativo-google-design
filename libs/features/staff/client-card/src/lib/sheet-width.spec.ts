import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FAMILY_TILE_MIN_REM,
  MEDAL_GRID_COMPACT,
  MEDAL_GRID_REGULAR,
  MEDAL_TILE_MIN_REM,
  MEDAL_WIDE_COLUMN_REM,
  type MedalGrid,
  RECORD_CARD_MIN_REM,
  GLANCE_TILE_MIN_REM,
  familyGridFor,
  familyGridOf,
  familyTilePx,
  glanceCardPaddingFor,
  measuredWidthOf,
  medalGridFor,
  medalGridOf,
  medalTilePx,
  recordColumnsFor,
  recordFigureFontFor,
} from './sheet-width';

/** The sheet's column on a phone `viewport` wide: its two 1.1rem insets off. */
const phoneColumn = (viewport: number, remPx = 16) => viewport - 2.2 * remPx;

/** The spacing rungs in px at a 16 px root (`tokens.css`). */
const RUNG_PX = { tight: 4, compact: 8, regular: 16, comfortable: 24 } as const;

/** A tile's width, worked out by hand from a step's own rungs. */
function tileOf(column: number, grid: MedalGrid): number {
  const padding =
    RUNG_PX[grid.padding] + (grid.inset === null ? 0 : RUNG_PX[grid.inset]);
  return (
    (column - 2 * padding - (grid.columns - 1) * RUNG_PX[grid.columnSpacing]) /
    grid.columns
  );
}

describe('medalGridFor', () => {
  it('takes the four steps of §2.3.2: a 330 phone, a 390 phone, a sheet from 600, the dialog', () => {
    expect(medalGridFor(phoneColumn(330))).toEqual({
      step: 'narrow',
      columns: 3,
      padding: 'compact',
      inset: 'tight',
      columnSpacing: 'tight',
      rowSpacing: 'regular',
    });
    expect(medalGridFor(phoneColumn(390))).toEqual({
      step: 'compact',
      columns: 3,
      padding: 'regular',
      inset: null,
      columnSpacing: 'compact',
      rowSpacing: 'regular',
    });
    expect(medalGridFor(phoneColumn(600))).toEqual({
      step: 'wide',
      columns: 4,
      padding: 'comfortable',
      inset: null,
      columnSpacing: 'regular',
      rowSpacing: 'comfortable',
    });
    expect(medalGridFor(528, 16, true)).toEqual({
      step: 'dialog',
      columns: 4,
      padding: 'comfortable',
      inset: null,
      columnSpacing: 'regular',
      rowSpacing: 'comfortable',
    });
  });

  it('draws the spec’s tiles: 87 on a 330 phone, 102 on a 390 one', () => {
    expect(
      Math.floor(medalTilePx(phoneColumn(330), medalGridFor(phoneColumn(330)))),
    ).toBe(87);
    expect(
      Math.floor(medalTilePx(phoneColumn(390), medalGridFor(phoneColumn(390)))),
    ).toBe(102);
    // The card's 12 on the narrow step is its padding and the inset under it.
    expect(RUNG_PX.compact + RUNG_PX.tight).toBe(12);
  });

  it('measures a tile as the step’s own rungs lay it out', () => {
    for (const [column, dialog] of [
      [285, false],
      [295, false],
      [355, false],
      [395, false],
      [565, false],
      [725, false],
      [528, true],
      [752, true],
    ] as const) {
      const grid = medalGridFor(column, 16, dialog);
      expect([column, medalTilePx(column, grid)]).toEqual([
        column,
        tileOf(column, grid),
      ]);
    }
    // A reader's larger text grows the padding and the gaps with it.
    expect(medalTilePx(355, MEDAL_GRID_COMPACT, 20)).toBeCloseTo(
      (355 - 40 - 20) / 3,
    );
  });

  it('never lays two across, nor five: a grid is three, four or six', () => {
    for (let column = 0; column <= 1200; column += 1) {
      expect([3, 4]).toContain(medalGridFor(column).columns);
      expect([4, 6]).toContain(medalGridFor(column, 16, true).columns);
    }
  });

  it('lays three across every phone, and four from a 600 pt sheet', () => {
    for (const viewport of [320, 330, 360, 375, 390, 412, 430, 480, 599]) {
      expect([viewport, medalGridFor(phoneColumn(viewport)).columns]).toEqual([
        viewport,
        3,
      ]);
    }
    for (const viewport of [600, 640, 700, 760]) {
      expect([viewport, medalGridFor(phoneColumn(viewport)).columns]).toEqual([
        viewport,
        4,
      ]);
    }
    expect(phoneColumn(600)).toBeGreaterThanOrEqual(MEDAL_WIDE_COLUMN_REM * 16);
    expect(phoneColumn(599)).toBeLessThan(MEDAL_WIDE_COLUMN_REM * 16);
    // As the page measures them: whole pixels.
    expect(medalGridFor(Math.round(phoneColumn(599))).columns).toBe(3);
    expect(medalGridFor(Math.round(phoneColumn(600))).columns).toBe(4);
    expect(Math.floor(medalTilePx(phoneColumn(600), medalGridFor(565)))).toBe(
      117,
    );
  });

  it('keeps the card’s padding while a third stays 96 wide, and gives it to the tiles under that', () => {
    const floor = MEDAL_TILE_MIN_REM * 16;
    for (let column = 240; column < MEDAL_WIDE_COLUMN_REM * 16; column += 1) {
      const grid = medalGridFor(column);
      const regular = tileOf(column, MEDAL_GRID_COMPACT);
      expect([column, grid.step]).toEqual([
        column,
        regular >= floor ? 'compact' : 'narrow',
      ]);
      // The narrow step is always the wider tile: it is why it exists.
      if (grid.step === 'narrow') {
        expect(tileOf(column, grid)).toBeGreaterThan(regular);
      }
    }
    // 320 · 330 · 360 phones are narrow; 375 and up keep the padding.
    expect(
      [320, 330, 360, 375, 390, 430].map(
        (viewport) => medalGridFor(phoneColumn(viewport)).step,
      ),
    ).toEqual(['narrow', 'narrow', 'narrow', 'compact', 'compact', 'compact']);
  });

  it('lays six in a dialog only where a sixth is never under 96, and four where it would be', () => {
    const floor = MEDAL_TILE_MIN_REM * 16;
    // The visit sheet's dialog: 576 wide, a 528 column. A sixth is 67.
    const six: MedalGrid = { ...MEDAL_GRID_REGULAR, columns: 6 };
    expect(Math.round(tileOf(528, six))).toBe(67);
    expect(medalGridFor(528, 16, true).columns).toBe(4);
    expect(Math.round(tileOf(528, MEDAL_GRID_REGULAR))).toBe(108);
    for (let column = 400; column <= 1200; column += 1) {
      const grid = medalGridFor(column, 16, true);
      expect(grid.step).toBe('dialog');
      expect([column, grid.columns]).toEqual([
        column,
        tileOf(column, six) >= floor ? 6 : 4,
      ]);
    }
    // Six from a 704 column (a dialog 752 wide).
    expect(medalGridFor(703, 16, true).columns).toBe(4);
    expect(medalGridFor(704, 16, true).columns).toBe(6);
  });

  it('asks a wider column of a reader’s larger text', () => {
    // 20 px text: a 600 sheet's column (556) is no longer four across…
    expect(medalGridFor(phoneColumn(600, 20), 20).columns).toBe(3);
    expect(medalGridFor(MEDAL_WIDE_COLUMN_REM * 20, 20).columns).toBe(4);
    // …a 390 phone's third is under the floor, so the card gives its padding…
    expect(medalGridFor(phoneColumn(390, 20), 20).step).toBe('narrow');
    // …and a dialog's six need a sixth of 120.
    expect(medalGridFor(704, 20, true).columns).toBe(4);
    expect(medalGridFor(880, 20, true).columns).toBe(6);
  });

  it('names the nominal steps: a phone’s three, the dialog’s four', () => {
    expect(MEDAL_GRID_COMPACT).toEqual(medalGridFor(355));
    expect(MEDAL_GRID_REGULAR).toEqual(medalGridFor(528, 16, true));
    expect(MEDAL_GRID_COMPACT.columns).toBe(3);
    expect(MEDAL_GRID_REGULAR.columns).toBe(4);
  });
});

describe('familyGridFor (review 3: a name holds two lines, never cut)', () => {
  /** A family tile on a step's metrics, as the stylesheet lays it. */
  const tile = (column: number, grid: ReturnType<typeof familyGridFor>) =>
    familyTilePx(column, grid);

  it('lays a card’s families THREE across a phone’s sheet, in a comfortable card where a third holds a name, else with the card’s padding and half its gap given to the tiles', () => {
    for (const viewport of [320, 330, 360, 375, 390, 430, 599]) {
      expect([viewport, familyGridFor(phoneColumn(viewport)).columns]).toEqual([
        viewport,
        3,
      ]);
    }
    // A 390 phone: 97 in the comfortable card, 8 apart.
    const compact = familyGridFor(phoneColumn(390));
    expect(compact).toEqual({
      columns: 3,
      padding: 'comfortable',
      spacing: 'compact',
      bleed: null,
    });
    expect(Math.round(tile(phoneColumn(390), compact))).toBe(97);
    // A 330 phone (a 294.8 column here): a comfortable third is 82 —
    // under «на седмицата» (90 laid out) — so the card pads regular, the
    // tiles share its measure with no gap and take a compact step back from
    // its padding on each side: 92.9 (93 of the live 295).
    const narrow = familyGridFor(phoneColumn(330));
    expect(narrow).toEqual({
      columns: 3,
      padding: 'regular',
      spacing: 'none',
      bleed: 'compact',
    });
    expect(tile(phoneColumn(330), narrow)).toBeGreaterThanOrEqual(
      FAMILY_TILE_MIN_REM * 16,
    );
    expect(Math.round(tile(phoneColumn(330), narrow) * 10) / 10).toBe(92.9);
    // The floor in px: «на седмицата» (90) with a step of air.
    expect(FAMILY_TILE_MIN_REM * 16).toBe(92);
    // A comfortable third holds the floor from a 340 column (3 × 92 and
    // the card's 64 of padding and gaps): a 376 phone and up; a 375 one
    // takes the narrow step (107.9), as every narrower phone does.
    expect(familyGridFor(phoneColumn(390)).padding).toBe('comfortable');
    expect(familyGridFor(phoneColumn(376)).padding).toBe('comfortable');
    expect(familyGridFor(phoneColumn(375))).toEqual(narrow);
    expect(Math.round(tile(phoneColumn(375), narrow) * 10) / 10).toBe(107.9);
  });

  it('lays FOUR from the column a 600 pt sheet has, and in the dialog — never eight', () => {
    expect(familyGridFor(phoneColumn(600)).columns).toBe(4);
    expect(familyGridFor(phoneColumn(760)).columns).toBe(4);
    const dialog = familyGridFor(528, 16, true);
    expect(dialog).toEqual({
      columns: 4,
      padding: 'comfortable',
      spacing: 'compact',
      bleed: null,
    });
    expect(tile(528, dialog)).toBe(114);
    for (let column = 300; column <= 900; column += 1) {
      const quarter = (column - 48 - 24) / 4;
      expect([column, familyGridFor(column, 16, true).columns]).toEqual([
        column,
        quarter >= FAMILY_TILE_MIN_REM * 16 ? 4 : 3,
      ]);
    }
    // A reader's larger text: a quarter of a narrow dialog column is not a name's width.
    expect(familyGridFor(400, 20, true).columns).toBe(3);
  });
});

describe('recordFigureFontFor (review 3, F1: a word figure on the rung its card holds)', () => {
  it('is the headline from a 144 card (a 390 phone’s 2-up, 170), the body rung at 600 from 126 (a 330 phone’s 140, a 600 sheet’s 129), the callout at 600 under it (the dialog’s 4-up, 120) — and the headline until measured', () => {
    expect(recordFigureFontFor(null)).toBe('headline');
    expect(recordFigureFontFor(170)).toBe('headline');
    expect(recordFigureFontFor(144)).toBe('headline');
    expect(recordFigureFontFor(143)).toBe('body');
    expect(recordFigureFontFor(140)).toBe('body');
    expect(recordFigureFontFor(129)).toBe('body');
    expect(recordFigureFontFor(126)).toBe('body');
    expect(recordFigureFontFor(125)).toBe('callout');
    expect(recordFigureFontFor(120)).toBe('callout');
    // A reader's larger text widens every threshold with the words.
    expect(recordFigureFontFor(170, 20)).toBe('body');
    expect(typeof measuredWidthOf).toBe('function');
  });
});

describe('recordColumnsFor (review 3, round 2: four across the dialog cramped every card)', () => {
  it('lays two across a phone, a 600 pt sheet and the ≥ 761 dialog, and four only from a column that keeps a card at 150', () => {
    expect(recordColumnsFor(295)).toBe(2);
    expect(recordColumnsFor(355)).toBe(2);
    expect(recordColumnsFor(528)).toBe(2);
    expect(recordColumnsFor(565)).toBe(2);
    expect(recordColumnsFor(647)).toBe(2);
    // Four cards of 150 and three regular gaps.
    expect(recordColumnsFor(648)).toBe(4);
    expect(recordColumnsFor(800)).toBe(4);
    // A reader's larger text asks a wider column of the 4-up.
    expect(recordColumnsFor(648, 20)).toBe(2);
    expect(recordColumnsFor(810, 20)).toBe(4);
    expect(RECORD_CARD_MIN_REM * 16).toBe(150);
  });
});

describe('glanceCardPaddingFor (review 3, F3: «Рожден ден» whole on a 330 phone)', () => {
  it('pads the glance’s medals card comfortable where a third of the column holds the tile floor, regular where it would not', () => {
    // A 390 phone: (355 − 48) / 3 = 102; the dialog: 160.
    expect(glanceCardPaddingFor(phoneColumn(390))).toBe('comfortable');
    expect(glanceCardPaddingFor(528)).toBe('comfortable');
    // A 330 phone: a comfortable third is 82, under the 86.4 floor; a
    // regular one is 87.7.
    expect(glanceCardPaddingFor(phoneColumn(330))).toBe('regular');
    expect((phoneColumn(330) - 32) / 3).toBeGreaterThanOrEqual(
      GLANCE_TILE_MIN_REM * 16,
    );
    // The floor in px: «Рожден ден» (78.4) and the tile's two tight gutters.
    expect(GLANCE_TILE_MIN_REM * 16).toBeCloseTo(86.4, 5);
    // A reader's larger text widens the floor with the words.
    expect(glanceCardPaddingFor(phoneColumn(390), 20)).toBe('regular');
  });
});

/** A `matchMedia` the spec drives: the sheet at a phone's width, then the dialog's. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches,
    media: '(min-width: 761px)',
    addEventListener: (
      _: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => listeners.add(listener),
    removeEventListener: (
      _: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => listeners.delete(listener),
  };
  Object.defineProperty(document.defaultView as Window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => query,
  });
  return {
    listeners,
    change(next: boolean) {
      query.matches = next;
      for (const listener of listeners) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
  };
}

/** A `ResizeObserver` the spec drives (jsdom has none, and lays nothing out). */
function stubResizeObserver() {
  const live = new Set<{
    readonly callback: ResizeObserverCallback;
    readonly observer: ResizeObserver;
    readonly targets: Set<Element>;
  }>();
  class Stub implements ResizeObserver {
    private readonly entry;
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, observer: this, targets: new Set<Element>() };
      live.add(this.entry);
    }
    observe(target: Element): void {
      this.entry.targets.add(target);
    }
    unobserve(target: Element): void {
      this.entry.targets.delete(target);
    }
    disconnect(): void {
      live.delete(this.entry);
    }
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: Stub,
  });
  return {
    observing: () => live.size,
    resize(width: number) {
      for (const entry of [...live]) {
        entry.callback(
          [...entry.targets].map(
            (target) =>
              ({
                target,
                contentRect: { width, height: 0 } as DOMRectReadOnly,
              }) as ResizeObserverEntry,
          ),
          entry.observer,
        );
      }
    },
  };
}

@Component({
  selector: 'lib-sheet-width-host',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Host {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly grid = medalGridOf(this.host);
  readonly familyGrid = familyGridOf(this.host);
}

describe('medalGridOf, familyGridOf', () => {
  afterEach(() => {
    Reflect.deleteProperty(document.defaultView as Window, 'matchMedia');
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
    document.documentElement.style.removeProperty('font-size');
  });

  function mount() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  it('is a phone’s nominal step where nothing measures and nothing answers the width', () => {
    const { componentInstance: host } = mount();
    expect(host.grid()).toBe(MEDAL_GRID_COMPACT);
    expect(host.grid().columns).toBe(3);
    expect(host.familyGrid().columns).toBe(3);
    expect(host.familyGrid().padding).toBe('comfortable');
  });

  it('is the dialog’s nominal step at a regular width, and follows the width as it changes', () => {
    const media = stubMatchMedia(true);
    const fixture = mount();
    const host = fixture.componentInstance;
    expect(host.grid()).toBe(MEDAL_GRID_REGULAR);
    expect(host.grid().columns).toBe(4);
    expect(host.familyGrid().columns).toBe(4);
    media.change(false);
    expect(host.grid()).toBe(MEDAL_GRID_COMPACT);
    expect(host.grid().columns).toBe(3);
    expect(host.familyGrid().columns).toBe(3);
    // It stops following with its owner.
    expect(media.listeners.size).toBeGreaterThan(0);
    fixture.destroy();
    expect(media.listeners.size).toBe(0);
  });

  it('takes the step of the column the host actually has, as it resizes', () => {
    const media = stubMatchMedia(false);
    const observer = stubResizeObserver();
    const fixture = mount();
    const host = fixture.componentInstance;
    observer.resize(295);
    expect(host.grid().step).toBe('narrow');
    expect(host.grid().columns).toBe(3);
    expect(host.familyGrid()).toEqual({
      columns: 3,
      padding: 'regular',
      spacing: 'none',
      bleed: 'compact',
    });
    observer.resize(355);
    expect(host.grid().step).toBe('compact');
    expect(host.familyGrid().padding).toBe('comfortable');
    observer.resize(565);
    expect(host.grid().step).toBe('wide');
    expect(host.grid().columns).toBe(4);
    expect(host.familyGrid().columns).toBe(4);
    // The same 528 column is three across a sheet and four in the dialog —
    // the families four either way, a 528 column being wider than a 600 sheet's.
    observer.resize(528);
    expect(host.grid().columns).toBe(3);
    expect(host.familyGrid().columns).toBe(3);
    media.change(true);
    expect(host.grid()).toEqual(MEDAL_GRID_REGULAR);
    expect(host.familyGrid().columns).toBe(4);
    observer.resize(752);
    expect(host.grid().columns).toBe(6);
    // A measurement of nothing (a hidden page) changes nothing.
    observer.resize(0);
    expect(host.grid().columns).toBe(6);
    fixture.destroy();
    expect(observer.observing()).toBe(0);
  });

  it('reads the root font size it was measured under', () => {
    stubMatchMedia(false);
    const observer = stubResizeObserver();
    document.documentElement.style.setProperty('font-size', '20px');
    const { componentInstance: host } = mount();
    // A 600 sheet's column is four across at 16 px text, three at 20.
    observer.resize(565);
    expect(host.grid().columns).toBe(3);
    observer.resize(706);
    expect(host.grid().columns).toBe(4);
  });
});
