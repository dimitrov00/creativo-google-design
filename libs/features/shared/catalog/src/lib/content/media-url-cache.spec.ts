import * as fc from 'fast-check';
import {
  MediaRef,
  MediaUnavailableError,
  fail,
  ok,
  type MediaReadError,
  type MediaReader,
  type MediaVariant,
  type Result,
} from '@creativo/application/catalog';
import { RepositoryError } from '@creativo/application/shared';
import {
  DEFAULT_MEDIA_RETRY_POLICY,
  MediaUrlCache,
  type MediaRetryPolicy,
} from './media-url-cache';

type Answer = Result<readonly MediaVariant[], MediaReadError>;
/**
 * What one resolve does: answer, fail transiently (`fail`, `reject`,
 * `throw`), or answer permanently that the object is `missing` or
 * `forbidden`.
 */
type Outcome =
  'ok' | 'fail' | 'reject' | 'throw' | 'empty' | 'missing' | 'forbidden';

/** Deterministic spacing — 1 s, 2 s, 3 s… — so a test can step exactly to a retry. */
const POLICY: MediaRetryPolicy = {
  maxAttempts: 3,
  backoffMs: (failures) => failures * 1_000,
};

function refAt(path: string, id = `media-${path}`): MediaRef {
  const result = MediaRef.create({ id, path, width: 1200, height: 1500 });
  if (result.isFailure()) throw new Error('bad test ref');
  return result.value;
}

const urlOf = (path: string) => `https://cdn.test/${path}`;

/**
 * A reader that plays a script per path (the last step repeats) and
 * counts every call, so a test can say exactly how many requests reached
 * Storage.
 */
class ScriptedReader implements MediaReader {
  readonly calls: string[] = [];

  constructor(private readonly script: Readonly<Record<string, Outcome[]>>) {}

  callsFor(path: string): number {
    return this.calls.filter((called) => called === path).length;
  }

  resolve(ref: MediaRef): Promise<Answer> {
    this.calls.push(ref.path);
    const steps = this.script[ref.path] ?? ['ok'];
    const step =
      steps[Math.min(this.callsFor(ref.path) - 1, steps.length - 1)] ?? 'ok';
    switch (step) {
      case 'ok':
        return Promise.resolve(
          ok([{ width: ref.width, url: urlOf(ref.path) }]),
        );
      case 'empty':
        return Promise.resolve(ok([]));
      case 'fail':
        return Promise.resolve(fail(new RepositoryError('storage down')));
      case 'missing':
        return Promise.resolve(
          fail(new MediaUnavailableError('not_found', ref.path)),
        );
      case 'forbidden':
        return Promise.resolve(
          fail(new MediaUnavailableError('forbidden', ref.path)),
        );
      case 'reject':
        return Promise.reject(new Error('network'));
      case 'throw':
        throw new Error('reader bug');
    }
  }
}

/** Lets pending answers land, and moves the clock by `ms`. */
const elapse = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

