import {
  ChangeDetectionStrategy,
  Component,
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
import { UiGrid, UiSpacer, UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import {
  UiCard,
  UiListGroup,
  UiListRow,
  UiRating,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import { LandingContentService } from '../../content/landing-content.service';
import {
  type BarberVm,
  type ServiceVm,
  serviceDurationRange,
  servicePriceFrom,
} from '../../content/landing-content';
import { UiModalSheet } from '@creativo/ui/controls';
import { ShowcaseGalleryComponent } from '../../shared/showcase-gallery/showcase-gallery.component';
import { CapsuleListComponent } from './capsule-list.component';

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
  selector: 'cr-service-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CapsuleListComponent,
    UiModalSheet,
    RouterLink,
    ShowcaseGalleryComponent,
    TranslocoDirective,
    UiAvatar,
    UiBadge,
    UiButton,
    UiCard,
    UiGrid,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiRating,
    UiSheetActionBar,
    UiSpacer,
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

  /** Mounts shut, opens next frame so the sheet animates in. */
  protected readonly sheetOpen = signal(false);
  protected readonly sheetClosing = signal(false);

  /** Sheet chrome state — gallery + performer layout modes. (The condensed
   *  toolbar title is ui-sheet-header's own sentinel-observed behavior, and
   *  the booking bar is always visible — zero scroll wiring here.) */
  protected readonly galleryExpanded = signal(false);
  /** Grid is the default performer reading — the 2-up contact-card layout
   *  reads faster at a glance than a name-by-name list (owner ruling
   *  2026-07-24); the toggle still offers the list for a denser scan. */
  protected readonly performersGrid = signal(true);

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
  }

  protected close(): void {
    if (!this.sheetOpen() || this.sheetClosing()) return;
    // No timer: close completion is driven by the sheet's own exit
    // transition (ui-modal-sheet's closeFinished) so the CSS motion tokens
    // stay the single source of truth for the exit duration.
    this.sheetOpen.set(false);
    this.sheetClosing.set(true);
  }

  protected finishClosing(): void {
    if (!this.sheetClosing()) return;
    this.sheetClosing.set(false);
    this.closed.emit();
  }
}
