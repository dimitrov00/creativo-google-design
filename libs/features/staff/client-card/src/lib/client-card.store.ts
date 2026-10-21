import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  type Signal,
  type WritableSignal,
  computed,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import type { Subscription } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { AVATAR_UPLOADER } from '@creativo/application/accounts';
import type {
  Appointment,
  AppointmentPhoto,
  ClientMoneyRecord,
  ClientStatsRecord,
  GiftVoucher,
  User,
  WaitlistRequest,
} from '@core/entities';
import {
  type AppointmentId,
  CustomerId,
  RepositoryError,
  Result,
  type TimeZone,
  type UtcEpochMs,
  UserId,
  defect,
} from '@core/primitives';
import { Registration, type VisitFact } from '@core/components';
import { ZonedTimeSystem } from '@core/systems';
import {
  APPOINTMENT_PHOTO_PORTS,
  APPOINTMENT_READ_PORTS,
  CLIENT_STATS_READ_PORTS,
  COUPON_VOUCHER_PORTS,
  CUSTOMER_PORTS,
  PROFILE_PORTS,
  WAITLIST_READ_PORTS,
} from '@creativo/infrastructure/firebase-app';
import {
  type ActivityEntry,
  type ActivityKind,
  type BadgeProgress,
  LOYALTY_ACTIVITY_READER,
  LOYALTY_CATALOG_READER,
  LOYALTY_READER,
  type LoyaltyAccount,
  type LoyaltyCatalog,
  type SeasonProgress,
  type StreakDefinition,
  type StreakDefinitionSchedule,
  type StreakRuleSummary,
} from '@creativo/application/engagement';
import { CLOCK, FEATURE_FLAGS } from '@creativo/application/shared';
import {
  type VisitFilter,
  type VisitRowVm,
  firstNameOf,
  matchesVisitFilter,
} from '@creativo/features/shared/visits';
import {
  type AchievementsContext,
  achievementScopeOf,
  scopeTitleOf,
} from './achievements.presenter';
import type {
  ClientCardContext,
  ClientCardRegion,
  ClientCardSubject,
} from './client-card.contracts';
import { cardLocaleOf, dayShort, shopDayOf } from './client-card.format';
import {
  clientHeadVm,
  clientPhotoVm,
  displayNameOf,
  isBirthdayToday,
  isInChairToday,
  lastWorkedVisit,
  pauseOf,
  photoRailVm,
  quickActionsVm,
} from './client-card.presenter';
import type {
  AchievementsData,
  BirthdayVm,
  ClientHeadVm,
  ClientHeroVm,
  ClientOverviewVm,
  ClientPhotoVm,
  DetailActionVm,
  LedgerPageVm,
  RecordsPageVm,
  Slice,
  SliceStatus,
  VisitCardsVm,
  VisitsPageVm,
  WalletVm,
} from './client-pages.vm';
import {
  type ClientCardTranslate,
  type ClientCardWords,
  clientCardWordsOf,
} from './client-card.words';
import {
  birthdayVm,
  clientHeroVm,
  grantsBesideBirthday,
  loyaltyGlanceVm,
  medalsGlanceVm,
  overviewCapsulesVm,
  visitCardsVm,
} from './glance.presenter';
import {
  FILTER_REFILL_PAGES,
  FILTER_REFILL_ROWS,
  HISTORY_PAGE_SIZE,
  type HistoryRowsInput,
  historyFacts,
  historyRows,
} from './history.presenter';
import {
  LEDGER_PAGE_READ,
  ledgerPageVm,
  wholeMonthsOf,
} from './ledger.presenter';
import { type LoyaltyFlags, glanceReward } from './loyalty.presenter';
import { detailActionOf } from './medal-detail.presenter';
import { CHIP_ALL } from './medals.presenter';
import { recordsPageVm } from './records.presenter';
import {
  visitsPageBlank,
  visitsPageVm,
  visitsPaging,
} from './visits-page.presenter';
import { WALLET_ACTIVITY_READ, walletVm } from './wallet.presenter';

/** Every read settles within this, or counts as failed (§5.2.1). */
export const CLIENT_CARD_READ_TIMEOUT_MS = 10_000;

/** The past cuts one read asks for; the rail shows six of them (§3.1 I1). */
const PHOTOS_LIMIT = 12;

const SHOP_ZONE = 'Europe/Sofia';

/** The shop's zone, branded — where a stored shop day and minute are read back as an instant. */
const SHOP_TIME_ZONE: TimeZone = (() => {
  const zone = ZonedTimeSystem.checkZone(SHOP_ZONE);
  return zone.ok ? zone.value : defect('unreachable: the shop zone');
})();

/**
 * A worked visit's stored shop day and minute (Law 7.3) as the instant the
 * loyalty presenters (flip 3) still read — once, at this boundary, in the
 * shop's zone; a minute inside a spring-forward gap reads as the day's start.
 */
function factInstant(fact: VisitFact): number {
  const at = ZonedTimeSystem.toUtc(
    fact.localDate,
    fact.startMinutes,
    SHOP_TIME_ZONE,
  );
  return at.ok
    ? at.value
    : ZonedTimeSystem.startOfLocalDay(fact.localDate, SHOP_TIME_ZONE);
}

/**
 * A read's answer as the store settles it — the ecs-core ports' plain
 * `Result`, or a loyalty reader's (flip 3) `Success`/`Failure` class, which
 * the store reads through `settled` until that flip re-types them.
 */
type ReadAnswer<T> =
  | Result<T, unknown>
  | {
      isSuccess(): boolean;
      readonly value?: T;
      readonly error?: unknown;
    };

/** Either answer, as one plain `Result`. */
function settled<T>(answer: ReadAnswer<T>): Result<T, unknown> {
  if ('ok' in answer) return answer;
  return answer.isSuccess()
    ? Result.ok(answer.value as T)
    : Result.err(answer.error);
}

/** A read that did not answer in time (`CLIENT_CARD_READ_TIMEOUT_MS`), or threw. */
const READ_TIMED_OUT = RepositoryError.readFailed(null, 'timeout');
const READ_THREW = RepositoryError.readFailed(null, 'threw');

/** The history's pages as the store holds them. */
interface HistoryState {
  /** The FIRST page's read: the list's skeleton, its rows, or its retry notice. */
  readonly status: Slice<unknown>['status'];
  /** Every loaded visit, newest first, page after page. */
  readonly appointments: readonly Appointment[];
  /** Where the next page starts — the start instant it reads before; `null` = nothing older. */
  readonly cursor: UtcEpochMs | null;
  /** The «Покажи още» read. */
  readonly more: 'idle' | 'loading' | 'failed';
  /** Each loaded visit's own photos, counted, for the rows' marks. */
  readonly photoCounts: ReadonlyMap<string, number>;
}

const LOADING_HISTORY: HistoryState = {
  status: 'loading',
  appointments: [],
  cursor: null,
  more: 'idle',
  photoCounts: new Map(),
};

const EMPTY_HEAD: ClientHeadVm = {
  name: '',
  stateLine: null,
  avatarSrc: null,
  initialsFrom: '',
  paused: false,
};

/**
 * The ledger page «Движение» as the store holds it (revision 3 §2.2.6):
 * the pages read under the chosen pill. Another pill starts over from the
 * top; the pages of the pill before are not kept.
 */
interface LedgerState {
  readonly filter: ActivityKind;
  /** The FIRST page's read under the pill: the skeleton, the rows, or the retry notice. */
  readonly status: SliceStatus;
  /** Every loaded entry, newest first, page after page. */
  readonly entries: readonly ActivityEntry[];
  /** Where the next page starts (the oldest row's `seq`); `null` = nothing older. */
  readonly next: number | null;
  /** The «Покажи още» read. */
  readonly more: 'idle' | 'loading' | 'failed';
}

const LOADING_LEDGER: LedgerState = {
  filter: 'all',
  status: 'loading',
  entries: [],
  next: null,
  more: 'idle',
};

const EMPTY_HERO: ClientHeroVm = {
  name: '',
  line: null,
  tier: null,
  avatarSrc: null,
  initialsFrom: '',
  paused: false,
};

const EMPTY_OVERVIEW: ClientOverviewVm = {
  actions: [],
  canRemove: false,
  failed: [],
};

/**
 * A reward tile's picture is «the cover of the ONE service its coupon
 * names» (§2.2.2 WF). The domain's `Coupon` names no service (its value is
 * a percentage, an amount or «free service», with no id), and the card is
 * handed no coupon catalogue, so no reward can be given a cover from here:
 * every tile draws the reward glyph, as the presenter does for a reward
 * the map does not hold. One place to fill when a coupon learns its
 * service (contract delta S1-2).
 */
const NO_COVERS: ReadonlyMap<string, string> = new Map();

const LOADING: Slice<never> = { status: 'loading' };
const FAILED: Slice<never> = { status: 'failed' };

function statusOf(
  slice: Slice<unknown> | null,
): Slice<unknown>['status'] | null {
  return slice?.status ?? null;
}

function dataOf<T>(slice: Slice<T> | null): T | null {
  return slice?.status === 'ready' ? slice.data : null;
}

