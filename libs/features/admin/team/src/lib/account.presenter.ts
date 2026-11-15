import {
  AccountStanding,
  Role,
  type StaffPermissions,
  type TeamMember,
} from '@core/components';
import type { AccountPageVm, RoleTickVm } from './account.vm';
import type { AccountWords } from './account.words';
import { levelLinks } from './levels.presenter';
import { LinkAnswer, type LinkQuestionVm } from './link.vm';
import type { MemberWords } from './member.words';
import { firstWord, rolesLine } from './team.format';
import type { TeamWords } from './team.words';

/*
 * A STAFF ACCOUNT'S PAGE, WORDED (Law 10; team onboarding D8): the Team
 * list's row for the account and the ticks as drafted in; the rows a
 * template prints out. It decides nothing. What the page is to the person
 * looking is `TeamRosterSystem.accountStandingOf`'s answer, which roles
 * are offered is `RoleAssignmentSystem.teamTicksOf`'s, each handed in.
 */

/** What an account's page is worded from. */
export type AccountPageInput = {
  readonly account: TeamMember.RoleOnly;
  /** `TeamRosterSystem.accountStandingOf` for the person looking. */
  readonly accountStanding: AccountStanding;
  /** `RoleAssignmentSystem.teamTicksOf` — the staff roles offered as ticks. */
  readonly ticks: readonly Role[];
  /** The ticks as drafted. */
  readonly ticked: readonly Role[];
  /** The person looking edits «Права»: the way to a level's page is theirs. */
  readonly editsPermissions: boolean;
  /** The cells in force, for how far a level departs from the standard. */
  readonly permissions: StaffPermissions;
  readonly words: TeamWords;
  readonly memberWords: MemberWords;
  readonly accountWords: AccountWords;
};

/** The ticks on show: every one offered when they take presses, else the ones on. */
function ticksOf(
  input: AccountPageInput,
  editable: boolean,
): readonly RoleTickVm[] {
  const ticks: RoleTickVm[] = [];
  for (const role of input.ticks) {
    const checked = input.ticked.includes(role);
    if (!editable && !checked) continue;
    ticks.push({
      role,
      label: input.words.roles.get(role) ?? role,
      checked,
      testId: `account-role-${role}`,
    });
  }
  return ticks;
}

/** The quiet lines under the roles. */
function notesOf(
  input: AccountPageInput,
  editable: boolean,
  name: string,
): readonly string[] {
  const { accountWords } = input;
  if (!editable) {
    const why = accountWords.standing.get(input.accountStanding);
    return why === undefined ? [] : [why];
  }
  return [
    ...(input.ticked.length === 0 ? [accountWords.noneTicked] : []),
    accountWords.sessionsNote(firstWord(name)),
    // «Бръснар» is given from a barber's page: said where it is not a tick.
    ...(input.ticks.includes(Role.Barber) ? [] : [accountWords.barberNote]),
  ];
}

/** The question before the account leaves the team. */
function removeQuestion(name: string, words: AccountWords): LinkQuestionVm {
  return {
    title: words.removeTitle(name),
    message: words.removeMessage(firstWord(name)),
    actions: [
      {
        id: LinkAnswer.Confirm,
        label: words.removeLabel,
        role: 'default',
        testId: 'account-remove-confirm',
      },
      {
        id: LinkAnswer.Cancel,
        label: words.cancel,
        role: 'cancel',
        testId: 'account-remove-cancel',
      },
    ],
  };
}

/** A staff account's page: the head, the roles, the way to «Права», the way off the team. */
export function accountPageVm(input: AccountPageInput): AccountPageVm {
  const { account, accountWords } = input;
  const editable = input.accountStanding === AccountStanding.Editable;
  const name =
    account.memberAccountName.length === 0
      ? accountWords.unnamed
      : account.memberAccountName;
  return {
    userId: account.memberUserId,
    name,
    line: rolesLine(account.memberRoles, input.words.roles),
    editable,
    ticks: ticksOf(input, editable),
    notes: notesOf(input, editable, name),
    levels: levelLinks({
      roles: account.memberRoles,
      editsPermissions: input.editsPermissions,
      permissions: input.permissions,
      words: input.words,
      levelRow: input.memberWords.levelRow,
      testIdPrefix: 'account-level',
    }),
    remove: editable ? removeQuestion(name, accountWords) : null,
  };
}
