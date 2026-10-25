import { describe, expect, it } from 'vitest';
import {
  AppointmentId,
  BookingStatus,
  LocalDate,
  type UtcEpochMs,
} from '@core/primitives';
import type { WallTime } from '@core/components';
import { ZonedTimeSystem } from '@core/systems';
import { unwrapOk } from '@core/testing';
import {
  VisitGrain,
  VisitRowEntry,
  VisitRowOutcome,
  type VisitRowVm,
} from './visit-row.vm';
import {
  UPCOMING_SECTION_KEY,
  sectionVisits,
  visitSectionKey,
  visitSectionLabel,
  workedVisitsDetail,
} from './visit-sections';

const ZONE = unwrapOk(ZonedTimeSystem.checkZone('Europe/Sofia'));

/** A wall-clock reading in Sofia: its instant, and the shop day it falls on. */
function at(iso: string): WallTime & { readonly utcMs: UtcEpochMs } {
  const utcMs = unwrapOk(ZonedTimeSystem.parseIsoIn(iso, ZONE));
  return { ...ZonedTimeSystem.toLocal(utcMs, ZONE), utcMs };
}

/** A row as the builder files it: only what sectioning reads is real. */
function row(
  id: string,
  iso: string,
  options: {
    readonly upcoming?: boolean;
    readonly grain?: VisitGrain;
    readonly outcome?: VisitRowOutcome;
  } = {},
): VisitRowVm {
  const start = at(iso);
  const upcoming = options.upcoming ?? false;
  return {
    id: AppointmentId.of(id),
    visitRowEntry: VisitRowEntry.Visit,
    localDate: start.localDate,
    startMinutes: start.minute,
    sectionKey: upcoming
      ? UPCOMING_SECTION_KEY
      : visitSectionKey(start.localDate, options.grain ?? VisitGrain.Month),
    upcoming,
    tile: {
      caption: 'пт',
      day: LocalDate.parts(start.localDate).day,
      tone: upcoming ? 'upcoming' : 'past',
    },
    leadingIcon: null,
    title: 'Фейд',
    struck: false,
    lines: [],
    quote: null,
    trailing: null,
    trailingFact: null,
    marks: [],
    outcome:
      options.outcome ??
      (upcoming ? VisitRowOutcome.Open : VisitRowOutcome.Worked),
    bookingStatus: upcoming ? BookingStatus.Confirmed : BookingStatus.Completed,
    accessibleName: id,
    testId: `row-${id}`,
  };
}

// `Intl` joins a bg year to its « г.» with a narrow no-break space (U+202F),
// kept as `Intl` writes it (R59: never post-processed).
const LABELS = {
  upcoming: 'Предстоящи',
  section: (key: string) => visitSectionLabel(key, 'bg'),
};

const ids = (rows: readonly VisitRowVm[]) => rows.map((entry) => entry.id);