/**
 * `users/{uid}` as the card reads it: `PROFILE_PORTS.loadProfile` answers
 * the STORED body, and a `PROVISIONED` stub (an account that signed in
 * but never registered) is no profile — the card names no stub and dials
 * no stub's number, as before the identity flip (flip-2 plan §3.5).
 */
function registeredOnly(user: User | null): User | null {
  return user !== null && Registration.isRegistered(user) ? user : null;
}

/**
 * THE CLIENT CARD'S DATA (client-card-redesign §5.2.1) — everything the
 * visit sheet's client stack shows about one person: their profile, their
 * visits and photos, their loyalty. Provided by the visit editor and
 * resolved lazily, so nothing constructs it until a card opens.
 *
 * Every port is optional (a missing port is an absent slice) and every read
 * is a `Result` with a 10 s timeout that settles as failed. `users/{uid}`
 * is read first — the D-9 gate: nothing under the head paints before the
 * profile says whether the client is paused — then the rest in parallel.
 * The flags are read once; a flag off never reads its data. A re-open of
 * the same person refreshes without skeletons (the answers so far stay on
 * screen, and a refresh that fails keeps them); another person starts
 * over. The loyalty catalogue is read once for the store's life.
 *
 * The store holds data; the pure presenters word it. The pages that draw
 * the achievements compute their own VM from `achievementsData` and
 * `achievementsContext` (`medalsPageVm`, `medalScopeVm`,
 * `medalDetailVm`), so nothing here is re-created per change detection.
 */
@Injectable()
export class ClientCardStore {
  private readonly profiles = inject(PROFILE_PORTS, { optional: true });
  private readonly avatars = inject(AVATAR_UPLOADER, { optional: true });
  /**
   * The client RECORD of the account (D29) — read once per person; stats,
   * money, history, photos and vouchers are all keyed by it. Absent (no
   * port bound) reads as no record.
   */
  private readonly customers = inject(CUSTOMER_PORTS, { optional: true });
  private readonly statsReader = inject(CLIENT_STATS_READ_PORTS, {
    optional: true,
  });
  private readonly waitlistReader = inject(WAITLIST_READ_PORTS, {
    optional: true,
  });
  private readonly historyReader = inject(APPOINTMENT_READ_PORTS, {
    optional: true,
  });
  private readonly photosReader = inject(APPOINTMENT_PHOTO_PORTS, {
    optional: true,
  });
  private readonly loyaltyReader = inject(LOYALTY_READER, { optional: true });
  private readonly catalogReader = inject(LOYALTY_CATALOG_READER, {
    optional: true,
  });
  /** The gift vouchers a person holds (revision 3 §4.5): the wallet's holdings, the glance's voucher fact. */
  private readonly vouchersReader = inject(COUPON_VOUCHER_PORTS, {
    optional: true,
  });
  /** The journal as a feed (§4.7): the wallet's «Движение» and the ledger page. */
  private readonly activityReader = inject(LOYALTY_ACTIVITY_READER, {
    optional: true,
  });
  private readonly clock = inject(CLOCK, { optional: true });
  private readonly transloco = inject(TranslocoService);
  private readonly window = inject(DOCUMENT).defaultView;

  /** The loyalty flags, read once (`config/feature-flags.json`). */
  private readonly flags: LoyaltyFlags = (() => {
    const flags = inject(FEATURE_FLAGS, { optional: true });
    return {
      points: flags?.isEnabled('loyalty.points') ?? false,
      streaks: flags?.isEnabled('loyalty.streaks') ?? false,
      achievements: flags?.isEnabled('loyalty.achievements') ?? false,
      tiers: flags?.isEnabled('loyalty.tiers') ?? false,
    };
  })();

  /** Bumped by every `open`: an answer for an older one is dropped. */
  private generation = 0;
  /** Bumped by every ledger pill and every new person: a page read under an older pill is dropped. */
  private ledgerSequence = 0;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private waitlistSubscription: Subscription | null = null;
  /** The catalogue, once read — kept for the store's life (§5.2.1). */
  private catalogCache: LoyaltyCatalog | null = null;

  private readonly _subject = signal<ClientCardSubject | null>(null);
  /**
   * The subject's client record, once read: the id, `null` for an account
   * with no record yet (today's "no stats yet"), `undefined` before the
   * read has answered — or when it failed, so a retry reads it again.
   */
  private readonly _customerId = signal<CustomerId | null | undefined>(
    undefined,
  );
  /** The record's id as the rows key their story; `null` until it is known, or for none. */
  readonly customerId = computed<string | null>(
    () => this._customerId() ?? null,
  );
  private readonly _context = signal<ClientCardContext | null>(null);
  private readonly _nowMs = signal(0);
  private readonly _profile = signal<Slice<User | null> | null>(null);
  private readonly _stats = signal<Slice<ClientStatsRecord | null> | null>(
    null,
  );
  private readonly _avatar = signal<string | null>(null);
  private readonly _money = signal<ClientMoneyRecord | null>(null);
  private readonly _history = signal<HistoryState | null>(null);
  private readonly _waitlist = signal<Slice<readonly WaitlistRequest[]> | null>(
    null,
  );
  private readonly _photos = signal<Slice<readonly AppointmentPhoto[]> | null>(
    null,
  );
  private readonly _account = signal<Slice<LoyaltyAccount | null> | null>(null);
  private readonly _catalog = signal<Slice<LoyaltyCatalog> | null>(null);
  private readonly _progress = signal<Slice<readonly BadgeProgress[]> | null>(
    null,
  );
  private readonly _seasonProgress = signal<Slice<
    readonly SeasonProgress[]
  > | null>(null);
  private readonly _filter = signal<VisitFilter>('all');
  private readonly _online = signal(this.window?.navigator.onLine ?? true);
  /** The vouchers issued to the person, any state; `null` = not read. */
  private readonly _vouchers = signal<Slice<readonly GiftVoucher[]> | null>(
    null,
  );
  /** The wallet's feed: the journal's newest rows under «Всички»; `null` = not read. */
  private readonly _activity = signal<Slice<readonly ActivityEntry[]> | null>(
    null,
  );
  /** The ledger page's pages under its pill; `null` = not read (`loyalty.points` off, no reader, a guest). */
  private readonly _ledgerPage = signal<LedgerState | null>(null);
  /** The chip «Постижения» is open on (§2.3.3): the store's, so ‹ from a medal's detail returns to it. */
  private readonly _medalsChip = signal<string>(CHIP_ALL);

  /** The person the card is about; `null` before the first `open`. */
  readonly subject = this._subject.asReadonly();

  /** Follows `navigator.onLine` and its events. No "data from" time: the ports return no cache metadata. */
  readonly online = this._online.asReadonly();

  /**
   * The language the catalogue has loaded, once it has: `translate()` is
   * only ever asked of a loaded language, so no lookup here can start a
   * load (a write) from inside a `computed`.
   */
  private readonly loadedLang = toSignal(
    this.transloco.langChanges$.pipe(
      switchMap((lang) =>
        this.transloco.selectTranslation(lang).pipe(map(() => lang)),
      ),
    ),
    { initialValue: null },
  );

  /**
   * The catalogue's own reading in the loaded language, for the shared
   * sentence builders (`rhythmRuleWords` reads the `rhythmRule.*` keys
   * through it); `null` until the catalogue has loaded.
   */
  private readonly translate: Signal<ClientCardTranslate | null> = computed(
    () => {
      const lang = this.loadedLang();
      return lang === null
        ? null
        : (key, params) => this.transloco.translate(key, params, lang);
    },
  );

  /** The card's words in the active language; `null` until its catalogue has loaded. */
  readonly words: Signal<ClientCardWords | null> = computed(() => {
    const lang = this.loadedLang();
    const translate = this.translate();
    return lang === null || translate === null
      ? null
      : clientCardWordsOf(translate, lang);
  });

  private readonly user = computed(() => dataOf(this._profile()));
  private readonly stats = computed(() => dataOf(this._stats()));
  private readonly today = computed(() => shopDayOf(this._nowMs()));
  private readonly paused = computed(
    () => pauseOf(this.user(), this._nowMs()) !== null,
  );

  /** `users/{uid}` or `clientStats/{uid}` failed: the whole card's S7. */
  private readonly profileFailed = computed(
    () =>
      statusOf(this._profile()) === 'failed' ||
      statusOf(this._stats()) === 'failed',
  );

  /**
   * The D-9 gate: the profile and the stats have answered (a port that is
   * not bound counts as answered with nothing). Every module under the head
   * waits for it.
   */
  private readonly gateOpen = computed(() => {
    const profile = statusOf(this._profile());
    const stats = statusOf(this._stats());
    return (
      this._subject()?.userId != null &&
      (profile === null || profile === 'ready') &&
      (stats === null || stats === 'ready')
    );
  });

  /** The User name once read, else the seat's label (the bar title, the photo page). */
  readonly displayName = computed(() => {
    const subject = this._subject();
    return subject === null ? null : displayNameOf(subject, this.user());
  });

