import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { Party } from '@core/components';
import type { BarberId, CartLineId, SeatKeyText } from '@core/primitives';
import {
  CatalogContentService,
  CatalogWording,
} from '@creativo/features/shared/catalog';
import { UiButton } from '@creativo/ui/controls';
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
  UiRewardMoment,
} from '@creativo/ui/patterns';
import { SessionIdentityService } from '@creativo/features/shared/shell';
import { BookingFlowStore } from '../booking-flow.store';
import {
  barberNameOf,
  bookerLabelOf,
  personLabelOf,
} from '../booking-people.words';
import { formatBookingDay, formatBookingTime } from '../booking-wall-clock';

interface ConfirmedLineVm {
  readonly key: string;
  readonly personLabel: string;
  readonly barberName: string;
  readonly timeLabel: string;
}

/**
 * The terminal step — it worked.
 *
 * ### Why this gets a moment
 * A booking is a small commitment a person made, and the shop's answer is
 * "yes, we've got you". Confirmation screens that read like a receipt waste
 * that. The check draws, the confetti fires once, and then the screen settles
 * into the two things the user actually needs next: what was booked, and the
 * way out.
 *
 * ### The draft is gone by the time this renders
 * `persist()` clears storage on the `confirmed` state, so a reload cannot
 * resurrect a wizard for an appointment that already exists. What is on screen
 * comes from the confirmation the machine carried across — including the
 * server's `appointmentId`, which is the only part the client did not know.
 */
@Component({
  selector: 'lib-booking-confirmed-step',
  imports: [
    RouterLink,
    TranslocoDirective,
    UiButton,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiListGroup,
    UiListRow,
    UiPageActionBar,
    UiRevealDirective,
    UiRewardMoment,
    UiSpacer,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './booking-confirmed-step.html',
  styleUrl: './booking-confirmed-step.css',
  host: { 'data-testid': 'booking-confirmed-step' },
})
export class BookingConfirmedStep {
  private readonly transloco = inject(TranslocoService);
  private readonly identity = inject(SessionIdentityService);

  protected readonly catalog = inject(CatalogContentService);
  protected readonly content = inject(CatalogWording);
  protected readonly store = inject(BookingFlowStore);

  /** "Monday, 3 August · 09:00" — the one line a person will re-read. */
  protected readonly whenLabel = computed(() => {
    const confirmation = this.store.confirmation();
    if (!confirmation) return '';
    const { localDate, startMinutes } = confirmation.selection;
    const locale = this.content.locale();
    return `${formatBookingDay(localDate, locale)} · ${formatBookingTime(
      localDate,
      startMinutes,
      locale,
    )}`;
  });

  protected readonly locationName = computed(() => {
    const confirmation = this.store.confirmation();
    if (!confirmation) return '';
    const shop = this.catalog
      .locations()
      .find((candidate) => candidate.id === confirmation.selection.locationId);
    return shop
      ? this.content.text({ en: shop.name.en, bg: shop.name.bg })
      : confirmation.selection.locationId;
  });

  /** Who is with whom, and when — only for a party; one person is the line above. */
  protected readonly lines = computed<readonly ConfirmedLineVm[]>(() => {
    const confirmation = this.store.confirmation();
    if (!confirmation || Party.guests(confirmation.party).length === 0) {
      return [];
    }

    const seatByLineId = new Map<CartLineId, SeatKeyText>();
    for (const seat of confirmation.cart.cartSeats) {
      for (const line of seat.lines) {
        seatByLineId.set(line.lineId, seat.seatKey);
      }
    }

    const { localDate } = confirmation.selection;
    const locale = this.content.locale();
    // The party the server accepted — the confirmation's own, not the flow's.
    const guests = Party.guests(confirmation.party);
    const booker = bookerLabelOf(
      this.identity.displayName(),
      this.transloco.translate('booking.party.you'),
    );
    return confirmation.selection.assignments.map((assignment) => {
      const seatKey = seatByLineId.get(assignment.lineId);
      return {
        key: assignment.lineId,
        // A line the cart no longer holds names nobody.
        personLabel:
          seatKey === undefined ? '' : personLabelOf(seatKey, guests, booker),
        barberName: this.barberName(assignment.barberId),
        timeLabel: formatBookingTime(
          localDate,
          assignment.startMinutes,
          locale,
        ),
      };
    });
  });

  /** A barber as the steps name them (`barberNameOf`, the one copy). */
  private barberName(barberId: BarberId): string {
    return barberNameOf(this.catalog.barbers(), barberId, (name) =>
      this.content.text(name),
    );
  }
}
