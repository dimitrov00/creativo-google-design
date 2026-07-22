/**
 * Compile-time-only assertions for the primitive-obsession ban (migration
 * blueprint §2.2). No runtime `expect()`/`it()` — this file is excluded
 * from the Vitest glob (`*.type-spec.ts`, see `tsconfig.spec.json`) and
 * exists purely so `tsc` fails the build if any of these accidentally
 * start compiling (i.e. if a signature below is loosened back to a bare
 * primitive/foreign brand). `declare function` (no body) so the fixture
 * signatures don't trip `no-unused-vars` on their parameters.
 */
import { PhoneNumber } from '@creativo/domain/kernel';
import { Email } from './email';
import { UserId } from './ids';

// ── (a) a plain `string` is rejected where a branded ID is expected ──

declare function acceptsUserId(id: UserId): void;

// @ts-expect-error — a raw string must not satisfy the `UserId` brand.
acceptsUserId('user_123');

declare const someUserId: UserId;
acceptsUserId(someUserId); // control: the branded value itself is accepted.

// ── (a, again) `UserId.create` only accepts a `string` in, and never
//    accepts an already-branded id back in as if it were raw input in a
//    context expecting the OTHER brand (see (b) below for that case).

const emptyIdResult = UserId.create('');
if (emptyIdResult.isFailure()) {
  // `.idType` is a bare string on the error itself (diagnostic data, not
  // a domain value) — fine per the primitive-obsession ban's own carve-out.
  const _idType: string = emptyIdResult.error.idType;
  void _idType;
}

// ── (b) this context's own VO brands are not interchangeable with each
//    other, nor with `PhoneNumber` (imported unmodified from kernel) ──

declare function acceptsPhoneNumber(phone: PhoneNumber): void;

declare const someEmail: Email;
// @ts-expect-error — an `Email` must not substitute for a `PhoneNumber`,
// even though both are ultimately private-string wrappers.
acceptsPhoneNumber(someEmail);

declare function acceptsEmail(email: Email): void;

declare const somePhoneNumber: PhoneNumber;
// @ts-expect-error — and the reverse: a `PhoneNumber` must not substitute
// for an `Email`.
acceptsEmail(somePhoneNumber);
