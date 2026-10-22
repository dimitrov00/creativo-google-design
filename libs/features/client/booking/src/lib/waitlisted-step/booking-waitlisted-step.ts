import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { DayWindows } from '@core/components';
import { CatalogPresenter } from '@creativo/features/shared/catalog';
import { UiButton, UiIcon } from '@creativo/ui/controls';
import { UiSpacer, UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiRevealDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiPageActionBar,
  UiStatusIndicator,
} from '@creativo/ui/patterns';
import { BookingFlowStore } from '../booking-flow.store';
import { formatBookingDay } from '../booking-wall-clock';

interface WatchedDayVm {
  readonly key: string;
  readonly dateLabel: string;
  readonly windowsLabel: string;
}

/**
 * The OTHER terminal step — nothing fitted, so we are watching instead.
 *
 * ### Deliberately not a celebration
 * The confirmed step draws a check and fires confetti once, because a booking
 * is a small commitment that got a yes. This is not that. The design record is
 * explicit — no confetti on the waitlist terminal, because celebrating a
 * non-booking is dishonest and the confetti has to stay rare enough to mean
 * something. What this screen does instead is state the promise precisely:
 * which days, which hours, and what will happen.
 *
 * ### It says out loud that nothing is held
 * The single most important line here. A waitlist notification is an
 * invitation to race for a slot, not a reservation, and a screen that let
 * someone believe otherwise would be setting up the worst possible surprise —
 * arriving for an appointment that never existed.
 *
 * ### The draft is gone by the time this renders
 * `persist()` clears storage on both terminal states, so a reload cannot
 * resurrect a wizard for a request the server already accepted.
 */
@Component({
  selector: 'lib-booking-waitlisted-step',
  imports: [
    RouterLink,
    TranslocoDirective,
    UiButton,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiPageActionBar,
    UiRevealDirective,
    UiSpacer,
    UiStack,
    UiStatusIndicator,
    UiTextDirective,
  ],
  templateUrl: './booking-waitlisted-step.html',
  styleUrl: './booking-waitlisted-step.css',
  host: { 'data-testid': 'booking-waitlisted-step' },
})
export class BookingWaitlistedStep {
  protected readonly content = inject(CatalogPresenter);
  protected readonly store = inject(BookingFlowStore);

  protected readonly days = computed<readonly WatchedDayVm[]>(() =>
    this.store.when().flexibleDays.map((dayWindows) => ({
      key: dayWindows.localDate,
      // The shop day as it is — a wall-clock reading needs no zone.
      dateLabel: formatBookingDay(dayWindows.localDate, this.content.locale()),
      windowsLabel: DayWindows.isWholeDay(dayWindows)
        ? ''
        : dayWindows.windows
            .map(
              (window) =>
                `${clockFace(window.startMinutes)} – ${clockFace(window.endMinutes)}`,
            )
            .join(' · '),
    })),
  );
}

/** «09:30» — a minute of the shop day, as the watched windows have always read. */
function clockFace(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
}
