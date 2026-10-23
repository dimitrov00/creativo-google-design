import { Injectable, computed, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { SupportedLang, isSupportedLang } from '@creativo/infrastructure/i18n';

export interface LanguageOption {
  readonly code: SupportedLang;
  /** Each language's own name for itself — deliberately not translated. */
  readonly label: string;
}

/**
 * The active locale for every language control (the header, the footer and
 * the hero's in-film pill drive this one source of truth): a read of
 * Transloco's active language and a setter over it.
 *
 * It decides nothing when constructed. The app's bootstrap picks the
 * language before any view renders (apps/web `AppChromeService` restores
 * the stored `ui-lang` choice) and mirrors every change into `<html lang>`
 * and storage. The first thing to inject this service is usually
 * mid-render — the footer's locale toggle, inside a `*transloco` view — and
 * a language set there re-entered that directive's view creation (dev-mode
 * "Reached the max number of directives", an empty footer) and overwrote
 * the restored choice.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);

  readonly activeLang = computed<SupportedLang>(() => {
    const lang = this.transloco.activeLang();
    return isSupportedLang(lang) ? lang : 'bg';
  });

  /** One entry per locale — adding a language is a single line here. */
  readonly languages: readonly LanguageOption[] = [
    { code: 'bg', label: 'Български' },
    { code: 'en', label: 'English' },
  ];

  set(lang: SupportedLang): void {
    this.transloco.setActiveLang(lang);
  }
}
