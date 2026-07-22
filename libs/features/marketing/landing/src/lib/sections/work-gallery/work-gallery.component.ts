import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  PLATFORM_ID,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LandingContentService } from '../../content/landing-content.service';
import type { WorkShotVm } from '../../content/landing-content';

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Scroll-driven horizontal work strip — v2 `work-gallery.tsx`. The section is
 * `100vh + scrollDistance` tall; a sticky full-viewport stage inside it
 * translates the card strip left as the page scrolls, so vertical scroll
 * reads as horizontal motion. Per-card art direction (aspect box, parallax
 * drift, caption) comes from the content fixture; the caption swaps to
 * whichever card's center is nearest the viewport midpoint.
 *
 * Interactive flourishes (3D tilt ±8°, cursor shimmer, reveal drift) are
 * pointer/motion-gated exactly like v2 — reduced-motion visitors get the
 * static strip.
 */
@Component({
  selector: 'cr-work-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective],
  templateUrl: './work-gallery.component.html',
  styleUrl: './work-gallery.component.css',
  host: {
    class: 'cr-work-gallery',
    'data-testid': 'landing-work-gallery',
    '(document:keydown.escape)': 'closeLightbox()',
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
  /** Gates drift/tilt/shimmer — false under prefers-reduced-motion. */
  protected readonly motionEnabled = signal(false);

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

  /** Once-in-view entrance: opacity 0 / driftY+22 → 1 / driftY (v2 reveal). */
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
          const drift = Number.parseFloat(card.dataset['drift'] ?? '0');
          if (typeof card.animate === 'function') {
            card.animate(
              [
                { opacity: 0, transform: `translateY(${drift + 22}px)` },
                { opacity: 1, transform: `translateY(${drift}px)` },
              ],
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

  /** Cursor tilt + shimmer — writes CSS vars the stylesheet reads. */
  protected onCardMove(event: MouseEvent, card: HTMLElement): void {
    if (!this.motionEnabled()) return;
    const rect = card.getBoundingClientRect();
    const relativeX = (event.clientX - rect.left) / rect.width - 0.5;
    const relativeY = (event.clientY - rect.top) / rect.height - 0.5;
    card.style.setProperty('--rx', `${relativeY * -16}deg`);
    card.style.setProperty('--ry', `${relativeX * 16}deg`);
    card.style.setProperty('--gx', `${(relativeX + 0.5) * 100}%`);
    card.style.setProperty('--gy', `${(relativeY + 0.5) * 100}%`);
  }

  protected onCardLeave(card: HTMLElement): void {
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  }

  protected openLightbox(shot: WorkShotVm): void {
    this.lightboxShot.set(shot);
  }

  protected closeLightbox(): void {
    this.lightboxShot.set(null);
  }
}
