import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  afterNextRender,
  booleanAttribute,
  computed,
  effect,
  input,
  isDevMode,
  linkedSignal,
  numberAttribute,
  signal,
} from '@angular/core';
import { UiIcon, type UiIconName } from '@creativo/ui/icons';
import { UiVisuallyHiddenDirective } from '@creativo/ui/modifiers';
import { UiMetric } from '../metric/metric';

/**
 * What became of one period of the shop's rhythm. `kept` — they came;
 * `protected` — they could not, and it was not on them (the shop closed, a
 * freeze, a pause), so the run holds; `missed` — the run broke there;
 * `repaired` — a miss made good; `current` — the period still open.
 */
export type UiStreakMark =
  'kept' | 'protected' | 'missed' | 'repaired' | 'current';

export interface UiStreakPeriod {
  readonly id: string;
  readonly mark: UiStreakMark;
  /** «авг»; on `current` the date it is due by, «до 12.10» — a date, never a countdown. */
  readonly caption: string;
  /** The period in words for the hidden list, written by the owner for its audience. */
  readonly description: string;
}

/** ≙ `.controlSize`. A local union: patterns cannot import `UiControlSize`. */
export type UiStreakTrackControlSize = 'small' | 'regular';

/** More periods than this is a calendar, which a cadence of weeks is not. */
const MAX_PERIODS = 12;

type StreakLink = 'tint' | 'quiet' | 'dotted';

interface StreakCell {
  readonly period: UiStreakPeriod;
  /** How the connector INTO this period is drawn; `null` = none. */
  readonly link: StreakLink | null;
  /** The freeze glyph sits in the mark. */
  readonly glyph: boolean;
  /** Became kept by a live change after the first frame: its connector draws in. */
  readonly extended: boolean;
}

/**
 * THE STREAK TRACK — «Посещения в ритъм»: the count of periods kept in a
 * row, over the last few periods of the SHOP'S rhythm (not days: a cadence
 * runs two to six weeks). Kept periods join into one run; a protected one
 * shows the freeze glyph and holds the run; a miss is a dashed ring with
 * no connector either side, so the break reads by shape; the open period
 * is a hollow ring with its due DATE under it. Every state differs in
 * shape, never only in colour, and nothing is ever red.
 *
 * `uiCount` is printed with its unit — «24 посещения», because the marks
 * are periods and the figure counts visits — and `uiCountLabel` («в
 * ритъм») says what it counts. `uiCountWord` («Винаги») takes the
 * figure's place where the owner already prints that number beside the
 * track — a run unbroken since the first visit IS the visit count — so
 * the metric reads «Винаги / в ритъм» and the owner passes no unit. `uiFrozen` (a paused client) turns the
 * tint to the secondary ink and puts the freeze glyph in the open period:
 * frozen, never zeroed.
 *
 * A reader gets ONE sentence (`uiLabel`, `role="img"` on the drawing)
 * and then a visually hidden list with one item per period in the owner's
 * words — the list sits OUTSIDE the image, whose children are
 * presentational. The owner writes those words per audience: a client is
 * never told who was away, or why. The track is all spans — the list is
 * `span[role=list] > span[role=listitem]`, not `ul > li` — so it stays
 * valid phrasing content inside `button[uiCard]` (the glance tile, whose
 * own name then speaks for it: a button's children are presentational).
 *
 * THE COUNT IS A `ui-metric` AT EVERY SIZE (2026-09-28, wave D r5): its
 * `regular` rung, «24 посещения» at title3 over «в ритъм» at caption —
 * the figure recipe the page's other counts use (the LC balance, the
 * stamp card). The track never restates it: `regular` once built its own
 * one-line figure (title2 · callout · caption on one baseline), two
 * figure recipes in one component.
 *
 * `regular` — marks of 1.5rem, captions under them: the loyalty page.
 * `small` — marks of two dots, no captions: the glance tile, beside the
 * stamp card's metric, so the two half tiles are one part and share
 * their lines.
 */
