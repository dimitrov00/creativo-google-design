import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AuthStrategy,
  AuthStrategyKind,
} from '../components/auth-strategy.data';
import {
  Identifier,
  IdentifierKind,
  ParsedIdentifier,
} from '../components/identifier.data';
import { IdentityErrorCode } from '../components/identity-errors.data';
import { OtpDestinationType } from '../components/otp-destination-type.data';
import { OtpPurpose } from '../components/otp-purpose.data';
import { RegistrationField } from '../components/registration.data';
import { TenantId } from '../components/tenant-id.data';
import { type OtpEntity, OtpId } from '../entities/otp.entity';
import { deepFreeze, sequentialIds, unwrapErr, unwrapOk } from '../testing';
import { type OtpChallenge, OtpLimits, OtpSystem } from './otp.system';

/*
 * The cases of libs/domain/identity/src/lib/otp.spec.ts (attempt limits,
 * expiry, lock-out), COPIED over struct literals — the class spec keeps
 * running against its shim. `isSuccess(r)` became `r.ok`, the class's
 * `ZonedDateTime` instants became epoch ms, and the `{ kind }` verdicts
 * became the four payload-free `identity.otp.*` codes. The edge refusals
 * the class collected at issue time (blank hash/salt, a bad id, a bad
 * stored instant) are re-targeted to the edges that now own them: issue is
 * total over inputs already through `ParsedIdentifier.parse`,
 * `AuthStrategy.parse` and the `OtpCrypto` port.
 *
 * Also copied: the OTP math of apps/functions/src/use-cases/
 * verify-otp.use-case.spec.ts (a wrong code persists the attempt, lock-out
 * after maxAttempts even with the right code, expiry, re-use) and of
 * request-otp.use-case.spec.ts (the resend throttle, the channel check,
 * the deployment's own ttl/maxAttempts).
 */

/** 2026-01-01T00:00:00.000Z */
const T0 = 1_767_225_600_000;
const MINUTE = 60_000;
const at = (minutes: number, seconds = 0): number =>
  T0 + minutes * MINUTE + seconds * 1_000;

function challenge(overrides: Partial<OtpChallenge> = {}): OtpChallenge {
  return {
    tenantId: TenantId.of('creativo'),
    destination: Identifier.of('client@example.com'),
    destinationType: OtpDestinationType.Email,
    purpose: OtpPurpose.Login,
    ttlMinutes: 5,
    maxAttempts: 5,
    ...overrides,
  };
}

const HASHED = { codeHash: 'hash(123456,fixed-salt)', salt: 'fixed-salt' };

function issued(nowMs = T0, overrides: Partial<OtpChallenge> = {}): OtpEntity {
  return OtpSystem.issue(challenge(overrides), HASHED, nowMs, () => 'otp_1');
}

/** A stored body read back — the entity itself, no reconstitute step. */
function stored(overrides: Partial<OtpEntity> = {}): OtpEntity {
  return {
    id: OtpId.of('otp_1'),
    tenantId: TenantId.of('creativo'),
    destination: Identifier.of('client@example.com'),
    destinationType: OtpDestinationType.Email,
    purpose: OtpPurpose.Login,
    codeHash: 'stored-hash',
    salt: 'stored-salt',
    expiresAtMs: at(5),
    attemptCount: 2,
    maxAttempts: 5,
    consumedAtMs: null,
    createdAtMs: T0,
    ...overrides,
  };
}

const readEmailOnly = () => null;

function strategy(
  kind: AuthStrategyKind,
  policy = { ttlMinutes: 5, maxAttempts: 5, sessionDays: 30 },
): AuthStrategy {
  return unwrapOk(
    AuthStrategy.parse({
      kind,
      required: [
        RegistrationField.Phone,
        RegistrationField.FirstName,
        RegistrationField.LastName,
      ],
      policy,
    }),
  );
}

