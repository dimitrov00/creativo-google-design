import type { Role, TeamMember } from '@core/components';
import type { User } from '@core/entities';
import { foundAccountRow, teamAccountRow } from './account-row.presenter';
import { LinkAnswer, type LinkQuestionVm, type LinkVm } from './link.vm';
import type { RoleAddWords } from './role-add.words';
import { firstWord } from './team.format';
import type { TeamWords } from './team.words';

/*
 * «ДОБАВИ В ЕКИПА», WORDED (Law 10): the accounts a role may be given to
 * and the role in; the rows a template prints and the question a row asks
 * out. It decides nothing. Who may take the role is
 * `RoleAssignmentSystem.additionCandidatesOf`'s answer over a lookup and
 * `TeamRosterSystem.additionCandidatesOf`'s over the team, each handed in;
 * which of the two is on show is the sheet's own state (a lookup is in
 * force, or not).
 *
 * Its rows word a phone (`account-row.presenter.ts`), so it carries the
 * phone rules: only the sheet, which loads when it is first asked for,
 * imports this file.
 */

/** The rows' test ids: `team-role-<uid>`. */
const ROW = 'team-role';

/** What «Добави в екипа» is worded from. */
export type RoleAddInput = {
  /** The role being given. */
  readonly role: Role;
  /** `TeamRosterSystem.additionCandidatesOf` — the team's own accounts that do not hold it. */
  readonly team: readonly TeamMember.WithAccount[];
  /** `RoleAssignmentSystem.additionCandidatesOf` over the lookup's answer. */
  readonly found: readonly User[];
  /** A lookup is in force: its answer is on show, not the team's accounts. */
  readonly asked: boolean;
  /** The lookup in force has not answered yet. */
  readonly searching: boolean;
  /** The lookup in force could not be read. */
  readonly failed: boolean;
  readonly words: TeamWords;
  readonly roleAddWords: RoleAddWords;
};

/** The role's own name, as every Team screen says it. */
function roleWord(role: Role, words: TeamWords): string {
  return words.roles.get(role) ?? role;
}

/** «Добави в екипа»: the lookup's answer while one is in force, else the team's own accounts. */
export function roleAddVm(input: RoleAddInput): LinkVm {
  const { roleAddWords } = input;
  const named = input.words.roles;
  const rows = input.asked
    ? input.found.map((account) => foundAccountRow(account, named, ROW))
    : input.team.map((member) => teamAccountRow(member, named, ROW));
  // Nothing to show, and no answer still on its way.
  const empty = rows.length === 0 && !(input.asked && input.searching);
  const foundNone = empty && input.asked && !input.failed;
  return {
    lede: roleAddWords.lede(roleWord(input.role, input.words)),
    heading: !input.asked && rows.length > 0 ? roleAddWords.team : null,
    rows,
    emptyTitle: foundNone ? roleAddWords.noneTitle : '',
    emptyBody: !empty
      ? null
      : !input.asked
        ? roleAddWords.hint
        : input.failed
          ? roleAddWords.failed
          : roleAddWords.none,
  };
}

/** The question before `accountName`'s account is given `role`. */
export function roleAddQuestionVm(
  accountName: string,
  role: Role,
  words: TeamWords,
  roleAddWords: RoleAddWords,
): LinkQuestionVm {
  const message = roleAddWords.messages.get(role) ?? roleAddWords.message;
  return {
    title: roleAddWords.questionTitle(accountName, roleWord(role, words)),
    message: message(firstWord(accountName)),
    actions: [
      {
        id: LinkAnswer.Confirm,
        label: roleAddWords.addLabel,
        role: 'default',
        testId: 'team-role-confirm',
      },
      {
        id: LinkAnswer.Cancel,
        label: roleAddWords.cancel,
        role: 'cancel',
        testId: 'team-role-cancel',
      },
    ],
  };
}