describe('sectionVisits', () => {
  it('leads with the upcoming run, soonest first, then the months newest first, each newest first', () => {
    const sections = sectionVisits(
      [
        row('aug-early', '2026-08-03T10:00:00'),
        row('next-week', '2026-10-05T10:00:00', { upcoming: true }),
        row('sep-late', '2026-09-24T10:00:00'),
        row('tomorrow', '2026-09-29T10:00:00', { upcoming: true }),
        row('aug-late', '2026-08-27T10:00:00'),
        row('sep-early', '2026-09-04T10:00:00'),
      ],
      { grain: VisitGrain.Month, labels: LABELS },
    );

    expect(sections.map((section) => section.key)).toEqual([
      'upcoming',
      '2026-09',
      '2026-08',
    ]);
    expect(sections.map((section) => section.label)).toEqual([
      'Предстоящи',
      'Септември 2026\u202fг.',
      'Август 2026\u202fг.',
    ]);
    expect(sections.map((section) => ids(section.rows))).toEqual([
      ['tomorrow', 'next-week'],
      ['sep-late', 'sep-early'],
      ['aug-late', 'aug-early'],
    ]);
    // A list that asks for no figure gets none, anywhere.
    expect(sections.every((section) => section.detail === null)).toBe(true);
  });

  it('never draws two «Юли» a year apart under the same word — the label carries its year', () => {
    const sections = sectionVisits(
      [
        row('july-2026', '2026-07-16T10:00:00'),
        row('july-2025', '2025-07-07T10:00:00'),
      ],
      { grain: VisitGrain.Month, labels: LABELS },
    );
    expect(sections.map((section) => section.label)).toEqual([
      'Юли 2026\u202fг.',
      'Юли 2025\u202fг.',
    ]);
  });

  it('sections a barber-cadence history by year, folding month keys into their year', () => {
    const sections = sectionVisits(
      [
        // Built for the year grain, and for the month grain: both file by year.
        row('sep-2026', '2026-09-04T10:00:00', { grain: VisitGrain.Year }),
        row('jul-2026', '2026-07-16T10:00:00', {
          outcome: VisitRowOutcome.Cancelled,
        }),
        row('mar-2025', '2025-03-06T10:00:00', { grain: VisitGrain.Year }),
        row('this-visit', '2026-10-02T10:00:00', { upcoming: true }),
      ],
      {
        grain: VisitGrain.Year,
        labels: {
          ...LABELS,
          // The staff heading's figure: worked visits only, absent at zero.
          detail: (rows) => {
            const worked = rows.filter(
              (entry) => entry.outcome === VisitRowOutcome.Worked,
            );
            return worked.length === 0 ? null : `${worked.length} посещения`;
          },
        },
        testIdPrefix: 'history',
      },
    );

    expect(
      sections.map(({ key, label, detail, testId }) => ({
        key,
        label,
        detail,
        testId,
      })),
    ).toEqual([
      {
        key: 'upcoming',
        label: 'Предстоящи',
        detail: null,
        testId: 'history-upcoming',
      },
      {
        key: '2026',
        label: '2026',
        detail: '1 посещения',
        testId: 'history-year-2026',
      },
      {
        key: '2025',
        label: '2025',
        detail: '1 посещения',
        testId: 'history-year-2025',
      },
    ]);
    expect(ids(sections[1]?.rows ?? [])).toEqual(['sep-2026', 'jul-2026']);
  });

  it('asks for the figure of dated sections only — the upcoming run is a promise, not a record', () => {
    const asked: string[] = [];
    sectionVisits(
      [
        row('ahead', '2026-10-02T10:00:00', { upcoming: true }),
        row('past', '2026-09-04T10:00:00'),
      ],
      {
        grain: VisitGrain.Year,
        labels: {
          ...LABELS,
          detail: (rows) => {
            asked.push(...ids(rows));
            return null;
          },
        },
      },
    );
    expect(asked).toEqual(['past']);
  });

  it('gives a period with no visit no section at all, and an empty list none', () => {
    const sections = sectionVisits(
      [row('sep', '2026-09-04T10:00:00'), row('jun', '2026-06-11T10:00:00')],
      { grain: VisitGrain.Month, labels: LABELS },
    );
    expect(sections.map((section) => section.key)).toEqual([
      '2026-09',
      '2026-06',
    ]);
    // No upcoming row, no upcoming heading.
    expect(sections.some((section) => section.key === 'upcoming')).toBe(false);
    expect(
      sectionVisits([], { grain: VisitGrain.Month, labels: LABELS }),
    ).toEqual([]);
  });

  it('keeps one order whatever order the rows arrive in', () => {
    const rows = [
      row('b', '2026-09-04T10:00:00'),
      row('a', '2026-09-04T10:00:00'),
      row('c', '2026-09-01T10:00:00'),
    ];
    const forward = sectionVisits(rows, {
      grain: VisitGrain.Month,
      labels: LABELS,
    });
    const backward = sectionVisits([...rows].reverse(), {
      grain: VisitGrain.Month,
      labels: LABELS,
    });
    expect(ids(forward[0]?.rows ?? [])).toEqual(['a', 'b', 'c']);
    expect(ids(backward[0]?.rows ?? [])).toEqual(['a', 'b', 'c']);
  });

  it('names its test ids after the family the host asks for, `visits` by default', () => {
    const sections = sectionVisits(
      [
        row('ahead', '2026-10-02T10:00:00', { upcoming: true }),
        row('past', '2026-09-04T10:00:00'),
      ],
      { grain: VisitGrain.Month, labels: LABELS },
    );
    expect(sections.map((section) => section.testId)).toEqual([
      'visits-upcoming',
      'visits-month-2026-09',
    ]);
  });
});

