/**
 * Single-tenant deployment stand-in (blueprint §0.4 greenfield schema
 * freedom) — there is no tenant-config lookup wired for the web-facing
 * OTP callables yet (`libs/domain/governance`'s `TenantConfig` is
 * deliberately lighter than v2's and doesn't carry auth strategy/tenant
 * routing; see that lib's own docs). A real multi-tenant deployment would
 * resolve this from the request's origin/hostname instead.
 */
export const DEFAULT_TENANT_ID = 'creativo';
