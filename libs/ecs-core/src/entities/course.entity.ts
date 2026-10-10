import type { EnrollmentStatus } from '../components/enrollment-status.data';
import type { LocalizedText } from '../components/localized-text.data';

export type CourseId = string & { readonly __brand: unique symbol };
export const CourseId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): CourseId => raw as CourseId,
} as const;

/**
 * A barbering course listing — `courses/{id}` (the stored body of
 * `course-repository.adapter.ts:21-31`), **every optional present**: the
 * legacy reader re-added `startsLabel` and `applyUrl` by conditional spread.
 * `enrollmentStatus` is admin-set and the single source of the page's
 * Open/Upcoming split; `startsLabel` is human copy like "Spring 2026" for a
 * course without a fixed date (`null` when none); `applyUrl` `null` falls
 * back to the shop's shared contact link.
 */
export type CourseEntity = {
  readonly id: CourseId;
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly enrollmentStatus: EnrollmentStatus;
  readonly startsLabel: LocalizedText | null;
  readonly applyUrl: string | null;
  readonly sortOrder: number;
};
