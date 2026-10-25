import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timedRead } from './timed-read';

const FAILURES = { timedOut: 'timed-out', threw: 'threw' } as const;

describe('timedRead — one read raced against its budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers the read’s own answer within the budget, and lets its timer go', async () => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const answer = timedRead(
      () => Promise.resolve(42),
      1_000,
      timers,
      FAILURES,
    );
    expect(timers.size).toBe(1);
    await expect(answer).resolves.toBe(42);
    expect(timers.size).toBe(0);
  });

  it('answers the timed-out failure once the budget passes, and ignores a later answer', async () => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let answerLate: (value: number) => void = () => undefined;
    const answer = timedRead(
      () =>
        new Promise<number>((resolve) => {
          answerLate = resolve;
        }),
      1_000,
      timers,
      FAILURES,
    );
    vi.advanceTimersByTime(999);
    expect(timers.size).toBe(1);
    vi.advanceTimersByTime(1);
    expect(timers.size).toBe(0);
    answerLate(42);
    await expect(answer).resolves.toBe('timed-out');
  });

  it('answers the threw failure for a read that throws synchronously', async () => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const answer = timedRead(
      () => {
        throw new Error('boom');
      },
      1_000,
      timers,
      FAILURES,
    );
    await expect(answer).resolves.toBe('threw');
    expect(timers.size).toBe(0);
  });

  it('answers the threw failure for a read that rejects', async () => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const answer = timedRead(
      () => Promise.reject(new Error('boom')),
      1_000,
      timers,
      FAILURES,
    );
    await expect(answer).resolves.toBe('threw');
    expect(timers.size).toBe(0);
  });

  it('keeps every pending timer in the caller’s set, so a teardown can clear them all', () => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const never = () => new Promise<number>(() => undefined);
    void timedRead(never, 1_000, timers, FAILURES);
    void timedRead(never, 2_000, timers, FAILURES);
    expect(timers.size).toBe(2);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    vi.advanceTimersByTime(5_000);
    expect(timers.size).toBe(0);
  });
});
