import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

export type UiDateBadgeState =
  'plain' | 'today' | 'selected' | 'outside' | 'unavailable';

/**
 * Custom element — a single calendar day number, with a state ring
 * (today/selected/outside-month/unavailable) and an optional marker dot
 * (e.g. "has an appointment"). Purely presentational and non-interactive; a
 * consumer that needs tap behavior wraps it in its own native `<button>`.
 *
 * `unavailable` is the booking grid's "nothing free that day": the number
 * stays legible (a struck-through or invisible date is worse than a quiet
 * one) but reads as untappable. The consumer still has to `disabled` its own
 * button — this state describes the day, it does not gate the tap.
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
