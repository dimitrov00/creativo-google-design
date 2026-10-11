import { describe, expect, it } from 'vitest';
import { StreakInterval } from '../components/streak-interval.data';
import { StreakQualifier } from '../components/streak-qualifier.data';
import {
  StreakExcuse,
  StreakOnBreak,
  StreakRule,
  type StreakHeadRule,
} from '../components/streak-rule.data';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { FIXTURE_TODAY, localDate, unwrapOk, utcMs } from '../testing';
import {
  FIXTURE_STREAK_OPENED_AT_UTC_MS,
  giftVouchersJson,
  loyaltyCatalogJson,
  streakDefinitionFixture,
  streakDefinitionVersionFixture,
} from './loyalty.fixtures';

/*
 * The loyalty fixtures tell ONE story: the JSON the dev seed writes and the
 * entities the loyalty flip's pipeline specs start from are the same rule,
 * opened the same instant.
 *
 * The JSON is today's wire (frozen): a nested rule with lowercase tags and
 * an ISO instant. The entities are flat (Laws 6 and 7): `wire` below reads
 * the one into the other field by field, by the tables of the wire's own
 * words, so the two are held to each other rather than each to itself.
 */

const head = loyaltyCatalogJson.streakDefinitions.cadence;

/** The wire's tags, word for word, as the dictionaries hold them. */
const WIRE_QUALIFIER = { anyVisit: StreakQualifier.AnyVisit } as const;
const WIRE_INTERVAL = { fixed: StreakInterval.Fixed } as const;
const WIRE_EXCUSE = {
  shopClosure: StreakExcuse.ShopClosure,
  barberAbsence: StreakExcuse.BarberAbsence,
  staffCancelled: StreakExcuse.StaffCancelled,
  closedDays: StreakExcuse.ClosedDays,
} as const;
const WIRE_ON_BREAK = {
  restart: StreakOnBreak.Restart,
  hold: StreakOnBreak.Hold,
} as const;

/** `catalog.json`'s rule in force, read flat — every part's figures prefixed by the part. */
function wire(rule: typeof head.current): StreakRule {
  return {
    version: rule.version,
    effectiveFromLocalDate: localDate(rule.effectiveFrom),
    enabled: rule.enabled,
    streakQualifier:
      WIRE_QUALIFIER[rule.qualifier.kind as keyof typeof WIRE_QUALIFIER],
    minGapDays: rule.minGapDays,
    bookingHoldEnabled: rule.bookingHold.enabled,
    bookingHoldMaxDaysPastDue: rule.bookingHold.maxDaysPastDue,
    streakInterval:
      WIRE_INTERVAL[rule.interval.kind as keyof typeof WIRE_INTERVAL],
    intervalDays: rule.interval.days,
    graceDays: rule.graceDays,
    riskLeadDays: rule.riskLeadDays,
    protectionsEnabled: rule.protections.enabled,
    protectionsMaxBanked: rule.protections.maxBanked,
    protectionsEarnEvery: rule.protections.earnEvery,
    protectionsStartWith: rule.protections.startWith,
    excuses: rule.excuses.map(
      (excuse) => WIRE_EXCUSE[excuse as keyof typeof WIRE_EXCUSE],
    ),
    clientPauseEnabled: rule.clientPause.enabled,
    clientPauseMaxDaysPerYear: rule.clientPause.maxDaysPerYear,
    repairEnabled: rule.repair.enabled,
    repairWindowDays: rule.repair.windowDays,
    repairPerYear: rule.repair.perYear,
    onBreak: WIRE_ON_BREAK[rule.onBreak as keyof typeof WIRE_ON_BREAK],
  };
}

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
    // Nothing waits on the wire (`scheduled: null`): the head is ONE element.
    expect(head.scheduled).toBeNull();
    expect(streakDefinitionFixture()).toEqual({
      id: 'cadence',
      name: head.name,
      rules: [
        {
          ...wire(head.current),
          headRole: 'CURRENT',
          streakTransition: null,
        },
      ],
      updatedAtUtcMs: utcMs(head.updatedAt),
    });
    const [current] = streakDefinitionFixture().rules;
    expect(current === undefined ? null : StreakRule.of(current)).toEqual(
      StreakRule.DEFAULT,
    );
  });

  it('pins the opening instant as a literal that agrees with the JSON', () => {
    expect(FIXTURE_STREAK_OPENED_AT_UTC_MS).toBe(utcMs(head.updatedAt));
  });

  it('takes overrides field by field', () => {
    const scheduled: StreakHeadRule = {
      ...StreakRule.DEFAULT,
      version: 2,
      effectiveFromLocalDate: localDate('2026-10-05'),
      graceDays: 10,
      headRole: 'SCHEDULED',
      streakTransition: 'GRANDFATHER',
    };
    const rules = [...streakDefinitionFixture().rules, scheduled];
    expect(streakDefinitionFixture({ rules })).toEqual({
      ...streakDefinitionFixture(),
      rules,
    });
  });
});

describe('streakDefinitionVersionFixture — the history the seed gives the head', () => {
  it('is version 000001: the rule in force, published by nobody by hand, never withdrawn', () => {
    expect(streakDefinitionVersionFixture()).toEqual({
      ...StreakRule.DEFAULT,
      id: '000001',
      publishedAtUtcMs: FIXTURE_STREAK_OPENED_AT_UTC_MS,
      publishedByUserId: 'system',
      streakTransition: 'GRANDFATHER',
      streakRuleDirection: 'NEUTRAL',
      changed: [],
      requestId: 'seed-cadence-000001',
      withdrawnAtUtcMs: null,
    });
  });

  it('takes overrides field by field', () => {
    const withdrawnAtUtcMs = unwrapOk(UtcEpochMs.of(1));
    expect(
      streakDefinitionVersionFixture({ withdrawnAtUtcMs }).withdrawnAtUtcMs,
    ).toBe(1);
  });
});
