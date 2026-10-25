import { describe, expect, it } from 'vitest';
import { FreezeReason, StreakPeriodMark, StreakRule } from '@core/components';
import bg from '../assets/i18n/bg.json';
import en from '../assets/i18n/en.json';
import {
  streakPeriodMarkWords,
  streakPeriodReasonWords,
} from './streak-period-words';

/*
 * ONE table per rhythm dictionary (UI residue cleanup, UR-3): total over
 * its dictionary, the words today's keys and the DS track's marks spell,
 * and every reason word a key both catalogues hold.
 */
describe('streakPeriodReasonWords', () => {
  it('words every covering reason as today’s clientCard.rhythm.reason key segment', () => {
    expect(streakPeriodReasonWords).toEqual({
      FREEZE: 'freeze',
      PAUSE: 'pause',
      CLIENT_PAUSE: 'clientPause',
      STAFF_CANCELLED: 'staffCancelled',
      BARBER_ABSENCE: 'barberAbsence',
      SHOP_CLOSURE: 'shopClosure',
      CLOSED_DAYS: 'closedDays',
    });
    expect(Object.keys(streakPeriodReasonWords).sort()).toEqual(
      [
        FreezeReason.Freeze,
        FreezeReason.Pause,
        FreezeReason.ClientPause,
        ...StreakRule.EXCUSES,
      ].sort(),
    );
  });

  it('names a clientCard.rhythm.reason key in both catalogues', () => {
    for (const word of Object.values(streakPeriodReasonWords)) {
      expect(en.clientCard.rhythm.reason).toHaveProperty(word);
      expect(bg.clientCard.rhythm.reason).toHaveProperty(word);
    }
  });
});

describe('streakPeriodMarkWords', () => {
  it('words every StreakPeriodMark as the DS track’s mark', () => {
    expect(streakPeriodMarkWords).toEqual({
      KEPT: 'kept',
      PROTECTED: 'protected',
      REPAIRED: 'repaired',
      MISSED: 'missed',
    });
    expect(Object.keys(streakPeriodMarkWords).sort()).toEqual(
      Object.values(StreakPeriodMark).sort(),
    );
  });
});
