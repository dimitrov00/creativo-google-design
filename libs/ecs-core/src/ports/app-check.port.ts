import type { AppCheckMode } from '@core/primitives';

/**
 * The App Check switch as the callable edge reads it per call (security
 * hardening S-WS-A, S-RU-19) — implemented over the functions param
 * `APP_CHECK_MODE` by `app-check.adapter.ts` (functions). Synchronous, like
 * the flags: the switch is deploy-time configuration, never a live backend.
 * An unreadable value reads as OFF (fail-open: the switch can never lock
 * out the current build).
 */
export type ReadAppCheckMode = () => AppCheckMode;

/** The App Check switch — one adapter factory (`paramAppCheckModePorts`), the edge's dependency. */
export type AppCheckModePorts = {
  readonly appCheckMode: ReadAppCheckMode;
};
