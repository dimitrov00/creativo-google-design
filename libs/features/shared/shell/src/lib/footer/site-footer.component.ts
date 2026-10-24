import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { Principal } from '@core/components';
import { LocalDate, TimeZone } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  AUTH_SESSION_PORTS,
  CLOCK_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import { UiIcon } from '@creativo/ui/controls';
import { UiDivider, UiGrid, UiStack } from '@creativo/ui/layout';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { LocaleThemeToggleComponent } from '../prefs/locale-theme-toggle.component';

/** Where a sitemap row leads — the field `footerLinkTarget` (Law 6). */
const FooterLinkTarget = {
  /** An in-page anchor of the landing (`/#work`). */
  Hash: 'HASH',
  /** An app route, through `routerLink`. */
  Router: 'ROUTER',
  /** Another site, in a new tab. */
  External: 'EXTERNAL',
  /** A `tel:` link. */
  Tel: 'TEL',
} as const;
type FooterLinkTarget =
  (typeof FooterLinkTarget)[keyof typeof FooterLinkTarget];

/** One sitemap row — the four destination shapes the footer links out to. */
interface FooterLink {
  readonly labelKey: string;
  readonly footerLinkTarget: FooterLinkTarget;
  /** href for hash/external/tel, routerLink path for router. */
  readonly target: string;
  readonly queryParams?: Record<string, string>;
  /** Leading Instagram mark (Material Symbols carries no brand glyphs). */
  readonly social?: boolean;
}

/** A sitemap column: eyebrow label + link rows (all existing i18n keys). */
interface FooterColumn {
  readonly labelKey: string;
  readonly links: readonly FooterLink[];
}

/** The bit of flagship-location data the Visit column needs — kept minimal
 *  and caller-supplied rather than this component reaching into a content
 *  service itself, so any page can use the footer regardless of whether
 *  it has location data at hand. */
export interface FooterFlagshipLocation {
  readonly mapUrl: string;
  readonly phoneE164: string;
}

/**
 * The page's ground floor — v2 `landing-footer.tsx`: preferences lead, three
 * sitemap columns (Explore · Visit · Connect) wired to real destinations,
 * then a legal bar. No brand mark by design — the masthead and closing CTA
 * already own identity. The three columns render from one typed model so the
 * column template exists once (DS pieces: ui-grid, uiText eyebrow headers,
 * plain uiText anchor rows — SwiftUI Link parity, not buttons).
 */
@Component({
  selector: 'cr-site-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LocaleThemeToggleComponent,
    RouterLink,
    TranslocoDirective,
    UiDivider,
    UiFrameDirective,
    UiGrid,
    UiIcon,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './site-footer.component.html',
  styleUrl: './site-footer.component.css',
  host: { class: 'cr-footer', 'data-testid': 'site-footer' },
})
export class SiteFooterComponent {
  private readonly session = inject(AUTH_SESSION_PORTS);
  private readonly clock = inject(CLOCK_PORTS);

  /** The dictionary, for the template's link branches (never bare literals). */
  protected readonly FooterLinkTarget = FooterLinkTarget;

  /** The flagship shop anchors the Visit column's directions/call rows
   *  (v2 `locations[0]`) — `null` on pages with no location data, in
   *  which case those two rows just don't render. */
  readonly flagshipLocation = input<FooterFlagshipLocation | null>(null);

  private readonly principal = toSignal(this.session.observePrincipal(), {
    initialValue: null,
  });
  private readonly isAuthed = computed(() => {
    const principal = this.principal();
    return principal !== null && Principal.isActive(principal);
  });

  protected readonly columns = computed<readonly FooterColumn[]>(() => {
    const flagship = this.flagshipLocation();
    const visitLinks: FooterLink[] = flagship
      ? [
          {
            labelKey: 'landing.footer.links.directions',
            footerLinkTarget: FooterLinkTarget.External,
            target: flagship.mapUrl,
          },
          {
            labelKey: 'landing.footer.links.call',
            footerLinkTarget: FooterLinkTarget.Tel,
            target: `tel:${flagship.phoneE164}`,
          },
        ]
      : [];
    return [
      {
        labelKey: 'landing.footer.cols.explore',
        links: [
          {
            labelKey: 'landing.footer.nav.work',
            footerLinkTarget: FooterLinkTarget.Hash,
            target: '/#work',
          },
          {
            labelKey: 'landing.footer.nav.team',
            footerLinkTarget: FooterLinkTarget.Hash,
            target: '/#team',
          },
          {
            labelKey: 'landing.footer.nav.careers',
            footerLinkTarget: FooterLinkTarget.Router,
            target: '/careers',
          },
          {
            labelKey: 'landing.footer.nav.courses',
            footerLinkTarget: FooterLinkTarget.Router,
            target: '/courses',
          },
          {
            labelKey: 'landing.footer.nav.events',
            footerLinkTarget: FooterLinkTarget.Router,
            target: '/events',
          },
        ],
      },
      {
        labelKey: 'landing.footer.cols.visit',
        links: [
          ...visitLinks,
          {
            labelKey: 'landing.footer.links.hours',
            footerLinkTarget: FooterLinkTarget.Hash,
            target: '/#visit',
          },
        ],
      },
      {
        labelKey: 'landing.footer.cols.connect',
        links: [
          {
            labelKey: 'landing.footer.links.instagram',
            footerLinkTarget: FooterLinkTarget.External,
            target: 'https://instagram.com/creativo.barbershop',
            social: true,
          },
          {
            labelKey: 'landing.footer.links.book',
            footerLinkTarget: FooterLinkTarget.Router,
            target: '/book',
          },
          this.isAuthed()
            ? {
                labelKey: 'landing.footer.links.account',
                footerLinkTarget: FooterLinkTarget.Router,
                target: '/account',
              }
            : {
                labelKey: 'landing.footer.links.login',
                footerLinkTarget: FooterLinkTarget.Router,
                target: '/auth',
                queryParams: { redirect: '/account' },
              },
        ],
      },
    ];
  });

  /** The one `CLOCK_PORTS` reading the copyright year is dated by — read once, like the device year it replaced. */
  private readonly nowUtcMs = this.clock.nowUtcMs();

  /**
   * The shop's zone — the default location's (Law 7.2), the session's ONE
   * read through the root `ShopZoneService` (the site menu asks for the
   * same signal); `null` until it answers.
   */
  private readonly shopZone = inject(ShopZoneService).defaultZone();

  /**
   * The copyright year — the civil year of that reading on the SHOP's
   * calendar (a displayed "today" is the location's, never the device's
   * or UTC's). While the zone is on its way the same instant is read on
   * the UTC calendar, so the legal bar never renders without a year.
   */
  protected readonly year = computed(
    () =>
      LocalDate.parts(
        ZonedTimeSystem.toLocal(this.nowUtcMs, this.shopZone() ?? TimeZone.UTC)
          .localDate,
      ).year,
  );
}
