import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  ElementRef,
  PLATFORM_ID,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiAsyncImage, UiButton, UiIcon } from '@creativo/ui/controls';
import { UiSheet } from '@creativo/ui/layout';
import {
  UiInteractiveDirective,
  UiMaterialDirective,
  UiOverlayDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
} from '@creativo/ui/modifiers';
import { LandingContentService } from '../../content/landing-content.service';
import type { WorkShotVm } from '../../content/landing-content';

/** Mirrors --sys-motion-ease-emphasized — WAAPI `easing` cannot read CSS
 *  custom properties, so the curve is restated here. */
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Scroll-driven horizontal work strip — v2 `work-gallery.tsx`. The section is
 * `100vh + scrollDistance` tall; a sticky full-viewport stage inside it
 * translates the card strip left as the page scrolls, so vertical scroll
 * reads as horizontal motion. Per-card art direction (aspect box, parallax
 * drift, caption) comes from the content fixture; the caption swaps to
 * whichever card's center is nearest the viewport midpoint.
 *
 * Cards are native buttons on the shared `data-interactive` grammar; the
 * hover image zoom is the section's one signature embellishment. The
 * lightbox is a `ui-sheet` — Escape, backdrop press, focus capture/trap/
 * restore, body scroll lock and overlay layering all come from
 * `UiSheetBehavior`. Reduced-motion visitors get the static strip.
 */
@Component({
  selector: 'cr-work-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslocoDirective,
    UiAsyncImage,
    UiButton,
    UiIcon,
    UiSheet,
    UiInteractiveDirective,
    UiMaterialDirective,
    UiOverlayDirective,
    UiTextDirective,
    UiVisuallyHiddenDirective,
  ],
  templateUrl: './work-gallery.component.html',
  styleUrl: './work-gallery.component.css',
  host: {
    class: 'cr-work-gallery',
    'data-testid': 'landing-work-gallery',
  },
})
export class WorkGalleryComponent {
  protected readonly content = inject(LandingContentService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly shots = this.content.workShots;

  /** Horizontal travel in px — strip width minus one viewport (v2 math). */
  protected readonly scrollDistance = signal(1400);
  protected readonly activeIndex = signal(0);
  protected readonly lightboxShot = signal<WorkShotVm | null>(null);
  /** Gates drift/zoom — false under prefers-reduced-motion. */
  protected readonly motionEnabled = signal(false);

  /** Accessible name for the lightbox dialog — the open shot's alt text. */
  protected readonly lightboxAlt = computed(() => {
    const shot = this.lightboxShot();
    return shot ? this.content.text(shot.alt) : null;
  });

  // NOT `.required`: the refs sit inside `*transloco`, whose embedded view
  // renders only after the async translation load — a required read before
  // that throws NG0951 and aborts the whole render-hook flush.
  private readonly containerRef =
    viewChild<ElementRef<HTMLElement>>('container');
  private readonly stripRef = viewChild<ElementRef<HTMLElement>>('strip');
  private readonly progressFillRef =
    viewChild<ElementRef<HTMLElement>>('progressFill');
  private readonly cardRefs = viewChildren<ElementRef<HTMLElement>>('card');

  private cardCenters: number[] = [];
  private containerWidth = 390;
  private frame = 0;
  private bootstrapped = false;

  constructor() {
    // Runs when BOTH the browser render and the transloco view (the template
    // refs) are ready — whichever lands last.
    effect(() => {
      const container = this.containerRef()?.nativeElement;
      const strip = this.stripRef()?.nativeElement;
      if (!container || !strip || this.bootstrapped) return;
      if (!isPlatformBrowser(this.platformId)) return;
      if (typeof window === 'undefined') return;
      this.bootstrapped = true;

      const reducedMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      this.motionEnabled.set(!reducedMotion);

      this.measure();
      this.revealOnIntersect(reducedMotion);

      const requestUpdate = () => {
        if (!this.frame) {
          this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.update();
          });
        }
      };
      window.addEventListener('scroll', requestUpdate, { passive: true });
      window.addEventListener('resize', requestUpdate, { passive: true });
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('scroll', requestUpdate);
        window.removeEventListener('resize', requestUpdate);
        if (this.frame) cancelAnimationFrame(this.frame);
      });

