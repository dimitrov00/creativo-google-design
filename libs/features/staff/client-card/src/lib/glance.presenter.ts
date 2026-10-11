import type { User } from '@creativo/application/accounts';
import {
  type Appointment,
  CalendarDay,
  Money,
  type WaitlistRequest,
  formatMoney,
  statWindows,
} from '@creativo/application/booking';
import {
  type GiftVoucher,
  type LoyaltyAccount,
  type LoyaltyCatalog,
  type PersonalRecord,
  type PersonalRecordKind,
  type StreakDefinition,
  bestAffordable,
  earnedLevelCount,
  nextAffordable,
  tierSteps,
} from '@creativo/application/engagement';
import {
  visitCardOf,
  visitRowOf,
  waitlistCardOf,
} from '@creativo/features/shared/visits';
import {
  AchievementRuleId,
  Currency,
  GiftVoucherId,
  LocalDate,
  PriceCents,
  type TimeZone,
  UserId as UserRefId,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  BirthDate,
  CouponOccasion,
  VoucherCode,
  VoucherLifecycle,
} from '@core/components';
import { type GiftVoucher as EcsGiftVoucher } from '@core/entities';
import {
  AgeSystem,
  ClientGlanceSystem,
  CouponGrantSystem,
  type GlanceHoldings,
  ZonedTimeSystem,
} from '@core/systems';
import type { AchievementsContext } from './achievements.presenter';
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
  isBirthdayToday,
  lastWorkedVisit,
  medalStripVm,
  pauseOf,
} from './client-card.presenter';
import type {
  AchievementTileVm,
  AchievementsData,
  BirthdayVm,
  ClientCapsulesVm,
  ClientHeroVm,
  HeroTierVm,
  HoldingFactVm,
  LinePart,
  LoyaltyGlanceVm,
  MedalsGlanceVm,
  RecordFactVm,
  VisitCardsVm,
} from './client-pages.vm';
import type { ClientCardWords } from './client-card.words';
import { cadenceWeeks } from './history.presenter';
import { glanceReward, offered } from './loyalty.presenter';
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

/** No-shows in the last 90 days that raise the reliability capsule (old spec R47). */
const NO_SHOW_CAPSULE_AT = 2;

/** The shop's zone: a voucher's last day is read on its calendar. */
const SHOP_ZONE: TimeZone = (() => {
  const zone = ZonedTimeSystem.checkZone('Europe/Sofia');
  if (!zone.ok) defect('unreachable: the shop zone is a zone');
  return zone.value;
})();

/** How far ahead a birthday is said: the week to come, never further. */
const BIRTHDAY_NOTICE_DAYS = 7;

/** The records the medals card's line may name, in its order; two at most print. */
const RECORD_LINE_ORDER: readonly PersonalRecordKind[] = [
  'favouriteService',
  'mostVisitsInYear',
  'firstVisit',
];
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
function weekdayLong(day: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
}

// ── A · the hero ────────────────────────────────────────────────────────

