import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import {
  MEDIA_READER,
  MediaUnavailableError,
  fail,
  ok,
  type MediaReadError,
  type MediaReader,
  type MediaRef,
  type MediaVariant,
  type Result as KernelResult,
} from '@creativo/application/catalog';
import { RepositoryError as KernelRepositoryError } from '@creativo/application/shared';
import { CATALOG_PORTS } from '@creativo/infrastructure/firebase-app';
import type { CatalogReadPorts } from '@core/ports';
import type { Barber, Service } from '@core/entities';
import {
  BarberId,
  MediaRefId,
  type RepositoryError,
  Result,
  ServiceId,
} from '@core/primitives';
import {
  barberFixture,
  memoryCatalogReadPorts,
  serviceFixture,
} from '@core/testing';
import {
  CatalogContentService,
  DEFAULT_MEDIA_RETRY_POLICY,
} from '@creativo/features/shared/catalog';
import { LanguageService } from '@creativo/features/shared/shell';
import { LandingContentService } from './landing-content.service';

/** The Storage objects the fixtures point at — what the media reader is asked for. */
const cover = { path: 'services/fade.jpg', width: 1200 } as const;
const avatar = { path: 'barbers/ivan.jpg', width: 1200 } as const;

const fade: Service = serviceFixture({
  id: ServiceId.of('svc-fade'),
  name: { en: 'Skin fade', bg: 'Фейд' },
  popular: true,
  sortOrder: 1,
  coverMediaId: MediaRefId.of('media-fade'),
  coverMediaPath: cover.path,
  coverMediaWidth: cover.width,
  coverMediaHeight: 1500,
});

const ivan: Barber = barberFixture({
  id: BarberId.of('ivan'),
  sortOrder: 1,
  avatarMediaId: MediaRefId.of('media-barber-ivan'),
  avatarMediaPath: avatar.path,
  avatarMediaWidth: avatar.width,
  avatarMediaHeight: 1500,
});

const urlOf = (ref: { readonly path: string }) =>
  `https://cdn.test/${ref.path}`;

/** What one resolve answers: a URL, a transient failure, or a permanent one. */
type Step = 'ok' | 'transient' | 'reject' | 'missing' | 'forbidden';

/** Plays a script per path (the last step repeats) and counts every call. */
class ScriptedReader implements MediaReader {
  readonly calls: string[] = [];

  constructor(private readonly script: Readonly<Record<string, Step[]>>) {}

  callsFor(ref: { readonly path: string }): number {
    return this.calls.filter((path) => path === ref.path).length;
  }

  resolve(
    ref: MediaRef,
  ): Promise<KernelResult<readonly MediaVariant[], MediaReadError>> {
    this.calls.push(ref.path);
    const steps = this.script[ref.path] ?? ['ok'];
    const step = steps[Math.min(this.callsFor(ref), steps.length) - 1] ?? 'ok';
    switch (step) {
      case 'ok':
        return Promise.resolve(ok([{ width: ref.width, url: urlOf(ref) }]));
      case 'transient':
        return Promise.resolve(
          fail(new KernelRepositoryError('storage/retry-limit-exceeded')),
        );
      case 'reject':
        return Promise.reject(new Error('network'));
      case 'missing':
        return Promise.resolve(
          fail(new MediaUnavailableError('not_found', ref.path)),
        );
      case 'forbidden':
        return Promise.resolve(
          fail(new MediaUnavailableError('forbidden', ref.path)),
        );
    }
  }
}

/** The longest wait the default policy can pick after `failures` failures. */
const longestBackoff = (failures: number) =>
  Math.min(30_000, 2_000 * 4 ** (failures - 1));

