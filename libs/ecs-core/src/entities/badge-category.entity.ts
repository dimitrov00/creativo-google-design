import type { BadgeCategoryKind } from '../components/gamification.data';
import type { LocalizedText } from '../components/localized-text.data';
import type { BadgeCategoryId } from '../primitives/ids.primitive';

/*
 * The id lives in `primitives/ids.primitive.ts` (flatten-spec §1.5); it is
 * re-exported here only while the barrel's staging block still names this
 * file (`index.ts`), and leaves with that line.
 */

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
