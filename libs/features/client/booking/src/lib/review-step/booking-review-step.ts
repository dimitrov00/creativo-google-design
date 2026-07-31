import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { Money, formatMoney } from '@creativo/application/booking';
import { BarberId } from '@creativo/application/catalog';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  CatalogContentService,
  CatalogPresenter,
} from '@creativo/features/shared/catalog';
import { translateDomainError } from '@creativo/infrastructure/i18n';
import { UiButton } from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { UiListGroup, UiListRow } from '@creativo/ui/patterns';
import { SessionIdentityService } from '@creativo/features/shared/shell';
import { BookingFlowStore } from '../booking-flow.store';
import { BookingStepTitle } from '../chrome/booking-chrome.service';
import { BookingStepLayout } from '../step-layout/booking-step-layout';

/** One booked line, as the summary reads it out. */
interface ReviewLineVm {
  readonly key: string;
  readonly personLabel: string;
  readonly serviceName: string;
  readonly variantName: string | null;
  readonly barberName: string;
  readonly timeLabel: string;
  readonly priceLabel: string;
}

/**
 * Step 4 — is this right?
 *
 * ### What a summary is for
 * Not decoration and not a receipt: it is the last place a mistake is cheap.
 * So it says the things that are expensive to get wrong — who, with whom, at
 * what time, for how much — in that order, and each row is the same shape the
 * user has already seen twice.
 *
 * ### The auth prompt is HERE, not at the door
 * `/book` is browsable anonymously (owner ruling 2026-07-29). Signing in is
 * asked for at the moment it buys something — a booking that exists, that can
 * be cancelled, that shows up in an account — rather than as a toll on the way
 * in. `AccountStateService` claims the party in place when the principal turns
 * active, so the round trip costs nothing the user assembled.
 *
 * ### Confirm is a server round trip that can say no
 * The times on this screen came from a projection that may be seconds old. If
 * the slot goes while the user is reading, the store steps back to a freshly
 * computed grid with the day intact and an honest line about why — never a
 * dead end, and never a silent success against stale data.
 */