describe('LandingContentService — media', () => {
  let services: BehaviorSubject<Result<readonly Service[], RepositoryError>>;
  /** How many times the services were subscribed to, across every surface. */
  let catalogueReads: number;

  beforeEach(() => {
    catalogueReads = 0;
    vi.useFakeTimers();
    services = new BehaviorSubject<Result<readonly Service[], RepositoryError>>(
      Result.ok([fade]),
    );
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  function setUp(reader: MediaReader): LandingContentService {
    TestBed.configureTestingModule({
      providers: [
        { provide: LanguageService, useValue: { activeLang: signal('bg') } },
        {
          // The double, its services stream wrapped: re-emitted by the
          // spec, and every subscription counted.
          provide: CATALOG_PORTS,
          useValue: {
            ...memoryCatalogReadPorts({ barbers: [ivan] }),
            observeServices: () => {
              catalogueReads++;
              return services.asObservable();
            },
          } satisfies CatalogReadPorts,
        },
        { provide: MEDIA_READER, useValue: reader },
      ],
    });
    const content = TestBed.inject(LandingContentService);
    TestBed.tick();
    return content;
  }

  /** The catalogue re-emits the same snapshot (a live query does, often). */
  function reEmit(): void {
    services.next(Result.ok([fade]));
    TestBed.tick();
  }

  const coverSrc = (content: LandingContentService) =>
    content.allServices()[0]?.coverSrc;
  const avatarSrc = (content: LandingContentService) =>
    content.barbers()[0]?.avatarSrc;

  it('resolves each cover and avatar once and maps them into the view models', async () => {
    const reader = new ScriptedReader({});
    const content = setUp(reader);
    await vi.advanceTimersByTimeAsync(0);

    expect(coverSrc(content)).toBe(urlOf(cover));
    expect(content.singleServices()[0]?.coverSrc).toBe(urlOf(cover));
    expect(avatarSrc(content)).toBe(urlOf(avatar));

    reEmit();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reader.calls).toEqual([cover.path, avatar.path]);
  });

  it.each<Step>(['transient', 'reject'])(
    'recovers a cover whose first resolve failed (%s), without a request per re-emit',
    async (firstStep) => {
      const reader = new ScriptedReader({
        [cover.path]: [firstStep, 'ok'],
        [avatar.path]: [firstStep, 'ok'],
      });
      const content = setUp(reader);
      await vi.advanceTimersByTimeAsync(0);
      expect(coverSrc(content)).toBeUndefined();
      expect(avatarSrc(content)).toBe('');

      // The catalogue re-emits while the retry waits: nothing new is asked.
      reEmit();
      await vi.advanceTimersByTimeAsync(0);
      expect(reader.callsFor(cover)).toBe(1);

      await vi.advanceTimersByTimeAsync(longestBackoff(1));
      expect(reader.callsFor(cover)).toBe(2);
      expect(coverSrc(content)).toBe(urlOf(cover));
      expect(avatarSrc(content)).toBe(urlOf(avatar));
    },
  );

  it('gives a failure that never clears a bounded number of attempts', async () => {
    const reader = new ScriptedReader({ [cover.path]: ['transient'] });
    const content = setUp(reader);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    reEmit();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(reader.callsFor(cover)).toBe(DEFAULT_MEDIA_RETRY_POLICY.maxAttempts);
    expect(coverSrc(content)).toBeUndefined();
  });

  it.each<Step>(['missing', 'forbidden'])(
    'asks once about a %s object and leaves it on its placeholder',
    async (step) => {
      const reader = new ScriptedReader({
        [cover.path]: [step],
        [avatar.path]: [step],
      });
      const content = setUp(reader);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      reEmit();
      await vi.advanceTimersByTimeAsync(10 * 60_000);

      expect(reader.callsFor(cover)).toBe(1);
      expect(reader.callsFor(avatar)).toBe(1);
      expect(coverSrc(content)).toBeUndefined();
      expect(avatarSrc(content)).toBe('');
    },
  );

  it('shares the session’s one catalogue read and media cache with /book', async () => {
    // A visitor lands, then books: the landing's grid and the booking
    // flow's (`CatalogContentService`) must not resolve a cover twice, nor
    // ask twice about one that is missing.
    const reader = new ScriptedReader({ [avatar.path]: ['missing'] });
    const landing = setUp(reader);
    await vi.advanceTimersByTimeAsync(0);
    const booking = TestBed.inject(CatalogContentService);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(booking.serviceVms()[0]?.coverSrc).toBe(urlOf(cover));
    expect(booking.coverUrl('svc-fade')).toBe(urlOf(cover));
    expect(coverSrc(landing)).toBe(urlOf(cover));
    expect(reader.callsFor(cover)).toBe(1);
    expect(reader.callsFor(avatar)).toBe(1);
    expect(catalogueReads).toBe(1);
    // The very view models, not a second mapping of the same data.
    expect(landing.allServices()).toBe(booking.serviceVms());
    expect(landing.barbers()).toBe(booking.barberVms());
  });

  it('stops retrying when its injector is destroyed', async () => {
    const reader = new ScriptedReader({ [cover.path]: ['transient'] });
    setUp(reader);
    await vi.advanceTimersByTimeAsync(0);
    TestBed.resetTestingModule();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reader.callsFor(cover)).toBe(1);
  });
});
