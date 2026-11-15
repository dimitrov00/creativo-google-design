import { type Role, StaffPermissions } from '@core/components';
import type { LevelLinkVm } from './member.vm';
import type { TeamWords } from './team.words';

/*
 * THE WAY TO «ПРАВА» FROM A PERSON'S PAGE, WORDED (Law 10; staff
 * permissions P10): one row per level an account holds, saying how far the
 * level departs from the standard. One copy for a barber record's page and
 * a staff account's. It decides nothing: which levels exist and how far
 * one departs are `StaffPermissions`' answers.
 */

/** What the level rows are worded from. */
export type LevelLinksInput = {
  /** The stored roles of the account whose levels are linked. */
  readonly roles: readonly Role[];
  /** The person looking edits «Права»: the way to a level's page is theirs. */
  readonly editsPermissions: boolean;
  /** The cells in force, for how far a level departs from the standard. */
  readonly permissions: StaffPermissions;
  readonly words: TeamWords;
  /** «Права на „Бръснар“» */
  readonly levelRow: (level: string) => string;
  /** What the rows' test ids start with: the page's own word. */
  readonly testIdPrefix: string;
};

/** The way to «Права» for each level the account holds; none for someone who does not edit them. */
export function levelLinks(input: LevelLinksInput): readonly LevelLinkVm[] {
  if (!input.editsPermissions) return [];
  const { words } = input;
  const links: LevelLinkVm[] = [];
  for (const level of StaffPermissions.LEVELS) {
    if (!input.roles.includes(level)) continue;
    const departures = StaffPermissions.departuresOf(input.permissions, level);
    links.push({
      level,
      label: input.levelRow(words.roles.get(level) ?? level),
      value:
        departures.length === 0
          ? words.standard
          : words.changes(departures.length),
      testId: `${input.testIdPrefix}-${level}`,
    });
  }
  return links;
}
