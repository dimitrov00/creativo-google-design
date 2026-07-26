import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { Course } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';
import { CourseRepository } from '../ports/course-repository.port';

export class ObserveAllCoursesUseCase {
  constructor(private readonly courses: CourseRepository) {}

  execute(): Observable<Result<readonly Course[], RepositoryError>> {
    return this.courses.observeAll();
  }
}
