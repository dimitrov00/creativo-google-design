import type { BookingPolicy } from '../components/booking-policy.data';
import { BookingPolicySettingsId } from '../primitives/ids.primitive';

/**
 * The tenant's booking policy — `settings/bookingPolicy`, AS STORED TODAY:
 * the seven `BookingPolicy` fields flat at the document root
 * (`booking-policy-document.ts:67-79`), already the flat archetype
 * `{ id } & BookingPolicy`. `BookingPolicy.withDefaults` covers an absent
 * `autoConfirm` and an absent document. No zone, no `countryCallingCode`, no
 * `flags`: the zone is the shop location's (Law 7.2), the dialling code a
 * deployment constant and flags are build-time manifest values.
 */
export type BookingPolicySettings = {
  readonly id: BookingPolicySettingsId;
} & BookingPolicy;

/**
 * Flatten-pass staging: the barrel's id block (and `ports/collections.ts`'s
 * `BOOKING_POLICY_DOC`) still name this module for `BookingPolicySettingsId`
 * until the integrator re-points them — the id, with its `FIXED`, lives in
 * `primitives/ids.primitive.ts` (§1.5).
 */
