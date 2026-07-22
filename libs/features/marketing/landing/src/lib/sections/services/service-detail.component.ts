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
import { UiButton } from '@creativo/ui/controls';
import { LandingContentService } from '../../content/landing-content.service';
import {
  type BarberVm,
  type ServiceVm,
  serviceDurationRange,
  servicePriceFrom,
} from '../../content/landing-content';
import { CrIcon } from '../../shared/icons/icons';
import {
  ModalSheetComponent,
  type ModalSheetScrollEvent,
} from '../../shared/modal-sheet/modal-sheet.component';
import { ShowcaseGalleryComponent } from '../../shared/showcase-gallery/showcase-gallery.component';

/** One performer card — a barber with their own terms for this service. */
interface PerformerVm {
  readonly barber: BarberVm;
  readonly price: number;
  readonly minutes: number;
}

const CLOSE_ANIMATION_MS = 380;

/**
 * The service-detail bottom sheet in the pre-migration landing's design
 * (kept by design call over v2's shell): showcase gallery on top, the
 * editorial story (eyebrow + title + summary with duration/price and an
 * inline book CTA), capsule variant chips, the bundle "includes" list in the
 * same chip language, and the performer cards — here ENRICHED with each
 * barber's own price/duration for this service — plus the old page's
 * scroll-revealed bottom booking bar. Title sizes are adapted to the sys
 * type ramp (title/title3) instead of the old oversized display cuts.
 */
@Component({
  selector: 'cr-service-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CrIcon,
    ModalSheetComponent,
    RouterLink,
    ShowcaseGalleryComponent,
    TranslocoDirective,
    UiButton,
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

  /** Old-page sheet chrome state — condensed toolbar title, scroll-revealed
   *  booking bar, gallery scroll progress + expansion. */
  protected readonly sheetHeaderCondensed = signal(false);
  protected readonly sheetBookingBarVisible = signal(false);
  protected readonly sheetScrollProgress = signal(0);
  protected readonly galleryExpanded = signal(false);

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

  constructor() {
    afterNextRender(() => this.sheetOpen.set(true));
    this.destroyRef.onDestroy(() => window.clearTimeout(this.closeTimer));
  }

  /** Old services.page scroll wiring: the toolbar title condenses in once
   *  the intro heading scrolls under the toolbar; the booking bar reveals
   *  once the inline summary CTA scrolls out of view. */
  protected onSheetScroll({ scroller, progress }: ModalSheetScrollEvent): void {
    this.sheetScrollProgress.set(progress);
    const sheet = scroller.closest<HTMLElement>('.modal-sheet');
    const toolbar = sheet?.querySelector<HTMLElement>('.modal-sheet__toolbar');
    if (!toolbar) return;

    const title = scroller.querySelector<HTMLElement>(
      '.service-sheet__intro h2',
    );
    if (title) {
      const condensed =
        title.getBoundingClientRect().bottom <=
        toolbar.getBoundingClientRect().bottom + 4;
      if (condensed !== this.sheetHeaderCondensed()) {
        this.sheetHeaderCondensed.set(condensed);
      }
    }

    const bookingCta = scroller.querySelector<HTMLElement>(
      '.service-sheet__summary > a',
    );
    if (bookingCta) {
      const visible =
        bookingCta.getBoundingClientRect().bottom <=
        toolbar.getBoundingClientRect().bottom;
      if (visible !== this.sheetBookingBarVisible()) {
        this.sheetBookingBarVisible.set(visible);
      }
    }
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