  /**
   * A — renders from the seat's snapshot at once, before the words have
   * loaded too (S1).
   *
   * @deprecated The hero (`hero`) is the head since revision 3; this one
   * stays only because the visit editor still reads `head().avatarSrc` for
   * the photo page (`staff-visit-editor.ts`, `pastCut`). It goes with that
   * line.
   */
  readonly head: Signal<ClientHeadVm> = computed(() => {
    const subject = this._subject();
    const words = this.words();
    if (subject === null) return EMPTY_HEAD;
    return clientHeadVm({
      subject,
      user: this.user(),
      settled: this.gateOpen(),
      stats: this.stats(),
      statsKnown: this._stats() !== null,
      avatarSrc: this._avatar(),
      nowMs: this._nowMs(),
      words,
    });
  });

  /**
   * What the staff rows are worded with — the built `historyRows` (by
   * year) and revision 3's `visitsRows` (by month) take the same input,
   * and the medal detail words its counted visits with it. `null` until
   * the card is open on an account, worded, and its history is read (in
   * any state: a loading history is an empty page of rows).
   */
  readonly visitRowsInput: Signal<HistoryRowsInput | null> = computed(() => {
    const subject = this._subject();
    const context = this._context();
    const history = this._history();
    const words = this.words();
    if (
      subject?.userId == null ||
      context === null ||
      history === null ||
      words === null
    ) {
      return null;
    }
    return {
      appointments: history.appointments,
      subjectUserId: subject.userId,
      subjectCustomerId: this._customerId() ?? null,
      currentAppointmentId: context.appointmentId,
      nowMs: this._nowMs(),
      photoCounts: history.photoCounts,
      clientWords: !context.viewer.roles.includes('sysadmin'),
      catalog: context.catalog,
      words,
    };
  });

  /** Every loaded visit as a staff row (the built history page's list, before the filter). */
  private readonly historyRowVms = computed((): readonly VisitRowVm[] => {
    const input = this.visitRowsInput();
    return input === null ? [] : historyRows(input);
  });

  /** The featured visit's id — its photos ride its card, so the rail leaves them out. */
  private readonly featuredVisitId = computed(() => {
    const context = this._context();
    const history = this._history();
    const subject = this._subject();
    const words = this.words();
    if (
      context === null ||
      history?.status !== 'ready' ||
      subject?.userId == null ||
      words === null
    ) {
      return null;
    }
    const byId = new Map(this.historyRowVms().map((row) => [row.id, row]));
    const featured = lastWorkedVisit(
      history.appointments,
      (appointment) => byId.get(appointment.id) as VisitRowVm,
      context.appointmentId,
    );
    return featured?.appointment.id ?? null;
  });

  /** The tier capsule's inputs: `null` = no capsule, `'loading'` = not known yet. */
  private readonly tierInputs = computed(
    ():
      | { readonly account: LoyaltyAccount; readonly catalog: LoyaltyCatalog }
      | null
      | 'loading' => {
      if (!this.flags.tiers) return null;
      const account = this._account();
      const catalog = this._catalog();
      if (account === null || catalog === null) return null;
      if (account.status === 'loading' || catalog.status === 'loading') {
        return 'loading';
      }
      const loaded = dataOf(account);
      const table = dataOf(catalog);
      return loaded === null || table === null
        ? null
        : { account: loaded, catalog: table };
    },
  );

  /**
   * The visits the rhythm reads: the stats' worked visits of the last year,
   * each a shop day and minute (Law 7.3), read back as the instant the
   * loyalty presenters (flip 3) still take — once, here, in the shop's zone.
   */
  private readonly visitsMs = computed(
    () => this.stats()?.last365VisitsCompleted.map(factInstant) ?? [],
  );

  /**
   * What each worked visit on the loaded history was, by its shop day —
   * the rows' own titles («Фейд, Оформяне на брада»), so a ledger row names
   * its visit the way the history does. Two worked visits on one day are
   * named together.
   */
  private readonly visitTitles = computed((): ReadonlyMap<string, string> => {
    const titles = new Map<string, string[]>();
    for (const row of this.historyRowVms()) {
      if (row.kind !== 'visit' || row.outcome !== 'worked') continue;
      const day = shopDayOf(row.startMs);
      titles.set(day, [...(titles.get(day) ?? []), row.title]);
    }
    return new Map(
      [...titles].map(([day, rows]) => [day, [...new Set(rows)].join(', ')]),
    );
  });

  private readonly inChairToday = computed(() => {
    const context = this._context();
    return context !== null && isInChairToday(context, this._nowMs());
  });

  /**
   * What the «Постижения» pages compute from: the catalogue, the account,
   * the family and season progress. `null` with `loyalty.achievements` off,
   * for a guest, without the readers, and for a client with no account.
   */
  readonly achievementsData: Signal<Slice<AchievementsData> | null> = computed(
    () => {
      if (!this.flags.achievements) return null;
      const account = this._account();
      const catalog = this._catalog();
      const progress = this._progress();
      const seasons = this._seasonProgress();
      if (
        account === null ||
        catalog === null ||
        progress === null ||
        seasons === null
      ) {
        return null;
      }
      if (this.profileFailed()) return FAILED;
      const parts = [account, catalog, progress, seasons];
      if (parts.some((part) => part.status === 'failed')) {
        return account.status === 'ready' && account.data === null
          ? null
          : FAILED;
      }
      if (!this.gateOpen() || parts.some((part) => part.status === 'loading')) {
        return LOADING;
      }
      const loadedAccount = dataOf(account);
      const loadedCatalog = dataOf(catalog);
      if (loadedAccount === null || loadedCatalog === null) return null;
      return {
        status: 'ready',
        data: {
          catalog: loadedCatalog,
          account: loadedAccount,
          progress: new Map(
            (dataOf(progress) ?? []).map((p) => [p.seriesId, p]),
          ),
          seasonProgress: new Map(
            (dataOf(seasons) ?? []).map((p) => [p.seasonId, p]),
          ),
          today: this.today(),
          previousVisitAtMs: this.previousVisitAtMs(),
        },
      };
    },
  );

  /** The start of the client's last worked visit before the one on screen — what «Ново» is measured from. */
  private readonly previousVisitAtMs = computed(() => {
    const stats = this.stats();
    const current = this._context()?.appointmentId ?? null;
    if (stats === null) return null;
    let latest: number | null = null;
    for (const fact of stats.last365VisitsCompleted) {
      if (fact.appointmentId === current) continue;
      const at = factInstant(fact);
      if (latest === null || at > latest) latest = at;
    }
    if (latest !== null) return latest;
    return stats.lastVisitAppointmentId !== null &&
      stats.lastVisitAppointmentId !== current &&
      stats.lastVisitLocalDate !== null &&
      stats.lastVisitStartMinutes !== null
      ? factInstant({
          appointmentId: stats.lastVisitAppointmentId,
          localDate: stats.lastVisitLocalDate,
          startMinutes: stats.lastVisitStartMinutes,
        })
      : null;
  });

  /** The presenters' context for the achievements pages; `null` until a card is open and worded. */
  readonly achievementsContext: Signal<AchievementsContext | null> = computed(
    () => {
      const context = this._context();
      const words = this.words();
      const name = this.displayName();
      if (context === null || words === null || name === null) return null;
      const open = context.appointmentId !== null && !context.settled;
      return {
        words,
        catalog: context.catalog,
        subjectName: name,
        visit: open
          ? {
              legs: context.legs,
              locationId: context.locationId,
              birthdayToday: isBirthdayToday(this.user(), this.today()),
            }
          : null,
      };
    },
  );

  // ── Revision 3: the re-drawn pages (§4.9) ──────────────────────────────
  //
  // Each page's model is composed from the presenter files over the slices
  // above. The built `glance`, `loyalty` and `history` went with their
  // bodies in W4; `head` stays until the visit editor reads `hero` instead.

  /**
   * A — the centred hero: the face and the name from the seat at once; the
   * line, the plate and the ring once the gate opens. The plate needs the
   * account and the catalogue (`loyalty.tiers`): until they have answered
   * the face stands without it, and a paused client's warning ring is
   * never kept waiting on them.
   */
  readonly hero: Signal<ClientHeroVm> = computed(() => {
    const subject = this._subject();
    if (subject === null) return EMPTY_HERO;
    const tier = this.tierInputs();
    return clientHeroVm({
      subject,
      user: this.user(),
      settled: this.gateOpen(),
      stats: this.stats(),
      statsKnown: this._stats() !== null,
      avatarSrc: this._avatar(),
      nowMs: this._nowMs(),
      words: this.words(),
      tier: tier === 'loading' ? null : tier,
    });
  });

  /**
   * A held reward can be spent on THIS visit now: the subject owns it, the
   * device is online, the visit is not gone and the client is not paused
   * (the built «Лоялност» page's gate, named once).
   */
  private readonly rewardsUsable = computed(() => {
    const context = this._context();
    return (
      context !== null &&
      context.isOwner &&
      this._online() &&
      !context.gone &&
      !this.paused()
    );
  });

