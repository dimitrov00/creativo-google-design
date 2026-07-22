import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  AuthStrategyError,
  AuthStrategyInvalidPolicyError,
  AuthStrategyPhoneMissingError,
  AuthStrategyRequiredEmptyError,
  AuthStrategyUnknownFieldError,
  AuthStrategyUnknownKindError,
} from './auth-strategy.errors';
import { RegistrationField, isRegistrationField } from './registration-field';

/** Policy for code-based challenges (phone-OTP, email-OTP). */
export interface OtpPolicy {
  readonly ttlMinutes: number;
  readonly maxAttempts: number;
  readonly sessionDays: number;
}

/** Policy for magic-link challenges (email link). */
export interface LinkPolicy {
  readonly ttlMinutes: number;
  readonly sessionDays: number;
}

export interface PhoneOtpStrategy {
  readonly kind: 'phone_otp';
  readonly required: readonly RegistrationField[];
  readonly policy: OtpPolicy;
}

export interface EmailOtpStrategy {
  readonly kind: 'email_otp';
  readonly required: readonly RegistrationField[];
  readonly policy: OtpPolicy;
}

export interface EmailLinkStrategy {
  readonly kind: 'email_link';
  readonly required: readonly RegistrationField[];
  readonly policy: LinkPolicy;
}

/**
 * Which authentication flow is active for this deployment.
 *
 * Each variant owns the policy it needs — no shared policy field lives on
 * a parent shape, which would make an illegal state representable (e.g. a
 * future OAuth variant carrying an unused `otp` field).
 *
 * The booking app needs a contact channel for salon owners to reach
 * clients, so every strategy's `required` set MUST include `'phone'` —
 * enforced by `createAuthStrategy`'s validation, not just by convention.
 */
export type AuthStrategy =
  PhoneOtpStrategy | EmailOtpStrategy | EmailLinkStrategy;

/** The identifier kind a strategy authenticates with. */
export function identifierKindForStrategy(
  strategy: AuthStrategy,
): 'phone' | 'email' {
  return strategy.kind === 'phone_otp' ? 'phone' : 'email';
}

/**
 * Whether a registration field is mandatory for this strategy — the single
 * source of truth an onboarding step reads to decide which collected
 * fields gate submission.
 */
export function authStrategyRequires(
  strategy: AuthStrategy,
  field: RegistrationField,
): boolean {
  return strategy.required.includes(field);
}

export interface AuthStrategyInput {
  readonly kind: string;
  readonly required: readonly string[];
  readonly policy: Record<string, unknown>;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function validateRequired(
  raw: readonly string[],
): Result<readonly RegistrationField[], AuthStrategyError[]> {
  const errors: AuthStrategyError[] = [];
  const fields: RegistrationField[] = [];
  for (const value of raw) {
    if (isRegistrationField(value)) {
      fields.push(value);
    } else {
      errors.push(new AuthStrategyUnknownFieldError(value));
    }
  }
  if (errors.length > 0) return fail(errors);
  if (fields.length === 0) return fail([new AuthStrategyRequiredEmptyError()]);
  if (!fields.includes('phone'))
    return fail([new AuthStrategyPhoneMissingError()]);
  return ok(fields);
}

function validateOtpPolicy(
  raw: Record<string, unknown>,
): Result<OtpPolicy, AuthStrategyError[]> {
  const errors: AuthStrategyError[] = [];
  if (!isPositiveInt(raw['ttlMinutes'])) {
    errors.push(
      new AuthStrategyInvalidPolicyError(
        'ttlMinutes must be a positive integer',
      ),
    );
  }
  if (!isPositiveInt(raw['maxAttempts'])) {
    errors.push(
      new AuthStrategyInvalidPolicyError(
        'maxAttempts must be a positive integer',
      ),
    );
  }
  if (!isPositiveInt(raw['sessionDays'])) {
    errors.push(
      new AuthStrategyInvalidPolicyError(
        'sessionDays must be a positive integer',
      ),
    );
  }
  if (errors.length > 0) return fail(errors);
  return ok({
    ttlMinutes: raw['ttlMinutes'] as number,
    maxAttempts: raw['maxAttempts'] as number,
    sessionDays: raw['sessionDays'] as number,
  });
}

function validateLinkPolicy(
  raw: Record<string, unknown>,
): Result<LinkPolicy, AuthStrategyError[]> {
  const errors: AuthStrategyError[] = [];
  if (!isPositiveInt(raw['ttlMinutes'])) {
    errors.push(
      new AuthStrategyInvalidPolicyError(
        'ttlMinutes must be a positive integer',
      ),
    );
  }
  if (!isPositiveInt(raw['sessionDays'])) {
    errors.push(
      new AuthStrategyInvalidPolicyError(
        'sessionDays must be a positive integer',
      ),
    );
  }
  if (errors.length > 0) return fail(errors);
  return ok({
    ttlMinutes: raw['ttlMinutes'] as number,
    sessionDays: raw['sessionDays'] as number,
  });
}

/**
 * Validating factory — the single entry point for building an
 * `AuthStrategy`, whether from code-authored deployment config or an
 * untyped `TenantConfig` document read at runtime. Unlike most VOs in this
 * lib there is no separate `reconstitute`: an `AuthStrategy` is stateless
 * deployment config with no creation-only invariant to skip, so the same
 * validation applies on every call site.
 */
export function createAuthStrategy(
  input: AuthStrategyInput,
): Result<AuthStrategy, AuthStrategyError[]> {
  if (
    input.kind !== 'phone_otp' &&
    input.kind !== 'email_otp' &&
    input.kind !== 'email_link'
  ) {
    return fail([new AuthStrategyUnknownKindError(input.kind)]);
  }

  const requiredResult = validateRequired(input.required);
  const policyResult =
    input.kind === 'email_link'
      ? validateLinkPolicy(input.policy)
      : validateOtpPolicy(input.policy);

  const errors: AuthStrategyError[] = [];
  if (requiredResult.isFailure()) errors.push(...requiredResult.error);
  if (policyResult.isFailure()) errors.push(...policyResult.error);
  if (errors.length > 0) return fail(errors);
  if (requiredResult.isFailure() || policyResult.isFailure()) {
    // Unreachable given the check above — narrows both Results to Success below.
    return fail(errors);
  }

  const required = requiredResult.value;
  if (input.kind === 'email_link') {
    return ok({
      kind: 'email_link',
      required,
      policy: policyResult.value as LinkPolicy,
    });
  }
  return ok({
    kind: input.kind,
    required,
    policy: policyResult.value as OtpPolicy,
  });
}
