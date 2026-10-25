import { describe, expect, it } from 'vitest';
import { ServiceCategoryId, ServiceId } from '@core/primitives';
import { deepFreeze } from '@core/testing';
import { QualifierComparison } from './qualifier-comparison.data';
import { StreakQualifier, StreakQualifierRule } from './streak-qualifier.data';

// The cases of `streak-qualifier.spec.ts` (create / comparedTo / equals),
// on the flat slice. `counts` — which visit keeps the rhythm — moves with
// the projector to StreakSystem (Phase 2).

const services = (...ids: string[]): StreakQualifierRule =>
  StreakQualifierRule.services(ids.map(ServiceId.of));
const categories = (...ids: string[]): StreakQualifierRule =>
  StreakQualifierRule.categories(ids.map(ServiceCategoryId.of));
const any = StreakQualifierRule.anyVisit();

function qualifier(raw: StreakQualifierRule): StreakQualifierRule {
  const result = StreakQualifierRule.parse(raw);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

describe('StreakQualifierRule.parse', () => {
  it('declares the qualifiers SCREAMING (the discriminator `streakQualifier`)', () => {
    expect(Object.values(StreakQualifier)).toEqual([
      'ANY_VISIT',
      'SERVICES',
      'CATEGORIES',
    ]);
    expect(Object.values(QualifierComparison)).toEqual([
      'SAME',
      'WIDER',
      'NARROWER',
      'OTHER',
    ]);
  });

  it('takes any visit', () => {
    expect(qualifier(any)).toEqual({ streakQualifier: 'ANY_VISIT' });
  });

  it('takes a list of services and a list of categories, in the order chosen', () => {
    expect(qualifier(services('svc-fade', 'svc-beard'))).toEqual({
      streakQualifier: 'SERVICES',
      qualifierServiceIds: ['svc-fade', 'svc-beard'],
    });
    expect(qualifier(categories('cat-hair'))).toEqual({
      streakQualifier: 'CATEGORIES',
      qualifierCategoryIds: ['cat-hair'],
    });
  });

  it('says a name once, however often it was chosen', () => {
    expect(qualifier(services('svc-fade', 'svc-beard', 'svc-fade'))).toEqual({
      streakQualifier: 'SERVICES',
      qualifierServiceIds: ['svc-fade', 'svc-beard'],
    });
  });

  it('keeps nothing of the list it was made from', () => {
    const raw = services('svc-fade');
    const parsed = qualifier(raw);
    expect(parsed).not.toBe(raw);
    expect(
      parsed.streakQualifier === StreakQualifier.Services &&
        raw.streakQualifier === StreakQualifier.Services
        ? parsed.qualifierServiceIds !== raw.qualifierServiceIds
        : false,
    ).toBe(true);
  });

  it.each([
    { what: 'no service', ids: [] as string[], value: '' },
    { what: 'a blank service', ids: ['svc-fade', '  '], value: 'svc-fade,   ' },
    { what: 'an empty service', ids: [''], value: '' },
  ])('refuses $what', ({ ids, value }) => {
    const result = StreakQualifierRule.parse(services(...ids));
    expect(result.ok ? [] : result.error).toEqual([
      {
        errorCode: 'ENGAGEMENT_STREAK_DEFINITION_QUALIFIER_EMPTY',
        field: 'qualifierServiceIds',
        value,
      },
    ]);
  });

  it.each([
    { what: 'no category', ids: [] as string[] },
    { what: 'a blank category', ids: [' '] },
  ])('refuses $what', ({ ids }) => {
    const result = StreakQualifierRule.parse(categories(...ids));
    expect(result.ok ? [] : result.error.map((e) => e.field)).toEqual([
      'qualifierCategoryIds',
    ]);
  });

  it('refuses a list that is not one', () => {
    const result = StreakQualifierRule.parse({
      streakQualifier: StreakQualifier.Services,
    } as unknown as StreakQualifierRule);
    expect(result.ok ? [] : result.error).toEqual([
      {
        errorCode: 'ENGAGEMENT_STREAK_DEFINITION_QUALIFIER_EMPTY',
        field: 'qualifierServiceIds',
        value: null,
      },
    ]);
  });

  it('refuses a qualifier it does not know', () => {
    const result = StreakQualifierRule.parse({
      streakQualifier: 'BARBERS',
    } as unknown as StreakQualifierRule);
    expect(result.ok ? [] : result.error).toEqual([
      {
        errorCode: 'ENGAGEMENT_STREAK_DEFINITION_UNKNOWN_OPTION',
        field: 'streakQualifier',
        value: 'BARBERS',
        options: 'ANY_VISIT, SERVICES, CATEGORIES',
      },
    ]);
  });

  it('copies just the qualifier fields of a whole rule, the list fresh', () => {
    const rule = { ...services('a', 'b'), graceDays: 7 };
    const copy = StreakQualifierRule.of(rule);
    expect(copy).toEqual(services('a', 'b'));
    expect(
      copy.streakQualifier === StreakQualifier.Services
        ? copy.qualifierServiceIds !==
            (rule as StreakQualifierRule.Services).qualifierServiceIds
        : false,
    ).toBe(true);
  });
});

describe('StreakQualifierRule.compare', () => {
  it.each([
    { now: any, before: any, is: 'SAME' },
    { now: any, before: services('a'), is: 'WIDER' },
    { now: any, before: categories('x'), is: 'WIDER' },
    { now: services('a'), before: any, is: 'NARROWER' },
    { now: categories('x'), before: any, is: 'NARROWER' },
    { now: services('a', 'b'), before: services('b', 'a'), is: 'SAME' },
    { now: services('a', 'b'), before: services('a'), is: 'WIDER' },
    { now: services('a'), before: services('a', 'b'), is: 'NARROWER' },
    { now: services('a', 'c'), before: services('a', 'b'), is: 'OTHER' },
    { now: categories('x', 'y'), before: categories('x'), is: 'WIDER' },
    { now: categories('x'), before: services('x'), is: 'OTHER' },
    { now: services('x'), before: categories('x'), is: 'OTHER' },
  ])(
    '$now.streakQualifier against $before.streakQualifier is $is',
    ({ now, before, is }) => {
      expect(StreakQualifierRule.compare(now, before)).toBe(is);
      expect(StreakQualifierRule.equals(now, before)).toBe(
        is === QualifierComparison.Same,
      );
    },
  );
});

describe('StreakQualifierRule.toggleService — the services sheet’s tap', () => {
  const fade = ServiceId.of('svc-fade');
  const beard = ServiceId.of('svc-beard');
  const wash = ServiceId.of('svc-wash');

  it('adds a service not chosen at the end, keeping the order the admin chose', () => {
    expect(StreakQualifierRule.toggleService([], fade)).toEqual([fade]);
    expect(StreakQualifierRule.toggleService([fade], beard)).toEqual([
      fade,
      beard,
    ]);
    expect(StreakQualifierRule.toggleService([beard, fade], wash)).toEqual([
      beard,
      fade,
      wash,
    ]);
  });

  it('takes a chosen service out', () => {
    expect(StreakQualifierRule.toggleService([fade, beard], fade)).toEqual([
      beard,
    ]);
    expect(
      StreakQualifierRule.toggleService([fade, beard, wash], beard),
    ).toEqual([fade, wash]);
  });

  it('keeps the last one chosen: a list of services names at least one', () => {
    const last = [beard];
    expect(StreakQualifierRule.toggleService(last, beard)).toBe(last);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const ids = deepFreeze([fade, beard]);
    const once = StreakQualifierRule.toggleService(ids, fade);
    expect(StreakQualifierRule.toggleService(ids, fade)).toEqual(once);
    expect(ids).toEqual([fade, beard]);
  });
});
