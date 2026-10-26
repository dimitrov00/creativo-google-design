import type { EventId } from '@core/primitives';

/*
 * THE EVENTS PAGE'S DISPLAY MODEL (OR-37, Law 10.3) — what one row of
 * `/events` prints. Filled by `marketing-events.presenter.ts`; no function
 * lives here.
 */

/** One event as its row prints it. */
export type EventRowVm = {
  readonly id: EventId;
  /** «Ден на отворените врати» — the title in the active language. */
  readonly title: string;
  /**
   * «пн, 5.10, 19:00 · Център» — the start on the shop's wall clock, then
   * the shop it is at when the tenant has shops to tell apart; the date
   * alone for an event at no shop, at a one-shop tenant, or while the shops
   * are unread.
   */
  readonly whenLine: string;
  /** Where the row leads: the event's RSVP link, else the shop's Instagram. */
  readonly href: string;
};
