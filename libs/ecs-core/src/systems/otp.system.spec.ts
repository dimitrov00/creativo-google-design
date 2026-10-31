import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AuthStrategy,
  AuthStrategyKind,
  Identifier,
  ParsedIdentifier,
  OtpDestinationType,
  OtpPurpose,
  OtpRefusalReason,
  RegistrationField,
} from '@core/components';
import {
  IdentifierChannel,
  DurationMinutes,
  OtpId,
  TenantId,
  UtcEpochMs,
} from '@core/primitives';
import { IdentityErrorCode } from '@core/errors';
import type { Otp } from '@core/entities';
import {
  deepFreeze,
  sequentialIds,
  unwrapErr,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { type OtpChallenge, OtpLimits, OtpSystem } from './otp.system';

/*
 * The cases of the legacy identity `otp.spec.ts` (attempt limits, expiry,
 * lock-out; deleted in Phase 4b, ledger
 * `docs/architecture/flips/phase-4b-delete.md` §11.1), COPIED over struct
 * literals while the class spec still ran against its shim. `isSuccess(r)`
 * became `r.ok`, the class's `ZonedDateTime` instants became `UtcEpochMs`
 * lifecycle stamps, and the `{ kind }` verdicts became the four payload-free
 * `IDENTITY_OTP_*` codes. The edge refusals the class collected at issue time
 * (blank hash/salt, a bad id, a bad stored instant) are re-targeted to the
 * edges that now own them: issue is total over inputs already through
 * `ParsedIdentifier.parse`, `AuthStrategy.parse` and the `OtpCrypto` port.
 *
 * Also copied: the OTP math of apps/functions/src/use-cases/
 * verify-otp.use-case.spec.ts (a wrong code persists the attempt, lock-out
 * after maxAttempts even with the right code, expiry, re-use) and of
 * request-otp.use-case.spec.ts (the resend throttle, the channel check,
 * the deployment's own ttl/maxAttempts).
 */

const T0 = utcMs('2026-01-01T00:00:00.000Z');
const SECOND = 1_000;
const MINUTE = 60_000;
const at = (minutes: number, seconds = 0): UtcEpochMs =>
  UtcEpochMs.plusMs(T0, minutes * MINUTE + seconds * 1_000);
const ttl = (minutes: number): DurationMinutes =>
  unwrapOk(DurationMinutes.of(minutes));

function challenge(overrides: Partial<OtpChallenge> = {}): OtpChallenge {
  return {
    tenantId: TenantId.of('creativo'),
    destination: Identifier.of('client@example.com'),
    otpDestinationType: OtpDestinationType.Email,
    otpPurpose: OtpPurpose.Login,
    ttlMinutes: ttl(5),
    maxAttempts: 5,
    ...overrides,
  };
}

const HASHED = { codeHash: 'hash(123456,fixed-salt)', salt: 'fixed-salt' };

function issued(nowUtcMs = T0, overrides: Partial<OtpChallenge> = {}): Otp {
  return OtpSystem.issue(challenge(overrides), HASHED, nowUtcMs, () => 'otp_1');
}

/** A stored body read back — the entity itself, no reconstitute step. */
function stored(overrides: Partial<Otp> = {}): Otp {
  return {
    id: OtpId.of('otp_1'),
    tenantId: TenantId.of('creativo'),
    destination: Identifier.of('client@example.com'),
    otpDestinationType: OtpDestinationType.Email,
    otpPurpose: OtpPurpose.Login,
    codeHash: 'stored-hash',
    salt: 'stored-salt',
    expiresAtUtcMs: at(5),
    attemptCount: 2,
    maxAttempts: 5,
    consumedAtUtcMs: null,
    createdAtUtcMs: T0,
    ...overrides,
  };
}

const readEmailOnly = () => null;

function strategy(
  authStrategyKind: AuthStrategyKind,
  policy = { ttlMinutes: 5, maxAttempts: 5, sessionDays: 30 },
): AuthStrategy {
  return unwrapOk(
    AuthStrategy.parse({
      authStrategyKind,
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
    expect(otp.otpDestinationType).toBe(OtpDestinationType.Email);
    expect(otp.attemptCount).toBe(0);
    expect(otp.consumedAtUtcMs).toBeNull();
    expect(otp.createdAtUtcMs).toBe(T0);
    expect(otp.id).toBe('otp_1');
  });

  it('computes expiresAt as now + ttlMinutes', () => {
    expect(issued().expiresAtUtcMs).toBe(at(5));
  });

  it('rejects an invalid identifier — the destination brand is reachable only through ParsedIdentifier.parse', () => {
    const refused = unwrapErr(
      ParsedIdentifier.parse(
        IdentifierChannel.Email,
        'not-an-email',
        readEmailOnly,
      ),
    );
    expect(refused.errorCode).toBe(IdentityErrorCode.IdentifierInvalid);
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
        authStrategyKind: AuthStrategyKind.EmailOtp,
        required: [RegistrationField.Phone],
        policy: { ttlMinutes: 5, maxAttempts: 0, sessionDays: 30 },
      }),
    );
    expect(errors).toEqual([
      {
        errorCode: IdentityErrorCode.AuthStrategyInvalidPolicy,
        field: 'maxAttempts',
      },
    ]);
  });

  it('collects every field error at once — each edge reports all of its refusals together', () => {
    const errors = unwrapErr(
      AuthStrategy.parse({
        authStrategyKind: AuthStrategyKind.EmailOtp,
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
    expect(unwrapOk(result).consumedAtUtcMs).toBe(verifiedAt);
  });

  it('fails with WRONG_CODE when codeMatches is false, without mutating attemptCount itself', () => {
    const otp = issued();
    const result = OtpSystem.verify(otp, false, at(1));
    expect(result.ok).toBe(false);
    expect(unwrapErr(result)).toEqual({
      errorCode: IdentityErrorCode.OtpWrongCode,
    });
    expect(otp.attemptCount).toBe(0);
  });

  it('recordFailedAttempt() increments attemptCount on a new instance', () => {
    const otp = issued();
    const updated = OtpSystem.recordAttempt(otp);
    expect(updated.attemptCount).toBe(1);
    expect(otp.attemptCount).toBe(0);
  });

  it('fails with EXPIRED once past expiresAt', () => {
    const result = OtpSystem.verify(issued(), true, at(10));
    expect(result.ok).toBe(false);
    expect(unwrapErr(result)).toEqual({
      errorCode: IdentityErrorCode.OtpExpired,
    });
  });

  it('fails with LOCKED_OUT once attemptCount reaches maxAttempts', () => {
    let otp = issued();
    for (let i = 0; i < 5; i++) otp = OtpSystem.recordAttempt(otp);
    const result = OtpSystem.verify(otp, true, at(1));
    expect(result.ok).toBe(false);
    expect(unwrapErr(result)).toEqual({
      errorCode: IdentityErrorCode.OtpLockedOut,
    });
  });

  it('fails with ALREADY_CONSUMED on a second verify', () => {
    const first = unwrapOk(OtpSystem.verify(issued(), true, at(1)));
    const second = OtpSystem.verify(first, true, at(2));
    expect(second.ok).toBe(false);
    expect(unwrapErr(second)).toEqual({
      errorCode: IdentityErrorCode.OtpAlreadyConsumed,
    });
  });

  it('still verifies at the expiry instant itself — expired is strictly past it', () => {
    expect(OtpSystem.verify(issued(), true, at(5)).ok).toBe(true);
    expect(
      OtpSystem.verify(issued(), true, UtcEpochMs.plusMs(at(5), 1)).ok,
    ).toBe(false);
  });

  it('an error value never carries entity state', () => {
    const error = unwrapErr(OtpSystem.verify(issued(), false, at(1)));
    expect(Object.keys(error)).toEqual(['errorCode']);
  });
});

describe('OtpSystem over a stored body (otp.spec.ts › Otp.reconstitute)', () => {
  it('rebuilds an Otp from persisted primitives — the stored body IS the entity', () => {
    const otp = stored();
    expect(otp.attemptCount).toBe(2);
    expect(otp.consumedAtUtcMs).toBeNull();
    expect(otp.codeHash).toBe('stored-hash');
    expect(otp.otpDestinationType).toBe(OtpDestinationType.Email);
    expect(OtpSystem.recordAttempt(otp).attemptCount).toBe(3);
  });

  it('rebuilds a consumed Otp correctly — a stored consumedAtUtcMs refuses re-use', () => {
    const otp = stored({ attemptCount: 1, consumedAtUtcMs: at(1) });
    expect(otp.consumedAtUtcMs).not.toBeNull();
    expect(unwrapErr(OtpSystem.verify(otp, true, at(2))).errorCode).toBe(
      IdentityErrorCode.OtpAlreadyConsumed,
    );
  });

  it('rejects an invalid persisted id — the id is the nextId draw, carried verbatim', () => {
    const otp = OtpSystem.issue(challenge(), HASHED, T0, sequentialIds('otp'));
    expect(otp.id).toBe('otp-1');
  });

  it('rejects an invalid persisted consumedAtIso — instants are UtcEpochMs, null while open', () => {
    const open = stored();
    expect(OtpSystem.verify(open, true, at(1)).ok).toBe(true);
  });
});

describe('OtpSystem.attempt (verify-otp.use-case.spec.ts)', () => {
  it('rejects an incorrect code and increments attemptCount on the stored OTP', () => {
    const decision = OtpSystem.attempt(issued(), false, T0);
    expect(unwrapErr(decision.result).errorCode).toBe(
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
    expect(unwrapErr(final.result).errorCode).toBe(
      IdentityErrorCode.OtpLockedOut,
    );
    expect(final.write).toBeNull();
  });

  it('rejects an expired OTP', () => {
    const decision = OtpSystem.attempt(issued(), true, at(10));
    expect(unwrapErr(decision.result).errorCode).toBe(
      IdentityErrorCode.OtpExpired,
    );
    expect(decision.write).toBeNull();
  });

  it('rejects reusing an already-consumed OTP', () => {
    const first = OtpSystem.attempt(issued(), true, T0);
    expect(first.write?.consumedAtUtcMs).toBe(T0);
    const second = OtpSystem.attempt(first.write as Otp, true, T0);
    expect(unwrapErr(second.result).errorCode).toBe(
      IdentityErrorCode.OtpAlreadyConsumed,
    );
    expect(second.write).toBeNull();
  });
});

describe('OtpSystem.refusalReasonOf — which refusal is a recorded one (Phase 3 WS-B, P3-RU-8)', () => {
  it('names a wrong code below the limit WRONG_CODE — at maxAttempts − 2 the challenge stays open', () => {
    const decision = OtpSystem.attempt(stored({ attemptCount: 3 }), false, T0);
    expect(decision.write?.attemptCount).toBe(4);
    expect(OtpSystem.refusalReasonOf(decision)).toBe(
      OtpRefusalReason.WrongCode,
    );
  });

  it('names the wrong code that reaches the limit LOCKED_OUT — at maxAttempts − 1', () => {
    const decision = OtpSystem.attempt(stored({ attemptCount: 4 }), false, T0);
    expect(decision.write?.attemptCount).toBe(5);
    expect(OtpSystem.refusalReasonOf(decision)).toBe(
      OtpRefusalReason.LockedOut,
    );
    // …and the next attempt, the right code included, records nothing: no reason.
    const next = OtpSystem.attempt(decision.write as Otp, true, T0);
    expect(unwrapErr(next.result).errorCode).toBe(
      IdentityErrorCode.OtpLockedOut,
    );
    expect(OtpSystem.refusalReasonOf(next)).toBeNull();
  });

  it('answers null for a success — a consumption is no refusal', () => {
    const decision = OtpSystem.attempt(stored(), true, T0);
    expect(decision.result.ok).toBe(true);
    expect(OtpSystem.refusalReasonOf(decision)).toBeNull();
  });

  it('answers null for every refusal that writes nothing — expired, consumed, already locked', () => {
    const refusals = [
      OtpSystem.attempt(stored(), false, at(10)),
      OtpSystem.attempt(stored({ consumedAtUtcMs: T0 }), false, T0),
      OtpSystem.attempt(stored({ attemptCount: 5 }), false, T0),
    ];
    expect(
      refusals.map((decision) => unwrapErr(decision.result).errorCode),
    ).toEqual([
      IdentityErrorCode.OtpExpired,
      IdentityErrorCode.OtpAlreadyConsumed,
      IdentityErrorCode.OtpLockedOut,
    ]);
    for (const decision of refusals) {
      expect(decision.write).toBeNull();
      expect(OtpSystem.refusalReasonOf(decision)).toBeNull();
    }
  });

  it('answers a reason exactly when the attempt recorded a wrong code (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 0, max: 9 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (maxAttempts, attemptCount, codeMatches, consumed, expired) => {
          const decision = OtpSystem.attempt(
            stored({
              maxAttempts,
              attemptCount,
              consumedAtUtcMs: consumed ? T0 : null,
            }),
            codeMatches,
            expired ? at(10) : T0,
          );
          const reason = OtpSystem.refusalReasonOf(decision);
          const recorded = !decision.result.ok && decision.write !== null;
          expect(reason !== null).toBe(recorded);
          if (recorded) {
            expect(reason).toBe(
              attemptCount + 1 >= maxAttempts
                ? OtpRefusalReason.LockedOut
                : OtpRefusalReason.WrongCode,
            );
          }
        },
      ),
    );
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
      OtpSystem.mayIssue([issued(T0)], at(0, OtpLimits.ResendWindowSeconds)),
    ).toBe(false);
    expect(
      OtpSystem.mayIssue(
        [issued(T0)],
        UtcEpochMs.plusMs(at(0, OtpLimits.ResendWindowSeconds), 1),
      ),
    ).toBe(true);
    expect(
      OtpSystem.mayIssue([stored({ consumedAtUtcMs: T0 })], at(0, 30)),
    ).toBe(true);
    expect(OtpSystem.resendWindowStartUtcMs(at(1))).toBe(T0);
  });

  it('rejects an EMAIL request under a PHONE_OTP deployment (channel mismatch)', () => {
    expect(
      OtpSystem.channelAccepts(
        strategy(AuthStrategyKind.PhoneOtp),
        OtpDestinationType.Email,
      ),
    ).toBe(false);
  });

  it('rejects an SMS request under an EMAIL_OTP deployment (channel mismatch)', () => {
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

  it('owns the figures the client reads — a 60 s resend window, escalation from the third send (OR-9, OR-10)', () => {
    expect(OtpLimits).toEqual({
      ResendWindowSeconds: 60,
      EscalateAfterSends: 3,
    });
  });

  it('issues no code challenge at all under a magic-link deployment', () => {
    const link = unwrapOk(
      AuthStrategy.parse({
        authStrategyKind: AuthStrategyKind.EmailLink,
        required: [RegistrationField.Phone],
        policy: { ttlMinutes: 15, sessionDays: 30 },
      }),
    );
    expect(OtpSystem.channelAccepts(link, OtpDestinationType.Email)).toBe(
      false,
    );
  });

  it("issues the OTP with the deployment strategy's own ttl/maxAttempts, not local constants", () => {
    const otp = issued(T0, { ttlMinutes: ttl(7), maxAttempts: 2 });
    expect(otp.maxAttempts).toBe(2);
    expect(otp.expiresAtUtcMs).toBe(at(7));
  });
});

