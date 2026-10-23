import {
  AppointmentId,
  type BadgeSeriesId,
  LocalDate,
  ServiceId,
  ServiceVariantId,
  type TimeZone,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  DialSource,
  MedalCue,
  type ShopNow,
  TenureState,
  type VisitLeg,
  type WallTime,
} from '@core/components';
import {
  AgeSystem,
  BadgeSystem,
  ClientGlanceSystem,
  ClientStatsSystem,
  type GlanceLeg,
  LoyaltyCatalogSystem,
  PhoneSystem,
  StandingSystem,
  type ValidLoyaltyCatalog,
  VisitStorySystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  type Appointment,
  type AppointmentPhoto,
  type BadgeSeries,
  type ClientStatsRecord,
  type LoyaltyAccount,
  Profile,
  type User,
  type WaitlistRequest,
} from '@core/entities';
import { type VisitRowVm } from '@creativo/features/shared/visits';
import {
  type AchievementsContext,
  completesWithThisVisit,
  medalVm,
  newestFaceLevel,
  previousVisitOf,
  progressOf,
  seriesById,
  soonSeriesIds,
} from './achievements.presenter';
import type {
  ClientCardContext,
  ClientCardSubject,
} from './client-card.contracts';
import {
  cardLocaleOf,
  dayLong,
  dayShort,
  levelNumeral,
  monthYearLong,
  shopDayOf,
} from './client-card.format';
import { type LoyaltyFlags } from './loyalty.presenter';
import type {
  AchievementsData,
  ClientCapsuleVm,
  ClientCapsulesVm,
  ClientHeadVm,
  ClientPhotoVm,
  MedalStripVm,
  QuickActionVm,
} from './client-pages.vm';
import type { ClientCardWords } from './client-card.words';

/*
 * THE GLANCE'S SHARED HELPERS (client-card-redesign §3.1; revision 3 §2.1
 * reads them through `glance.presenter.ts`), as pure functions — the
 * head's words (`clientHeadVm`, kept for the visit editor's photo page),
 * the capsules' run, the quick actions, the photo rail, and the medal
 * picks the glance's medals card draws (`medalStripVm`). The built glance
 * page's own modules went with its body in W4. The store decides what has
 * loaded; these decide what it says. Nothing here reads a clock, a flag or
 * a port.
 */

/** How many capsules show before «+N» stands for the rest. */
const CAPSULE_LIMIT = 4;

/** The past cuts the rail shows. */
const PHOTO_RAIL_LIMIT = 6;

/** The medals the glance's strip draws. */
const STRIP_LIMIT = 3;

// ── The person ──────────────────────────────────────────────────────────

/**
 * Online booking paused AS OF now — a temporary pause that has run out is
 * no pause (`AccountLifecycle.isBlockedAt`, read off the user's own
 * lifecycle slice). `until` is the shop day it ends on `zone` (the shop's,
 * Law 7.2), `null` for a permanent pause.
 */
export function pauseOf(
  user: User | null,
  nowMs: number,
  zone: TimeZone,
): { readonly until: string | null } | null {
  const now = UtcEpochMs.of(nowMs);
  // No instant to judge by: nothing can be shown paused at it.
  if (!now.ok) return null;
  const pause = ClientGlanceSystem.pauseOf(user, now.value);
  if (pause === null) return null;
  return {
    until: pause.untilUtcMs === null ? null : shopDayOf(pause.untilUtcMs, zone),
  };
}

/** Today is the person's birthday (a 29 February one is kept on the 28th in other years). */
export function isBirthdayToday(user: User | null, today: string): boolean {
  const birth = user?.birthDate ?? null;
  if (birth === null) return false;
  const day = LocalDate.parse(today);
  return day.ok && AgeSystem.isBirthdayOn(birth, day.value);
}

/** The name the card shows: `users/{uid}`'s once read, the seat's until then (and for good, for a guest). */
export function displayNameOf(
  subject: ClientCardSubject,
  user: User | null,
): string {
  const name = user === null ? '' : Profile.fullName(user);
  return name.length > 0 ? name : subject.label;
}

