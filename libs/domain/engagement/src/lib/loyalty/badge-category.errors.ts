import { DomainError } from '@creativo/domain/kernel';
import type { LocalizedTextFieldEmptyError } from '@creativo/domain/catalog';
import type { EmptyIdError } from '../ids.errors';

export class BadgeCategoryOrderNegativeError extends DomainError {
  override readonly code = 'engagement.badge_category.order_negative' as const;
  constructor(public readonly rawValue: number) {
    super(
      `A badge category's order must be a non-negative integer: ${rawValue}`,
      { rawValue },
    );
  }
}

export type BadgeCategoryError =
  EmptyIdError | LocalizedTextFieldEmptyError | BadgeCategoryOrderNegativeError;