@Component({
  selector: 'lib-booking-review-step',
  imports: [
    BookingStepLayout,
    BookingStepTitle,
    TranslocoDirective,
    UiButton,
    UiForegroundStyleDirective,
    UiListGroup,
    UiListRow,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './booking-review-step.html',
  styleUrl: './booking-review-step.css',
  host: { 'data-testid': 'booking-review-step' },
})
export class BookingReviewStep {
  private readonly transloco = inject(TranslocoService);
  private readonly identity = inject(SessionIdentityService);
  private readonly router = inject(Router);
  private readonly accountState = inject(AccountStateService);

  protected readonly catalog = inject(CatalogContentService);
  protected readonly content = inject(CatalogPresenter);
  protected readonly store = inject(BookingFlowStore);

  /** The booker has an account. Until then Confirm asks them to sign in. */
  protected readonly isSignedIn = computed(
    () => this.accountState.principal().kind === 'active',
  );

  private readonly zone = computed(
    () => this.store.selection()?.timeSlot.start.zoneName ?? 'Europe/Sofia',
  );

  protected readonly locationName = computed(() => {
    const selection = this.store.selection();
    if (!selection) return '';
    const shop = this.catalog
      .locations()
      .find((candidate) => candidate.id.equals(selection.locationId));
    return shop
      ? this.content.text({ en: shop.name.en, bg: shop.name.bg })
      : selection.locationId.value;
  });

  /** The day, spelled out — "Monday, 3 August". */
  protected readonly dayLabel = computed(() => {
    const selection = this.store.selection();
    if (!selection) return '';
    return new Intl.DateTimeFormat(this.content.locale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: this.zone(),
    }).format(new Date(selection.timeSlot.start.toMillis()));
  });

  /** The envelope — when the party arrives and when it is done. */
  protected readonly windowLabel = computed(() => {
    const selection = this.store.selection();
    if (!selection) return '';
    return `${this.time(selection.timeSlot.start.toMillis())} – ${this.time(
      selection.timeSlot.end.toMillis(),
    )}`;
  });

  protected readonly lines = computed<readonly ReviewLineVm[]>(() => {
    const selection = this.store.selection();
    const cart = this.store.cart();
    if (!selection || !cart) return [];

    const byLineId = new Map(
      cart
        .entries()
        .flatMap(([seatKey, lines]) =>
          lines.map((line) => [line.id.value, { seatKey, line }] as const),
        ),
    );

    return selection.assignments.flatMap((assignment): ReviewLineVm[] => {
      const found = byLineId.get(assignment.lineId.value);
      if (!found) return [];
      const service = this.catalog.findService(found.line.serviceId.value);
      if (!service) return [];

      // The price shown is `termsFor(the barber who actually got it)` — the
      // same resolution the server will redo. A summary quoting the catalog
      // base while the server charges the barber's rate is a summary that
      // lies.
      const terms = service.termsFor(assignment.barberId, found.line.variantId);
      const variant = found.line.variantId
        ? (service.variants.find((candidate) =>
            candidate.id.equals(found.line.variantId as never),
          ) ?? null)
        : null;

      return [
        {
          key: assignment.lineId.value,
          personLabel: this.personLabel(found.seatKey),
          serviceName: this.content.text({
            en: service.name.en,
            bg: service.name.bg,
          }),
          variantName: variant
            ? this.content.text({ en: variant.name.en, bg: variant.name.bg })
            : null,
          barberName: this.barberName(assignment.barberId),
          timeLabel: this.time(assignment.slot.start.toMillis()),
          priceLabel: formatMoney(terms.price, this.content.locale()),
        },
      ];
    });
  });

  /**
   * What it comes to.
   *
   * Summed from the same per-barber terms each row shows, so the total and its
   * parts cannot disagree. Money is otherwise deferred (owner ruling
   * 2026-07-29) — nothing is charged here; this is what to expect at the
   * chair.
   */
  protected readonly totalLabel = computed(() => {
    const selection = this.store.selection();
    const cart = this.store.cart();
    if (!selection || !cart) return null;

    const byLineId = new Map(
      cart
        .entries()
        .flatMap(([, lines]) =>
          lines.map((line) => [line.id.value, line] as const),
        ),
    );

    let total: Money | null = null;
    for (const assignment of selection.assignments) {
      const line = byLineId.get(assignment.lineId.value);
      if (!line) continue;
      const service = this.catalog.findService(line.serviceId.value);
      if (!service) continue;
      const price = service.termsFor(assignment.barberId, line.variantId).price;
      if (total === null) {
        total = price;
        continue;
      }
      const sum = total.add(price);
      // Mixed currencies are a data error the aggregate also refuses; showing
      // a partial total would be worse than showing none.
      if (sum.isFailure()) return null;
      total = sum.value;
    }
    return total ? formatMoney(total, this.content.locale()) : null;
  });

  /** The `slot_unavailable` bounce is handled by the store; this is anything else. */
  protected readonly errorMessage = computed(() => {
    const error = this.store.error();
    if (!error || this.store.slotTaken()) return null;
    return translateDomainError(this.transloco, error);
  });

  /**
   * Confirm, or sign in first.
   *
   * The redirect lands on `?step=schedule` rather than back here on purpose:
   * the draft resumes one step back (see `BookingFlowStore.restore`), because
   * the offer this screen shows would be minutes old by then and nobody
   * re-checked it. The user's day survives, so it costs one tap.
   */
  protected async confirm(): Promise<void> {
    if (!this.isSignedIn()) {
      await this.router.navigate(['/auth'], {
        queryParams: { redirect: '/book?step=schedule' },
      });
      return;
    }
    await this.store.commit();
  }

  private time(millis: number): string {
    return new Intl.DateTimeFormat(this.content.locale(), {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: this.zone(),
    }).format(new Date(millis));
  }

  private barberName(barberId: BarberId): string {
    const barber = this.catalog
      .barbers()
      .find((candidate) => candidate.id.equals(barberId));
    return barber
      ? this.content.text({ en: barber.name.en, bg: barber.name.bg })
      : barberId.value;
  }

  /** `seatKeyValue` is `'self'` or the bare `GuestId`. */
  private personLabel(seatKey: string): string {
    // The booker by NAME once we know it — three steps said "You" to a
    // signed-in user whose name was sitting in the session the whole time
    // (owner ruling 2026-07-31). "You" is the fallback, not the rule.
    if (seatKey === 'self')
      return (
        this.identity.displayName() ||
        this.transloco.translate('booking.party.you')
      );
    const guest = this.store
      .guests()
      .find((candidate) => candidate.id.value === seatKey);
    return guest?.label.value ?? seatKey;
  }
}
