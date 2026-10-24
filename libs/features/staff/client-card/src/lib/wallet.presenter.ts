import { CouponGrantId, LocalDate, defect } from '@core/primitives';
import {
  FreezeReason,
  PassFigure,
  PassState,
  PunchCard,
  RewardGrant,
  StreakCapsule,
  StreakPeriodMark,
  StreakState,
  WalletAction,
} from '@core/components';
import type {
  GiftVoucher,
  JournalEntry,
  StreakDefinition,
} from '@core/entities';
import {
  type LoyaltyPass,
  LoyaltyPassSystem,
  LoyaltyCatalogSystem,
  RewardSystem,
  type RewardTiles,
  type StreakOutlookAnswer,
  StreakRuleSystem,
  StreakSystem,
  type StreakTrackMark,
  StreakTrackMarkKind,
  TierSystem,
  type ValidLoyaltyCatalog,
  type VoucherIdOrder,
  VoucherSystem,
  WalletSystem,
} from '@core/systems';
import { rhythmRuleWords } from '@creativo/features/shared/visits';
import { formatCents } from '@creativo/ui/wall-clock';
import type {
  UiMark,
  UiStreakMark,
  UiStreakPeriod,
} from '@creativo/ui/controls';
import {
  cardLocaleOf,
  dayLong,
  dayMonth,
  dayShort,
  figure,
  monthLong,
  monthYearLong,
  runningCase,
} from './client-card.format';
import {
  type GaugeVm,
  type PassVm,
  type RewardGridVm,
  type RewardReadyVm,
  type RewardTileVm,
  type RhythmPhaseVm,
  type StampCardVm,
  type VoucherVm,
  type WalletActionVm,
  WalletHolding,
  type WalletHoldingVm,
  type WalletRhythmVm,
  type WalletTierVm,
  type WalletVm,
} from './client-pages.vm';
import { LoadSlice, LoadState } from '@creativo/shared/view-state';
import {
  streakPeriodMarkWords,
  streakPeriodReasonWords,
} from '@creativo/infrastructure/i18n';
import {
  type ClientCardTranslate,
  type ClientCardWords,
} from './client-card.words';
import { activityGroups, foldByEvent, wholeMonthsOf } from './ledger.presenter';
import {
  type LoyaltyPageInput,
  groupedGrants,
  rhythmLineOf,
  rhythmOutlookOf,
  rhythmStateOf,
  rhythmTrackName,
  ruleInForceOf,
  ruleUpcomingOf,
  sliceMap,
  ticketOf,
} from './loyalty.presenter';

/*
 * «ЛОЯЛНОСТ» AS A WALLET (client-card-revision-3 §2.2), as pure functions:
 * the pass, the discs under it, what the person holds, the rhythm, the
 * status, what the points buy, what moved. Each section follows its flag
 * and its data; a paused client's values are never zeroed, only frozen.
 *
 * ONE FACT, ONE ENCODING (§2.2.1): the stamps are counted by the stamps,
 * the rhythm's health is its figure and its track, the status is a ring
 * that holds what remains, «Използвай» is the disc. So nothing here words
 * a fact that a drawing beside it already shows.
 *
 * The rhythm is read, never re-derived (§4.2): the marks are the
 * projection's closed periods, the open mark its phase, and the rule's
 * sentences are the shared `rhythmRuleWords` of the rule IN FORCE.
 */

type Words = ClientCardWords;

/** U+2212: a figure that owes prints a minus, never a hyphen. */
const MINUS = '\u2212';

/** The journal rows the wallet reads for its feed: five events need more than five rows. */
export const WALLET_ACTIVITY_READ = 12;

/** The events «Движение» shows on the wallet; the rest are the ledger page's. */
export const WALLET_ACTIVITY_ROWS = 5;

/** The rhythm's marks, the open one among them: eight in the dialog, the newest six on a phone. */
export const WALLET_RHYTHM_PERIODS = 8;
export const WALLET_RHYTHM_PERIODS_NARROW = 6;

