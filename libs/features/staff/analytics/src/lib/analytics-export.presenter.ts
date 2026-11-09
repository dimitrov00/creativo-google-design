import {
  type AnalyticsReport,
  DayFigures,
  type DayRow,
} from '@core/components';
import { StaffAnalyticsSystem } from '@core/systems';
import { formatCentsFigure } from '@creativo/ui/wall-clock';
import { type AnalyticsNames, REPORT_CURRENCY } from './analytics.presenter';
import type { AnalyticsExportFile } from './analytics.vm';
import type { AnalyticsWords } from './analytics.words';

/*
 * THE «АНАЛИЗИ» CSV (staff-analytics-v2 «Export (PR 7)», Law 10) — a report
 * and the words in, the file's name and text out. It DECIDES NOTHING: which
 * rows exist and their order are the report's (`reportDayRows`,
 * `reportServices`); whether a row is a day or a month is
 * `StaffAnalyticsSystem.dayRowsAreMonths`; the scope is the report's
 * (`reportScopeBarberId`, `null` the shop); the «друго» part is
 * `DayFigures.otherMinutesOf`. This file only spells them.
 *
 * The file: a byte-order mark (so a spreadsheet reads it as UTF-8), block 1
 * — the day columns and a row per day row; a blank line; block 2 — the
 * service columns and a row per service row: that barber's on a barber
 * scope, the shop's on the shop scope with the barber «Всички». `;` between
 * fields (a decimal comma is the money's), a field quoted only when it holds
 * a `;`, a `"` or a line break, the `"` doubled. Dates `YYYY-MM-DD`,
 * minutes whole numbers, money the locale's figure without its sign. CRLF
 * line ends. No client name, no seat: the export carries days and services.
 */

/** Everything the file is spelt from. */
export interface AnalyticsExportInput {
  readonly words: AnalyticsWords;
  readonly report: AnalyticsReport;
  readonly names: AnalyticsNames;
}

const BOM = '\uFEFF';
const SEPARATOR = ';';
const LINE_END = '\r\n';

/** The report as a CSV file. */
export function analyticsExportFile(
  input: AnalyticsExportInput,
): AnalyticsExportFile {
  const { report, words } = input;
  const lines: string[] = [lineOf(words.export.dayColumns)];
  const kind = StaffAnalyticsSystem.dayRowsAreMonths(report)
    ? words.export.kindMonth
    : words.export.kindDay;
  for (const row of report.reportDayRows) {
    lines.push(lineOf(dayFieldsOf(row, kind, input)));
  }
  lines.push('');
  lines.push(lineOf(words.export.serviceColumns));
  // A shop report's services are the shop's own: «Всички».
  const barber = barberNameOf(report.reportScopeBarberId, input);
  for (const row of report.reportServices) {
    lines.push(lineOf(serviceFieldsOf(row, barber, input)));
  }
  return {
    fileName: `creativo-analytics-${report.reportFromLocalDate}-${report.reportToLocalDate}.csv`,
    text: BOM + lines.join(LINE_END) + LINE_END,
  };
}

function dayFieldsOf(
  row: DayRow,
  kind: string,
  input: AnalyticsExportInput,
): readonly string[] {
  const lang = input.words.lang;
  return [
    kind,
    barberNameOf(row.barberId, input),
    row.localDate,
    String(row.dayWorkedMinutes),
    String(row.dayNoShowMinutes),
    String(row.dayUnmarkedMinutes),
    String(row.dayBlockedMinutes),
    String(row.dayBreakMinutes),
    String(row.dayUnsoldMinutes),
    String(DayFigures.otherMinutesOf(row)),
    formatCentsFigure(row.dayTakingsCents, row.currency, lang),
    formatCentsFigure(row.dayTipsCents, row.currency, lang),
  ];
}

function serviceFieldsOf(
  row: AnalyticsReport.ServiceRow,
  barber: string,
  input: AnalyticsExportInput,
): readonly string[] {
  const { words, names } = input;
  return [
    words.export.kindService,
    barber,
    names.serviceName(row.serviceId) ?? words.unknownService,
    String(row.workedSeatCount),
    formatCentsFigure(row.takingsCents, REPORT_CURRENCY, words.lang),
    String(row.serviceMinutes),
  ];
}

/** The catalogue's name of a barber record, as the screen prints it; the shop is «Всички». */
function barberNameOf(
  barberId: AnalyticsReport['reportScopeBarberId'],
  input: AnalyticsExportInput,
): string {
  const { words, names } = input;
  return barberId === null
    ? words.export.everyone
    : (names.barberName(barberId) ?? words.scope.barber);
}

function lineOf(fields: readonly string[]): string {
  return fields.map(fieldOf).join(SEPARATOR);
}

/** A field as written: quoted, its `"` doubled, only when it holds `;`, `"` or a line break. */
function fieldOf(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
