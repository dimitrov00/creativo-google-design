import { DomainError } from '@creativo/domain/kernel';
import { CourseValidationError } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';

export class CreateCourseValidationFailure extends DomainError {
  readonly code = 'programs.create_course.validation_failed' as const;
  constructor(public readonly errors: readonly CourseValidationError[]) {
    super('Course validation failed');
  }
}

export class CreateCourseRepositoryFailure extends DomainError {
  readonly code = 'programs.create_course.repository_failure' as const;
  constructor(public override readonly cause: RepositoryError) {
    super('Failed to save the new course');
  }
}

export type CreateCourseError =
  CreateCourseValidationFailure | CreateCourseRepositoryFailure;
