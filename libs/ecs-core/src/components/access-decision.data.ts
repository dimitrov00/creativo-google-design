import type { AccessTarget } from './access-target.data';
import type { AccessVerdict } from './access-verdict.data';

/**
 * The guard's answer (`SessionAccessSystem.decide`). A redirect to `AUTH`
 * from the active gate keeps the attempted URL (`?redirect=`), so the
 * person lands back where they aimed.
 */
export type AccessDecision =
  | { readonly accessVerdict: typeof AccessVerdict.Allow }
  | {
      readonly accessVerdict: typeof AccessVerdict.Redirect;
      readonly to: AccessTarget;
      readonly keepReturnUrl: boolean;
    };
