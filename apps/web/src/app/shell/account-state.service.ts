import {
  Injectable,
  Signal,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AUTH_GATEWAY } from '@creativo/application/identity';
import { PROFILE_PORT } from '@creativo/application/accounts';
import { ANONYMOUS_PRINCIPAL, Principal } from '@creativo/domain/identity';
import { User, UserId } from '@creativo/domain/accounts';

/**
 * Root-provided, single `onIdTokenChanged` listener for the whole shell
 * (blueprint §1.4) — every route/guard/component reads `principal`/
 * `claims`/`account` from here rather than re-subscribing to `AuthGateway`.
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

  constructor() {
    effect(() => {
      const principal = this.principal();
      if (principal.kind === 'anonymous') {
        this._account.set(null);
        return;
      }
      const userIdResult = UserId.create(principal.uid.value);
      if (userIdResult.isFailure()) {
        this._account.set(null);
        return;
      }
      void this.profilePort.getProfile(userIdResult.value).then((result) => {
        this._account.set(result.isSuccess() ? result.value : null);
      });
    });
  }
}
