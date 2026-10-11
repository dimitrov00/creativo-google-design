import type { Brand } from '../primitives/brand';
import { LocalDate } from '../primitives/local-date.primitive';

/** Strict `YYYY-MM-DD` — the shape `firestore.rules:93` tests. */
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A calendar date of birth as `'YYYY-MM-DD'` — a brand over the plain stored
 * string (`users.birthDate`; the rules test `data.birthDate is string &&
 * matches('^[0-9]{4}-…')`, so no wrapper struct). String order is date
 * order. The accounts and identity `BirthDate` classes collapsed into one
 * (blueprint §2.4).
 *
 * This component owns what a birth date IS: a real calendar day (no
 * Feb 30, no month 13, year 1–9999). Whether a person may register with it —
 * the 16–120 age window and the not-in-the-future rule, which need "today"
 * as the shop's `LocalDate` — is `AgeSystem.ageAt` (`systems/age.system.ts`),
 * never a creation-time check here. A domain-value brand (F-15): it stays in
 * this file on the one `Brand` helper, and its refusals are identity errors.
 */
export type BirthDate = Brand<string, 'BirthDate'>;

export const BirthDate = {
  /** The only cast site — for a value already canonical (read back from a document). */
  of: (raw: string): BirthDate => raw as BirthDate,

  /**
   * The edge guard for the server-submitted value: a strict `YYYY-MM-DD`
   * (surrounding whitespace trimmed) naming a real calendar day, or `null`.
   * Context-free: the caller words the refusal (`identity.birth_date.invalid`).
   */
  parse(raw: string): BirthDate | null {
    const match = ISO_DATE_PATTERN.exec(raw.trim());
    if (match === null) return null;
    return BirthDate.fromParts({
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    });
  },

  /**
   * The edge guard for a DD / MM / YYYY form control's segments: integers in
   * range naming a real calendar day, canonicalised to `'YYYY-MM-DD'`
   * (zero-padded), or `null`.
   */
  fromParts(parts: BirthDate.Parts): BirthDate | null {
    const { year, month, day } = parts;
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      year < 1 ||
      year > 9999 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > LocalDate.daysInMonth(year, month)
    ) {
      return null;
    }
    return BirthDate.of(
      `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
  },

  /** The segments back, for the form control — `'1990-07-03'` → `{ year: 1990, month: 7, day: 3 }`. */
  partsOf(birthDate: BirthDate): BirthDate.Parts {
    return {
      year: Number(birthDate.slice(0, 4)),
      month: Number(birthDate.slice(5, 7)),
      day: Number(birthDate.slice(8, 10)),
    };
  },

  /** By calendar day — canonical form makes it plain string equality. */
  equals(a: BirthDate, b: BirthDate): boolean {
    return a === b;
  },
} as const;

export namespace BirthDate {
  /** Raw segment values as a DD / MM / YYYY form control collects them. */
  export type Parts = {
    readonly year: number;
    readonly month: number;
    readonly day: number;
  };
}
