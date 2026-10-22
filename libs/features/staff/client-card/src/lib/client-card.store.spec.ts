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
import { BirthDate, JournalEffect, JournalFeed } from '@core/components';
import type { Appointment, JournalEntry } from '@core/entities';
import type {
  AppointmentPhotoPorts,
  AppointmentReadPorts,
  AvatarPorts,
  ClientJournalPorts,
  DefaultLocationPorts,
  LocationLoadPorts,
  ClientStatsReadPorts,
  CouponVoucherPorts,
  CustomerPorts,
  JournalPage,
  LoyaltyAccountReadPorts,
  LoyaltyCatalogReadPorts,
  ProfilePorts,
  WaitlistReadPorts,
} from '@core/ports';
import {
  type CustomerId,
  RepositoryError as CoreRepositoryError,
  Result as CoreResult,
} from '@core/primitives';
import {
  loyaltyCatalogFixture,
  memoryAppointmentReadPorts,
} from '@core/testing';
import {
  APPOINTMENT_PHOTO_PORTS,
  APPOINTMENT_READ_PORTS,
  AVATAR_PORTS,
  CLIENT_JOURNAL_PORTS,
  CLIENT_STATS_READ_PORTS,
  COUPON_VOUCHER_PORTS,
  CUSTOMER_PORTS,
  LOYALTY_ACCOUNT_READ_PORTS,
  LOYALTY_CATALOG_READ_PORTS,
  PROFILE_PORTS,
  WAITLIST_READ_PORTS,
  provideFlags,
} from '@creativo/infrastructure/firebase-app';
import type {
  ClientCardContext,
  ClientCardSubject,
} from './client-card.contracts';
import { dayWithYear } from './client-card.format';
import {
  CLIENT_CARD_READ_TIMEOUT_MS,
  ClientCardStore,
} from './client-card.store';
import { LEDGER_PAGE_READ, foldByEvent } from './ledger.presenter';
import { WALLET_ACTIVITY_READ } from './wallet.presenter';
import {
  GEORGI,
  GEORGI_CUSTOMER_ID,
  GEORGI_GRANT,
  GEORGI_LOYALTY,
  GEORGI_MONEY,
  GEORGI_PREVIOUS_MS,
  GUEST,
  MARTIN,
  NBSP_EURO,
  type PortDouble,
  avatarPortsOf,
  catalogPortsOf,
  catalogueOf,
  customerPortsOf,
  georgiContext,
  georgiHistory,
  georgiOpenContext,
  georgiPhotos,
  georgiUser,
  heldProfilePortsOf,
  historyPortsOf,
  journalPortsOf,
  loyaltyPortsOf,
  martinContext,
  martinHistory,
  martinUser,
  martinWaitlist,
  must,
  pausedUntilOctober,
  photoPortsOf,
  profilePortsOf,
  shopZonePortsOf,
  statsOf,
  statsPortsOf,
  stubOf,
  subjectOf,
  voucherPortsOf,
  waitlistPortsOf,
  wordsOf,
} from '../testing/client-card.fixtures';
import { cardRuntimeProviders } from '../testing/achievements-pages.rig';
import { CardLoadState } from './client-pages.vm';

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

type HistoryPage = ReturnType<AppointmentReadPorts['pageClientHistory']>;

/** A history serving small pages, so paging shows on a real book; each read's cursor recorded. */
function pagedHistory(
  inner: AppointmentReadPorts,
  size: number,
): AppointmentReadPorts & {
  readonly calls: (number | null)[];
  failOnce(): void;
} {
  const calls: (number | null)[] = [];
  let failNext = false;
  return {
    ...inner,
    calls,
    failOnce: () => {
      failNext = true;
    },
    pageClientHistory: async (subjectCustomerId, beforeUtcMs) => {
      calls.push(beforeUtcMs);
      if (failNext) {
        failNext = false;
        return CoreResult.err(CoreRepositoryError.unavailable());
      }
      return inner.pageClientHistory(subjectCustomerId, beforeUtcMs, size);
    },
  };
}

/** A history that answers only when the spec says so. */
function heldHistory(inner: AppointmentReadPorts): AppointmentReadPorts & {
  readonly calls: number[];
  release(): void;
} {
  const calls: number[] = [];
  const answers: (() => void)[] = [];
  return {
    ...inner,
    calls,
    pageClientHistory: (subjectCustomerId, beforeUtcMs, limit): HistoryPage => {
      calls.push(calls.length);
      return new Promise((resolve) => {
        void inner
          .pageClientHistory(subjectCustomerId, beforeUtcMs, limit)
          .then((result) => {
            answers.push(() => resolve(result));
          });
      });
    },
    /** Every answer held so far. */
    release: () => {
      for (const answer of answers.splice(0)) answer();
    },
  };
}

/** One read of the journal: whose, under which effects, from which cursor, how many. */
interface JournalRead {
  readonly customerId: CustomerId;
  readonly effects: readonly JournalEffect[];
  readonly beforeSeq: number | null;
  readonly limit: number;
}

/** A journal serving small pages, so the ledger pages on the fixture's journal; each read recorded. */
function pagedJournal(
  inner: ClientJournalPorts,
  size: number,
): ClientJournalPorts & {
  readonly calls: JournalRead[];
  failOnce(): void;
} {
  const calls: JournalRead[] = [];
  let failNext = false;
  return {
    calls,
    failOnce: () => {
      failNext = true;
    },
    pageClientJournal: async (customerId, effects, beforeSeq, limit) => {
      calls.push({ customerId, effects, beforeSeq, limit });
      if (failNext) {
        failNext = false;
        return CoreResult.err(CoreRepositoryError.unavailable());
      }
      return inner.pageClientJournal(customerId, effects, beforeSeq, size);
    },
  };
}

