import { Result, fail, ok } from '@creativo/domain/kernel';
import { LocalizedText, LocalizedTextProps } from '@creativo/domain/catalog';
import { BadgeCategoryId } from '../ids';
import type { BadgeCategoryKind } from './badge-vocabulary';
import {
  BadgeCategoryError,
  BadgeCategoryOrderNegativeError,
} from './badge-category.errors';

export interface BadgeCategoryProps {
  id: string;
  kind: BadgeCategoryKind;
  title: LocalizedTextProps;
  order: number;
}

/**
 * A shelf of «Постижения» (`badgeCategories/{id}`): Етапи, Майсторство,
 * Бръснари и салони, Ритъм, Специални, Рекорди. Families point at it; the
 * page draws the shelves in `order`.
 */
export class BadgeCategory {
  private constructor(
    readonly id: BadgeCategoryId,
    readonly kind: BadgeCategoryKind,
    readonly title: LocalizedText,
    readonly order: number,
  ) {}

  static create(
    props: BadgeCategoryProps,
  ): Result<BadgeCategory, BadgeCategoryError[]> {
    const errors: BadgeCategoryError[] = [];
    const id = BadgeCategoryId.create(props.id);
    if (id.isFailure()) errors.push(id.error);
    const title = LocalizedText.create(props.title);
    if (title.isFailure()) errors.push(...title.error);
    if (!Number.isInteger(props.order) || props.order < 0) {
      errors.push(new BadgeCategoryOrderNegativeError(props.order));
    }
    if (errors.length > 0 || id.isFailure() || title.isFailure()) {
      return fail(errors);
    }
    return ok(
      new BadgeCategory(id.value, props.kind, title.value, props.order),
    );
  }

  /** The personal-records rail: a shelf with no families of its own. */
  holdsRecords(): boolean {
    return this.kind === 'records';
  }
}
