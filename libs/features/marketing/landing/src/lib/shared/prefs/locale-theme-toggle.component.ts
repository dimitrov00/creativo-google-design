import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiButton, UiIcon } from '@creativo/ui/controls';
import { LanguageService } from '../../language.service';
import { ThemeService } from './theme.service';

/**
 * Locale + theme control pair — v2 `locale-theme-toggle.tsx`.
 *   overlay — chrome-media chips over the dark hero video;
 *   toolbar — track chips on solid surfaces (menu, footer), toolbar-tinted
 *             ink (accent in light / foreground in dark) like v2's
 *             `toolbarControl({ surface: 'track' })`.
 * Chips ride uiButton whole: base typography (callout 600), the tinted /
 * overlay hover tiers, and the exact 44px regular size — the theme chip is
 * a square `uiIconOnly` member of the header chip group.
 */
@Component({
  selector: 'cr-locale-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective, UiButton, UiIcon],
  host: { class: 'cr-prefs', '[attr.data-variant]': 'variant()' },
  template: `
    <ng-container *transloco="let t">
      <button
        type="button"
        uiButton
        [uiVariant]="variant() === 'overlay' ? 'overlay' : 'tinted'"
        uiShape="capsule"
        uiSize="regular"
        data-testid="landing-locale-toggle"
        [attr.aria-label]="t('landing.nav.locale')"
        (click)="toggleLocale()"
      >
        <!-- Locale glyph is a compact accessory beside the code label:
             uiScale="small" (16px, fixed icon ladder) — the old local
             15px override, snapped to the nearest rung. -->
        <ui-icon
          uiName="prefs.language"
          uiScale="small"
          class="cr-prefs__glyph"
        />
        {{ t('landing.prefs.localeCode') }}
      </button>
      <button
        type="button"
        uiButton
        [uiVariant]="variant() === 'overlay' ? 'overlay' : 'tinted'"
        uiShape="capsule"
        uiSize="regular"
        [uiIconOnly]="true"
        data-testid="landing-theme-toggle"
        [attr.aria-label]="
          theme.theme() === 'dark'
            ? t('landing.prefs.switchToLight')
            : t('landing.prefs.switchToDark')
        "
        (click)="theme.toggle()"
      >
        <!-- Theme glyph: no local sizing — the button's regular-tier
             control-glyph rule supplies medium (20px) from the same fixed
             ladder (was an 18px off-ladder local override). -->
        @if (theme.theme() === 'dark') {
          <ui-icon uiName="prefs.theme.light" />
        } @else {
          <ui-icon uiName="prefs.theme.dark" />
        }
      </button>
    </ng-container>
  `,
  styleUrl: './locale-theme-toggle.component.css',
})
export class LocaleThemeToggleComponent {
  readonly variant = input<'overlay' | 'toolbar'>('toolbar');

  private readonly language = inject(LanguageService);
  protected readonly theme = inject(ThemeService);

  protected toggleLocale(): void {
    this.language.set(this.language.activeLang() === 'bg' ? 'en' : 'bg');
  }
}