export interface HeadInput {
  readonly subject: ClientCardSubject;
  readonly user: User | null;
  /** `users/{uid}` and `clientStats/{customerId}` have both answered: the D-9 gate. */
  readonly settled: boolean;
  readonly stats: ClientStatsRecord | null;
  /** The stats were read (a bound reader answered); without them the line claims no tenure. */
  readonly statsKnown: boolean;
  /** `AVATAR_PORTS.findAvatar(uid)`, after the seat's own picture. */
  readonly avatarSrc: string | null;
  readonly nowMs: number;
  /**
   * The shop's zone (Law 7.2) — `null` until the store has resolved it: the
   * head is the snapshot until then, without a pause or its line.
   */
  readonly zone: TimeZone | null;
  /** `null` while the catalogue is loading: the head is the snapshot, without its line. */
  readonly words: ClientCardWords | null;
}

/**
 * A — the head. It renders from the seat's snapshot at once — before the
 * card's words have loaded, too; the state line waits for the profile and
 * the stats (a pause never pushes painted content), then is the ONE place
 * for tenure, a first visit, a guest or a pause. The cadence is not here:
 * its one place is the history's band (§3.6 HC, one fact, once), so the
 * line is the one short fact the head has room for on every phone.
 */
export function clientHeadVm(input: HeadInput): ClientHeadVm {
  const { subject, user, stats, words } = input;
  const name = displayNameOf(subject, user);
  const zone = input.zone;
  const pause = zone === null ? null : pauseOf(user, input.nowMs, zone);
  let stateLine: string | null = null;
  if (words === null) {
    stateLine = null;
  } else if (subject.userId === null) {
    stateLine = words.head.guest;
  } else if (input.settled && zone !== null) {
    if (pause !== null) {
      stateLine =
        pause.until === null
          ? words.head.pausedPermanent
          : words.head.pausedUntil(
              dayShort(pause.until, shopDayOf(input.nowMs, zone), words.lang),
            );
    } else if (!input.statsKnown) {
      stateLine = null;
    } else {
      // How long the client has come is `ClientStatsSystem.tenureOf`'s; the
      // head words SINCE and SINCE_CADENCE alike — the cadence is the
      // history's to say.
      const tenure = ClientStatsSystem.tenureOf(stats);
      stateLine =
        tenure.tenureState === TenureState.FirstVisit || tenure.since === null
          ? words.head.firstVisit
          : words.head.since(monthYearLong(tenure.since, words.lang));
    }
  }
  return {
    name,
    stateLine,
    avatarSrc: subject.avatarSrc ?? input.avatarSrc,
    initialsFrom: name,
    paused: pause !== null,
  };
}

export interface CapsulesInput {
  readonly user: User | null;
  readonly stats: ClientStatsRecord | null;
  /** The account and the catalogue when the tier capsule may show (`loyalty.tiers`), else `null`. */
  readonly tier: {
    readonly account: LoyaltyAccount;
    readonly catalog: ValidLoyaltyCatalog;
  } | null;
  readonly nowMs: number;
  /** The shop's zone (Law 7.2): where «днес» and the windows are read. */
  readonly zone: TimeZone;
  readonly words: ClientCardWords;
}

/**
 * The row's cap: up to four capsules show; past that, three show and «+N»
 * stands for the rest (read in a visually hidden item). The three computed
 * qualifiers always fit; the cap is the row's rule for when staff tags
 * (P1) join them.
 */
export function capsulesRun(
  capsules: readonly ClientCapsuleVm[],
  words: ClientCardWords,
): ClientCapsulesVm {
  if (capsules.length <= CAPSULE_LIMIT) return { shown: capsules, more: null };
  const hidden = capsules.slice(CAPSULE_LIMIT - 1);
  return {
    shown: capsules.slice(0, CAPSULE_LIMIT - 1),
    more: { text: words.capsules.more(hidden.length), hidden },
  };
}

// ── Contact ─────────────────────────────────────────────────────────────

