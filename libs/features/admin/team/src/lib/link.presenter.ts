import { LocalizedText, type TeamMember } from '@core/components';
import type { Barber, User } from '@core/entities';
import type { Locale } from '@core/primitives';
import { foundAccountRow, teamAccountRow } from './account-row.presenter';
import type { LinkVm } from './link.vm';
import type { LinkWords } from './link.words';
import { firstWord } from './team.format';
import type { TeamWords } from './team.words';

/*
 * «СВЪРЖИ ПРОФИЛ», WORDED (Law 10): the accounts a record may be linked to
 * and the record in; the rows a template prints out. It decides nothing.
 * Who may be linked is `RoleAssignmentSystem.linkCandidatesOf`'s answer
 * over a lookup and `TeamRosterSystem.unlinkedOf`'s over the team, each
 * handed in; which of the two is on show is the sheet's own state (a
 * lookup is in force, or not).
 *
 * Its rows word a phone (`account-row.presenter.ts`), so it carries the
 * phone rules: only the sheet, which loads when it is first asked for,
 * imports this file. The questions the member's page asks are in
 * `link-question.presenter.ts`.
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

/** The rows' test ids: `member-link-<uid>`. */
const ROW = 'member-link';

/** «Свържи профил»: the lookup's answer while one is in force, else the team's own accounts. */
export function linkVm(input: LinkInput): LinkVm {
  const { linkWords } = input;
  const name = firstWord(LocalizedText.pick(input.barber.name, input.locale));
  const named = input.words.roles;
  const rows = input.asked
    ? input.found.map((account) => foundAccountRow(account, named, ROW))
    : input.unlinked.map((member) => teamAccountRow(member, named, ROW));
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
