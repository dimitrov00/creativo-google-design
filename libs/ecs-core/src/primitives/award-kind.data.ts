/** What a level paid — the award element's field `awardKind`. */
export const AwardKind = {
  Points: 'POINTS',
  Coupon: 'COUPON',
  Freeze: 'FREEZE',
  Perk: 'PERK',
} as const;
export type AwardKind = (typeof AwardKind)[keyof typeof AwardKind];
