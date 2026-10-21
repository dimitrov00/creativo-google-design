import {
  LocalDate,
  ServiceId,
  ServiceVariantId,
  type TimeZone,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import type { VisitLeg, WallTime } from '@core/components';
import {
  AgeSystem,
  ClientGlanceSystem,
  PhoneSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  type Appointment,
  type AppointmentPhoto,
  type ClientStatsRecord,
  Profile,
  type User,
  type WaitlistRequest,
} from '@core/entities';
import {
  type BadgeSeries,
  type LoyaltyAccount,
  type LoyaltyCatalog,
  isNewSince,
  levelNumeral,
} from '@creativo/application/engagement';
import { type VisitRowVm } from '@creativo/features/shared/visits';
import {
  type AchievementsContext,
  completesWithThisVisit,
  isOneOff,
  medalVm,
  newestFaceLevel,
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

/** The shop's zone: pauses, birthdays and «днес» are read on its calendar. */
const SHOP_ZONE: TimeZone = (() => {
  const zone = ZonedTimeSystem.checkZone('Europe/Sofia');
  if (!zone.ok) defect('unreachable: the shop zone is a zone');
  return zone.value;
})();

/** How many capsules show before «+N» stands for the rest. */
const CAPSULE_LIMIT = 4;

/** The past cuts the rail shows. */
const PHOTO_RAIL_LIMIT = 6;

// ── The person ──────────────────────────────────────────────────────────

/**
 * Online booking paused AS OF now — a temporary pause that has run out is
 * no pause (`AccountLifecycle.isBlockedAt`, read off the user's own
 * lifecycle slice). `until` is the Sofia day it ends, `null` for a
 * permanent pause.
 */
export function pauseOf(
  user: User | null,
  nowMs: number,
): { readonly until: string | null } | null {
  const now = UtcEpochMs.of(nowMs);
  // No instant to judge by: nothing can be shown paused at it.
  if (!now.ok) return null;
  const pause = ClientGlanceSystem.pauseOf(user, now.value);
  if (pause === null) return null;
  return {
    until: pause.untilUtcMs === null ? null : shopDayOf(pause.untilUtcMs),
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
  /** `AVATAR_UPLOADER.find(uid)`, after the seat's own picture. */
  readonly avatarSrc: string | null;
  readonly nowMs: number;
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
  const pause = pauseOf(user, input.nowMs);
  const today = shopDayOf(input.nowMs);
  let stateLine: string | null = null;
  if (words === null) {
    stateLine = null;
  } else if (subject.userId === null) {
    stateLine = words.head.guest;
  } else if (input.settled) {
    if (pause !== null) {
      stateLine =
        pause.until === null
          ? words.head.pausedPermanent
          : words.head.pausedUntil(dayShort(pause.until, today, words.lang));
    } else if (!input.statsKnown) {
      stateLine = null;
    } else if (
      stats === null ||
      stats.lifetimeVisitsCompleted === 0 ||
      stats.firstVisitLocalDate === null
    ) {
      stateLine = words.head.firstVisit;
    } else {
      stateLine = words.head.since(
        monthYearLong(stats.firstVisitLocalDate, words.lang),
      );
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
    readonly catalog: LoyaltyCatalog;
  } | null;
  readonly nowMs: number;
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

/** The dialable number: the account's own, else the seat's (never the booker's for a companion). */
export function phoneOf(
  subject: ClientCardSubject,
  user: User | null,
): { readonly e164: string; readonly display: string } | null {
  // A registered account always holds a phone; a stub never reaches here.
  if (user !== null && user.phone !== null) {
    return {
      e164: user.phone,
      display: PhoneSystem.formatInternational(user.phone),
    };
  }
  const raw = (subject.phoneHref ?? subject.phone ?? '')
    .replace(/^tel:/i, '')
    .replace(/[^\d+]/g, '');
  if (raw.replace('+', '').length === 0) return null;
  return { e164: raw, display: subject.phone ?? raw };
}

export function sameLegs(
  last: readonly VisitLeg[],
  draft: ClientCardContext['legs'],
): boolean {
  return ClientGlanceSystem.sameLegs(
    last,
    draft.map((leg) => ({
      serviceId: ServiceId.of(leg.serviceId),
      variantId:
        leg.variantId === null ? null : ServiceVariantId.of(leg.variantId),
    })),
  );
}

export interface ActionsInput {
  readonly subject: ClientCardSubject;
  readonly user: User | null;
  readonly name: string;
  readonly stats: ClientStatsRecord | null;
  readonly context: ClientCardContext;
  readonly online: boolean;
  readonly nowMs: number;
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
  const lastId = stats?.lastVisitAppointmentId ?? null;
  const lastDay = stats?.lastVisitLocalDate ?? null;
  const lastLegs = stats?.lastVisitLegs ?? [];
  if (
    lastId !== null &&
    lastDay !== null &&
    input.online &&
    !input.context.gone &&
    lastId !== input.context.appointmentId &&
    lastLegs.length > 0 &&
    !sameLegs(lastLegs, input.context.legs)
  ) {
    const services = [
      ...new Set(
        lastLegs.map((leg) => input.context.catalog.serviceName(leg.serviceId)),
      ),
    ].filter((service): service is string => service !== null);
    if (services.length > 0) {
      const today = shopDayOf(input.nowMs);
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
  readonly nowMs: number;
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
  const newestFirst = [...appointments].sort(
    (a, b) => b.utcEpochMs - a.utcEpochMs,
  );
  for (const appointment of newestFirst) {
    if (appointment.id === currentAppointmentId) continue;
    const row = rowOf(appointment);
    if (row.outcome === 'worked') return { appointment, row };
  }
  return null;
}

// ── The photo rail ─────────────────────────────────────────────────────

/** One past cut: «12.08» on the tile, «Снимка от 12 август» for a reader. */
export function clientPhotoVm(
  photo: AppointmentPhoto,
  nowMs: number,
  words: ClientCardWords,
): ClientPhotoVm {
  const today = shopDayOf(nowMs);
  const day = shopDayOf(photo.takenAtUtcMs);
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
  words: ClientCardWords,
): readonly ClientPhotoVm[] {
  const excluded = new Set(
    excludedAppointmentIds.filter((id): id is string => id !== null),
  );
  return photos
    .filter((photo) => !excluded.has(photo.appointmentId))
    .slice(0, PHOTO_RAIL_LIMIT)
    .map((photo) => clientPhotoVm(photo, nowMs, words));
}

// ── Loyalty and achievements on the glance ──────────────────────────────

export interface LoyaltyTilesInput {
  readonly account: LoyaltyAccount;
  /** Needed by the points tile; `null` = not loaded (the tile waits, the store says how). */
  readonly catalog: LoyaltyCatalog | null;
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

/** Shelves before seasons, then the catalogue's order — which family a cue names first. */
export function cueOrder(data: AchievementsData) {
  const shelf = (series: BadgeSeries) =>
    series.categoryId === null
      ? Number.POSITIVE_INFINITY
      : (data.catalog.category(series.categoryId.value)?.order ??
        Number.POSITIVE_INFINITY);
  return (a: BadgeSeries, b: BadgeSeries) =>
    shelf(a) - shelf(b) || a.order - b.order;
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
    newest === null ? null : data.catalog.series(newest.seriesId);
  const soon = soonSeriesIds(data, ctx, 3)
    .filter((id) => id !== newestSeries?.id.value)
    .map((id) => data.catalog.series(id))
    .filter((series): series is BadgeSeries => series !== null);
  const completing = data.catalog.families
    .filter((series) => completesWithThisVisit(series, data, ctx))
    .sort(cueOrder(data))[0];
  const seen = new Set<string>();
  const slots = [
    ...(completing === undefined ? [] : [completing]),
    ...(newestSeries === null ? [] : [newestSeries]),
    ...soon,
  ]
    .filter((series) => {
      if (seen.has(series.id.value)) return false;
      seen.add(series.id.value);
      return true;
    })
    .slice(0, 3);

  let cue: string | null = null;
  if (completing !== undefined) {
    const title = completing.title.get(locale);
    // A single act has no levels (its tile wears no numeral, no «ниво I»
    // is heard, medals.presenter): «Рожден ден в салона с това посещение»,
    // the suffix the pending tile's caption already says (review 3, F9).
    // A levelled family names the level the visit reaches.
    if (isOneOff(completing)) {
      cue = `${title} ${words.achievements.withThisVisit}`;
    } else {
      const standing = completing.standing(
        data.progress.get(completing.id.value) ?? null,
      );
      cue = words.achievements.cueWithThisVisit(
        title,
        levelNumeral(standing.next?.level ?? standing.highestLevel + 1),
      );
    }
  } else if (
    newest !== null &&
    newestSeries !== null &&
    isNewSince(newest.earnedAt, data.previousVisitAtMs)
  ) {
    cue = words.achievements.cueNew(
      newestSeries.title.get(locale),
      levelNumeral(newest.level),
    );
  } else {
    const closest = soon[0];
    const standing = closest?.standing(
      data.progress.get(closest.id.value) ?? null,
    );
    if (
      closest !== undefined &&
      standing?.next != null &&
      standing.target !== null
    ) {
      cue = words.achievements.cueClose(
        closest.title.get(locale),
        standing.value,
        standing.target,
        levelNumeral(standing.next.level),
      );
    }
  }
  return {
    // «ново» in slot 1's name only, the newest level's, and only while the
    // cue is not «С това посещение»: the two closest are still to come,
    // never «new» (one place per page, §3.0). The cue says it on screen.
    medals: slots.map((series, index) =>
      medalVm(series, data, ctx, {
        ...options,
        markNew:
          index === 0 && completing === undefined && series === newestSeries,
      }),
    ),
    cue,
  };
}

/**
 * The client is in the chair today: the visit on screen is open and
 * starts on the shop's today — the rhythm's current mark reads «днес».
 */
export function isInChairToday(
  context: ClientCardContext,
  nowMs: number,
): boolean {
  const now = UtcEpochMs.of(nowMs);
  // No "today" without a now to read it from.
  if (!now.ok) return false;
  const legs: WallTime[] = [];
  for (const leg of context.legs) {
    // A leg whose start is no instant starts on no day.
    const start = UtcEpochMs.of(Date.parse(leg.startsAtIso));
    if (start.ok) legs.push(ZonedTimeSystem.toLocal(start.value, SHOP_ZONE));
  }
  return ClientGlanceSystem.isInChairToday(
    context.appointmentId !== null && !context.settled,
    legs,
    ZonedTimeSystem.shopNow(now.value, SHOP_ZONE),
  );
}
