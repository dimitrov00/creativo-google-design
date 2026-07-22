/**
 * Compile-only assertions (no runtime `it`/`expect`) proving the
 * primitive-obsession ban and cross-brand isolation actually hold. This
 * file is never executed by Vitest — named `*.type-spec.ts` (not
 * `*.spec.ts`) specifically so the `{test,spec}` glob doesn't pick it up —
 * it exists purely so `tsc` fails if one of these invariants regresses.
 */
import { OtpId, PrincipalId } from './ids';
import { Email } from './email';
import { OtpCode } from './otp-code';
import { RedirectPath } from './redirect-path';
import { Otp } from './otp';

// (a) A plain `string` is rejected where a branded ID/VO is expected.

// @ts-expect-error — a bare string is not an OtpId.
const _otpIdFromString: OtpId = 'otp_1';

// @ts-expect-error — a bare string is not a PrincipalId.
const _principalIdFromString: PrincipalId = 'user_1';

// @ts-expect-error — a bare string is not an Email.
const _emailFromString: Email = 'client@example.com';

// @ts-expect-error — a bare string is not an OtpCode.
const _otpCodeFromString: OtpCode = '123456';

// @ts-expect-error — a bare string is not a RedirectPath.
const _redirectPathFromString: RedirectPath = '/account';

// (b) This context's own branded types are not interchangeable with each other.

declare const otpId: OtpId;
declare const principalId: PrincipalId;

// @ts-expect-error — OtpId cannot substitute where a PrincipalId is expected.
const _principalIdFromOtpId: PrincipalId = otpId;

// @ts-expect-error — PrincipalId cannot substitute where an OtpId is expected.
const _otpIdFromPrincipalId: OtpId = principalId;

declare const email: Email;
declare const otpCode: OtpCode;
declare const redirectPath: RedirectPath;

// @ts-expect-error — Email cannot substitute where an OtpCode is expected.
const _otpCodeFromEmail: OtpCode = email;

// @ts-expect-error — OtpCode cannot substitute where a RedirectPath is expected.
const _redirectPathFromOtpCode: RedirectPath = otpCode;

// @ts-expect-error — RedirectPath cannot substitute where an Email is expected.
const _emailFromRedirectPath: Email = redirectPath;

// (c) Otp.issue()/verify() stay zero-port: no hasher/generator port
// parameter can be smuggled back in without this call site breaking.
declare const now: Parameters<typeof Otp.issue>[1];
declare const issueProps: Parameters<typeof Otp.issue>[0];
declare const fakePort: { generateCode: () => string };
// @ts-expect-error — Otp.issue takes exactly (props, now); no third port argument.
Otp.issue(issueProps, now, fakePort);

export {};