export interface HeroInput extends HeadInput {
  /** The account and the catalogue when the tier may show (`loyalty.tiers`), else `null`. */
  readonly tier: {
    readonly account: LoyaltyAccount;
    readonly catalog: LoyaltyCatalog;
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
  if (!input.settled) return null;
  if (pause !== null) {
    if (pause.until === null) return plainLine(words.head.pausedPermanent);
    const until = dayShort(pause.until, shopDayOf(input.nowMs), words.lang);
    return lineParts(words.head.pausedUntil(until), [until]);
  }
  if (!input.statsKnown) return null;
  const stats = input.stats;
  if (
    stats === null ||
    stats.lifetime.visitsCompleted === 0 ||
    stats.firstVisitAtMs === null
  ) {
    return plainLine(words.head.firstVisit);
  }
  const since = monthYearLong(shopDayOf(stats.firstVisitAtMs), words.lang);
  // A cadence needs three worked visits (R34): until then the tenure alone.
  if (stats.avgCadenceDays === null) {
    return lineParts(words.head.since(since), [since]);
  }
  const cadence = words.head.cadence(cadenceWeeks(stats.avgCadenceDays));
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
  const track = tierSteps(tier.account.tier, tier.catalog.tiers);
  const current = track.steps.find(
    (step) => step.tierId === track.currentTierId,
  );
  if (current === undefined) return null;
  const name = current.name.get(locale);
  if (current === track.steps.at(-1)) {
    return {
      name,
      progress: 1,
      accessibleName: words.head.tierTopName(name),
    };
  }
  const next = track.steps.find((step) => step.tierId === track.nextTierId);
  if (next === undefined || next.atLeast <= current.atLeast) {
    return { name, progress: null, accessibleName: name };
  }
  const span = next.atLeast - current.atLeast;
  const remaining = Math.max(0, track.remaining ?? next.atLeast - track.value);
  return {
    name,
    progress: Math.min(1, Math.max(0, (track.value - current.atLeast) / span)),
    accessibleName: words.head.tierName(
      name,
      words.visitsModule.sectionVisits(remaining),
      next.name.get(locale),
    ),
  };
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
  const pause = pauseOf(user, input.nowMs);
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
    const noShows = statWindows(input.stats, input.nowMs).noShows.last90d;
    if (noShows >= NO_SHOW_CAPSULE_AT) {
      capsules.push({
        id: 'noShows',
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
  /** The shop calendar's today (`YYYY-MM-DD`, Europe/Sofia). */
  readonly today: string;
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

/** The grant's coupon was made for the birthday; a name is never parsed (§4.6). */
function isBirthdayGrant(grant: ClientCardGrant): boolean {
  const occasion = grant.occasion ?? null;
  return CouponGrantSystem.isOccasion(
    occasion === null ? null : COUPON_OCCASION_OF[occasion],
    CouponOccasion.Birthday,
  );
}

/**
 * The age reached on a birthday (`AgeSystem.ageReachedOn`): that day's year
 * less the year of birth. `null` where the record holds no year a person
 * can have been born in — the band then says the day without a figure.
 */
function ageOn(day: string, birth: string): number | null {
  const shopDay = LocalDate.parse(day);
  return shopDay.ok
    ? AgeSystem.ageReachedOn(BirthDate.of(birth), shopDay.value)
    : null;
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
  const birth = input.user?.birthDate?.toISODate();
  if (birth === undefined) return null;

  if (isBirthdayToday(input.user, today)) {
    const age = ageOn(today, birth);
    const gift = glanceReward(
      input.grants.filter(isBirthdayGrant),
      today,
      words,
      input.grantsOnBill.filter(isBirthdayGrant),
    );
    // The figure is what the gift is worth; a gift whose name says it all
    // («Безплатно подстригване») is said by its name.
    const worth = gift === null ? null : (gift.value ?? gift.title);
    return {
      kind: 'today',
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

  // The next birthday on or after today (`AgeSystem.nextBirthday`; today's
  // own is the band above, so the card's window starts at tomorrow).
  const shopToday = LocalDate.parse(today);
  if (!shopToday.ok) return null;
  const next = AgeSystem.nextBirthday(BirthDate.of(birth), shopToday.value);
  if (next.inDays < 1 || next.inDays > BIRTHDAY_NOTICE_DAYS) return null;
  const title = words.birthday.upcoming(
    weekdayLong(next.localDate, words.lang),
    dayShort(next.localDate, today, words.lang),
    next.turning,
  );
  return {
    kind: 'upcoming',
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
  return birthday?.kind === 'today' && birthday.gift !== null
    ? grants.filter((grant) => !isBirthdayGrant(grant))
    : grants;
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
  const { context, words } = input;
  const today = shopDayOf(input.nowMs);
  // The rows tell which visit was worked and which is still to come, as
  // the history tells it; the cards are built from the visits they pick.
  const rowOf = (appointment: Appointment) =>
    visitRowOf(
      appointment,
      {
        perspective: 'staff',
        grain: 'month',
        subjectUserId: input.subjectUserId,
        currentAppointmentId: context.appointmentId,
        nowMs: input.nowMs,
        locale: words.lang,
        words: words.visits,
        clientWords: input.clientWords,
      },
      context.catalog,
    );
  const cardOf = (
    appointment: Appointment,
    kind: 'last' | 'next',
    testId: string,
  ) =>
    visitCardOf(
      appointment,
      {
        kind,
        perspective: 'staff',
        subjectUserId: input.subjectUserId,
        nowMs: input.nowMs,
        locale: words.lang,
        words: words.visits,
        cardWords: words.visitCard,
        clientWords: input.clientWords,
        // The last visit's own cuts, newest first; the card draws three.
        photos:
          kind === 'last'
            ? input.photos
                .filter((photo) => photo.appointmentId === appointment.id.value)
                .map((photo) => ({
                  id: photo.photoId,
                  url: photo.url,
                  takenAtIso: photo.takenAtIso,
                }))
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

  const upcoming = input.appointments
    .filter((appointment) => appointment.id.value !== context.appointmentId)
    .map((appointment) => ({ appointment, row: rowOf(appointment) }))
    .filter(({ row }) => row.upcoming)
    .sort((a, b) => a.row.startMs - b.row.startMs);
  const soonest = upcoming[0];

  let waitlist: VisitCardsVm['waitlist'] = null;
  if (!input.paused && input.waitlist !== null) {
    const day = CalendarDay.create(today, 'Europe/Sofia');
    const bookedAfter = (request: WaitlistRequest) =>
      upcoming.some(
        ({ appointment }) =>
          appointment.bookedAt !== null &&
          appointment.bookedAt.toMillis() >= request.createdAt.toMillis(),
      );
    const watching = input.waitlist
      .filter(
        (request) =>
          request.isWatching() &&
          (day.isFailure() || !request.hasLapsedBy(day.value)) &&
          !bookedAfter(request),
      )
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    const newest = watching[0];
    if (newest !== undefined) {
      waitlist = waitlistCardOf(
        newest,
        {
          words: words.waitlist,
          today,
          locale: words.lang,
          otherRequests: watching.length - 1,
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
        : cardOf(featured.appointment, 'last', 'client-visit-last'),
    next:
      soonest === undefined
        ? null
        : cardOf(soonest.appointment, 'next', 'client-visit-next'),
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
   * The rhythm's rule in force today (`LoyaltyCatalog.streakInForce`). The
   * rhythm is a fact of the card only under a rule that is known and ON:
   * `null`, or a rule switched off, prints none.
   */
  readonly ruleInForce: StreakDefinition | null;
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
  const sum = Money.fromMinorUnitsAndCode(
    held.voucherCents,
    held.voucherCurrency,
  );
  if (sum.isFailure()) return null;
  const value = formatMoney(sum.value, words.lang);
  return {
    id: 'voucher',
    label: words.loyalty.holding('voucher'),
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
  const rule = input.ruleInForce;
  const state =
    rule === null
      ? undefined
      : new Map(Object.entries(account.streaks)).get(rule.id);
  const today = LocalDate.parse(input.today);
  const held = ClientGlanceSystem.holdings({
    // A today that is no shop day reads no voucher's last day: no voucher fact.
    vouchers:
      input.vouchers === null || !today.ok ? null : vouchersOf(input.vouchers),
    punchCards: account.punchCards.map((card) => ({
      ruleId: AchievementRuleId.of(card.ruleId),
      filled: card.filled,
      size: card.size,
      title: card.title,
    })),
    achievements: flags.achievements,
    rhythmOn: flags.streaks && rule !== null && rule.enabled,
    rhythm: state === undefined ? null : { current: state.current },
    paused: input.paused,
    today: today.ok ? today.value : LocalDate.fromEpochDay(0),
  });
  const holdings: Holding[] = [];

  const voucher = voucherHolding(held, words);
  if (voucher !== null) holdings.push(voucher);

  if (held.stamps !== null) {
    const value = words.loyalty.stampsOf(held.stamps.filled, held.stamps.size);
    holdings.push({
      id: 'stamps',
      label: words.loyalty.holding('stamps'),
      value,
      spoken: value,
    });
  }

  if (held.rhythm !== null) {
    const value = figure(held.rhythm, words.lang);
    holdings.push({
      id: 'rhythm',
      label: words.loyalty.holding('rhythm'),
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
  catalog: LoyaltyCatalog,
): string | null {
  const { account, today, words } = input;
  const locale = cardLocaleOf(words.lang);
  const inHand = new Set(input.heldRewards ?? []);
  const beyond = offered(catalog, today).filter(
    (reward) => !inHand.has(reward.name.get(locale)),
  );
  const best = bestAffordable(beyond, account.balance, today);
  if (best !== null) {
    return words.loyalty.enoughForPoints(
      inSentence(best.name.get(locale), words.lang),
    );
  }
  const next = nextAffordable(beyond, account.balance, today);
  return next === null
    ? null
    : words.loyalty.moreTo(
        next.cost - account.balance,
        inSentence(next.name.get(locale), words.lang),
      );
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
  switch (record.kind) {
    case 'favouriteService':
      value =
        record.serviceId === null
          ? null
          : ctx.catalog.serviceName(record.serviceId);
      break;
    case 'mostVisitsInYear':
      value = figure(record.value, words.lang);
      break;
    case 'firstVisit':
      value = record.on === null ? null : dayWithYear(record.on, words.lang);
      break;
    case 'longestRhythm':
      // The rhythm's record is the wallet's and the records page's.
      value = null;
      break;
  }
  if (value === null) return null;
  return {
    kind: record.kind,
    label: words.records.label(record.kind),
    value,
    spoken: `${words.achievements.record(record.kind)} ${value}`,
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
  const levelCount = earnedLevelCount(data.progress);
  if (levelCount === 0) return null;

  const strip = medalStripVm(data, ctx);
  const tiles = strip.medals.flatMap((slot): AchievementTileVm[] => {
    const series = data.catalog.series(slot.seriesId);
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

  const facts = RECORD_LINE_ORDER.flatMap((kind) => {
    const record = data.account.records.find((held) => held.kind === kind);
    const fact = record === undefined ? null : recordFact(record, ctx);
    return fact === null ? [] : [fact];
  }).slice(0, RECORD_LINE_LIMIT);

  return {
    levelCount,
    tiles,
    cue: strip.cue,
    records: facts.map(({ kind, label, value }) => ({ kind, label, value })),
    recordsName:
      facts.length === 0
        ? null
        : ctx.words.achievements.recordsLineName(
            facts.map((fact) => fact.spoken).join(', '),
          ),
  };
}

// ── The bridge: legacy shapes → ecs-core structs (Phase 4 deletes it) ────

/** The legacy coupon occasions ↔ `CouponOccasion` — the ONE table. */
const COUPON_OCCASION_OF = {
  birthday: CouponOccasion.Birthday,
} as const satisfies Record<
  NonNullable<ClientCardGrant['occasion']>,
  CouponOccasion
>;

/** The vouchers `ClientGlanceSystem.holdings` can read; one it cannot hold in the flat shape is none it can spend. */
function vouchersOf(vouchers: readonly GiftVoucher[]): EcsGiftVoucher[] {
  const out: EcsGiftVoucher[] = [];
  for (const voucher of vouchers) {
    const struct = voucherOf(voucher);
    if (struct !== null) out.push(struct);
  }
  return out;
}

/**
 * A voucher as `ClientGlanceSystem.holdings` (and `VoucherSystem.spendable`)
 * reads it: cents and one currency, its instants as `UtcEpochMs`, and its
 * last day on the shop's calendar (`expiresLocalDate`, T5).
 */
function voucherOf(voucher: GiftVoucher): EcsGiftVoucher | null {
  const { state } = voucher;
  const initial = PriceCents.of(voucher.initialValue.toMinorUnits());
  const balance = PriceCents.of(voucher.balance.toMinorUnits());
  const currency = Currency.parse(voucher.balance.currencyCode());
  const issuedAt = UtcEpochMs.of(voucher.issuedAt.toMillis());
  const expiresAt =
    voucher.expiresAt === null
      ? null
      : UtcEpochMs.of(voucher.expiresAt.toMillis());
  const voidedAt =
    state.kind === 'void' ? UtcEpochMs.of(state.voidedAt.toMillis()) : null;
  if (
    !initial.ok ||
    !balance.ok ||
    !currency.ok ||
    !issuedAt.ok ||
    (expiresAt !== null && !expiresAt.ok) ||
    (voidedAt !== null && !voidedAt.ok)
  ) {
    return null;
  }
  const expiresAtUtcMs = expiresAt === null ? null : expiresAt.value;
  return {
    id: GiftVoucherId.of(voucher.id.value),
    code: VoucherCode.of(voucher.code),
    initialValueCents: initial.value,
    balanceCents: balance.value,
    currency: currency.value,
    issuedAtUtcMs: issuedAt.value,
    expiresAtUtcMs,
    expiresLocalDate:
      expiresAtUtcMs === null
        ? null
        : ZonedTimeSystem.toLocal(expiresAtUtcMs, SHOP_ZONE).localDate,
    issuedToUserId:
      voucher.issuedToUserId === null
        ? null
        : UserRefId.of(voucher.issuedToUserId.value),
    ...(state.kind === 'void' && voidedAt !== null && voidedAt.ok
      ? VoucherLifecycle.voided(voidedAt.value, state.reason)
      : VoucherLifecycle.active()),
  };
}
