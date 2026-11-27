import type { EnrollmentStatus } from './enrollment-status.data';
import type { LocalizedText } from './localized-text.data';
import type { ProgramContact } from './program-contact.data';

/** A course as the admin typed it. */
export type CourseInput = {
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly enrollmentStatus: EnrollmentStatus;
  /** Both locales blank (after trimming) = no label; one blank alone is refused. */
  readonly startsLabel: LocalizedText;
  /** The ways to answer it, as typed; an entry with a blank value is dropped. */
  readonly contacts: readonly ProgramContact[];
  readonly sortOrder: number;
};
