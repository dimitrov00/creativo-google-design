import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
} from '@angular/core';

/** A word under a point of the range — «0%», «100%», «14,50 €». */
export interface UiSliderMark {
  readonly value: number;
  readonly label: string;
}

/**
 * THE SLIDER — SwiftUI parity: `Slider(value:in:step:)`.
 *
 * A value picked from a bounded range by dragging, on a RULER: tick marks
 * every `uiTickEvery` across the range, the taller ones every
 * `uiMajorEvery`, the ticks up to the value lit in the tint and the rest
 * quiet (Rocket Money's savings ruler, Google Photos' edit sliders, Acorns'
 * portfolio percent), a round thumb where the value is, and words under
 * the points that matter (`uiMarks`). Without ticks it is the plain rail
 * every platform draws. Snapping is `uiStep`'s: the native range control
 * underneath does it, and gives the free semantics — the slider role, the
 * arrow keys, VoiceOver's adjustable — so nothing is hand-rolled but the
 * drawing. The native control is laid over the track, invisible, its own
 * thumb the size of the drawn one so a finger lands where the eye looks.
 *
 * `uiValue` is the owner's number; `uiValueChange` reports every move,
 * live, so a readout above can follow the finger. `uiValueText` is what a
 * screen reader says for the value («−15% · −2,63 €»), the owner's words.
 * The tint is `--ui-slider-tint` (the accent unless the owner says), and
 * the control owns no space around itself but the marks' own line.
 */
@Component({
  selector: 'ui-slider',
  template: `
    <span class="ui-slider__track" aria-hidden="true">
      @if (ticks().length > 0) {
        <span class="ui-slider__ticks">
          @for (tick of ticks(); track tick.value) {
            <span
              class="ui-slider__tick"
              [attr.data-major]="tick.major ? '' : null"
            ></span>
          }
        </span>
        <span class="ui-slider__ticks ui-slider__ticks--lit">
          @for (tick of ticks(); track tick.value) {
            <span
              class="ui-slider__tick"
              [attr.data-major]="tick.major ? '' : null"
            ></span>
          }
        </span>
      } @else {
        <span class="ui-slider__rail"></span>
        <span class="ui-slider__rail ui-slider__rail--lit"></span>
      }
      <span class="ui-slider__thumb"></span>
    </span>
    <input
      #native
      type="range"
      class="ui-slider__native"
      [min]="uiMin()"
      [max]="uiMax()"
      [step]="uiStep()"
      [value]="uiValue()"
      [disabled]="uiDisabled()"
      [attr.id]="uiId()"
      [attr.aria-label]="uiLabel()"
      [attr.aria-valuetext]="uiValueText()"
      [attr.data-testid]="uiTestId()"
      (input)="uiValueChange.emit(native.valueAsNumber)"
    />
    @if (uiMarks().length > 0) {
      <span class="ui-slider__marks" aria-hidden="true">
        @for (mark of uiMarks(); track mark.value) {
          <span
            class="ui-slider__mark"
            [style.--ui-slider-mark]="ratio(mark.value)"
            >{{ mark.label }}</span
          >
        }
      </span>
    }
  `,
  styleUrl: './slider.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, like every DS control: `.ui-*` is the styling contract.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-slider',
    '[style.--ui-slider-fill]': 'fill()',
    '[attr.data-disabled]': "uiDisabled() ? '' : null",
  },
})
export class UiSlider {
  /** Where the thumb is. */
  readonly uiValue = input.required<number>();
  readonly uiMin = input(0);
  readonly uiMax = input(100);
  /** What one move snaps to. */
  readonly uiStep = input(1);
  /** A tick every so much of the range; none draws the plain rail. */
  readonly uiTickEvery = input<number | null>(null);
  /** The taller ticks, every so much. */
  readonly uiMajorEvery = input<number | null>(null);
  /** Words under the points that matter. */
  readonly uiMarks = input<readonly UiSliderMark[]>([]);
  /** The accessible name. */
  readonly uiLabel = input<string | null>(null);
  /** What a reader hears for the value, in the owner's words. */
  readonly uiValueText = input<string | null>(null);
  readonly uiId = input<string | null>(null);
  readonly uiTestId = input<string | null>(null);
  readonly uiDisabled = input(false);
  /** Every move, live. */
  readonly uiValueChange = output<number>();

  /** How far along the range the thumb is, 0 to 1. */
  protected readonly fill = computed(() => this.ratio(this.uiValue()));

  protected readonly ticks = computed<
    readonly { readonly value: number; readonly major: boolean }[]
  >(() => {
    const every = this.uiTickEvery();
    const min = this.uiMin();
    const max = this.uiMax();
    if (every === null || every <= 0 || max <= min) return [];
    const major = this.uiMajorEvery();
    const out: { value: number; major: boolean }[] = [];
    const count = Math.floor((max - min) / every + 1e-9);
    for (let i = 0; i <= count; i += 1) {
      const value = min + i * every;
      out.push({
        value,
        major:
          major !== null &&
          major > 0 &&
          Math.abs((value - min) / major - Math.round((value - min) / major)) <
            1e-9,
      });
    }
    return out;
  });

  protected ratio(value: number): number {
    const span = this.uiMax() - this.uiMin();
    if (span <= 0) return 0;
    return Math.min(1, Math.max(0, (value - this.uiMin()) / span));
  }
}
