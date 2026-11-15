import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  BarberLinkRequest,
  type Role,
  StaffLink,
  TeamMemberStatus,
} from '@core/components';
import type { BarberId, UserId } from '@core/primitives';
import { RoleAssignmentSystem, TeamRosterSystem } from '@core/systems';
import {
  AccountStateService,
  StaffAccessService,
} from '@creativo/features/client/account-state';
import { CLOCK_PORTS } from '@creativo/infrastructure/firebase-app';
import { AccountLookupStore } from '../account-lookup.store';
import { AccountPickSheet } from '../account-pick-sheet/account-pick-sheet';
import {
  LinkAnswer,
  type LinkQuestionVm,
  type LinkRowVm,
  type LinkVm,
} from '../link.vm';
import { roleAddQuestionVm, roleAddVm } from '../role-add.presenter';
import { TeamRolesStore } from '../team-roles.store';
import { TeamWording } from '../team-wording.service';
import { TeamStore } from '../team.store';

/** Whose account was given the role, and the barber record it signs in as (if any). */
export type TeamRoleAdded = {
  readonly userId: UserId;
  readonly barberId: BarberId | null;
};

/** The account picked, held while its question is up and its call is out. */
type PickedAccount = TeamRoleAdded & {
  readonly name: string;
  /** The account's stored roles, as the lookup or the Team list read them. */
  readonly storedRoles: readonly Role[];
};

/**
 * «ДОБАВИ В ЕКИПА» — a role given to a registered account (team onboarding
 * D8): the front desk, a content editor, an admin. Before anything is
 * typed the sheet offers the team's own people who do not hold the role —
 * a barber who also runs the front desk is one tap; a lookup (a name, a
 * phone, an email, read as the staff client search reads them) answers
 * the registered accounts. A row asks first: the change ends that person's
 * sessions, and the question says so.
 *
 * The sheet decides nothing. Who may take the role is
 * `RoleAssignmentSystem.additionCandidatesOf`'s answer over the lookup and
 * `TeamRosterSystem.additionCandidatesOf`'s over the team; what is sent is
 * `RoleAssignmentSystem.additionOf`; `setRoles` judges the call, through
 * the page's one roles sender. The Team list is read again before the
 * page is told, so the person's page opens on their new roles. What is
 * drawn is the shared lookup sheet. Mounted while it is open.
 */
@Component({
  selector: 'lib-team-role-sheet',
  imports: [AccountPickSheet, TranslocoDirective],
  providers: [AccountLookupStore],
  templateUrl: './team-role-sheet.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeamRoleSheet {
  private readonly roles = inject(TeamRolesStore);
  protected readonly lookup = inject(AccountLookupStore);
  private readonly team = inject(TeamStore);
  private readonly wording = inject(TeamWording);
  private readonly access = inject(StaffAccessService);
  private readonly account = inject(AccountStateService);
  /** The instant the sheet opened: a block is read against it. */
  private readonly openedAtUtcMs = inject(CLOCK_PORTS).nowUtcMs();

  /** The role being given. */
  readonly uiRole = input.required<Role>();
  /** The sheet is leaving: its close animation runs. */
  readonly uiClosing = input(false);
  /** ✕, Escape, the scrim. */
  readonly dismissed = output<void>();
  /** The close animation ended. */
  readonly closeFinished = output<void>();
  /** The role was given, and the Team list read again. */
  readonly added = output<TeamRoleAdded>();

  /** The account last picked: kept while its question leaves, so the words stay. */
  private readonly picked = signal<PickedAccount | null>(null);
  /** The question about it is up. */
  protected readonly questionOpen = signal(false);
  /** The Team list is being read after a change that landed. */
  private readonly reading = signal(false);

  /** A call is on its way, or the list is being read after one. */
  protected readonly pending = computed(
    () => this.roles.pending() || this.reading(),
  );

  /** The team's own people the role may be given to. */
  private readonly ours = computed(() =>
    TeamRosterSystem.additionCandidatesOf(
      this.team.members() ?? [],
      this.uiRole(),
      this.account.userId(),
    ),
  );

  /** Who of the lookup's answer the role may be given to. */
  private readonly found = computed(() => {
    const viewerUserId = this.account.userId();
    return viewerUserId === null
      ? []
      : RoleAssignmentSystem.additionCandidatesOf({
          viewerUserId,
          viewerRoles: this.access.storedRoles(),
          accounts: this.lookup.accounts(),
          role: this.uiRole(),
          nowUtcMs: this.openedAtUtcMs,
        });
  });

  protected readonly vm = computed<LinkVm | null>(() => {
    const words = this.wording.words();
    const roleAddWords = this.wording.roleAddWords();
    return words === null || roleAddWords === null
      ? null
      : roleAddVm({
          role: this.uiRole(),
          team: this.ours(),
          found: this.found(),
          asked: this.lookup.asked(),
          searching: this.lookup.searching(),
          failed: this.lookup.failed(),
          words,
          roleAddWords,
        });
  });

  /** The question about the account picked; `null` until one is. */
  protected readonly question = computed<LinkQuestionVm | null>(() => {
    const picked = this.picked();
    const words = this.wording.words();
    const roleAddWords = this.wording.roleAddWords();
    return picked === null || words === null || roleAddWords === null
      ? null
      : roleAddQuestionVm(picked.name, this.uiRole(), words, roleAddWords);
  });

  /** Why the change was refused, in the catalogue's words. */
  protected readonly refusal = computed(() => {
    const error = this.roles.refusal();
    return error === null ? null : this.wording.refusalOf(error);
  });

  constructor() {
    // A refusal the page still held is another opening's.
    this.roles.clearRefusal();
  }

  /** A row: the question goes up, with the account as it was read. */
  protected pick(row: LinkRowVm): void {
    const account = this.accountOf(row);
    if (account === null || this.pending()) return;
    this.picked.set(account);
    this.questionOpen.set(true);
  }

  /** The question answered: «Добави» sends the role, anything else lets it go. */
  protected async answer(linkAnswer: string): Promise<void> {
    const picked = this.picked();
    this.questionOpen.set(false);
    if (
      picked === null ||
      linkAnswer !== LinkAnswer.Confirm ||
      this.pending()
    ) {
      return;
    }
    this.reading.set(true);
    const written = await this.roles.send({
      targetUserId: picked.userId,
      roles: RoleAssignmentSystem.additionOf(picked.storedRoles, this.uiRole()),
      // The role sits beside whatever the account holds: its link is not asked about.
      ...BarberLinkRequest.KEEP,
    });
    if (written) await this.team.load();
    this.reading.set(false);
    if (written) {
      this.added.emit({ userId: picked.userId, barberId: picked.barberId });
    }
  }

  /** The account a row stands for, as the list that holds it read it. */
  private accountOf(row: LinkRowVm): PickedAccount | null {
    for (const account of this.found()) {
      if (account.id === row.userId) {
        return {
          userId: account.id,
          name: row.name,
          storedRoles: account.roles,
          barberId: StaffLink.of(account).linkedBarberId,
        };
      }
    }
    for (const member of this.ours()) {
      if (member.memberUserId === row.userId) {
        return {
          userId: member.memberUserId,
          name: row.name,
          storedRoles: member.memberRoles,
          barberId:
            member.teamMemberStatus === TeamMemberStatus.RoleOnly
              ? null
              : member.barberId,
        };
      }
    }
    return null;
  }
}
