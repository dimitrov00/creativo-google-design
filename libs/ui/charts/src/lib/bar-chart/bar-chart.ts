import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  booleanAttribute,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { elementWidth } from '@creativo/ui/layout';
import type { UiChartPart } from '../chart-part';
import { linearScale, px, zeroExtent } from '../geometry/linear-scale';
import { stackOffsets, stackTotal } from '../geometry/stack-offsets';

/** One part of a bar: the hook that colours it and how much of the bar it is. */
export type UiChartBarPart = {
  readonly part: UiChartPart;
  readonly value: number;
};

/** One bar: its word along the baseline (or the row) and its parts, baseline first. */
export type UiChartBar = {
  readonly label: string;
  readonly parts: readonly UiChartBarPart[];
};

export type UiBarChartOrientation = 'vertical' | 'horizontal';
/** `stacked` draws every part; `single` draws the bar's total as one mark on its first part. */
export type UiBarChartStacking = 'stacked' | 'single';

/** Where the chart draws before its width is known (jsdom, the first frame). */
const FALLBACK_WIDTH = 320;
/** The surface showing between adjacent bars and between stacked parts. */
const GAP = 2;
/** A vertical chart: the plot's height and the label band under the baseline. */
const PLOT_HEIGHT = 120;
const LABEL_BAND = 20;
/** A horizontal chart: the words line over each bar, the bar, and the gap to the next row. */
const ROW_TEXT = 18;
const ROW_BAR = 12;
const ROW_GAP = 8;
const ROW_PITCH = ROW_TEXT + ROW_BAR + ROW_GAP;
/**
 * A caption glyph's width, near enough, for the one layout decision SVG
 * cannot make itself: on a horizontal row the word and the figure share one
 * line, so a word longer than the room the figure leaves is ellipsized
 * (the accessible name keeps it whole). An estimate, not a measurement —
 * the kit draws from numbers alone.
 */
const CHAR_WIDTH = 7;
const TEXT_GAP = 12;

/** The word as it fits beside its figure on a row of `width`. */
export function fitLabel(
  label: string,
  valueText: string,
  width: number,
): string {
  const room = Math.floor(
    (width - valueText.length * CHAR_WIDTH - (valueText ? TEXT_GAP : 0)) /
      CHAR_WIDTH,
  );
  if (label.length <= room) return label;
  return room <= 1 ? '…' : `${label.slice(0, room - 1).trimEnd()}…`;
}

type BarSegment = {
  readonly key: number;
  readonly part: UiChartPart;
  /** Along the axis from the baseline, in px. */
  readonly offset: number;
  readonly size: number;
};

type BarMark = {
  /** The bar's index in `uiBars` — what a pick reports and what the texts are read by. */
  readonly index: number;
  readonly label: string;
  readonly valueText: string;
  readonly name: string;
  readonly highlight: boolean;
  /** The pointer target: the whole band (vertical) or the whole row (horizontal). */
  readonly hitX: number;
  readonly hitY: number;
  readonly hitWidth: number;
  readonly hitHeight: number;
  /** The segments' fixed cross-axis placement. */
  readonly across: number;
  readonly thickness: number;
  readonly labelX: number;
  readonly labelY: number;
  readonly segments: readonly BarSegment[];
};

/**
 * THE BAR CHART — rectangles on a baseline, one bar per word (`uiBars`),
 * each bar's parts stacked from the baseline outwards and coloured by
 * their `data-part` hook (charts.css; the kit decides no colour and
 * formats no number). Vertical bars carry their words under the baseline;
 * horizontal bars carry the word and the value text (`uiValueText`, one
 * per bar, pre-formatted) on the line above each bar. `uiRanked` orders
 * the bars largest first; `uiHighlightIndex` sets one bar in the accent
 * and the rest in grey (the open-hours card). A tap or Enter/Space on a bar
 * emits its index in `uiBars` (`uiBarPicked`); the bars are one tab stop,
 * the arrows walk them.
 *
 * Marks: the data end rounded 4 px, 2 px of surface between parts and
 * between bars, a hairline separator edge; a bar's length and place in the
 * stack glide on registered custom properties after the first frame, and
 * not at all under reduced motion. `[uiChartLegend]` is the slot under the
 * drawing for the rows that explain the parts.
 *
 * Accessibility: the `svg` is `role="img"` named by `uiLabel` (required,
 * one sentence); each bar is a button named by its word and its value text.
 */
@Component({
  selector: 'ui-bar-chart',
  templateUrl: './bar-chart.html',
  styleUrl: './bar-chart.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: `.ui-bar-chart__*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-bar-chart',
    '[attr.data-orientation]': 'uiOrientation()',
    '[attr.data-highlighting]': "uiHighlightIndex() === null ? null : ''",
    '[attr.data-settled]': "settled() ? '' : null",
    '[style.--ui-bar-base]': 'baseline()',
  },
})
export class UiBarChart {
  readonly uiBars = input.required<readonly UiChartBar[]>();
  readonly uiOrientation = input<UiBarChartOrientation>('vertical');
  readonly uiStacking = input<UiBarChartStacking>('stacked');
  readonly uiRanked = input(false, { transform: booleanAttribute });
  readonly uiHighlightIndex = input<number | null>(null);
  /** One pre-formatted figure per bar («4 ч 30 мин», «120 €»). */
  readonly uiValueText = input<readonly string[]>([]);
  /** The drawing's accessible name — one sentence the presenter writes. */
  readonly uiLabel = input.required<string>();
  /** The index in `uiBars` of the bar tapped or chosen with Enter/Space. */
  readonly uiBarPicked = output<number>();

