import { BookingPolicy } from '@creativo/domain/scheduling';

/**
 * Where the tenant policy lives, and how its document parses — defined HERE,
 * in the port layer, for the same reason `appointment-document.ts` is: the
 * browser reads it through `firebase/firestore` and the functions read it
 * through `firebase-admin`, and two parsers is two answers to "what is the
 * horizon". (The first split copy shipped a client that read the policy off
 * the WRONG object entirely while the server never read it at all.)
 */
export const SETTINGS_COLLECTION = 'settings';
export const BOOKING_POLICY_DOC = 'bookingPolicy';

/**
 * Document → policy, defaults as the floor.
 *
 * A missing document, a malformed one, a field an admin fat-fingered to
 * zero — all fall through to `BookingPolicy.default()`, per field. This is
 * deliberate and it is why nothing here returns a `Result`: the alternative
 * to a usable policy is a booking flow that will not open, and no shop is
 * better off with a dark `/book` than with a two-month horizon they did not
 * choose. A tenant with no policy document is the NORMAL case, not a failure.
 */
export function policyFromDocument(
  data: Record<string, unknown> | null | undefined,
): BookingPolicy {
  const fallback = BookingPolicy.default();
  if (!data) return fallback;

  const result = BookingPolicy.create({
    maxPartySize: numberOr(data['maxPartySize'], fallback.maxPartySize),
    slotStepMinutes: numberOr(
      data['slotStepMinutes'],
      fallback.slotStepMinutes,
    ),
    minLeadMinutes: numberOr(data['minLeadMinutes'], fallback.minLeadMinutes),
    horizonMonths: numberOr(data['horizonMonths'], fallback.horizonMonths),
    cancellationWindowHours: numberOr(
      data['cancellationWindowHours'],
      fallback.cancellationWindowHours,
    ),
    maxFlexibleDays: numberOr(
      data['maxFlexibleDays'],
      fallback.maxFlexibleDays,
    ),
    // A missing field means "the shop never chose", and the ruling's default
    // is on — so an existing tenant document without the key auto-confirms.
    autoConfirm:
      typeof data['autoConfirm'] === 'boolean'
        ? data['autoConfirm']
        : fallback.autoConfirm,
  });
  return result.isSuccess() ? result.value : fallback;
}

/** A field the domain would refuse falls back rather than failing the whole policy. */
function numberOr(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Policy → document, the write half — used by the seed and, later, the admin
 * editor. Kept beside the parser so a field added to one cannot be forgotten
 * by the other.
 */
export function policyToDocument(
  policy: BookingPolicy,
): Record<string, number | boolean> {
  return {
    maxPartySize: policy.maxPartySize,
    slotStepMinutes: policy.slotStepMinutes,
    minLeadMinutes: policy.minLeadMinutes,
    horizonMonths: policy.horizonMonths,
    cancellationWindowHours: policy.cancellationWindowHours,
    maxFlexibleDays: policy.maxFlexibleDays,
    autoConfirm: policy.autoConfirm,
  };
}
