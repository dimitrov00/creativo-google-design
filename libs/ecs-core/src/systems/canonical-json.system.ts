/**
 * JSON with every object's keys sorted — ONE spelling per value, so two
 * equal values always print the same text whatever order their keys were
 * written in. The basis of every change test and digest that compares
 * documents or commands by content: `ClientStatsSystem` (its
 * `canonicalJson` delegates here, unchanged), the governed-document change
 * test and the log digest (`LogDigestSystem`, audit-hardening WS-4.2).
 * Moved out of `ClientStatsSystem` so a digest of a command does not reach
 * through the stats system for a JSON printer (§7 "reuse, never copy").
 *
 * Pure (Law 3): the value is read, never written; arrays keep their order
 * (an array's order is content); `JSON.stringify`'s own rules apply to the
 * leaves (`undefined` and functions vanish from records and print `null` in
 * arrays).
 *
 * Its UTF-8 weigher ({@link CanonicalJsonSystem.utf8Bytes}) moved here from
 * `ClientIssueSystem` (audit-hardening Phase 3, P3-RU-27), where the issue
 * sink's batch cap reads it unchanged: the client export's byte cap weighs
 * this printer's text with the same counter — one counter, never a copy.
 */
export const CanonicalJsonSystem = {
  /** JSON with object keys sorted, so two equal values always print the same. */
  of(value: unknown): string {
    return JSON.stringify(value, (_key, raw: unknown) => {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return raw;
      }
      return Object.fromEntries(
        Object.entries(raw).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    });
  },

  /**
   * How many bytes a text weighs in UTF-8 — counted by code unit, nothing
   * encoded: one below U+0080, two below U+0800, four for a surrogate PAIR,
   * three for everything else (a lone surrogate included, as an encoder's
   * replacement character weighs). Read on JSON, where every lone surrogate
   * is already an escape, so a lead surrogate there always starts a pair.
   */
  utf8Bytes(text: string): number {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (
        isLeadSurrogate(code) &&
        isTrailSurrogate(text.charCodeAt(i + 1))
      ) {
        bytes += 4;
        i++;
      } else bytes += 3;
    }
    return bytes;
  },
} as const;

/** A UTF-16 lead surrogate. */
function isLeadSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** A UTF-16 trail surrogate. */
function isTrailSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
