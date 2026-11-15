import { LocalizedText, type Role, type TeamMember } from '@core/components';
import { type Barber, Profile, type User } from '@core/entities';
import type { Locale } from '@core/primitives';
import { PhoneSystem } from '@core/systems';
import type { LinkRowVm, LinkVm } from './link.vm';
import type { LinkWords } from './link.words';
import { firstWord, lineOf } from './team.format';
import type { TeamWords } from './team.words';

/*
 * «СВЪРЖИ ПРОФИЛ», WORDED (Law 10): the accounts a record may be linked to
 * and the record in; the rows a template prints out. It decides nothing.
 * Who may be linked is `RoleAssignmentSystem.linkCandidatesOf`'s answer
 * over a lookup and `TeamRosterSystem.unlinkedOf`'s over the team, each
 * handed in; which of the two is on show is the sheet's own state (a
 * lookup is in force, or not).
 *
 * It words a phone, so it carries the phone rules: only the sheet, which
 * loads when it is first asked for, imports this file. The questions the
 * member's page asks are in `link-question.presenter.ts`.
 */

/** What «Свържи профил» is worded from. */
export type LinkInput = {
  readonly barber: Barber;
  /** `TeamRosterSystem.unlinkedOf` — the team's own accounts with no record. */
  readonly unlinked: readonly TeamMember.RoleOnly[];
  /** `RoleAssignmentSystem.linkCandidatesOf` over the lookup's answer. */
  readonly found: readonly User[];
  /** A lookup is in force: its answer is on show, not the team's accounts. */
  readonly asked: boolean;
  /** The lookup in force has not answered yet. */
  readonly searching: boolean;
  /** The lookup in force could not be read. */
  readonly failed: boolean;
  readonly words: TeamWords;
  readonly linkWords: LinkWords;
  readonly locale: Locale;
};

/** «Рецепция, Съдържание» — the staff roles a row may name, in its order. */
function rolesLine(roles: readonly Role[], words: TeamWords): string {
  const named: string[] = [];
  for (const [role, word] of words.roles) {
    if (roles.includes(role)) named.push(word);
  }
  return named.join(', ');
}

/** A quiet line of the facts that are there; `null` for none. */
function factsLine(facts: readonly string[]): string | null {
  const said = facts.filter((fact) => fact.length > 0);
  return said.length === 0 ? null : lineOf(said);
}

/** An account a lookup found: its name, the contact it is told apart by, its staff roles. */
function foundRow(account: User, input: LinkInput): LinkRowVm {
  const contact =
    account.phone === null
      ? (account.email ?? '')
      : PhoneSystem.formatInternational(account.phone);
  return {
    userId: account.id,
    name: Profile.fullName(account),
    line: factsLine([contact, rolesLine(account.roles, input.words)]),
    testId: `member-link-${account.id}`,
  };
}

/** One of the team's own accounts: its name and its roles — the Team list holds no contact. */
function teamRow(member: TeamMember.RoleOnly, input: LinkInput): LinkRowVm {
  return {
    userId: member.memberUserId,
    name: member.memberAccountName,
    line: factsLine([rolesLine(member.memberRoles, input.words)]),
    testId: `member-link-${member.memberUserId}`,
  };
}

/** «Свържи профил»: the lookup's answer while one is in force, else the team's own accounts. */
export function linkVm(input: LinkInput): LinkVm {
  const { linkWords } = input;
  const name = firstWord(LocalizedText.pick(input.barber.name, input.locale));
  const rows = input.asked
    ? input.found.map((account) => foundRow(account, input))
    : input.unlinked.map((member) => teamRow(member, input));
  // Nothing to show, and no answer still on its way.
  const empty = rows.length === 0 && !(input.asked && input.searching);
  const foundNone = empty && input.asked && !input.failed;
  return {
    lede: linkWords.lede(name),
    heading: !input.asked && rows.length > 0 ? linkWords.team : null,
    rows,
    emptyTitle: foundNone ? linkWords.noneTitle : '',
    emptyBody: !empty
      ? null
      : !input.asked
        ? linkWords.hint(name)
        : input.failed
          ? linkWords.failed
          : linkWords.none(name),
  };
}
