/**
 * THE ADD-CLIENT OMNIBOX, as pure functions (2026-09-18; owner: "it should
 * auto detect phone or name or email and auto assign it and look it up").
 *
 * One field, three kinds of answer. The desk types whatever the caller
 * gives — «Мария», «088 765 4321», «maria@…», or all of it at once, pasted
 * from a message — and every part is found where it stands: the words are
 * the NAME, the digit run is the PHONE, the token with an `@` is the MAIL.
 * The most selective part LEADS the lookup (mail, then number, then name);
 * the others rank what comes back and prefill the new-client form.
 *
 * Pure on purpose: the editor reads it for the row it draws and the form it
 * prefills, the page reads it for the keys it sends the index, and the two
 * can never disagree about what was typed.
 */

export type ClientQueryKind = 'empty' | 'name' | 'phone' | 'email';

export interface ParsedClientQuery {
  readonly raw: string;
  /** Which part leads: the most selective one present. */
  readonly kind: ClientQueryKind;
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
}

/** A client as the ranking reads them — the option's own fields. */
export interface RankableClient {
  readonly label: string;
  readonly phone: string | null;
  readonly email?: string | null;
}

export interface RankedClient<T extends RankableClient> {
  readonly client: T;
  /** The typed number or mail IS this person's — a duplicate in waiting. */
  readonly exact: boolean;
}

export interface TextSegment {
  readonly text: string;
  readonly hit: boolean;
}

/** Bulgaria's calling code — the shop's, and the default a bare number gets. */
export const DEFAULT_CALLING_CODE = '359';

