import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  type ElementRef,
  type Signal,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';

/*
 * THE SHEET'S WIDTH, where a DS INPUT (not a stylesheet) sets a layout: a
 * grid's columns and its card's padding, a record figure's rung. A media
 * query in feature CSS cannot set a DS input, so the pages read the width
 * here, from the same query the sheet's own CSS uses.
 */

/** Where the visit sheet presents as the centred dialog (`modal-sheet.css`). */
const REGULAR_WIDTH = '(min-width: 761px)';

/**
 * Whether the visit sheet is shown as the ≥761 px centred dialog (a
 * regular width) rather than a phone's sheet, following the width as it
 * changes. Without `matchMedia` (a server, a test DOM) it is a phone.
 * Call it in an injection context: it stops following when that is
 * destroyed.
 */
export function regularSheetWidth(): Signal<boolean> {
  const view = inject(DOCUMENT).defaultView;
  const query =
    view !== null && typeof view.matchMedia === 'function'
      ? view.matchMedia(REGULAR_WIDTH)
      : null;
  const regular = signal(query?.matches ?? false);
  if (query !== null) {
    const follow = (event: MediaQueryListEvent) => regular.set(event.matches);
    query.addEventListener('change', follow);
    inject(DestroyRef).onDestroy(() =>
      query.removeEventListener('change', follow),
    );
  }
  return regular.asReadonly();
}

/** A phone's nominal column, and the dialog's (§3.1.5), in px: before anything measures. */
const COMPACT_COLUMN_PX = 355;
const REGULAR_COLUMN_PX = 528;

/*
 * THE MEDAL GRIDS (client-card-revision-3 §2.3.2, «Grid metrics»). A grid,
 * never a rail: every family of a section is on the page. The count is a
 * STEP, not a fit — three across a phone, four from a 600 pt sheet, six in
 * a dialog — and each step brings the card's padding and the grid's gaps
 * with it, all of them DS inputs (`uiColumns`, `uiPadding`, `uiSpacing`,
 * `uiRowSpacing`), which a media query in feature CSS cannot set.
 *
 * | column            | 295 (330) | 355 (390) | ≥ 565 (a 600 sheet) | the dialog    |
 * | columns           | 3         | 3         | 4                   | 6, else 4     |
 * | the card's padding| 12        | 16        | 24                  | 24            |
 * | column · row gap  | 4 · 16    | 8 · 16    | 16 · 24             | 16 · 24       |
 * | a tile            | 87        | 102       | ≥ 117               | ≥ 96          |
 */

/** The steps a medal grid takes: never two across, never five. */
export type MedalColumns = 3 | 4 | 6;

/** The spacing rungs a medal grid's step names (`UiSpacing`, `UiCardPadding`). */
export type MedalGridSpacing = 'tight' | 'compact' | 'regular' | 'comfortable';

/** Which step a grid is on: a 330 phone, a phone, a sheet from 600 pt, the ≥ 761 dialog. */
export type MedalGridStep = 'narrow' | 'compact' | 'wide' | 'dialog';

/** One step of the grid metrics: what the card and its `ui-grid` take. */
export interface MedalGrid {
  readonly step: MedalGridStep;
  /** `ui-grid [uiColumns]`. */
  readonly columns: MedalColumns;
  /**
   * The card's `uiPadding`. On the `narrow` step the card's padding is 12:
   * this rung and {@link inset} under it.
   */
  readonly padding: MedalGridSpacing;
  /**
   * What the `narrow` step adds inside the card's padding (`tight`: 8 + 4
   * = 12, so three tiles of 87 fit a 295 pt column); `null` on every
   * other step, whose padding is a rung of its own.
   */
  readonly inset: MedalGridSpacing | null;
  /** `ui-grid [uiSpacing]`: between the columns. */
  readonly columnSpacing: MedalGridSpacing;
  /** `ui-grid [uiRowSpacing]`: between the rows. */
  readonly rowSpacing: MedalGridSpacing;
}

/**
 * A large medal tile's narrowest width, in rem (96 px): the floor §2.3.2
 * gives a sixth in the dialog, and the one a phone's third is held to
 * before the card gives up padding for it. A ring of 64 with its title at
 * `subheadline` 600 («Онлайн / записване» on two lines) inside the tile's
 * own gutter.
 */
export const MEDAL_TILE_MIN_REM = 6;

