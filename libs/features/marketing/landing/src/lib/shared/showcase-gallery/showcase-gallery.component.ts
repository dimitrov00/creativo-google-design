import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  PLATFORM_ID,
  afterNextRender,
  inject,
  input,
  model,
} from '@angular/core';
import { UiAsyncImage, UiButton, UiIcon } from '@creativo/ui/controls';
import { UiGrid, UiScrollRow } from '@creativo/ui/layout';
import { UiRadiusDirective } from '@creativo/ui/modifiers';

/** Mirrors --sys-motion-duration-cinematic / --sys-motion-ease-entrance —
 *  WAAPI options cannot read CSS custom properties, so both are restated
 *  here (same provenance pattern as work-gallery's EASE const). */
const MORPH_DURATION = 900;
const MORPH_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

@Component({
  selector: 'cr-showcase-gallery',
  imports: [
    UiAsyncImage,
    UiButton,
    UiGrid,
    UiIcon,
    UiRadiusDirective,
    UiScrollRow,
  ],
  templateUrl: './showcase-gallery.component.html',
  styleUrl: './showcase-gallery.component.css',
  host: {
    '[attr.data-expanded]': "expanded() ? '' : null",
  },
})
export class ShowcaseGalleryComponent {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly platformId = inject(PLATFORM_ID);

  readonly images = input.required<readonly string[]>();
  readonly imageAlt = input.required<string>();
  readonly ariaLabel = input.required<string>();
  readonly gridViewLabel = input.required<string>();
  readonly carouselViewLabel = input.required<string>();
  readonly showToggle = input(true);
  readonly expanded = model(false);

  /** FLIP morph between the strip and the grid layouts. */
  protected toggleLayout(): void {
    const expanding = !this.expanded();
    if (!isPlatformBrowser(this.platformId)) {
      this.expanded.set(expanding);
      return;
    }

    const figures = this.figures();
    const firstRects = figures.map((figure) => figure.getBoundingClientRect());
    const reducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    this.expanded.set(expanding);
    if (reducedMotion || figures.length === 0) return;

    afterNextRender(
      () => {
        this.figures().forEach((figure, index) => {
          const first = firstRects[index];
          const last = figure.getBoundingClientRect();
          if (!first || last.width === 0 || last.height === 0) return;

          figure.animate(
            [
              {
                transform: `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${first.width / last.width}, ${first.height / last.height})`,
                transformOrigin: 'top left',
              },
              {
                transform: 'translate(0, 0) scale(1)',
                transformOrigin: 'top left',
              },
            ],
            {
              duration: MORPH_DURATION,
              delay: index * 55,
              easing: MORPH_EASE,
            },
          );
        });
      },
      { injector: this.injector },
    );
  }

  private figures(): HTMLElement[] {
    return Array.from(
      this.elementRef.nativeElement.querySelectorAll<HTMLElement>('figure'),
    );
  }
}
