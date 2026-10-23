import { Locale, Result } from '@core/primitives';
import { CatalogError } from '@core/errors';

/**
 * Display text in both shop locales — two required, non-blank strings keyed
 * by the `Locale` values, stored as the plain `{ bg, en }` map (a bounded
 * map: its keys are fixed at design time). Used for `Barber.name/title/bio`,
 * `ShopLocation.name/address`, `ServiceCategory.name`, `Service.name/description`
 * and the programs and loyalty catalogues — the catalog and programs
 * `LocalizedText` classes collapsed into one (blueprint §2.2).
 */
export type LocalizedText = {
  readonly bg: string;
  readonly en: string;
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

  /** The string for `locale` — the template layer's one read of a localized field. */
  pick(text: LocalizedText, locale: Locale): string {
    return text[locale];
  },

  /** Both locales equal. */
  equals(a: LocalizedText, b: LocalizedText): boolean {
    return a.bg === b.bg && a.en === b.en;
  },
} as const;
