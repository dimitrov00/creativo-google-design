import type { LocalizedText } from './localized-text.data';
import type { PositionStatus } from './program-status.data';

/** A role as the admin typed it. `locationIds` empty = every location; the page always sends `[]`. */
export type PositionInput = {
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  readonly locationIds: readonly string[];
  readonly positionStatus: PositionStatus;
  /** Blank (after trimming) = none. */
  readonly applyUrl: string;
  readonly sortOrder: number;
};
