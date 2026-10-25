import { describe, expect, it } from 'vitest';
import { CouponGrantId, GiftVoucherId, TierId } from '@core/primitives';
import { localDate } from '@core/testing';
import { PerkId } from './award-summary.data';
import { GrantRefFields } from './grant-ref-fields.data';
import {
  JournalEffect,
  JournalEffectRecord,
  PauseScope,
  PauseTerm,
  TierOp,
} from './journal-effect.data';
import { JournalVisibility } from './journal-visibility.data';
import { JournalFeed } from './journal-feed.data';
import { LabelCode, PublicLabel } from './public-label.data';
import {
  CosmeticId,
  RewardRef,
  RewardRefFields,
} from './reward-ref-fields.data';

describe('the journal vocabularies', () => {
  it('declare the tags SCREAMING (the discriminator `journalEffect` and its peers) and keep the label keys', () => {
    expect(Object.values(JournalEffect)).toEqual([
      'POINTS',
      'STREAK',
      'FREEZE',
      'ACHIEVEMENT',
      'TIER',
      'REWARD',
      'REDEMPTION',
      'PAUSE',
      'VISIT_OUTCOME',
    ]);
    expect(Object.values(JournalVisibility)).toEqual(['CLIENT', 'STAFF']);
    expect(Object.values(PauseScope)).toEqual(['SELF_SERVICE', 'ALL_BOOKINGS']);
    expect(Object.values(PauseTerm)).toEqual(['TEMPORARY', 'PERMANENT']);
    expect(Object.values(RewardRef)).toEqual([
      'COUPON_GRANT',
      'GIFT_VOUCHER',
      'PERK',
      'COSMETIC',
    ]);
    // i18n message keys: an external contract, unchanged (flatten-spec §0.4).
    const labelCodes = Object.values(LabelCode);
    expect(labelCodes).toHaveLength(26);
    expect(new Set(labelCodes).size).toBe(26);
    expect(labelCodes[0]).toBe('points.opening');
    expect(labelCodes.at(-1)).toBe('choice.upcomingBooking');
  });
});

describe('JournalFeed — the activity feed’s pills and the effects each reads', () => {
  const PILLS: readonly JournalFeed[] = [
    JournalFeed.All,
    JournalFeed.Points,
    JournalFeed.Rewards,
    JournalFeed.Status,
  ];

  it('declares the four pills SCREAMING', () => {
    expect(PILLS).toEqual(['ALL', 'POINTS', 'REWARDS', 'STATUS']);
  });

  it('reads today’s effects per pill, in the feed’s order', () => {
    // Today's table, pill by pill (the lowercase `all`/`points`/`rewards`/
    // `status` rows of the legacy activity reader), on the SCREAMING tags.
    expect(JournalFeed.effectsOf(JournalFeed.All)).toEqual([
      'POINTS',
      'ACHIEVEMENT',
      'TIER',
      'REWARD',
      'REDEMPTION',
    ]);
    expect(JournalFeed.effectsOf(JournalFeed.Points)).toEqual(['POINTS']);
    expect(JournalFeed.effectsOf(JournalFeed.Rewards)).toEqual([
      'REWARD',
      'REDEMPTION',
    ]);
    expect(JournalFeed.effectsOf(JournalFeed.Status)).toEqual(['TIER']);
  });

  it('never reads a row the feed does not draw: every pill is a part of «Всички»', () => {
    const all = JournalFeed.effectsOf(JournalFeed.All);
    for (const pill of PILLS) {
      for (const effect of JournalFeed.effectsOf(pill)) {
        expect(all).toContain(effect);
      }
    }
    for (const silent of [
      JournalEffect.Streak,
      JournalEffect.Freeze,
      JournalEffect.Pause,
      JournalEffect.VisitOutcome,
    ]) {
      expect(all).not.toContain(silent);
    }
  });

  it('hands out a fresh list: a caller that edits its filter cannot rewrite the table', () => {
    const first = JournalFeed.effectsOf(JournalFeed.Rewards);
    expect(JournalFeed.effectsOf(JournalFeed.Rewards)).not.toBe(first);
    expect(JournalFeed.effectsOf(JournalFeed.Rewards)).toEqual(first);
  });
});

