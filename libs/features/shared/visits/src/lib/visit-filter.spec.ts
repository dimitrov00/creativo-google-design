import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VisitListSystem } from '@core/systems';
import { describe, expect, it } from 'vitest';
import { visitFilterWordKey } from './visit-filter';
import { VisitFilter, VisitPerspective } from './visit-row.vm';

// The options, their order and the narrowing rule are `VisitListSystem`'s,
// proved in `visit-list.system.spec.ts`; this file keeps the option's word.

describe('visitFilterWordKey', () => {
  const catalogue = (lang: 'bg' | 'en') =>
    JSON.parse(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
      readFileSync(
        resolve(
          __dirname,
          `../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;

  const word = (tree: Record<string, unknown>, key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node !== null && typeof node === 'object'
            ? new Map(Object.entries(node)).get(part)
            : undefined,
        tree,
      );

  it('words the no-show by who reads it, every other option alike', () => {
    expect(
      visitFilterWordKey(VisitFilter.NoShow, VisitPerspective.Client),
    ).toBe('visits.filter.no_show');
    expect(visitFilterWordKey(VisitFilter.NoShow, VisitPerspective.Staff)).toBe(
      'visits.filter.no_show_staff',
    );
    expect(
      visitFilterWordKey(VisitFilter.Cancelled, VisitPerspective.Staff),
    ).toBe('visits.filter.cancelled');
  });

  it('names a word both catalogues carry, for every option of both menus', () => {
    const bg = catalogue('bg');
    const en = catalogue('en');
    for (const perspective of [
      VisitPerspective.Client,
      VisitPerspective.Staff,
    ]) {
      for (const filter of VisitListSystem.filtersFor(perspective)) {
        const key = visitFilterWordKey(filter, perspective);
        expect(typeof word(bg, key), `bg ${key}`).toBe('string');
        expect(typeof word(en, key), `en ${key}`).toBe('string');
      }
    }
    expect(word(bg, 'visits.filter.no_show')).toBe('Пропуснати');
    expect(word(bg, 'visits.filter.no_show_staff')).toBe('Неявявания');
  });
});
