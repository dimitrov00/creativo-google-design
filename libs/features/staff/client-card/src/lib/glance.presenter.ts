import type {
  Appointment,
  GiftVoucher,
  LoyaltyAccount,
  StreakDefinition,
  User,
} from '@core/entities';
import {
  VisitCardSlot,
  visitCardOf,
  visitRowOf,
  waitlistCardOf,
} from '@creativo/features/shared/visits';
import { formatCents, formatWallClock } from '@creativo/ui/wall-clock';
import { type LocalDate, type ServiceId, defect } from '@core/primitives';
import {
  BirthdayMoment,
  CouponOccasion,
  type PersonalRecord,
  PersonalRecordKind,
  PointsReach,
  TenureState,
  TierPlateState,
  VisitGrain,
  VisitPerspective,
} from '@core/components';
import {
  AgeSystem,
  ClientGlanceSystem,
  ClientStatsSystem,
  CouponGrantSystem,
  type GlanceHoldings,
  LoyaltyCatalogSystem,
  RecordsSystem,
  RewardSystem,
  StandingSystem,
  StreakRuleSystem,
  TierSystem,
  type ValidLoyaltyCatalog,
  VisitListSystem,
  WaitlistSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  type AchievementsContext,
  familyOfMedal,
  progressList,
} from './achievements.presenter';
import type { ClientCardGrant } from './client-card.contracts';
import {
  cardLocaleOf,
  dayShort,
  dayWithYear,
  figure,
  heldFacts,
  hungJoints,
  inSentence,
  monthYearLong,
  quietRun,
  runningCase,
  runsOf,
  shopDayOf,
} from './client-card.format';
import {
  type CapsulesInput,
  type HeadInput,
  type LoyaltyTilesInput,
  type VisitsModuleInput,
  capsulesRun,
  displayNameOf,
  lastWorkedVisit,
  medalStripVm,
  pauseOf,
} from './client-card.presenter';
import {
  type AchievementTileVm,
  type AchievementsData,
  type BirthdayVm,
  ClientCapsuleId,
  type ClientCapsulesVm,
  type ClientHeroVm,
  type HeroTierVm,
  type HoldingFactVm,
  type LinePart,
  type LoyaltyGlanceVm,
  type MedalsGlanceVm,
  type RecordFactVm,
  type VisitCardsVm,
} from './client-pages.vm';
import {
  type ClientCardWords,
  LoyaltyHoldingWord,
  RECORD_KIND_WORDS,
} from './client-card.words';
import { glanceReward, rhythmStateOf } from './loyalty.presenter';
import { medalRingVm } from './medals.presenter';

/*
 * THE GLANCE PAGE «client», REVISION 3 (client-card-revision-3 §2.1), module
 * by module, as pure functions: the hero, the capsule row, the birthday
 * card, the visit cards, the loyalty card and the medals card. The quick
 * actions, the reward ticket and the photos are the built functions'
 * (`quickActionsVm`, `glanceReward`, `photoRailVm`): what did not change is
 * not written again.
 *
 * NEW BESIDE BUILT (§4.9): the built glance keeps its own presenter until
 * its body is re-drawn, and this file reads that one for everything the two
 * share — who is paused, whose birthday it is, which visit is the last,
 * which medals the strip shows and what its cue says. A medal is drawn by
 * the collection's own presenter (`medalRingVm`), so a family wears one face
 * on the glance and one push away. The store decides what has loaded; these
 * decide what it says. Nothing here reads a clock, a flag or a port.
 */

/** How many records the medals card's line prints (`RecordsSystem.glanceLine` picks them). */
const RECORD_LINE_LIMIT = 2;

/** The typographic minus (U+2212): a balance owed prints as the pass prints it. */
const MINUS = '−';

// ── Words and lines ─────────────────────────────────────────────────────

/**
 * ONE translated sentence as the hero's quiet line: cut around the facts
 * that were passed into it (each a run in primary ink, what stands between
 * them quiet — the card's one grammar, `client-card.format.ts`), the
 * facts' words held together («март 2025 г.», «4 седмици») and the
 * catalogue's joints hung on no-break spaces, so the page parts the line
 * into its FACTS at them and a wrapped line neither ends nor opens on a
 * «·» (review 3, round 4). The runs joined are the sentence, letter for
 * letter but for those spaces.
 */
