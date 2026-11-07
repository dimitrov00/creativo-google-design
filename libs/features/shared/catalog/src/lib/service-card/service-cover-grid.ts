import type { ServiceId } from '@core/primitives';

/**
 * ONE COVER CARD OF A SERVICE PICKER (owner, 2026-11-06: "services should
 * look the same as the others, the grid view, reused the DOD way") — the
 * plain struct `cr-service-cover-grid` draws: the schedule search's service
 * values, the visit sheet's «Добави услуга», the rhythm rule's «Услуги». A
 * tile is a TICK (on or off), never a count. A picker may carry its own
 * fields beside these (the option, the suggestion row) and has its tile
 * back, whole, from the grid's `uiPicked`.
 */
export type ServiceCoverTile = {
  /** The tile's key in its picker — an option key, a suggestion id. */
  readonly id: string;
  /** The service whose cover it is. */
  readonly serviceId: ServiceId;
  /** The service's name — it leads, under the cover. */
  readonly name: string;
  /** Under the name: the variant («Дълга коса»), '' for a plain service. */
  readonly meta: string;
  readonly coverSrc: string | null;
  readonly checked: boolean;
  /** A test hook for the card, when its picker names one. */
  readonly testId?: string;
};

/** A run of tiles laid out as one grid (`coverRowsOf`). */
export type ServiceCoverGrid<T> = {
  readonly id: string;
  readonly tiles: readonly T[];
};

/**
 * Service cover tiles as GRIDS (owner, 2026-11-05) — the schedule search's
 * and the visit sheet's «Добави услуга» alike (2026-11-06): services
 * WITHOUT variants flow together, three across; a service WITH variants
 * cuts that grid and stands in one of its own, its variants side by side;
 * the plain services after it start the next shared grid. In the order the
 * tiles came. A run of plain services is named by its place (`PLAIN:<n>`),
 * so two runs stay apart; a service's own grid by its id.
 */
export function coverRowsOf<T>(
  tiles: readonly T[],
  serviceOf: (tile: T) => ServiceId,
  hasVariant: (tile: T) => boolean,
): readonly ServiceCoverGrid<T>[] {
  // A run of plain services shares the key `null`; a service's own grid is
  // keyed by its id.
  const rows: { serviceId: string | null; tiles: T[] }[] = [];
  for (const tile of tiles) {
    const serviceId = hasVariant(tile) ? serviceOf(tile) : null;
    const last = rows[rows.length - 1];
    if (last !== undefined && last.serviceId === serviceId)
      last.tiles.push(tile);
    else rows.push({ serviceId, tiles: [tile] });
  }
  return rows.map((row, at) => ({
    id: row.serviceId ?? `PLAIN:${at}`,
    tiles: row.tiles,
  }));
}
