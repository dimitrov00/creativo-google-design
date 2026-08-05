import { DomainError } from '@creativo/domain/kernel';
import type { WaitlistStatus } from './waitlist-request';

export class InvalidWaitlistRequestError extends DomainError {
  override readonly code = 'scheduling.waitlist.invalid' as const;
  constructor(public readonly field: string) {
    super(`Waitlist request "${field}" is invalid`, { field });
  }
}

/**
 * A request naming no days is a request to be told about nothing. Refused at
 * the door rather than stored: it would sit in the matcher forever, matching
 * everything or nothing depending on how the empty mask degrades.
 */
export class EmptyWaitlistWhenError extends DomainError {
  override readonly code = 'scheduling.waitlist.no_days' as const;
  constructor() {
    super('A waitlist request must name at least one day');
  }
}

/** Nothing to watch FOR — the bag is what a match is measured against. */
export class EmptyWaitlistCartError extends DomainError {
  override readonly code = 'scheduling.waitlist.empty_cart' as const;
  constructor() {
    super('A waitlist request must carry at least one service');
  }
}

export class WaitlistTransitionError extends DomainError {
  override readonly code = 'scheduling.waitlist.invalid_transition' as const;
  constructor(
    public readonly from: WaitlistStatus,
    public readonly to: WaitlistStatus,
  ) {
    super(`A waitlist request cannot go from "${from}" to "${to}"`, {
      from,
      to,
    });
  }
}

export type WaitlistRequestError =
  | InvalidWaitlistRequestError
  | EmptyWaitlistWhenError
  | EmptyWaitlistCartError
  | WaitlistTransitionError;
