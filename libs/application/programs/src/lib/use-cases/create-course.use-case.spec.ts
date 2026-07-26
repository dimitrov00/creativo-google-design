import { describe, expect, it } from 'vitest';
import { Result, ok } from '@creativo/domain/kernel';
import { Course } from '@creativo/domain/programs';
import { RepositoryError } from '@creativo/application/shared';
import { CourseRepository } from '../ports/course-repository.port';
import { CreateCourseUseCase } from './create-course.use-case';
import { CreateCourseValidationFailure } from './create-course.errors';

function fakeRepository(): CourseRepository & { saved: Course[] } {
  const saved: Course[] = [];
  return {
    saved,
    async save(course): Promise<Result<void, RepositoryError>> {
      saved.push(course);
      return ok(undefined);
    },
    async findById(): Promise<Result<Course | null, RepositoryError>> {
      return ok(null);
    },
    observeOpenAndUpcoming() {
      throw new Error('not used in this spec');
    },
    observeAll() {
      throw new Error('not used in this spec');
    },
  };
}

function fakeIdGenerator(prefix: string) {
  let n = 0;
  return { next: () => `${prefix}-${++n}` };
}

describe('CreateCourseUseCase', () => {
  it('creates and saves an open course', async () => {
    const repo = fakeRepository();
    const useCase = new CreateCourseUseCase(repo, fakeIdGenerator('course'));

    const result = await useCase.execute({
      title: { en: 'Fundamentals of Fading', bg: 'Основи на фейда' },
      description: { en: 'Six-week evening course', bg: 'Шестседмичен курс' },
      enrollmentStatus: 'open',
      sortOrder: 0,
    });

    expect(result.isSuccess()).toBe(true);
    expect(repo.saved).toHaveLength(1);
    if (result.isSuccess()) {
      expect(result.value.isOpenOrUpcoming()).toBe(true);
    }
  });

  it('rejects a blank description', async () => {
    const repo = fakeRepository();
    const useCase = new CreateCourseUseCase(repo, fakeIdGenerator('course'));

    const result = await useCase.execute({
      title: { en: 'Fundamentals of Fading', bg: 'Основи на фейда' },
      description: { en: '', bg: '' },
      enrollmentStatus: 'open',
      sortOrder: 0,
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(CreateCourseValidationFailure);
    }
    expect(repo.saved).toHaveLength(0);
  });
});
