import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  booleanAttribute,
  computed,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { elementWidth } from '@creativo/ui/layout';
import { UiVisuallyHiddenDirective } from '@creativo/ui/modifiers';
import { UiChartPart } from '../chart-part';
import {
  type ChartPoint,
  areaPath,
  linePath,
  monotonePath,
} from '../geometry/line-path';
import { linearScale, px, zeroExtent } from '../geometry/linear-scale';

/** One point: its word (for the hidden table), this period's value and the comparison's, if any. */
export type UiChartLinePoint = {
  readonly label: string;
  /**
   * The point's figure; `null` leaves it undrawn — a running total stops at
   * today while the comparison runs on. Only a trailing run may be `null`
   * (the line and the area are one run).
   */
  readonly value: number | null;
  readonly comparison: number | null;
};

/**
 * One more line beside this period's (`uiSeries`) — a member of a set the
 * chart compares (each shop of a business), in an identity tone
 * (`--sys-identity-N`, `0…4`): colour follows the member, never its rank.
 * Its values align with `uiPoints` by position; a `null` leaves a gap.
 */
export type UiLineChartSeries = {
  readonly values: readonly (number | null)[];
  readonly tone: number;
};

/** One drawn member line and the end dot on its last point. */
type SeriesShape = {
  readonly d: string;
  readonly tone: number;
  readonly end: ChartPoint | null;
};

/** A value the grid rules, and its words (the kit formats no number). */
export type UiChartTick = {
  readonly value: number;
  readonly text: string;
};

/**
 * How the line runs between its points: `linear` straight segments,
 * `smooth` a monotone cubic through every point that never overshoots
 * between two of them (`monotonePath`).
 */
export type UiLineChartCurve = 'linear' | 'smooth';

/** Each chart's area gradient needs an id of its own in the document. */
let nextGradientId = 0;

/** Where the chart draws before its width is known (jsdom, the first frame). */
const FALLBACK_WIDTH = 320;
/** The box is 5 : 2 — line-chart.css says the same in `aspect-ratio`. */
const ASPECT = 2.5;
/** Room for a marker and its ring at the plot's edges. */
const PAD = 6;
/** The day axis' band under the plot: a caption line. */
const AXIS_BAND = 18;
/** The right-edge labels' column, taken only when a label is printed — at least this. */
const LABEL_GUTTER = 56;
/**
 * A caption glyph's width, near enough: the column grows with the longer
 * label («средно 1 234,56 €») so it never runs past the drawing into the
 * page's side gutter — the radar's and the bar chart's estimate; the kit
 * measures nothing.
 */
const CHAR_WIDTH = 7;
/** The labels never take more than this share of the box: the line keeps the rest. */
const MAX_GUTTER_SHARE = 0.4;
/** Two right-edge labels never sit closer than a caption line. */
const LABEL_CLEARANCE = 14;

/** The current line and the area under it, drawn from the same points. */
type LineShape = {
  readonly d: string;
  readonly area: string;
};

type LinePathNode = {
  readonly key: string;
  readonly d: string;
  readonly area: string;
  readonly leaving: boolean;
};

type EdgeLabel = {
  readonly text: string;
  readonly x: number;
  readonly y: number;
};

/**
 * THE LINE CHART — one accent line of this period's values over evenly
 * spaced points, the comparison period as a grey line behind it
 * (`data-part="comparison"`, a `null` leaves a gap), a dashed rule at the
 * average, and labels at the right edge only: the last value
 * (`uiValueText`'s last entry) and the average (`uiAverageText`, since the
 * kit formats no number). The first and last points carry an 8 px marker
 * in a 2 px ring of the surface. Straight segments by default;
 * `uiCurve="smooth"` draws both lines as monotone cubics through their
 * points (never past them). `uiArea` fills under this period's line with
 * its paint fading from 22 % at the top to nothing at the baseline (an SVG
 * gradient with an id of its own per chart).
 *
 * The width is measured (`elementWidth`) and the box keeps a fixed 5 : 2
 * from the stylesheet, so the viewBox is the drawing's own pixels and the
 * words never stretch. A change of series cross-fades the old path and the
 * new one after the first frame; nothing moves under reduced motion.
 *
 * Accessibility: the `svg` is `role="img"` named by `uiLabel`; a visually
 * hidden table lists every point's word and figure, since only the last
 * figure is printed beside the line.
 */
