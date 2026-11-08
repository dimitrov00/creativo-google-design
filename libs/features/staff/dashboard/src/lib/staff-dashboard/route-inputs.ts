import { type Signal, effect, untracked } from '@angular/core';
import type { StaffDayStore } from '../staff-day.store';

/** The schedule's route-bound inputs — `?day=`, `?view=`, `?barber=`, `?free=`. */
export interface ScheduleRouteInputs {
  readonly day: Signal<string | null>;
  readonly view: Signal<string | null>;
  readonly barber: Signal<string | null>;
  readonly free: Signal<string | null>;
}

/**
 * THE SCHEDULE'S URL AS INPUTS — one effect per parameter, each handing the
 * URL's text to the store, which parses it ONCE at its edge. Called from
 * the page's constructor (an injection context). Moved out of
 * `staff-dashboard.ts` beside `?free=` (staff-analytics, 2026-11-08), that
 * file's line cap only shrinking.
 *
 * The URL is an INPUT here and an OUTPUT of the store, so the echo of the
 * store's own write must not be mistaken for the user asking for a day —
 * that bounced every chevron press straight back to today. Comparing
 * against what the store last published leaves only genuine external
 * changes: the first load, and the back button.
 */
export function bindRouteInputs(
  page: ScheduleRouteInputs,
  store: StaffDayStore,
): void {
  effect(() => {
    const requested = page.day() ?? null;
    // `published` is read UNTRACKED: it changes as a RESULT of the day's
    // navigation, so tracking it re-fires this effect with a stale `day()`
    // and undoes the navigation that just happened. Only `day()` may wake
    // this. The text is the URL's: the store parses it ONCE, at its edge
    // (`applyRouteDay` → `LocalDate.parse`).
    if (requested !== untracked(() => store.published().day)) {
      untracked(() => store.applyRouteDay(requested));
    }
  });
  // The same guard for the view and the chair. An ABSENT parameter reaches
  // a route-bound input as `undefined`, not the input's `null` default —
  // the binder sets every declared input from the route's data — so both
  // are read as "silent" before the comparison. The view's published
  // value starts UNDEFINED (never written) so the first look at a silent
  // URL still reaches the store, which states the view the device
  // restored; the store sends no navigation when nothing changes.
  effect(() => {
    const requested = page.view() ?? null;
    const stated = untracked(() => store.published().view);
    if (stated === undefined || requested !== (stated ?? null)) {
      // UNTRACKED, like every store call from a route effect: the store
      // reads the published record before it writes it, and a read inside
      // this effect's own tracking would make the effect depend on the
      // signal it changes — and re-run on its own write, forever (found
      // live 2026-09-23 on the first silent URL after a remembered view).
      untracked(() => store.applyRouteView(requested));
    }
  });
  effect(() => {
    const requested = page.barber() ?? null;
    if (requested !== untracked(() => store.published().barber)) {
      untracked(() => store.applyRouteBarber(requested));
    }
  });
  // `?free=1` asks ONCE: the store draws free time for this visit and takes
  // the parameter out of the URL (its deferred write — never a navigation
  // inside this first activation). Its removal reads as silent, which asks
  // nothing.
  effect(() => {
    const requested = page.free() ?? null;
    if (requested !== null) untracked(() => store.applyRouteFree(requested));
  });
}
