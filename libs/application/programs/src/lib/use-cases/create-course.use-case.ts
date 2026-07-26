import { Result, fail, ok } from '@creativo/domain/kernel';
import { Course, CourseEnrollmentStatus } from '@creativo/domain/programs';
import { IdGenerator } from '@creativo/application/shared';
import { CourseRepository } from '../ports/course-repository.port';
import {
  CreateCourseError,
  CreateCourseRepositoryFailure,
  CreateCourseValidationFailure,
} from './create-course.errors';

export interface CreateCourseInput {
  readonly title: { readonly en: string; readonly bg: string };
  readonly description: { readonly en: string; readonly bg: string };
  readonly enrollmentStatus: CourseEnrollmentStatus;
  readonly startsLabel?: { readonly en: string; readonly bg: string };
  readonly applyUrl?: string;
  readonly sortOrder: number;
}

export class CreateCourseUseCase {
  constructor(
    private readonly courses: CourseRepository,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(
    input: CreateCourseInput,
  ): Promise<Result<Course, CreateCourseError>> {
    const courseResult = Course.create({
      id: this.idGenerator.next(),
      ...input,
    });
    if (courseResult.isFailure()) {
      return fail(new CreateCourseValidationFailure(courseResult.error));
    }
    const course = courseResult.value;

    const saveResult = await this.courses.save(course);
    if (saveResult.isFailure()) {
      return fail(new CreateCourseRepositoryFailure(saveResult.error));
    }

    return ok(course);
  }
}