/**
 * The dialable number: the account's own, else the seat's (never the
 * booker's for a companion) — which one, and whether there is one, is
 * `PhoneSystem.dialable`'s. The seat's `tel:` and everything but digits
 * and «+» are stripped here, at the edge.
 */
export function phoneOf(
  subject: ClientCardSubject,
  user: User | null,
): { readonly e164: string; readonly display: string } | null {
  const seatDigits = (subject.phoneHref ?? subject.phone ?? '')
    .replace(/^tel:/i, '')
    .replace(/[^\d+]/g, '');
  // A registered account always holds a phone; a stub never reaches here.
  const number = PhoneSystem.dialable(user?.phone ?? null, seatDigits);
  if (number === null) return null;
  return number.dialSource === DialSource.Account
    ? {
        e164: number.e164,
        display: PhoneSystem.formatInternational(number.e164),
      }
    : { e164: number.digits, display: subject.phone ?? number.digits };
}

/** The visit on screen's services as the glance's legs, branded at the edge. */
function draftLegsOf(draft: ClientCardContext['legs']): readonly GlanceLeg[] {
  return draft.map((leg) => ({
    serviceId: ServiceId.of(leg.serviceId),
    variantId:
      leg.variantId === null ? null : ServiceVariantId.of(leg.variantId),
  }));
}

export function sameLegs(
  last: readonly VisitLeg[],
  draft: ClientCardContext['legs'],
): boolean {
  return ClientGlanceSystem.sameLegs(last, draftLegsOf(draft));
}

export interface ActionsInput {
  readonly subject: ClientCardSubject;
  readonly user: User | null;
  readonly name: string;
  readonly stats: ClientStatsRecord | null;
  readonly context: ClientCardContext;
  readonly online: boolean;
  readonly nowMs: number;
  /** The shop's zone (Law 7.2): where «днес» is read. */
  readonly zone: TimeZone;
  readonly words: ClientCardWords;
}

/**
 * D — call, SMS and Viber from the phone (absent without one), and «Пак
 * същото» from the last visit's legs: absent offline, on a gone visit
 * (cancelled, no-show — a finished one is still correctable), when the
 * visit on screen IS the last one or already holds its services, and when
 * every one of them left the catalogue (old spec D-5).
 */
export function quickActionsVm(input: ActionsInput): readonly QuickActionVm[] {
  const { words, name } = input;
  const actions: QuickActionVm[] = [];
  const phone = phoneOf(input.subject, input.user);
  if (phone !== null) {
    const digits = phone.e164.replace(/^\+/, '');
    actions.push(
      {
        id: 'call',
        icon: 'contact.phone',
        label: words.actions.call,
        href: `tel:${phone.e164}`,
        accessibleName: words.actions.callName(name, phone.display),
      },
      {
        id: 'sms',
        icon: 'contact.sms',
        label: words.actions.sms,
        href: `sms:${phone.e164}`,
        accessibleName: words.actions.smsName(name),
      },
      {
        id: 'viber',
        icon: 'contact.viber',
        label: words.actions.viber,
        href: `viber://chat?number=%2B${digits}`,
        accessibleName: words.actions.viberName(name),
      },
    );
  }
  const stats = input.stats;
  const context = input.context;
  if (stats !== null) {
    const lastLegs = stats.lastVisitLegs;
    // The services of the last visit the catalogue still names (the
    // host's lookup); whether «Пак същото» is offered is
    // `ClientGlanceSystem.repeatOffer`'s.
    const named = lastLegs.flatMap((leg) => {
      const name = context.catalog.serviceName(leg.serviceId);
      return name === null ? [] : [{ serviceId: leg.serviceId, name }];
    });
    const offered = ClientGlanceSystem.repeatOffer(
      stats,
      {
        online: input.online,
        gone: context.gone,
        currentAppointmentId:
          context.appointmentId === null
            ? null
            : AppointmentId.of(context.appointmentId),
        legs: draftLegsOf(context.legs),
      },
      new Set<ServiceId>(named.map((leg) => leg.serviceId)),
    );
    const lastDay = stats.lastVisitLocalDate;
    if (offered && lastDay !== null) {
      const services = [...new Set(named.map((leg) => leg.name))];
      const today = shopDayOf(input.nowMs, input.zone);
      actions.push({
        id: 'same',
        icon: 'visit.repeat',
        label: words.actions.repeat,
        href: null,
        accessibleName: words.actions.againName(
          dayLong(lastDay, today, words.lang),
          services.join(', '),
        ),
        legs: lastLegs,
      });
    }
  }
  return actions;
}

