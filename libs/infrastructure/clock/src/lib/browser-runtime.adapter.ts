import type { ClockPorts, IdPorts } from '@core/ports';
import { UtcEpochMs, defect } from '@core/primitives';

/**
 * The browser's clock and id source as ECS bundles (flip 4, plan §3.7,
 * F4-9) — what `CLOCK_PORTS` and `ID_PORTS` bind in the web's composition
 * root, so a flipped feature reads "now" and draws an id through a port its
 * specs pin (`memoryClockPorts`, `memoryIdPorts` of `@core/testing`). The
 * legacy `SystemClock`/`CryptoIdGenerator` beside it stay for the features
 * that still inject `CLOCK`/`ID_GENERATOR` until Phase 4.
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