/**
 * The column from which a sheet lays four across, in rem: 564.5 px, which
 * a 600 pt sheet's column reaches (600 less its two 17.6 pt insets is
 * 564.8) and a 599 pt one's does not (563.8). In rem, so a reader's larger
 * text asks for a wider column first.
 */
export const MEDAL_WIDE_COLUMN_REM = 35.28125;

/** The spacing rungs, in rem (`tokens.css`: the unit is 0.25rem). */
const SPACING_REM: Readonly<Record<MedalGridSpacing | 'none', number>> = {
  none: 0,
  tight: 0.25,
  compact: 0.5,
  regular: 1,
  comfortable: 1.5,
};

const GRID_NARROW: MedalGrid = {
  step: 'narrow',
  columns: 3,
  padding: 'compact',
  inset: 'tight',
  columnSpacing: 'tight',
  rowSpacing: 'regular',
};

const GRID_COMPACT: MedalGrid = {
  step: 'compact',
  columns: 3,
  padding: 'regular',
  inset: null,
  columnSpacing: 'compact',
  rowSpacing: 'regular',
};

const GRID_WIDE: MedalGrid = {
  step: 'wide',
  columns: 4,
  padding: 'comfortable',
  inset: null,
  columnSpacing: 'regular',
  rowSpacing: 'comfortable',
};

const GRID_DIALOG_FOUR: MedalGrid = { ...GRID_WIDE, step: 'dialog' };

const GRID_DIALOG_SIX: MedalGrid = { ...GRID_DIALOG_FOUR, columns: 6 };

/** A tile's width on a step's metrics, in px: the column less the card's padding and the gaps, shared out. */
export function medalTilePx(
  columnPx: number,
  grid: MedalGrid,
  remPx = 16,
): number {
  const padding =
    (SPACING_REM[grid.padding] +
      (grid.inset === null ? 0 : SPACING_REM[grid.inset])) *
    remPx;
  const gap = SPACING_REM[grid.columnSpacing] * remPx;
  return (columnPx - 2 * padding - (grid.columns - 1) * gap) / grid.columns;
}

/**
 * The medal grid's step for a column `columnPx` wide (§2.3.2).
 *
 * A PHONE'S SHEET lays three across, and four from
 * {@link MEDAL_WIDE_COLUMN_REM}. Three keep the card's regular padding
 * while a third stays {@link MEDAL_TILE_MIN_REM} wide (a 375 phone and
 * up); under that the card gives its padding to the tiles (`narrow`: a
 * 330 phone's three of 87) rather than drop to two — two across hid half a
 * section under the fold, which is what the rails were retired for.
 *
 * THE DIALOG (`dialog`, the ≥ 761 px presentation) lays six where a sixth
 * is never under {@link MEDAL_TILE_MIN_REM}, and four where it would be:
 * the visit sheet's own dialog is 576 wide, its column 528, and a sixth of
 * that is 67 — a 64 ring with no room for a word beside it.
 *
 * `remPx` is the root font size: a reader's larger text needs the wider
 * tile, so every threshold grows with it.
 */
export function medalGridFor(
  columnPx: number,
  remPx = 16,
  dialog = false,
): MedalGrid {
  const floor = MEDAL_TILE_MIN_REM * remPx;
  if (dialog) {
    return medalTilePx(columnPx, GRID_DIALOG_SIX, remPx) >= floor
      ? GRID_DIALOG_SIX
      : GRID_DIALOG_FOUR;
  }
  if (columnPx >= MEDAL_WIDE_COLUMN_REM * remPx) return GRID_WIDE;
  return medalTilePx(columnPx, GRID_COMPACT, remPx) >= floor
    ? GRID_COMPACT
    : GRID_NARROW;
}

/** A phone's nominal 355 pt column: three medals of 102, the card's padding regular. */
export const MEDAL_GRID_COMPACT: MedalGrid = medalGridFor(COMPACT_COLUMN_PX);

/** The dialog's nominal 528 pt column: four of 108 (six would be 67 wide). */
export const MEDAL_GRID_REGULAR: MedalGrid = medalGridFor(
  REGULAR_COLUMN_PX,
  16,
  true,
);

