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
import type { Role } from '@core/components';
import type { Barber } from '@core/entities';
import type { UserId } from '@core/primitives';
import { RoleAssignmentSystem } from '@core/systems';
import {
  AccountStateService,
  StaffAccessService,
} from '@creativo/features/client/account-state';
import { CLOCK_PORTS } from '@creativo/infrastructure/firebase-app';
import { AccountLookupStore } from '../account-lookup.store';
import { AccountPickSheet } from '../account-pick-sheet/account-pick-sheet';
import { linkQuestionVm } from '../link-question.presenter';
import { linkVm } from '../link.presenter';
import {
  LinkAnswer,
  type LinkQuestionVm,
  type LinkRowVm,
  type LinkVm,
} from '../link.vm';
import { TeamMemberStore } from '../team-member.store';
import { TeamWording } from '../team-wording.service';

/** The account picked, held while its question is up. */
type PickedAccount = {
  readonly userId: UserId;
  readonly name: string;
  /** The account's stored roles, as the lookup or the Team list read them. */
  readonly storedRoles: readonly Role[];
};

/**
 * «СВЪРЖИ ПРОФИЛ» — whose account a barber record is (team onboarding D8):
 * the person signs in with it and the schedule knows their chair. Before
 * anything is typed the sheet offers the team's own accounts that have no
 * record; a lookup — a name, a phone, an email, read as the staff client
 * search reads them — answers the registered accounts. A row asks first:
 * linking ends that person's sessions, and the question says so.
 *
 * The sheet decides nothing. Who may be linked is
 * `RoleAssignmentSystem.linkCandidatesOf`'s answer over the lookup and
 * `TeamRosterSystem.unlinkedOf`'s over the team; `setRoles` judges the
 * call. What is drawn is the shared lookup sheet (`lib-account-pick-sheet`).
 * Mounted while it is open.
 */
@Component({
  selector: 'lib-member-link-sheet',
  imports: [AccountPickSheet, TranslocoDirective],
  providers: [AccountLookupStore],
  templateUrl: './member-link-sheet.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemberLinkSheet {
  protected readonly store = inject(TeamMemberStore);
  protected readonly lookup = inject(AccountLookupStore);
  private readonly wording = inject(TeamWording);
  private readonly access = inject(StaffAccessService);
  private readonly account = inject(AccountStateService);
  /** The instant the sheet opened: a block is read against it. */
  private readonly openedAtUtcMs = inject(CLOCK_PORTS).nowUtcMs();

  /** The record an account is linked to. */
  readonly uiBarber = input.required<Barber>();
  /** The sheet is leaving: its close animation runs. */
  readonly uiClosing = input(false);
  /** ✕, Escape, the scrim — or a link that landed. */
  readonly dismissed = output<void>();
  /** The close animation ended. */
  readonly closeFinished = output<void>();

  /** The account last picked: kept while its question leaves, so the words stay. */
  private readonly picked = signal<PickedAccount | null>(null);
  /** The question about it is up. */
  protected readonly questionOpen = signal(false);

  /** Who of the lookup's answer the record may be linked to. */
  private readonly found = computed(() => {
    const viewerUserId = this.account.userId();
    return viewerUserId === null
      ? []
      : RoleAssignmentSystem.linkCandidatesOf({
          viewerUserId,
          viewerRoles: this.access.storedRoles(),
          accounts: this.lookup.accounts(),
          nowUtcMs: this.openedAtUtcMs,
        });
  });

  protected readonly vm = computed<LinkVm | null>(() => {
    const words = this.wording.words();
    const linkWords = this.wording.linkWords();
    return words === null || linkWords === null
      ? null
      : linkVm({
          barber: this.uiBarber(),
          unlinked: this.store.unlinked(),
          found: this.found(),
          asked: this.lookup.asked(),
          searching: this.lookup.searching(),
          failed: this.lookup.failed(),
          words,
          linkWords,
          locale: this.wording.locale(),
        });
  });

  /** The question about the account picked; `null` until one is.  */
  protected readonly question = computed<LinkQuestionVm | null>(() => {
    const picked = this.picked();
    const linkWords = this.wording.linkWords();
    return picked === null || linkWords === null
      ? null
      : linkQuestionVm(
          picked.name,
          this.uiBarber(),
          linkWords,
          this.wording.locale(),
        );
  });

  /** Why the link was refused, in the catalogue's words. */
  protected readonly refusal = computed(() => {
    const error = this.store.refusal();
    return error === null ? null : this.wording.refusalOf(error);
  });

  /** A row: the question goes up, with the account as it was read. */
  protected pick(row: LinkRowVm): void {
    const storedRoles = this.storedRolesOf(row.userId);
    if (storedRoles === null || this.store.pending()) return;
    this.picked.set({ userId: row.userId, name: row.name, storedRoles });
    this.questionOpen.set(true);
  }

  /** The question answered: «Свържи» sends the link, anything else lets it go. */
  protected async answer(linkAnswer: string): Promise<void> {
    const picked = this.picked();
    this.questionOpen.set(false);
    if (picked === null || linkAnswer !== LinkAnswer.Confirm) return;
    if (await this.store.linkAccount(picked.userId, picked.storedRoles)) {
      this.dismissed.emit();
    }
  }

  /** The stored roles of an account on show, from the list that holds it. */
  private storedRolesOf(userId: UserId): readonly Role[] | null {
    for (const account of this.found()) {
      if (account.id === userId) return account.roles;
    }
    for (const member of this.store.unlinked()) {
      if (member.memberUserId === userId) return member.memberRoles;
    }
    return null;
  }
}
