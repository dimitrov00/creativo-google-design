import { DomainError } from '@creativo/domain/kernel';
import { CourseValidationError } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';

export class CourseNotFoundError extends DomainError {
  readonly code = 'programs.update_course.not_found' as const;
  constructor() {
    super('No course exists with the given id');
  }
}

export class UpdateCourseValidationFailure extends DomainError {
  readonly code = 'programs.update_course.validation_failed' as const;
  constructor(public readonly errors: readonly CourseValidationError[]) {
    super('Course validation failed');
  }
}

export class UpdateCourseRepositoryFailure extends DomainError {
  readonly code = 'programs.update_course.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Failed to save the updated course');
  }
}

export type UpdateCourseError =
  | CourseNotFoundError
  | UpdateCourseValidationFailure
  | UpdateCourseRepositoryFailure;
