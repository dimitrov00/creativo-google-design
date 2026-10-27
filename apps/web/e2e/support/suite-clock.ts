import type { Page } from '@playwright/test';
import { type LocalDate, UtcEpochMs } from '@core/primitives';
import {
  browserPinOf,
  instantOfText,
  resolveSuiteInstant,
  shopDayOf,
  sure,
} from './shop-clock';

/**
 * THE SUITE'S ONE INSTANT, the Node half (Phase 3 WS-A, P3-DEP-3, P3-L-1):
 * global setup resolves it once and hands it to every worker through
 * `process.env`; a PINNED spec reads its day from here and pins the page's
 * clock to that day at 10:00 on the shop's clock (P3-DEP-4). The pure half —
 * the text grammar, the pinned instant of a day, the one day check — is
 * `shop-clock.ts`, held by `apps/web/src/testing/e2e-suite-clock.spec.ts`.
 *
 * Playwright runs the global setup inside its runner process and forks every
 * worker — a restarted one too — with that process's `process.env`, so an
 * instant written there reaches all the processes of one run.
 */

/**
 * The variable that carries the run's instant: the seed's text grammar
 * (P3-RU-3). Read and written below by its literal key, as the suite's other
 * variables are.
 */
export const SUITE_NOW_ENV = 'E2E_NOW';

/**
 * Global setup ONLY: the run's instant — `E2E_NOW` when given (it must fall
 * on the real shop day), else the real clock — written back as epoch
 * milliseconds for the workers to inherit.
 */
export function fixSuiteInstant(): UtcEpochMs {
  const instant = resolveSuiteInstant(
    process.env['E2E_NOW'] ?? null,
    sure(UtcEpochMs.of(Date.now()), 'now'),
  );
  process.env['E2E_NOW'] = String(instant);
  return instant;
}

/**
 * The run's instant as a worker reads it: the `E2E_NOW` global setup wrote —
 * trusted, never checked against the real day again (a worker started after
 * the real midnight keeps the run's day).
 */
export function suiteNowUtcMs(): UtcEpochMs {
  const text = process.env['E2E_NOW'];
  if (text === undefined) {
    throw new Error(
      `e2e: ${SUITE_NOW_ENV} is unset — run the suite through the Playwright config, whose global setup fixes the run's instant`,
    );
  }
  return instantOfText(text);
}

/** The suite's shop day — what a PINNED spec calls "today" (never the live `shopToday()`). */
export function suiteDay(): LocalDate {
  return shopDayOf(suiteNowUtcMs());
}

/** The browser's pinned instant for this run: the suite's day at 10:00 on the shop's clock. */
export function browserNowUtcMs(): UtcEpochMs {
  return browserPinOf(suiteDay());
}

/**
 * Sets the page's clock to the suite's day at 10:00 and lets it RUN from
 * there (`setSystemTime`: the time flows with the real clock; timers keep
 * running) — FIRST, before any `goto` or `signInAs`. Not `setFixedTime`:
 * a frozen `Date.now()` starves every watchdog that measures elapsed time
 * with it — the Firestore channel's stalled-request timeout among them — so
 * a listener that met one slow answer waited forever (the C_A gate's two
 * reds: an agenda row and a card's name that never arrived). A run of
 * minutes stays hours short of the 21:00 visit it reads as to come.
 *
 * A pinned page must never meet the two rules that judge a client stamp
 * against the server's real time: the notes / photos ±300 s stamp window
 * (`firestore.rules`, DEP-15) and an inbox read stamp
 * `readAtUtcMs >= sentAtUtcMs` — so a pinned spec authors no note or photo
 * through the UI and marks no notification read.
 */
export async function pinBrowserClock(page: Page): Promise<void> {
  await page.clock.setSystemTime(browserNowUtcMs());
}
