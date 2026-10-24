import type { E164, SearchFields } from '@core/components';
import { Profile } from '@core/entities';
import { PhoneSystem } from './phone.system';

/**
 * SearchFieldsSystem — the clientele search keys of `users/{uid}` and
 * `customers/{id}` (blueprint §2.7, §2.8), computed in ONE place for the
 * web, the functions and the seed: `RegistrationSystem.register` (the
 * registered body), `ProfileEditSystem.decide` (an owner's edit, from the
 * STORED contact channels), `CustomerRecordSystem.createsFor` (a client
 * record) — the two hand-kept copies of `computeSearchFields` it replaced
 * are gone — and the query side of the same index (`normalizeQuery`),
 * which the staff client search calls before `searchUsers`.
 *
 * `searchName` is the trimmed, lower-cased full name (the list's order
 * key). `searchPrefixes` is every prefix of every whitespace-split name
 * token, then the phone's digits in each form a person types it (E.164
 * without the plus, and the national form) and the e-mail (whole, and its
 * local part) from the third character on — de-duplicated in first-seen
 * order (index #8: `searchPrefixes ARRAY_CONTAINS, searchName ASC`).
 *
 * Beside the index, the staff dashboard's in-memory book search (pass C,
 * `staff-dashboard.ts` `searchResults`): a term is searched from
 * {@link SearchFieldsSystem.TERM_MIN} characters on, and a term with at
 * least {@link SearchFieldsSystem.DIGIT_QUERY_MIN} digits also finds a phone
 * by its bare digits, whatever the formatter's spacing (`digitQuery`,
 * `digitsMatch`). The text match itself (Bulgarian collation) and the
 * highlight runs stay the page's — locale collation and display wording.
 */

/** Phone and e-mail prefixes start at the third character — keeps the array sane. */
const MIN_CONTACT_PREFIX = 3;
/** A search term shorter than this asks nothing. */
const TERM_MIN = 2;
/** A term with at least this many digits also reads as a phone number's bare digits. */
const DIGIT_QUERY_MIN = 4;

const WHITESPACE = /\s+/;
const NON_DIGITS = /\D/g;
/** A query that reads as a phone number: a `+` or digit, then digits and dialling punctuation. */
const PHONE_SHAPE = /^[+\d][\d\s().-]*$/;
const INTERNATIONAL_PREFIX = /^00/;

/**
 * The keys as computed — a name always present (a computed full name is a
 * string, `''` at worst); the slice's `null` belongs to a stub only.
 */
type ComputedSearchFields = SearchFields & { readonly searchName: string };

/** Every prefix of `token` of at least `from` characters, into `out` (first seen wins). */
function addPrefixes(out: Set<string>, token: string, from: number): void {
  for (let i = from; i <= token.length; i++) out.add(token.slice(0, i));
}

export const SearchFieldsSystem = {
  /**
   * The keys from a full name, the phone forms to index and the e-mail —
   * the legacy `computeSearchFields(fullName, phoneForms, email)`, verbatim.
   */
  fromForms(
    fullName: string,
    phoneForms: readonly string[],
    email: string | null,
  ): ComputedSearchFields {
    const searchName = fullName.trim().toLowerCase();
    const prefixes = new Set<string>();
    const tokens = searchName.split(WHITESPACE);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i] as string;
      if (token.length > 0) addPrefixes(prefixes, token, 1);
    }
    for (let i = 0; i < phoneForms.length; i++) {
      const digits = (phoneForms[i] as string).replace(NON_DIGITS, '');
      addPrefixes(prefixes, digits, MIN_CONTACT_PREFIX);
    }
    if (email) {
      const lower = email.trim().toLowerCase();
      addPrefixes(prefixes, lower, MIN_CONTACT_PREFIX);
      addPrefixes(prefixes, lower.split('@')[0] ?? '', MIN_CONTACT_PREFIX);
    }
    return { searchName, searchPrefixes: [...prefixes] };
  },

  /**
   * The keys of a user's stored names and contact channels — the full name
   * as `Profile.fullName` joins it, the E.164 in both forms (the national
   * one through `PhoneSystem.formatNational`), and the e-mail.
   */
  searchFields(
    firstName: string | null,
    lastName: string | null,
    phone: E164 | null,
    email: string | null,
  ): ComputedSearchFields {
    return SearchFieldsSystem.fromForms(
      Profile.fullName({ firstName, lastName }),
      phone === null ? [] : [phone, PhoneSystem.formatNational(phone)],
      email,
    );
  },

  /**
   * A search box's text as the index stores it: a phone-shaped query
   * becomes its digits (a leading international `00` dropped), anything
   * else is trimmed and lower-cased.
   */
  normalizeQuery(raw: string): string {
    const trimmed = raw.trim();
    if (PHONE_SHAPE.test(trimmed)) {
      return trimmed.replace(NON_DIGITS, '').replace(INTERNATIONAL_PREFIX, '');
    }
    return trimmed.toLowerCase();
  },

  /** A search term shorter than this asks nothing (the book search's threshold). */
  TERM_MIN,

  /** A term with at least this many digits also finds a phone by its bare digits. */
  DIGIT_QUERY_MIN,

  /**
   * Is the term long enough to search — at least {@link TERM_MIN}
   * characters? Measured on the caller's own operand (the trimmed text, or
   * its collated lower case), never re-trimmed here.
   */
  termSearchable(term: string): boolean {
    return term.length >= TERM_MIN;
  },

  /**
   * The term's digits alone — the bare run a phone is matched by, so
   * «887778899» finds «+359 88 777 8899» — or `null` when the term holds
   * fewer than {@link DIGIT_QUERY_MIN} digits: a person searching by phone
   * types the number off a screen or a card, and three digits are not one.
   */
  digitQuery(raw: string): string | null {
    const digits = raw.replace(NON_DIGITS, '');
    return digits.length >= DIGIT_QUERY_MIN ? digits : null;
  },

  /** Does the field's own digits, separators dropped, hold the run? */
  digitsMatch(field: string, digits: string): boolean {
    return field.replace(NON_DIGITS, '').includes(digits);
  },
} as const;
