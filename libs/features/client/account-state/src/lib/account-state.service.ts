import {
  Injectable,
  Signal,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import type { Subscription } from 'rxjs';
import {
  AUTH_GATEWAY,
  ANONYMOUS_PRINCIPAL,
  Principal,
} from '@creativo/application/identity';
import { PROFILE_PORTS } from '@creativo/infrastructure/firebase-app';
import { Registration } from '@core/components';
import type { User } from '@core/entities';
import { UserId } from '@core/primitives';

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
 * `account` is the single live `users/{uid}` snapshot (`observeProfile`):
 * one listener per signed-in uid, so a write from anywhere — this tab's own
 * profile save, registration completing, a pause the shop applies — reaches
 * every screen without a re-fetch. It is the flat `User` of `@core/entities`
 * as stored, and `null` while the document is absent OR still the
 * `PROVISIONED` stub a first sign-in writes: the port answers the stored
 * body, and "a stub is no profile yet" is this consumer's rule
 * (`Registration.isRegistered`, identity flip (2) §3.5).
 */
@Injectable({ providedIn: 'root' })
export class AccountStateService {
  private readonly authGateway = inject(AUTH_GATEWAY);
  private readonly profilePorts = inject(PROFILE_PORTS);

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

  /** True until the current uid's first snapshot answers — lets consumers (e.g. dashboard skeletons) tell "still loading" apart from "loaded, no profile". */
  private readonly _accountLoading = signal(false);
  readonly accountLoading = this._accountLoading.asReadonly();

  /**
   * The uid to listen to, as a string so the listener follows the PERSON:
   * a token refresh or the onboarding → active claim flip re-emits the
   * principal, and none of those is a reason to re-attach.
   */
  private readonly uid = computed(() => {
    const principal = this.principal();
    return principal.kind === 'anonymous' ? null : principal.uid.value;
  });

  /** Bumped by `refresh()` to re-attach a listener that has stopped. */
  private readonly relistens = signal(0);

  /** Whose profile `_account` holds, so a re-attach for the same person keeps it on screen. */
  private listenedUid: string | null = null;
  /** The listener's last answer was a failure; `subscribeWithRetry` stops on the unhealable ones. */
  private listenerFailed = false;

  constructor() {
    effect((onCleanup) => {
      const uid = this.uid();
      this.relistens();
      const subscription = untracked(() => this.listen(uid));
      onCleanup(() => subscription?.unsubscribe());
    });
  }

  /**
   * A no-op while the listener is healthy: `account` is already current.
   * Only after a failure (a rule denial, an unparseable document, which the
   * listener does not retry) does it re-attach, so a screen that calls it on
   * entry still gets one fresh attempt, as it did from the one-shot read.
   */
  refresh(): void {
    if (this.listenerFailed) {
      this.relistens.update((count) => count + 1);
    }
  }

  private listen(uid: string | null): Subscription | null {
    if (uid !== this.listenedUid) {
      // Never show one person's profile to the next, not even for a frame.
      this._account.set(null);
      this.listenedUid = uid;
    }
    this.listenerFailed = false;
    const userId = uid === null ? null : UserId.parse(uid);
    if (userId === null || !userId.ok) {
      this._account.set(null);
      this._accountLoading.set(false);
      return null;
    }
    this._accountLoading.set(this._account() === null);
    return this.profilePorts
      .observeProfile(userId.value)
      .subscribe((result) => {
        if (result.ok) {
          this._account.set(registeredOrNull(result.value));
          this.listenerFailed = false;
        } else {
          // Keep what is on screen: dated data beats a blank account while a
          // transient failure retries, and a first answer that fails leaves
          // it null anyway.
          this.listenerFailed = true;
        }
        this._accountLoading.set(false);
      });
  }
}

/** The stored body as an account: a `PROVISIONED` stub reads as no profile yet. */
function registeredOrNull(user: User | null): User | null {
  return user !== null && Registration.isRegistered(user) ? user : null;
}