/**
 * A family tile's narrowest width, in rem (92 px): the regular medal's
 * NAME — two lines of footnote 600 at most, never cut: «Всеки есенен» is
 * 83.8 wide, «на седмицата» (the second line of «Пълна грижа на
 * седмицата») lays out at 90 — and its caption whole («Още не е /
 * спечелено»). The ring alone (52) is not the floor; the words are: four
 * across a 330 phone gave 56 px tiles and eight in the dialog 53, and
 * every one cut a name («Прияте / л…», «Всеки есенен…») or broke the
 * caption inside «спечелено» (review 3, F3 / F7 / F12).
 */
export const FAMILY_TILE_MIN_REM = 5.75;

/** The steps a card's families take: three across a phone, four from a 600 pt sheet and in the dialog. */
export type FamilyColumns = 3 | 4;

/**
 * One step of a season's or an event's card (§2.3.2 AG, AH): how many
 * families across, the card's padding and the gap between the tiles —
 * DS inputs (`uiColumns`, `uiPadding`, `uiSpacing`), as the medal grids'.
 * On the narrow step the tiles share the card's measure with no gap
 * between them, as the glance's three medals do (§2.1.6), and the grid
 * takes a compact step back from the card's padding on each side (the
 * `bleed`, the glance's records line's own move): the head keeps its 16,
 * the tiles get 93.
 *
 * | column      | 295 (330)        | 355 (390)            | ≥ 565 · the dialog   |
 * | columns     | 3                | 3                    | 4                    |
 * | padding     | regular (16)     | comfortable (24)     | comfortable (24)     |
 * | bleed       | compact (8)      | —                    | —                    |
 * | gap         | none             | compact (8)          | compact (8)          |
 * | a tile      | 93               | 97                   | ≥ 114                |
 */
export interface FamilyGrid {
  readonly columns: FamilyColumns;
  readonly padding: 'regular' | 'comfortable';
  readonly spacing: 'none' | 'compact';
  /** The step the grid takes back from the card's padding on each side; `null` keeps the card's measure. */
  readonly bleed: 'compact' | null;
}

const FAMILY_GRID_NARROW: FamilyGrid = {
  columns: 3,
  padding: 'regular',
  spacing: 'none',
  bleed: 'compact',
};

const FAMILY_GRID_COMPACT: FamilyGrid = {
  columns: 3,
  padding: 'comfortable',
  spacing: 'compact',
  bleed: null,
};

const FAMILY_GRID_WIDE: FamilyGrid = { ...FAMILY_GRID_COMPACT, columns: 4 };

/** A family tile's width on a step's metrics, in px: the column less the card's padding and the gaps, shared out. */
export function familyTilePx(
  columnPx: number,
  grid: FamilyGrid,
  remPx = 16,
): number {
  const padding =
    (SPACING_REM[grid.padding] -
      (grid.bleed === null ? 0 : SPACING_REM[grid.bleed])) *
    remPx;
  const gap = SPACING_REM[grid.spacing] * remPx;
  return (columnPx - 2 * padding - (grid.columns - 1) * gap) / grid.columns;
}

/**
 * The step a season's or an event's card takes for a column `columnPx`
 * wide: regular medals, THREE across a phone's sheet — the category
 * grid's own count, where every name of the catalogue holds two lines —
 * in a `comfortable` card where a third keeps {@link FAMILY_TILE_MIN_REM}
 * (a 390 phone's 97), else the tiles take the card's gap and a step of
 * its padding (a 330 phone's 93) rather than drop to two; FOUR from the
 * column a 600 pt sheet has ({@link MEDAL_WIDE_COLUMN_REM}) and in the
 * dialog, where a quarter is 114 and a sixth (73) would cut «Всеки
 * есенен» again. Never more than four: a card of two families hugs two
 * tiles at its leading edge. ALL the families are drawn, row after row:
 * there is no «+N». `remPx` is the root font size: a reader's larger text
 * needs the wider tile.
 */
export function familyGridFor(
  columnPx: number,
  remPx = 16,
  dialog = false,
): FamilyGrid {
  const floor = FAMILY_TILE_MIN_REM * remPx;
  if (dialog || columnPx >= MEDAL_WIDE_COLUMN_REM * remPx) {
    return familyTilePx(columnPx, FAMILY_GRID_WIDE, remPx) >= floor
      ? FAMILY_GRID_WIDE
      : FAMILY_GRID_COMPACT;
  }
  return familyTilePx(columnPx, FAMILY_GRID_COMPACT, remPx) >= floor
    ? FAMILY_GRID_COMPACT
    : FAMILY_GRID_NARROW;
}

