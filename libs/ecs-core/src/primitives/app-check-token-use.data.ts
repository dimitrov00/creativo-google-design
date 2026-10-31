/**
 * Which App Check token a callable takes (security hardening S-WS-A,
 * S-RU-21, S-L-3) — the field `appCheckTokenUse`, the ONLY source of these
 * strings. One table, `CALLABLE_APP_CHECK_TOKEN` (`@core/ports`), drives
 * both sides: the web asks a limited-use token for a `LIMITED_USE`
 * callable, and the server consumes it (replay protection) while the
 * switch is MONITOR or ENFORCE.
 */
export const AppCheckTokenUse = {
  /** A standard, auto-refreshed token, reused until it expires. */
  Standard: 'STANDARD',
  /** A fresh limited-use token per call, consumed by the server — the destructive and sensitive callables. */
  LimitedUse: 'LIMITED_USE',
} as const;
export type AppCheckTokenUse =
  (typeof AppCheckTokenUse)[keyof typeof AppCheckTokenUse];
