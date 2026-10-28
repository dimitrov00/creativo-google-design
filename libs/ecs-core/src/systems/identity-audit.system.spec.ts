import { describe, expect, it } from 'vitest';
import {
  Actor,
  AuditAction,
  Identifier,
  OtpDestinationType,
  OtpPurpose,
  OtpRefusalReason,
  Role,
  SessionKind,
  SystemSource,
} from '@core/components';
import {
  AuditEntryId,
  IdentifierChannel,
  OperationId,
  OtpId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { Collections, type Otp } from '@core/entities';
import {
  FIXTURE_NOW_UTC_MS,
  deepFreeze,
  fixtureHash,
  otpFixture,
  auditResource,
} from '@core/testing';
import { AuditSystem } from './audit.system';
import { IdentityAuditSystem } from './identity-audit.system';
import { OtpSystem } from './otp.system';

/*
 * The sign-in rows (audit-hardening Phase 3 WS-B, P3-DEP-7): each planner's
 * exact row, its id basis, the replay rule (a retried act derives the same
 * id, every other act another), and the PII scan — every PII-bearing input
 * carries a SENTINEL value, and the serialised row is searched for it.
 */

const SENTINEL_PHONE = '+359880000777';
const SENTINEL_EMAIL = 'sentinel@example.invalid';
const SENTINEL_HASH = 'sentinel-code-hash-417';
const SENTINEL_SALT = 'sentinel-salt-417';
const SENTINELS = [
  SENTINEL_PHONE,
  SENTINEL_EMAIL,
  SENTINEL_HASH,
  SENTINEL_SALT,
] as const;

const OP = OperationId.of('op-0123456789abcdef');
const UID = UserId.of('u-maria');
const LATER = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 90_000);

/** An open SMS login challenge whose destination, hash and salt are sentinels. */
function challenge(overrides: Partial<Otp> = {}): Otp {
  return otpFixture({
    id: OtpId.of('otp-7'),
    destination: Identifier.of(SENTINEL_PHONE),
    codeHash: SENTINEL_HASH,
    salt: SENTINEL_SALT,
    ...overrides,
  });
}

/** No sentinel, and none of the challenge's secret-bearing keys, in a row. */
function expectNoPii(row: object): void {
  const json = JSON.stringify(row);
  for (const sentinel of SENTINELS) expect(json).not.toContain(sentinel);
  const keys = Object.keys(row);
  for (const key of ['destination', 'codeHash', 'salt', 'code']) {
    expect(keys).not.toContain(key);
  }
}

const SYSTEM_ACTOR = {
  actorRole: 'SYSTEM',
  actorSystemSource: 'IDENTITY_CALLABLE',
} as const;

describe('IdentityAuditSystem.ACTOR — the sign-in callables act as a named process (P3-RU-10)', () => {
  it('is SYSTEM / IDENTITY_CALLABLE, never the unattributed-write source', () => {
    expect(IdentityAuditSystem.ACTOR).toEqual(
      Actor.system(SystemSource.IdentityCallable),
    );
    expect(IdentityAuditSystem.ACTOR.actorSystemSource).not.toBe(
      SystemSource.UnattributedUnauthenticated,
    );
  });
});

describe('IdentityAuditSystem.planOtpRequested — the challenge saved', () => {
  it('names otps/<id>, no target, no operation; stamped at the challenge’s creation', () => {
    const otp = challenge();
    const plan = IdentityAuditSystem.planOtpRequested(otp);
    expect(plan.row).toEqual({
      recordedAtUtcMs: otp.createdAtUtcMs,
      resourceId: `${Collections.Otps}/otp-7`,
      auditOperationId: null,
      ...SYSTEM_ACTOR,
      auditAction: 'IDENTITY_OTP_REQUESTED',
      otpDestinationType: 'SMS',
      otpPurpose: 'LOGIN',
      otpExpiresAtUtcMs: otp.expiresAtUtcMs,
      auditTarget: 'NONE',
    });
    expect(plan.idBasis).toBe(
      AuditSystem.rowBasis(
        'IDENTITY_OTP_REQUESTED',
        auditResource('otps/otp-7'),
        null,
        'otp-requested:otp-7',
      ),
    );
    expectNoPii(plan.row);
  });

  it('takes no operation id — a caller-chosen transport id never reaches a pre-session row (P3-L-20)', () => {
    // @ts-expect-error — a pre-session planner has no operation parameter
    const plan = IdentityAuditSystem.planOtpRequested(challenge(), OP);
    expect(plan.row.auditOperationId).toBeNull();
  });

  it('one row per challenge: the same challenge derives the same id, another challenge another', () => {
    const a = IdentityAuditSystem.planOtpRequested(challenge());
    expect(IdentityAuditSystem.planOtpRequested(challenge()).idBasis).toBe(
      a.idBasis,
    );
    expect(
      IdentityAuditSystem.planOtpRequested(challenge({ id: OtpId.of('otp-8') }))
        .idBasis,
    ).not.toBe(a.idBasis);
  });

  it('carries the e-mail channel and the signup purpose as tags — the address never', () => {
    const plan = IdentityAuditSystem.planOtpRequested(
      challenge({
        destination: Identifier.of(SENTINEL_EMAIL),
        otpDestinationType: OtpDestinationType.Email,
        otpPurpose: OtpPurpose.Signup,
      }),
    );
    expect(plan.row).toMatchObject({
      otpDestinationType: 'EMAIL',
      otpPurpose: 'SIGNUP',
    });
    expectNoPii(plan.row);
  });
});

