import {
  Injectable,
  Injector,
  type Signal,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { map, of, switchMap } from 'rxjs';
import { STAFF_PERMISSIONS_PORTS } from '@creativo/infrastructure/firebase-app';
import {
  Principal,
  Role,
  Roles,
  StaffLink,
  StaffPermissions,
} from '@core/components';
import {
  AccessScope,
  type BarberId,
  type StaffCapability,
  type UserId,
} from '@core/primitives';
import { type StaffAccess, StaffAccessSystem } from '@core/systems';
import { AccountStateService } from './account-state.service';

/** Who reads the cells: the signed-in person, and whether their token holds a staff role. */
type CellsReader = {
  readonly userId: UserId | null;
  readonly staff: boolean;
};

/** The cells as they answered for one person; `null`: none to read, or unreadable. */
type CellsAnswer = {
  readonly userId: UserId | null;
  readonly permissions: StaffPermissions | null;
};

/** What a route's capability gate reads, once everything has answered. */
export type StaffAccessFacts = {
  readonly storedRoles: readonly Role[];
  readonly permissions: StaffPermissions;
};

/**
 * Cells nobody could read: every editable cell is nobody. What the session
 * decides on until the cells answer and when they cannot be read — never
 * the defaults, which would hand back what an owner had taken away (O11).
 * The admin's everything and the sysadmin's fixed column are not cells, so
 * they hold here too.
 */
const CLOSED: StaffPermissions = StaffPermissions.saved(
  StaffPermissions.UNSET,
  new Map(
    StaffPermissions.LEVELS.flatMap((level) =>
      StaffPermissions.CAPABILITIES.map(
        (capability) =>
          [
            StaffPermissions.fieldOf(level, capability),
            AccessScope.None,
          ] as const,
      ),
    ),
  ),
);

/**
 * WHO MAY DO WHAT, FOR THE SCREENS (staff permissions P8) — the one place
 * the web asks the owner's permissions. It holds the session's one live
 * copy of `settings/staffPermissions` and answers, per capability, how far
 * the signed-in person reaches: an entry point is shown or hidden by it,
 * and a route's capability gate decides on it.
 *
 * It reads what the server reads:
 *
 * - **the STORED account's roles** (`AccountStateService.account`) — so a
 *   role the owner gave themself works at once, with no new sign-in — and
 *   the token's only for an account that has no document;
 * - **the owner's cells**, through the same reading guard. When they
 *   cannot be read, every cell is nobody ({@link CLOSED}): never an entry
 *   point the owner cut.
 *
 * **Nothing is granted on a half-read session.** Until the account and the
 * cells have answered ({@link StaffAccessService.settled}), every reach is
 * nobody, so an entry point appears only once the decision behind it is
 * final. That is what keeps a tap from starting a navigation its gate
 * would have to wait on: the page being left syncs its own URL meanwhile,
 * which cancels the pending navigation, and the button does nothing (the
 * schedule's chart button did exactly that on a slow machine).
 *
 * **The owner needs no cells.** The admin's everything is answered before
 * a cell is read (P4), so an admin's session is settled as soon as the
 * account has answered; it never waits for a document that cannot change
 * its answer.
 *
 * The cells are read by staff sessions only — the rules refuse the
 * document to everyone else, and nobody else has a capability to ask
 * about. Nothing here is security-bearing: every call re-judges the stored
 * account and the cells on the server (`StaffAccessSystem.admit`).
 *
 * `scopeOf`, `accessOf` and `mayFor` read signals, so a `computed()` or a
 * template that calls them follows a change of the cells or of the account
 * with no reload.
 */
@Injectable({ providedIn: 'root' })
export class StaffAccessService {
  private readonly accountState = inject(AccountStateService);
  private readonly injector = inject(Injector);
  /**
   * The cells' stream — optional, so a host that binds none (a test bed,
   * the showcase) is a session with no cells to read: closed, and the
   * admin's everything still stands.
   */
  private readonly ports = inject(STAFF_PERMISSIONS_PORTS, { optional: true });

  /**
   * Whose cells to read. Equal by value, so a token refresh for the same
   * person re-attaches nothing. Staff by the TOKEN: that is the rules'
   * own test for the document.
   */
  private readonly reader = computed<CellsReader>(
    () => ({
      userId: this.accountState.userId(),
      staff: Principal.hasAnyRole(this.accountState.principal(), Roles.STAFF),
    }),
    { equal: (a, b) => a.userId === b.userId && a.staff === b.staff },
  );

  /** The last answer of the cells, and whose it was; `undefined` before the first. */
  private readonly answer = toSignal(
    toObservable(this.reader).pipe(
      switchMap(({ userId, staff }) =>
        staff && this.ports !== null
          ? this.ports.observeStaffPermissions().pipe(
              map((result): CellsAnswer => ({
                userId,
                permissions: result.ok ? result.value : null,
              })),
            )
          : of<CellsAnswer>({ userId, permissions: null }),
      ),
    ),
    { initialValue: undefined },
  );

  /**
   * The cells for WHOEVER IS SIGNED IN: `undefined` until they answer for
   * that person (an answer for the one before is not theirs), `null` when
   * there are none to read or the read was refused.
   */
  private readonly cells = computed<StaffPermissions | null | undefined>(() => {
    const answer = this.answer();
    return answer !== undefined && answer.userId === this.accountState.userId()
      ? answer.permissions
      : undefined;
  });

  /** The owner's cells as far as this session knows them; closed while it does not. */
  readonly permissions: Signal<StaffPermissions> = computed(
    () => this.cells() ?? CLOSED,
  );

  /**
   * The account's roles as the server reads them: the stored ones; the
   * token's while the account has not answered and for one that has no
   * document. Empty for nobody and for an account that is not onboarded.
   */
  readonly storedRoles: Signal<readonly Role[]> = computed(() => {
    const account = this.accountState.account();
    return account !== null ? account.roles : (this.accountState.roles() ?? []);
  });

  /** The barber record that is the person's own; `null`: none, or not loaded yet. */
  readonly linkedBarberId: Signal<BarberId | null> = computed(() => {
    const account = this.accountState.account();
    return account === null ? null : StaffLink.of(account).linkedBarberId;
  });

  /**
   * Everything a decision reads has answered for the signed-in person: the
   * account, and the cells — at once for a session with none to read, and
   * not at all for the owner, whose everything no cell can change.
   */
  readonly settled: Signal<boolean> = computed(
    () =>
      this.accountState.accountSettled() &&
      (this.cells() !== undefined || this.storedRoles().includes(Role.Admin)),
  );

  /**
   * How far `staffCapability` reaches for the signed-in person — nobody
   * while the session is half-read ({@link settled}).
   */
  scopeOf(staffCapability: StaffCapability): AccessScope {
    return this.settled()
      ? StaffAccessSystem.scopeOf(
          this.permissions(),
          staffCapability,
          this.storedRoles(),
        )
      : AccessScope.None;
  }

  /** The reach for one capability: its scope and the record that is one's own. */
  accessOf(staffCapability: StaffCapability): StaffAccess {
    return {
      accessScope: this.scopeOf(staffCapability),
      linkedBarberId: this.linkedBarberId(),
    };
  }

  /**
   * Whether the person may make an act of `staffCapability` on ONE barber
   * record: everyone's, or their own. What a lane shows an entry point by.
   */
  mayFor(staffCapability: StaffCapability, barberId: BarberId): boolean {
    return StaffAccessSystem.reaches(this.accessOf(staffCapability), barberId);
  }

  /**
   * What a route's capability gate decides on, once the account and the
   * cells have answered for whoever is signed in. It always resolves: a
   * session with nobody in it is settled, with no roles and closed cells.
   *
   * Two rules, each learned from a lost navigation:
   *
   * - **It READS `settled` as it stands, never a replayed stream.** A
   *   stream hands back the last value it was told — on a cold load that
   *   is the signed-out moment's "settled", a beat before the person's
   *   account and cells are even asked, and the gate would decide on the
   *   token and closed cells.
   * - **A session that is already settled answers at once**, in the same
   *   microtask a role gate does. A wait of even one tick leaves room for
   *   the page being left to sync its own URL, which cancels the pending
   *   navigation: the chart button then does nothing. (`scopeOf` closes the
   *   other half of that gap: no entry point shows before the session is
   *   settled, so only a cold deep link ever waits here.)
   */
  whenSettled(): Promise<StaffAccessFacts> {
    if (this.settled()) return Promise.resolve(this.facts());
    return new Promise((resolve) => {
      const watch = effect(
        () => {
          if (!this.settled()) return;
          watch.destroy();
          resolve(untracked(() => this.facts()));
        },
        { injector: this.injector },
      );
    });
  }

  private facts(): StaffAccessFacts {
    return {
      storedRoles: this.storedRoles(),
      permissions: this.permissions(),
    };
  }
}
