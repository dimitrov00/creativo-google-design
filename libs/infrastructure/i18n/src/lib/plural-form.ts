/**
 * CLDR plural category for a count, in the active language.
 *
 * ### Why this exists rather than a Transloco plugin
 * The app shipped with NO plural machinery at all — every count was plain
 * interpolation (`"{{count}} посещения"`), so Bulgarian read "1 посещения"
 * and English "1 cuts". The official fix is `@jsverse/transloco-messageformat`,
 * which drags ICU MessageFormat and its own parser into the bundle to answer
 * a question the platform already answers: `Intl.PluralRules` is CLDR, is
 * built in, and costs nothing.
 *
 * The trade is that plural forms become KEYS rather than inline syntax:
 *
 * ```json
 * "visitCount": { "one": "{{count}} посещение", "other": "{{count}} посещения" }
 * ```
 * ```html
 * {{ t('staff.day.visitCount.' + pluralOf(n), { count: n }) }}
 * ```
 *
 * That reads worse than ICU inside one string and better than ICU everywhere
 * else: the forms stay flat JSON a translator can see, and a language that
 * needs `few`/`many` (Russian, Polish) adds keys without touching a call site.
 *
 * Bulgarian and English both use only `one`/`other`, so those are the two
 * forms every key here must carry. `select()` can still return `few`, `many`
 * or `zero` in another language — a caller that adds a locale must add the
 * keys with it, or Transloco falls back and the count reads untranslated.
 */
const RULES = new Map<string, Intl.PluralRules>();

export function pluralForm(count: number, lang: string): string {
  let rules = RULES.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(lang);
    RULES.set(lang, rules);
  }
  return rules.select(count);
}