/** A journal whose pages answer only when the spec says so. */
function heldJournal(inner: ClientJournalPorts): ClientJournalPorts & {
  readonly calls: JournalRead[];
  release(): void;
} {
  const calls: JournalRead[] = [];
  const answers: (() => void)[] = [];
  return {
    calls,
    pageClientJournal: (customerId, effects, beforeSeq, limit) => {
      calls.push({ customerId, effects, beforeSeq, limit });
      return new Promise<CoreResult<JournalPage, CoreRepositoryError>>(
        (resolve) => {
          void inner
            .pageClientJournal(customerId, effects, beforeSeq, limit)
            .then((result) => {
              answers.push(() => resolve(result));
            });
        },
      );
    },
    /** Every answer held so far, in the order asked. */
    release: () => {
      for (const answer of answers.splice(0)) answer();
    },
  };
}

interface RigOptions {
  readonly flags?: Readonly<Record<string, boolean>>;
  readonly profiles?: PortDouble<ProfilePorts> | null;
  readonly customers?: CustomerPorts | null;
  readonly stats?: PortDouble<ClientStatsReadPorts> | null;
  readonly history?: AppointmentReadPorts | null;
  readonly photos?: PortDouble<AppointmentPhotoPorts> | null;
  readonly loyalty?: PortDouble<LoyaltyAccountReadPorts> | null;
  readonly catalog?: PortDouble<LoyaltyCatalogReadPorts> | null;
  readonly waitlist?: WaitlistReadPorts | null;
  readonly avatars?: AvatarPorts | null;
  readonly vouchers?: PortDouble<CouponVoucherPorts> | null;
  readonly activity?: ClientJournalPorts | null;
  /** Where the shop's zone is read — the fixture centre shop as the default location unless said. */
  readonly locations?: LocationLoadPorts & DefaultLocationPorts;
}

const BOOK: readonly Appointment[] = [...georgiHistory(), ...martinHistory()];

function defaults() {
  return {
    profiles: profilePortsOf(),
    customers: customerPortsOf(),
    stats: statsPortsOf(
      [statsOf(GEORGI, georgiHistory()), statsOf(MARTIN, martinHistory())],
      [GEORGI_MONEY],
    ),
    history: historyPortsOf(BOOK) as AppointmentReadPorts,
    photos: photoPortsOf(georgiPhotos()),
    loyalty: loyaltyPortsOf(),
    catalog: catalogPortsOf(),
    waitlist: waitlistPortsOf([martinWaitlist()]) as WaitlistReadPorts,
    avatars: avatarPortsOf(
      new Map([[GEORGI, 'https://example.test/avatars/georgi.jpg']]),
    ),
    vouchers: voucherPortsOf(),
    activity: journalPortsOf() as ClientJournalPorts,
  };
}

