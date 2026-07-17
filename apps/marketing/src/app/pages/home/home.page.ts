import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  inject,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { CursorTargetDirective } from '@creativo/shared/cursor';
import { ServicesPage } from '../services/services.page';
import { LocationsComponent } from './locations/locations.component';
import { TeamShowcaseComponent } from './team-showcase/team-showcase.component';
import { WorkGalleryComponent } from './work-gallery/work-gallery.component';

@Component({
  selector: 'cr-home-page',
  imports: [
    CursorTargetDirective,
    LocationsComponent,
    ServicesPage,
    TeamShowcaseComponent,
    TranslocoDirective,
    WorkGalleryComponent,
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

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const host = this.elementRef.nativeElement;
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const hero = host.querySelector<HTMLElement>('.hero');
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

    const updateScroll = () => {
      frame = 0;
      updateNavigationTone();
      updateParallax();
      updateHero();
    };

    const requestUpdate = () => {
      if (!frame) frame = requestAnimationFrame(updateScroll);
    };

    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate, { passive: true });
    cleanups.push(() => window.removeEventListener('scroll', requestUpdate));
    cleanups.push(() => window.removeEventListener('resize', requestUpdate));
    cleanups.push(() => frame && cancelAnimationFrame(frame));

    requestAnimationFrame(updateScroll);

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
