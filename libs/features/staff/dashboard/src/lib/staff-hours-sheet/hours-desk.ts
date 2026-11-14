import { InjectionToken, type Signal } from '@angular/core';
import type { RosterCall } from '@core/components';
import type { StaffBlockFailure } from '@core/errors';
import type { ObserveSchedule } from '@core/ports';
import type { BarberId } from '@core/primitives';

/**
 * WHAT THE WEEKLY HOURS SHEET ASKS OF ITS HOST: a chair's roster to read,
 * the one write that saves a week, and how that write stands. The sheet
 * decides nothing about either — the week is `RosterWeekSystem`'s — so it
 * can be raised by any page that can answer these four: the schedule
 * (`StaffDayStore`, whose members these are) and a team member's page
 * (staff permissions, stage T).
 */
export type HoursDesk = {
  /** A chair's roster, live. */
  readonly rosterOf: (barberId: BarberId) => ReturnType<ObserveSchedule>;
  /** The week's save — `setRosterWeek`, ONE roster write; `true` once it landed. */
  readonly setRosterWeek: (week: RosterCall.WeekChange) => Promise<boolean>;
  /** Why the last save was refused; `null` when it was not. */
  readonly absenceError: Signal<StaffBlockFailure | null>;
  /** A save is on its way. */
  readonly absencePending: Signal<boolean>;
};

/** The hours sheet's host — provided by the page that raises the sheet. */
export const HOURS_DESK = new InjectionToken<HoursDesk>('HOURS_DESK');
