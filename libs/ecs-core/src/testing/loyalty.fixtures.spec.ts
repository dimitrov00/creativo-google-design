import { describe, expect, it } from 'vitest';
import { DayKey } from '../components/day-key.data';
import { StreakRule } from '../components/streak-rule.data';
import { FIXTURE_TODAY } from '../testing';
import {
  FIXTURE_STREAK_OPENED_AT_MS,
  giftVouchersJson,
  loyaltyCatalogJson,
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
} from './loyalty.fixtures';

/*
 * The loyalty fixtures tell ONE story: the JSON the dev seed writes and the
 * entities the loyalty flip's pipeline specs start from are the same rule,
 * opened the same instant.
 */

const head = loyaltyCatalogJson.streakDefinitions.cadence;

describe('the loyalty JSON fixtures', () => {
  it('holds every catalogue collection, keyed by collection', () => {
    expect(Object.keys(loyaltyCatalogJson)).toEqual([
      'badgeCategories',
      'badgeSeries',
      'seasons',
      'tierDefinitions',
      'rewardsCatalog',
      'streakDefinitions',
    ]);
    expect(Object.keys(giftVouchersJson)).toEqual(['giftVouchers']);
  });

  it('is deep-frozen: a spec cannot leak a write into the next one', () => {
    expect(Object.isFrozen(loyaltyCatalogJson)).toBe(true);
    expect(Object.isFrozen(head.current.excuses)).toBe(true);
    expect(Object.isFrozen(giftVouchersJson.giftVouchers)).toBe(true);
    expect(() => {
      (head.current as { graceDays: number }).graceDays = 99;
    }).toThrow(TypeError);
  });

  it('is dated before FIXTURE_TODAY, the day it is true on', () => {
    expect(head.current.effectiveFrom < FIXTURE_TODAY).toBe(true);
  });
});

describe('streakDefinitionFixture — catalog.json’s head, as the entity', () => {
  it('is the recommended rule the JSON opens with, in the ECS shape', () => {
    const { effectiveFrom, ...rest } = head.current;
    expect(streakDefinitionFixture()).toEqual({
      id: 'cadence',
      name: head.name,
      current: { ...rest, effectiveFromDayKey: DayKey.of(effectiveFrom) },
      scheduled: head.scheduled,
      updatedAtMs: Date.parse(head.updatedAt),
    });
    expect(streakDefinitionFixture().current).toBe(StreakRule.DEFAULT);
  });

  it('pins the opening instant as a literal that agrees with the JSON', () => {
    expect(FIXTURE_STREAK_OPENED_AT_MS).toBe(Date.parse(head.updatedAt));
  });

  it('takes overrides field by field', () => {
    const scheduled = {
      ...StreakRule.DEFAULT,
      version: 2,
      effectiveFromDayKey: DayKey.of('2026-10-05'),
      graceDays: 10,
      transition: 'grandfather' as const,
    };
    expect(streakDefinitionFixture({ scheduled })).toEqual({
      ...streakDefinitionFixture(),
      scheduled,
    });
  });
});

describe('streakDefinitionVersionFixture — the history the seed gives the head', () => {
  it('is version 000001: the rule in force, published by nobody by hand, never withdrawn', () => {
    expect(streakDefinitionVersionFixture()).toEqual({
      ...StreakRule.DEFAULT,
      id: '000001',
      publishedAtMs: FIXTURE_STREAK_OPENED_AT_MS,
      publishedBy: 'system',
      transition: 'grandfather',
      direction: 'neutral',
      changed: [],
      requestId: 'seed-cadence-000001',
      withdrawnAtMs: null,
    });
  });

  it('takes overrides field by field', () => {
    expect(
      streakDefinitionVersionFixture({ withdrawnAtMs: 1 }).withdrawnAtMs,
    ).toBe(1);
  });
});
