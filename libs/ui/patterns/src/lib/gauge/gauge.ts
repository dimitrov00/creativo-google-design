import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  afterNextRender,
  computed,
  effect,
  input,
  isDevMode,
  linkedSignal,
  numberAttribute,
  signal,
} from '@angular/core';
import { UiIcon, type UiIconName } from '@creativo/ui/icons';
import { UiMarkScale, type UiMark } from '../mark-scale/mark-scale';

/**
 * ≙ SwiftUI `.gaugeStyle(_:)`. `linearCapacity` is a bar filled to the
 * value; `discreteCapacity` a row of whole slots (a stamp card);
 * `steps` a node per mark, evenly spaced — a custom GaugeStyle for RANKS
 * (tiers, season levels, a medal family's I–V), where the distance
 * between two thresholds says nothing and the order says everything;
 * `circularCapacity` (≙ `.accessoryCircularCapacity`) a RING filled
 * clockwise from 12 o'clock — round a disc (a medal, a face) or alone
 * round one figure.
 */
export type UiGaugeStyle =
  'linearCapacity' | 'discreteCapacity' | 'steps' | 'circularCapacity';
/**
 * ≙ `.controlSize`. A local union: patterns cannot import `UiControlSize`.
 * `small` belongs to the bar, the card and the steps; `large` to the card
 * (the wallet's stamps at 44, 2026-10-06) and to the ring; `extraLarge`
 * to the ring alone. On the ring the size names the DISC it wraps (44,
 * 52, 112 inside 52, 64, 128). A size a style does not have draws that
 * style's `regular` and warns in development.
 */
export type UiGaugeControlSize = 'small' | 'regular' | 'large' | 'extraLarge';

/** Past this many slots a card demotivates; the gauge draws a bar instead. */
const MAX_SLOTS = 12;

type GaugeRingSize = Exclude<UiGaugeControlSize, 'small'>;

/**
 * A DASHED ring's pattern is «2 on, 3 off»: five points to a dash. The
 * track's `pathLength` is a whole number of dashes, so the last one meets
 * the first at 12 o'clock with no odd dash at the seam, and a unit stays a
 * point to within 1 %. The dashed line is the regular ring's at every size
 * (gauge.css), on the box's outer edge: 49 π ≈ 154, 61 π ≈ 192, 125 π ≈ 393.
 */
const RING_DASH_UNITS = 5;
const RING_DASHES: Readonly<Record<GaugeRingSize, number>> = {
  regular: 31,
  large: 38,
  extraLarge: 79,
};

type GaugeDirection = 'up' | 'reset';

interface GaugeSlot {
  readonly index: number;
  readonly filled: boolean;
  readonly reward: boolean;
  /** Filled by a live change after the first frame: the stamp lands. */
  readonly punched: boolean;
  readonly caption: string | null;
  /** A stamp on the large card prints the check (a mark on the tint, never a word). */
  readonly check: boolean;
  /** An empty slot on the large card prints its ordinal, so the next stamp is read without counting. */
  readonly numeral: string | null;
}

type GaugeNodeState = 'reached' | 'current' | 'next' | 'ahead';