describe('OtpSystem.issue (otp.spec.ts › Otp.issue)', () => {
  it('builds an Otp from the already-hashed code, never touching a raw code itself', () => {
    const otp = issued();
    expect(otp.codeHash).toBe('hash(123456,fixed-salt)');
    expect(otp.salt).toBe('fixed-salt');
    expect(otp.destinationType).toBe(OtpDestinationType.Email);
    expect(otp.attemptCount).toBe(0);
    expect(otp.consumedAtMs).toBeNull();
    expect(otp.createdAtMs).toBe(T0);
    expect(otp.id).toBe('otp_1');
  });

  it('computes expiresAt as now + ttlMinutes', () => {
    expect(issued().expiresAtMs).toBe(at(5));
  });

  it('rejects an invalid identifier — the destination brand is reachable only through ParsedIdentifier.parse', () => {
    const refused = unwrapErr(
      ParsedIdentifier.parse(
        IdentifierKind.Email,
        'not-an-email',
        readEmailOnly,
      ),
    );
    expect(refused.code).toBe(IdentityErrorCode.IdentifierInvalid);
  });

  it('rejects an empty codeHash — issue stores the OtpCrypto port hash verbatim and never trims or invents one', () => {
    const otp = OtpSystem.issue(
      challenge(),
      { codeHash: 'h', salt: 's' },
      T0,
      () => 'otp_1',
    );
    expect(otp.codeHash).toBe('h');
  });

  it('rejects an empty salt — the salt is the port draw, stored as handed over', () => {
    const otp = OtpSystem.issue(
      challenge(),
      { codeHash: 'h', salt: 'salt-2' },
      T0,
      () => 'otp_1',
    );
    expect(otp.salt).toBe('salt-2');
  });

  it('rejects a non-positive maxAttempts — AuthStrategy.parse, the only source of the figure, refuses it', () => {
    const errors = unwrapErr(
      AuthStrategy.parse({
        kind: AuthStrategyKind.EmailOtp,
        required: [RegistrationField.Phone],
        policy: { ttlMinutes: 5, maxAttempts: 0, sessionDays: 30 },
      }),
    );
    expect(errors).toEqual([
      {
        code: IdentityErrorCode.AuthStrategyInvalidPolicy,
        field: 'maxAttempts',
      },
    ]);
  });

  it('collects every field error at once — each edge reports all of its refusals together', () => {
    const errors = unwrapErr(
      AuthStrategy.parse({
        kind: AuthStrategyKind.EmailOtp,
        required: ['middleName'],
        policy: { ttlMinutes: 0, maxAttempts: 0, sessionDays: 0 },
      }),
    );
    expect(errors.length).toBe(4);
  });
});

describe('OtpSystem.verify (otp.spec.ts › Otp.verify)', () => {
  it('succeeds when codeMatches is true and marks the OTP consumed', () => {
    const otp = issued();
    const verifiedAt = at(1);
    const result = OtpSystem.verify(otp, true, verifiedAt);
    expect(result.ok).toBe(true);
    expect(unwrapOk(result).consumedAtMs).toBe(verifiedAt);
  });

  it('fails with wrong_code when codeMatches is false, without mutating attemptCount itself', () => {
    const otp = issued();
    const result = OtpSystem.verify(otp, false, at(1));
    expect(result.ok).toBe(false);
    expect(unwrapErr(result)).toEqual({ code: IdentityErrorCode.OtpWrongCode });
    expect(otp.attemptCount).toBe(0);
  });

  it('recordFailedAttempt() increments attemptCount on a new instance', () => {
    const otp = issued();
    const updated = OtpSystem.recordAttempt(otp);
    expect(updated.attemptCount).toBe(1);
    expect(otp.attemptCount).toBe(0);
  });

  it('fails with expired once past expiresAt', () => {
    const result = OtpSystem.verify(issued(), true, at(10));
    expect(result.ok).toBe(false);
    expect(unwrapErr(result)).toEqual({ code: IdentityErrorCode.OtpExpired });
  });

  it('fails with locked_out once attemptCount reaches maxAttempts', () => {
    let otp = issued();
    for (let i = 0; i < 5; i++) otp = OtpSystem.recordAttempt(otp);
    const result = OtpSystem.verify(otp, true, at(1));
    expect(result.ok).toBe(false);
    expect(unwrapErr(result)).toEqual({ code: IdentityErrorCode.OtpLockedOut });
  });

  it('fails with already_consumed on a second verify', () => {
    const first = unwrapOk(OtpSystem.verify(issued(), true, at(1)));
    const second = OtpSystem.verify(first, true, at(2));
    expect(second.ok).toBe(false);
    expect(unwrapErr(second)).toEqual({
      code: IdentityErrorCode.OtpAlreadyConsumed,
    });
  });

  it('still verifies at the expiry instant itself — expired is strictly past it', () => {
    expect(OtpSystem.verify(issued(), true, at(5)).ok).toBe(true);
    expect(OtpSystem.verify(issued(), true, at(5) + 1).ok).toBe(false);
  });

  it('an error value never carries entity state', () => {
    const error = unwrapErr(OtpSystem.verify(issued(), false, at(1)));
    expect(Object.keys(error)).toEqual(['code']);
  });
});

