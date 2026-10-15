import { PRIMARY_OUTLET, type Router, type UrlTree } from '@angular/router';
import { AppointmentId } from '@core/primitives';
import { RedirectPath } from '@creativo/application/identity';

/** The one route a booking sign-in round trip may come back to. */
const BOOKING_SEGMENT = 'book';

/**
 * The booking query parameters that still MEAN something after the flow has
 * sent a signed-out person to sign in — each one names a visit the booking
 * must still be attached to once the account is known:
 *
 *   - `repeat` — the visit this booking was made FROM. Read only for an
 *     active principal, so a person who arrived signed out has not had it
 *     read yet; dropped from the return URL, the rebooking edge was simply
 *     lost (the one fact about a booking nothing can rebuild later).
 *   - `reschedule` — the visit this flow MOVES. Lost, a move would commit as
 *     a second booking beside the first.
 *
 * Deliberately NOT carried: `step`, which is always `schedule` on the way
 * back (the draft resumes one step before an offer nobody re-checked), and
 * the waitlist deep link (`waitlist`, `day`) — that landing REBUILDS the flow
 * from the request, and by the time anyone reaches a sign-in prompt the draft
 * already holds everything it built plus whatever the person changed since.
 */
export const BOOKING_SOURCE_PARAMS = ['repeat', 'reschedule'] as const;

/**
 * Where the sign-in round trip returns to: `/book?step=schedule` plus every
 * {@link BOOKING_SOURCE_PARAMS} the current URL carries.
 *
 * `current` is the URL the flow is on (`router.url`), and it is treated as
 * UNTRUSTED — it came from the address bar. It has to be a relative path by
 * the same rule every `?redirect=` obeys (`RedirectPath`: no scheme, no
 * protocol-relative `//host`, no backslash tricks) AND it has to be the
 * booking route itself; anything else answers the plain booking return.
 * Only the named parameters are copied, and only when they have the shape of
 * an appointment id — the output is built by the router (`createUrlTree` →
 * `serializeUrl`), never by concatenation, so no value can smuggle a second
 * parameter or a path into it.
 */
export function bookingSignInReturnUrl(
  router: Router,
  current: string,
): string {
  const tree = bookingTreeOf(router, current);
  const sources =
    tree === null
      ? []
      : BOOKING_SOURCE_PARAMS.flatMap((key) => {
          const value = tree.queryParamMap.get(key);
          return value !== null && AppointmentId.parse(value).ok
            ? [[key, value] as const]
            : [];
        });
  return router.serializeUrl(
    router.createUrlTree([`/${BOOKING_SEGMENT}`], {
      queryParams: { step: 'schedule', ...Object.fromEntries(sources) },
    }),
  );
}

/** `current` parsed, when it is a safe relative URL of the booking route. */
function bookingTreeOf(router: Router, current: string): UrlTree | null {
  const safe = RedirectPath.create(current);
  if (safe.isFailure()) return null;

  let tree: UrlTree;
  try {
    tree = router.parseUrl(safe.value.value);
  } catch {
    // A malformed escape (`%E0%A4%A`) is not a URL the flow wrote.
    return null;
  }

  const outlets = new Map(Object.entries(tree.root.children));
  const primary = outlets.get(PRIMARY_OUTLET);
  const segments = primary?.segments.map((segment) => segment.path) ?? [];
  // Exactly `/book`: no deeper path, no auxiliary outlet riding along.
  const isBooking =
    outlets.size === 1 &&
    segments.length === 1 &&
    segments[0] === BOOKING_SEGMENT &&
    (primary?.children === undefined ||
      Object.keys(primary.children).length === 0);
  return isBooking ? tree : null;
}