  /**
   * BD — the birthday card, once the profile has answered (a birthday is
   * never promised by a skeleton); `null` on any other day, for a guest and
   * without a date of birth. The gift rides it only where a reward can be
   * spent: a companion's, an offline, a gone or a paused card keeps the
   * band alone.
   */
  private readonly birthday = computed((): BirthdayVm | null => {
    const context = this._context();
    const words = this.words();
    if (
      context === null ||
      words === null ||
      this._subject()?.userId == null ||
      !this.gateOpen()
    ) {
      return null;
    }
    const usable = this.rewardsUsable();
    return birthdayVm({
      user: this.user(),
      today: this.today(),
      grants: usable ? context.grants : [],
      grantsOnBill: usable ? context.grantsOnBill : [],
      words,
    });
  });

  /** E beside BD: the ready reward, less the gift the birthday card carries today (§2.1.2). */
  private readonly rewardBesideBirthday = computed(() => {
    const context = this._context();
    const words = this.words();
    if (context === null || words === null) return null;
    const birthday = this.birthday();
    return glanceReward(
      grantsBesideBirthday(context.grants, birthday),
      this.today(),
      words,
      grantsBesideBirthday(context.grantsOnBill, birthday),
    );
  });

  /**
   * The glance under the hero (§2.1): each module's `Slice`, an absent key
   * an absent module, the birthday card as a fact of the day, and the
   * regions whose read failed. The built `glance`'s gates, module for
   * module; what changed is what each module is made of.
   */
  readonly overview: Signal<ClientOverviewVm> = computed(() => {
    const subject = this._subject();
    const context = this._context();
    const words = this.words();
    if (subject === null || context === null || words === null) {
      return EMPTY_OVERVIEW;
    }
    const online = this._online();
    const nowMs = this._nowMs();
    const user = this.user();
    const stats = this.stats();
    const name = this.displayName() ?? subject.label;
    const actions = quickActionsVm({
      subject,
      user,
      name,
      stats,
      context,
      online,
      nowMs,
      words,
    });
    const canRemove = online && !context.gone;
    if (subject.userId === null) return { actions, canRemove, failed: [] };
    if (this.profileFailed()) {
      return { actions, canRemove, failed: ['profile'] };
    }
    const gate = this.gateOpen();
    const failed: ClientCardRegion[] = [];
    const overview: {
      -readonly [K in keyof ClientOverviewVm]: ClientOverviewVm[K];
    } = { actions, canRemove, failed };

    // B — warnings and tags only: no tier (the plate says it), no birthday
    // (the card does), so the row waits for the gate alone.
    if (!gate) {
      overview.capsules = LOADING;
    } else {
      const capsules = overviewCapsulesVm({ user, stats, nowMs, words });
      if (capsules.shown.length > 0) {
        overview.capsules = { status: 'ready', data: capsules };
      }
    }

    // BD
    const birthday = this.birthday();
    if (birthday !== null) overview.birthday = birthday;

    // E — as built, less the gift the birthday card carries today.
    if (
      context.isOwner &&
      context.grants.length + context.grantsOnBill.length > 0 &&
      online &&
      !context.gone
    ) {
      if (!gate) {
        overview.reward = LOADING;
      } else if (!this.paused()) {
        const reward = this.rewardBesideBirthday();
        if (reward !== null) {
          overview.reward = { status: 'ready', data: reward };
        }
      }
    }

    // H — the three cards
    const visits = this.visitCardsSlice(gate);
    if (visits !== undefined) {
      overview.visits = visits;
      if (visits.status === 'failed') failed.push('visits');
    }

    // F — one card: the points, what they buy, what else is held.
    const loyalty = this.loyaltyGlanceSlice(
      gate,
      [...context.grants, ...context.grantsOnBill].map((grant) => grant.title),
    );
    if (loyalty !== undefined) {
      overview.loyalty = loyalty;
      if (loyalty.status === 'failed') failed.push('loyalty');
    }

    // G — the medals and the records' line
    const medals = this.medalsGlanceSlice(gate);
    if (medals !== undefined) {
      overview.medals = medals;
      if (medals.status === 'failed') failed.push('achievements');
    }

    // I — as built: waits for the featured visit, whose photos it leaves out.
    const photos = this._photos();
    if (photos !== null) {
      const history = this._history();
      if (
        !gate ||
        photos.status === 'loading' ||
        history?.status === 'loading'
      ) {
        overview.photos = LOADING;
      } else if (photos.status === 'failed') {
        overview.photos = FAILED;
        failed.push('photos');
      } else {
        const rail = photoRailVm(
          photos.data,
          [this.featuredVisitId(), context.appointmentId],
          nowMs,
          words,
        );
        if (rail.length > 0) overview.photos = { status: 'ready', data: rail };
      }
    }
    return overview;
  });

  /** H — the built module's gates over the three cards: the list, then the waitlist and the photos the cards carry. */
  private visitCardsSlice(gate: boolean): Slice<VisitCardsVm> | undefined {
    const subject = this._subject();
    const context = this._context();
    const words = this.words();
    const history = this._history();
    if (
      subject?.userId == null ||
      context === null ||
      words === null ||
      history === null
    ) {
      return undefined;
    }
    if (!gate || history.status === 'loading') return LOADING;
    if (history.status === 'failed') return FAILED;
    const waitlist = this._waitlist();
    const photos = this._photos();
    const settled = (slice: Slice<unknown> | null) =>
      slice === null || slice.status !== 'loading';
    if (!settled(waitlist) || !settled(photos)) return LOADING;
    return {
      status: 'ready',
      data: visitCardsVm({
        appointments: history.appointments,
        subjectUserId: subject.userId,
        subjectCustomerId: this._customerId() ?? null,
        context,
        photos: dataOf(photos) ?? [],
        waitlist: dataOf(waitlist),
        paused: this.paused(),
        count: this.stats()?.lifetimeVisitsCompleted ?? 0,
        clientWords: !context.viewer.roles.includes('sysadmin'),
        nowMs: this._nowMs(),
        words,
      }),
    };
  }

  /**
   * F — the built tiles' gates, and two more reads the one card waits for
   * so its holdings line lands once: the vouchers (a failed read is no
   * voucher fact; the wallet says so) and, for the rhythm's fact, the
   * catalogue that holds the rule.
   */
  private loyaltyGlanceSlice(
    gate: boolean,
    heldRewards: readonly string[],
  ): ClientOverviewVm['loyalty'] {
    const flags = this.flags;
    if (!flags.points && !flags.achievements && !flags.streaks) {
      return undefined;
    }
    const account = this._account();
    const words = this.words();
    if (account === null || words === null) return undefined;
    const catalog = this._catalog();
    const vouchers = this._vouchers();
    if (!gate || account.status === 'loading') return LOADING;
    if (account.status === 'failed') return FAILED;
    if (account.data === null) return undefined;
    if (flags.points && catalog?.status === 'loading') return LOADING;
    if (flags.points && catalog?.status === 'failed') return FAILED;
    if (vouchers?.status === 'loading') return LOADING;
    if (flags.streaks && catalog?.status === 'loading') return LOADING;
    const vm = loyaltyGlanceVm({
      account: account.data,
      catalog: dataOf(catalog),
      flags,
      visitsMs: this.visitsMs(),
      lifetimeVisits: this.stats()?.lifetimeVisitsCompleted ?? null,
      inChairToday: this.inChairToday(),
      paused: this.paused(),
      today: this.today(),
      words,
      heldRewards,
      vouchers: dataOf(vouchers),
      ruleInForce: this.ruleInForce(),
    });
    return vm === null ? undefined : { status: 'ready', data: vm };
  }

  /** G — the built module's gates over the medals in their rings and the records' line. */
  private medalsGlanceSlice(gate: boolean): ClientOverviewVm['medals'] {
    const data = this.achievementsData();
    const ctx = this.achievementsContext();
    if (data === null || ctx === null) return undefined;
    if (!gate || data.status === 'loading') return LOADING;
    if (data.status === 'failed') return FAILED;
    const vm = medalsGlanceVm(data.data, ctx);
    return vm === null ? undefined : { status: 'ready', data: vm };
  }

  /**
   * The catalogue's rhythm (§4.1): the first schedule the account holds a
   * state for, else the catalogue's first — the built `defaultStreakOf`'s
   * choice, over the schedules. `null` before the catalogue and in a shop
   * without a rhythm.
   */
  private readonly rhythmSchedule = computed(
    (): StreakDefinitionSchedule | null => {
      const catalog = dataOf(this._catalog());
      if (catalog === null) return null;
      const held = new Set(Object.keys(dataOf(this._account())?.streaks ?? {}));
      return (
        catalog.streakSchedules.find((schedule) => held.has(schedule.id)) ??
        catalog.streakSchedules[0] ??
        null
      );
    },
  );

  /**
   * The rule the rhythm is judged by today; `null` with `loyalty.streaks`
   * off, before the catalogue, and in a shop without a rhythm. A rule that
   * is switched OFF is still handed over: every presenter asks it.
   */
  private readonly ruleInForce = computed((): StreakDefinition | null =>
    this.flags.streaks
      ? (this.rhythmSchedule()?.inForceOn(this.today()) ?? null)
      : null,
  );

