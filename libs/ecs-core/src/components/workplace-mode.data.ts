/**
 * Where a careers-page role is worked — the position's field
 * `workplaceMode`, as job boards word it: at a shop, partly at a shop, or
 * from anywhere.
 *
 * Admin-managed, a plain field (as `PositionStatus`). A remote role is tied
 * to no shop: `ProgramsSystem.position` stores it with no `locationIds`,
 * and the rules refuse one that names any. An on-site or hybrid role keeps
 * its shops (`[]` = every shop).
 */
export const WorkplaceMode = {
  OnSite: 'ON_SITE',
  Hybrid: 'HYBRID',
  Remote: 'REMOTE',
} as const;
export type WorkplaceMode = (typeof WorkplaceMode)[keyof typeof WorkplaceMode];
