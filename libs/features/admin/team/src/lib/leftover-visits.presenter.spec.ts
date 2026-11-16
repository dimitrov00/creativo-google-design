import { describe, expect, it } from 'vitest';
import { AppointmentId, BarberId } from '@core/primitives';
import {
  appointmentFixture,
  deepFreeze,
  endMinute,
  FIXTURE_PHONE,
  FIXTURE_TODAY,
  localDate,
  minute,
} from '@core/testing';
import {
  type LeftoverVisitsInput,
  leftoverSectionsVm,
} from './leftover-visits.presenter';

/*
 * The visits a last day leaves behind, as the schedule would card them:
 * one section per shop day under a full date, each row the client first,
 * what was booked under the name, the clock — and no barber.
 */

const IVAN = BarberId.of('ivan');

const visit = (
  id: string,
  day: string,
  startMinutes = 600,
  contactName: string | null = 'Елена Василева',
) =>
  appointmentFixture({
    id: AppointmentId.of(id),
    localDate: localDate(day),
    startMinutes: minute(startMinutes),
    endMinutes: endMinute(startMinutes + 30),
    barberIds: [IVAN],
    ...(contactName === null
      ? {}
      : { contactName, contactPhone: FIXTURE_PHONE }),
  });

function inputOf(
  visits: LeftoverVisitsInput['visits'],
  over: Partial<LeftoverVisitsInput> = {},
): LeftoverVisitsInput {
  return {
    visits,
    // 2026-09-28, a Monday.
    today: FIXTURE_TODAY,
    locale: 'bg',
    earlier: 'По-рано',
    unknownService: 'Услуга',
    serviceName: () => 'Класическо подстригване',
    ...over,
  };
}

describe('leftoverSectionsVm', () => {
  it('files the visits under their days, each day under its full date, in the order given', () => {
    const sections = leftoverSectionsVm(
      inputOf([
        visit('a-1', '2026-10-02', 540),
        visit('a-2', '2026-10-02', 900),
        visit('a-3', '2026-10-20'),
      ]),
    );

    expect(
      sections.map((section) => ({
        key: section.key,
        label: section.label,
        testId: section.testId,
        rows: section.rows.map((row) => row.id),
      })),
    ).toEqual([
      {
        key: '2026-10-02',
        label: 'Петък, 2 октомври',
        testId: 'leftover-group-2026-10-02',
        rows: ['a-1', 'a-2'],
      },
      {
        key: '2026-10-20',
        label: 'Вторник, 20 октомври',
        testId: 'leftover-group-2026-10-20',
        rows: ['a-3'],
      },
    ]);
  });

  it('a visit before today that nobody closed files under «По-рано», after the days ahead', () => {
    const sections = leftoverSectionsVm(
      inputOf([visit('a-old', '2026-09-20'), visit('a-next', '2026-10-02')]),
    );
    expect(sections.map((section) => section.label)).toEqual([
      'Петък, 2 октомври',
      'По-рано',
    ]);
  });

  it('leads a row with who the shop would call, what was booked under the name, and the clock — never the barber', () => {
    const [section] = leftoverSectionsVm(
      inputOf([visit('a-1', '2026-10-02', 600)]),
    );
    expect(section?.rows.at(0)).toEqual({
      id: 'a-1',
      testId: 'leftover-row-a-1',
      clientName: 'Елена Василева',
      title: 'Елена Василева',
      lines: [
        { text: 'Класическо подстригване', testId: 'leftover-line-services' },
      ],
      start: '10:00',
      end: '10:30',
      accessibleName:
        'Елена Василева, Класическо подстригване, Петък, 2 октомври, 10:00',
    });
  });

  it('a visit with nobody to call is titled by what was booked, with no line under it', () => {
    const [section] = leftoverSectionsVm(
      inputOf([visit('a-walk-in', '2026-10-02', 600, null)]),
    );
    const row = section?.rows.at(0);
    expect(row?.clientName).toBeNull();
    expect(row?.title).toBe('Класическо подстригване');
    expect(row?.lines).toEqual([]);
    expect(row?.accessibleName).toBe(
      'Класическо подстригване, Петък, 2 октомври, 10:00',
    );
  });

  it('names a service the catalogue no longer lists by the house word, and each service once', () => {
    const [section] = leftoverSectionsVm(
      inputOf([visit('a-1', '2026-10-02')], { serviceName: () => null }),
    );
    expect(section?.rows.at(0)?.lines.at(0)?.text).toBe('Услуга');
  });

  it('answers no section for no visit', () => {
    expect(leftoverSectionsVm(inputOf([]))).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const input = deepFreeze(
      inputOf([visit('a-1', '2026-10-02'), visit('a-3', '2026-10-20')]),
    );
    expect(leftoverSectionsVm(input)).toEqual(leftoverSectionsVm(input));
  });
});
