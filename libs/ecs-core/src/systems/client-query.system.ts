import {
  ClientQueryShape,
  Seat,
  SeatSubject,
  type AccountOccupant,
} from '@core/components';
import { UtcEpochMs, type UserId } from '@core/primitives';

/**
 * One omnibox entry, read apart (`visit-editor/client-query.ts:17-50`): the
 * words are the NAME, the digit run is the PHONE, the token with an `@` is
 * the MAIL, and the most selective part present leads.
 */
export type ParsedClientQuery = {
  readonly raw: string;
  /** Which part leads: the most selective one present. */
  readonly clientQueryShape: ClientQueryShape;
  /** The words that are neither a number nor a mail, as typed. */
  readonly name: string;
  /** The same words, lowercased, one per token — what a name is matched by. */
  readonly nameTokens: readonly string[];
  /** The number as typed, its own spacing kept, for showing back. */
  readonly phoneTyped: string;
  /** Its digits alone; an international `00` prefix already dropped. */
  readonly phoneDigits: string;
  /** Typed with a `+` or a `00` — the digits start with a calling code. */
  readonly phoneInternational: boolean;
  /** A mail, or the beginning of one, lowercased. */
  readonly email: string;
};

/** A client as the ranking reads them. Every field present; absent is `null`. */
export type RankableClient = {
  readonly label: string;
  readonly phone: string | null;
  readonly email: string | null;
};

/** One ranked hit: the index of the client in the pool the caller passed. */
export type RankedClientIndex = {
  readonly index: number;
  /** The typed number or mail IS this person's — a duplicate in waiting. */
  readonly exact: boolean;
};

/** A run of text, marked when it is what was typed. */
export type TextSegment = {
  readonly text: string;
  readonly hit: boolean;
};

/**
 * A visit as the add-client page's account lists read it — whose booking it
 * is (`ownerUserId`, else its `SELF` account seat) and the booker's own
 * contact snapshot. A whole `Appointment` passes straight in.
 */
export type AccountVisit = {
  readonly ownerUserId: UserId | null;
  readonly seats: readonly AccountOccupant[];
  readonly contactName: string | null;
};

/**
 * One account read off a visit: the BOOKER's account, paired with the
 * visit it was read from — whose contact (`contactName`, `contactPhone`,
 * `contactEmail`) is that booker's, never a companion's.
 */
export type AccountPick<V extends AccountVisit = AccountVisit> = {
  readonly userId: UserId;
  readonly visit: V;
};

/**
 * A visit as the local book reads it — an {@link AccountVisit} with the
 * instant it starts, which orders the book newest contact first. A whole
 * `Appointment` passes straight in.
 */
export type BookVisit = AccountVisit & {
  readonly utcEpochMs: UtcEpochMs;
};

/** A book entry — an {@link AccountPick} whose visit carries a contact name, read out. */
export type NamedAccountPick<V extends AccountVisit = AccountVisit> =
  AccountPick<V> & {
    readonly contactName: string;
  };

/** Bulgaria's calling code — the shop's, and the default a bare number gets. */
const DEFAULT_CALLING_CODE = '359';

