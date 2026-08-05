import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  BarberPref,
  type CartLine,
  CartLineId,
  Money,
  formatMoney,
} from '@creativo/application/booking';
import {
  BarberId,
  type Service,
  ServiceVariantId,
} from '@creativo/application/catalog';
import {
  CatalogContentService,
  CatalogPresenter,
  type ServiceVm,
} from '@creativo/features/shared/catalog';
import {
  UiAsyncImage,
  UiAvatar,
  UiButton,
  UiIcon,
  UiModalSheet,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiMenu,
  UiMenuItem,
  UiMenuTrigger,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import { BookingFlowStore } from '../booking-flow.store';
import type { SeatScopeVm } from '../seat-scope-vm';

/**
 * What a line costs and how long it takes — as a SPAN, always.
 *
 * "Anyone" is not a missing answer waiting to be filled in; it is an answer
 * that leaves the price open, because whoever is free decides it and they
 * charge their own rates. A bag that quoted one number there would name a
 * price the booking may not cost (the same reasoning the add-to-bag CTA
 * already applies — owner ruling 2026-07-31). A pinned barber collapses the
 * span to a point, and every label below prints a single value when it does.
 */
interface TermsSpan {
  readonly minPrice: Money;
  readonly maxPrice: Money;
  readonly minMinutes: number;
  readonly maxMinutes: number;
}

/** One option on a line's variant or performer menu. */
interface BagOptionVm {
  readonly key: string;
  /** `null` is the "anyone" option; variants always carry an id. */
  readonly id: string | null;
  readonly name: string;
  readonly avatarSrc: string | null;
  /** Terms on THIS option — "45 мин · 28,00 €". */
  readonly terms: string;
  readonly selected: boolean;
}

/** A pull-down on the row: what it currently says, and what it could say. */
interface BagSelectVm {
  /** Menu identity — `<line>:variant` / `<line>:barber`. */
  readonly key: string;
  /** Which cart write a pick performs — the template renders both the same. */
  readonly kind: 'variant' | 'barber';
  readonly label: string;
  readonly ariaLabel: string;
  /** A portrait when a person is pinned; the silhouette stands for "anyone". */
  readonly avatarSrc: string | null;
  readonly showsFace: boolean;
  readonly options: readonly BagOptionVm[];
}

/** One thing in the bag, described down to what it will actually cost. */
interface BagLineVm {
  readonly key: string;
  readonly id: CartLineId;
  readonly name: string;
  readonly coverSrc: string | null;
  readonly durationLabel: string;
  readonly priceLabel: string;
  /** Absent when the service declares no variants — an empty select is noise. */
  readonly variant: BagSelectVm | null;
  readonly performer: BagSelectVm;
  readonly editLabel: string;
  readonly removeLabel: string;
}

/** One person's shelf of the bag. */
interface BagGroupVm {
  readonly seat: SeatScopeVm;
  readonly lines: readonly BagLineVm[];
  /** What this person alone comes to; `null` if their prices can't be summed. */
  readonly subtotalLabel: string | null;
}

/**
 * The bag — what is being bought, for whom, by whom, and what it comes to.
 *
 * ### Why this is a shop's bag and not a list of names
 * The bag is the only screen between "I picked things" and "I am committing to
 * a time", and the previous one answered exactly one of the four questions a
 * person actually has there: it said WHAT, in one line of text, and left who,
 * how long and how much to be discovered two steps later at the summary. A
 * price first seen at the summary is a price that arrives too late to change
 * anything — which is the definition of a surprise, and the one thing a bag
 * exists to prevent.
 *
 * Nothing here is new data: it is the same `Service.termsFor(barber, variant)`
 * resolution the review step quotes and the server re-runs, moved to the first
 * screen that could have shown it.
 *
 * ### Editing in place, at two depths
 * The name is the way into the full sheet (story, gallery, conflicts) — the
 * decision that needs room. The two answers that DON'T need room are the two
 * the sheet asks for anyway, so they are pull-downs on the row itself: which
 * variant, and who. Each option states its own terms, because a picker whose
 * options don't say what they cost is a picker you have to press to read.
 *
 * ### One person, one shelf
 * A party's bag is grouped by seat with the person's face and their own
 * subtotal above their run — never a flat list with a name repeated down the
 * side, which is how you end up buying a beard trim for the wrong guest. The
 * heading disappears entirely for a party of one.
 *
 * ### It closes itself
 * Removing the last line empties the bag, and an empty bag is not a screen —
 * it is the absence of one. The sheet dismisses rather than presenting an
 * empty state nobody asked to see (the trigger behind it is already disabled
 * at zero, so there is no way back in to be stranded).
 */
@Component({
  selector: 'lib-booking-bag-sheet',
  imports: [
    NgTemplateOutlet,
    TranslocoDirective,
    UiAsyncImage,
    UiAvatar,
    UiButton,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiMenu,
    UiMenuItem,
    UiMenuTrigger,
    UiModalSheet,
    UiSheetActionBar,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './booking-bag-sheet.html',
  // Second stylesheet is the SHARED select recipe the service sheet renders
  // from — the bag's pull-downs are the same control, so they are the same
  // stylesheet rather than a second one that looks like it today.
  styleUrls: ['./booking-bag-sheet.css', '../chrome/booking-select.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, like every component that has to reach a DS internal: the row
  // label (`.ui-list-row__label`) is stamped by UiListRow's OWN template, so
  // it never carries this component's `_ngcontent` attribute — the row grid
  // declared on it silently matched nothing under emulated scoping. Every
  // selector in the stylesheet stays `.bag`-prefixed for it.
  encapsulation: ViewEncapsulation.None,
})
export class BookingBagSheet {
  private readonly transloco = inject(TranslocoService);
  private readonly catalog = inject(CatalogContentService);
  private readonly content = inject(CatalogPresenter);
  private readonly store = inject(BookingFlowStore);

  /** The party, in scope order — the same people the catalog step scopes by. */
  readonly seats = input.required<readonly SeatScopeVm[]>();

  /**
   * What the forward move says, decided by the step that owns the flow.
   *
   * Passed in rather than re-derived: with a party the label hands over to the
   * next person with an empty bag BY NAME, and a bag that computed its own
   * "Continue" would disagree with the button behind it.
   */
  readonly forwardLabel = input.required<string>();

  /**
   * Whether that move is available — passed in for the same reason the label
   * is. The bag can be full and the party still short a person, and a bar
   * that decided this from its own total would offer a way forward the step
   * behind it refuses.
   */
  readonly forwardBlocked = input.required<boolean>();

  /** Open this line in the full sheet, for the person who holds it. */
  readonly editLine = output<{ seatKey: string; lineId: CartLineId }>();
  readonly dismissed = output<void>();
  readonly proceed = output<void>();

  /** Which pull-down is down — at most one on the whole sheet, by select key. */
  protected readonly openMenu = signal<string | null>(null);

  protected readonly multiPerson = computed(() => this.seats().length > 1);

  protected readonly groups = computed<readonly BagGroupVm[]>(() => {
    const cart = this.store.cart();
    if (!cart) return [];
    return this.seats()
      .map((seat) => {
        const described = cart
          .linesFor(seat.seatKey)
          .flatMap((line) => this.describe(line));
        return {
          seat,
          lines: described.map((entry) => entry.vm),
          subtotalLabel: this.priceLabel(
            this.sum(described.map((entry) => entry.span)),
          ),
        };
      })
      .filter((group) => group.lines.length > 0);
  });

  /** Every priced line in the bag, flattened — the bar's two numbers. */
  private readonly wholeBag = computed(() => {
    const cart = this.store.cart();
    if (!cart) return [];
    return this.seats().flatMap((seat) =>
      cart.linesFor(seat.seatKey).flatMap((line) => this.describe(line)),
    );
  });

  protected readonly totalLabel = computed(() =>
    this.priceLabel(this.sum(this.wholeBag().map((entry) => entry.span))),
  );

  /**
   * "Общо · 55 – 80 мин" — the label the amount hangs under.
   *
   * The duration rides HERE rather than getting a column of its own: chair
   * time is what the total is a price FOR, and a bar with two numbers side by
   * side makes you work out which one is the money. It spans for the same
   * reason the price does — an unpinned barber decides how long it takes too.
   */
  protected readonly summaryLabel = computed(() => {
    const span = this.sum(this.wholeBag().map((entry) => entry.span));
    const total = this.transloco.translate('booking.bag.total');
    return span
      ? `${total} · ${this.content.durationRange(span.minMinutes, span.maxMinutes)}`
      : total;
  });

  protected edit(seat: SeatScopeVm, line: BagLineVm): void {
    this.openMenu.set(null);
    this.editLine.emit({ seatKey: seat.key, lineId: line.id });
  }

  protected remove(seat: SeatScopeVm, line: BagLineVm): void {
    this.openMenu.set(null);
    this.store.removeLine(seat.seatKey, line.id);
    // The bag is now empty and an empty bag is not a screen. Reading the count
    // straight after the dispatch is sound: the store sets a signal, so the
    // derived count is already the post-removal one here.
    if (this.store.lineCount() === 0) this.dismissed.emit();
  }

  protected toggleMenu(key: string): void {
    this.openMenu.set(this.openMenu() === key ? null : key);
  }

  /**
   * Commit a pick.
   *
   * One entry point for both pull-downs so the template renders them from the
   * same block — they differ only in which cart write they end in, and a
   * second copy of the trigger/menu markup to express that would be a copy.
   */
  protected pick(
    seat: SeatScopeVm,
    line: BagLineVm,
    select: BagSelectVm,
    option: BagOptionVm,
  ): void {
    this.openMenu.set(null);
    if (select.kind === 'variant') {
      if (option.id === null) return;
      const variantId = ServiceVariantId.create(option.id);
      if (variantId.isFailure()) return;
      this.store.setLineVariant(seat.seatKey, line.id, variantId.value);
      return;
    }
    if (option.id === null) {
      this.store.setLineBarber(seat.seatKey, line.id, BarberPref.any());
      return;
    }
    const barberId = BarberId.create(option.id);
    if (barberId.isFailure()) return;
    this.store.setLineBarber(
      seat.seatKey,
      line.id,
      BarberPref.specific(barberId.value),
    );
  }

  // ── Terms ───────────────────────────────────────────────────────────

  /**
   * What a (service, variant, barber) will cost and take.
   *
   * A named barber resolves to exactly one `ServiceTerms` — the one the server
   * will charge. "Anyone" resolves to the span across everyone who performs it,
   * because the scheduler picks the performer and their rate comes with them.
   * A service nobody has claimed yet falls back to the catalog's base terms,
   * which is the only quote there is.
   */
  private spanFor(
    service: Service,
    variantId: ServiceVariantId | null,
    barberId: BarberId | null,
  ): TermsSpan {
    const resolved = barberId
      ? [service.termsFor(barberId, variantId)]
      : service.offerings.map((offering) =>
          service.termsFor(offering.barberId, variantId),
        );
    // `termsFor` always answers, so the base fallback makes the seed total —
    // there is no "no terms" case to model.
    const seed = service.termsFor(null, variantId);
    const terms = resolved.length > 0 ? resolved : [seed];

    // Single currency is a cart invariant the aggregate enforces, so minor
    // units compare directly.
    return terms.reduce<TermsSpan>(
      (span, next) => ({
        minPrice:
          next.price.toMinorUnits() < span.minPrice.toMinorUnits()
            ? next.price
            : span.minPrice,
        maxPrice:
          next.price.toMinorUnits() > span.maxPrice.toMinorUnits()
            ? next.price
            : span.maxPrice,
        minMinutes: Math.min(span.minMinutes, next.durationMinutes),
        maxMinutes: Math.max(span.maxMinutes, next.durationMinutes),
      }),
      {
        minPrice: terms[0]?.price ?? seed.price,
        maxPrice: terms[0]?.price ?? seed.price,
        minMinutes: terms[0]?.durationMinutes ?? seed.durationMinutes,
        maxMinutes: terms[0]?.durationMinutes ?? seed.durationMinutes,
      },
    );
  }

  /**
   * Several spans as one.
   *
   * Floors add to the floor and ceilings to the ceiling: a bag holding one
   * pinned 14,50 € line and one open 13,00–15,50 € line is honestly
   * 27,50 – 30,00 €, not a single number either end of it.
   *
   * Mixed currencies are a data error the aggregate also refuses, and a
   * PARTIAL total would be worse than none — so the label vanishes rather than
   * quoting a sum that is missing a line (the review step's ruling).
   */
  private sum(spans: readonly TermsSpan[]): TermsSpan | null {
    let total: TermsSpan | null = null;
    for (const span of spans) {
      if (total === null) {
        total = span;
        continue;
      }
      const min = total.minPrice.add(span.minPrice);
      const max = total.maxPrice.add(span.maxPrice);
      if (min.isFailure() || max.isFailure()) return null;
      total = {
        minPrice: min.value,
        maxPrice: max.value,
        minMinutes: total.minMinutes + span.minMinutes,
        maxMinutes: total.maxMinutes + span.maxMinutes,
      };
    }
    return total;
  }

  /** "28,00 €", or "13,00 € – 15,50 €" when the barber is still open. */
  private priceLabel(span: TermsSpan | null): string | null {
    if (!span) return null;
    const low = formatMoney(span.minPrice, this.content.locale());
    if (span.minPrice.toMinorUnits() === span.maxPrice.toMinorUnits()) {
      return low;
    }
    return `${low} – ${formatMoney(span.maxPrice, this.content.locale())}`;
  }

  /** A menu option's one-line terms — "45 мин · 28,00 €". */
  private termsLabel(span: TermsSpan): string {
    return `${this.content.durationRange(
      span.minMinutes,
      span.maxMinutes,
    )} · ${this.priceLabel(span)}`;
  }

  // ── Describing a line ───────────────────────────────────────────────

  /**
   * One cart line, priced.
   *
   * Returns an array so an unknown service (a catalog that moved under a
   * restored draft) drops the row instead of rendering a line with an id where
   * its name should be — `flatMap` over `[]` is the whole guard.
   */
  private describe(
    line: CartLine,
  ): readonly { vm: BagLineVm; span: TermsSpan }[] {
    const service = this.catalog.findService(line.serviceId.value);
    if (!service) return [];
    const vm = this.catalog.toServiceVm(service);

    const barberId =
      line.barberPref.kind === 'specific' ? line.barberPref.barberId : null;
    const variantId = line.variantId ?? null;
    const span = this.spanFor(service, variantId, barberId);

    const name = this.content.text(vm.name);
    const key = line.id.value;

    return [
      {
        vm: {
          key,
          id: line.id,
          name,
          coverSrc: vm.coverSrc ?? null,
          durationLabel: this.content.durationRange(
            span.minMinutes,
            span.maxMinutes,
          ),
          priceLabel: this.priceLabel(span) ?? '',
          variant: this.variantSelect(service, vm, key, variantId, barberId),
          performer: this.performerSelect(
            service,
            vm,
            key,
            variantId,
            barberId,
          ),
          editLabel: this.transloco.translate('booking.bag.edit', {
            service: name,
          }),
          removeLabel: this.transloco.translate('booking.bag.remove', {
            service: name,
          }),
        },
        span,
      },
    ];
  }

  /** Which variant — absent for a service that declares none. */
  private variantSelect(
    service: Service,
    vm: ServiceVm,
    lineKey: string,
    variantId: ServiceVariantId | null,
    barberId: BarberId | null,
  ): BagSelectVm | null {
    if (vm.variants.length === 0) return null;
    const chosen = vm.variants.find(
      (candidate) => candidate.id === variantId?.value,
    );
    return {
      key: `${lineKey}:variant`,
      kind: 'variant',
      label: chosen
        ? this.content.text(chosen.name)
        : this.transloco.translate('booking.configure.variantPick'),
      ariaLabel: this.transloco.translate('booking.configure.variant'),
      avatarSrc: null,
      showsFace: false,
      options: vm.variants.map((variant) => {
        const id = ServiceVariantId.create(variant.id);
        return {
          key: variant.id,
          id: variant.id,
          name: this.content.text(variant.name),
          avatarSrc: null,
          // Priced on the CURRENT performer answer, so switching variant shows
          // what it would cost the way this line is actually set up.
          terms: this.termsLabel(
            this.spanFor(service, id.isFailure() ? null : id.value, barberId),
          ),
          selected: variant.id === variantId?.value,
        };
      }),
    };
  }

  /**
   * Who does it — "anyone" first, then the named performers cheapest-first on
   * the terms actually shown, since a list that claims cheapest-first has to
   * be one.
   */
  private performerSelect(
    service: Service,
    vm: ServiceVm,
    lineKey: string,
    variantId: ServiceVariantId | null,
    barberId: BarberId | null,
  ): BagSelectVm {
    const barber = barberId
      ? this.catalog
          .barberVms()
          .find((candidate) => candidate.id === barberId.value)
      : undefined;

    const anyone: BagOptionVm = {
      key: 'any',
      id: null,
      name: this.transloco.translate('booking.configure.anyBarber'),
      avatarSrc: null,
      terms: this.termsLabel(this.spanFor(service, variantId, null)),
      selected: barberId === null,
    };

    const named = vm.offerings
      .flatMap((offering) => {
        const candidate = this.catalog
          .barberVms()
          .find((entry) => entry.id === offering.barberId);
        if (!candidate) return [];
        const id = BarberId.create(candidate.id);
        if (id.isFailure()) return [];
        return [
          {
            barber: candidate,
            span: this.spanFor(service, variantId, id.value),
          },
        ];
      })
      .sort(
        (a, b) =>
          a.span.minPrice.toMinorUnits() - b.span.minPrice.toMinorUnits(),
      )
      .map((entry): BagOptionVm => ({
        key: entry.barber.id,
        id: entry.barber.id,
        name: this.content.text(entry.barber.name),
        avatarSrc: entry.barber.avatarSrc || null,
        terms: this.termsLabel(entry.span),
        selected: barberId?.value === entry.barber.id,
      }));

    return {
      key: `${lineKey}:barber`,
      kind: 'barber',
      label: barber
        ? this.content.text(barber.name)
        : this.transloco.translate('booking.configure.anyBarber'),
      ariaLabel: this.transloco.translate('booking.configure.barber'),
      avatarSrc: barber?.avatarSrc || null,
      showsFace: barber !== undefined,
      options: [anyone, ...named],
    };
  }
}
