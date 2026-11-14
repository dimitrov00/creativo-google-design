/**
 * What a staff level may do — the field `staffCapability`, the ONLY source
 * of these strings (`docs/designs/staff-permissions.md`, P2). The owner
 * sets, per level, how far each reaches (`AccessScope`); the callables that
 * enforce one read it through `StaffAccessSystem`.
 *
 * **A capability exists only once it is enforced (P13).** This dictionary
 * holds the capabilities whose stage has shipped — stage A's six, the calls
 * that already judged the stored account. A planned one keeps today's fixed
 * behaviour until its stage adds it here, so the editor can never save a
 * cell nothing reads. Dictionary order is the editor's order.
 */
export const StaffCapability = {
  /** Block time, clear or move a block, change one day's breaks (`setDayExceptions`). */
  TimeOff: 'TIME_OFF',
  /** Weekly hours and standing breaks (`setRosterWeek`, `amendRosterBreaks`). */
  Hours: 'HOURS',
  /** Own: own numbers and own goal. All: the shop's and every barber's (`staffAnalytics`, `setAnalyticsGoal`). */
  Analytics: 'ANALYTICS',
  /** A barber's name, title, bio, Instagram, experience (`editBarber`, the profile part). */
  TeamProfiles: 'TEAM_PROFILES',
  /** A barber's services, prices and durations (`setBarberOfferings`). */
  TeamOfferings: 'TEAM_OFFERINGS',
  /** Add a barber, their shops, working period, booking access and pool flag, delete a draft, the full Team list. */
  TeamManage: 'TEAM_MANAGE',
} as const;
export type StaffCapability =
  (typeof StaffCapability)[keyof typeof StaffCapability];
