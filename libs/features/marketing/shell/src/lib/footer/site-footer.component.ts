import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AUTH_GATEWAY } from '@creativo/application/identity';
import { UiIcon } from '@creativo/ui/controls';
import { UiDivider, UiGrid, UiStack } from '@creativo/ui/layout';
import { UiFrameDirective, UiTextDirective } from '@creativo/ui/modifiers';
import { LandingContentService } from '../../content/landing-content.service';
import { IconInstagram } from '../../shared/icons/icons';
import { LocaleThemeToggleComponent } from '../../shared/prefs/locale-theme-toggle.component';

/** One sitemap row — the four destination shapes the footer links out to. */
interface FooterLink {
  readonly labelKey: string;
  readonly kind: 'hash' | 'router' | 'external' | 'tel';
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

/**
 * The page's ground floor — v2 `landing-footer.tsx`: preferences lead, three
 * sitemap columns (Explore · Visit · Connect) wired to real destinations,
 * then a legal bar. No brand mark by design — the masthead and closing CTA
 * already own identity. The three columns render from one typed model so the
 * column template exists once (DS pieces: ui-grid, uiText eyebrow headers,
 * plain uiText anchor rows — SwiftUI Link parity, not buttons).
 */
@Component({
  selector: 'cr-landing-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconInstagram,
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
  templateUrl: './landing-footer.component.html',
  styleUrl: './landing-footer.component.css',
  host: { class: 'cr-footer', 'data-testid': 'landing-footer' },
})
export class LandingFooterComponent {
  private readonly content = inject(LandingContentService);
  private readonly authGateway = inject(AUTH_GATEWAY);

  private readonly principal = toSignal(this.authGateway.observePrincipal(), {
    initialValue: null,
  });
  private readonly isAuthed = computed(
    () => this.principal()?.kind === 'active',
  );

  /** The flagship shop anchors the Visit column (v2 `locations[0]`). */
  private readonly location = this.content.locations.at(0) ?? null;

  protected readonly columns = computed<readonly FooterColumn[]>(() => {
    const flagship = this.location;
    const visitLinks: FooterLink[] = flagship
      ? [
          {
            labelKey: 'landing.footer.links.directions',
            kind: 'external',
            target: flagship.mapUrl,
          },
          {
            labelKey: 'landing.footer.links.call',
            kind: 'tel',
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
            kind: 'hash',
            target: '/#work',
          },
          {
            labelKey: 'landing.footer.nav.team',
            kind: 'hash',
            target: '/#team',
          },
          {
            labelKey: 'landing.footer.nav.careers',
            kind: 'hash',
            target: '/#hiring',
          },
        ],
      },
      {
        labelKey: 'landing.footer.cols.visit',
        links: [
          ...visitLinks,
          {
            labelKey: 'landing.footer.links.hours',
            kind: 'hash',
            target: '/#visit',
          },
        ],
      },
      {
        labelKey: 'landing.footer.cols.connect',
        links: [
          {
            labelKey: 'landing.footer.links.instagram',
            kind: 'external',
            target: 'https://instagram.com/creativo.barbershop',
            social: true,
          },
          {
            labelKey: 'landing.footer.links.book',
            kind: 'router',
            target: '/book',
          },
          this.isAuthed()
            ? {
                labelKey: 'landing.footer.links.account',
                kind: 'router',
                target: '/account',
              }
            : {
                labelKey: 'landing.footer.links.login',
                kind: 'router',
                target: '/auth',
                queryParams: { redirect: '/account' },
              },
        ],
      },
    ];
  });

  protected readonly year = new Date().getFullYear();
}