const MIN_PHONE_DIGITS = 3;
const MIN_KEY_LENGTH = 3;
/** Fewer typed digits than this are no number on its way into the new-client form. */
const PREFILL_PHONE_DIGITS = 5;
const PHONE_TOKEN = /^[+(]*\d[\d()./-]*$/;
const WRAPPING = /^[<("'[]+|[>)"'\],;:]+$/g;
const NAME_WRAPPING = /^[<"'[]+|[>"'\],;:]+$/g;
const NON_DIGIT = /\D/g;
const LEADING_ZEROS = /^0+/;
const LETTER = /\p{L}/u;
const WHITESPACE_RUN = /\s+/;
const LABEL_WORD_SPLIT = /[\s·]+/;
const WORD_OR_SPACE = /\S+|\s+/g;
const ONLY_SPACE = /^\s+$/;
/** The locale names are matched in — the shop's. */
const NAME_LOCALE = 'bg';

const SCORE_EXACT = 100;
const SCORE_PREFIX = 80;
const SCORE_FIRST_NAME = 75;
const SCORE_ANY_NAME = 70;
const SCORE_PHONE_INSIDE = 60;
const SCORE_EMAIL_INSIDE = 50;

/** The stored number's digits as the index holds them — international, no plus. */
function storedDigits(phone: string | null): string {
  return (phone ?? '').replace(NON_DIGIT, '');
}

/** The typed number as international digits it could be the beginning of. */
function internationalCandidates(
  parsed: ParsedClientQuery,
  callingCode: string,
): readonly string[] {
  const digits = parsed.phoneDigits;
  if (digits.length === 0) return [];
  if (parsed.phoneInternational || digits.startsWith(callingCode)) {
    return [digits];
  }
  if (digits.startsWith('0')) return [callingCode + digits.slice(1)];
  return [callingCode + digits, digits];
}

function phoneScore(
  client: RankableClient,
  parsed: ParsedClientQuery,
  candidates: readonly string[],
): number {
  const stored = storedDigits(client.phone);
  if (stored.length === 0 || parsed.phoneDigits.length === 0) return 0;
  for (let i = 0; i < candidates.length; i++) {
    if (stored === candidates[i]) return SCORE_EXACT;
  }
  for (let i = 0; i < candidates.length; i++) {
    if (stored.startsWith(candidates[i] as string)) return SCORE_PREFIX;
  }
  const dialled = parsed.phoneDigits.replace(LEADING_ZEROS, '');
  return dialled.length >= MIN_PHONE_DIGITS && stored.includes(dialled)
    ? SCORE_PHONE_INSIDE
    : 0;
}

function emailScore(client: RankableClient, parsed: ParsedClientQuery): number {
  const stored = (client.email ?? '').toLowerCase();
  if (stored.length === 0 || parsed.email.length === 0) return 0;
  if (stored === parsed.email) return SCORE_EXACT;
  if (stored.startsWith(parsed.email)) return SCORE_PREFIX;
  return stored.includes(parsed.email) ? SCORE_EMAIL_INSIDE : 0;
}

function nameScore(client: RankableClient, parsed: ParsedClientQuery): number {
  const tokens = parsed.nameTokens;
  if (tokens.length === 0) return 0;
  const pieces = client.label
    .toLocaleLowerCase(NAME_LOCALE)
    .split(LABEL_WORD_SPLIT);
  const words: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const word = pieces[i] as string;
    if (word.length > 0) words.push(word);
  }
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t] as string;
    let found = false;
    for (let w = 0; w < words.length; w++) {
      if ((words[w] as string).startsWith(token)) {
        found = true;
        break;
      }
    }
    if (!found) return 0;
  }
  const first = tokens[0] as string;
  const firstWord = words[0];
  return firstWord !== undefined && firstWord.startsWith(first)
    ? SCORE_FIRST_NAME
    : SCORE_ANY_NAME;
}

function plain(text: string): readonly TextSegment[] {
  return text.length === 0 ? [] : [{ text, hit: false }];
}

/**
 * The visit's BOOKER — its `ownerUserId`, else its first own-account seat
 * (`Seat.isOwnAccount`: an ACCOUNT seated as `SELF`, the seat the
 * `ownerUserId` mirror is read from); `null` for a visit with neither — a
 * party of guests, or companions alone.
 */
function bookerOf(visit: AccountVisit): UserId | null {
  if (visit.ownerUserId !== null) return visit.ownerUserId;
  const seats = visit.seats;
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i] as AccountOccupant;
    // The subject check narrows the variant; the rule is the companion's.
    if (seat.seatSubject === SeatSubject.Account && Seat.isOwnAccount(seat)) {
      return seat.subjectUserId;
    }
  }
  return null;
}

type Scored = {
  readonly index: number;
  readonly score: number;
  readonly exact: boolean;
};

/**
 * ClientQuerySystem — THE ADD-CLIENT OMNIBOX as pure functions
 * (`visit-editor/client-query.ts`). One field, three kinds of answer: the
 * desk types whatever the caller gives — a name, a number, a mail, or all of
 * it pasted at once — and every part is found where it stands. The most
 * selective part LEADS the lookup (mail, then number, then name); the others
 * rank what comes back and prefill the new-client form. Strings and scores
 * only; the editor and the page read the same answers.
 *
 * Beside the query (pass C): the page's two lists of accounts read off the
 * loaded visits — «Скорошни» and the local book (`recentAccounts`,
 * `bookAccounts`, the staff dashboard's `browseClients`) — and the new-client
 * form's phone prefill threshold (`prefillsPhone`).
 */
