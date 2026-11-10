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
import type { UiChartPart } from '../chart-part';
import { px } from '../geometry/linear-scale';
import { ringArcs } from '../geometry/ring-arcs';

/**
 * One share of the ring: how much (any unit; the ring draws shares of the
 * total), its paint — an identity tone `0 … 4` first, else a part hook,
 * else the accent — and its word and pre-formatted figure for the hidden
 * table.
 */
export type UiChartRingSegment = {
  readonly value: number;
  readonly part: UiChartPart | null;
  readonly tone: number | null;
  readonly label: string;
  readonly valueText: string;
};

/** Where the ring draws before its width is known (jsdom, the first frame). */
const FALLBACK_WIDTH = 240;
/** The air between two segments' round caps, along the ring. */
const GAP_AIR = 4;
/** The identity tones the stylesheet maps (`--sys-identity-0..4`). */
const IDENTITY_TONES = 5;

type RingSegmentMark = {
  readonly index: number;
  readonly d: string;
  readonly tone: number | null;
  readonly part: UiChartPart | null;
};

/** The segments as drawn, and the shares and paints they were drawn from — what a fade is keyed on. */
type RingShape = {
  readonly key: string;
  readonly arcs: readonly RingSegmentMark[];
};

type RingNode = RingShape & { readonly leaving: boolean };

/** A tone the stylesheet knows, or none. */
function toneOf(tone: number | null): number | null {
  return tone !== null &&
    Number.isInteger(tone) &&
    tone >= 0 &&
    tone < IDENTITY_TONES
    ? tone
    : null;
}

/**
 * THE RING — a donut of shares, Revolut's radial view: one round-capped
 * arc per segment, its share of the total, the first from 12 o'clock and
 * the rest clockwise, with 4 px of air between two segments' caps (a share
 * too short for that becomes a dot). A segment's paint is its identity
 * tone (`tone` 0 … 4 → `data-tone`, `--sys-identity-N`), else its part
 * hook (`data-part`, charts.css), else the accent. One segment with a
 * share is the whole ring with no gap; a zero total draws the track alone,
 * a full ring in the control fill.
 *
 * The host is square (the measured width, the viewBox over it) and the
 * ring is inset by half its `uiThickness` (14 px), so its outer edge meets
 * the box. `[uiRingCenter]` is projected over the hole as HTML, centred
 * in the square inscribed in it: a caption, a big figure, a sub-line
 * («Похарчено / 1 234 € / яну – юни»). New shares or paints cross-fade
 * after the first frame (a resize redraws in place); nothing moves under
 * reduced motion.
 *
 * Accessibility: the `svg` is `role="img"` named by `uiLabel`; a visually
 * hidden table lists each segment's word and figure.
 */
@Component({
  selector: 'ui-ring-chart',
  imports: [UiVisuallyHiddenDirective],
  templateUrl: './ring-chart.html',
  styleUrl: './ring-chart.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-ring-chart',
    '[attr.data-settled]': "settled() ? '' : null",
    '[attr.data-scrubbing]': "scrubIndex() === null ? null : ''",
    '[style.--ui-ring-chart-thickness]': "thickness() + 'px'",
  },
})
export class UiRingChart {
  readonly uiSegments = input.required<readonly UiChartRingSegment[]>();
  /** The drawing's accessible name — one sentence the presenter writes. */
  readonly uiLabel = input.required<string>();
  /** The ring's stroke, in px. */
  readonly uiThickness = input<number>(14);

  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('drawing');
  private readonly measured = elementWidth(this.svg);

  /** Set once the first frame is on screen: nothing fades before it. */
  protected readonly settled = signal(false);

  protected readonly size = computed(() => this.measured() || FALLBACK_WIDTH);
  protected readonly viewBox = computed(() => {
    const size = px(this.size());
    return `0 0 ${size} ${size}`;
  });

  /** The stroke, never under a pixel nor wider than half the box. */
  protected readonly thickness = computed(() =>
    px(Math.min(Math.max(1, this.uiThickness()), this.size() / 2)),
  );

  protected readonly centre = computed(() => px(this.size() / 2));
  protected readonly radius = computed(() =>
    px(this.size() / 2 - this.thickness() / 2),
  );