function rig(options: RigOptions = {}) {
  const ports = { ...defaults(), ...options };
  const bind = <T>(token: unknown, value: T | null) =>
    value === null ? [] : [{ provide: token, useValue: value }];
  TestBed.configureTestingModule({
    providers: [
      ClientCardStore,
      provideFlags(options.flags ?? ALL_FLAGS),
      ...provideTransloco({
        config: {
          availableLangs: ['bg', 'en'],
          defaultLang: 'bg',
          fallbackLang: 'bg',
          missingHandler: { logMissingKey: false },
        },
        loader: CatalogueLoader,
      }),
      ...cardRuntimeProviders(undefined, options.locations),
      ...bind(PROFILE_PORTS, ports.profiles),
      ...bind(CUSTOMER_PORTS, ports.customers),
      ...bind(CLIENT_STATS_READ_PORTS, ports.stats),
      ...bind(APPOINTMENT_READ_PORTS, ports.history),
      ...bind(APPOINTMENT_PHOTO_PORTS, ports.photos),
      ...bind(LOYALTY_ACCOUNT_READ_PORTS, ports.loyalty),
      ...bind(LOYALTY_CATALOG_READ_PORTS, ports.catalog),
      ...bind(WAITLIST_READ_PORTS, ports.waitlist),
      ...bind(AVATAR_PORTS, ports.avatars),
      ...bind(COUPON_VOUCHER_PORTS, ports.vouchers),
      ...bind(CLIENT_JOURNAL_PORTS, ports.activity),
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
    const history = historyPortsOf(BOOK);
    const profiles = profilePortsOf([]);
    const loyalty = loyaltyPortsOf();
    const photos = photoPortsOf(georgiPhotos());
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
      return loyalty?.cardLoadState === CardLoadState.Ready
        ? loyalty.data.sentence
        : undefined;
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
    expect(
      data?.cardLoadState === CardLoadState.Ready &&
        data.data.previousVisitAtMs,
    ).toBe(GEORGI_PREVIOUS_MS);
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
    expect(barber.stats?.callsTo('loadClientMoney')).toEqual([]);
    expect(textOf(barber.store.visits().facts ?? [])).not.toContain('€');
    TestBed.resetTestingModule();

    const admin = rig();
    open(
      admin.store,
      subjectOf(GEORGI),
      georgiContext({ viewer: { uid: 'dev-admin', roles: ['admin'] } }),
    );
    await settle();
    expect(admin.stats?.callsTo('loadClientMoney')).toEqual([
      [GEORGI_CUSTOMER_ID],
    ]);
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
      overview.loyalty?.cardLoadState === CardLoadState.Ready &&
        overview.loyalty.data.sentence,
    ).toContain('оформяне на брада');
    expect(overview.canRemove).toBe(false);
    expect(overview.actions.map((a) => a.id)).toEqual(['call', 'sms', 'viber']);
    const wallet = store.wallet();
    expect(
      wallet?.cardLoadState === CardLoadState.Ready &&
        wallet.data.actions.map((a) => a.id),
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
    expect(overview.reward?.cardLoadState).toBe(CardLoadState.Ready);
    expect(overview.canRemove).toBe(true);
    expect(overview.actions.map((a) => a.id)).toContain('same');
    const wallet = store.wallet();
    expect(
      wallet?.cardLoadState === CardLoadState.Ready &&
        wallet.data.actions.map((a) => a.id),
    ).toContain('use');
    expect(
      wallet?.cardLoadState === CardLoadState.Ready &&
        wallet.data.holdings.cardLoadState === CardLoadState.Ready &&
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
      overview.visits?.cardLoadState === CardLoadState.Ready &&
        overview.visits.data.waitlist?.id,
    ).toBe('waitlist-dev-martin');
    expect(store.achievementsContext()?.visit).toMatchObject({
      birthdayToday: true,
      locationId: 'loc-center',
    });
    expect(
      overview.medals?.cardLoadState === CardLoadState.Ready &&
        overview.medals.data.cue,
    ).toBe('Рожден ден в салона с това посещение');
  });

  it('holds the owner’s ticket out on the wallet while the visit can take it', async () => {
    const { store } = rig();
    open(store, subjectOf(MARTIN), martinContext({ grants: [GEORGI_GRANT] }));
    await settle();
    expect(store.overview().reward).toEqual({
      cardLoadState: CardLoadState.Ready,
      data: expect.objectContaining({
        grantId: 'grant-dev-georgi-punch',
        detail: 'до 28.10',
      }),
    });
    const wallet = store.wallet();
    expect(
      wallet?.cardLoadState === CardLoadState.Ready &&
        wallet.data.holdings.cardLoadState === CardLoadState.Ready &&
        wallet.data.holdings.data.filter((h) => h.kind === 'ticket'),
    ).toMatchObject([{ ticket: { grantId: 'grant-dev-georgi-punch' } }]);
    expect(
      wallet?.cardLoadState === CardLoadState.Ready &&
        wallet.data.actions.map((a) => a.id),
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
    const profiles = heldProfilePortsOf([georgiUser(pausedUntilOctober())]);
    const history = historyPortsOf(BOOK);
    const { store } = rig({ profiles, history });
    open(store, subjectOf(GEORGI), georgiOpenContext());
    await settle();
    expect(store.hero()).toMatchObject({
      name: 'Георги П.',
      line: null,
      tier: null,
    });
    const overview = store.overview();
    expect(overview.capsules).toEqual({ cardLoadState: CardLoadState.Loading });
    expect(overview.reward).toEqual({ cardLoadState: CardLoadState.Loading });
    expect(overview.visits).toEqual({ cardLoadState: CardLoadState.Loading });
    expect(overview.loyalty).toEqual({ cardLoadState: CardLoadState.Loading });
    expect(overview.medals).toEqual({ cardLoadState: CardLoadState.Loading });
    expect(overview.photos).toEqual({ cardLoadState: CardLoadState.Loading });
    expect(overview.birthday).toBeUndefined();
    expect(history.calls).toEqual([]);

    profiles.answer();
    await settle();
    const hero = store.hero();
    expect(hero.paused).toBe(true);
    expect(textOf(hero.line ?? [])).toBe(WORDS.head.pausedUntil('12.10'));
    // Paused: no ticket, no waitlist card, the wallet frozen.
    expect('reward' in store.overview()).toBe(false);
    expect(history.calls.length).toBe(1);
    const wallet = store.wallet();
    expect(
      wallet?.cardLoadState === CardLoadState.Ready && wallet.data.frozen,
    ).toBe(true);
  });

  it('fails the whole card when the profile fails, reads nothing else, and recovers on retry', async () => {
    const profiles = profilePortsOf([georgiUser()]).failWith();
    const history = historyPortsOf(BOOK);
    const loyalty = loyaltyPortsOf();
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
    expect(store.wallet()).toEqual({ cardLoadState: CardLoadState.Failed });
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
    const profiles = profilePortsOf([georgiUser()]).failWith();
    const history = historyPortsOf(BOOK);
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
    const stats = statsPortsOf([]).failWith();
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

describe('ClientCardStore — the shop’s zone (Phase 4a 4A-11)', () => {
  /** The default location's read, held until the spec answers it — or failing while `down.failing`. */
  function heldLocations(failing = false) {
    const shop = shopZonePortsOf();
    const down = { failing };
    let answer: () => void = () => undefined;
    const locations: LocationLoadPorts & DefaultLocationPorts = {
      ...shop,
      loadLocation: (id) =>
        down.failing
          ? Promise.resolve(
              CoreResult.err(CoreRepositoryError.readFailed(null, 'down')),
            )
          : failing
            ? shop.loadLocation(id)
            : new Promise((resolve) => {
                answer = () => resolve(shop.loadLocation(id));
              }),
    };
    return { locations, answer: () => answer(), down };
  }

  it('folds the default location’s zone into the gate: the seat’s snapshot, nothing said under it, until the zone is known', async () => {
    const zone = heldLocations();
    const { store } = rig({
      profiles: profilePortsOf([georgiUser(pausedUntilOctober())]),
      locations: zone.locations,
    });
    open(store, subjectOf(GEORGI), georgiOpenContext());
    await settle();
    // The profile has answered; the shop's day has not: no pause, no line.
    expect(store.hero()).toMatchObject({
      line: null,
      tier: null,
      paused: false,
    });
    expect(store.overview()).toEqual({
      actions: [],
      canRemove: false,
      failed: [],
    });
    expect(store.visits().status).toBe('loading');
    expect(store.wallet()).toEqual({ cardLoadState: CardLoadState.Loading });

    zone.answer();
    await settle();
    const hero = store.hero();
    expect(hero.paused).toBe(true);
    expect(textOf(hero.line ?? [])).toBe(WORDS.head.pausedUntil('12.10'));
    expect(store.overview().actions.length).toBeGreaterThan(0);
    expect(store.visits().status).toBe('ready');
  });

  it('fails the whole card when the zone cannot be read — nothing is judged on a day it cannot name — and its retry reads the zone again (4A-2 (e))', async () => {
    const zone = heldLocations(true);
    const { store } = rig({ locations: zone.locations });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.hero()).toMatchObject({ line: null, tier: null });
    expect(store.overview().failed).toEqual(['profile']);
    expect(store.visits().status).toBe('failed');

    zone.down.failing = false;
    store.retry('profile');
    await settle();
    expect(store.overview().failed).toEqual([]);
    expect(store.visits().status).toBe('ready');
    expect(textOf(store.hero().line ?? [])).toMatch(
      /^Клиент от март\u00a02025\u00a0г\./u,
    );
  });
});

describe('ClientCardStore — module failures', () => {
  it('fails one module under its heading, and retries it alone', async () => {
    const photos = photoPortsOf(georgiPhotos()).failWith();
    const { store, loyalty } = rig({ photos });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.overview().photos).toEqual({
      cardLoadState: CardLoadState.Failed,
    });
    expect(store.overview().failed).toEqual(['photos']);
    // The featured card still draws — without its thumbs.
    const visits = store.overview().visits;
    expect(
      visits?.cardLoadState === CardLoadState.Ready && visits.data.last?.photos,
    ).toEqual([]);

    const loyaltyReads = loyalty?.calls.length;
    photos.recover();
    store.retry('photos');
    await settle();
    expect(store.overview().failed).toEqual([]);
    expect(store.overview().photos?.cardLoadState).toBe(CardLoadState.Ready);
    expect(loyalty?.calls.length).toBe(loyaltyReads);
  });

  it('names every failed module; the page folds two or more into one notice', async () => {
    const photos = photoPortsOf(georgiPhotos()).failWith();
    const history = historyPortsOf(BOOK).failWith();
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
    const loyalty = loyaltyPortsOf().failWith();
    const { store } = rig({ loyalty });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.overview().failed).toEqual(['loyalty', 'achievements']);
    expect(store.wallet()).toEqual({ cardLoadState: CardLoadState.Failed });
    expect(store.achievementsData()).toEqual({
      cardLoadState: CardLoadState.Failed,
    });
    loyalty.recover();
    store.retry('loyalty');
    await settle();
    expect(store.overview().failed).toEqual([]);
    expect(store.achievementsData()?.cardLoadState).toBe(CardLoadState.Ready);
  });

  it('keeps the visits module when only the waitlist fails — without the card', async () => {
    const waitlist = waitlistPortsOf([martinWaitlist()]).failWith();
    const { store } = rig({ waitlist });
    open(store, subjectOf(MARTIN), martinContext());
    await settle();
    const visits = store.overview().visits;
    expect(visits?.cardLoadState).toBe(CardLoadState.Ready);
    expect(
      visits?.cardLoadState === CardLoadState.Ready && visits.data.waitlist,
    ).toBeNull();
    expect(store.overview().failed).toEqual([]);
  });

  it('settles a read that never answers as failed after ten seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const silent: AppointmentReadPorts = {
      ...memoryAppointmentReadPorts([]),
      pageClientHistory: () => new Promise(() => undefined),
    };
    const { store } = rig({ history: silent });
    open(store, subjectOf(GEORGI), georgiContext());
    await vi.advanceTimersByTimeAsync(0);
    expect(store.overview().visits).toEqual({
      cardLoadState: CardLoadState.Loading,
    });
    await vi.advanceTimersByTimeAsync(CLIENT_CARD_READ_TIMEOUT_MS);
    expect(store.overview().visits).toEqual({
      cardLoadState: CardLoadState.Failed,
    });
    expect(store.overview().failed).toEqual(['visits']);
  });
});