describe('IdentityAuditSystem.planOtpVerified — the challenge consumed', () => {
  it('names otps/<id>, no target, no operation; stamped at the consumption; the wrong codes before it', () => {
    const consumed = challenge({ attemptCount: 2, consumedAtUtcMs: LATER });
    const plan = IdentityAuditSystem.planOtpVerified(consumed);
    expect(plan.row).toEqual({
      recordedAtUtcMs: LATER,
      resourceId: 'otps/otp-7',
      auditOperationId: null,
      ...SYSTEM_ACTOR,
      auditAction: 'IDENTITY_OTP_VERIFIED',
      otpDestinationType: 'SMS',
      otpPurpose: 'LOGIN',
      otpAttemptCount: 2,
      auditTarget: 'NONE',
    });
    expect(plan.idBasis).toBe(
      AuditSystem.rowBasis(
        'IDENTITY_OTP_VERIFIED',
        auditResource('otps/otp-7'),
        null,
        'otp-verified:otp-7',
      ),
    );
    expectNoPii(plan.row);
  });

  it('plans from OtpSystem.attempt’s success as it stands', () => {
    const decision = OtpSystem.attempt(challenge(), true, LATER);
    expect(decision.result.ok).toBe(true);
    const plan = IdentityAuditSystem.planOtpVerified(decision.write as Otp);
    expect(plan.row.recordedAtUtcMs).toBe(LATER);
    // A retried transaction re-derives the same row.
    expect(
      IdentityAuditSystem.planOtpVerified(decision.write as Otp).idBasis,
    ).toBe(plan.idBasis);
  });

  it('refuses an open challenge as a programmer defect, never a row', () => {
    expect(() => IdentityAuditSystem.planOtpVerified(challenge())).toThrow(
      /defect/,
    );
  });
});

describe('IdentityAuditSystem.planOtpRefused — a wrong code recorded', () => {
  const recordedAfter = (attemptCount: number): Otp =>
    challenge({ attemptCount });

  it('names otps/<id>, no target, no operation; the reason, the count after the attempt and the limit', () => {
    const plan = IdentityAuditSystem.planOtpRefused(
      recordedAfter(1),
      OtpRefusalReason.WrongCode,
      LATER,
    );
    expect(plan.row).toEqual({
      recordedAtUtcMs: LATER,
      resourceId: 'otps/otp-7',
      auditOperationId: null,
      ...SYSTEM_ACTOR,
      auditAction: 'IDENTITY_OTP_REFUSED',
      otpDestinationType: 'SMS',
      otpPurpose: 'LOGIN',
      otpRefusalReason: 'WRONG_CODE',
      otpAttemptCount: 1,
      otpMaxAttempts: 5,
      auditTarget: 'NONE',
    });
    expect(plan.idBasis).toBe(
      AuditSystem.rowBasis(
        'IDENTITY_OTP_REFUSED',
        auditResource('otps/otp-7'),
        null,
        'otp-refused:otp-7:1',
      ),
    );
    expectNoPii(plan.row);
  });

  it('attempts 1 and 2 are two rows; a retried attempt is the same row (its count was read in the same transaction)', () => {
    const first = IdentityAuditSystem.planOtpRefused(
      recordedAfter(1),
      OtpRefusalReason.WrongCode,
      LATER,
    );
    const second = IdentityAuditSystem.planOtpRefused(
      recordedAfter(2),
      OtpRefusalReason.WrongCode,
      LATER,
    );
    const replay = IdentityAuditSystem.planOtpRefused(
      recordedAfter(1),
      OtpRefusalReason.WrongCode,
      UtcEpochMs.plusMs(LATER, 5_000),
    );
    expect(second.idBasis).not.toBe(first.idBasis);
    expect(replay.idBasis).toBe(first.idBasis);
    expect(fixtureHash(replay.idBasis)).toBe(fixtureHash(first.idBasis));
  });

  it('plans from OtpSystem.attempt’s recorded write and refusalReasonOf — the attempt that locks the challenge is LOCKED_OUT', () => {
    const decision = OtpSystem.attempt(recordedAfter(4), false, LATER);
    const reason = OtpSystem.refusalReasonOf(decision);
    expect(reason).toBe(OtpRefusalReason.LockedOut);
    const plan = IdentityAuditSystem.planOtpRefused(
      decision.write as Otp,
      reason as OtpRefusalReason,
      LATER,
    );
    expect(plan.row).toMatchObject({
      otpRefusalReason: 'LOCKED_OUT',
      otpAttemptCount: 5,
      otpMaxAttempts: 5,
    });
    expect(plan.idBasis).toContain('otp-refused:otp-7:5');
  });
});