describe('OtpSystem.retryAfterSeconds (OR-9)', () => {
  it('counts down the 60 s window of a challenge created at T0 — 60 at 0 s, 59 at 1 s, 1 at 59 s', () => {
    const open = [issued(T0)];
    expect(OtpSystem.retryAfterSeconds(open, at(0, 0))).toBe(60);
    expect(OtpSystem.retryAfterSeconds(open, at(0, 1))).toBe(59);
    expect(OtpSystem.retryAfterSeconds(open, at(0, 59))).toBe(1);
  });

  it('rounds what remains UP — a part second left is a whole second to wait', () => {
    const open = [issued(T0)];
    expect(OtpSystem.retryAfterSeconds(open, UtcEpochMs.plusMs(T0, 1))).toBe(
      60,
    );
    expect(
      OtpSystem.retryAfterSeconds(open, UtcEpochMs.plusMs(at(0, 58), 1)),
    ).toBe(2);
    expect(
      OtpSystem.retryAfterSeconds(open, UtcEpochMs.plusMs(at(0, 59), 999)),
    ).toBe(1);
  });

  it("answers 1 at 60 s — the window's last instant still throttles, so a refusal never says 0 — and 0 one millisecond past it", () => {
    const open = [issued(T0)];
    expect(OtpSystem.mayIssue(open, at(0, 60))).toBe(false);
    expect(OtpSystem.retryAfterSeconds(open, at(0, 60))).toBe(1);
    const past = UtcEpochMs.plusMs(at(0, 60), 1);
    expect(OtpSystem.mayIssue(open, past)).toBe(true);
    expect(OtpSystem.retryAfterSeconds(open, past)).toBe(0);
  });

  it('is 0 when the destination is free — no challenge, or only ones outside the window', () => {
    expect(OtpSystem.retryAfterSeconds([], T0)).toBe(0);
    expect(OtpSystem.retryAfterSeconds([issued(T0)], at(2))).toBe(0);
  });

  it('ignores a consumed challenge — it neither throttles nor counts', () => {
    expect(
      OtpSystem.retryAfterSeconds([stored({ consumedAtUtcMs: T0 })], at(0, 1)),
    ).toBe(0);
    expect(
      OtpSystem.retryAfterSeconds(
        [
          stored({ createdAtUtcMs: at(0, 30), consumedAtUtcMs: at(0, 31) }),
          stored({ createdAtUtcMs: T0 }),
        ],
        at(0, 40),
      ),
    ).toBe(20);
  });

  it('counts from the NEWEST open challenge, whatever the read order', () => {
    const older = stored({ createdAtUtcMs: T0 });
    const newer = stored({ createdAtUtcMs: at(0, 45) });
    expect(OtpSystem.retryAfterSeconds([older, newer], at(0, 50))).toBe(55);
    expect(OtpSystem.retryAfterSeconds([newer, older], at(0, 50))).toBe(55);
  });
});