@Component({
  selector: 'ui-streak-track',
  imports: [UiIcon, UiMetric, UiVisuallyHiddenDirective],
  template: `
    <span
      class="ui-streak-track__figure"
      role="img"
      [attr.aria-label]="uiLabel()"
    >
      <ui-metric
        uiControlSize="regular"
        [uiValue]="countText()"
        [uiUnit]="uiCountUnit()"
        [uiCaption]="uiCountLabel()"
      />
      <span class="ui-streak-track__periods">
        @for (cell of cells(); track cell.period.id) {
          <span
            class="ui-streak-track__period"
            [attr.data-mark]="cell.period.mark"
            [attr.data-connector]="cell.link"
            [attr.data-extended]="cell.extended ? '' : null"
          >
            <span class="ui-streak-track__mark">
              @if (cell.glyph) {
                <ui-icon
                  class="ui-streak-track__glyph"
                  [uiName]="uiProtectedIcon()"
                />
              }
            </span>
            @if (uiControlSize() === 'regular') {
              <span class="ui-streak-track__caption">{{
                cell.period.caption
              }}</span>
            }
          </span>
        }
      </span>
    </span>
    <span uiVisuallyHidden role="list" class="ui-streak-track__list">
      @for (cell of cells(); track cell.period.id) {
        <span role="listitem" class="ui-streak-track__item">{{
          cell.period.description
        }}</span>
      }
    </span>
  `,
  styleUrl: './streak-track.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: `.ui-streak-track__*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-streak-track',
    '[attr.data-control-size]': 'uiControlSize()',
    '[attr.data-frozen]': "uiFrozen() ? '' : null",
    '[attr.data-settled]': "settled() ? '' : null",
    // The periods drawn: the pitch the marks spread over (edge to edge).
    '[style.--ui-streak-periods]': 'cells().length',
  },
})
export class UiStreakTrack {
  /** Oldest → newest; the owner passes 6 on a phone, 8 wider, never more than 12. */
  readonly uiPeriods = input.required<readonly UiStreakPeriod[]>();
  readonly uiCount = input.required({ transform: numberAttribute });
  /** What the figure counts — «в ритъм». */
  readonly uiCountLabel = input.required<string>();
  /** The figure's unit — «посещения». */
  readonly uiCountUnit = input<string | null>(null);
  /** A word in the figure's place («Винаги»): the count is said elsewhere on the page. */
  readonly uiCountWord = input<string | null>(null);
  /** One sentence for the whole drawing («24 посещения в ритъм, най-много 26, следващото до 26 октомври»). */
  readonly uiLabel = input.required<string>();
  /** The glyph of a protected period (and of the open one, frozen). */
  readonly uiProtectedIcon = input.required<UiIconName>();
  /** A paused client: the run is held, not lost. */
  readonly uiFrozen = input(false, { transform: booleanAttribute });
  readonly uiControlSize = input<UiStreakTrackControlSize>('regular');

  /** Set once the first frame is on screen: nothing moves before it. */
  protected readonly settled = signal(false);

  /** The count as printed — the metric takes its value as text. */
  protected readonly countText = computed(
    () => this.uiCountWord() ?? String(this.uiCount()),
  );

  /** The newest twelve at most. */
  private readonly periods = computed(() =>
    this.uiPeriods().slice(-MAX_PERIODS),
  );

  /** The ids that turned from open to kept by a live change. */
  private readonly extendedIds = linkedSignal<
    readonly UiStreakPeriod[],
    ReadonlySet<string>
  >({
    source: this.periods,
    computation: (periods, previous) => {
      if (previous === undefined || !this.settled()) return new Set();
      const before = new Map(
        previous.source.map((period) => [period.id, period.mark]),
      );
      return new Set(
        periods
          .filter(
            (period) =>
              before.get(period.id) === 'current' &&
              (period.mark === 'kept' || period.mark === 'repaired'),
          )
          .map((period) => period.id),
      );
    },
  });

  protected readonly cells = computed<readonly StreakCell[]>(() => {
    const extended = this.extendedIds();
    const frozen = this.uiFrozen();
    const periods = this.periods();
    return periods.map((period, index) => ({
      period,
      link: linkOf(periods[index - 1], period),
      glyph:
        period.mark === 'protected' || (frozen && period.mark === 'current'),
      extended: extended.has(period.id),
    }));
  });

  constructor() {
    afterNextRender(() => this.settled.set(true));

    if (isDevMode()) {
      let warned = false;
      effect(() => {
        const count = this.uiPeriods().length;
        if (warned || count <= MAX_PERIODS) return;
        warned = true;
        console.warn(
          `[ui-streak-track] ${count} periods is a calendar; the track draws ` +
            `the newest ${MAX_PERIODS}.`,
        );
      });
    }
  }
}

/**
 * The connector between two neighbours: none across a miss (the break
 * reads by shape), dotted into the open period, quiet through a protected
 * one, the tint along a kept run.
 */
function linkOf(
  previous: UiStreakPeriod | undefined,
  period: UiStreakPeriod,
): StreakLink | null {
  if (previous === undefined) return null;
  if (previous.mark === 'missed' || period.mark === 'missed') return null;
  if (period.mark === 'current') return 'dotted';
  if (previous.mark === 'protected' || period.mark === 'protected') {
    return 'quiet';
  }
  return 'tint';
}
