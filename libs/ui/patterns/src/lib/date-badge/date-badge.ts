import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

export type UiDateBadgeState = 'plain' | 'today' | 'selected' | 'outside';

/**
 * Custom element — a single calendar day number, with a state ring
 * (today/selected/outside-month) and an optional marker dot (e.g. "has an
 * appointment"). Purely presentational and non-interactive; a consumer
 * that needs tap behavior wraps it in its own native `<button>`.
 */
@Component({
  selector: 'ui-date-badge',
  template: `
    <span class="ui-date-badge__day">{{ uiDay() }}</span>
    @if (uiMarker()) {
      <span class="ui-date-badge__marker" aria-hidden="true"></span>
    }
  `,
  styleUrl: './date-badge.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-date-badge',
    '[attr.data-state]': 'uiState()',
  },
})
export class UiDateBadge {
  readonly uiDay = input.required<number>();
  readonly uiState = input<UiDateBadgeState>('plain');
  readonly uiMarker = input(false);
}
