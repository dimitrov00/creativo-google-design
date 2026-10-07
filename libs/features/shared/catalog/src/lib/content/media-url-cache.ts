import { signal } from '@angular/core';
import {
  MediaUnavailableError,
  type MediaReader,
  type MediaRef,
  type MediaVariant,
} from '@creativo/application/catalog';

/**
 * How a TRANSIENT failed resolve is tried again: a bounded number of
 * attempts, spaced by a growing delay. A permanent answer
 * (`MediaUnavailableError`) is never retried, whatever the policy.
 */
export interface MediaRetryPolicy {
  /** Resolves one media object gets in a session, the first included. */
  readonly maxAttempts: number;
  /** The wait before the retry that follows the `failures`-th failure (1…). */
  backoffMs(failures: number): number;
}

/**
 * Four attempts, the retries about 2 s, 8 s and 30 s after each failure,
 * each drawn from the upper half of its ceiling ("equal jitter") so a batch
 * of covers that failed together does not come back together.
 *
 * The Storage SDK already retries a network error inside one attempt (up to
 * its own two-minute operation limit), so a failure reaching this layer has
 * outlived one blip. Four of them cover several minutes of a bad connection.
 * A missing or forbidden object is not a failure of that kind: it costs
 * exactly one request (see `MediaUnavailableError`).
 */
export const DEFAULT_MEDIA_RETRY_POLICY: MediaRetryPolicy = {
  maxAttempts: 4,
  backoffMs: (failures) => {
    const ceiling = Math.min(30_000, 2_000 * 4 ** (failures - 1));
    return ceiling / 2 + Math.random() * (ceiling / 2);
  },
};

type Entry =
  | { readonly state: 'inFlight' }
  | {
      readonly state: 'waiting';
      readonly timer: ReturnType<typeof setTimeout>;
    }
  | { readonly state: 'settled' }
  | {
      readonly state: 'unavailable';
      readonly reason: MediaUnavailableError['reason'];
    }
  | { readonly state: 'exhausted' };

/**
 * `MediaRef` → servable URL, resolved once per media object and kept for the
 * session: the cache a live catalogue needs so that a snapshot re-emit never
 * re-fetches what is already known or on its way.
 *
 * Keyed by the Storage PATH, the thing `resolve` actually fetches: two
 * services sharing one cover resolve once, and a cover replaced in the
 * catalogue (a new path) resolves afresh instead of keeping the old URL.
 *
 * **A transient failure is not final.** A failed resolve (a
 * `RepositoryError`, a rejected promise or a throw) is retried on a timer by
 * `policy` — never from `request`, so a catalogue that re-emits while a
 * retry waits cannot turn one failure into a storm. After `maxAttempts` the
 * object stays on its placeholder until the page reloads.
 *
 * **A permanent answer is final at once.** `MediaUnavailableError` (the
 * object is missing, or the rules forbid reading it) is Storage saying the
 * same thing it will say next time: the object stays on its placeholder
 * after that one request. So does an empty answer (no variants): it settles
 * without a URL and is not asked again.
 *
 * **Except a `forbidden` answer, for the next viewer.** The rules answered
 * the viewer who asked; after a sign-in, a sign-out or a change of roles
 * (`identityChanged`) the same object may be readable, so that answer is
 * forgotten and the next `request` asks again. A `not_found` answer holds
 * for everyone and stays. (Catalogue media is public in `storage.rules`
 * today, so this matters only once some of it moves behind auth.)
 */
export class MediaUrlCache {
  private readonly urls = signal<Readonly<Record<string, string>>>({});
  private readonly entries = new Map<string, Entry>();
  private disposed = false;
  /** Bumped by `identityChanged`: which viewer an answer in flight was asked as. */
  private viewer = 0;

  constructor(
    private readonly reader: MediaReader,
    private readonly policy: MediaRetryPolicy = DEFAULT_MEDIA_RETRY_POLICY,
  ) {}

  /** The resolved URL, or `undefined` while unknown. Reactive: reads a signal. */
  url(ref: MediaRef | null | undefined): string | undefined {
    return ref ? this.urls()[ref.path] : undefined;
  }

  /**
   * Starts a resolve for every ref not yet known, in flight, waiting on a
   * retry, answered as unavailable, or given up on. Safe to call on every
   * catalogue emission.
   */
  request(refs: Iterable<MediaRef>): void {
    if (this.disposed) return;
    for (const ref of refs) {
      if (this.entries.has(ref.path)) continue;
      this.attempt(ref, 0);
    }
  }

  /**
   * The viewer changed — a sign-in, a sign-out, a change of roles. Every
   * `forbidden` answer was the rules' answer to the LAST viewer, so it is
   * forgotten and the next `request` asks again; one still in flight is
   * asked again the moment it lands. A missing object stays answered, and
   * a resolved URL stays served: neither depends on who asks.
   */
  identityChanged(): void {
    if (this.disposed) return;
    this.viewer++;
    for (const [path, entry] of this.entries) {
      if (entry.state === 'unavailable' && entry.reason === 'forbidden') {
        this.entries.delete(path);
      }
    }
  }

  /** Cancels every waiting retry and ignores answers still in flight. */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      if (entry.state === 'waiting') clearTimeout(entry.timer);
    }
  }

  private attempt(ref: MediaRef, failures: number): void {
    this.entries.set(ref.path, { state: 'inFlight' });
    const askedAs = this.viewer;
    let answer: ReturnType<MediaReader['resolve']>;
    try {
      answer = this.reader.resolve(ref);
    } catch (error) {
      answer = Promise.reject(error);
    }
    void answer.then(
      (result) => {
        if (result.isSuccess()) this.settle(ref, result.value);
        else if (result.error instanceof MediaUnavailableError)
          this.markUnavailable(ref, result.error.reason, askedAs);
        else this.fail(ref, failures + 1);
      },
      () => this.fail(ref, failures + 1),
    );
  }

  private settle(ref: MediaRef, variants: readonly MediaVariant[]): void {
    if (this.disposed) return;
    this.entries.set(ref.path, { state: 'settled' });
    const [variant] = variants;
    if (!variant) return;
    this.urls.update((urls) => ({ ...urls, [ref.path]: variant.url }));
  }

  /**
   * Storage's permanent "no": the placeholder stays, nothing is asked again
   * — unless it was a `forbidden` answer to a viewer who has since changed,
   * which is asked again at once, as the viewer there is now.
   */
  private markUnavailable(
    ref: MediaRef,
    reason: MediaUnavailableError['reason'],
    askedAs: number,
  ): void {
    if (this.disposed) return;
    if (reason === 'forbidden' && askedAs !== this.viewer) {
      this.attempt(ref, 0);
      return;
    }
    this.entries.set(ref.path, { state: 'unavailable', reason });
  }

  private fail(ref: MediaRef, failures: number): void {
    if (this.disposed) return;
    if (failures >= this.policy.maxAttempts) {
      this.entries.set(ref.path, { state: 'exhausted' });
      return;
    }
    const timer = setTimeout(
      () => this.attempt(ref, failures),
      this.policy.backoffMs(failures),
    );
    this.entries.set(ref.path, { state: 'waiting', timer });
  }
}
