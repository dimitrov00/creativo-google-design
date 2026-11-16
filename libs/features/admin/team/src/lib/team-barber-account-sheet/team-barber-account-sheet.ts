import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import type { Role } from '@core/components';
import type { UserId } from '@core/primitives';
import { RoleAssignmentSystem, TeamRosterSystem } from '@core/systems';
import {
  AccountStateService,
  StaffAccessService,
} from '@creativo/features/client/account-state';
import { CLOCK_PORTS } from '@creativo/infrastructure/firebase-app';
import { AccountLookupStore } from '../account-lookup.store';
import { AccountPickSheet } from '../account-pick-sheet/account-pick-sheet';
import { barberAccountVm } from '../barber-account.presenter';
import type { LinkRowVm, LinkVm } from '../link.vm';
import { TeamWording } from '../team-wording.service';
import { TeamStore } from '../team.store';

/** The account a new barber is made from: who, as the row named them, and what they hold. */
export type BarberAccountPick = {
  readonly userId: UserId;
  readonly name: string;
  /** The account's stored roles, as the lookup or the Team list read them. */
  readonly storedRoles: readonly Role[];
};

/**
 * «НОВ БРЪСНАР», THE ACCOUNT STEP (account first, A2 —
 * `docs/architecture/decisions/2026-11-16-account-first-team.md`): the
 * Team page's ＋ «Бръснар» asks for the person's account FIRST, the way
 * GitLab adds a member — the team's own accounts with no record, or a
 * lookup by name, phone or email — with «Без профил в приложението» on
 * top for someone who will never sign in.
 *
 * It is the one account sheet (`lib-account-pick-sheet`) over the same
 * lookup «Свържи профил» uses; who may be picked is
 * `RoleAssignmentSystem.linkCandidatesOf` (a record's account: registered,
 * not blocked, linked to no record yet). A pick asks nothing: the add
 * sheet that follows, with the account named, is the question.
 */
@Component({
  selector: 'lib-team-barber-account-sheet',
  imports: [AccountPickSheet, TranslocoDirective],
  providers: [AccountLookupStore],
  template: `
    @if (wording.barberAccountWords(); as words) {
      <lib-account-pick-sheet
        uiSheetId="team-barber-account"
        [uiTitle]="words.title"
        [uiVm]="vm()"
        [uiSkipLabel]="words.skip"
        [uiSearching]="lookup.searching()"
        [uiClosing]="uiClosing()"
        (queried)="lookup.ask($event)"
        (picked)="pick($event)"
        (skipped)="chosen.emit(null)"
        (dismissed)="dismissed.emit()"
        (closeFinished)="closeFinished.emit()"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeamBarberAccountSheet {
  protected readonly lookup = inject(AccountLookupStore);
  protected readonly wording = inject(TeamWording);
  private readonly team = inject(TeamStore);
  private readonly access = inject(StaffAccessService);
  private readonly session = inject(AccountStateService);
  /** The instant the sheet opened: a block is read against it. */
  private readonly openedAtUtcMs = inject(CLOCK_PORTS).nowUtcMs();

  /** The sheet is leaving: its close animation runs. */
  readonly uiClosing = input(false);
  /** The account picked, or `null` for «Без профил в приложението». */
  readonly chosen = output<BarberAccountPick | null>();
  /** ✕, Escape, the scrim. */
  readonly dismissed = output<void>();
  /** The close animation ended. */
  readonly closeFinished = output<void>();

  /** The team's own accounts with no record. */
  private readonly ours = computed(() =>
    TeamRosterSystem.unlinkedOf(
      this.team.members() ?? [],
      this.session.userId(),
    ),
  );

  /** Who of the lookup's answer a record may be linked to. */
  private readonly found = computed(() => {
    const viewerUserId = this.session.userId();
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
    const barberAccountWords = this.wording.barberAccountWords();
    return words === null || barberAccountWords === null
      ? null
      : barberAccountVm({
          unlinked: this.ours(),
          found: this.found(),
          asked: this.lookup.asked(),
          searching: this.lookup.searching(),
          failed: this.lookup.failed(),
          words,
          barberAccountWords,
        });
  });

  /** A row pressed: the account it names, as the add sheet will hold it. */
  protected pick(row: LinkRowVm): void {
    for (const account of this.found()) {
      if (account.id === row.userId) {
        this.chosen.emit({
          userId: account.id,
          name: row.name,
          storedRoles: account.roles,
        });
        return;
      }
    }
    for (const member of this.ours()) {
      if (member.memberUserId === row.userId) {
        this.chosen.emit({
          userId: member.memberUserId,
          name: row.name,
          storedRoles: member.memberRoles,
        });
        return;
      }
    }
  }
}
