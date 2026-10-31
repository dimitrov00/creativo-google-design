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
  AccountLifecycle,
  BirthDate,
  ClientPrivacyCall,
  CouponOccasion,
  CustomerOrigin,
  ErasureCensus,
  ErasureLifecycle,
  ErasureStatus,
  JournalEffect,
  JournalFeed,
  Role,
  type RolesCall,
  VisitFilter,
} from '@core/components';
import type { Appointment, Customer, JournalEntry } from '@core/entities';
import type {
  AppointmentPhotoPorts,
  AppointmentReadPorts,
  AvatarPorts,
  ClientJournalPorts,
  ClientPrivacyGatewayPorts,
  DefaultLocationPorts,
  LocationLoadPorts,
  ClientStatsReadPorts,
  CouponVoucherPorts,
  CustomerReadPorts,
  EraseClient,
  IdPorts,
  JournalPage,
  LoyaltyAccountReadPorts,
  LoyaltyCatalogReadPorts,
  PreviewClientErasure,
  ProfilePorts,
  RolesAdminPorts,
  WaitlistReadPorts,
} from '@core/ports';
import {
  AppointmentId,
  BadgeSeriesId,
  ClientOperationId,
  CustomerId,
  DraftPersonKey,
  Result as CoreResult,
  UserId,
} from '@core/primitives';
import {
  GovernanceErrorCode,
  PipelineError,
  PipelineErrorCode,
  RepositoryError as CoreRepositoryError,
} from '@core/errors';
import { MAX_ERASURE_CALLS } from '@core/pipelines';
import {
  loyaltyCatalogFixture,
  memoryAppointmentReadPorts,
  unwrapOk,
} from '@core/testing';
import {
  APPOINTMENT_PHOTO_PORTS,
  APPOINTMENT_READ_PORTS,
  AVATAR_PORTS,
  CLIENT_JOURNAL_PORTS,
  CLIENT_PRIVACY_PORTS,
  CLIENT_STATS_READ_PORTS,
  COUPON_VOUCHER_PORTS,
  CUSTOMER_PORTS,
  ID_PORTS,
  LOYALTY_ACCOUNT_READ_PORTS,
  LOYALTY_CATALOG_READ_PORTS,
  PROFILE_PORTS,
  ROLES_ADMIN_PORTS,
  WAITLIST_READ_PORTS,
  provideFlags,
} from '@creativo/infrastructure/firebase-app';
import {
  type ClientCardContext,
  ClientCardPage,
  type ClientCardSubject,
} from './client-card.contracts';
import { dayWithYear } from './client-card.format';
import {
  CLIENT_CARD_READ_TIMEOUT_MS,
  ClientCardStore,
} from './client-card.store';
import { LEDGER_PAGE_READ } from './ledger.presenter';
import { WALLET_ACTIVITY_READ } from './wallet.presenter';
import {
  ADMIN_VIEWER,
  GEORGI,
  GEORGI_CUSTOMER_ID,
  GEORGI_GRANT,
  GEORGI_LOYALTY,
  GEORGI_MONEY,
  GEORGI_PREVIOUS_MS,
  GUEST,
  MARTIN,
  NBSP_EURO,
  NOW,
  NOW_MS,
  type PortDouble,
  avatarPortsOf,
  catalogPortsOf,
  catalogueOf,
  customerPortsOf,
  fixtureCustomers,
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
  portDouble,
  profilePortsOf,
  rolesAdminPortsOf,
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
import { LoadState, PagingState } from '@creativo/shared/view-state';
import { BirthdayMoment, WalletHolding } from './client-pages.vm';
import { LedgerSystem } from '@core/systems';

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
  readonly customers?: CustomerReadPorts | null;
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

/** A walk-in the desk entered: a client RECORD with no account (S-WS-F). */
const WALK_IN_ID = CustomerId.of('cus_7070707070707070707a');

function walkInRecord(
  lifecycle: ErasureLifecycle = ErasureLifecycle.none(),
): Customer {
  const [georgi] = fixtureCustomers();
  return {
    ...must(georgi, 'a fixture record'),
    id: WALK_IN_ID,
    userId: null,
    displayName: 'Иво Иванов',
    customerOrigin: CustomerOrigin.StaffWalkIn,
    ...lifecycle,
  };
}

/** The walk-in's seat as the search or a stored WALK_IN seat hands it over: its record id beside the guest key. */
const WALK_IN: ClientCardSubject = {
  ...GUEST,
  id: DraftPersonKey.of(`guest-${WALK_IN_ID}`),
  customerId: WALK_IN_ID,
};

describe('ClientCardStore — a guest', () => {
  it('a TYPED guest reads nothing, and draws the hero, the phone and the exit', async () => {
    const history = historyPortsOf(BOOK);
    const profiles = profilePortsOf([]);
    const loyalty = loyaltyPortsOf();
    const photos = photoPortsOf(georgiPhotos());
    const customers = customerPortsOf();
    const { store } = rig({ history, profiles, loyalty, photos, customers });
    open(
      store,
      GUEST,
      martinContext({
        isOwner: false,
        appointmentId: AppointmentId.of('appt-walk-in'),
      }),
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
    expect(customers.calls).toEqual([]);
    expect(store.customerId()).toBeNull();
    expect(store.wallet()).toBeNull();
    expect(store.achievementsData()).toBeNull();
    expect(store.displayName()).toBe('Иво');
  });

  it('a typed label shaped like a record id stays a typed guest — the id is never parsed from the key (S-RU-15)', async () => {
    const customers = customerPortsOf([...fixtureCustomers(), walkInRecord()]);
    const { store } = rig({ customers });
    open(
      store,
      { ...GUEST, id: DraftPersonKey.of(`guest-${WALK_IN_ID}`) },
      martinContext({ isOwner: false }),
    );
    await settle();
    expect(customers.calls).toEqual([]);
    expect(store.customerId()).toBeNull();
  });

  it('a walk-in RECORD is known at once and reads its record alone — no profile, loyalty, history, photos, waitlist or picture (S-WS-F)', async () => {
    const history = historyPortsOf(BOOK);
    const profiles = profilePortsOf([]);
    const loyalty = loyaltyPortsOf();
    const photos = photoPortsOf(georgiPhotos());
    const waitlist = waitlistPortsOf([martinWaitlist()]);
    const avatars = portDouble(avatarPortsOf());
    const customers = customerPortsOf([...fixtureCustomers(), walkInRecord()]);
    const { store } = rig({
      history,
      profiles,
      loyalty,
      photos,
      waitlist,
      avatars,
      customers,
    });
    open(store, WALK_IN, martinContext({ isOwner: false }));
    // Set at once, before any read answers: the privacy block is decidable.
    expect(store.customerId()).toBe(WALK_IN_ID);
    await settle();
    expect(customers.calls).toEqual([
      { method: 'loadCustomer', args: [WALK_IN_ID] },
    ]);
    expect(profiles.calls).toEqual([]);
    expect(loyalty.calls).toEqual([]);
    expect(photos.calls).toEqual([]);
    expect(history.calls).toEqual([]);
    expect(waitlist.calls).toEqual([]);
    expect(avatars.calls).toEqual([]);
    // The head stays the seat's (S-L-19).
    expect(store.hero()).toMatchObject({ name: 'Иво', paused: false });
    expect(store.displayName()).toBe('Иво');
    expect(store.wallet()).toBeNull();
    // Opening the same walk-in again reads the record no second time.
    open(store, WALK_IN, martinContext({ isOwner: false }));
    await settle();
    expect(customers.callsTo('loadCustomer')).toHaveLength(1);
  });
});

describe('ClientCardStore — Георги, settled', () => {
  it('gives the editor’s photo page the face the hero shows', async () => {
    const { store } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.avatarSrc()).toBe('https://example.test/avatars/georgi.jpg');
    expect(store.avatarSrc()).toBe(store.hero().avatarSrc);
  });

  it('keeps F1’s sentence through «Използвай» and «Премахни»: a grant on the draft bill is still in hand (wave D r6)', async () => {
    const { store } = rig();
    const sentence = () => {
      const loyalty = store.overview().loyalty;
      return loyalty?.loadState === LoadState.Ready
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
      data?.loadState === LoadState.Ready && data.data.previousVisitUtcMs,
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
    expect(store.barTitle(ClientCardPage.Client, GEORGI)).toBe('Георги Петров');
    expect(store.barTitle(ClientCardPage.ClientLoyalty, GEORGI)).toBe(
      'Лоялност',
    );
    expect(store.barTitle(ClientCardPage.ClientAchievements, GEORGI)).toBe(
      'Постижения',
    );
    expect(store.barTitle(ClientCardPage.ClientHistory, GEORGI)).toBe(
      'Посещения',
    );
    expect(
      store.barTitle(
        ClientCardPage.AchievementCategory,
        'category:cat-mastery',
      ),
    ).toBe('Майсторство');
    expect(
      store.barTitle(
        ClientCardPage.AchievementCategory,
        'season:season-2026-autumn',
      ),
    ).toBe('Есен 2026');
    expect(store.barTitle(ClientCardPage.AchievementCategory, 'archive')).toBe(
      'Минали сезони и събития',
    );
    expect(
      store.barTitle(ClientCardPage.AchievementCategory, 'day:2026-09-04'),
    ).toBe('Спечелени на 4.09');
    expect(
      store.barTitle(ClientCardPage.AchievementCategory, 'shelf:x'),
    ).toBeNull();
    expect(
      store.barTitle(ClientCardPage.AchievementDetail, 'series-svc-fade'),
    ).toBe('Фейд');
    expect(store.barTitle(ClientCardPage.Photo, 'photo-dev-georgi-2')).toBe(
      '3.09',
    );
    expect(store.photoById('photo-dev-georgi-1')).toMatchObject({
      appointmentId: 'appt-dev-1',
      dateLabel: '28.09',
      accessibleName: 'Снимка от 28 септември',
      barberId: 'ivan',
    });
    expect(store.photoById('photo-gone')).toBeNull();
    // The editor's past-cut page takes the photo AS STORED, under the same
    // readiness as `photoById`.
    expect(store.storedPhotoById('photo-dev-georgi-1')).toMatchObject({
      id: 'photo-dev-georgi-1',
      appointmentId: 'appt-dev-1',
      barberId: 'ivan',
    });
    expect(store.storedPhotoById('photo-gone')).toBeNull();
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
      georgiContext({
        viewer: { userId: UserId.of('dev-admin'), roles: ['admin'] },
      }),
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
      overview.loyalty?.loadState === LoadState.Ready &&
        overview.loyalty.data.sentence,
    ).toContain('оформяне на брада');
    expect(overview.canRemove).toBe(false);
    expect(overview.actions.map((a) => a.id)).toEqual(['call', 'sms', 'viber']);
    const wallet = store.wallet();
    expect(
      wallet?.loadState === LoadState.Ready &&
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
    expect(overview.reward?.loadState).toBe(LoadState.Ready);
    expect(overview.canRemove).toBe(true);
    expect(overview.actions.map((a) => a.id)).toContain('same');
    const wallet = store.wallet();
    expect(
      wallet?.loadState === LoadState.Ready &&
        wallet.data.actions.map((a) => a.id),
    ).toContain('use');
    expect(
      wallet?.loadState === LoadState.Ready &&
        wallet.data.holdings.loadState === LoadState.Ready &&
        wallet.data.holdings.data.map((h) => h.walletHolding),
    ).toContain(WalletHolding.Ticket);
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
    expect(overview.birthday?.birthdayMoment).toBe(BirthdayMoment.Today);
    expect(
      overview.visits?.loadState === LoadState.Ready &&
        overview.visits.data.waitlist?.id,
    ).toBe('waitlist-dev-martin');
    expect(store.achievementsContext()?.visit).toMatchObject({
      birthdayToday: true,
      locationId: 'loc-center',
    });
    expect(
      overview.medals?.loadState === LoadState.Ready &&
        overview.medals.data.cue,
    ).toBe('Рожден ден в салона с това посещение');
  });

  it('holds the owner’s ticket out on the wallet while the visit can take it', async () => {
    const { store } = rig();
    open(store, subjectOf(MARTIN), martinContext({ grants: [GEORGI_GRANT] }));
    await settle();
    expect(store.overview().reward).toEqual({
      loadState: LoadState.Ready,
      data: expect.objectContaining({
        grantId: 'grant-dev-georgi-punch',
        detail: 'до 28.10',
      }),
    });
    const wallet = store.wallet();
    expect(
      wallet?.loadState === LoadState.Ready &&
        wallet.data.holdings.loadState === LoadState.Ready &&
        wallet.data.holdings.data.filter(
          (h) => h.walletHolding === WalletHolding.Ticket,
        ),
    ).toMatchObject([{ ticket: { grantId: 'grant-dev-georgi-punch' } }]);
    expect(
      wallet?.loadState === LoadState.Ready &&
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
    expect(overview.capsules).toEqual({ loadState: LoadState.Loading });
    expect(overview.reward).toEqual({ loadState: LoadState.Loading });
    expect(overview.visits).toEqual({ loadState: LoadState.Loading });
    expect(overview.loyalty).toEqual({ loadState: LoadState.Loading });
    expect(overview.medals).toEqual({ loadState: LoadState.Loading });
    expect(overview.photos).toEqual({ loadState: LoadState.Loading });
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
    expect(wallet?.loadState === LoadState.Ready && wallet.data.frozen).toBe(
      true,
    );
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
    expect(store.wallet()).toEqual({ loadState: LoadState.Failed });
    expect(store.visits().loadState).toBe(LoadState.Failed);

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
    expect(store.visits().loadState).toBe(LoadState.Failed);
    profiles.recover();
    store.retry('history');
    await settle();
    expect(store.overview().failed).toEqual([]);
    expect(store.visits().loadState).toBe(LoadState.Ready);
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
    expect(store.visits().loadState).toBe(LoadState.Loading);
    expect(store.wallet()).toEqual({ loadState: LoadState.Loading });

    zone.answer();
    await settle();
    const hero = store.hero();
    expect(hero.paused).toBe(true);
    expect(textOf(hero.line ?? [])).toBe(WORDS.head.pausedUntil('12.10'));
    expect(store.overview().actions.length).toBeGreaterThan(0);
    expect(store.visits().loadState).toBe(LoadState.Ready);
  });

  it('keeps «Посещения» LOADING, never FAILED, while the default zone is pending — its rows wait for "now" (R-1)', async () => {
    const zone = heldLocations();
    const { store } = rig({ locations: zone.locations });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    // The rows' input stands; its shop-clock "now" does not yet: no row is
    // worded on a day the card cannot name, and the page is not failed.
    expect(store.visitRowsInput()).toMatchObject({ now: null, timeZone: null });
    expect(store.visits().loadState).toBe(LoadState.Loading);
    expect(store.visits().sections).toEqual([]);

    zone.answer();
    await settle();
    expect(store.visitRowsInput()?.now).toEqual(NOW);
    expect(store.visits().loadState).toBe(LoadState.Ready);
    expect(store.visits().sections.length).toBeGreaterThan(0);
  });

  it('fails the whole card when the zone cannot be read — nothing is judged on a day it cannot name — and its retry reads the zone again (4A-2 (e))', async () => {
    const zone = heldLocations(true);
    const { store } = rig({ locations: zone.locations });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.hero()).toMatchObject({ line: null, tier: null });
    expect(store.overview().failed).toEqual(['profile']);
    expect(store.visits().loadState).toBe(LoadState.Failed);

    zone.down.failing = false;
    store.retry('profile');
    await settle();
    expect(store.overview().failed).toEqual([]);
    expect(store.visits().loadState).toBe(LoadState.Ready);
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
      loadState: LoadState.Failed,
    });
    expect(store.overview().failed).toEqual(['photos']);
    // The featured card still draws — without its thumbs.
    const visits = store.overview().visits;
    expect(
      visits?.loadState === LoadState.Ready && visits.data.last?.photos,
    ).toEqual([]);

    const loyaltyReads = loyalty?.calls.length;
    photos.recover();
    store.retry('photos');
    await settle();
    expect(store.overview().failed).toEqual([]);
    expect(store.overview().photos?.loadState).toBe(LoadState.Ready);
    expect(loyalty?.calls.length).toBe(loyaltyReads);
  });

  it('names every failed module; the page folds two or more into one notice', async () => {
    const photos = photoPortsOf(georgiPhotos()).failWith();
    const history = historyPortsOf(BOOK).failWith();
    const { store } = rig({ photos, history });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.overview().failed).toEqual(['visits', 'photos']);
    expect(store.visits().loadState).toBe(LoadState.Failed);
    history.recover();
    store.retry('visits');
    await settle();
    expect(store.overview().failed).toEqual(['photos']);
    expect(store.visits().loadState).toBe(LoadState.Ready);
  });

  it('fails loyalty and achievements together when the account cannot be read, and retries them', async () => {
    const loyalty = loyaltyPortsOf().failWith();
    const { store } = rig({ loyalty });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.overview().failed).toEqual(['loyalty', 'achievements']);
    expect(store.wallet()).toEqual({ loadState: LoadState.Failed });
    expect(store.achievementsData()).toEqual({
      loadState: LoadState.Failed,
    });
    loyalty.recover();
    store.retry('loyalty');
    await settle();
    expect(store.overview().failed).toEqual([]);
    expect(store.achievementsData()?.loadState).toBe(LoadState.Ready);
  });

  it('keeps the visits module when only the waitlist fails — without the card', async () => {
    const waitlist = waitlistPortsOf([martinWaitlist()]).failWith();
    const { store } = rig({ waitlist });
    open(store, subjectOf(MARTIN), martinContext());
    await settle();
    const visits = store.overview().visits;
    expect(visits?.loadState).toBe(LoadState.Ready);
    expect(
      visits?.loadState === LoadState.Ready && visits.data.waitlist,
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
      loadState: LoadState.Loading,
    });
    await vi.advanceTimersByTimeAsync(CLIENT_CARD_READ_TIMEOUT_MS);
    expect(store.overview().visits).toEqual({
      loadState: LoadState.Failed,
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
    expect(store.wallet()).toEqual({ loadState: LoadState.Failed });
    expect(store.achievementsData()).toEqual({
      loadState: LoadState.Failed,
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
    expect(store.wallet()?.loadState).toBe(LoadState.Ready);
    expect(store.achievementsData()?.loadState).toBe(LoadState.Ready);
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
    expect(store.wallet()).toEqual({ loadState: LoadState.Failed });
    expect(activity.calls).toEqual([]);

    customers.recover();
    store.retry('loyalty');
    store.retry('activity');
    await settle();
    expect(store.wallet()?.loadState).toBe(LoadState.Ready);
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
      loadState: LoadState.Failed,
    });

    // A refused catalogue is not cached: a retry reads it again.
    store.retry('achievements');
    await settle();
    expect(catalog.callsTo('loadLoyaltyCatalog')).toHaveLength(2);
    expect(store.achievementsData()).toEqual({
      loadState: LoadState.Failed,
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
    expect(overview.birthday?.birthdayMoment).toBe(BirthdayMoment.Today);
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
        loadState: LoadState.Ready,
        data: expect.objectContaining({ grantId: 'grant-dev-georgi-punch' }),
      },
    });
    expect(store.visits().loadState).toBe(LoadState.Failed);
  });

  it('reads the loyalty catalogue once for the store’s life', async () => {
    const { store, catalog } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    open(store, subjectOf(MARTIN), martinContext());
    await settle();
    expect(catalog?.callsTo('loadLoyaltyCatalog')).toHaveLength(1);
    expect(store.achievementsData()?.loadState).toBe(LoadState.Ready);
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
    expect(store.overview().visits?.loadState).toBe(LoadState.Ready);

    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    // The second read is out; what was on screen stays.
    expect(held.calls.length).toBe(2);
    expect(store.overview().visits?.loadState).toBe(LoadState.Ready);
    held.release();
    await settle();
    expect(store.overview().visits?.loadState).toBe(LoadState.Ready);
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
      loadState: LoadState.Loading,
    });
    held.release();
    await settle();
    const visits = store.overview().visits;
    expect(visits?.loadState === LoadState.Ready && visits.data.last?.id).toBe(
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
    const history = pagedHistory(historyPortsOf(BOOK), 10);
    const { store } = rig({ history });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.visits().paging).toMatchObject({
      pagingState: PagingState.More,
    });
    expect(rowsOf(store)).toHaveLength(10);

    store.loadMoreHistory();
    expect(store.visits().paging).toMatchObject({
      pagingState: PagingState.Loading,
    });
    await settle();
    expect(rowsOf(store)).toHaveLength(20);
    store.loadMoreHistory();
    await settle();
    expect(rowsOf(store)).toHaveLength(25);
    expect(store.visits().paging?.pagingState).toBe(PagingState.End);
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
    expect(store.visits().paging).toMatchObject({
      pagingState: PagingState.Failed,
    });
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
    store.setHistoryFilter(VisitFilter.Cancelled);
    expect(store.visits().filter).toBe(VisitFilter.Cancelled);
    await settle();
    expect(history.calls).toHaveLength(4);
    expect(rowsOf(store).map((r) => r.id)).toEqual(['appt-hist-c2-11']);
    store.setHistoryFilter(VisitFilter.All);
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
    expect(store.barTitle(ClientCardPage.ClientLoyalty, GEORGI)).toBe(
      'Loyalty',
    );
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
      loadState: LoadState.Ready,
      data: expect.objectContaining({ grantId: 'grant-dev-georgi-punch' }),
    });
    expect(
      overview.visits?.loadState === LoadState.Ready && overview.visits.data,
    ).toMatchObject({
      count: GEORGI_STATS.lifetimeVisitsCompleted,
      waitlist: null,
    });
    expect(
      overview.visits?.loadState === LoadState.Ready &&
        overview.visits.data.last,
    ).not.toBeNull();
    expect(
      overview.visits?.loadState === LoadState.Ready &&
        overview.visits.data.next,
    ).not.toBeNull();
    const loyalty =
      overview.loyalty?.loadState === LoadState.Ready
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
      overview.medals?.loadState === LoadState.Ready
        ? overview.medals.data
        : null;
    expect(medals?.levelCount).toBeGreaterThan(0);
    expect(medals?.tiles.length).toBeGreaterThan(0);
    expect(medals?.tiles.length).toBeLessThanOrEqual(3);
    expect(
      overview.photos?.loadState === LoadState.Ready &&
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
    expect(wallet?.loadState).toBe(LoadState.Ready);
    if (wallet?.loadState !== LoadState.Ready) return;
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
    expect(wallet.data.holdings.loadState).toBe(LoadState.Ready);
    if (wallet.data.holdings.loadState === LoadState.Ready) {
      expect(wallet.data.holdings.data.map((h) => h.walletHolding)).toEqual(
        expect.arrayContaining([
          WalletHolding.Voucher,
          WalletHolding.Ticket,
          WalletHolding.Stamps,
        ]),
      );
      expect(
        wallet.data.holdings.data.find(
          (h) => h.walletHolding === WalletHolding.Voucher,
        ),
      ).toMatchObject({ voucher: { voucherId: 'voucher-dev-georgi' } });
    }
    expect(wallet.data.rhythm).toMatchObject({ frozen: false });
    expect(wallet.data.rhythm?.ruleLine).not.toBe('');
    expect(wallet.data.tier?.loadState).toBe(LoadState.Ready);
    expect(wallet.data.catalog?.loadState).toBe(LoadState.Ready);
    expect(wallet.data.activity?.loadState).toBe(LoadState.Ready);
    expect(
      wallet.data.activity?.loadState === LoadState.Ready &&
        wallet.data.activity.data.length,
    ).toBeGreaterThan(0);

    const ledger = store.ledger();
    expect(ledger.loadState).toBe(LoadState.Ready);
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
      pagingState:
        journal.length > LEDGER_PAGE_READ ? PagingState.More : PagingState.End,
    });
    expect(store.medalsChip()).toBe('all');
  });

  it('words «Рекорди» and «Посещения», knows the history whole, and titles the two new pages', async () => {
    const { store } = rig();
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const records = store.records();
    expect(records?.loadState).toBe(LoadState.Ready);
    if (records?.loadState === LoadState.Ready) {
      expect(records.data.subline).toBe('Георги Петров');
      expect(records.data.groups.length).toBeGreaterThan(0);
    }
    expect(store.rhythmRule()).toMatchObject({ enabled: true });

    const visits = store.visits();
    expect(visits.loadState).toBe(LoadState.Ready);
    expect(visits.line.length).toBeGreaterThan(0);
    const keys = visits.sections.map((section) => section.key);
    expect(keys[0]).toBe('upcoming');
    for (const key of keys.slice(1)) expect(key).toMatch(/^\d{4}-\d{2}$/u);
    expect(visits.offeredFilters).toContain(VisitFilter.All);
    // The whole book is one page: the foot names the first visit's day.
    const first = must(GEORGI_STATS.firstVisitLocalDate, 'his first visit');
    expect(visits.paging).toEqual({
      pagingState: PagingState.End,
      endLabel: WORDS.history.first(dayWithYear(first, 'bg')),
    });
    expect(store.loadedVisits()).toHaveLength(georgiHistory().length);
    expect(store.historyComplete()).toBe(true);
    expect(store.visitRowsInput()).toMatchObject({
      subjectUserId: GEORGI,
      currentAppointmentId: 'appt-dev-1',
    });

    expect(store.barTitle(ClientCardPage.ClientLedger, GEORGI)).toBe(
      'Движение',
    );
    expect(store.barTitle(ClientCardPage.ClientRecords, GEORGI)).toBe(
      'Рекорди',
    );
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
      loadState: LoadState.Loading,
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
      loadState: LoadState.Ready,
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
      loadState: LoadState.Ready,
      filter: JournalFeed.Rewards,
    });
    // The sum of what the reward rows moved is nobody's net.
    expect(rewards.groups.every((group) => group.net === null)).toBe(true);
    // The wallet's own feed is untouched by the pills.
    const wallet = store.wallet();
    expect(
      wallet?.loadState === LoadState.Ready && wallet.data.activity?.loadState,
    ).toBe(LoadState.Ready);
  });

  it('drops an older pill’s answer when the pills change faster than the reads', async () => {
    const held = heldJournal(journalPortsOf());
    const { store } = rig({ activity: held });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(store.ledger().loadState).toBe(LoadState.Loading);
    store.setLedgerFilter(JournalFeed.Points);
    store.setLedgerFilter(JournalFeed.Status);
    // Every read is on its way; they answer in the order asked.
    await settle();
    held.release();
    await settle();
    expect(store.ledger()).toMatchObject({
      loadState: LoadState.Ready,
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
    expect(store.ledger().paging).toEqual({ pagingState: PagingState.More });
    for (
      let page = 0;
      page < 20 && store.ledger().paging?.pagingState === PagingState.More;
      page += 1
    ) {
      store.loadMoreLedger();
      expect(store.ledger().paging).toEqual({
        pagingState: PagingState.Loading,
      });
      await settle();
    }
    const ledger = store.ledger();
    expect(ledger.paging).toEqual({ pagingState: PagingState.End });
    const journal = await journalOf();
    expect(
      ledger.groups.reduce((rows, group) => rows + group.rows.length, 0),
    ).toBe(LedgerSystem.fold(journal, true).length);
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
    expect(store.ledger().paging).toEqual({
      pagingState: PagingState.Failed,
    });
    expect(store.ledger().groups.flatMap((group) => group.rows)).toEqual(rows);
    store.retry('activity');
    await settle();
    expect([PagingState.More, PagingState.End]).toContain(
      store.ledger().paging?.pagingState,
    );
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
      wallet?.loadState === LoadState.Ready && wallet.data.activity?.loadState,
    ).toBe(LoadState.Failed);
    expect(store.ledger().loadState).toBe(LoadState.Failed);
    expect(store.overview().failed).toEqual([]);

    activity.recover();
    store.retry('activity');
    await settle();
    const after = store.wallet();
    expect(
      after?.loadState === LoadState.Ready && after.data.activity?.loadState,
    ).toBe(LoadState.Ready);
    expect(store.ledger().loadState).toBe(LoadState.Ready);
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
      wallet?.loadState === LoadState.Ready && wallet.data.holdings.loadState,
    ).toBe(LoadState.Failed);
    const loyalty = store.overview().loyalty;
    expect(loyalty?.loadState).toBe(LoadState.Ready);
    expect(
      loyalty?.loadState === LoadState.Ready &&
        loyalty.data.holdings.map((h) => h.id),
    ).toEqual(['stamps', 'rhythm']);
    expect(store.overview().failed).toEqual([]);

    vouchers.recover();
    store.retry('vouchers');
    await settle();
    expect(vouchers.calls).toHaveLength(2);
    const after = store.wallet();
    expect(
      after?.loadState === LoadState.Ready && after.data.holdings.loadState,
    ).toBe(LoadState.Ready);
    const glance = store.overview().loyalty;
    expect(
      glance?.loadState === LoadState.Ready &&
        glance.data.holdings.map((h) => h.id),
    ).toEqual(['voucher', 'stamps', 'rhythm']);
  });

  it('treats the two unbound readers as absent sections, never failures', async () => {
    const { store } = rig({ vouchers: null, activity: null });
    open(store, subjectOf(GEORGI), georgiContext());
    await settle();
    const wallet = store.wallet();
    expect(wallet?.loadState).toBe(LoadState.Ready);
    if (wallet?.loadState !== LoadState.Ready) return;
    expect(wallet.data.holdings.loadState).toBe(LoadState.Ready);
    if (wallet.data.holdings.loadState === LoadState.Ready) {
      expect(
        wallet.data.holdings.data.map((h) => h.walletHolding),
      ).not.toContain(WalletHolding.Voucher);
    }
    expect('activity' in wallet.data).toBe(false);
    expect(wallet.data.actions.map((a) => a.id)).toContain('use');
    // Without a feed the ledger page is unreachable: it reads as failed, as a list without its reader does.
    expect(store.ledger().loadState).toBe(LoadState.Failed);
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
      birthdayMoment: BirthdayMoment.Today,
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
      loadState: LoadState.Ready,
      data: expect.objectContaining({ grantId: 'grant-dev-georgi-punch' }),
    });
    TestBed.resetTestingModule();

    const gifted = rig();
    open(
      gifted.store,
      subjectOf(MARTIN),
      martinContext({
        grants: [{ ...GEORGI_GRANT, couponOccasion: CouponOccasion.Birthday }],
      }),
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
    expect(
      store.detailAction(BadgeSeriesId.of('series-svc-fade')),
    ).toMatchObject({
      serviceId: 'svc-fade',
    });
    expect(store.detailAction(BadgeSeriesId.of('series-nope'))).toBeNull();

    window.dispatchEvent(new Event('offline'));
    expect(store.detailAction(BadgeSeriesId.of('series-svc-fade'))).toBeNull();
    window.dispatchEvent(new Event('online'));
    expect(
      store.detailAction(BadgeSeriesId.of('series-svc-fade')),
    ).not.toBeNull();

    // The service already on his seat: nothing to add.
    expect(
      store.detailAction(BadgeSeriesId.of('series-svc-classic-cut')),
    ).toBeNull();
    TestBed.resetTestingModule();

    const gone = rig();
    open(gone.store, subjectOf(MARTIN), martinContext({ gone: true }));
    await settle();
    expect(
      gone.store.detailAction(BadgeSeriesId.of('series-svc-fade')),
    ).toBeNull();
    // Offline and gone, the wallet keeps its tickets on show but takes the verbs.
    const wallet = gone.store.wallet();
    expect(
      wallet?.loadState === LoadState.Ready &&
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
    expect(wallet?.loadState).toBe(LoadState.Ready);
    if (wallet?.loadState === LoadState.Ready) {
      expect(wallet.data.frozen).toBe(true);
      expect(wallet.data.pass.state).toBe(WORDS.loyaltyPage.passFrozen);
      expect(wallet.data.actions.map((a) => a.id)).not.toContain('use');
    }
    expect(store.detailAction(BadgeSeriesId.of('series-svc-beard'))).toBeNull();
    expect('reward' in store.overview()).toBe(false);
  });
});

