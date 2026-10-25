import type { ClientStats } from './client-stats.data';

/*
 * Split out of `client-stats.data.ts` (pass D, S-21; one name per file,
 * L-1). The fields are `ClientStats`'s own, picked — declared once, there.
 */

/** The next visit's fields. */
export type NextVisit = Pick<
  ClientStats,
  | 'nextVisitAppointmentId'
  | 'nextVisitLocalDate'
  | 'nextVisitStartMinutes'
  | 'nextVisitServiceIds'
  | 'nextVisitBarberIds'
  | 'nextVisitLegs'
>;

const NO_NEXT_VISIT: NextVisit = {
  nextVisitAppointmentId: null,
  nextVisitLocalDate: null,
  nextVisitStartMinutes: null,
  nextVisitServiceIds: [],
  nextVisitBarberIds: [],
  nextVisitLegs: [],
};

export const NextVisit = {
  /** No open visit ahead. */
  NONE: NO_NEXT_VISIT,
} as const;