function lineParts(
  sentence: string,
  facts: readonly string[],
): readonly LinePart[] {
  return hungJoints(heldFacts(runsOf(sentence, facts)));
}

/** A line with no fact to set apart: «Първо посещение», «Гост · без профил» (two facts to the page, one sentence to a reader). */
function plainLine(sentence: string): readonly LinePart[] {
  return hungJoints([quietRun(sentence)]);
}

/** «петък» — a shop day's weekday in words, formatted as the day itself (no zone moves it). */
function weekdayLong(day: LocalDate, lang: string): string {
  return formatWallClock(day, null, lang, { weekday: 'long' });
}

// ── A · the hero ────────────────────────────────────────────────────────

export interface HeroInput extends HeadInput {
  /** The account and the catalogue when the tier may show (`loyalty.tiers`), else `null`. */
  readonly tier: {
    readonly account: LoyaltyAccount;
    readonly catalog: ValidLoyaltyCatalog;
  } | null;
}

/**
 * A5 — the quiet line under the name, the ONE place for tenure and cadence,
 * a first visit, a guest, a pause. It waits for the profile and the stats
 * (the D-9 gate: a pause never pushes painted content); a guest's is known
 * from the seat.
 */
function heroLine(
  input: HeroInput,
  pause: ReturnType<typeof pauseOf>,
  words: ClientCardWords,
): readonly LinePart[] | null {
  if (input.subject.userId === null) return plainLine(words.head.guest);
  const zone = input.zone;
  if (!input.settled || zone === null) return null;
  if (pause !== null) {
    if (pause.until === null) return plainLine(words.head.pausedPermanent);
    const until = dayShort(
      pause.until,
      shopDayOf(input.nowUtcMs, zone),
      words.lang,
    );
    return lineParts(words.head.pausedUntil(until), [until]);
  }
  if (!input.statsKnown) return null;
  // How long the client has come is `ClientStatsSystem.tenureOf`'s: a
  // cadence needs three worked visits (R34), until then the tenure alone.
  const tenure = ClientStatsSystem.tenureOf(input.stats);
  if (tenure.tenureState === TenureState.FirstVisit || tenure.since === null) {
    return plainLine(words.head.firstVisit);
  }
  const since = monthYearLong(tenure.since, words.lang);
  if (
    tenure.tenureState === TenureState.Since ||
    tenure.cadenceWeeks === null
  ) {
    return lineParts(words.head.since(since), [since]);
  }
  const cadence = words.head.cadence(tenure.cadenceWeeks);
  return lineParts(words.head.sinceCadence(since, cadence), [since, cadence]);
}

/**
 * A2, A3 — the tier as the plate on the face's rim and the ring round it:
 * how far the qualifying visits have come from the tier's own threshold to
 * the next one's, full at the top of the track.
 *
 * A tier held by an override may stand above what the visits have reached.
 * The account's `next` is then no step up from it, and nothing is under
 * way that a ring could draw or a sentence could promise: the plate stands
 * alone (`progress` null), named by the tier.
 */
function heroTier(
  tier: NonNullable<HeroInput['tier']>,
  words: ClientCardWords,
): HeroTierVm | null {
  const locale = cardLocaleOf(words.lang);
  // Which plate, its ring and what remains are `TierSystem.plate`'s; the
  // tiers' names are the catalogue's.
  const plate = TierSystem.plate(tier.account, tier.catalog.tiers);
  if (plate === null) return null;
  const current = LoyaltyCatalogSystem.tier(tier.catalog, plate.currentTierId);
  if (current === null) return null;
  const name = current.name[locale];
  switch (plate.tierPlateState) {
    case TierPlateState.Top:
      return {
        name,
        progress: plate.progress,
        accessibleName: words.head.tierTopName(name),
      };
    case TierPlateState.HeldAbove:
      return { name, progress: null, accessibleName: name };
    case TierPlateState.Climbing: {
      const next =
        plate.nextTierId === null
          ? null
          : LoyaltyCatalogSystem.tier(tier.catalog, plate.nextTierId);
      // A CLIMBING plate always names the next tier and what remains.
      if (next === null || plate.remaining === null) {
        return defect(
          `${plate.currentTierId} climbs to no tier of the catalogue`,
        );
      }
      return {
        name,
        progress: plate.progress,
        accessibleName: words.head.tierName(
          name,
          words.visitsModule.sectionVisits(plate.remaining),
          next.name[locale],
        ),
      };
    }
  }
}

