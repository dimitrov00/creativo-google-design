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
import { LandingContentService } from '../../content/landing-content.service';
import { CrIcon, IconInstagram } from '../../shared/icons/icons';
import { LocaleThemeToggleComponent } from '../../shared/prefs/locale-theme-toggle.component';

/**
 * The page's ground floor — v2 `landing-footer.tsx`: preferences lead, three
 * sitemap columns (Explore · Visit · Connect) wired to real destinations,
 * then a legal bar. No brand mark by design — the masthead and closing CTA
 * already own identity.
 */
@Component({
  selector: 'cr-landing-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CrIcon,
    IconInstagram,
    LocaleThemeToggleComponent,
    RouterLink,
    TranslocoDirective,
  ],
  templateUrl: './landing-footer.component.html',
  styleUrl: './landing-footer.component.css',
  host: { class: 'cr-footer', 'data-testid': 'landing-footer' },
})
export class LandingFooterComponent {
  protected readonly content = inject(LandingContentService);
  private readonly authGateway = inject(AUTH_GATEWAY);

  private readonly principal = toSignal(this.authGateway.observePrincipal(), {
    initialValue: null,
  });
  protected readonly isAuthed = computed(
    () => this.principal()?.kind === 'active',
  );

  /** The flagship shop anchors the Visit column (v2 `locations[0]`). */
  protected readonly location = this.content.locations.at(0) ?? null;

  protected readonly year = new Date().getFullYear();
}
