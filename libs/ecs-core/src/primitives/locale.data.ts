/**
 * The UI and content locales — the ONLY source of these strings (§9 D22),
 * matching the i18n lib's `availableLangs: ['en', 'bg']`. A closed set: the
 * type is the dictionary's values, so a `Locale` compares with `===` against
 * `Locale.Bg`, and `LocalizedText` is keyed by exactly these values.
 * Governance's legacy `Locale` union (the governance domain lib's
 * `locale.ts`, deleted in Phase 4b), re-shaped from a tuple into the
 * dictionary. Every locale in key order is `Tag.values(Locale)`; the edge
 * guard for an untrusted value (a stored preference, route data, the
 * active Transloco language) is `Tag.has(Locale, raw)` / `Tag.or(Locale,
 * raw, fallback)` — exact match, no case folding (`tag.data.ts`).
 */
export const Locale = {
  Bg: 'bg',
  En: 'en',
} as const;
export type Locale = (typeof Locale)[keyof typeof Locale];