@Component({
  selector: 'ui-line-chart',
  imports: [UiVisuallyHiddenDirective],
  templateUrl: './line-chart.html',
  styleUrl: './line-chart.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-line-chart',
    '[attr.data-settled]': "settled() ? '' : null",
  },
})
export class UiLineChart {
  readonly uiPoints = input.required<readonly UiChartLinePoint[]>();
  readonly uiAverage = input<number | null>(null);
  /** One pre-formatted figure per point; the last one is printed at the right edge. */
  readonly uiValueText = input<readonly string[]>([]);
  /** The average, pre-formatted, printed on its rule at the right edge. */
  readonly uiAverageText = input<string | null>(null);
  /** The drawing's accessible name — one sentence the presenter writes. */
  readonly uiLabel = input.required<string>();
  /** Straight segments, or a monotone curve through the points. */
  readonly uiCurve = input<UiLineChartCurve>('linear');
  /** Fill under this period's line with its paint, fading to the baseline. */
  readonly uiArea = input(false, { transform: booleanAttribute });
  /**
   * Pixels kept clear at the right edge — a chart that runs to the screen's
   * edges (full bleed) keeps its figures inside the page's own gutter.
   */
  readonly uiInset = input(0);
  /**
   * TAP AND DRAG to read a point (Revolut's, Apple Health's): the nearest
   * point under the pointer is marked — a hairline down the plot, a dot on
   * each line — and reported through `uiScrubbed`, `null` when the finger
   * lifts. A drag across scrubs; a vertical swipe still scrolls the page.
   */
  readonly uiScrubbable = input(false, { transform: booleanAttribute });
  /**
   * Further lines to compare, each in its identity tone (`UiLineChartSeries`)
   * — with every `uiPoints` value `null`, the chart draws these alone: one
   * line per member of a set, none of them the accent.
   */
  readonly uiSeries = input<readonly UiLineChartSeries[]>([]);
  /** The index of the point under the pointer; `null` when it lifts or leaves. */
  readonly uiScrubbed = output<number | null>();

  private readonly scrubIndex = signal<number | null>(null);
  private scrubbing = false;

  /** The marks of the scrubbed point, in the drawing's pixels. */
  protected readonly scrub = computed(() => {
    const index = this.scrubIndex();
    const points = this.uiPoints();
    const point = index === null ? undefined : points[index];
    if (index === null || point === undefined) return null;
    const { x, y } = this.scales();
    return {
      x: px(x(index)),
      top: px(PAD),
      bottom: px(this.plotBottom()),
      valueY: point.value === null ? null : px(y(point.value)),
      comparisonY: point.comparison === null ? null : px(y(point.comparison)),
      series: this.uiSeries().flatMap((line) => {
        const value = line.values[index] ?? null;
        return value === null ? [] : [{ y: px(y(value)), tone: line.tone }];
      }),
    };
  });

  protected scrubStart(event: PointerEvent): void {
    if (!this.uiScrubbable()) return;
    this.scrubbing = true;
    this.scrubAt(event);
    // The drag keeps reading when the finger strays off the plot. A pointer
    // that has already lifted (or a synthetic one) cannot be captured — the
    // scrub still reads, it just ends at the plot's edge.
    const target = event.currentTarget as Element | null;
    try {
      target?.setPointerCapture?.(event.pointerId);
    } catch {
      /* no active pointer to capture */
    }
  }

  protected scrubMove(event: PointerEvent): void {
    if (!this.uiScrubbable()) return;
    // A mouse reads on hover; a finger or pen only while it is down.
    if (this.scrubbing || event.pointerType === 'mouse') this.scrubAt(event);
  }

  protected scrubEnd(event: PointerEvent): void {
    if (!this.uiScrubbable()) return;
    if (event.type === 'pointerleave' && this.scrubbing) return;
    this.scrubbing = false;
    this.setScrub(null);
  }

  /** The point nearest the pointer's x, in the plot's own slots. */
  private scrubAt(event: PointerEvent): void {
    const svg = this.svg()?.nativeElement;
    const count = this.uiPoints().length;
    if (svg === undefined || count === 0) return;
    const box = svg.getBoundingClientRect();
    if (box.width <= 0) return;
    const at = ((event.clientX - box.left) * this.width()) / box.width;
    const { x0, x1 } = this.scales();
    const step = count > 1 ? (x1 - x0) / (count - 1) : 1;
    const index = Math.round((at - x0) / step);
    this.setScrub(Math.min(Math.max(index, 0), count - 1));
  }

  private setScrub(index: number | null): void {
    if (index === this.scrubIndex()) return;
    this.scrubIndex.set(index);
    this.uiScrubbed.emit(index);
  }