/** The glance's medals card: its padding (`uiPadding="comfortable"`), in rem. */
const GLANCE_CARD_PADDING_REM = SPACING_REM.comfortable;

/**
 * A glance tile's narrowest width, in rem (86.4 px): «Рожден ден» at
 * subheadline 600 is 78.4, and the DS button tile keeps a tight step of
 * gutter on each side that its words do not take back inside a grid cell
 * (the title is fit-content to the track; `medal.css`, THE WORDS). Three
 * tiles of 82 on a 330 phone cut it to «Рожден / ден в…» (review 3, F3).
 */
export const GLANCE_TILE_MIN_REM = 5.4;

/**
 * The glance's medals card pads `comfortable` where its three tiles keep
 * {@link GLANCE_TILE_MIN_REM} (a 390 phone's 102, the dialog's 160), and
 * steps down to `regular` where they would not (a 330 phone: 87.7, so
 * «Рожден ден / в салона» holds). One step only: a card padded tighter
 * than `regular` is no longer a card of the glance.
 */
export function glanceCardPaddingFor(
  columnPx: number,
  remPx = 16,
): 'comfortable' | 'regular' {
  const inside = columnPx - 2 * GLANCE_CARD_PADDING_REM * remPx;
  return inside / 3 >= GLANCE_TILE_MIN_REM * remPx ? 'comfortable' : 'regular';
}

/** A column's measured content width, with the root font size it was measured under. */
export interface MeasuredColumn {
  readonly width: number;
  readonly remPx: number;
}

/**
 * A record card's WORD figure (a favourite's service) on the rung its own
 * card holds, by the card's measured width ({@link measuredWidthOf}; a
 * phone's 2-up card until measured): the headline (18/600 — «подстрижка»
 * is 107) in a card of {@link RECORD_WORD_HEADLINE_REM} and up (a 390
 * phone's 170, the dialog's 2-up 256); the body rung at 600 (91) from
 * {@link RECORD_WORD_BODY_REM} (a 330 phone's 140); the callout at 600
 * (86) under it (a card narrower than 126, which no step of the records
 * grid lays today — {@link recordColumnsFor} keeps a card at 150 and up
 * in a 4-up). A number keeps the display rung at every width
 * (record-card.ts).
 */
export function recordFigureFontFor(
  cardPx: number | null,
  remPx = 16,
): 'headline' | 'body' | 'callout' {
  if (cardPx === null || cardPx >= RECORD_WORD_HEADLINE_REM * remPx) {
    return 'headline';
  }
  return cardPx >= RECORD_WORD_BODY_REM * remPx ? 'body' : 'callout';
}

/** A record card wide enough for «подстрижка» at 18/600 (107) inside its regular padding, in rem: 144 px. */
export const RECORD_WORD_HEADLINE_REM = 9;

/** A record card wide enough for «подстрижка» at the body rung at 600 (91.3) inside its regular padding, in rem: 126 px. */
export const RECORD_WORD_BODY_REM = 7.875;

/*
 * THE RECORDS GRID (§2.3.2 AE): the account's four records as white
 * cards, 2 × 2 on a phone — and 2 × 2 wherever four across would cramp a
 * card. Four across the ≥ 761 dialog's 528 pt column gave 120 pt cards:
 * every label on two lines, «септември 2026 г.» broken before its year,
 * «Нов рекорд» dropped under its figure (review 3, rounds 1 and 2). A
 * card is laid four across only where it keeps {@link RECORD_CARD_MIN_REM}
 * — the 2-up's own proportion on a 330 phone (140) with room for a label
 * of two words, a display figure beside its capsule, a month and its
 * year on one line — which asks a column of 648 px (four cards and three
 * regular gaps); the dialog's 528 and a 600 pt sheet's 565 lay two.
 */

/** A record card's narrowest width in a 4-up, in rem: 150 px. */
export const RECORD_CARD_MIN_REM = 9.375;

/** The records grid's gap (`uiSpacing="regular"`, 16 px), in rem. */
const RECORD_GAP_REM = 1;

/** The steps the records grid takes: two across, or four where a card keeps its width. */
export type RecordColumns = 2 | 4;

