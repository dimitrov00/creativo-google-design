import type { BadgeCategoryKind } from '../components/gamification.data';
import type { LocalizedText } from '../components/localized-text.data';

export type BadgeCategoryId = string & { readonly __brand: unique symbol };
export const BadgeCategoryId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): BadgeCategoryId => raw as BadgeCategoryId,
} as const;

/**
 * `badgeCategories/{id}` — a shelf of «Постижения»: Етапи, Майсторство,
 * Бръснари и салони, Ритъм, Специални, Рекорди. Families point at it; the
 * page draws the shelves in `order` (a non-negative integer). The `records`
 * kind holds no families: it is the personal-records rail. Author-chosen
 * slug ids (`cat-mastery`), stable across edits. The stored body as is.
 */
export type BadgeCategoryEntity = {
  readonly id: BadgeCategoryId;
  readonly kind: BadgeCategoryKind;
  readonly title: LocalizedText;
  readonly order: number;
};
