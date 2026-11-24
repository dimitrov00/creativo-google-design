import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  numberAttribute,
} from '@angular/core';
import { UiConfetti } from '../confetti/confetti';
import { UiProgressDisc } from '../progress-disc/progress-disc';

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
 * The disc and its drawn check are `ui-progress-disc`'s, in its `complete`
 * phase at the `large` size (lifted out of here 2026-11-23, when the sign-in
 * code step needed the same mark before the success as well). This
 * component adds the burst.
 *
 * The confetti rides a WRAPPER around the disc, not the disc itself: an
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
  imports: [UiConfetti, UiProgressDisc],
  template: `
    <span class="ui-reward-moment__burst">
      <ui-confetti
        [uiCount]="uiConfettiCount()"
        [uiDelay]="uiConfettiDelay()"
      />
      <ui-progress-disc uiPhase="complete" uiControlSize="large" />
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
