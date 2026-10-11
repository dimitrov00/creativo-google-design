import { LocationId } from '../primitives/ids.primitive';

/**
 * The deployment's constants — **never stored** (§9 D22; `settings/bookingPolicy`
 * holds only the policy). No zone is configured here (flatten-spec F-4,
 * Law 7.2): the IANA zone lives ONLY on the `ShopLocation`, and a boundary
 * with no location in scope (an OTP, an impersonation, an account block)
 * loads the shop named by `defaultLocationId` and reads its `timeZone`.
 * `countryCallingCode` is the dialling code a local-format phone number is
 * read against (digits only, no `+`).
 */
export type TenantConfig = {
  /** The deployment's main shop — the location a location-less boundary reads its zone from. */
  readonly defaultLocationId: LocationId;
  readonly countryCallingCode: string;
};

export const TenantConfig = {
  /**
   * The single-tenant deployment: the centre shop (the seed's `loc-center`;
   * OQ-2 confirms the production id) and Bulgaria's `359`.
   */
  DEFAULT: {
    defaultLocationId: LocationId.of('loc-center'),
    countryCallingCode: '359',
  } satisfies TenantConfig as TenantConfig,
} as const;
