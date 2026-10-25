/** Where a refused principal is sent — the redirect's `to` of {@link AccessDecision}. */
export const AccessTarget = {
  Auth: 'AUTH',
  Onboarding: 'ONBOARDING',
  Account: 'ACCOUNT',
  Forbidden: 'FORBIDDEN',
} as const;
export type AccessTarget = (typeof AccessTarget)[keyof typeof AccessTarget];
