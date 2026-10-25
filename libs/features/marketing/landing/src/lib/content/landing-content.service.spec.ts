import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import {
  CATALOG_PORTS,
  MEDIA_RESOLVE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { type MediaRef, Money } from '@core/components';
import type {
  CatalogReadPorts,
  MediaResolvePorts,
  MediaVariant,
} from '@core/ports';
import type { Barber, Service } from '@core/entities';
import {
  BarberId,
  Currency,
  MediaRefId,
  Result,
  ServiceId,
} from '@core/primitives';
import { MediaError, type RepositoryError } from '@core/errors';
import {
  barberFixture,
  cents,
  memoryCatalogReadPorts,
  serviceFixture,
} from '@core/testing';
import {
  CatalogContentService,
  CatalogWording,
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

/** What one resolve answers, as the media port types it. */
type MediaAnswer = Result<readonly MediaVariant[], MediaError>;

/** The media port playing a script per path (the last step repeats), counting every call. */
type ScriptedMedia = MediaResolvePorts & {
  readonly calls: readonly string[];
  callsFor(ref: { readonly path: string }): number;
};

function scriptedMedia(
  script: Readonly<Record<string, Step[]>>,
): ScriptedMedia {
  const calls: string[] = [];
  const callsFor = (ref: { readonly path: string }): number =>
    calls.filter((path) => path === ref.path).length;
  return {
    calls,
    callsFor,
    resolveMedia: (ref: MediaRef): Promise<MediaAnswer> => {
      const path = ref.mediaPath;
      calls.push(path);
      const steps = script[path] ?? ['ok'];
      const step =
        steps[Math.min(callsFor({ path }), steps.length) - 1] ?? 'ok';
      switch (step) {
        case 'ok':
          return Promise.resolve(
            Result.ok([{ width: ref.mediaWidth, url: urlOf({ path }) }]),
          );
        case 'transient':
          return Promise.resolve(Result.err(MediaError.transient(path)));
        case 'reject':
          return Promise.reject(new Error('network'));
        case 'missing':
          return Promise.resolve(Result.err(MediaError.notFound(path)));
        case 'forbidden':
          return Promise.resolve(Result.err(MediaError.forbidden(path)));
      }
    },
  };
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

  function setUp(reader: MediaResolvePorts): LandingContentService {
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
        { provide: MEDIA_RESOLVE_PORTS, useValue: reader },
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
    const reader = scriptedMedia({});
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
      const reader = scriptedMedia({
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
    const reader = scriptedMedia({ [cover.path]: ['transient'] });
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
      const reader = scriptedMedia({
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
    const reader = scriptedMedia({ [avatar.path]: ['missing'] });
    const landing = setUp(reader);
    await vi.advanceTimersByTimeAsync(0);
    const booking = TestBed.inject(CatalogContentService);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(booking.serviceVms()[0]?.coverSrc).toBe(urlOf(cover));
    expect(booking.coverUrl(ServiceId.of('svc-fade'))).toBe(urlOf(cover));
    expect(coverSrc(landing)).toBe(urlOf(cover));
    expect(reader.callsFor(cover)).toBe(1);
    expect(reader.callsFor(avatar)).toBe(1);
    expect(catalogueReads).toBe(1);
    // The very view models, not a second mapping of the same data.
    expect(landing.allServices()).toBe(booking.serviceVms());
    expect(landing.barbers()).toBe(booking.barberVms());
  });

  it('words a localized pair and a price as the catalogue’s presenter does', () => {
    const content = setUp(scriptedMedia({}));
    const words = TestBed.inject(CatalogWording);
    expect(content.text({ en: 'Skin fade', bg: 'Фейд' })).toBe('Фейд');
    const price = Money.fromCents(cents(1450), Currency.EUR);
    expect(content.price(price)).toBe(words.price(price));
  });

  it('stops retrying when its injector is destroyed', async () => {
    const reader = scriptedMedia({ [cover.path]: ['transient'] });
    setUp(reader);
    await vi.advanceTimersByTimeAsync(0);
    TestBed.resetTestingModule();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reader.callsFor(cover)).toBe(1);
  });
});