describe('JournalEffectRecord', () => {
  it('moves the balance by a points effect only', () => {
    const earned = JournalEffectRecord.points(120);
    const spent = JournalEffectRecord.points(-80);
    const tier: JournalEffectRecord = {
      journalEffect: JournalEffect.Tier,
      tierOp: TierOp.Changed,
      tierFrom: TierId.of('silver'),
      tierTo: TierId.of('gold'),
      tierUntil: localDate('2026-12-31'),
    };
    expect(earned).toEqual({ journalEffect: 'POINTS', pointsDelta: 120 });
    expect(JournalEffectRecord.movesBalance(earned)).toBe(true);
    expect(JournalEffectRecord.movesBalance(tier)).toBe(false);
    expect([earned, spent, tier].map(JournalEffectRecord.pointsDelta)).toEqual([
      120, -80, 0,
    ]);
  });

  it('tells a tier effect from every other one', () => {
    const tier: JournalEffectRecord = {
      journalEffect: JournalEffect.Tier,
      tierOp: TierOp.Changed,
      tierFrom: TierId.of('silver'),
      tierTo: TierId.of('gold'),
      tierUntil: localDate('2026-12-31'),
    };
    expect(JournalEffectRecord.isTier(tier)).toBe(true);
    expect(JournalEffectRecord.isTier(JournalEffectRecord.points(120))).toBe(
      false,
    );
    if (JournalEffectRecord.isTier(tier)) {
      // The guard narrows: the tier's own fields are readable.
      expect(tier.tierTo).toBe('gold');
    }
  });
});

describe('PublicLabel', () => {
  it('carries its params as named pairs — no dynamic field path — flat at the entry root', () => {
    const label = PublicLabel.of(LabelCode.PointsRule, [
      { name: 'points', value: 50 },
      { name: 'rule', value: 'visit' },
    ]);
    expect(label).toEqual({
      labelCode: 'points.rule',
      labelParams: [
        { name: 'points', value: 50 },
        { name: 'rule', value: 'visit' },
      ],
    });
    expect(PublicLabel.param(label, 'points')).toBe(50);
    expect(PublicLabel.param(label, 'rule')).toBe('visit');
    expect(PublicLabel.param(label, 'missing')).toBeNull();
  });
});

describe('RewardRefFields / GrantRefFields — each flat variant built from its tag', () => {
  it('names the reward a client holds, each variant declaring only its own id', () => {
    expect(RewardRefFields.couponGrant(CouponGrantId.of('g1'))).toEqual({
      rewardRef: RewardRef.CouponGrant,
      rewardCouponGrantId: 'g1',
    });
    expect(RewardRefFields.giftVoucher(GiftVoucherId.of('v1'))).toEqual({
      rewardRef: RewardRef.GiftVoucher,
      rewardGiftVoucherId: 'v1',
    });
    expect(RewardRefFields.perk(PerkId.BookFurtherAhead)).toEqual({
      rewardRef: RewardRef.Perk,
      rewardPerkId: PerkId.BookFurtherAhead,
    });
    expect(RewardRefFields.cosmetic(CosmeticId.FrameWelcome)).toEqual({
      rewardRef: RewardRef.Cosmetic,
      rewardCosmeticId: CosmeticId.FrameWelcome,
    });
  });

  it('names what a redemption minted — or nothing yet (today’s nullable `grant`)', () => {
    expect(GrantRefFields.none()).toEqual({ grantRef: null });
    expect(GrantRefFields.couponGrant(CouponGrantId.of('g1'))).toEqual({
      grantRef: RewardRef.CouponGrant,
      grantCouponGrantId: 'g1',
    });
    expect(GrantRefFields.giftVoucher(GiftVoucherId.of('v1'))).toEqual({
      grantRef: RewardRef.GiftVoucher,
      grantGiftVoucherId: 'v1',
    });
    expect(GrantRefFields.perk(PerkId.FreeReschedule)).toEqual({
      grantRef: RewardRef.Perk,
      grantPerkId: PerkId.FreeReschedule,
    });
    expect(GrantRefFields.cosmetic(CosmeticId.FrameWelcome)).toEqual({
      grantRef: RewardRef.Cosmetic,
      grantCosmeticId: CosmeticId.FrameWelcome,
    });
  });

  it('bounds a pause by a day, or not at all — the term a tag beside its own day', () => {
    // Today's `PauseTerm.temporary(until)` / `.permanent()`: the PAUSE
    // effect now carries `pauseTerm` and `pauseUntil` side by side.
    const temporary: JournalEffectRecord.Pause['pauseTerm'] =
      PauseTerm.Temporary;
    const until: JournalEffectRecord.Pause['pauseUntil'] =
      localDate('2026-11-30');
    expect({ pauseTerm: temporary, pauseUntil: until }).toEqual({
      pauseTerm: 'TEMPORARY',
      pauseUntil: '2026-11-30',
    });
    expect({ pauseTerm: PauseTerm.Permanent, pauseUntil: null }).toEqual({
      pauseTerm: 'PERMANENT',
      pauseUntil: null,
    });
  });
});