describe('OtpSystem over a stored body (otp.spec.ts › Otp.reconstitute)', () => {
  it('rebuilds an Otp from persisted primitives — the stored body IS the entity', () => {
    const otp = stored();
    expect(otp.attemptCount).toBe(2);
    expect(otp.consumedAtMs).toBeNull();
    expect(otp.codeHash).toBe('stored-hash');
    expect(otp.destinationType).toBe(OtpDestinationType.Email);
    expect(OtpSystem.recordAttempt(otp).attemptCount).toBe(3);
  });

  it('rebuilds a consumed Otp correctly — a stored consumedAtMs refuses re-use', () => {
    const otp = stored({ attemptCount: 1, consumedAtMs: at(1) });
    expect(otp.consumedAtMs).not.toBeNull();
    expect(unwrapErr(OtpSystem.verify(otp, true, at(2))).code).toBe(
      IdentityErrorCode.OtpAlreadyConsumed,
    );
  });

  it('rejects an invalid persisted id — the id is the nextId draw, carried verbatim', () => {
    const otp = OtpSystem.issue(challenge(), HASHED, T0, sequentialIds('otp'));
    expect(otp.id).toBe('otp-1');
  });

  it('rejects an invalid persisted consumedAtIso — instants are epoch ms, null while open', () => {
    const open = stored();
    expect(OtpSystem.verify(open, true, at(1)).ok).toBe(true);
  });
});

describe('OtpSystem.attempt (verify-otp.use-case.spec.ts)', () => {
  it('rejects an incorrect code and increments attemptCount on the stored OTP', () => {
    const decision = OtpSystem.attempt(issued(), false, T0);
    expect(unwrapErr(decision.result).code).toBe(
      IdentityErrorCode.OtpWrongCode,
    );
    expect(decision.write?.attemptCount).toBe(1);
  });

  it('locks out after maxAttempts incorrect tries, even with the correct code', () => {
    let otp = issued();
    for (let i = 0; i < 5; i++) {
      const decision = OtpSystem.attempt(otp, false, T0);
      otp = decision.write ?? otp;
    }
    const final = OtpSystem.attempt(otp, true, T0);
    expect(unwrapErr(final.result).code).toBe(IdentityErrorCode.OtpLockedOut);
    expect(final.write).toBeNull();
  });

  it('rejects an expired OTP', () => {
    const decision = OtpSystem.attempt(issued(), true, at(10));
    expect(unwrapErr(decision.result).code).toBe(IdentityErrorCode.OtpExpired);
    expect(decision.write).toBeNull();
  });

  it('rejects reusing an already-consumed OTP', () => {
    const first = OtpSystem.attempt(issued(), true, T0);
    expect(first.write?.consumedAtMs).toBe(T0);
    const second = OtpSystem.attempt(first.write as OtpEntity, true, T0);
    expect(unwrapErr(second.result).code).toBe(
      IdentityErrorCode.OtpAlreadyConsumed,
    );
    expect(second.write).toBeNull();
  });
});

