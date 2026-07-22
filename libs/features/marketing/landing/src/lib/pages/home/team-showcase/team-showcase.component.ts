import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiAvatar, UiButton } from '@creativo/ui/controls';
import {
  UiInteractiveDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { UiSectionHeader } from '@creativo/ui/patterns';
import { ModalSheetComponent } from '../../../shared/modal-sheet/modal-sheet.component';
import { ShowcaseGalleryComponent } from '../../../shared/showcase-gallery/showcase-gallery.component';

interface BarberItem {
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
    ModalSheetComponent,
    ShowcaseGalleryComponent,
    TranslocoDirective,
    UiAvatar,
    UiButton,
    UiInteractiveDirective,
    UiSectionHeader,
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
  private readonly destroyRef = inject(DestroyRef);
  private closeTimer: number | undefined;

  protected readonly barbers: readonly BarberItem[] = [
    {
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

  protected readonly activeBarberIndex = signal(0);
  protected readonly sheetOpen = signal(false);
  protected readonly sheetClosing = signal(false);
  protected readonly activeBarber = computed(
    () => this.barbers[this.activeBarberIndex()] ?? this.barbers[0],
  );

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (isPlatformBrowser(this.platformId) && this.closeTimer !== undefined) {
        window.clearTimeout(this.closeTimer);
      }
    });
  }

  protected onCardKeydown(index: number, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.openBarber(index);
  }

  protected openBarber(index: number): void {
    this.activeBarberIndex.set(index);
    this.sheetOpen.set(true);
    this.sheetClosing.set(false);
  }

  protected closeBarber(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.sheetOpen() || this.sheetClosing()) return;

    this.sheetClosing.set(true);
    if (this.closeTimer !== undefined) window.clearTimeout(this.closeTimer);
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    this.closeTimer = window.setTimeout(
      () => this.finishClosing(),
      reducedMotion ? 0 : 300, // sheet exit = opacity track (deliberate, 300ms)
    );
  }

  private finishClosing(): void {
    this.closeTimer = undefined;
    this.sheetOpen.set(false);
    this.sheetClosing.set(false);
  }
}
