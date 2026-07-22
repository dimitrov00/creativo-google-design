/**
 * Discriminated session-kind for the post-OTP path.
 *
 * Replaces an `isNewUser: boolean` field — the boolean variant let illegal
 * states slip through (a `false` session reaching registration, a `true`
 * session skipping it); the union makes the auth machine's guards
 * exhaustive on `kind`.
 *
 * Identity, not obligation: a session answers only "have we seen this
 * person before?" (`new` vs `returning`). It deliberately carries no
 * onboarding obligations — *what* a new user must still provide is owned
 * by the onboarding machine and the deployment's `AuthStrategy.required`
 * set, not pinned onto this type.
 */
export type SessionKind =
  { readonly kind: 'new' } | { readonly kind: 'returning' };

export const NEW_SESSION: SessionKind = { kind: 'new' };
export const RETURNING_SESSION: SessionKind = { kind: 'returning' };
