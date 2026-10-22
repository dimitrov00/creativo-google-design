import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserClockPorts, browserIdPorts } from './browser-runtime.adapter';

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
});
