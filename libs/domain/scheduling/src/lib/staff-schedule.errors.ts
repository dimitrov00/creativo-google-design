import { DomainError } from '@creativo/domain/kernel';

export class OverlappingScheduleVersionsError extends DomainError {
  override readonly code =
    'scheduling.staff_schedule.overlapping_versions' as const;
  constructor(
    public readonly earlierFrom: string,
    public readonly laterFrom: string,
  ) {
    super(
      `Schedule versions starting ${earlierFrom} and ${laterFrom} overlap — exactly one pattern must be in force on any day`,
      { earlierFrom, laterFrom },
    );
  }
}

/**
 * Someone tried to change a roster with an effective date at or before the
 * current version's start — a retroactive edit.
 *
 * Refused because it silently restates history: every utilisation figure for
 * the affected period would divide by different minutes than the report the
 * owner already read. A genuine correction to specific past days is a
 * `ScheduleException`, which is explicit and auditable.
 */
export class RetroactiveScheduleAmendmentError extends DomainError {
  override readonly code =
    'scheduling.staff_schedule.retroactive_amendment' as const;
  constructor(
    public readonly attemptedFrom: string,
    public readonly currentFrom: string,
  ) {
    super(
      `Cannot amend a schedule from ${attemptedFrom}: the version in force began ${currentFrom}. Record a schedule exception for past days instead.`,
      { attemptedFrom, currentFrom },
    );
  }
}

export type StaffScheduleError =
  OverlappingScheduleVersionsError | RetroactiveScheduleAmendmentError;
