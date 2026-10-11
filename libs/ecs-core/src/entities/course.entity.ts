import type { EnrollmentStatus, LocalizedText } from '@core/components';
import type { CourseId } from '@core/primitives';

/**
 * A barbering course listing — `courses/{id}` (the stored body of
 * `course-repository.adapter.ts:21-31`), **every optional present**: the
 * legacy reader re-added `startsLabel` and `applyUrl` by conditional spread.
 * `enrollmentStatus` is admin-set and the single source of the page's
 * Open/Upcoming split; `startsLabel` is human copy like "Spring 2026" for a
 * course without a fixed date (`null` when none); `applyUrl` `null` falls
 * back to the shop's shared contact link.
 */
export type Course = {
  readonly id: CourseId;
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly enrollmentStatus: EnrollmentStatus;
  readonly startsLabel: LocalizedText | null;
  readonly applyUrl: string | null;
  readonly sortOrder: number;
};
