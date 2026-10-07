import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type Translation,
  type TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AVATAR_UPLOADER,
  PROFILE_PORT,
  type User,
  type UserId,
  ZonedDateTime,
} from '@creativo/application/accounts';
import {
  type Appointment,
  CLIENT_HISTORY_READER,
  CLIENT_PHOTOS_READER,
  CLIENT_STATS_READER,
  type ClientHistoryPage,
  type ClientHistoryReader,
  type Result,
  WAITLIST_READER,
  fail,
} from '@creativo/application/booking';
import {
  InMemoryClientHistoryReader,
  InMemoryClientPhotosReader,
} from '@creativo/application/booking/testing';
import {
  type ActivityEntry,
  CLIENT_VOUCHERS_READER,
  LOYALTY_ACTIVITY_READER,
  LOYALTY_CATALOG_READER,
  LOYALTY_READER,
  type LoyaltyActivityPage,
  type LoyaltyActivityQuery,
  type LoyaltyActivityReader,
} from '@creativo/application/engagement';
import {
  InMemoryClientVouchersReader,
  InMemoryLoyaltyActivityReader,
  InMemoryLoyaltyCatalogReader,
  InMemoryLoyaltyReader,
} from '@creativo/application/engagement/testing';
import {
  CLOCK,
  RepositoryError,
  provideFeatureFlags,
} from '@creativo/application/shared';
import type {
  ClientCardContext,
  ClientCardSubject,
} from './client-card.contracts';
import { dayWithYear, shopDayOf } from './client-card.format';
import {
  CLIENT_CARD_READ_TIMEOUT_MS,
  ClientCardStore,
} from './client-card.store';
import { LEDGER_PAGE_READ, foldByEvent } from './ledger.presenter';
import { WALLET_ACTIVITY_READ } from './wallet.presenter';
import {
  GEORGI,
  GEORGI_GRANT,
  GEORGI_MONEY,
  GEORGI_PREVIOUS_MS,
  GUEST,
  InMemoryAvatars,
  InMemoryProfilePort,
  InMemoryStatsReader,
  InMemoryWaitlistReader,
  MARTIN,
  NBSP_EURO,
  NOW_MS,
  catalogueOf,
  georgiContext,
  georgiHistory,
  georgiOpenContext,
  georgiPhotos,
  georgiUser,
  martinContext,
  martinHistory,
  martinUser,
  martinWaitlist,
  must,
  pausedUntilOctober,
  statsOf,
  subjectOf,
  wordsOf,
} from '../testing/client-card.fixtures';

@Injectable()
class CatalogueLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(catalogueOf(lang === 'en' ? 'en' : 'bg'));
  }
}

const ALL_FLAGS = {
  'client.profile': true,
  'loyalty.points': true,
  'loyalty.streaks': true,
  'loyalty.achievements': true,
  'loyalty.tiers': true,
};

/** A history reader serving small pages, so paging shows on a real book. */
class PagedHistory implements ClientHistoryReader {
  readonly calls: (string | null)[] = [];
  private failNext = false;
  constructor(
    private readonly inner: ClientHistoryReader,
    private readonly size: number,
  ) {}
  failOnce(): this {
    this.failNext = true;
    return this;
  }
  async pageForSubject(
    userId: string,
    page: { readonly beforeIso: string | null; readonly limit: number },
  ): Promise<Result<ClientHistoryPage, RepositoryError>> {
    this.calls.push(page.beforeIso);
    if (this.failNext) {
      this.failNext = false;
      return fail(new RepositoryError('page unavailable'));
    }
    return this.inner.pageForSubject(userId, { ...page, limit: this.size });
  }
}

/** A reader that answers only when the spec says so. */
class HeldHistory implements ClientHistoryReader {
  readonly calls: number[] = [];
  private readonly answers: (() => void)[] = [];
  constructor(private readonly inner: ClientHistoryReader) {}
  pageForSubject(
    userId: string,
    page: { readonly beforeIso: string | null; readonly limit: number },
  ): Promise<Result<ClientHistoryPage, RepositoryError>> {
    this.calls.push(this.calls.length);
    return new Promise((resolve) => {
      void this.inner.pageForSubject(userId, page).then((result) => {
        this.answers.push(() => resolve(result));
      });
    });
  }
  /** Every answer held so far. */
  release(): void {
    for (const answer of this.answers.splice(0)) answer();
  }
}

/** A profile port whose answer waits for the spec. */
class HeldProfiles extends InMemoryProfilePort {
  private releaseAll: (() => void) | null = null;
  private readonly gate = new Promise<void>((resolve) => {
    this.releaseAll = resolve;
  });
  override async getProfile(
    userId: UserId,
  ): Promise<Result<User | null, RepositoryError>> {
    await this.gate;
    return super.getProfile(userId);
  }
  release(): void {
    this.releaseAll?.();
  }
}

/** An activity reader serving small pages, so the ledger pages on the fixture's journal. */
class PagedActivity implements LoyaltyActivityReader {
  readonly calls: (LoyaltyActivityQuery & { readonly userId: string })[] = [];
  private failNext = false;
  constructor(
    private readonly inner: LoyaltyActivityReader,
    private readonly size: number,
  ) {}
  failOnce(): this {
    this.failNext = true;
    return this;
  }
  async page(
    userId: string,
    query: LoyaltyActivityQuery,
  ): Promise<Result<LoyaltyActivityPage, RepositoryError>> {
    this.calls.push({ userId, ...query });
    if (this.failNext) {
      this.failNext = false;
      return fail(new RepositoryError('page unavailable'));
    }
    return this.inner.page(userId, { ...query, limit: this.size });
  }
}

/** An activity reader whose pages answer only when the spec says so. */
class HeldActivity implements LoyaltyActivityReader {
  readonly calls: LoyaltyActivityQuery[] = [];
  private readonly answers: (() => void)[] = [];
  constructor(private readonly inner: LoyaltyActivityReader) {}
  page(
    userId: string,
    query: LoyaltyActivityQuery,
  ): Promise<Result<LoyaltyActivityPage, RepositoryError>> {
    this.calls.push(query);
    return new Promise((resolve) => {
      void this.inner.page(userId, query).then((result) => {
        this.answers.push(() => resolve(result));
      });
    });
  }
  /** Every answer held so far, in the order asked. */
  release(): void {
    for (const answer of this.answers.splice(0)) answer();
  }
}

interface RigOptions {
  readonly flags?: Readonly<Record<string, boolean>>;
  readonly profiles?: InMemoryProfilePort | null;
  readonly stats?: InMemoryStatsReader | null;
  readonly history?: ClientHistoryReader | null;
  readonly photos?: InMemoryClientPhotosReader | null;
  readonly loyalty?: InMemoryLoyaltyReader | null;
  readonly catalog?: InMemoryLoyaltyCatalogReader | null;
  readonly waitlist?: InMemoryWaitlistReader | null;
  readonly avatars?: InMemoryAvatars | null;
  readonly vouchers?: InMemoryClientVouchersReader | null;
  readonly activity?: LoyaltyActivityReader | null;
}

const BOOK: readonly Appointment[] = [...georgiHistory(), ...martinHistory()];

