import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { UiButton } from '@creativo/ui/controls';
import { CrIcon } from '../../shared/icons/icons';
import { FadeUpDirective } from '../../shared/motion/fade-up.directive';

/**
 * Careers — v2 `hiring-section.tsx`: a dark video card whose only
 * interactive layer is a cursor spotlight (a radial glow following the
 * mouse, revealing the warm amber beneath the overlay). No 3D tilt. One
 * CTA, no role cards. The headline reveals per-word (blur + lift), the
 * calm signature move of the landing.
 */
@Component({
  selector: 'cr-hiring-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CrIcon, FadeUpDirective, TranslocoDirective, UiButton],
  templateUrl: './hiring-section.component.html',
  styleUrl: './hiring-section.component.css',
  host: { class: 'cr-hiring', 'data-testid': 'landing-hiring' },
})
export class HiringSectionComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly transloco = inject(TranslocoService);

  // NOT `.required`: the refs sit inside `*transloco`, whose embedded view
  // renders only after the async translation load — a required read before
  // that throws NG0951 and aborts the whole render-hook flush.
  private readonly card = viewChild<ElementRef<HTMLElement>>('card');
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');

  /** Localized headline, split per word — recomputes on language switch
   *  (v2 WordReveal splits at render). */
  private readonly titleText = toSignal(
    this.transloco.selectTranslate<string>('landing.hiring.title'),
    { initialValue: '' },
  );
  protected readonly words = computed(() =>
    this.titleText().split(' ').filter(Boolean),
  );

  /** Motion gate — set only when the reveal machinery can actually run, so
   *  the pre-reveal hidden state can never strand the headline invisible. */
  protected readonly motionReady = signal(false);
  /** Latched once the headline scrolls into view (v2 `once: true`). */
  protected readonly revealed = signal(false);
  protected readonly reducedMotion = signal(false);

  constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      this.reducedMotion.set(reduced);
    });

    // Waits for BOTH browser readiness and the transloco view (the `#title`
    // ref) — whichever lands last — then arms the once-only reveal observer.
    effect(() => {
      const title = this.title()?.nativeElement;
      if (!title || this.motionReady() || this.revealed()) return;
      if (!isPlatformBrowser(this.platformId)) return;
      if (
        this.reducedMotion() ||
        typeof IntersectionObserver !== 'function' ||
        typeof window === 'undefined'
      ) {
        return;
      }
      this.motionReady.set(true);
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.disconnect();
            this.revealed.set(true);
          }
        },
        // v2 WordReveal viewport margin '-10% 0px'.
        { rootMargin: '-10% 0px' },
      );
      observer.observe(title);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  /** Cursor spotlight — local pixel position via CSS vars (v2 spring ≈ CSS
   *  transition on the layer's opacity). */
  protected onMouseMove(event: MouseEvent): void {
    if (this.reducedMotion()) return;
    const card = this.card()?.nativeElement;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    card.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
    card.setAttribute('data-spot', '');
  }

  protected onMouseLeave(): void {
    this.card()?.nativeElement.removeAttribute('data-spot');
  }
}
