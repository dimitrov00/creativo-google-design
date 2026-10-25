/**
 * Entry-method tags of the identify screen — the discriminator
 * `authProviderKind` (N15: `AuthProvider` is the union).
 */
export const AuthProviderKind = {
  /** The deployment's own OTP flow. */
  Otp: 'OTP',
  /** A third-party sign-in button. */
  OAuth: 'OAUTH',
} as const;
export type AuthProviderKind =
  (typeof AuthProviderKind)[keyof typeof AuthProviderKind];

/** The third-party providers a deployment may offer. */
export const OAuthProvider = {
  Google: 'GOOGLE',
  Apple: 'APPLE',
  Facebook: 'FACEBOOK',
} as const;
export type OAuthProvider = (typeof OAuthProvider)[keyof typeof OAuthProvider];

/**
 * One way to start authenticating on the identify screen — a concept BESIDE
 * `AuthStrategy`, never a variant of it: an OAuth sign-in carries no
 * challenge policy, and still funnels through onboarding, where
 * `AuthStrategy.required` collects the phone.
 */
export type AuthProvider = AuthProvider.Otp | AuthProvider.OAuth;

const OTP_PROVIDER: AuthProvider.Otp = {
  authProviderKind: AuthProviderKind.Otp,
};

export const AuthProvider = {
  otp(): AuthProvider.Otp {
    return OTP_PROVIDER;
  },
  oauth(provider: OAuthProvider): AuthProvider.OAuth {
    return { authProviderKind: AuthProviderKind.OAuth, provider };
  },
} as const;

export namespace AuthProvider {
  export type Otp = {
    readonly authProviderKind: typeof AuthProviderKind.Otp;
  };
  export type OAuth = {
    readonly authProviderKind: typeof AuthProviderKind.OAuth;
    readonly provider: OAuthProvider;
  };
}