interface GaugeNode {
  readonly mark: UiMark;
  readonly state: GaugeNodeState;
  /** How much of the link INTO this node is lit, 0 … 1; `null` on the first node. */
  readonly link: number | null;
  readonly detail: readonly string[];
  /** A level passed (reached below the current one, or the last node of a finished track): the check, never a word on the tint. */
  readonly check: boolean;
  /** What the node prints: its `short`, except where the check stands for it. */
  readonly numeral: string | null;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * THE GAUGE — a meter (SwiftUI `Gauge`): where a value stands in a range
 * that PERSISTS — a points balance against the catalogue, a stamp card, a
 * tier, a season's levels. Not a progress bar: nothing is loading, so it
 * is `role="meter"`, never `progressbar`, and it never performs on mount.
 *
 * The tint is `--ui-gauge-tint`, the accent every meter already fills
 * with (the ring, the progress view, the slider). Nothing here carries
 * information only its colour holds: the owner always prints the value
 * beside it in words, and the states differ by FORM — a filled slot, a
 * ringed one; a node passed filled and checked, the current one ringed
 * in the tint, the rest ringed in the extent's ink — so the gauge is read
 * by shape first. Accent strokes mark what is EARNED only.
 *
 * `uiMarks` is the DS's one mark grammar, read three ways: on a bar every
 * mark cuts a notch and a labelled one gets its word under the track
 * (`ui-mark-scale`, `regular` only); on a card a labelled mark captions
 * the slot its value fills; on `steps` each mark IS a node — `short`
 * inside it (a level passed shows the check instead), `label` under it,
 * `detail` under that.
 *
 * THE RING (`circularCapacity`, revision 3) is two circles: a quiet track
 * and the tint's arc, from 12 o'clock, clockwise, round caps. The size
 * names the disc it wraps — `regular` 44 in 52, `large` 52 in 64,
 * `extraLarge` 112 in 128 — and the gauge draws the ring only: a composer
 * (`ui-medal`, the sheet headline) centres its disc in the same box, read
 * from `--ui-gauge-diameter`. Standing ALONE round a figure it takes
 * `large` with a heavier `--ui-gauge-stroke` (five points), set on the
 * gauge itself. `[uiCurrentValueLabel]` is what stands in the centre
 * (≙ `currentValueLabel`): ONE number or one check — «7», «18», never
 * «3/10» — always the headline role, tabular. A zero value draws the
 * track alone (no dot at 12 o'clock); a ring short of full always keeps a
 * gap; `data-extent="dashed"`, stamped by the composer, draws the track
 * alone, dashed, in the extent's ink (a family not started): a quiet line,
 * the regular ring's weight at every size. It takes no marks.
 *
 * ```html
 * <ui-gauge
 *   uiGaugeStyle="circularCapacity"
 *   uiControlSize="large"
 *   [uiValue]="13" [uiMin]="10" [uiMax]="20"
 *   [uiLabel]="words.status"
 *   [uiValueText]="words.statusReading"
 * >
 *   <span uiCurrentValueLabel>7</span>
 * </ui-gauge>
 * ```
 *
 * A stamp card of more than twelve slots draws the bar instead and warns
 * in development. Whole slots only: a slot is stamped or it is not.
 * `uiRewardIcon` makes the LAST slot the reward, told apart by its ring
 * and glyph rather than by colour. THE CARD HAS THREE RUNGS: `small`,
 * dots; `regular`, 24 pt slots that hug their row (the glance's half
 * tile); `large` (2026-10-06, the wallet's «Карта с печати», revision 3
 * §2.2.2 WC3), stamps at the regular control's 44 spread across the
 * card's inner width, a stamp printing the check in the on-accent ink and
 * an empty slot its ordinal in the secondary ink, the reward its glyph at
 * the 24 rung.
 *
 * Motion only for a LIVE change after the first frame: a rise glides the
 * bar and lands the new stamps; a card that completes and starts again
 * cross-fades to empty; a fall swaps without a word of motion. Reduced
 * motion draws the value, nothing else.
 *
 * `uiLabel` and `uiValueText` are required: the meter's name and its
 * reading in the owner's words («4 от 10 посещения, още 6 до безплатно
 * подстригване»). Inside a button or an image the meter is presentational
 * and the container's own name must carry the same words. All spans, so it
 * sits inside a button.
 */
@Component({
  selector: 'ui-gauge',
  imports: [UiIcon, UiMarkScale],
  template: `
    @switch (effectiveStyle()) {
      @case ('discreteCapacity') {
        <span class="ui-gauge__slots" aria-hidden="true">
          @for (slot of slots(); track slot.index) {
            <span
              class="ui-gauge__slot"
              [attr.data-filled]="slot.filled ? '' : null"
              [attr.data-reward]="slot.reward ? '' : null"
              [attr.data-punched]="slot.punched ? '' : null"
            >
              <span class="ui-gauge__disc">
                @if (slot.reward && showsRewardGlyph()) {
                  @if (uiRewardIcon(); as icon) {
                    <ui-icon class="ui-gauge__reward" [uiName]="icon" />
                  }
                } @else if (slot.check) {
                  <ui-icon class="ui-gauge__check" uiName="checklist.done" />
                } @else if (slot.numeral; as numeral) {
                  <span class="ui-gauge__numeral">{{ numeral }}</span>
                }
              </span>
              @if (slot.caption; as caption) {
                <span class="ui-gauge__slot-caption">{{ caption }}</span>
              }
            </span>
          }
        </span>
      }
      @case ('circularCapacity') {
        <svg class="ui-gauge__ring" aria-hidden="true" focusable="false">
          <circle
            class="ui-gauge__ring-track"
            cx="50%"
            cy="50%"
            [attr.pathLength]="ringPathLength()"
          />
          <circle class="ui-gauge__ring-arc" cx="50%" cy="50%" />
        </svg>
        <span class="ui-gauge__current" aria-hidden="true">
          <ng-content select="[uiCurrentValueLabel]" />
        </span>
      }
      @case ('steps') {
        <span class="ui-gauge__steps" aria-hidden="true">
          @for (node of nodes(); track node.mark.value) {
            <span
              class="ui-gauge__step"
              [attr.data-state]="node.state"
              [style.--ui-gauge-link]="node.link"
            >
              <span
                class="ui-gauge__node"
                [attr.data-numeral]="node.numeral ? '' : null"
              >
                @if (node.check) {
                  <ui-icon class="ui-gauge__check" uiName="checklist.done" />
                }
                {{ node.numeral ?? '' }}</span
              >
              @if (node.mark.label; as label) {
                <span class="ui-gauge__step-label">{{ label }}</span>
              }
              @for (line of node.detail; track $index) {
                <span class="ui-gauge__step-detail">{{ line }}</span>
              }
            </span>
          }
        </span>
      }
      @default {
        <span class="ui-gauge__track" aria-hidden="true">
          <span class="ui-gauge__fill"></span>
          @for (notch of notches(); track $index) {
            <span
              class="ui-gauge__notch"
              [style.--ui-gauge-mark]="notch"
            ></span>
          }
        </span>
        @if (showsScale()) {
          <ui-mark-scale
            class="ui-gauge__scale"
            [uiMarks]="uiMarks()"
            [uiMin]="uiMin()"
            [uiMax]="uiMax()"
          />
        }
      }
    }
  `,
  styleUrl: './gauge.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: `.ui-gauge__*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-gauge',
    role: 'meter',
    '[attr.aria-label]': 'uiLabel()',
    '[attr.aria-valuetext]': 'uiValueText()',
    '[attr.aria-valuemin]': 'uiMin()',
    '[attr.aria-valuemax]': 'uiMax()',
    '[attr.aria-valuenow]': 'clamped()',
    '[attr.data-gauge-style]': 'effectiveStyle()',
    '[attr.data-control-size]': 'controlSize()',
    '[attr.data-complete]': "complete() ? '' : null",
    '[attr.data-empty]': "empty() ? '' : null",
    '[attr.data-direction]': 'direction()',
    '[attr.data-settled]': "settled() ? '' : null",
    '[style.--ui-gauge-value]': 'ratio()',
    '[style.--ui-gauge-slots]': 'positions()',
    '[style.--ui-gauge-columns]': 'columns()',
  },
})
export class UiGauge {
  readonly uiValue = input.required({ transform: numberAttribute });
  /** The house slider's names for the range's ends. */
  readonly uiMin = input(0, { transform: numberAttribute });
  readonly uiMax = input(1, { transform: numberAttribute });
  readonly uiGaugeStyle = input<UiGaugeStyle>('linearCapacity');
  readonly uiControlSize = input<UiGaugeControlSize>('regular');
  /** Thresholds (notches, words under the bar) · slot captions · the nodes of `steps`. */
  readonly uiMarks = input<readonly UiMark[]>([]);
  /** Slots per row on a card: 5 lays ten stamps out as 5 × 2. */
  readonly uiColumns = input<number | null>(null);
  /** The last slot is the reward, drawn with this glyph. */
  readonly uiRewardIcon = input<UiIconName | null>(null);
  /** The meter's accessible name. */
  readonly uiLabel = input.required<string>();
  /** The reading, in the owner's words. */
  readonly uiValueText = input.required<string>();

