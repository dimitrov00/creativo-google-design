import { UserId } from '@creativo/domain/accounts';
import { BarberId, LocationId, ServiceId } from '@creativo/domain/catalog';
import { TimeSlot } from '@creativo/domain/scheduling';

/**
 * A booking wizard's in-progress, unconfirmed selections — persisted across
 * reloads so a client doesn't lose their place. Fields are progressively
 * filled in as the (not-yet-built) `BookingFlow` state machine advances;
 * `null`/empty just means "not chosen yet", not an error.
 */
export interface BookingDraft {
  readonly ownerId: UserId;
  readonly barberId: BarberId | null;
  readonly locationId: LocationId | null;
  readonly serviceIds: readonly ServiceId[];
  readonly timeSlot: TimeSlot | null;
}
