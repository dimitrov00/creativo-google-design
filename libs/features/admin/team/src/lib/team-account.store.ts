import {
  Injectable,
  computed,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import {
  AccountStanding,
  BarberLinkRequest,
  type Role,
  type RolesCall,
  type TeamMember,
} from '@core/components';
import type { UserId } from '@core/primitives';
import { RoleAssignmentSystem, TeamRosterSystem } from '@core/systems';
import {
  AccountStateService,
  StaffAccessService,
} from '@creativo/features/client/account-state';
import { TeamRolesStore } from './team-roles.store';
import { TeamStore } from './team.store';

/** Two lists of roles hold the same ones in the same order. */
function sameRoles(a: readonly Role[], b: readonly Role[]): boolean {
  return (
    a.length === b.length && a.every((role, index) => role === b.at(index))
  );
}

/**
 * ONE STAFF ACCOUNT WITH NO BARBER RECORD (team onboarding D8): the front
 * desk, a content editor, an admin — the Team list's own row for it, what
 * its page is to the person looking, the staff roles as drafted, and the
 * two calls the page makes: the ticks saved, and the account taken off the
 * team.
 *
 * Provided by the account's page. It decides nothing: which roles are
 * offered, what the ticks send and whether they may be sent are
 * `RoleAssignmentSystem`'s answers; `setRoles` judges the call
 * (`TeamRolesStore`). The draft follows the stored roles: it starts from
 * them, and starts again whenever the list says they changed.
 */
@Injectable()
export class TeamAccountStore {
  private readonly roles = inject(TeamRolesStore);
  private readonly team = inject(TeamStore);
  private readonly access = inject(StaffAccessService);
  private readonly session = inject(AccountStateService);

  private readonly _userId = signal<UserId | null>(null);
  private readonly _reading = signal(false);
  private readonly _saved = signal(false);

  /** The Team list's row for the account; `null` while the list is unread or holds no such account. */
  readonly account = computed<TeamMember.RoleOnly | null>(() => {
    const userId = this._userId();
    return userId === null
      ? null
      : TeamRosterSystem.accountOf(this.team.members() ?? [], userId);
  });

  /** The Team list has answered: an account it does not hold is really not on the team. */
  readonly known = computed(() => this.team.members() !== null);

  /** What the page is to the person looking. */
  readonly accountStanding = computed<AccountStanding>(() => {
    const account = this.account();
    return account === null
      ? AccountStanding.ReadOnly
      : TeamRosterSystem.accountStandingOf(account, {
          userId: this.session.userId(),
          linkedBarberId: this.access.linkedBarberId(),
          assignsRoles: this.access.editsPermissions(),
        });
  });

  /** The staff roles the page offers as ticks. */
  readonly ticks = computed<readonly Role[]>(() => {
    const account = this.account();
    return account === null
      ? []
      : RoleAssignmentSystem.teamTicksOf(account.memberRoles);
  });

  /** The ticks the stored account holds — the same list until its roles really change. */
  private readonly held = computed<readonly Role[]>(
    () => {
      const account = this.account();
      return account === null
        ? []
        : this.ticks().filter((role) => account.memberRoles.includes(role));
    },
    { equal: sameRoles },
  );

  /** The ticks as drafted: the stored ones until a row is pressed, and again when they change. */
  readonly ticked = linkedSignal<readonly Role[]>(() => this.held());

  /** The draft may be sent (`RoleAssignmentSystem.teamSaveOf`), and the roles are the viewer's to change. */
  readonly canSave = computed(() => {
    const account = this.account();
    return (
      account !== null &&
      this.accountStanding() === AccountStanding.Editable &&
      RoleAssignmentSystem.teamSaveOf(account.memberRoles, this.ticked())
    );
  });

  /** A call is on its way, or the list is being read after one. */
  readonly pending = computed(() => this.roles.pending() || this._reading());

  /** Why the last call was refused; `null` when it was not. */
  readonly refusal = this.roles.refusal;

  /** A change landed, but that person's sessions were not ended: the page offers the retry. */
  readonly sessionsPending = this.roles.sessionsPending;

  /** The roles were just saved — said once. */
  readonly saved = this._saved.asReadonly();

  /** The page opens on an account: what was pending is another account's no more. */
  open(userId: UserId | null): void {
    if (userId === untracked(this._userId)) return;
    this._userId.set(userId);
    this._saved.set(false);
    this.roles.reset();
  }

  /** A role's tick, turned — while the roles are the viewer's to change. */
  toggle(role: Role): void {
    if (
      this.accountStanding() !== AccountStanding.Editable ||
      this.pending() ||
      !this.ticks().includes(role)
    ) {
      return;
    }
    this._saved.set(false);
    this.ticked.update((ticked) =>
      ticked.includes(role)
        ? ticked.filter((held) => held !== role)
        : [...ticked, role],
    );
  }

  /** «Запази»: the ticks, as the set `RoleAssignmentSystem.teamRolesOf` answers. */
  async save(): Promise<boolean> {
    if (!this.canSave()) return false;
    const written = await this.send(this.ticked());
    if (written) this._saved.set(true);
    return written;
  }

  /** «Махни от екипа»: no tick at all — the account is a client again. `true` once it is gone. */
  remove(): Promise<boolean> {
    return this.accountStanding() === AccountStanding.Editable
      ? this.send([])
      : Promise.resolve(false);
  }

  /** «Опитай пак» after a change whose sessions were not ended. */
  endSessions(): Promise<boolean> {
    return this.roles.endSessions();
  }

  /** The receipt was read. */
  dismissSaved(): void {
    this._saved.set(false);
  }

  /**
   * One roles change for the account on the page, and the list read again
   * before the answer is given — so the page never shows the old roles
   * beside a change that landed.
   */
  private async send(ticked: readonly Role[]): Promise<boolean> {
    const account = this.account();
    if (account === null || this.pending()) return false;
    const call: RolesCall = {
      targetUserId: account.memberUserId,
      roles: RoleAssignmentSystem.teamRolesOf(account.memberRoles, ticked),
      // Taking «Бръснар» away clears the link on the server; nothing else touches it.
      ...BarberLinkRequest.KEEP,
    };
    this._reading.set(true);
    const written = await this.roles.send(call);
    if (written) await this.team.load();
    this._reading.set(false);
    return written;
  }
}
