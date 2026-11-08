import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  computed,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { elementWidth } from '@creativo/ui/layout';
import { UiVisuallyHiddenDirective } from '@creativo/ui/modifiers';
import { UiChartPart } from '../chart-part';
import { type ChartPoint, linePath } from '../geometry/line-path';
import { linearScale, px, zeroExtent } from '../geometry/linear-scale';

/** One point: its word (for the hidden table), this period's value and the comparison's, if any. */
export type UiChartLinePoint = {
  readonly label: string;
  readonly value: number;
  readonly comparison: number | null;
};

/** Where the chart draws before its width is known (jsdom, the first frame). */
const FALLBACK_WIDTH = 320;
/** The box is 5 : 2 — line-chart.css says the same in `aspect-ratio`. */
const ASPECT = 2.5;
/** Room for a marker and its ring at the plot's edges. */
const PAD = 6;
/** The right-edge labels' column, taken only when a label is printed. */
const LABEL_GUTTER = 56;
/** Two right-edge labels never sit closer than a caption line. */
const LABEL_CLEARANCE = 14;

type LinePathNode = {
  readonly key: string;
  readonly d: string;
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
 * in a 2 px ring of the surface. Straight segments, no smoothing.
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

  protected readonly comparisonPart = UiChartPart.Comparison;

  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('drawing');
  private readonly measured = elementWidth(this.svg);

  /** Set once the first frame is on screen: nothing fades before it. */
  protected readonly settled = signal(false);

  protected readonly width = computed(() => this.measured() || FALLBACK_WIDTH);
  protected readonly height = computed(() => px(this.width() / ASPECT));
  protected readonly viewBox = computed(
    () => `0 0 ${px(this.width())} ${this.height()}`,
  );

  protected readonly lastValueText = computed(() => {
    const texts = this.uiValueText();
    const count = this.uiPoints().length;
    return count > 0 ? (texts[count - 1] ?? null) : null;
  });

  private readonly gutter = computed(() =>
    this.lastValueText() !== null || this.uiAverageText() !== null
      ? LABEL_GUTTER
      : 0,
  );

  /** The plot's x of point `i` and y of a value. */
  private readonly scales = computed(() => {
    const points = this.uiPoints();
    const average = this.uiAverage();
    const x0 = PAD;
    const x1 = this.width() - this.gutter() - PAD;
    const domain = zeroExtent([
      ...points.map((p) => p.value),
      ...points.map((p) => p.comparison),
      average,
    ]);
    const y = linearScale(domain, [this.height() - PAD, PAD]);
    const step = points.length > 1 ? (x1 - x0) / (points.length - 1) : 0;
    const x = (index: number): number => x0 + index * step;
    return { x, y, x0, x1 };
  });

  private readonly valuePoints = computed<readonly ChartPoint[]>(() => {
    const { x, y } = this.scales();
    return this.uiPoints().map((p, i) => ({ x: x(i), y: y(p.value) }));
  });

  private readonly linePathD = computed(() => linePath(this.valuePoints()));

  protected readonly comparisonPath = computed(() => {
    const { x, y } = this.scales();
    return linePath(
      this.uiPoints().map((p, i) =>
        p.comparison === null ? null : { x: x(i), y: y(p.comparison) },
      ),
    );
  });

  /**
   * The line's path, keyed on its `d`: a change after the first frame keeps
   * the old path a moment, leaving, under the new one, entering. The old
   * one is dropped when its fade ends.
   */
  protected readonly linePaths = linkedSignal<string, readonly LinePathNode[]>({
    source: this.linePathD,
    computation: (d, previous) => {
      const fresh = { key: d, d, leaving: false };
      if (!this.settled() || previous === undefined || previous.source === d) {
        return [fresh];
      }
      return [
        { key: previous.source, d: previous.source, leaving: true },
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
    const x = this.width() - this.gutter() + PAD;
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
