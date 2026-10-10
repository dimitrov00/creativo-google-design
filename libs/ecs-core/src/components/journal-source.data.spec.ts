import { describe, expect, it } from 'vitest';
import {
  JournalSource,
  JournalSourceKind,
  JournalSystemJob,
} from './journal-source.data';

describe('JournalSource', () => {
  it('keeps the stored tags', () => {
    expect(Object.values(JournalSourceKind)).toEqual([
      'rule',
      'manual',
      'correction',
      'system',
      'migration',
      'redemption',
    ]);
    expect(Object.values(JournalSystemJob)).toEqual([
      'streak',
      'tier',
      'pauseExpiry',
      'pointsExpiry',
      'rewardExpiry',
    ]);
  });

  it('builds why each entry was written', () => {
    expect(
      JournalSource.rule(
        { ruleId: 'r-visit', version: 2 },
        'r-visit:u1:a1',
        'evt-1',
      ),
    ).toEqual({
      kind: 'rule',
      rule: { ruleId: 'r-visit', version: 2 },
      awardKey: 'r-visit:u1:a1',
      eventId: 'evt-1',
    });
    expect(JournalSource.manual('adj-1')).toEqual({
      kind: 'manual',
      adjustmentId: 'adj-1',
    });
    expect(JournalSource.correction('adj-2')).toEqual({
      kind: 'correction',
      adjustmentId: 'adj-2',
    });
    expect(JournalSource.system(JournalSystemJob.PointsExpiry)).toEqual({
      kind: 'system',
      job: 'pointsExpiry',
    });
    expect(JournalSource.migration('batch-7')).toEqual({
      kind: 'migration',
      batchId: 'batch-7',
    });
    expect(JournalSource.redemption('red-3')).toEqual({
      kind: 'redemption',
      redemptionId: 'red-3',
    });
  });
});
