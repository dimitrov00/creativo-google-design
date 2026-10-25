/** A scope page's section — `scopeSection`. */
export const ScopeSection = {
  ServiceCategory: 'SERVICE_CATEGORY',
  Barbers: 'BARBERS',
  Shops: 'SHOPS',
  General: 'GENERAL',
  Whole: 'WHOLE',
} as const;
export type ScopeSection = (typeof ScopeSection)[keyof typeof ScopeSection];