/**
 * How many records a grid lays across a column `columnPx` wide: four
 * where a quarter of it, the three gaps taken out, keeps
 * {@link RECORD_CARD_MIN_REM}; two otherwise. `remPx` is the root font
 * size, so a reader's larger text asks a wider column of the 4-up.
 */
export function recordColumnsFor(columnPx: number, remPx = 16): RecordColumns {
  const card = (columnPx - 3 * RECORD_GAP_REM * remPx) / 4;
  return card >= RECORD_CARD_MIN_REM * remPx ? 4 : 2;
}

/**
 * The records grid's columns for the column `host` actually has
 * ({@link recordColumnsFor}), followed as it resizes; two until measured
 * and where nothing measures — a phone's and the dialog's own count.
 * Call it in an injection context, with an element as wide as the
 * column.
 */
export function recordColumnsOf(
  host: ElementRef<HTMLElement>,
): Signal<RecordColumns> {
  const column = measuredWidthOf(host);
  return computed(() => {
    const measured = column();
    return measured === null
      ? 2
      : recordColumnsFor(measured.width, measured.remPx);
  });
}

/**
 * The content width of `host`, followed as it resizes; `null` until the
 * first measurement, and for good where nothing measures (a server, a
 * test DOM without `ResizeObserver`). Call it in an injection context: it
 * stops observing when that context is destroyed.
 */
export function measuredWidthOf(
  host: ElementRef<HTMLElement>,
): Signal<MeasuredColumn | null> {
  const measured = signal<MeasuredColumn | null>(null, {
    equal: (a, b) => a?.width === b?.width && a?.remPx === b?.remPx,
  });
  const destroyRef = inject(DestroyRef);
  afterNextRender(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const element = host.nativeElement;
    const root = element.ownerDocument.documentElement;
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (width <= 0) return;
      const remPx = Number.parseFloat(getComputedStyle(root).fontSize) || 16;
      measured.set({ width, remPx });
    });
    observer.observe(element);
    destroyRef.onDestroy(() => observer.disconnect());
  });
  return measured.asReadonly();
}

/**
 * The medal grid's step for the column `host` actually has (a 330 phone:
 * three, the card's padding given to the tiles; 375–430: three; a sheet
 * from 600 pt: four; the dialog: six where a sixth keeps its width, else
 * four), followed as it resizes; the nominal step for the sheet's
 * presentation until measured. Call it in an injection context, with an
 * element as wide as the column.
 */
export function medalGridOf(host: ElementRef<HTMLElement>): Signal<MedalGrid> {
  const regular = regularSheetWidth();
  const column = measuredWidthOf(host);
  return computed(() => {
    const measured = column();
    if (measured !== null) {
      return medalGridFor(measured.width, measured.remPx, regular());
    }
    return regular() ? MEDAL_GRID_REGULAR : MEDAL_GRID_COMPACT;
  });
}

/**
 * The step a season's or an event's card takes for the column `host`
 * actually has ({@link familyGridFor}), followed as it resizes; the
 * nominal step for the sheet's presentation until measured. Call it in an
 * injection context, with an element as wide as the column.
 */
export function familyGridOf(
  host: ElementRef<HTMLElement>,
): Signal<FamilyGrid> {
  const regular = regularSheetWidth();
  const column = measuredWidthOf(host);
  return computed(() => {
    const measured = column();
    return measured === null
      ? familyGridFor(
          regular() ? REGULAR_COLUMN_PX : COMPACT_COLUMN_PX,
          16,
          regular(),
        )
      : familyGridFor(measured.width, measured.remPx, regular());
  });
}

/**
 * The content width of `host` and the root font size, followed as it
 * resizes; the sheet's nominal column for its presentation (a phone's
 * 355, the dialog's 528) until the first measurement, and where nothing
 * measures. Call it in an injection context, with an element as wide as
 * the column.
 */
export function sheetColumnOf(
  host: ElementRef<HTMLElement>,
): Signal<MeasuredColumn> {
  const regular = regularSheetWidth();
  const column = measuredWidthOf(host);
  return computed(
    () =>
      column() ?? {
        width: regular() ? REGULAR_COLUMN_PX : COMPACT_COLUMN_PX,
        remPx: 16,
      },
    { equal: (a, b) => a.width === b.width && a.remPx === b.remPx },
  );
}
