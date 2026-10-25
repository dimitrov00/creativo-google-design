import { AuthProvider } from './auth-provider.data';
import { AuthStrategy } from './auth-strategy.data';
import { CountryIso2 } from './country-iso2.data';

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
    strategy: AuthStrategy.DEFAULT,
    providers: [AuthProvider.otp()],
    defaultCountry: CountryIso2.of('BG'),
  } satisfies AuthDeployment as AuthDeployment,
} as const;
