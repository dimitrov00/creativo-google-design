import { describe, expect, it } from 'vitest';
import { Locale } from '@core/primitives';
import { deepFreeze, localDate } from '@core/testing';
import { catalogueTranslate } from './catalogue.spec-support';
import { LinkAnswer } from './link.vm';
import { memberWordsOf } from './member.words';
import {
  type PeriodOutlookInput,
  type PeriodOutlookVm,
  QUIET_OUTLOOK,
  periodOutlookVm,
} from './period.presenter';
import { IVAN_RECORD, NIKOLAY_RECORD } from './team.fixtures.spec-support';

/*
 * «Работен период», worded (Law 10; team onboarding D10): what the last
 * day drafted will do — ONE notice, the departure or the visits it leaves
 * — and the question before a save that makes the barber leave at once,
 * pinned in both languages from fixed inputs and the app's real
 * catalogue. Where the period stands is the system's answer.
 */

const NBSP = '\u00a0';
const read = (line: string): string => line.replaceAll(NBSP, ' ');
/** The notice as it reads: its tone, title and line, and whether it opens the search. */
const said = (outlook: PeriodOutlookVm) =>
  outlook.notice === null
    ? null
    : {
        tone: outlook.notice.tone,
        title: read(outlook.notice.title),
        body: read(outlook.notice.body),
        opensSearch: outlook.notice.opensSearch,
        testId: outlook.notice.testId,
      };

const TODAY = localDate('2026-11-16');

function inputOf(
  over: Partial<PeriodOutlookInput> = {},
  lang: 'bg' | 'en' = 'bg',
): PeriodOutlookInput {
  return deepFreeze({
    barber: IVAN_RECORD,
    lastLocalDate: null,
    today: TODAY,
    leftover: null,
    leftoverFailed: false,
    memberWords: memberWordsOf(catalogueTranslate(lang)),
    locale: lang === 'bg' ? Locale.Bg : Locale.En,
    ...over,
  });
}

/** What the visits after a day were counted as. */
const counted = (leftoverCount: number, day: string) => ({
  leftoverCount,
  leftoverLocalDates: [localDate(day)],
});

