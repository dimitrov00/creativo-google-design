import type { RepositoryError } from '@core/errors';
import type { E164 } from '@core/components';
import { type Customer, Profile, type User } from '@core/entities';
import { DraftPersonKey, type Result } from '@core/primitives';
import { PhoneSystem } from '@core/systems';
import type { VisitEditorClientOption } from './staff-visit-editor';

/**
 * THE INDEX'S ANSWERS AS THE ADD-CLIENT PAGE'S PEOPLE (OR-26). Each key the
 * omnibox asks (`clientLookupKeys`) goes to two indexes at once: the
 * accounts (`users`, index #8) and the shop's client RECORDS (`customers`),
 * where a walk-in the desk entered lives with no account behind it. Both
 * answers become people the page ranks with everything else it holds —
 * the sections and the book — through the one ranking it already has
 * (`rankClients`, `ClientQuerySystem.rank`): no second ranking here, and no
 * order but the answers' own.
 *
 * ONE PERSON, ONE ROW. An account is keyed by its uid, so the record of an
 * account (`userId` set) is that account's row: the account's own answer
 * speaks first — the profile is the truth about a name, a number and a
 * mail — and a record speaks only for an account no account answer named.
 * A walk-in record (`userId` null) is keyed by its OWN id, never by its
 * name: two «Иван»s the desk entered are two people, each with their
 * number, and the row says it has no profile (`noAccount`, «Без профил»).
 */

/** What one key's two questions answered; `null` for a key nobody asked. */
export type ClientSearchAnswer = {
  readonly accounts: Result<readonly User[], RepositoryError>;
  readonly records: Result<readonly Customer[], RepositoryError>;
} | null;

/** An account's printed name: as written, else the index's own key. */
function accountLabel(user: User): string {
  const written = Profile.fullName(user);
  return written.length > 0 ? written : (user.searchName ?? '');
}

/** A number as the profile prints it — «+359 88 765 4321», not the E.164. */
function printed(phone: E164 | null): string | null {
  return phone === null ? null : PhoneSystem.formatInternational(phone);
}

/** A person the account index found — by their uid, read off the account. */
export function accountOption(user: User): VisitEditorClientOption {
  return {
    id: DraftPersonKey.account(user.id),
    label: accountLabel(user),
    phone: printed(user.phone),
    phoneHref: user.phone,
    meta: user.email,
    email: user.email,
  };
}

/**
 * A person the record index found: an account's record as that account
 * (the name and the contact the shop holds for it), a walk-in's as a guest
 * keyed by the record — `guest-<customerId>`, a key no typed label and no
 * minted person can spell — marked as having no profile. Picked, the
 * walk-in rides the save as a guest with this name, number and mail, and
 * the server finds the same record again by them (`CustomerId.forWalkIn`).
 * The walk-in's record id rides beside the key as its own field
 * (`customerId`, S-RU-15) — what opens their card keyed by the record
 * (S-WS-F); an account's record answers `null` (its card resolves the
 * record by the uid).
 */
export function recordOption(customer: Customer): VisitEditorClientOption {
  const facts = {
    label: customer.displayName,
    phone: printed(customer.phone),
    phoneHref: customer.phone,
    meta: customer.email,
    email: customer.email,
  };
  return customer.userId === null
    ? {
        id: DraftPersonKey.guest(customer.id),
        ...facts,
        noAccount: true,
        customerId: customer.id,
      }
    : {
        id: DraftPersonKey.account(customer.userId),
        ...facts,
        customerId: null,
      };
}

/**
 * Every key's answers as one list of people: the accounts of every key
 * first, then the records — each person once, the first answer that named
 * them kept. A refused answer (the index unreachable, a chunk that did not
 * load) adds nobody; the other index's answer still stands.
 */
export function clientSearchOptions(
  answers: readonly ClientSearchAnswer[],
): readonly VisitEditorClientOption[] {
  const seen = new Set<DraftPersonKey>();
  const options: VisitEditorClientOption[] = [];
  const add = (option: VisitEditorClientOption): void => {
    if (seen.has(option.id)) return;
    seen.add(option.id);
    options.push(option);
  };
  for (const answer of answers) {
    if (answer === null || !answer.accounts.ok) continue;
    for (const user of answer.accounts.value) add(accountOption(user));
  }
  for (const answer of answers) {
    if (answer === null || !answer.records.ok) continue;
    for (const customer of answer.records.value) add(recordOption(customer));
  }
  return options;
}
