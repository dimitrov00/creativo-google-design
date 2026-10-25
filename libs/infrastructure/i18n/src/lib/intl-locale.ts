import { Locale, Tag } from '@core/primitives';

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
 * reads as Bulgarian — the shop's own (`Tag.or(Locale, lang, Locale.Bg)`).
 */
export function intlLocaleOf(lang: string): string {
  return INTL_LOCALE[Tag.or(Locale, lang, Locale.Bg)];
}
