import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  Course,
  CourseEnrollmentStatus,
  CourseId,
} from '@creativo/domain/programs';
import { CourseRepository } from '../ports/course-repository.port';
import {
  CourseNotFoundError,
  UpdateCourseError,
  UpdateCourseRepositoryFailure,
  UpdateCourseValidationFailure,
} from './update-course.errors';

export interface UpdateCourseInput {
  readonly id: CourseId;
  readonly title: { readonly en: string; readonly bg: string };
  readonly description: { readonly en: string; readonly bg: string };
  readonly enrollmentStatus: CourseEnrollmentStatus;
  readonly startsLabel?: { readonly en: string; readonly bg: string };
  readonly applyUrl?: string;
  readonly sortOrder: number;
}

/** Same posture as `UpdatePositionUseCase` — the admin form submits the
 *  full edited record, so `findById` only confirms the course still
 *  exists before rebuilding through `Course.create` and saving. */
export class UpdateCourseUseCase {
  constructor(private readonly courses: CourseRepository) {}

  async execute(
    input: UpdateCourseInput,
  ): Promise<Result<Course, UpdateCourseError>> {
    const foundResult = await this.courses.findById(input.id);
    if (foundResult.isFailure()) {
      return fail(new UpdateCourseRepositoryFailure(foundResult.error));
    }
    if (!foundResult.value) {
      return fail(new CourseNotFoundError());
    }

    const rebuiltResult = Course.create({
      id: input.id.value,
      title: input.title,
      description: input.description,
      enrollmentStatus: input.enrollmentStatus,
      ...(input.startsLabel !== undefined && {
        startsLabel: input.startsLabel,
      }),
      ...(input.applyUrl !== undefined && { applyUrl: input.applyUrl }),
      sortOrder: input.sortOrder,
    });
    if (rebuiltResult.isFailure()) {
      return fail(new UpdateCourseValidationFailure(rebuiltResult.error));
    }
    const updated = rebuiltResult.value;

    const saveResult = await this.courses.save(updated);
    if (saveResult.isFailure()) {
      return fail(new UpdateCourseRepositoryFailure(saveResult.error));
    }

    return ok(updated);
  }
}
