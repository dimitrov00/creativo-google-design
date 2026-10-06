import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
} from '@angular/core';

/**
 * A point on a scale that matters: a threshold, a tier, a level. ONE mark
 * grammar for every drawn range in the system — the slider's named points,
 * a gauge's notches and captions, the nodes of a `steps` track — so a
 * feature that learns it once can hand the same array to any of them.
 *
 * `label` is the word under the point; `null` is a notch without words (a
 * gauge cuts the track there and says nothing). `short` is what fits INSIDE
 * a `steps` node («I», «II»). `detail` is at most two caption lines under
 * the label: a date reached («3.06»), what a level paid («+50 т.»), what is
 * left («още 6»).
 */
export interface UiMark {
  readonly value: number;
  readonly label: string | null;
  readonly short?: string | null;
  readonly detail?: readonly string[];
}

/** A labelled mark, where it sits on the range (0 … 1), and which edge its words hug. */
interface PlacedMark {
  readonly mark: UiMark;
  readonly ratio: number;
  readonly align: 'start' | 'center' | 'end';
}

/**
 * The labelled marks a scale can show without two words colliding, in
 * value order: a mark outside the range, or without a label, is not a
 * word on this scale; a label closer than `minGap` (a share of the range)
 * to the previous one SHOWN is dropped, so a crowded catalogue keeps its
 * first word and loses the one that would overprint it. Pure — the
 * component and its owners call the same rule (a dropped word stays in the
 * owner's `aria-valuetext`, never only on screen).
 */
export function visibleMarks(
  marks: readonly UiMark[],
  min: number,
  max: number,
  minGap: number,
): readonly UiMark[] {
  const span = max - min;
  if (!(span > 0)) return [];
  const labelled = marks
    .filter(
      (mark) =>
        mark.label !== null &&
        mark.label.length > 0 &&
        mark.value >= min &&
        mark.value <= max,
    )
    .slice()
    .sort((a, b) => a.value - b.value);
  const shown: UiMark[] = [];
  let last: number | null = null;
  for (const mark of labelled) {
    const ratio = (mark.value - min) / span;
    if (last !== null && ratio - last < minGap) continue;
    shown.push(mark);
    last = ratio;
  }
  return shown;
}

/**
 * THE MARK SCALE — the words under a drawn range, each under its point.
 *
 * Placement is CSS only: every label sits at its ratio `r` along the scale
 * and shifts back by `r` of its OWN width, so the first word starts where
 * the range starts, the last ends where it ends and a middle one centres on
 * its point — no label ever hangs past the track it names (the slider's
 * end labels used to, by half a word). The words stack in one grid cell,
 * so the scale is as tall as its tallest label and nobody measures text.
 *
 * `--ui-mark-scale-inset` lets an owner pull both ends in — the slider
 * keeps its thumb's half-width, so a point's word sits under the thumb's
 * centre at that value. The scale is decoration to a reader (`aria-hidden`):
 * the meter or slider that owns it says the value in words.
 */
@Component({
  selector: 'ui-mark-scale',
  template: `
    @for (placed of placed(); track placed.mark.value) {
      <span
        class="ui-mark-scale__mark"
        [attr.data-align]="placed.align"
        [style.--ui-mark-scale-ratio]="placed.ratio"
      >
        <span class="ui-mark-scale__label">{{ placed.mark.label }}</span>
        @for (line of detailOf(placed.mark); track $index) {
          <span class="ui-mark-scale__detail">{{ line }}</span>
        }
      </span>
    }
  `,
  styleUrl: './mark-scale.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: `.ui-mark-scale__*` is the styling
  // contract, and owners (the slider, the gauge) place the host by class.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-mark-scale',
    'aria-hidden': 'true',
  },
})
export class UiMarkScale {
  readonly uiMarks = input.required<readonly UiMark[]>();
  readonly uiMin = input(0);
  readonly uiMax = input(1);
  /** A label closer than this (as a share of the range) to the previous shown one is dropped. */
  readonly uiMinGap = input(0.12);

  protected readonly placed = computed<readonly PlacedMark[]>(() => {
    const min = this.uiMin();
    const max = this.uiMax();
    const span = max - min;
    return visibleMarks(this.uiMarks(), min, max, this.uiMinGap()).map(
      (mark) => {
        const ratio = (mark.value - min) / span;
        return {
          mark,
          ratio,
          align: ratio <= 0 ? 'start' : ratio >= 1 ? 'end' : 'center',
        };
      },
    );
  });

  /** At most two caption lines under a label. */
  protected detailOf(mark: UiMark): readonly string[] {
    return (mark.detail ?? []).slice(0, 2);
  }
}
