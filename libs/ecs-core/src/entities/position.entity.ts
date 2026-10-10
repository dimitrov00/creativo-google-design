import type { LocalizedText } from '../components/localized-text.data';
import type { PositionState } from '../components/program-status.data';
import type { LocationId } from './location.entity';

export type PositionId = string & { readonly __brand: unique symbol };
export const PositionId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): PositionId => raw as PositionId,
} as const;

/**
 * An open role on the careers page — `positions/{id}` (the stored body of
 * `position-repository.adapter.ts:21-29`), **every optional present**: the
 * legacy reader re-added `applyUrl` by conditional spread, so one collection
 * carried two hidden-class shapes. Empty `locationIds` means every location.
 * `applyUrl` is where "Apply" sends a candidate; `null` falls back to the
 * shop's shared contact link.
 */
export type PositionEntity = {
  readonly id: PositionId;
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  readonly locationIds: readonly LocationId[];
  readonly status: PositionState;
  readonly applyUrl: string | null;
  readonly sortOrder: number;
};
