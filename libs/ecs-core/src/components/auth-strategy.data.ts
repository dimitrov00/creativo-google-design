import {
  defect,
  DurationMinutes,
  IdentifierChannel,
  Result,
} from '@core/primitives';
import { AuthPolicyField, IdentityError } from '@core/errors';
import { Registration, RegistrationField } from './registration.data';

/**
 * Strategy tags — the ONLY source of these strings (deployment config); the
 * discriminator `authStrategyKind` (N15: `AuthStrategy` is the union).
 */
export const AuthStrategyKind = {
  PhoneOtp: 'PHONE_OTP',
  EmailOtp: 'EMAIL_OTP',
  EmailLink: 'EMAIL_LINK',
} as const;
export type AuthStrategyKind =
  (typeof AuthStrategyKind)[keyof typeof AuthStrategyKind];

/**
 * Which challenge flow a deployment runs. Each variant owns the policy it
 * needs — no shared policy on a parent shape, which would let a future
 * variant carry an unused field. Every strategy's `required` set includes
 * `phone`: the shop always needs a contact channel (enforced by `parse`).
 */
export type AuthStrategy =
  AuthStrategy.PhoneOtp | AuthStrategy.EmailOtp | AuthStrategy.EmailLink;

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * A policy's TTL as the brand — for a figure already checked positive (the
 * parse's `checkPolicy`, a literal of this file), so a refusal is a defect.
 */
function ttlOf(raw: number): DurationMinutes {
  const ttl = DurationMinutes.of(raw);
  return ttl.ok ? ttl.value : defect(`${raw} is not a positive TTL`);
}

/** Collects a refusal for each policy figure that is not a positive integer. */
function checkPolicy(
  raw: { readonly [key: string]: unknown },
  fields: readonly AuthPolicyField[],
  errors: IdentityError[],
): void {
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] as AuthPolicyField;
    if (!isPositiveInt(raw[field])) {
      errors.push(IdentityError.authStrategyInvalidPolicy(field));
    }
  }
}

const OTP_POLICY_FIELDS = [
  AuthPolicyField.TtlMinutes,
  AuthPolicyField.MaxAttempts,
  AuthPolicyField.SessionDays,
] as const;
const LINK_POLICY_FIELDS = [
  AuthPolicyField.TtlMinutes,
  AuthPolicyField.SessionDays,
] as const;

/**
 * The single-tenant deployment's strategy: e-mail OTP (the adopted
 * auth-flow design), with the phone collected by the onboarding profile
 * step to satisfy the phone-required invariant. A literal of what
 * `parse` accepts (its spec holds the two equal).
 */
const DEFAULT_STRATEGY: AuthStrategy.EmailOtp = {
  authStrategyKind: AuthStrategyKind.EmailOtp,
  required: [
    RegistrationField.Phone,
    RegistrationField.FirstName,
    RegistrationField.LastName,
  ],
  policy: { ttlMinutes: ttlOf(5), maxAttempts: 5, sessionDays: 30 },
};

export const AuthStrategy = {
  DEFAULT: DEFAULT_STRATEGY,

  /**
   * The edge guard — the one entry point for a strategy, from code-authored
   * config or an untyped document. Reports EVERY refusal at once: an unknown
   * kind alone; otherwise unknown fields, an empty or phone-less `required`,
   * and each bad policy figure (`createAuthStrategy`).
   */
  parse(
    input: AuthStrategy.Input,
  ): Result<AuthStrategy, readonly IdentityError[]> {
    const kind = input.authStrategyKind;
    if (
      kind !== AuthStrategyKind.PhoneOtp &&
      kind !== AuthStrategyKind.EmailOtp &&
      kind !== AuthStrategyKind.EmailLink
    ) {
      return Result.err([IdentityError.authStrategyUnknownKind(kind)]);
    }

    const errors: IdentityError[] = [];
    const required: RegistrationField[] = [];
    let unknownField = false;
    for (let i = 0; i < input.required.length; i++) {
      const value = input.required[i] as string;
      if (Registration.isField(value)) required.push(value);
      else {
        unknownField = true;
        errors.push(IdentityError.authStrategyUnknownField(value));
      }
    }
    if (!unknownField) {
      if (required.length === 0) {
        errors.push(IdentityError.authStrategyRequiredEmpty());
      } else if (!required.includes(RegistrationField.Phone)) {
        errors.push(IdentityError.authStrategyPhoneMissing());
      }
    }
    checkPolicy(
      input.policy,
      kind === AuthStrategyKind.EmailLink
        ? LINK_POLICY_FIELDS
        : OTP_POLICY_FIELDS,
      errors,
    );
    if (errors.length > 0) return Result.err(errors);

    const ttlMinutes = ttlOf(
      input.policy[AuthPolicyField.TtlMinutes] as number,
    );
    const sessionDays = input.policy[AuthPolicyField.SessionDays] as number;
    if (kind === AuthStrategyKind.EmailLink) {
      return Result.ok({
        authStrategyKind: kind,
        required,
        policy: { ttlMinutes, sessionDays },
      });
    }
    const maxAttempts = input.policy[AuthPolicyField.MaxAttempts] as number;
    return Result.ok({
      authStrategyKind: kind,
      required,
      policy: { ttlMinutes, maxAttempts, sessionDays },
    });
  },

  /** The identifier channel a strategy authenticates with. */
  identifierKind(
    strategy: Pick<AuthStrategy, 'authStrategyKind'>,
  ): IdentifierChannel {
    return strategy.authStrategyKind === AuthStrategyKind.PhoneOtp
      ? IdentifierChannel.Phone
      : IdentifierChannel.Email;
  },

  /** Whether a registration field gates submission under this strategy. */
  requires(
    strategy: Pick<AuthStrategy, 'required'>,
    field: RegistrationField,
  ): boolean {
    for (let i = 0; i < strategy.required.length; i++) {
      if (strategy.required[i] === field) return true;
    }
    return false;
  },
} as const;

export namespace AuthStrategy {
  /**
   * Policy for a code challenge (phone or e-mail OTP) — deployment config, a
   * named reference of the strategy (F-8): a code lives `ttlMinutes`, locks
   * out after `maxAttempts` wrong codes, and a session lasts `sessionDays`.
   */
  export type OtpPolicy = {
    readonly ttlMinutes: DurationMinutes;
    readonly maxAttempts: number;
    readonly sessionDays: number;
  };
  /** Policy for a magic-link challenge — deployment config. */
  export type LinkPolicy = {
    readonly ttlMinutes: DurationMinutes;
    readonly sessionDays: number;
  };
  /** The untyped shape a deployment config hands `parse` — foreign input (the L3 `Input` escape). */
  export type Input = {
    readonly authStrategyKind: string;
    readonly required: readonly string[];
    readonly policy: Readonly<Record<string, unknown>>;
  };
  export type PhoneOtp = {
    readonly authStrategyKind: typeof AuthStrategyKind.PhoneOtp;
    readonly required: readonly RegistrationField[];
    readonly policy: AuthStrategy.OtpPolicy;
  };
  export type EmailOtp = {
    readonly authStrategyKind: typeof AuthStrategyKind.EmailOtp;
    readonly required: readonly RegistrationField[];
    readonly policy: AuthStrategy.OtpPolicy;
  };
  export type EmailLink = {
    readonly authStrategyKind: typeof AuthStrategyKind.EmailLink;
    readonly required: readonly RegistrationField[];
    readonly policy: AuthStrategy.LinkPolicy;
  };
}
