import { describe, expect, it } from 'vitest';
import { AccountStatus } from '../components/account-status.data';
import { DayKey } from '../components/day-key.data';
import { StreakPhase, type StreakState } from '../components/streak-state.data';
import { VoucherState } from '../components/voucher-state.data';
import { StreakDefinitionId } from '../entities/streak-definition.entity';
import { deepFreeze } from '../testing';
import { VoucherCode } from '../components/voucher-code.data';
import {
  GiftVoucherId,
  type GiftVoucherEntity,
} from '../entities/gift-voucher.entity';
import {
  ClientGlanceSystem,
  type GlanceHoldingsInput,
} from './client-glance.system';

/*
 * COPIED, never moved, and re-targeted to the numbers and verdicts the
 * presenters' cases assert (the words stay with their specs):
 * - libs/features/staff/client-card/src/lib/client-card.presenter.spec.ts —
 *   «pauseOf, isInChairToday», the head's «treats a pause that has run out
 *   as none», and «Повтори»'s «the draft already holds it» (`sameLegs`);
 * - libs/features/staff/client-card/src/lib/glance.presenter.spec.ts — the
 *   holdings: the vouchers that still pay as one sum, the facts the flags
 *   and the data allow, no rhythm for a lost run or a paused client.
 * `isBirthdayToday` is AgeSystem's (identity), not here.
 */

const ZONE = 'Europe/Sofia';
const TODAY = DayKey.of('2026-09-28');
/** 09:00 in Sofia on the fixtures' day. */
const NOW_MS = Date.parse('2026-09-28T06:00:00.000Z');

describe('ClientGlanceSystem.pauseOf', () => {
  it('reads a pause, and when it ends', () => {
    const untilMs = Date.parse('2026-10-12T21:00:00.000Z');
    expect(
      ClientGlanceSystem.pauseOf(
        AccountStatus.block('manual', untilMs),
        NOW_MS,
      ),
    ).toEqual({ untilMs });
    expect(
      ClientGlanceSystem.pauseOf(AccountStatus.block('manual', null), NOW_MS),
    ).toEqual({ untilMs: null });
    expect(
      ClientGlanceSystem.pauseOf(AccountStatus.active(), NOW_MS),
    ).toBeNull();
    expect(ClientGlanceSystem.pauseOf(null, NOW_MS)).toBeNull();
  });

  it('treats a pause that has run out as none', () => {
    expect(
      ClientGlanceSystem.pauseOf(
        AccountStatus.block('manual', Date.parse('2026-08-31T21:00:00.000Z')),
        NOW_MS,
      ),
    ).toBeNull();
  });
});

describe('ClientGlanceSystem.sameLegs', () => {
  const leg = (serviceId: string, variantId: string | null = null) => ({
    serviceId,
    variantId,
  });

  it('holds the last visit when the draft holds its services, whatever the order', () => {
    expect(
      ClientGlanceSystem.sameLegs(
        [leg('svc-fade'), leg('svc-beard')],
        [leg('svc-beard'), leg('svc-fade')],
      ),
    ).toBe(true);
  });

  it('tells another variant, another count and another service apart', () => {
    expect(
      ClientGlanceSystem.sameLegs([leg('svc-cut', 'long')], [leg('svc-cut')]),
    ).toBe(false);
    expect(
      ClientGlanceSystem.sameLegs(
        [leg('svc-cut')],
        [leg('svc-cut'), leg('svc-cut')],
      ),
    ).toBe(false);
    expect(ClientGlanceSystem.sameLegs([leg('a')], [leg('b')])).toBe(false);
    expect(ClientGlanceSystem.sameLegs([], [])).toBe(true);
  });
});

describe('ClientGlanceSystem.isInChairToday', () => {
  it('puts the client in the chair only on an open visit today', () => {
    const today = Date.parse('2026-09-28T07:00:00.000Z');
    const yesterday = Date.parse('2026-09-27T07:00:00.000Z');
    expect(ClientGlanceSystem.isInChairToday(true, [today], NOW_MS, ZONE)).toBe(
      true,
    );
    // A visit settled, or one on another day, is no visit in the chair.
    expect(
      ClientGlanceSystem.isInChairToday(false, [today], NOW_MS, ZONE),
    ).toBe(false);
    expect(
      ClientGlanceSystem.isInChairToday(true, [yesterday], NOW_MS, ZONE),
    ).toBe(false);
    expect(
      ClientGlanceSystem.isInChairToday(true, [Number.NaN], NOW_MS, ZONE),
    ).toBe(false);
    expect(
      ClientGlanceSystem.isInChairToday(true, [today], NOW_MS, 'Not/AZone'),
    ).toBe(false);
  });

  it('reads today on the shop’s calendar: 00:30 in Sofia is already tomorrow in Sofia', () => {
    const halfPastMidnight = Date.parse('2026-09-28T21:30:00.000Z');
    expect(
      ClientGlanceSystem.isInChairToday(
        true,
        [halfPastMidnight],
        halfPastMidnight,
        ZONE,
      ),
    ).toBe(true);
  });
});