describe('ClientCardStore — the client record (D29, flip-3 F3-1 (a))', () => {
  /*
   * Loyalty is keyed by the client RECORD: the card resolves it once per
   * open (`customers where userId == uid`) and reads the account, the
   * families, the seasons and the journal under it. No record is no
   * loyalty (today's "no account" view); a record that could not be read
   * fails the loyalty slices, and a retry resolves the record again.
   */

  it('reads no loyalty for an account with no client record — and fails nothing', async () => {
    const customers = customerPortsOf([]);
    const loyalty = loyaltyPortsOf();
    const activity = journalPortsOf();
    const { store } = rig({ customers, loyalty, activity });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(customers.callsTo('loadCustomerForUser')).toHaveLength(1);
    const overview = store.overview();
    expect('loyalty' in overview || 'medals' in overview).toBe(false);
    expect(overview.failed).toEqual([]);
    expect(store.wallet()).toBeNull();
    expect(store.achievementsData()).toBeNull();
    expect(store.hero().tier).toBeNull();
    expect(loyalty.calls).toEqual([]);
    expect(activity.calls).toEqual([]);
  });

  it('reads no loyalty with no record port bound — an absent module, never a failure', async () => {
    const loyalty = loyaltyPortsOf();
    const { store } = rig({ customers: null, loyalty });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const overview = store.overview();
    expect('loyalty' in overview || 'medals' in overview).toBe(false);
    expect(overview.failed).toEqual([]);
    expect(store.wallet()).toBeNull();
    expect(store.achievementsData()).toBeNull();
    expect(loyalty.calls).toEqual([]);
  });

  it('fails the loyalty slices when the record cannot be read, and a retry resolves it again', async () => {
    const customers = customerPortsOf().failWith();
    const loyalty = loyaltyPortsOf();
    // Only loyalty waits on the record here: the other keyed reads are
    // unbound, so the notice is loyalty's own.
    const { store } = rig({
      customers,
      loyalty,
      stats: null,
      history: null,
      photos: null,
      vouchers: null,
      activity: null,
    });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.overview().failed).toEqual(['loyalty', 'achievements']);
    expect(store.wallet()).toEqual({ cardLoadState: CardLoadState.Failed });
    expect(store.achievementsData()).toEqual({
      cardLoadState: CardLoadState.Failed,
    });
    expect(loyalty.calls).toEqual([]);

    const recordReads = customers.callsTo('loadCustomerForUser').length;
    customers.recover();
    store.retry('loyalty');
    await settle();
    // The failed answer was never kept: the retry asks for the record again.
    expect(customers.callsTo('loadCustomerForUser').length).toBe(
      recordReads + 1,
    );
    expect(store.overview().failed).toEqual([]);
    expect(store.wallet()?.cardLoadState).toBe(CardLoadState.Ready);
    expect(store.achievementsData()?.cardLoadState).toBe(CardLoadState.Ready);
    expect(loyalty.callsTo('loadLoyaltyAccount')).toEqual([
      [GEORGI_LOYALTY.customerId],
    ]);
  });

  it('fails the wallet’s feed with the record, and reads the journal under it once it resolves', async () => {
    const customers = customerPortsOf().failWith();
    const activity = journalPortsOf();
    const { store } = rig({
      customers,
      activity,
      stats: null,
      history: null,
      photos: null,
      vouchers: null,
    });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.wallet()).toEqual({ cardLoadState: CardLoadState.Failed });
    expect(activity.calls).toEqual([]);

    customers.recover();
    store.retry('loyalty');
    store.retry('activity');
    await settle();
    expect(store.wallet()?.cardLoadState).toBe(CardLoadState.Ready);
    expect(
      activity
        .callsTo('pageClientJournal')
        .every(([customerId]) => customerId === GEORGI_LOYALTY.customerId),
    ).toBe(true);
    expect(activity.calls.length).toBeGreaterThan(0);
  });
});

