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
} as const;