export interface WalletInput extends LoyaltyPageInput {
  /** The head's name; `null` until it is known. */
  readonly holder: string | null;
  /** The first worked visit's shop day (`ClientStatsRecord.firstVisitLocalDate`); `null` before it. */
  readonly sinceDay: string | null;
  /** The vouchers issued to the person, any state; `null` = not read (no reader bound). */
  readonly vouchers: LoadSlice<readonly GiftVoucher[]> | null;
  /**
   * The journal's newest rows under «Всички», one per entry, as
   * `CLIENT_JOURNAL_PORTS.pageClientJournal(customerId, JournalFeed.effectsOf(ALL), null, WALLET_ACTIVITY_READ)`
   * answers them; `null` = not read (`loyalty.points` off, no reader).
   */
  readonly activity: LoadSlice<readonly JournalEntry[]> | null;
  /**
   * The rhythm the account is judged by (its head): the rule in force and
   * the one that waits are `StreakRuleSystem.inForceOn` / `upcomingOn` on
   * `today`; `null` with `loyalty.streaks` off, or when the catalogue holds
   * no rhythm.
   */
  readonly rhythm: StreakDefinition | null;
  readonly online: boolean;
  /** The subject owns the appointment: only the owner's rewards can be spent on it. */
  readonly isOwner: boolean;
  /** Cancelled or a no-show: nothing can be written to the visit. */
  readonly visitGone: boolean;
  /**
   * A reward's picture, by the REWARD's id or by its coupon's
   * (`RewardCatalogItem.grantCouponId`): the cover of the one service
   * the coupon names, resolved by whoever knows the coupon. A reward the
   * map does not hold draws the reward glyph.
   */
  readonly covers: ReadonlyMap<string, string>;
  /**
   * The catalogue's own reading (Transloco's `translate`): the rule's
   * sentences are the shared `rhythmRuleWords`, which words them from the
   * `rhythmRule.*` keys.
   */
  readonly translate: ClientCardTranslate;
  /**
   * A counted service's name by its id (a category's, when the rule counts
   * by category), for the rule's «Броят се посещения с: …». Absent, a rule
   * that counts a list says nothing about it.
   */
  readonly nameOf?: ((id: string) => string | null) | null;
  /** Who worked a visit, under `visitTitles`' keys: the activity row's «5.09 · Иван». */
  readonly visitBarbers?: ReadonlyMap<string, string>;
}

function catalogOf(input: WalletInput): ValidLoyaltyCatalog | null {
  return input.catalog?.loadState === LoadState.Ready
    ? input.catalog.data
    : null;
}

/** A balance or a count as a display figure; one that owes wears the minus. */
function signedFigureOf(value: number, lang: string): string {
  return `${value < 0 ? MINUS : ''}${figure(Math.abs(value), lang)}`;
}

// ── WA · The pass ───────────────────────────────────────────────────────

/** The tier the account stands on, as the plate words it; `null` when the catalogue cannot name it. */
function tierPlateOf(
  input: WalletInput,
  catalog: ValidLoyaltyCatalog | null,
): string | null {
  if (!input.flags.tiers || catalog === null) return null;
  const tierId = TierSystem.standingTier(input.account, catalog.tiers);
  return tierId === null
    ? null
    : (LoyaltyCatalogSystem.tier(catalog, tierId)?.name[
        cardLocaleOf(input.words.lang)
      ] ?? null);
}

/** The pass as `LoyaltyPassSystem` decides it on the card's today. */
function passOf(input: WalletInput): LoyaltyPass {
  return LoyaltyPassSystem.passOf(input.account, {
    pointsOn: input.flags.points,
    paused: input.paused,
    today: dayOf(input.today),
  });
}

/** A figure the pass's state carries; the system gives it with its state. */
function carried<T>(value: T | null, state: PassState): T {
  return value === null ? defect(`${state} carries its figure`) : value;
}

/** The pass's state line: only when it says something, and one thing. */
function passStateOf(pass: LoyaltyPass, input: WalletInput): string | null {
  const { words, today } = input;
  const page = words.loyaltyPage;
  switch (pass.passState) {
    case PassState.Frozen:
      return page.passFrozen;
    case PassState.Owes:
      return page.owes(carried(pass.owed, pass.passState));
    case PassState.Expiring:
      // The projection says WHEN points lapse, not how many: what can lapse
      // is what the account holds.
      return page.expiring(
        carried(pass.lapsing, pass.passState),
        dayShort(carried(pass.lapsesOn, pass.passState), today, words.lang),
      );
    case PassState.Clear:
      return null;
  }
}

/**
 * WA — the loyalty pass. The figure is the spendable balance; with
 * `loyalty.points` off it is the count the tier is judged by. The name a
 * reader hears holds no state: the state line under it is read after it.
 */