function defaults() {
  return {
    profiles: new InMemoryProfilePort(
      new Map([
        [GEORGI, georgiUser()],
        [MARTIN, martinUser()],
      ]),
    ),
    stats: new InMemoryStatsReader(
      new Map([
        [GEORGI, statsOf(GEORGI, georgiHistory())],
        [MARTIN, statsOf(MARTIN, martinHistory())],
      ]),
      new Map([[GEORGI, GEORGI_MONEY]]),
    ),
    history: new InMemoryClientHistoryReader(BOOK),
    photos: new InMemoryClientPhotosReader(georgiPhotos()),
    loyalty: InMemoryLoyaltyReader.seeded(),
    catalog: new InMemoryLoyaltyCatalogReader(),
    waitlist: new InMemoryWaitlistReader([martinWaitlist()]),
    avatars: new InMemoryAvatars(
      new Map([[GEORGI, 'https://example.test/avatars/georgi.jpg']]),
    ),
    vouchers: InMemoryClientVouchersReader.seeded(),
    activity: InMemoryLoyaltyActivityReader.seeded() as LoyaltyActivityReader,
  };
}

function rig(options: RigOptions = {}) {
  const ports = { ...defaults(), ...options };
  const bind = <T>(token: unknown, value: T | null) =>
    value === null ? [] : [{ provide: token, useValue: value }];
  TestBed.configureTestingModule({
    providers: [
      ClientCardStore,
      provideFeatureFlags(options.flags ?? ALL_FLAGS),
      ...provideTransloco({
        config: {
          availableLangs: ['bg', 'en'],
          defaultLang: 'bg',
          fallbackLang: 'bg',
          missingHandler: { logMissingKey: false },
        },
        loader: CatalogueLoader,
      }),
      {
        provide: CLOCK,
        useValue: {
          now: (zone: string) => ZonedDateTime.fromMillis(NOW_MS, zone),
        },
      },
      ...bind(PROFILE_PORT, ports.profiles),
      ...bind(CLIENT_STATS_READER, ports.stats),
      ...bind(CLIENT_HISTORY_READER, ports.history),
      ...bind(CLIENT_PHOTOS_READER, ports.photos),
      ...bind(LOYALTY_READER, ports.loyalty),
      ...bind(LOYALTY_CATALOG_READER, ports.catalog),
      ...bind(WAITLIST_READER, ports.waitlist),
      ...bind(AVATAR_UPLOADER, ports.avatars),
      ...bind(CLIENT_VOUCHERS_READER, ports.vouchers),
      ...bind(LOYALTY_ACTIVITY_READER, ports.activity),
    ],
  });
  return { store: TestBed.inject(ClientCardStore), ...ports };
}

/** Lets every pending read answer (real timers). */
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function open(
  store: ClientCardStore,
  subject: ClientCardSubject,
  context: ClientCardContext,
): void {
  store.open(subject, context);
}

afterEach(() => {
  vi.useRealTimers();
});

const WORDS = wordsOf('bg');
const textOf = (parts: readonly { readonly text: string }[]) =>
  parts.map((part) => part.text).join('');

/*
 * The built pages' members (`glance`, `loyalty`, `history`) went in W4
 * with their bodies; what they pinned of the STORE — the gate, the
 * failures and retries, the pages and the filter, offline, the words —
 * is pinned below on the revision-3 members (`hero`, `overview`,
 * `wallet`, `visits`) that read the same slices.
 */

describe('ClientCardStore — a guest', () => {
  it('reads nothing, and draws the hero, the phone and the exit', async () => {
    const history = new InMemoryClientHistoryReader(BOOK);
    const profiles = new InMemoryProfilePort(new Map());
    const loyalty = InMemoryLoyaltyReader.seeded();
    const photos = new InMemoryClientPhotosReader(georgiPhotos());
    const { store } = rig({ history, profiles, loyalty, photos });
    open(
      store,
      GUEST,
      martinContext({ isOwner: false, appointmentId: 'appt-walk-in' }),
    );
    await settle();
    expect(store.hero()).toMatchObject({ name: 'Иво', paused: false });
    expect(textOf(store.hero().line ?? [])).toBe('Гост\u00a0· без профил');
    expect(store.overview()).toEqual({
      actions: [
        expect.objectContaining({ id: 'call', href: 'tel:+359890001111' }),
        expect.objectContaining({ id: 'sms' }),
        expect.objectContaining({ id: 'viber' }),
      ],
      canRemove: true,
      failed: [],
    });
    expect(profiles.calls).toEqual([]);
    expect(loyalty.calls).toEqual([]);
    expect(photos.calls).toEqual([]);
    expect(history.calls).toEqual([]);
    expect(store.wallet()).toBeNull();
    expect(store.achievementsData()).toBeNull();
    expect(store.displayName()).toBe('Иво');
  });
});

describe('ClientCardStore — Георги, settled', () => {
  it('keeps the deprecated head for the editor’s photo page: the face and the line the hero says', async () => {
    const { store } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.head()).toEqual({
      name: 'Георги Петров',
      stateLine: 'Клиент от март 2025 г.',
      avatarSrc: 'https://example.test/avatars/georgi.jpg',
      initialsFrom: 'Георги Петров',
      paused: false,
    });
    expect(store.head().avatarSrc).toBe(store.hero().avatarSrc);
  });

  it('keeps F1’s sentence through «Използвай» and «Премахни»: a grant on the draft bill is still in hand (wave D r6)', async () => {
    const { store } = rig();
    const sentence = () => {
      const loyalty = store.overview().loyalty;
      return loyalty?.status === 'ready' ? loyalty.data.sentence : undefined;
    };
    // At rest: the ticket offers the haircut; the points say what else.
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(sentence()).toContain('оформяне на брада');
    // «Използвай»: the grant is on the bill, nothing offers it — the same
    // balance still never names the haircut the visit already gets.
    open(
      store,
      subjectOf(GEORGI),
      georgiContext({ grants: [], grantsOnBill: [GEORGI_GRANT] }),
    );
    await settle();
    expect(sentence()).toContain('оформяне на брада');
    // «Премахни»: back on the ticket, the same sentence.
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(sentence()).toContain('оформяне на брада');
    // Nothing held: the points name the haircut.
    open(
      store,
      subjectOf(GEORGI),
      georgiContext({ grants: [], grantsOnBill: [] }),
    );
    await settle();
    expect(sentence()).toContain('подстригване');
    expect(sentence()).not.toContain('оформяне на брада');
  });

  it('measures «Ново» from his visit before today’s, and words the achievements context', async () => {
    const { store } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const data = store.achievementsData();
    expect(data?.status === 'ready' && data.data.previousVisitAtMs).toBe(
      GEORGI_PREVIOUS_MS,
    );
    expect(store.achievementsContext()).toMatchObject({
      subjectName: 'Георги Петров',
      visit: null,
    });
  });

  it('titles every page of the client stack, and finds a past cut for the photo page', async () => {
    const { store } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.barTitle('client', GEORGI)).toBe('Георги Петров');
    expect(store.barTitle('clientLoyalty', GEORGI)).toBe('Лоялност');
    expect(store.barTitle('clientAchievements', GEORGI)).toBe('Постижения');
    expect(store.barTitle('clientHistory', GEORGI)).toBe('Посещения');
    expect(store.barTitle('achievementCategory', 'category:cat-mastery')).toBe(
      'Майсторство',
    );
    expect(
      store.barTitle('achievementCategory', 'season:season-2026-autumn'),
    ).toBe('Есен 2026');
    expect(store.barTitle('achievementCategory', 'archive')).toBe(
      'Минали сезони и събития',
    );
    expect(store.barTitle('achievementCategory', 'day:2026-09-04')).toBe(
      'Спечелени на 4.09',
    );
    expect(store.barTitle('achievementCategory', 'shelf:x')).toBeNull();
    expect(store.barTitle('achievementDetail', 'series-svc-fade')).toBe('Фейд');
    expect(store.barTitle('photo', 'photo-dev-georgi-2')).toBe('3.09');
    expect(store.barTitle('discount', null)).toBeNull();
    expect(store.photoById('photo-dev-georgi-1')).toMatchObject({
      appointmentId: 'appt-dev-1',
      dateLabel: '28.09',
      accessibleName: 'Снимка от 28 септември',
      barberId: 'ivan',
    });
    expect(store.photoById('photo-gone')).toBeNull();
  });

  it('reads the ‹admin› spend for an admin only', async () => {
    const barber = rig();
    open(barber.store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(barber.stats?.moneyCalls).toEqual([]);
    expect(textOf(barber.store.visits().facts ?? [])).not.toContain('€');
    TestBed.resetTestingModule();

    const admin = rig();
    open(
      admin.store,
      subjectOf(GEORGI),
      georgiContext({ viewer: { uid: 'dev-admin', roles: ['admin'] } }),
    );
    await settle();
    expect(admin.stats?.moneyCalls).toEqual([GEORGI]);
    const facts = textOf(admin.store.visits().facts ?? []);
    expect(facts).toContain('462,50');
    expect(facts).toContain('€');
  });
});

