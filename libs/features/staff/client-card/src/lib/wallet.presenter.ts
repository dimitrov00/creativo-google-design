import { formatMoney } from '@creativo/application/booking';
import {
  type ActivityEntry,
  type GiftVoucher,
  type LoyaltyCatalog,
  type StreakDefinition,
  type StreakPeriodFact,
  type StreakState,
  tierSteps,
} from '@creativo/application/engagement';
import {
  AdjustmentId,
  AppointmentId,
  Currency,
  FreezeReason,
  LocalDate,
  Points,
  type RedeemableRewardRef,
  RewardId,
  RewardSystem,
  StreakDefinitionId,
  StreakExcuse as SystemExcuse,
  StreakIntervalSource as SystemIntervalSource,
  StreakPeriodMark as SystemPeriodMark,
  type StreakPeriodReason as SystemPeriodReason,
  StreakPhaseState,
  type StreakState as SystemStreakState,
  StreakSystem,
  type StreakTrackMark,
  StreakTrackMarkKind,
  TierId,
  TierOverride,
  type TierState,
  type TierStepRef,
  TierSystem,
  UtcEpochMs,
  defect,
  type GiftVoucher as GiftVoucherEntity,
  GiftVoucherId,
  PriceCents,
  UserId as UserRefId,
  VoucherCode,
  VoucherLifecycle,
  VoucherSystem,
  ZonedTimeSystem,
} from '@creativo/ecs-core';
import { rhythmRuleWords } from '@creativo/features/shared/visits';
import type { UiMark, UiStreakPeriod } from '@creativo/ui/controls';
import {
  cardLocaleOf,
  dayLong,
  dayMonth,
  dayShort,
  figure,
  monthLong,
  monthYearLong,
  runningCase,
  shopDayOf,
} from './client-card.format';
import type {
  GaugeVm,
  PassVm,
  RewardGridVm,
  RewardReadyVm,
  RewardTileVm,
  RhythmPhaseVm,
  Slice,
  StampCardVm,
  VoucherVm,
  WalletActionVm,
  WalletHoldingVm,
  WalletRhythmVm,
  WalletTierVm,
  WalletVm,
} from './client-pages.vm';
import type { ClientCardTranslate, ClientCardWords } from './client-card.words';
import { activityGroups, foldByEvent, wholeMonthsOf } from './ledger.presenter';
import {
  type LoyaltyPageInput,
  groupedGrants,
  offered,
  rhythmLabel,
  rhythmStateLine,
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
  /** The first worked visit (`ClientStatsRecord.firstVisitAtMs`); `null` before it. */
  readonly sinceMs: number | null;
  /** The vouchers issued to the person, any state; `null` = not read (no reader bound). */
  readonly vouchers: Slice<readonly GiftVoucher[]> | null;
  /**
   * The journal's newest rows under «Всички», one per entry, as
   * `LOYALTY_ACTIVITY_READER.page(uid, { limit: WALLET_ACTIVITY_READ })`
   * answers them; `null` = not read (`loyalty.points` off, no reader).
   */
  readonly activity: Slice<readonly ActivityEntry[]> | null;
  /** The rule the rhythm is judged by today; `null` when the catalogue holds no rhythm. */
  readonly ruleInForce: StreakDefinition | null;
  /** The rule that waits for its day; `null` with nothing scheduled. */
  readonly ruleUpcoming: StreakDefinition | null;
  readonly online: boolean;
  /** The subject owns the appointment: only the owner's rewards can be spent on it. */
  readonly isOwner: boolean;
  /** Cancelled or a no-show: nothing can be written to the visit. */
  readonly visitGone: boolean;
  /**
   * A reward's picture, by the REWARD's id or by its coupon's
   * (`RewardCatalogItem.grants.couponId`): the cover of the one service
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

function catalogOf(input: WalletInput): LoyaltyCatalog | null {
  return input.catalog?.status === 'ready' ? input.catalog.data : null;
}

/** A balance or a count as a display figure; one that owes wears the minus. */
function signedFigureOf(value: number, lang: string): string {
  return `${value < 0 ? MINUS : ''}${figure(Math.abs(value), lang)}`;
}

function capitalised(text: string, lang: string): string {
  return text.charAt(0).toLocaleUpperCase(lang) + text.slice(1);
}

// ── WA · The pass ───────────────────────────────────────────────────────

/** The tier the account stands on, as the plate words it; `null` when the catalogue cannot name it. */
function tierPlateOf(
  input: WalletInput,
  catalog: LoyaltyCatalog | null,
): string | null {
  if (!input.flags.tiers || catalog === null || catalog.tiers.length === 0) {
    return null;
  }
  const { currentTierId } = tierSteps(input.account.tier, catalog.tiers);
  return (
    catalog.tier(currentTierId)?.name.get(cardLocaleOf(input.words.lang)) ??
    null
  );
}

/** The pass's state line: only when it says something, and one thing. */
function passStateOf(input: WalletInput): string | null {
  const { account, flags, words, today } = input;
  const page = words.loyaltyPage;
  if (input.paused) return page.passFrozen;
  if (!flags.points) return null;
  if (account.balance < 0) return page.owes(Math.abs(account.balance));
  const expiry = account.pointsExpiry;
  if (
    expiry !== null &&
    account.balance > 0 &&
    today >= expiry.noticeFrom &&
    today <= expiry.expiresOn
  ) {
    // The projection says WHEN points lapse, not how many: what can lapse
    // is what the account holds.
    return page.expiring(
      account.balance,
      dayShort(expiry.expiresOn, today, words.lang),
    );
  }
  return null;
}

/**
 * WA — the loyalty pass. The figure is the spendable balance; with
 * `loyalty.points` off it is the count the tier is judged by. The name a
 * reader hears holds no state: the state line under it is read after it.
 */
export function passVm(input: WalletInput): PassVm {
  const { account, flags, words } = input;
  const lang = words.lang;
  const holder = input.holder?.trim() ? input.holder.trim() : null;
  const tier = tierPlateOf(input, catalogOf(input));
  const since =
    input.sinceMs === null
      ? null
      : monthYearLong(shopDayOf(input.sinceMs), lang);
  const state = passStateOf(input);
  const tenure = since === null ? null : words.head.since(since);
  if (!flags.points) {
    const visits = account.tier.qualifying;
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
    figure: signedFigureOf(account.balance, lang),
    unit: words.loyalty.pointsWord(Math.abs(account.balance)),
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
      Math.max(0, account.balance),
      since,
    ),
  };
}

