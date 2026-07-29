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
  UiRating,
  UiSectionHeader,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import { UiModalSheet } from '@creativo/ui/controls';
import { ShowcaseGalleryComponent } from '../../../shared/showcase-gallery/showcase-gallery.component';
import { LandingContentService } from '../../../content/landing-content.service';
import {
  type ServiceVm,
  servicesByBarber,
} from '../../../content/landing-content';
import { CatalogNavigationService } from '../../../shared/catalog-navigation.service';
import { ServiceRowComponent } from '../../../sections/services/service-row.component';

interface BarberItem {
  /** Matches the catalog's barber id — the key the price list derives from. */
  readonly id: string;
  readonly nameKey: string;
  readonly image: string;
  readonly roleKey: string;
  readonly specialtyKey: string;
  readonly aboutKey?: string;
  readonly rating?: number;
  readonly gallery: readonly string[];
}

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
    UiRating,
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
  protected readonly content = inject(LandingContentService);
  private readonly catalog = inject(CatalogNavigationService);

  /** Held across the exit — see `openService`. */
  private handoff: ServiceVm | null = null;

  protected readonly barbers: readonly BarberItem[] = [
    {
      id: 'ivan',
      nameKey: 'landing.barbers.ivan.name',
      image: '/barbers/ivan.jpg',
      roleKey: 'landing.barbers.ivan.role',
      specialtyKey: 'landing.barbers.ivan.specialty',
      aboutKey: 'landing.barbers.ivan.about',
      rating: 4.9,
      gallery: [
        '/work/scissors-trim.jpg',
        '/work/modern-cut.jpg',
        '/work/finishing-touch.jpg',
        '/work/classic-clippers.jpg',
      ],
    },
    {
      id: 'niko',
      nameKey: 'landing.barbers.niko.name',
      image: '/barbers/niko.jpg',
      roleKey: 'landing.barbers.niko.role',
      specialtyKey: 'landing.barbers.niko.specialty',
      aboutKey: 'landing.barbers.niko.about',
      rating: 4.8,
      gallery: [
        '/work/fade-styling.jpg',
        '/work/classic-clippers.jpg',
        '/work/modern-cut.jpg',
        '/work/finishing-touch.jpg',
      ],
    },
    {
      id: 'stefan',
      nameKey: 'landing.barbers.stefan.name',
      image: '/barbers/stefan.jpg',
      roleKey: 'landing.barbers.stefan.role',
      specialtyKey: 'landing.barbers.stefan.specialty',
      gallery: [
        '/work/beard-shave.jpg',
        '/work/classic-clippers.jpg',
        '/work/scissors-trim.jpg',
        '/work/fade-styling.jpg',
      ],
    },
  ];

  /**
   * WHICH barber the sheet shows is shared state, because a performer in
   * the service sheet opens this same sheet — one barber presentation for
   * the whole page. Only the exit dance stays local.
   */
  protected readonly activeBarber = computed(
    () =>
      this.barbers.find((barber) => barber.id === this.catalog.barberId()) ??
      null,
  );
  protected readonly sheetOpen = computed(() => this.activeBarber() !== null);
  protected readonly sheetClosing = signal(false);

  /**
   * What this barber charges, per service — derived by inverting
   * `ServiceVm.offerings`, the only direction the catalog stores. Fed the
   * marketing shelf, so upsell-only add-ons stay out of it exactly as they
   * do everywhere else on this page.
   */
  protected readonly activeBarberPrices = computed(() => {
    const barber = this.activeBarber();
    if (!barber) return [];
    return servicesByBarber(this.content.shelfServices, barber.id);
  });

  protected openBarber(barber: BarberItem): void {
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