describe('ClientCardStore — a gone visit', () => {
  it('offers nothing that writes to a cancelled visit or a no-show: no ticket, no removal, no «Повтори»', async () => {
    const { store } = rig();
    open(
      store,
      subjectOf(MARTIN),
      martinContext({ settled: true, gone: true, grants: [GEORGI_GRANT] }),
    );
    await settle();
    const overview = store.overview();
    expect('reward' in overview).toBe(false);
    // No ticket on screen, but the reward is still his: the points never
    // name a reward he holds (DV5, wave D r6) — the sentence does not flip
    // with what the visit can take.
    expect(
      overview.loyalty?.status === 'ready' && overview.loyalty.data.sentence,
    ).toContain('оформяне на брада');
    expect(overview.canRemove).toBe(false);
    expect(overview.actions.map((a) => a.id)).toEqual(['call', 'sms', 'viber']);
    const wallet = store.wallet();
    expect(
      wallet?.status === 'ready' && wallet.data.actions.map((a) => a.id),
    ).not.toContain('use');
  });

  it('keeps all of it on a finished visit (completed is not gone)', async () => {
    const { store } = rig();
    open(
      store,
      subjectOf(MARTIN),
      martinContext({ settled: true, gone: false, grants: [GEORGI_GRANT] }),
    );
    await settle();
    const overview = store.overview();
    expect(overview.reward?.status).toBe('ready');
    expect(overview.canRemove).toBe(true);
    expect(overview.actions.map((a) => a.id)).toContain('same');
    const wallet = store.wallet();
    expect(
      wallet?.status === 'ready' && wallet.data.actions.map((a) => a.id),
    ).toContain('use');
    expect(
      wallet?.status === 'ready' &&
        wallet.data.holdings.status === 'ready' &&
        wallet.data.holdings.data.map((h) => h.kind),
    ).toContain('ticket');
  });
});

describe('ClientCardStore — Мартин, in the chair', () => {
  it('offers «Пак същото», the waitlist card and the birthday card, and measures «с това посещение»', async () => {
    const { store } = rig();
    open(store, subjectOf(MARTIN), martinContext());
    await settle();
    const overview = store.overview();
    expect(overview.canRemove).toBe(true);
    expect(overview.actions.map((a) => a.id)).toEqual([
      'call',
      'sms',
      'viber',
      'same',
    ]);
    // The tier is the plate and the birthday a card of its own: no capsule row.
    expect(overview.capsules).toBeUndefined();
    expect(overview.birthday?.kind).toBe('today');
    expect(
      overview.visits?.status === 'ready' && overview.visits.data.waitlist?.id,
    ).toBe('waitlist-dev-martin');
    expect(store.achievementsContext()?.visit).toMatchObject({
      birthdayToday: true,
      locationId: 'loc-center',
    });
    expect(
      overview.medals?.status === 'ready' && overview.medals.data.cue,
    ).toBe('Рожден ден в салона с това посещение');
  });

  it('holds the owner’s ticket out on the wallet while the visit can take it', async () => {
    const { store } = rig();
    open(store, subjectOf(MARTIN), martinContext({ grants: [GEORGI_GRANT] }));
    await settle();
    expect(store.overview().reward).toEqual({
      status: 'ready',
      data: expect.objectContaining({
        grantId: 'grant-dev-georgi-punch',
        detail: 'до 28.10',
      }),
    });
    const wallet = store.wallet();
    expect(
      wallet?.status === 'ready' &&
        wallet.data.holdings.status === 'ready' &&
        wallet.data.holdings.data.filter((h) => h.kind === 'ticket'),
    ).toMatchObject([{ ticket: { grantId: 'grant-dev-georgi-punch' } }]);
    expect(
      wallet?.status === 'ready' && wallet.data.actions.map((a) => a.id),
    ).toContain('use');
  });

  it('gives a companion no ticket', async () => {
    const { store } = rig();
    open(
      store,
      subjectOf(MARTIN),
      martinContext({ isOwner: false, grants: [] }),
    );
    await settle();
    expect('reward' in store.overview()).toBe(false);
  });
});

