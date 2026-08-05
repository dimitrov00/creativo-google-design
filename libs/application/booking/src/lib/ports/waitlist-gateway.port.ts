import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { DomainError, Result } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import type {
  FlexibleWhenProps,
  ReconstituteBookingCartProps,
  WaitlistRequest,
} from '@creativo/domain/scheduling';
import { RepositoryError } from '@creativo/application/shared';

export interface RequestWaitlistInput {
  /** `null` ⇒ any shop. */
  readonly locationId: string | null;
  readonly when: FlexibleWhenProps;
  readonly cart: ReconstituteBookingCartProps;
}

export interface AcceptedWaitlistRequest {
  readonly requestId: string;
}

/**
 * Why a waitlist request was refused, as a code the UI can branch on.
 *
 * `unauthenticated` is the one that is not really a failure: it is the point
 * at which the flow asks the visitor to sign in, because there is nobody to
 * notify otherwise. It is separated from the rest for exactly that reason —
 * everything else is terminal, this one has a next step.
 */
export type WaitlistGatewayCode =
  'unauthenticated' | 'invalid_request' | 'already_watching' | 'failed';

export class WaitlistGatewayError extends DomainError {
  override readonly code: `booking.waitlist.${WaitlistGatewayCode}`;
  constructor(reason: WaitlistGatewayCode, message: string) {
    super(message, { reason });
    this.code = `booking.waitlist.${reason}` as const;
  }

  needsSignIn(): boolean {
    return this.code === 'booking.waitlist.unauthenticated';
  }
}

/**
 * The write side of the waitlist — a callable, exactly like `BookingGateway`.
 *
 * Server-side for the same reason the booking write is: the request names an
 * owner, and the one fact a caller must not be able to choose is who they are.
 * It also gives the matcher a single, validated shape to read; a client that
 * could write its own document could write a request the matcher then trips
 * over three days later with nobody watching.
 */
export interface WaitlistGateway {
  request(
    input: RequestWaitlistInput,
  ): Promise<Result<AcceptedWaitlistRequest, WaitlistGatewayError>>;

  cancel(requestId: string): Promise<Result<void, WaitlistGatewayError>>;
}

export const WAITLIST_GATEWAY = new InjectionToken<WaitlistGateway>(
  'WaitlistGateway',
);

/**
 * The read side — the client's own standing requests.
 *
 * Split from the gateway because the two have genuinely different shapes and
 * different trust: reads come straight from Firestore under rules scoped to
 * the owner, writes go through a function. Merging them would put a callable
 * and a snapshot listener behind one interface for no gain.
 */
export interface WaitlistReader {
  observeMine(
    userId: UserId,
  ): Observable<Result<readonly WaitlistRequest[], RepositoryError>>;

  /**
   * One request by id — the match notification's deep link carries only the
   * id, and landing it means rebuilding the bag the request froze. Rules
   * scope the read to the owner; a foreign id answers `null`, exactly like a
   * missing one, so the deep link cannot be used to probe.
   */
  findMine(
    requestId: string,
  ): Promise<Result<WaitlistRequest | null, RepositoryError>>;
}

export const WAITLIST_READER = new InjectionToken<WaitlistReader>(
  'WaitlistReader',
);
