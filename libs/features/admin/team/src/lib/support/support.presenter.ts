import type { User } from '@core/entities';
import { foundAccountRow } from '../account-row.presenter';
import type { LinkVm } from '../link.vm';
import type { TeamWords } from '../team.words';
import type { SupportWords } from './support.words';

export type SupportLookupInput = {
  /** The lookup's answer, as `AccountLookupStore` holds it. */
  readonly found: readonly User[];
  /** A lookup is in force. */
  readonly asked: boolean;
  /** The lookup in force has not answered yet. */
  readonly searching: boolean;
  /** The lookup in force could not be read. */
  readonly failed: boolean;
  readonly words: TeamWords;
  readonly supportWords: SupportWords;
};

const ROW = 'support-account';

/**
 * THE ACCOUNTS SUPPORT MAY READ AS (OR-24), as the one lookup sheet prints
 * them: each found account as the Team's lookup rows are worded (name, then
 * the contact it was found by and its staff roles). Decides nothing: which
 * account may be read as is the server's (`startImpersonation` refuses
 * oneself, an erased account and one that never registered).
 */
export function supportLookupVm(input: SupportLookupInput): LinkVm {
  const { supportWords } = input;
  const rows = input.found.map((account) =>
    foundAccountRow(account, input.words.roles, ROW),
  );
  const empty = rows.length === 0 && !(input.asked && input.searching);
  const foundNone = empty && input.asked && !input.failed;
  return {
    lede: supportWords.lookupLede,
    heading: null,
    rows,
    emptyTitle: foundNone ? supportWords.noneTitle : '',
    emptyBody: !empty
      ? null
      : !input.asked
        ? supportWords.hint
        : input.failed
          ? supportWords.failed
          : supportWords.none,
  };
}
