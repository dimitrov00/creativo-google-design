import type { ClockPorts, IdPorts, TimerPorts } from '@core/ports';
import { UtcEpochMs, defect } from '@core/primitives';

/**
 * The browser's clock, id source and timer as ECS bundles (flip 4, plan
 * §3.7, F4-9; the timer Phase 4a 4A-7) — what `CLOCK_PORTS`, `ID_PORTS`
 * and `TIMER_PORTS` bind in the web's composition root, so a feature reads
 * "now", draws an id and waits through a port its specs pin
 * (`memoryClockPorts`, `memoryIdPorts`, `immediateTimerPorts` of
 * `@core/testing`).
 *
 * No SDK: eager, in the initial chunk.
 */

/**
 * The instant now, as an absolute `UtcEpochMs` — the zone is the caller's to
 * apply (a location's, through `ZonedTimeSystem`). The runtime clock is
 * always inside `UtcEpochMs`'s window, so a refusal is a broken host, not an
 * expected outcome.
 */
export const browserClockPorts = (): ClockPorts => ({
  nowUtcMs: () => {
    const now = UtcEpochMs.of(Date.now());
    return now.ok
      ? now.value
      : defect(`the browser clock is unreadable: ${String(now.error.raw)}`);
  },
});

/** A fresh document id: the platform's `crypto.randomUUID()` (a v4 UUID). */
export const browserIdPorts = (): IdPorts => ({
  nextId: () => crypto.randomUUID(),
});

/** Wait `ms` milliseconds on the platform's `setTimeout` — never a clock read. */
export const browserTimerPorts = (): TimerPorts => ({
  delay: (ms) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
});