const MIN_PHONE_DIGITS = 3;
const MIN_KEY_LENGTH = 3;
const PHONE_TOKEN = /^[+(]*\d[\d()./-]*$/;
const WRAPPING = /^[<("'[]+|[>)"'\],;:]+$/g;

export function parseClientQuery(raw: string): ParsedClientQuery {
  const words: string[] = [];
  const phoneTokens: string[] = [];
  let email = '';
  for (const piece of raw.split(/\s+/)) {
    // A pasted «Мария <maria@x.bg>,» keeps its brackets and commas out.
    const token = piece.includes('@')
      ? piece.replace(WRAPPING, '')
      : piece.replace(/^[<"'[]+|[>"'\],;:]+$/g, '');
    if (token.length === 0) continue;
    if (token.includes('@')) {
      if (email.length === 0) email = token.toLowerCase();
      continue;
    }
    if (PHONE_TOKEN.test(token)) phoneTokens.push(token);
    else words.push(token);
  }

  let phoneTyped = phoneTokens.join(' ');
  let digits = phoneTyped.replace(/\D/g, '');
  if (digits.length < MIN_PHONE_DIGITS) {
    // «Мария 2» is a name with a figure in it, not a number.
    words.push(...phoneTokens);
    phoneTyped = '';
    digits = '';
  }
  const plus = phoneTyped.trimStart().startsWith('+');
  const doubleZero = !plus && digits.startsWith('00');
  if (doubleZero) digits = digits.slice(2);

  const name = words.join(' ');
  const nameTokens = words.map((word) => word.toLocaleLowerCase('bg'));
  const kind: ClientQueryKind =
    email.length > 0
      ? 'email'
      : digits.length > 0
        ? 'phone'
        : name.length > 0
          ? 'name'
          : 'empty';
  return {
    raw,
    kind,
    name,
    nameTokens,
    phoneTyped,
    phoneDigits: digits,
    phoneInternational: plus || doubleZero,
    email,
  };
}

/**
 * The number in the forms the index holds — the international digits and
 * the national «0…» — so a number finds its person however it was dialled:
 * «+359 88…», «00359 88…», «088…», or the bare «88…» somebody read aloud.
 */
export function phoneLookupVariants(
  parsed: ParsedClientQuery,
  callingCode = DEFAULT_CALLING_CODE,
): readonly string[] {
  const digits = parsed.phoneDigits;
  if (digits.length < MIN_PHONE_DIGITS) return [];
  const out = new Set<string>();
  const international =
    parsed.phoneInternational || digits.startsWith(callingCode);
  if (international) {
    out.add(digits);
    if (digits.startsWith(callingCode) && digits.length > callingCode.length) {
      out.add('0' + digits.slice(callingCode.length));
    }
  } else if (digits.startsWith('0')) {
    out.add(digits);
    if (digits.length > 1) out.add(callingCode + digits.slice(1));
  } else {
    out.add(digits);
    out.add('0' + digits);
    out.add(callingCode + digits);
  }
  return [...out].filter((variant) => variant.length >= MIN_KEY_LENGTH);
}

/**
 * What to ask the index, most selective part first: the mail, else the
 * number in its forms, else the LONGEST word of the name (the index matches
 * one token's prefix; the other words are matched here, in memory).
 */
export function clientLookupKeys(
  parsed: ParsedClientQuery,
  callingCode = DEFAULT_CALLING_CODE,
): readonly string[] {
  if (parsed.email.length >= MIN_KEY_LENGTH && !parsed.email.startsWith('@')) {
    return [parsed.email];
  }
  const phones = phoneLookupVariants(parsed, callingCode);
  if (phones.length > 0) return phones;
  // A word has a letter in it: «08» on its way to a number asks nothing yet.
  const longest = [...parsed.nameTokens]
    .filter((token) => token.length >= 2 && /\p{L}/u.test(token))
    .sort((a, b) => b.length - a.length)[0];
  return longest === undefined ? [] : [longest];
}

/** The stored number's digits as the index holds them — international, no plus. */
function storedDigits(phone: string | null): string {
  return (phone ?? '').replace(/\D/g, '');
}

/**
 * The typed digits as INTERNATIONAL digits (no `+`), most likely reading
 * first: «+359…»/«00359…»/«359…» as carried, a trunk «0…» with the code in
 * its place, a bare run with the code before it (and, last, as itself).
 */
export function phoneInternationalDigits(
  parsed: ParsedClientQuery,
  callingCode = DEFAULT_CALLING_CODE,
): readonly string[] {
  return internationalCandidates(parsed, callingCode);
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
  callingCode: string,
): number {
  const stored = storedDigits(client.phone);
  if (stored.length === 0 || parsed.phoneDigits.length === 0) return 0;
  const candidates = internationalCandidates(parsed, callingCode);
  if (candidates.some((candidate) => stored === candidate)) return 100;
  if (candidates.some((candidate) => stored.startsWith(candidate))) return 80;
  const dialled = parsed.phoneDigits.replace(/^0+/, '');
  return dialled.length >= MIN_PHONE_DIGITS && stored.includes(dialled)
    ? 60
    : 0;
}

function emailScore(client: RankableClient, parsed: ParsedClientQuery): number {
  const stored = (client.email ?? '').toLowerCase();
  if (stored.length === 0 || parsed.email.length === 0) return 0;
  if (stored === parsed.email) return 100;
  if (stored.startsWith(parsed.email)) return 80;
  return stored.includes(parsed.email) ? 50 : 0;
}

function nameScore(client: RankableClient, parsed: ParsedClientQuery): number {
  if (parsed.nameTokens.length === 0) return 0;
  const words = client.label
    .toLocaleLowerCase('bg')
    .split(/[\s·]+/)
    .filter((word) => word.length > 0);
  const every = parsed.nameTokens.every((token) =>
    words.some((word) => word.startsWith(token)),
  );
  if (!every) return 0;
  const first = parsed.nameTokens[0];
  return first !== undefined && words[0]?.startsWith(first) ? 75 : 70;
}

/**
 * The owner's hits, filtered by the LEADING part and ordered best first:
 * an exact number or mail, then a number that begins as typed, then names
 * whose every typed word begins one of theirs. The other parts only nudge
 * the order — a number that belongs to somebody else's name is exactly the
 * row the desk needs to see before making a duplicate.
 */
export function rankClients<T extends RankableClient>(
  clients: readonly T[],
  parsed: ParsedClientQuery,
  callingCode = DEFAULT_CALLING_CODE,
): readonly RankedClient<T>[] {
  if (parsed.kind === 'empty') {
    return clients.map((client) => ({ client, exact: false }));
  }
  const scored = clients.flatMap((client, index) => {
    const phone = phoneScore(client, parsed, callingCode);
    const email = emailScore(client, parsed);
    const name = nameScore(client, parsed);
    const lead =
      parsed.kind === 'email' ? email : parsed.kind === 'phone' ? phone : name;
    if (lead === 0) return [];
    const others = phone + email + name - lead;
    return [
      {
        client,
        index,
        score: lead + others / 10,
        exact: phone === 100 || email === 100,
      },
    ];
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map(({ client, exact }) => ({ client, exact }));
}

const plain = (text: string): readonly TextSegment[] =>
  text.length === 0 ? [] : [{ text, hit: false }];

/** A name with the typed beginnings of its words marked. */
export function nameSegments(
  label: string,
  parsed: ParsedClientQuery,
): readonly TextSegment[] {
  if (parsed.nameTokens.length === 0) return plain(label);
  const out: TextSegment[] = [];
  for (const piece of label.match(/\S+|\s+/g) ?? []) {
    const lower = piece.toLocaleLowerCase('bg');
    const token = parsed.nameTokens
      .filter((candidate) => lower.startsWith(candidate))
      .sort((a, b) => b.length - a.length)[0];
    if (token === undefined || /^\s+$/.test(piece)) {
      out.push({ text: piece, hit: false });
      continue;
    }
    out.push({ text: piece.slice(0, token.length), hit: true });
    if (piece.length > token.length) {
      out.push({ text: piece.slice(token.length), hit: false });
    }
  }
  return out;
}

/** A printed number with the typed run of its digits marked, spacing kept. */
export function phoneSegments(
  formatted: string,
  parsed: ParsedClientQuery,
  callingCode = DEFAULT_CALLING_CODE,
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
  for (const candidate of internationalCandidates(parsed, callingCode)) {
    if (digits.startsWith(candidate)) {
      from = 0;
      length = candidate.length;
      break;
    }
  }
  if (from < 0) {
    const dialled = parsed.phoneDigits.replace(/^0+/, '');
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
}

/** A mail with the typed fragment marked. */
export function emailSegments(
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
}
