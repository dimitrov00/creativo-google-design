import {
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { OtpId, TenantId } from './ids';
import {
  EmptyDestinationError,
  InvalidMaxAttemptsError,
  IssueOtpError,
  OtpVerificationError,
} from './otp.errors';

export type OtpDestinationType = 'email' | 'sms';
export type OtpPurpose = 'login' | 'signup';

/**
 * `Otp`'s own crypto seam — kept local (not imported from a `ports/`
 * folder) now that the real port duplicates have moved to
 * `@creativo/application/identity`; structurally identical to that
 * package's `OtpCodeGenerator`/`OtpCodeHasher`, so any implementation of
 * those also satisfies these.
 */
export interface OtpCodeGenerator {
  generateCode(): string;
  generateSalt(): string;
}

export interface OtpCodeHasher {
  hash(code: string, salt: string): string;
  /** Must be constant-time — never `hash(...) === expectedHash`. */
  verify(code: string, salt: string, expectedHash: string): boolean;
}

/** UTC throughout — these are internal system instants, not user-facing local wall-clock times. */
const OTP_ZONE = 'UTC';

export interface IssueOtpProps {
  id: string;
  tenantId: string;
  destination: string;
  destinationType: OtpDestinationType;
  purpose: OtpPurpose;
  maxAttempts: number;
  ttlMinutes: number;
}

export interface ReconstituteOtpProps {
  id: string;
  tenantId: string;
  destination: string;
  destinationType: OtpDestinationType;
  purpose: OtpPurpose;
  codeHash: string;
  salt: string;
  expiresAtIso: string;
  attemptCount: number;
  maxAttempts: number;
  consumedAtIso: string | null;
  createdAtIso: string;
}

export class Otp {
  private constructor(
    readonly id: OtpId,
    readonly tenantId: TenantId,
    readonly destination: string,
    readonly destinationType: OtpDestinationType,
    readonly purpose: OtpPurpose,
    readonly codeHash: string,
    readonly salt: string,
    readonly expiresAt: ZonedDateTime,
    readonly attemptCount: number,
    readonly maxAttempts: number,
    readonly consumedAt: ZonedDateTime | null,
    readonly createdAt: ZonedDateTime,
  ) {}

  /** Generates a fresh code/salt via the injected ports, hashes it, and returns both the entity (to persist) and the raw code (to send — never persisted, never returned past this call). */
  static issue(
    props: IssueOtpProps,
    generator: OtpCodeGenerator,
    hasher: OtpCodeHasher,
    now: ZonedDateTime,
  ): Result<{ otp: Otp; rawCode: string }, IssueOtpError[]> {
    const idResult = OtpId.create(props.id);
    const tenantIdResult = TenantId.create(props.tenantId);
    const destinationResult = Otp.validateDestination(props.destination);
    const maxAttemptsResult = Otp.validateMaxAttempts(props.maxAttempts);
    const expiresAtResult = ZonedDateTime.fromISO(
      now.plusMinutes(props.ttlMinutes).toISO(),
      OTP_ZONE,
    );

    const combined = combineAll([
      idResult,
      tenantIdResult,
      destinationResult,
      maxAttemptsResult,
      expiresAtResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, tenantId, destination, maxAttempts, expiresAt] = combined.value;

    const code = generator.generateCode();
    const salt = generator.generateSalt();
    const codeHash = hasher.hash(code, salt);

    const otp = new Otp(
      id,
      tenantId,
      destination,
      props.destinationType,
      props.purpose,
      codeHash,
      salt,
      expiresAt,
      0,
      maxAttempts,
      null,
      now,
    );
    return ok({ otp, rawCode: code });
  }

  static reconstitute(
    props: ReconstituteOtpProps,
  ): Result<Otp, IssueOtpError[]> {
    const idResult = OtpId.create(props.id);
    const tenantIdResult = TenantId.create(props.tenantId);
    const destinationResult = Otp.validateDestination(props.destination);
    const maxAttemptsResult = Otp.validateMaxAttempts(props.maxAttempts);
    const expiresAtResult = ZonedDateTime.fromISO(props.expiresAtIso, OTP_ZONE);
    const createdAtResult = ZonedDateTime.fromISO(props.createdAtIso, OTP_ZONE);

    const combined = combineAll([
      idResult,
      tenantIdResult,
      destinationResult,
      maxAttemptsResult,
      expiresAtResult,
      createdAtResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, tenantId, destination, maxAttempts, expiresAt, createdAt] =
      combined.value;

    let consumedAt: ZonedDateTime | null = null;
    if (props.consumedAtIso) {
      const consumedAtResult = ZonedDateTime.fromISO(
        props.consumedAtIso,
        OTP_ZONE,
      );
      if (consumedAtResult.isFailure()) {
        return fail([consumedAtResult.error]);
      }
      consumedAt = consumedAtResult.value;
    }

    return ok(
      new Otp(
        id,
        tenantId,
        destination,
        props.destinationType,
        props.purpose,
        props.codeHash,
        props.salt,
        expiresAt,
        props.attemptCount,
        maxAttempts,
        consumedAt,
        createdAt,
      ),
    );
  }

  /** Pure check — does not mutate attemptCount on a wrong code, see `recordFailedAttempt()`. */
  verify(
    rawCode: string,
    hasher: OtpCodeHasher,
    now: ZonedDateTime,
  ): Result<Otp, OtpVerificationError> {
    if (this.consumedAt) {
      return fail({ kind: 'already_consumed' });
    }
    if (now.isAfter(this.expiresAt)) {
      return fail({ kind: 'expired' });
    }
    if (this.attemptCount >= this.maxAttempts) {
      return fail({ kind: 'locked_out' });
    }
    if (!hasher.verify(rawCode, this.salt, this.codeHash)) {
      return fail({ kind: 'wrong_code' });
    }
    return ok(this.withConsumedAt(now));
  }

  /** Explicit, separate mutation — the use-case calls this after a `verify()` failure with `kind: 'wrong_code'` so the incremented attempt count gets persisted. */
  recordFailedAttempt(): Otp {
    return this.withAttemptCount(this.attemptCount + 1);
  }

  private static validateDestination(
    raw: string,
  ): Result<string, EmptyDestinationError> {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? ok(trimmed) : fail(new EmptyDestinationError());
  }

  private static validateMaxAttempts(
    raw: number,
  ): Result<number, InvalidMaxAttemptsError> {
    return Number.isInteger(raw) && raw > 0
      ? ok(raw)
      : fail(new InvalidMaxAttemptsError(raw));
  }

  private withConsumedAt(consumedAt: ZonedDateTime): Otp {
    return new Otp(
      this.id,
      this.tenantId,
      this.destination,
      this.destinationType,
      this.purpose,
      this.codeHash,
      this.salt,
      this.expiresAt,
      this.attemptCount,
      this.maxAttempts,
      consumedAt,
      this.createdAt,
    );
  }

  private withAttemptCount(attemptCount: number): Otp {
    return new Otp(
      this.id,
      this.tenantId,
      this.destination,
      this.destinationType,
      this.purpose,
      this.codeHash,
      this.salt,
      this.expiresAt,
      attemptCount,
      this.maxAttempts,
      this.consumedAt,
      this.createdAt,
    );
  }
}
