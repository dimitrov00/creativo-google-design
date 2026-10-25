/** The guard's verdict — the discriminator `accessVerdict` of {@link AccessDecision}. */
export const AccessVerdict = {
  Allow: 'ALLOW',
  Redirect: 'REDIRECT',
} as const;
export type AccessVerdict = (typeof AccessVerdict)[keyof typeof AccessVerdict];
