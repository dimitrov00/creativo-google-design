/**
 * Compile-only assertions (no runtime `it`/`expect`) proving the
 * primitive-obsession ban holds across this lib's ports/use-cases. Never
 * executed by Vitest — named `*.type-spec.ts` so the `{test,spec}` glob
 * doesn't pick it up — exists purely so `tsc` fails if one of these
 * invariants regresses.
 */
import { PrincipalId } from '@creativo/domain/identity';
import { OtpChallengeId } from './ports/otp-client.port';
import { OtpCode as BackendOtpCode } from './ports/otp-code';

// (a) A plain `string` is rejected where a branded type is expected.

// @ts-expect-error — a bare string is not a PrincipalId.
const _principalIdFromString: PrincipalId = 'user_1';

// @ts-expect-error — a bare string is not an OtpChallengeId.
const _challengeIdFromString: OtpChallengeId = 'challenge_1';

// @ts-expect-error — a bare string is not this lib's backend OtpCode brand.
const _backendOtpCodeFromString: BackendOtpCode = '123456';

// (b) This lib's own branded types are not interchangeable with each other.

declare const principalId: PrincipalId;
declare const challengeId: OtpChallengeId;

// @ts-expect-error — PrincipalId cannot substitute where an OtpChallengeId is expected.
const _challengeIdFromPrincipalId: OtpChallengeId = principalId;

// @ts-expect-error — OtpChallengeId cannot substitute where a PrincipalId is expected.
const _principalIdFromChallengeId: PrincipalId = challengeId;

export {};