// ── «Посещения» ────────────────────────────────────────────────────────

export interface VisitsModuleInput {
  /** The history's first page, newest first. */
  readonly appointments: readonly Appointment[];
  /** The account the card is open on — whose own words a card quotes. */
  readonly subjectUserId: string;
  /** Its client RECORD (D29) — whose seats and outcome a card tells; `null` before the record exists. */
  readonly subjectCustomerId: string | null;
  readonly context: ClientCardContext;
  /** The client's past cuts, newest first — the featured card's thumbs. */
  readonly photos: readonly AppointmentPhoto[];
  /** The requests the client owns; `null` while the read has not answered or failed (no line). */
  readonly waitlist: readonly WaitlistRequest[] | null;
  readonly paused: boolean;
  readonly count: number;
  readonly clientWords: boolean;
  /** "Now" on the shop's wall clock (Law 7.3), derived ONCE by the store: «днес» and what is still to come. */
  readonly now: ShopNow;
  /** The shop's zone (Law 7.2) — the one `now` was read in. */
  readonly zone: TimeZone;
  readonly words: ClientCardWords;
}

/**
 * The person's newest worked visit that is not the one on screen — the
 * featured card; `null` when the first page holds none.
 */
export function lastWorkedVisit(
  appointments: readonly Appointment[],
  rowOf: (appointment: Appointment) => VisitRowVm,
  currentAppointmentId: string | null,
): { readonly appointment: Appointment; readonly row: VisitRowVm } | null {
  // The visit on screen is UI read-state: dropped here, before the system
  // picks the newest WORKED one (`VisitStorySystem.lastWorked`).
  const rest = appointments.filter(
    (appointment) => appointment.id !== currentAppointmentId,
  );
  const appointment = VisitStorySystem.lastWorked(
    rest,
    (candidate) => rowOf(candidate).outcome,
  );
  return appointment === null ? null : { appointment, row: rowOf(appointment) };
}

// ── The photo rail ─────────────────────────────────────────────────────

/** One past cut: «12.08» on the tile, «Снимка от 12 август» for a reader. */
export function clientPhotoVm(
  photo: AppointmentPhoto,
  nowMs: number,
  zone: TimeZone,
  words: ClientCardWords,
): ClientPhotoVm {
  const today = shopDayOf(nowMs, zone);
  const day = shopDayOf(photo.takenAtUtcMs, zone);
  return {
    photoId: photo.id,
    appointmentId: photo.appointmentId,
    url: photo.url,
    takenAtUtcMs: photo.takenAtUtcMs,
    dateLabel: dayShort(day, today, words.lang),
    accessibleName: words.photos.name(dayLong(day, today, words.lang)),
    barberId: photo.barberId,
    width: photo.width,
    height: photo.height,
  };
}

/**
 * I — the newest past cuts, without the featured visit's (they ride its
 * card) and the visit on screen's (the editor shows those), six at most.
 */
export function photoRailVm(
  photos: readonly AppointmentPhoto[],
  excludedAppointmentIds: readonly (string | null)[],
  nowMs: number,
  zone: TimeZone,
  words: ClientCardWords,
): readonly ClientPhotoVm[] {
  const excluded = new Set(
    excludedAppointmentIds.filter((id): id is string => id !== null),
  );
  return photos
    .filter((photo) => !excluded.has(photo.appointmentId))
    .slice(0, PHOTO_RAIL_LIMIT)
    .map((photo) => clientPhotoVm(photo, nowMs, zone, words));
}

