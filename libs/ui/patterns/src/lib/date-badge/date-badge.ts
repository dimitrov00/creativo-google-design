import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
} from '@angular/core';

/**
 * What is true about a day's AVAILABILITY and selection. Deliberately no
 * `today` arm — see {@link UiDateBadge.uiToday}.
 */
export type UiDateBadgeState = 'plain' | 'selected' | 'outside' | 'unavailable';

/**
 * Custom element — a single calendar day number, with a selection/availability
 * treatment and an optional dot beneath it. Purely presentational and
 * non-interactive; a consumer that needs tap behavior wraps it in its own
 * native `<button>`.
 *
 * ### Why `today` is not a state
 * It used to be, and both consumers wrote the same ternary — *selected, else
 * today, else plain* — which silently DROPPED today-ness the moment the day
 * was selected. The two facts are orthogonal: today can be selected,
 * unavailable, or outside the shown month, and a badge that can only say one
 * of them at a time forces the caller to choose which truth to tell. So
 * selection/availability is the state and {@link uiToday} is its own flag.
 *
 * ### The dot
 * Today reads as *the number, with an accent dot beneath it* — the iOS
 * Calendar treatment, and quieter than the ring it replaces, which competed
 * with the selected day's filled capsule for the same visual weight. Selecting
 * the day flips the dot to the on-accent ink so it stays legible on the filled
 * capsule instead of vanishing into it.
 *
 * `uiMarker` is the consumer's own "there is something on this day" dot (the
 * appointments calendar's booked days). There is ONE dot slot: a day that is
 * both today and marked shows a single accent dot rather than two, because two
 * 4px dots under a number is noise, and "noteworthy" is what either of them
 * actually communicates at that size.
 *
 * `unavailable` is the booking grid's "nothing free that day": the number
 * stays legible (a struck-through or invisible date is worse than a quiet
 * one) but reads as untappable. The consumer still has to `disabled` its own
 * button — this state describes the day, it does not gate the tap.
 *
 * ### Size
 * Driven by `--ui-date-badge-size`, which `ui-calendar-grid` sets for every
 * badge inside it (see its `uiSize`) — set once on the grid rather than passed
 * to forty-two badges.
 */
@Component({
  selector: 'ui-date-badge',
  template: `
    <span class="ui-date-badge__day">{{ uiDay() }}</span>
    @if (showsDot()) {
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
    '[attr.data-today]': 'uiToday() ? "" : null',
  },
})
export class UiDateBadge {
  readonly uiDay = input.required<number>();
  readonly uiState = input<UiDateBadgeState>('plain');

  /**
   * This day is today — orthogonal to {@link uiState}, so a selected today
   * still says so. Renders the accent dot.
   */
  readonly uiToday = input(false);

  /** The consumer's own "something happens here" dot. */
  readonly uiMarker = input(false);

  protected readonly showsDot = computed(
    () => this.uiToday() || this.uiMarker(),
  );
}