/**
 * A — the head as a centred hero. The face and the name render from the
 * seat's snapshot at once, before the card's words have loaded too; the
 * line, the plate and the ring land TOGETHER, once the profile and the
 * stats have answered — so the ring never turns from the tier's to a
 * pause's warning under the eye. A paused client keeps the plate: which
 * ring is drawn is the body's (`paused`).
 */
export function clientHeroVm(input: HeroInput): ClientHeroVm {
  const { subject, user, words } = input;
  const name = displayNameOf(subject, user);
  const pause =
    input.zone === null ? null : pauseOf(user, input.nowUtcMs, input.zone);
  return {
    name,
    line: words === null ? null : heroLine(input, pause, words),
    tier:
      words === null ||
      subject.userId === null ||
      !input.settled ||
      input.tier === null
        ? null
        : heroTier(input.tier, words),
    avatarSrc: subject.avatarSrc ?? input.avatarSrc,
    initialsFrom: name,
    paused: pause !== null,
  };
}

// ── B · the capsule row ─────────────────────────────────────────────────

/**
 * B — warnings and tags only: the reliability capsule at two no-shows in 90
 * days, warning-toned behind its own glyph (the word stays primary ink).
 * No tier (the plate says it) and no birthday (the card does); the row is
 * absent when this comes back empty. Staff tags (P1) join through the same
 * run, which is why the cap stays.
 */
export function overviewCapsulesVm(
  input: Omit<CapsulesInput, 'tier'>,
): ClientCapsulesVm {
  const capsules: ClientCapsulesVm['shown'][number][] = [];
  if (input.stats !== null) {
    // Whether the no-shows warn is `ClientStatsSystem.noShowWarning`'s.
    const noShows = ClientStatsSystem.noShowWarning(
      ClientStatsSystem.statWindows(
        input.stats,
        ZonedTimeSystem.shopNow(input.nowUtcMs, input.zone),
      ),
    );
    if (noShows !== null) {
      capsules.push({
        id: ClientCapsuleId.NoShows,
        text: input.words.capsules.noShows(noShows),
        tone: 'warning',
        icon: 'visit.noShow',
      });
    }
  }
  return capsulesRun(capsules, input.words);
}

// ── BD · the birthday card ──────────────────────────────────────────────

export interface BirthdayInput {
  readonly user: User | null;
  /** The shop calendar's today, on the shop's zone. */
  readonly today: LocalDate;
  /**
   * The owner's usable grants and the ones on this visit's bill, as the
   * reward ticket takes them. EMPTY wherever a reward cannot be spent on
   * this visit: a party member, offline, a gone visit, a paused client —
   * the band then stands alone.
   */
  readonly grants: readonly ClientCardGrant[];
  readonly grantsOnBill: readonly ClientCardGrant[];
  readonly words: ClientCardWords;
}

/**
 * BD — the birthday as a card of its own (R2-D), in one of two kinds:
 *
 * - `today`: the band, and under it the gift — the owner's grant whose
 *   coupon says `birthday`, ready or already on this visit's bill (stamped,
 *   «Премахни» where «Използвай» stood). With no such grant the band
 *   stands alone: a statement, not a control.
 * - `upcoming`: the birthday falls within the week to come — one quiet
 *   line with its weekday and date, never a countdown and never a gift.
 *
 * `null` on every other day, for a guest and for a profile without a date
 * of birth. A birthday is never promised by a skeleton: the store mounts
 * this once the profile has answered.
 */
