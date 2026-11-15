import { describe, expect, it } from 'vitest';
import { VisitPerspective } from '@core/components';
import { AppointmentId, BarberId } from '@core/primitives';
import {
  appointmentFixture,
  deepFreeze,
  FIXTURE_NOW,
  FIXTURE_PHONE,
  FIXTURE_TIME_ZONE,
  localDate,
  minute,
} from '@core/testing';
import {
  type VisitLookup,
  visitWordsOf,
} from '@creativo/features/shared/visits';
import { catalogueTranslate } from './catalogue.spec-support';
import {
  type LeftoverVisitsInput,
  leftoverSectionsVm,
} from './leftover-visits.presenter';

/*
 * The visits a last day leaves behind, as the app's own visit list: one
 * section per shop day under a full date, each row the shared list's — so
 * what is pinned here is the grouping's headings, the order and that a row
 * is the staff's row of that appointment.
 */

const IVAN = BarberId.of('ivan');
const translate = catalogueTranslate('bg');

const LOOKUP: VisitLookup = {
  serviceName: () => 'Класическо подстригване',
  barberName: () => 'Иван Петров',
  barberAvatarSrc: () => null,
  locationName: () => 'Център',
  locationCount: 1,
};

const visit = (id: string, day: string, startMinutes = 600) =>
  appointmentFixture({
    id: AppointmentId.of(id),
    localDate: localDate(day),
    startMinutes: minute(startMinutes),
    barberIds: [IVAN],
  });

function inputOf(visits: LeftoverVisitsInput['visits']): LeftoverVisitsInput {
  return {
    visits,
    now: FIXTURE_NOW,
    timeZone: FIXTURE_TIME_ZONE,
    locale: 'bg',
    rowWords: visitWordsOf(translate, 'bg', VisitPerspective.Staff),
    earlier: translate('staff.search.earlier'),
    lookup: LOOKUP,
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
    // No worked-visit count: these are visits to move, not a history.
    expect(sections.every((section) => section.detail === null)).toBe(true);
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

  it('a row is the shared list’s staff row of that appointment: what was booked, and with whom', () => {
    const [section] = leftoverSectionsVm(inputOf([visit('a-1', '2026-10-02')]));
    const row = section?.rows.at(0);
    expect(row?.id).toBe('a-1');
    expect(row?.title).toBe('Класическо подстригване');
    expect(row?.accessibleName).toContain('Иван Петров');
  });

  it('names who the shop would call under the person glyph — and adds no line for a visit with nobody to call', () => {
    const [section] = leftoverSectionsVm(
      inputOf([
        appointmentFixture({
          id: AppointmentId.of('a-1'),
          localDate: localDate('2026-10-02'),
          barberIds: [IVAN],
          contactName: 'Елена Василева',
          contactPhone: FIXTURE_PHONE,
        }),
        visit('a-walk-in', '2026-10-02', 900),
      ]),
    );
    const contactLineOf = (index: number) =>
      section?.rows
        .at(index)
        ?.lines.find((line) => line.testId === 'leftover-line-contact');

    expect(contactLineOf(0)).toEqual({
      text: 'Елена Василева',
      icon: 'contact.person',
      testId: 'leftover-line-contact',
    });
    expect(contactLineOf(1)).toBeUndefined();
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
