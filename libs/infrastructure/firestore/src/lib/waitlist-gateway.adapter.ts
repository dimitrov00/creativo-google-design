import { Injectable, inject } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  type AcceptedWaitlistRequest,
  type RequestWaitlistInput,
  type WaitlistGateway,
  type WaitlistGatewayCode,
  WaitlistGatewayError,
} from '@creativo/application/booking';
import { FIREBASE_FUNCTIONS } from '@creativo/infrastructure/firebase-app';

/**
 * Server error `code` → the gateway's own vocabulary.
 *
 * Duck-typed off `details` rather than `instanceof FunctionsError`, the same
 * approach `CallableBookingGateway` and `CallableOtpClient` take: the SDK's
 * error shape is stable across versions and importing the class for a type
 * guard buys nothing.
 */
function toFailureCode(error: unknown): WaitlistGatewayCode {
  if (typeof error !== 'object' || error === null || !('details' in error)) {
    return 'failed';
  }
  const details = (error as { details?: unknown }).details;
  if (typeof details !== 'object' || details === null) return 'failed';

  switch ((details as { code?: unknown }).code) {
    case 'booking.waitlist.unauthenticated':
      return 'unauthenticated';
    case 'booking.waitlist.already_watching':
      return 'already_watching';
    case 'booking.waitlist.invalid_request':
    case 'booking.waitlist.too_many_days':
      return 'invalid_request';
    default:
      return 'failed';
  }
}

/**
 * The waitlist write path, over the `requestWaitlist` callable.
 *
 * Mirrors `CallableBookingGateway` exactly, including the duck-typed error
 * mapping, because the two are the same kind of thing: a client asking a
 * server to record something only the server may decide it owns.
 */
@Injectable()
export class CallableWaitlistGateway implements WaitlistGateway {
  private readonly functions = inject(FIREBASE_FUNCTIONS);

  async request(
    input: RequestWaitlistInput,
  ): Promise<Result<AcceptedWaitlistRequest, WaitlistGatewayError>> {
    try {
      const callable = httpsCallable<
        RequestWaitlistInput,
        { requestId: string }
      >(this.functions, 'requestWaitlist');
      const response = await callable(input);
      return ok({ requestId: String(response.data?.requestId ?? '') });
    } catch (error) {
      const code = toFailureCode(error);
      return fail(new WaitlistGatewayError(code, messageFor(code)));
    }
  }

  async cancel(requestId: string): Promise<Result<void, WaitlistGatewayError>> {
    try {
      const callable = httpsCallable<{ requestId: string }, void>(
        this.functions,
        'cancelWaitlist',
      );
      await callable({ requestId });
      return ok(undefined);
    } catch (error) {
      const code = toFailureCode(error);
      return fail(new WaitlistGatewayError(code, messageFor(code)));
    }
  }
}

/**
 * A developer-facing message only — every user-facing string is resolved from
 * the error's `code` through `translateDomainError`, never from here.
 */
function messageFor(code: WaitlistGatewayCode): string {
  switch (code) {
    case 'unauthenticated':
      return 'Sign in to be told when something opens up';
    case 'already_watching':
      return 'These days are already being watched';
    case 'invalid_request':
      return 'The waitlist request was rejected';
    default:
      return 'The waitlist request failed';
  }
}
