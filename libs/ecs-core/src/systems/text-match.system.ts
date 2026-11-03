import type { TextSegment } from './client-query.system';

/**
 * TextMatchSystem — the plain "type to narrow a list" match (the visit
 * sheet's service catalogue): a typed run is found anywhere in a text, in
 * either case, and said where it sits so a screen can mark it.
 *
 * Case is folded in the Bulgarian locale, the one the catalogue is written
 * in, so `matches` (which rows stay) and `segments` (which runs are marked)
 * can never disagree about what a query finds.
 */

const LOCALE = 'bg';

/** The query as it is matched: trimmed and case-folded. */
function folded(raw: string): string {
  return raw.trim().toLocaleLowerCase(LOCALE);
}

export const TextMatchSystem = {
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
    if (text.length === 0) return [];
    const needle = folded(query);
    const haystack = text.toLocaleLowerCase(LOCALE);
    if (needle.length === 0 || haystack.length !== text.length) {
      return [{ text, hit: false }];
    }
    const out: TextSegment[] = [];
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      if (at > from) out.push({ text: text.slice(from, at), hit: false });
      out.push({ text: text.slice(at, at + needle.length), hit: true });
      from = at + needle.length;
    }
    if (from < text.length) out.push({ text: text.slice(from), hit: false });
    return out;
  },
} as const;
