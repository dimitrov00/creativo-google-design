import type { ServiceId } from '@core/primitives';

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
): readonly { readonly id: string; readonly tiles: readonly T[] }[] {
  const rows: { id: string; tiles: T[] }[] = [];
  for (const tile of tiles) {
    const id = hasVariant(tile) ? serviceOf(tile) : 'PLAIN';
    const last = rows[rows.length - 1];
    if (last !== undefined && last.id === id) last.tiles.push(tile);
    else rows.push({ id, tiles: [tile] });
  }
  return rows.map((row, at) => ({
    ...row,
    id: row.id === 'PLAIN' ? `PLAIN:${at}` : row.id,
  }));
}
