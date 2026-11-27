import { LocalizedText, WorkplaceMode } from '@core/components';
import type { Position, PositionBody, ShopLocation } from '@core/entities';
import type { RepositoryError } from '@core/errors';
import { type Result } from '@core/primitives';
import { ProgramsSystem, RichTextSystem } from '@core/systems';
import {
  contactRowVm,
  type ContactSheetVm,
  type NamedShop,
  namedShopsOf,
} from '@creativo/features/shared/catalog';
import type { PositionRowVm } from './marketing-careers.vm';
import { localeFor } from '@creativo/infrastructure/i18n';

/*
 * THE CAREERS PAGE'S WORDS (OR-42, Law 10) — the roles as read in, the rows
 * `/careers` prints out. It decides nothing: which roles exist and their
 * order are the read's (open roles, `sortOrder`), the shops a role is open
 * at are `ProgramsSystem.positionShops`' (none of its own for a role open
 * at every shop), and whether there are shops to tell apart is
 * `LocationScopeSystem.isMultiShop`'s. It words the title and the summary
 * in the active language and the shops by the names a line that already
 * knows the business calls them (`namedShopsOf`, the one shop-name wording
 * of the programs pages), joined « · », and hands on the workplace tag a
 * row words — none for an on-site role, whose shops say where it is.
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
  const locale = localeFor(input.lang);
  const named = namedShopsOf(input.shops, locale);
  const rows: PositionRowVm[] = [];
  for (const position of input.positions) {
    rows.push({
      id: position.id,
      title: LocalizedText.pick(position.title, locale),
      summary: LocalizedText.pick(position.summary, locale),
      shopsLine: shopsLineOf(position, named),
      workplaceTag:
        position.workplaceMode === WorkplaceMode.OnSite
          ? null
          : position.workplaceMode,
      contact: contactRowVm(position.contacts, input.fallbackHref),
    });
  }
  return rows;
}

/** What an opened role's sheet is worded from. */
export type PositionSheetInput = {
  /** The row that was tapped. */
  readonly row: PositionRowVm;
  /** The role's description as read — `null` for none, or until it answers. */
  readonly body: PositionBody | null;
  /** The active UI language. */
  readonly lang: string;
};

/**
 * An opened role as its sheet prints it: the row's own words, and its
 * description in the active language as the blocks `RichTextSystem` reads
 * from it — `null` for a role with none.
 */
export function positionSheetVm(input: PositionSheetInput): ContactSheetVm {
  const { row, body } = input;
  return {
    title: row.title,
    summary: row.summary,
    workplaceTag: row.workplaceTag,
    shopsLine: row.shopsLine,
    body:
      body === null
        ? null
        : RichTextSystem.parse(
            LocalizedText.pick(body.body, localeFor(input.lang)),
          ),
    contacts: row.contact.contacts,
  };
}
