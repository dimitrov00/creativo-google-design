/**
 * A parameter of the rule a change can list, in the rule's own order —
 * every one of them, and the head's name. A version's identity (`version`,
 * `effectiveFromLocalDate`) is never listed: it is what every revision
 * changes. They name rule PARTS in the UI: consumers map by this dictionary.
 */
export const StreakRuleParameter = {
  Name: 'NAME',
  Enabled: 'ENABLED',
  Qualifier: 'QUALIFIER',
  MinGapDays: 'MIN_GAP_DAYS',
  BookingHold: 'BOOKING_HOLD',
  Interval: 'INTERVAL',
  GraceDays: 'GRACE_DAYS',
  RiskLeadDays: 'RISK_LEAD_DAYS',
  Protections: 'PROTECTIONS',
  Excuses: 'EXCUSES',
  ClientPause: 'CLIENT_PAUSE',
  Repair: 'REPAIR',
  OnBreak: 'ON_BREAK',
} as const;
export type StreakRuleParameter =
  (typeof StreakRuleParameter)[keyof typeof StreakRuleParameter];
