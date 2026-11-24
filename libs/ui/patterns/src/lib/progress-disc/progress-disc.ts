import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

/**
 * Where the disc's errand stands. `idle`: the symbol on its wash, nothing in
 * flight. `busy`: an accent ring turns round the disc while the work is out
 * (a code being sent, a code being checked). `acknowledged`: a small check
 * badge on the disc's shoulder — the step landed (the code is in the inbox),
 * the person's turn now. `complete`: the disc fills accent and a check draws
 * itself where the symbol was.
 */
export type UiProgressDiscPhase = 'idle' | 'busy' | 'acknowledged' | 'complete';

/**
 * 64 · 88: the hero symbol over a step's headline, and the celebration
 * mark of `ui-reward-moment`. A local union: patterns cannot import
 * `UiControlSize`.
 */
export type UiProgressDiscSize = 'regular' | 'large';

/**
 * THE PROGRESS DISC — one symbol on an accent wash that tells an errand's
 * whole story without a line of copy: a ring turns round it while the work
 * is in flight, a badge says it landed, and the disc fills with a drawn
 * check when it is done. ≙ the Apple Pay sheet's processing → done mark, a
 * SwiftUI `Image(systemName:)` in a tinted `Circle` with a
 * `ProgressView` ring and a `.symbolEffect(.replace)` to a checkmark.
 *
 * Lifted out of `ui-reward-moment` (2026-11-23, the sign-in code step's
 * direction B): the disc and its drawn check were the reward moment's own;
 * the code step needed the same mark BEFORE the success — sending, sent,
 * checking — so the disc moved here and the reward moment composes it in
 * its `complete` phase, inside its confetti burst. One disc, one check
 * stroke, one entrance.
 *
 * The symbol is projected (`<ui-icon uiName="auth.email" />`) and inherits
 * the disc's size and accent ink. The disc is decorative (`aria-hidden`):
 * the words beside it — the step's headline — say the same thing, and a
 * live region of the owner's announces a change.
 *
 * The ring sits OUTSIDE the disc's box (the host is the disc), so a phase
 * change never moves the layout; leave a `regular`-or-wider gap around it.
 * The badge's cut-out ring is the page ground (`--ui-progress-disc-cutout`,
 * the background by default) — set it on a card.
 *
 * ```html
 * <ui-progress-disc [uiPhase]="phase()"><ui-icon uiName="auth.email" /></ui-progress-disc>
 * ```
 */
@Component({
  selector: 'ui-progress-disc',
  template: `
    <svg
      class="ui-progress-disc__ring"
      viewBox="0 0 100 100"
      data-motion-essential
    >
      <circle cx="50" cy="50" r="47" pathLength="100" />
    </svg>
    <span class="ui-progress-disc__face">
      <span class="ui-progress-disc__glyph"><ng-content /></span>
      <svg class="ui-progress-disc__mark" viewBox="0 0 48 48">
        <!-- pathLength-normalized so the stroke draw animates 1 → 0. -->
        <path
          class="ui-progress-disc__check"
          d="M15 24.5l6.2 6.2L33 18"
          pathLength="1"
          fill="none"
          stroke-width="3.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
    <span class="ui-progress-disc__badge">
      <svg viewBox="0 0 24 24">
        <path
          d="M7 12.5l3.2 3.2L17 9"
          fill="none"
          stroke-width="2.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  `,
  styleUrl: './progress-disc.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-progress-disc',
    'aria-hidden': 'true',
    '[attr.data-phase]': 'uiPhase()',
    '[attr.data-control-size]': 'uiControlSize()',
  },
})
export class UiProgressDisc {
  readonly uiPhase = input<UiProgressDiscPhase>('idle');
  readonly uiControlSize = input<UiProgressDiscSize>('regular');
}
