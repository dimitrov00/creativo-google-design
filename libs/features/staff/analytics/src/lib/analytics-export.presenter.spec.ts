import { describe, expect, it } from 'vitest';
import { AnalyticsSpan } from '@core/components';
import type { PriceCents } from '@core/primitives';
import {
  analyticsReportFixture,
  deepFreeze,
  localDate,
  shopReportFixture,
} from '@core/testing';
import { NAMES, wordsOf } from '../testing/analytics.fixtures';
import { analyticsExportFile } from './analytics-export.presenter';

const BOM = '\uFEFF';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture row');
  return value;
}
const CRLF = '\r\n';

/** The file's lines, the byte-order mark off and the last CRLF's empty tail dropped. */
function linesOf(text: string): readonly string[] {
  expect(text.startsWith(BOM)).toBe(true);
  expect(text.endsWith(CRLF)).toBe(true);
  return text.slice(BOM.length, -CRLF.length).split(CRLF);
}

/** `formatCentsFigure`' bg output keeps a no-break space between thousands: spell it in a spec. */
const nbsp = (text: string): string => text.replaceAll(' ', '\u00a0');

describe('analyticsExportFile — the «Анализи» CSV (staff-analytics-v2 «Export (PR 7)»)', () => {
  it('spells a barber’s month: block 1 a row per day row, a blank line, block 2 that barber’s services', () => {
    const file = analyticsExportFile({
      words: wordsOf('bg'),
      report: deepFreeze(analyticsReportFixture()),
      names: NAMES,
    });
    expect(file.fileName).toBe('creativo-analytics-2026-09-01-2026-09-30.csv');
    expect(linesOf(file.text)).toEqual([
      'вид;бръснар;дата;работено мин;неявяване мин;немаркирано мин;блокирано мин;почивка мин;непродадено мин;друго мин;оборот;бакшиш',
      'ДЕН;Иван Колев;2026-09-14;270;30;0;60;30;140;10;27,00;3,00',
      'ДЕН;Иван Колев;2026-09-15;210;30;0;60;30;200;10;21,00;3,00',
      '',
      'вид;бръснар;услуга;посещения;оборот;минути услуга',
      'УСЛУГА;Иван Колев;Подстригване;1;28,00;40',
      'УСЛУГА;Иван Колев;Брада;1;17,50;30',
    ]);
  });

  it('on the shop scope: a row per barber-day in the report’s order, and the shop’s services as «Всички»', () => {
    const lines = linesOf(
      analyticsExportFile({
        words: wordsOf('bg'),
        report: deepFreeze(shopReportFixture()),
        names: NAMES,
      }).text,
    );
    expect(lines.slice(1, 3)).toEqual([
      'ДЕН;Иван Колев;2026-09-14;270;30;0;60;30;140;10;27,00;3,00',
      'ДЕН;Нико Петров;2026-09-14;210;30;0;60;30;200;10;21,00;3,00',
    ]);
    expect(lines.slice(5)).toEqual([
      'УСЛУГА;Всички;Подстригване;1;28,00;40',
      'УСЛУГА;Всички;Брада;1;17,50;30',
    ]);
  });

  it('a span over 93 days carries a row per barber-month: «МЕСЕЦ», filed under the month’s first day', () => {
    const lines = linesOf(
      analyticsExportFile({
        words: wordsOf('bg'),
        report: deepFreeze(
          analyticsReportFixture({
            reportAnalyticsSpan: AnalyticsSpan.Year,
            reportFromLocalDate: localDate('2026-01-01'),
            reportToLocalDate: localDate('2026-12-31'),
          }),
        ),
        names: NAMES,
      }).text,
    );
    expect(lines[1]?.startsWith('МЕСЕЦ;Иван Колев;')).toBe(true);
  });

  it('quotes a field only when it holds the separator, a quote or a line break — the quote doubled — and names a barber or service the catalogue lost', () => {
    const lines = linesOf(
      analyticsExportFile({
        words: wordsOf('bg'),
        report: deepFreeze(
          analyticsReportFixture({
            reportDayRows: [
              {
                ...must(analyticsReportFixture().reportDayRows[0]),
                dayTakingsCents: 1_234_500 as PriceCents,
              },
            ],
          }),
        ),
        names: {
          ...NAMES,
          serviceName: (id) =>
            id === 'haircut' ? 'Подстригване; "класика"' : null,
          barberName: () => null,
        },
      }).text,
    );
    // Five figures take the locale's thousands separator.
    expect(lines[1]).toBe(
      nbsp('ДЕН;Бръснар;2026-09-14;270;30;0;60;30;140;10;12 345,00;3,00'),
    );
    expect(lines[4]).toBe(
      'УСЛУГА;Бръснар;"Подстригване; ""класика""";1;28,00;40',
    );
    expect(lines[5]).toBe('УСЛУГА;Бръснар;Услуга;1;17,50;30');
  });

  it('carries days and services only — no visit, no seat', () => {
    const report = analyticsReportFixture();
    const { text } = analyticsExportFile({
      words: wordsOf('bg'),
      report,
      names: NAMES,
    });
    for (const seat of report.reportSeatRows) {
      expect(text).not.toContain(seat.appointmentId);
      expect(text).not.toContain(seat.seatId);
    }
  });

  it('in English: the columns, the kinds and the money in the locale’s figure', () => {
    const lines = linesOf(
      analyticsExportFile({
        words: wordsOf('en'),
        report: deepFreeze(shopReportFixture()),
        names: NAMES,
      }).text,
    );
    expect(lines[0]).toBe(
      'kind;barber;date;worked min;no-show min;unmarked min;blocked min;break min;unsold min;other min;takings;tips',
    );
    expect(lines[1]).toBe(
      'DAY;Иван Колев;2026-09-14;270;30;0;60;30;140;10;27.00;3.00',
    );
    expect(lines[4]).toBe('kind;barber;service;visits;takings;service min');
    expect(lines[5]).toBe('SERVICE;All;Подстригване;1;28.00;40');
  });

  it('is pure — the report it reads is left as it was, the same file twice', () => {
    const input = {
      words: wordsOf('bg'),
      report: deepFreeze(shopReportFixture()),
      names: NAMES,
    };
    expect(analyticsExportFile(input)).toEqual(analyticsExportFile(input));
  });
});
