import { Locale, Result, Tag } from '@core/primitives';
import { CatalogError } from '@core/errors';

/**
 * Display text in every shop locale — one required, non-blank string per
 * `Locale` value, stored as the plain `{ bg, en }` map (a bounded map: its
 * keys are the `Locale` dictionary's, fixed at design time). The type is
 * keyed by the dictionary, so a locale added there is owed by every text
 * the compiler can see. Used for `Barber.name/title/bio`,
 * `ShopLocation.name/address`, `ServiceCategory.name`, `Service.name/description`
 * and the programs and loyalty catalogues — the catalog and programs
 * `LocalizedText` classes collapsed into one (blueprint §2.2).
 */
export type LocalizedText = Readonly<Record<Locale, string>>;

/**
 * One translated field of a form, for {@link LocalizedText.owedLocales}:
 * its text as typed, and whether the thing may be saved without it.
 */
export type TranslatedField = {
  readonly text: LocalizedText;
  readonly required: boolean;
};

export const LocalizedText = {
  /**
   * The edge guard for authored content (the catalogue seed, an admin
   * write): both fields trimmed, and each blank one reported — every blank
   * field at once, `en` first, as `catalog.localized_text.field_empty`.
   */
  parse(raw: LocalizedText): Result<LocalizedText, readonly CatalogError[]> {
    const bg = raw.bg.trim();
    const en = raw.en.trim();
    const errors: CatalogError[] = [];
    if (en.length === 0) {
      errors.push(CatalogError.localizedTextFieldEmpty(Locale.En));
    }
    if (bg.length === 0) {
      errors.push(CatalogError.localizedTextFieldEmpty(Locale.Bg));
    }
    return errors.length > 0 ? Result.err(errors) : Result.ok({ bg, en });
  },

  /** A text with nothing typed in any locale — a form's starting value. */
  blank(): LocalizedText {
    const text = {} as Record<Locale, string>;
    for (const locale of Tag.values(Locale)) text[locale] = '';
    return text;
  },

  /** The text with one locale's string replaced; the rest and the input kept. */
  with(text: LocalizedText, locale: Locale, value: string): LocalizedText {
    return { ...text, [locale]: value };
  },

  /**
   * The locales a form still owes a translation in, in the dictionary's
   * order. A REQUIRED field owes every locale it is blank in. An optional
   * one owes a locale only once it is written in another: it is left out
   * whole or translated whole, never said in one language alone.
   */
  owedLocales(fields: readonly TranslatedField[]): readonly Locale[] {
    const locales = Tag.values(Locale);
    const owed: Locale[] = [];
    for (const locale of locales) {
      for (const { text, required } of fields) {
        if (text[locale].trim().length > 0) continue;
        const writtenElsewhere = locales.some(
          (other) => text[other].trim().length > 0,
        );
        if (required || writtenElsewhere) {
          owed.push(locale);
          break;
        }
      }
    }
    return owed;
  },

  /** The string for `locale` — the template layer's one read of a localized field. */
  pick(text: LocalizedText, locale: Locale): string {
    return text[locale];
  },

  /** Both locales equal. */
  equals(a: LocalizedText, b: LocalizedText): boolean {
    return a.bg === b.bg && a.en === b.en;
  },
} as const;