describe('OtpSystem throttle and channel (request-otp.use-case.spec.ts)', () => {
  it('rate-limits a second request for the same destination within the window', () => {
    const first = issued(T0);
    expect(OtpSystem.mayIssue([first], at(0, 30))).toBe(false);
  });

  it('allows a new request once the rate-limit window has passed', () => {
    const first = issued(T0);
    expect(OtpSystem.mayIssue([first], at(2))).toBe(true);
  });

  it('throttles inclusively at the window edge, and never on a consumed challenge', () => {
    expect(
      OtpSystem.mayIssue([issued(T0)], at(OtpLimits.ResendWindowMinutes)),
    ).toBe(false);
    expect(OtpSystem.mayIssue([stored({ consumedAtMs: T0 })], at(0, 30))).toBe(
      true,
    );
    expect(OtpSystem.resendWindowStartMs(at(1))).toBe(T0);
  });

  it('rejects an email request under a phone_otp deployment (channel mismatch)', () => {
    expect(
      OtpSystem.channelAccepts(
        strategy(AuthStrategyKind.PhoneOtp),
        OtpDestinationType.Email,
      ),
    ).toBe(false);
  });

  it('rejects an sms request under an email_otp deployment (channel mismatch)', () => {
    const emailOtp = strategy(AuthStrategyKind.EmailOtp);
    expect(OtpSystem.channelAccepts(emailOtp, OtpDestinationType.Sms)).toBe(
      false,
    );
    expect(OtpSystem.channelAccepts(emailOtp, OtpDestinationType.Email)).toBe(
      true,
    );
    expect(
      OtpSystem.channelAccepts(
        strategy(AuthStrategyKind.PhoneOtp),
        OtpDestinationType.Sms,
      ),
    ).toBe(true);
  });

  it('issues no code challenge at all under a magic-link deployment', () => {
    const link = unwrapOk(
      AuthStrategy.parse({
        kind: AuthStrategyKind.EmailLink,
        required: [RegistrationField.Phone],
        policy: { ttlMinutes: 15, sessionDays: 30 },
      }),
    );
    expect(OtpSystem.channelAccepts(link, OtpDestinationType.Email)).toBe(
      false,
    );
  });

  it("issues the OTP with the deployment strategy's own ttl/maxAttempts, not local constants", () => {
    const otp = issued(T0, { ttlMinutes: 7, maxAttempts: 2 });
    expect(otp.maxAttempts).toBe(2);
    expect(otp.expiresAtMs).toBe(at(7));
  });
});

describe('OtpSystem properties', () => {
  const anyOtp = fc
    .record({
      attemptCount: fc.integer({ min: 0, max: 8 }),
      maxAttempts: fc.integer({ min: 1, max: 8 }),
      consumed: fc.boolean(),
      ttl: fc.integer({ min: 1, max: 30 }),
    })
    .map(({ attemptCount, maxAttempts, consumed, ttl }) =>
      stored({
        attemptCount,
        maxAttempts,
        consumedAtMs: consumed ? T0 : null,
        expiresAtMs: at(ttl),
      }),
    );

  it('verify succeeds exactly when open, unexpired, unlocked and matching — and then only consumes', () => {
    fc.assert(
      fc.property(
        anyOtp,
        fc.boolean(),
        fc.integer({ min: 0, max: 40 * MINUTE }),
        (otp, codeMatches, offset) => {
          const nowMs = T0 + offset;
          const result = OtpSystem.verify(otp, codeMatches, nowMs);
          const open =
            otp.consumedAtMs === null &&
            nowMs <= otp.expiresAtMs &&
            otp.attemptCount < otp.maxAttempts &&
            codeMatches;
          expect(result.ok).toBe(open);
          if (result.ok)
            expect(result.value).toEqual({ ...otp, consumedAtMs: nowMs });
        },
      ),
    );
  });

  it('mayIssue equals the brute-force "no open challenge inside the window"', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            created: fc.integer({ min: -3 * MINUTE, max: 0 }),
            consumed: fc.boolean(),
          }),
          { maxLength: 6 },
        ),
        (rows) => {
          const nowMs = T0;
          const open = rows.map((row) =>
            stored({
              createdAtMs: nowMs + row.created,
              consumedAtMs: row.consumed ? nowMs : null,
            }),
          );
          const brute = !open.some(
            (otp) =>
              otp.consumedAtMs === null &&
              otp.createdAtMs >= nowMs - OtpLimits.ResendWindowMinutes * MINUTE,
          );
          expect(OtpSystem.mayIssue(open, nowMs)).toBe(brute);
        },
      ),
    );
  });
});

describe('OtpSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const otp = deepFreeze(stored());
    const request = deepFreeze(challenge());
    const code = deepFreeze({ ...HASHED });
    const open = deepFreeze([stored({ createdAtMs: T0 })]);
    const run = () => ({
      issued: OtpSystem.issue(request, code, T0, () => 'otp_9'),
      verified: OtpSystem.verify(otp, true, at(1)),
      wrong: OtpSystem.attempt(otp, false, at(1)),
      recorded: OtpSystem.recordAttempt(otp),
      mayIssue: OtpSystem.mayIssue(open, at(0, 30)),
    });
    const once = run();
    const twice = run();
    expect(twice).toEqual(once);
    expect(otp).toEqual(stored());
  });
});
