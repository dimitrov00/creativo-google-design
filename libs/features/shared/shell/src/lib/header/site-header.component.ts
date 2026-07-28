import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiAvatar, UiButton, UiIcon } from '@creativo/ui/controls';
import { UiStack, UiToolbar } from '@creativo/ui/layout';
import { UiFrameDirective } from '@creativo/ui/modifiers';
import { MenuIconComponent } from '../icons/icons';
import { SessionIdentityService } from '../identity/session-identity.service';
import { ThemeService } from '../prefs/theme.service';
import { SiteMenuComponent } from '../menu/site-menu.component';

/**
 * The fixed top bar — v2 `app-header.tsx` with `surface="hero"`:
 * transparent, inset-floating while the hero is in view (art-directed 44px
 * gutters aligning with the hero card's own padding), then a solid toolbar
 * bar once scrolled past 80px. The wordmark rides white over the video (or
 * in dark theme) and black on the light solid bar. Right cluster is
 * auth-aware: signed-out shows the Login pill; the hamburger morphs to ✕
 * while the guest menu is open.
 *
 * `uiOverHero` gates that whole float/morph behavior — content pages with
 * no hero underneath (`/careers`, `/courses`, `/events`, …) pass `false`
 * and get a permanently solid bar with the dark wordmark, no scroll-driven
 * transform.
 */
@Component({
  selector: 'cr-site-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SiteMenuComponent,
    MenuIconComponent,
    RouterLink,
    TranslocoDirective,
    UiAvatar,
    UiButton,
    UiFrameDirective,
    UiIcon,
    UiStack,
    UiToolbar,
  ],
  templateUrl: './site-header.component.html',
  styleUrl: './site-header.component.css',
})
export class SiteHeaderComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly theme = inject(ThemeService);

  /** Whether this page has a hero card underneath the header for it to
   *  float/morph over. Content pages pass `false` for a permanently
   *  solid bar. */
  readonly uiOverHero = input(true);

  /** Name + photo for the trigger's account circle — the SAME read model
   *  the menu's identity portrait uses (Apple HIG profile-circle grammar:
   *  photo when one exists, initials otherwise). */
  protected readonly identity = inject(SessionIdentityService);
  protected readonly isAuthed = this.identity.isAuthed;

  protected readonly menuOpen = signal(false);
  protected readonly isScrolled = signal(false);
  protected readonly yOffset = signal(0);

  /** Solid once scrolled, while the menu is open, or always when there's no hero to float over (v2 `isSolid`). */
  protected readonly isSolid = computed(
    () => !this.uiOverHero() || this.isScrolled() || this.menuOpen(),
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
