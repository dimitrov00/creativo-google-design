/**
 * The names this lib re-exports from other modules, by name. Kept out of
 * `index.ts` and reached through its `export *`, so a bundle that uses none
 * of them never reaches their modules (esbuild follows a barrel's named
 * re-exports unconditionally, its star re-exports only when used).
 */
export { ok, fail } from '@creativo/domain/kernel';
export {
  PhoneNumber,
  PhoneNumberInvalidError,
  examplePhoneNumber,
  // The staff omnibox reads a number as it is typed — «088 76» printed
  // «+359 88 76» before it is whole — and asks the index by the tenant's
  // own dial code (2026-09-22).
  formatPhoneDraft,
  countryCallingCode,
} from '@creativo/domain/kernel';
export { ZonedDateTime } from '@creativo/domain/kernel';
export { MONEY_ROLES, UserId, handlesMoney } from '@creativo/domain/accounts';
