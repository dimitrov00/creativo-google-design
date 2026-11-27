import type {
  EnrollmentStatus,
  LocalizedText,
  ProgramContact,
} from '@core/components';
import type { CourseId } from '@core/primitives';

/**
 * A barbering course listing — `courses/{id}`, the body this type minus
 * `id` (Law 5), **every optional present**: before flip 4 the reader
 * re-added `startsLabel` by conditional spread; now `null` is written. `enrollmentStatus` is admin-set and the single source of the
 * page's Open/Upcoming split (SCREAMING since flip 4); `startsLabel` is
 * human copy like "Spring 2026" for a course without a fixed date (`null`
 * when none); `contacts` are the ways to enrol, none falling back to the
 * shop's Instagram.
 */
export type Course = {
  readonly id: CourseId;
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly enrollmentStatus: EnrollmentStatus;
  readonly startsLabel: LocalizedText | null;
  /** The ways to answer it, canonical, at most one per method; `[]` falls back to the shop's Instagram. */
  readonly contacts: readonly ProgramContact[];
  readonly sortOrder: number;
};
