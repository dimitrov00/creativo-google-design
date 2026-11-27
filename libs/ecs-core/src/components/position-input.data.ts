import type { LocalizedText } from './localized-text.data';
import type { PositionStatus } from './program-status.data';
import type { WorkplaceMode } from './workplace-mode.data';

/**
 * A role as the admin typed it. `locationIds` empty = every location; a
 * remote role's are dropped by the system, whatever was typed.
 */
export type PositionInput = {
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  readonly workplaceMode: WorkplaceMode;
  readonly locationIds: readonly string[];
  readonly positionStatus: PositionStatus;
  /** Blank (after trimming) = none. */
  readonly applyUrl: string;
  readonly sortOrder: number;
};
