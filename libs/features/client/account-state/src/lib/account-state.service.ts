import {
  Injectable,
  Signal,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AUTH_GATEWAY,
  ANONYMOUS_PRINCIPAL,
  Principal,
} from '@creativo/application/identity';
import { PROFILE_PORT, User, UserId } from '@creativo/application/accounts';

/**
 * Root-provided, single `onIdTokenChanged` listener for the whole shell
 * (blueprint §1.4) — every route/guard/component reads `principal`/
 * `claims`/`account`/`accountLoading` from here rather than re-subscribing
 * to `AuthGateway` or re-fetching the profile themselves.
 *
 * Lives in its own lib (not `apps/web`, not the `client/account` dashboard
 * lib) for two reasons: Nx module boundaries forbid a `type:feature` lib
 * from depending on `type:app` (`apps/web`), and `apps/web`'s
 * `SessionExpiryService` — eager, injected from the always-loaded root
 * `App` component — already depends on this service; if it lived inside
 * the lazy-loaded `client/account` dashboard lib instead, that static
 * eager import would pull the whole dashboard screen into the main
 * bundle and defeat `/account`'s lazy chunk.
 *
 * The "single `users/{uid}` snapshot" half of the brief is a partial
 * implementation: `ProfilePort` only exposes a one-shot `getProfile`, not a
 * live listener (no such port exists yet — adding one is infrastructure
 * work outside this goal's scope guard, which asks to stop and flag a
 * missing port rather than invent one). `account` here re-fetches once per
 * uid change instead of subscribing to a live snapshot; a `ProfilePort`
 * with an `observeProfile` method would let this become a true snapshot.
 */
@Injectable({ providedIn: 'root' })
export class AccountStateService {
  private readonly authGateway = inject(AUTH_GATEWAY);
  private readonly profilePort = inject(PROFILE_PORT);

  readonly principal: Signal<Principal> = toSignal(
    this.authGateway.observePrincipal(),
    { initialValue: ANONYMOUS_PRINCIPAL },
  );

  readonly claims = computed(() => {
    const principal = this.principal();
    return principal.kind === 'active' ? principal.roles : null;
  });

  private readonly _account = signal<User | null>(null);
  readonly account = this._account.asReadonly();

  /** True while the current uid's profile fetch is in flight — lets consumers (e.g. dashboard skeletons) tell "still loading" apart from "loaded, no profile". */
  private readonly _accountLoading = signal(false);
  readonly accountLoading = this._accountLoading.asReadonly();

  constructor() {
    effect(() => {
      const principal = this.principal();
      if (principal.kind === 'anonymous') {
        this._account.set(null);
        this._accountLoading.set(false);
        return;
      }
      const userIdResult = UserId.create(principal.uid.value);
      if (userIdResult.isFailure()) {
        this._account.set(null);
        this._accountLoading.set(false);
        return;
      }
      this._accountLoading.set(true);
      void this.profilePort.getProfile(userIdResult.value).then((result) => {
        this._account.set(result.isSuccess() ? result.value : null);
        this._accountLoading.set(false);
      });
    });
  }
}