describe('workedVisitsDetail', () => {
  const word = (count: number) =>
    count === 1 ? `${count} посещение` : `${count} посещения`;

  it('counts a month’s worked visits from two up, and leaves a one-row month its heading alone', () => {
    const sections = sectionVisits(
      [
        row('next', '2026-10-05T10:00:00', { upcoming: true }),
        row('sep-a', '2026-09-24T10:00:00'),
        row('sep-b', '2026-09-04T10:00:00'),
        row('sep-c', '2026-09-02T10:00:00'),
        row('aug', '2026-08-03T10:00:00'),
      ],
      {
        grain: VisitGrain.Month,
        labels: { ...LABELS, detail: workedVisitsDetail(word) },
      },
    );
    expect(sections.map((section) => [section.key, section.detail])).toEqual([
      // The upcoming run is a promise, not a record: never asked.
      [UPCOMING_SECTION_KEY, null],
      ['2026-09', '3 посещения'],
      // «1 посещение» over one row says what the row already does.
      ['2026-08', null],
    ]);
  });

  it('counts what was WORKED: a cancellation and a no-show are rows, not visits', () => {
    const detail = workedVisitsDetail(word);
    expect(
      detail([
        row('worked', '2026-07-20T10:00:00'),
        row('missed', '2026-07-07T10:00:00', {
          outcome: VisitRowOutcome.NoShow,
        }),
        row('called-off', '2026-07-16T10:00:00', {
          outcome: VisitRowOutcome.Cancelled,
        }),
      ]),
    ).toBeNull();
    expect(
      detail([
        row('worked-a', '2026-07-20T10:00:00'),
        row('worked-b', '2026-07-02T10:00:00'),
        row('missed', '2026-07-07T10:00:00', {
          outcome: VisitRowOutcome.NoShow,
        }),
      ]),
    ).toBe('2 посещения');
    expect(detail([])).toBeNull();
  });

  it('takes the floor its grain asks for: a year’s figure is a fact from the first visit on', () => {
    const byYear = workedVisitsDetail(word, 1);
    expect(
      byYear([row('only', '2025-03-06T10:00:00', { grain: VisitGrain.Year })]),
    ).toBe('1 посещение');
    // Nothing worked is never «0 посещения», whatever the floor.
    expect(
      workedVisitsDetail(
        word,
        0,
      )([
        row('missed', '2025-03-06T10:00:00', {
          outcome: VisitRowOutcome.NoShow,
        }),
      ]),
    ).toBeNull();
  });
});

describe('visitSectionKey', () => {
  it('files a visit on its own calendar, never the device’s', () => {
    // 00:30 on 1 October in Sofia is still 30 September in UTC: the visit
    // files under its SHOP day, the one it is stored on.
    const justAfterMidnight = at('2026-10-01T00:30:00');
    expect(visitSectionKey(justAfterMidnight.localDate, VisitGrain.Month)).toBe(
      '2026-10',
    );
    expect(visitSectionKey(justAfterMidnight.localDate, VisitGrain.Year)).toBe(
      '2026',
    );
    const newYear = at('2027-01-01T00:15:00');
    expect(visitSectionKey(newYear.localDate, VisitGrain.Year)).toBe('2027');
  });
});

describe('visitSectionLabel', () => {
  it('heads a month with its year, the month capitalised because a heading is not prose', () => {
    expect(visitSectionLabel('2026-09', 'bg')).toBe('Септември 2026\u202fг.');
    expect(visitSectionLabel('2026-09', 'en')).toBe('September 2026');
    expect(visitSectionLabel('2027-01', 'bg')).toBe('Януари 2027\u202fг.');
  });

  it('heads a year with the year alone', () => {
    expect(visitSectionLabel('2026', 'bg')).toBe('2026');
    expect(visitSectionLabel('2025', 'en')).toBe('2025');
  });
});
