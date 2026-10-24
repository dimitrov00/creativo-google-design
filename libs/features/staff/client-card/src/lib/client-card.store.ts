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
import type {
  Appointment,
  AppointmentPhoto,
  BadgeProgress,
  ClientMoneyRecord,
  ClientStatsRecord,
  GiftVoucher,
  JournalEntry,
  LoyaltyAccount,
  SeasonProgress,
  StreakDefinition,
  User,
  WaitlistRequest,
} from '@core/entities';
import {
  AppointmentId,
  CustomerId,
  Result,
  type TimeZone,
  UtcEpochMs,
  UserId,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  FlagName,
  JournalFeed,
  Registration,
  type ShopNow,
  type VisitFact,
  readsClientWords,
  seesClientSpend,
} from '@core/components';
import {
  ClientStatsSystem,
  LoyaltyCatalogSystem,
  StreakRuleSystem,
  StreakSystem,
  type StreakRuleSummary,
  type ValidLoyaltyCatalog,
  VisitFilter,
  VisitRowOutcome,
  WalletSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  APPOINTMENT_PHOTO_PORTS,
  APPOINTMENT_READ_PORTS,
  AVATAR_PORTS,
  CLIENT_JOURNAL_PORTS,
  CLIENT_STATS_READ_PORTS,
  CLOCK_PORTS,
  COUPON_VOUCHER_PORTS,
  CUSTOMER_PORTS,
  FLAGS_PORTS,
  LOYALTY_ACCOUNT_READ_PORTS,
  LOYALTY_CATALOG_READ_PORTS,
  PROFILE_PORTS,
  ShopZoneService,
  WAITLIST_READ_PORTS,
} from '@creativo/infrastructure/firebase-app';
import {
  VisitRowEntry,
  type VisitRowVm,
  firstNameOf,
  matchesVisitFilter,
} from '@creativo/features/shared/visits';
import {
  type AchievementsContext,
  achievementScopeOf,
  scopeTitleOf,
  seriesById,
} from './achievements.presenter';
import {
  AchievementScope,
  type ClientCardContext,
  type ClientCardRegion,
  type ClientCardSubject,
} from './client-card.contracts';
import { cardLocaleOf, dayShort, shopDayOf } from './client-card.format';
import {
  clientPhotoVm,
  displayNameOf,
  isBirthdayToday,
  isInChairToday,
  lastWorkedVisit,
  pauseOf,
  photoRailVm,
  quickActionsVm,
} from './client-card.presenter';
import {
  type AchievementsData,
  type BirthdayVm,
  type ClientHeroVm,
  type ClientOverviewVm,
  type ClientPhotoVm,
  type DetailActionVm,
  type LedgerPageVm,
  type RecordsPageVm,
  type VisitCardsVm,
  type VisitsPageVm,
  type WalletVm,
} from './client-pages.vm';
import { LoadSlice, LoadState, PagingState } from '@creativo/shared/view-state';
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
  type HistoryRowsInput,
  historyFacts,
  historyRows,
} from './history.presenter';
import {
  LEDGER_PAGE_READ,
  ledgerPageVm,
  wholeMonthsOf,
} from './ledger.presenter';
import {
  type LoyaltyFlags,
  glanceReward,
  ruleInForceOf,
} from './loyalty.presenter';
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

/** The page size of a history read (§3.6 HF). */
const HISTORY_PAGE_SIZE = 30;

/** Fewer rows than this left by a filter fetches more pages on the same tap (§3.6). */
const FILTER_REFILL_ROWS = 10;

/** …up to this many pages at once. */
const FILTER_REFILL_PAGES = 3;

/**
 * A worked visit's stored shop day and minute (Law 7.3) as the instant the
 * loyalty presenters (flip 3) still read — once, at this boundary, on the
 * shop's `zone`; a minute inside a spring-forward gap reads as the day's
 * start.
 */
function factInstant(fact: VisitFact, zone: TimeZone): UtcEpochMs {
  const at = ZonedTimeSystem.toUtc(fact.localDate, fact.startMinutes, zone);
  return at.ok
    ? at.value
    : ZonedTimeSystem.startOfLocalDay(fact.localDate, zone);
}

/** A read's answer as the store settles it — the ports' plain `Result`. */
type ReadAnswer<T> = Result<T, unknown>;

/** A read that did not answer in time (`CLIENT_CARD_READ_TIMEOUT_MS`), or threw. */
const READ_TIMED_OUT = RepositoryError.readFailed(null, 'timeout');
const READ_THREW = RepositoryError.readFailed(null, 'threw');

/** The history's pages as the store holds them. */
interface HistoryState {
  /** The FIRST page's read: the list's skeleton, its rows, or its retry notice. */
  readonly loadState: LoadState;
  /** Every loaded visit, newest first, page after page. */
  readonly appointments: readonly Appointment[];
  /** Where the next page starts — the start instant it reads before; `null` = nothing older. */
  readonly cursor: UtcEpochMs | null;
  /** The «Покажи още» read: `MORE` while idle (the end is the `null` cursor, never stored). */
  readonly pagingState: Exclude<PagingState, typeof PagingState.End>;
  /** Each loaded visit's own photos, counted, for the rows' marks. */
  readonly photoCounts: ReadonlyMap<string, number>;
}

const LOADING_HISTORY: HistoryState = {
  loadState: LoadState.Loading,
  appointments: [],
  cursor: null,
  pagingState: PagingState.More,
  photoCounts: new Map(),
};

/**
 * The ledger page «Движение» as the store holds it (revision 3 §2.2.6):
 * the pages read under the chosen pill. Another pill starts over from the
 * top; the pages of the pill before are not kept.
 */
interface LedgerState {
  /** The pill; its rows are `clientJournal` entries of `JournalFeed.effectsOf(filter)`. */
  readonly filter: JournalFeed;
  /** The FIRST page's read under the pill: the skeleton, the rows, or the retry notice. */
  readonly loadState: LoadState;
  /** Every loaded entry, newest first, page after page. */
  readonly entries: readonly JournalEntry[];
  /** Where the next page starts (the oldest row's `seq`); `null` = nothing older. */
  readonly next: number | null;
  /** The «Покажи още» read: `MORE` while idle (the end is the `null` cursor, never stored). */
  readonly pagingState: Exclude<PagingState, typeof PagingState.End>;
}