  /** The rule that waits for its day (`scheduled`, while `effectiveFrom` is ahead); `null` with nothing scheduled. */
  private readonly ruleUpcoming = computed((): StreakDefinition | null =>
    this.flags.streaks
      ? (this.rhythmSchedule()?.upcomingOn(this.today())?.definition ?? null)
      : null,
  );

  /** The rule in force, summarised, for the medal detail's rhythm family (`rhythmRuleWords`); `null` as `ruleInForce` is. */
  readonly rhythmRule: Signal<StreakRuleSummary | null> = computed(
    () => this.ruleInForce()?.summary() ?? null,
  );

  /**
   * A worked visit's services by its APPOINTMENT id and by its shop day
   * (a ledger row asks for its appointment first, then for its day): the
   * rows' own titles, so the feed names a visit the way the history does.
   */
  private readonly visitNames = computed((): ReadonlyMap<string, string> => {
    const names = new Map<string, string>(this.visitTitles());
    for (const row of this.historyRowVms()) {
      if (row.kind === 'visit' && row.outcome === 'worked') {
        names.set(row.id, row.title);
      }
    }
    return names;
  });

  /**
   * Who worked a visit, under the same keys — the row's trailing face, by
   * FIRST NAME, as every fact line of the card names him («12.09 · Иван»:
   * the glance's visit card, the history rows; «Иван Колев» in the
   * activity rows named one person two ways a swipe apart, review 3,
   * round 2); two worked visits on one day name their barbers together.
   * «2 бръснари» is a count, not a name, and stays whole.
   */
  private readonly visitBarbers = computed((): ReadonlyMap<string, string> => {
    const barbers = new Map<string, string>();
    const byDay = new Map<string, string[]>();
    for (const row of this.historyRowVms()) {
      if (
        row.kind !== 'visit' ||
        row.outcome !== 'worked' ||
        row.trailing?.kind !== 'barber'
      ) {
        continue;
      }
      const name = row.trailing.several
        ? row.trailing.name
        : firstNameOf(row.trailing.name);
      barbers.set(row.id, name);
      const day = shopDayOf(row.startMs);
      byDay.set(day, [...(byDay.get(day) ?? []), name]);
    }
    for (const [day, names] of byDay) {
      barbers.set(day, [...new Set(names)].join(', '));
    }
    return barbers;
  });

  /**
   * «Лоялност» as a wallet (§2.2) — `null` when every loyalty flag is off,
   * for a guest, without a loyalty reader, and for a client with no
   * account (the page is unreachable then: the glance draws no F). The
   * built page's gates; the vouchers' and the feed's reads ride inside
   * (each section follows its own, §2.2.4).
   */
  readonly wallet: Signal<Slice<WalletVm> | null> = computed(() => {
    const flags = this.flags;
    if (
      !flags.points &&
      !flags.streaks &&
      !flags.achievements &&
      !flags.tiers
    ) {
      return null;
    }
    const account = this._account();
    const context = this._context();
    const words = this.words();
    const translate = this.translate();
    if (
      account === null ||
      context === null ||
      words === null ||
      translate === null
    ) {
      return null;
    }
    if (this.profileFailed()) return FAILED;
    if (!this.gateOpen() || account.status === 'loading') return LOADING;
    if (account.status === 'failed') return FAILED;
    if (account.data === null) return null;
    const usable = this.rewardsUsable();
    const catalog = context.catalog;
    const stats = this.stats();
    return {
      status: 'ready',
      data: walletVm({
        account: account.data,
        catalog: this._catalog(),
        flags,
        paused: this.paused(),
        usableGrants: usable ? context.grants : [],
        usableGrantsOnBill: usable ? context.grantsOnBill : [],
        visitsMs: this.visitsMs(),
        lifetimeVisits: stats?.lifetimeVisitsCompleted ?? null,
        visitTitles: this.visitNames(),
        visitBarbers: this.visitBarbers(),
        inChairToday: this.inChairToday(),
        today: this.today(),
        words,
        holder: this.displayName(),
        sinceDay: stats?.firstVisitLocalDate ?? null,
        vouchers: this._vouchers(),
        activity: this._activity(),
        ruleInForce: this.ruleInForce(),
        ruleUpcoming: this.ruleUpcoming(),
        online: this._online(),
        isOwner: context.isOwner,
        visitGone: context.gone,
        covers: NO_COVERS,
        translate,
        // A counted service by its id; the card's catalogue names no
        // category by id, so a rule that counts categories says nothing
        // about them (V3-1: nothing breaks).
        nameOf: (id) => catalog.serviceName(id),
      }),
    };
  });

  /**
   * «Движение», the ledger page (§2.2.6): the pill, its pages, the foot.
   * Its line needs the balance, so the page waits for the account as the
   * wallet does; a page that is not read (`loyalty.points` off, no reader,
   * a guest, no account) is unreachable and reads as failed, the built
   * history's rule for a list without its reader.
   */
  readonly ledger: Signal<LedgerPageVm> = computed(() => {
    const words = this.words();
    const state = this._ledgerPage();
    const account = this._account();
    const filter = state?.filter ?? 'all';
    const blank = (status: SliceStatus): LedgerPageVm => ({
      status,
      subline: [],
      filter,
      groups: [],
      paging: null,
    });
    if (words === null || this._subject()?.userId == null) {
      return blank('loading');
    }
    if (state === null || account === null) return blank('failed');
    if (this.profileFailed()) return blank('failed');
    if (!this.gateOpen() || account.status === 'loading') {
      return blank('loading');
    }
    if (account.status === 'failed' || account.data === null) {
      return blank('failed');
    }
    return ledgerPageVm({
      status: state.status,
      entries: state.entries,
      next: state.next,
      loadingMore: state.more === 'loading',
      failedMore: state.more === 'failed',
      filter: state.filter,
      holder: this.displayName() ?? '',
      balance: account.data.balance,
      online: this._online(),
      visitTitles: this.visitNames(),
      visitBarbers: this.visitBarbers(),
      catalog: dataOf(this._catalog()),
      today: this.today(),
      wholeMonths: wholeMonthsOf(state.entries, state.next === null),
      words,
    });
  });

  /** The chip «Постижения» is open on; `all` at open and for every new person. */
  readonly medalsChip: Signal<string> = this._medalsChip.asReadonly();

  /**
   * «Рекорди» (§2.3.4) — follows `achievementsData` (`null` with
   * `loyalty.achievements` off, for a guest, without the readers, and for
   * a client with no account), computed over the history's loaded pages.
   */
  readonly records: Signal<Slice<RecordsPageVm> | null> = computed(() => {
    const data = this.achievementsData();
    const ctx = this.achievementsContext();
    if (data === null || ctx === null) return null;
    if (data.status !== 'ready') return data;
    return {
      status: 'ready',
      data: recordsPageVm({
        data: data.data,
        ctx,
        stats: this.stats(),
        ruleInForce: this.ruleInForce(),
        visits: this.loadedVisits(),
        historyComplete: this.historyComplete(),
      }),
    };
  });

  /**
   * «Посещения» (§2.5) — the two quiet lines and the shared browser's
   * input, by month. The built `history`'s gates: the first page's read,
   * behind the profile's; before the words or the subject the page is
   * blank, without a reader it has failed.
   */
  readonly visits: Signal<VisitsPageVm> = computed(() => {
    const words = this.words();
    const history = this._history();
    const filter = this._filter();
    const rows = this.visitRowsInput();
    if (words === null || this._subject()?.userId == null) {
      return visitsPageBlank('loading', filter);
    }
    if (history === null || rows === null) {
      return visitsPageBlank('failed', filter);
    }
    const status: SliceStatus =
      this.profileFailed() || history.status === 'failed'
        ? 'failed'
        : !this.gateOpen() || history.status === 'loading'
          ? 'loading'
          : 'ready';
    const stats = this.stats();
    return visitsPageVm({
      status,
      rows,
      filter,
      stats,
      spend: historyFacts(stats, this._money(), words).spend,
      paging: visitsPaging({
        cursor: history.cursor,
        more: history.more,
        online: this._online(),
        stats,
        words,
      }),
    });
  });

  /** The history's loaded pages, newest first: `countsToward` and «По години» read them. */
  readonly loadedVisits: Signal<readonly Appointment[]> = computed(
    () => this._history()?.appointments ?? [],
  );

