import type { TeamMember } from '@core/components';
import type { User } from '@core/entities';
import { foundAccountRow, teamAccountRow } from './account-row.presenter';
import type { BarberAccountWords } from './barber-account.words';
import type { LinkVm } from './link.vm';
import type { TeamWords } from './team.words';

/*
 * «НОВ БРЪСНАР», THE ACCOUNT STEP, WORDED (Law 10; account first, A2): the
 * accounts a new barber may be made from and what the sheet says with
 * none. It decides nothing: who may be linked to a record is
 * `RoleAssignmentSystem.linkCandidatesOf`'s answer over a lookup and
 * `TeamRosterSystem.unlinkedOf`'s over the team, each handed in.
 */

/** What the account step is worded from. */
export type BarberAccountInput = {
  /** `TeamRosterSystem.unlinkedOf` — the team's own accounts with no record. */
  readonly unlinked: readonly TeamMember.RoleOnly[];
  /** `RoleAssignmentSystem.linkCandidatesOf` over the lookup's answer. */
  readonly found: readonly User[];
  /** A lookup is in force: its answer is on show, not the team's accounts. */
  readonly asked: boolean;
  readonly searching: boolean;
  readonly failed: boolean;
  readonly words: TeamWords;
  readonly barberAccountWords: BarberAccountWords;
};

/** The rows' test ids: `team-barber-account-<uid>`. */
const ROW = 'team-barber-account';

/** The account step: the lookup's answer while one is in force, else the team's own accounts. */
export function barberAccountVm(input: BarberAccountInput): LinkVm {
  const words = input.barberAccountWords;
  const named = input.words.roles;
  const rows = input.asked
    ? input.found.map((account) => foundAccountRow(account, named, ROW))
    : input.unlinked.map((member) => teamAccountRow(member, named, ROW));
  // Nothing to show, and no answer still on its way.
  const empty = rows.length === 0 && !(input.asked && input.searching);
  const foundNone = empty && input.asked && !input.failed;
  return {
    lede: words.lede,
    heading: !input.asked && rows.length > 0 ? words.team : null,
    rows,
    emptyTitle: foundNone ? words.noneTitle : '',
    emptyBody: !empty
      ? null
      : !input.asked
        ? words.hint
        : input.failed
          ? words.failed
          : words.none,
  };
}
