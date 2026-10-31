import {
  type AppointmentId,
  type BadgeSeriesId,
  type CustomerId,
  type LocalDate,
  type ServiceId,
  type TimeZone,
  type UserId,
  type UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  DialSource,
  LocalizedText,
  MedalCue,
  type ShopNow,
  WallTime,
} from '@core/components';
import {
  AgeSystem,
  BadgeSystem,
  ClientGlanceSystem,
  LoyaltyCatalogSystem,
  PhoneSystem,
  StandingSystem,
  type ValidLoyaltyCatalog,
  VisitStorySystem,
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
  progressOf,
  seriesById,
  soonSeriesIds,
} from './achievements.presenter';
import type {
  ClientCardContext,
  ClientCardSubject,
} from './client-card.contracts';
import { levelNumeral, shopDayOf } from './client-card.format';
import { type LoyaltyFlags } from './loyalty.presenter';
import {
  type AchievementsData,
  type ClientCapsuleVm,
  type ClientCapsulesVm,
  type ClientPhotoVm,
  type MedalStripVm,
  QuickActionId,
  type QuickActionVm,
} from './client-pages.vm';
import type { ClientCardWords } from './client-card.words';
import { formatDayLong, formatDayShort } from '@creativo/ui/wall-clock';
import { localeFor } from '@creativo/infrastructure/i18n';

/*
 * THE GLANCE'S SHARED HELPERS (client-card-redesign §3.1; revision 3 §2.1
 * reads them through `glance.presenter.ts`), as pure functions — the
 * head's input (`HeadInput`, which the hero's `HeroInput` extends),
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
  now: UtcEpochMs,
  zone: TimeZone,
): { readonly until: LocalDate | null } | null {
  const pause = ClientGlanceSystem.pauseOf(user, now);
  if (pause === null) return null;
  return {
    until: pause.untilUtcMs === null ? null : shopDayOf(pause.untilUtcMs, zone),
  };
}

/** Today is the person's birthday (a 29 February one is kept on the 28th in other years). */
export function isBirthdayToday(user: User | null, today: LocalDate): boolean {
  const birth = user?.birthDate ?? null;
  return birth !== null && AgeSystem.isBirthdayOn(birth, today);
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
  /** The store's one clock reading of the open: the pause is judged at it. */
  readonly nowUtcMs: UtcEpochMs;
  /**
   * The shop's zone (Law 7.2) — `null` until the store has resolved it: the
   * head is the snapshot until then, without a pause or its line.
   */
  readonly zone: TimeZone | null;
  /** `null` while the catalogue is loading: the head is the snapshot, without its line. */
  readonly words: ClientCardWords | null;
}

