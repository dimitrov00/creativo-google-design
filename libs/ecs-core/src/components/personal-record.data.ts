import type { ServiceId } from '../entities/service.entity';
import type { DayKey } from './day-key.data';

/** A personal best of the «Рекорди» rail — today the tuple `PERSONAL_RECORD_KINDS`, stored strings unchanged. */
export const PersonalRecordKind = {
  /** The longest run, dated by the run's last visit (`on`). */
  LongestRhythm: 'longestRhythm',
  /** The most visits in one `year`. */
  MostVisitsInYear: 'mostVisitsInYear',
  /** The service visited most (`serviceId`), and its visits. */
  FavouriteService: 'favouriteService',
  /** `value` 1 on its day. */
  FirstVisit: 'firstVisit',
} as const;
export type PersonalRecordKind =
  (typeof PersonalRecordKind)[keyof typeof PersonalRecordKind];

/** Every record kind, dictionary order — derived, never a second source. */
export const PERSONAL_RECORD_KINDS: readonly PersonalRecordKind[] =
  Object.values(PersonalRecordKind);

/**
 * A personal best — an entry of `loyaltyAccounts/{uid}.records[]`
 * (`loyalty-document.ts:557-563`), unchanged. Every field is present on
 * every kind; the ones a kind does not use are `null`.
 */
export type PersonalRecord = {
  readonly kind: PersonalRecordKind;
  readonly value: number;
  readonly on: DayKey | null;
  readonly year: number | null;
  readonly serviceId: ServiceId | null;
};

export const PersonalRecord = {
  /** The record of one kind, or `null` — at most one per kind. */
  find(
    records: readonly PersonalRecord[],
    kind: PersonalRecordKind,
  ): PersonalRecord | null {
    for (let i = 0; i < records.length; i++) {
      const record = records[i] as PersonalRecord;
      if (record.kind === kind) return record;
    }
    return null;
  },
} as const;
