import { describe, expect, it } from 'vitest';
import { ServiceCategoryId, ServiceId } from '@creativo/domain/catalog';
import {
  StreakQualifier,
  StreakQualifierProps,
  StreakQualifierVisit,
} from './streak-qualifier';

function qualifier(props: StreakQualifierProps): StreakQualifier {
  const result = StreakQualifier.create(props);
  if (result.isFailure()) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function service(raw: string): ServiceId {
  const id = ServiceId.create(raw);
  if (id.isFailure()) throw id.error;
  return id.value;
}

function category(raw: string): ServiceCategoryId {
  const id = ServiceCategoryId.create(raw);
  if (id.isFailure()) throw id.error;
  return id.value;
}

/** One person's worked seats: services, their categories, and which of them only ride along. */
function visit(
  services: readonly string[],
  categories: readonly string[] = [],
  rideAlong: readonly string[] = [],
): StreakQualifierVisit {
  return {
    serviceIds: services.map(service),
    categoryIds: categories.map(category),
    upsellOnlyIds: rideAlong.map(service),
  };
}

describe('StreakQualifier.create', () => {
  it('takes any visit', () => {
    const any = qualifier({ kind: 'anyVisit' });
    expect(any.kind).toBe('anyVisit');
    expect(any.toProps()).toEqual({ kind: 'anyVisit' });
  });

  it('takes a list of services and a list of categories, in the order chosen', () => {
    expect(
      qualifier({
        kind: 'services',
        serviceIds: ['svc-fade', 'svc-beard'],
      }).toProps(),
    ).toEqual({ kind: 'services', serviceIds: ['svc-fade', 'svc-beard'] });
    expect(
      qualifier({ kind: 'categories', categoryIds: ['cat-hair'] }).toProps(),
    ).toEqual({ kind: 'categories', categoryIds: ['cat-hair'] });
  });

  it('says a name once, however often it was chosen', () => {
    expect(
      qualifier({
        kind: 'services',
        serviceIds: ['svc-fade', 'svc-beard', 'svc-fade'],
      }).toProps(),
    ).toEqual({ kind: 'services', serviceIds: ['svc-fade', 'svc-beard'] });
  });

  it.each([
    { what: 'no service', serviceIds: [] },
    { what: 'a blank service', serviceIds: ['svc-fade', '  '] },
    { what: 'an empty service', serviceIds: [''] },
  ])('refuses $what', ({ serviceIds }) => {
    const result = StreakQualifier.create({ kind: 'services', serviceIds });
    expect(result.isFailure() && result.error).toHaveLength(1);
    expect(result.isFailure() && result.error[0]).toMatchObject({
      code: 'engagement.streak_definition.qualifier_empty',
      field: 'qualifier.serviceIds',
      value: serviceIds,
    });
  });

  it.each([
    { what: 'no category', categoryIds: [] },
    { what: 'a blank category', categoryIds: [' '] },
  ])('refuses $what', ({ categoryIds }) => {
    const result = StreakQualifier.create({ kind: 'categories', categoryIds });
    expect(result.isFailure() && result.error).toHaveLength(1);
    expect(result.isFailure() && result.error[0]).toMatchObject({
      code: 'engagement.streak_definition.qualifier_empty',
      field: 'qualifier.categoryIds',
      value: categoryIds,
    });
  });

  it('refuses a list that is not one', () => {
    const result = StreakQualifier.create({
      kind: 'services',
    } as unknown as StreakQualifierProps);
    expect(result.isFailure() && result.error.map((e) => e.field)).toEqual([
      'qualifier.serviceIds',
    ]);
  });

  it('refuses a kind it does not know', () => {
    const result = StreakQualifier.create({
      kind: 'barbers',
    } as unknown as StreakQualifierProps);
    expect(result.isFailure() && result.error).toHaveLength(1);
    expect(result.isFailure() && result.error[0]).toMatchObject({
      code: 'engagement.streak_definition.unknown_option',
      field: 'qualifier.kind',
      value: 'barbers',
      options: ['anyVisit', 'services', 'categories'],
    });
  });
});

describe('StreakQualifier.counts', () => {
  const any = qualifier({ kind: 'anyVisit' });
  const fades = qualifier({
    kind: 'services',
    serviceIds: ['svc-fade', 'svc-beard'],
  });
  const hair = qualifier({ kind: 'categories', categoryIds: ['cat-hair'] });

  it.each([
    {
      what: 'any worked service counts',
      rule: any,
      seat: visit(['svc-wash'], ['cat-care']),
      counts: true,
    },
    {
      what: 'a visit with nothing worked does not',
      rule: any,
      seat: visit([]),
      counts: false,
    },
    {
      what: 'a service that only rides along never counts alone',
      rule: any,
      seat: visit(['svc-wax'], ['cat-care'], ['svc-wax']),
      counts: false,
    },
    {
      what: 'it counts beside a service of its own',
      rule: any,
      seat: visit(['svc-wax', 'svc-fade'], ['cat-hair'], ['svc-wax']),
      counts: true,
    },
    {
      what: 'one chosen service is enough',
      rule: fades,
      seat: visit(['svc-wash', 'svc-beard'], ['cat-care', 'cat-beard']),
      counts: true,
    },
    {
      what: 'a visit with none of the chosen services does not count',
      rule: fades,
      seat: visit(['svc-wash'], ['cat-care']),
      counts: false,
    },
    {
      what: 'a chosen service that only rides along does not count alone',
      rule: qualifier({ kind: 'services', serviceIds: ['svc-wax'] }),
      seat: visit(['svc-wax'], ['cat-care'], ['svc-wax']),
      counts: false,
    },
    {
      what: 'a chosen ride-along counts beside a service of its own',
      rule: qualifier({ kind: 'services', serviceIds: ['svc-wax'] }),
      seat: visit(['svc-wax', 'svc-fade'], ['cat-hair'], ['svc-wax']),
      counts: true,
    },
    {
      what: 'a service of a chosen category counts',
      rule: hair,
      seat: visit(['svc-fade'], ['cat-hair']),
      counts: true,
    },
    {
      what: 'a service of another category does not',
      rule: hair,
      seat: visit(['svc-beard'], ['cat-beard']),
      counts: false,
    },
    {
      what: 'a category is never matched against a service’s id',
      rule: hair,
      seat: visit(['cat-hair'], ['cat-beard']),
      counts: false,
    },
  ])('$what', ({ rule, seat, counts }) => {
    expect(rule.counts(seat)).toBe(counts);
  });
});

describe('StreakQualifier.comparedTo', () => {
  const any: StreakQualifierProps = { kind: 'anyVisit' };
  const services = (...serviceIds: string[]): StreakQualifierProps => ({
    kind: 'services',
    serviceIds,
  });
  const categories = (...categoryIds: string[]): StreakQualifierProps => ({
    kind: 'categories',
    categoryIds,
  });

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
  ])('$now against $before is $is', ({ now, before, is }) => {
    expect(qualifier(now).comparedTo(qualifier(before))).toBe(is);
    expect(qualifier(now).equals(qualifier(before))).toBe(is === 'same');
  });
});

describe('StreakQualifier, as a value', () => {
  it('hands out a copy of its list, never its own', () => {
    const fades = qualifier({ kind: 'services', serviceIds: ['svc-fade'] });
    const props = fades.toProps();
    if (props.kind !== 'services') throw new Error('unreachable');
    (props.serviceIds as string[]).push('svc-wash');
    expect(fades.toProps()).toEqual({
      kind: 'services',
      serviceIds: ['svc-fade'],
    });
    expect(fades.counts(visit(['svc-wash']))).toBe(false);
  });

  it('keeps nothing of the list it was made from', () => {
    const serviceIds = ['svc-fade'];
    const fades = qualifier({ kind: 'services', serviceIds });
    serviceIds.push('svc-wash');
    expect(fades.counts(visit(['svc-wash']))).toBe(false);
  });
});
