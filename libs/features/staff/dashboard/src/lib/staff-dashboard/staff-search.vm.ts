import type { BookingStatus, AppointmentId, LocalDate } from '@core/primitives';
import type { Tag } from '@core/primitives';

/*
 * THE SEARCH SHEET'S DISPLAY MODEL (Law 10.3): one struct per hit, the title
 * and every other matched field split into runs. `staff-search.presenter.ts`
 * fills them.
 */

/**
 * What a search field of an appointment holds — the field `label` of a
 * searchable field and of a matched line. Internal: the matched lines print
 * their parts, never this tag.
 */
export const SearchField = {
  Client: 'CLIENT',
  Service: 'SERVICE',
  Phone: 'PHONE',
  Email: 'EMAIL',
  Note: 'NOTE',
} as const;
export type SearchField = Tag<typeof SearchField>;

/** One field that matched, split so the matching run can be marked. */
export interface MatchVm {
  readonly label: SearchField;
  readonly parts: readonly { readonly text: string; readonly hit: boolean }[];
}

/** One searchable field of an appointment — what it holds, and its text. */
export interface SearchableField {
  readonly label: SearchField;
  readonly value: string;
}

/** A visit's searchable fields, and those the term hit. */
export interface SearchMatch {
  readonly fields: readonly SearchableField[];
  readonly matched: readonly SearchableField[];
}

/** One appointment the search found. */
export interface SearchHitVm {
  readonly id: AppointmentId;
  readonly dayKey: LocalDate;
  readonly whenLabel: string;
  readonly past: boolean;
  readonly bookingStatus: BookingStatus;
  readonly titleParts: readonly {
    readonly text: string;
    readonly hit: boolean;
  }[];
  readonly matches: readonly MatchVm[];
}
