import type { Translate } from './team.words';

/** The words «Услуги и цени» prints from values (`admin.team.offerings.*`). */
export type OfferingWords = {
  readonly none: string;
  /** «10,00 € · 30 мин» */
  readonly terms: (price: string, minutes: string) => string;
  readonly price: string;
  readonly duration: string;
  /** «Цена, Дълга коса» — a variant's field, named for a reader. */
  readonly variantPrice: (variant: string) => string;
  readonly variantDuration: (variant: string) => string;
};

/** The services editor's words in one language. */
export function offeringWordsOf(translate: Translate): OfferingWords {
  const at = (key: string, params?: Readonly<Record<string, unknown>>) =>
    translate(`admin.team.offerings.${key}`, params);
  return {
    none: at('none'),
    terms: (price, minutes) => at('terms', { price, minutes }),
    price: at('price'),
    duration: at('duration'),
    variantPrice: (variant) => at('variantPrice', { variant }),
    variantDuration: (variant) => at('variantDuration', { variant }),
  };
}