const LOADING_LEDGER: LedgerState = {
  filter: JournalFeed.All,
  loadState: LoadState.Loading,
  entries: [],
  next: null,
  pagingState: PagingState.More,
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

const LOADING = LoadSlice.loading;
const FAILED = LoadSlice.failed;

function loadStateOf(slice: LoadSlice<unknown> | null): LoadState | null {
  return slice?.loadState ?? null;
}

/** The account and the catalogue the tier capsule reads. */
interface TierInputs {
  readonly account: LoyaltyAccount;
  readonly catalog: ValidLoyaltyCatalog;
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

/** A known client record as the read answers it: `READY` with the id, `EMPTY` for none. */
function recordSliceOf(
  record: CustomerId | null,
): LoadSlice.WithEmpty<CustomerId> {
  return record === null ? LoadSlice.empty : LoadSlice.ready(record);
}

/**
 * THE CLIENT CARD'S DATA (client-card-redesign §5.2.1) — everything the
 * visit sheet's client stack shows about one person: their profile, their
 * visits and photos, their loyalty. Provided by the visit editor and
 * resolved lazily, so nothing constructs it until a card opens. Every read
 * of the record's — stats, history, photos, vouchers, and the loyalty
 * (account, progress, journal: keyed by the client RECORD, D29) — waits on
 * the record the card resolves (`withRecord`).
 *
 * Every read port is optional (a missing port is an absent slice) — the
 * clock (`CLOCK_PORTS`) and the shop's zone (`ShopZoneService`, the default
 * location's: no location is in the card's scope, Law 7.2) are required —
 * and every read is a `Result` with a 10 s timeout that settles as failed.
 * The zone is folded into the card's loading state: until it resolves the
 * head is the seat's snapshot and the gate stays shut. `users/{uid}`
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
  private readonly avatars = inject(AVATAR_PORTS, { optional: true });
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
  /** The record's loyalty account and its badge and season progress. */
  private readonly loyaltyPorts = inject(LOYALTY_ACCOUNT_READ_PORTS, {
    optional: true,
  });
  /** The published catalogue, the rhythm's heads included. */
  private readonly catalogPorts = inject(LOYALTY_CATALOG_READ_PORTS, {
    optional: true,
  });
  /** The gift vouchers a person holds (revision 3 §4.5): the wallet's holdings, the glance's voucher fact. */
  private readonly vouchersReader = inject(COUPON_VOUCHER_PORTS, {
    optional: true,
  });
  /** The journal as a feed (§4.7): the wallet's «Движение» and the ledger page. */
  private readonly journalPorts = inject(CLIENT_JOURNAL_PORTS, {
    optional: true,
  });
  /** The browser's clock (`CLOCK_PORTS`): «now» is read once per `open`. */
  private readonly clock = inject(CLOCK_PORTS);
  /**
   * The shop's zone (Law 7.2, Phase 4a 4A-11): no location is in the card's
   * scope, so it is the deployment's default location's — read once per
   * session and cached. `null` until it resolves: the head is the seat's
   * snapshot and everything under it its skeleton until then (the D-9
   * gate waits for it, as for the profile). A zone that cannot be read is
   * the whole card's S7, as a failed profile read is (4A-2 (e)), and its
   * retry reads the zone again.
   */
  private readonly shopZones = inject(ShopZoneService);
  private readonly zone: Signal<TimeZone | null> = this.shopZones.defaultZone();
  private readonly zoneFailed: Signal<boolean> =
    this.shopZones.defaultZoneFailed();
  private readonly transloco = inject(TranslocoService);
  private readonly window = inject(DOCUMENT).defaultView;

  /** The loyalty flags, read once (`config/feature-flags.json`, `FLAGS_PORTS`). */
  private readonly flags: LoyaltyFlags = (() => {
    const flags = inject(FLAGS_PORTS);
    return {
      points: flags.flagOn(FlagName.LoyaltyPoints),
      streaks: flags.flagOn(FlagName.LoyaltyStreaks),
      achievements: flags.flagOn(FlagName.LoyaltyAchievements),
      tiers: flags.flagOn(FlagName.LoyaltyTiers),
    };
  })();

  /** Bumped by every `open`: an answer for an older one is dropped. */
  private generation = 0;
  /** Bumped by every ledger pill and every new person: a page read under an older pill is dropped. */
  private ledgerSequence = 0;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private waitlistSubscription: Subscription | null = null;
  /** The catalogue, once read and validated — kept for the store's life (§5.2.1). */
  private catalogCache: ValidLoyaltyCatalog | null = null;

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
  private readonly _profile = signal<LoadSlice<User | null> | null>(null);
  private readonly _stats = signal<LoadSlice<ClientStatsRecord | null> | null>(
    null,
  );
  private readonly _avatar = signal<string | null>(null);
  private readonly _money = signal<ClientMoneyRecord | null>(null);
  private readonly _history = signal<HistoryState | null>(null);
  private readonly _waitlist = signal<LoadSlice<
    readonly WaitlistRequest[]
  > | null>(null);
  private readonly _photos = signal<LoadSlice<
    readonly AppointmentPhoto[]
  > | null>(null);
  private readonly _account = signal<LoadSlice<LoyaltyAccount | null> | null>(
    null,
  );
  /** The catalogue as `LoyaltyCatalogSystem.validate` answered it; a refused one is `failed`. */
  private readonly _catalog = signal<LoadSlice<ValidLoyaltyCatalog> | null>(
    null,
  );
  private readonly _progress = signal<LoadSlice<
    readonly BadgeProgress[]
  > | null>(null);
  private readonly _seasonProgress = signal<LoadSlice<
    readonly SeasonProgress[]
  > | null>(null);
  private readonly _filter = signal<VisitFilter>(VisitFilter.All);
  private readonly _online = signal(this.window?.navigator.onLine ?? true);
  /** The vouchers issued to the person, any state; `null` = not read. */
  private readonly _vouchers = signal<LoadSlice<readonly GiftVoucher[]> | null>(
    null,
  );
  /** The wallet's feed: the journal's newest rows under «Всички»; `null` = not read. */
  private readonly _activity = signal<LoadSlice<
    readonly JournalEntry[]
  > | null>(null);
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

  private readonly user = computed(() => LoadSlice.dataOf(this._profile()));
  private readonly stats = computed(() => LoadSlice.dataOf(this._stats()));
  /** The shop calendar's today on the shop's zone; `null` until the zone resolves. */
  private readonly today = computed((): string | null => {
    const zone = this.zone();
    return zone === null ? null : shopDayOf(this._nowMs(), zone);
  });
  private readonly paused = computed(() => {
    const zone = this.zone();
    return zone !== null && pauseOf(this.user(), this._nowMs(), zone) !== null;
  });

  /** `users/{uid}`, `clientStats/{uid}` or the shop's zone failed: the whole card's S7. */
  private readonly profileFailed = computed(
    () =>
      loadStateOf(this._profile()) === LoadState.Failed ||
      loadStateOf(this._stats()) === LoadState.Failed ||
      this.zoneFailed(),
  );

  /**
   * The D-9 gate: the profile and the stats have answered (a port that is
   * not bound counts as answered with nothing), and the shop's zone is
   * known. Every module under the head waits for it.
   */
  private readonly gateOpen = computed(() => {
    const profile = loadStateOf(this._profile());
    const stats = loadStateOf(this._stats());
    return (
      this._subject()?.userId != null &&
      this.zone() !== null &&
      (profile === null || profile === LoadState.Ready) &&
      (stats === null || stats === LoadState.Ready)
    );
  });

  /** The User name once read, else the seat's label (the bar title, the photo page). */
  readonly displayName = computed(() => {
    const subject = this._subject();
    return subject === null ? null : displayNameOf(subject, this.user());
  });

  /**
   * "Now" on the shop's wall clock for the visit rows and cards (Law 7.3),
   * derived ONCE from the open's clock reading in the shop's zone; `null`
   * until the zone resolves (the rows wait for it, the page stays loading).
   */
  private readonly visitNow = computed((): ShopNow | null => {
    const zone = this.zone();
    if (zone === null) return null;
    const now = UtcEpochMs.of(this._nowMs());
    return now.ok ? ZonedTimeSystem.shopNow(now.value, zone) : null;
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
      now: this.visitNow(),
      timeZone: this.zone(),
      photoCounts: history.photoCounts,
      clientWords: readsClientWords(context.viewer.roles),
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
    // No rows before the shop's "now" is known (the overview waits for the
    // zone before it asks): nothing to feature yet.
    if (
      context === null ||
      history?.loadState !== LoadState.Ready ||
      subject?.userId == null ||
      words === null ||
      this.visitNow() === null
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

  /** The tier capsule's inputs: `null` = no capsule, `LOADING` = not known yet. */
  private readonly tierInputs = computed((): LoadSlice<TierInputs> | null => {
    if (!this.flags.tiers) return null;
    const account = this._account();
    const catalog = this._catalog();
    if (account === null || catalog === null) return null;
    if (
      account.loadState === LoadState.Loading ||
      catalog.loadState === LoadState.Loading
    ) {
      return LOADING;
    }
    const loaded = LoadSlice.dataOf(account);
    const table = LoadSlice.dataOf(catalog);
    return loaded === null || table === null
      ? null
      : LoadSlice.ready({ account: loaded, catalog: table });
  });

  /**
   * The visits the rhythm reads: the stats' worked visits of the last year,
   * each a shop day and minute (Law 7.3), read back as the instant the
   * loyalty presenters (flip 3) still take — once, here, in the shop's zone.
   */
  private readonly visitsMs = computed((): readonly number[] => {
    const zone = this.zone();
    if (zone === null) return [];
    return (
      this.stats()?.last365VisitsCompleted.map((fact) =>
        factInstant(fact, zone),
      ) ?? []
    );
  });

  /**
   * What each worked visit on the loaded history was, by its shop day —
   * the rows' own titles («Фейд, Оформяне на брада»), so a ledger row names
   * its visit the way the history does. Two worked visits on one day are
   * named together.
   */
  private readonly visitTitles = computed((): ReadonlyMap<string, string> => {
    const titles = new Map<string, string[]>();
    for (const row of this.historyRowVms()) {
      if (
        row.visitRowEntry !== VisitRowEntry.Visit ||
        row.outcome !== VisitRowOutcome.Worked
      ) {
        continue;
      }
      const day = row.localDate;
      titles.set(day, [...(titles.get(day) ?? []), row.title]);
    }
    return new Map(
      [...titles].map(([day, rows]) => [day, [...new Set(rows)].join(', ')]),
    );
  });

  private readonly inChairToday = computed(() => {
    const context = this._context();
    const zone = this.zone();
    return (
      context !== null &&
      zone !== null &&
      isInChairToday(context, this._nowMs(), zone)
    );
  });

  /**
   * What the «Постижения» pages compute from: the catalogue, the account,
   * the family and season progress. `null` with `loyalty.achievements` off,
   * for a guest, without the readers, and for a client with no account.
   */
  readonly achievementsData: Signal<LoadSlice<AchievementsData> | null> =
    computed(() => {
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
      if (parts.some((part) => part.loadState === LoadState.Failed)) {
        return account.loadState === LoadState.Ready && account.data === null
          ? null
          : FAILED;
      }
      const today = this.today();
      if (
        !this.gateOpen() ||
        today === null ||
        parts.some((part) => part.loadState === LoadState.Loading)
      ) {
        return LOADING;
      }
      const loadedAccount = LoadSlice.dataOf(account);
      const loadedCatalog = LoadSlice.dataOf(catalog);
      if (loadedAccount === null || loadedCatalog === null) return null;
      return LoadSlice.ready({
        catalog: loadedCatalog,
        account: loadedAccount,
        progress: new Map(
          (LoadSlice.dataOf(progress) ?? []).map((p) => [p.id, p]),
        ),
        seasonProgress: new Map(
          (LoadSlice.dataOf(seasons) ?? []).map((p) => [p.id, p]),
        ),
        today,
        previousVisitAtMs: this.previousVisitAtMs(),
      });
    });

  /**
   * The start of the client's last worked visit before the one on screen —
   * what «Ново» is measured from (`ClientStatsSystem.previousVisit`), each
   * visit read as its instant on the shop's zone here, at the boundary. The
   * host's raw id of the visit on screen is parsed here (Law 7.4); one that
   * is no id names no stored visit, so nothing is left out.
   */
  private readonly previousVisitAtMs = computed(() => {
    const stats = this.stats();
    const zone = this.zone();
    const raw = this._context()?.appointmentId ?? null;
    if (stats === null || zone === null) return null;
    const parsed = raw === null ? null : AppointmentId.parse(raw);
    const current = parsed !== null && parsed.ok ? parsed.value : null;
    return ClientStatsSystem.previousVisit(stats, current, (fact) =>
      factInstant(fact, zone),
    );
  });

  /** The presenters' context for the achievements pages; `null` until a card is open and worded. */
  readonly achievementsContext: Signal<AchievementsContext | null> = computed(
    () => {
      const context = this._context();
      const words = this.words();
      const name = this.displayName();
      const zone = this.zone();
      const today = this.today();
      if (
        context === null ||
        words === null ||
        name === null ||
        zone === null ||
        today === null
      ) {
        return null;
      }
      const open = context.appointmentId !== null && !context.settled;
      return {
        words,
        catalog: context.catalog,
        subjectName: name,
        visit: open
          ? {
              legs: context.legs,
              locationId: context.locationId,
              birthdayToday: isBirthdayToday(this.user(), today),
            }
          : null,
        zone,
      };
    },
  );

  // ── Revision 3: the re-drawn pages (§4.9) ──────────────────────────────
  //
  // Each page's model is composed from the presenter files over the slices
  // above. The built `glance`, `loyalty` and `history` went with their
  // bodies in W4.

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
      zone: this.zone(),
      words: this.words(),
      tier: LoadSlice.dataOf(tier),
    });
  });

  /**
   * The face the hero shows (the seat's own picture, else the account's),
   * `null` with neither — what the visit editor's photo page gives a past
   * cut's person (`staff-visit-editor.ts`, `pastCut`), so the push keeps
   * the face the card just showed.
   */
  readonly avatarSrc: Signal<string | null> = computed(
    () => this.hero().avatarSrc,
  );

  /**
   * A held reward can be spent on THIS visit now: the subject owns it, the
   * device is online, the visit is not gone and the client is not paused
   * (the built «Лоялност» page's gate, named once).
   */
  private readonly rewardsUsable = computed(() => {
    const context = this._context();
    // The wallet's own write gate (`WalletSystem.writable`), named once.
    return (
      context !== null &&
      WalletSystem.writable({
        isOwner: context.isOwner,
        visitGone: context.gone,
        online: this._online(),
        paused: this.paused(),
      })
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
    const today = this.today();
    if (
      context === null ||
      words === null ||
      today === null ||
      this._subject()?.userId == null ||
      !this.gateOpen()
    ) {
      return null;
    }
    const usable = this.rewardsUsable();
    return birthdayVm({
      user: this.user(),
      today,
      grants: usable ? context.grants : [],
      grantsOnBill: usable ? context.grantsOnBill : [],
      words,
    });
  });

  /** E beside BD: the ready reward, less the gift the birthday card carries today (§2.1.2). */
  private readonly rewardBesideBirthday = computed(() => {
    const context = this._context();
    const words = this.words();
    const today = this.today();
    if (context === null || words === null || today === null) return null;
    const birthday = this.birthday();
    return glanceReward(
      grantsBesideBirthday(context.grants, birthday),
      today,
      words,
      grantsBesideBirthday(context.grantsOnBill, birthday),
    );
  });

  /**
   * The glance under the hero (§2.1): each module's `LoadSlice`, an absent key
   * an absent module, the birthday card as a fact of the day, and the
   * regions whose read failed. The built `glance`'s gates, module for
   * module; what changed is what each module is made of.
   */
  readonly overview: Signal<ClientOverviewVm> = computed(() => {
    const subject = this._subject();
    const context = this._context();
    const words = this.words();
    const zone = this.zone();
    // The shop's zone is part of the card's wording: until it is known the
    // glance is the bare head, as while the words load — and a zone that
    // cannot be read is the whole card's S7, its retry the profile's
    // (4A-2 (e)).
    if (subject === null || context === null || words === null) {
      return EMPTY_OVERVIEW;
    }
    if (zone === null) {
      return subject.userId !== null && this.zoneFailed()
        ? {
            actions: [],
            canRemove: this._online() && !context.gone,
            failed: ['profile'],
          }
        : EMPTY_OVERVIEW;
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
      zone,
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
      const capsules = overviewCapsulesVm({ user, stats, nowMs, zone, words });
      if (capsules.shown.length > 0) {
        overview.capsules = LoadSlice.ready(capsules);
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
      } else if (this.rewardsUsable()) {
        const reward = this.rewardBesideBirthday();
        if (reward !== null) {
          overview.reward = LoadSlice.ready(reward);
        }
      }
    }

    // H — the three cards
    const visits = this.visitCardsSlice(gate);
    if (visits !== undefined) {
      overview.visits = visits;
      if (visits.loadState === LoadState.Failed) failed.push('visits');
    }

    // F — one card: the points, what they buy, what else is held.
    const loyalty = this.loyaltyGlanceSlice(
      gate,
      [...context.grants, ...context.grantsOnBill].map((grant) => grant.title),
    );
    if (loyalty !== undefined) {
      overview.loyalty = loyalty;
      if (loyalty.loadState === LoadState.Failed) failed.push('loyalty');
    }

    // G — the medals and the records' line
    const medals = this.medalsGlanceSlice(gate);
    if (medals !== undefined) {
      overview.medals = medals;
      if (medals.loadState === LoadState.Failed) failed.push('achievements');
    }

    // I — as built: waits for the featured visit, whose photos it leaves out.
    const photos = this._photos();
    if (photos !== null) {
      const history = this._history();
      if (
        !gate ||
        photos.loadState === LoadState.Loading ||
        history?.loadState === LoadState.Loading
      ) {
        overview.photos = LOADING;
      } else if (photos.loadState === LoadState.Failed) {
        overview.photos = FAILED;
        failed.push('photos');
      } else {
        const rail = photoRailVm(
          photos.data,
          [this.featuredVisitId(), context.appointmentId],
          nowMs,
          zone,
          words,
        );
        if (rail.length > 0) overview.photos = LoadSlice.ready(rail);
      }
    }
    return overview;
  });

  /** H — the built module's gates over the three cards: the list, then the waitlist and the photos the cards carry. */
  private visitCardsSlice(gate: boolean): LoadSlice<VisitCardsVm> | undefined {
    const subject = this._subject();
    const context = this._context();
    const words = this.words();
    const history = this._history();
    const zone = this.zone();
    if (
      subject?.userId == null ||
      context === null ||
      words === null ||
      history === null
    ) {
      return undefined;
    }
    const now = this.visitNow();
    if (zone === null || now === null) return LOADING;
    if (!gate || history.loadState === LoadState.Loading) return LOADING;
    if (history.loadState === LoadState.Failed) return FAILED;
    const waitlist = this._waitlist();
    const photos = this._photos();
    const settled = (slice: LoadSlice<unknown> | null) =>
      slice === null || slice.loadState !== LoadState.Loading;
    if (!settled(waitlist) || !settled(photos)) return LOADING;
    return LoadSlice.ready(
      visitCardsVm({
        appointments: history.appointments,
        subjectUserId: subject.userId,
        subjectCustomerId: this._customerId() ?? null,
        context,
        photos: LoadSlice.dataOf(photos) ?? [],
        waitlist: LoadSlice.dataOf(waitlist),
        paused: this.paused(),
        count: this.stats()?.lifetimeVisitsCompleted ?? 0,
        clientWords: readsClientWords(context.viewer.roles),
        now,
        zone,
        words,
      }),
    );
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
    const today = this.today();
    if (!gate || today === null || account.loadState === LoadState.Loading) {
      return LOADING;
    }
    if (account.loadState === LoadState.Failed) return FAILED;
    if (account.data === null) return undefined;
    if (flags.points && catalog?.loadState === LoadState.Loading)
      return LOADING;
    if (flags.points && catalog?.loadState === LoadState.Failed) return FAILED;
    if (vouchers?.loadState === LoadState.Loading) return LOADING;
    if (flags.streaks && catalog?.loadState === LoadState.Loading)
      return LOADING;
    const vm = loyaltyGlanceVm({
      account: account.data,
      catalog: LoadSlice.dataOf(catalog),
      flags,
      visitsMs: this.visitsMs(),
      lifetimeVisits: this.stats()?.lifetimeVisitsCompleted ?? null,
      inChairToday: this.inChairToday(),
      paused: this.paused(),
      today,
      words,
      heldRewards,
      vouchers: LoadSlice.dataOf(vouchers),
      rhythm: this.rhythm(),
    });
    return vm === null ? undefined : LoadSlice.ready(vm);
  }

  /** G — the built module's gates over the medals in their rings and the records' line. */
  private medalsGlanceSlice(gate: boolean): ClientOverviewVm['medals'] {
    const data = this.achievementsData();
    const ctx = this.achievementsContext();
    if (data === null || ctx === null) return undefined;
    if (!gate || data.loadState === LoadState.Loading) return LOADING;
    if (data.loadState === LoadState.Failed) return FAILED;
    const vm = medalsGlanceVm(data.data, ctx);
    return vm === null ? undefined : LoadSlice.ready(vm);
  }

  /**
   * The catalogue's rhythm (§4.1): the first head the account holds a
   * state for, else the catalogue's first (`StreakSystem.headOf`). `null`
   * before the catalogue and in a shop without a rhythm.
   */
  private readonly rhythmHead = computed((): StreakDefinition | null => {
    const catalog = LoadSlice.dataOf(this._catalog());
    if (catalog === null) return null;
    const states = LoadSlice.dataOf(this._account())?.streaks ?? [];
    return StreakSystem.headOf(catalog.streaks, states);
  });

  /**
   * The rhythm the presenters judge by — the head; its rule in force and
   * the one that waits are `StreakRuleSystem.inForceOn` / `upcomingOn` on
   * the shop's today. `null` with `loyalty.streaks` off, before the
   * catalogue, and in a shop without a rhythm.
   */
  private readonly rhythm = computed((): StreakDefinition | null =>
    this.flags.streaks ? this.rhythmHead() : null,
  );

  /**
   * The rule the rhythm is judged by today; `null` as `rhythm` is, and
   * before the shop's today is known. A rule that is switched OFF is still
   * handed over: every presenter asks it.
   */
  private readonly ruleInForce = computed(() => {
    const today = this.today();
    return today === null ? null : ruleInForceOf(this.rhythm(), today);
  });

  /** The rule in force, summarised, for the medal detail's rhythm family (`rhythmRuleWords`); `null` as `ruleInForce` is. */
  readonly rhythmRule: Signal<StreakRuleSummary | null> = computed(() => {
    const rule = this.ruleInForce();
    return rule === null ? null : StreakRuleSystem.summary(rule);
  });

  /**
   * A worked visit's services by its APPOINTMENT id and by its shop day
   * (a ledger row asks for its appointment first, then for its day): the
   * rows' own titles, so the feed names a visit the way the history does.
   */
  private readonly visitNames = computed((): ReadonlyMap<string, string> => {
    const names = new Map<string, string>(this.visitTitles());
    for (const row of this.historyRowVms()) {
      if (
        row.visitRowEntry === VisitRowEntry.Visit &&
        row.outcome === VisitRowOutcome.Worked
      ) {
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
        row.visitRowEntry !== VisitRowEntry.Visit ||
        row.outcome !== VisitRowOutcome.Worked ||
        row.trailing === null
      ) {
        continue;
      }
      const name = row.trailing.several
        ? row.trailing.name
        : firstNameOf(row.trailing.name);
      barbers.set(row.id, name);
      const day = row.localDate;
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
  readonly wallet: Signal<LoadSlice<WalletVm> | null> = computed(() => {
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
    const zone = this.zone();
    const today = this.today();
    if (
      !this.gateOpen() ||
      zone === null ||
      today === null ||
      account.loadState === LoadState.Loading
    ) {
      return LOADING;
    }
    if (account.loadState === LoadState.Failed) return FAILED;
    if (account.data === null) return null;
    const usable = this.rewardsUsable();
    const catalog = context.catalog;
    const stats = this.stats();
    return LoadSlice.ready(
      walletVm({
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
        today,
        zone,
        words,
        holder: this.displayName(),
        sinceDay: stats?.firstVisitLocalDate ?? null,
        vouchers: this._vouchers(),
        activity: this._activity(),
        rhythm: this.rhythm(),
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
    );
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
    const filter = state?.filter ?? JournalFeed.All;
    const blank = (loadState: LoadState): LedgerPageVm => ({
      loadState,
      subline: [],
      filter,
      groups: [],
      paging: null,
    });
    if (words === null || this._subject()?.userId == null) {
      return blank(LoadState.Loading);
    }
    if (state === null || account === null) return blank(LoadState.Failed);
    if (this.profileFailed()) return blank(LoadState.Failed);
    const today = this.today();
    if (
      !this.gateOpen() ||
      today === null ||
      account.loadState === LoadState.Loading
    ) {
      return blank(LoadState.Loading);
    }
    if (account.loadState === LoadState.Failed || account.data === null) {
      return blank(LoadState.Failed);
    }
    return ledgerPageVm({
      loadState: state.loadState,
      entries: state.entries,
      next: state.next,
      loadingMore: state.pagingState === PagingState.Loading,
      failedMore: state.pagingState === PagingState.Failed,
      filter: state.filter,
      holder: this.displayName() ?? '',
      balance: account.data.balance,
      online: this._online(),
      visitTitles: this.visitNames(),
      visitBarbers: this.visitBarbers(),
      catalog: LoadSlice.dataOf(this._catalog()),
      today,
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
  readonly records: Signal<LoadSlice<RecordsPageVm> | null> = computed(() => {
    const data = this.achievementsData();
    const ctx = this.achievementsContext();
    if (data === null || ctx === null) return null;
    if (data.loadState !== LoadState.Ready) return data;
    return LoadSlice.ready(
      recordsPageVm({
        data: data.data,
        ctx,
        stats: this.stats(),
        rhythm: this.rhythm(),
        visits: this.loadedVisits(),
        historyComplete: this.historyComplete(),
      }),
    );
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
      return visitsPageBlank(LoadState.Loading, filter);
    }
    if (history === null || rows === null) {
      return visitsPageBlank(LoadState.Failed, filter);
    }
    // The shop's zone gates the rows (`now`) as it gates the page: while it
    // is pending `gateOpen` is shut, so the page is LOADING, never FAILED.
    const loadState =
      this.profileFailed() || history.loadState === LoadState.Failed
        ? LoadState.Failed
        : !this.gateOpen() || history.loadState === LoadState.Loading
          ? LoadState.Loading
          : LoadState.Ready;
    const stats = this.stats();
    return visitsPageVm({
      loadState,
      rows,
      filter,
      stats,
      spend: historyFacts(stats, this._money(), words).spend,
      paging: visitsPaging({
        cursor: history.cursor,
        pagingState: history.pagingState,
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
    return history?.loadState === LoadState.Ready && history.cursor === null;
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
  setLedgerFilter(kind: JournalFeed): void {
    untracked(() => {
      const state = this._ledgerPage();
      const uid = this._subject()?.userId ?? null;
      if (state === null || uid === null) return;
      if (state.filter === kind && state.loadState !== LoadState.Failed) return;
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
    const data = LoadSlice.dataOf(this.achievementsData());
    const ctx = this.achievementsContext();
    const context = this._context();
    if (data === null || ctx === null || context === null) return null;
    const series = seriesById(data, seriesId);
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
      const failed = (slice: LoadSlice<unknown> | null) =>
        slice?.loadState === LoadState.Failed;
      // Behind a failed gate nothing else was read: any retry is the
      // profile's (the pages' own notices land here too).
      const scope = this.profileFailed() ? 'profile' : region;
      switch (scope) {
        case 'profile':
          this.shopZones.retryDefaultZone();
          this.generation += 1;
          if (failed(this._profile())) this._profile.set(LOADING);
          if (failed(this._stats())) this._stats.set(LOADING);
          void this.loadAll(this.generation, userId);
          return;
        case 'visits':
        case 'history':
          if (this._history()?.loadState === LoadState.Failed) {
            void this.withRecord(generation, userId, (record) =>
              this.loadFirstPage(generation, record),
            );
          } else if (
            region === 'history' &&
            this._history()?.pagingState === PagingState.Failed
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
          if (this._ledgerPage()?.loadState === LoadState.Failed) {
            this.loadLedgerFirst(generation, userId);
          } else if (this._ledgerPage()?.pagingState === PagingState.Failed) {
            void this.fetchMoreLedger();
          }
          return;
      }
    });
  }

  /** One past cut for the read-only `photo` page (the editor maps it to its own photo type). */
  photoById(photoId: string): ClientPhotoVm | null {
    const photos = LoadSlice.dataOf(this._photos());
    const words = this.words();
    const zone = this.zone();
    const photo = photos?.find((p) => p.id === photoId);
    return photo === undefined || words === null || zone === null
      ? null
      : clientPhotoVm(photo, this._nowMs(), zone, words);
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
        const data = LoadSlice.dataOf(this.achievementsData());
        if (data !== null) return scopeTitleOf(data, scope, words);
        if (scope.achievementScope === AchievementScope.Archive) {
          return words.achievements.archive;
        }
        const today = this.today();
        if (scope.achievementScope === AchievementScope.Day && today !== null) {
          return words.achievements.dayTitle(
            dayShort(scope.day, today, words.lang),
          );
        }
        return null;
      }
      case 'achievementDetail': {
        const data = LoadSlice.dataOf(this.achievementsData());
        const series =
          subjectId === null || data === null
            ? null
            : seriesById(data, subjectId);
        return series?.title[cardLocaleOf(words.lang)] ?? null;
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
    return this.clock.nowUtcMs();
  }

  /**
   * The subject's client record (D29): the one the store already read, else
   * `customers where userId == uid` (`CUSTOMER_PORTS.loadCustomerForUser`) —
   * `EMPTY` for an account with no record yet, and with no port bound;
   * `FAILED` when the read failed or timed out (the record stays unknown,
   * so a retry reads it again). An answer for an older open is dropped.
   */
  private recordOf(
    generation: number,
    uid: string,
  ): Promise<LoadSlice.WithEmpty<CustomerId>> {
    const known = untracked(this._customerId);
    if (known !== undefined) return Promise.resolve(recordSliceOf(known));
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
    readonly answer: Promise<LoadSlice.WithEmpty<CustomerId>>;
  } | null = null;

  private async readRecord(
    generation: number,
    uid: string,
  ): Promise<LoadSlice.WithEmpty<CustomerId>> {
    const customers = this.customers;
    if (customers === null) {
      this._customerId.set(null);
      return LoadSlice.empty;
    }
    const userId = UserId.parse(uid);
    if (!userId.ok) return FAILED;
    const result = await this.timed(() =>
      customers.loadCustomerForUser(userId.value),
    );
    if (generation !== this.generation) return FAILED;
    if (!result.ok) return FAILED;
    const record = result.value === null ? null : result.value.id;
    this._customerId.set(record);
    return recordSliceOf(record);
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
    if (record.loadState === LoadState.Failed) failed?.();
    else if (record.loadState === LoadState.Ready) await run(record.data);
    else none?.();
  }

  /** A new person: every slice back to its first state (loading where it will be read, absent where it will not). */
  private reset(subject: ClientCardSubject): void {
    this.waitlistSubscription?.unsubscribe();
    this.waitlistSubscription = null;
    this._customerId.set(undefined);
    this._filter.set(VisitFilter.All);
    this._avatar.set(null);
    this._money.set(null);
    const account = subject.userId !== null;
    const flags = this.flags;
    const loyalty =
      account &&
      this.loyaltyPorts !== null &&
      (flags.points || flags.streaks || flags.achievements || flags.tiers);
    const when = <T>(read: boolean): LoadSlice<T> | null =>
      read ? LOADING : null;
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
      loyalty && this.catalogPorts !== null
        ? this.catalogCache !== null
          ? LoadSlice.ready(this.catalogCache)
          : LOADING
        : null,
    );
    // Revision 3: the wallet's two reads ride the same reachability as the
    // account (no wallet without one), the feed and the ledger page the
    // points' flag besides; the chip starts over with the person.
    this._vouchers.set(when(loyalty && this.vouchersReader !== null));
    const feed = loyalty && flags.points && this.journalPorts !== null;
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
        () => this._stats.set(LoadSlice.ready(null)),
        () => this._stats.set(FAILED),
      );
      const viewer = this._context()?.viewer;
      if (viewer !== undefined && seesClientSpend(viewer.roles)) {
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
          history === null
            ? null
            : { ...LOADING_HISTORY, loadState: LoadState.Ready },
        ),
      () =>
        this._history.update((history) =>
          history === null || history.loadState === LoadState.Ready
            ? history
            : { ...LOADING_HISTORY, loadState: LoadState.Failed },
        ),
    );
    this.watchWaitlist(generation, uid);
    void this.withRecord(
      generation,
      uid,
      (customerId) => this.loadPhotos(generation, customerId),
      () => {
        if (this._photos() !== null) {
          this._photos.set(LoadSlice.ready([]));
        }
      },
      () => {
        if (
          this._photos()?.loadState !== LoadState.Ready &&
          this._photos() !== null
        ) {
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
          this._vouchers.set(LoadSlice.ready([]));
        }
      },
      () => {
        if (
          this._vouchers()?.loadState !== LoadState.Ready &&
          this._vouchers() !== null
        ) {
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
    target: WritableSignal<LoadSlice<T> | null>,
    read: () => Promise<ReadAnswer<T>>,
  ): Promise<boolean> {
    if (target()?.loadState !== LoadState.Ready) target.set(LOADING);
    const result = await this.timed(read);
    if (generation !== this.generation) return false;
    if (result.ok) {
      target.set(LoadSlice.ready(result.value));
      return true;
    }
    if (target()?.loadState !== LoadState.Ready) {
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
        (answer) => settle(answer),
        () => settle(Result.err(READ_THREW)),
      );
    });
  }

  private async loadAvatar(generation: number, userId: UserId): Promise<void> {
    const avatars = this.avatars;
    if (avatars === null) return;
    const result = await this.timed(() => avatars.findAvatar(userId));
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
    if (this._history()?.loadState !== LoadState.Ready)
      this._history.set(LOADING_HISTORY);
    const result = await this.timed(() =>
      reader.pageClientHistory(customerId, null, HISTORY_PAGE_SIZE),
    );
    if (generation !== this.generation) return;
    if (!result.ok) {
      if (this._history()?.loadState !== LoadState.Ready) {
        this._history.set({
          ...LOADING_HISTORY,
          loadState: LoadState.Failed,
        });
      }
      return;
    }
    this._history.set({
      loadState: LoadState.Ready,
      appointments: result.value.appointments,
      cursor: result.value.nextBeforeUtcMs,
      pagingState: PagingState.More,
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
      history.loadState !== LoadState.Ready ||
      history.cursor === null ||
      history.pagingState === PagingState.Loading ||
      !untracked(this._online)
    ) {
      return false;
    }
    const generation = this.generation;
    const cursor = history.cursor;
    this._history.set({ ...history, pagingState: PagingState.Loading });
    const result = await this.timed(() =>
      reader.pageClientHistory(customerId, cursor, HISTORY_PAGE_SIZE),
    );
    if (generation !== this.generation) return false;
    const now = this._history();
    if (now === null) return false;
    if (!result.ok) {
      this._history.set({ ...now, pagingState: PagingState.Failed });
      return false;
    }
    this._history.set({
      ...now,
      appointments: [...now.appointments, ...result.value.appointments],
      cursor: result.value.nextBeforeUtcMs,
      pagingState: PagingState.More,
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
    if (this._waitlist()?.loadState !== LoadState.Ready)
      this._waitlist.set(LOADING);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (
        generation === this.generation &&
        this._waitlist()?.loadState === LoadState.Loading
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
            this._waitlist.set(LoadSlice.ready(result.value));
          } else if (this._waitlist()?.loadState !== LoadState.Ready) {
            this._waitlist.set(FAILED);
          }
        },
        error: () => {
          settle();
          if (
            generation === this.generation &&
            this._waitlist()?.loadState !== LoadState.Ready
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
   * The account and, by flag, the family progress and the season tracks —
   * all at once (an account that turns out absent makes the rest moot),
   * keyed by the client RECORD (D29): read through `withRecord`, so no
   * record is no account (the account `null`, the progress empty: today's
   * "no account" view) and a record that could not be read fails them all
   * (flip-3 plan F3-1 (a)); a retry resolves the record again.
   * `failedOnly` re-reads only what failed (a retry).
   */
  private loadLoyalty(
    generation: number,
    uid: string,
    failedOnly: boolean,
  ): void {
    const ports = this.loyaltyPorts;
    if (ports === null) return;
    const due = (slice: LoadSlice<unknown> | null) =>
      slice !== null && (!failedOnly || slice.loadState === LoadState.Failed);
    const account = due(this._account());
    const progress = due(this._progress());
    const seasons = due(this._seasonProgress());
    if (!account && !progress && !seasons) return;
    // Loading at once, as a read sets it, while the record is resolved.
    const loading = <T>(target: WritableSignal<LoadSlice<T> | null>) => {
      if (target()?.loadState !== LoadState.Ready) target.set(LOADING);
    };
    if (account) loading(this._account);
    if (progress) loading(this._progress);
    if (seasons) loading(this._seasonProgress);
    void this.withRecord(
      generation,
      uid,
      async (customerId) => {
        if (account) {
          void this.read(generation, this._account, () =>
            ports.loadLoyaltyAccount(customerId),
          );
        }
        if (progress) {
          void this.read(generation, this._progress, () =>
            ports.listBadgeProgress(customerId),
          );
        }
        if (seasons) {
          void this.read(generation, this._seasonProgress, () =>
            ports.listSeasonProgress(customerId),
          );
        }
      },
      // No record yet: no loyalty account either.
      () => {
        if (account) this._account.set(LoadSlice.ready(null));
        if (progress) this._progress.set(LoadSlice.ready([]));
        if (seasons) this._seasonProgress.set(LoadSlice.ready([]));
      },
      () => {
        const fail = <T>(target: WritableSignal<LoadSlice<T> | null>) => {
          if (target()?.loadState !== LoadState.Ready) target.set(FAILED);
        };
        if (account) fail(this._account);
        if (progress) fail(this._progress);
        if (seasons) fail(this._seasonProgress);
      },
    );
  }

  /**
   * The catalogue, once per store: the port's answer as it is, judged
   * whole by `LoyaltyCatalogSystem.validate` (display order, `families`).
   * A good answer is kept; a failure — the read's, or a catalogue the
   * system refuses — never is, and fails the slice (F3-10).
   */
  private async loadCatalog(): Promise<void> {
    const ports = this.catalogPorts;
    if (ports === null || this._catalog() === null) return;
    if (this.catalogCache !== null) {
      this._catalog.set(LoadSlice.ready(this.catalogCache));
      return;
    }
    this._catalog.set(LOADING);
    const result = await this.timed(() => ports.loadLoyaltyCatalog());
    const valid = result.ok
      ? LoyaltyCatalogSystem.validate(result.value)
      : null;
    if (valid !== null && valid.ok) {
      this.catalogCache = valid.value;
      if (this._catalog() !== null) {
        this._catalog.set(LoadSlice.ready(valid.value));
      }
    } else if (this._catalog()?.loadState !== LoadState.Ready) {
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

  /**
   * The wallet's feed: the record's journal, its newest rows under
   * «Всички», one per entry, unfolded (`WALLET_ACTIVITY_READ`). No record
   * is no row; a record that could not be read fails the feed.
   */
  private async loadFeed(generation: number, uid: string): Promise<void> {
    const ports = this.journalPorts;
    if (ports === null || this._activity() === null) return;
    if (this._activity()?.loadState !== LoadState.Ready)
      this._activity.set(LOADING);
    await this.withRecord(
      generation,
      uid,
      async (customerId) => {
        await this.read(generation, this._activity, async () =>
          Result.map(
            await ports.pageClientJournal(
              customerId,
              JournalFeed.effectsOf(JournalFeed.All),
              null,
              WALLET_ACTIVITY_READ,
            ),
            (page) => page.entries,
          ),
        );
      },
      () => {
        if (this._activity() !== null) {
          this._activity.set(LoadSlice.ready([]));
        }
      },
      () => {
        if (
          this._activity()?.loadState !== LoadState.Ready &&
          this._activity() !== null
        ) {
          this._activity.set(FAILED);
        }
      },
    );
  }

  /**
   * The ledger page's first page under its pill: at open, and on a
   * refresh (the rows stay on screen until the fresh page lands; a refresh
   * that fails keeps them).
   */
  private loadLedgerFirst(generation: number, uid: string): void {
    const state = this._ledgerPage();
    if (state === null || this.journalPorts === null) return;
    if (state.loadState !== LoadState.Ready) {
      this._ledgerPage.set({ ...state, loadState: LoadState.Loading });
    }
    void this.readLedgerPage(generation, uid, state.filter);
  }

  /**
   * One first page under a pill (`LEDGER_PAGE_READ`), of the record's
   * journal (`withRecord`: no record is an empty page, a record that could
   * not be read fails it); an answer for an older pill, or an older
   * person, is dropped.
   */
  private async readLedgerPage(
    generation: number,
    uid: string,
    kind: JournalFeed,
  ): Promise<void> {
    const ports = this.journalPorts;
    if (ports === null) return;
    const sequence = ++this.ledgerSequence;
    /** The page in force for this read: `null` once another pill or person took over. */
    const current = (): LedgerState | null => {
      if (generation !== this.generation || sequence !== this.ledgerSequence) {
        return null;
      }
      const now = this._ledgerPage();
      return now === null || now.filter !== kind ? null : now;
    };
    const fail = () => {
      const now = current();
      if (now !== null && now.loadState !== LoadState.Ready) {
        this._ledgerPage.set({ ...now, loadState: LoadState.Failed });
      }
    };
    await this.withRecord(
      generation,
      uid,
      async (customerId) => {
        const result = await this.timed(() =>
          ports.pageClientJournal(
            customerId,
            JournalFeed.effectsOf(kind),
            null,
            LEDGER_PAGE_READ,
          ),
        );
        if (current() === null) return;
        if (!result.ok) {
          fail();
          return;
        }
        this._ledgerPage.set({
          filter: kind,
          loadState: LoadState.Ready,
          entries: result.value.entries,
          next: result.value.nextBeforeSeq,
          pagingState: PagingState.More,
        });
      },
      () => {
        if (current() === null) return;
        this._ledgerPage.set({
          filter: kind,
          loadState: LoadState.Ready,
          entries: [],
          next: null,
          pagingState: PagingState.More,
        });
      },
      fail,
    );
  }

  /**
   * The next page under the pill, appended — of the record the store
   * already resolved (a page was read, so the record is known); a failure
   * keeps the rows and says so in the foot.
   */
  private async fetchMoreLedger(): Promise<void> {
    const ports = this.journalPorts;
    const customerId = untracked(this._customerId) ?? null;
    const state = untracked(this._ledgerPage);
    if (
      ports === null ||
      customerId === null ||
      state === null ||
      state.loadState !== LoadState.Ready ||
      state.next === null ||
      state.pagingState === PagingState.Loading ||
      !untracked(this._online)
    ) {
      return;
    }
    const generation = this.generation;
    const sequence = this.ledgerSequence;
    const after = state.next;
    this._ledgerPage.set({ ...state, pagingState: PagingState.Loading });
    const result = await this.timed(() =>
      ports.pageClientJournal(
        customerId,
        JournalFeed.effectsOf(state.filter),
        after,
        LEDGER_PAGE_READ,
      ),
    );
    if (generation !== this.generation || sequence !== this.ledgerSequence) {
      return;
    }
    const now = this._ledgerPage();
    if (now === null || now.filter !== state.filter) return;
    if (!result.ok) {
      this._ledgerPage.set({ ...now, pagingState: PagingState.Failed });
      return;
    }
    this._ledgerPage.set({
      ...now,
      entries: [...now.entries, ...result.value.entries],
      next: result.value.nextBeforeSeq,
      pagingState: PagingState.More,
    });
  }
}