describe('MediaUrlCache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe('success', () => {
    it('resolves a media object once and serves its URL', async () => {
      const reader = new ScriptedReader({});
      const cache = new MediaUrlCache(reader, POLICY);
      const cover = refAt('covers/fade.jpg');

      expect(cache.url(cover)).toBeUndefined();
      cache.request([cover]);
      await elapse();
      expect(cache.url(cover)).toBe(urlOf('covers/fade.jpg'));

      // A catalogue re-emit hands back the same ref: nothing to fetch.
      cache.request([cover]);
      cache.request([cover]);
      await elapse(60_000);
      expect(reader.callsFor('covers/fade.jpg')).toBe(1);
    });

    it('never starts a second resolve while one is in flight', async () => {
      const reader = new ScriptedReader({});
      const cache = new MediaUrlCache(reader, POLICY);
      const cover = refAt('covers/fade.jpg');

      cache.request([cover]);
      cache.request([cover]);
      cache.request([cover, cover]);
      expect(reader.callsFor('covers/fade.jpg')).toBe(1);
      await elapse();
      expect(cache.url(cover)).toBe(urlOf('covers/fade.jpg'));
    });

    it('keys by the Storage path: one object resolves once, a replaced cover resolves afresh', async () => {
      const reader = new ScriptedReader({});
      const cache = new MediaUrlCache(reader, POLICY);
      const shared = refAt('covers/cut.jpg', 'media-a');
      const sameObject = refAt('covers/cut.jpg', 'media-b');
      const replaced = refAt('covers/cut-v2.jpg', 'media-a');

      cache.request([shared, sameObject]);
      await elapse();
      expect(reader.calls).toEqual(['covers/cut.jpg']);
      expect(cache.url(sameObject)).toBe(urlOf('covers/cut.jpg'));

      cache.request([replaced]);
      await elapse();
      expect(cache.url(replaced)).toBe(urlOf('covers/cut-v2.jpg'));
    });

    it('settles an empty answer without a URL and does not ask again', async () => {
      const reader = new ScriptedReader({ 'covers/none.jpg': ['empty'] });
      const cache = new MediaUrlCache(reader, POLICY);
      const cover = refAt('covers/none.jpg');

      cache.request([cover]);
      await elapse(60_000);
      cache.request([cover]);
      await elapse(60_000);
      expect(cache.url(cover)).toBeUndefined();
      expect(reader.callsFor('covers/none.jpg')).toBe(1);
    });

    it('reads nothing for an absent ref', () => {
      const cache = new MediaUrlCache(new ScriptedReader({}), POLICY);
      expect(cache.url(null)).toBeUndefined();
      expect(cache.url(undefined)).toBeUndefined();
    });
  });

  describe('a transient failure, then success', () => {
    it('retries after its backoff and then serves the URL', async () => {
      const reader = new ScriptedReader({ 'covers/fade.jpg': ['fail', 'ok'] });
      const cache = new MediaUrlCache(reader, POLICY);
      const cover = refAt('covers/fade.jpg');

      cache.request([cover]);
      await elapse();
      expect(cache.url(cover)).toBeUndefined();

      // The catalogue re-emits while the retry waits: no extra request.
      cache.request([cover]);
      await elapse(999);
      cache.request([cover]);
      expect(reader.callsFor('covers/fade.jpg')).toBe(1);

      await elapse(1);
      expect(reader.callsFor('covers/fade.jpg')).toBe(2);
      expect(cache.url(cover)).toBe(urlOf('covers/fade.jpg'));
    });

    it('spaces successive retries by the policy', async () => {
      const reader = new ScriptedReader({
        'covers/fade.jpg': ['fail', 'fail', 'ok'],
      });
      const cache = new MediaUrlCache(reader, POLICY);
      const cover = refAt('covers/fade.jpg');

      cache.request([cover]);
      await elapse(1_000);
      expect(reader.callsFor('covers/fade.jpg')).toBe(2);
      // The second failure waits 2 s, not 1 s.
      await elapse(1_999);
      expect(reader.callsFor('covers/fade.jpg')).toBe(2);
      await elapse(1);
      expect(reader.callsFor('covers/fade.jpg')).toBe(3);
      expect(cache.url(cover)).toBe(urlOf('covers/fade.jpg'));
    });

    it.each<Outcome>(['reject', 'throw'])(
      'treats a %s from the reader as a failed resolve',
      async (outcome) => {
        const reader = new ScriptedReader({ 'a.jpg': [outcome, 'ok'] });
        const cache = new MediaUrlCache(reader, POLICY);
        const avatar = refAt('a.jpg');

        expect(() => cache.request([avatar])).not.toThrow();
        await elapse();
        expect(cache.url(avatar)).toBeUndefined();
        await elapse(1_000);
        expect(cache.url(avatar)).toBe(urlOf('a.jpg'));
      },
    );

    it('keeps one object’s failure from holding up another', async () => {
      const reader = new ScriptedReader({ 'bad.jpg': ['fail', 'ok'] });
      const cache = new MediaUrlCache(reader, POLICY);
      const bad = refAt('bad.jpg');
      const good = refAt('good.jpg');

      cache.request([bad, good]);
      await elapse();
      expect(cache.url(good)).toBe(urlOf('good.jpg'));
      expect(cache.url(bad)).toBeUndefined();
    });
  });

  describe('a permanent answer', () => {
    it.each<Outcome>(['missing', 'forbidden'])(
      'asks once about a %s object, never retries, and stays on the placeholder',
      async (outcome) => {
        const reader = new ScriptedReader({
          'gone.jpg': [outcome],
          'fine.jpg': ['ok'],
        });
        const cache = new MediaUrlCache(reader, POLICY);
        const gone = refAt('gone.jpg');
        const fine = refAt('fine.jpg');

        cache.request([gone, fine]);
        await elapse(10 * 60_000);
        expect(reader.callsFor('gone.jpg')).toBe(1);
        expect(cache.url(gone)).toBeUndefined();
        // It holds nothing else up.
        expect(cache.url(fine)).toBe(urlOf('fine.jpg'));

        // Nor does a later catalogue emission ask again.
        cache.request([gone]);
        await elapse(10 * 60_000);
        expect(reader.callsFor('gone.jpg')).toBe(1);
      },
    );

    describe('when the viewer changes (a sign-in, a sign-out, new roles)', () => {
      it('forgets a forbidden answer, and the next request asks again', async () => {
        const reader = new ScriptedReader({ 'staff.jpg': ['forbidden', 'ok'] });
        const cache = new MediaUrlCache(reader, POLICY);
        const cover = refAt('staff.jpg');

        cache.request([cover]);
        await elapse(10 * 60_000);
        cache.request([cover]);
        await elapse();
        expect(reader.callsFor('staff.jpg')).toBe(1);

        cache.identityChanged();
        // Forgetting asks nothing by itself: the next request does.
        await elapse(10 * 60_000);
        expect(reader.callsFor('staff.jpg')).toBe(1);
        cache.request([cover]);
        await elapse();
        expect(reader.callsFor('staff.jpg')).toBe(2);
        expect(cache.url(cover)).toBe(urlOf('staff.jpg'));
      });

      it('keeps a missing answer: an absent object is absent for everyone', async () => {
        const reader = new ScriptedReader({ 'gone.jpg': ['missing', 'ok'] });
        const cache = new MediaUrlCache(reader, POLICY);
        const gone = refAt('gone.jpg');

        cache.request([gone]);
        await elapse();
        cache.identityChanged();
        cache.request([gone]);
        await elapse(10 * 60_000);
        expect(reader.callsFor('gone.jpg')).toBe(1);
        expect(cache.url(gone)).toBeUndefined();
      });

      it('keeps serving a resolved URL without asking again', async () => {
        const reader = new ScriptedReader({});
        const cache = new MediaUrlCache(reader, POLICY);
        const cover = refAt('covers/fade.jpg');

        cache.request([cover]);
        await elapse();
        cache.identityChanged();
        cache.request([cover]);
        await elapse();
        expect(reader.callsFor('covers/fade.jpg')).toBe(1);
        expect(cache.url(cover)).toBe(urlOf('covers/fade.jpg'));
      });

      it('asks again at once about a forbidden answer that was in flight across the change', async () => {
        const reader = new ScriptedReader({ 'staff.jpg': ['forbidden', 'ok'] });
        const cache = new MediaUrlCache(reader, POLICY);
        const cover = refAt('staff.jpg');

        cache.request([cover]);
        cache.identityChanged(); // before the answer, asked as the old viewer, lands
        await elapse();
        expect(reader.callsFor('staff.jpg')).toBe(2);
        expect(cache.url(cover)).toBe(urlOf('staff.jpg'));
      });

      it('keeps a forbidden answer to the viewer there is now', async () => {
        const reader = new ScriptedReader({ 'staff.jpg': ['forbidden'] });
        const cache = new MediaUrlCache(reader, POLICY);
        const cover = refAt('staff.jpg');

        cache.identityChanged();
        cache.request([cover]);
        await elapse();
        cache.request([cover]);
        await elapse(10 * 60_000);
        expect(reader.callsFor('staff.jpg')).toBe(1);
      });

      it('asks nothing once disposed', async () => {
        const reader = new ScriptedReader({ 'staff.jpg': ['forbidden', 'ok'] });
        const cache = new MediaUrlCache(reader, POLICY);
        const cover = refAt('staff.jpg');

        cache.request([cover]);
        await elapse();
        cache.dispose();
        cache.identityChanged();
        cache.request([cover]);
        await elapse();
        expect(reader.callsFor('staff.jpg')).toBe(1);
      });
    });

    it('stops at once when a retry meets a permanent answer', async () => {
      const reader = new ScriptedReader({ 'gone.jpg': ['fail', 'missing'] });
      const cache = new MediaUrlCache(reader, POLICY);
      const cover = refAt('gone.jpg');

      cache.request([cover]);
      await elapse(10 * 60_000);
      expect(reader.callsFor('gone.jpg')).toBe(2);
      expect(cache.url(cover)).toBeUndefined();
    });
  });

  describe('a transient failure that never clears', () => {
    it('stops after maxAttempts and stays on the placeholder', async () => {
      const reader = new ScriptedReader({ 'gone.jpg': ['fail'] });
      const cache = new MediaUrlCache(reader, POLICY);
      const cover = refAt('gone.jpg');

      cache.request([cover]);
      await elapse(10 * 60_000);
      expect(reader.callsFor('gone.jpg')).toBe(POLICY.maxAttempts);

      // Nor does a later catalogue emission start the cycle again.
      cache.request([cover]);
      await elapse(10 * 60_000);
      expect(reader.callsFor('gone.jpg')).toBe(POLICY.maxAttempts);
      expect(cache.url(cover)).toBeUndefined();
    });

    it('bounds the requests whatever the answers and however often the catalogue re-emits', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.constantFrom<Outcome>('ok', 'fail', 'reject', 'missing'),
            { minLength: 1, maxLength: 6 },
          ),
          fc.array(fc.integer({ min: 0, max: 4_000 }), { maxLength: 12 }),
          async (script, reEmitsAfterMs) => {
            const reader = new ScriptedReader({ 'x.jpg': script });
            const cache = new MediaUrlCache(reader, POLICY);
            const ref = refAt('x.jpg');

            cache.request([ref]);
            for (const ms of reEmitsAfterMs) {
              await elapse(ms);
              cache.request([ref]);
            }
            await elapse(60_000);

            // The first answer that ends the cycle: a success, or a
            // permanent "missing". The script's last step repeats, so a
            // script with neither never ends it.
            const ends = (step: Outcome) => step === 'ok' || step === 'missing';
            const final = script.findIndex(ends);
            const endsOn = final === -1 ? Infinity : final + 1;
            const expectedCalls = Math.min(endsOn, POLICY.maxAttempts);
            expect(reader.callsFor('x.jpg')).toBe(expectedCalls);
            expect(cache.url(ref) !== undefined).toBe(
              endsOn <= POLICY.maxAttempts && script.find(ends) === 'ok',
            );
            cache.dispose();
          },
        ),
        { numRuns: 150 },
      );
    });
  });

  describe('dispose', () => {
    it('cancels a waiting retry and ignores an answer still in flight', async () => {
      const reader = new ScriptedReader({ 'a.jpg': ['fail', 'ok'] });
      const cache = new MediaUrlCache(reader, POLICY);
      const waiting = refAt('a.jpg');
      const inFlight = refAt('b.jpg');

      cache.request([waiting]);
      await elapse();
      cache.request([inFlight]);
      cache.dispose();
      await elapse(60_000);

      expect(reader.callsFor('a.jpg')).toBe(1);
      expect(cache.url(inFlight)).toBeUndefined();
      cache.request([refAt('c.jpg')]);
      expect(reader.callsFor('c.jpg')).toBe(0);
    });
  });

  describe('the default policy', () => {
    it('waits about 2 s, 8 s and 30 s, jittered within the upper half, and never longer', () => {
      const { backoffMs, maxAttempts } = DEFAULT_MEDIA_RETRY_POLICY;
      expect(maxAttempts).toBe(4);
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
          (failures, random) => {
            vi.spyOn(Math, 'random').mockReturnValue(random);
            const ceiling = Math.min(30_000, 2_000 * 4 ** (failures - 1));
            const wait = backoffMs(failures);
            expect(wait).toBeGreaterThanOrEqual(ceiling / 2);
            expect(wait).toBeLessThanOrEqual(ceiling);
            expect(wait).toBeLessThanOrEqual(30_000);
            vi.restoreAllMocks();
          },
        ),
      );
      vi.spyOn(Math, 'random').mockReturnValue(0);
      expect([1, 2, 3].map(backoffMs)).toEqual([1_000, 4_000, 15_000]);
      vi.restoreAllMocks();
    });
  });
});
