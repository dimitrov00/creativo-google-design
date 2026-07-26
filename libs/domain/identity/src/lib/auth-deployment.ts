import { CountryIso2, toCountryIso2 } from '@creativo/domain/kernel';
import { AuthStrategy, DEFAULT_AUTH_STRATEGY } from './auth-strategy';

/**
 * One way a user can start authenticating on the identify screen — the
 * deployment's own OTP flow, or a third-party OAuth provider button.
 *
 * Deliberately a concept BESIDE `AuthStrategy`, never a variant inside it:
 * that union answers "which *challenge flow* is active" and each of its
 * variants owns the OTP/link policy it needs — growing it with OAuth
 * variants would force meaningless policies (exactly the illegal-state
 * problem its own docs warn about) and break `identifierKindForStrategy`'s
 * total `'phone' | 'email'` return. OAuth sign-ins carry no challenge
 * policy at all; they still funnel through onboarding, where
 * `AuthStrategy.required` (always containing `'phone'`, enforced by
 * `createAuthStrategy`) collects the contact channel.
 */
export type AuthProvider =
  | { readonly kind: 'otp' }
  | {
      readonly kind: 'oauth';
      readonly provider: 'google' | 'apple' | 'facebook';
    };

/**
 * Everything a single deployment decides about authentication, in one
 * injectable concept: which challenge flow runs (`strategy`), which entry
 * buttons the identify screen renders (`providers`), and which country
 * phone entry defaults to (`defaultCountry` — threaded into
 * `createIdentifier`/`PhoneNumber.create` and the phone field so users
 * type national-format numbers instead of full E.164).
 *
 * Flipping a deployment (phone↔email OTP, enabling Google, launching in a
 * new market) becomes a config change at the composition root, not a code
 * change scattered across call sites.
 */
export interface AuthDeployment {
  /** The active challenge flow — phone-required invariant already enforced by `createAuthStrategy`. */
  readonly strategy: AuthStrategy;
  /** Entry methods the identify screen offers, in render order; `[{kind:'otp'}]` today. */
  readonly providers: readonly AuthProvider[];
  /** Default country for phone entry, e.g. `'BG'` — national-format typing everywhere phones are collected. */
  readonly defaultCountry: CountryIso2;
}

const DEFAULT_COUNTRY_RESULT = toCountryIso2('BG');
if (DEFAULT_COUNTRY_RESULT.isFailure()) {
  // Unreachable — 'BG' is a known-supported country in the phone metadata.
  throw new Error('DEFAULT_AUTH_DEPLOYMENT default country failed to parse');
}

/**
 * Single-tenant deployment stand-in, wrapping `DEFAULT_AUTH_STRATEGY` the
 * same way that const stands in for a runtime tenant-config source (see
 * its doc). OTP-only entry, Bulgarian default country — the whole config a
 * per-deployment override at the composition root would replace.
 */
export const DEFAULT_AUTH_DEPLOYMENT: AuthDeployment = {
  strategy: DEFAULT_AUTH_STRATEGY,
  providers: [{ kind: 'otp' }],
  defaultCountry: DEFAULT_COUNTRY_RESULT.value,
};