describe('ClientCardStore — the catalogue', () => {
  it('fails the catalogue slice when the system refuses the answer, and never keeps it', async () => {
    // Two rewards under one id: `LoyaltyCatalogSystem.validate` refuses
    // the catalogue whole (F3-10), so nothing is shown off it.
    const published = loyaltyCatalogFixture();
    const first = must(published.rewards[0]);
    const catalog = catalogPortsOf({
      ...published,
      rewards: [...published.rewards, first],
    });
    const { store } = rig({ catalog });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.overview().failed).toEqual(['loyalty', 'achievements']);
    expect(store.achievementsData()).toEqual({
      cardLoadState: CardLoadState.Failed,
    });

    // A refused catalogue is not cached: a retry reads it again.
    store.retry('achievements');
    await settle();
    expect(catalog.callsTo('loadLoyaltyCatalog')).toHaveLength(2);
    expect(store.achievementsData()).toEqual({
      cardLoadState: CardLoadState.Failed,
    });
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
    expect(catalog?.calls).toEqual([]);
  });

  it('draws no loyalty module for a client without an account', async () => {
    const profiles = profilePortsOf([martinUser()]);
    const { store } = rig({ profiles, loyalty: loyaltyPortsOf([]) });
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

  it('reads a provisioned stub as no profile: the seat names him, and no pause or birthday is said', async () => {
    // Мартин signed in once and never registered, and the stub was paused:
    // `PROFILE_PORTS` answers it as stored, the card reads no profile —
    // the registration state decides, whatever else the stub holds.
    const stub = {
      ...stubOf(MARTIN, pausedUntilOctober()),
      firstName: 'Мартин',
      lastName: 'Илиев',
      birthDate: BirthDate.of('1992-09-28'),
    };
    const profiles = profilePortsOf([stub]);
    const { store } = rig({ profiles, loyalty: loyaltyPortsOf([]) });
    open(store, subjectOf(MARTIN), martinContext());
    await settle();
    expect(profiles.callsTo('loadProfile')).toEqual([[MARTIN]]);
    expect(store.displayName()).toBe('Мартин И.');
    expect(store.hero()).toMatchObject({ name: 'Мартин И.', paused: false });
    const overview = store.overview();
    expect(overview.failed).toEqual([]);
    expect(overview.birthday).toBeUndefined();
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
        cardLoadState: CardLoadState.Ready,
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
    expect(catalog?.callsTo('loadLoyaltyCatalog')).toHaveLength(1);
    expect(store.achievementsData()?.cardLoadState).toBe(CardLoadState.Ready);
  });
});

describe('ClientCardStore — opening again', () => {
  it('refreshes the same person without skeletons', async () => {
    const inner = historyPortsOf(BOOK);
    const held = heldHistory(inner);
    const { store } = rig({ history: held });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    held.release();
    await settle();
    expect(store.overview().visits?.cardLoadState).toBe(CardLoadState.Ready);

    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    // The second read is out; what was on screen stays.
    expect(held.calls.length).toBe(2);
    expect(store.overview().visits?.cardLoadState).toBe(CardLoadState.Ready);
    held.release();
    await settle();
    expect(store.overview().visits?.cardLoadState).toBe(CardLoadState.Ready);
  });

  it('starts over for another person, dropping the first one’s late answers', async () => {
    const inner = historyPortsOf(BOOK);
    const held = heldHistory(inner);
    const { store } = rig({ history: held });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    open(store, subjectOf(MARTIN), martinContext());
    await settle();
    expect(store.displayName()).toBe('Мартин Илиев');
    expect(store.overview().visits).toEqual({
      cardLoadState: CardLoadState.Loading,
    });
    held.release();
    await settle();
    const visits = store.overview().visits;
    expect(
      visits?.cardLoadState === CardLoadState.Ready && visits.data.last?.id,
    ).toBe('appt-hist-c2-14');
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
    const history = pagedHistory(historyPortsOf(BOOK), 10);
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
    const history = pagedHistory(historyPortsOf(BOOK), 10);
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
    const history = pagedHistory(historyPortsOf(BOOK), 3);
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
    const history = pagedHistory(historyPortsOf(BOOK), 10);
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
  return GEORGI_LOYALTY.account.balance;
}

/** Every client-visible row of Георги's journal under «Всички», as the seeded journal holds them. */
async function journalOf(): Promise<readonly JournalEntry[]> {
  const page = await journalPortsOf().pageClientJournal(
    GEORGI_CUSTOMER_ID,
    JournalFeed.effectsOf(JournalFeed.All),
    null,
    1_000,
  );
  return page.ok ? page.value.entries : [];
}

/** The pills, in the toolbar's order. */
const PILLS = [
  JournalFeed.All,
  JournalFeed.Points,
  JournalFeed.Rewards,
  JournalFeed.Status,
] as const;

/** The pill a journal read was made under, by the effects it asked for. */
function pillOf(effects: readonly JournalEffect[]): JournalFeed | undefined {
  return PILLS.find(
    (pill) => JournalFeed.effectsOf(pill).join() === [...effects].join(),
  );
}

/** The seeded journal double's reads (`journalPortsOf`, a port double). */
const journalCalls = (activity: ClientJournalPorts | null | undefined) =>
  (activity as PortDouble<ClientJournalPorts>).callsTo('pageClientJournal');

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
      cardLoadState: CardLoadState.Ready,
      data: expect.objectContaining({ grantId: 'grant-dev-georgi-punch' }),
    });
    expect(
      overview.visits?.cardLoadState === CardLoadState.Ready &&
        overview.visits.data,
    ).toMatchObject({
      count: GEORGI_STATS.lifetimeVisitsCompleted,
      waitlist: null,
    });
    expect(
      overview.visits?.cardLoadState === CardLoadState.Ready &&
        overview.visits.data.last,
    ).not.toBeNull();
    expect(
      overview.visits?.cardLoadState === CardLoadState.Ready &&
        overview.visits.data.next,
    ).not.toBeNull();
    const loyalty =
      overview.loyalty?.cardLoadState === CardLoadState.Ready
        ? overview.loyalty.data
        : null;
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
      overview.medals?.cardLoadState === CardLoadState.Ready
        ? overview.medals.data
        : null;
    expect(medals?.levelCount).toBeGreaterThan(0);
    expect(medals?.tiles.length).toBeGreaterThan(0);
    expect(medals?.tiles.length).toBeLessThanOrEqual(3);
    expect(
      overview.photos?.cardLoadState === CardLoadState.Ready &&
        overview.photos.data.map((p) => p.photoId),
    ).toEqual(['photo-dev-georgi-3']);
  });

  it('holds the wallet over its two new reads, and the ledger’s first page under «Всички»', async () => {
    const { store, vouchers, activity } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(vouchers?.callsTo('listGiftVouchersForHolder')).toEqual([
      [GEORGI_CUSTOMER_ID],
    ]);
    // Two reads of the record's journal: the wallet's feed and the ledger's
    // first page, both under «Всички».
    const all = JournalFeed.effectsOf(JournalFeed.All);
    expect(journalCalls(activity)).toEqual(
      expect.arrayContaining([
        [GEORGI_CUSTOMER_ID, all, null, WALLET_ACTIVITY_READ],
        [GEORGI_CUSTOMER_ID, all, null, LEDGER_PAGE_READ],
      ]),
    );

    const wallet = store.wallet();
    expect(wallet?.cardLoadState).toBe(CardLoadState.Ready);
    if (wallet?.cardLoadState !== CardLoadState.Ready) return;
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
    expect(wallet.data.holdings.cardLoadState).toBe(CardLoadState.Ready);
    if (wallet.data.holdings.cardLoadState === CardLoadState.Ready) {
      expect(wallet.data.holdings.data.map((h) => h.kind)).toEqual(
        expect.arrayContaining(['voucher', 'ticket', 'stamps']),
      );
      expect(
        wallet.data.holdings.data.find((h) => h.kind === 'voucher'),
      ).toMatchObject({ voucher: { voucherId: 'voucher-dev-georgi' } });
    }
    expect(wallet.data.rhythm).toMatchObject({ frozen: false });
    expect(wallet.data.rhythm?.ruleLine).not.toBe('');
    expect(wallet.data.tier?.cardLoadState).toBe(CardLoadState.Ready);
    expect(wallet.data.catalog?.cardLoadState).toBe(CardLoadState.Ready);
    expect(wallet.data.activity?.cardLoadState).toBe(CardLoadState.Ready);
    expect(
      wallet.data.activity?.cardLoadState === CardLoadState.Ready &&
        wallet.data.activity.data.length,
    ).toBeGreaterThan(0);

    const ledger = store.ledger();
    expect(ledger.cardLoadState).toBe(CardLoadState.Ready);
    expect(ledger.filter).toBe(JournalFeed.All);
    expect(textOf(ledger.subline)).toBe(
      WORDS.ledgerPage.subline(
        'Георги Петров',
        WORDS.ledgerPage.points(balance),
      ),
    );
    expect(ledger.groups.length).toBeGreaterThan(0);
    for (const group of ledger.groups)
      expect(group.key).toMatch(/^\d{4}-\d{2}$/u);
    const journal = await journalOf();
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
    expect(records?.cardLoadState).toBe(CardLoadState.Ready);
    if (records?.cardLoadState === CardLoadState.Ready) {
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
    const first = must(GEORGI_STATS.firstVisitLocalDate, 'his first visit');
    expect(visits.paging).toEqual({
      kind: 'end',
      endLabel: WORDS.history.first(dayWithYear(first, 'bg')),
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
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const before = journalCalls(activity).length;

    store.setLedgerFilter(JournalFeed.Points);
    expect(store.ledger()).toMatchObject({
      cardLoadState: CardLoadState.Loading,
      filter: JournalFeed.Points,
    });
    await settle();
    expect(journalCalls(activity).slice(before)).toEqual([
      [
        GEORGI_CUSTOMER_ID,
        JournalFeed.effectsOf(JournalFeed.Points),
        null,
        LEDGER_PAGE_READ,
      ],
    ]);
    expect(store.ledger()).toMatchObject({
      cardLoadState: CardLoadState.Ready,
      filter: JournalFeed.Points,
    });

    // The pill in force again: nothing is read.
    store.setLedgerFilter(JournalFeed.Points);
    await settle();
    expect(journalCalls(activity)).toHaveLength(before + 1);

    store.setLedgerFilter(JournalFeed.Rewards);
    await settle();
    const rewards = store.ledger();
    expect(rewards).toMatchObject({
      cardLoadState: CardLoadState.Ready,
      filter: JournalFeed.Rewards,
    });
    // The sum of what the reward rows moved is nobody's net.
    expect(rewards.groups.every((group) => group.net === null)).toBe(true);
    // The wallet's own feed is untouched by the pills.
    const wallet = store.wallet();
    expect(
      wallet?.cardLoadState === CardLoadState.Ready &&
        wallet.data.activity?.cardLoadState,
    ).toBe(CardLoadState.Ready);
  });

  it('drops an older pill’s answer when the pills change faster than the reads', async () => {
    const held = heldJournal(journalPortsOf());
    const { store } = rig({ activity: held });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.ledger().cardLoadState).toBe(CardLoadState.Loading);
    store.setLedgerFilter(JournalFeed.Points);
    store.setLedgerFilter(JournalFeed.Status);
    // Every read is on its way; they answer in the order asked.
    await settle();
    held.release();
    await settle();
    expect(store.ledger()).toMatchObject({
      cardLoadState: CardLoadState.Ready,
      filter: JournalFeed.Status,
    });
    expect(held.calls.map((call) => pillOf(call.effects))).toEqual([
      JournalFeed.All,
      JournalFeed.All,
      JournalFeed.Points,
      JournalFeed.Status,
    ]);
  });

  it('pages older rows in on «Покажи още», and ends on the journal’s oldest event', async () => {
    const paged = pagedJournal(journalPortsOf(), 3);
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
    const journal = await journalOf();
    expect(
      ledger.groups.reduce((rows, group) => rows + group.rows.length, 0),
    ).toBe(foldByEvent(journal, true).length);
    const pages = paged.calls.filter((call) => call.limit === LEDGER_PAGE_READ);
    expect(pages[0]?.beforeSeq).toBeNull();
    for (const call of pages.slice(1)) {
      expect(typeof call.beforeSeq).toBe('number');
    }
    expect(pages.length).toBe(Math.ceil(journal.length / 3));
  });

  it('keeps a failed page’s rows, says so in the foot, and retries the page', async () => {
    const paged = pagedJournal(journalPortsOf(), 3);
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
    const activity = journalPortsOf().failWith();
    const { store } = rig({ activity });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const wallet = store.wallet();
    expect(
      wallet?.cardLoadState === CardLoadState.Ready &&
        wallet.data.activity?.cardLoadState,
    ).toBe(CardLoadState.Failed);
    expect(store.ledger().cardLoadState).toBe(CardLoadState.Failed);
    expect(store.overview().failed).toEqual([]);

    activity.recover();
    store.retry('activity');
    await settle();
    const after = store.wallet();
    expect(
      after?.cardLoadState === CardLoadState.Ready &&
        after.data.activity?.cardLoadState,
    ).toBe(CardLoadState.Ready);
    expect(store.ledger().cardLoadState).toBe(CardLoadState.Ready);
  });
});

