import { describe, expect, it } from 'vitest';
import { ServiceCategory } from './service-category';

function validProps() {
  return {
    id: 'category_1',
    name: { en: 'Hair', bg: 'Коса' },
    sortOrder: 0,
  };
}

describe('ServiceCategory.create', () => {
  it('accepts fully valid props', () => {
    const result = ServiceCategory.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.name.en).toBe('Hair');
      expect(result.value.sortOrder).toBe(0);
    }
  });

  it('rejects an empty id', () => {
    expect(
      ServiceCategory.create({ ...validProps(), id: '' }).isFailure(),
    ).toBe(true);
  });

  it('rejects a negative sort order', () => {
    expect(
      ServiceCategory.create({ ...validProps(), sortOrder: -1 }).isFailure(),
    ).toBe(true);
  });

  it('rejects a non-integer sort order', () => {
    expect(
      ServiceCategory.create({ ...validProps(), sortOrder: 1.5 }).isFailure(),
    ).toBe(true);
  });

  it('rejects a blank localized name field', () => {
    expect(
      ServiceCategory.create({
        ...validProps(),
        name: { en: '', bg: 'Коса' },
      }).isFailure(),
    ).toBe(true);
  });

  it('collects every invalid field at once', () => {
    const result = ServiceCategory.create({
      id: '',
      name: { en: '', bg: '' },
      sortOrder: -1,
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('ServiceCategory.reconstitute', () => {
  it('validates identically to create()', () => {
    expect(ServiceCategory.reconstitute(validProps()).isSuccess()).toBe(true);
  });
});