describe('ClientCardStore — the D-9 gate', () => {
  it('paints nothing under the hero until users/{uid} answers, and reads nothing else before it', async () => {
    const profiles = new HeldProfiles(
      new Map([[GEORGI, georgiUser(pausedUntilOctober())]]),
    );
    const history = new InMemoryClientHistoryReader(BOOK);
    const { store } = rig({ profiles, history });
    open(store, subjectOf(GEORGI), georgiOpenContext());
    await settle();
    expect(store.hero()).toMatchObject({
      name: 'Георги П.',
      line: null,
      tier: null,
    });
    const overview = store.overview();
    expect(overview.capsules).toEqual({ status: 'loading' });
    expect(overview.reward).toEqual({ status: 'loading' });
    expect(overview.visits).toEqual({ status: 'loading' });
    expect(overview.loyalty).toEqual({ status: 'loading' });
    expect(overview.medals).toEqual({ status: 'loading' });
    expect(overview.photos).toEqual({ status: 'loading' });
    expect(overview.birthday).toBeUndefined();
    expect(history.calls).toEqual([]);

    profiles.release();
    await settle();
    const hero = store.hero();
    expect(hero.paused).toBe(true);
    expect(textOf(hero.line ?? [])).toBe(WORDS.head.pausedUntil('12.10'));
    // Paused: no ticket, no waitlist card, the wallet frozen.
    expect('reward' in store.overview()).toBe(false);
    expect(history.calls.length).toBe(1);
    const wallet = store.wallet();
    expect(wallet?.status === 'ready' && wallet.data.frozen).toBe(true);
  });

  it('fails the whole card when the profile fails, reads nothing else, and recovers on retry', async () => {
    const profiles = new InMemoryProfilePort(
      new Map([[GEORGI, georgiUser()]]),
    ).failWith();
    const history = new InMemoryClientHistoryReader(BOOK);
    const loyalty = InMemoryLoyaltyReader.seeded();
    const { store } = rig({ profiles, history, loyalty });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    // Taking the person off needs no profile: a finished visit keeps it.
    expect(store.overview()).toEqual({
      actions: expect.any(Array),
      canRemove: true,
      failed: ['profile'],
    });
    expect(store.hero().line).toBeNull();
    expect(history.calls).toEqual([]);
    expect(loyalty.calls).toEqual([]);
    expect(store.wallet()).toEqual({ status: 'failed' });
    expect(store.visits().status).toBe('failed');

    profiles.recover();
    store.retry('profile');
    await settle();
    expect(store.overview().failed).toEqual([]);
    expect(textOf(store.hero().line ?? [])).toMatch(
      /^Клиент от март\u00a02025\u00a0г\./u,
    );
    expect(history.calls.length).toBe(1);
  });

  it('reads the whole card again whichever notice is retried behind a failed gate', async () => {
    const profiles = new InMemoryProfilePort(
      new Map([[GEORGI, georgiUser()]]),
    ).failWith();
    const history = new InMemoryClientHistoryReader(BOOK);
    const { store } = rig({ profiles, history });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.visits().status).toBe('failed');
    profiles.recover();
    store.retry('history');
    await settle();
    expect(store.overview().failed).toEqual([]);
    expect(store.visits().status).toBe('ready');
    expect(history.calls.length).toBe(1);
  });

  it('counts a failed stats read as the whole card’s', async () => {
    const stats = new InMemoryStatsReader(new Map()).failWith();
    const { store } = rig({ stats });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.overview().failed).toEqual(['profile']);
    stats.recover();
    store.retry('profile');
    await settle();
    expect(store.overview().failed).toEqual([]);
  });
});

describe('ClientCardStore — module failures', () => {
  it('fails one module under its heading, and retries it alone', async () => {
    const photos = new InMemoryClientPhotosReader(georgiPhotos()).failWith();
    const { store, loyalty } = rig({ photos });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.overview().photos).toEqual({ status: 'failed' });
    expect(store.overview().failed).toEqual(['photos']);
    // The featured card still draws — without its thumbs.
    const visits = store.overview().visits;
    expect(visits?.status === 'ready' && visits.data.last?.photos).toEqual([]);

    const loyaltyReads = loyalty?.calls.length;
    photos.recover();
    store.retry('photos');
    await settle();
    expect(store.overview().failed).toEqual([]);
    expect(store.overview().photos?.status).toBe('ready');
    expect(loyalty?.calls.length).toBe(loyaltyReads);
  });

  it('names every failed module; the page folds two or more into one notice', async () => {
    const photos = new InMemoryClientPhotosReader(georgiPhotos()).failWith();
    const history = new InMemoryClientHistoryReader(BOOK).failWith();
    const { store } = rig({ photos, history });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.overview().failed).toEqual(['visits', 'photos']);
    expect(store.visits().status).toBe('failed');
    history.recover();
    store.retry('visits');
    await settle();
    expect(store.overview().failed).toEqual(['photos']);
    expect(store.visits().status).toBe('ready');
  });

  it('fails loyalty and achievements together when the account cannot be read, and retries them', async () => {
    const loyalty = InMemoryLoyaltyReader.seeded().failWith();
    const { store } = rig({ loyalty });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.overview().failed).toEqual(['loyalty', 'achievements']);
    expect(store.wallet()).toEqual({ status: 'failed' });
    expect(store.achievementsData()).toEqual({ status: 'failed' });
    loyalty.recover();
    store.retry('loyalty');
    await settle();
    expect(store.overview().failed).toEqual([]);
    expect(store.achievementsData()?.status).toBe('ready');
  });

  it('keeps the visits module when only the waitlist fails — without the card', async () => {
    const waitlist = new InMemoryWaitlistReader([martinWaitlist()]).failWith();
    const { store } = rig({ waitlist });
    open(store, subjectOf(MARTIN), martinContext());
    await settle();
    const visits = store.overview().visits;
    expect(visits?.status).toBe('ready');
    expect(visits?.status === 'ready' && visits.data.waitlist).toBeNull();
    expect(store.overview().failed).toEqual([]);
  });

  it('settles a read that never answers as failed after ten seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const silent: ClientHistoryReader = {
      pageForSubject: () => new Promise(() => undefined),
    };
    const { store } = rig({ history: silent });
    open(store, subjectOf(GEORGI), georgiContext());
    await vi.advanceTimersByTimeAsync(0);
    expect(store.overview().visits).toEqual({ status: 'loading' });
    await vi.advanceTimersByTimeAsync(CLIENT_CARD_READ_TIMEOUT_MS);
    expect(store.overview().visits).toEqual({ status: 'failed' });
    expect(store.overview().failed).toEqual(['visits']);
  });
});

describe('ClientCardStore — flags, ports and accounts', () => {
  it('reads no loyalty with every loyalty flag off', async () => {
    const { store, loyalty, catalog } = rig({
      flags: { 'client.profile': true },
    });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.wallet()).toBeNull();
    expect(store.achievementsData()).toBeNull();
    const overview = store.overview();
    expect(
      'loyalty' in overview || 'medals' in overview || 'capsules' in overview,
    ).toBe(false);
    expect(loyalty?.calls).toEqual([]);
    expect(catalog?.reads).toBe(0);
  });

  it('draws no loyalty module for a client without an account', async () => {
    const profiles = new InMemoryProfilePort(new Map([[MARTIN, martinUser()]]));
    const { store } = rig({ profiles, loyalty: new InMemoryLoyaltyReader() });
    open(store, subjectOf(MARTIN), martinContext());
    await settle();
    const overview = store.overview();
    expect('loyalty' in overview || 'medals' in overview).toBe(false);
    expect(store.wallet()).toBeNull();
    expect(store.achievementsData()).toBeNull();
    // His birthday is still a card of its own; the plate has no tier to say.
    expect(overview.birthday?.kind).toBe('today');
    expect(store.hero().tier).toBeNull();
  });

  it('treats an unbound port as an absent module, never a failure', async () => {
    const { store } = rig({
      profiles: null,
      stats: null,
      history: null,
      photos: null,
      loyalty: null,
      catalog: null,
      waitlist: null,
      avatars: null,
    });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.hero()).toMatchObject({ name: 'Георги П.', line: null });
    expect(store.overview()).toEqual({
      actions: [
        expect.objectContaining({ id: 'call', href: 'tel:+359881234567' }),
        expect.objectContaining({ id: 'sms' }),
        expect.objectContaining({ id: 'viber' }),
      ],
      canRemove: true,
      failed: [],
      // The ticket is the host's grant, read through no port.
      reward: {
        status: 'ready',
        data: expect.objectContaining({ grantId: 'grant-dev-georgi-punch' }),
      },
    });
    expect(store.visits().status).toBe('failed');
  });

  it('reads the loyalty catalogue once for the store’s life', async () => {
    const { store, catalog } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    open(store, subjectOf(MARTIN), martinContext());
    await settle();
    expect(catalog?.reads).toBe(1);
    expect(store.achievementsData()?.status).toBe('ready');
  });
});