export function passVm(input: WalletInput): PassVm {
  const { words } = input;
  const lang = words.lang;
  const pass = passOf(input);
  const holder = input.holder?.trim() ? input.holder.trim() : null;
  const tier = tierPlateOf(input, catalogOf(input));
  const since =
    input.sinceDay === null ? null : monthYearLong(input.sinceDay, lang);
  const state = passStateOf(pass, input);
  const tenure = since === null ? null : words.head.since(since);
  if (pass.passFigure === PassFigure.Visits) {
    const visits = pass.figure;
    return {
      figure: figure(visits, lang),
      unit: words.loyalty.rhythmUnit(visits),
      holder,
      tier,
      since: tenure,
      state,
      frozen: input.paused,
      // No sentence of the catalogue words a pass without points: its
      // facts, each as the page words it, in the pass's own order.
      accessibleName: [
        words.loyalty.title,
        holder,
        tier,
        words.loyaltyPage.tierQualifying(visits),
        tenure === null ? null : runningCase(tenure, lang),
      ]
        .filter((part): part is string => part !== null)
        .join(', '),
    };
  }
  return {
    figure: signedFigureOf(pass.figure, lang),
    unit: words.loyalty.pointsWord(Math.abs(pass.figure)),
    holder,
    tier,
    since: tenure,
    state,
    frozen: input.paused,
    // An account that owes has nothing to spend; what it owes is the
    // state line's, heard right after the name.
    accessibleName: words.loyaltyPage.passName(
      holder,
      tier,
      pass.spendable,
      since,
    ),
  };
}

// ── WC · What is held ───────────────────────────────────────────────────

/**
 * Two vouchers that end on one day keep the wallet's locale collation of
 * their ids — a locale's order, which no system can hold
 * (`VoucherSystem.held` takes it as its tie-break).
 */
const BY_ID_COLLATION: VoucherIdOrder = (a, b) => a.localeCompare(b);

/** The card's today as a shop day; a day the table cannot place is none. */
function heldDayOf(today: string): LocalDate | null {
  const day = LocalDate.parse(today);
  return day.ok ? day.value : null;
}

/**
 * The vouchers held (`VoucherSystem.held`): the spendable ones — issued,
 * not voided, not past their day, with a balance — the soonest to run out
 * first. A day the table cannot place spends nothing rather than
 * everything.
 */
function heldOf(
  vouchers: readonly GiftVoucher[],
  today: string,
): readonly GiftVoucher[] {
  const day = heldDayOf(today);
  return day === null ? [] : VoucherSystem.held(vouchers, day, BY_ID_COLLATION);
}

function voucherVm(
  voucher: GiftVoucher,
  today: string,
  words: Words,
): VoucherVm {
  const page = words.loyaltyPage;
  const lang = words.lang;
  // The voucher's last day on the shop's calendar; `null` when it never expires.
  const lastDay = voucher.expiresLocalDate;
  const balance = formatCents(voucher.balanceCents, voucher.currency, lang);
  const value = formatCents(voucher.initialValueCents, voucher.currency, lang);
  const until = lastDay === null ? null : dayShort(lastDay, today, lang);
  // One fact, once: an untouched voucher's chip does not repeat the figure
  // over it, so it says its validity alone, or nothing.
  const untouched = VoucherSystem.untouched(voucher);
  return {
    voucherId: voucher.id,
    title: page.voucher,
    balance,
    detail: untouched
      ? until === null
        ? null
        : words.reward.until(until)
      : page.voucherDetail(value, until),
    accessibleName: page.voucherFullName(
      balance,
      value,
      lastDay === null ? null : dayLong(lastDay, today, lang),
    ),
  };
}

/**
 * WC1 — the vouchers the person can spend, the soonest to expire first. A
 * voided voucher, an empty one and one past its day are absent: the wallet
 * holds what can be used, and a voucher's history is the bill's.
 */
export function voucherVms(
  vouchers: readonly GiftVoucher[],
  today: string,
  words: Words,
): readonly VoucherVm[] {
  return heldOf(vouchers, today).map((voucher) =>
    voucherVm(voucher, today, words),
  );
}

/** The grants as the wallet's tickets: ready ones and the ones on this visit's bill. */
function ticketGroups(input: WalletInput) {
  // A companion's rewards cannot be spent on this visit, and a paused
  // client's are out of reach: neither is drawn (`WalletSystem.ticketsShown`).
  return WalletSystem.ticketsShown(input)
    ? groupedGrants(input.usableGrants, input.usableGrantsOnBill ?? [])
    : [];
}

/**
 * WC2 — a held reward as a ticket that is STATIC on this page (the disc is
 * the verb): named as what it is, «Награда: …», not as a button. One on
 * the bill keeps its own name and its «Премахни».
 */
function walletTickets(input: WalletInput): readonly RewardReadyVm[] {
  const { words, today } = input;
  return ticketGroups(input).map((group) => {
    const ticket = ticketOf(group, 0, today, words);
    const expiresOn = group.grants[0]?.expiresOn ?? null;
    return group.applied
      ? ticket
      : {
          ...ticket,
          accessibleName: words.loyaltyPage.ticketName(
            runningCase(ticket.title, words.lang),
            expiresOn === null ? null : dayLong(expiresOn, today, words.lang),
          ),
        };
  });
}