// ── WC · What is held ───────────────────────────────────────────────────

/** A voucher's last day on the shop's calendar; `null` when it never expires. */
function lastDayOf(voucher: GiftVoucher): string | null {
  return voucher.expiresAt === null
    ? null
    : shopDayOf(voucher.expiresAt.toMillis());
}

/**
 * The vouchers that can be spent today (`VoucherSystem.spendable`): issued,
 * not voided, not past its day, with a balance. "Its day" is the shop's:
 * a voucher is spendable while it expires no earlier than today's shop
 * midnight. A day the table cannot place spends nothing rather than
 * everything.
 */
function spendableOf(
  vouchers: readonly GiftVoucher[],
  today: string,
): readonly GiftVoucher[] {
  // "Expires no earlier than today's shop midnight" is "expires on today
  // or later" (T5); a day that is no day spends nothing.
  const day = LocalDate.parse(today);
  if (!day.ok) return [];
  return vouchers.filter((voucher) =>
    VoucherSystem.spendable(voucherOf(voucher), day.value),
  );
}

/** The day a never-expiring voucher sorts as: after every real one. */
const NEVER = '9999-12-31';

function voucherVm(
  voucher: GiftVoucher,
  lastDay: string | null,
  today: string,
  words: Words,
): VoucherVm {
  const page = words.loyaltyPage;
  const lang = words.lang;
  const balance = formatMoney(voucher.balance, lang);
  const value = formatMoney(voucher.initialValue, lang);
  const until = lastDay === null ? null : dayShort(lastDay, today, lang);
  // One fact, once: an untouched voucher's chip does not repeat the figure
  // over it, so it says its validity alone, or nothing.
  const untouched = voucher.balance.equals(voucher.initialValue);
  return {
    voucherId: voucher.id.value,
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
  // Each voucher's last day worked out ONCE (the shop's calendar is a zone
  // reading), then sorted on it: day keys are ASCII, so `<` is their order.
  const held = spendableOf(vouchers, today).map((voucher) => ({
    voucher,
    lastDay: lastDayOf(voucher),
  }));
  held.sort((a, b) => {
    const x = a.lastDay ?? NEVER;
    const y = b.lastDay ?? NEVER;
    return x < y
      ? -1
      : x > y
        ? 1
        : a.voucher.id.value.localeCompare(b.voucher.id.value);
  });
  return held.map(({ voucher, lastDay }) =>
    voucherVm(voucher, lastDay, today, words),
  );
}

/** The grants as the wallet's tickets: ready ones and the ones on this visit's bill. */
function ticketGroups(input: WalletInput) {
  // A companion's rewards cannot be spent on this visit, and a paused
  // client's are out of reach: neither is drawn.
  return input.isOwner && !input.paused
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
    const reward = punch.title.get(locale);
    const spoken = runningCase(reward, words.lang);
    const filled = Math.min(Math.max(punch.filled, 0), punch.size);
    const left = Math.max(0, punch.size - filled);
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
      sentence: page.stampsToNext(Math.max(1, left)),
    };
    return {
      kind: 'stamps',
      card,
      line: page.stampsFor(punch.size, spoken),
    };
  });
}