export function birthdayVm(input: BirthdayInput): BirthdayVm | null {
  const { today, words } = input;
  const birth = input.user?.birthDate ?? null;
  if (birth === null) return null;
  // Which birthday, if any, is `AgeSystem.birthdayMoment`'s: today's, or
  // one within the week to come.
  const moment = AgeSystem.birthdayMoment(birth, today);
  if (moment === null) return null;

  if (moment.birthdayMoment === BirthdayMoment.Today) {
    // The age reached today; `null` where the record holds no year a
    // person can have been born in — the band then says the day without a
    // figure. The gift is the grant whose coupon was made for the birthday
    // (`CouponGrantSystem.forOccasion`; a name is never parsed, §4.6).
    const age = moment.age;
    const gift = glanceReward(
      CouponGrantSystem.forOccasion(input.grants, CouponOccasion.Birthday),
      today,
      words,
      CouponGrantSystem.forOccasion(
        input.grantsOnBill,
        CouponOccasion.Birthday,
      ),
    );
    // The figure is what the gift is worth; a gift whose name says it all
    // («Безплатно подстригване») is said by its name.
    const worth = gift === null ? null : (gift.value ?? gift.title);
    return {
      birthdayMoment: BirthdayMoment.Today,
      title: age === null ? words.birthday.today : words.birthday.todayAge(age),
      gift,
      giftLabel: words.birthday.gift,
      accessibleName:
        gift === null || worth === null
          ? words.birthday.name(age)
          : gift.applied
            ? words.birthday.giftAppliedName(age, worth)
            : words.birthday.giftName(age, worth),
    };
  }

  // A birthday of the week to come: the day it is kept on, and the age it brings.
  const title = words.birthday.upcoming(
    weekdayLong(moment.localDate, words.lang),
    dayShort(moment.localDate, today, words.lang),
    moment.turning,
  );
  return {
    birthdayMoment: BirthdayMoment.Upcoming,
    title,
    gift: null,
    giftLabel: words.birthday.gift,
    accessibleName: title,
  };
}

/**
 * E's grants beside the birthday card: every grant but the ones the card
 * carries TODAY, so the reward ticket never repeats the gift. On any other
 * day, and while the band stands alone, nothing is taken out — a birthday
 * grant still held is then an ordinary ticket (§2.1.2 c). The store passes
 * the ready grants and the bill's through it, each in turn.
 */
export function grantsBesideBirthday(
  grants: readonly ClientCardGrant[],
  birthday: BirthdayVm | null,
): readonly ClientCardGrant[] {
  return CouponGrantSystem.besideOccasionGift(
    grants,
    CouponOccasion.Birthday,
    birthday?.birthdayMoment === BirthdayMoment.Today && birthday.gift !== null,
  );
}

// ── H · «Посещения» ─────────────────────────────────────────────────────

/**
 * H — up to three cards of ONE shape and one order (`lib-visit-card`): the
 * newest worked visit that is not the one on screen, with its thumbs and
 * the client's own words; the soonest visit to come; and the newest
 * waiting request, when the first spec's rule lets it through — watching,
 * not lapsed, the client not paused, and no upcoming visit booked at or
 * after it.
 */
