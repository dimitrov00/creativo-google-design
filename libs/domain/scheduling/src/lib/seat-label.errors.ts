import { DomainError } from '@creativo/domain/kernel';

export class SeatLabelEmptyError extends DomainError {
  override readonly code = 'scheduling.seat_label.empty' as const;
  constructor() {
    super('Seat label cannot be blank');
  }
}

export class SeatLabelTooLongError extends DomainError {
  override readonly code = 'scheduling.seat_label.too_long' as const;
  constructor(public readonly max: number) {
    super(`Seat label cannot exceed ${max} characters`, { max });
  }
}

export type SeatLabelError = SeatLabelEmptyError | SeatLabelTooLongError;
