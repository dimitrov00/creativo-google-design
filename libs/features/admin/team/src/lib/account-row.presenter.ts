import type { Role, TeamMember } from '@core/components';
import { Profile, type User } from '@core/entities';
import { PhoneSystem } from '@core/systems';
import type { LinkRowVm } from './link.vm';
import { factsLine, rolesLine } from './team.format';

/*
 * AN ACCOUNT AS A ROW OF A LOOKUP SHEET, WORDED (Law 10): a face, a name
 * and one quiet line — for «Свържи профил» and «Добави в екипа» alike. It
 * decides nothing: which accounts are on show is a system's answer, handed
 * to the sheet's own presenter.
 *
 * It words a phone, so it carries the phone rules: only the lookup sheets,
 * which load when they are first asked for, import this file.
 */

/** An account a lookup found: its name, the contact it is told apart by, its staff roles. */
export function foundAccountRow(
  account: User,
  named: ReadonlyMap<Role, string>,
  testIdPrefix: string,
): LinkRowVm {
  const contact =
    account.phone === null
      ? (account.email ?? '')
      : PhoneSystem.formatInternational(account.phone);
  return {
    userId: account.id,
    name: Profile.fullName(account),
    line: factsLine([contact, rolesLine(account.roles, named)]),
    testId: `${testIdPrefix}-${account.id}`,
  };
}

/** One of the team's own accounts: its name and its roles — the Team list holds no contact. */
export function teamAccountRow(
  member: TeamMember.WithAccount,
  named: ReadonlyMap<Role, string>,
  testIdPrefix: string,
): LinkRowVm {
  return {
    userId: member.memberUserId,
    name: member.memberAccountName,
    line: factsLine([rolesLine(member.memberRoles, named)]),
    testId: `${testIdPrefix}-${member.memberUserId}`,
  };
}
