import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
import {
  AUTH_SESSION_PORTS,
  CATALOG_PORTS,
  MEDIA_RESOLVE_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { type MediaRef, type Principal, Role } from '@core/components';
import type {
  CatalogReadPorts,
  MediaResolvePorts,
  MediaVariant,
} from '@core/ports';
import type { Barber, Service, ShopLocation } from '@core/entities';
import {
  BarberId,
  MediaError,
  MediaRefId,
  RepositoryError,
  Result,
  ServiceId,
  UserId,
} from '@core/primitives';
import {
  barberFixture,
  memoryAuthSessionPorts,
  memoryCatalogReadPorts,
  memoryMediaResolvePorts,
  principalFixture,
  serviceFixture,
} from '@core/testing';
import { CatalogContentService } from './catalog-content.service';
import { DEFAULT_MEDIA_RETRY_POLICY } from './media-url-cache';

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

/**
 * The catalogue double, with the streams under test wrapped to answer what
 * the spec hands them — re-emits, a cold listener that waits, a failure.
 */
function catalogPorts(reads: {
  readonly services: () => ReturnType<CatalogReadPorts['observeServices']>;
  readonly barbers: () => ReturnType<CatalogReadPorts['observeBarbers']>;
  readonly locations?: () => ReturnType<CatalogReadPorts['observeLocations']>;
}): CatalogReadPorts {
  const base = memoryCatalogReadPorts();
  return {
    ...base,
    observeServices: () => reads.services(),
    observeBarbers: () => reads.barbers(),
    observeLocations: () => reads.locations?.() ?? base.observeLocations(),
  };
}

/** A resolver that counts its calls per Storage path. */
type CountingResolver = {
  readonly ports: MediaResolvePorts;
  readonly calls: string[];
  readonly callsFor: (ref: { readonly path: string }) => number;
};

/** Fails the first `failures` resolves of every path (transiently), then answers. */
function flakyResolver(failures: number): CountingResolver {
  const calls: string[] = [];
  const callsFor = (ref: { readonly path: string }) =>
    calls.filter((path) => path === ref.path).length;
  return {
    calls,
    callsFor,
    ports: {
      resolveMedia: (
        ref: MediaRef,
      ): Promise<Result<readonly MediaVariant[], MediaError>> => {
        calls.push(ref.mediaPath);
        return Promise.resolve(
          callsFor({ path: ref.mediaPath }) <= failures
            ? Result.err(MediaError.transient(ref.mediaPath))
            : Result.ok([
                { width: ref.mediaWidth, url: urlOf({ path: ref.mediaPath }) },
              ]),
        );
      },
    },
  };
}

/** The longest wait the default policy can pick after `failures` failures. */
const longestBackoff = (failures: number) =>
  Math.min(30_000, 2_000 * 4 ** (failures - 1));

describe('CatalogContentService — media', () => {
  let services: BehaviorSubject<Result<readonly Service[], RepositoryError>>;

  beforeEach(() => {
    vi.useFakeTimers();
    services = new BehaviorSubject<Result<readonly Service[], RepositoryError>>(
      Result.ok([fade]),
    );
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  function setUp(reader: CountingResolver): CatalogContentService {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CATALOG_PORTS,
          useValue: catalogPorts({
            services: () => services.asObservable(),
            barbers: () => of(Result.ok([ivan])),
          }),
        },
        { provide: MEDIA_RESOLVE_PORTS, useValue: reader.ports },
      ],
    });
    const content = TestBed.inject(CatalogContentService);
    TestBed.tick();
    return content;
  }

  it('resolves each cover and avatar once and maps them into the view models', async () => {
    const reader = flakyResolver(0);
    const content = setUp(reader);
    await vi.advanceTimersByTimeAsync(0);

    expect(content.coverUrl('svc-fade')).toBe(urlOf(cover));
    expect(content.serviceVms()[0]?.coverSrc).toBe(urlOf(cover));
    expect(content.barberVms()[0]?.avatarSrc).toBe(urlOf(avatar));

    // A snapshot re-emit of the same catalogue fetches nothing again.
    services.next(Result.ok([fade]));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reader.calls).toEqual([cover.path, avatar.path]);
  });

  it('recovers a cover whose first resolve failed, without a request per re-emit', async () => {
    const reader = flakyResolver(1);
    const content = setUp(reader);
    await vi.advanceTimersByTimeAsync(0);
    expect(content.coverUrl('svc-fade')).toBeUndefined();
    expect(content.serviceVms()[0]?.coverSrc).toBeUndefined();

    // The catalogue re-emits while the retry waits.
    services.next(Result.ok([fade]));
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.callsFor(cover)).toBe(1);

    await vi.advanceTimersByTimeAsync(longestBackoff(1));
    expect(reader.callsFor(cover)).toBe(2);
    expect(content.coverUrl('svc-fade')).toBe(urlOf(cover));
    expect(content.serviceVms()[0]?.coverSrc).toBe(urlOf(cover));
    expect(content.barberVms()[0]?.avatarSrc).toBe(urlOf(avatar));
  });

  it('leaves a cover that never resolves on its placeholder after the last attempt', async () => {
    const reader = flakyResolver(Infinity);
    const content = setUp(reader);
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(reader.callsFor(cover)).toBe(DEFAULT_MEDIA_RETRY_POLICY.maxAttempts);
    expect(content.coverUrl('svc-fade')).toBeUndefined();
    expect(content.serviceVms()[0]?.coverSrc).toBeUndefined();
  });

  it('reads a service’s cover off the service in hand, without searching the catalogue', async () => {
    const content = setUp(flakyResolver(0));
    await vi.advanceTimersByTimeAsync(0);
    const search = vi.spyOn(content, 'findService');

    expect(content.coverUrlOf(fade)).toBe(urlOf(cover));
    expect(search).not.toHaveBeenCalled();
    // By id it still answers the same, through the one search.
    expect(content.coverUrl('svc-fade')).toBe(urlOf(cover));
    expect(content.coverUrl('svc-retired')).toBeUndefined();
  });

  it('stops retrying when its injector is destroyed', async () => {
    const reader = flakyResolver(Infinity);
    setUp(reader);
    await vi.advanceTimersByTimeAsync(0);
    TestBed.resetTestingModule();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reader.callsFor(cover)).toBe(1);
  });
});