/** WC3 — a stamp card: the stamps do the counting, the line says what they are for. */
function stampCards(input: WalletInput): readonly WalletHoldingVm[] {
  const { account, flags, words } = input;
  if (!flags.achievements) return [];
  const page = words.loyaltyPage;
  const locale = cardLocaleOf(words.lang);
  return account.punchCards.map((punch): WalletHoldingVm => {
    const reward = punch.title[locale];
    const spoken = runningCase(reward, words.lang);
    const { filled, left, toNext } = PunchCard.progress(punch);
    const card: StampCardVm = {
      ruleId: punch.ruleId,
      title: reward,
      figure: words.loyalty.stampsOf(filled, punch.size),
      gauge: {
        value: filled,
        min: 0,
        max: punch.size,
        marks: [],
        label: page.stampCard,
        valueText: page.stampsName(filled, punch.size, left, spoken),
      },
      sentence: page.stampsToNext(toNext),
    };
    return {
      walletHolding: WalletHolding.Stamps,
      card,
      line: page.stampsFor(punch.size, spoken),
    };
  });
}

/** The vouchers the read answered; none while it is on its way, failed or not made. */
function vouchersOf(input: WalletInput): readonly GiftVoucher[] {
  return input.vouchers?.loadState === LoadState.Ready
    ? input.vouchers.data
    : [];
}

/**
 * WC — everything held, in the wallet's order: gift vouchers, reward
 * tickets, stamp cards; within a kind the soonest to expire first.
 */
export function walletHoldings(input: WalletInput): readonly WalletHoldingVm[] {
  const { today, words } = input;
  return [
    ...voucherVms(vouchersOf(input), today, words).map(
      (voucher): WalletHoldingVm => ({
        walletHolding: WalletHolding.Voucher,
        voucher,
      }),
    ),
    ...walletTickets(input).map((ticket): WalletHoldingVm => ({
      walletHolding: WalletHolding.Ticket,
      ticket,
    })),
    ...stampCards(input),
  ];
}

/**
 * «3 · 55,00 €» when several spendable vouchers are held: their sum is
 * nowhere else on the page. Otherwise `null`: a bare count beside «В
 * портфейла» said nothing the tickets right under it do not (review 3,
 * round 4; the group's name still counts them for a reader).
 */
function holdingsDetailOf(
  input: WalletInput,
  holdings: readonly WalletHoldingVm[],
): string | null {
  const { words, today } = input;
  const day = heldDayOf(today);
  // From two vouchers on, in one currency (`VoucherSystem.heldTotal`); the
  // count is every holding the section draws.
  const total =
    day === null ? null : VoucherSystem.heldTotal(vouchersOf(input), day);
  return total === null
    ? null
    : words.loyaltyPage.walletSum(
        holdings.length,
        formatCents(total.amountCents, total.currency, words.lang),
      );
}

// ── WB · The discs ──────────────────────────────────────────────────────

/** Each disc as drawn: its id, glyph and prominence — «Използвай» the one promoted verb. */
const WALLET_ACTION_DISCS = {
  [WalletAction.Use]: {
    id: 'use',
    icon: 'promo.coupon',
    prominence: 'accent',
  },
  [WalletAction.Code]: {
    id: 'code',
    icon: 'loyalty.enterCode',
    prominence: 'standard',
  },
  [WalletAction.Catalog]: {
    id: 'catalog',
    icon: 'loyalty.reward',
    prominence: 'standard',
  },
  [WalletAction.History]: {
    id: 'history',
    icon: 'loyalty.ledger',
    prominence: 'standard',
  },
} as const satisfies Record<
  WalletAction,
  {
    readonly id: WalletActionVm['id'];
    readonly icon: WalletActionVm['icon'];
    readonly prominence: WalletActionVm['prominence'];
  }
>;

/** A disc's word and the name a reader hears. */
function discWordsOf(
  action: WalletAction,
  actions: Words['loyaltyPage']['actions'],
): { readonly label: string; readonly accessibleName: string } {
  switch (action) {
    case WalletAction.Use:
      return { label: actions.use, accessibleName: actions.useName };
    case WalletAction.Code:
      return { label: actions.code, accessibleName: actions.codeName };
    case WalletAction.Catalog:
      return { label: actions.catalog, accessibleName: actions.catalogName };
    case WalletAction.History:
      return { label: actions.history, accessibleName: actions.historyName };
  }
}

/** The first grant of each held ticket not on the bill yet, in the tickets' order. */
function readyGrantIdsOf(input: WalletInput): readonly CouponGrantId[] {
  return ticketGroups(input).flatMap((group) => {
    const first = group.grants[0];
    return group.applied || first === undefined
      ? []
      : [CouponGrantId.of(first.grantId)];
  });
}

/**
 * WB — the discs that work today, in their order (`WalletSystem.actions`);
 * one that cannot be used is absent and the run closes up (§2.2.3).
 */
