import { EnvironmentProviders } from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';
import { TranslationHttpLoader } from './translation-loader';

export const SUPPORTED_LANGS = ['en', 'bg'] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

/**
 * `assets/i18n/{lang}.json` must be reachable at runtime — each consuming
 * app's build config needs an assets glob copying this lib's
 * `src/assets/i18n` into its own `assets/i18n` output.
 */
export function provideI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: [...SUPPORTED_LANGS],
      defaultLang: 'en',
      fallbackLang: 'en',
      reRenderOnLangChange: true,
      prodMode: true,
      // translateDomainError() owns the missing-key fallback (raw code) —
      // suppress Transloco's own console warning to avoid double-reporting.
      missingHandler: { logMissingKey: false },
    },
    loader: TranslationHttpLoader,
  });
}