  /** The loaded pages are the client's WHOLE history: read, and no cursor left. */
  readonly historyComplete: Signal<boolean> = computed(() => {
    const history = this._history();
    return history?.status === 'ready' && history.cursor === null;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    const window = this.window;
    if (window !== null) {
      const online = () => this._online.set(true);
      const offline = () => this._online.set(false);
      window.addEventListener('online', online);
      window.addEventListener('offline', offline);
      destroyRef.onDestroy(() => {
        window.removeEventListener('online', online);
        window.removeEventListener('offline', offline);
      });
    }
    destroyRef.onDestroy(() => {
      this.generation += 1;
      this.waitlistSubscription?.unsubscribe();
      for (const timer of this.timers) clearTimeout(timer);
      this.timers.clear();
    });
  }

  /**
   * Opens the card on a person. Idempotent per subject id: a re-open of the
   * same person refreshes every read without skeletons; another person
   * starts over. Reads nothing for a guest.
   */
  open(subject: ClientCardSubject, context: ClientCardContext): void {
    untracked(() => {
      const same = this._subject()?.id === subject.id;
      this._subject.set(subject);
      this._context.set(context);
      this._nowMs.set(this.readNow());
      this.generation += 1;
      if (!same) this.reset(subject);
      if (subject.userId !== null) {
        void this.loadAll(this.generation, subject.userId);
      }
    });
  }

  /** «Покажи още»: the next page of the history (a no-op offline, at the end, or while one is loading). */
  loadMoreHistory(): void {
    void this.fetchMore();
  }

  /**
   * Narrows the history in memory; when the filter leaves fewer than ten
   * rows and older pages remain, up to three more are fetched on the same
   * tap (§3.6).
   */
  setHistoryFilter(filter: VisitFilter): void {
    untracked(() => this._filter.set(filter));
    void this.refill(filter);
  }

  /**
   * «Движение»'s pill: the first page under the kind is read from the top
   * (older pages of the pill before are not kept). Choosing the pill in
   * force again does nothing — unless its first page failed, when it reads
   * again. A no-op before the page is read at all.
   */
  setLedgerFilter(kind: ActivityKind): void {
    untracked(() => {
      const state = this._ledgerPage();
      const uid = this._subject()?.userId ?? null;
      if (state === null || uid === null) return;
      if (state.filter === kind && state.status !== 'failed') return;
      this._ledgerPage.set({ ...LOADING_LEDGER, filter: kind });
      void this.readLedgerPage(this.generation, uid, kind);
    });
  }

  /** «Покажи още» on the ledger page: the next page under the pill (a no-op offline, at the end, or while one is loading). */
  loadMoreLedger(): void {
    void this.fetchMoreLedger();
  }

  /** The chip «Постижения» opens on (`all`, `seasons`, a category's id): the glance's and a detail's «Всички ›» choose it before the push (§5.2). */
  setMedalsChip(id: string): void {
    untracked(() => this._medalsChip.set(id));
  }

  /**
   * The dock's verb on a medal's page (§5.2, DV-C): «Добави фейд» while the
   * family is about a service the shop offers, the visit on screen can be
   * edited (open, online, not gone, the client not paused), this person's
   * services lack it and the family can still move. `null` otherwise: the
   * dock draws ✓ alone. Read inside the editor's `computed`.
   */
  detailAction(seriesId: string): DetailActionVm | null {
    const data = dataOf(this.achievementsData());
    const ctx = this.achievementsContext();
    const context = this._context();
    if (data === null || ctx === null || context === null) return null;
    const series = data.catalog.series(seriesId);
    if (series === null) return null;
    return detailActionOf(
      series,
      ctx,
      {
        online: this._online(),
        visitGone: context.gone,
        paused: this.paused(),
      },
      data,
    );
  }

  /** Reads a failed region again — its failed parts only; `profile` reads the whole card again. */
  retry(region: ClientCardRegion): void {
    untracked(() => {
      const userId = this._subject()?.userId ?? null;
      if (userId === null) return;
      const generation = this.generation;
      const failed = (slice: Slice<unknown> | null) =>
        slice?.status === 'failed';
      // Behind a failed gate nothing else was read: any retry is the
      // profile's (the pages' own notices land here too).
      const scope = this.profileFailed() ? 'profile' : region;
      switch (scope) {
        case 'profile':
          this.generation += 1;
          if (failed(this._profile())) this._profile.set(LOADING);
          if (failed(this._stats())) this._stats.set(LOADING);
          void this.loadAll(this.generation, userId);
          return;
        case 'visits':
        case 'history':
          if (this._history()?.status === 'failed') {
            void this.withRecord(generation, userId, (record) =>
              this.loadFirstPage(generation, record),
            );
          } else if (
            region === 'history' &&
            this._history()?.more === 'failed'
          ) {
            void this.fetchMore();
          }
          if (failed(this._waitlist())) this.watchWaitlist(generation, userId);
          return;
        case 'photos':
          if (failed(this._photos())) {
            void this.withRecord(generation, userId, (record) =>
              this.loadPhotos(generation, record),
            );
          }
          return;
        case 'loyalty':
        case 'achievements':
          this.loadLoyalty(generation, userId, true);
          if (failed(this._catalog())) void this.loadCatalog();
          return;
        case 'vouchers':
          if (failed(this._vouchers())) {
            void this.withRecord(generation, userId, (record) =>
              this.loadVouchers(generation, record),
            );
          }
          return;
        case 'activity':
          if (failed(this._activity())) void this.loadFeed(generation, userId);
          if (this._ledgerPage()?.status === 'failed') {
            this.loadLedgerFirst(generation, userId);
          } else if (this._ledgerPage()?.more === 'failed') {
            void this.fetchMoreLedger();
          }
          return;
      }
    });
  }

  /** One past cut for the read-only `photo` page (the editor maps it to its own photo type). */
  photoById(photoId: string): ClientPhotoVm | null {
    const photos = dataOf(this._photos());
    const words = this.words();
    const photo = photos?.find((p) => p.id === photoId);
    return photo === undefined || words === null
      ? null
      : clientPhotoVm(photo, this._nowMs(), words);
  }

  /**
   * The compact title of a page in the client stack: the person on
   * `client`, the page's name on the three module pages, the scope's or
   * the family's title on `achievementCategory` / `achievementDetail`, the
   * date on a `photo`. `null` for a kind the card does not title, or data
   * not loaded yet.
   */
  barTitle(kind: string, subjectId: string | null): string | null {
    const words = this.words();
    if (words === null) return null;
    switch (kind) {
      case 'client':
        return this.displayName();
      case 'clientLoyalty':
        return words.loyalty.title;
      case 'clientAchievements':
        return words.achievements.title;
      case 'clientHistory':
        return words.visitsModule.title;
      case 'clientLedger':
        return words.ledgerPage.title;
      case 'clientRecords':
        return words.achievements.records;
      case 'achievementCategory': {
        const scope = subjectId === null ? null : achievementScopeOf(subjectId);
        if (scope === null) return null;
        const data = dataOf(this.achievementsData());
        if (data !== null) return scopeTitleOf(data, scope, words);
        if (scope.kind === 'archive') return words.achievements.archive;
        if (scope.kind === 'day') {
          return words.achievements.dayTitle(
            dayShort(scope.day, this.today(), words.lang),
          );
        }
        return null;
      }
      case 'achievementDetail': {
        const data = dataOf(this.achievementsData());
        const series =
          subjectId === null ? null : (data?.catalog.series(subjectId) ?? null);
        return series?.title.get(cardLocaleOf(words.lang)) ?? null;
      }
      case 'photo':
        return subjectId === null
          ? null
          : (this.photoById(subjectId)?.dateLabel ?? null);
      default:
        return null;
    }
  }

  // ── Loading ─────────────────────────────────────────────────────────

  private readNow(): number {
    const now = this.clock?.now(SHOP_ZONE);
    return now?.isSuccess() ? now.value.toMillis() : Date.now();
  }

  /**
   * The subject's client record (D29): the one the store already read, else
   * `customers where userId == uid` (`CUSTOMER_PORTS.loadCustomerForUser`) —
   * `null` for an account with no record yet, and with no port bound;
   * `'failed'` when the read failed or timed out (the record stays unknown,
   * so a retry reads it again). An answer for an older open is dropped.
   */
  private recordOf(
    generation: number,
    uid: string,
  ): Promise<CustomerId | null | 'failed'> {
    const known = untracked(this._customerId);
    if (known !== undefined) return Promise.resolve(known);
    // ONE read per open: every keyed read waits on the same answer.
    const pending = this.recordRead;
    if (
      pending !== null &&
      pending.uid === uid &&
      pending.generation === generation
    ) {
      return pending.answer;
    }
    const answer = this.readRecord(generation, uid);
    this.recordRead = { uid, generation, answer };
    void answer.then(() => {
      if (this.recordRead?.answer === answer) this.recordRead = null;
    });
    return answer;
  }

  /** The in-flight record read, shared by every read of one open. */
  private recordRead: {
    readonly uid: string;
    readonly generation: number;
    readonly answer: Promise<CustomerId | null | 'failed'>;
  } | null = null;

  private async readRecord(
    generation: number,
    uid: string,
  ): Promise<CustomerId | null | 'failed'> {
    const customers = this.customers;
    if (customers === null) {
      this._customerId.set(null);
      return null;
    }
    const userId = UserId.parse(uid);
    if (!userId.ok) return 'failed';
    const result = await this.timed(() =>
      customers.loadCustomerForUser(userId.value),
    );
    if (generation !== this.generation) return 'failed';
    if (!result.ok) return 'failed';
    const record = result.value === null ? null : result.value.id;
    this._customerId.set(record);
    return record;
  }

  /**
   * A read keyed by the record, once it is known: `run` for a record, the
   * reader's empty answer for none (an account with no record has no
   * stats, visits, photos or vouchers yet), and the slice `failed` when the
   * record itself could not be read.
   */
  private async withRecord(
    generation: number,
    uid: string,
    run: (record: CustomerId) => Promise<void>,
    none?: () => void,
    failed?: () => void,
  ): Promise<void> {
    const record = await this.recordOf(generation, uid);
    if (generation !== this.generation) return;
    if (record === 'failed') failed?.();
    else if (record === null) none?.();
    else await run(record);
  }

  /** A new person: every slice back to its first state (loading where it will be read, absent where it will not). */
  private reset(subject: ClientCardSubject): void {
    this.waitlistSubscription?.unsubscribe();
    this.waitlistSubscription = null;
    this._customerId.set(undefined);
    this._filter.set('all');
    this._avatar.set(null);
    this._money.set(null);
    const account = subject.userId !== null;
    const flags = this.flags;
    const loyalty =
      account &&
      this.loyaltyReader !== null &&
      (flags.points || flags.streaks || flags.achievements || flags.tiers);
    const when = <T>(read: boolean): Slice<T> | null => (read ? LOADING : null);
    this._profile.set(when(account && this.profiles !== null));
    this._stats.set(when(account && this.statsReader !== null));
    this._history.set(
      account && this.historyReader !== null ? LOADING_HISTORY : null,
    );
    this._waitlist.set(when(account && this.waitlistReader !== null));
    this._photos.set(when(account && this.photosReader !== null));
    this._account.set(when(loyalty));
    this._progress.set(when(loyalty && flags.achievements));
    this._seasonProgress.set(when(loyalty && flags.achievements));
    this._catalog.set(
      loyalty && this.catalogReader !== null
        ? this.catalogCache !== null
          ? { status: 'ready', data: this.catalogCache }
          : LOADING
        : null,
    );
    // Revision 3: the wallet's two reads ride the same reachability as the
    // account (no wallet without one), the feed and the ledger page the
    // points' flag besides; the chip starts over with the person.
    this._vouchers.set(when(loyalty && this.vouchersReader !== null));
    const feed = loyalty && flags.points && this.activityReader !== null;
    this._activity.set(when(feed));
    this._ledgerPage.set(feed ? LOADING_LEDGER : null);
    this.ledgerSequence += 1;
    this._medalsChip.set(CHIP_ALL);
  }

  /**
   * `users/{uid}` first — the gate — then everything else at once. The
   * client record is asked for beside the profile (it keys the stats, the
   * history, the photos and the vouchers, D29), so it costs no round trip
   * of its own.
   */
  private async loadAll(generation: number, uid: string): Promise<void> {
    const userId = UserId.parse(uid);
    // Asked for at once, beside the gate: every keyed read below waits on it.
    void this.recordOf(generation, uid);
    const profiles = this.profiles;
    if (profiles !== null) {
      if (!userId.ok) {
        this._profile.set(FAILED);
        return;
      }
      const ok = await this.read(generation, this._profile, async () =>
        Result.map(await profiles.loadProfile(userId.value), registeredOnly),
      );
      if (!ok) return;
    }
    const stats = this.statsReader;
    if (stats !== null) {
      void this.withRecord(
        generation,
        uid,
        async (customerId) => {
          await this.read(generation, this._stats, () =>
            stats.loadClientStats(customerId),
          );
        },
        // No record yet: no projection either — the head's "first visit".
        () => this._stats.set({ status: 'ready', data: null }),
        () => this._stats.set(FAILED),
      );
      if (this._context()?.viewer.roles.includes('admin') === true) {
        void this.withRecord(generation, uid, (customerId) =>
          this.loadMoney(generation, customerId),
        );
      }
    }
    if (this.avatars !== null && userId.ok) {
      void this.loadAvatar(generation, userId.value);
    }
    void this.withRecord(
      generation,
      uid,
      (customerId) => this.loadFirstPage(generation, customerId),
      () =>
        this._history.update((history) =>
          history === null ? null : { ...LOADING_HISTORY, status: 'ready' },
        ),
      () =>
        this._history.update((history) =>
          history === null || history.status === 'ready'
            ? history
            : { ...LOADING_HISTORY, status: 'failed' },
        ),
    );
    this.watchWaitlist(generation, uid);
    void this.withRecord(
      generation,
      uid,
      (customerId) => this.loadPhotos(generation, customerId),
      () => {
        if (this._photos() !== null) {
          this._photos.set({ status: 'ready', data: [] });
        }
      },
      () => {
        if (this._photos()?.status !== 'ready' && this._photos() !== null) {
          this._photos.set(FAILED);
        }
      },
    );
    this.loadLoyalty(generation, uid, false);
    void this.loadCatalog();
    void this.withRecord(
      generation,
      uid,
      (customerId) => this.loadVouchers(generation, customerId),
      () => {
        if (this._vouchers() !== null) {
          this._vouchers.set({ status: 'ready', data: [] });
        }
      },
      () => {
        if (this._vouchers()?.status !== 'ready' && this._vouchers() !== null) {
          this._vouchers.set(FAILED);
        }
      },
    );
    void this.loadFeed(generation, uid);
    this.loadLedgerFirst(generation, uid);
  }

  /**
   * One read into one slice: loading unless it already holds an answer,
   * then the answer — or, on a failure, `failed` unless an earlier answer
   * is there to keep (a refresh never blanks what is on screen). `true`
   * when the slice holds an answer afterwards.
   */
  private async read<T>(
    generation: number,
    target: WritableSignal<Slice<T> | null>,
    read: () => Promise<ReadAnswer<T>>,
  ): Promise<boolean> {
    if (target()?.status !== 'ready') target.set(LOADING);
    const result = await this.timed(read);
    if (generation !== this.generation) return false;
    if (result.ok) {
      target.set({ status: 'ready', data: result.value });
      return true;
    }
    if (target()?.status !== 'ready') {
      target.set(FAILED);
      return false;
    }
    return true;
  }

  /** The read, or a failure after `CLIENT_CARD_READ_TIMEOUT_MS`; a thrown error is a failure too. */
  private timed<T>(
    read: () => Promise<ReadAnswer<T>>,
  ): Promise<Result<T, unknown>> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve(Result.err(READ_TIMED_OUT));
      }, CLIENT_CARD_READ_TIMEOUT_MS);
      this.timers.add(timer);
      const settle = (result: Result<T, unknown>) => {
        clearTimeout(timer);
        this.timers.delete(timer);
        resolve(result);
      };
      let pending: Promise<ReadAnswer<T>>;
      try {
        pending = read();
      } catch {
        settle(Result.err(READ_THREW));
        return;
      }
      pending.then(
        (answer) => settle(settled(answer)),
        () => settle(Result.err(READ_THREW)),
      );
    });
  }

  private async loadAvatar(generation: number, userId: UserId): Promise<void> {
    const avatars = this.avatars;
    if (avatars === null) return;
    const result = await this.timed(() => avatars.find(userId));
    if (generation !== this.generation) return;
    // A missing or unreadable picture is the monogram, never an error.
    this._avatar.set(result.ok ? (result.value?.url ?? null) : null);
  }

  /** ‹admin› — `restricted/money`; never asked for anyone else, and a refusal is simply no figure. */
  private async loadMoney(
    generation: number,
    customerId: CustomerId,
  ): Promise<void> {
    const stats = this.statsReader;
    if (stats === null) return;
    const result = await this.timed(() => stats.loadClientMoney(customerId));
    if (generation !== this.generation) return;
    this._money.set(result.ok ? result.value : null);
  }

  private async loadFirstPage(
    generation: number,
    customerId: CustomerId,
  ): Promise<void> {
    const reader = this.historyReader;
    if (reader === null) return;
    if (this._history()?.status !== 'ready') this._history.set(LOADING_HISTORY);
    const result = await this.timed(() =>
      reader.pageClientHistory(customerId, null, HISTORY_PAGE_SIZE),
    );
    if (generation !== this.generation) return;
    if (!result.ok) {
      if (this._history()?.status !== 'ready') {
        this._history.set({ ...LOADING_HISTORY, status: 'failed' });
      }
      return;
    }
    this._history.set({
      status: 'ready',
      appointments: result.value.appointments,
      cursor: result.value.nextBeforeUtcMs,
      more: 'idle',
      photoCounts: new Map(),
    });
    void this.loadCounts(generation, result.value.appointments);
  }

  /** The rows' photo marks; a failed count is no marks, not a failed list. */
  private async loadCounts(
    generation: number,
    appointments: readonly Appointment[],
  ): Promise<void> {
    const photos = this.photosReader;
    if (photos === null || appointments.length === 0) return;
    const ids: readonly AppointmentId[] = appointments.map(
      (appointment) => appointment.id,
    );
    const result = await this.timed(() => photos.countPhotosByAppointment(ids));
    if (generation !== this.generation || !result.ok) return;
    // Positions preserved: `counts[i]` counts `ids[i]`.
    const counts = result.value;
    this._history.update((history) =>
      history === null
        ? null
        : {
            ...history,
            photoCounts: new Map([
              ...history.photoCounts,
              ...ids.map((id, index) => [id, counts[index] ?? 0] as const),
            ]),
          },
    );
  }

  /** The next page; `true` when one was added. */
  private async fetchMore(): Promise<boolean> {
    const reader = this.historyReader;
    const customerId = untracked(this._customerId) ?? null;
    const history = untracked(this._history);
    if (
      reader === null ||
      customerId === null ||
      history === null ||
      history.status !== 'ready' ||
      history.cursor === null ||
      history.more === 'loading' ||
      !untracked(this._online)
    ) {
      return false;
    }
    const generation = this.generation;
    const cursor = history.cursor;
    this._history.set({ ...history, more: 'loading' });
    const result = await this.timed(() =>
      reader.pageClientHistory(customerId, cursor, HISTORY_PAGE_SIZE),
    );
    if (generation !== this.generation) return false;
    const now = this._history();
    if (now === null) return false;
    if (!result.ok) {
      this._history.set({ ...now, more: 'failed' });
      return false;
    }
    this._history.set({
      ...now,
      appointments: [...now.appointments, ...result.value.appointments],
      cursor: result.value.nextBeforeUtcMs,
      more: 'idle',
    });
    void this.loadCounts(generation, result.value.appointments);
    return true;
  }

  private async refill(filter: VisitFilter): Promise<void> {
    for (let page = 0; page < FILTER_REFILL_PAGES; page += 1) {
      if (untracked(this._filter) !== filter) return;
      const shown = untracked(this.historyRowVms).filter((row) =>
        matchesVisitFilter(row, filter),
      ).length;
      if (shown >= FILTER_REFILL_ROWS) return;
      if (!(await this.fetchMore())) return;
    }
  }

  /**
   * The waitlist is a live read of the ACCOUNT's own requests (they stay
   * keyed by the account, D29): its first answer settles the slice (or the
   * timeout fails it), later ones update it.
   */
  private watchWaitlist(generation: number, uid: string): void {
    const reader = this.waitlistReader;
    if (reader === null) return;
    const userId = UserId.parse(uid);
    if (!userId.ok) {
      this._waitlist.set(FAILED);
      return;
    }
    this.waitlistSubscription?.unsubscribe();
    if (this._waitlist()?.status !== 'ready') this._waitlist.set(LOADING);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (
        generation === this.generation &&
        this._waitlist()?.status === 'loading'
      ) {
        this._waitlist.set(FAILED);
      }
    }, CLIENT_CARD_READ_TIMEOUT_MS);
    this.timers.add(timer);
    const settle = () => {
      clearTimeout(timer);
      this.timers.delete(timer);
    };
    this.waitlistSubscription = reader
      .observeMyWaitlistRequests(userId.value)
      .subscribe({
        next: (result) => {
          settle();
          if (generation !== this.generation) return;
          if (result.ok) {
            this._waitlist.set({ status: 'ready', data: result.value });
          } else if (this._waitlist()?.status !== 'ready') {
            this._waitlist.set(FAILED);
          }
        },
        error: () => {
          settle();
          if (
            generation === this.generation &&
            this._waitlist()?.status !== 'ready'
          ) {
            this._waitlist.set(FAILED);
          }
        },
      });
  }

  /** The record's newest photos across visits (`listClientPhotos`, index #22). */
  private async loadPhotos(
    generation: number,
    customerId: CustomerId,
  ): Promise<void> {
    const reader = this.photosReader;
    if (reader === null) return;
    await this.read(generation, this._photos, () =>
      reader.listClientPhotos(customerId, PHOTOS_LIMIT),
    );
  }

  /**
   * The account and, by flag, the family progress, the season tracks and
   * the ledger — all at once (an account that turns out absent makes the
   * rest moot). `failedOnly` re-reads only what failed (a retry).
   */
  private loadLoyalty(
    generation: number,
    uid: string,
    failedOnly: boolean,
  ): void {
    const reader = this.loyaltyReader;
    if (reader === null) return;
    const due = (slice: Slice<unknown> | null) =>
      slice !== null && (!failedOnly || slice.status === 'failed');
    if (due(this._account())) {
      void this.read(generation, this._account, () => reader.getAccount(uid));
    }
    if (due(this._progress())) {
      void this.read(generation, this._progress, () =>
        reader.listBadgeProgress(uid),
      );
    }
    if (due(this._seasonProgress())) {
      void this.read(generation, this._seasonProgress, () =>
        reader.listSeasonProgress(uid),
      );
    }
  }

  /** The catalogue, once per store: a good answer is kept, a failure never is. */
  private async loadCatalog(): Promise<void> {
    const reader = this.catalogReader;
    if (reader === null || this._catalog() === null) return;
    if (this.catalogCache !== null) {
      this._catalog.set({ status: 'ready', data: this.catalogCache });
      return;
    }
    this._catalog.set(LOADING);
    const result = await this.timed(() => reader.getCatalog());
    if (result.ok) {
      this.catalogCache = result.value;
      if (this._catalog() !== null) {
        this._catalog.set({ status: 'ready', data: result.value });
      }
    } else if (this._catalog()?.status !== 'ready') {
      this._catalog.set(FAILED);
    }
  }

  // ── Revision 3: the wallet's two reads ──────────────────────────────

  /**
   * The vouchers issued to the client record, whatever their state
   * (`listGiftVouchersForHolder`, D29); the wallet keeps what it shows.
   */
  private async loadVouchers(
    generation: number,
    customerId: CustomerId,
  ): Promise<void> {
    const reader = this.vouchersReader;
    if (reader === null || this._vouchers() === null) return;
    await this.read(generation, this._vouchers, () =>
      reader.listGiftVouchersForHolder(customerId),
    );
  }

  /** The wallet's feed: the journal's newest rows under «Всички», one per entry, unfolded (`WALLET_ACTIVITY_READ`). */
  private async loadFeed(generation: number, uid: string): Promise<void> {
    const reader = this.activityReader;
    if (reader === null || this._activity() === null) return;
    await this.read(generation, this._activity, async () => {
      const page = await reader.page(uid, {
        kind: 'all',
        limit: WALLET_ACTIVITY_READ,
        after: null,
      });
      return page.isSuccess()
        ? Result.ok(page.value.entries)
        : Result.err(page.error);
    });
  }

  /**
   * The ledger page's first page under its pill: at open, and on a
   * refresh (the rows stay on screen until the fresh page lands; a refresh
   * that fails keeps them).
   */
  private loadLedgerFirst(generation: number, uid: string): void {
    const state = this._ledgerPage();
    if (state === null || this.activityReader === null) return;
    if (state.status !== 'ready') {
      this._ledgerPage.set({ ...state, status: 'loading' });
    }
    void this.readLedgerPage(generation, uid, state.filter);
  }

  /** One first page under a pill (`LEDGER_PAGE_READ`); an answer for an older pill, or an older person, is dropped. */
  private async readLedgerPage(
    generation: number,
    uid: string,
    kind: ActivityKind,
  ): Promise<void> {
    const reader = this.activityReader;
    if (reader === null) return;
    const sequence = ++this.ledgerSequence;
    const result = await this.timed(() =>
      reader.page(uid, { kind, limit: LEDGER_PAGE_READ, after: null }),
    );
    if (generation !== this.generation || sequence !== this.ledgerSequence) {
      return;
    }
    const now = this._ledgerPage();
    if (now === null || now.filter !== kind) return;
    if (!result.ok) {
      if (now.status !== 'ready')
        this._ledgerPage.set({ ...now, status: 'failed' });
      return;
    }
    this._ledgerPage.set({
      filter: kind,
      status: 'ready',
      entries: result.value.entries,
      next: result.value.next,
      more: 'idle',
    });
  }

  /** The next page under the pill, appended; a failure keeps the rows and says so in the foot. */
  private async fetchMoreLedger(): Promise<void> {
    const reader = this.activityReader;
    const uid = untracked(this._subject)?.userId ?? null;
    const state = untracked(this._ledgerPage);
    if (
      reader === null ||
      uid === null ||
      state === null ||
      state.status !== 'ready' ||
      state.next === null ||
      state.more === 'loading' ||
      !untracked(this._online)
    ) {
      return;
    }
    const generation = this.generation;
    const sequence = this.ledgerSequence;
    const after = state.next;
    this._ledgerPage.set({ ...state, more: 'loading' });
    const result = await this.timed(() =>
      reader.page(uid, { kind: state.filter, limit: LEDGER_PAGE_READ, after }),
    );
    if (generation !== this.generation || sequence !== this.ledgerSequence) {
      return;
    }
    const now = this._ledgerPage();
    if (now === null || now.filter !== state.filter) return;
    if (!result.ok) {
      this._ledgerPage.set({ ...now, more: 'failed' });
      return;
    }
    this._ledgerPage.set({
      ...now,
      entries: [...now.entries, ...result.value.entries],
      next: result.value.next,
      more: 'idle',
    });
  }
}