export function walletActions(input: WalletInput): readonly WalletActionVm[] {
  const actions = input.words.loyaltyPage.actions;
  const discs = WalletSystem.actions({
    writable: WalletSystem.writable(input),
    pointsOn: input.flags.points,
    catalogStands: catalogSectionStands(input),
    readyGrantIds: readyGrantIdsOf(input),
  });
  return discs.actions.map((action): WalletActionVm => {
    const named = discWordsOf(action, actions);
    const use = action === WalletAction.Use;
    return {
      ...WALLET_ACTION_DISCS[action],
      label: named.label,
      accessibleName:
        use && discs.useCount !== null
          ? `${named.accessibleName}, ${actions.useCount(discs.useCount)}`
          : named.accessibleName,
      grantId: use ? discs.useGrantId : null,
      count: use ? discs.useCount : null,
    };
  });
}

/**
 * «Награди за точки» has somewhere to land: the section is drawn while its
 * read is on its way and when it failed (the heading stands over a
 * skeleton or a notice), and is absent only once the catalogue is known to
 * offer nothing (`RewardSystem.tiles`).
 */
function catalogSectionStands(input: WalletInput): boolean {
  const catalog = input.catalog;
  if (catalog === null) return false;
  return (
    catalog.loadState !== LoadState.Ready ||
    rewardTilesOf(input, catalog.data).tiles.length > 0
  );
}

// ── WD · The rhythm ─────────────────────────────────────────────────────

/** Where the rhythm stands: the sentence, the day it names, the capsule beside the figure. */
interface RhythmStanding {
  readonly line: string;
  /** The day the line names: the open mark under it stays uncaptioned for that day. */
  readonly day: string | null;
  /** `null` while healthy. */
  readonly phase: RhythmPhaseVm | null;
  /** The due date the track's sentence names (`StreakOutlookAnswer.nextDue`); `null` where the line names none. */
  readonly nextDue: string | null;
}

/**
 * The day the NEXT visit keeps the rhythm by, once the visit in the chair
 * counts: the open period's own interval after TODAY. `null` when nobody
 * is in the chair, for a paused client, under a used protection and while
 * no period is open.
 */
function inChairDueOf(
  state: StreakState,
  input: WalletInput,
): LocalDate | null {
  return StreakSystem.inChairDue(state, dayOf(input.today), {
    inChairToday: input.inChairToday,
    paused: input.paused,
  });
}

/**
 * The capsule beside the figure, as the outlook gives it: a warning where
 * a visit can still keep or restore the run (`urgent`), else neutral. A
 * visit on the book answers the cue — its capsule stands where a warning
 * would have, and nothing stands beside a healthy figure.
 */
function capsuleOf(
  outlook: StreakOutlookAnswer,
  input: WalletInput,
): RhythmPhaseVm | null {
  const { words, today } = input;
  const rhythm = words.rhythm;
  const capsule = outlook.streakCapsule;
  if (capsule === null) return null;
  const day = outlook.day;
  const short = () =>
    day === null
      ? defect(`${capsule} names a day`)
      : dayShort(day, today, words.lang);
  const tone = outlook.urgent ? 'warning' : 'neutral';
  switch (capsule) {
    case StreakCapsule.Frozen:
      return { text: rhythm.phaseFrozen, tone };
    case StreakCapsule.Broken:
      return { text: rhythm.phaseBroken, tone };
    case StreakCapsule.Held:
      return { text: rhythm.phaseHeld(short()), tone };
    case StreakCapsule.AtRisk:
      return { text: rhythm.phaseAtRisk(short()), tone };
    case StreakCapsule.InGrace:
      return { text: rhythm.phaseInGrace(short()), tone };
  }
}

/** Where the rhythm stands (`StreakSystem.outlook`), worded. */
function standingOf(
  state: StreakState,
  inChairDue: LocalDate | null,
  input: WalletInput,
): RhythmStanding {
  const { words, today, zone } = input;
  const outlook = rhythmOutlookOf(state, {
    paused: input.paused,
    inChairDue,
    today,
    zone,
  });
  return {
    ...rhythmLineOf(outlook, today, words),
    phase: capsuleOf(outlook, input),
    nextDue: outlook.nextDue,
  };
}

