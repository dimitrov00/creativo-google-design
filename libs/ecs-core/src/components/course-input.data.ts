import type { EnrollmentStatus } from './enrollment-status.data';
import type { LocalizedText } from './localized-text.data';

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
