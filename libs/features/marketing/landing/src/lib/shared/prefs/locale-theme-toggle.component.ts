import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiButton } from '@creativo/ui/controls';
import { LanguageService } from '../../language.service';
import { CrIcon } from '../icons/icons';
import { ThemeService } from './theme.service';

/**
 * Locale + theme control pair — v2 `locale-theme-toggle.tsx`.
 *   overlay — chrome-media chips over the dark hero video;
 *   toolbar — track chips on solid surfaces (menu, footer), toolbar-tinted
 *             ink (accent in light / foreground in dark) like v2's
 *             `toolbarControl({ surface: 'track' })`.
 */
@Component({
  selector: 'cr-locale-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CrIcon, TranslocoDirective, UiButton],
  host: { class: 'cr-prefs', '[attr.data-variant]': 'variant()' },
  template: `
    <ng-container *transloco="let t">
      <button
        type="button"
        uiButton
        [uiVariant]="variant() === 'overlay' ? 'overlay' : 'tinted'"
        uiShape="capsule"
        class="cr-prefs__chip cr-prefs__chip--locale"
        data-testid="landing-locale-toggle"
        [attr.aria-label]="t('landing.nav.locale')"
        (click)="toggleLocale()"
      >
        <cr-icon name="language" class="cr-prefs__glyph" />
        {{ t('landing.prefs.localeCode') }}
      </button>
      <button
        type="button"
        uiButton
        [uiVariant]="variant() === 'overlay' ? 'overlay' : 'tinted'"
        uiShape="capsule"
        class="cr-prefs__chip cr-prefs__chip--theme"
        data-testid="landing-theme-toggle"
        [attr.aria-label]="
          theme.theme() === 'dark'
            ? t('landing.prefs.switchToLight')
            : t('landing.prefs.switchToDark')
        "
        (click)="theme.toggle()"
      >
        @if (theme.theme() === 'dark') {
          <cr-icon
            name="light_mode"
            class="cr-prefs__glyph cr-prefs__glyph--theme"
          />
        } @else {
          <cr-icon
            name="dark_mode"
            class="cr-prefs__glyph cr-prefs__glyph--theme"
          />
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
