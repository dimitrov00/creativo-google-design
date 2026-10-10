/**
 * The deployment's constants — **never stored** (§9 D22; `settings/bookingPolicy`
 * holds only the policy). `zone` is the IANA zone every `dayTableAround`
 * call reads (today `TENANT_ZONE` in `apps/functions/src/lib/booking/tenant-zone.ts`
 * and the web's eight `'Europe/Sofia'` literals); `countryCallingCode` is the
 * dialling code a local-format phone number is read against (digits only,
 * no `+`). A single-city tenant, so a constant is honest: the day a shop
 * opens in another zone, the location's own `zone` takes over and this is
 * the one constant to retire.
 */
export type TenantConfig = {
  readonly zone: string;
  readonly countryCallingCode: string;
};

export const TenantConfig = {
  DEFAULT: {
    zone: 'Europe/Sofia',
    countryCallingCode: '359',
  } satisfies TenantConfig,
} as const;
