import { DomainError } from '@creativo/domain/kernel';

/**
 * Two occupancy blocks overlap — the barber would be in two chairs at once.
 *
 * Checked on the aggregate as well as in the booking transaction, so that a
 * rebuild from source data cannot reintroduce a collision the live write path
 * prevented.
 */
export class BarberDayBlockCollisionError extends DomainError {
  override readonly code = 'scheduling.barber_day.block_collision' as const;
  constructor(
    public readonly firstBlockId: string,
    public readonly secondBlockId: string,
  ) {
    super(
      `Occupancy blocks "${firstBlockId}" and "${secondBlockId}" overlap — a barber cannot be in two chairs at once`,
      { firstBlockId, secondBlockId },
    );
  }
}

export type BarberDayError = BarberDayBlockCollisionError;
