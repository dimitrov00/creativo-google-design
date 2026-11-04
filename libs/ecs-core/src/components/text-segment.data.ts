/**
 * A run of text, marked when it is what was typed — the one shape every
 * search hands a screen to print a match (moved from `client-query.system.ts`
 * so `TextMatchSystem` and `ClientQuerySystem` share it without importing each
 * other).
 */
export type TextSegment = {
  readonly text: string;
  readonly hit: boolean;
};