export const ClientQuerySystem = {
  /** Bulgaria's calling code — the default a bare number is read under. */
  DEFAULT_CALLING_CODE,

  /** Fewer typed digits than this are no number on its way into the new-client form. */
  PREFILL_PHONE_DIGITS,

  /**
   * Does the typed number go into the new-client form's phone field — at
   * least {@link PREFILL_PHONE_DIGITS} digits typed? Fewer are not a number
   * on its way anywhere.
   */
  prefillsPhone(parsed: { readonly phoneDigits: string }): boolean {
    return parsed.phoneDigits.length >= PREFILL_PHONE_DIGITS;
  },

  /**
   * «СКОРОШНИ» — the accounts of the visits handed in, IN THE ORDER HANDED
   * IN (the caller filters and orders them: the page hands the past visits,
   * newest first), each account once — its first visit in that order —
   * and at most `limit` of them. The account is the visit's BOOKER
   * (`ownerUserId`, else its `SELF` account seat), whose contact the visit
   * carries: a companion is never filed under the booker's name or number.
   * A visit with no booker contributes no account.
   */
  recentAccounts<V extends AccountVisit>(
    orderedPast: readonly V[],
    limit: number,
  ): readonly AccountPick<V>[] {
    const out: AccountPick<V>[] = [];
    if (limit <= 0) return out;
    const seen = new Set<UserId>();
    for (let i = 0; i < orderedPast.length; i++) {
      const visit = orderedPast[i] as V;
      const userId = bookerOf(visit);
      if (userId === null || seen.has(userId)) continue;
      seen.add(userId);
      out.push({ userId, visit });
      if (out.length >= limit) break;
    }
    return out;
  },

  /**
   * THE BOOK — every NAMED account of the visits handed in (the page hands
   * every loaded visit, in any order), each account once. The system orders
   * the visits newest contact first itself — by `utcEpochMs`, a stamp
   * ordering; visits at the same instant keep the order handed in — so a
   * changed number is the one read: each account's first visit in that order
   * that carries a contact name (read out as `contactName`), in that order.
   * The account is the visit's booker, as in {@link recentAccounts}.
   */
  bookAccounts<V extends BookVisit>(
    visits: readonly V[],
  ): readonly NamedAccountPick<V>[] {
    const newestFirst = [...visits].sort((a, b) =>
      UtcEpochMs.compare(b.utcEpochMs, a.utcEpochMs),
    );
    const out: NamedAccountPick<V>[] = [];
    const seen = new Set<UserId>();
    for (let i = 0; i < newestFirst.length; i++) {
      const visit = newestFirst[i] as V;
      const userId = bookerOf(visit);
      const contactName = visit.contactName;
      if (userId === null || seen.has(userId) || contactName === null) {
        continue;
      }
      seen.add(userId);
      out.push({ userId, visit, contactName });
    }
    return out;
  },

  /** The typed line, read into its parts. */
  parse(raw: string): ParsedClientQuery {
    const words: string[] = [];
    const phoneTokens: string[] = [];
    let email = '';
    const pieces = raw.split(WHITESPACE_RUN);
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i] as string;
      // A pasted «Мария <maria@x.bg>,» keeps its brackets and commas out.
      const token = piece.includes('@')
        ? piece.replace(WRAPPING, '')
        : piece.replace(NAME_WRAPPING, '');
      if (token.length === 0) continue;
      if (token.includes('@')) {
        if (email.length === 0) email = token.toLowerCase();
        continue;
      }
      if (PHONE_TOKEN.test(token)) phoneTokens.push(token);
      else words.push(token);
    }

    let phoneTyped = phoneTokens.join(' ');
    let digits = phoneTyped.replace(NON_DIGIT, '');
    if (digits.length < MIN_PHONE_DIGITS) {
      // «Мария 2» is a name with a figure in it, not a number.
      for (let i = 0; i < phoneTokens.length; i++) {
        words.push(phoneTokens[i] as string);
      }
      phoneTyped = '';
      digits = '';
    }
    const plus = phoneTyped.trimStart().startsWith('+');
    const doubleZero = !plus && digits.startsWith('00');
    if (doubleZero) digits = digits.slice(2);

    const name = words.join(' ');
    const nameTokens: string[] = [];
    for (let i = 0; i < words.length; i++) {
      nameTokens.push((words[i] as string).toLocaleLowerCase(NAME_LOCALE));
    }
    const clientQueryShape: ClientQueryShape =
      email.length > 0
        ? ClientQueryShape.Email
        : digits.length > 0
          ? ClientQueryShape.Phone
          : name.length > 0
            ? ClientQueryShape.Name
            : ClientQueryShape.Empty;
    return {
      raw,
      clientQueryShape,
      name,
      nameTokens,
      phoneTyped,
      phoneDigits: digits,
      phoneInternational: plus || doubleZero,
      email,
    };
  },

  /**
   * The number in the forms the index holds — the international digits and
   * the national «0…» — so a number finds its person however it was
   * dialled: «+359 88…», «00359 88…», «088…», or the bare «88…».
   */
  phoneLookupVariants(
    parsed: ParsedClientQuery,
    callingCode: string,
  ): readonly string[] {
    const digits = parsed.phoneDigits;
    if (digits.length < MIN_PHONE_DIGITS) return [];
    const variants: string[] = [];
    const add = (variant: string): void => {
      if (!variants.includes(variant)) variants.push(variant);
    };
    const international =
      parsed.phoneInternational || digits.startsWith(callingCode);
    if (international) {
      add(digits);
      if (
        digits.startsWith(callingCode) &&
        digits.length > callingCode.length
      ) {
        add('0' + digits.slice(callingCode.length));
      }
    } else if (digits.startsWith('0')) {
      add(digits);
      if (digits.length > 1) add(callingCode + digits.slice(1));
    } else {
      add(digits);
      add('0' + digits);
      add(callingCode + digits);
    }
    const out: string[] = [];
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i] as string;
      if (variant.length >= MIN_KEY_LENGTH) out.push(variant);
    }
    return out;
  },

  /**
   * What to ask the index, most selective part first: the mail, else the
   * number in its forms, else the LONGEST word of the name (the index
   * matches one token's prefix; the other words are matched in memory).
   */
  lookupKeys(
    parsed: ParsedClientQuery,
    callingCode: string,
  ): readonly string[] {
    if (
      parsed.email.length >= MIN_KEY_LENGTH &&
      !parsed.email.startsWith('@')
    ) {
      return [parsed.email];
    }
    const phones = ClientQuerySystem.phoneLookupVariants(parsed, callingCode);
    if (phones.length > 0) return phones;
    // A word has a letter in it: «08» on its way to a number asks nothing
    // yet. The longest wins; the first of equal lengths keeps its place.
    let longest: string | null = null;
    for (let i = 0; i < parsed.nameTokens.length; i++) {
      const token = parsed.nameTokens[i] as string;
      if (token.length < 2 || !LETTER.test(token)) continue;
      if (longest === null || token.length > longest.length) longest = token;
    }
    return longest === null ? [] : [longest];
  },

  /**
   * The typed digits as INTERNATIONAL digits (no `+`), most likely reading
   * first: «+359…»/«00359…»/«359…» as carried, a trunk «0…» with the code
   * in its place, a bare run with the code before it (and, last, as itself).
   */
  phoneInternationalDigits(
    parsed: ParsedClientQuery,
    callingCode: string,
  ): readonly string[] {
    return internationalCandidates(parsed, callingCode);
  },

  /**
   * The pool's hits, filtered by the LEADING part and ordered best first —
   * an exact number or mail, then a number that begins as typed, then names
   * whose every typed word begins one of theirs. The other parts only nudge
   * the order (a tenth of their score), and the pool's own order breaks
   * ties. Indexes into `clients`; an empty query keeps the whole pool.
   */
  rank(
    clients: readonly RankableClient[],
    parsed: ParsedClientQuery,
    callingCode: string,
  ): readonly RankedClientIndex[] {
    if (parsed.clientQueryShape === ClientQueryShape.Empty) {
      const all: RankedClientIndex[] = [];
      for (let i = 0; i < clients.length; i++) {
        all.push({ index: i, exact: false });
      }
      return all;
    }
    const candidates = internationalCandidates(parsed, callingCode);
    const scored: Scored[] = [];
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i] as RankableClient;
      const phone = phoneScore(client, parsed, candidates);
      const email = emailScore(client, parsed);
      const name = nameScore(client, parsed);
      const lead =
        parsed.clientQueryShape === ClientQueryShape.Email
          ? email
          : parsed.clientQueryShape === ClientQueryShape.Phone
            ? phone
            : name;
      if (lead === 0) continue;
      const others = phone + email + name - lead;
      scored.push({
        index: i,
        score: lead + others / 10,
        exact: phone === SCORE_EXACT || email === SCORE_EXACT,
      });
    }
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    const out: RankedClientIndex[] = [];
    for (let i = 0; i < scored.length; i++) {
      const hit = scored[i] as Scored;
      out.push({ index: hit.index, exact: hit.exact });
    }
    return out;
  },

  /** A name with the typed beginnings of its words marked. */
  nameSegments(
    label: string,
    parsed: ParsedClientQuery,
  ): readonly TextSegment[] {
    if (parsed.nameTokens.length === 0) return plain(label);
    const out: TextSegment[] = [];
    const pieces = label.match(WORD_OR_SPACE) ?? [];
    for (let p = 0; p < pieces.length; p++) {
      const piece = pieces[p] as string;
      const lower = piece.toLocaleLowerCase(NAME_LOCALE);
      // The LONGEST typed beginning wins; the first of equal ones keeps it.
      let token: string | null = null;
      for (let t = 0; t < parsed.nameTokens.length; t++) {
        const candidate = parsed.nameTokens[t] as string;
        if (!lower.startsWith(candidate)) continue;
        if (token === null || candidate.length > token.length) {
          token = candidate;
        }
      }
      if (token === null || ONLY_SPACE.test(piece)) {
        out.push({ text: piece, hit: false });
        continue;
      }
      out.push({ text: piece.slice(0, token.length), hit: true });
      if (piece.length > token.length) {
        out.push({ text: piece.slice(token.length), hit: false });
      }
    }
    return out;
  },

  /** A printed number with the typed run of its digits marked, spacing kept. */
  phoneSegments(
    formatted: string,
    parsed: ParsedClientQuery,
    callingCode: string,
  ): readonly TextSegment[] {
    if (parsed.phoneDigits.length === 0) return plain(formatted);
    const positions: number[] = [];
    let digits = '';
    for (let index = 0; index < formatted.length; index += 1) {
      const char = formatted.charAt(index);
      if (char >= '0' && char <= '9') {
        positions.push(index);
        digits += char;
      }
    }
    let from = -1;
    let length = 0;
    const candidates = internationalCandidates(parsed, callingCode);
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i] as string;
      if (digits.startsWith(candidate)) {
        from = 0;
        length = candidate.length;
        break;
      }
    }
    if (from < 0) {
      const dialled = parsed.phoneDigits.replace(LEADING_ZEROS, '');
      const at =
        dialled.length >= MIN_PHONE_DIGITS ? digits.indexOf(dialled) : -1;
      if (at >= 0) {
        from = at;
        length = dialled.length;
      }
    }
    const start = positions[from];
    const end = positions[from + length - 1];
    if (from < 0 || start === undefined || end === undefined) {
      return plain(formatted);
    }
    return [
      ...plain(formatted.slice(0, start)),
      { text: formatted.slice(start, end + 1), hit: true },
      ...plain(formatted.slice(end + 1)),
    ];
  },

  /** A mail with the typed fragment marked. */
  emailSegments(
    email: string,
    parsed: ParsedClientQuery,
  ): readonly TextSegment[] {
    if (parsed.email.length === 0) return plain(email);
    const at = email.toLowerCase().indexOf(parsed.email);
    if (at < 0) return plain(email);
    return [
      ...plain(email.slice(0, at)),
      { text: email.slice(at, at + parsed.email.length), hit: true },
      ...plain(email.slice(at + parsed.email.length)),
    ];
  },
} as const;
