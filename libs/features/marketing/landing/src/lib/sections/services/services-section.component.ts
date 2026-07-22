import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { UiSectionHeader } from '@creativo/ui/patterns';
import { LandingContentService } from '../../content/landing-content.service';
import {
  type ServiceVm,
  servicePriceFrom,
} from '../../content/landing-content';
import { CrIcon } from '../../shared/icons/icons';
import { FadeUpDirective } from '../../shared/motion/fade-up.directive';
import { ServiceDetailComponent } from './service-detail.component';

/**
 * The services shelf — v2 `services-section.tsx`: header trio, a swipeable
 * carousel of portrait single-service tiles (next tile peeking past the
 * edge), a titled bundles shelf below, and the read-only detail sheet one
 * tap away. Tiles "deal in" from the right with a staggered blur-rise the
 * first time the carousel scrolls into view.
 */
@Component({
  selector: 'cr-services-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CrIcon,
    FadeUpDirective,
    ServiceDetailComponent,
    TranslocoDirective,
    UiSectionHeader,
    UiTextDirective,
  ],
  templateUrl: './services-section.component.html',
  styleUrl: './services-section.component.css',
  host: { class: 'cr-services', 'data-testid': 'landing-services' },
})
export class ServicesSectionComponent {
  protected readonly content = inject(LandingContentService);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly selectedService = signal<ServiceVm | null>(null);

  protected readonly servicePriceFrom = servicePriceFrom;

  constructor() {
    // Dealt-in carousel entrance (v2 carouselContainer/carouselItem variants):
    // items rise 16px through a 6px blur, staggered 0.07s, starting 0.08s
    // after the carousel first enters the viewport. Reduced motion skips it.
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      if (reducedMotion || typeof IntersectionObserver !== 'function') return;

      // The carousels live inside `*transloco` (async view) — retry on
      // frames (bounded) until they exist, then arm the reveal observer.
      const arm = (attempt: number): void => {
        const carousels = Array.from(
          this.elementRef.nativeElement.querySelectorAll<HTMLElement>(
            '.cr-services__carousel',
          ),
        );
        if (carousels.length === 0) {
          if (attempt < 240) requestAnimationFrame(() => arm(attempt + 1));
          return;
        }
        this.armReveal(carousels);
      };
      arm(0);
    });
  }

  private armReveal(carousels: readonly HTMLElement[]): void {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          const items = Array.from(
            entry.target.querySelectorAll<HTMLElement>('.cr-services__item'),
          );
          items.forEach((item, index) => {
            if (typeof item.animate !== 'function') {
              item.style.opacity = '';
              return;
            }
            item.animate(
              [
                {
                  opacity: 0,
                  transform: 'translateY(16px)',
                  filter: 'blur(6px)',
                },
                {
                  opacity: 1,
                  transform: 'translateY(0)',
                  filter: 'blur(0px)',
                },
              ],
              {
                duration: 550,
                delay: 80 + index * 70,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
                fill: 'both',
              },
            );
            item.style.opacity = '';
          });
        }
      },
      { rootMargin: '-12% 0px' },
    );
    for (const carousel of carousels) {
      for (const item of Array.from(
        carousel.querySelectorAll<HTMLElement>('.cr-services__item'),
      )) {
        item.style.opacity = '0';
      }
      observer.observe(carousel);
    }
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  protected open(service: ServiceVm): void {
    this.selectedService.set(service);
  }
}
