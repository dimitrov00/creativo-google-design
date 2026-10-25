import { signal } from '@angular/core';
import type { MediaRef } from '@core/components';
import type {
  MediaResolvePorts,
  MediaVariant,
  ResolveMedia,
} from '@core/ports';
import { MediaError, MediaErrorCode } from '@core/errors';

/**
 * How a TRANSIENT failed resolve is tried again: a bounded number of
 * attempts, spaced by a growing delay. A permanent answer
 * (`MediaError.isPermanent`) is never retried, whatever the policy.
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
 * exactly one request (a permanent `MediaError`).
 */
export const DEFAULT_MEDIA_RETRY_POLICY: MediaRetryPolicy = {
  maxAttempts: 4,
  backoffMs: (failures) => {
    const ceiling = Math.min(30_000, 2_000 * 4 ** (failures - 1));
    return ceiling / 2 + Math.random() * (ceiling / 2);
  },
};

/**
 * Where one media object's resolve stands — the field `mediaFetchState`,
 * the ONLY source of these strings (Phase 4a, 4A-13's named view state).
 */
export const MediaFetchState = {
  InFlight: 'IN_FLIGHT',
  /** A transient failure; a retry waits on its timer. */
  Waiting: 'WAITING',
  Settled: 'SETTLED',
  /** Storage's permanent no (`MEDIA_NOT_FOUND` / `MEDIA_FORBIDDEN`). */
  Unavailable: 'UNAVAILABLE',
  /** `maxAttempts` transient failures — the placeholder stays. */
  Exhausted: 'EXHAUSTED',
} as const;
export type MediaFetchState =
  (typeof MediaFetchState)[keyof typeof MediaFetchState];

