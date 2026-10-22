import { EnrollmentStatus } from './enrollment-status.data';
import type { LocalizedText } from './localized-text.data';
import { PositionStatus } from './program-status.data';

/*
 * The admin programs form as typed (`/admin/programs`) — FOREIGN input
 * before `ProgramsSystem` parses it into a `Position`, `Course` or
 * `ShopEvent` (F-8: raw edge structs, never stored). Every string is
 * untrimmed: the system trims. Each struct is a TOP-LEVEL `…Input` alias,
 * the sanctioned escape from the raw-primitive guard (L3) for a location id
 * that is still a raw string — a namespace member would hide the suffix, so
 * the variants are not namespaced (the `BarberOfferingInput` precedent).
 */

/** A role as the admin typed it. `locationIds` empty = every location; the page always sends `[]`. */
export type PositionInput = {
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  readonly locationIds: readonly string[];
  readonly positionStatus: PositionStatus;
  /** Blank (after trimming) = none. */
  readonly applyUrl: string;
  readonly sortOrder: number;
};

/** A course as the admin typed it. */
export type CourseInput = {
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly enrollmentStatus: EnrollmentStatus;
  /** Both locales blank (after trimming) = no label; one blank alone is refused. */
  readonly startsLabel: LocalizedText;
  /** Blank (after trimming) = none. */
  readonly applyUrl: string;
  readonly sortOrder: number;
};

/** An event as the admin typed it. */
export type ShopEventInput = {
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  /** The shop wall clock exactly as `<input type="datetime-local">` emits it: `YYYY-MM-DDTHH:mm`. */
  readonly startsAt: string;
  /** Blank (after trimming) = not tied to one shop. */
  readonly locationId: string;
  /** The RSVP link; blank (after trimming) = none. */
  readonly applyUrl: string;
  readonly sortOrder: number;
};

/** Any programs form as typed. */
export type ProgramInput = PositionInput | CourseInput | ShopEventInput;

const blankText = (): LocalizedText => ({ bg: '', en: '' });

export const ProgramInput = {
  /** The empty role form — open, no apply URL, first in order. */
  blankPosition(): PositionInput {
    return {
      title: blankText(),
      summary: blankText(),
      locationIds: [],
      positionStatus: PositionStatus.Open,
      applyUrl: '',
      sortOrder: 0,
    };
  },
  /** The empty course form — open, no starts label, no apply URL, first in order. */
  blankCourse(): CourseInput {
    return {
      title: blankText(),
      description: blankText(),
      enrollmentStatus: EnrollmentStatus.Open,
      startsLabel: blankText(),
      applyUrl: '',
      sortOrder: 0,
    };
  },
  /** The empty event form — no start, no location, no RSVP link, first in order. */
  blankShopEvent(): ShopEventInput {
    return {
      title: blankText(),
      description: blankText(),
      startsAt: '',
      locationId: '',
      applyUrl: '',
      sortOrder: 0,
    };
  },
} as const;
