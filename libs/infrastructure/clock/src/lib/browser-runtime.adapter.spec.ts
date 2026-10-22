import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientOperationId } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  browserClockPorts,
  browserIdPorts,
  browserTimerPorts,
} from './browser-runtime.adapter';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('browserClockPorts — CLOCK_PORTS', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers the runtime instant, inside the spec’s own Date.now() bracket', () => {
    const before = Date.now();
    const now = browserClockPorts().nowUtcMs();
    const after = Date.now();

    expect(Number.isSafeInteger(now)).toBe(true);
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('reads the clock on every call, never once at construction', () => {
    const clock = browserClockPorts();
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);

    expect([clock.nowUtcMs(), clock.nowUtcMs()]).toEqual([1_000, 2_000]);
  });

  // Ported from `system-clock.adapter.spec.ts` (the class is deleted with
  // Phase 4a, 4A-14): "now" for a valid zone is the instant placed on that
  // zone's wall clock; an invalid zone is refused by the zone check — the
  // clock never takes a zone (Law 7.2).
  it('resolves the current instant on a valid zone’s wall clock', () => {
    const zone = ZonedTimeSystem.checkZone('Europe/Sofia');
    expect(zone.ok).toBe(true);
    if (!zone.ok) return;
    const now = ZonedTimeSystem.shopNow(
      browserClockPorts().nowUtcMs(),
      zone.value,
    );
    expect(now.currentMinute).toBeGreaterThanOrEqual(0);
    expect(now.currentMinute).toBeLessThan(1440);
  });

  it('refuses an invalid zone before any clock reading is placed on it', () => {
    expect(ZonedTimeSystem.checkZone('Not/AZone').ok).toBe(false);
  });

  it('treats an unreadable host clock as a defect, never an answer', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Number.NaN);

    expect(() => browserClockPorts().nowUtcMs()).toThrow(
      /defect: the browser clock is unreadable/,
    );
  });
});

describe('browserIdPorts — ID_PORTS', () => {
  it('draws a fresh v4 UUID on every call', () => {
    const ids = browserIdPorts();

    const first = ids.nextId();
    const second = ids.nextId();

    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(first).not.toBe(second);
  });

  // `crypto-id-generator.adapter.spec.ts`' one case («a non-empty, unique id
  // on each call») is the case above — dead with the class (4A-14).

  it('draws ids the wire takes as client operation ids (4A-12)', () => {
    expect(ClientOperationId.is(browserIdPorts().nextId())).toBe(true);
  });
});

describe('browserTimerPorts — TIMER_PORTS', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the delay asked for, never before', async () => {
    vi.useFakeTimers();
    let done = false;
    const waited = browserTimerPorts()
      .delay(250)
      .then(() => {
        done = true;
      });
    await vi.advanceTimersByTimeAsync(249);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waited;
    expect(done).toBe(true);
  });
});