  private readonly host =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('drawing');
  private readonly measured = elementWidth(this.svg);

  /** Set once the first frame is on screen: nothing glides before it. */
  protected readonly settled = signal(false);
  /** The display position holding the tab stop. */
  private readonly focused = signal(0);

  protected readonly width = computed(() => this.measured() || FALLBACK_WIDTH);

  protected readonly height = computed(() => {
    if (this.uiOrientation() === 'horizontal') {
      const rows = this.uiBars().length;
      return rows === 0 ? 0 : rows * ROW_PITCH - ROW_GAP;
    }
    return PLOT_HEIGHT + LABEL_BAND;
  });

  /** The baseline's px, for the stylesheet's `y` of a vertical segment. */
  protected readonly baseline = computed(() => `${PLOT_HEIGHT}px`);

  protected readonly viewBox = computed(
    () => `0 0 ${px(this.width())} ${px(this.height())}`,
  );

  /** The bars in display order, each carrying its index in `uiBars`. */
  private readonly order = computed(() => {
    const bars = this.uiBars();
    const indices = bars.map((_, index) => index);
    if (!this.uiRanked()) return indices;
    const totals = bars.map((bar) => stackTotal(bar.parts.map((p) => p.value)));
    return indices.sort(
      (a, b) => (totals.at(b) ?? 0) - (totals.at(a) ?? 0) || a - b,
    );
  });

  protected readonly marks = computed<readonly BarMark[]>(() => {
    const bars = this.uiBars();
    const order = this.order();
    if (bars.length === 0) return [];
    const horizontal = this.uiOrientation() === 'horizontal';
    const width = this.width();
    const texts = this.uiValueText();
    const highlight = this.uiHighlightIndex();
    const single = this.uiStacking() === 'single';
    const max = zeroExtent(
      bars.map((bar) => stackTotal(bar.parts.map((p) => p.value))),
    );
    const length = linearScale(max, [0, horizontal ? width : PLOT_HEIGHT]);
    const band = width / bars.length;

    return order.flatMap((index, position) => {
      const bar = bars.at(index);
      if (bar === undefined) return [];
      const values = single
        ? [stackTotal(bar.parts.map((p) => p.value))]
        : bar.parts.map((p) => p.value);
      const parts = single ? bar.parts.slice(0, 1) : bar.parts;
      const offsets = stackOffsets(values);
      const last = offsets.length - 1;
      const segments: BarSegment[] = [];
      offsets.forEach((offset, i) => {
        const part = parts.at(i);
        if (part === undefined) return;
        const start = length(offset.start) + (i > 0 ? GAP / 2 : 0);
        const end = length(offset.end) - (i < last ? GAP / 2 : 0);
        segments.push({
          key: i,
          part: part.part,
          offset: px(start),
          size: px(Math.max(0, end - start)),
        });
      });
      const valueText = texts.at(index) ?? '';
      const row = position * ROW_PITCH;
      const mark: BarMark = {
        index,
        label: horizontal ? fitLabel(bar.label, valueText, width) : bar.label,
        valueText,
        name: valueText ? `${bar.label}, ${valueText}` : bar.label,
        highlight: highlight === index,
        hitX: horizontal ? 0 : px(position * band),
        hitY: horizontal ? row : 0,
        hitWidth: horizontal ? px(width) : px(band),
        hitHeight: horizontal ? ROW_PITCH - ROW_GAP : PLOT_HEIGHT,
        across: horizontal ? row + ROW_TEXT : px(position * band + GAP / 2),
        thickness: horizontal ? ROW_BAR : px(Math.max(1, band - GAP)),
        labelX: horizontal ? 0 : px(position * band + band / 2),
        labelY: horizontal ? row + ROW_TEXT - 5 : PLOT_HEIGHT + LABEL_BAND - 6,
        segments,
      };
      return [mark];
    });
  });

  protected readonly hasLabels = computed(() =>
    this.uiBars().some((bar) => bar.label !== ''),
  );

  constructor() {
    afterNextRender(() => this.settled.set(true));
  }

  protected tabIndex(position: number): number {
    const focused = Math.min(this.focused(), this.marks().length - 1);
    return position === focused ? 0 : -1;
  }

  protected pick(index: number): void {
    this.uiBarPicked.emit(index);
  }

  protected onKeydown(
    event: KeyboardEvent,
    position: number,
    index: number,
  ): void {
    const count = this.marks().length;
    let next: number | null = null;
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.pick(index);
        return;
      case 'ArrowRight':
      case 'ArrowDown':
        next = Math.min(count - 1, position + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = Math.max(0, position - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.focused.set(next);
    this.host
      .querySelectorAll<SVGGElement>('.ui-bar-chart__bar')
      .item(next)
      ?.focus();
  }
}
