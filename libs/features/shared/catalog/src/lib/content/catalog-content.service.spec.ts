import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
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
import {
  ANONYMOUS_PRINCIPAL,
  AUTH_GATEWAY,
  PrincipalId,
  roleFromPrimitive,
  type AuthGateway,
  type Principal,
} from '@creativo/application/identity';
import { RepositoryError as KernelRepositoryError } from '@creativo/application/shared';
import { CATALOG_PORTS } from '@creativo/infrastructure/firebase-app';
import type { CatalogReadPorts } from '@core/ports';
import type { Barber, Service, ShopLocation } from '@core/entities';
import {
  BarberId,
  MediaRefId,
  RepositoryError,
  Result,
  ServiceId,
} from '@core/primitives';
import {
  barberFixture,
  memoryCatalogReadPorts,
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

/** Fails the first `failures` resolves of every path, then answers. */
class FlakyReader implements MediaReader {
  readonly calls: string[] = [];

  constructor(private readonly failures: number) {}

  callsFor(ref: { readonly path: string }): number {
    return this.calls.filter((path) => path === ref.path).length;
  }

  resolve(
    ref: MediaRef,
  ): Promise<KernelResult<readonly MediaVariant[], KernelRepositoryError>> {
    this.calls.push(ref.path);
    return Promise.resolve(
      this.callsFor(ref) <= this.failures
        ? fail(new KernelRepositoryError('storage/retry-limit-exceeded'))
        : ok([{ width: ref.width, url: urlOf(ref) }]),
    );
  }
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

  function setUp(reader: MediaReader): CatalogContentService {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CATALOG_PORTS,
          useValue: catalogPorts({
            services: () => services.asObservable(),
            barbers: () => of(Result.ok([ivan])),
          }),
        },
        { provide: MEDIA_READER, useValue: reader },
      ],
    });
    const content = TestBed.inject(CatalogContentService);
    TestBed.tick();
    return content;
  }

  it('resolves each cover and avatar once and maps them into the view models', async () => {
    const reader = new FlakyReader(0);
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
    const reader = new FlakyReader(1);
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
    const reader = new FlakyReader(Infinity);
    const content = setUp(reader);
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(reader.callsFor(cover)).toBe(DEFAULT_MEDIA_RETRY_POLICY.maxAttempts);
    expect(content.coverUrl('svc-fade')).toBeUndefined();
    expect(content.serviceVms()[0]?.coverSrc).toBeUndefined();
  });

  it('reads a service’s cover off the service in hand, without searching the catalogue', async () => {
    const content = setUp(new FlakyReader(0));
    await vi.advanceTimersByTimeAsync(0);
    const search = vi.spyOn(content, 'findService');

    expect(content.coverUrlOf(fade)).toBe(urlOf(cover));
    expect(search).not.toHaveBeenCalled();
    // By id it still answers the same, through the one search.
    expect(content.coverUrl('svc-fade')).toBe(urlOf(cover));
    expect(content.coverUrl('svc-retired')).toBeUndefined();
  });

  it('stops retrying when its injector is destroyed', async () => {
    const reader = new FlakyReader(Infinity);
    setUp(reader);
    await vi.advanceTimersByTimeAsync(0);
    TestBed.resetTestingModule();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reader.callsFor(cover)).toBe(1);
  });
});

/** Answers each path from a script (the last step repeats) and counts every call. */
class ScriptedReader implements MediaReader {
  readonly calls: string[] = [];

  constructor(
    private readonly script: Readonly<
      Record<string, readonly ('ok' | 'missing' | 'forbidden')[]>
    >,
  ) {}

  callsFor(ref: { readonly path: string }): number {
    return this.calls.filter((path) => path === ref.path).length;
  }

  resolve(
    ref: MediaRef,
  ): Promise<KernelResult<readonly MediaVariant[], MediaReadError>> {
    this.calls.push(ref.path);
    const steps = this.script[ref.path] ?? ['ok'];
    const step = steps[Math.min(this.callsFor(ref), steps.length) - 1];
    return Promise.resolve(
      step === 'ok' || step === undefined
        ? ok([{ width: ref.width, url: urlOf(ref) }])
        : fail(
            new MediaUnavailableError(
              step === 'missing' ? 'not_found' : 'forbidden',
              ref.path,
            ),
          ),
    );
  }
}

describe('CatalogContentService — a new viewer', () => {
  let viewers: Subject<Principal>;

  const member = (uid: PrincipalId, ...roles: string[]): Principal => ({
    kind: 'active',
    uid,
    roles: roles.map(roleFromPrimitive),
  });

  beforeEach(() => {
    vi.useFakeTimers();
    viewers = new Subject<Principal>();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  function setUp(reader: MediaReader): CatalogContentService {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CATALOG_PORTS,
          useValue: catalogPorts({
            services: () => of(Result.ok([fade])),
            barbers: () => of(Result.ok([ivan])),
          }),
        },
        { provide: MEDIA_READER, useValue: reader },
        {
          provide: AUTH_GATEWAY,
          useValue: {
            observePrincipal: () => viewers.asObservable(),
          } satisfies Partial<AuthGateway>,
        },
      ],
    });
    const content = TestBed.inject(CatalogContentService);
    TestBed.tick();
    return content;
  }

  it('asks again about a cover the rules refused once someone signs in, and not about a missing avatar', async () => {
    const reader = new ScriptedReader({
      [cover.path]: ['forbidden', 'ok'],
      [avatar.path]: ['missing', 'ok'],
    });
    const content = setUp(reader);
    viewers.next(ANONYMOUS_PRINCIPAL);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(content.coverUrlOf(fade)).toBeUndefined();
    expect(reader.callsFor(cover)).toBe(1);

    viewers.next(member(PrincipalId.generate(), 'client'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.callsFor(cover)).toBe(2);
    expect(content.serviceVms()[0]?.coverSrc).toBe(urlOf(cover));
    // Missing is missing for everyone.
    expect(reader.callsFor(avatar)).toBe(1);
  });

  it('takes the first viewer as the one the first answers were for, and a token refresh as the same viewer', async () => {
    const reader = new ScriptedReader({ [cover.path]: ['forbidden'] });
    setUp(reader);
    const uid = PrincipalId.generate();
    // A restored session: Storage waited for it, so its "no" is this
    // viewer's own.
    viewers.next(member(uid, 'client'));
    await vi.advanceTimersByTimeAsync(0);
    // An hourly token refresh with the same claims.
    viewers.next(member(uid, 'client'));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reader.callsFor(cover)).toBe(1);

    // New roles are a new viewer to the rules; so is signing out.
    viewers.next(member(uid, 'client', 'admin'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.callsFor(cover)).toBe(2);
    viewers.next(ANONYMOUS_PRINCIPAL);
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
        {
          provide: MEDIA_READER,
          useValue: { resolve: () => Promise.resolve(ok([])) },
        },
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
