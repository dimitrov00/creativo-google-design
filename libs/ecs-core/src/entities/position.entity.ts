import type { LocalizedText } from '../components/localized-text.data';
import type { PositionStatus } from '../components/program-status.data';
import type { LocationId, PositionId } from '../primitives/ids.primitive';

/*
 * The id lives in `primitives/ids.primitive.ts` (flatten-spec §1.5); it is
 * re-exported here only while the barrel's staging block still names this
 * file (`index.ts`), and leaves with that line.
 */

/**
 * An open role on the careers page — `positions/{id}` (the stored body of
 * `position-repository.adapter.ts:21-29`), **every optional present**: the
 * legacy reader re-added `applyUrl` by conditional spread, so one collection
 * carried two hidden-class shapes. Empty `locationIds` means every location.
 * `applyUrl` is where "Apply" sends a candidate; `null` falls back to the
 * shop's shared contact link. `positionStatus` was `status` (N8).
 */
export type Position = {
  readonly id: PositionId;
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  readonly locationIds: readonly LocationId[];
  readonly positionStatus: PositionStatus;
  readonly applyUrl: string | null;
  readonly sortOrder: number;
};
