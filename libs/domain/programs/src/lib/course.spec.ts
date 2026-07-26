import { describe, expect, it } from 'vitest';
import { Course } from './course';

function validProps() {
  return {
    id: 'course_1',
    title: { en: 'Fundamentals of Fading', bg: 'Основи на фейда' },
    description: { en: 'Six-week evening course', bg: 'Шестседмичен курс' },
    enrollmentStatus: 'open' as const,
    startsLabel: { en: 'Spring 2026', bg: 'Пролет 2026' },
    applyUrl: 'https://instagram.com/creativo.barbershop',
    sortOrder: 0,
  };
}

describe('Course.create', () => {
  it('accepts fully valid props', () => {
    const result = Course.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.title.en).toBe('Fundamentals of Fading');
      expect(result.value.startsLabel?.en).toBe('Spring 2026');
      expect(result.value.isOpenOrUpcoming()).toBe(true);
    }
  });

  it('accepts a missing startsLabel/applyUrl as null', () => {
    const result = Course.create({
      id: 'course_1',
      title: { en: 'Fundamentals of Fading', bg: 'Основи на фейда' },
      description: { en: 'Six-week evening course', bg: 'Шестседмичен курс' },
      enrollmentStatus: 'open',
      sortOrder: 0,
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.startsLabel).toBeNull();
      expect(result.value.applyUrl).toBeNull();
    }
  });

  it('treats a closed course as not open-or-upcoming', () => {
    const result = Course.create({
      ...validProps(),
      enrollmentStatus: 'closed',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.isOpenOrUpcoming()).toBe(false);
    }
  });

  it('rejects an empty id', () => {
    expect(Course.create({ ...validProps(), id: '' }).isFailure()).toBe(true);
  });

  it('rejects a blank localized description field', () => {
    expect(
      Course.create({
        ...validProps(),
        description: { en: '', bg: 'Курс' },
      }).isFailure(),
    ).toBe(true);
  });

  it('rejects a negative sort order', () => {
    expect(Course.create({ ...validProps(), sortOrder: -1 }).isFailure()).toBe(
      true,
    );
  });

  it('rejects a malformed apply URL', () => {
    expect(
      Course.create({ ...validProps(), applyUrl: 'not a url' }).isFailure(),
    ).toBe(true);
  });
});

describe('Course.reconstitute', () => {
  it('validates identically to create()', () => {
    expect(Course.reconstitute(validProps()).isSuccess()).toBe(true);
  });
});
