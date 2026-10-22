import type { FlagsPorts } from '@core/ports';
import { flagOn } from '../lib/flags';

/**
 * The build-time flags (`FlagsPorts`, blueprint §4.2) over the functions'
 * params (`lib/flags.ts`, whose `FeatureFlagKey` strings are `FlagName`'s —
 * the spec pins the two vocabularies equal). Read PER CALL, never at module
 * load: during deploy analysis the env holds no values yet, so a top-level
 * read would bake in `false`. Logic-free.
 */
export const paramFlagsPorts = (): FlagsPorts => ({
  flagOn: (key) => flagOn(key),
});
