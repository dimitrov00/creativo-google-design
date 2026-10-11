import type { ServiceId } from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';

/**
 * A personal best of the «Рекорди» rail — the element's field
 * `personalRecordKind` (today the tuple `PERSONAL_RECORD_KINDS`).
 */
export const PersonalRecordKind = {
  /** The longest run, dated by the run's last visit (`on`). */
  LongestRhythm: 'LONGEST_RHYTHM',
  /** The most visits in one `year`. */
  MostVisitsInYear: 'MOST_VISITS_IN_YEAR',
  /** The service visited most (`serviceId`), and its visits. */
  FavouriteService: 'FAVOURITE_SERVICE',
  /** `value` 1 on its day. */
  FirstVisit: 'FIRST_VISIT',
} as const;
export type PersonalRecordKind =
  (typeof PersonalRecordKind)[keyof typeof PersonalRecordKind];

/** Every record kind, dictionary order — derived, never a second source. */
export const PERSONAL_RECORD_KINDS: readonly PersonalRecordKind[] =
  Object.values(PersonalRecordKind);

/**
 * A personal best — an element of `loyaltyAccounts/{uid}.records[]`
 * (`loyalty-document.ts:557-563`). Every field is present on every kind;
 * the ones a kind does not use are `null`.
 */
export type PersonalRecord = {
  readonly personalRecordKind: PersonalRecordKind;
  readonly value: number;
  readonly on: LocalDate | null;
  readonly year: number | null;
  readonly serviceId: ServiceId | null;
};

export const PersonalRecord = {
  /** The record of one kind, or `null` — at most one per kind. */
  find(
    records: readonly PersonalRecord[],
    personalRecordKind: PersonalRecordKind,
  ): PersonalRecord | null {
    for (let i = 0; i < records.length; i++) {
      const record = records[i] as PersonalRecord;
      if (record.personalRecordKind === personalRecordKind) return record;
    }
    return null;
  },
} as const;
