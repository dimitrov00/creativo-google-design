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
 * ### The dot means EVENTS, and only events
 * `uiMarker` is the consumer's "there is something on this day" dot — the
 * appointments calendar's booked days — and it is the dot's only meaning.
 * `currentColor` is the trick that keeps it legible: on a filled day the
 * badge's ink is already the on-fill colour, so the dot flips with it rather
 * than vanishing into the disc beneath.
 *
 * ⚠ It used to ALSO mark today (`uiToday || uiMarker`), on the stated grounds
 * that a dot beneath the number was "the iOS Calendar treatment" for today.
 * It is not — iOS draws today in red TEXT and reserves the dot for events —
 * and the borrowing cost this system the ability to say the other thing: a
 * booked day and today drew the same dot, and a booked today drew one dot
 * that meant either. {@link uiToday} is ink now; the dot is events again.
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
   * still says so. Renders as the ACCENT-COLOURED number, and as an
   * accent-FILLED disc once the day is also selected.
   */
  readonly uiToday = input(false);

  /** The consumer's own "something happens here" dot. */
  readonly uiMarker = input(false);

  protected readonly showsDot = computed(() => this.uiMarker());
}