export function visitCardsVm(input: VisitsModuleInput): VisitCardsVm {
  const { context, words, now } = input;
  const today = now.localDate;
  // The rows tell which visit was worked and which is still to come, as
  // the history tells it; the cards are built from the visits they pick.
  const rowOf = (appointment: Appointment) =>
    visitRowOf(
      appointment,
      {
        perspective: VisitPerspective.Staff,
        grain: VisitGrain.Month,
        subjectUserId: input.subjectUserId,
        subjectCustomerId: input.subjectCustomerId,
        currentAppointmentId: context.appointmentId,
        now,
        timeZone: input.zone,
        locale: words.lang,
        words: words.visits,
        clientWords: input.clientWords,
      },
      context.catalog,
    );
  const cardOf = (
    appointment: Appointment,
    visitCardSlot: typeof VisitCardSlot.Last | typeof VisitCardSlot.Next,
    testId: string,
  ) =>
    visitCardOf(
      appointment,
      {
        visitCardSlot,
        perspective: VisitPerspective.Staff,
        subjectUserId: input.subjectUserId,
        subjectCustomerId: input.subjectCustomerId,
        now,
        timeZone: input.zone,
        locale: words.lang,
        words: words.visits,
        cardWords: words.visitCard,
        clientWords: input.clientWords,
        // The last visit's own cuts, newest first; the card draws three.
        photos:
          visitCardSlot === VisitCardSlot.Last
            ? input.photos.filter(
                (photo) => photo.appointmentId === appointment.id,
              )
            : [],
        testId,
      },
      context.catalog,
    );

  const featured = lastWorkedVisit(
    input.appointments,
    rowOf,
    context.appointmentId,
  );

  // The visits to come but the one on screen (UI read-state), soonest
  // first on the shop's wall clock (`VisitListSystem.upcomingSoonestFirst`).
  const upcoming = VisitListSystem.upcomingSoonestFirst(
    input.appointments.filter(
      (appointment) => appointment.id !== context.appointmentId,
    ),
    rowOf,
  );
  const soonest = upcoming[0];

  let waitlist: VisitCardsVm['waitlist'] = null;
  if (input.waitlist !== null) {
    // Which request, and how many others, is `WaitlistSystem.glancePick`'s.
    const pick = WaitlistSystem.glancePick(
      input.waitlist,
      upcoming,
      today,
      input.paused,
    );
    if (pick.newest !== null) {
      waitlist = waitlistCardOf(
        pick.newest,
        {
          words: words.waitlist,
          today,
          locale: words.lang,
          otherRequests: pick.others,
          testId: 'client-visit-waitlist',
        },
        context.catalog,
      );
    }
  }

  return {
    last:
      featured === null
        ? null
        : cardOf(featured.appointment, VisitCardSlot.Last, 'client-visit-last'),
    next:
      soonest === undefined
        ? null
        : cardOf(soonest, VisitCardSlot.Next, 'client-visit-next'),
    waitlist,
    count: input.count,
  };
}

// ── F · «Лоялност» ──────────────────────────────────────────────────────

export interface LoyaltyGlanceInput extends LoyaltyTilesInput {
  /**
   * The vouchers issued to the person, any state (`CLIENT_VOUCHERS_READER`);
   * `null` = not read (no reader bound, or the read failed): no voucher fact.
   */
  readonly vouchers: readonly GiftVoucher[] | null;
  /**
   * The rhythm the account is judged by (its head); its rule in force today
   * is `StreakRuleSystem.inForceOn`'s. The rhythm is a fact of the card
   * only under a rule that is known and ON: `null`, or a rule switched off,
   * prints none.
   */
  readonly rhythm: StreakDefinition | null;
}

/** One holding, and how a reader hears it after its label («9 посещения»). */
interface Holding extends HoldingFactVm {
  readonly spoken: string;
}

/**
 * The vouchers' fact: what is left on every voucher the person can still
 * pay with — active, not empty, and not past its last day on the shop's
 * calendar — as ONE sum (`ClientGlanceSystem.holdings`). `null` when
 * nothing is left.
 */
function voucherHolding(
  held: GlanceHoldings,
  words: ClientCardWords,
): Holding | null {
  if (held.voucherCents === null || held.voucherCurrency === null) return null;
  const value = formatCents(
    held.voucherCents,
    held.voucherCurrency,
    words.lang,
  );
  return {
    id: LoyaltyHoldingWord.Voucher,
    label: words.loyalty.holding(LoyaltyHoldingWord.Voucher),
    value,
    spoken: value,
  };
}

/**
 * The holdings line, in its order: the vouchers' balance, the first stamp
 * card, the rhythm. A fact follows its flag and its data, and a fact whose
 * data is absent is absent: no voucher left, no stamp card, no run under
 * way (a count of nought is nothing held), a rule that is off, a paused
 * client (the rhythm is frozen: the wallet says so, the glance says
 * nothing). Which facts, and their figures, are `ClientGlanceSystem.holdings`.
 */
