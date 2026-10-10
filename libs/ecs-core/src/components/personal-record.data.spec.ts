import { describe, expect, it } from 'vitest';
import { DayKey } from './day-key.data';
import {
  PERSONAL_RECORD_KINDS,
  PersonalRecord,
  PersonalRecordKind,
} from './personal-record.data';

describe('PersonalRecord', () => {
  it('keeps the stored kinds', () => {
    expect(PERSONAL_RECORD_KINDS).toEqual([
      'longestRhythm',
      'mostVisitsInYear',
      'favouriteService',
      'firstVisit',
    ]);
  });

  it('finds the record of one kind, or none', () => {
    const records: readonly PersonalRecord[] = [
      {
        kind: 'firstVisit',
        value: 1,
        on: DayKey.of('2024-03-02'),
        year: null,
        serviceId: null,
      },
      {
        kind: 'mostVisitsInYear',
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