describe('ClientCardStore — revision 3: a guest, and the flags', () => {
  it('draws a guest’s hero from the seat and nothing of the pages', async () => {
    const { store, vouchers, activity } = rig();
    open(
      store,
      GUEST,
      martinContext({
        isOwner: false,
        appointmentId: AppointmentId.of('appt-walk-in'),
      }),
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
    expect(store.visits().loadState).toBe(LoadState.Loading);
    expect(store.ledger().loadState).toBe(LoadState.Loading);
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
    expect(off.store.ledger().loadState).toBe(LoadState.Failed);
    expect(off.vouchers?.calls).toEqual([]);
    expect(journalCalls(off.activity)).toEqual([]);
    TestBed.resetTestingModule();

    const noPoints = rig({ flags: { ...ALL_FLAGS, 'loyalty.points': false } });
    open(noPoints.store, subjectOf(GEORGI), georgiContext());
    await settle();
    expect(noPoints.vouchers?.calls).toHaveLength(1);
    expect(journalCalls(noPoints.activity)).toEqual([]);
    const wallet = noPoints.store.wallet();
    expect(wallet?.loadState).toBe(LoadState.Ready);
    if (wallet?.loadState === LoadState.Ready) {
      expect('activity' in wallet.data).toBe(false);
      expect('catalog' in wallet.data).toBe(false);
      expect(wallet.data.actions.map((a) => a.id)).not.toContain('history');
    }
    expect(noPoints.store.ledger().loadState).toBe(LoadState.Failed);
    // The glance's card leads with the first holding as its figure.
    const loyalty = noPoints.store.overview().loyalty;
    expect(
      loyalty?.loadState === LoadState.Ready && loyalty.data,
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
    expect(store.barTitle(ClientCardPage.ClientLedger, GEORGI)).toBe(
      wordsOf('en').ledgerPage.title,
    );
    expect(store.barTitle(ClientCardPage.ClientRecords, GEORGI)).toBe(
      wordsOf('en').achievements.records,
    );
    expect(store.hero().tier?.name).toBe('Gold');
  });
});

/** The erasure's two callables where a case never dials them: unreachable. */
const NO_ERASURE: {
  readonly previewClientErasure: PreviewClientErasure;
  readonly eraseClient: EraseClient;
} = {
  previewClientErasure: async () =>
    CoreResult.err(PipelineError.bare(PipelineErrorCode.Unknown)),
  eraseClient: async () =>
    CoreResult.err(PipelineError.bare(PipelineErrorCode.Unknown)),
};

/*
 * L «Лични данни» (audit-hardening Phase 3, WS-C): the admin's privacy
 * block. The rig binds the callables' port and the id source only here
 * (`privacyRig`), so every case above runs without them — and with
 * `client.privacy` off — exactly as before.
 */
describe('ClientCardStore — the admin’s export (audit-hardening Phase 3)', () => {
  const PRIVACY_FLAGS = { ...ALL_FLAGS, 'client.privacy': true };
  const ADMIN = { userId: UserId.of('dev-admin'), roles: [Role.Admin] };

  const EXPORTED: ClientPrivacyCall.Exported = {
    clientExportVersion: ClientPrivacyCall.EXPORT_VERSION,
    exportedCustomerId: GEORGI_CUSTOMER_ID,
    exportedAtUtcMs: NOW_MS,
    exportDocumentCount: 4,
    exportByteCount: 21,
    exportJson: '{"clientExportVersion":1}',
  };

  /** The export callable, scripted: each answer in turn (the last one repeats), every call recorded. */
  function scriptedExport(
    ...answers: CoreResult<ClientPrivacyCall.Exported, PipelineError>[]
  ): ClientPrivacyGatewayPorts & { readonly calls: ClientPrivacyCall[] } {
    const calls: ClientPrivacyCall[] = [];
    return {
      calls,
      exportClientData: async (call) => {
        calls.push(call);
        return must(
          answers[Math.min(calls.length, answers.length) - 1],
          'a scripted answer',
        );
      },
      ...NO_ERASURE,
    };
  }

  /** Names the wire can carry, `op-card-export-0001`, … — each one recorded. */
  function namedIds(): IdPorts & { readonly minted: string[] } {
    const minted: string[] = [];
    return {
      minted,
      nextId: () => {
        const id = `op-card-export-${String(minted.length + 1).padStart(4, '0')}`;
        minted.push(id);
        return id;
      },
    };
  }

  function privacyRig(
    options: RigOptions & {
      readonly privacy?: ClientPrivacyGatewayPorts | null;
      readonly ids?: IdPorts | null;
    } = {},
  ) {
    const privacy =
      options.privacy === undefined
        ? scriptedExport(CoreResult.ok(EXPORTED))
        : options.privacy;
    const ids = options.ids === undefined ? namedIds() : options.ids;
    TestBed.configureTestingModule({
      providers: [
        ...(privacy === null
          ? []
          : [{ provide: CLIENT_PRIVACY_PORTS, useValue: privacy }]),
        ...(ids === null ? [] : [{ provide: ID_PORTS, useValue: ids }]),
      ],
    });
    return rig({ flags: PRIVACY_FLAGS, ...options });
  }

  async function openedAs(
    store: ClientCardStore,
    viewer: ClientCardContext['viewer'],
    subject: ClientCardSubject = subjectOf(GEORGI),
  ): Promise<void> {
    open(store, subject, georgiContext({ viewer }));
    await settle();
  }

  it('offers the export to the shop’s admin, worded, with no line until it runs', async () => {
    const { store } = privacyRig();
    await openedAs(store, ADMIN);
    expect(store.privacy()).toEqual({
      groupLabel: 'Лични данни',
      exportLabel: 'Изтегли данните',
      exportStatus: null,
    });
    // Never part of the overview: its key set stays as it was.
    expect('privacy' in store.overview()).toBe(false);
  });

  it('is absent without the port, the id source or the flag', async () => {
    const noPort = privacyRig({ privacy: null });
    await openedAs(noPort.store, ADMIN);
    expect(noPort.store.privacy()).toBeNull();
    TestBed.resetTestingModule();

    const noIds = privacyRig({ ids: null });
    await openedAs(noIds.store, ADMIN);
    expect(noIds.store.privacy()).toBeNull();
    TestBed.resetTestingModule();

    const flagOff = privacyRig({ flags: ALL_FLAGS });
    await openedAs(flagOff.store, ADMIN);
    expect(flagOff.store.privacy()).toBeNull();
  });

  it('is absent for a barber, a receptionist, the sysadmin and no viewer — the admin alone', async () => {
    for (const viewer of [
      null,
      { userId: UserId.of('dev-barber'), roles: [Role.Barber] },
      { userId: UserId.of('dev-desk'), roles: [Role.Receptionist] },
      { userId: UserId.of('dev-sysadmin'), roles: [Role.Sysadmin] },
    ]) {
      const { store } = privacyRig();
      await openedAs(store, viewer);
      expect(store.privacy()).toBeNull();
      TestBed.resetTestingModule();
    }
  });

  it('is absent until the client record is known: a guest, an account with no record', async () => {
    const guest = privacyRig();
    open(guest.store, GUEST, georgiContext({ viewer: ADMIN }));
    await settle();
    expect(guest.store.privacy()).toBeNull();
    TestBed.resetTestingModule();

    const noRecord = privacyRig({ customers: customerPortsOf([]) });
    await openedAs(noRecord.store, ADMIN);
    expect(noRecord.store.customerId()).toBeNull();
    expect(noRecord.store.privacy()).toBeNull();
  });

  it('is absent offline, and back with the network', async () => {
    const { store } = privacyRig();
    await openedAs(store, ADMIN);
    window.dispatchEvent(new Event('offline'));
    expect(store.privacy()).toBeNull();
    expect(await store.exportData()).toBeNull();
    window.dispatchEvent(new Event('online'));
    expect(store.privacy()).not.toBeNull();
  });

  it('stays on a gone visit: the export writes nothing to the visit', async () => {
    const { store } = privacyRig();
    open(
      store,
      subjectOf(GEORGI),
      georgiContext({ viewer: ADMIN, gone: true }),
    );
    await settle();
    expect(store.overview().canRemove).toBe(false);
    expect(store.privacy()).not.toBeNull();
  });

  it('sends the record under one minted id, hands the bundle on and says it is downloaded', async () => {
    const privacy = scriptedExport(CoreResult.ok(EXPORTED));
    const ids = namedIds();
    const { store } = privacyRig({ privacy, ids });
    await openedAs(store, ADMIN);

    const answer = await store.exportData();

    expect(answer).toBe(EXPORTED);
    expect(privacy.calls).toEqual([
      {
        customerId: GEORGI_CUSTOMER_ID,
        operationId: 'op-card-export-0001',
      },
    ]);
    expect(store.privacy()?.exportStatus).toBe('Файлът е изтеглен.');

    // A new tap is a new act: a new name.
    await store.exportData();
    expect(privacy.calls.map((call) => call.operationId)).toEqual([
      'op-card-export-0001',
      'op-card-export-0002',
    ]);
    expect(ids.minted).toHaveLength(2);
  });

  it('keeps a refused act’s id for its retry, words the refusal, and mints anew once it lands', async () => {
    const refused = PipelineError.fromWire('functions/failed-precondition', {
      errorCode: 'PRIVACY_EXPORT_TOO_LARGE',
    });
    const privacy = scriptedExport(
      CoreResult.err(refused),
      CoreResult.ok(EXPORTED),
    );
    const ids = namedIds();
    const { store } = privacyRig({ privacy, ids });
    await openedAs(store, ADMIN);

    expect(await store.exportData()).toBeNull();
    expect(store.privacy()?.exportStatus).toBe(
      'Данните са твърде много за един файл. Свържи се с поддръжката.',
    );

    expect(await store.exportData()).toBe(EXPORTED);
    expect(privacy.calls.map((call) => call.operationId)).toEqual([
      'op-card-export-0001',
      'op-card-export-0001',
    ]);
    expect(ids.minted).toEqual(['op-card-export-0001']);
    expect(store.privacy()?.exportStatus).toBe('Файлът е изтеглен.');
  });

  it('asks once while an export is on its way, and drops the answer of a person no longer on the card', async () => {
    const pending: { release: (() => void) | null } = { release: null };
    const calls: ClientPrivacyCall[] = [];
    const held: ClientPrivacyGatewayPorts = {
      exportClientData: (call) => {
        calls.push(call);
        return new Promise((resolve) => {
          pending.release = () => resolve(CoreResult.ok(EXPORTED));
        });
      },
      ...NO_ERASURE,
    };
    const { store } = privacyRig({ privacy: held });
    await openedAs(store, ADMIN);

    const first = store.exportData();
    expect(await store.exportData()).toBeNull();
    expect(calls).toHaveLength(1);
    expect(store.privacy()?.exportStatus).toBeNull();

    open(store, subjectOf(MARTIN), martinContext({ viewer: ADMIN }));
    must(pending.release, 'the held export')();
    expect(await first).toBeNull();
    await settle();
    expect(store.privacy()?.exportStatus).toBeNull();
  });

  it('forgets the last line when the same person is opened again', async () => {
    const { store } = privacyRig();
    await openedAs(store, ADMIN);
    await store.exportData();
    expect(store.privacy()?.exportStatus).toBe('Файлът е изтеглен.');
    await openedAs(store, ADMIN);
    expect(store.privacy()?.exportStatus).toBeNull();
  });
});

/*
 * L «Лични данни» — the admin's erasure (audit-hardening Phase 3, WS-D,
 * P3-DEP-22): ONE act per row — preview (the census) → ONE alert → confirm
 * → `completeClientErasure` with the act's ONE captured call. The rig binds
 * the callables only here, as the export's does.
 */
describe('ClientCardStore — the admin’s erasure (audit-hardening Phase 3, WS-D)', () => {
  const PRIVACY_FLAGS = { ...ALL_FLAGS, 'client.privacy': true };
  const ADMIN = { userId: UserId.of('dev-admin'), roles: [Role.Admin] };
  const SIBLING = CustomerId.of('cus_5151515151515151515a');
  const OTHER_SIBLING = CustomerId.of('cus_5252525252525252525b');

  const PREVIEW: ClientPrivacyCall.ErasurePreview = {
    ...ErasureCensus.EMPTY,
    erasureStatus: ErasureStatus.None,
    erasureRecordCount: 1,
    erasureAccountCount: 1,
    erasureContactCount: 4,
    erasureVisitCount: 12,
    erasureNoteCount: 2,
    erasurePhotoCount: 3,
    erasureSiblingCustomerIds: [SIBLING, OTHER_SIBLING],
  };
  const SIBLING_PREVIEW: ClientPrivacyCall.ErasurePreview = {
    ...ErasureCensus.EMPTY,
    erasureStatus: ErasureStatus.None,
    erasureRecordCount: 1,
    erasureVisitCount: 1,
    erasureSiblingCustomerIds: [],
  };
  const erasureOf = (
    erasureStatus: ErasureStatus,
    erasureDone: boolean,
  ): ClientPrivacyCall.Erasure => ({
    ...ErasureCensus.EMPTY,
    erasureStatus,
    erasureDone,
    erasureVisitCount: 12,
  });
  const ERASED = erasureOf(ErasureStatus.Erased, true);
  const STILL_ERASING = erasureOf(ErasureStatus.Erasing, false);

  type Answer<T> = CoreResult<T, PipelineError>;

  /** The two erasure callables, scripted per record: each answer in turn (the last one repeats), every call recorded. */
  function scriptedErasure(script: {
    readonly previews?: ReadonlyMap<
      CustomerId,
      Answer<ClientPrivacyCall.ErasurePreview>
    >;
    readonly erasures?: readonly Answer<ClientPrivacyCall.Erasure>[];
  }): ClientPrivacyGatewayPorts & {
    readonly previews: ClientPrivacyCall[];
    readonly erasures: ClientPrivacyCall[];
  } {
    const previews: ClientPrivacyCall[] = [];
    const erasures: ClientPrivacyCall[] = [];
    const erasureAnswers = script.erasures ?? [CoreResult.ok(ERASED)];
    return {
      previews,
      erasures,
      exportClientData: async () =>
        CoreResult.err(PipelineError.bare(PipelineErrorCode.Unknown)),
      previewClientErasure: async (call) => {
        previews.push(call);
        return must(
          (
            script.previews ??
            new Map([
              [GEORGI_CUSTOMER_ID, CoreResult.ok(PREVIEW)],
              [SIBLING, CoreResult.ok(SIBLING_PREVIEW)],
              [OTHER_SIBLING, CoreResult.ok(SIBLING_PREVIEW)],
            ])
          ).get(call.customerId),
          'a scripted preview',
        );
      },
      eraseClient: async (call) => {
        erasures.push(call);
        return must(
          erasureAnswers[Math.min(erasures.length, erasureAnswers.length) - 1],
          'a scripted erasure',
        );
      },
    };
  }

  /** Names the wire can carry, `op-card-erase-0001`, … — each one recorded. */
  function namedIds(): IdPorts & { readonly minted: string[] } {
    const minted: string[] = [];
    return {
      minted,
      nextId: () => {
        const id = `op-card-erase-${String(minted.length + 1).padStart(4, '0')}`;
        minted.push(id);
        return id;
      },
    };
  }

  function erasureRig(
    options: RigOptions & {
      readonly privacy?: ClientPrivacyGatewayPorts;
      readonly ids?: IdPorts;
    } = {},
  ) {
    const privacy = options.privacy ?? scriptedErasure({});
    const ids = options.ids ?? namedIds();
    TestBed.configureTestingModule({
      providers: [
        { provide: CLIENT_PRIVACY_PORTS, useValue: privacy },
        { provide: ID_PORTS, useValue: ids },
      ],
    });
    return rig({ flags: PRIVACY_FLAGS, ...options });
  }

  /** Георги's record under the given erasure slice; every other record as the fixture holds it. */
  function customersWithGeorgi(
    lifecycle: ErasureLifecycle,
  ): ReturnType<typeof customerPortsOf> {
    return customerPortsOf(
      fixtureCustomers().map((record) =>
        record.id === GEORGI_CUSTOMER_ID ? { ...record, ...lifecycle } : record,
      ),
    );
  }

  async function openedAsAdmin(store: ClientCardStore): Promise<void> {
    open(store, subjectOf(GEORGI), georgiContext({ viewer: ADMIN }));
    await settle();
  }

  const call = (customerId: CustomerId, n: number): ClientPrivacyCall => ({
    customerId,
    operationId: unwrapOk(
      ClientOperationId.parse(`op-card-erase-${String(n).padStart(4, '0')}`),
    ),
  });

  it('offers the erase row to the shop’s admin on a record the system offers erasure for, with no alert yet', async () => {
    const { store } = erasureRig();
    await openedAsAdmin(store);
    const vm = must(store.erasure(), 'the erasure rows');
    expect(vm.eraseLabel).toBe('Изтрий личните данни');
    expect(vm.erasedLine).toBeNull();
    expect(vm.eraseStatus).toBeNull();
    expect(vm.siblings).toEqual([]);
    expect(vm.alert.open).toBe(false);
    expect(vm.alert.body).toBeNull();
    // Never part of the overview, nor of the export's block.
    expect('erasure' in store.overview()).toBe(false);
    expect(store.privacy()).toEqual({
      groupLabel: 'Лични данни',
      exportLabel: 'Изтегли данните',
      exportStatus: null,
    });
  });

  it('is absent wherever the privacy block is: a barber, the flag off, offline', async () => {
    const barber = erasureRig();
    open(
      barber.store,
      subjectOf(GEORGI),
      georgiContext({
        viewer: { userId: UserId.of('dev-barber'), roles: [Role.Barber] },
      }),
    );
    await settle();
    expect(barber.store.erasure()).toBeNull();
    TestBed.resetTestingModule();

    const flagOff = erasureRig({ flags: ALL_FLAGS });
    await openedAsAdmin(flagOff.store);
    expect(flagOff.store.erasure()).toBeNull();
    TestBed.resetTestingModule();

    const { store } = erasureRig();
    await openedAsAdmin(store);
    window.dispatchEvent(new Event('offline'));
    expect(store.erasure()).toBeNull();
    window.dispatchEvent(new Event('online'));
    expect(store.erasure()).not.toBeNull();
  });

  it('words an ERASED record’s line beside the re-sweep row, and an ERASING record’s unfinished line', async () => {
    const begun = ErasureLifecycle.begin(NOW_MS);
    const erased = erasureRig({
      customers: customersWithGeorgi(ErasureLifecycle.complete(begun, NOW_MS)),
    });
    await openedAsAdmin(erased.store);
    expect(erased.store.erasure()?.erasedLine).toBe('Изтрит клиент');
    expect(erased.store.erasure()?.eraseLabel).toBe('Изтрий личните данни');
    expect(erased.store.erasure()?.eraseStatus).toBeNull();
    TestBed.resetTestingModule();

    const erasing = erasureRig({ customers: customersWithGeorgi(begun) });
    await openedAsAdmin(erasing.store);
    expect(erasing.store.erasure()?.erasedLine).toBeNull();
    expect(erasing.store.erasure()?.eraseStatus).toBe(
      'Изтриването още не е завършило. Опитай пак.',
    );
  });

  it('previews under ONE minted id, opens the ONE alert with the census, and confirms with EXACTLY that call until the erasure is done', async () => {
    const privacy = scriptedErasure({
      erasures: [CoreResult.ok(STILL_ERASING), CoreResult.ok(ERASED)],
    });
    const ids = namedIds();
    const { store } = erasureRig({ privacy, ids });
    await openedAsAdmin(store);

    await store.previewErasure(GEORGI_CUSTOMER_ID);

    expect(privacy.previews).toEqual([call(GEORGI_CUSTOMER_ID, 1)]);
    const alert = must(store.erasure(), 'the rows').alert;
    expect(alert.open).toBe(true);
    expect(alert.title).toBe('Да изтрием ли личните данни?');
    expect(alert.body).toBe(
      'Посещения: 12 · Бележки: 2 · Снимки: 3 · Профили за вход: 1 · ' +
        'Други записи със същия телефон или имейл: 2. Името, телефонът и ' +
        'имейлът изчезват, профилът за вход се изтрива. Посещенията и ' +
        'плащанията остават.',
    );
    expect(privacy.erasures).toEqual([]);

    await store.confirmErasure();

    // The loop resumed the SAME act: one id, the same call each time.
    expect(privacy.erasures).toEqual([
      call(GEORGI_CUSTOMER_ID, 1),
      call(GEORGI_CUSTOMER_ID, 1),
    ]);
    expect(privacy.erasures[0]).toBe(privacy.previews[0]);
    expect(ids.minted).toEqual(['op-card-erase-0001']);
    const vm = must(store.erasure(), 'the rows');
    expect(vm.alert.open).toBe(false);
    expect(vm.erasedLine).toBe('Изтрит клиент');
    expect(vm.eraseStatus).toBeNull();
    // The siblings the preview named stay after the act.
    expect(vm.siblings.map((row) => row.customerId)).toEqual([
      SIBLING,
      OTHER_SIBLING,
    ]);
  });

  it('«Отказ» calls nothing and closes the alert', async () => {
    const privacy = scriptedErasure({});
    const { store } = erasureRig({ privacy });
    await openedAsAdmin(store);
    await store.previewErasure(GEORGI_CUSTOMER_ID);
    expect(store.erasure()?.alert.open).toBe(true);

    store.dismissErasure();
    await store.confirmErasure();

    expect(privacy.erasures).toEqual([]);
    expect(store.erasure()?.alert.open).toBe(false);
    expect(store.erasure()?.erasedLine).toBeNull();
    expect(store.erasure()?.eraseStatus).toBeNull();
  });

  it('switching the card to another client between preview and confirm calls nothing and clears the pending act', async () => {
    const privacy = scriptedErasure({});
    const { store } = erasureRig({ privacy });
    await openedAsAdmin(store);
    await store.previewErasure(GEORGI_CUSTOMER_ID);
    expect(store.erasure()?.alert.open).toBe(true);

    open(store, subjectOf(MARTIN), martinContext({ viewer: ADMIN }));
    await store.confirmErasure();
    await settle();

    expect(privacy.erasures).toEqual([]);
    expect(store.erasure()?.alert.open).toBe(false);
    expect(store.erasure()?.alert.body).toBeNull();
    expect(store.erasure()?.siblings).toEqual([]);
  });

  it('drops a preview answered for a person no longer on the card', async () => {
    const release: { answer: (() => void) | null } = { answer: null };
    const previews: ClientPrivacyCall[] = [];
    const held: ClientPrivacyGatewayPorts = {
      ...scriptedErasure({}),
      previewClientErasure: (asked) => {
        previews.push(asked);
        return new Promise((resolve) => {
          release.answer = () => resolve(CoreResult.ok(PREVIEW));
        });
      },
    };
    const { store } = erasureRig({ privacy: held });
    await openedAsAdmin(store);

    const first = store.previewErasure(GEORGI_CUSTOMER_ID);
    // One act at a time: a second tap while the preview runs asks nothing.
    await store.previewErasure(GEORGI_CUSTOMER_ID);
    expect(previews).toHaveLength(1);

    open(store, subjectOf(MARTIN), martinContext({ viewer: ADMIN }));
    must(release.answer, 'the held preview')();
    await first;
    await settle();
    expect(store.erasure()?.alert.open).toBe(false);
    expect(store.erasure()?.alert.body).toBeNull();
  });

  it('a sibling row runs its own preview with a NEW operation id and the sibling’s id, and leaves the list once erased', async () => {
    const privacy = scriptedErasure({});
    const ids = namedIds();
    const { store } = erasureRig({ privacy, ids });
    await openedAsAdmin(store);
    await store.previewErasure(GEORGI_CUSTOMER_ID);
    store.dismissErasure();
    expect(store.erasure()?.siblings.map((row) => row.testId)).toEqual([
      'client-privacy-sibling-1',
      'client-privacy-sibling-2',
    ]);

    await store.previewErasure(SIBLING);
    expect(privacy.previews).toEqual([
      call(GEORGI_CUSTOMER_ID, 1),
      call(SIBLING, 2),
    ]);
    expect(store.erasure()?.alert.body).toContain('Посещения: 1 ·');

    await store.confirmErasure();

    expect(privacy.erasures).toEqual([call(SIBLING, 2)]);
    const vm = must(store.erasure(), 'the rows');
    expect(vm.siblings.map((row) => row.customerId)).toEqual([OTHER_SIBLING]);
    // The card's own record is untouched by a sibling's act.
    expect(vm.erasedLine).toBeNull();
    // A record neither the card's nor a named sibling is never previewed.
    await store.previewErasure(CustomerId.of('cus_7777777777777777777c'));
    expect(privacy.previews).toHaveLength(2);
  });

  /**
   * The scripted callables, but the card's record previews as `PREVIEW`
   * the first time and as `after` (its erasure stamped) from then on — every
   * preview call recorded, the siblings answered as scripted.
   */
  function previewsAfterStamp(
    erasures: readonly Answer<ClientPrivacyCall.Erasure>[],
    after: ClientPrivacyCall.ErasurePreview,
  ) {
    const base = scriptedErasure({ erasures });
    let own = 0;
    return {
      ...base,
      previewClientErasure: async (
        call: ClientPrivacyCall,
      ): Promise<Answer<ClientPrivacyCall.ErasurePreview>> => {
        if (call.customerId !== GEORGI_CUSTOMER_ID) {
          return base.previewClientErasure(call);
        }
        base.previews.push(call);
        own += 1;
        return CoreResult.ok(own === 1 ? PREVIEW : after);
      },
    };
  }

  it('keeps the sibling rows when the card’s record is previewed again after the stamp — a refusal mid-act, then the RESUME preview names none (P3-L-7)', async () => {
    const privacy = previewsAfterStamp(
      [CoreResult.err(PipelineError.bare(PipelineErrorCode.Unavailable))],
      {
        ...PREVIEW,
        erasureStatus: ErasureStatus.Erasing,
        erasureSiblingCustomerIds: [],
      },
    );
    const { store } = erasureRig({ privacy });
    await openedAsAdmin(store);
    await store.previewErasure(GEORGI_CUSTOMER_ID);
    // The stamp committed, then the call failed: the act is refused.
    await store.confirmErasure();
    await store.previewErasure(GEORGI_CUSTOMER_ID);
    // The alert counts the two rows the card still lists beside it (P3-DEP-35).
    expect(store.erasure()?.alert.body).toContain(
      'Други записи със същия телефон или имейл: 2.',
    );
    store.dismissErasure();

    expect(store.erasure()?.siblings.map((row) => row.customerId)).toEqual([
      SIBLING,
      OTHER_SIBLING,
    ]);
    await store.previewErasure(SIBLING);
    // A sibling's own act counts its own preview's list (it names none).
    expect(store.erasure()?.alert.body).toContain(
      'Други записи със същия телефон или имейл: 0.',
    );
    expect(privacy.previews.map((sent) => sent.customerId)).toEqual([
      GEORGI_CUSTOMER_ID,
      GEORGI_CUSTOMER_ID,
      SIBLING,
    ]);
  });

  it('keeps the sibling rows when an ERASED record is re-swept — its preview names none (P3-L-7, P3-L-19)', async () => {
    const privacy = previewsAfterStamp([CoreResult.ok(ERASED)], {
      ...PREVIEW,
      erasureStatus: ErasureStatus.Erased,
      erasureSiblingCustomerIds: [],
    });
    const { store } = erasureRig({ privacy });
    await openedAsAdmin(store);
    await store.previewErasure(GEORGI_CUSTOMER_ID);
    await store.confirmErasure();
    expect(store.erasure()?.erasedLine).toBe('Изтрит клиент');
    // The RESWEEP row previews the record again.
    await store.previewErasure(GEORGI_CUSTOMER_ID);
    expect(store.erasure()?.alert.body).toContain(
      'Други записи със същия телефон или имейл: 2.',
    );
    store.dismissErasure();

    expect(store.erasure()?.siblings.map((row) => row.customerId)).toEqual([
      SIBLING,
      OTHER_SIBLING,
    ]);
  });

  it('a refused erasure keeps the alert’s words and says the refusal on the rows; a refused preview opens no alert', async () => {
    const staff = PipelineError.fromWire('functions/failed-precondition', {
      errorCode: 'PRIVACY_ERASURE_STAFF_ACCOUNT',
    });
    const privacy = scriptedErasure({ erasures: [CoreResult.err(staff)] });
    const { store } = erasureRig({ privacy });
    await openedAsAdmin(store);
    await store.previewErasure(GEORGI_CUSTOMER_ID);
    const worded = store.erasure()?.alert.body;

    await store.confirmErasure();

    const vm = must(store.erasure(), 'the rows');
    expect(vm.alert.open).toBe(false);
    expect(vm.alert.body).toBe(worded);
    expect(vm.eraseStatus).toBe(
      'Профил на служител не може да се изтрие оттук.',
    );
    expect(vm.erasedLine).toBeNull();
    TestBed.resetTestingModule();

    const mismatch = PipelineError.fromWire('functions/failed-precondition', {
      errorCode: 'PRIVACY_ACCOUNT_LINK_MISMATCH',
    });
    const refusing = scriptedErasure({
      previews: new Map([[GEORGI_CUSTOMER_ID, CoreResult.err(mismatch)]]),
    });
    const second = erasureRig({ privacy: refusing });
    await openedAsAdmin(second.store);
    await second.store.previewErasure(GEORGI_CUSTOMER_ID);
    expect(second.store.erasure()?.alert.open).toBe(false);
    expect(second.store.erasure()?.eraseStatus).toBe(
      'Профилът не съвпада със записа на клиента. Свържи се с поддръжката.',
    );
    await second.store.confirmErasure();
    expect(refusing.erasures).toEqual([]);
  });

  it('says «not finished yet» when the calls run out, the record left ERASING for a resume', async () => {
    const privacy = scriptedErasure({
      erasures: [CoreResult.ok(STILL_ERASING)],
    });
    const { store } = erasureRig({ privacy });
    await openedAsAdmin(store);
    await store.previewErasure(GEORGI_CUSTOMER_ID);

    await store.confirmErasure();

    expect(privacy.erasures).toHaveLength(MAX_ERASURE_CALLS);
    expect(store.erasure()?.eraseStatus).toBe(
      'Изтриването още не е завършило. Опитай пак.',
    );
    expect(store.erasure()?.erasedLine).toBeNull();
    // A re-open of the same person keeps the record's own word for it (RESUME).
    await openedAsAdmin(store);
    expect(store.erasure()?.eraseStatus).toBe(
      'Изтриването още не е завършило. Опитай пак.',
    );
  });
});

/*
 * «Роли» — the admin's roles change (security hardening S-WS-E, S-RU-13,
 * S-L-18): toggles over `Roles.ASSIGNABLE`, Save as
 * `RoleAssignmentSystem.saveOf` answers, ONE operation id per act reused
 * on its retry, and a failed revoke that is never forgotten (S-RU-10). The
 * rig binds the callable's port and the id source only here, as the
 * privacy block's does.
 */
describe('ClientCardStore — the admin’s roles (security hardening S-WS-E)', () => {
  const NOT_REVOKED = PipelineError.fromWire('functions/unavailable', {
    errorCode: GovernanceErrorCode.RolesSessionsNotRevoked,
  });
  const NOT_REVOKED_LINE =
    'Ролите са запазени, но старите сесии не бяха прекратени. Опитай пак.';
  const SAVED_LINE = 'Ролите са запазени. Важат от следващото влизане.';

  /** Names the wire can carry, `op-card-roles-0001`, … — each one recorded. */
  function rolesIds(): IdPorts & { readonly minted: string[] } {
    const minted: string[] = [];
    return {
      minted,
      nextId: () => {
        const id = `op-card-roles-${String(minted.length + 1).padStart(4, '0')}`;
        minted.push(id);
        return id;
      },
    };
  }

  const changed = (
    roles: readonly Role[],
  ): CoreResult<RolesCall.Changed, PipelineError> =>
    CoreResult.ok({
      targetUserId: UserId.of(GEORGI),
      roles,
      rolesChanged: true,
    });

  function rolesRig(
    options: RigOptions & {
      readonly admin?: RolesAdminPorts | null;
      readonly ids?: IdPorts | null;
    } = {},
  ) {
    const admin =
      options.admin === undefined ? rolesAdminPortsOf() : options.admin;
    const ids = options.ids === undefined ? rolesIds() : options.ids;
    TestBed.configureTestingModule({
      providers: [
        ...(admin === null
          ? []
          : [{ provide: ROLES_ADMIN_PORTS, useValue: admin }]),
        ...(ids === null ? [] : [{ provide: ID_PORTS, useValue: ids }]),
      ],
    });
    return rig(options);
  }

  async function openedAs(
    store: ClientCardStore,
    viewer: ClientCardContext['viewer'],
    subject: ClientCardSubject = subjectOf(GEORGI),
  ): Promise<void> {
    open(store, subject, georgiContext({ viewer }));
    await settle();
  }

  const ticked = (store: ClientCardStore): readonly Role[] =>
    (store.roles()?.toggles ?? [])
      .filter((toggle) => toggle.checked)
      .map((toggle) => toggle.role);

  it('offers the block to the shop’s admin on another account, the stored roles ticked, Save off, no line', async () => {
    const { store } = rolesRig();
    await openedAs(store, ADMIN_VIEWER);
    const block = must(store.roles(), 'the roles block');
    expect(block.groupLabel).toBe('Роли');
    expect(
      block.toggles.map((toggle) => [toggle.label, toggle.checked]),
    ).toEqual([
      ['Клиент', true],
      ['Бръснар', false],
      ['Рецепция', false],
      ['Съдържание', false],
      ['Администратор', false],
    ]);
    expect(block.saveLabel).toBe('Запази ролите');
    expect(block.saveEnabled).toBe(false);
    expect(block.line).toBeNull();
    expect(block.testId).toBe('client-roles');
    // Never part of the overview, and independent of `client.privacy` (off here).
    expect('roles' in store.overview()).toBe(false);
    expect(store.privacy()).toBeNull();
  });

  it('is absent without the port or the id source', async () => {
    const noPort = rolesRig({ admin: null });
    await openedAs(noPort.store, ADMIN_VIEWER);
    expect(noPort.store.roles()).toBeNull();
    TestBed.resetTestingModule();

    const noIds = rolesRig({ ids: null });
    await openedAs(noIds.store, ADMIN_VIEWER);
    expect(noIds.store.roles()).toBeNull();
  });

  it('is absent for no viewer, a barber, a receptionist, a content manager and the sysadmin — the admin alone', async () => {
    for (const viewer of [
      null,
      { userId: UserId.of('dev-barber'), roles: [Role.Barber] },
      { userId: UserId.of('dev-desk'), roles: [Role.Receptionist] },
      { userId: UserId.of('dev-content'), roles: [Role.ContentManager] },
      { userId: UserId.of('dev-sysadmin'), roles: [Role.Sysadmin] },
    ]) {
      const { store } = rolesRig();
      await openedAs(store, viewer);
      expect(store.roles()).toBeNull();
      TestBed.resetTestingModule();
    }
  });

  it('is absent on the viewer’s own account, on an account holding the sysadmin, an erased one, a stub and a guest', async () => {
    const own = rolesRig();
    await openedAs(own.store, {
      userId: UserId.of(GEORGI),
      roles: [Role.Admin],
    });
    expect(own.store.roles()).toBeNull();
    TestBed.resetTestingModule();

    const sysadmin = rolesRig({
      profiles: profilePortsOf([
        { ...georgiUser(), roles: [Role.Client, Role.Sysadmin] },
      ]),
    });
    await openedAs(sysadmin.store, ADMIN_VIEWER);
    expect(sysadmin.store.roles()).toBeNull();
    TestBed.resetTestingModule();

    const erased = rolesRig({
      profiles: profilePortsOf([georgiUser(AccountLifecycle.erase(NOW_MS))]),
    });
    await openedAs(erased.store, ADMIN_VIEWER);
    expect(erased.store.roles()).toBeNull();
    TestBed.resetTestingModule();

    const stub = rolesRig({ profiles: profilePortsOf([stubOf(GEORGI)]) });
    await openedAs(stub.store, ADMIN_VIEWER);
    expect(stub.store.roles()).toBeNull();
    TestBed.resetTestingModule();

    const guest = rolesRig();
    await openedAs(guest.store, ADMIN_VIEWER, GUEST);
    expect(guest.store.roles()).toBeNull();
  });

  it('is absent until the profile has answered, offline, and back with the network', async () => {
    const profiles = heldProfilePortsOf();
    const { store } = rolesRig({ profiles });
    open(store, subjectOf(GEORGI), georgiContext({ viewer: ADMIN_VIEWER }));
    await settle();
    expect(store.roles()).toBeNull();
    profiles.answer();
    await settle();
    expect(store.roles()).not.toBeNull();

    window.dispatchEvent(new Event('offline'));
    expect(store.roles()).toBeNull();
    window.dispatchEvent(new Event('online'));
    expect(store.roles()).not.toBeNull();
  });

  it('a toggle then Save sends the whole set once under the act’s ONE id; the answer refreshes the toggles', async () => {
    const admin = rolesAdminPortsOf(changed([Role.Client, Role.Barber]));
    const ids = rolesIds();
    const { store } = rolesRig({ admin, ids });
    await openedAs(store, ADMIN_VIEWER);

    store.toggleRole(Role.Barber);
    expect(ticked(store)).toEqual([Role.Client, Role.Barber]);
    expect(store.roles()?.saveEnabled).toBe(true);

    await store.saveRoles();

    expect(admin.calls).toEqual([
      {
        targetUserId: UserId.of(GEORGI),
        roles: [Role.Client, Role.Barber],
        operationId: 'op-card-roles-0001',
      },
    ]);
    expect(ticked(store)).toEqual([Role.Client, Role.Barber]);
    expect(store.roles()?.saveEnabled).toBe(false);
    expect(store.roles()?.line).toBe(SAVED_LINE);

    // A new change is a new act: a new name.
    store.toggleRole(Role.Receptionist);
    expect(store.roles()?.line).toBeNull();
    await store.saveRoles();
    expect(
      admin.calls.map((call) =>
        ClientOperationId.inPayload(call, 'operationId'),
      ),
    ).toEqual(['op-card-roles-0001', 'op-card-roles-0002']);
  });

  it('follows the server’s answer, not the set it sent', async () => {
    const admin = rolesAdminPortsOf(changed([Role.Barber]));
    const { store } = rolesRig({ admin });
    await openedAs(store, ADMIN_VIEWER);
    store.toggleRole(Role.Barber);
    await store.saveRoles();
    expect(ticked(store)).toEqual([Role.Barber]);
  });

  it('never offers Save for an empty set or the stored one, and sends nothing then', async () => {
    const admin = rolesAdminPortsOf();
    const { store } = rolesRig({ admin });
    await openedAs(store, ADMIN_VIEWER);
    store.toggleRole(Role.Client);
    expect(ticked(store)).toEqual([]);
    expect(store.roles()?.saveEnabled).toBe(false);
    await store.saveRoles();
    store.toggleRole(Role.Client);
    expect(store.roles()?.saveEnabled).toBe(false);
    await store.saveRoles();
    expect(admin.calls).toEqual([]);
    // A role the block does not show is never toggled.
    store.toggleRole(Role.Sysadmin);
    expect(ticked(store)).toEqual([Role.Client]);
  });

  it('keeps a refused act’s id for its retry, words the refusal, and mints anew once it lands', async () => {
    const forbidden = PipelineError.fromWire('functions/permission-denied', {
      errorCode: GovernanceErrorCode.RolesForbidden,
    });
    const admin = rolesAdminPortsOf(
      CoreResult.err(forbidden),
      changed([Role.Client, Role.Barber]),
    );
    const ids = rolesIds();
    const { store } = rolesRig({ admin, ids });
    await openedAs(store, ADMIN_VIEWER);
    store.toggleRole(Role.Barber);

    await store.saveRoles();
    expect(store.roles()?.line).toBe(
      'Нямаш права за това. Влез отново или питай администратора.',
    );
    expect(ticked(store)).toEqual([Role.Client, Role.Barber]);
    expect(store.roles()?.saveEnabled).toBe(true);

    await store.saveRoles();
    expect(admin.calls).toHaveLength(2);
    expect(admin.calls[0]).toBe(admin.calls[1]);
    expect(ids.minted).toEqual(['op-card-roles-0001']);
    expect(store.roles()?.line).toBe(SAVED_LINE);
  });

  it('after a failed revoke keeps the line and Save with the toggles unchanged, and Save re-sends the stored set', async () => {
    const admin = rolesAdminPortsOf(
      CoreResult.err(NOT_REVOKED),
      CoreResult.ok({
        targetUserId: UserId.of(GEORGI),
        roles: [Role.Client, Role.Barber],
        rolesChanged: false,
      }),
    );
    const ids = rolesIds();
    const { store } = rolesRig({ admin, ids });
    await openedAs(store, ADMIN_VIEWER);
    store.toggleRole(Role.Barber);

    await store.saveRoles();
    expect(store.roles()?.line).toBe(NOT_REVOKED_LINE);
    expect(ticked(store)).toEqual([Role.Client, Role.Barber]);
    expect(store.roles()?.saveEnabled).toBe(true);

    await store.saveRoles();
    expect(admin.calls).toHaveLength(2);
    expect(admin.calls[1]).toEqual({
      targetUserId: UserId.of(GEORGI),
      roles: [Role.Client, Role.Barber],
      operationId: 'op-card-roles-0001',
    });
    expect(ids.minted).toEqual(['op-card-roles-0001']);
    expect(store.roles()?.line).toBe(SAVED_LINE);
    expect(store.roles()?.saveEnabled).toBe(false);
  });

  it('never forgets a failed revoke: it outlives a re-open and another person, until a revoke succeeds', async () => {
    const admin = rolesAdminPortsOf(
      CoreResult.err(NOT_REVOKED),
      CoreResult.err(NOT_REVOKED),
      changed([Role.Client, Role.Barber]),
    );
    const { store } = rolesRig({ admin });
    await openedAs(store, ADMIN_VIEWER);
    store.toggleRole(Role.Barber);
    await store.saveRoles();

    // The same person again: the line and the retry stay.
    await openedAs(store, ADMIN_VIEWER);
    expect(store.roles()?.line).toBe(NOT_REVOKED_LINE);
    expect(store.roles()?.saveEnabled).toBe(true);

    // Another person: nothing pending for him.
    open(store, subjectOf(MARTIN), martinContext({ viewer: ADMIN_VIEWER }));
    await settle();
    expect(store.roles()?.line).toBeNull();
    expect(store.roles()?.saveEnabled).toBe(false);

    // Back to Георги: his retry comes back, the committed set ticked.
    await openedAs(store, ADMIN_VIEWER);
    expect(store.roles()?.line).toBe(NOT_REVOKED_LINE);
    expect(ticked(store)).toEqual([Role.Client, Role.Barber]);
    await store.saveRoles();
    expect(store.roles()?.line).toBe(NOT_REVOKED_LINE);
    await store.saveRoles();
    expect(admin.calls).toHaveLength(3);
    expect(new Set(admin.calls.map((call) => call.roles.join(',')))).toEqual(
      new Set(['client,barber']),
    );
    expect(store.roles()?.line).toBe(SAVED_LINE);

    // Revoked at last: a re-open forgets it.
    await openedAs(store, ADMIN_VIEWER);
    expect(store.roles()?.line).toBeNull();
  });

  it('asks once while a change is on its way, and drops the answer of a person no longer on the card', async () => {
    const pending: { release: (() => void) | null } = { release: null };
    const calls: RolesCall[] = [];
    const held: RolesAdminPorts = {
      setRoles: (call) => {
        calls.push(call);
        return new Promise((resolve) => {
          pending.release = () => resolve(changed([Role.Client, Role.Barber]));
        });
      },
    };
    const { store } = rolesRig({ admin: held });
    await openedAs(store, ADMIN_VIEWER);
    store.toggleRole(Role.Barber);

    const first = store.saveRoles();
    await store.saveRoles();
    store.toggleRole(Role.Admin);
    expect(calls).toHaveLength(1);
    expect(ticked(store)).toEqual([Role.Client, Role.Barber]);
    expect(store.roles()?.line).toBeNull();

    open(store, subjectOf(MARTIN), martinContext({ viewer: ADMIN_VIEWER }));
    must(pending.release, 'the held change')();
    await first;
    await settle();
    expect(store.roles()?.line).toBeNull();
    expect(store.roles()?.saveEnabled).toBe(false);
  });
});

/*
 * S-WS-F (security hardening): a walk-in with no account opens its card
 * keyed by the RECORD the search found or a stored WALK_IN seat carries —
 * the head, the admin's privacy block and the erasure state from the
 * record (S-L-19). The «Роли» block stays account-only.
 */
describe('ClientCardStore — a walk-in’s record: the privacy block (security hardening S-WS-F)', () => {
  const PRIVACY_FLAGS = { ...ALL_FLAGS, 'client.privacy': true };
  const ADMIN = { userId: UserId.of('dev-admin'), roles: [Role.Admin] };

  const EXPORTED: ClientPrivacyCall.Exported = {
    clientExportVersion: ClientPrivacyCall.EXPORT_VERSION,
    exportedCustomerId: WALK_IN_ID,
    exportedAtUtcMs: NOW_MS,
    exportDocumentCount: 1,
    exportByteCount: 21,
    exportJson: '{"clientExportVersion":1}',
  };
  const PREVIEW: ClientPrivacyCall.ErasurePreview = {
    ...ErasureCensus.EMPTY,
    erasureStatus: ErasureStatus.None,
    erasureRecordCount: 1,
    erasureVisitCount: 2,
    erasureSiblingCustomerIds: [],
  };
  const ERASED: ClientPrivacyCall.Erasure = {
    ...ErasureCensus.EMPTY,
    erasureStatus: ErasureStatus.Erased,
    erasureDone: true,
    erasureVisitCount: 2,
  };

  /** The three privacy callables, every call recorded by its name. */
  function recordingPrivacy(): ClientPrivacyGatewayPorts & {
    readonly calls: {
      readonly method: string;
      readonly call: ClientPrivacyCall;
    }[];
  } {
    const calls: { method: string; call: ClientPrivacyCall }[] = [];
    return {
      calls,
      exportClientData: async (call) => {
        calls.push({ method: 'exportClientData', call });
        return CoreResult.ok(EXPORTED);
      },
      previewClientErasure: async (call) => {
        calls.push({ method: 'previewClientErasure', call });
        return CoreResult.ok(PREVIEW);
      },
      eraseClient: async (call) => {
        calls.push({ method: 'eraseClient', call });
        return CoreResult.ok(ERASED);
      },
    };
  }

  function walkInRig(
    options: RigOptions & {
      readonly privacy?: ClientPrivacyGatewayPorts;
      readonly roles?: RolesAdminPorts;
    } = {},
  ) {
    const privacy = options.privacy ?? recordingPrivacy();
    let minted = 0;
    const ids: IdPorts = {
      nextId: () => `op-card-walk-in-${String((minted += 1)).padStart(4, '0')}`,
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: CLIENT_PRIVACY_PORTS, useValue: privacy },
        { provide: ID_PORTS, useValue: ids },
        ...(options.roles === undefined
          ? []
          : [{ provide: ROLES_ADMIN_PORTS, useValue: options.roles }]),
      ],
    });
    return rig({
      flags: PRIVACY_FLAGS,
      customers: customerPortsOf([...fixtureCustomers(), walkInRecord()]),
      ...options,
    });
  }

  async function openedAs(
    store: ClientCardStore,
    viewer: ClientCardContext['viewer'],
  ): Promise<void> {
    open(store, WALK_IN, martinContext({ isOwner: false, viewer }));
    await settle();
  }

  it('offers the shop’s admin the export and the erase row on the record, and no «Роли» block', async () => {
    const { store } = walkInRig({ roles: rolesAdminPortsOf() });
    await openedAs(store, ADMIN);
    expect(store.customerId()).toBe(WALK_IN_ID);
    expect(store.privacy()).toEqual({
      groupLabel: 'Лични данни',
      exportLabel: 'Изтегли данните',
      exportStatus: null,
    });
    const vm = must(store.erasure(), 'the erasure rows');
    expect(vm.eraseLabel).toBe('Изтрий личните данни');
    expect(vm.erasedLine).toBeNull();
    // Account-only: a record-keyed card shows no roles block.
    expect(store.roles()).toBeNull();
  });

  it('exports, previews and erases the RECORD by its id', async () => {
    const privacy = recordingPrivacy();
    const { store } = walkInRig({ privacy });
    await openedAs(store, ADMIN);

    expect(await store.exportData()).toEqual(EXPORTED);
    await store.previewErasure(WALK_IN_ID);
    expect(store.erasure()?.alert.open).toBe(true);
    await store.confirmErasure();

    expect(
      privacy.calls.map(({ method, call }) => [method, call.customerId]),
    ).toEqual([
      ['exportClientData', WALK_IN_ID],
      ['previewClientErasure', WALK_IN_ID],
      ['eraseClient', WALK_IN_ID],
    ]);
    expect(store.erasure()?.erasedLine).toBe('Изтрит клиент');
  });

  it('is absent for a barber, a receptionist, the sysadmin and no viewer', async () => {
    for (const viewer of [
      null,
      { userId: UserId.of('dev-barber'), roles: [Role.Barber] },
      { userId: UserId.of('dev-desk'), roles: [Role.Receptionist] },
      { userId: UserId.of('dev-sysadmin'), roles: [Role.Sysadmin] },
    ]) {
      const { store } = walkInRig();
      await openedAs(store, viewer);
      expect(store.customerId()).toBe(WALK_IN_ID);
      expect(store.privacy()).toBeNull();
      expect(store.erasure()).toBeNull();
      TestBed.resetTestingModule();
    }
  });

  it('is absent with the flag off, and offline until the network is back', async () => {
    const flagOff = walkInRig({ flags: ALL_FLAGS });
    await openedAs(flagOff.store, ADMIN);
    expect(flagOff.store.privacy()).toBeNull();
    TestBed.resetTestingModule();

    const { store } = walkInRig();
    await openedAs(store, ADMIN);
    window.dispatchEvent(new Event('offline'));
    expect(store.privacy()).toBeNull();
    expect(store.erasure()).toBeNull();
    window.dispatchEvent(new Event('online'));
    expect(store.privacy()).not.toBeNull();
  });

  it('words an ERASED record’s line from the record it read', async () => {
    const erased = ErasureLifecycle.complete(
      ErasureLifecycle.begin(NOW_MS),
      NOW_MS,
    );
    const { store } = walkInRig({
      customers: customerPortsOf([walkInRecord(erased)]),
    });
    await openedAs(store, ADMIN);
    expect(store.erasure()?.erasedLine).toBe('Изтрит клиент');
  });

  it('an absent record keeps the id — the export stays — and the erasure rows wait on a tag', async () => {
    const customers = customerPortsOf([]);
    const { store } = walkInRig({ customers });
    await openedAs(store, ADMIN);
    expect(customers.callsTo('loadCustomer')).toEqual([[WALK_IN_ID]]);
    expect(store.customerId()).toBe(WALK_IN_ID);
    expect(store.privacy()).not.toBeNull();
    expect(store.erasure()).toBeNull();
  });
});
