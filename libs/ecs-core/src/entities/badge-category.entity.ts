import type { BadgeCategoryKind, LocalizedText } from '@core/components';
import type { BadgeCategoryId } from '@core/primitives';

/**
 * `badgeCategories/{id}` — a shelf of «Постижения»: Етапи, Майсторство,
 * Бръснари и салони, Ритъм, Специални, Рекорди. Families point at it; the
 * page draws the shelves in `order` (a non-negative integer). The `RECORDS`
 * kind holds no families: it is the personal-records rail. Author-chosen
 * slug ids (`cat-mastery`), stable across edits. Flat (Law 6):
 * `badgeCategoryKind` was `kind` (N15).
 */
export type BadgeCategory = {
  readonly id: BadgeCategoryId;
  readonly badgeCategoryKind: BadgeCategoryKind;
  readonly title: LocalizedText;
  readonly order: number;
};
