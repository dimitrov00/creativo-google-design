import type { TranslocoService } from '@jsverse/transloco';
import {
  type DomainError,
  shopReachKey,
  wordError,
} from '@creativo/application/booking';
import { translateDomainError } from '@creativo/infrastructure/i18n';

/**
 * What the review step says about a failed commit or move.
 *
 * The SERVER's own code wins when the catalogue has copy for it, read one
 * level deeper first when it names its reason (`wordError` — the one rule,
 * shared with the appointments page). The gateway's coarse
 * `booking.gateway.failed` can only say "try again", and some refusals are
 * the opposite of that: a busy barber is fixed by another time; a retired
 * service or a visit only the shop may move is fixed by the shop, and one
 * sentence cannot honestly say both. One person in two chairs, or two
 * guests under one name, say so in their own words (`field`).
 *
 * `callHref` is the call the PAGE offers beside the message, or `null`. Copy
 * that sends the client to the shop says "call" only when that button is
 * there to press, and "get in touch" when it is not (`shopReachKey`) — a
 * sentence must never promise a call the page cannot place.
 */
export function bookingErrorMessage(
  transloco: TranslocoService,
  error: DomainError,
  callHref: string | null = null,
): string {
  const params = {
    ...error.params,
    reach: transloco.translate(shopReachKey(callHref)),
  };
  return wordError(error, (code) =>
    translateDomainError(transloco, { code, params }),
  );
}

/**
 * The refusal this error carries, when the server named one — what the
 * review step reads to decide whether a call is the answer.
 */
export function carriedRefusalOf(error: DomainError): string | null {
  const refusal = error.params['refusal'];
  return error.params['serverCode'] === CARRIED_SEAT_UNPLACEABLE &&
    typeof refusal === 'string' &&
    refusal.length > 0
    ? refusal
    : null;
}

/**
 * `tel:` for the shop beside a refused move whose companion cannot come
 * along — every such refusal ends at the shop, the only one who can re-seat
 * somebody else, and its copy says "call" exactly when this is not `null`
 * (`shopReachKey`). `null` for every other failure (a taken
 * slot is fixed by the grid, not a call) and when there is no number to dial,
 * so the page never shows a call it cannot place.
 */
export function callHrefForRefusal(
  error: DomainError | null,
  shopPhoneE164: string | null,
): string | null {
  if (error === null || shopPhoneE164 === null) return null;
  return carriedRefusalOf(error) === null ? null : `tel:${shopPhoneE164}`;
}

/** The server code a move whose carried seat cannot come along answers with. */
const CARRIED_SEAT_UNPLACEABLE = 'booking.reschedule.carried_seat_unplaceable';
