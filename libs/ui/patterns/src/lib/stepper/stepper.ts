import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  computed,
  input,
  numberAttribute,
} from '@angular/core';

/** Per-segment state, stamped as `data-state` for the CSS contract. */
export type UiStepperSegmentState = 'done' | 'current' | 'upcoming';

/**
 * Journey stepper — a horizontal row of thin capsule segments marking a
 * short, fixed sequence of steps (the auth journey's identify → code →
 * profile). Completed and current segments fill with the accent; upcoming
 * segments stay on the hairline fill; the current segment carries a subtle
 * width emphasis so "where am I" reads at a glance.
 *
 * Not a loading indicator — determinate/indeterminate progress is
 * `ui-progress-view`. This is wayfinding chrome for multi-screen flows,
 * sized to ride inside a `ui-toolbar` or above a form column.
 *
 * `uiCurrent` is 1-based. The optional `uiLabel` renders as a caption above
 * the track ("Step 1 of 3") and doubles as the accessible name; without it
 * the name falls back to the locale-neutral "current / steps" figure, so
 * consumers should pass a translated label. `uiLabelsHidden`
 * (≙ SwiftUI `.labelsHidden()`) suppresses the VISIBLE caption while the
 * label keeps naming the progressbar — the quiet-chrome flows (auth journey,
 * owner ruling 2026-07-25) show segments only, per Apple's own Setup
 * Assistant (no step counter; the screen titles carry orientation).
 *
 * A11y: the host is a `role="progressbar"` over the step ordinals
 * (`aria-valuemin` 1 … `aria-valuemax` steps, `aria-valuenow` current);
 * the visual segments and caption are presentational.
 *
 * ```html
 * <ui-stepper
 *   [uiSteps]="3"
 *   [uiCurrent]="2"
 *   [uiLabel]="t('auth.steps.label', { current: 2, total: 3 })"
 * />
 * ```
 */
@Component({
  selector: 'ui-stepper',
  template: `
    @if (!uiLabelsHidden() && uiLabel(); as label) {
      <span class="ui-stepper__label" aria-hidden="true">{{ label }}</span>
    }
    <span class="ui-stepper__track" aria-hidden="true">
      @for (state of segments(); track $index) {
        <span class="ui-stepper__segment" [attr.data-state]="state"></span>
      }
    </span>
  `,
  styleUrl: './stepper.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-stepper',
    role: 'progressbar',
    'aria-valuemin': '1',
    '[attr.aria-valuemax]': 'uiSteps()',
    '[attr.aria-valuenow]': 'clampedCurrent()',
    '[attr.aria-label]': 'accessibleLabel()',
  },
})
export class UiStepper {
  /** Total number of steps in the journey. */
  readonly uiSteps = input.required<number, number | string>({
    transform: numberAttribute,
  });
  /** The active step, 1-based. Clamped into `1…uiSteps`. */
  readonly uiCurrent = input.required<number, number | string>({
    transform: numberAttribute,
  });
  /** Caption above the track ("Step 1 of 3") — also the accessible name. */
  readonly uiLabel = input<string | null>(null);
  /** ≙ `.labelsHidden()` — drops the visible caption (no residual gap: the
   *  track becomes the host's only child) while `uiLabel` still names the
   *  progressbar for assistive tech. */
  readonly uiLabelsHidden = input(false, { transform: booleanAttribute });

  protected readonly clampedCurrent = computed(() =>
    Math.min(Math.max(this.uiCurrent(), 1), Math.max(this.uiSteps(), 1)),
  );

  protected readonly segments = computed<readonly UiStepperSegmentState[]>(
    () => {
      const current = this.clampedCurrent();
      return Array.from({ length: Math.max(this.uiSteps(), 1) }, (_, index) =>
        index + 1 < current
          ? 'done'
          : index + 1 === current
            ? 'current'
            : 'upcoming',
      );
    },
  );

  protected readonly accessibleLabel = computed(
    () => this.uiLabel() ?? `${this.clampedCurrent()} / ${this.uiSteps()}`,
  );
}
