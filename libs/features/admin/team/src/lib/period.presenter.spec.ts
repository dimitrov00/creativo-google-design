import { describe, expect, it } from 'vitest';
import { Locale } from '@core/primitives';
import { deepFreeze, localDate } from '@core/testing';
import { catalogueTranslate } from './catalogue.spec-support';
import { LinkAnswer } from './link.vm';
import { memberWordsOf } from './member.words';
import { type PeriodOutlookInput, periodOutlookVm } from './period.presenter';
import { NIKOLAY_RECORD } from './team.fixtures.spec-support';

/*
 * «Период на работа», worded (Law 10; team onboarding D10): what the last
 * day drafted will do, and the question before a save that makes the
 * barber leave at once — pinned in both languages from fixed inputs and
 * the app's real catalogue. Where the period stands is the system's answer.
 */

const NBSP = ' ';
const read = (line: string | null): string | null =>
  line === null ? null : line.replaceAll(NBSP, ' ');

const TODAY = localDate('2026-11-16');

function inputOf(
  over: Partial<PeriodOutlookInput> = {},
  lang: 'bg' | 'en' = 'bg',
): PeriodOutlookInput {
  return deepFreeze({
    barber: NIKOLAY_RECORD,
    lastLocalDate: null,
    today: TODAY,
    memberWords: memberWordsOf(catalogueTranslate(lang)),
    locale: lang === 'bg' ? Locale.Bg : Locale.En,
    ...over,
  });
}

describe('periodOutlookVm', () => {
  it('says nothing with no last day, and nothing while the shop’s today is unknown', () => {
    expect(periodOutlookVm(inputOf())).toEqual({ note: null, question: null });
    expect(
      periodOutlookVm(
        inputOf({ lastLocalDate: localDate('2026-12-31'), today: null }),
      ),
    ).toEqual({ note: null, question: null });
  });

  it('a last day today or ahead: says when the person leaves, and asks nothing', () => {
    const ahead = periodOutlookVm(
      inputOf({ lastLocalDate: localDate('2026-12-31') }),
    );
    expect(read(ahead.note)).toBe(
      'След 31.12 Николай напуска екипа и вече не влиза в приложението като бръснар.',
    );
    expect(ahead.question).toBeNull();
    // The last day itself is worked through.
    expect(
      periodOutlookVm(inputOf({ lastLocalDate: TODAY })).question,
    ).toBeNull();
  });

  it('a last day already passed: says the person leaves on saving, and asks first', () => {
    const passed = periodOutlookVm(
      inputOf({ lastLocalDate: localDate('2026-11-15') }),
    );
    expect(read(passed.note)).toBe(
      '15.11 вече е минал. Със запазването Николай напуска екипа веднага.',
    );
    expect(passed.question).toEqual({
      title: 'Николай напуска екипа сега?',
      message:
        'Последният работен ден вече е минал. Николай спира да приема записи и вече не влиза в приложението като бръснар.',
      actions: [
        {
          id: LinkAnswer.Confirm,
          label: 'Напуска',
          role: 'default',
          testId: 'member-period-leave-confirm',
        },
        {
          id: LinkAnswer.Cancel,
          label: 'Отказ',
          role: 'cancel',
          testId: 'member-period-leave-cancel',
        },
      ],
    });
  });

  it('says a day outside today’s year with its year', () => {
    expect(
      read(
        periodOutlookVm(inputOf({ lastLocalDate: localDate('2027-03-31') }))
          .note,
      ),
    ).toContain('31.03.2027');
  });

  it('words it in English', () => {
    const ahead = periodOutlookVm(
      inputOf({ lastLocalDate: localDate('2026-12-31') }, 'en'),
    );
    expect(read(ahead.note)).toMatch(
      /^After .+ Nikolay leaves the team and no longer signs in to the app as a barber\.$/,
    );
    const passed = periodOutlookVm(
      inputOf({ lastLocalDate: localDate('2026-11-15') }, 'en'),
    );
    expect(read(passed.note)).toMatch(
      /has already passed\. Saving makes Nikolay leave the team right away\.$/,
    );
    expect(passed.question?.title).toBe('Nikolay leaves the team now?');
    expect(passed.question?.actions.map((action) => action.label)).toEqual([
      'Leaves',
      'Cancel',
    ]);
  });
});
