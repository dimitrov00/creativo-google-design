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
import { CompositionKind } from '@core/components';
import type { Service } from '@core/entities';
import { CatalogPricingSystem } from '@core/systems';
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
import { CatalogContentService } from '../content/catalog-content.service';
import { CatalogWording } from '../content/catalog-wording.service';
import {
  type BarberVm,
  type ServiceVm,
  type ServiceVariantVm,
} from '../content/catalog.vm';
import {
  serviceDurationRange,
  servicePriceFrom,
  termsToVm,
} from '../content/catalog.presenter';
import { ShowcaseGalleryComponent } from '../gallery/showcase-gallery.component';
import { type CapsuleVm, CapsuleListComponent } from './capsule-list.component';
import { ServiceRowComponent } from './service-row.component';

/** The mark each variant kind wears — keyed on the view model's own union. */
const VARIANT_ICONS: Record<ServiceVariantVm['icon'], UiIconName> = {
  length: 'service.variant.length',
  skin: 'service.variant.skin',
};

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
  selector: 'cr-service-detail-sheet',
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
  templateUrl: './service-detail-sheet.component.html',
  styleUrl: './service-detail-sheet.component.css',
})
export class ServiceDetailSheetComponent {
  /** The service on show. Following a reference REOPENS this sheet on the
   *  new subject — one surface, one subject, no stack (owner ruling). */
  readonly service = input.required<ServiceVm>();
  /** Everyone who performs anything — the sheet picks out this service's performers. */
  readonly barbers = input.required<readonly BarberVm[]>();
  /** The catalog this service's bundle members are looked up in. Empty is fine for a single. */
  readonly catalogServices = input<readonly ServiceVm[]>([]);

  /**
   * How much of the fine print this reading needs.
   *
   * - `full` (default) — options and performers included. Marketing: they
   *   are information about what the service can be and who does it.
   * - `story` — the pitch, the gallery and the bundle manifest only. A
   *   booking host asks for the variant and the barber on its own action
   *   bar, and a second read-only telling of both, further from the button
   *   that needs the answers, is two accounts of one question (owner ruling
   *   2026-07-31).
   */
  readonly uiDetail = input<'full' | 'story'>('full');

  readonly closed = output();
  /** A reference inside the sheet was followed — the owner swaps the
   *  sheet's subject; it never opens a second sheet over this one. */
  readonly serviceSelected = output<ServiceVm>();
  /** A performer was tapped. Emitted only AFTER this sheet has finished
   *  leaving, so the barber's own sheet takes an empty screen. */
  readonly barberSelected = output<BarberVm>();

  protected readonly content = inject(CatalogWording);
  /**
   * The live catalogue the hosts' view models come from: the performer
   * order and the bundle saving are `CatalogPricingSystem`'s answers on the
   * stored entities (integer cents), never re-derived from the view model's
   * major-unit floats.
   */
  private readonly catalog = inject(CatalogContentService);
  /** The dictionary, for the template's bundle badge (never a bare literal). */
  protected readonly CompositionKind = CompositionKind;

  private readonly sheet = viewChild.required(UiDetailSheet);

  /**
   * Dismiss with the pattern's own close animation. Part of the composite's
   * public API on purpose: a host that projects `[sheet-actions]` acts and
   * then closes ("select this service" → gone), and it must not have to
   * reach through to the inner `ui-detail-sheet` to do it.
   */
  close(): void {
    this.sheet().close();
  }

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

  /**
   * One card per offering barber, cheapest first — the order is
   * `CatalogPricingSystem.performersByPrice` on the stored service (a stable
   * sort on each performer's base price); which of them are on the team is
   * the host's barber lookup.
   */
  protected readonly performers = computed<readonly PerformerVm[]>(() => {
    const service = this.catalog.findService(this.service().id);
    if (service === undefined) return [];
    const byId = new Map(this.barbers().map((b) => [b.id, b]));
    return CatalogPricingSystem.performersByPrice(service, null).flatMap(
      (performer) => {
        const barber = byId.get(performer.barberId);
        if (!barber) return [];
        const terms = termsToVm(performer.terms);
        return [{ barber, price: terms.price, minutes: terms.minutes }];
      },
    );
  });

  protected readonly includedServices = computed<readonly ServiceVm[]>(() => {
    const includes = this.service().includes ?? [];
    return includes
      .map((id) => this.catalogServices().find((s) => s.id === id))
      .filter((s): s is ServiceVm => Boolean(s));
  });

  /** Options capsules — the variant's own `icon` intent maps to a registry
   *  key so the chips carry a mark instead of reading as bare text. */
  protected readonly variantCapsules = computed<readonly CapsuleVm[]>(() =>
    this.service().variants.map((variant) => ({
      label: this.content.text(variant.name),
      // Exhaustive over the variant's own union: a new variant kind fails to
      // compile here until it has a registry key — no cast, no string math.
      icon: VARIANT_ICONS[variant.icon],
    })),
  );

  /**
   * What a bundle saves against buying its members separately —
   * `CatalogPricingSystem.bundleSaving` on the stored bundle and the members
   * this sheet lists, in integer cents (DEP-10: a bundle priced exactly at
   * its members' sum says nothing, where a float sum could print a
   * «спестяваш 0,00 €»). Priced against the barber the "from" price comes
   * from; null when that barber doesn't offer every member (the seed has
   * this case: Niko has no shave, so he offers no Full-care bundle), or when
   * the bundle isn't cheaper — an unearned "you save" is worse than none.
   */
  protected readonly savings = computed<{
    price: string;
    minutes: number;
  } | null>(() => {
    const bundle = this.catalog.findService(this.service().id);
    if (bundle === undefined) return null;
    const members: Service[] = [];
    for (const member of this.includedServices()) {
      const stored = this.catalog.findService(member.id);
      if (stored !== undefined) members.push(stored);
    }
    const saving = CatalogPricingSystem.bundleSaving(bundle, members);
    if (saving === null) return null;
    return {
      price: this.content.priceCents(saving.savedCents),
      minutes: saving.savedMinutes,
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
