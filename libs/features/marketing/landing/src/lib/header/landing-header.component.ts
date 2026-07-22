import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AUTH_GATEWAY } from '@creativo/application/identity';
import { CrIcon, MenuIconComponent } from '../shared/icons/icons';
import { ThemeService } from '../shared/prefs/theme.service';
import { LandingMenuComponent } from './landing-menu.component';

/**
 * The fixed top bar — v2 `app-header.tsx` with `surface="hero"`:
 * transparent, inset-floating while the hero is in view (art-directed 44px
 * gutters aligning with the hero card's own padding), then a solid toolbar
 * bar once scrolled past 80px. The wordmark rides white over the video (or
 * in dark theme) and black on the light solid bar. Right cluster is
 * auth-aware: signed-out shows the Login pill; the hamburger morphs to ✕
 * while the guest menu is open.
 */
@Component({
  selector: 'cr-landing-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CrIcon,
    LandingMenuComponent,
    MenuIconComponent,
    RouterLink,
    TranslocoDirective,
  ],
  templateUrl: './landing-header.component.html',
  styleUrl: './landing-header.component.css',
})
export class LandingHeaderComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly theme = inject(ThemeService);
  private readonly authGateway = inject(AUTH_GATEWAY);

  private readonly principal = toSignal(this.authGateway.observePrincipal(), {
    initialValue: null,
  });
  protected readonly isAuthed = computed(
    () => this.principal()?.kind === 'active',
  );

  protected readonly menuOpen = signal(false);
  protected readonly isScrolled = signal(false);
  protected readonly yOffset = signal(0);

  /** Solid once scrolled or while the menu is open (v2 `isSolid`). */
  protected readonly isSolid = computed(
    () => this.isScrolled() || this.menuOpen(),
  );
  /** White wordmark over the hero video or in dark mode. */
  protected readonly logoWhite = computed(
    () => !this.isSolid() || this.theme.theme() === 'dark',
  );
  protected readonly headerTransform = computed(() =>
    this.isSolid()
      ? 'translateY(var(--landing-safe-top))'
      : `translateY(max(var(--landing-safe-top), calc(var(--landing-safe-pad-top) - ${this.yOffset()}px)))`,
  );

  constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const onScroll = () => {
        this.isScrolled.set(window.scrollY > 80);
        this.yOffset.set(Math.max(0, window.scrollY));
        // Snapping back to the top closes the menu — it can only open
        // from the solid bar (v2 behavior).
        if (window.scrollY <= 80) this.menuOpen.set(false);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
      this.destroyRef.onDestroy(() =>
        window.removeEventListener('scroll', onScroll),
      );
    });
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }
}
