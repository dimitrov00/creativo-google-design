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
import { px, zeroExtent } from '../geometry/linear-scale';
import { type SparkBarRect, sparkBarRects } from '../geometry/spark-bars';

/** Where the sparkline draws before its box is known (jsdom, the first frame): a bento tile's width. */
const FALLBACK_WIDTH = 160;
/** `--ui-spark-bars-height`'s default — spark-bars.css says the same. */
const FALLBACK_HEIGHT = 48;

type SparkBarMark = SparkBarRect & { readonly highlight: boolean };

/** The bars as drawn, and the values they were drawn from — what a fade is keyed on. */
type SparkBarsShape = {
  readonly key: string;
  readonly bars: readonly SparkBarMark[];
};

type SparkBarsNode = SparkBarsShape & { readonly leaving: boolean };

/**
 * THE BAR SPARKLINE — a bento card's tiny graph: one thin capsule per value
 * (`uiValues`, zero-anchored, a negative counted as zero), evenly spaced
 * across the host's width, standing on the bottom of a box as tall as
 * `--ui-spark-bars-height` (48 px by default). No axes and no words on the
 * drawing. A zero still draws a 2 px stub, so its slot reads (Revolut's
 * spend card).
 *
 * Paint: every bar in the series paint — the accent, or the host's own
 * `--ui-chart-paint` when it carries `data-tone` (an identity tone) or
 * `data-part` (charts.css). `uiHighlight` names ONE bar to keep that paint
 * and quiets every other to the ramp's 48 % grey (the bar chart's
 * highlight). `uiAverage` rules a dashed line at that value in the
 * comparison grey (`data-part="comparison"`); the scale's top makes room
 * for it.
 *
 * The width is measured (`elementWidth`) and the height read once from
 * the drawing's laid-out box after the first frame, so the viewBox is the
 * drawing's own pixels and the round ends stay round. New values
 * cross-fade the bars after the first frame (a resize redraws in place);
 * nothing moves under reduced motion.
 *
 * Accessibility: the `svg` is `role="img"` named by `uiLabel`; a visually
 * hidden table lists each bar's word (`uiLabels`, else `1 … n`) and its
 * figure (`uiValueText`, the kit formats no number).
 */
@Component({
  selector: 'ui-spark-bars',
  imports: [UiVisuallyHiddenDirective],
  templateUrl: './spark-bars.html',
  styleUrl: './spark-bars.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-spark-bars',
    '[attr.data-highlighting]': "highlight() === null ? null : ''",
    '[attr.data-settled]': "settled() ? '' : null",
  },
})
export class UiSparkBars {
  readonly uiValues = input.required<readonly number[]>();
  /** The index of the one bar kept in the series paint; `null` paints them all. */
  readonly uiHighlight = input<number | null>(null);
  /** A dashed rule at this value, in the comparison grey. */
  readonly uiAverage = input<number | null>(null);
  /** The drawing's accessible name — one sentence the presenter writes. */
  readonly uiLabel = input.required<string>();
  /** One pre-formatted figure per bar, for the hidden table only. */
  readonly uiValueText = input<readonly string[]>([]);
  /** One word per bar for the hidden table («пн», «1 ноем.»); `1 … n` when absent. */
  readonly uiLabels = input<readonly string[]>([]);

  protected readonly comparisonPart = UiChartPart.Comparison;

  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('drawing');
  private readonly measured = elementWidth(this.svg);
  /** The drawing's laid-out height, read once after the first frame. */
  private readonly measuredHeight = signal(0);

  /** Set once the first frame is on screen: nothing fades before it. */
  protected readonly settled = signal(false);

  protected readonly width = computed(() => this.measured() || FALLBACK_WIDTH);
  protected readonly height = computed(
    () => this.measuredHeight() || FALLBACK_HEIGHT,
  );
  /** The drawing's right edge, where the average's rule ends. */
  protected readonly right = computed(() => px(this.width()));
  protected readonly viewBox = computed(
    () => `0 0 ${this.right()} ${px(this.height())}`,
  );

  /** The highlight, when it names a bar that exists. */
  protected readonly highlight = computed(() => {
    const index = this.uiHighlight();
    return index !== null &&
      Number.isInteger(index) &&
      index >= 0 &&
      index < this.uiValues().length
      ? index
      : null;
  });

  /** The scale's top: the largest value, or the average when it reaches higher. */
  private readonly top = computed(
    () => zeroExtent([...this.uiValues(), this.uiAverage()])[1],
  );

  private readonly shape = computed<SparkBarsShape>(() => {
    const values = this.uiValues();
    const highlight = this.highlight();
    const rects = sparkBarRects(
      values,
      this.width(),
      this.height(),
      this.top(),
    );
    return {
      key: values.join(','),
      bars: rects.map((rect, index) => ({
        ...rect,
        highlight: index === highlight,
      })),
    };
  });

  /**
   * The bars, keyed on their values: new values after the first frame keep
   * the old bars a moment, leaving, under the new ones, entering; a resize
   * or a moved highlight redraws in place. The old bars are dropped when
   * their fade ends.
   */
  protected readonly nodes = linkedSignal<
    SparkBarsShape,
    readonly SparkBarsNode[]
  >({
    source: this.shape,
    computation: (shape, previous) => {
      const fresh = { ...shape, leaving: false };
      if (
        !this.settled() ||
        previous === undefined ||
        previous.source.key === shape.key
      ) {
        return [fresh];
      }
      return [{ ...previous.source, leaving: true }, fresh];
    },
  });

  protected readonly averageY = computed(() => {
    const average = this.uiAverage();
    if (average === null) return null;
    const top = this.top();
    const height = this.height();
    return px(
      top > 0 ? height - (Math.max(0, average) / top) * height : height,
    );
  });

  protected readonly rows = computed(() => {
    const labels = this.uiLabels();
    const texts = this.uiValueText();
    return this.uiValues().map((_, index) => ({
      label: labels.at(index) ?? `${index + 1}`,
      value: texts.at(index) ?? '',
    }));
  });

  constructor() {
    afterNextRender(() => {
      const height = this.svg()?.nativeElement.getBoundingClientRect().height;
      if (height !== undefined && height > 0) this.measuredHeight.set(height);
      this.settled.set(true);
    });
  }

  protected dropLeaving(): void {
    if (this.nodes().some((node) => node.leaving)) {
      this.nodes.update((nodes) => nodes.filter((node) => !node.leaving));
    }
  }
}
