import type { BarberState } from '../components/catalog-status.data';
import type { LocalizedText } from '../components/localized-text.data';
import type { MediaRef } from '../components/media-ref.data';
import type { LocationId } from './location.entity';

export type BarberId = string & { readonly __brand: unique symbol };
export const BarberId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): BarberId => raw as BarberId,
} as const;

/**
 * A craftsman's public profile — `barbers/{id}` (`barber.ts:28-34`,
 * `catalog-reader.adapter.ts:174-186`).
 *
 * No offerings — the pricing matrix lives on each service
 * (`ServiceEntity.offerings`) — and deliberately no rating: fabricated
 * ratings read as a scam. Empty `locationIds` means every location. Absent
 * is `null`: a barber with no avatar, no stated experience or no Instagram
 * still has every key.
 */
export type BarberEntity = {
  readonly id: BarberId;
  readonly name: LocalizedText;
  /** The trimmed, non-blank public handle. */
  readonly handle: string;
  readonly title: LocalizedText;
  readonly bio: LocalizedText;
  readonly avatar: MediaRef | null;
  /** A non-negative integer, or `null` when not stated. */
  readonly yearsExperience: number | null;
  readonly locationIds: readonly LocationId[];
  /** The trimmed Instagram handle, or `null` when none is given. */
  readonly instagramHandle: string | null;
  readonly status: BarberState;
  readonly sortOrder: number;
};
