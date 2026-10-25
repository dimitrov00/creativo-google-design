import type { AccountOccupant } from './account-occupant.data';
import type { SeatCatalogTerms } from './seat-catalog-terms.data';
import type { SeatCore } from './seat-core.data';
import type { SeatOutcome } from './seat-outcome.data';
import type { ServiceTerms } from './service-terms.data';

/**
 * A seat as the ACCOUNT rules read it — every slice of `Seat`, its occupant
 * an {@link AccountOccupant} (D29). What a system that reads no client
 * record takes (Law 3: the slice it reads), so a whole `Seat` passes
 * straight in. (Split out of `seat.data.ts`, pass D, L-2.)
 */
export type AccountSeat = SeatCore &
  ServiceTerms &
  SeatCatalogTerms &
  AccountOccupant &
  SeatOutcome;