describe('ClientGlanceSystem.holdings (glance.presenter.spec.ts)', () => {
  const eur = (amountMinorUnits: number) => ({
    amountMinorUnits,
    currencyCode: 'EUR',
  });
  const voucher = (
    amount: number,
    overrides: Partial<GiftVoucherEntity> = {},
  ): GiftVoucherEntity => ({
    id: GiftVoucherId.of(`voucher-${amount}`),
    code: VoucherCode.of('GIFT-0001'),
    initialValue: eur(5000),
    balance: eur(amount),
    issuedAtMs: Date.parse('2026-01-01T10:00:00Z'),
    expiresAtMs: null,
    issuedToUserId: null,
    state: VoucherState.active(),
    ...overrides,
  });
  const run = (current: number): StreakState => ({
    streakId: StreakDefinitionId.of('cadence'),
    definitionVersion: 1,
    phase: StreakPhase.active(),
    current,
    best: 24,
    lastQualifiedAtMs: null,
    dueBy: null,
    freezesBanked: 2,
    period: null,
    periods: [],
    heldBy: null,
    runStartedOn: null,
  });
  const STAMPS = {
    ruleId: 'rule-every-10th-visit',
    filled: 4,
    size: 10,
    title: { bg: 'Подстригване', en: 'Cut' },
  };
  const input = (
    overrides: Partial<GlanceHoldingsInput> = {},
  ): GlanceHoldingsInput => ({
    vouchers: [voucher(2500)],
    punchCards: [STAMPS],
    achievements: true,
    rhythmOn: true,
    rhythm: run(24),
    paused: false,
    today: TODAY,
    zone: ZONE,
    ...overrides,
  });

  it('counts only the vouchers that still pay: active, not empty, not past their last day, as one sum', () => {
    const fact = (vouchers: readonly GiftVoucherEntity[] | null) =>
      ClientGlanceSystem.holdings(input({ vouchers })).voucher;
    expect(fact([voucher(2500)])).toEqual(eur(2500));
    expect(fact([voucher(2500), voucher(2500), voucher(500)])).toEqual(
      eur(5500),
    );
    expect(
      fact([
        voucher(0),
        voucher(2500, {
          state: VoucherState.voided(
            Date.parse('2026-09-01T00:00:00Z'),
            'refund',
          ),
        }),
      ]),
    ).toBeNull();
    const lastDay = (iso: string) =>
      voucher(2500, { expiresAtMs: Date.parse(iso) });
    expect(fact([lastDay('2026-09-27T23:59:59.999+03:00')])).toBeNull();
    expect(fact([lastDay('2026-09-28T23:59:59.999+03:00')])).toEqual(eur(2500));
    expect(fact([])).toBeNull();
    expect(fact(null)).toBeNull();
  });

  it('sums in the first voucher’s currency alone', () => {
    expect(
      ClientGlanceSystem.holdings(
        input({
          vouchers: [
            voucher(2500),
            voucher(1000, {
              balance: { amountMinorUnits: 1000, currencyCode: 'BGN' },
            }),
          ],
        }),
      ).voucher,
    ).toEqual(eur(2500));
  });

  it('draws only the facts its flags and its data allow', () => {
    expect(ClientGlanceSystem.holdings(input())).toEqual({
      voucher: eur(2500),
      stamps: STAMPS,
      rhythm: 24,
    });
    expect(
      ClientGlanceSystem.holdings(input({ achievements: false })).stamps,
    ).toBeNull();
    expect(
      ClientGlanceSystem.holdings(input({ rhythmOn: false })).rhythm,
    ).toBeNull();
    expect(
      ClientGlanceSystem.holdings(input({ punchCards: [] })).stamps,
    ).toBeNull();
    expect(
      ClientGlanceSystem.holdings(input({ rhythm: null })).rhythm,
    ).toBeNull();
  });

  it('says no rhythm for a run that was lost, and agrees a run of one', () => {
    expect(
      ClientGlanceSystem.holdings(input({ rhythm: run(0) })).rhythm,
    ).toBeNull();
    expect(ClientGlanceSystem.holdings(input({ rhythm: run(1) })).rhythm).toBe(
      1,
    );
  });

  it('never zeroes a paused client’s values; the rhythm, frozen, is the wallet’s to say', () => {
    expect(ClientGlanceSystem.holdings(input({ paused: true }))).toEqual({
      voucher: eur(2500),
      stamps: STAMPS,
      rhythm: null,
    });
  });
});

describe('ClientGlanceSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const held = deepFreeze({
      vouchers: [
        {
          id: GiftVoucherId.of('voucher-1'),
          code: VoucherCode.of('GIFT-0001'),
          initialValue: { amountMinorUnits: 5000, currencyCode: 'EUR' },
          balance: { amountMinorUnits: 2500, currencyCode: 'EUR' },
          issuedAtMs: Date.parse('2026-01-01T10:00:00Z'),
          expiresAtMs: Date.parse('2026-10-01T00:00:00Z'),
          issuedToUserId: null,
          state: VoucherState.active(),
        },
      ],
      punchCards: [],
      achievements: true,
      rhythmOn: true,
      rhythm: null,
      paused: false,
      today: TODAY,
      zone: ZONE,
    });
    const legs = deepFreeze([
      { serviceId: 'b', variantId: null },
      { serviceId: 'a', variantId: 'x' },
    ]);
    const run = () => [
      ClientGlanceSystem.holdings(held),
      ClientGlanceSystem.sameLegs(legs, legs),
      ClientGlanceSystem.isInChairToday(true, [NOW_MS], NOW_MS, ZONE),
    ];
    expect(run()).toEqual(run());
  });
});
