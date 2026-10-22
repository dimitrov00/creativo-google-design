import type { EnrollmentStatus, LocalizedText } from '@core/components';
import type { CourseId } from '@core/primitives';

/**
 * A barbering course listing — `courses/{id}`, the body this type minus
 * `id` (Law 5), **every optional present**: before flip 4 the reader
 * re-added `startsLabel` and `applyUrl` by conditional spread; now `null` is
 * written. `enrollmentStatus` is admin-set and the single source of the
 * page's Open/Upcoming split (SCREAMING since flip 4); `startsLabel` is
 * human copy like "Spring 2026" for a course without a fixed date (`null`
 * when none); `applyUrl` `null` falls back to the shop's shared contact link.
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
