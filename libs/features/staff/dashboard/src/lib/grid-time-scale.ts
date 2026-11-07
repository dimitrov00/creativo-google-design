import { Injectable, signal } from '@angular/core';

/**
 * HOW MUCH TIME ONE ROW OF THE CALENDAR IS (owner, 2026-11-06: "configure
 * the time scale like Teams / Outlook — 30 min, 15 min, 60 min"). Outlook's
 * «Time scale»: a row keeps its height and the scale says how many minutes
 * it holds, so a finer scale is a taller day and a coarser one a shorter.
 *
 * ### The presets
 * A barbershop's day is cut in quarter-hours and half-hours, so:
 * - **10 мин** — the beard tidy-up and the fringe, readable as blocks;
 * - **15 мин** — the default: a half-hour cut holds two lines;
 * - **30 мин** — a full day on a phone in about two screens;
 * - **1 ч** — the whole day's shape at a glance, names only on the longer
 *   visits.
 * 5 minutes is left out: 288 rows is a scroll, not a calendar. Per DEVICE,
 * like the card fields: the front desk and a barber's phone differ.
 */
export const TIME_SCALES = [10, 15, 30, 60] as const;
export type TimeScaleMinutes = (typeof TIME_SCALES)[number];

const STORAGE_KEY = 'staff-schedule-time-scale';
const DEFAULT_SCALE: TimeScaleMinutes = 15;

function load(): TimeScaleMinutes {
  if (typeof localStorage === 'undefined') return DEFAULT_SCALE;
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return (TIME_SCALES as readonly number[]).includes(stored)
      ? (stored as TimeScaleMinutes)
      : DEFAULT_SCALE;
  } catch {
    // Corrupt or blocked storage is not worth a broken screen.
    return DEFAULT_SCALE;
  }
}

@Injectable({ providedIn: 'root' })
export class GridTimeScale {
  private readonly state = signal<TimeScaleMinutes>(load());

  /** The minutes one row of the calendar views holds. */
  readonly minutes = this.state.asReadonly();

  set(minutes: TimeScaleMinutes): void {
    this.state.set(minutes);
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, String(minutes));
    } catch {
      // The choice simply does not outlive the session.
    }
  }
}
