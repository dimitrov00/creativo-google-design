import type { Locator, Page, TestInfo } from '@playwright/test';
import { shopToday } from './shop-clock';

/**
 * The days after today the booking calendar lets you tap, in calendar order.
 *
 * Today is skipped: its cell turns on before its live query answers, and by
 * evening it can have no time left worth booking.
 */
export function bookableDays(page: Page): Locator {
  return page.locator(
    `[data-testid="booking-day"]:not([disabled]):not([data-day-key="${shopToday()}"])`,
  );
}

/**
 * Which of the bookable days this run books, as an index into them.
 *
 * Two runs booking at the same moment must never share a day. On a shared
 * day one run's booking re-renders the other's live time list under its
 * pick, which is then lost, or both take the same first time and one
 * correctly loses with «Този час току-що се зае»: the product's answer to a
 * real race, and a failure here. Runs at the same moment always hold
 * different `parallelIndex`es, whatever their project, repeat or retry
 * (Playwright: "workers running at the same time have a different
 * parallelIndex", all below `workers`). So the lane keeps `parallelIndex` as
 * its remainder by `workers`, and no two of them can meet.
 *
 * The quotient spreads the runs ONE worker makes in turn (every project,
 * every `--repeat-each` copy, every retry) over further days, as far as
 * `bookableDays` holds them, so a run seldom books a day an earlier one
 * booked while that booking's busy projection may still be landing.
 */
export function bookingLane(info: TestInfo, bookableDays: number): number {
  const workers = Math.max(1, info.config.workers);
  const projects = info.config.projects.map((project) => project.name);
  const project = Math.max(0, projects.indexOf(info.project.name));
  const turn =
    (info.repeatEachIndex * projects.length + project) *
      (info.project.retries + 1) +
    info.retry;
  const turns = Math.max(1, Math.floor(bookableDays / workers));
  return info.parallelIndex + workers * (turn % turns);
}