export interface CapsulesInput {
  readonly user: User | null;
  readonly stats: ClientStatsRecord | null;
  /** The account and the catalogue when the tier capsule may show (`loyalty.tiers`), else `null`. */
  readonly tier: {
    readonly account: LoyaltyAccount;
    readonly catalog: ValidLoyaltyCatalog;
  } | null;
  /** The store's one clock reading of the open. */
  readonly nowUtcMs: UtcEpochMs;
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

export interface ActionsInput {
  readonly subject: ClientCardSubject;
  readonly user: User | null;
  readonly name: string;
  readonly stats: ClientStatsRecord | null;
  readonly context: ClientCardContext;
  readonly online: boolean;
  /** The store's one clock reading of the open. */
  readonly nowUtcMs: UtcEpochMs;
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
        id: QuickActionId.Call,
        icon: 'contact.phone',
        label: words.actions.call,
        href: `tel:${phone.e164}`,
        accessibleName: words.actions.callName(name, phone.display),
      },
      {
        id: QuickActionId.Sms,
        icon: 'contact.sms',
        label: words.actions.sms,
        href: `sms:${phone.e164}`,
        accessibleName: words.actions.smsName(name),
      },
      {
        id: QuickActionId.Viber,
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
        currentAppointmentId: context.appointmentId,
        legs: context.legs,
      },
      new Set<ServiceId>(named.map((leg) => leg.serviceId)),
    );
    const lastDay = stats.lastVisitLocalDate;
    if (offered && lastDay !== null) {
      const services = [...new Set(named.map((leg) => leg.name))];
      const today = shopDayOf(input.nowUtcMs, input.zone);
      actions.push({
        id: QuickActionId.Same,
        icon: 'visit.repeat',
        label: words.actions.repeat,
        href: null,
        accessibleName: words.actions.againName(
          formatDayLong(lastDay, today, words.lang),
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
  readonly subjectUserId: UserId;
  /** Its client RECORD (D29) — whose seats and outcome a card tells; `null` before the record exists. */
  readonly subjectCustomerId: CustomerId | null;
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
  currentAppointmentId: AppointmentId | null,
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
  nowUtcMs: UtcEpochMs,
  zone: TimeZone,
  words: ClientCardWords,
): ClientPhotoVm {
  const today = shopDayOf(nowUtcMs, zone);
  const day = shopDayOf(photo.takenAtUtcMs, zone);
  return {
    photoId: photo.id,
    appointmentId: photo.appointmentId,
    url: photo.url,
    takenAtUtcMs: photo.takenAtUtcMs,
    dateLabel: formatDayShort(day, today, words.lang),
    accessibleName: words.photos.name(formatDayLong(day, today, words.lang)),
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
  excludedAppointmentIds: readonly (AppointmentId | null)[],
  nowUtcMs: UtcEpochMs,
  zone: TimeZone,
  words: ClientCardWords,
): readonly ClientPhotoVm[] {
  const excluded = new Set(
    excludedAppointmentIds.filter((id): id is AppointmentId => id !== null),
  );
  return photos
    .filter((photo) => !excluded.has(photo.appointmentId))
    .slice(0, PHOTO_RAIL_LIMIT)
    .map((photo) => clientPhotoVm(photo, nowUtcMs, zone, words));
}

// ── Loyalty and achievements on the glance ──────────────────────────────

export interface LoyaltyTilesInput {
  /** `loyaltyAccounts/{customerId}` as stored. */
  readonly account: LoyaltyAccount;
  /** Needed by the points tile; `null` = not loaded (the tile waits, the store says how). */
  readonly catalog: ValidLoyaltyCatalog | null;
  readonly flags: LoyaltyFlags;
  /** The stats' worked visits of the last year, each as its start instant on the shop's zone. */
  readonly visitsMs: readonly UtcEpochMs[];
  /** `clientStats.lifetime.visitsCompleted`: the rhythm fact says «Винаги» for a run that long. */
  readonly lifetimeVisits?: number | null;
  readonly inChairToday: boolean;
  readonly paused: boolean;
  /** The shop calendar's today, on the shop's zone. */
  readonly today: LocalDate;
  readonly words: ClientCardWords;
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
  const locale = localeFor(words.lang);
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
    newest: newest === null || newestSeries === null ? null : newest,
    previousVisitAtUtcMs: data.previousVisitUtcMs,
    closest: closestStanding,
  });

  let cue: string | null = null;
  switch (stripCue.medalCue) {
    case MedalCue.WithThisVisit: {
      const series = completing ?? defect('a WITH_THIS_VISIT cue, no family');
      const title = LocalizedText.pick(series.title, locale);
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
        LocalizedText.pick(series.title, locale),
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
        LocalizedText.pick(series.title, locale),
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
 * starts on the shop's today (`now`, the shop's) — the rhythm's current
 * mark reads «днес». Every leg starts at the drafted start, read on the
 * shop's wall clock as it is (Law 7.3, pass D DEP-15); a start that is no
 * minute of the day starts on no day.
 */
export function isInChairToday(
  context: ClientCardContext,
  now: ShopNow,
): boolean {
  return ClientGlanceSystem.isInChairToday(
    context.appointmentId !== null && !context.settled,
    legStartsOf(context),
    now,
  );
}

/**
 * The visit on screen's legs' starts on the shop's wall clock — each leg
 * starts at the drafted start; none while the draft holds no start, or
 * one that is no minute of the day.
 */
function legStartsOf(context: ClientCardContext): readonly WallTime[] {
  const start = context.start;
  if (start === null || start.startMinutes === null) return [];
  const at = WallTime.of(start.localDate, start.startMinutes);
  return context.legs.map(() => at);
}
