import { DomainError } from '@creativo/domain/kernel';

export class InvalidShiftSegmentError extends DomainError {
  readonly code = 'scheduling.shift_segment.invalid_location' as const;

  constructor(rawLocationId: string) {
    super(`A shift segment needs a valid location, got "${rawLocationId}"`, {
      rawLocationId,
    });
  }
}

/**
 * Two segments on one day at DIFFERENT shops, too close together for a human
 * to travel between them.
 *
 * Raised by the authoring path rather than silently trimmed, because a roster
 * that cannot be worked is a mistake someone should fix — not a grid that
 * quietly offers fewer slots for a reason nobody can see.
 */
export class ImpossibleTransferError extends DomainError {
  readonly code = 'scheduling.shift_segment.impossible_transfer' as const;

  constructor(
    readonly fromSegment: string,
    readonly toSegment: string,
    readonly requiredMinutes: number,
  ) {
    super(
      `Cannot travel from ${fromSegment} to ${toSegment} in under ${requiredMinutes} minutes`,
      { fromSegment, toSegment, requiredMinutes: String(requiredMinutes) },
    );
  }
}
