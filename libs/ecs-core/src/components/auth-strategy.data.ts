import { CountryIso2 } from './country-iso2.data';
import { IdentifierKind } from './identifier.data';
import { AuthPolicyField, IdentityError } from './identity-errors.data';
import { RegistrationField, isRegistrationField } from './registration.data';
import { Result } from './result.data';

/** Strategy tags — the ONLY source of these strings (deployment config). */
export const AuthStrategyKind = {
  PhoneOtp: 'phone_otp',
  EmailOtp: 'email_otp',
  EmailLink: 'email_link',
} as const;
export type AuthStrategyKind =
  (typeof AuthStrategyKind)[keyof typeof AuthStrategyKind];

/** Policy for a code challenge (phone or e-mail OTP). */
export type OtpPolicy = {
  readonly ttlMinutes: number;
  readonly maxAttempts: number;
  readonly sessionDays: number;
};

/** Policy for a magic-link challenge. */
export type LinkPolicy = {
  readonly ttlMinutes: number;
  readonly sessionDays: number;
};

/**
 * Which challenge flow a deployment runs. Each variant owns the policy it
 * needs — no shared policy on a parent shape, which would let a future
 * variant carry an unused field. Every strategy's `required` set includes
 * `phone`: the shop always needs a contact channel (enforced by `parse`).
 */
export type AuthStrategy =
  AuthStrategy.PhoneOtp | AuthStrategy.EmailOtp | AuthStrategy.EmailLink;

/** The untyped shape a deployment config hands `parse`. */
export type AuthStrategyInput = {
  readonly kind: string;
  readonly required: readonly string[];
  readonly policy: { readonly [key: string]: unknown };
};

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
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
  kind: AuthStrategyKind.EmailOtp,
  required: [
    RegistrationField.Phone,
    RegistrationField.FirstName,
    RegistrationField.LastName,
  ],
  policy: { ttlMinutes: 5, maxAttempts: 5, sessionDays: 30 },
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
    input: AuthStrategyInput,
  ): Result<AuthStrategy, readonly IdentityError[]> {
    const kind = input.kind;
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
      if (isRegistrationField(value)) required.push(value);
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

    const ttlMinutes = input.policy[AuthPolicyField.TtlMinutes] as number;
    const sessionDays = input.policy[AuthPolicyField.SessionDays] as number;
    if (kind === AuthStrategyKind.EmailLink) {
      return Result.ok({ kind, required, policy: { ttlMinutes, sessionDays } });
    }
    const maxAttempts = input.policy[AuthPolicyField.MaxAttempts] as number;
    return Result.ok({
      kind,
      required,
      policy: { ttlMinutes, maxAttempts, sessionDays },
    });
  },

  /** The identifier kind a strategy authenticates with. */
  identifierKind(strategy: AuthStrategy): IdentifierKind {
    return strategy.kind === AuthStrategyKind.PhoneOtp
      ? IdentifierKind.Phone
      : IdentifierKind.Email;
  },

  /** Whether a registration field gates submission under this strategy. */
  requires(strategy: AuthStrategy, field: RegistrationField): boolean {
    for (let i = 0; i < strategy.required.length; i++) {
      if (strategy.required[i] === field) return true;
    }
    return false;
  },
} as const;

export namespace AuthStrategy {
  export type PhoneOtp = {
    readonly kind: typeof AuthStrategyKind.PhoneOtp;
    readonly required: readonly RegistrationField[];
    readonly policy: OtpPolicy;
  };
  export type EmailOtp = {
    readonly kind: typeof AuthStrategyKind.EmailOtp;
    readonly required: readonly RegistrationField[];
    readonly policy: OtpPolicy;
  };
  export type EmailLink = {
    readonly kind: typeof AuthStrategyKind.EmailLink;
    readonly required: readonly RegistrationField[];
    readonly policy: LinkPolicy;
  };
}

/** Entry-method tags of the identify screen. */
export const AuthProviderKind = {
  /** The deployment's own OTP flow. */
  Otp: 'otp',
  /** A third-party sign-in button. */
  OAuth: 'oauth',
} as const;
export type AuthProviderKind =
  (typeof AuthProviderKind)[keyof typeof AuthProviderKind];

/** The third-party providers a deployment may offer. */
export const OAuthProvider = {
  Google: 'google',
  Apple: 'apple',
  Facebook: 'facebook',
} as const;
export type OAuthProvider = (typeof OAuthProvider)[keyof typeof OAuthProvider];

/**
 * One way to start authenticating on the identify screen — a concept BESIDE
 * `AuthStrategy`, never a variant of it: an OAuth sign-in carries no
 * challenge policy, and still funnels through onboarding, where
 * `AuthStrategy.required` collects the phone.
 */
export type AuthProvider = AuthProvider.Otp | AuthProvider.OAuth;

const OTP_PROVIDER: AuthProvider.Otp = { kind: AuthProviderKind.Otp };

export const AuthProvider = {
  otp(): AuthProvider.Otp {
    return OTP_PROVIDER;
  },
  oauth(provider: OAuthProvider): AuthProvider.OAuth {
    return { kind: AuthProviderKind.OAuth, provider };
  },
} as const;

export namespace AuthProvider {
  export type Otp = {
    readonly kind: typeof AuthProviderKind.Otp;
  };
  export type OAuth = {
    readonly kind: typeof AuthProviderKind.OAuth;
    readonly provider: OAuthProvider;
  };
}

/**
 * Everything one deployment decides about authentication: which challenge
 * runs, which entry buttons the identify screen renders (in order), and the
 * country phone entry defaults to (national-format typing everywhere).
 * Flipping a deployment is a config change at the composition root.
 */
export type AuthDeployment = {
  readonly strategy: AuthStrategy;
  readonly providers: readonly AuthProvider[];
  readonly defaultCountry: CountryIso2;
};

export const AuthDeployment = {
  /** The single-tenant stand-in: the default strategy, OTP entry only, Bulgaria. */
  DEFAULT: {
    strategy: DEFAULT_STRATEGY,
    providers: [OTP_PROVIDER],
    defaultCountry: CountryIso2.of('BG'),
  } satisfies AuthDeployment as AuthDeployment,
} as const;
