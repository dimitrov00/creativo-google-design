/**
 * Where in a text a typed run counts as found — the ONLY source of these
 * strings. `ANYWHERE` is the plain "type to narrow a list" rule (the service
 * catalogue, the schedule search); `WORD_START` is the add-client page's rule,
 * which marks only the beginning of a word.
 */
export const MatchMode = {
  Anywhere: 'ANYWHERE',
  WordStart: 'WORD_START',
} as const;
export type MatchMode = (typeof MatchMode)[keyof typeof MatchMode];