describe('ClientCardStore — opening again', () => {
  it('refreshes the same person without skeletons', async () => {
    const inner = new InMemoryClientHistoryReader(BOOK);
    const held = new HeldHistory(inner);
    const { store } = rig({ history: held });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    held.release();
    await settle();
    expect(store.overview().visits?.status).toBe('ready');

    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    // The second read is out; what was on screen stays.
    expect(held.calls.length).toBe(2);
    expect(store.overview().visits?.status).toBe('ready');
    held.release();
    await settle();
    expect(store.overview().visits?.status).toBe('ready');
  });

  it('starts over for another person, dropping the first one’s late answers', async () => {
    const inner = new InMemoryClientHistoryReader(BOOK);
    const held = new HeldHistory(inner);
    const { store } = rig({ history: held });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    open(store, subjectOf(MARTIN), martinContext());
    await settle();
    expect(store.displayName()).toBe('Мартин Илиев');
    expect(store.overview().visits).toEqual({ status: 'loading' });
    held.release();
    await settle();
    const visits = store.overview().visits;
    expect(visits?.status === 'ready' && visits.data.last?.id).toBe(
      'appt-hist-c2-14',
    );
    expect(
      store
        .visits()
        .sections.flatMap((s) => s.rows)
        .every((row) => !row.id.startsWith('appt-hist-c1')),
    ).toBe(true);
  });
});

describe('ClientCardStore — the history’s pages and filter', () => {
  const rowsOf = (store: ClientCardStore) =>
    store.visits().sections.flatMap((s) => s.rows);

  it('pages older visits in on «Покажи още», and ends on the first visit', async () => {
    const history = new PagedHistory(new InMemoryClientHistoryReader(BOOK), 10);
    const { store } = rig({ history });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.visits().paging).toMatchObject({ kind: 'more' });
    expect(rowsOf(store)).toHaveLength(10);

    store.loadMoreHistory();
    expect(store.visits().paging).toMatchObject({ kind: 'loading' });
    await settle();
    expect(rowsOf(store)).toHaveLength(20);
    store.loadMoreHistory();
    await settle();
    expect(rowsOf(store)).toHaveLength(25);
    expect(store.visits().paging?.kind).toBe('end');
    store.loadMoreHistory();
    await settle();
    expect(history.calls).toHaveLength(3);
  });

  it('keeps a failed page’s rows, says so, and retries the page', async () => {
    const history = new PagedHistory(new InMemoryClientHistoryReader(BOOK), 10);
    const { store } = rig({ history });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    history.failOnce();
    store.loadMoreHistory();
    await settle();
    expect(store.visits().paging).toMatchObject({ kind: 'failed' });
    expect(rowsOf(store)).toHaveLength(10);
    store.retry('history');
    await settle();
    expect(rowsOf(store)).toHaveLength(20);
  });

  it('fetches up to three more pages when a filter leaves fewer than ten rows', async () => {
    const history = new PagedHistory(new InMemoryClientHistoryReader(BOOK), 3);
    const { store } = rig({ history });
    open(store, subjectOf(MARTIN), martinContext());
    await settle();
    expect(history.calls).toHaveLength(1);
    store.setHistoryFilter('cancelled');
    expect(store.visits().filter).toBe('cancelled');
    await settle();
    expect(history.calls).toHaveLength(4);
    expect(rowsOf(store).map((r) => r.id)).toEqual(['appt-hist-c2-11']);
    store.setHistoryFilter('all');
    await settle();
    expect(history.calls).toHaveLength(4);
  });
});

describe('ClientCardStore — offline', () => {
  it('follows the device, keeps the phone, and drops what writes or reads', async () => {
    const history = new PagedHistory(new InMemoryClientHistoryReader(BOOK), 10);
    const { store } = rig({ history });
    open(store, subjectOf(MARTIN), martinContext({ grants: [GEORGI_GRANT] }));
    await settle();
    expect(store.online()).toBe(true);
    expect('reward' in store.overview()).toBe(true);

    window.dispatchEvent(new Event('offline'));
    expect(store.online()).toBe(false);
    const overview = store.overview();
    expect(overview.actions.map((a) => a.id)).toEqual(['call', 'sms', 'viber']);
    expect(overview.canRemove).toBe(false);
    expect('reward' in overview).toBe(false);
    expect(store.visits().paging).toBeNull();
    store.loadMoreHistory();
    await settle();
    expect(history.calls).toHaveLength(1);

    window.dispatchEvent(new Event('online'));
    expect(store.online()).toBe(true);
    expect(store.overview().canRemove).toBe(true);
  });
});

describe('ClientCardStore — words', () => {
  it('follows the active language', async () => {
    const { store } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    TestBed.inject(TranslocoService).setActiveLang('en');
    await settle();
    expect(textOf(store.hero().line ?? [])).toMatch(
      /^Client since March\u00a02025/u,
    );
    expect(store.barTitle('clientLoyalty', GEORGI)).toBe('Loyalty');
  });
});

// ── Revision 3: the re-drawn pages (§4.9) ─────────────────────────────────

const GEORGI_STATS = statsOf(GEORGI, georgiHistory());

/** The balance the seeded account holds (never the wireframe's figure, LR7). */
async function georgiBalance(): Promise<number> {
  const account = await InMemoryLoyaltyReader.seeded().getAccount(GEORGI);
  return must(account.isSuccess() ? account.value : null, 'Георги’s account')
    .balance;
}

/** Every client-visible row of a holder's journal, as the seeded reader holds them. */
async function journalOf(uid: string): Promise<readonly ActivityEntry[]> {
  const page = await InMemoryLoyaltyActivityReader.seeded().page(uid, {
    kind: 'all',
    limit: 1_000,
    after: null,
  });
  return page.isSuccess() ? page.value.entries : [];
}

const bgFigure = (value: number) => new Intl.NumberFormat('bg').format(value);

