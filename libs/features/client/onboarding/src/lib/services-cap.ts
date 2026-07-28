import { InjectionToken } from '@angular/core';

/**
 * How many services the onboarding personalization step lets a visitor
 * pick (Revolut-style capped multi-select: a short, intentional list beats
 * an everything-checked one — the selection seeds recommendations, so
 * three strong signals outrank ten weak ones).
 *
 * Deployment-configurable the same way `AUTH_DEPLOYMENT` is: the
 * composition root may re-provide the token; features only ever read it.
 */
export const ONBOARDING_SERVICES_CAP = new InjectionToken<number>(
  'ONBOARDING_SERVICES_CAP',
  { factory: () => 3 },
);
