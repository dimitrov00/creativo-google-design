/**
 * The UI and content locales — the ONLY source of these strings (§9 D22),
 * matching the i18n lib's `availableLangs: ['en', 'bg']`. A closed set: the
 * type is the dictionary's values, so a `Locale` compares with `===` against
 * `Locale.Bg`, and `LocalizedText` is keyed by exactly these values.
 * Governance's legacy `Locale` union, `LOCALES` array and `isLocale`
 * guard (the governance domain lib's `locale.ts`, deleted in Phase 4b),
 * re-shaped from a tuple into the dictionary.
 */
export const Locale = {
  Bg: 'bg',
  En: 'en',
} as const;
export type Locale = (typeof Locale)[keyof typeof Locale];

/** Every supported locale, dictionary order — derived, never a second source. */
export const LOCALES: readonly Locale[] = Object.values(Locale);

/**
 * The edge guard for an untrusted value — a stored preference, route data,
 * `navigator.language`'s primary subtag. Exact match: no case folding, no
 * region stripping (the caller decides what to feed it).
 */
export function isLocale(value: unknown): value is Locale {
  for (let i = 0; i < LOCALES.length; i++) {
    if (LOCALES[i] === value) return true;
  }
  return false;
}
