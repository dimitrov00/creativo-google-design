import { describe, expect, it } from 'vitest';
import { CouponGrantId } from '../entities/coupon-grant.entity';
import { GiftVoucherId } from '../entities/gift-voucher.entity';
import type { TierId } from '../entities/tier-definition.entity';
import { DayKey } from './day-key.data';
import { PerkId } from './gamification.data';
import {
  CosmeticId,
  JournalEffect,
  JournalEffectKind,
  JournalVisibility,
  LABEL_CODES,
  LabelCode,
  PauseScope,
  PauseTerm,
  PauseTermKind,
  PublicLabel,
  RewardRef,
  RewardRefKind,
} from './journal-effect.data';

describe('the journal vocabularies', () => {
  it('keep the stored tags', () => {
    expect(Object.values(JournalEffectKind)).toEqual([
      'points',
      'streak',
      'freeze',
      'achievement',
      'tier',
      'reward',
      'redemption',
      'pause',
      'visitOutcome',
    ]);
    expect(Object.values(JournalVisibility)).toEqual(['client', 'staff']);
    expect(Object.values(PauseScope)).toEqual(['selfService', 'allBookings']);
    expect(LABEL_CODES).toHaveLength(26);
    expect(new Set(LABEL_CODES).size).toBe(26);
    expect(LABEL_CODES[0]).toBe('points.opening');
    expect(LABEL_CODES.at(-1)).toBe('choice.upcomingBooking');
  });
});

describe('JournalEffect', () => {
  it('moves the balance by a points effect only', () => {
    const earned = JournalEffect.points(120);
    const spent = JournalEffect.points(-80);
    const tier: JournalEffect = {
      kind: 'tier',
      op: 'changed',
      from: 'silver' as TierId,
      to: 'gold' as TierId,
      until: DayKey.of('2026-12-31'),
    };
    expect(earned).toEqual({ kind: 'points', delta: 120 });
    expect(JournalEffect.movesBalance(earned)).toBe(true);
    expect(JournalEffect.movesBalance(tier)).toBe(false);
    expect([earned, spent, tier].map(JournalEffect.pointsDelta)).toEqual([
      120, -80, 0,
    ]);
  });
});

describe('PublicLabel', () => {
  it('carries its params as named pairs — no dynamic field path', () => {
    const label = PublicLabel.of(LabelCode.PointsRule, [
      { name: 'points', value: 50 },
      { name: 'rule', value: 'visit' },
    ]);
    expect(label).toEqual({
      code: 'points.rule',
      params: [
        { name: 'points', value: 50 },
        { name: 'rule', value: 'visit' },
      ],
    });
    expect(PublicLabel.param(label, 'points')).toBe(50);
    expect(PublicLabel.param(label, 'rule')).toBe('visit');
    expect(PublicLabel.param(label, 'missing')).toBeNull();
  });
});

describe('RewardRef / PauseTerm — each variant built from its tag', () => {
  it('names the reward a client holds', () => {
    expect(RewardRef.couponGrant(CouponGrantId.of('g1'))).toEqual({
      kind: RewardRefKind.CouponGrant,
      id: 'g1',
    });
    expect(RewardRef.giftVoucher(GiftVoucherId.of('v1'))).toEqual({
      kind: RewardRefKind.GiftVoucher,
      id: 'v1',
    });
    expect(RewardRef.perk(PerkId.BookFurtherAhead)).toEqual({
      kind: RewardRefKind.Perk,
      perkId: PerkId.BookFurtherAhead,
    });
    expect(RewardRef.cosmetic(CosmeticId.FrameWelcome)).toEqual({
      kind: RewardRefKind.Cosmetic,
      cosmeticId: CosmeticId.FrameWelcome,
    });
  });

  it('bounds a pause by a day, or not at all', () => {
    expect(PauseTerm.temporary(DayKey.of('2026-11-30'))).toEqual({
      kind: PauseTermKind.Temporary,
      until: '2026-11-30',
    });
    expect(PauseTerm.permanent()).toEqual({ kind: PauseTermKind.Permanent });
  });
});
