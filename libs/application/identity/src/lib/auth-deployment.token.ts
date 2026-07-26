import { InjectionToken } from '@angular/core';
import {
  AuthDeployment,
  DEFAULT_AUTH_DEPLOYMENT,
} from '@creativo/domain/identity';

/**
 * The deployment's auth configuration (strategy + entry providers +
 * default phone country) as an injectable — the seam that turns
 * "flip phone_otp↔email_otp" or "enable Google" into a composition-root
 * config change instead of edits at every `DEFAULT_AUTH_STRATEGY` call
 * site. The factory default keeps tests and secondary composition roots
 * working without an explicit provider; `apps/web`'s `app.config.ts`
 * still provides it explicitly so the per-deployment override point stays
 * visible in the wiring.
 */
export const AUTH_DEPLOYMENT = new InjectionToken<AuthDeployment>(
  'AuthDeployment',
  { factory: () => DEFAULT_AUTH_DEPLOYMENT },
);