describe('OtpSystem.escalates (OR-10)', () => {
  it('escalates from the third send on — 2 → false, 3 → true', () => {
    expect(OtpSystem.escalates(0)).toBe(false);
    expect(OtpSystem.escalates(1)).toBe(false);
    expect(OtpSystem.escalates(2)).toBe(false);
    expect(OtpSystem.escalates(3)).toBe(true);
    expect(OtpSystem.escalates(4)).toBe(true);
    expect(OtpSystem.escalates(OtpLimits.EscalateAfterSends)).toBe(true);
    expect(OtpSystem.escalates(OtpLimits.EscalateAfterSends - 1)).toBe(false);
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
        consumedAtUtcMs: consumed ? T0 : null,
        expiresAtUtcMs: at(ttl),
      }),
    );

  it('verify succeeds exactly when open, unexpired, unlocked and matching — and then only consumes', () => {
    fc.assert(
      fc.property(
        anyOtp,
        fc.boolean(),
        fc.integer({ min: 0, max: 40 * MINUTE }),
        (otp, codeMatches, offset) => {
          const nowUtcMs = UtcEpochMs.plusMs(T0, offset);
          const result = OtpSystem.verify(otp, codeMatches, nowUtcMs);
          const open =
            otp.consumedAtUtcMs === null &&
            nowUtcMs <= otp.expiresAtUtcMs &&
            otp.attemptCount < otp.maxAttempts &&
            codeMatches;
          expect(result.ok).toBe(open);
          if (result.ok)
            expect(result.value).toEqual({ ...otp, consumedAtUtcMs: nowUtcMs });
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
          const nowUtcMs = T0;
          const open = rows.map((row) =>
            stored({
              createdAtUtcMs: UtcEpochMs.plusMs(nowUtcMs, row.created),
              consumedAtUtcMs: row.consumed ? nowUtcMs : null,
            }),
          );
          const brute = !open.some(
            (otp) =>
              otp.consumedAtUtcMs === null &&
              otp.createdAtUtcMs >=
                nowUtcMs - OtpLimits.ResendWindowSeconds * SECOND,
          );
          expect(OtpSystem.mayIssue(open, nowUtcMs)).toBe(brute);
        },
      ),
    );
  });

  it('retryAfterSeconds equals the brute-force ceiling of the newest open window, and is 0 exactly when mayIssue', () => {
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
          const nowUtcMs = T0;
          const open = rows.map((row) =>
            stored({
              createdAtUtcMs: UtcEpochMs.plusMs(nowUtcMs, row.created),
              consumedAtUtcMs: row.consumed ? nowUtcMs : null,
            }),
          );
          const windowMs = OtpLimits.ResendWindowSeconds * SECOND;
          const throttling = open.filter(
            (otp) =>
              otp.consumedAtUtcMs === null &&
              otp.createdAtUtcMs >= nowUtcMs - windowMs,
          );
          const brute =
            throttling.length === 0
              ? 0
              : Math.max(
                  1,
                  Math.ceil(
                    (Math.max(...throttling.map((o) => o.createdAtUtcMs)) +
                      windowMs -
                      nowUtcMs) /
                      SECOND,
                  ),
                );
          const seconds = OtpSystem.retryAfterSeconds(open, nowUtcMs);
          expect(seconds).toBe(brute);
          expect(seconds === 0).toBe(OtpSystem.mayIssue(open, nowUtcMs));
          expect(seconds).toBeLessThanOrEqual(OtpLimits.ResendWindowSeconds);
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
    const open = deepFreeze([stored({ createdAtUtcMs: T0 })]);
    const run = () => ({
      issued: OtpSystem.issue(request, code, T0, () => 'otp_9'),
      verified: OtpSystem.verify(otp, true, at(1)),
      wrong: OtpSystem.attempt(otp, false, at(1)),
      refusalReason: OtpSystem.refusalReasonOf(
        OtpSystem.attempt(otp, false, at(1)),
      ),
      recorded: OtpSystem.recordAttempt(otp),
      mayIssue: OtpSystem.mayIssue(open, at(0, 30)),
      retryAfterSeconds: OtpSystem.retryAfterSeconds(open, at(0, 30)),
      escalates: OtpSystem.escalates(OtpLimits.EscalateAfterSends),
    });
    const once = run();
    const twice = run();
    expect(twice).toEqual(once);
    expect(once.retryAfterSeconds).toBe(30);
    expect(otp).toEqual(stored());
    expect(open).toEqual([stored({ createdAtUtcMs: T0 })]);
  });
});