  private readonly shape = computed<RingShape>(() => {
    const segments = this.uiSegments();
    const centre = this.centre();
    const arcs = ringArcs(
      segments.map((segment) => segment.value),
      this.radius(),
      { x: centre, y: centre },
      GAP_AIR + this.thickness(),
    );
    const marks = arcs.map((arc): RingSegmentMark => {
      const segment = segments[arc.index] as UiChartRingSegment;
      const tone = toneOf(segment.tone);
      return {
        index: arc.index,
        d: arc.d,
        tone,
        part: tone === null ? segment.part : null,
      };
    });
    return {
      key: segments
        .map(
          (segment) =>
            `${Math.max(0, segment.value)}:${toneOf(segment.tone) ?? ''}:${segment.part ?? ''}`,
        )
        .join(','),
      arcs: marks,
    };
  });

  /** Nothing to share out: the track alone. */
  protected readonly empty = computed(() => this.shape().arcs.length === 0);

  /**
   * The segments, keyed on their shares and paints: a change after the
   * first frame keeps the old ring a moment, leaving, under the new one,
   * entering; a resize redraws in place. The old ring is dropped when its
   * fade ends.
   */
  protected readonly nodes = linkedSignal<RingShape, readonly RingNode[]>({
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

  protected readonly rows = computed(() =>
    this.uiSegments().map((segment) => ({
      label: segment.label,
      value: segment.valueText,
    })),
  );

  constructor() {
    afterNextRender(() => this.settled.set(true));
  }

  protected dropLeaving(): void {
    if (this.nodes().some((node) => node.leaving)) {
      this.nodes.update((nodes) => nodes.filter((node) => !node.leaving));
    }
  }

  // ── The scrub (the line and bar charts' grammar) ──────────────────────

  /**
   * READ BY TOUCH: a finger down on the ring, or going round it — a mouse
   * on hover — reads the share under it: that segment keeps its paint,
   * every other steps back, and its index goes out through `uiScrubbed`
   * (`null` when the finger lifts or the mouse leaves). The share is the
   * one whose slice of the turn holds the pointer's angle, measured
   * clockwise from twelve o'clock as the arcs are drawn.
   */
  readonly uiScrubbable = input(false, { transform: booleanAttribute });
  /** The index (in `uiSegments`) of the share under the pointer; `null` at rest. */
  readonly uiScrubbed = output<number | null>();

  protected readonly scrubIndex = signal<number | null>(null);
  private scrubbing = false;

  protected scrubStart(event: PointerEvent): void {
    if (!this.uiScrubbable()) return;
    this.scrubbing = true;
    this.scrubAt(event);
    const target = event.currentTarget as Element | null;
    try {
      target?.setPointerCapture?.(event.pointerId);
    } catch {
      /* no active pointer to capture */
    }
  }

  protected scrubMove(event: PointerEvent): void {
    if (!this.uiScrubbable()) return;
    if (this.scrubbing || event.pointerType === 'mouse') this.scrubAt(event);
  }

  protected scrubEnd(event: PointerEvent): void {
    if (!this.uiScrubbable()) return;
    if (event.type === 'pointerleave' && this.scrubbing) return;
    this.scrubbing = false;
    this.setScrub(null);
  }

  private scrubAt(event: PointerEvent): void {
    const svg = this.svg()?.nativeElement;
    if (svg === undefined) return;
    const box = svg.getBoundingClientRect();
    if (box.width <= 0) return;
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    // The ring's hole holds the figure: a touch there reads nothing.
    const inner =
      ((this.radius() - this.thickness()) * box.width) / this.size();
    if (Math.hypot(dx, dy) < inner) {
      this.setScrub(null);
      return;
    }
    this.setScrub(shareAt(this.uiSegments(), Math.atan2(dx, -dy)));
  }

  private setScrub(index: number | null): void {
    if (index === this.scrubIndex()) return;
    this.scrubIndex.set(index);
    this.uiScrubbed.emit(index);
  }
}

/**
 * The segment whose slice of the turn holds `angle` (radians clockwise from
 * twelve o'clock, any turn): each positive value takes its share of the
 * turn in order; `null` when nothing is shared out.
 */
export function shareAt(
  segments: readonly UiChartRingSegment[],
  angle: number,
): number | null {
  let total = 0;
  for (const segment of segments) total += Math.max(0, segment.value);
  if (total <= 0) return null;
  const turn = 2 * Math.PI;
  const at = (((angle % turn) + turn) % turn) / turn;
  let edge = 0;
  for (let i = 0; i < segments.length; i++) {
    const share = Math.max(0, segments.at(i)?.value ?? 0) / total;
    if (share <= 0) continue;
    edge += share;
    if (at < edge) return i;
  }
  return segments.length - 1;
}
