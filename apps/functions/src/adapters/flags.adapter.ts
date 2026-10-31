import type { FlagsPorts } from '@core/ports';
import { flagOn } from '../lib/flags';

/**
 * The build-time flags (`FlagsPorts`, blueprint §4.2) over the functions'
 * params (`lib/flags.ts`, keyed by the one vocabulary, `FlagName`). Read PER
 * CALL, never at module load: during deploy analysis the env holds no
 * values yet, so a top-level read would bake in `false`. Logic-free.
 */
export const paramFlagsPorts = (): FlagsPorts => ({ flagOn });
