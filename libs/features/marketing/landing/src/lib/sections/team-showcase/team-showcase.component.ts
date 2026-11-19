import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiAvatar, UiButton, UiIcon } from '@creativo/ui/controls';
import { UiGrid, UiSpacer, UiStack } from '@creativo/ui/layout';
import {
  UiInteractiveDirective,
  UiRadiusDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiSectionHeader,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import { UiModalSheet } from '@creativo/ui/controls';
import {
  type BarberVm,
  CatalogWording,
  ServiceRowComponent,
  type ServiceVm,
  ShowcaseGalleryComponent,
  termsPrice,
} from '@creativo/features/shared/catalog';
import { LandingContentService } from '../../content/landing-content.service';
import { CatalogNavigationService } from '../../shared/catalog-navigation.service';

/**
 * The team — the catalogue's PUBLIC barbers in their `sortOrder`
 * (`LandingContentService.barbers`, the same view models `/book` reads):
 * each card is the barber's avatar, their title as the role line and their
 * name; the sheet adds their bio, their price list and — when art direction
 * gives one (`CATALOG_ART`) — a specialty line and a gallery. Nothing here
 * is authored: a barber the owner adds through Team appears, one who leaves
 * the public list disappears, and the page hides the section while there is
 * nobody to show. No rating: the catalogue has no reviews, and a rating is
 * never authored (EU rules on fake reviews and ratings).
 */
@Component({
  selector: 'cr-team-showcase',
  imports: [
    UiModalSheet,
    ShowcaseGalleryComponent,
    TranslocoDirective,
    UiAvatar,
    UiButton,
    UiGrid,
    UiIcon,
    UiInteractiveDirective,
    ServiceRowComponent,
    UiListGroup,
    UiRadiusDirective,
    UiSectionHeader,
    UiSheetActionBar,
    UiSpacer,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './team-showcase.component.html',
  styleUrl: './team-showcase.component.css',
  host: {
    'data-testid': 'landing-barbers',
    '[attr.data-state]': "sheetOpen() ? 'open' : 'closed'",
  },
})
export class TeamShowcaseComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly content = inject(LandingContentService);
  protected readonly words = inject(CatalogWording);
  private readonly catalog = inject(CatalogNavigationService);
  /** A price-list row's terms as the money `CatalogWording.price` words. */
  protected readonly termsPrice = termsPrice;

  /** Held across the exit — see `openService`. */
  private handoff: ServiceVm | null = null;

  /** The public barbers, in their `sortOrder`. */
  protected readonly barbers = this.content.barbers;

  /**
   * WHICH barber the sheet shows is shared state, because a performer in
   * the service sheet opens this same sheet — one barber presentation for
   * the whole page. Only the exit dance stays local.
   */
  protected readonly activeBarber = computed(
    () =>
      this.barbers().find((barber) => barber.id === this.catalog.barberId()) ??
      null,
  );
  protected readonly sheetOpen = computed(() => this.activeBarber() !== null);
  protected readonly sheetClosing = signal(false);

  /**
   * What this barber charges, per shelf service — the content service asks
   * `CatalogPricingSystem.servicesByBarber` over the marketing shelf, so
   * upsell-only add-ons stay out of it exactly as they do everywhere else on
   * this page.
   */
  protected readonly activeBarberPrices = computed(() => {
    const barber = this.activeBarber();
    if (!barber) return [];
    return this.content.barberPrices(barber.id);
  });

  protected openBarber(barber: BarberVm): void {
    this.sheetClosing.set(false);
    this.catalog.openBarber(barber.id);
  }

  protected closeBarber(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.sheetOpen() || this.sheetClosing()) return;
    // No timer: close completion is driven by the sheet's own exit
    // transition (ui-modal-sheet's closeFinished) so the CSS motion tokens
    // stay the single source of truth for the exit duration.
    this.sheetClosing.set(true);
  }

  /**
   * A price-list row is a reference to the service's own sheet. Rather
   * than opening one over this one — a sheet on top of a sheet, the thing
   * HIG is firmest about — this sheet leaves FIRST and the catalog sheet
   * takes the screen once its exit finishes. One surface at a time, and
   * the handoff reads as a replace rather than a stack.
   */
  protected openService(service: ServiceVm): void {
    this.handoff = service;
    this.closeBarber();
  }

  protected finishClosing(): void {
    if (!this.sheetClosing()) return;
    this.sheetClosing.set(false);
    this.catalog.closeBarber();
    const handoff = this.handoff;
    this.handoff = null;
    if (handoff) this.catalog.open(handoff);
  }
}
