/**
 * Compile-only assertions (no runtime `it`/`expect`) proving the
 * primitive-obsession ban holds across this lib's ports/use-cases. Never
 * executed by Vitest — named `*.type-spec.ts` so the `{test,spec}` glob
 * doesn't pick it up — exists purely so `tsc` fails if one of these
 * invariants regresses.
 */
import { ImpersonationSessionId } from '@creativo/domain/governance';
import { UserId } from '@creativo/domain/accounts';
import { ImpersonationPort } from './ports/impersonation.port';

declare const impersonation: ImpersonationPort;

// (a) A plain `string` is rejected where a branded ID is expected.

// @ts-expect-error — a bare string is not an ImpersonationSessionId.
const _sessionIdFromString: ImpersonationSessionId = 'session_1';

// (b) This context's branded types are not interchangeable with a sibling context's.

declare const sessionId: ImpersonationSessionId;

// @ts-expect-error — ImpersonationSessionId cannot substitute where a UserId is expected.
const _userIdFromSessionId: UserId = sessionId;

// (c) Port methods reject a plain string in place of the branded id.

// @ts-expect-error — findById takes an ImpersonationSessionId, not a bare string.
impersonation.findById('session_1');

export {};