describe('IdentityAuditSystem.planSessionIssued — the token answered', () => {
  it('names the account users/<uid> as resource and target, the operation, the session kind and channel', () => {
    const plan = IdentityAuditSystem.planSessionIssued(
      challenge({ consumedAtUtcMs: LATER }),
      UID,
      SessionKind.Returning,
      OP,
      LATER,
    );
    expect(plan.row).toEqual({
      recordedAtUtcMs: LATER,
      resourceId: 'users/u-maria',
      auditOperationId: OP,
      ...SYSTEM_ACTOR,
      auditAction: 'IDENTITY_SESSION_ISSUED',
      sessionKind: 'RETURNING',
      otpDestinationType: 'SMS',
      auditTarget: 'USER',
      targetUserId: 'u-maria',
    });
    expect(plan.idBasis).toBe(
      AuditSystem.rowBasis(
        'IDENTITY_SESSION_ISSUED',
        auditResource('users/u-maria'),
        UserId.of('u-maria'),
        'session:otp-7',
      ),
    );
    expectNoPii(plan.row);
  });

  it('names no operation when the call sent none (RU-21), and a NEW person as NEW', () => {
    const plan = IdentityAuditSystem.planSessionIssued(
      challenge({ consumedAtUtcMs: LATER }),
      UID,
      SessionKind.New,
      null,
      LATER,
    );
    expect(plan.row.auditOperationId).toBeNull();
    expect(plan.row).toMatchObject({ sessionKind: 'NEW' });
  });

  it('one row per consumed challenge — another operation id is the same act', () => {
    const otp = challenge({ consumedAtUtcMs: LATER });
    const a = IdentityAuditSystem.planSessionIssued(
      otp,
      UID,
      SessionKind.New,
      OP,
      LATER,
    );
    const b = IdentityAuditSystem.planSessionIssued(
      otp,
      UID,
      SessionKind.New,
      OperationId.of('op-other-0000000000'),
      LATER,
    );
    expect(b.idBasis).toBe(a.idBasis);
    expect(
      IdentityAuditSystem.planSessionIssued(
        challenge({ id: OtpId.of('otp-8'), consumedAtUtcMs: LATER }),
        UID,
        SessionKind.New,
        OP,
        LATER,
      ).idBasis,
    ).not.toBe(a.idBasis);
  });
});