/** A closed period as the track draws it; a visit's caption is chosen with its neighbours' (`rhythmMarks`). */
function closedPeriod(
  mark: StreakTrackMark & {
    readonly streakTrackMarkKind: StreakPeriodMark;
  },
  input: WalletInput,
): UiStreakPeriod {
  const { words, today } = input;
  const rhythm = words.rhythm;
  const month = monthLong(mark.on, words.lang);
  // A closed period's mark as the DS track draws it — the SAME glyph as
  // before the flip, from the one table, typed against the DS's own words.
  const drawn: UiStreakMark = streakPeriodMarkWords[mark.streakTrackMarkKind];
  const id = `${drawn}-${mark.on}`;
  switch (mark.streakTrackMarkKind) {
    case StreakPeriodMark.Kept:
      return {
        id,
        mark: drawn,
        caption: '',
        description: rhythm.markKept(
          month,
          dayShort(mark.on, today, words.lang),
        ),
      };
    case StreakPeriodMark.Repaired:
      return {
        id,
        mark: drawn,
        caption: '',
        description: rhythm.markRepaired(month),
      };
    case StreakPeriodMark.Protected: {
      // A closed period's reason is the projection's own: a protection, a
      // pause or the excuse by name (never the open phase's `EXCUSE`).
      const reason = mark.reason;
      return {
        id,
        mark: drawn,
        caption: '',
        description: rhythm.markProtected(
          month,
          reason === null || reason === FreezeReason.Excuse
            ? rhythm.reasonFreeze
            : rhythm.reason(streakPeriodReasonWords[reason]),
        ),
      };
    }
    case StreakPeriodMark.Missed:
      return {
        id,
        mark: drawn,
        caption: '',
        description: rhythm.markMissed(month),
      };
  }
}

/** A track mark that closes a period (every mark but the open one). */
function isClosed(mark: StreakTrackMark): mark is StreakTrackMark & {
  readonly streakTrackMarkKind: StreakPeriodMark;
} {
  return mark.streakTrackMarkKind !== StreakTrackMarkKind.Current;
}

/**
 * The open period as the track draws it (`StreakSystem.track`'s open mark):
 * a protection or an excuse carrying the period, today's visit in the
 * chair, or the due date.
 */
function openPeriod(
  mark: StreakTrackMark,
  standing: RhythmStanding,
  input: WalletInput,
): UiStreakPeriod {
  const { words, today } = input;
  const rhythm = words.rhythm;
  const lang = words.lang;
  // One fact, once: the day the sentence under the track names is not
  // captioned a second time.
  const due = (day: string) =>
    day === standing.day ? '' : rhythm.dueBy(dayShort(day, today, lang));
  if (mark.streakTrackMarkKind === StreakTrackMarkKind.Protected) {
    // The open mark's reason is the frozen phase's own.
    const reason = mark.reason;
    return {
      id: 'current',
      mark: 'protected',
      caption: due(mark.on),
      description:
        reason === null || reason === FreezeReason.Excuse
          ? // Which excuse it was is the closed period's to say; the open
            // one names the day its due date moved to.
            rhythm.markCurrent(dayLong(mark.on, today, lang))
          : rhythm.markProtected(
              monthLong(mark.on, lang),
              rhythm.reason(streakPeriodReasonWords[reason]),
            ),
    };
  }
  if (input.inChairToday) {
    return {
      id: 'current',
      mark: 'current',
      caption: words.visits.today,
      description: rhythm.markCurrent(dayLong(today, today, lang)),
    };
  }
  return {
    id: 'current',
    mark: 'current',
    caption: due(mark.on),
    description: rhythm.markCurrent(dayLong(mark.on, today, lang)),
  };
}

/**
 * The track's marks, oldest first: the projection's closed periods, then
 * the open one (`StreakSystem.track`). The visits' captions are ONE axis in
 * one grain: the month's word while every drawn visit has a month of its
 * own, every visit's day once two share one (DV12). A due date nobody met
 * has no visit to name: its mark says it, uncaptioned.
 */
function rhythmMarks(
  state: StreakState,
  standing: RhythmStanding,
  input: WalletInput,
): readonly UiStreakPeriod[] {
  const { words } = input;
  const track = StreakSystem.track(state, {
    today: dayOf(input.today),
    inChairToday: input.inChairToday,
    paused: input.paused,
    limit: WALLET_RHYTHM_PERIODS,
  });
  return track.marks.map((mark) => {
    const period =
      mark.open || !isClosed(mark)
        ? openPeriod(mark, standing, input)
        : closedPeriod(mark, input);
    return mark.visitDay === null
      ? period
      : {
          ...period,
          caption: track.byMonth
            ? words.monthShort(Number(mark.visitDay.slice(5, 7)))
            : dayMonth(mark.visitDay, words.lang),
        };
  });
}

/**
 * WD — «Ритъм»; `null` with `loyalty.streaks` off, while the rule in force
 * is off, and for an account that holds no such rhythm (§4.2).
 */