  /** Set once the first frame is on screen: nothing moves before it. */
  protected readonly settled = signal(false);

  protected readonly clamped = computed(() =>
    Math.min(this.uiMax(), Math.max(this.uiMin(), this.uiValue())),
  );

  protected readonly ratio = computed(() => {
    const span = this.uiMax() - this.uiMin();
    return span > 0 ? clamp01((this.uiValue() - this.uiMin()) / span) : 0;
  });

  protected readonly complete = computed(() => this.uiValue() >= this.uiMax());
  protected readonly empty = computed(() => this.uiValue() <= this.uiMin());

  /** Whole slots between the ends; a card has 1 … 12. */
  private readonly slotCount = computed(() =>
    Math.floor(this.uiMax() - this.uiMin()),
  );

  /** Too many (or no) slots for a card: the bar tells it instead. */
  private readonly overfull = computed(
    () =>
      this.uiGaugeStyle() === 'discreteCapacity' &&
      (this.slotCount() > MAX_SLOTS || this.slotCount() < 1),
  );

  protected readonly effectiveStyle = computed<UiGaugeStyle>(() =>
    this.overfull() ? 'linearCapacity' : this.uiGaugeStyle(),
  );

  /**
   * A size its style does not have. The ring draws `regular`, `large`,
   * `extraLarge`; the card `small`, `regular`, `large`; a bar and the steps
   * `small`, `regular`.
   */
  private readonly missized = computed(() => {
    const size = this.uiControlSize();
    switch (this.effectiveStyle()) {
      case 'circularCapacity':
        return size === 'small';
      case 'discreteCapacity':
        return size === 'extraLarge';
      default:
        return size === 'large' || size === 'extraLarge';
    }
  });

