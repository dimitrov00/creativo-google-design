import type { PhoneReading } from '@core/components';
import { ClientQuerySystem } from './client-query.system';
import { PhoneSystem } from './phone.system';

/**
 * A typed search read into what a visit must satisfy: every text term, and —
 * when the text holds a number — the phone reading. `088 333` is a phone
 * reading and no terms; `Иван 088 333` is the term `иван` and one reading;
 * `Иван 12` has too few digits to be a number, so both words are terms.
 */
export type ReadQuery = {
  /** Folded in the shop's locale, one per word (a mail fragment counts as a word). */
  readonly queryTerms: readonly string[];
  /** `NONE` when the text holds no number. */
  readonly queryPhone: PhoneReading;
};

/**
 * SearchQuerySystem — what the schedule search's field was typed as. It
 * builds on the add-client page's reader (`ClientQuerySystem.parse`: the
 * words, the run of phone-shaped tokens with at least three digits, the
 * mail) and on `PhoneSystem.searchDigitsOf` for the number, and adds no
 * second parser. The field's text is never rewritten (part 1, Alternative E).
 */
export const SearchQuerySystem = {
  read(raw: string, callingCode: string): ReadQuery {
    const parsed = ClientQuerySystem.parse(raw);
    const queryTerms =
      parsed.email.length > 0
        ? [...parsed.nameTokens, parsed.email]
        : parsed.nameTokens;
    return {
      queryTerms,
      queryPhone: PhoneSystem.searchDigitsOf(parsed.phoneTyped, callingCode),
    };
  },
} as const;
