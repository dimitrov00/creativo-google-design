import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeWithRetry } from './subscribe-with-retry';

/** A controllable fake for the raw `onSnapshot` subscribe shape. */
function harness() {
  let onNext: (value: string) => void = () => undefined;
  let onError: (error: unknown) => void = () => undefined;
  let subscribeCalls = 0;
  const subscribe = (
    next: (value: string) => void,
    error: (error: unknown) => void,
  ) => {
    subscribeCalls++;
    onNext = next;
    onError = error;
    return () => undefined;
  };
  return {
    subscribe,
    next: (value: string) => onNext(value),
    error: (error: unknown) => onError(error),
    calls: () => subscribeCalls,
  };
}

describe('subscribeWithRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('delivers snapshots as ok results', () => {
    const h = harness();
    const seen: boolean[] = [];
    const sub = subscribeWithRetry(h.subscribe).subscribe((result) =>
      seen.push(result.isSuccess()),
    );

    h.next('a');
    expect(seen).toEqual([true]);
    sub.unsubscribe();
  });

  it('retries a retryable code on the backoff schedule', () => {
    const h = harness();
    const sub = subscribeWithRetry(h.subscribe).subscribe(() => undefined);

    expect(h.calls()).toBe(1);
    h.error({ code: 'unavailable' });
    vi.advanceTimersByTime(500);
    expect(h.calls()).toBe(2);
    sub.unsubscribe();
  });

  // The contract that stops one deployment defect from becoming an infinite
  // billed re-read loop per open tab: a rule denial or missing composite
  // index cannot be healed by listening again.
  it.each(['permission-denied', 'failed-precondition', 'unauthenticated'])(
    'surfaces %s once and never re-subscribes',
    (code) => {
      const h = harness();
      const seen: boolean[] = [];
      const sub = subscribeWithRetry(h.subscribe).subscribe((result) =>
        seen.push(result.isSuccess()),
      );

      h.error({ code });
      vi.advanceTimersByTime(60_000);

      expect(seen).toEqual([false]);
      expect(h.calls()).toBe(1);
      sub.unsubscribe();
    },
  );

  // Adapters route domain-mapping failures (a doc that refuses to parse)
  // through the same onError. No Firestore code ⇒ re-reading cannot fix it.
  it('treats a code-less domain error as terminal', () => {
    const h = harness();
    const sub = subscribeWithRetry(h.subscribe).subscribe(() => undefined);

    h.error(new Error('appointment doc failed domain validation'));
    vi.advanceTimersByTime(60_000);

    expect(h.calls()).toBe(1);
    sub.unsubscribe();
  });

  it('resets the backoff schedule after a successful snapshot', () => {
    const h = harness();
    const sub = subscribeWithRetry(h.subscribe).subscribe(() => undefined);

    h.error({ code: 'unavailable' });
    vi.advanceTimersByTime(500); // schedule position 1 consumed
    h.next('healed'); // attempt counter resets
    h.error({ code: 'unavailable' });
    vi.advanceTimersByTime(499);
    expect(h.calls()).toBe(2); // not yet — back on the FIRST delay
    vi.advanceTimersByTime(1);
    expect(h.calls()).toBe(3);
    sub.unsubscribe();
  });
});
