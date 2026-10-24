import { describe, expect, it } from 'vitest';
import { FreezeReason, StreakExcuse, StreakPeriodMark } from '@core/components';
import { LocalDate } from '@core/primitives';
import { type StreakTrackMark, StreakTrackMarkKind } from '@core/systems';
import { deepFreeze, unwrapOk } from '@core/testing';
import {
  type RhythmClosedMark,
  type RhythmClosedMarkForms,
  type RhythmClosedMarkSentences,
  isRhythmClosedMark,
  rhythmClosedMarkPeriod,
} from './rhythm-closed-mark.words';

/*
 * The one word source of a closed period on the rhythm's track: the card's
 * wallet and the admin's sample both print through it, each with its own
 * forms (id suffix, month, day) and sentences. The words here are a fake
 * surface's, so every parameter's place in the answer is visible; the two
 * real surfaces pin their own words (`wallet.presenter.spec.ts`,
 * `admin-rhythm.words.spec.ts`).
 */

const day = (raw: string): LocalDate => unwrapOk(LocalDate.parse(raw));

function mark(
  streakTrackMarkKind: StreakPeriodMark,
  reason: RhythmClosedMark['reason'] = null,
): RhythmClosedMark {
  return {
    streakTrackMarkKind,
    on: day('2026-09-04'),
    reason,
    open: false,
    visitDay: null,
  };
}

const SENTENCES: RhythmClosedMarkSentences = {
  kept: (period, date) => `kept · ${period} · ${date}`,
  repaired: (period) => `repaired · ${period}`,
  protected: (period, reason) => `protected · ${period} · ${reason}`,
  missed: (period) => `missed · ${period}`,
  reason: (word) => `reason:${word}`,
};

const CARD: RhythmClosedMarkForms = {
  idSuffix: '',
  month: (on) => `month(${on})`,
  day: (on) => `day(${on})`,
};

const SAMPLE: RhythmClosedMarkForms = { ...CARD, idSuffix: '-3' };

describe('rhythmClosedMarkPeriod', () => {
  it('words each closed mark in the surface’s sentences, uncaptioned, with the DS track’s mark', () => {
    expect(
      rhythmClosedMarkPeriod(mark(StreakPeriodMark.Kept), CARD, SENTENCES),
    ).toEqual({
      id: 'kept-2026-09-04',
      mark: 'kept',
      caption: '',
      description: 'kept · month(2026-09-04) · day(2026-09-04)',
    });
    expect(
      rhythmClosedMarkPeriod(mark(StreakPeriodMark.Repaired), CARD, SENTENCES),
    ).toEqual({
      id: 'repaired-2026-09-04',
      mark: 'repaired',
      caption: '',
      description: 'repaired · month(2026-09-04)',
    });
    expect(
      rhythmClosedMarkPeriod(mark(StreakPeriodMark.Missed), CARD, SENTENCES),
    ).toEqual({
      id: 'missed-2026-09-04',
      mark: 'missed',
      caption: '',
      description: 'missed · month(2026-09-04)',
    });
  });

  it('appends the surface’s id suffix: the admin sample’s place in the run, the card’s none', () => {
    expect(
      rhythmClosedMarkPeriod(mark(StreakPeriodMark.Kept), SAMPLE, SENTENCES).id,
    ).toBe('kept-2026-09-04-3');
    expect(
      rhythmClosedMarkPeriod(mark(StreakPeriodMark.Kept), CARD, SENTENCES).id,
    ).toBe('kept-2026-09-04');
  });

  it('says a protected period’s reason by its word — a protection’s when none is named or it is the open phase’s EXCUSE', () => {
    const covered = (reason: RhythmClosedMark['reason']) =>
      rhythmClosedMarkPeriod(
        mark(StreakPeriodMark.Protected, reason),
        CARD,
        SENTENCES,
      );
    expect(covered(null)).toEqual({
      id: 'protected-2026-09-04',
      mark: 'protected',
      caption: '',
      description: 'protected · month(2026-09-04) · reason:freeze',
    });
    expect(covered(FreezeReason.Excuse).description).toBe(
      'protected · month(2026-09-04) · reason:freeze',
    );
    expect(covered(FreezeReason.Freeze).description).toBe(
      'protected · month(2026-09-04) · reason:freeze',
    );
    expect(covered(FreezeReason.ClientPause).description).toBe(
      'protected · month(2026-09-04) · reason:clientPause',
    );
    expect(covered(StreakExcuse.ShopClosure).description).toBe(
      'protected · month(2026-09-04) · reason:shopClosure',
    );
  });

  it('asks for the day form only for a kept visit', () => {
    const asked: string[] = [];
    const forms: RhythmClosedMarkForms = {
      ...CARD,
      day: (on) => {
        asked.push(on);
        return `day(${on})`;
      },
    };
    rhythmClosedMarkPeriod(mark(StreakPeriodMark.Missed), forms, SENTENCES);
    rhythmClosedMarkPeriod(mark(StreakPeriodMark.Repaired), forms, SENTENCES);
    expect(asked).toEqual([]);
    rhythmClosedMarkPeriod(mark(StreakPeriodMark.Kept), forms, SENTENCES);
    expect(asked).toEqual(['2026-09-04']);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const closed = deepFreeze(mark(StreakPeriodMark.Protected, null));
    const once = rhythmClosedMarkPeriod(closed, SAMPLE, SENTENCES);
    const twice = rhythmClosedMarkPeriod(closed, SAMPLE, SENTENCES);
    expect(twice).toEqual(once);
  });
});

describe('isRhythmClosedMark', () => {
  it('holds for every mark but the open one’s CURRENT', () => {
    const of = (
      streakTrackMarkKind: StreakTrackMark['streakTrackMarkKind'],
    ): StreakTrackMark => ({
      streakTrackMarkKind,
      on: day('2026-09-04'),
      reason: null,
      open: false,
      visitDay: null,
    });
    expect(isRhythmClosedMark(of(StreakTrackMarkKind.Current))).toBe(false);
    for (const closed of Object.values(StreakPeriodMark)) {
      expect(isRhythmClosedMark(of(closed))).toBe(true);
    }
  });
});
