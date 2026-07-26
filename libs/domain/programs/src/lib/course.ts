import { Result, combineAll, fail, ok } from '@creativo/domain/kernel';
import { CourseId } from './ids';
import { LocalizedText, LocalizedTextProps } from './localized-text';
import {
  CourseValidationError,
  InvalidCourseApplyUrlError,
  InvalidCourseSortOrderError,
} from './course.errors';

/** Admin-set — a course's timing "runs hot/cold" (owner's own framing), so
 *  this is the single source of truth for the Open/Upcoming split on the
 *  public page, not a date derived from a start-date field. */
export type CourseEnrollmentStatus = 'open' | 'upcoming' | 'closed';

export interface CourseProps {
  id: string;
  title: LocalizedTextProps;
  description: LocalizedTextProps;
  enrollmentStatus: CourseEnrollmentStatus;
  /** Human copy like "Spring 2026" for a course without a fixed date yet. */
  startsLabel?: LocalizedTextProps;
  applyUrl?: string;
  sortOrder: number;
}

/** **Aggregate root** for a barbering course listing. */
export class Course {
  private constructor(
    readonly id: CourseId,
    readonly title: LocalizedText,
    readonly description: LocalizedText,
    readonly enrollmentStatus: CourseEnrollmentStatus,
    readonly startsLabel: LocalizedText | null,
    readonly applyUrl: string | null,
    readonly sortOrder: number,
  ) {}

  static create(props: CourseProps): Result<Course, CourseValidationError[]> {
    return Course.build(props);
  }

  static reconstitute(
    props: CourseProps,
  ): Result<Course, CourseValidationError[]> {
    return Course.build(props);
  }

  private static build(
    props: CourseProps,
  ): Result<Course, CourseValidationError[]> {
    const idResult = CourseId.create(props.id);
    const sortOrderResult = Course.validateSortOrder(props.sortOrder);

    const combined = combineAll([idResult, sortOrderResult] as const);
    const errors: CourseValidationError[] = combined.isFailure()
      ? [...combined.error]
      : [];

    const titleResult = LocalizedText.create(props.title);
    if (titleResult.isFailure()) {
      errors.push(...titleResult.error);
    }
    const descriptionResult = LocalizedText.create(props.description);
    if (descriptionResult.isFailure()) {
      errors.push(...descriptionResult.error);
    }
    const startsLabelResult = props.startsLabel
      ? LocalizedText.create(props.startsLabel)
      : ok<LocalizedText | null, never>(null);
    if (startsLabelResult.isFailure()) {
      errors.push(...startsLabelResult.error);
    }
    const applyUrlResult = Course.validateApplyUrl(props.applyUrl);
    if (applyUrlResult.isFailure()) {
      errors.push(applyUrlResult.error);
    }

    if (errors.length > 0) {
      return fail(errors);
    }
    if (
      combined.isFailure() ||
      titleResult.isFailure() ||
      descriptionResult.isFailure() ||
      startsLabelResult.isFailure() ||
      applyUrlResult.isFailure()
    ) {
      // Unreachable given the check above — narrows every Result to
      // Success below without an unsafe assertion.
      return fail(errors);
    }

    const [id, sortOrder] = combined.value;

    return ok(
      new Course(
        id,
        titleResult.value,
        descriptionResult.value,
        props.enrollmentStatus,
        startsLabelResult.value,
        applyUrlResult.value,
        sortOrder,
      ),
    );
  }

  private static validateSortOrder(
    raw: number,
  ): Result<number, InvalidCourseSortOrderError> {
    return Number.isInteger(raw) && raw >= 0
      ? ok(raw)
      : fail(new InvalidCourseSortOrderError(raw));
  }

  private static validateApplyUrl(
    raw: string | undefined,
  ): Result<string | null, InvalidCourseApplyUrlError> {
    if (raw === undefined || raw.trim().length === 0) {
      return ok(null);
    }
    try {
      new URL(raw);
      return ok(raw);
    } catch {
      return fail(new InvalidCourseApplyUrlError(raw));
    }
  }

  isOpenOrUpcoming(): boolean {
    return this.enrollmentStatus !== 'closed';
  }
}