  /** The size drawn: the asked one, or the style's `regular` where it has no such rung. */
  protected readonly controlSize = computed<UiGaugeControlSize>(() =>
    this.missized() ? 'regular' : this.uiControlSize(),
  );

  /** The ring track's length in dash units, so a dashed ring closes on a whole dash. */
  protected readonly ringPathLength = computed(() => {
    const size = this.controlSize();
    return RING_DASHES[size === 'small' ? 'regular' : size] * RING_DASH_UNITS;
  });

  /** Positions on the gauge: a card's slots, a track's nodes. */
  protected readonly positions = computed(() => {
    switch (this.effectiveStyle()) {
      case 'discreteCapacity':
        return this.slotCount();
      case 'steps':
        return this.uiMarks().length;
      default:
        return null;
    }
  });

  protected readonly columns = computed(() => {
    const positions = this.positions();
    if (positions === null) return null;
    const columns = this.uiColumns();
    return columns !== null && columns > 0
      ? Math.min(columns, positions)
      : positions;
  });

  private readonly filledCount = computed(() =>
    Math.max(
      0,
      Math.min(this.slotCount(), Math.floor(this.uiValue() - this.uiMin())),
    ),
  );

  /** The stamps a live rise just added: `[from, to)`. */
  private readonly punchedRange = linkedSignal<
    number,
    readonly [number, number] | null
  >({
    source: this.filledCount,
    computation: (filled, previous) =>
      previous !== undefined && this.settled() && filled > previous.source
        ? [previous.source, filled]
        : null,
  });

  /** A live change's direction, for the motion that may follow it. */
  protected readonly direction = linkedSignal<number, GaugeDirection | null>({
    source: this.uiValue,
    computation: (value, previous) => {
      if (previous === undefined || !this.settled()) return null;
      if (value > previous.source) return 'up';
      if (previous.source >= this.uiMax() && value <= this.uiMin()) {
        return 'reset';
      }
      return null;
    },
  });

