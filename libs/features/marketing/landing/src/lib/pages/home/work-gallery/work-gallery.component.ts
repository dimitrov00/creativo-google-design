import { isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { CursorTargetDirective } from '@creativo/shared/cursor';
import { Button, CrText } from '@creativo/shared/ui';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { attachPointerTilt } from '../../../shared/motion/pointer-tilt';

interface GalleryItem {
  readonly image: string;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly altKey: string;
}

const TILT_ANGLES = [-4, 5, -6, 4, -5, 6] as const;

@Component({
  selector: 'cr-work-gallery',
  imports: [Button, CrText, CursorTargetDirective, TranslocoDirective],
  templateUrl: './work-gallery.component.html',
  styleUrl: './work-gallery.component.css',
  host: { style: 'display: contents' },
})
export class WorkGalleryComponent implements AfterViewInit {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  private context: gsap.Context | undefined;
  private cleanups: Array<() => void> = [];

  protected readonly galleryItems: readonly GalleryItem[] = [
    {
      image: '/work/scissors-trim.jpg',
      titleKey: 'marketing.work.items.precision.title',
      bodyKey: 'marketing.work.items.precision.body',
      altKey: 'marketing.work.items.precision.alt',
    },
    {
      image: '/work/modern-cut.jpg',
      titleKey: 'marketing.work.items.texture.title',
      bodyKey: 'marketing.work.items.texture.body',
      altKey: 'marketing.work.items.texture.alt',
    },
    {
      image: '/work/classic-clippers.jpg',
      titleKey: 'marketing.work.items.structure.title',
      bodyKey: 'marketing.work.items.structure.body',
      altKey: 'marketing.work.items.structure.alt',
    },
    {
      image: '/work/fade-styling.jpg',
      titleKey: 'marketing.work.items.gradient.title',
      bodyKey: 'marketing.work.items.gradient.body',
      altKey: 'marketing.work.items.gradient.alt',
    },
    {
      image: '/work/beard-shave.jpg',
      titleKey: 'marketing.work.items.contour.title',
      bodyKey: 'marketing.work.items.contour.body',
      altKey: 'marketing.work.items.contour.alt',
    },
    {
      image: '/work/finishing-touch.jpg',
      titleKey: 'marketing.work.items.finish.title',
      bodyKey: 'marketing.work.items.finish.body',
      altKey: 'marketing.work.items.finish.alt',
    },
  ];

  protected readonly activeIndex = signal(0);
  protected readonly total = this.galleryItems.length;

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    gsap.registerPlugin(ScrollTrigger);
    // Mobile browsers change the viewport's reported height when the
    // address bar/toolbar hides or shows *during* a scroll gesture, which
    // fires a `resize` event mid-scroll. ScrollTrigger's own built-in resize
    // handling would otherwise treat that as a real layout change and
    // refresh (re-measure + re-pin) while the user is actively flicking
    // through the pinned track — that remeasure-mid-gesture is what was
    // causing cards to flash blank/stuck-blurred. This tells it to ignore
    // resizes that are just toolbar show/hide noise on touch devices.
    ScrollTrigger.config({ ignoreMobileResize: true });
    this.build();

    this.destroyRef.onDestroy(() => {
      this.cleanups.forEach((cleanup) => cleanup());
      this.cleanups = [];
      this.context?.revert();
    });
  }

  protected pad(value: number): string {
    return value < 10 ? `0${value}` : `${value}`;
  }

  private build(): void {
    this.context?.revert();
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];

    const host = this.elementRef.nativeElement;
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    if (reducedMotion) {
      this.context = gsap.context(() => undefined, host);
      return;
    }

    this.context = gsap.context(() => this.buildPinned(host), host);
  }

  private buildPinned(host: HTMLElement): void {
    const section = host.querySelector<HTMLElement>(
      '[data-work-gallery-section]',
    );
    const sticky = host.querySelector<HTMLElement>(
      '[data-work-gallery-sticky]',
    );
    const track = host.querySelector<HTMLElement>('[data-work-gallery-track]');
    const cards = Array.from(
      host.querySelectorAll<HTMLElement>('[data-work-gallery-card]'),
    );
    const endPanel = host.querySelector<HTMLElement>('[data-work-gallery-end]');
    if (!section || !sticky || !track) return;

    gsap.set(cards, { autoAlpha: 0 });

    const scrollTween = gsap.to(track, {
      x: () => -(track.scrollWidth - sticky.clientWidth),
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top top',
        end: () => `+=${track.scrollWidth - sticky.clientWidth}`,
        scrub: 0.65,
        fastScrollEnd: true,
        pin: sticky,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) =>
          section.style.setProperty(
            '--work-gallery-progress',
            self.progress.toFixed(4),
          ),
      },
    });

    cards.forEach((card, index) => {
      const frame = card.querySelector<HTMLElement>(
        '[data-work-gallery-frame]',
      );
      const image = card.querySelector<HTMLElement>(
        '[data-work-gallery-image]',
      );
      const tilt = TILT_ANGLES[index % TILT_ANGLES.length];

      gsap.fromTo(
        card,
        {
          autoAlpha: 0,
          scale: 0.82,
          y: 70,
          rotate: tilt,
          filter: 'blur(18px)',
        },
        {
          autoAlpha: 1,
          scale: 1,
          y: 0,
          rotate: 0,
          filter: 'blur(0px)',
          ease: 'power2.out',
          scrollTrigger: {
            trigger: card,
            containerAnimation: scrollTween,
            start: 'left 88%',
            end: 'left 42%',
            scrub: 0.4,
            fastScrollEnd: true,
          },
        },
      );

      gsap.to(card, {
        autoAlpha: 0.12,
        scale: 0.88,
        filter: 'blur(10px)',
        ease: 'power1.in',
        scrollTrigger: {
          trigger: card,
          containerAnimation: scrollTween,
          start: 'right 45%',
          end: 'right -10%',
          scrub: 0.4,
          fastScrollEnd: true,
        },
      });

      ScrollTrigger.create({
        trigger: card,
        containerAnimation: scrollTween,
        start: 'left center',
        end: 'right center',
        onToggle: (self) => {
          if (self.isActive) this.activeIndex.set(index);
        },
      });

      if (image) {
        gsap.fromTo(
          image,
          { xPercent: -10, scale: 1.16 },
          {
            xPercent: 10,
            scale: 1.05,
            ease: 'none',
            scrollTrigger: {
              trigger: card,
              containerAnimation: scrollTween,
              start: 'left right',
              end: 'right left',
              scrub: 0.4,
              fastScrollEnd: true,
            },
          },
        );
      }

      if (frame && window.matchMedia('(pointer: fine)').matches) {
        this.cleanups.push(attachPointerTilt(frame));
      }
    });

    if (endPanel) {
      gsap.fromTo(
        endPanel.querySelectorAll('[data-work-gallery-end-reveal]'),
        { autoAlpha: 0, y: 40 },
        {
          autoAlpha: 1,
          y: 0,
          stagger: 0.08,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: endPanel,
            containerAnimation: scrollTween,
            start: 'left 75%',
            end: 'left 30%',
            scrub: 0.4,
            fastScrollEnd: true,
          },
        },
      );
    }
  }
}
