import { MatchMode, type TextSegment } from '@core/components';

/**
 * TextMatchSystem — every "which run of this text did the user type?" answer
 * the app's searches mark: the visit sheet's service catalogue, the add-client
 * rows and the schedule search. A typed run is found in a text, in either
 * case, and said where it sits so a screen can mark it.
 *
 * Case is folded in the Bulgarian locale, the one the shop writes in, so
 * `matches` (which rows stay) and the segment functions (which runs are
 * marked) can never disagree about what a query finds.
 */

const LOCALE = 'bg';

/** The query as it is matched: trimmed and case-folded. */
function folded(raw: string): string {
  return raw.trim().toLocaleLowerCase(LOCALE);
}

/** A half-open stretch `[start, end)` of the text. */
type Span = { start: number; end: number };

const WHITESPACE = /\s/;

/** Every non-overlapping occurrence of `needle` in `haystack`, left to right. */
function anywhere(haystack: string, needle: string, into: Span[]): void {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return;
    into.push({ start: at, end: at + needle.length });
    from = at + needle.length;
  }
}

/** Every occurrence of `needle` that begins a word (a run after whitespace). */
function atWordStarts(haystack: string, needle: string, into: Span[]): void {
  for (let at = 0; at < haystack.length; at++) {
    const char = haystack.charAt(at);
    if (WHITESPACE.test(char)) continue;
    if (at > 0 && !WHITESPACE.test(haystack.charAt(at - 1))) continue;
    if (haystack.startsWith(needle, at)) {
      into.push({ start: at, end: at + needle.length });
    }
  }
}

export const TextMatchSystem = {
  /** `text` in the shop's locale folding, untrimmed — what a search index stores. */
  fold(text: string): string {
    return text.toLocaleLowerCase(LOCALE);
  },

  /** Whether `text` holds the typed run; an empty query holds everywhere. */
  matches(text: string, query: string): boolean {
    return text.toLocaleLowerCase(LOCALE).includes(folded(query));
  },

  /**
   * `text` cut into runs, every occurrence of the typed run marked, the
   * text between kept as it was written. No query, no occurrence — or a
   * case fold that changes the text's length, which would shift every
   * offset — is the text as one unmarked run.
   */
  segments(text: string, query: string): readonly TextSegment[] {
    return TextMatchSystem.segmentsAny(text, [query], MatchMode.Anywhere);
  },

  /**
   * `segments` for several typed words at once. `matchMode` says where a word
   * counts as found: `ANYWHERE` in the text, or `WORD_START` only where a word
   * of the text begins (the add-client page's rule). Hits that overlap are
   * merged into one run; hits that merely touch stay two. No term, no
   * occurrence — or a case fold that changes the text's length, which would
   * shift every offset — is the text as one unmarked run.
   */
  segmentsAny(
    text: string,
    terms: readonly string[],
    matchMode: MatchMode,
  ): readonly TextSegment[] {
    if (text.length === 0) return [];
    const haystack = text.toLocaleLowerCase(LOCALE);
    const needles: string[] = [];
    for (let i = 0; i < terms.length; i++) {
      const needle = folded(terms[i] as string);
      if (needle.length > 0) needles.push(needle);
    }
    if (needles.length === 0 || haystack.length !== text.length) {
      return [{ text, hit: false }];
    }
    const found: Span[] = [];
    for (let i = 0; i < needles.length; i++) {
      const needle = needles[i] as string;
      if (matchMode === MatchMode.WordStart) {
        atWordStarts(haystack, needle, found);
      } else {
        anywhere(haystack, needle, found);
      }
    }
    if (found.length === 0) return [{ text, hit: false }];
    found.sort((a, b) => a.start - b.start || b.end - a.end);
    const merged: Span[] = [];
    for (let i = 0; i < found.length; i++) {
      const span = found[i] as Span;
      const last = merged[merged.length - 1];
      if (last !== undefined && span.start < last.end) {
        if (span.end > last.end) last.end = span.end;
      } else {
        merged.push({ start: span.start, end: span.end });
      }
    }
    const out: TextSegment[] = [];
    let from = 0;
    for (let i = 0; i < merged.length; i++) {
      const span = merged[i] as Span;
      if (span.start > from) {
        out.push({ text: text.slice(from, span.start), hit: false });
      }
      out.push({ text: text.slice(span.start, span.end), hit: true });
      from = span.end;
    }
    if (from < text.length) out.push({ text: text.slice(from), hit: false });
    return out;
  },

  /**
   * A printed number with the first occurrence of a run of digits marked
   * through the formatter's separators: `+359 88 777 8899` searched for
   * `887778899` marks from the first 8 through the last 9, spaces included —
   * marking only the digit runs would break one match into three. No digits,
   * or none found, is the text as one unmarked run.
   */
  phoneSegments(formatted: string, digits: string): readonly TextSegment[] {
    if (formatted.length === 0) return [];
    if (digits.length === 0) return [{ text: formatted, hit: false }];
    const positions: number[] = [];
    let bare = '';
    for (let index = 0; index < formatted.length; index++) {
      const char = formatted.charAt(index);
      if (char >= '0' && char <= '9') {
        positions.push(index);
        bare += char;
      }
    }
    const at = bare.indexOf(digits);
    const start = positions[at];
    const last = positions[at + digits.length - 1];
    if (at < 0 || start === undefined || last === undefined) {
      return [{ text: formatted, hit: false }];
    }
    const out: TextSegment[] = [];
    if (start > 0) out.push({ text: formatted.slice(0, start), hit: false });
    out.push({ text: formatted.slice(start, last + 1), hit: true });
    if (last + 1 < formatted.length) {
      out.push({ text: formatted.slice(last + 1), hit: false });
    }
    return out;
  },
} as const;
