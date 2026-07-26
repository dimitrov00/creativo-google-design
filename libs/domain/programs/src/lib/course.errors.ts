import { DomainError } from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';
import { LocalizedTextFieldEmptyError } from './localized-text.errors';

export class InvalidCourseSortOrderError extends DomainError {
  readonly code = 'programs.course.invalid_sort_order' as const;
  constructor(public readonly rawValue: number) {
    super(`Course sort order must be a non-negative integer: ${rawValue}`, {
      rawValue,
    });
  }
}

export class InvalidCourseApplyUrlError extends DomainError {
  readonly code = 'programs.course.invalid_apply_url' as const;
  constructor(public readonly rawValue: string) {
    super(`Course apply URL is not a valid URL: ${rawValue}`, { rawValue });
  }
}

export type CourseValidationError =
  | EmptyIdError
  | LocalizedTextFieldEmptyError
  | InvalidCourseSortOrderError
  | InvalidCourseApplyUrlError;