describe('periodOutlookVm', () => {
  it('says nothing with no last day, and nothing while the shop’s today is unknown', () => {
    expect(periodOutlookVm(inputOf())).toEqual(QUIET_OUTLOOK);
    expect(
      periodOutlookVm(
        inputOf({ lastLocalDate: localDate('2026-12-31'), today: null }),
      ),
    ).toEqual(QUIET_OUTLOOK);
  });

  it('a last day today or ahead, nothing after it: says when the person leaves, quietly, and asks nothing', () => {
    const ahead = periodOutlookVm(
      inputOf({
        lastLocalDate: localDate('2026-12-31'),
        leftover: counted(0, '2027-01-04'),
      }),
    );
    expect(said(ahead)).toEqual({
      tone: 'neutral',
      title: 'Иван напуска екипа след 31.12',
      body: 'След този ден не приема записи и губи достъпа си до графика.',
      opensSearch: false,
      testId: 'member-period-note',
    });
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
    expect(said(passed)).toEqual({
      tone: 'neutral',
      title: 'Иван напуска екипа веднага',
      body: '15.11 вече мина. Със запазването спира да приема записи и губи достъпа си до графика.',
      opensSearch: false,
      testId: 'member-period-note',
    });
    expect(passed.question).toEqual({
      title: 'Иван напуска екипа сега?',
      message:
        'Последният ден вече мина. Иван спира да приема записи и губи достъпа си до графика.',
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

  it('says and asks nothing for a record in preparation: it has never worked, so no last day makes it leave', () => {
    for (const lastLocalDate of [
      localDate('2026-11-15'),
      localDate('2026-12-31'),
    ]) {
      expect(
        periodOutlookVm(
          inputOf({
            barber: NIKOLAY_RECORD,
            lastLocalDate,
            leftover: counted(2, '2027-01-04'),
          }),
        ),
      ).toEqual(QUIET_OUTLOOK);
    }
  });

  it('turns into a warning once visits fall after a day ahead — counted in its title, the departure and what to do with them in its body, and the way to them', () => {
    const ahead = (leftoverCount: number) =>
      said(
        periodOutlookVm(
          inputOf({
            lastLocalDate: localDate('2026-12-31'),
            leftover: counted(leftoverCount, '2027-01-04'),
          }),
        ),
      );
    expect(ahead(1)).toEqual({
      tone: 'warning',
      title: '1 запис след последния ден',
      body: 'След 31.12 Иван напуска екипа, а записът остава в графика. Дай го на друг бръснар или го премести по-рано.',
      opensSearch: true,
      testId: 'member-period-leftover',
    });
    expect(ahead(3)).toEqual({
      tone: 'warning',
      title: '3 записа след последния ден',
      body: 'След 31.12 Иван напуска екипа, а записите остават в графика. Дай ги на друг бръснар или ги премести по-рано.',
      opensSearch: true,
      testId: 'member-period-leftover',
    });
  });

  it('for a last day already passed, says the person leaves on saving and to give, move or cancel the visits', () => {
    const passed = (leftoverCount: number) =>
      said(
        periodOutlookVm(
          inputOf({
            lastLocalDate: localDate('2026-11-15'),
            leftover: counted(leftoverCount, '2026-11-17'),
          }),
        ),
      );
    expect(passed(1)).toMatchObject({
      tone: 'warning',
      title: '1 запис след последния ден',
      body: 'Със запазването Иван напуска екипа веднага, а записът остава в графика. Дай го на друг бръснар, премести го или го откажи.',
    });
    expect(passed(2)).toMatchObject({
      tone: 'warning',
      title: '2 записа след последния ден',
      body: 'Със запазването Иван напуска екипа веднага, а записите остават в графика. Дай ги на друг бръснар, премести ги или ги откажи.',
    });
  });

  it('warns that it could not check when the visits cannot be read — under the departure, with nothing to open — and stays quiet while the answer is on its way', () => {
    expect(
      said(
        periodOutlookVm(
          inputOf({
            lastLocalDate: localDate('2026-12-31'),
            leftoverFailed: true,
          }),
        ),
      ),
    ).toEqual({
      tone: 'warning',
      title: 'Иван напуска екипа след 31.12',
      body: 'Не успяхме да проверим дали има записи след този ден.',
      opensSearch: false,
      testId: 'member-period-leftover',
    });
    expect(
      said(periodOutlookVm(inputOf({ lastLocalDate: localDate('2026-12-31') })))
        ?.tone,
    ).toBe('neutral');
  });

  it('says a day outside today’s year with its year', () => {
    expect(
      said(periodOutlookVm(inputOf({ lastLocalDate: localDate('2027-03-31') })))
        ?.title,
    ).toContain('31.03.2027');
  });

  it('words it in English', () => {
    const ahead = said(
      periodOutlookVm(
        inputOf({ lastLocalDate: localDate('2026-12-31') }, 'en'),
      ),
    );
    expect(ahead?.title).toMatch(/^Ivan leaves the team after .+$/);
    expect(ahead?.body).toBe(
      'After that day they take no bookings and lose access to the schedule.',
    );
    const left = said(
      periodOutlookVm(
        inputOf(
          {
            lastLocalDate: localDate('2026-12-31'),
            leftover: counted(2, '2027-01-04'),
          },
          'en',
        ),
      ),
    );
    expect(left?.title).toBe('2 bookings after the last day');
    expect(left?.body).toMatch(
      /^After .+ Ivan leaves the team, but the bookings stay on the schedule\. Give them to another barber or move them earlier\.$/,
    );
    const passed = periodOutlookVm(
      inputOf({ lastLocalDate: localDate('2026-11-15') }, 'en'),
    );
    expect(said(passed)?.title).toBe('Ivan leaves the team right away');
    expect(said(passed)?.body).toMatch(
      /has passed\. On saving they stop taking bookings and lose access to the schedule\.$/,
    );
    expect(passed.question?.title).toBe('Ivan leaves the team now?');
    expect(passed.question?.actions.map((action) => action.label)).toEqual([
      'Leaves',
      'Cancel',
    ]);
  });
});
