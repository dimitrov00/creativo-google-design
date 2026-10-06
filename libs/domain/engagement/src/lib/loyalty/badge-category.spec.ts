import { describe, expect, it } from 'vitest';
import { BadgeCategory } from './badge-category';
import { BadgeCategoryOrderNegativeError } from './badge-category.errors';

const props = {
  id: 'cat-mastery',
  kind: 'mastery' as const,
  title: { bg: 'Майсторство', en: 'Mastery' },
  order: 2,
};

describe('BadgeCategory.create', () => {
  it('makes a shelf with a typed id and both locales', () => {
    const result = BadgeCategory.create(props);
    if (result.isFailure()) throw new Error('expected a category');
    const category = result.value;
    expect(category.id.value).toBe('cat-mastery');
    expect(category.kind).toBe('mastery');
    expect(category.title.get('bg')).toBe('Майсторство');
    expect(category.title.get('en')).toBe('Mastery');
    expect(category.order).toBe(2);
  });

  it.each([-1, 1.5, Number.NaN])('refuses the order %s', (order) => {
    const result = BadgeCategory.create({ ...props, order });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toEqual([
        expect.any(BadgeCategoryOrderNegativeError),
      ]);
    }
  });

  it('reports every problem at once', () => {
    const result = BadgeCategory.create({
      id: ' ',
      kind: 'rhythm',
      title: { bg: '', en: 'Rhythm' },
      order: -2,
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.map((e) => e.code).sort()).toEqual([
        'catalog.localized_text.field_empty',
        'engagement.badge_category.order_negative',
        'engagement.id.empty',
      ]);
    }
  });
});

describe('BadgeCategory.holdsRecords', () => {
  it('is the records rail only', () => {
    const records = BadgeCategory.create({
      ...props,
      id: 'cat-records',
      kind: 'records',
    });
    const mastery = BadgeCategory.create(props);
    expect(records.isSuccess() && records.value.holdsRecords()).toBe(true);
    expect(mastery.isSuccess() && mastery.value.holdsRecords()).toBe(false);
  });
});