      if (typeof ResizeObserver === 'function') {
        const resizeObserver = new ResizeObserver(() => {
          this.measure();
          requestUpdate();
        });
        resizeObserver.observe(container);
        this.destroyRef.onDestroy(() => resizeObserver.disconnect());
      }

      this.update();
    });
  }

  /** Read the strip's real padding/gap so centers track the CSS tokens. */
  private measure(): void {
    const container = this.containerRef()?.nativeElement;
    const strip = this.stripRef()?.nativeElement;
    if (!container || !strip) return;
    this.containerWidth = container.offsetWidth;
    const styles = getComputedStyle(strip);
    const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
    let offsetX = Number.parseFloat(styles.paddingLeft) || 0;
    const centers: number[] = [];
    for (const card of Array.from(strip.children) as HTMLElement[]) {
      centers.push(offsetX + card.offsetWidth / 2);
      offsetX += card.offsetWidth + gap;
    }
    this.cardCenters = centers;
    this.scrollDistance.set(Math.max(0, offsetX - gap - this.containerWidth));
  }

  /** Scroll progress → strip translate + caption index + progress bar. */
  private update(): void {
    const container = this.containerRef()?.nativeElement;
    const strip = this.stripRef()?.nativeElement;
    const progressFill = this.progressFillRef()?.nativeElement;
    if (!container || !strip || !progressFill) return;
    const distance = this.scrollDistance();
    const top = container.getBoundingClientRect().top;
    const progress =
      distance > 0 ? Math.min(1, Math.max(0, -top / distance)) : 0;
    const x = -progress * distance;

    strip.style.transform = `translate3d(${x}px, 0, 0)`;
    progressFill.style.transform = `scaleX(${progress})`;

    if (this.cardCenters.length) {
      const midpoint = this.containerWidth / 2;
      let closestIndex = 0;
      let closestDistance = Infinity;
      for (let i = 0; i < this.cardCenters.length; i++) {
        const candidate = Math.abs((this.cardCenters[i] ?? 0) + x - midpoint);
        if (candidate < closestDistance) {
          closestDistance = candidate;
          closestIndex = i;
        }
      }
      if (closestIndex !== this.activeIndex()) {
        this.activeIndex.set(closestIndex);
      }
    }
  }

  /** Once-in-view entrance: opacity 0 / +22px → 1 / rest (v2 reveal). The
   *  keyframes are RELATIVE offsets — each card's drift rides the CSS
   *  `translate` property, which WAAPI `transform` composes with. */
  private revealOnIntersect(reducedMotion: boolean): void {
    if (reducedMotion || typeof IntersectionObserver !== 'function') return;
    const cards = this.cardRefs().map((ref) => ref.nativeElement);
    for (const card of cards) card.style.opacity = '0';
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const card = entry.target as HTMLElement;
          observer.unobserve(card);
          if (typeof card.animate === 'function') {
            card.animate(
              [
                { opacity: 0, transform: 'translateY(22px)' },
                { opacity: 1, transform: 'translateY(0)' },
              ],
              // 650ms mirrors --sys-motion-duration-slowest (WAAPI cannot
              // read custom properties — same provenance note as EASE).
              { duration: 650, easing: EASE, fill: 'backwards' },
            );
          }
          card.style.opacity = '';
        }
      },
      { rootMargin: '0px' },
    );
    for (const card of cards) observer.observe(card);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  protected openLightbox(shot: WorkShotVm): void {
    // Focus capture, initial focus and restore-on-close are owned by
    // UiSheetBehavior (via ui-sheet) — no local bookkeeping.
    this.lightboxShot.set(shot);
  }

  protected closeLightbox(): void {
    if (this.lightboxShot() === null) return;
    this.lightboxShot.set(null);
  }
}
