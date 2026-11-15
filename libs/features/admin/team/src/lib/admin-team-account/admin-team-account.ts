import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { UserId } from '@core/primitives';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { UiAvatar, UiButton, UiSkeleton } from '@creativo/ui/controls';
import { UiIcon } from '@creativo/ui/icons';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiPaddingDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiAlert,
  UiListGroup,
  UiListRow,
  UiNotice,
  UiPageActionBar,
  UiSectionHeader,
  UiSheetHeader,
  UiSheetHeadline,
  UiToast,
} from '@creativo/ui/patterns';
import { accountPageVm } from '../account.presenter';
import type { AccountPageVm } from '../account.vm';
import { LinkAnswer } from '../link.vm';
import { TeamAccountStore } from '../team-account.store';
import { TeamRolesStore } from '../team-roles.store';
import { TeamWording } from '../team-wording.service';
import { TeamStore } from '../team.store';

/**
 * A STAFF ACCOUNT'S PAGE (team onboarding D8; staff permissions P10): one
 * account that holds a staff role and is linked to no barber record — the
 * front desk, a content editor, an admin. Who it is, the staff roles it
 * holds as ticks the owner turns, the way to «Права» for each level it
 * holds, and the way off the team, behind a question.
 *
 * The ticks are a draft: «Запази» is in the dock only while the system
 * would send them. «Бръснар» is taken away here and given from a barber's
 * page, with «Свържи профил». Every change ends that person's sessions, and
 * the page says so. Someone who assigns no roles reads the page; so does
 * the owner on their own account.
 */
@Component({
  selector: 'lib-admin-team-account',
  imports: [
    RouterLink,
    TranslocoDirective,
    UiAlert,
    UiAvatar,
    UiButton,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiNotice,
    UiPaddingDirective,
    UiPageActionBar,
    UiSectionHeader,
    UiSheetHeader,
    UiSheetHeadline,
    UiSkeleton,
    UiTextDirective,
    UiToast,
  ],
  providers: [TeamRolesStore, TeamAccountStore],
  templateUrl: './admin-team-account.html',
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `team-page`-prefixed.
  encapsulation: ViewEncapsulation.None,
})
export class AdminTeamAccount {
  protected readonly store = inject(TeamAccountStore);
  private readonly team = inject(TeamStore);
  private readonly access = inject(StaffAccessService);
  private readonly wording = inject(TeamWording);
  private readonly router = inject(Router);

  /** The route's `:userId` — bound by the router (`withComponentInputBinding`). */
  readonly userId = input<string | undefined>(undefined);

  /** The «Махни от екипа» question is up. */
  protected readonly removeOpen = signal(false);

  /** The Team list is read and holds no such account: the page says so. */
  protected readonly missing = computed(
    () => this.store.known() && this.store.account() === null,
  );

  protected readonly vm = computed<AccountPageVm | null>(() => {
    const words = this.wording.words();
    const memberWords = this.wording.memberWords();
    const accountWords = this.wording.accountWords();
    const account = this.store.account();
    if (
      words === null ||
      memberWords === null ||
      accountWords === null ||
      account === null
    ) {
      return null;
    }
    return accountPageVm({
      account,
      accountStanding: this.store.accountStanding(),
      ticks: this.store.ticks(),
      ticked: this.store.ticked(),
      editsPermissions: this.access.editsPermissions(),
      permissions: this.access.permissions(),
      words,
      memberWords,
      accountWords,
    });
  });

  /** Why the last call was refused, in the catalogue's words. */
  protected readonly refusal = computed(() => {
    const error = this.store.refusal();
    return error === null ? null : this.wording.refusalOf(error);
  });

  constructor() {
    // The account is the Team list's row: read it again, so a page opened
    // from a link is as fresh as one opened from the list.
    void this.team.load();
    // The route names the account; the store's own signals are not read here.
    effect(() => {
      const raw = this.userId();
      const parsed = raw === undefined ? null : UserId.parse(raw);
      untracked(() =>
        this.store.open(parsed !== null && parsed.ok ? parsed.value : null),
      );
    });
  }

  protected save(): void {
    void this.store.save();
  }

  /** «Опитай пак»: the change again, so the person's sessions are ended. */
  protected endSessions(): void {
    void this.store.endSessions();
  }

  /** The «Махни от екипа» question answered. */
  protected async onRemovePick(answer: string): Promise<void> {
    this.removeOpen.set(false);
    if (answer !== LinkAnswer.Confirm) return;
    if (await this.store.remove()) {
      void this.router.navigate(['/admin/team']);
    }
  }
}
