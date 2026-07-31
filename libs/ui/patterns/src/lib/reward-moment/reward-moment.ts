import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  numberAttribute,
} from '@angular/core';
import { UiConfetti } from '../confetti/confetti';

/**
 * The success mark — an accent disc that settles in, a check that draws
 * itself, and one confetti burst from behind the disc.
 *
 * ≙ the completion moment at the end of a SwiftUI flow: a big symbol, a beat
 * of motion, then the two things the person needs next. Promoted out of
 * `client/onboarding` when `/book`'s confirmation became the second surface
 * that needed it — two copies of an 80-line animation recipe is exactly how
 * the six hand-rolled eyebrows in the UI/UX case study happened.
 *
 * The confetti rides a WRAPPER around the badge, not the badge itself: an
 * isolated stacking context lets the overlay sit at `z-index: -1`, so
 * particles erupt from the disc's centre but fly out from BEHIND it — never
 * across the check.
 *
 * Under `prefers-reduced-motion` there are no particles (`ui-confetti` spawns
 * none), no scale and no stroke draw: one opacity-led settle on the finished
 * mark is the whole moment.
 *
 * ```html
 * <ui-reward-moment />
 * <h1 uiText uiFont="largeTitle">You're in</h1>
 * ```
 */
@Component({
  selector: 'ui-reward-moment',
  imports: [UiConfetti],
  template: `
    <span class="ui-reward-moment__burst">
      <ui-confetti
        [uiCount]="uiConfettiCount()"
        [uiDelay]="uiConfettiDelay()"
      />
      <span class="ui-reward-moment__badge">
        <svg
          class="ui-reward-moment__mark"
          viewBox="0 0 48 48"
          aria-hidden="true"
        >
          <!-- pathLength-normalized so the stroke draw animates 1 → 0. -->
          <path
            class="ui-reward-moment__check"
            d="M15 24.5l6.2 6.2L33 18"
            pathLength="1"
            fill="none"
            stroke-width="3.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </span>
  `,
  styleUrl: './reward-moment.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: { class: 'ui-reward-moment' },
})
export class UiRewardMoment {
  readonly uiConfettiCount = input(160, { transform: numberAttribute });
  /** Milliseconds after mount. The default lands the burst as the check finishes. */
  readonly uiConfettiDelay = input(650, { transform: numberAttribute });
}