describe('ClientCardStore — revision 3: Георги, settled', () => {
  it('draws the hero: the face and the name from the seat, the line, the plate once the gate opens', async () => {
    const { store } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const hero = store.hero();
    expect(hero).toMatchObject({
      name: 'Георги Петров',
      avatarSrc: 'https://example.test/avatars/georgi.jpg',
      initialsFrom: 'Георги Петров',
      paused: false,
    });
    // The tenure is the line's fact, in primary ink, its words held by
    // no-break spaces (the card's one grammar, `client-card.format.ts`).
    expect(textOf(hero.line ?? [])).toMatch(
      /^Клиент от март\u00a02025\u00a0г\./u,
    );
    expect(hero.line?.find((part) => part.fact)?.text).toBe(
      'март\u00a02025\u00a0г.',
    );
    // The tier is the plate on the face, not a capsule under the name.
    expect(hero.tier?.name).toBe('Злато');
    expect(hero.tier?.accessibleName).toContain('Злато');
  });

  it('fills the overview: no tier capsule, no birthday, the cards, one loyalty card with its holdings, the medals', async () => {
    const { store } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const overview = store.overview();
    expect(overview.failed).toEqual([]);
    expect(overview.canRemove).toBe(true);
    expect(overview.actions.map((a) => a.id)).toEqual(['call', 'sms', 'viber']);
    // B carries warnings and tags only; the plate says the tier.
    expect(overview.capsules).toBeUndefined();
    // His birthday is in April.
    expect(overview.birthday).toBeUndefined();
    expect(overview.reward).toEqual({
      status: 'ready',
      data: expect.objectContaining({ grantId: 'grant-dev-georgi-punch' }),
    });
    expect(
      overview.visits?.status === 'ready' && overview.visits.data,
    ).toMatchObject({
      count: GEORGI_STATS.lifetime.visitsCompleted,
      waitlist: null,
    });
    expect(
      overview.visits?.status === 'ready' && overview.visits.data.last,
    ).not.toBeNull();
    expect(
      overview.visits?.status === 'ready' && overview.visits.data.next,
    ).not.toBeNull();
    const loyalty =
      overview.loyalty?.status === 'ready' ? overview.loyalty.data : null;
    expect(loyalty?.figure).toBe(bgFigure(await georgiBalance()));
    expect(loyalty?.unit).not.toBeNull();
    // The voucher the seed gave him leads the holdings: 25,00 € of 50,00 €.
    expect(loyalty?.holdings.map((h) => h.id)).toEqual([
      'voucher',
      'stamps',
      'rhythm',
    ]);
    expect(loyalty?.holdings[0]?.value).toBe(NBSP_EURO('25,00 €'));
    const medals =
      overview.medals?.status === 'ready' ? overview.medals.data : null;
    expect(medals?.levelCount).toBeGreaterThan(0);
    expect(medals?.tiles.length).toBeGreaterThan(0);
    expect(medals?.tiles.length).toBeLessThanOrEqual(3);
    expect(
      overview.photos?.status === 'ready' &&
        overview.photos.data.map((p) => p.photoId),
    ).toEqual(['photo-dev-georgi-3']);
  });

  it('holds the wallet over its two new reads, and the ledger’s first page under «Всички»', async () => {
    const { store, vouchers, activity } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(vouchers?.calls).toEqual([{ userId: GEORGI }]);
    // Two reads of the journal: the wallet's feed and the ledger's first page.
    expect((activity as InMemoryLoyaltyActivityReader).calls).toEqual(
      expect.arrayContaining([
        {
          userId: GEORGI,
          kind: 'all',
          limit: WALLET_ACTIVITY_READ,
          after: null,
        },
        { userId: GEORGI, kind: 'all', limit: LEDGER_PAGE_READ, after: null },
      ]),
    );

    const wallet = store.wallet();
    expect(wallet?.status).toBe('ready');
    if (wallet?.status !== 'ready') return;
    const balance = await georgiBalance();
    expect(wallet.data.frozen).toBe(false);
    expect(wallet.data.pass).toMatchObject({
      figure: bgFigure(balance),
      holder: 'Георги Петров',
      tier: 'Злато',
      frozen: false,
    });
    // A finished visit still takes a reward: «Използвай» and «Код» are on.
    const actions = wallet.data.actions.map((a) => a.id);
    expect(actions).toHaveLength(4);
    expect(actions).toEqual(
      expect.arrayContaining(['use', 'code', 'catalog', 'history']),
    );
    expect(wallet.data.holdings.status).toBe('ready');
    if (wallet.data.holdings.status === 'ready') {
      expect(wallet.data.holdings.data.map((h) => h.kind)).toEqual(
        expect.arrayContaining(['voucher', 'ticket', 'stamps']),
      );
      expect(
        wallet.data.holdings.data.find((h) => h.kind === 'voucher'),
      ).toMatchObject({ voucher: { voucherId: 'voucher-dev-georgi' } });
    }
    expect(wallet.data.rhythm).toMatchObject({ frozen: false });
    expect(wallet.data.rhythm?.ruleLine).not.toBe('');
    expect(wallet.data.tier?.status).toBe('ready');
    expect(wallet.data.catalog?.status).toBe('ready');
    expect(wallet.data.activity?.status).toBe('ready');
    expect(
      wallet.data.activity?.status === 'ready' &&
        wallet.data.activity.data.length,
    ).toBeGreaterThan(0);

    const ledger = store.ledger();
    expect(ledger.status).toBe('ready');
    expect(ledger.filter).toBe('all');
    expect(textOf(ledger.subline)).toBe(
      WORDS.ledgerPage.subline(
        'Георги Петров',
        WORDS.ledgerPage.points(balance),
      ),
    );
    expect(ledger.groups.length).toBeGreaterThan(0);
    for (const group of ledger.groups)
      expect(group.key).toMatch(/^\d{4}-\d{2}$/u);
    const journal = await journalOf(GEORGI);
    expect(ledger.paging).toEqual({
      kind: journal.length > LEDGER_PAGE_READ ? 'more' : 'end',
    });
    expect(store.medalsChip()).toBe('all');
  });

  it('words «Рекорди» and «Посещения», knows the history whole, and titles the two new pages', async () => {
    const { store } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const records = store.records();
    expect(records?.status).toBe('ready');
    if (records?.status === 'ready') {
      expect(records.data.subline).toBe('Георги Петров');
      expect(records.data.groups.length).toBeGreaterThan(0);
    }
    expect(store.rhythmRule()).toMatchObject({ enabled: true });

    const visits = store.visits();
    expect(visits.status).toBe('ready');
    expect(visits.line.length).toBeGreaterThan(0);
    const keys = visits.sections.map((section) => section.key);
    expect(keys[0]).toBe('upcoming');
    for (const key of keys.slice(1)) expect(key).toMatch(/^\d{4}-\d{2}$/u);
    expect(visits.offeredFilters).toContain('all');
    // The whole book is one page: the foot names the first visit's day.
    const first = must(GEORGI_STATS.firstVisitAtMs, 'his first visit');
    expect(visits.paging).toEqual({
      kind: 'end',
      endLabel: WORDS.history.first(dayWithYear(shopDayOf(first), 'bg')),
    });
    expect(store.loadedVisits()).toHaveLength(georgiHistory().length);
    expect(store.historyComplete()).toBe(true);
    expect(store.visitRowsInput()).toMatchObject({
      subjectUserId: GEORGI,
      currentAppointmentId: 'appt-dev-1',
    });

    expect(store.barTitle('clientLedger', GEORGI)).toBe('Движение');
    expect(store.barTitle('clientRecords', GEORGI)).toBe('Рекорди');
  });
});

