import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  UiAvatar,
  UiBadge,
  UiButton,
  UiDetailSheet,
  UiIcon,
  type UiIconName,
} from '@creativo/ui/controls';
import { UiGrid, UiSpacer, UiStack } from '@creativo/ui/layout';
import {
  UiMultilineTextAlignmentDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiCard,
  UiListGroup,
  UiListRow,
  UiRating,
} from '@creativo/ui/patterns';
import { LandingContentService } from '../../content/landing-content.service';
import {
  type BarberVm,
  type ServiceOfferingVm,
  type ServiceVm,
  serviceDurationRange,
  servicePriceFrom,
} from '../../content/landing-content';
import { ShowcaseGalleryComponent } from '../../shared/showcase-gallery/showcase-gallery.component';
import { type CapsuleVm, CapsuleListComponent } from './capsule-list.component';
import { ServiceRowComponent } from './service-row.component';

/** One performer card — a barber with their own terms for this service. */
interface PerformerVm {
  readonly barber: BarberVm;
  readonly price: number;
  readonly minutes: number;
}

/**
 * The service-detail bottom sheet: the editorial story leads (title +
 * summary with duration/price), then the showcase gallery, then capsule
 * variant chips, the bundle "includes" list in the same chip language, and
 * the performer rows (circular avatars + each barber's own price/duration
 * for this service, with a grid layout alternative). The book CTA lives in
 * the bottom action bar, docked and visible for the sheet's whole life.
 * Title sizes are adapted to the sys type ramp (title/title3) instead of
 * the old oversized display cuts.
 */
@Component({
  selector: 'cr-catalog-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CapsuleListComponent,
    RouterLink,
    ServiceRowComponent,
    ShowcaseGalleryComponent,
    TranslocoDirective,
    UiAvatar,
    UiBadge,
    UiButton,
    UiCard,
    UiDetailSheet,
    UiGrid,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiMultilineTextAlignmentDirective,
    UiRating,
    UiSpacer,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './catalog-sheet.component.html',
  styleUrl: './catalog-sheet.component.css',
})
export class CatalogSheetComponent {
  /** The service on show. Following a reference REOPENS this sheet on the
   *  new subject — one surface, one subject, no stack (owner ruling). */
  readonly service = input.required<ServiceVm>();

  readonly closed = output();
  /** A reference inside the sheet was followed — the owner swaps the
   *  sheet's subject; it never opens a second sheet over this one. */
  readonly serviceSelected = output<ServiceVm>();
  /** A performer was tapped. Emitted only AFTER this sheet has finished
   *  leaving, so the barber's own sheet takes an empty screen. */
  readonly barberSelected = output<BarberVm>();

  protected readonly content = inject(LandingContentService);

  private readonly sheet = viewChild.required(UiDetailSheet);

  constructor() {
    // Following a reference REOPENS this sheet on the new subject, and the
    // surface never unmounts — so nothing resets its scroll. Without this
    // you land partway down a service you have not seen, wherever you
    // happened to be in the previous one. The first run is skipped: the
    // shell already starts a freshly-opened sheet at the top.
    let firstSubject = true;
    effect(() => {
      this.service();
      if (firstSubject) {
        firstSubject = false;
        return;
      }
      this.sheet().scrollToTop();
    });
  }

  /** Sheet chrome state — gallery + performer layout modes. (Shell
   *  mechanics — entrance, close dance, condensed title, docked bar — all
   *  live in the shared ui-detail-sheet pattern now.) */
  protected readonly galleryExpanded = signal(false);
  /** Grid is the default performer reading — the 2-up contact-card layout
   *  reads faster at a glance than a name-by-name list (owner ruling
   *  2026-07-24); the toggle still offers the list for a denser scan. */
  protected readonly performersGrid = signal(true);

  protected readonly duration = computed(() =>
    this.content.durationRange(
      serviceDurationRange(this.service()).from,
      serviceDurationRange(this.service()).to,
    ),
  );

  protected readonly fromPrice = computed(() =>
    this.content.price(servicePriceFrom(this.service())),
  );

  /** One card per offering barber, cheapest first. */
  protected readonly performers = computed<readonly PerformerVm[]>(() => {
    const service = this.service();
    const byId = new Map(this.content.barbers().map((b) => [b.id, b]));
    return service.offerings
      .flatMap((offering) => {
        const barber = byId.get(offering.barberId);
        return barber
          ? [
              {
                barber,
                price: offering.base.price,
                minutes: offering.base.minutes,
              },
            ]
          : [];
      })
      .sort((a, b) => a.price - b.price);
  });

  protected readonly includedServices = computed<readonly ServiceVm[]>(() => {
    const includes = this.service().includes ?? [];
    return includes
      .map((id) => this.content.allServices().find((s) => s.id === id))
      .filter((s): s is ServiceVm => Boolean(s));
  });

  /** Options capsules — the variant's own `icon` intent maps to a registry
   *  key so the chips carry a mark instead of reading as bare text. */
  protected readonly variantCapsules = computed<readonly CapsuleVm[]>(() =>
    this.service().variants.map((variant) => ({
      label: this.content.text(variant.name),
      // The registry key is derived from the variant's own intent, so a
      // new variant kind must add its glyph there — the cast is the seam
      // where that contract is asserted (both keys exist today).
      icon: `service.variant.${variant.icon}` as UiIconName,
    })),
  );

  /**
   * What a bundle saves against buying its members separately.
   *
   * Priced against the SAME barber the sheet's "from" price comes from —
   * mixing barbers would compare a total nobody can actually book. Null
   * when that barber doesn't offer every member (the seed already has this
   * case: Niko has no shave, so he offers no Full-care bundle), or when
   * the bundle isn't cheaper — an unearned "you save" is worse than none.
   */
  protected readonly savings = computed<{
    price: string;
    minutes: number;
  } | null>(() => {
    const service = this.service();
    const members = this.includedServices();
    if (service.kind !== 'bundle' || members.length === 0) return null;

    const cheapest = service.offerings.reduce<ServiceOfferingVm | null>(
      (best, offering) =>
        best === null || offering.base.price < best.base.price
          ? offering
          : best,
      null,
    );
    if (!cheapest) return null;

    let price = 0;
    let minutes = 0;
    for (const member of members) {
      const own = member.offerings.find(
        (offering) => offering.barberId === cheapest.barberId,
      );
      if (!own) return null;
      price += own.base.price;
      minutes += own.base.minutes;
    }

    const savedPrice = price - cheapest.base.price;
    if (savedPrice <= 0) return null;
    return {
      price: this.content.price(savedPrice),
      minutes: Math.max(0, minutes - cheapest.base.minutes),
    };
  });

  /** The cheapest offering's price for one member row's trailing value. */
  protected memberFrom(member: ServiceVm): string {
    return this.content.price(servicePriceFrom(member));
  }

  /**
   * A performer is a reference to that barber's own sheet — which lives in
   * the team section, because ONE barber presentation is the rule. Opening
   * it over this sheet would stack two, so this one leaves first and the
   * handoff fires on its exit.
   */
  protected selectBarber(barber: BarberVm): void {
    this.pendingBarber = barber;
    this.sheet().close();
  }

  protected onClosed(): void {
    const pending = this.pendingBarber;
    this.pendingBarber = null;
    this.closed.emit();
    if (pending) this.barberSelected.emit(pending);
  }

  private pendingBarber: BarberVm | null = null;
}