type Entry =
  | { readonly mediaFetchState: typeof MediaFetchState.InFlight }
  | {
      readonly mediaFetchState: typeof MediaFetchState.Waiting;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  | { readonly mediaFetchState: typeof MediaFetchState.Settled }
  | {
      readonly mediaFetchState: typeof MediaFetchState.Unavailable;
      readonly mediaErrorCode: MediaErrorCode;
    }
  | { readonly mediaFetchState: typeof MediaFetchState.Exhausted };

/** The session's `MediaRef` → URL cache — see {@link mediaUrlCache}. */
export type MediaUrlCache = {
  /** The resolved URL, or `undefined` while unknown. Reactive: reads a signal. */
  readonly url: (ref: MediaRef | null | undefined) => string | undefined;
  /**
   * Starts a resolve for every ref not yet known, in flight, waiting on a
   * retry, answered as unavailable, or given up on. Safe to call on every
   * catalogue emission.
   */
  readonly request: (refs: Iterable<MediaRef>) => void;
  /**
   * The viewer changed — a sign-in, a sign-out, a change of roles. Every
   * `MEDIA_FORBIDDEN` answer was the rules' answer to the LAST viewer, so it
   * is forgotten and the next `request` asks again; one still in flight is
   * asked again the moment it lands. A missing object stays answered, and a
   * resolved URL stays served: neither depends on who asks.
   */
  readonly identityChanged: () => void;
  /** Cancels every waiting retry and ignores answers still in flight. */
  readonly dispose: () => void;
};

/**
 * `MediaRef` → servable URL, resolved once per media object and kept for the
 * session: the cache a live catalogue needs so that a snapshot re-emit never
 * re-fetches what is already known or on its way (a closure, Phase 4a; was
 * the `MediaUrlCache` class over `MEDIA_READER`).
 *
 * Keyed by the Storage PATH (`mediaPath`), the thing a resolve fetches: two
 * services sharing one cover resolve once, and a cover replaced in the
 * catalogue (a new path) resolves afresh instead of keeping the old URL.
 *
 * **A transient failure is not final.** A `MEDIA_TRANSIENT` answer, a
 * rejected promise or a throw is retried on a timer by `policy` — never
 * from `request`, so a catalogue that re-emits while a retry waits cannot
 * turn one failure into a storm. After `maxAttempts` the object stays on
 * its placeholder until the page reloads.
 *
 * **A permanent answer is final at once** (`MediaError.isPermanent`): the
 * object is missing, or the rules forbid reading it — Storage will say the
 * same next time, so the object stays on its placeholder after that one
 * request. So does an empty answer (no variants).
 *
 * **Except a `MEDIA_FORBIDDEN` answer, for the next viewer** (see
 * `identityChanged`). A `MEDIA_NOT_FOUND` answer holds for everyone.
 */
export function mediaUrlCache(
  resolver: MediaResolvePorts,
  policy: MediaRetryPolicy = DEFAULT_MEDIA_RETRY_POLICY,
): MediaUrlCache {
  const urls = signal<Readonly<Record<string, string>>>({});
  const entries = new Map<string, Entry>();
  let disposed = false;
  /** Bumped by `identityChanged`: which viewer an answer in flight was asked as. */
  let viewer = 0;

  const settle = (ref: MediaRef, variants: readonly MediaVariant[]): void => {
    if (disposed) return;
    entries.set(ref.mediaPath, { mediaFetchState: MediaFetchState.Settled });
    const [variant] = variants;
    if (!variant) return;
    urls.update((known) => ({ ...known, [ref.mediaPath]: variant.url }));
  };

  /**
   * Storage's permanent "no": the placeholder stays, nothing is asked again
   * — unless it was a `MEDIA_FORBIDDEN` answer to a viewer who has since
   * changed, which is asked again at once, as the viewer there is now.
   */
  const markUnavailable = (
    ref: MediaRef,
    error: MediaError,
    askedAs: number,
  ): void => {
    if (disposed) return;
    if (error.errorCode === MediaErrorCode.Forbidden && askedAs !== viewer) {
      attempt(ref, 0);
      return;
    }
    entries.set(ref.mediaPath, {
      mediaFetchState: MediaFetchState.Unavailable,
      mediaErrorCode: error.errorCode,
    });
  };

  const fail = (ref: MediaRef, failures: number): void => {
    if (disposed) return;
    if (failures >= policy.maxAttempts) {
      entries.set(ref.mediaPath, {
        mediaFetchState: MediaFetchState.Exhausted,
      });
      return;
    }
    const timer = setTimeout(
      () => attempt(ref, failures),
      policy.backoffMs(failures),
    );
    entries.set(ref.mediaPath, {
      mediaFetchState: MediaFetchState.Waiting,
      timer,
    });
  };

  function attempt(ref: MediaRef, failures: number): void {
    entries.set(ref.mediaPath, { mediaFetchState: MediaFetchState.InFlight });
    const askedAs = viewer;
    let answer: ReturnType<ResolveMedia>;
    try {
      answer = resolver.resolveMedia(ref);
    } catch (error) {
      answer = Promise.reject(error);
    }
    void answer.then(
      (result) => {
        if (result.ok) settle(ref, result.value);
        else if (MediaError.isPermanent(result.error)) {
          markUnavailable(ref, result.error, askedAs);
        } else fail(ref, failures + 1);
      },
      () => fail(ref, failures + 1),
    );
  }

  return {
    url: (ref) => (ref ? urls()[ref.mediaPath] : undefined),
    request: (refs) => {
      if (disposed) return;
      for (const ref of refs) {
        if (entries.has(ref.mediaPath)) continue;
        attempt(ref, 0);
      }
    },
    identityChanged: () => {
      if (disposed) return;
      viewer++;
      for (const [path, entry] of entries) {
        if (
          entry.mediaFetchState === MediaFetchState.Unavailable &&
          entry.mediaErrorCode === MediaErrorCode.Forbidden
        ) {
          entries.delete(path);
        }
      }
    },
    dispose: () => {
      disposed = true;
      for (const entry of entries.values()) {
        if (entry.mediaFetchState === MediaFetchState.Waiting) {
          clearTimeout(entry.timer);
        }
      }
    },
  };
}
