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
import type { ChartPoint } from '../geometry/line-path';
import { px } from '../geometry/linear-scale';
import {
  axisAnchor,
  polygonPoints,
  radarVertex,
  ringPoints,
  type RadarAnchor,
} from '../geometry/polygon-points';

/**
 * One axis: its word, this period's value (0 … 100, `null` when there is
 * not enough data for one) and the comparison period's, if any.
 */
export type UiChartRadarAxis = {
  readonly label: string;
  readonly value: number | null;
  readonly comparison: number | null;
};

/** Where the radar draws before its width is known (jsdom, the first frame). */
const FALLBACK_WIDTH = 320;
/** The least band around the rings the words take, on every side. */
const LABEL_ROOM = 60;
/**
 * A caption glyph's width, near enough: the band grows with the longest
 * word (or figure) so a long axis word never runs under the rings — an
 * estimate, as the bar chart's; the kit measures nothing.
 */
const CHAR_WIDTH = 7;
/** The rings never shrink below a quarter of the box, whatever the words want. */
const MIN_RADIUS_SHARE = 0.25;
/** The guide rings: half way and the outer edge. */
const RING_SHARES = [0.5, 1] as const;
/** From an axis's outer end to its words. */
const LABEL_GAP = 8;
/** A caption line, near enough, and its ascent over the baseline. */
const LINE = 14;
const ASCENT = 8;
/** The identity tones the stylesheet maps (`--sys-identity-0..4`). */
const IDENTITY_TONES = 5;

type RadarAxisMark = {
  readonly label: string;
  /** The figure as worded, or `uiMissingText` for a `null` axis. */
  readonly valueText: string;
  readonly missing: boolean;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly textX: number;
  readonly labelY: number;
  readonly valueY: number;
  readonly textAnchor: RadarAnchor['textAnchor'];
};

type RadarPolygonNode = {
  readonly key: string;
  readonly points: string;
  readonly leaving: boolean;
};

type RadarRow = {
  readonly label: string;
  readonly value: string;
  readonly comparison: number | null;
};

/**
 * THE RADAR — one polygon over `n` axes (five in the design, any count
 * drawn), the first axis straight up and the rest clockwise; each vertex
 * at its value's share of the radius, a `null` axis collapsed to the
 * centre and its value slot printing `uiMissingText` instead of a figure.
 * The polygon is its paint at 18 % with a solid stroke — the accent, or
 * one of the five identity tones when `uiTone` names a person (`data-tone`
 * on the host, mapped by charts.css). The comparison period is a dashed
 * grey outline on the same base (`data-part="comparison"`); the guide
 * rings at 50 % and 100 % and the axes are hairlines in the separator.
 * Each axis's word (ink) and its value text (`uiValueText`, the kit formats
 * no number) sit outside the axis's outer end, anchored away from the
 * centre.
 *
 * The box is square (`aspect-ratio: 1` in the stylesheet, the viewBox over
 * the measured width), the words' band taken off the radius. A changed
 * polygon cross-fades after the first frame; nothing moves under reduced
 * motion.
 *
 * Accessibility: the `svg` is `role="img"` named by `uiLabel`; a visually
 * hidden table lists every axis's word, value text and comparison figure.
 */
@Component({
  selector: 'ui-radar',
  imports: [UiVisuallyHiddenDirective],
  templateUrl: './radar.html',
  styleUrl: './radar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-radar',
    '[attr.data-tone]': 'tone()',
    '[attr.data-settled]': "settled() ? '' : null",
  },
})
export class UiRadar {
  readonly uiAxes = input.required<readonly UiChartRadarAxis[]>();
  /** The drawing's accessible name — one sentence the presenter writes. */
  readonly uiLabel = input.required<string>();
  /** One pre-formatted figure per axis, printed outside its vertex. */
  readonly uiValueText = input<readonly string[]>([]);
  /** The word printed in place of a `null` axis's figure («малко данни»). */
  readonly uiMissingText = input<string>('');
  /** `0 … 4` → the polygon in `--sys-identity-N`; `null` → the accent. */
  readonly uiTone = input<number | null>(null);

  protected readonly comparisonPart = UiChartPart.Comparison;

  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('drawing');
  private readonly measured = elementWidth(this.svg);

  /** Set once the first frame is on screen: nothing fades before it. */
  protected readonly settled = signal(false);