  /**
   * THE VALUE GRID (Revolut's, Apple Health's): a dotted rule at each round
   * value the presenter names, its words at the right edge — the reader
   * measures the line against amounts, never a decoration. The scale
   * reaches the highest tick, so the top rule sits on the plot's top.
   */
  readonly uiTicks = input<readonly UiChartTick[]>([]);
  /**
   * THE DAY AXIS: under the plot, each point's word that is not empty (a
   * month's week starts, a week's days, a year's months) with a faint
   * guide up from it — the vertical rules mark those days and nothing else.
   */
  readonly uiAxis = input(false, { transform: booleanAttribute });

  /** The plot's lowest y — above the day axis when it is drawn. */
  private readonly plotBottom = computed(
    () => this.height() - PAD - (this.uiAxis() ? AXIS_BAND : 0),
  );

  /** The value grid: each tick's rule from the plot's start to its end. */
  protected readonly grid = computed(() => {
    const { y, x0, x1 } = this.scales();
    return this.uiTicks().map((tick) => ({
      y: px(y(tick.value)),
      x1: px(x0),
      x2: px(x1),
    }));
  });

  /** The day axis: each named point's word under the plot, and its guide. */
  protected readonly axis = computed(() => {
    if (!this.uiAxis()) return [];
    const { x } = this.scales();
    const points = this.uiPoints();
    const last = points.length - 1;
    const out: {
      x: number;
      text: string;
      anchor: 'start' | 'middle' | 'end';
    }[] = [];
    for (let i = 0; i < points.length; i++) {
      const text = (points[i] as UiChartLinePoint).label;
      if (text === '') continue;
      // The first and last words stay inside the box.
      const anchor = i === 0 ? 'start' : i === last ? 'end' : 'middle';
      out.push({ x: px(x(i)), text, anchor });
    }
    return out;
  });

  protected readonly axisTop = computed(() => px(PAD));
  protected readonly axisBottom = computed(() => px(this.plotBottom()));
  protected readonly axisTextY = computed(() => px(this.height() - PAD - 2));

  protected readonly comparisonPart = UiChartPart.Comparison;
  protected readonly gradientId = `ui-line-chart-area-${nextGradientId++}`;
  protected readonly areaFill = `url(#${this.gradientId})`;

  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('drawing');
  private readonly measured = elementWidth(this.svg);

  /** Set once the first frame is on screen: nothing fades before it. */
  protected readonly settled = signal(false);

  protected readonly width = computed(() => this.measured() || FALLBACK_WIDTH);
  protected readonly height = computed(() => px(this.width() / ASPECT));
  protected readonly viewBox = computed(
    () => `0 0 ${px(this.width())} ${this.height()}`,
  );

  /** The last DRAWN point's figure — a running total's, at today. */
  protected readonly lastValueText = computed(() => {
    const texts = this.uiValueText();
    const points = this.uiPoints();
    for (let i = points.length - 1; i >= 0; i--) {
      if ((points[i] as UiChartLinePoint).value !== null) {
        return texts[i] ?? null;
      }
    }
    return null;
  });

  /** The right-edge labels' column: none without a label, else as wide as the longer one needs. */
  private readonly gutter = computed(() => {
    const texts = [
      this.lastValueText(),
      this.uiAverageText(),
      ...this.uiTicks().map((tick) => tick.text),
    ].filter((text): text is string => text !== null);
    if (texts.length === 0) return 0;
    const longest = texts.reduce((max, text) => Math.max(max, text.length), 0);
    return Math.min(
      Math.max(LABEL_GUTTER, longest * CHAR_WIDTH + PAD),
      this.width() * MAX_GUTTER_SHARE,
    );
  });

  /** The plot's x of point `i` and y of a value. */
  private readonly scales = computed(() => {
    const points = this.uiPoints();
    const average = this.uiAverage();
    const x0 = PAD;
    const x1 = this.width() - this.gutter() - PAD - this.uiInset();
    const domain = zeroExtent([
      ...points.map((p) => p.value),
      ...points.map((p) => p.comparison),
      ...this.uiSeries().flatMap((line) => line.values),
      ...this.uiTicks().map((tick) => tick.value),
      average,
    ]);
    const y = linearScale(domain, [this.plotBottom(), PAD]);
    const step = points.length > 1 ? (x1 - x0) / (points.length - 1) : 0;
    const x = (index: number): number => x0 + index * step;
    return { x, y, x0, x1 };
  });

  private readonly valuePoints = computed<readonly ChartPoint[]>(() => {
    const { x, y } = this.scales();
    const out: ChartPoint[] = [];
    const points = this.uiPoints();
    for (let i = 0; i < points.length; i++) {
      const value = (points[i] as UiChartLinePoint).value;
      if (value !== null) out.push({ x: x(i), y: y(value) });
    }
    return out;
  });

  /** The `d` of a series in the chosen curve. */
  private readonly pathOf = computed(() =>
    this.uiCurve() === 'smooth' ? monotonePath : linePath,
  );

