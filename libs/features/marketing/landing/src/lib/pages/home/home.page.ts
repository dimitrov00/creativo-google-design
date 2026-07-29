import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
} from '@angular/core';
import {
  FooterFlagshipLocation,
  SiteFooterComponent,
  SiteHeaderComponent,
  ThemeService,
} from '@creativo/features/shared/shell';
import { UiSkeleton } from '@creativo/ui/controls';
import { UiFrameDirective } from '@creativo/ui/modifiers';
import { CoursesSectionComponent } from '../../sections/courses/courses-section.component';
import { LandingHeroComponent } from '../../sections/hero/landing-hero.component';
import { HiringSectionComponent } from '../../sections/hiring/hiring-section.component';
import { LocationsComponent } from './locations/locations.component';
import { TeamShowcaseComponent } from './team-showcase/team-showcase.component';
import { ServicesSectionComponent } from '../../sections/services/services-section.component';
import { WorkGalleryComponent } from '../../sections/work-gallery/work-gallery.component';
import { LandingContentService } from '../../content/landing-content.service';
import { CatalogNavigationService } from '../../shared/catalog-navigation.service';
import { ServiceDetailSheetComponent } from '@creativo/features/shared/catalog';

/**
 * The marketing landing — a 1:1 port of v2's `routes/index.tsx` composition:
 * fixed AppHeader (hero treatment) → inset video hero → the anchored section
 * run (work · team · services · hiring · visit) inside the centred app
 * column → sitemap footer. The installed-PWA active-user
 * redirect lives in `apps/web` `homeGuard` (v2's `isStandalone && settled
 * === 'active'` check).
 */
@Component({
  selector: 'cr-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ServiceDetailSheetComponent,
    TeamShowcaseComponent,
    CoursesSectionComponent,
    HiringSectionComponent,
    SiteFooterComponent,
    SiteHeaderComponent,
    LandingHeroComponent,
    LocationsComponent,
    ServicesSectionComponent,
    UiFrameDirective,
    UiSkeleton,
    WorkGalleryComponent,
  ],
  templateUrl: './home.page.html',
  styleUrl: './home.page.css',
  host: { class: 'cr-landing-page', 'data-testid': 'landing-page' },
})
export class HomePage {
  /** The page hosts the single catalog sheet every section navigates in. */
  protected readonly catalog = inject(CatalogNavigationService);

  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly theme = inject(ThemeService);
  // Template-visible: the shared service sheet takes the roster and the
  // sibling catalog as inputs rather than reaching for a content source of
  // its own — that decoupling is what lets onboarding reuse it.
  protected readonly content = inject(LandingContentService);

  /** The flagship shop for the footer's Visit column (directions/call rows) — the site-wide `cr-site-footer` takes this as an input rather than reaching into landing's own content service itself. */
  protected readonly flagshipLocation = computed<FooterFlagshipLocation | null>(
    () => {
      const location = this.content.locations.at(0);
      return location
        ? { mapUrl: location.mapUrl, phoneE164: location.phoneE164 }
        : null;
    },
  );

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
        // The header clearance lives once in CSS (--landing-header-offset,
        // via .cr-landing__anchor's scroll-margin) — read the anchor's
        // resolved value instead of re-hardcoding the offset here.
        const offset = Number.parseFloat(
          window
            .getComputedStyle(target)
            .getPropertyValue('scroll-margin-block-start') || '0',
        );
        const top =
          target.getBoundingClientRect().top +
          window.scrollY -
          (Number.isNaN(offset) ? 0 : offset);
        window.scrollTo({ top: Math.max(0, top) });
      };
      requestAnimationFrame(() => requestAnimationFrame(align));
      const timer = window.setTimeout(align, 700);
      this.destroyRef.onDestroy(() => window.clearTimeout(timer));
    });
  }
}