describe('ClientCardStore — revision 3: the vouchers', () => {
  it('fails the holdings alone, keeps the glance’s card without the voucher, and retries the vouchers', async () => {
    const vouchers = voucherPortsOf().failWith();
    const { store } = rig({ vouchers });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const wallet = store.wallet();
    expect(
      wallet?.cardLoadState === CardLoadState.Ready &&
        wallet.data.holdings.cardLoadState,
    ).toBe(CardLoadState.Failed);
    const loyalty = store.overview().loyalty;
    expect(loyalty?.cardLoadState).toBe(CardLoadState.Ready);
    expect(
      loyalty?.cardLoadState === CardLoadState.Ready &&
        loyalty.data.holdings.map((h) => h.id),
    ).toEqual(['stamps', 'rhythm']);
    expect(store.overview().failed).toEqual([]);

    vouchers.recover();
    store.retry('vouchers');
    await settle();
    expect(vouchers.calls).toHaveLength(2);
    const after = store.wallet();
    expect(
      after?.cardLoadState === CardLoadState.Ready &&
        after.data.holdings.cardLoadState,
    ).toBe(CardLoadState.Ready);
    const glance = store.overview().loyalty;
    expect(
      glance?.cardLoadState === CardLoadState.Ready &&
        glance.data.holdings.map((h) => h.id),
    ).toEqual(['voucher', 'stamps', 'rhythm']);
  });

  it('treats the two unbound readers as absent sections, never failures', async () => {
    const { store } = rig({ vouchers: null, activity: null });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const wallet = store.wallet();
    expect(wallet?.cardLoadState).toBe(CardLoadState.Ready);
    if (wallet?.cardLoadState !== CardLoadState.Ready) return;
    expect(wallet.data.holdings.cardLoadState).toBe(CardLoadState.Ready);
    if (wallet.data.holdings.cardLoadState === CardLoadState.Ready) {
      expect(wallet.data.holdings.data.map((h) => h.kind)).not.toContain(
        'voucher',
      );
    }
    expect('activity' in wallet.data).toBe(false);
    expect(wallet.data.actions.map((a) => a.id)).toContain('use');
    // Without a feed the ledger page is unreachable: it reads as failed, as a list without its reader does.
    expect(store.ledger().cardLoadState).toBe(CardLoadState.Failed);
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
      cardLoadState: CardLoadState.Ready,
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
      wallet?.cardLoadState === CardLoadState.Ready &&
        wallet.data.actions.map((a) => a.id),
    ).not.toContain('code');
  });
});