  private readonly lineShape = computed<LineShape>(
    () => {
      const points = this.valuePoints();
      const d = this.pathOf()(points);
      const area = this.uiArea() ? areaPath(d, points, this.scales().y(0)) : '';
      return { d, area };
    },
    { equal: (a, b) => a.d === b.d && a.area === b.area },
  );

  protected readonly comparisonPath = computed(() => {
    const { x, y } = this.scales();
    return this.pathOf()(
      this.uiPoints().map((p, i) =>
        p.comparison === null ? null : { x: x(i), y: y(p.comparison) },
      ),
    );
  });

  /** The member lines (`uiSeries`), each with a dot on its last drawn point. */
  protected readonly seriesShapes = computed<readonly SeriesShape[]>(() => {
    const { x, y } = this.scales();
    const path = this.pathOf();
    return this.uiSeries().map((line) => {
      const points: (ChartPoint | null)[] = [];
      let end: ChartPoint | null = null;
      for (let i = 0; i < line.values.length; i++) {
        const value = line.values[i] ?? null;
        const point = value === null ? null : { x: x(i), y: y(value) };
        points.push(point);
        if (point !== null) end = point;
      }
      return { d: path(points), tone: line.tone, end };
    });
  });

  /**
   * The line's path (and the area under it), keyed on its `d`: a change
   * after the first frame keeps the old path a moment, leaving, under the
   * new one, entering. The old one is dropped when its fade ends.
   */
  protected readonly linePaths = linkedSignal<
    LineShape,
    readonly LinePathNode[]
  >({
    source: this.lineShape,
    computation: (shape, previous) => {
      const fresh = { key: shape.d, ...shape, leaving: false };
      if (
        !this.settled() ||
        previous === undefined ||
        previous.source.d === shape.d
      ) {
        return [fresh];
      }
      return [
        { key: previous.source.d, ...previous.source, leaving: true },
        fresh,
      ];
    },
  });

  protected readonly markers = computed<readonly ChartPoint[]>(() => {
    const points = this.valuePoints();
    const first = points[0];
    const last = points[points.length - 1];
    if (first === undefined) return [];
    return last === first ? [first] : [first, last as ChartPoint];
  });

  protected readonly averageY = computed(() => {
    const average = this.uiAverage();
    return average === null ? null : px(this.scales().y(average));
  });

  protected readonly plotEnd = computed(() => px(this.scales().x1));

  /** The right-edge labels: the last value on its point, the average on its rule, kept apart. */
  protected readonly edgeLabels = computed<readonly EdgeLabel[]>(() => {
    const x = this.width() - this.gutter() + PAD - this.uiInset();
    const labels: EdgeLabel[] = [];
    const last = this.valuePoints()[this.valuePoints().length - 1];
    const valueText = this.lastValueText();
    if (last !== undefined && valueText !== null) {
      labels.push({ text: valueText, x: px(x), y: px(last.y + 4) });
    }
    const averageY = this.averageY();
    const averageText = this.uiAverageText();
    if (averageY !== null && averageText !== null) {
      let y = averageY + 4;
      const valueLabel = labels[0];
      if (
        valueLabel !== undefined &&
        Math.abs(y - valueLabel.y) < LABEL_CLEARANCE
      ) {
        y =
          valueLabel.y +
          (y >= valueLabel.y ? LABEL_CLEARANCE : -LABEL_CLEARANCE);
      }
      labels.push({ text: averageText, x: px(x), y: px(y) });
    }
    return labels;
  });

  /** The ticks' words in the labels' column, each dropped where a figure sits. */
  protected readonly tickLabels = computed<readonly EdgeLabel[]>(() => {
    const x = this.width() - this.gutter() + PAD - this.uiInset();
    const { y } = this.scales();
    const taken = this.edgeLabels();
    const out: EdgeLabel[] = [];
    for (const tick of this.uiTicks()) {
      const at = y(tick.value) + 4;
      if (taken.some((label) => Math.abs(label.y - at) < LABEL_CLEARANCE)) {
        continue;
      }
      out.push({ text: tick.text, x: px(x), y: px(at) });
    }
    return out;
  });

  protected readonly rows = computed(() => {
    const texts = this.uiValueText();
    return this.uiPoints().map((p, i) => ({
      label: p.label,
      value: texts.at(i) ?? '',
    }));
  });

  constructor() {
    afterNextRender(() => this.settled.set(true));
  }

  protected dropLeaving(): void {
    if (this.linePaths().some((node) => node.leaving)) {
      this.linePaths.update((nodes) => nodes.filter((node) => !node.leaving));
    }
  }
}
