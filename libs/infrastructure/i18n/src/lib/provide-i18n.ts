import { EnvironmentProviders } from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';
import { Locale, Tag } from '@core/primitives';
import { TranslationHttpLoader } from './translation-loader';

/**
 * `assets/i18n/{lang}.json` must be reachable at runtime — each consuming
 * app's build config needs an assets glob copying this lib's
 * `src/assets/i18n` into its own `assets/i18n` output. The languages are
 * the `Locale` dictionary's, in its order (`bg`, `en`); an untrusted
 * language reads through `Tag.has(Locale, raw)` / `Tag.or(Locale, raw,
 * Locale.Bg)`.
 */
export function provideI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: [...Tag.values(Locale)],
      defaultLang: Locale.Bg,
      fallbackLang: Locale.Bg,
      reRenderOnLangChange: true,
      prodMode: true,
      // translateCodedError() owns the missing-key fallback (the raw errorCode) —
      // suppress Transloco's own console warning to avoid double-reporting.
      missingHandler: { logMissingKey: false },
    },
    loader: TranslationHttpLoader,
  });
}