describe('IdentityAuditSystem.planRegistrationCompleted — the first registration', () => {
  it('credits the verified caller by the stored roles, on the account’s timeline, naming the operation and the channel', () => {
    const plan = IdentityAuditSystem.planRegistrationCompleted(
      UID,
      [Role.Client],
      IdentifierChannel.Phone,
      OP,
      LATER,
    );
    expect(plan.row).toEqual({
      recordedAtUtcMs: LATER,
      resourceId: 'users/u-maria',
      auditOperationId: OP,
      actorRole: 'USER',
      actorUserId: 'u-maria',
      auditAction: 'IDENTITY_REGISTRATION_COMPLETED',
      registrationIdentifierChannel: 'PHONE',
      auditTarget: 'USER',
      targetUserId: 'u-maria',
    });
    expect(plan.idBasis).toBe(
      AuditSystem.rowBasis(
        'IDENTITY_REGISTRATION_COMPLETED',
        auditResource('users/u-maria'),
        UserId.of('u-maria'),
        'registration:u-maria',
      ),
    );
  });

  it('attributes through Actor.forCaller — an admin as ADMIN, a barber as STAFF, unknown claims as nothing', () => {
    const actorOf = (roles: readonly unknown[]) =>
      IdentityAuditSystem.planRegistrationCompleted(
        UID,
        roles,
        IdentifierChannel.Email,
        null,
        LATER,
      ).row;
    expect(actorOf([Role.Admin])).toMatchObject(Actor.admin(UID));
    expect(actorOf([Role.Barber])).toMatchObject({
      actorRole: 'STAFF',
      actorRoles: ['barber'],
    });
    expect(actorOf(['root', 42])).toMatchObject(Actor.user(UID));
    expect(actorOf([]).auditOperationId).toBeNull();
  });

  it('one row per account — a second call keys the same row', () => {
    const a = IdentityAuditSystem.planRegistrationCompleted(
      UID,
      [],
      IdentifierChannel.Phone,
      OP,
      LATER,
    );
    expect(
      IdentityAuditSystem.planRegistrationCompleted(
        UID,
        [],
        IdentifierChannel.Phone,
        OperationId.of('op-other-0000000000'),
        FIXTURE_NOW_UTC_MS,
      ).idBasis,
    ).toBe(a.idBasis);
    expect(
      IdentityAuditSystem.planRegistrationCompleted(
        UserId.of('u-other'),
        [],
        IdentifierChannel.Phone,
        OP,
        LATER,
      ).idBasis,
    ).not.toBe(a.idBasis);
  });
});

describe('IdentityAuditSystem — the rows of one sign-in', () => {
  it('are five distinct rows, each a Create of auditLog/<hash(idBasis)>', () => {
    const otp = challenge();
    const consumed = challenge({ attemptCount: 1, consumedAtUtcMs: LATER });
    const plans = [
      IdentityAuditSystem.planOtpRequested(otp),
      IdentityAuditSystem.planOtpRefused(
        challenge({ attemptCount: 1 }),
        OtpRefusalReason.WrongCode,
        LATER,
      ),
      IdentityAuditSystem.planOtpVerified(consumed),
      IdentityAuditSystem.planSessionIssued(
        consumed,
        UID,
        SessionKind.New,
        OP,
        LATER,
      ),
      IdentityAuditSystem.planRegistrationCompleted(
        UID,
        [],
        IdentifierChannel.Phone,
        OP,
        LATER,
      ),
    ];
    const writes = AuditSystem.createsOf(plans, fixtureHash);
    expect(new Set(plans.map((plan) => plan.idBasis)).size).toBe(5);
    expect(writes).toEqual(
      plans.map((plan) => ({
        writeAction: 'CREATE',
        path: [
          Collections.AuditLog,
          AuditEntryId.of(fixtureHash(plan.idBasis)),
        ],
        body: plan.row,
      })),
    );
    expect(plans.map((plan) => plan.row.auditAction)).toEqual([
      AuditAction.IdentityOtpRequested,
      AuditAction.IdentityOtpRefused,
      AuditAction.IdentityOtpVerified,
      AuditAction.IdentitySessionIssued,
      AuditAction.IdentityRegistrationCompleted,
    ]);
    for (const plan of plans) expectNoPii(plan.row);
    // The serialised plan as a whole holds no sentinel either.
    const json = JSON.stringify(writes);
    for (const sentinel of SENTINELS) expect(json).not.toContain(sentinel);
  });
});

describe('IdentityAuditSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const otp = deepFreeze(challenge({ attemptCount: 2 }));
    const consumed = deepFreeze(
      challenge({ attemptCount: 2, consumedAtUtcMs: LATER }),
    );
    const roles = deepFreeze([Role.Barber, 'stranger']);
    const run = () => ({
      requested: IdentityAuditSystem.planOtpRequested(otp),
      verified: IdentityAuditSystem.planOtpVerified(consumed),
      refused: IdentityAuditSystem.planOtpRefused(
        otp,
        OtpRefusalReason.WrongCode,
        LATER,
      ),
      session: IdentityAuditSystem.planSessionIssued(
        consumed,
        UID,
        SessionKind.Returning,
        OP,
        LATER,
      ),
      registration: IdentityAuditSystem.planRegistrationCompleted(
        UID,
        roles,
        IdentifierChannel.Phone,
        OP,
        LATER,
      ),
    });
    const once = run();
    const twice = run();
    expect(twice).toEqual(once);
    expect(otp).toEqual(challenge({ attemptCount: 2 }));
    expect(roles).toEqual([Role.Barber, 'stranger']);
  });
});
