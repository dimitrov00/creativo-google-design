import { describe, expect, it } from 'vitest';
import { localDate } from '../testing';
import {
  PERSONAL_RECORD_KINDS,
  PersonalRecord,
  PersonalRecordKind,
} from './personal-record.data';

describe('PersonalRecord', () => {
  it('declares the kinds SCREAMING, in the rail order', () => {
    expect(PERSONAL_RECORD_KINDS).toEqual([
      'LONGEST_RHYTHM',
      'MOST_VISITS_IN_YEAR',
      'FAVOURITE_SERVICE',
      'FIRST_VISIT',
    ]);
  });

  it('finds the record of one kind, or none', () => {
    const records: readonly PersonalRecord[] = [
      {
        personalRecordKind: PersonalRecordKind.FirstVisit,
        value: 1,
        on: localDate('2024-03-02'),
        year: null,
        serviceId: null,
      },
      {
        personalRecordKind: PersonalRecordKind.MostVisitsInYear,
        value: 11,
        on: null,
        year: 2025,
        serviceId: null,
      },
    ];
    expect(
      PersonalRecord.find(records, PersonalRecordKind.MostVisitsInYear),
    ).toBe(records[1]);
    expect(
      PersonalRecord.find(records, PersonalRecordKind.LongestRhythm),
    ).toBeNull();
  });
});