/** The vouchers the read answered; none while it is on its way, failed or not made. */
function vouchersOf(input: WalletInput): readonly GiftVoucher[] {
  return input.vouchers?.status === 'ready' ? input.vouchers.data : [];
}

/**
 * WC — everything held, in the wallet's order: gift vouchers, reward
 * tickets, stamp cards; within a kind the soonest to expire first.
 */
export function walletHoldings(input: WalletInput): readonly WalletHoldingVm[] {
  const { today, words } = input;
  return [
    ...voucherVms(vouchersOf(input), today, words).map(
      (voucher): WalletHoldingVm => ({ kind: 'voucher', voucher }),
    ),
    ...walletTickets(input).map((ticket): WalletHoldingVm => ({
      kind: 'ticket',
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
  const [first, ...rest] = spendableOf(vouchersOf(input), today).map(
    (voucher) => voucher.balance,
  );
  if (first === undefined || rest.length === 0) return null;
  let sum = first;
  for (const balance of rest) {
    const added = sum.add(balance);
    // Two currencies have no sum: nothing to say.
    if (added.isFailure()) return null;
    sum = added.value;
  }
  return words.loyaltyPage.walletSum(
    holdings.length,
    formatMoney(sum, words.lang),
  );
}

// ── WB · The discs ──────────────────────────────────────────────────────

/** Something can be written to the visit now, for this person. */
function canWrite(input: WalletInput): boolean {
  return input.isOwner && !input.visitGone && input.online && !input.paused;
}

/**
 * WB — the discs that work today, in their order; one that cannot be used
 * is absent and the run closes up (§2.2.3).
 */
export function walletActions(input: WalletInput): readonly WalletActionVm[] {
  const { flags, words } = input;
  const actions = words.loyaltyPage.actions;
  const writable = canWrite(input);
  const ready = writable
    ? ticketGroups(input).filter((group) => !group.applied)
    : [];
  const out: WalletActionVm[] = [];
  const [only] = ready;
  if (only !== undefined) {
    const several = ready.length > 1;
    out.push({
      id: 'use',
      icon: 'promo.coupon',
      label: actions.use,
      prominence: 'accent',
      accessibleName: several
        ? `${actions.useName}, ${actions.useCount(ready.length)}`
        : actions.useName,
      grantId: several ? null : (only.grants[0]?.grantId ?? null),
      count: several ? ready.length : null,
    });
  }
  if (writable) {
    out.push({
      id: 'code',
      icon: 'loyalty.enterCode',
      label: actions.code,
      prominence: 'standard',
      accessibleName: actions.codeName,
      grantId: null,
      count: null,
    });
  }
  if (flags.points && catalogSectionStands(input)) {
    out.push({
      id: 'catalog',
      icon: 'loyalty.reward',
      label: actions.catalog,
      prominence: 'standard',
      accessibleName: actions.catalogName,
      grantId: null,
      count: null,
    });
  }
  if (flags.points) {
    out.push({
      id: 'history',
      icon: 'loyalty.ledger',
      label: actions.history,
      prominence: 'standard',
      accessibleName: actions.historyName,
      grantId: null,
      count: null,
    });
  }
  return out;
}

/**
 * «Награди за точки» has somewhere to land: the section is drawn while its
 * read is on its way and when it failed (the heading stands over a
 * skeleton or a notice), and is absent only once the catalogue is known to
 * offer nothing.
 */
function catalogSectionStands(input: WalletInput): boolean {
  const catalog = input.catalog;
  if (catalog === null) return false;
  return catalog.status !== 'ready' || tilesOf(input, catalog.data).length > 0;
}

// ── WD · The rhythm ─────────────────────────────────────────────────────

/** Where the rhythm stands: the sentence, the day it names, the capsule beside the figure. */
interface RhythmStanding {
  readonly line: string;
  /** The day the line names: the open mark under it stays uncaptioned for that day. */
  readonly day: string | null;
  /** `null` while healthy. */
  readonly phase: RhythmPhaseVm | null;
  /** The line names no due date, so the track's sentence names none either. */
  readonly dueNamed: boolean;
}

/**
 * The day the NEXT visit keeps the rhythm by, once the visit in the chair
 * counts: the open period's own interval after TODAY. `null` when nobody
 * is in the chair, for a paused client, under a used protection and while
 * no period is open.
 */
function inChairDueOf(state: StreakState, input: WalletInput): string | null {
  return StreakSystem.inChairDue(streakStateOf(state), dayOf(input.today), {
    inChairToday: input.inChairToday,
    paused: input.paused,
  });
}

function standingOf(
  state: StreakState,
  inChairDue: string | null,
  input: WalletInput,
): RhythmStanding {
  const { words, today } = input;
  const rhythm = words.rhythm;
  const lang = words.lang;
  const short = (day: string) => dayShort(day, today, lang);
  const built = () => rhythmStateLine(state, false, inChairDue, today, words);
  if (input.paused) {
    return { line: rhythm.frozen, day: null, phase: null, dueNamed: false };
  }
  const started = state.current > 0 || state.lastQualifiedAt !== null;
  if (inChairDue !== null || !started) {
    return { ...built(), phase: null, dueNamed: inChairDue !== null };
  }
  const phase = state.phase;
  switch (phase.kind) {
    case 'frozen': {
      const line =
        phase.reason === 'freeze'
          ? rhythm.stateFrozenFreeze
          : phase.reason === 'excuse'
            ? rhythm.stateFrozenExcuse
            : phase.reason === 'clientPause'
              ? capitalised(rhythm.reason('clientPause'), lang)
              : rhythm.frozen;
      return {
        line,
        day: null,
        phase: { text: rhythm.phaseFrozen, tone: 'neutral' },
        dueNamed: false,
      };
    }
    case 'broken': {
      // Where nothing can be restored the day before the break is kept,
      // so no day reads as one: the next visit simply starts the count.
      const repairable = phase.repairableUntil >= today;
      return {
        line: repairable
          ? rhythm.stateBroken(short(phase.repairableUntil))
          : rhythm.stateNone,
        day: repairable ? phase.repairableUntil : null,
        phase: {
          text: rhythm.phaseBroken,
          tone: repairable ? 'warning' : 'neutral',
        },
        dueNamed: false,
      };
    }
    case 'active':
    case 'atRisk':
    case 'inGrace': {
      const held = state.heldBy;
      if (held !== null) {
        return {
          line: rhythm.stateHeld(short(held.on)),
          day: held.on,
          // A visit on the book answers the cue: the capsule says so where
          // a warning would have stood, and nothing stands beside a
          // healthy figure.
          phase:
            phase.kind === 'active'
              ? null
              : { text: rhythm.phaseHeld(short(held.on)), tone: 'neutral' },
          dueNamed: false,
        };
      }
      return {
        ...built(),
        phase:
          phase.kind === 'atRisk'
            ? { text: rhythm.phaseAtRisk(short(phase.dueBy)), tone: 'warning' }
            : phase.kind === 'inGrace'
              ? {
                  text: rhythm.phaseInGrace(short(phase.graceUntil)),
                  tone: 'warning',
                }
              : null,
        dueNamed: true,
      };
    }
  }
}

/** A closed period as the track draws it; a visit's caption is chosen with its neighbours' (`rhythmMarks`). */
function closedPeriod(
  fact: StreakPeriodFact,
  input: WalletInput,
): UiStreakPeriod {
  const { words, today } = input;
  const rhythm = words.rhythm;
  const month = monthLong(fact.on, words.lang);
  switch (fact.mark) {
    case 'kept':
      return {
        id: `kept-${fact.on}`,
        mark: 'kept',
        caption: '',
        description: rhythm.markKept(
          month,
          dayShort(fact.on, today, words.lang),
        ),
      };
    case 'repaired':
      return {
        id: `repaired-${fact.on}`,
        mark: 'repaired',
        caption: '',
        description: rhythm.markRepaired(month),
      };
    case 'protected':
      return {
        id: `protected-${fact.on}`,
        mark: 'protected',
        caption: '',
        description: rhythm.markProtected(
          month,
          fact.reason === null
            ? rhythm.reasonFreeze
            : rhythm.reason(fact.reason),
        ),
      };
    case 'missed':
      return {
        id: `missed-${fact.on}`,
        mark: 'missed',
        caption: '',
        description: rhythm.markMissed(month),
      };
  }
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
    const reason = LEGACY_FREEZE_REASON[mark.reason as FreezeReason];
    return {
      id: 'current',
      mark: 'protected',
      caption: due(mark.on),
      description:
        reason === 'excuse'
          ? // Which excuse it was is the closed period's to say; the open
            // one names the day its due date moved to.
            rhythm.markCurrent(dayLong(mark.on, today, lang))
          : rhythm.markProtected(
              monthLong(mark.on, lang),
              rhythm.reason(reason),
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
  const track = StreakSystem.track(streakStateOf(state), {
    today: dayOf(input.today),
    inChairToday: input.inChairToday,
    paused: input.paused,
    limit: WALLET_RHYTHM_PERIODS,
  });
  return track.marks.map((mark) => {
    const period = mark.open
      ? openPeriod(mark, standing, input)
      : closedPeriod(
          {
            mark: LEGACY_PERIOD_MARK[
              mark.streakTrackMarkKind as SystemPeriodMark
            ],
            on: mark.on,
            reason:
              mark.reason === null
                ? null
                : LEGACY_PERIOD_REASON[mark.reason as SystemPeriodReason],
          },
          input,
        );
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
  const rule = input.ruleInForce;
  if (!flags.streaks || rule === null || !rule.enabled) return null;
  const state = new Map(Object.entries(account.streaks)).get(rule.id);
  if (state === undefined) return null;

  const lang = words.lang;
  const inChairDue = inChairDueOf(state, input);
  const standing = standingOf(state, inChairDue, input);
  const nameOf = input.nameOf ?? null;
  const ruleWords = rhythmRuleWords(rule.summary(), input.translate, lang, {
    period: state.period,
    nameOf,
  });
  const upcoming = input.ruleUpcoming;
  return {
    figure: figure(state.current, lang),
    unit: words.loyaltyPage.inRhythm(state.current),
    phase: standing.phase,
    periods: rhythmMarks(state, standing, input),
    trackName: rhythmLabel(
      standing.dueNamed ? state : { ...state, dueBy: null },
      standing.dueNamed ? inChairDue : null,
      today,
      words,
    ),
    stateLine: standing.line,
    best:
      state.best > state.current
        ? words.loyaltyPage.rhythmBest(state.best)
        : null,
    protections:
      rule.summary().protections !== null && state.freezesBanked > 0
        ? words.rhythm.protections(state.freezesBanked)
        : null,
    ruleLine: ruleWords.short,
    ruleFull: [ruleWords.sentence, ...ruleWords.details],
    ruleUpcoming:
      upcoming !== null && upcoming.effectiveFrom > today
        ? words.rhythm.ruleUpcoming(
            dayShort(upcoming.effectiveFrom, today, lang),
            runningCase(
              rhythmRuleWords(upcoming.summary(), input.translate, lang, {
                nameOf,
              }).short,
              lang,
            ),
          )
        : null,
    frozen: input.paused,
  };
}

// ── WE · The status ─────────────────────────────────────────────────────

function tierOf(
  input: WalletInput,
  catalog: LoyaltyCatalog,
): WalletTierVm | null {
  const { account, words } = input;
  if (catalog.tiers.length === 0) return null;
  const locale = cardLocaleOf(words.lang);
  const page = words.loyaltyPage;
  const track = tierSteps(account.tier, catalog.tiers);
  const stepOf = (tierId: string | null) =>
    track.steps.find((step) => step.tierId === tierId) ?? null;
  const current = stepOf(track.currentTierId);
  const next = stepOf(track.nextTierId);
  // The nodes are the tiers, named; what remains is the ring's, so no node
  // says it a second time.
  const marks: readonly UiMark[] = track.steps.map((step) => ({
    value: step.atLeast,
    label: step.name.get(locale),
  }));
  // The ring and the gauge are `TierSystem.progress`'s numbers.
  const progress = TierSystem.progress(
    tierStateOf(account.tier),
    catalog.tiers.map(tierRefOf),
  );
  const steps = (valueText: string): GaugeVm => ({
    value: progress.gaugeValue,
    min: 0,
    max: progress.top,
    marks,
    label: page.tier,
    valueText,
  });
  const remaining = progress.remaining;

  if (next === null || remaining === null || progress.atTop) {
    const sentence = page.tierTop(progress.currentAtLeast ?? progress.value);
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

  const sentence = page.tierName(
    current?.name.get(locale) ?? '',
    track.value,
    remaining,
    next.name.get(locale),
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
    line1: page.tierTo(next.name.get(locale)),
    line2: page.tierQualifying(track.value),
    steps: steps(sentence),
    accessibleName: sentence,
  };
}

/**
 * WE — «Статус»: what remains in a ring, the tiers as steps; `null` with
 * `loyalty.tiers` off and until the catalogue names its tiers.
 */
export function walletTierVm(input: WalletInput): WalletTierVm | null {
  const catalog = catalogOf(input);
  return !input.flags.tiers || catalog === null ? null : tierOf(input, catalog);
}

// ── WF · What the points buy ────────────────────────────────────────────

/**
 * The catalogue as tiles, within reach first. A tile is INFORMATION in
 * this round (ES-2): it says whether the points cover the reward, so
 * «within reach» is the balance against the cost and nothing else. A
 * reward nobody can take today (not yet offered, sold out) is no tile.
 */
function tilesOf(
  input: WalletInput,
  catalog: LoyaltyCatalog,
): readonly RewardTileVm[] {
  const { account, words, today } = input;
  const page = words.loyaltyPage;
  const locale = cardLocaleOf(words.lang);
  const balance = account.balance;
  const tiles = offered(catalog, today).flatMap(
    (reward): readonly RewardTileVm[] => {
      // Within reach is the balance against the cost and nothing else:
      // `RewardSystem.affordable`; `null` is a reward nobody can take today.
      const reach = RewardSystem.affordable(
        rewardRefOf(reward),
        balance,
        dayOf(today),
      );
      if (reach === null) return [];
      const title = reward.name.get(locale);
      const missing = reach.affordable ? null : figure(reach.short, words.lang);
      return [
        {
          rewardId: reward.id,
          title,
          cost: words.ledgerPage.points(reward.cost),
          affordable: missing === null,
          missing: missing === null ? null : page.moreToGo(missing),
          progress: reach.progress,
          src:
            input.covers.get(reward.id) ??
            (reward.grants.kind === 'coupon'
              ? input.covers.get(reward.grants.couponId)
              : undefined) ??
            null,
          accessibleName: page.rewardName(
            reward.cost,
            title,
            missing === null ? '' : page.rewardMoreSuffix(missing),
          ),
        },
      ];
    },
  );
  // Within reach first; inside each half the catalogue's own order.
  return [
    ...tiles.filter((tile) => tile.affordable),
    ...tiles.filter((tile) => !tile.affordable),
  ];
}

/** WF — the reward tiles; empty with `loyalty.points` off and until the catalogue is read. */
export function rewardTiles(input: WalletInput): readonly RewardTileVm[] {
  const catalog = catalogOf(input);
  return !input.flags.points || catalog === null ? [] : tilesOf(input, catalog);
}

function rewardGrid(
  input: WalletInput,
  catalog: LoyaltyCatalog,
): RewardGridVm | null {
  const { account, words } = input;
  const tiles = tilesOf(input, catalog);
  return tiles.length === 0
    ? null
    : {
        name: words.loyaltyPage.catalogListName(
          words.loyalty.points(Math.max(0, account.balance)),
          tiles.filter((tile) => tile.affordable).length,
          tiles.length,
        ),
        tiles,
      };
}

// ── The page ────────────────────────────────────────────────────────────

/** WG — the newest five events of what was read, by month. */
function walletActivity(entries: readonly ActivityEntry[], input: WalletInput) {
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
function holdingsSlice(input: WalletInput): Slice<readonly WalletHoldingVm[]> {
  const status = input.vouchers?.status ?? 'ready';
  return status === 'ready'
    ? { status, data: walletHoldings(input) }
    : { status };
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
      holdings.status === 'ready'
        ? holdingsDetailOf(input, holdings.data)
        : null,
    ...(rhythm === null ? {} : { rhythm }),
    ...(tier === undefined ? {} : { tier }),
    ...(catalog === undefined ? {} : { catalog }),
    ...(activity === undefined ? {} : { activity }),
  };
}

// ── The bridge: legacy shapes → ecs-core structs (Phase 4 deletes it) ────

/** What carries a frozen period, as the legacy phase names it. */
type FrozenReason = Extract<StreakState['phase'], { kind: 'frozen' }>['reason'];

/** A shop day the card holds: a guarded document day, a clock's «today». */
function dayOf(raw: string): LocalDate {
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : defect(`${raw} is no calendar day`);
}

/** An instant a document held: always inside the brand's window. */
function utcOf(at: Date): UtcEpochMs {
  const epochMs = at.getTime();
  const utc = UtcEpochMs.of(epochMs);
  return utc.ok ? utc.value : defect(`${epochMs} is not an instant`);
}

const SYSTEM_FREEZE_REASON = {
  freeze: FreezeReason.Freeze,
  pause: FreezeReason.Pause,
  clientPause: FreezeReason.ClientPause,
  excuse: FreezeReason.Excuse,
} as const satisfies Record<FrozenReason, FreezeReason>;

const LEGACY_FREEZE_REASON = {
  [FreezeReason.Freeze]: 'freeze',
  [FreezeReason.Pause]: 'pause',
  [FreezeReason.ClientPause]: 'clientPause',
  [FreezeReason.Excuse]: 'excuse',
} as const satisfies Record<FreezeReason, FrozenReason>;

const SYSTEM_PERIOD_MARK = {
  kept: SystemPeriodMark.Kept,
  protected: SystemPeriodMark.Protected,
  repaired: SystemPeriodMark.Repaired,
  missed: SystemPeriodMark.Missed,
} as const satisfies Record<StreakPeriodFact['mark'], SystemPeriodMark>;

const LEGACY_PERIOD_MARK = {
  [SystemPeriodMark.Kept]: 'kept',
  [SystemPeriodMark.Protected]: 'protected',
  [SystemPeriodMark.Repaired]: 'repaired',
  [SystemPeriodMark.Missed]: 'missed',
} as const satisfies Record<SystemPeriodMark, StreakPeriodFact['mark']>;

const SYSTEM_PERIOD_REASON = {
  freeze: FreezeReason.Freeze,
  pause: FreezeReason.Pause,
  clientPause: FreezeReason.ClientPause,
  shopClosure: SystemExcuse.ShopClosure,
  barberAbsence: SystemExcuse.BarberAbsence,
  staffCancelled: SystemExcuse.StaffCancelled,
  closedDays: SystemExcuse.ClosedDays,
} as const satisfies Record<
  NonNullable<StreakPeriodFact['reason']>,
  SystemPeriodReason
>;

const LEGACY_PERIOD_REASON = {
  [FreezeReason.Freeze]: 'freeze',
  [FreezeReason.Pause]: 'pause',
  [FreezeReason.ClientPause]: 'clientPause',
  [SystemExcuse.ShopClosure]: 'shopClosure',
  [SystemExcuse.BarberAbsence]: 'barberAbsence',
  [SystemExcuse.StaffCancelled]: 'staffCancelled',
  [SystemExcuse.ClosedDays]: 'closedDays',
} as const satisfies Record<
  SystemPeriodReason,
  NonNullable<StreakPeriodFact['reason']>
>;

const SYSTEM_INTERVAL_SOURCE = {
  fixed: SystemIntervalSource.Fixed,
  personal: SystemIntervalSource.Personal,
  fallback: SystemIntervalSource.Fallback,
} as const satisfies Record<
  NonNullable<StreakState['period']>['source'],
  SystemIntervalSource
>;

/** The legacy phase as the variant slice the state carries flat. */
function phaseOf(phase: StreakState['phase']): StreakPhaseState {
  switch (phase.kind) {
    case 'atRisk':
      return StreakPhaseState.atRisk(dayOf(phase.dueBy));
    case 'inGrace':
      return StreakPhaseState.inGrace(dayOf(phase.graceUntil));
    case 'frozen':
      return StreakPhaseState.frozen(
        dayOf(phase.until),
        SYSTEM_FREEZE_REASON[phase.reason],
      );
    case 'broken':
      return StreakPhaseState.broken(
        dayOf(phase.brokenAt),
        dayOf(phase.repairableUntil),
      );
    default:
      return StreakPhaseState.active();
  }
}

/** The account's rhythm as `StreakSystem` reads it: flat (Law 6), the instant and the days as brands, the tags the dictionary's. */
function streakStateOf(state: StreakState): SystemStreakState {
  const { period, heldBy } = state;
  return {
    streakId: StreakDefinitionId.of(state.streakId),
    definitionVersion: state.definitionVersion,
    ...phaseOf(state.phase),
    current: state.current,
    best: state.best,
    lastQualifiedAtUtcMs:
      state.lastQualifiedAt === null ? null : utcOf(state.lastQualifiedAt),
    dueBy: state.dueBy === null ? null : dayOf(state.dueBy),
    freezesBanked: state.freezesBanked,
    periodIntervalDays: period === null ? null : period.intervalDays,
    periodGraceDays: period === null ? null : period.graceDays,
    periodSource:
      period === null ? null : SYSTEM_INTERVAL_SOURCE[period.source],
    periodHabitDays: period === null ? null : period.habitDays,
    periods: state.periods.map((fact) => ({
      streakPeriodMark: SYSTEM_PERIOD_MARK[fact.mark],
      on: dayOf(fact.on),
      periodReason:
        fact.reason === null ? null : SYSTEM_PERIOD_REASON[fact.reason],
    })),
    heldByAppointmentId:
      heldBy === null ? null : AppointmentId.of(heldBy.appointmentId),
    heldOn: heldBy === null ? null : dayOf(heldBy.on),
    runStartedOn:
      state.runStartedOn === null ? null : dayOf(state.runStartedOn),
  };
}

/** The account's tier as `TierSystem` reads it: the standing and the override, flat. */
function tierStateOf(tier: WalletInput['account']['tier']): TierState {
  const { override } = tier;
  const until =
    override === null || override.until === null ? null : dayOf(override.until);
  return {
    tierId: TierId.of(tier.current),
    tierDefinitionVersion: tier.definitionVersion,
    tierSinceUtcMs: utcOf(tier.since),
    tierQualifying: tier.qualifying,
    nextTierId: tier.next === null ? null : TierId.of(tier.next),
    tierRemaining: tier.remaining,
    ...(override === null
      ? TierOverride.none()
      : override.source.kind === 'award'
        ? TierOverride.award(
            TierId.of(override.tierId),
            until,
            override.source.awardKey,
          )
        : TierOverride.adjustment(
            TierId.of(override.tierId),
            until,
            AdjustmentId.of(override.source.adjustmentId),
          )),
  };
}

/** A tier as `TierSystem` reads it; its name rides along by reference. */
function tierRefOf(tier: LoyaltyCatalog['tiers'][number]): TierStepRef {
  return {
    id: TierId.of(tier.id),
    rank: tier.rank,
    name: tier.name,
    qualifyAtLeast: tier.qualify.atLeast,
  };
}

/** A reward as `RewardSystem` reads it: flat, the days as brands. */
function rewardRefOf(
  reward: LoyaltyCatalog['rewards'][number],
): RedeemableRewardRef {
  return {
    id: RewardId.of(reward.id),
    cost: Points.of(reward.cost),
    enabled: reward.enabled,
    order: reward.order,
    availableFrom:
      reward.available.from === null ? null : dayOf(reward.available.from),
    availableUntil:
      reward.available.until === null ? null : dayOf(reward.available.until),
    perClientLimitCount: reward.limits.perClient?.count ?? null,
    perClientLimitWindowDays: reward.limits.perClient?.windowDays ?? null,
    totalLimit: reward.limits.total,
    redeemedCount: reward.redeemedCount,
  };
}

/** A legacy figure the class already guarded, as the brand. */
function sure<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: unknown },
  what: string,
): T {
  return result.ok ? result.value : defect(`unreachable: ${what}`);
}

/**
 * A voucher as `VoucherSystem.spendable` reads it: flat, the money as
 * cents and one currency, the expiry's shop day beside its instant (T5,
 * read on the instant's own zone, as the voucher's own shim reads it).
 */
function voucherOf(voucher: GiftVoucher): GiftVoucherEntity {
  const { state } = voucher;
  const instantOf = (at: NonNullable<GiftVoucher['expiresAt']>) =>
    sure(UtcEpochMs.of(at.toMillis()), 'an instant');
  return {
    id: GiftVoucherId.of(voucher.id.value),
    code: VoucherCode.of(voucher.code),
    initialValueCents: sure(
      PriceCents.of(voucher.initialValue.toMinorUnits()),
      'an amount',
    ),
    balanceCents: sure(
      PriceCents.of(voucher.balance.toMinorUnits()),
      'an amount',
    ),
    currency: sure(
      Currency.parse(voucher.balance.currencyCode()),
      'a currency',
    ),
    issuedAtUtcMs: instantOf(voucher.issuedAt),
    expiresAtUtcMs:
      voucher.expiresAt === null ? null : instantOf(voucher.expiresAt),
    expiresLocalDate:
      voucher.expiresAt === null
        ? null
        : ZonedTimeSystem.toLocal(
            instantOf(voucher.expiresAt),
            sure(
              ZonedTimeSystem.checkZone(voucher.expiresAt.zoneName),
              'a zone',
            ),
          ).localDate,
    issuedToUserId:
      voucher.issuedToUserId === null
        ? null
        : UserRefId.of(voucher.issuedToUserId.value),
    ...(state.kind === 'void'
      ? VoucherLifecycle.voided(instantOf(state.voidedAt), state.reason)
      : VoucherLifecycle.active()),
  };
}
