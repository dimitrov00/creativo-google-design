import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  afterNextRender,
  effect,
  inject,
} from '@angular/core';
import { LandingHeaderComponent } from '../../header/landing-header.component';
import { ClosingCtaComponent } from '../../sections/closing-cta/closing-cta.component';
import { LandingFooterComponent } from '../../sections/footer/landing-footer.component';
import { LandingHeroComponent } from '../../sections/hero/landing-hero.component';
import { HiringSectionComponent } from '../../sections/hiring/hiring-section.component';
import { LocationsComponent } from './locations/locations.component';
import { TeamShowcaseComponent } from './team-showcase/team-showcase.component';
import { ServicesSectionComponent } from '../../sections/services/services-section.component';
import { WorkGalleryComponent } from '../../sections/work-gallery/work-gallery.component';
import { ThemeService } from '../../shared/prefs/theme.service';

/**
 * The marketing landing — a 1:1 port of v2's `routes/index.tsx` composition:
 * fixed AppHeader (hero treatment) → inset video hero → the anchored section
 * run (work · team · services · hiring · visit) inside the centred app
 * column → closing CTA → sitemap footer. The installed-PWA active-user
 * redirect lives in `apps/web` `homeGuard` (v2's `isStandalone && settled
 * === 'active'` check).
 */
@Component({
  selector: 'cr-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TeamShowcaseComponent,
    ClosingCtaComponent,
    HiringSectionComponent,
    LandingFooterComponent,
    LandingHeaderComponent,
    LandingHeroComponent,
    LocationsComponent,
    ServicesSectionComponent,
    WorkGalleryComponent,
  ],
  templateUrl: './home.page.html',
  styleUrl: './home.page.css',
  host: { class: 'cr-landing-page', 'data-testid': 'landing-page' },
})
export class HomePage {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly theme = inject(ThemeService);

  constructor() {
    // v2 `useLandingThemeColor`: the inset hero leaves plain background above
    // it, so the browser chrome just tracks the resolved theme's background —
    // read straight from the token so no per-theme hex is duplicated here.
    effect(() => {
      this.theme.theme();
      const background = this.document.defaultView
        ?.getComputedStyle(this.document.documentElement)
        .getPropertyValue('--sys-color-background')
        .trim();
      if (background) {
        this.document
          .querySelector('meta[name="theme-color"]')
          ?.setAttribute('content', background);
      }
    });

    // #work/#team/… deep links land aligned under the fixed header.
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const hash = window.location.hash;
      if (!hash) return;
      const targetId = decodeURIComponent(hash.slice(1));
      const align = () => {
        const target = this.document.getElementById(targetId);
        if (!target) return;
        const top = target.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top: Math.max(0, top) });
      };
      requestAnimationFrame(() => requestAnimationFrame(align));
      const timer = window.setTimeout(align, 700);
      this.destroyRef.onDestroy(() => window.clearTimeout(timer));
    });
  }
}