// ── Loyalty and achievements on the glance ──────────────────────────────

export interface LoyaltyTilesInput {
  /** `loyaltyAccounts/{customerId}` as stored. */
  readonly account: LoyaltyAccount;
  /** Needed by the points tile; `null` = not loaded (the tile waits, the store says how). */
  readonly catalog: ValidLoyaltyCatalog | null;
  readonly flags: LoyaltyFlags;
  readonly visitsMs: readonly number[];
  /** `clientStats.lifetime.visitsCompleted`: the rhythm fact says «Винаги» for a run that long. */
  readonly lifetimeVisits?: number | null;
  readonly inChairToday: boolean;
  readonly paused: boolean;
  readonly today: string;
  readonly words: ClientCardWords;
  /**
   * The rewards the client holds on this visit — the titles of the grants
   * E offers and of those already on the draft bill: the points tile never
   * says its points are «enough for» one of them (`loyaltyGlanceVm`). Empty
   * when the owner holds none (or the subject is not the owner).
   */
  readonly heldRewards?: readonly string[];
}

/**
 * Shelves before seasons, then the catalogue's order — which family a cue
 * names first, as a comparator over two families. The order is
 * `LoyaltyCatalogSystem.cueOrdered`'s (a stable sort): `a` before `b` when
 * the system puts it first either way round, a tie (0) when each keeps its
 * place.
 */
export function cueOrder(data: AchievementsData) {
  return (a: BadgeSeries, b: BadgeSeries): number => {
    if (a === b) return 0;
    if (LoyaltyCatalogSystem.cueOrdered(data.catalog, [b, a])[0] === a) {
      return -1;
    }
    return LoyaltyCatalogSystem.cueOrdered(data.catalog, [a, b])[0] === b
      ? 1
      : 0;
  };
}

/**
 * G1 — ONE strip of three: the newest earned level first — the family on
 * «Последни»'s first face (`newestFaceLevel`), so the glance and its own
 * collection draw the newest day as one medal — then the two closest
 * under the diversity rule (the «Скоро» rail's own list), rim numerals
 * only; and one cue, first match wins: this visit completes a
 * level › something new › the closest level.
 *
 * One callout per strip, and it is the cue's (wave D r4): when it is «С
 * това посещение», the family it names leads, drawn with the pending face
 * (`medalVm`); when it is «Ново: …», it names slot 1's family and level.
 * No disc wears a «Ново» chip — beside «Ново: …» it said the one fact
 * twice; slot 1's name still says «ново» for a reader (`markNew`).
 */