/** Answers each path from a script (the last step repeats) and counts every call. */
function scriptedResolver(
  script: Readonly<Record<string, readonly ('ok' | 'missing' | 'forbidden')[]>>,
): CountingResolver {
  const calls: string[] = [];
  const callsFor = (ref: { readonly path: string }) =>
    calls.filter((path) => path === ref.path).length;
  return {
    calls,
    callsFor,
    ports: {
      resolveMedia: (
        ref: MediaRef,
      ): Promise<Result<readonly MediaVariant[], MediaError>> => {
        calls.push(ref.mediaPath);
        const steps = script[ref.mediaPath] ?? ['ok'];
        const step =
          steps[Math.min(callsFor({ path: ref.mediaPath }), steps.length) - 1];
        return Promise.resolve(
          step === 'ok' || step === undefined
            ? Result.ok([
                { width: ref.mediaWidth, url: urlOf({ path: ref.mediaPath }) },
              ])
            : Result.err(
                step === 'missing'
                  ? MediaError.notFound(ref.mediaPath)
                  : MediaError.forbidden(ref.mediaPath),
              ),
        );
      },
    },
  };
}

describe('CatalogContentService — a new viewer', () => {
  let viewers: Subject<Principal>;

  const member = (uid: UserId, ...roles: Role[]): Principal =>
    roles.includes(Role.Admin)
      ? principalFixture.staff(uid, roles)
      : { ...principalFixture.client(uid), roles };
  const ANONYMOUS = principalFixture.anonymous();

  beforeEach(() => {
    vi.useFakeTimers();
    viewers = new Subject<Principal>();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  function setUp(reader: CountingResolver): CatalogContentService {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CATALOG_PORTS,
          useValue: catalogPorts({
            services: () => of(Result.ok([fade])),
            barbers: () => of(Result.ok([ivan])),
          }),
        },
        { provide: MEDIA_RESOLVE_PORTS, useValue: reader.ports },
        {
          provide: AUTH_SESSION_PORTS,
          useValue: {
            ...memoryAuthSessionPorts(),
            observePrincipal: () => viewers.asObservable(),
          },
        },
      ],
    });
    const content = TestBed.inject(CatalogContentService);
    TestBed.tick();
    return content;
  }

  it('asks again about a cover the rules refused once someone signs in, and not about a missing avatar', async () => {
    const reader = scriptedResolver({
      [cover.path]: ['forbidden', 'ok'],
      [avatar.path]: ['missing', 'ok'],
    });
    const content = setUp(reader);
    viewers.next(ANONYMOUS);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(content.coverUrlOf(fade)).toBeUndefined();
    expect(reader.callsFor(cover)).toBe(1);

    viewers.next(member(UserId.of('u-new'), Role.Client));
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.callsFor(cover)).toBe(2);
    expect(content.serviceVms()[0]?.coverSrc).toBe(urlOf(cover));
    // Missing is missing for everyone.
    expect(reader.callsFor(avatar)).toBe(1);
  });

  it('takes the first viewer as the one the first answers were for, and a token refresh as the same viewer', async () => {
    const reader = scriptedResolver({ [cover.path]: ['forbidden'] });
    setUp(reader);
    const uid = UserId.of('u-restored');
    // A restored session: Storage waited for it, so its "no" is this
    // viewer's own.
    viewers.next(member(uid, Role.Client));
    await vi.advanceTimersByTimeAsync(0);
    // An hourly token refresh with the same claims.
    viewers.next(member(uid, Role.Client));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reader.callsFor(cover)).toBe(1);

    // New roles are a new viewer to the rules; so is signing out.
    viewers.next(member(uid, Role.Client, Role.Admin));
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.callsFor(cover)).toBe(2);
    viewers.next(ANONYMOUS);
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.callsFor(cover)).toBe(3);
  });
});

