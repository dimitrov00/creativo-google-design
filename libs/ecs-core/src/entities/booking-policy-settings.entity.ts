import type { BookingPolicy } from '../components/booking-policy.data';

/** The fixed id `'bookingPolicy'` — the tenant has one policy document. */
export type BookingPolicySettingsId = string & {
  readonly __brand: unique symbol;
};
export const BookingPolicySettingsId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): BookingPolicySettingsId => raw as BookingPolicySettingsId,
  /**
   * The one document id there is (`BOOKING_POLICY_DOC`, read by
   * `load-booking-policy.ts:27`, matched by `recompute-on-policy-change.ts:121-125`).
   */
  FIXED: 'bookingPolicy',
} as const;

/**
 * The tenant's booking policy — `settings/bookingPolicy`, AS STORED TODAY:
 * the seven `BookingPolicy` fields flat at the document root
 * (`booking-policy-document.ts:67-79`). `BookingPolicy.withDefaults` covers an
 * absent `autoConfirm` and an absent document. No `zone`, no
 * `countryCallingCode`, no `flags`: the tenant zone and dialling code are
 * deployment constants (`TenantConfig.DEFAULT`) and flags are build-time
 * manifest values.
 */
export type BookingPolicySettingsEntity = {
  readonly id: BookingPolicySettingsId;
} & BookingPolicy;