function holdingsOf(input: LoyaltyGlanceInput): readonly Holding[] {
  const { account, flags, words } = input;
  const state = rhythmStateOf(account, input.rhythm);
  // The rhythm counts under `loyalty.streaks` and its rule in force, on
  // (`StreakRuleSystem.isOnOn`); a rhythm is read on a shop day, ever.
  const rhythmOn =
    input.rhythm !== null &&
    StreakRuleSystem.isOnOn(input.rhythm, input.today, flags.streaks);
  const held = ClientGlanceSystem.holdings({
    vouchers: input.vouchers,
    punchCards: account.punchCards,
    achievements: flags.achievements,
    rhythmOn,
    rhythm: state,
    paused: input.paused,
    today: input.today,
  });
  const holdings: Holding[] = [];

  const voucher = voucherHolding(held, words);
  if (voucher !== null) holdings.push(voucher);

  if (held.stamps !== null) {
    const value = words.loyalty.stampsOf(held.stamps.filled, held.stamps.size);
    holdings.push({
      id: LoyaltyHoldingWord.Stamps,
      label: words.loyalty.holding(LoyaltyHoldingWord.Stamps),
      value,
      spoken: value,
    });
  }

  if (held.rhythm !== null) {
    const value = figure(held.rhythm, words.lang);
    holdings.push({
      id: LoyaltyHoldingWord.Rhythm,
      label: words.loyalty.holding(LoyaltyHoldingWord.Rhythm),
      value,
      spoken: `${value} ${words.loyalty.rhythmUnit(held.rhythm)}`,
    });
  }
  return holdings;
}

/**
 * The holdings as a reader hears them: «Ваучер 25,00 €, печати 3 от 10,
 * ритъм 9 посещения». The first label opens a sentence of its own after
 * the points; without them the list runs on from «Лоялност: » and every
 * label is in the running case.
 */
function holdingsSpoken(
  holdings: readonly Holding[],
  running: boolean,
  lang: string,
): string | null {
  if (holdings.length === 0) return null;
  return holdings
    .map(({ label, spoken }, index) => {
      const word = index > 0 || running ? runningCase(label, lang) : label;
      return `${word} ${spoken}`;
    })
    .join(', ');
}

/**
 * What the points buy, beyond the rewards already in hand (DV5's held
 * rule): the costliest reward the balance reaches, else how far the
 * cheapest one out of reach is. A reward held on this visit — offered by
 * the ticket or already on the bill — is never the one the points are
 * «enough for», so the sentence does not flip with «Използвай» and
 * «Премахни». `null` when the catalogue offers nothing else.
 */
function pointsSentence(
  input: LoyaltyGlanceInput,
  catalog: ValidLoyaltyCatalog,
): string | null {
  const { account, today, words } = input;
  const locale = cardLocaleOf(words.lang);
  // Which rewards the sentence may name, what the balance reaches and how
  // far it falls short are `RewardSystem.pointsReachBeyondHeld`'s.
  const reach = RewardSystem.pointsReachBeyondHeld(
    catalog.rewards,
    input.heldRewards ?? [],
    locale,
    account.balance,
    today,
  );
  const reward = reach.reward;
  if (reward === null) return null;
  const name = inSentence(reward.name[locale], words.lang);
  switch (reach.pointsReach) {
    case PointsReach.EnoughFor:
      return words.loyalty.enoughForPoints(name);
    case PointsReach.MoreTo:
      return words.loyalty.moreTo(reach.short, name);
    case PointsReach.None:
      return null;
  }
}

/** «371» · «1 200» · «−40»: the balance as the card's figure; what is owed wears the true minus. */
function balanceFigure(balance: number, lang: string): string {
  return balance < 0
    ? `${MINUS}${figure(Math.abs(balance), lang)}`
    : figure(balance, lang);
}

/**
 * F1 — «Лоялност» as ONE card: the points, what they buy, and a line of
 * what else is held. With `loyalty.points` off the first holding leads as
 * the figure and the line still names it; with nothing to say the module
 * is absent (`null`). A paused client's values are never zeroed.
 */
