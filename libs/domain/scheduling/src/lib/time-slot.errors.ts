import {
  DomainError,
  type InvalidDateTimeError,
} from '@creativo/domain/kernel';

export class InvalidTimeSlotRangeError extends DomainError {
  override readonly code = 'scheduling.time_slot.invalid_range' as const;
  constructor() {
    super('A time slot must start strictly before it ends');
  }
}

export type TimeSlotError = InvalidDateTimeError | InvalidTimeSlotRangeError;
