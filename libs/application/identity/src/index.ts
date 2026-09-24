export * from './lib/ports/auth-token.port';
export * from './lib/ports/otp-crypto.port';
export * from './lib/ports/otp-code';
export * from './lib/ports/otp-destination';
export * from './lib/ports/otp-repository.port';
export * from './lib/ports/otp-sender.port';
export * from './lib/ports/user-repository.port';
export * from './lib/ports/auth-gateway.port';
export * from './lib/ports/otp-client.port';
export * from './lib/auth-deployment.token';
export * from './lib/use-cases/request-otp.use-case';
export * from './lib/use-cases/verify-otp.use-case';
export * from './lib/use-cases/register-user.use-case';
export * from './lib/use-cases/sign-out.use-case';
export * from './lib/use-cases/ensure-session-ready.use-case';
export * from './lib/flow/guest-guard';
export * from './lib/flow/auth-flow';
export * from './lib/flow/onboarding-flow';

// Facade re-export (blueprint §1.2 layering): `type:feature` libs may never
// depend on `type:domain` directly, only through `type:application` — and
// every flow/use-case above is already built entirely on this bounded
// context's domain vocabulary, so re-exporting it here is the sanctioned
// door for `AuthFlowStore`/`OnboardingFlowStore` (and the step components
// that bind form inputs straight through domain factories, blueprint §5.1)
// rather than each feature lib reaching past this layer.
export * from '@creativo/domain/identity';
// `Result`/`ok`/`fail` (blueprint §2.1) are the one piece of `domain/kernel`
// every port signature above is built from — re-exported for the same
// reason: feature-layer test doubles need to construct port-shaped
// `Result`s without an illegal `type:domain` import of their own.
export type { Result } from '@creativo/domain/kernel';
export { ok, fail } from '@creativo/domain/kernel';
// The kernel's caged phone vocabulary, re-exported for the same reason:
// feature steps that COLLECT a phone (onboarding's about step, a phone-OTP
// identify screen) validate the field text through `PhoneNumber.create`
// and reason-map `PhoneNumberInvalidError.reason` to example-bearing error
// copy (`examplePhoneNumber`) — without an illegal `type:domain` import of
// their own. `libphonenumber-js` itself stays caged in `domain/kernel`.
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
export type {
  CountryIso2,
  PhoneNumberInvalidReason,
} from '@creativo/domain/kernel';
// `BirthDate.create`'s explicit `today` parameter (§7.1 — no raw `Date` in
// domain code) is a kernel `ZonedDateTime`; re-exported so the onboarding
// about step (and its test doubles) can source `today` from the `Clock`
// port and hand it to the VO without an illegal `type:domain` import.
export { ZonedDateTime } from '@creativo/domain/kernel';

// Who may touch the shop's money (2026-09-10) — the accounts domain's own
// list and predicate, re-exported for the staff surfaces that gate on it.
// `UserId` rides along for the one feature that hands a client's id to a
// repository port.
export { MONEY_ROLES, UserId, handlesMoney } from '@creativo/domain/accounts';
