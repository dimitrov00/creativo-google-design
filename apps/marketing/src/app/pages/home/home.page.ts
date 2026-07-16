import { DOCUMENT, isPlatformBrowser } from '@angular/common';
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
import { ServicesPage } from '../services/services.page';
import { TeamShowcaseComponent } from './team-showcase/team-showcase.component';

interface GalleryItem {
  readonly image: string;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly altKey: string;
  readonly className: string;
}

@Component({
  selector: 'cr-home-page',
  imports: [
    CursorTargetDirective,
    ServicesPage,
    TeamShowcaseComponent,
    TranslocoDirective,
  ],
  templateUrl: './home.page.html',
  styleUrl: './home.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage implements AfterViewInit {
  private readonly document = inject(DOCUMENT);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly heroPaused = signal(false);
  protected readonly activeGalleryIndex = signal(0);

  protected readonly galleryItems: readonly GalleryItem[] = [
    {
      image: '/work/scissors-trim.jpg',
      titleKey: 'marketing.work.items.precision.title',
      bodyKey: 'marketing.work.items.precision.body',
      altKey: 'marketing.work.items.precision.alt',
      className: 'work-card--one',
    },
    {
      image: '/work/modern-cut.jpg',
      titleKey: 'marketing.work.items.texture.title',
      bodyKey: 'marketing.work.items.texture.body',
      altKey: 'marketing.work.items.texture.alt',
      className: 'work-card--two',
    },
    {
      image: '/work/classic-clippers.jpg',
      titleKey: 'marketing.work.items.structure.title',
      bodyKey: 'marketing.work.items.structure.body',
      altKey: 'marketing.work.items.structure.alt',
      className: 'work-card--three',
    },
    {
      image: '/work/fade-styling.jpg',
      titleKey: 'marketing.work.items.gradient.title',
      bodyKey: 'marketing.work.items.gradient.body',
      altKey: 'marketing.work.items.gradient.alt',
      className: 'work-card--four',
    },
    {
      image: '/work/beard-shave.jpg',
      titleKey: 'marketing.work.items.contour.title',
      bodyKey: 'marketing.work.items.contour.body',
      altKey: 'marketing.work.items.contour.alt',
      className: 'work-card--five',
    },
    {
      image: '/work/finishing-touch.jpg',
      titleKey: 'marketing.work.items.finish.title',
      bodyKey: 'marketing.work.items.finish.body',
      altKey: 'marketing.work.items.finish.alt',
      className: 'work-card--six',
    },
  ];

  protected readonly activeGalleryItem = computed(
    () => this.galleryItems[this.activeGalleryIndex()] ?? this.galleryItems[0],
  );

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const host = this.elementRef.nativeElement;
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const hero = host.querySelector<HTMLElement>('.hero');
    const galleryScene = host.querySelector<HTMLElement>(
      '[data-gallery-scene]',
    );
    const galleryTrack = host.querySelector<HTMLElement>(
      '[data-gallery-track]',
    );
    const galleryCards = Array.from(
      host.querySelectorAll<HTMLElement>('[data-gallery-reveal]'),
    );
    const parallaxItems = Array.from(
      host.querySelectorAll<HTMLElement>('[data-parallax]'),
    );
    const toneSections = Array.from(
      host.querySelectorAll<HTMLElement>('[data-nav-tone]'),
    );
    const cleanups: Array<() => void> = [];
    let frame = 0;
    let currentTone = '';

    if (window.location.hash) {
      const targetId = decodeURIComponent(window.location.hash.slice(1));
      const alignToFragment = () => {
        const target = this.document.getElementById(targetId);
        if (!target) return;
        const top = target.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top: Math.max(0, top) });
      };
      requestAnimationFrame(() => requestAnimationFrame(alignToFragment));
      const fragmentTimer = window.setTimeout(alignToFragment, 700);
      window.addEventListener('load', alignToFragment, { once: true });
      cleanups.push(() => {
        window.clearTimeout(fragmentTimer);
        window.removeEventListener('load', alignToFragment);
      });
    }

    if (!reducedMotion) {
      host.classList.add('motion-ready');
      host
        .querySelectorAll<HTMLElement>('[data-hero-reveal]')
        .forEach((element, index) => {
          if (typeof element.animate !== 'function') return;
          element.animate(
            [
              {
                opacity: 0,
                transform: 'translateY(115%) rotate(2deg)',
                filter: 'blur(12px)',
              },
              {
                opacity: 1,
                transform: 'translateY(0) rotate(0)',
                filter: 'blur(0)',
              },
            ],
            {
              duration: 1050,
              delay: 100 + index * 150,
              easing: 'cubic-bezier(.16,1,.3,1)',
              fill: 'both',
            },
          );
        });
    }

    if (typeof IntersectionObserver === 'function') {
      const revealObserver = new IntersectionObserver(
        (entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            (entry.target as HTMLElement).classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        },
        { rootMargin: '0px 0px -7% 0px', threshold: 0.08 },
      );
      host
        .querySelectorAll<HTMLElement>('[data-reveal]')
        .forEach((element) => revealObserver.observe(element));
      cleanups.push(() => revealObserver.disconnect());
    }

    const clamp = (value: number) => Math.min(1, Math.max(0, value));

    const updateNavigationTone = () => {
      const center = window.innerHeight * 0.46;
      const active = toneSections.find((section) => {
        const rect = section.getBoundingClientRect();
        return rect.top <= center && rect.bottom > center;
      });
      const tone = active?.dataset['navTone'] ?? 'light';
      if (tone === currentTone) return;
      currentTone = tone;
      this.document.documentElement.setAttribute('data-nav-tone', tone);
    };

    const updateParallax = () => {
      if (reducedMotion) return;
      for (const item of parallaxItems) {
        const rect = item.getBoundingClientRect();
        if (rect.bottom < -100 || rect.top > window.innerHeight + 100) continue;
        const progress = clamp(
          (window.innerHeight - rect.top) / (window.innerHeight + rect.height),
        );
        item.style.setProperty('--parallax-y', `${(progress - 0.5) * 52}px`);
      }
    };

    const updateHero = () => {
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      const progress = clamp(-rect.top / Math.max(1, rect.height * 0.72));
      hero.style.setProperty('--hero-progress', progress.toString());
    };

    const updateGallery = () => {
      frame = 0;
      updateNavigationTone();
      updateParallax();
      updateHero();
      if (!galleryScene || !galleryTrack) return;

      if (reducedMotion) {
        galleryTrack.style.removeProperty('transform');
        galleryScene.style.setProperty('--gallery-progress', '0');
        galleryScene.style.setProperty('--gallery-intro', '0');
        galleryScene.style.setProperty('--gallery-end', '0');
        galleryCards.forEach((card) =>
          card.style.setProperty('--card-reveal', '1'),
        );
        return;
      }

      const rect = galleryScene.getBoundingClientRect();
      const range = Math.max(1, galleryScene.offsetHeight - window.innerHeight);
      const progress = clamp(-rect.top / range);
      const overflow = Math.max(
        0,
        galleryTrack.scrollWidth - window.innerWidth,
      );
      const introProgress = clamp(progress * 9.5);
      const endProgress = clamp((progress - 0.88) / 0.12);

      galleryTrack.style.transform = `translate3d(${-progress * overflow}px, 0, 0)`;
      galleryScene.style.setProperty('--gallery-progress', progress.toString());
      galleryScene.style.setProperty(
        '--gallery-intro',
        introProgress.toString(),
      );
      galleryScene.style.setProperty('--gallery-end', endProgress.toString());

      let nearestIndex = this.activeGalleryIndex();
      let nearestDistance = Number.POSITIVE_INFINITY;
      const entryLine = window.innerWidth * 1.03;
      const revealDistance = Math.max(
        200,
        window.innerWidth * (window.innerWidth < 820 ? 0.72 : 0.42),
      );

      galleryCards.forEach((card, index) => {
        const cardRect = card.getBoundingClientRect();
        const incoming = clamp((entryLine - cardRect.left) / revealDistance);
        const outgoing = clamp(
          (cardRect.right + window.innerWidth * 0.18) /
            (window.innerWidth * 0.42),
        );
        const reveal = Math.min(incoming, outgoing);
        card.style.setProperty('--card-reveal', reveal.toString());

        if (reveal < 0.18) return;
        const distance = Math.abs(
          cardRect.left + cardRect.width / 2 - window.innerWidth * 0.5,
        );
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      this.activeGalleryIndex.set(nearestIndex);
    };

    const requestUpdate = () => {
      if (!frame) frame = requestAnimationFrame(updateGallery);
    };

    const measureGallery = () => {
      if (!galleryScene || !galleryTrack) return;
      if (reducedMotion) {
        galleryScene.style.removeProperty('height');
        galleryTrack.style.removeProperty('transform');
      } else {
        const overflow = Math.max(
          0,
          galleryTrack.scrollWidth - window.innerWidth,
        );
        const travelRatio = window.innerWidth < 820 ? 0.58 : 0.72;
        galleryScene.style.height = `${
          window.innerHeight + overflow * travelRatio
        }px`;
      }
      requestUpdate();
    };

    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', measureGallery, { passive: true });
    cleanups.push(() => window.removeEventListener('scroll', requestUpdate));
    cleanups.push(() => window.removeEventListener('resize', measureGallery));
    cleanups.push(() => frame && cancelAnimationFrame(frame));

    if (typeof ResizeObserver === 'function' && galleryTrack) {
      const resizeObserver = new ResizeObserver(measureGallery);
      resizeObserver.observe(galleryTrack);
      cleanups.push(() => resizeObserver.disconnect());
    }

    requestAnimationFrame(measureGallery);

    this.destroyRef.onDestroy(() => {
      cleanups.forEach((cleanup) => cleanup());
      this.document.documentElement.removeAttribute('data-nav-tone');
    });
  }

  protected async toggleHeroVideo(): Promise<void> {
    const video =
      this.elementRef.nativeElement.querySelector<HTMLVideoElement>(
        '[data-hero-video]',
      );
    if (!video) return;

    if (video.paused) {
      await video.play();
      this.heroPaused.set(false);
    } else {
      video.pause();
      this.heroPaused.set(true);
    }
  }

  protected onHeroPointerMove(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    target.style.setProperty('--pointer-x', `${event.clientX - rect.left}px`);
    target.style.setProperty('--pointer-y', `${event.clientY - rect.top}px`);
  }
}