describe('ClientCardStore — revision 3: the ledger’s pills and pages', () => {
  it('reads the first page again under a pill, once per pill, and nets only under «Всички» and «Точки»', async () => {
    const { store, activity } = rig();
    const reader = activity as InMemoryLoyaltyActivityReader;
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const before = reader.calls.length;

    store.setLedgerFilter('points');
    expect(store.ledger()).toMatchObject({
      status: 'loading',
      filter: 'points',
    });
    await settle();
    expect(reader.calls.slice(before)).toEqual([
      { userId: GEORGI, kind: 'points', limit: LEDGER_PAGE_READ, after: null },
    ]);
    expect(store.ledger()).toMatchObject({ status: 'ready', filter: 'points' });

    // The pill in force again: nothing is read.
    store.setLedgerFilter('points');
    await settle();
    expect(reader.calls).toHaveLength(before + 1);

    store.setLedgerFilter('rewards');
    await settle();
    const rewards = store.ledger();
    expect(rewards).toMatchObject({ status: 'ready', filter: 'rewards' });
    // The sum of what the reward rows moved is nobody's net.
    expect(rewards.groups.every((group) => group.net === null)).toBe(true);
    // The wallet's own feed is untouched by the pills.
    const wallet = store.wallet();
    expect(wallet?.status === 'ready' && wallet.data.activity?.status).toBe(
      'ready',
    );
  });

  it('drops an older pill’s answer when the pills change faster than the reads', async () => {
    const held = new HeldActivity(InMemoryLoyaltyActivityReader.seeded());
    const { store } = rig({ activity: held });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.ledger().status).toBe('loading');
    store.setLedgerFilter('points');
    store.setLedgerFilter('status');
    // Every read is on its way; they answer in the order asked.
    await settle();
    held.release();
    await settle();
    expect(store.ledger()).toMatchObject({ status: 'ready', filter: 'status' });
    expect(held.calls.map((call) => call.kind)).toEqual([
      'all',
      'all',
      'points',
      'status',
    ]);
  });

  it('pages older rows in on «Покажи още», and ends on the journal’s oldest event', async () => {
    const paged = new PagedActivity(InMemoryLoyaltyActivityReader.seeded(), 3);
    const { store } = rig({ activity: paged });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.ledger().paging).toEqual({ kind: 'more' });
    for (
      let page = 0;
      page < 20 && store.ledger().paging?.kind === 'more';
      page += 1
    ) {
      store.loadMoreLedger();
      expect(store.ledger().paging).toEqual({ kind: 'loading' });
      await settle();
    }
    const ledger = store.ledger();
    expect(ledger.paging).toEqual({ kind: 'end' });
    const journal = await journalOf(GEORGI);
    expect(
      ledger.groups.reduce((rows, group) => rows + group.rows.length, 0),
    ).toBe(foldByEvent(journal, true).length);
    const pages = paged.calls.filter((call) => call.limit === LEDGER_PAGE_READ);
    expect(pages[0]?.after).toBeNull();
    for (const call of pages.slice(1)) expect(typeof call.after).toBe('number');
    expect(pages.length).toBe(Math.ceil(journal.length / 3));
  });

  it('keeps a failed page’s rows, says so in the foot, and retries the page', async () => {
    const paged = new PagedActivity(InMemoryLoyaltyActivityReader.seeded(), 3);
    const { store } = rig({ activity: paged });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const rows = store.ledger().groups.flatMap((group) => group.rows);
    paged.failOnce();
    store.loadMoreLedger();
    await settle();
    expect(store.ledger().paging).toEqual({ kind: 'failed' });
    expect(store.ledger().groups.flatMap((group) => group.rows)).toEqual(rows);
    store.retry('activity');
    await settle();
    expect(['more', 'end']).toContain(store.ledger().paging?.kind);
    expect(
      store.ledger().groups.flatMap((group) => group.rows).length,
    ).toBeGreaterThan(rows.length);
  });

  it('fails the feed and the page under their headings, never the glance, and retries them as one region', async () => {
    const activity = InMemoryLoyaltyActivityReader.seeded().failWith();
    const { store } = rig({ activity });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const wallet = store.wallet();
    expect(wallet?.status === 'ready' && wallet.data.activity?.status).toBe(
      'failed',
    );
    expect(store.ledger().status).toBe('failed');
    expect(store.overview().failed).toEqual([]);

    activity.recover();
    store.retry('activity');
    await settle();
    const after = store.wallet();
    expect(after?.status === 'ready' && after.data.activity?.status).toBe(
      'ready',
    );
    expect(store.ledger().status).toBe('ready');
  });
});

describe('ClientCardStore — revision 3: the vouchers', () => {
  it('fails the holdings alone, keeps the glance’s card without the voucher, and retries the vouchers', async () => {
    const vouchers = InMemoryClientVouchersReader.seeded().failWith();
    const { store } = rig({ vouchers });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const wallet = store.wallet();
    expect(wallet?.status === 'ready' && wallet.data.holdings.status).toBe(
      'failed',
    );
    const loyalty = store.overview().loyalty;
    expect(loyalty?.status).toBe('ready');
    expect(
      loyalty?.status === 'ready' && loyalty.data.holdings.map((h) => h.id),
    ).toEqual(['stamps', 'rhythm']);
    expect(store.overview().failed).toEqual([]);

    vouchers.recover();
    store.retry('vouchers');
    await settle();
    expect(vouchers.calls).toHaveLength(2);
    const after = store.wallet();
    expect(after?.status === 'ready' && after.data.holdings.status).toBe(
      'ready',
    );
    const glance = store.overview().loyalty;
    expect(
      glance?.status === 'ready' && glance.data.holdings.map((h) => h.id),
    ).toEqual(['voucher', 'stamps', 'rhythm']);
  });

  it('treats the two unbound readers as absent sections, never failures', async () => {
    const { store } = rig({ vouchers: null, activity: null });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const wallet = store.wallet();
    expect(wallet?.status).toBe('ready');
    if (wallet?.status !== 'ready') return;
    expect(wallet.data.holdings.status).toBe('ready');
    if (wallet.data.holdings.status === 'ready') {
      expect(wallet.data.holdings.data.map((h) => h.kind)).not.toContain(
        'voucher',
      );
    }
    expect('activity' in wallet.data).toBe(false);
    expect(wallet.data.actions.map((a) => a.id)).toContain('use');
    // Without a feed the ledger page is unreachable: it reads as failed, as a list without its reader does.
    expect(store.ledger().status).toBe('failed');
    expect(store.overview().failed).toEqual([]);
  });
});

describe('ClientCardStore — revision 3: the chip', () => {
  it('opens on «Всички», keeps the chosen chip through a re-open of the same person, and starts over for another', async () => {
    const { store } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.medalsChip()).toBe('all');
    store.setMedalsChip('cat-mastery');
    expect(store.medalsChip()).toBe('cat-mastery');
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.medalsChip()).toBe('cat-mastery');
    open(store, subjectOf(MARTIN), martinContext());
    await settle();
    expect(store.medalsChip()).toBe('all');
  });
});