  protected readonly slots = computed<readonly GaugeSlot[]>(() => {
    // Read on every pass, so the range always knows the count before it.
    const punched = this.punchedRange();
    const count = this.slotCount();
    const filled = this.filledCount();
    const min = this.uiMin();
    const rewardLast = this.uiRewardIcon() !== null;
    const size = this.controlSize();
    const large = size === 'large';
    const captions = new Map<number, string>();
    for (const mark of this.uiMarks()) {
      const slot = mark.value - min;
      if (mark.label && Number.isInteger(slot) && slot >= 1 && slot <= count) {
        captions.set(slot - 1, mark.label);
      }
    }
    return Array.from({ length: count }, (_, index) => {
      const isFilled = index < filled;
      const reward = rewardLast && index === count - 1;
      return {
        index,
        filled: isFilled,
        reward,
        punched: punched !== null && index >= punched[0] && index < punched[1],
        caption: size === 'small' ? null : (captions.get(index) ?? null),
        // The large card's marks: a stamp is checked, an empty slot
        // numbered; the reward slot keeps its glyph in either state.
        check: large && !reward && isFilled,
        numeral: large && !reward && !isFilled ? String(index + 1) : null,
      };
    });
  });

  /** The reward's glyph fits a regular or a large slot; a small card rings the reward slot alone. */
  protected readonly showsRewardGlyph = computed(
    () => this.controlSize() !== 'small',
  );

  protected readonly nodes = computed<readonly GaugeNode[]>(() => {
    const value = this.uiValue();
    const regular = this.controlSize() === 'regular';
    const marks = [...this.uiMarks()].sort((a, b) => a.value - b.value);
    let current = -1;
    marks.forEach((mark, index) => {
      if (value >= mark.value) current = index;
    });
    return marks.map((mark, index) => {
      const previous = marks[index - 1];
      let link: number | null = null;
      if (previous !== undefined) {
        if (index <= current) link = 1;
        else if (index === current + 1 && mark.value > previous.value) {
          link = clamp01(
            (value - previous.value) / (mark.value - previous.value),
          );
        } else link = 0;
      }
      const state: GaugeNodeState =
        index < current
          ? 'reached'
          : index === current
            ? 'current'
            : index === current + 1
              ? 'next'
              : 'ahead';
      // A level passed draws the check on the solid tint (a mark, 3:1 as a
      // graphic): no word is ever set on the tint. Only the regular track
      // has the room; the small one's bare nodes are fill alone. A FINISHED
      // track crowns with it too (2026-09-28, wave D r5): when the current
      // node is the last — every level reached, or an ended scope cut to
      // what it reached — nothing is under way, so the crowning level is
      // drawn passed, the check on the solid tint inside its ring, never
      // the in-progress wash (the faintest filled node on a done ladder).
      const finished = state === 'current' && index === marks.length - 1;
      const check = regular && (state === 'reached' || finished);
      return {
        mark: regular ? mark : { value: mark.value, label: null },
        state,
        link,
        detail: regular ? (mark.detail ?? []).slice(0, 2) : [],
        check,
        numeral: regular && !check ? (mark.short ?? null) : null,
      };
    });
  });

  /** A notch for every mark strictly inside the bar (its ends need none). */
  protected readonly notches = computed(() => {
    const min = this.uiMin();
    const span = this.uiMax() - min;
    if (!(span > 0)) return [];
    return this.uiMarks()
      .filter((mark) => mark.value > min && mark.value < this.uiMax())
      .map((mark) => (mark.value - min) / span);
  });

  protected readonly showsScale = computed(
    () =>
      this.controlSize() === 'regular' &&
      this.uiMarks().some((mark) => !!mark.label),
  );

  constructor() {
    afterNextRender(() => this.settled.set(true));

    if (isDevMode()) {
      let warned = false;
      effect(() => {
        if (warned || !this.overfull()) return;
        warned = true;
        console.warn(
          `[ui-gauge] a discreteCapacity card holds 1 … ${MAX_SLOTS} whole slots ` +
            `(got ${this.slotCount()}); it draws a linearCapacity bar instead.`,
        );
      });

      let sized = false;
      effect(() => {
        if (sized || !this.missized()) return;
        sized = true;
        console.warn(
          `[ui-gauge] ${this.effectiveStyle()} has no "${this.uiControlSize()}" size ` +
            `(the ring draws regular, large, extraLarge; the card small, regular, large; ` +
            `a bar and the steps small, regular); it draws regular instead.`,
        );
      });
    }
  }
}