export function walletRhythmVm(input: WalletInput): WalletRhythmVm | null {
  const { account, flags, words, today } = input;
  // The rhythm counts: its flag, and the rule in force switched on.
  if (!StreakRuleSystem.isOnOn(input.rhythm, dayOf(today), flags.streaks)) {
    return null;
  }
  const rule = ruleInForceOf(input.rhythm, today);
  const state = rhythmStateOf(account, input.rhythm);
  if (rule === null || state === null) return null;

  const lang = words.lang;
  const inChairDue = inChairDueOf(state, input);
  const standing = standingOf(state, inChairDue, input);
  const nameOf = input.nameOf ?? null;
  const summary = StreakRuleSystem.summary(rule);
  const ruleWords = rhythmRuleWords(summary, input.translate, lang, {
    period: StreakState.periodTerms(state),
    nameOf,
  });
  // `StreakRuleSystem.upcomingOn` answers only a rule whose day is still ahead.
  const upcoming = ruleUpcomingOf(input.rhythm, today);
  const best = StreakSystem.record(state);
  const protections = StreakSystem.protectionsHeld(state, summary);
  return {
    figure: figure(state.current, lang),
    unit: words.loyaltyPage.inRhythm(state.current),
    phase: standing.phase,
    periods: rhythmMarks(state, standing, input),
    trackName: rhythmTrackName(state, standing.nextDue, today, words),
    stateLine: standing.line,
    best: best === null ? null : words.loyaltyPage.rhythmBest(best),
    protections:
      protections === null ? null : words.rhythm.protections(protections),
    ruleLine: ruleWords.short,
    ruleFull: [ruleWords.sentence, ...ruleWords.details],
    ruleUpcoming:
      upcoming !== null
        ? words.rhythm.ruleUpcoming(
            dayShort(upcoming.effectiveFromLocalDate, today, lang),
            runningCase(
              rhythmRuleWords(
                StreakRuleSystem.summary(upcoming),
                input.translate,
                lang,
                { nameOf },
              ).short,
              lang,
            ),
          )
        : null,
    frozen: input.paused,
  };
}

// ── WE · The status ─────────────────────────────────────────────────────

/**
 * WE — «Статус»: what remains in a ring, the tiers as steps; `null` while
 * the catalogue names no tier the account stands on (the section is then
 * absent, as it is with `loyalty.tiers` off — `walletVm`).
 */
function tierOf(
  input: WalletInput,
  catalog: ValidLoyaltyCatalog,
): WalletTierVm | null {
  const { account, words } = input;
  // A ring only with tiers in the catalogue (`TierSystem.standingTier`).
  if (TierSystem.standingTier(account, catalog.tiers) === null) return null;
  const locale = cardLocaleOf(words.lang);
  const page = words.loyaltyPage;
  const track = TierSystem.steps(account, catalog.tiers);
  const stepOf = (tierId: string | null) =>
    track.steps.find((step) => step.tierId === tierId) ?? null;
  const current = stepOf(track.currentTierId);
  // The nodes are the tiers, named; what remains is the ring's, so no node
  // says it a second time.
  const marks: readonly UiMark[] = track.steps.map((step) => ({
    value: step.atLeast,
    label: step.name[locale],
  }));
  // The ring and the gauge are `TierSystem.progress`'s numbers.
  const progress = TierSystem.progress(account, catalog.tiers);
  const steps = (valueText: string): GaugeVm => ({
    value: progress.gaugeValue,
    min: 0,
    max: progress.top,
    marks,
    label: page.tier,
    valueText,
  });

  if (progress.atTop) {
    const sentence = page.tierTop(TierSystem.keptAt(progress));
    return {
      ring: {
        value: 1,
        min: 0,
        max: 1,
        marks: [],
        label: page.tier,
        valueText: sentence,
      },
      remaining: null,
      line1: page.tierHighest,
      line2: page.tierQualifying(track.value),
      steps: steps(sentence),
      accessibleName: sentence,
    };
  }

  // Under way, the track holds the next tier and what it still asks
  // (`TierProgress.atTop` is their absence).
  const next =
    stepOf(progress.nextTierId) ?? defect('a tier under way has a next one');
  const remaining =
    progress.remaining ?? defect('a tier under way has what remains');
  const sentence = page.tierName(
    current?.name[locale] ?? '',
    track.value,
    remaining,
    next.name[locale],
  );
  // From the tier the account stands on to the next: an override may stand
  // above what the visits reached, and the arc never runs backwards.
  return {
    ring: {
      value: progress.ringValue,
      min: 0,
      max: progress.ringMax,
      marks: [],
      label: page.tier,
      valueText: sentence,
    },
    remaining: figure(remaining, words.lang),
    line1: page.tierTo(next.name[locale]),
    line2: page.tierQualifying(track.value),
    steps: steps(sentence),
    accessibleName: sentence,
  };
}

// ── WF · What the points buy ────────────────────────────────────────────

