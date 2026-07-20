import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { CursorTargetDirective } from '@creativo/shared/cursor';

@Component({
  selector: 'cr-showcase-gallery',
  imports: [CursorTargetDirective],
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
  readonly scrollProgress = input(0);
  readonly showToggle = input(true);
  readonly expanded = model(false);

  protected readonly activeIndex = computed(() => {
    const imageCount = this.images().length;
    if (imageCount === 0) return -1;

    const progress = Math.min(1, Math.max(0, this.scrollProgress()));
    return Math.min(imageCount - 1, Math.floor(progress * imageCount));
  });

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

          const active = index === this.activeIndex();
          figure.animate(
            [
              {
                opacity: expanding ? (active ? 1 : 0) : 1,
                transform: `translate(${first.left - last.left}px, ${first.top - last.top}px) scale(${first.width / last.width}, ${first.height / last.height})`,
                transformOrigin: 'top left',
              },
              {
                opacity: expanding || active ? 1 : 0,
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