  /** The host's `data-tone`: an identity slot the stylesheet knows, or none. */
  protected readonly tone = computed(() => {
    const tone = this.uiTone();
    return tone !== null &&
      Number.isInteger(tone) &&
      tone >= 0 &&
      tone < IDENTITY_TONES
      ? tone
      : null;
  });

  protected readonly width = computed(() => this.measured() || FALLBACK_WIDTH);
  protected readonly viewBox = computed(
    () => `0 0 ${px(this.width())} ${px(this.width())}`,
  );

  private readonly centre = computed<ChartPoint>(() => {
    const half = this.width() / 2;
    return { x: half, y: half };
  });

  /** The band the longest word or figure needs, never under {@link LABEL_ROOM}. */
  private readonly labelRoom = computed(() => {
    const words = [
      ...this.uiAxes().map((axis) => axis.label),
      ...this.uiValueText(),
      this.uiMissingText(),
    ];
    const longest = words.reduce((max, word) => Math.max(max, word.length), 0);
    return Math.max(LABEL_ROOM, longest * CHAR_WIDTH + LABEL_GAP);
  });

  private readonly radius = computed(() => {
    const width = this.width();
    return Math.max(width / 2 - this.labelRoom(), width * MIN_RADIUS_SHARE);
  });

  protected readonly rings = computed(() => {
    const count = this.uiAxes().length;
    if (count === 0) return [];
    return RING_SHARES.map((share) =>
      ringPoints(count, this.radius() * share, this.centre()),
    );
  });

  /** Each axis: its hairline, and where its two lines of words go. */
  protected readonly axes = computed<readonly RadarAxisMark[]>(() => {
    const axes = this.uiAxes();
    const count = axes.length;
    const centre = this.centre();
    const radius = this.radius();
    const texts = this.uiValueText();
    const missingText = this.uiMissingText();
    return axes.map((axis, index) => {
      const end = radarVertex(index, count, radius, centre);
      const at = radarVertex(index, count, radius + LABEL_GAP, centre);
      const anchor = axisAnchor(index, count);
      const missing = axis.value === null;
      let labelY: number;
      let valueY: number;
      if (anchor.vertical === 'above') {
        valueY = at.y;
        labelY = at.y - LINE;
      } else if (anchor.vertical === 'below') {
        labelY = at.y + ASCENT;
        valueY = at.y + ASCENT + LINE;
      } else {
        labelY = at.y - 2;
        valueY = at.y + LINE - 2;
      }
      return {
        label: axis.label,
        valueText: missing ? missingText : (texts.at(index) ?? ''),
        missing,
        x1: px(centre.x),
        y1: px(centre.y),
        x2: px(end.x),
        y2: px(end.y),
        textX: px(at.x),
        labelY: px(labelY),
        valueY: px(valueY),
        textAnchor: anchor.textAnchor,
      };
    });
  });

  private readonly polygon = computed(() =>
    polygonPoints(
      this.uiAxes().map((axis) => axis.value),
      this.radius(),
      this.centre(),
    ),
  );

  /** The comparison outline, or none when no axis has a comparison. */
  protected readonly comparisonPoints = computed(() => {
    const axes = this.uiAxes();
    if (axes.every((axis) => axis.comparison === null)) return null;
    return polygonPoints(
      axes.map((axis) => axis.comparison),
      this.radius(),
      this.centre(),
    );
  });

  /**
   * The polygon, keyed on its points: a change after the first frame keeps
   * the old shape a moment, leaving, under the new one, entering. The old
   * one is dropped when its fade ends.
   */
  protected readonly polygons = linkedSignal<
    string,
    readonly RadarPolygonNode[]
  >({
    source: this.polygon,
    computation: (points, previous) => {
      const fresh = { key: points, points, leaving: false };
      if (
        !this.settled() ||
        previous === undefined ||
        previous.source === points
      ) {
        return [fresh];
      }
      return [
        { key: previous.source, points: previous.source, leaving: true },
        fresh,
      ];
    },
  });

  protected readonly rows = computed<readonly RadarRow[]>(() =>
    this.axes().map((axis, index) => ({
      label: axis.label,
      value: axis.valueText,
      comparison: this.uiAxes().at(index)?.comparison ?? null,
    })),
  );

  constructor() {
    afterNextRender(() => this.settled.set(true));
  }

  protected dropLeaving(): void {
    if (this.polygons().some((node) => node.leaving)) {
      this.polygons.update((nodes) => nodes.filter((node) => !node.leaving));
    }
  }
}
