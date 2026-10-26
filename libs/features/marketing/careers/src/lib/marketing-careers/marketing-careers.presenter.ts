import { LocalizedText } from '@core/components';
import type { Position, ShopLocation } from '@core/entities';
import type { RepositoryError } from '@core/errors';
import { Locale, type Result, Tag } from '@core/primitives';
import { ProgramsSystem } from '@core/systems';
import {
  type NamedShop,
  namedShopsOf,
} from '@creativo/features/shared/catalog';
import type { PositionRowVm } from './marketing-careers.vm';

/*
 * THE CAREERS PAGE'S WORDS (OR-42, Law 10) — the roles as read in, the rows
 * `/careers` prints out. It decides nothing: which roles exist and their
 * order are the read's (open roles, `sortOrder`), the shops a role is open
 * at are `ProgramsSystem.positionShops`' (none of its own for a role open
 * at every shop), and whether there are shops to tell apart is
 * `LocationScopeSystem.isMultiShop`'s. It words the title and the summary
 * in the active language and the shops by the names a line that already
 * knows the business calls them (`namedShopsOf`, the one shop-name wording
 * of the programs pages), joined « · ».
 *
 * The shops are named ONCE per emission. Unread or failed, they name
 * nothing: each row prints without its shops line, and no row is ever
 * hidden for it.
 */

/** What the careers page's rows are worded from. */
export type PositionRowsInput = {
  /** The open roles, in the read's order. */
  readonly positions: readonly Position[];
  /** The ACTIVE shops as read — `undefined` until they answer. */
  readonly shops: Result<readonly ShopLocation[], RepositoryError> | undefined;
  /** The active UI language (`bg` | `en`; anything else reads its data as `bg`). */
  readonly lang: string;
  /** Where a row with no apply link of its own leads — the shop's Instagram. */
  readonly fallbackHref: string;
};

/** «Център · Младост» — the role's shops among `named`, or `null` when it names none of them. */
function shopsLineOf(
  position: Position,
  named: readonly NamedShop[],
): string | null {
  let line: string | null = null;
  for (const shop of ProgramsSystem.positionShops(position, named)) {
    line = line === null ? shop.name : `${line} · ${shop.name}`;
  }
  return line;
}

/** Every role's row, in the read's order. */
export function positionRowsVm(
  input: PositionRowsInput,
): readonly PositionRowVm[] {
  const locale = Tag.or(Locale, input.lang, Locale.Bg);
  const named = namedShopsOf(input.shops, locale);
  const rows: PositionRowVm[] = [];
  for (const position of input.positions) {
    rows.push({
      id: position.id,
      title: LocalizedText.pick(position.title, locale),
      summary: LocalizedText.pick(position.summary, locale),
      shopsLine: shopsLineOf(position, named),
      href: position.applyUrl ?? input.fallbackHref,
      positionStatus: position.positionStatus,
    });
  }
  return rows;
}
