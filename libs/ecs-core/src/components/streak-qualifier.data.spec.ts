import { describe, expect, it } from 'vitest';
import type { ServiceCategoryId } from '../entities/service-category.entity';
import type { ServiceId } from '../entities/service.entity';
import {
  QualifierComparison,
  StreakQualifier,
  StreakQualifierKind,
} from './streak-qualifier.data';

// The cases of `streak-qualifier.spec.ts` (create / comparedTo / equals),
// on the plain struct. `counts` — which visit keeps the rhythm — moves with
// the projector to StreakSystem (Phase 2).

const sid = (raw: string) => raw as ServiceId;
const cid = (raw: string) => raw as ServiceCategoryId;
const services = (...ids: string[]): StreakQualifier =>
  StreakQualifier.services(ids.map(sid));
const categories = (...ids: string[]): StreakQualifier =>
  StreakQualifier.categories(ids.map(cid));
const any = StreakQualifier.anyVisit();

function qualifier(raw: StreakQualifier): StreakQualifier {
  const result = StreakQualifier.parse(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

describe('StreakQualifier.parse', () => {
  it('keeps the stored tags', () => {
    expect(Object.values(StreakQualifierKind)).toEqual([
      'anyVisit',
      'services',
      'categories',
    ]);
  });

  it('takes any visit', () => {
    expect(qualifier(any)).toEqual({ kind: 'anyVisit' });
  });

  it('takes a list of services and a list of categories, in the order chosen', () => {
    expect(qualifier(services('svc-fade', 'svc-beard'))).toEqual({
      kind: 'services',
      serviceIds: ['svc-fade', 'svc-beard'],
    });
    expect(qualifier(categories('cat-hair'))).toEqual({
      kind: 'categories',
      categoryIds: ['cat-hair'],
    });
  });

  it('says a name once, however often it was chosen', () => {
    expect(qualifier(services('svc-fade', 'svc-beard', 'svc-fade'))).toEqual({
      kind: 'services',
      serviceIds: ['svc-fade', 'svc-beard'],
    });
  });

  it('keeps nothing of the list it was made from', () => {
    const raw = services('svc-fade');
    const parsed = qualifier(raw);
    expect(parsed).not.toBe(raw);
    expect(
      parsed.kind === 'services' && raw.kind === 'services'
        ? parsed.serviceIds !== raw.serviceIds
        : false,
    ).toBe(true);
  });

  it.each([
    { what: 'no service', ids: [] as string[], value: '' },
    { what: 'a blank service', ids: ['svc-fade', '  '], value: 'svc-fade,   ' },
    { what: 'an empty service', ids: [''], value: '' },
  ])('refuses $what', ({ ids, value }) => {
    const result = StreakQualifier.parse(services(...ids));
    expect(result.ok ? [] : result.error).toEqual([
      {
        code: 'engagement.streak_definition.qualifier_empty',
        field: 'qualifier.serviceIds',
        value,
      },
    ]);
  });

  it.each([
    { what: 'no category', ids: [] as string[] },
    { what: 'a blank category', ids: [' '] },
  ])('refuses $what', ({ ids }) => {
    const result = StreakQualifier.parse(categories(...ids));
    expect(result.ok ? [] : result.error.map((e) => e.field)).toEqual([
      'qualifier.categoryIds',
    ]);
  });

  it('refuses a list that is not one', () => {
    const result = StreakQualifier.parse({
      kind: 'services',
    } as unknown as StreakQualifier);
    expect(result.ok ? [] : result.error).toEqual([
      {
        code: 'engagement.streak_definition.qualifier_empty',
        field: 'qualifier.serviceIds',
        value: null,
      },
    ]);
  });

  it('refuses a kind it does not know', () => {
    const result = StreakQualifier.parse({
      kind: 'barbers',
    } as unknown as StreakQualifier);
    expect(result.ok ? [] : result.error).toEqual([
      {
        code: 'engagement.streak_definition.unknown_option',
        field: 'qualifier.kind',
        value: 'barbers',
        options: 'anyVisit, services, categories',
      },
    ]);
  });
});

describe('StreakQualifier.compare', () => {
  it.each([
    { now: any, before: any, is: 'same' },
    { now: any, before: services('a'), is: 'wider' },
    { now: any, before: categories('x'), is: 'wider' },
    { now: services('a'), before: any, is: 'narrower' },
    { now: categories('x'), before: any, is: 'narrower' },
    { now: services('a', 'b'), before: services('b', 'a'), is: 'same' },
    { now: services('a', 'b'), before: services('a'), is: 'wider' },
    { now: services('a'), before: services('a', 'b'), is: 'narrower' },
    { now: services('a', 'c'), before: services('a', 'b'), is: 'other' },
    { now: categories('x', 'y'), before: categories('x'), is: 'wider' },
    { now: categories('x'), before: services('x'), is: 'other' },
    { now: services('x'), before: categories('x'), is: 'other' },
  ])('$now.kind against $before.kind is $is', ({ now, before, is }) => {
    expect(StreakQualifier.compare(now, before)).toBe(is);
    expect(StreakQualifier.equals(now, before)).toBe(
      is === QualifierComparison.Same,
    );
  });
});
