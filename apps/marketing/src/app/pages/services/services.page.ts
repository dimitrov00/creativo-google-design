import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { CursorTargetDirective } from '@creativo/shared/cursor';
import { ModalSheetComponent } from '../../shared/modal-sheet/modal-sheet.component';

interface ServiceExample {
  readonly image: string;
  readonly barberKey: string;
  readonly locationKey: string;
  readonly dateKey: string;
  readonly appointmentRef: string;
}

interface ServicePerformer {
  readonly nameKey: string;
  readonly roleKey: string;
  readonly image: string;
  readonly durationKey: string;
  readonly priceKey: string;
}

interface CatalogServiceItem {
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly priceKey: string;
  readonly labelKey: string;
  readonly durationKey: string;
  readonly image: string;
  readonly variantKeys: readonly string[];
  readonly examples: readonly ServiceExample[];
  readonly performers: readonly ServicePerformer[];
}

@Component({
  selector: 'cr-services-page',
  imports: [CursorTargetDirective, ModalSheetComponent, TranslocoDirective],
  templateUrl: './services.page.html',
  styleUrl: './services.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServicesPage implements AfterViewInit {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private closeAnimationTimer: number | undefined;

  protected readonly services: readonly CatalogServiceItem[] = [
    {
      titleKey: 'marketing.services.items.signature.title',
      bodyKey: 'marketing.services.items.signature.body',
      priceKey: 'marketing.services.items.signature.price',
      labelKey: 'marketing.servicesPage.labels.shape',
      durationKey: 'marketing.servicesPage.durations.m45',
      image: '/work/scissors-trim.jpg',
      variantKeys: [
        'marketing.servicesPage.variants.short',
        'marketing.servicesPage.variants.medium',
        'marketing.servicesPage.variants.long',
        'marketing.servicesPage.variants.natural',
      ],
      examples: [
        {
          image: '/work/scissors-trim.jpg',
          barberKey: 'marketing.team.ivan.name',
          locationKey: 'marketing.servicesPage.locations.center',
          dateKey: 'marketing.servicesPage.dates.may',
          appointmentRef: 'CR-0526-118',
        },
        {
          image: '/work/modern-cut.jpg',
          barberKey: 'marketing.team.stefan.name',
          locationKey: 'marketing.servicesPage.locations.mladost',
          dateKey: 'marketing.servicesPage.dates.april',
          appointmentRef: 'CR-0426-084',
        },
        {
          image: '/work/finishing-touch.jpg',
          barberKey: 'marketing.team.niko.name',
          locationKey: 'marketing.servicesPage.locations.center',
          dateKey: 'marketing.servicesPage.dates.march',
          appointmentRef: 'CR-0326-211',
        },
        {
          image: '/work/fade-styling.jpg',
          barberKey: 'marketing.team.niko.name',
          locationKey: 'marketing.servicesPage.locations.mladost',
          dateKey: 'marketing.servicesPage.dates.may',
          appointmentRef: 'CR-0526-224',
        },
        {
          image: '/work/beard-shave.jpg',
          barberKey: 'marketing.team.stefan.name',
          locationKey: 'marketing.servicesPage.locations.center',
          dateKey: 'marketing.servicesPage.dates.april',
          appointmentRef: 'CR-0426-231',
        },
        {
          image: '/work/classic-clippers.jpg',
          barberKey: 'marketing.team.ivan.name',
          locationKey: 'marketing.servicesPage.locations.mladost',
          dateKey: 'marketing.servicesPage.dates.march',
          appointmentRef: 'CR-0326-246',
        },
      ],
      performers: [
        {
          nameKey: 'marketing.team.ivan.name',
          roleKey: 'marketing.team.ivan.specialty',
          image: '/barbers/ivan.jpg',
          durationKey: 'marketing.servicesPage.durations.m45',
          priceKey: 'marketing.services.items.signature.price',
        },
        {
          nameKey: 'marketing.team.stefan.name',
          roleKey: 'marketing.team.stefan.specialty',
          image: '/barbers/stefan.jpg',
          durationKey: 'marketing.servicesPage.durations.m50',
          priceKey: 'marketing.services.items.signature.price',
        },
      ],
    },
    {
      titleKey: 'marketing.services.items.fade.title',
      bodyKey: 'marketing.services.items.fade.body',
      priceKey: 'marketing.services.items.fade.price',
      labelKey: 'marketing.servicesPage.labels.gradient',
      durationKey: 'marketing.servicesPage.durations.m50',
      image: '/work/fade-styling.jpg',
      variantKeys: [
        'marketing.servicesPage.variants.lowFade',
        'marketing.servicesPage.variants.midFade',
        'marketing.servicesPage.variants.highFade',
        'marketing.servicesPage.variants.skinFade',
      ],
      examples: [
        {
          image: '/work/fade-styling.jpg',
          barberKey: 'marketing.team.niko.name',
          locationKey: 'marketing.servicesPage.locations.mladost',
          dateKey: 'marketing.servicesPage.dates.may',
          appointmentRef: 'CR-0526-136',
        },
        {
          image: '/work/classic-clippers.jpg',
          barberKey: 'marketing.team.ivan.name',
          locationKey: 'marketing.servicesPage.locations.center',
          dateKey: 'marketing.servicesPage.dates.april',
          appointmentRef: 'CR-0426-102',
        },
        {
          image: '/work/finishing-touch.jpg',
          barberKey: 'marketing.team.niko.name',
          locationKey: 'marketing.servicesPage.locations.mladost',
          dateKey: 'marketing.servicesPage.dates.march',
          appointmentRef: 'CR-0326-194',
        },
        {
          image: '/work/modern-cut.jpg',
          barberKey: 'marketing.team.ivan.name',
          locationKey: 'marketing.servicesPage.locations.center',
          dateKey: 'marketing.servicesPage.dates.may',
          appointmentRef: 'CR-0526-257',
        },
        {
          image: '/work/scissors-trim.jpg',
          barberKey: 'marketing.team.stefan.name',
          locationKey: 'marketing.servicesPage.locations.center',
          dateKey: 'marketing.servicesPage.dates.april',
          appointmentRef: 'CR-0426-268',
        },
      ],
      performers: [
        {
          nameKey: 'marketing.team.niko.name',
          roleKey: 'marketing.team.niko.specialty',
          image: '/barbers/niko.jpg',
          durationKey: 'marketing.servicesPage.durations.m50',
          priceKey: 'marketing.services.items.fade.price',
        },
        {
          nameKey: 'marketing.team.ivan.name',
          roleKey: 'marketing.team.ivan.specialty',
          image: '/barbers/ivan.jpg',
          durationKey: 'marketing.servicesPage.durations.m55',
          priceKey: 'marketing.services.items.fade.price',
        },
      ],
    },
    {
      titleKey: 'marketing.services.items.beard.title',
      bodyKey: 'marketing.services.items.beard.body',
      priceKey: 'marketing.services.items.beard.price',
      labelKey: 'marketing.servicesPage.labels.contour',
      durationKey: 'marketing.servicesPage.durations.m30',
      image: '/work/beard-shave.jpg',
      variantKeys: [
        'marketing.servicesPage.variants.shortBeard',
        'marketing.servicesPage.variants.longBeard',
        'marketing.servicesPage.variants.razorContour',
        'marketing.servicesPage.variants.skinCare',
      ],
      examples: [
        {
          image: '/work/beard-shave.jpg',
          barberKey: 'marketing.team.stefan.name',
          locationKey: 'marketing.servicesPage.locations.center',
          dateKey: 'marketing.servicesPage.dates.may',
          appointmentRef: 'CR-0526-041',
        },
        {
          image: '/work/finishing-touch.jpg',
          barberKey: 'marketing.team.ivan.name',
          locationKey: 'marketing.servicesPage.locations.mladost',
          dateKey: 'marketing.servicesPage.dates.april',
          appointmentRef: 'CR-0426-159',
        },
        {
          image: '/work/classic-clippers.jpg',
          barberKey: 'marketing.team.stefan.name',
          locationKey: 'marketing.servicesPage.locations.center',
          dateKey: 'marketing.servicesPage.dates.march',
          appointmentRef: 'CR-0326-066',
        },
      ],
      performers: [
        {
          nameKey: 'marketing.team.stefan.name',
          roleKey: 'marketing.team.stefan.specialty',
          image: '/barbers/stefan.jpg',
          durationKey: 'marketing.servicesPage.durations.m30',
          priceKey: 'marketing.services.items.beard.price',
        },
        {
          nameKey: 'marketing.team.ivan.name',
          roleKey: 'marketing.team.ivan.specialty',
          image: '/barbers/ivan.jpg',
          durationKey: 'marketing.servicesPage.durations.m35',
          priceKey: 'marketing.services.items.beard.price',
        },
      ],
    },
    {
      titleKey: 'marketing.services.items.ritual.title',
      bodyKey: 'marketing.services.items.ritual.body',
      priceKey: 'marketing.services.items.ritual.price',
      labelKey: 'marketing.servicesPage.labels.complete',
      durationKey: 'marketing.servicesPage.durations.m80',
      image: '/work/classic-clippers.jpg',
      variantKeys: [
        'marketing.servicesPage.variants.cutBeard',
        'marketing.servicesPage.variants.hotTowel',
        'marketing.servicesPage.variants.skinCare',
        'marketing.servicesPage.variants.fullFinish',
      ],
      examples: [
        {
          image: '/work/classic-clippers.jpg',
          barberKey: 'marketing.team.ivan.name',
          locationKey: 'marketing.servicesPage.locations.mladost',
          dateKey: 'marketing.servicesPage.dates.may',
          appointmentRef: 'CR-0526-017',
        },
        {
          image: '/work/beard-shave.jpg',
          barberKey: 'marketing.team.stefan.name',
          locationKey: 'marketing.servicesPage.locations.center',
          dateKey: 'marketing.servicesPage.dates.april',
          appointmentRef: 'CR-0426-127',
        },
        {
          image: '/work/scissors-trim.jpg',
          barberKey: 'marketing.team.niko.name',
          locationKey: 'marketing.servicesPage.locations.mladost',
          dateKey: 'marketing.servicesPage.dates.march',
          appointmentRef: 'CR-0326-088',
        },
        {
          image: '/work/fade-styling.jpg',
          barberKey: 'marketing.team.niko.name',
          locationKey: 'marketing.servicesPage.locations.mladost',
          dateKey: 'marketing.servicesPage.dates.may',
          appointmentRef: 'CR-0526-279',
        },
        {
          image: '/work/modern-cut.jpg',
          barberKey: 'marketing.team.ivan.name',
          locationKey: 'marketing.servicesPage.locations.center',
          dateKey: 'marketing.servicesPage.dates.april',
          appointmentRef: 'CR-0426-284',
        },
        {
          image: '/work/finishing-touch.jpg',
          barberKey: 'marketing.team.stefan.name',
          locationKey: 'marketing.servicesPage.locations.center',
          dateKey: 'marketing.servicesPage.dates.march',
          appointmentRef: 'CR-0326-296',
        },
      ],
      performers: [
        {
          nameKey: 'marketing.team.ivan.name',
          roleKey: 'marketing.team.ivan.specialty',
          image: '/barbers/ivan.jpg',
          durationKey: 'marketing.servicesPage.durations.m80',
          priceKey: 'marketing.services.items.ritual.price',
        },
        {
          nameKey: 'marketing.team.stefan.name',
          roleKey: 'marketing.team.stefan.specialty',
          image: '/barbers/stefan.jpg',
          durationKey: 'marketing.servicesPage.durations.m85',
          priceKey: 'marketing.services.items.ritual.price',
        },
      ],
    },
    {
      titleKey: 'marketing.services.items.long.title',
      bodyKey: 'marketing.services.items.long.body',
      priceKey: 'marketing.services.items.long.price',
      labelKey: 'marketing.servicesPage.labels.movement',
      durationKey: 'marketing.servicesPage.durations.m55',
      image: '/work/modern-cut.jpg',
      variantKeys: [
        'marketing.servicesPage.variants.medium',
        'marketing.servicesPage.variants.long',
        'marketing.servicesPage.variants.layers',
        'marketing.servicesPage.variants.natural',
      ],
      examples: [
        {
          image: '/work/modern-cut.jpg',
          barberKey: 'marketing.team.ivan.name',
          locationKey: 'marketing.servicesPage.locations.center',
          dateKey: 'marketing.servicesPage.dates.may',
          appointmentRef: 'CR-0526-074',
        },
        {
          image: '/work/scissors-trim.jpg',
          barberKey: 'marketing.team.stefan.name',
          locationKey: 'marketing.servicesPage.locations.center',
          dateKey: 'marketing.servicesPage.dates.april',
          appointmentRef: 'CR-0426-063',
        },
        {
          image: '/work/finishing-touch.jpg',
          barberKey: 'marketing.team.ivan.name',
          locationKey: 'marketing.servicesPage.locations.mladost',
          dateKey: 'marketing.servicesPage.dates.march',
          appointmentRef: 'CR-0326-172',
        },
      ],
      performers: [
        {
          nameKey: 'marketing.team.ivan.name',
          roleKey: 'marketing.team.ivan.specialty',
          image: '/barbers/ivan.jpg',
          durationKey: 'marketing.servicesPage.durations.m55',
          priceKey: 'marketing.services.items.long.price',
        },
        {
          nameKey: 'marketing.team.stefan.name',
          roleKey: 'marketing.team.stefan.specialty',
          image: '/barbers/stefan.jpg',
          durationKey: 'marketing.servicesPage.durations.m60',
          priceKey: 'marketing.services.items.long.price',
        },
      ],
    },
    {
      titleKey: 'marketing.services.items.styling.title',
      bodyKey: 'marketing.services.items.styling.body',
      priceKey: 'marketing.services.items.styling.price',
      labelKey: 'marketing.servicesPage.labels.finish',
      durationKey: 'marketing.servicesPage.durations.m25',
      image: '/work/finishing-touch.jpg',
      variantKeys: [
        'marketing.servicesPage.variants.everyday',
        'marketing.servicesPage.variants.event',
        'marketing.servicesPage.variants.volume',
        'marketing.servicesPage.variants.texture',
      ],
      examples: [
        {
          image: '/work/finishing-touch.jpg',
          barberKey: 'marketing.team.niko.name',
          locationKey: 'marketing.servicesPage.locations.mladost',
          dateKey: 'marketing.servicesPage.dates.may',
          appointmentRef: 'CR-0526-205',
        },
        {
          image: '/work/modern-cut.jpg',
          barberKey: 'marketing.team.ivan.name',
          locationKey: 'marketing.servicesPage.locations.center',
          dateKey: 'marketing.servicesPage.dates.april',
          appointmentRef: 'CR-0426-098',
        },
        {
          image: '/work/fade-styling.jpg',
          barberKey: 'marketing.team.niko.name',
          locationKey: 'marketing.servicesPage.locations.mladost',
          dateKey: 'marketing.servicesPage.dates.march',
          appointmentRef: 'CR-0326-143',
        },
      ],
      performers: [
        {
          nameKey: 'marketing.team.niko.name',
          roleKey: 'marketing.team.niko.specialty',
          image: '/barbers/niko.jpg',
          durationKey: 'marketing.servicesPage.durations.m25',
          priceKey: 'marketing.services.items.styling.price',
        },
        {
          nameKey: 'marketing.team.ivan.name',
          roleKey: 'marketing.team.ivan.specialty',
          image: '/barbers/ivan.jpg',
          durationKey: 'marketing.servicesPage.durations.m30',
          priceKey: 'marketing.services.items.styling.price',
        },
      ],
    },
  ];

  protected readonly activeServiceIndex = signal(0);
  protected readonly sheetOpen = signal(false);
  protected readonly sheetClosing = signal(false);
  protected readonly sheetHeaderCondensed = signal(false);
  protected readonly sheetBookingBarVisible = signal(false);
  protected readonly showcasedImageIndex = signal(0);
  protected readonly galleryExpanded = signal(false);
  protected readonly activeService = computed(
    () => this.services[this.activeServiceIndex()] ?? this.services[0],
  );

  protected barberRoleKey(nameKey: string): string {
    return nameKey.replace(/\.name$/, '.role');
  }

  protected setGalleryLayout(expanding: boolean): void {
    if (this.galleryExpanded() === expanding) return;
    if (!isPlatformBrowser(this.platformId)) {
      this.galleryExpanded.set(expanding);
      return;
    }

    const showcase =
      this.elementRef.nativeElement.querySelector<HTMLElement>(
        '.service-showcase',
      );
    const figures = Array.from(
      showcase?.querySelectorAll<HTMLElement>('figure') ?? [],
    );
    const firstRects = figures.map((figure) => figure.getBoundingClientRect());
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    this.galleryExpanded.set(expanding);
    if (!showcase || reducedMotion || typeof showcase.animate !== 'function') {
      return;
    }

    requestAnimationFrame(() => {
      const nextFigures = Array.from(
        showcase.querySelectorAll<HTMLElement>('figure'),
      );
      nextFigures.forEach((figure, index) => {
        const first = firstRects[index];
        const last = figure.getBoundingClientRect();
        if (!first || last.width === 0 || last.height === 0) return;

        const deltaX = first.left - last.left;
        const deltaY = first.top - last.top;
        const scaleX = first.width / last.width;
        const scaleY = first.height / last.height;
        const remainsVisible =
          expanding || index === this.showcasedImageIndex();

        figure.animate(
          [
            {
              opacity: expanding
                ? index === this.showcasedImageIndex()
                  ? 1
                  : 0
                : 1,
              transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
              transformOrigin: 'top left',
            },
            {
              opacity: remainsVisible ? 1 : 0,
              transform: 'translate(0, 0) scale(1)',
              transformOrigin: 'top left',
            },
          ],
          {
            duration: 820,
            delay: index * 55,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          },
        );
      });
    });
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const host = this.elementRef.nativeElement;
    const cleanups: Array<() => void> = [];

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (!reducedMotion && typeof IntersectionObserver === 'function') {
      host.classList.add('motion-ready');
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            (entry.target as HTMLElement).classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        },
        { rootMargin: '0px 0px -7% 0px', threshold: 0.08 },
      );

      host
        .querySelectorAll<HTMLElement>('[data-service-reveal]')
        .forEach((element) => observer.observe(element));
      cleanups.push(() => observer.disconnect());
    }

    this.destroyRef.onDestroy(() => {
      cleanups.forEach((cleanup) => cleanup());
      if (this.closeAnimationTimer !== undefined) {
        window.clearTimeout(this.closeAnimationTimer);
      }
    });
  }

  protected onServiceCardKeydown(index: number, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.openService(index);
  }

  protected openService(index: number): void {
    this.activeServiceIndex.set(index);
    this.sheetOpen.set(true);
    this.sheetClosing.set(false);
    this.sheetHeaderCondensed.set(false);
    this.sheetBookingBarVisible.set(false);
    this.showcasedImageIndex.set(0);
    this.galleryExpanded.set(false);
  }

  protected closeService(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (!this.sheetOpen() || this.sheetClosing()) return;

    this.sheetClosing.set(true);

    if (this.closeAnimationTimer !== undefined) {
      window.clearTimeout(this.closeAnimationTimer);
    }
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    this.closeAnimationTimer = window.setTimeout(
      () => this.finishClosing(),
      reducedMotion ? 0 : 380,
    );
  }

  protected onSheetScroll(scroller: HTMLElement): void {
    const sheet = scroller.closest<HTMLElement>('.modal-sheet');
    const title = scroller.querySelector<HTMLElement>(
      '.service-sheet__intro h2',
    );
    const toolbar = sheet?.querySelector<HTMLElement>('.modal-sheet__toolbar');
    if (title && toolbar) {
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
    if (bookingCta && toolbar) {
      const bookingBarVisible =
        bookingCta.getBoundingClientRect().bottom <=
        toolbar.getBoundingClientRect().bottom;
      if (bookingBarVisible !== this.sheetBookingBarVisible()) {
        this.sheetBookingBarVisible.set(bookingBarVisible);
      }
    }

    const imageCount = this.activeService()?.examples.length ?? 0;
    if (imageCount > 1 && !this.galleryExpanded()) {
      const scrollable = Math.max(
        1,
        scroller.scrollHeight - scroller.clientHeight,
      );
      const progress = Math.min(
        1,
        Math.max(0, scroller.scrollTop / scrollable),
      );
      const imageIndex = Math.min(
        imageCount - 1,
        Math.floor(progress * imageCount),
      );
      if (imageIndex !== this.showcasedImageIndex()) {
        this.showcasedImageIndex.set(imageIndex);
      }
    }
  }

  protected onSheetClosed(): void {
    this.sheetOpen.set(false);
    this.sheetClosing.set(false);
    this.sheetHeaderCondensed.set(false);
    this.sheetBookingBarVisible.set(false);
    this.showcasedImageIndex.set(0);
    this.galleryExpanded.set(false);
  }

  private finishClosing(): void {
    this.closeAnimationTimer = undefined;
    this.onSheetClosed();
  }
}
