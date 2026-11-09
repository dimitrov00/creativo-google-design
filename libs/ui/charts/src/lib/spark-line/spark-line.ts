import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  computed,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { elementWidth } from '@creativo/ui/layout';
import { UiChartPart } from '../chart-part';
import { areaPath, linePath, monotonePath } from '../geometry/line-path';
import { px, zeroExtent } from '../geometry/linear-scale';
import { sparkLinePoints } from '../geometry/spark-line';

/** Where the line draws before its box is known (jsdom, the first frame): a bento tile's width. */
const FALLBACK_WIDTH = 320;
/** `--ui-spark-line-height`'s default — spark-line.css says the same. */
const FALLBACK_HEIGHT = 64;
/** Room inside the box for the end dot and the stroke. */
const INSET = 5;

/**
 * THE LINE SPARKLINE — a bento card's pace: `uiValues` as a smooth line
 * with a soft wash under it, ending in a dot, beside `uiComparison` as a
 * dashed line in the comparison grey, both on one scale over `uiSlots`
 * slots (the period's buckets: a running month draws to today and leaves
 * the rest of the width ahead). No axes and no words on the drawing.
 *
 * Paint: the accent, or the host's `--ui-chart-paint` when it carries
 * `data-tone` / `data-part` (charts.css) — the line, the wash and the dot
 * are shapes, so the accent law holds.
 *
 * The width is measured and the height read once after the first frame,
 * so the viewBox is the drawing's own pixels: the dot stays round and the
 * strokes keep their width. Accessibility: `role="img"` named by
 * `uiLabel`, one sentence the presenter writes with both figures in it.
 */
@Component({
  selector: 'ui-spark-line',
  templateUrl: './spark-line.html',
  styleUrl: './spark-line.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ui-spark-line' },
})
export class UiSparkLine {
  /** The series, slot by slot from the first; may stop short of `uiSlots`. */
  readonly uiValues = input.required<readonly number[]>();
  /** The series it is read against, dashed; `null` draws none. */
  readonly uiComparison = input<readonly number[] | null>(null);
  /** How many slots the width holds; the longer series when larger. */
  readonly uiSlots = input(0);
  /** The drawing's accessible name. */
  readonly uiLabel = input.required<string>();

  protected readonly comparisonPart = UiChartPart.Comparison;

  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('drawing');
  private readonly measured = elementWidth(this.svg);
  private readonly measuredHeight = signal(0);

  private readonly width = computed(() => this.measured() || FALLBACK_WIDTH);
  private readonly height = computed(
    () => this.measuredHeight() || FALLBACK_HEIGHT,
  );
  protected readonly viewBox = computed(
    () => `0 0 ${px(this.width())} ${px(this.height())}`,
  );

  private readonly top = computed(
    () => zeroExtent([...this.uiValues(), ...(this.uiComparison() ?? [])])[1],
  );
  private readonly slots = computed(() =>
    Math.max(
      this.uiSlots(),
      this.uiValues().length,
      this.uiComparison()?.length ?? 0,
    ),
  );

  private pointsOf(values: readonly number[]) {
    return sparkLinePoints(
      values,
      this.slots(),
      this.width(),
      this.height(),
      this.top(),
      INSET,
    );
  }

  private readonly points = computed(() => this.pointsOf(this.uiValues()));

  protected readonly line = computed(() => {
    const points = this.points();
    return points.length > 1 ? monotonePath(points) : '';
  });
  protected readonly area = computed(() =>
    areaPath(this.line(), this.points(), this.height() - INSET),
  );
  protected readonly end = computed(() => {
    const last = this.points().at(-1);
    return last === undefined ? null : { x: px(last.x), y: px(last.y) };
  });
  protected readonly comparisonPath = computed(() => {
    const comparison = this.uiComparison();
    if (comparison === null || comparison.length < 2) return '';
    return linePath(this.pointsOf(comparison));
  });

  constructor() {
    afterNextRender(() => {
      const height = this.svg()?.nativeElement.getBoundingClientRect().height;
      if (height !== undefined && height > 0) this.measuredHeight.set(height);
    });
  }
}