/**
 * The catalogue as tiles (`RewardSystem.tiles`): offered today, within
 * reach first, inside each half the catalogue's own order. A tile is
 * INFORMATION in this round (ES-2): it says whether the points cover the
 * reward, so «within reach» is the balance against the cost and nothing
 * else. A reward nobody can take today (not yet offered, sold out) is no
 * tile.
 */
function rewardTilesOf(input: WalletInput, catalog: ValidLoyaltyCatalog) {
  return RewardSystem.tiles(
    catalog.rewards,
    input.account.balance,
    dayOf(input.today),
  );
}

function tilesOf(
  input: WalletInput,
  answer: RewardTiles<ValidLoyaltyCatalog['rewards'][number]>,
): readonly RewardTileVm[] {
  const { words } = input;
  const page = words.loyaltyPage;
  const locale = cardLocaleOf(words.lang);
  return answer.tiles.map(({ reward, reach }): RewardTileVm => {
    const title = reward.name[locale];
    const missing = reach.affordable ? null : figure(reach.short, words.lang);
    return {
      rewardId: reward.id,
      title,
      cost: words.ledgerPage.points(reward.cost),
      affordable: reach.affordable,
      missing: missing === null ? null : page.moreToGo(missing),
      progress: reach.progress,
      // The cover the host knows: the reward's own, else its coupon's.
      src:
        input.covers.get(reward.id) ??
        (reward.rewardGrant === RewardGrant.Coupon
          ? input.covers.get(reward.grantCouponId)
          : undefined) ??
        null,
      accessibleName: page.rewardName(
        reward.cost,
        title,
        missing === null ? '' : page.rewardMoreSuffix(missing),
      ),
    };
  });
}

function rewardGrid(
  input: WalletInput,
  catalog: ValidLoyaltyCatalog,
): RewardGridVm | null {
  const { words } = input;
  const answer = rewardTilesOf(input, catalog);
  const tiles = tilesOf(input, answer);
  return tiles.length === 0
    ? null
    : {
        name: words.loyaltyPage.catalogListName(
          words.loyalty.points(passOf(input).spendable),
          answer.withinReach,
          tiles.length,
        ),
        tiles,
      };
}

// ── The page ────────────────────────────────────────────────────────────

/** WG — the newest five events of what was read, by month. */
function walletActivity(entries: readonly JournalEntry[], input: WalletInput) {
  // A read that came back full may have cut its oldest event.
  const whole = entries.length < WALLET_ACTIVITY_READ;
  const groups = activityGroups(foldByEvent(entries, whole), {
    visitTitles: input.visitTitles ?? new Map<string, string>(),
    visitBarbers: input.visitBarbers,
    catalog: catalogOf(input),
    today: input.today,
    wholeMonths: wholeMonthsOf(entries, whole),
    limit: WALLET_ACTIVITY_ROWS,
    words: input.words,
  });
  return groups.length === 0 ? null : groups;
}

/**
 * The holdings follow the vouchers' read, the one read of theirs that can
 * fail: on its way the section is a skeleton, failed it is its heading
 * over a notice. Not read at all, the wallet holds the tickets and the
 * stamp cards alone.
 */
function holdingsSlice(
  input: WalletInput,
): LoadSlice<readonly WalletHoldingVm[]> {
  const vouchers = input.vouchers;
  return vouchers === null || vouchers.loadState === LoadState.Ready
    ? LoadSlice.ready(walletHoldings(input))
    : vouchers;
}

/**
 * The «Лоялност» page (§2.2). A section is absent with its flag or its
 * data; one whose own read failed keeps its heading over a notice.
 */
export function walletVm(input: WalletInput): WalletVm {
  const { flags } = input;
  const holdings = holdingsSlice(input);
  const rhythm = walletRhythmVm(input);
  const tier = flags.tiers
    ? sliceMap(input.catalog, (catalog) => tierOf(input, catalog))
    : undefined;
  const catalog = flags.points
    ? sliceMap(input.catalog, (loaded) => rewardGrid(input, loaded))
    : undefined;
  const activity = flags.points
    ? sliceMap(input.activity, (entries) => walletActivity(entries, input))
    : undefined;
  return {
    frozen: input.paused,
    pass: passVm(input),
    actions: walletActions(input),
    holdings,
    holdingsDetail:
      holdings.loadState === LoadState.Ready
        ? holdingsDetailOf(input, holdings.data)
        : null,
    ...(rhythm === null ? {} : { rhythm }),
    ...(tier === undefined ? {} : { tier }),
    ...(catalog === undefined ? {} : { catalog }),
    ...(activity === undefined ? {} : { activity }),
  };
}

// ── The card's own values → ecs-core structs ──────────────────────────────

/** A shop day the card holds: a clock's «today». */
function dayOf(raw: string): LocalDate {
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : defect(`${raw} is no calendar day`);
}
