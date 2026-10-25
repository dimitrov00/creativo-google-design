/**
 * The settled account verdict `/auth` and `/onboarding` branch on
 * (`GuestGuardSystem.classify`, blueprint §2.8):
 *
 * - `LOADING`    — no principal observed yet → render a splash.
 * - `ANONYMOUS`  — not signed in → allow the auth flow.
 * - `ONBOARDING` — signed in, not yet active → resume onboarding.
 * - `ACTIVE`     — a finished account (client or staff) → bounce away.
 */
export const SettledVerdict = {
  Loading: 'LOADING',
  Anonymous: 'ANONYMOUS',
  Onboarding: 'ONBOARDING',
  Active: 'ACTIVE',
} as const;
export type SettledVerdict =
  (typeof SettledVerdict)[keyof typeof SettledVerdict];
