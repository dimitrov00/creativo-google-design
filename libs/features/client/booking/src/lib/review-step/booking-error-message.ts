import type { TranslocoService } from '@jsverse/transloco';
import { ShopReach } from '@core/components';
import { MoveErrorCode, PipelineError } from '@core/primitives';
import {
  translateDomainError,
  wordPipelineError,
} from '@creativo/infrastructure/i18n';
import type { BookingFlowFailure } from '../booking-flow.store';

/** The review step's own generic copy — what a call failure says when the server said nothing more. */
const REVIEW_FALLBACK_CODE = 'booking.gateway.failed';

/**
 * What the review step says about a failed commit or move.
 *
 * The SERVER's own code wins when the catalogue has copy for it, read one
 * level deeper first when it names its reason (`wordPipelineError` — the one
 * rule, shared with the appointments page). The surface's generic copy can
 * only say "try again", and some refusals are the opposite of that: a busy
 * barber is fixed by another time; a retired service or a visit only the
 * shop may move is fixed by the shop, and one sentence cannot honestly say
 * both. One person in two chairs, or two guests under one name, say so in
 * their own words (`field`). A step the machine itself refused words its
 * own `errors.<errorCode>`.
 *
 * `callHref` is the call the PAGE offers beside the message, or `null`. Copy
 * that sends the client to the shop says "call" only when that button is
 * there to press, and "get in touch" when it is not
 * (`ShopReach.forCallHref`) — a sentence must never promise a call the page
 * cannot place.
 */
export function bookingErrorMessage(
  transloco: TranslocoService,
  error: BookingFlowFailure,
  callHref: string | null = null,
): string {
  if (!PipelineError.isPipelineError(error))
    return translateDomainError(transloco, error);
  return wordPipelineError(
    error,
    (code, params) =>
      translateDomainError(transloco, { ...params, errorCode: code }),
    REVIEW_FALLBACK_CODE,
    { reach: transloco.translate(ShopReach.forCallHref(callHref)) },
  );
}

/**
 * The refusal this error carries when the server refused to carry a seat
 * along (`MoveErrorCode.CarriedSeatUnplaceable`) — a `CarriedSeatRefusal`,
 * or a reason a newer server names that this client has no words for yet:
 * every one of them ends at the shop. What the review step reads to decide
 * whether a call is the answer.
 */
export function carriedRefusalOf(error: BookingFlowFailure): string | null {
  if (!PipelineError.isPipelineError(error)) return null;
  return error.serverErrorCode === MoveErrorCode.CarriedSeatUnplaceable
    ? error.refusal
    : null;
}

/**
 * `tel:` for the shop beside a refused move whose companion cannot come
 * along — every such refusal ends at the shop, the only one who can re-seat
 * somebody else, and its copy says "call" exactly when this is not `null`
 * (`ShopReach.forCallHref`). `null` for every other failure (a taken slot
 * is fixed by the grid, not a call) and when there is no number to dial, so
 * the page never shows a call it cannot place.
 */
export function callHrefForRefusal(
  error: BookingFlowFailure | null,
  shopPhoneE164: string | null,
): string | null {
  if (error === null || shopPhoneE164 === null) return null;
  return carriedRefusalOf(error) === null ? null : `tel:${shopPhoneE164}`;
}
