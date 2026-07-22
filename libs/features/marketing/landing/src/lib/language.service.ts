import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  Injectable,
  PLATFORM_ID,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { SupportedLang } from '@creativo/infrastructure/i18n';

export interface LanguageOption {
  readonly code: SupportedLang;
  /** Each language's own name for itself — deliberately not translated. */
  readonly label: string;
}

// The pre-paint boot script reads this exact key before Angular runs
// (`@creativo/ui/tokens` LANG_STORAGE_KEY — module boundaries keep
// `type:tokens` TS out of feature libs, so the stable contract string is
// spelled here). The old 'creativo-language' key drifted from boot.
const STORAGE_KEY = 'ui-lang';

/**
 * Owns the active locale so both the shell header and the hero's in-film
 * language pill drive the same source of truth (extracted from App when the
 * toggle moved into the hero). Applies transloco + `<html lang>` + storage.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transloco = inject(TranslocoService);

  readonly activeLang = signal<SupportedLang>('bg');

  /** One entry per locale — adding a language is a single line here. */
  readonly languages: readonly LanguageOption[] = [
    { code: 'bg', label: 'Български' },
    { code: 'en', label: 'English' },
  ];

  constructor() {
    this.apply('bg', false);

    // Restore the stored language only after first render: hydrating against
    // the server-rendered (bg) DOM first avoids NG0500 text mismatches for
    // returning EN visitors, which would force a destructive re-render.
    afterNextRender(() => {
      try {
        const stored =
          this.document.defaultView?.localStorage.getItem(STORAGE_KEY);
        if (stored === 'en') this.apply(stored, false);
      } catch {
        // Storage can be unavailable in privacy-restricted browsers.
      }
    });
  }

  set(lang: SupportedLang): void {
    this.apply(lang, true);
  }

  private apply(lang: SupportedLang, persist: boolean): void {
    this.activeLang.set(lang);
    this.transloco.setActiveLang(lang);
    this.document.documentElement.lang = lang;

    if (!persist || !isPlatformBrowser(this.platformId)) return;
    try {
      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // The language still changes when storage is unavailable.
    }
  }
}
