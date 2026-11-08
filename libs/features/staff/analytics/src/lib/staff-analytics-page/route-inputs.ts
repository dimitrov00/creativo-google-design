import { type Signal, effect, untracked } from '@angular/core';
import type { StaffAnalyticsStore } from '../staff-analytics.store';

/** The analytics screen's route-bound inputs — `?span=`, `?from=`, `?to=`, `?barber=`. */
export interface AnalyticsRouteInputs {
  readonly span: Signal<string | undefined>;
  readonly from: Signal<string | undefined>;
  readonly to: Signal<string | undefined>;
  readonly barber: Signal<string | undefined>;
}

/**
 * THE ANALYTICS URL AS INPUTS (`docs/designs/staff-analytics-v2.md`, State
 * and URL) — the schedule's `route-inputs.ts` pattern: one effect per
 * parameter, each handing the URL's text to the store, which parses it
 * ONCE at its edge. Called from the page's constructor (an injection
 * context).
 *
 * The URL is an INPUT here and an OUTPUT of the store — each pick replaces
 * it — so the echo of the store's own write must not be mistaken for a
 * request, or every pick would bounce (the schedule's chevrons did, before
 * its guard). Comparing against what the store last published leaves only
 * genuine external changes: the first look, and a new link. The published
 * record starts UNDEFINED ("never written"), so the first look at a silent
 * URL still reaches the store, which then stands on this month. An ABSENT
 * parameter reaches a route-bound input as `undefined` — the binder sets
 * every declared input from the route's data — and is handed on as `null`.
 *
 * Every store call is UNTRACKED: the store reads the published record
 * before it writes it, and a read inside an effect's own tracking would
 * make the effect depend on the signal it changes — and re-run on its own
 * write, forever. The store never navigates inside this first activation:
 * its write is deferred to the next task (`publishQuery`).
 */
export function bindAnalyticsRouteInputs(
  page: AnalyticsRouteInputs,
  store: StaffAnalyticsStore,
): void {
  effect(() => {
    const requested = page.span() ?? null;
    if (requested !== untracked(() => store.published().span)) {
      untracked(() => store.applyRouteSpan(requested));
    }
  });
  effect(() => {
    const requested = page.from() ?? null;
    if (requested !== untracked(() => store.published().from)) {
      untracked(() => store.applyRouteFrom(requested));
    }
  });
  effect(() => {
    const requested = page.to() ?? null;
    if (requested !== untracked(() => store.published().to)) {
      untracked(() => store.applyRouteTo(requested));
    }
  });
  effect(() => {
    const requested = page.barber() ?? null;
    if (requested !== untracked(() => store.published().barber)) {
      untracked(() => store.applyRouteBarber(requested));
    }
  });
}