export function loyaltyGlanceVm(
  input: LoyaltyGlanceInput,
): LoyaltyGlanceVm | null {
  const { account, words } = input;
  const held = holdingsOf(input);
  const holdings = held.map(({ id, label, value }) => ({ id, label, value }));

  if (!input.flags.points) {
    const first = held[0];
    if (first === undefined) return null;
    return {
      figure: first.value,
      unit: null,
      sentence: null,
      holdings,
      accessibleName: words.loyalty.cardName(
        holdingsSpoken(held, true, words.lang) ?? '',
        null,
        null,
      ),
    };
  }

  const sentence =
    input.catalog === null ? null : pointsSentence(input, input.catalog);
  return {
    figure: balanceFigure(account.balance, words.lang),
    unit: words.loyalty.pointsWord(account.balance),
    sentence,
    holdings,
    accessibleName: words.loyalty.cardName(
      words.loyalty.points(account.balance),
      sentence,
      holdingsSpoken(held, false, words.lang),
    ),
  };
}

// ── G · «Постижения» ────────────────────────────────────────────────────

/** One record as a fact of the line; `null` where its subject cannot be named. */
function recordFact(
  record: PersonalRecord,
  ctx: AchievementsContext,
): (RecordFactVm & { readonly spoken: string }) | null {
  const words = ctx.words;
  let value: string | null;
  switch (record.personalRecordKind) {
    case PersonalRecordKind.FavouriteService:
      value =
        record.serviceId === null
          ? null
          : ctx.catalog.serviceName(record.serviceId);
      break;
    case PersonalRecordKind.MostVisitsInYear:
      value = figure(record.value, words.lang);
      break;
    case PersonalRecordKind.FirstVisit:
      value = record.on === null ? null : dayWithYear(record.on, words.lang);
      break;
    case PersonalRecordKind.LongestRhythm:
      // The rhythm's record is the wallet's and the records page's.
      value = null;
      break;
  }
  if (value === null) return null;
  const kind = RECORD_KIND_WORDS[record.personalRecordKind];
  return {
    personalRecordKind: record.personalRecordKind,
    label: words.records.label(kind),
    value,
    spoken: `${words.achievements.record(kind)} ${value}`,
  };
}

/**
 * G — «Постижения» as ONE card: three named medals, one cue, and the
 * records as a quiet line; `null` before the first earned level (G is
 * absent).
 *
 * WHICH medals, and the cue, are the built strip's (`medalStripVm`): the
 * glance leads with the family its cue names — the level this visit
 * completes, else the newest one, then the closest. HOW a medal is drawn is
 * the collection's (`medalRingVm`, the grid's `large` tile): its ring, the
 * fourth state, its rim. The glance takes that medal and blanks its
 * caption: every medal is NAMED here and none is captioned.
 *
 * One callout, the cue's: no medal wears «Ново», and none says it — the
 * cue is a sentence of the card, read with it.
 */
export function medalsGlanceVm(
  data: AchievementsData,
  ctx: AchievementsContext,
): MedalsGlanceVm | null {
  const levelCount = StandingSystem.earnedLevelCount(progressList(data));
  if (levelCount === 0) return null;

  const strip = medalStripVm(data, ctx);
  const tiles = strip.medals.flatMap((slot): AchievementTileVm[] => {
    const series = familyOfMedal(data, slot);
    return series === null
      ? []
      : [
          {
            key: slot.seriesId,
            medal: {
              ...medalRingVm(series, data, ctx, 'large'),
              caption: null,
            },
            opens: null,
          },
        ];
  });

  // Which records the line names, in its order, is
  // `RecordsSystem.glanceLine`'s; a favourite needs a service the
  // catalogue still names (the host's lookup).
  const records = data.account.records;
  const knownServiceIds = new Set<ServiceId>(
    records.flatMap((record) =>
      record.serviceId !== null &&
      ctx.catalog.serviceName(record.serviceId) !== null
        ? [record.serviceId]
        : [],
    ),
  );
  const facts = RecordsSystem.glanceLine(
    records,
    knownServiceIds,
    RECORD_LINE_LIMIT,
  ).flatMap((record) => {
    const fact = recordFact(record, ctx);
    return fact === null ? [] : [fact];
  });

  return {
    levelCount,
    tiles,
    cue: strip.cue,
    records: facts.map(({ personalRecordKind, label, value }) => ({
      personalRecordKind,
      label,
      value,
    })),
    recordsName:
      facts.length === 0
        ? null
        : ctx.words.achievements.recordsLineName(
            facts.map((fact) => fact.spoken).join(', '),
          ),
  };
}