describe('CatalogContentService — has each read answered?', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function withReads(reads: {
    readonly services: Subject<Result<readonly Service[], RepositoryError>>;
    readonly barbers: Subject<Result<readonly Barber[], RepositoryError>>;
    /** Answered at once, with no shop, unless the test holds it. */
    readonly locations?: Subject<
      Result<readonly ShopLocation[], RepositoryError>
    >;
  }): CatalogContentService {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CATALOG_PORTS,
          // Nothing until the test says so, the way a cold listener waits.
          useValue: catalogPorts({
            services: () => reads.services.asObservable(),
            barbers: () => reads.barbers.asObservable(),
            locations: () =>
              reads.locations?.asObservable() ?? of(Result.ok([])),
          }),
        },
        { provide: MEDIA_RESOLVE_PORTS, useValue: memoryMediaResolvePorts() },
      ],
    });
    return TestBed.inject(CatalogContentService);
  }

  it('knows who is active only once THEIR read answers, apart from the services', () => {
    const services = new Subject<Result<readonly Service[], RepositoryError>>();
    const barbers = new Subject<Result<readonly Barber[], RepositoryError>>();
    const content = withReads({ services, barbers });
    expect(content.servicesKnown()).toBe(false);

    services.next(Result.ok([fade]));
    // The services answered; the barbers have not, so "nobody is active"
    // is not yet an answer anyone may act on.
    expect(content.loading()).toBe(false);
    expect(content.servicesKnown()).toBe(true);
    expect(content.barbersKnown()).toBe(false);
    expect(content.barbers()).toEqual([]);

    barbers.next(Result.ok([ivan]));
    expect(content.barbersKnown()).toBe(true);
    expect(content.barbers()).toEqual([ivan]);
  });

  it('never calls a FAILED read known — its empty list says nothing about what the shop offers', () => {
    const services = new Subject<Result<readonly Service[], RepositoryError>>();
    const barbers = new Subject<Result<readonly Barber[], RepositoryError>>();
    const content = withReads({ services, barbers });

    services.next(Result.err(RepositoryError.unavailable()));
    barbers.next(Result.err(RepositoryError.unavailable()));

    // Loading is over, and both lists render empty — yet neither is known.
    expect(content.loading()).toBe(false);
    expect(content.services()).toEqual([]);
    expect(content.servicesKnown()).toBe(false);
    expect(content.barbersKnown()).toBe(false);

    // A later success is an answer again.
    barbers.next(Result.ok([ivan]));
    expect(content.barbersKnown()).toBe(true);
  });

  it('knows the shops only once THEIR read answers successfully — an answered empty list included', () => {
    const locations = new Subject<
      Result<readonly ShopLocation[], RepositoryError>
    >();
    const content = withReads({
      services: new Subject(),
      barbers: new Subject(),
      locations,
    });
    // Pending: the list is empty, and it is not an answer.
    expect(content.locations()).toEqual([]);
    expect(content.locationsKnown()).toBe(false);

    // Failed: still empty, still not an answer.
    locations.next(Result.err(RepositoryError.unavailable()));
    expect(content.locations()).toEqual([]);
    expect(content.locationsKnown()).toBe(false);

    // Answered with no active shop: empty, and that IS the answer.
    locations.next(Result.ok([]));
    expect(content.locations()).toEqual([]);
    expect(content.locationsKnown()).toBe(true);
  });
});