export function medalStripVm(
  data: AchievementsData,
  ctx: AchievementsContext,
): MedalStripVm {
  const words = ctx.words;
  const locale = cardLocaleOf(words.lang);
  const options = { titled: false, captioned: false, meter: true } as const;
  // The newest day as «Последни» draws it — the same face, one push away.
  const newest = newestFaceLevel(data, ctx);
  const newestSeries =
    newest === null
      ? null
      : LoyaltyCatalogSystem.series(data.catalog, newest.badgeSeriesId);
  // «Скоро»'s families as the catalogue names them (`StandingSystem.strip`
  // reads them beside the newest one's own slot, and names the closest).
  const soon = soonSeriesIds(data, ctx, STRIP_LIMIT).flatMap((id) => {
    const series = seriesById(data, id);
    return series === null ? [] : [series];
  });
  // The first family this visit completes, in the cue's order.
  const completing =
    LoyaltyCatalogSystem.cueOrdered(
      data.catalog,
      data.catalog.families.filter((series) =>
        completesWithThisVisit(series, data, ctx),
      ),
    )[0] ?? null;
  // Which families fill the slots, which slot says «ново» and which family
  // is the closest are `StandingSystem.strip`'s.
  const strip = StandingSystem.strip({
    completingFirst: completing?.id ?? null,
    newestSeriesId: newestSeries?.id ?? null,
    soonIds: soon.map((series) => series.id),
    limit: STRIP_LIMIT,
  });
  // Each slot's family as the candidates named it, the first naming kept.
  const byId = new Map<BadgeSeriesId, BadgeSeries>();
  for (const series of [completing, newestSeries, ...soon]) {
    if (series !== null && !byId.has(series.id)) byId.set(series.id, series);
  }
  const slots = strip.slots.flatMap((id) => {
    const series = byId.get(id);
    return series === undefined ? [] : [series];
  });

  // The ONE cue, first match wins, and the level it names, are
  // `StandingSystem.stripCue`'s.
  const closest =
    strip.closestId === null ? null : (byId.get(strip.closestId) ?? null);
  const closestStanding =
    closest === null
      ? null
      : BadgeSystem.standing(closest, progressOf(data, closest));
  const stripCue = StandingSystem.stripCue({
    completing:
      completing === null
        ? null
        : {
            series: completing,
            standing: BadgeSystem.standing(
              completing,
              progressOf(data, completing),
            ),
          },
    newest:
      newest === null || newestSeries === null
        ? null
        : { level: newest.level, earnedAtUtcMs: newest.earnedAtUtcMs },
    previousVisitAtUtcMs: previousVisitOf(data),
    closest: closestStanding,
  });

  let cue: string | null = null;
  switch (stripCue.medalCue) {
    case MedalCue.WithThisVisit: {
      const series = completing ?? defect('a WITH_THIS_VISIT cue, no family');
      const title = series.title[locale];
      // A single act has no levels (its tile wears no numeral, no «ниво I»
      // is heard, medals.presenter): «Рожден ден в салона с това
      // посещение», the suffix the pending tile's caption already says
      // (review 3, F9). A levelled family names the level the visit
      // reaches.
      cue =
        stripCue.level === null
          ? `${title} ${words.achievements.withThisVisit}`
          : words.achievements.cueWithThisVisit(
              title,
              levelNumeral(stripCue.level),
            );
      break;
    }
    case MedalCue.New: {
      // The newest level's family, and that level (the face's).
      const series = newestSeries ?? defect('a NEW cue with no family');
      const level = stripCue.level ?? defect('a NEW cue with no level');
      cue = words.achievements.cueNew(
        series.title[locale],
        levelNumeral(level),
      );
      break;
    }
    case MedalCue.Close: {
      // «Скоро»'s first family, how far it has come and the level ahead.
      const series = closest ?? defect('a CLOSE cue with no family');
      const standing = closestStanding ?? defect('a CLOSE cue unplaced');
      const target = standing.target ?? defect('a CLOSE cue with no target');
      const level = stripCue.level ?? defect('a CLOSE cue with no level');
      cue = words.achievements.cueClose(
        series.title[locale],
        standing.value,
        target,
        levelNumeral(level),
      );
      break;
    }
    case null:
      break;
  }
  return {
    // «ново» in slot 1's name only, the newest level's, and only while the
    // cue is not «С това посещение»: the two closest are still to come,
    // never «new» (one place per page, §3.0). The cue says it on screen.
    medals: slots.map((series, index) =>
      medalVm(series, data, ctx, {
        ...options,
        markNew: index === strip.markNewIndex,
      }),
    ),
    cue,
  };
}

/**
 * The client is in the chair today: the visit on screen is open and
 * starts on the shop's today (on `zone`, the shop's) — the rhythm's
 * current mark reads «днес».
 */
export function isInChairToday(
  context: ClientCardContext,
  nowMs: number,
  zone: TimeZone,
): boolean {
  const now = UtcEpochMs.of(nowMs);
  // No "today" without a now to read it from.
  if (!now.ok) return false;
  const legs: WallTime[] = [];
  for (const leg of context.legs) {
    // A leg whose start is no instant starts on no day.
    const start = ZonedTimeSystem.parseIsoIn(leg.startsAtIso, zone);
    if (start.ok) legs.push(ZonedTimeSystem.toLocal(start.value, zone));
  }
  return ClientGlanceSystem.isInChairToday(
    context.appointmentId !== null && !context.settled,
    legs,
    ZonedTimeSystem.shopNow(now.value, zone),
  );
}
