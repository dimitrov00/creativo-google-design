import { Component } from '@angular/core';

/**
 * Slot for v2's `ImpersonationBanner` (`src/components/impersonation-
 * banner.tsx`) — renders nothing today. `Principal`/`AuthClaims` carry no
 * "currently impersonating" fact yet (that's `ImpersonationSession`, a
 * live governance-context read keyed by admin uid, not a token claim), so
 * there's nothing for this component to read. Hosting the slot in the
 * shell now means the real banner only needs a body once that read
 * exists, with no `App`/`app.html` changes required.
 */
@Component({
  selector: 'cr-impersonation-banner',
  template: '',
})
export class ImpersonationBanner {}
