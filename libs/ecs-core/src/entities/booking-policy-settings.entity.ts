import type { BookingPolicy } from '@core/components';
import { BookingPolicySettingsId } from '@core/primitives';

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
