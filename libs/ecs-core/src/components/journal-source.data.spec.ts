import { describe, expect, it } from 'vitest';
import {
  AchievementRuleId,
  AdjustmentId,
  JournalEventId,
  MigrationBatchId,
  RedemptionId,
} from '../primitives/ids.primitive';
import {
  JournalSource,
  JournalSourceRecord,
  JournalSystemJob,
} from './journal-source.data';

describe('JournalSourceRecord', () => {
  it('declares the tags SCREAMING (the discriminator `journalSource`)', () => {
    expect(Object.values(JournalSource)).toEqual([
      'RULE',
      'MANUAL',
      'CORRECTION',
      'SYSTEM',
      'MIGRATION',
      'REDEMPTION',
    ]);
    expect(Object.values(JournalSystemJob)).toEqual([
      'STREAK',
      'TIER',
      'PAUSE_EXPIRY',
      'POINTS_EXPIRY',
      'REWARD_EXPIRY',
    ]);
  });

  it('builds why each entry was written, every field flat and prefixed `source`', () => {
    const rule = {
      ruleId: AchievementRuleId.of('r-visit'),
      version: 2,
    };
    const fromRule = JournalSourceRecord.rule(
      rule,
      'r-visit:u1:a1',
      JournalEventId.of('evt-1'),
    );
    expect(fromRule).toEqual({
      journalSource: 'RULE',
      sourceRuleId: 'r-visit',
      sourceRuleVersion: 2,
      sourceAwardKey: 'r-visit:u1:a1',
      sourceEventId: 'evt-1',
    });
    expect(JournalSourceRecord.ruleRef(fromRule)).toEqual(rule);
    expect(JournalSourceRecord.manual(AdjustmentId.of('adj-1'))).toEqual({
      journalSource: 'MANUAL',
      sourceAdjustmentId: 'adj-1',
    });
    expect(JournalSourceRecord.correction(AdjustmentId.of('adj-2'))).toEqual({
      journalSource: 'CORRECTION',
      sourceAdjustmentId: 'adj-2',
    });
    expect(JournalSourceRecord.system(JournalSystemJob.PointsExpiry)).toEqual({
      journalSource: 'SYSTEM',
      sourceSystemJob: 'POINTS_EXPIRY',
    });
    expect(
      JournalSourceRecord.migration(MigrationBatchId.of('batch-7')),
    ).toEqual({
      journalSource: 'MIGRATION',
      sourceBatchId: 'batch-7',
    });
    expect(JournalSourceRecord.redemption(RedemptionId.of('red-3'))).toEqual({
      journalSource: 'REDEMPTION',
      sourceRedemptionId: 'red-3',
    });
  });
});
