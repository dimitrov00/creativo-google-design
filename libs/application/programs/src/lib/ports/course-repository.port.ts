import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { Course, CourseId } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';

export interface CourseRepository {
  findById(id: CourseId): Promise<Result<Course | null, RepositoryError>>;
  save(course: Course): Promise<Result<void, RepositoryError>>;
  /** Live courses with `enrollmentStatus` `open` or `upcoming` — `closed` courses never reach the public page. */
  observeOpenAndUpcoming(): Observable<
    Result<readonly Course[], RepositoryError>
  >;
  /** Live courses regardless of status — the admin view, which manages closed courses too (e.g. reopening one). */
  observeAll(): Observable<Result<readonly Course[], RepositoryError>>;
}

export const COURSE_REPOSITORY = new InjectionToken<CourseRepository>(
  'CourseRepository',
);
