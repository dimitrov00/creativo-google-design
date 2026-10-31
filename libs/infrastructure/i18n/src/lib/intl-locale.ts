import { Locale, Tag } from '@core/primitives';

/**
 * The app's default language — Transloco's `defaultLang` AND `fallbackLang`
 * (`provideI18n` reads both from here, so the two cannot drift): Bulgarian,
 * the shop's own.
 */
export const DEFAULT_LOCALE: Locale = Locale.Bg;

/**
 * THE ONE active-language rule of the web: any untrusted language
 * (Transloco's active one, a stored preference, a loaded language) as the
 * `Locale` it names, anything else the app's default ({@link DEFAULT_LOCALE}).
 * Every reader of "the language" calls it, so no two of them disagree on an
 * unknown one.
 */
export function localeFor(lang: unknown): Locale {
  return Tag.or(Locale, lang, DEFAULT_LOCALE);
}

/**
 * The BCP-47 tag each UI language formats in — the ONE table: Bulgarian
 * as Bulgaria writes it, English as Britain does (24-hour clock, day
 * before month).
 */
const INTL_LOCALE: Readonly<Record<Locale, string>> = {
  [Locale.Bg]: 'bg-BG',
  [Locale.En]: 'en-GB',
};

/**
 * The `Intl` locale for an active UI language (Transloco's `activeLang`,
 * untrusted text): a known `Locale` formats in its own tag, anything else
 * in the default's ({@link localeFor}).
 */
export function intlLocaleOf(lang: string): string {
  return INTL_LOCALE[localeFor(lang)];
}
