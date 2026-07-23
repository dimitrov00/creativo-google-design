import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiAvatar, UiBadge, UiButton, UiIcon } from '@creativo/ui/controls';
import { UiGrid, UiStack } from '@creativo/ui/layout';
import { UiRadiusDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { UiListRow, UiSheetActionBar } from '@creativo/ui/patterns';
import { LandingContentService } from '../../content/landing-content.service';
import {
  type BarberVm,
  type ServiceVm,
  serviceDurationRange,
  servicePriceFrom,
} from '../../content/landing-content';
import { ModalSheetComponent } from '../../shared/modal-sheet/modal-sheet.component';
import { ShowcaseGalleryComponent } from '../../shared/showcase-gallery/showcase-gallery.component';
import { CapsuleListComponent } from './capsule-list.component';

/** One performer card — a barber with their own terms for this service. */
interface PerformerVm {
  readonly barber: BarberVm;
  readonly price: number;
  readonly minutes: number;
}

/* The sheet exit is visually done when its opacity transition completes —
   --sys-motion-duration-deliberate (300ms). The old 380ms matched neither
   the 300ms opacity nor the 480ms transform track (drift risk flagged in
   the case study §2.8). */
const CLOSE_ANIMATION_MS = 300;

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
  selector: 'cr-service-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CapsuleListComponent,
    ModalSheetComponent,
    RouterLink,
    ShowcaseGalleryComponent,
    TranslocoDirective,
    UiAvatar,
    UiBadge,
    UiButton,
    UiGrid,
    UiIcon,
    UiListRow,
    UiRadiusDirective,
    UiSheetActionBar,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './service-detail.component.html',
  styleUrl: './service-detail.component.css',
})
export class ServiceDetailComponent {
  readonly service = input.required<ServiceVm>();
  readonly closed = output();

  protected readonly content = inject(LandingContentService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private closeTimer: number | undefined;

  /** Mounts shut, opens next frame so the sheet animates in. */
  protected readonly sheetOpen = signal(false);
  protected readonly sheetClosing = signal(false);

  /** Sheet chrome state — gallery + performer layout modes. (The condensed
   *  toolbar title is ui-sheet-header's own sentinel-observed behavior, and
   *  the booking bar is always visible — zero scroll wiring here.) */
  protected readonly galleryExpanded = signal(false);
  protected readonly performersGrid = signal(false);

  protected readonly duration = computed(() => {
    const range = serviceDurationRange(this.service());
    return this.content.durationRange(range.from, range.to);
  });

  protected readonly fromPrice = computed(() =>
    this.content.price(servicePriceFrom(this.service())),
  );

  /** One card per offering barber, cheapest first. */
  protected readonly performers = computed<readonly PerformerVm[]>(() => {
    const byId = new Map(this.content.barbers.map((b) => [b.id, b]));
    return this.service()
      .offerings.flatMap((offering) => {
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
      .map((id) => this.content.allServices.find((s) => s.id === id))
      .filter((s): s is ServiceVm => Boolean(s));
  });

  /** Display strings for the capsule lists (locale-reactive). */
  protected readonly variantNames = computed<readonly string[]>(() =>
    this.service().variants.map((variant) => this.content.text(variant.name)),
  );

  protected readonly includedNames = computed<readonly string[]>(() =>
    this.includedServices().map((included) => this.content.text(included.name)),
  );

  constructor() {
    afterNextRender(() => this.sheetOpen.set(true));
    this.destroyRef.onDestroy(() => window.clearTimeout(this.closeTimer));
  }

  protected close(): void {
    if (!this.sheetOpen() || this.sheetClosing()) return;
    this.sheetOpen.set(false);
    this.sheetClosing.set(true);
    const reducedMotion =
      isPlatformBrowser(this.platformId) &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.closeTimer = window.setTimeout(
      () => {
        this.sheetClosing.set(false);
        this.closed.emit();
      },
      reducedMotion ? 0 : CLOSE_ANIMATION_MS,
    );
  }
}
