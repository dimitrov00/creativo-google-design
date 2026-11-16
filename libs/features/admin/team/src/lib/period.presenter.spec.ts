import { describe, expect, it } from 'vitest';
import { Locale } from '@core/primitives';
import { deepFreeze, localDate } from '@core/testing';
import { catalogueTranslate } from './catalogue.spec-support';
import { LinkAnswer } from './link.vm';
import { memberWordsOf } from './member.words';
import {
  type PeriodOutlookInput,
  type PeriodOutlookVm,
  periodOutlookVm,
} from './period.presenter';
import { IVAN_RECORD, NIKOLAY_RECORD } from './team.fixtures.spec-support';

/*
 * «Период на работа», worded (Law 10; team onboarding D10): what the last
 * day drafted will do, and the question before a save that makes the
 * barber leave at once — pinned in both languages from fixed inputs and
 * the app's real catalogue. Where the period stands is the system's answer.
 */

const NBSP = ' ';
const read = (line: string | null): string | null =>
  line === null ? null : line.replaceAll(NBSP, ' ');
/** A warning as it reads: its title, then its line. */
const said = (
  notice: PeriodOutlookVm['leftover'],
): { title: string | null; body: string | null } | null =>
  notice === null
    ? null
    : { title: read(notice.title), body: read(notice.body) };

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

describe('periodOutlookVm', () => {
  it('says nothing with no last day, and nothing while the shop’s today is unknown', () => {
    expect(periodOutlookVm(inputOf())).toEqual({
      note: null,
      question: null,
      leftover: null,
    });
    expect(
      periodOutlookVm(
        inputOf({ lastLocalDate: localDate('2026-12-31'), today: null }),
      ),
    ).toEqual({ note: null, question: null, leftover: null });
  });

  it('a last day today or ahead: says when the person leaves, and asks nothing', () => {
    const ahead = periodOutlookVm(
      inputOf({ lastLocalDate: localDate('2026-12-31') }),
    );
    expect(ahead.note).toEqual({
      title: 'Иван напуска екипа след 31.12',
      body: 'След това вече не влиза в приложението като бръснар.',
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
    expect(passed.note).toEqual({
      title: 'Иван напуска екипа веднага',
      body: '15.11 вече е минал. Със запазването спира да влиза в приложението като бръснар.',
    });
    expect(passed.question).toEqual({
      title: 'Иван напуска екипа сега?',
      message:
        'Последният работен ден вече е минал. Иван спира да приема записи и вече не влиза в приложението като бръснар.',
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
        periodOutlookVm(inputOf({ barber: NIKOLAY_RECORD, lastLocalDate })),
      ).toEqual({ note: null, question: null, leftover: null });
    }
  });

  it('counts the bookings a last day ahead would leave behind — one, several — as the warning’s title, and says under it that they stay on the schedule', () => {
    const ahead = (leftoverCount: number) =>
      said(
        periodOutlookVm(
          inputOf({
            lastLocalDate: localDate('2026-12-31'),
            leftover: {
              leftoverCount,
              leftoverLocalDates: [localDate('2027-01-04')],
            },
          }),
        ).leftover,
      );
    expect(ahead(1)).toEqual({
      title: 'Иван има 1 запис след 31.12',
      body: 'Остава в графика. Отвори го, за да го дадеш на друг бръснар или да го преместиш преди последния ден.',
    });
    expect(ahead(3)).toEqual({
      title: 'Иван има 3 записа след 31.12',
      body: 'Остават в графика. Отвори запис, за да го дадеш на друг бръснар или да го преместиш преди последния ден.',
    });
    expect(ahead(0)).toBeNull();
  });

  it('for a last day already passed, says to move or cancel them before saving', () => {
    const passed = (leftoverCount: number) =>
      said(
        periodOutlookVm(
          inputOf({
            lastLocalDate: localDate('2026-11-15'),
            leftover: {
              leftoverCount,
              leftoverLocalDates: [localDate('2026-11-17')],
            },
          }),
        ).leftover,
      );
    expect(passed(1)).toEqual({
      title: 'Иван има 1 запис след 15.11',
      body: 'Остава в графика. Отвори го, за да го дадеш на друг бръснар, да го преместиш или да го откажеш.',
    });
    expect(passed(2)).toEqual({
      title: 'Иван има 2 записа след 15.11',
      body: 'Остават в графика. Отвори запис, за да го дадеш на друг бръснар, да го преместиш или да го откажеш.',
    });
  });

  it('says it could not check when the bookings cannot be read — a line with no count — and nothing while the answer is on its way', () => {
    expect(
      periodOutlookVm(
        inputOf({
          lastLocalDate: localDate('2026-12-31'),
          leftoverFailed: true,
        }),
      ).leftover,
    ).toEqual({
      title: null,
      body: 'Не успяхме да проверим дали има записи след тази дата.',
    });
    expect(
      periodOutlookVm(inputOf({ lastLocalDate: localDate('2026-12-31') }))
        .leftover,
    ).toBeNull();
  });

  it('says nothing about bookings for a record in preparation, whatever was read', () => {
    expect(
      periodOutlookVm(
        inputOf({
          barber: NIKOLAY_RECORD,
          lastLocalDate: localDate('2026-12-31'),
          leftover: {
            leftoverCount: 2,
            leftoverLocalDates: [localDate('2027-01-04')],
          },
        }),
      ).leftover,
    ).toBeNull();
  });

  it('says a day outside today’s year with its year', () => {
    expect(
      read(
        periodOutlookVm(inputOf({ lastLocalDate: localDate('2027-03-31') }))
          .note?.title ?? null,
      ),
    ).toContain('31.03.2027');
  });

  it('words it in English', () => {
    const ahead = periodOutlookVm(
      inputOf({ lastLocalDate: localDate('2026-12-31') }, 'en'),
    );
    expect(read(ahead.note?.title ?? null)).toMatch(
      /^Ivan leaves the team after .+$/,
    );
    expect(ahead.note?.body).toBe(
      'After that they no longer sign in to the app as a barber.',
    );
    const passed = periodOutlookVm(
      inputOf({ lastLocalDate: localDate('2026-11-15') }, 'en'),
    );
    expect(passed.note?.title).toBe('Ivan leaves the team right away');
    expect(read(passed.note?.body ?? null)).toMatch(
      /has already passed\. On saving they stop signing in to the app as a barber\.$/,
    );
    expect(passed.question?.title).toBe('Ivan leaves the team now?');
    expect(passed.question?.actions.map((action) => action.label)).toEqual([
      'Leaves',
      'Cancel',
    ]);
  });
});
