import type { ClientStats } from './client-stats.data';

/*
 * Split out of `client-stats.data.ts` (pass D, S-21; one name per file,
 * L-1). The fields are `ClientStats`'s own, picked — declared once, there.
 */

/** The last visit's fields — what «Пак същото» rebooks. */
export type LastVisit = Pick<
  ClientStats,
  | 'lastVisitAppointmentId'
  | 'lastVisitLocalDate'
  | 'lastVisitStartMinutes'
  | 'lastVisitServiceIds'
  | 'lastVisitBarberIds'
  | 'lastVisitLegs'
>;

const NO_LAST_VISIT: LastVisit = {
  lastVisitAppointmentId: null,
  lastVisitLocalDate: null,
  lastVisitStartMinutes: null,
  lastVisitServiceIds: [],
  lastVisitBarberIds: [],
  lastVisitLegs: [],
};

export const LastVisit = {
  /** No worked visit yet. */
  NONE: NO_LAST_VISIT,
} as const;
