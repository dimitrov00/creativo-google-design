import type { FlagName } from '../components/feature-flags.data';

/**
 * Whether a manifest flag is on (blueprint §4.2) — on both sides: the web
 * reads `config/feature-flags.json` from its bundle, the functions read the
 * same manifest through their params. Synchronous on purpose: flags are
 * build-time values, never a live backend (owner ruling 2026-09-24), so
 * there is nothing to await and nothing to fail.
 */
export type FlagOn = (key: FlagName) => boolean;

export type FlagsPorts = {
  readonly flagOn: FlagOn;
};
