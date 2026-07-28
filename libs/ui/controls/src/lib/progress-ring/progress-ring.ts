import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  numberAttribute,
} from '@angular/core';

/**
 * Determinate circular progress — the Apple gauge/activity-ring language
 * for "how much of a whole is done" (profile completion, loyalty progress,
 * storage…). A quiet track circle with an accent arc that DRAWS ITSELF to
 * the bound value on mount (stroke-dashoffset keyframe from empty; value
 * CHANGES then glide on a transition), rounded caps, starting at 12
 * o'clock. Center content is projected — a "2/3" caption, a check glyph, a
 * percentage — the ring imposes no typography of its own.
 *
 * Sizing rides the consumer's uiFrame (the SVG fills the host); stroke
 * scales with the viewBox so every size keeps the same ring weight.
 *
 * ```html
 * <ui-progress-ring [uiValue]="2 / 3" uiFrame uiFrameWidth="4rem">
 *   <span uiText uiFont="footnote" uiWeight="semibold">2/3</span>
 * </ui-progress-ring>
 * ```
 */
@Component({
  selector: 'ui-progress-ring',
  template: `
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle
        class="ui-progress-ring__track"
        cx="24"
        cy="24"
        r="21"
        pathLength="1"
      />
      <circle
        class="ui-progress-ring__value"
        cx="24"
        cy="24"
        r="21"
        pathLength="1"
      />
    </svg>
    <span class="ui-progress-ring__label">
      <ng-content />
    </span>
  `,
  styleUrl: './progress-ring.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-progress-ring',
    role: 'img',
    '[style.--ui-progress-ring-value]': 'clamped()',
    '[attr.data-complete]': "clamped() >= 1 ? '' : null",
    '[attr.data-empty]': "clamped() === 0 ? '' : null",
  },
})
export class UiProgressRing {
  /** Fraction complete, 0…1 (clamped). */
  readonly uiValue = input.required({ transform: numberAttribute });

  protected readonly clamped = computed(() => {
    const value = this.uiValue();
    if (Number.isNaN(value)) return 0;
    return Math.min(1, Math.max(0, value));
  });
}
