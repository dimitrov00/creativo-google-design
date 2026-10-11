import type { LocalizedText, PositionStatus } from '@core/components';
import type { LocationId, PositionId } from '@core/primitives';

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
