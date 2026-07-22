/**
 * Compile-only assertions (no runtime `it`/`expect`) proving the
 * primitive-obsession ban holds across this lib's ports/use-cases. Never
 * executed by Vitest — named `*.type-spec.ts` so the `{test,spec}` glob
 * doesn't pick it up — exists purely so `tsc` fails if one of these
 * invariants regresses.
 */
import { UserId } from '@creativo/domain/accounts';
import { ProfilePort } from './ports/profile.port';
import { ConfirmationCode } from './ports/confirmation-code';

declare const profiles: ProfilePort;

// (a) A plain `string` is rejected where a branded ID is expected.

// @ts-expect-error — a bare string is not a UserId.
const _userIdFromString: UserId = 'user_1';

// @ts-expect-error — a bare string is not a ConfirmationCode.
const _confirmationCodeFromString: ConfirmationCode = '123456';

// (b) Port methods reject a plain string in place of the branded id.

// @ts-expect-error — getProfile takes a UserId, not a bare string.
profiles.getProfile('user_1');

export {};