describe('ClientCardStore — revision 3: Мартин, in the chair', () => {
  it('draws the birthday as a card, the band alone without a gift, and the plate for the tier', async () => {
    const { store } = rig();
    open(store, subjectOf(MARTIN), martinContext());
    await settle();
    expect(store.hero().tier?.name).toBe('Сребро');
    const overview = store.overview();
    expect(overview.capsules).toBeUndefined();
    expect(overview.birthday).toMatchObject({
      kind: 'today',
      title: WORDS.birthday.todayAge(34),
      gift: null,
    });
    expect('reward' in overview).toBe(false);
  });

  it('puts the birthday gift on the card and keeps every other ticket where it stood', async () => {
    const plain = rig();
    open(
      plain.store,
      subjectOf(MARTIN),
      martinContext({ grants: [GEORGI_GRANT] }),
    );
    await settle();
    const overview = plain.store.overview();
    expect(overview.birthday?.gift).toBeNull();
    expect(overview.reward).toEqual({
      status: 'ready',
      data: expect.objectContaining({ grantId: 'grant-dev-georgi-punch' }),
    });
    TestBed.resetTestingModule();

    const gifted = rig();
    open(
      gifted.store,
      subjectOf(MARTIN),
      martinContext({ grants: [{ ...GEORGI_GRANT, occasion: 'birthday' }] }),
    );
    await settle();
    const withGift = gifted.store.overview();
    expect(withGift.birthday?.gift).toMatchObject({
      grantId: 'grant-dev-georgi-punch',
    });
    // The generic ticket never repeats the gift.
    expect('reward' in withGift).toBe(false);
  });

  it('offers the dock’s verb for a service family his open visit lacks, and withdraws it offline, on a gone visit and for a companion’s paused card', async () => {
    const { store } = rig();
    open(store, subjectOf(MARTIN), martinContext());
    await settle();
    expect(store.detailAction('series-svc-fade')).toMatchObject({
      serviceId: 'svc-fade',
    });
    expect(store.detailAction('series-nope')).toBeNull();

    window.dispatchEvent(new Event('offline'));
    expect(store.detailAction('series-svc-fade')).toBeNull();
    window.dispatchEvent(new Event('online'));
    expect(store.detailAction('series-svc-fade')).not.toBeNull();

    // The service already on his seat: nothing to add.
    expect(store.detailAction('series-svc-classic-cut')).toBeNull();
    TestBed.resetTestingModule();

    const gone = rig();
    open(gone.store, subjectOf(MARTIN), martinContext({ gone: true }));
    await settle();
    expect(gone.store.detailAction('series-svc-fade')).toBeNull();
    // Offline and gone, the wallet keeps its tickets on show but takes the verbs.
    const wallet = gone.store.wallet();
    expect(
      wallet?.status === 'ready' && wallet.data.actions.map((a) => a.id),
    ).not.toContain('code');
  });
});

describe('ClientCardStore — revision 3: a paused client', () => {
  it('rings the face with the warning, freezes the pass, and offers no verb', async () => {
    const profiles = new InMemoryProfilePort(
      new Map([[GEORGI, georgiUser(pausedUntilOctober())]]),
    );
    const { store } = rig({ profiles });
    open(store, subjectOf(GEORGI), georgiOpenContext());
    await settle();
    const hero = store.hero();
    expect(hero.paused).toBe(true);
    expect(textOf(hero.line ?? [])).toBe(WORDS.head.pausedUntil('12.10'));
    const wallet = store.wallet();
    expect(wallet?.status).toBe('ready');
    if (wallet?.status === 'ready') {
      expect(wallet.data.frozen).toBe(true);
      expect(wallet.data.pass.state).toBe(WORDS.loyaltyPage.passFrozen);
      expect(wallet.data.actions.map((a) => a.id)).not.toContain('use');
    }
    expect(store.detailAction('series-svc-beard')).toBeNull();
    expect('reward' in store.overview()).toBe(false);
  });
});

describe('ClientCardStore — revision 3: a guest, and the flags', () => {
  it('draws a guest’s hero from the seat and nothing of the pages', async () => {
    const { store, vouchers, activity } = rig();
    open(
      store,
      GUEST,
      martinContext({ isOwner: false, appointmentId: 'appt-walk-in' }),
    );
    await settle();
    expect(store.hero()).toEqual({
      name: 'Иво',
      line: [{ text: 'Гост\u00a0· без профил', fact: false }],
      tier: null,
      avatarSrc: null,
      initialsFrom: 'Иво',
      paused: false,
    });
    expect(store.overview()).toEqual({
      actions: [
        expect.objectContaining({ id: 'call' }),
        expect.objectContaining({ id: 'sms' }),
        expect.objectContaining({ id: 'viber' }),
      ],
      canRemove: true,
      failed: [],
    });
    expect(store.wallet()).toBeNull();
    expect(store.records()).toBeNull();
    expect(store.rhythmRule()).toBeNull();
    expect(store.visits().status).toBe('loading');
    expect(store.ledger().status).toBe('loading');
    expect(store.loadedVisits()).toEqual([]);
    expect(store.historyComplete()).toBe(false);
    expect(store.visitRowsInput()).toBeNull();
    expect(vouchers?.calls).toEqual([]);
    expect((activity as InMemoryLoyaltyActivityReader).calls).toEqual([]);
  });

  it('reads no voucher and no feed with every loyalty flag off, and no feed with the points off', async () => {
    const off = rig({ flags: { 'client.profile': true } });
    open(off.store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(off.store.wallet()).toBeNull();
    expect(off.store.records()).toBeNull();
    expect(off.store.rhythmRule()).toBeNull();
    expect(off.store.overview().loyalty).toBeUndefined();
    expect(off.store.overview().medals).toBeUndefined();
    expect(off.store.ledger().status).toBe('failed');
    expect(off.vouchers?.calls).toEqual([]);
    expect((off.activity as InMemoryLoyaltyActivityReader).calls).toEqual([]);
    TestBed.resetTestingModule();

    const noPoints = rig({ flags: { ...ALL_FLAGS, 'loyalty.points': false } });
    open(noPoints.store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(noPoints.vouchers?.calls).toHaveLength(1);
    expect((noPoints.activity as InMemoryLoyaltyActivityReader).calls).toEqual(
      [],
    );
    const wallet = noPoints.store.wallet();
    expect(wallet?.status).toBe('ready');
    if (wallet?.status === 'ready') {
      expect('activity' in wallet.data).toBe(false);
      expect('catalog' in wallet.data).toBe(false);
      expect(wallet.data.actions.map((a) => a.id)).not.toContain('history');
    }
    expect(noPoints.store.ledger().status).toBe('failed');
    // The glance's card leads with the first holding as its figure.
    const loyalty = noPoints.store.overview().loyalty;
    expect(loyalty?.status === 'ready' && loyalty.data).toMatchObject({
      figure: NBSP_EURO('25,00 €'),
      unit: null,
    });
  });

  it('titles the two new pages in English too', async () => {
    const { store } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    TestBed.inject(TranslocoService).setActiveLang('en');
    await settle();
    expect(store.barTitle('clientLedger', GEORGI)).toBe(
      wordsOf('en').ledgerPage.title,
    );
    expect(store.barTitle('clientRecords', GEORGI)).toBe(
      wordsOf('en').achievements.records,
    );
    expect(store.hero().tier?.name).toBe('Gold');
  });
});
