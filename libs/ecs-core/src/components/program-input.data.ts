import type { CourseInput } from './course-input.data';
import { EnrollmentStatus } from './enrollment-status.data';
import type { LocalizedText } from './localized-text.data';
import type { PositionInput } from './position-input.data';
import { PositionStatus } from './program-status.data';
import type { ShopEventInput } from './shop-event-input.data';

/*
 * The admin programs form as typed (`/admin/programs`) — FOREIGN input
 * before `ProgramsSystem` parses it into a `Position`, `Course` or
 * `ShopEvent` (F-8: raw edge structs, never stored). Every string is
 * untrimmed: the system trims. Each struct is its own TOP-LEVEL `…Input`
 * component (`position-input.data.ts`, `course-input.data.ts`,
 * `shop-event-input.data.ts` — split out by pass D, D-7), the sanctioned
 * escape from the raw-primitive guard (L3) for a location id that is still
 * a raw string; this file holds their union and the blank forms.
 */

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