describe('ClientCardStore — revision 3: a paused client', () => {
  it('rings the face with the warning, freezes the pass, and offers no verb', async () => {
    const profiles = profilePortsOf([georgiUser(pausedUntilOctober())]);
    const { store } = rig({ profiles });
    open(store, subjectOf(GEORGI), georgiOpenContext());
    await settle();
    const hero = store.hero();
    expect(hero.paused).toBe(true);
    expect(textOf(hero.line ?? [])).toBe(WORDS.head.pausedUntil('12.10'));
    const wallet = store.wallet();
    expect(wallet?.cardLoadState).toBe(CardLoadState.Ready);
    if (wallet?.cardLoadState === CardLoadState.Ready) {
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
    expect(store.ledger().cardLoadState).toBe(CardLoadState.Loading);
    expect(store.loadedVisits()).toEqual([]);
    expect(store.historyComplete()).toBe(false);
    expect(store.visitRowsInput()).toBeNull();
    expect(vouchers?.calls).toEqual([]);
    expect(journalCalls(activity)).toEqual([]);
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
    expect(off.store.ledger().cardLoadState).toBe(CardLoadState.Failed);
    expect(off.vouchers?.calls).toEqual([]);
    expect(journalCalls(off.activity)).toEqual([]);
    TestBed.resetTestingModule();

    const noPoints = rig({ flags: { ...ALL_FLAGS, 'loyalty.points': false } });
    open(noPoints.store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(noPoints.vouchers?.calls).toHaveLength(1);
    expect(journalCalls(noPoints.activity)).toEqual([]);
    const wallet = noPoints.store.wallet();
    expect(wallet?.cardLoadState).toBe(CardLoadState.Ready);
    if (wallet?.cardLoadState === CardLoadState.Ready) {
      expect('activity' in wallet.data).toBe(false);
      expect('catalog' in wallet.data).toBe(false);
      expect(wallet.data.actions.map((a) => a.id)).not.toContain('history');
    }
    expect(noPoints.store.ledger().cardLoadState).toBe(CardLoadState.Failed);
    // The glance's card leads with the first holding as its figure.
    const loyalty = noPoints.store.overview().loyalty;
    expect(
      loyalty?.cardLoadState === CardLoadState.Ready && loyalty.data,
    ).toMatchObject({
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
