import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { type Observable, combineLatest, from, map, of, switchMap } from 'rxjs';
import { settledViewTransition } from './shared/view-transition';
import {
  AppointmentId,
  AppointmentPhotoId,
  BarberId,
  BusyKey,
  CouponId,
  CustomerId,
  EndMinute,
  ExceptionEffect,
  GrantStatus,
  LocalDate,
  LocationId,
  MinuteOfDay,
  OperationId,
  type RepositoryError,
  Result,
  ScheduleExceptionId,
  SchedulingError,
  type TimeZone,
  UserId,
  UtcEpochMs,
  VoucherRefusal,
  defect,
} from '@core/primitives';
import {
  Combinability,
  CouponOccasion,
  ExceptionEffectRule,
  GrantExpiry,
  MinuteRange,
  PhotoOrigin,
  type ShopNow,
  VoucherCode,
  type WallTime,
} from '@core/components';
import type {
  Appointment,
  AppointmentNote,
  AppointmentPhoto,
  BarberBusyDay,
  BarberSchedule,
  Coupon,
  CouponGrant,
  GiftVoucher,
  ScheduleException,
  ScheduleExceptionMeta,
  ShopLocation,
} from '@core/entities';
import {
  AvailabilitySystem,
  CouponGrantSystem,
  GridLayoutSystem,
  type LandedRevision,
  type LaneGap as EcsLaneGap,
  RosterSystem,
  ScheduleExceptionSystem,
  StaffIntentSystem,
  type UnsettledName,
  VoucherSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  BOOKING_GATEWAY,
  BookingGatewayError,
  type CommitBookingRequest,
  type RecordSeatTipRequest,
  type StaffEditAppointmentRequest,
  type TransitionAppointmentRequest,
} from '@creativo/application/booking';
import { downscaleImage } from '@creativo/infrastructure/storage';
import { AUTH_GATEWAY } from '@creativo/application/identity';
import {
  APPOINTMENT_NOTE_PORTS,
  APPOINTMENT_PHOTO_PORTS,
  APPOINTMENT_READ_PORTS,
  COUPON_VOUCHER_PORTS,
  SCHEDULE_EXCEPTION_PORTS,
  SCHEDULING_READ_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { CLOCK, ID_GENERATOR } from '@creativo/application/shared';
import {
  type VisitEditorGrantOption,
  type VisitEditorPromoOption,
  discountValueOf,
} from './visit-editor/staff-visit-editor';
import { CatalogContentService } from '@creativo/features/shared/catalog';

/** The whole product is Europe/Sofia-only for now (blueprint §7.1). */
export const STAFF_ZONE = 'Europe/Sofia';

/**
 * The shop's day a held coupon lapses on (`YYYY-MM-DD`), or `null` for one
 * that never does. The grant's expiry is an instant (`grantExpiresAtUtcMs`);
 * the card prints a DAY on the shop's calendar («до 28.10»), so the instant
 * is read in the shop's zone — a grant lapsing at 00:30 Sofia is one more
 * day held here, not one less.
 */
export function grantExpiresOn(
  grant: CouponGrant,
  timeZone: TimeZone = STAFF_TIME_ZONE,
): string | null {
  if (grant.grantStatus !== GrantStatus.Active) return null;
  if (grant.grantExpiry !== GrantExpiry.ExpiresAt) return null;
  return ZonedTimeSystem.toLocal(grant.grantExpiresAtUtcMs, timeZone).localDate;
}

/**
 * What makes two sends the SAME staff intent: the visit, the batch, and the
 * two claims beside it — an acknowledged overlap is a different decision
 * from an unacknowledged one, and a claim on another revision is a draft of
 * another visit. Serialised, because equality is the only question ever
 * asked of it. Read off the request AS SENT (the claim rebased — see
 * `StaffDayStore.claimFor`), so a re-send is recognised by what the wire
 * carried.
 */
function intentOf(request: StaffEditAppointmentRequest): string {
  return StaffIntentSystem.intentBasis(
    AppointmentId.of(request.appointmentId),
    request.command,
    request.acknowledgedOverlap === true,
    request.expectedVersion ?? null,
  );
}

/**
 * Every staff intent states the revision it was made on (round 5): the
 * visit's copy's `Appointment.revision`, or `null` where the reader did not
 * say — a claim of nothing, which the server never refuses. Required by the
 * store's one funnel, so no caller can forget it.
 */
export type StaffIntent = StaffEditAppointmentRequest & {
  readonly expectedVersion: number | null;
};

/**
 * How many appointments the search reads each side of now.
 *
 * A 3–5 chair shop books ~40 a day, so 300 reaches roughly a working week
 * back and a working week forward — past the horizon anyone searches by
 * name, and small enough to match in memory without a pause.
 */
const SEARCH_WINDOW_PER_SIDE = 300;

/** A held grant and the coupon it was issued from — one row of the «Отстъпка» menu. */
interface HeldGrant {
  readonly grant: CouponGrant;
  readonly coupon: Coupon;
}

/** The sheet's word for each refusal a typed voucher can earn. */
const VOUCHER_REFUSAL_WORD = {
  [VoucherRefusal.Void]: 'void',
  [VoucherRefusal.Expired]: 'expired',
  [VoucherRefusal.Empty]: 'empty',
} as const satisfies Record<VoucherRefusal, 'void' | 'expired' | 'empty'>;

/** The largest visit photo the shop takes, after downscaling — today's limit. */
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * THE UPLOAD GUARD — run BEFORE the bytes go up (`media.port.ts`: limits
 * are a guard before the upload, never the adapter's): what is not an image
 * is refused, and so is one over the limit. `null` lets it through.
 */
export function photoUploadRefusal(
  image: Blob,
): 'not_an_image' | 'too_large' | null {
  if (!image.type.startsWith('image/')) return 'not_an_image';
  if (image.size > MAX_PHOTO_BYTES) return 'too_large';
  return null;
}

/**
 * The renderings the toolbar switches between.
 *
 * `agenda` is the complete run — visits and sellable gaps as one list. The
 * three calendar views are proportional time grids; they differ only in what
 * a COLUMN is, which is the whole reason `week` needs a chair scope:
 *
 * - `day` — one column per chair. The counter's comparison view.
 * - `three-day` / `week` — one column per DAY. Five chairs across seven days
 *   is thirty-five columns and unreadable, so these narrow to one chair by
 *   default and merge with attribution when the shop asks for all of them.
 */
export type StaffView = 'agenda' | 'day' | 'three-day' | 'week';

const STAFF_VIEWS: readonly StaffView[] = [
  'agenda',
  'day',
  'three-day',
  'week',
];

/** A view named in a URL or on the device, or `null` for anything else. */
export function parseView(raw: string | null | undefined): StaffView | null {
  return STAFF_VIEWS.find((view) => view === raw) ?? null;
}

/**
 * Where the last view is kept on the device. `try/catch` on both sides:
 * storage is absent in a private window and throws in some embedded views,
 * and a schedule must open either way.
 */
const STORED_VIEW_KEY = 'staff.schedule.view';

function readStoredView(): StaffView {
  try {
    return (
      parseView(globalThis.localStorage?.getItem(STORED_VIEW_KEY)) ?? 'agenda'
    );
  } catch {
    return 'agenda';
  }
}

function writeStoredView(view: StaffView): void {
  try {
    globalThis.localStorage?.setItem(STORED_VIEW_KEY, view);
  } catch {
    // Nothing to remember on; the reading still shows.
  }
}

const DAY_SPAN: Record<StaffView, number> = {
  agenda: 1,
  day: 1,
  'three-day': 3,
  week: 7,
};

/** Calendar walk on a `YYYY-MM-DD` triple — DST-immune by construction. */
export function addDays(dayKey: string, delta: number): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const shifted = new Date(
    Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + delta),
  );
  return shifted.toISOString().slice(0, 10);
}

/** Monday-first: Bulgaria's week, stated rather than derived (see caller). */
export function startOfWeek(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const at = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  // `getUTCDay` is 0=Sunday; shift so Monday is 0.
  const weekday = (at.getUTCDay() + 6) % 7;
  return addDays(dayKey, -weekday);
}

/**
 * A stretch of a lane on the absolute timeline — what the sheet draws a
 * window, a block or a hole from. Read off the shop's wall clock once, by
 * the store (`ZonedTimeSystem`, the location's zone): the minutes are the
 * truth (Law 7.3), these are where they fall for the drawing.
 */
export interface LaneSpan {
  readonly startMs: number;
  readonly endMs: number;
}

/** One visible day with a lane per chair in scope. */
export interface StaffDayCell {
  readonly dayKey: string;
  readonly lanes: readonly BarberDayLane[];
}

/**
 * A day's lanes before the clock: each lane's holes, not yet split at now —
 * on the lane's shop day (`day`, `null` for a key that names no day), in its
 * wall-clock minutes (Law 7.3).
 */
interface DayGeometryCell {
  readonly dayKey: string;
  readonly lanes: readonly (Omit<BarberDayLane, 'gaps'> & {
    readonly day: LaneDay | null;
    readonly holes: readonly MinuteRange[];
  })[];
}

/** A hole in a chair's rostered day that is long enough to sell. */
export interface LaneGap {
  readonly startMs: number;
  readonly endMs: number;
  readonly minutes: number;
  /**
   * Still ahead of the clock, so a shop could still fill it.
   *
   * The same hole is inventory before now and a record after it. A gap that
   * has already elapsed is drawn — an idle morning must not render the same
   * as a fully booked one — but it is never offered, never tappable, and it
   * carries different words.
   */
  readonly sellable: boolean;
}

/** One string for one subscription — the days and the chairs it answers. */
function laneKeyOf(
  days: readonly string[],
  barbers: readonly string[],
): string {
  return `${days.join('|')}#${barbers.join('|')}`;
}

/**
 * `YYYY-MM-DD` → the shop day, or `null` on anything malformed. The key is
 * ours (the `?day=` param, `addDays`), so this is a parse rather than a
 * validation — but a hand-edited URL reaches it, and a bad day must yield
 * no geometry rather than a thrown listener.
 */
function localDateOf(dayKey: string): LocalDate | null {
  const day = LocalDate.parse(dayKey);
  return day.ok ? day.value : null;
}

/**
 * What actually occupied a chair, from the appointments themselves.
 *
 * ### Why not `barberBusy`
 * The projection keeps only `PENDING`/`CONFIRMED` (`rebuildBusy`) and TTLs
 * thirty days after the day it describes. That is exactly right for its
 * job — `/book` reads it anonymously and it must mean "what can I sell" —
 * and it makes it structurally unable to describe a past day: by close of
 * business every completed and no-showed visit has dropped out of it, so it
 * reports the whole rostered day free. Deriving elapsed holes from it would
 * draw a nine-hour "unbooked" card over a fully worked Saturday, and one
 * per chair on any day older than a month.
 *
 * The lane already holds every appointment, untruncated and untimed-out.
 * This rebuilds the SAME envelope the busy projection writes — the seat's
 * slot padded by its own setup and cleanup (`GridLayoutSystem`) — so the
 * two sources coincide exactly wherever both exist, and there is no
 * padded/unpadded seam at the clock.
 *
 * A CANCELLED appointment contributes nothing: the chair genuinely went
 * empty, and that lost hour becoming visible is the point. Everything else
 * — pending, confirmed, completed, no-show — consumed the chair. A no-show
 * especially: nobody came, but nobody else could have been booked either.
 *
 * `blocks` are deliberately NOT added. They were already subtracted from
 * the windows upstream (`RosterSystem.buildDayWindows`), and counting them
 * again would turn every lunch break into idleness.
 */
export function occupiedIntervals(
  appointments: readonly Appointment[],
  barberId: string,
  busy: readonly LaneSpan[],
): readonly LaneSpan[] {
  const day = dataDayOf(busy, appointments, barberId);
  if (day === null) return [];
  return intervalsOn(
    day,
    occupiedOn(day, appointments, barberId, rangesOn(day, busy)),
  );
}

/**
 * What occupied the chair on one lane day, in that day's minutes. The
 * day's appointments are the visits (an `Appointment` IS an occupying
 * visit, Law 3); one on another shop day holds nothing here.
 */
function occupiedOn(
  day: LaneDay,
  appointments: readonly Appointment[],
  barberId: string,
  busy: readonly MinuteRange[],
): readonly MinuteRange[] {
  return GridLayoutSystem.occupiedIntervals(
    appointments.filter(
      (appointment) => appointment.localDate === day.localDate,
    ),
    BarberId.of(barberId),
    busy,
  );
}

/**
 * Rostered time minus what is taken — every hole in the chair's day.
 *
 * `busy` arrives ALREADY padded by the barber's turnaround (the store's own
 * `AvailabilitySystem.paddedBusy`), so a gap here is genuinely bookable
 * rather than a sliver that only exists because the padding has not been
 * applied yet. Holes under `GridLayoutSystem.SHORTEST_SELLABLE_MINUTES` (20)
 * are dropped, not drawn quieter: an unsellable two-minute rounding artefact
 * is noise on a surface graded on being scannable.
 */
export function laneGaps(
  rostered: readonly LaneSpan[],
  occupied: readonly LaneSpan[],
  nowMs: number,
): readonly LaneGap[] {
  // SPLIT AT NOW, then floor — never the other way round
  // (`GridLayoutSystem.sellableAt`). The holes take no clock; the minute
  // tick re-splits them alone (`StaffDayStore.dayCells`).
  const first = rostered[0];
  if (first === undefined) return [];
  const zone = STAFF_TIME_ZONE;
  const day = laneDayOf(
    wallTimeOf(first.startMs, zone).localDate,
    zone,
    rostered,
    occupied,
  );
  const now = shopNowOf(nowMs, zone);
  return gapsOn(
    day,
    GridLayoutSystem.laneGaps(
      rangesOn(day, rostered),
      rangesOn(day, occupied),
      now,
      day.localDate,
    ),
    cutOf(day, now, nowMs),
  );
}

/* ── The lane geometry's boundary (Law 7.3) ───────────────────────────── */

/*
 * `GridLayoutSystem` works on ONE shop day's wall clock: a lane is a
 * barber's `LocalDate`, its spans `MinuteRange`s, "now" a `ShopNow`. The
 * roster, the busy projection and the visits all ARE wall-clock minutes;
 * the sheet draws on instants (`LaneSpan`), so the store reads each minute
 * back once, through the lane day's frame. A caller handing instants in
 * (`laneGaps`, `occupiedIntervals`) gets its OWN instants back: every
 * minute an input named maps back to the instant it was read from, the
 * clock's minute to the clock's own instant, and only a minute nobody named
 * is read off the shop's clock (`ZonedTimeSystem.toUtc`). A lane never
 * leaves its day — one shop day per visit (F-6), and the busy projection
 * clips to it.
 */

/** The tenant zone, branded — the fallback until the catalogue names a shop's. */
const STAFF_TIME_ZONE: TimeZone = zoneOf(STAFF_ZONE);

/** One lane's shop day, and the caller's instants its minutes were read from. */
interface LaneDay {
  readonly localDate: LocalDate;
  readonly timeZone: TimeZone;
  /** A minute of the day (1440: the closing midnight) → the instant it came from; first wins. */
  readonly instants: ReadonlyMap<number, number>;
  /** Every instant the lane named, read on the shop's clock ONCE (`rangesOn` reads them back). */
  readonly walls: ReadonlyMap<number, WallTime>;
  /** The day's first instant on the shop's clock. */
  readonly originUtcMs: number;
  /**
   * The day's wall clock runs 24 hours (no DST transition): a minute of it
   * is `originUtcMs + minute` — resolved once per lane day, so the minute
   * tick does plain arithmetic, never `Intl`.
   */
  readonly uniform: boolean;
}

/** One shop day's frame: its first instant, and whether it runs 24 hours. */
interface DayFrame {
  readonly originUtcMs: number;
  readonly uniform: boolean;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** The frames of the days a session draws, by zone and day — two `startOfLocalDay`s each, once. */
const DAY_FRAMES = new Map<string, DayFrame>();

function frameOf(localDate: LocalDate, timeZone: TimeZone): DayFrame {
  const key = `${timeZone}|${localDate}`;
  let frame = DAY_FRAMES.get(key);
  if (frame === undefined) {
    const origin = ZonedTimeSystem.startOfLocalDay(localDate, timeZone);
    const next = ZonedTimeSystem.startOfLocalDay(
      LocalDate.addDays(localDate, 1),
      timeZone,
    );
    frame = {
      originUtcMs: origin,
      uniform: UtcEpochMs.elapsedMs(origin, next) === MS_PER_DAY,
    };
    DAY_FRAMES.set(key, frame);
  }
  return frame;
}

/** The clock's own minute and instant, when "now" falls on the lane's day. */
interface LaneCut {
  readonly minute: number;
  readonly ms: number;
}

/** An IANA zone the catalogue already accepted. */
function zoneOf(raw: string): TimeZone {
  const zone = ZonedTimeSystem.checkZone(raw);
  if (!zone.ok) defect(`unreachable: an unknown zone ${raw}`);
  return zone.value;
}

/** An instant as the brand (a stored or clock instant is a safe integer). */
function utcMsOf(epochMs: number): UtcEpochMs {
  const instant = UtcEpochMs.of(Math.trunc(epochMs));
  if (!instant.ok) defect(`unreachable: not an instant ${epochMs}`);
  return instant.value;
}

/** An instant on the shop's wall clock. */
function wallTimeOf(epochMs: number, timeZone: TimeZone): WallTime {
  return ZonedTimeSystem.toLocal(utcMsOf(epochMs), timeZone);
}

/** "Now" as the shop sees it — derived once per read from the store's clock. */
function shopNowOf(nowMs: number, timeZone: TimeZone): ShopNow {
  return ZonedTimeSystem.shopNow(utcMsOf(nowMs), timeZone);
}

function startMinuteOf(minute: number): MinuteOfDay {
  const start = MinuteOfDay.of(minute);
  if (!start.ok) defect(`unreachable: a start off the clock ${minute}`);
  return start.value;
}

function endMinuteOf(minute: number): EndMinute {
  const end = EndMinute.of(minute);
  if (!end.ok) defect(`unreachable: an end off the clock ${minute}`);
  return end.value;
}

/** The lane day of `localDate`, naming every instant of `lists` that falls on it. */
function laneDayOf(
  localDate: LocalDate,
  timeZone: TimeZone,
  ...lists: readonly (readonly LaneSpan[])[]
): LaneDay {
  const next = LocalDate.addDays(localDate, 1);
  const instants = new Map<number, number>();
  const walls = new Map<number, WallTime>();
  const name = (epochMs: number): void => {
    let at = walls.get(epochMs);
    if (at === undefined) {
      at = wallTimeOf(epochMs, timeZone);
      walls.set(epochMs, at);
    }
    const minute =
      at.localDate === localDate
        ? at.minute
        : at.localDate === next && at.minute === 0
          ? 1440
          : null;
    if (minute !== null && !instants.has(minute)) instants.set(minute, epochMs);
  };
  for (const list of lists) {
    for (const span of list) {
      name(span.startMs);
      name(span.endMs);
    }
  }
  return {
    localDate,
    timeZone,
    instants,
    walls,
    ...frameOf(localDate, timeZone),
  };
}

/** An instant on the lane's wall clock — the reading the lane already made, when it named it. */
function wallOn(day: LaneDay, epochMs: number): WallTime {
  return day.walls.get(epochMs) ?? wallTimeOf(epochMs, day.timeZone);
}

/**
 * The lane day the data itself is on, for a caller that names none: the
 * first busy span's day, else the first of this barber's visits'. `null`
 * when nothing at all occupied the chair.
 */
function dataDayOf(
  busy: readonly LaneSpan[],
  appointments: readonly Appointment[],
  barberId: string,
): LaneDay | null {
  const zone = STAFF_TIME_ZONE;
  const first = busy[0];
  if (first !== undefined) {
    return laneDayOf(wallTimeOf(first.startMs, zone).localDate, zone, busy);
  }
  for (const appointment of appointments) {
    if (appointment.seats.some((seat) => seat.barberId === barberId)) {
      return laneDayOf(appointment.localDate, zone, busy);
    }
  }
  return null;
}

/** Instants as minute ranges of the lane's day, clipped to it. */
function rangesOn(
  day: LaneDay,
  spans: readonly LaneSpan[],
): readonly MinuteRange[] {
  const out: MinuteRange[] = [];
  for (const span of spans) {
    const start = wallOn(day, span.startMs);
    const end = wallOn(day, span.endMs);
    const from =
      start.localDate < day.localDate
        ? 0
        : start.localDate > day.localDate
          ? null
          : start.minute;
    const to =
      end.localDate > day.localDate
        ? 1440
        : end.localDate < day.localDate
          ? null
          : end.minute;
    if (from === null || to === null || to <= from) continue;
    out.push(MinuteRange.of(startMinuteOf(from), endMinuteOf(to)));
  }
  return out;
}

/** The instant a minute of the lane's day reads as — the caller's own where it named one. */
function instantOn(day: LaneDay, minute: number, cut: LaneCut | null): number {
  const named = day.instants.get(minute);
  if (named !== undefined) return named;
  if (cut !== null && cut.minute === minute) return cut.ms;
  // A day of 24 hours: plain arithmetic from its first instant (1440 is the
  // next day's start) — the zone was read once, when the lane day was made.
  if (day.uniform) return day.originUtcMs + minute * MS_PER_MINUTE;
  const next = LocalDate.addDays(day.localDate, 1);
  if (minute >= 1440) {
    return ZonedTimeSystem.startOfLocalDay(next, day.timeZone);
  }
  // A minute inside a spring-forward gap reads as the gap's end.
  for (let at = minute; at < 1440; at++) {
    const instant = ZonedTimeSystem.toUtc(
      day.localDate,
      startMinuteOf(at),
      day.timeZone,
    );
    if (instant.ok) return instant.value;
  }
  return ZonedTimeSystem.startOfLocalDay(next, day.timeZone);
}

/**
 * A wall-clock reading of the shop — a day and a minute of it (1440: the
 * closing midnight) — as the instant it names, through the same day frame
 * the lanes are drawn on, so a visit's block and the lane's spans agree to
 * the millisecond. A minute inside a spring-forward gap reads as the gap's
 * end. What the sheet's rows draw a visit's start and end from.
 */
export function wallClockInstant(
  localDate: LocalDate,
  minute: number,
  timeZone: TimeZone = STAFF_TIME_ZONE,
): number {
  return instantOn(laneDayOf(localDate, timeZone), minute, null);
}

/** Minute ranges of the lane's day as instants. */
function intervalsOn(
  day: LaneDay,
  ranges: readonly MinuteRange[],
): readonly LaneSpan[] {
  return ranges.map((range) => ({
    startMs: instantOn(day, range.startMinutes, null),
    endMs: instantOn(day, range.endMinutes, null),
  }));
}

/** The clock's cut of a lane: its minute and instant, on the lane's own day only. */
function cutOf(day: LaneDay, now: ShopNow, nowMs: number): LaneCut | null {
  return now.localDate === day.localDate
    ? { minute: now.currentMinute, ms: nowMs }
    : null;
}

/** The system's gaps as the store's — instants, minutes, sellable. */
function gapsOn(
  day: LaneDay,
  gaps: readonly EcsLaneGap[],
  cut: LaneCut | null,
): readonly LaneGap[] {
  return gaps.map((gap) => ({
    startMs: instantOn(day, gap.startMinutes, cut),
    endMs: instantOn(day, gap.endMinutes, cut),
    minutes: gap.minutes,
    sellable: gap.sellable,
  }));
}

/** One chair's day as the roster, the exceptions and the busy projection draw it. */
export interface LaneGeometry {
  /** The BOOKABLE windows — roster ∩ shop hours − blocks, at the shops the day offers. */
  readonly rostered: readonly MinuteRange[];
  /** The carve-outs — a break, an admin hour — clipped to worked time. */
  readonly blocks: readonly MinuteRange[];
  /** The busy projection's spans, padded by the barber's turnaround. */
  readonly busy: readonly MinuteRange[];
}

const NO_GEOMETRY: LaneGeometry = { rostered: [], blocks: [], busy: [] };

/**
 * ONE CHAIR'S DAY, derived (F1-10, blueprint §4.2) — the availability the
 * store used to receive pre-folded from an adapter, computed here from the
 * raw streams with the systems `/book` and the commit use, so the shop is
 * never shown a hole the public grid would refuse to sell:
 *
 * - the windows are `RosterSystem.buildDayWindows` — the version in force,
 *   the day's exception, each shop's published hours — kept only at a shop
 *   the day OFFERS (an active shop of the catalogue): a shop absent from the
 *   hours would otherwise read as "publishes no bound" and its chair reach
 *   the grid unclamped;
 * - the blocks are `RosterSystem.buildDayCarveOuts`, the same inputs' second
 *   question — the windows say what is left, these say what was blocked;
 * - the busy spans are the projection's, padded by the schedule's
 *   turnaround (`AvailabilitySystem.paddedBusy`). Busy is location-agnostic
 *   on purpose: a barber booked at the other shop is not free here either.
 *
 * A barber with no schedule, or no window that day, has no geometry at all
 * — not rostered, and nothing of theirs to draw. Exported for its spec
 * (`lane-geometry.spec.ts`).
 */
export function laneGeometryOf(
  barberId: BarberId,
  localDate: LocalDate,
  schedule: BarberSchedule | null,
  busyDay: BarberBusyDay | null,
  exception: ScheduleException | null,
  locations: readonly ShopLocation[],
): LaneGeometry {
  if (schedule === null) return NO_GEOMETRY;
  const offered = new Set<LocationId>(locations.map((shop) => shop.id));
  const input = {
    barberId,
    localDate,
    versions: schedule.versions,
    exceptions: exception === null ? [] : [exception],
    shopHours: locations.map((shop) => ({
      locationId: shop.id,
      hours: RosterSystem.shopDayHours(shop.openingHours, localDate),
    })),
  };
  const rostered = RosterSystem.buildDayWindows(input).filter((window) =>
    offered.has(window.locationId),
  );
  if (rostered.length === 0) return NO_GEOMETRY;
  return {
    rostered,
    blocks: RosterSystem.buildDayCarveOuts(input).filter((window) =>
      offered.has(window.locationId),
    ),
    busy: AvailabilitySystem.paddedBusy({
      barberId,
      spans: busyDay?.blocks ?? [],
      turnaroundMinutes: schedule.turnaroundMinutes,
      release: [],
    }),
  };
}

/**
 * A changed day's identity slice — keyed by its `BusyKey` (the busy
 * projection's key, read by the commit beside it), its `utcEpochMs` the
 * shop day's first instant in the shop's zone (computed once, here, at the
 * write — F-28).
 */
function exceptionMetaOf(
  barberId: BarberId,
  localDate: LocalDate,
  locationId: string,
  timeZone: TimeZone,
): ScheduleExceptionMeta {
  return {
    id: ScheduleExceptionId.of(BusyKey.of(barberId, localDate)),
    barberId,
    localDate,
    utcEpochMs: ZonedTimeSystem.startOfLocalDay(localDate, timeZone),
    locationId: LocationId.of(locationId),
  };
}

/** A stored changed day's identity slice alone — its effect left behind for the next one. */
function metaOfStored(stored: ScheduleException): ScheduleExceptionMeta {
  return {
    id: stored.id,
    barberId: stored.barberId,
    localDate: stored.localDate,
    utcEpochMs: stored.utcEpochMs,
    locationId: stored.locationId,
  };
}

/**
 * One barber's chair for the chosen day, with its own failure flag.
 *
 * `rostered` is what makes the run COMPLETE rather than sparse: without it a
 * barber on holiday and a barber with a wide-open Saturday both render as
 * "free day", which is the surface's oldest lie.
 */
export interface BarberDayLane {
  readonly barberId: string;
  /** The day's visits on this chair, as stored — every status. */
  readonly appointments: readonly Appointment[];
  /** The chair's working windows today. Empty means NOT ROSTERED. */
  readonly rostered: readonly LaneSpan[];
  /**
   * Time BLOCKED OUT of the worked day — a break, an admin hour.
   *
   * A separate channel from `rostered` on purpose. A block is the complement
   * of a window, and if it arrived only as that complement there would be no
   * way to tell "Ivan blocked this hour" from "Ivan is not rostered" from
   * "the shop is shut" — which is exactly what the calendar could not do, and
   * why time you blocked yourself came back as anonymous grey shading.
   */
  readonly blocks: readonly LaneSpan[];
  /**
   * EVERY hole inside those windows, already padded by turnaround — the
   * elapsed ones as well as the sellable ones, split at the clock and
   * distinguished by `LaneGap.sellable`.
   */
  readonly gaps: readonly LaneGap[];
  readonly failed: boolean;
}

/**
 * Page-scoped store for `/staff` — the shop's day, one live lane per active
 * barber, and the pen that moves an appointment through its lifecycle.
 *
 * ### One `busyKeys` query per barber, not one shop query
 * The roster is bounded (a barbershop, not a franchise) and the
 * `{barberId}__{localDate}` mirror is single-field-indexed, so N tiny
 * listeners beat inventing a new composite index. The lanes re-subscribe
 * when the day changes.
 *
 * ### Transitions are server writes
 * `gateway.transition` calls the role-checked callable; the live listeners
 * then show the new status on their own — no optimistic local mutation,
 * because the server can refuse (`canTransition` is the law) and a lane
 * that lied for a second teaches staff to distrust it.
 */
@Injectable()
export class StaffDayStore {
  private readonly appointments = inject(APPOINTMENT_READ_PORTS);
  private readonly notes = inject(APPOINTMENT_NOTE_PORTS);
  private readonly photos = inject(APPOINTMENT_PHOTO_PORTS);
  private readonly couponsVouchers = inject(COUPON_VOUCHER_PORTS);
  /** The raw availability streams the lanes' geometry is derived from (F1-10). */
  private readonly scheduling = inject(SCHEDULING_READ_PORTS);
  private readonly exceptions = inject(SCHEDULE_EXCEPTION_PORTS);
  private readonly gateway = inject(BOOKING_GATEWAY);
  private readonly clock = inject(CLOCK);
  /** Mints each staff intent's `operationId` — see `staffEdit`. */
  private readonly ids = inject(ID_GENERATOR);
  private readonly catalog = inject(CatalogContentService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /**
   * WHO IS AT THE BOOK — the session the stamps name: who wrote a team note,
   * who took a photo (`notes-photos.port.ts`: the caller fills them from its
   * own clock and session, never the adapter). `null` until the principal
   * is an onboarded one.
   */
  private readonly principal = toSignal(
    inject(AUTH_GATEWAY).observePrincipal(),
    { initialValue: null },
  );

  /** The signed-in account, or `null` — what a stamp's `*ByUserId` names. */
  private currentUserId(): UserId | null {
    const principal = untracked(this.principal);
    return principal?.kind === 'active' ? UserId.of(principal.uid.value) : null;
  }

  /**
   * The shop's zone — the LOCATION's (`ShopLocation.timeZone`, Law 7.2), read
   * off the catalogue's shops, never the browser's. Every shop of the tenant
   * keeps one clock (blueprint §7.1), so the first shop that names a zone
   * answers; until the catalogue does, the tenant zone `STAFF_ZONE`. "Today",
   * "now" and every lane's shop day are read in it.
   */
  private readonly shopZone = computed<TimeZone>(
    () => this.catalog.locations()[0]?.timeZone ?? STAFF_TIME_ZONE,
  );

  /**
   * Today, RE-READ rather than frozen.
   *
   * This used to be resolved once in the constructor, on the assumption that
   * "the store's whole life is one visit". A counter tab is open from
   * open to close and routinely overnight — so at 09:00 the next morning the
   * sheet was still showing yesterday, still calling it today, and hiding the
   * "back to today" button precisely because it believed it was already
   * there. The whole morning could be worked against the wrong day.
   */
  private readonly _todayKey = signal(this.resolveToday());
  readonly todayKey = this._todayKey.asReadonly();

  /**
   * Now, on the same minute tick that re-reads today.
   *
   * The gaps read it: a hole shrinks as the morning passes, and one that has
   * wholly elapsed stops being drawn at all.
   */
  private readonly _nowMs = signal(this.resolveNowMs());
  /**
   * The page's ONE clock.
   *
   * Exposed because the component used to keep a second one seeded from
   * `Date.now()` — so the gaps answered to the injected `CLOCK` while every
   * verb gate and the now-line answered to the machine. Two clocks on one
   * screen will always drift; this is the one that goes through the port.
   */
  readonly nowMs = this._nowMs.asReadonly();

  private readonly _dayKey = signal(this.resolveToday());
  readonly dayKey = this._dayKey.asReadonly();

  /** Did the user ASK for this day, or are they just on the default? */
  private readonly _chosen = signal(false);

  /**
   * The last values this store wrote into the URL — `?day=`, `?view=`,
   * `?barber=`.
   *
   * The URL is written by the store and read back as component inputs, so
   * without this the echo of our own write looks like an external change and
   * bounces the day straight back to today. Compare against it and only an
   * ACTUAL external change — first load, or the back button — gets applied.
   *
   * ONE record for the three (2026-09-23, the grid views' design record
   * §10): the view and the chair joined the day in the URL so a link pasted
   * into the staff chat says "Ivan's week", and the back button restores
   * the reading you left. `view` starts UNDEFINED, not null — "never
   * published" — so the page's first look at a silent URL still asks the
   * store to state the restored view (see `applyRouteView`).
   */
  private readonly _published = signal<{
    readonly day: string | null;
    readonly view: StaffView | null | undefined;
    readonly barber: string | null;
  }>({ day: null, view: undefined, barber: null });
  readonly published = this._published.asReadonly();

  constructor() {
    // Cheap, and the only two moments the answer can change: the clock
    // crossing midnight while the tab sits open, and the tab coming back
    // after the laptop was shut. A minute's granularity is finer than any
    // decision made off this value.
    const tick = setInterval(() => {
      this._nowMs.set(this.resolveNowMs());
      this.refreshToday();
    }, 60_000);
    const onVisible = () => {
      if (!document.hidden) {
        this._nowMs.set(this.resolveNowMs());
        this.refreshToday();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      // A URL write scheduled by a store that is leaving would navigate a
      // page that is no longer showing.
      if (this.urlWrite !== null) clearTimeout(this.urlWrite);
      this.destroyed = true;
    });

    // The reveal a jump asked for goes out when the asked day's lanes are
    // the ones on hand — see `_pendingReveal`.
    effect(() => {
      if (this._pendingReveal() && this.settled()) {
        this._pendingReveal.set(false);
        this._revealKey.update((key) => key + 1);
      }
    });

    // A chair named in a link that the catalogue does not know — a barber
    // who left, a hand-edited id — resolves to everyone once the catalogue
    // has answered, rather than to a schedule of nobody. Only once it HAS
    // answered: an empty roster while it loads says nothing about the id.
    effect(() => {
      const scope = this._scope();
      const barbers = this.catalog.barbers();
      if (
        scope !== null &&
        barbers.length > 0 &&
        !barbers.some((barber) => barber.id === scope)
      ) {
        untracked(() => this.setScope(null));
      }
    });
  }

  /**
   * Now, through the injected CLOCK — never `Date.now()`.
   *
   * The clock is injected precisely so time is substitutable, and reading the
   * wall clock directly made the gap arithmetic answer to the machine instead
   * of to the port. It also skipped the zone resolution every other instant
   * on this surface goes through.
   */
  private resolveNowMs(): number {
    const now = this.clock.now(untracked(() => this.shopZone()));
    return now.isSuccess() ? now.value.toMillis() : 0;
  }

  /** Now as the brand — what a stamp and an elapsed-time rule read (T2). */
  private nowUtcMs(): UtcEpochMs {
    return utcMsOf(this.resolveNowMs());
  }

  /** Today on the SHOP's calendar — the clock read in the location's zone. */
  private resolveToday(): string {
    const now = this.clock.now(untracked(() => this.shopZone()));
    return now.isSuccess()
      ? shopNowOf(
          now.value.toMillis(),
          untracked(() => this.shopZone()),
        ).localDate
      : '1970-01-01';
  }

  private refreshToday(): void {
    const today = this.resolveToday();
    if (today === this._todayKey()) return;
    this._todayKey.set(today);
    // NO auto-jump. Moving the day under someone mid-tap is its own trust
    // failure — the sheet says it is stale and offers the way back instead.
  }

  readonly isToday = computed(() => this._dayKey() === this._todayKey());

  /**
   * The sheet is showing a day the user never asked for, and it is no longer
   * today — i.e. midnight rolled over under an open tab. Distinct from simply
   * browsing another day, which is deliberate and needs no warning.
   */
  readonly showingStaleToday = computed(
    () => !this._chosen() && !this.isToday(),
  );

  /**
   * The header chevrons — one PERIOD, not one day.
   *
   * A week view whose chevron moved a single day would leave six of the seven
   * columns unchanged and slide the week under the reader, which is the thing
   * every calendar gets right and is jarring when it is wrong.
   */
  shiftDay(delta: number): void {
    this.goToDay(addDays(this._dayKey(), delta * this.daySpan()));
  }

  /**
   * A JUMP, as opposed to a turn (2026-09-23, the grid views' design record
   * §6): «Към днес» and a pick in the month popover are the two moments the
   * calendar re-reveals its working day — the reader asked to be taken
   * somewhere. Turning a day from the week strip, switching the view or the
   * chair keeps the hour under the reader's thumb, the way swiping to the
   * next day in Apple Calendar keeps the vertical position. The grid keys
   * its reveal on this counter and on nothing else.
   */
  private readonly _revealKey = signal(0);
  readonly revealKey = this._revealKey.asReadonly();

  /**
   * A jump asked for, not yet revealed. The key is bumped only once the
   * lanes on hand answer the asked day (`settled`) — bumped at once, the
   * calendar revealed on the PREVIOUS day's roster and latched before the
   * asked day's arrived (found in review, 2026-09-23). Same day, already
   * loaded: the effect fires in the same pass.
   */
  private readonly _pendingReveal = signal(false);

  jumpToToday(): void {
    this._dayKey.set(this._todayKey());
    this._chosen.set(false);
    this.publishQuery({ day: null });
    this._pendingReveal.set(true);
  }

  /** A day the reader ASKED for by name — the month popover's pick. */
  jumpToDay(dayKey: string | null): void {
    this.goToDay(dayKey);
    this._pendingReveal.set(true);
  }

  /**
   * Show a specific day. `null` or an unparseable key falls back to today,
   * so a hand-edited or stale URL lands somewhere real rather than blank.
   */
  goToDay(dayKey: string | null): void {
    const valid =
      dayKey !== null && /^\d{4}-\d{2}-\d{2}$/.test(dayKey) ? dayKey : null;
    const next = valid ?? this._todayKey();
    this._dayKey.set(next);
    this._chosen.set(next !== this._todayKey());
    this.publishQuery({ day: next === this._todayKey() ? null : next });
  }

  /**
   * The day, the view and the chair live in the URL so a reading can be
   * pasted into a staff chat, and so that coming back from a visit returns
   * to what you were looking at. Absent means the default — today, the
   * list, everyone — a link that pinned today would go stale by morning,
   * and a link that pinned the list would say nothing.
   *
   * `replaceUrl`, as `?day=` always was: the back button leaves the page,
   * it does not walk back through every view switch of the morning.
   */
  private publishQuery(
    patch: Partial<{
      readonly day: string | null;
      readonly view: StaffView | null;
      readonly barber: string | null;
    }>,
  ): void {
    // Read UNTRACKED: a caller inside an effect must not come to depend on
    // the record this writes, or it re-runs on its own write.
    const current = untracked(this._published);
    const next = { ...current, ...patch };
    this._published.set(next);
    // NOTHING TO SAY, NO NAVIGATION: a write that leaves every parameter as
    // it was is recorded and not sent.
    if (
      next.day === current.day &&
      (next.view ?? null) === (current.view ?? null) &&
      next.barber === current.barber
    ) {
      return;
    }
    // AFTER THE CURRENT TASK, and coalesced (found live 2026-09-23). The
    // page's route-input effects call this from inside change detection —
    // inside the ACTIVATION of the page's own first navigation. A navigation
    // started there re-enters the router before that first one has settled
    // (`router.navigated` is still false, so even the same URL is processed
    // anew), which re-activates the page, which re-runs the effect, which
    // navigates again, synchronously, forever: the first look at a silent
    // URL hung the tab. Written on the next task the address bar catches
    // up once the navigation that asked for it is over, and three writes
    // in one tick — a day, a view and a chair restored together — are one
    // navigation with the final record.
    if (this.urlWrite !== null) return;
    this.urlWrite = setTimeout(() => {
      this.urlWrite = null;
      // …and AFTER any view transition still playing: the router starts
      // one of its own on every navigation, and the platform allows one
      // at a time — the write cut the canvas's cross-fade a few
      // milliseconds in (found in review, 2026-09-23).
      void settledViewTransition().then(() => {
        if (this.destroyed) return;
        const stated = this._published();
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {
            day: stated.day,
            view: stated.view ?? null,
            barber: stated.barber,
          },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });
    }, 0);
  }

  /** Set on destroy, so a write that waited on a transition stays unsent. */
  private destroyed = false;

  /** The pending address-bar write, if one is scheduled. */
  private urlWrite: ReturnType<typeof setTimeout> | null = null;

  // ── What the sheet is showing ───────────────────────────────────────

  /**
   * Which rendering. Owner ruling 2026-08-07 reverses §2 of the design brief,
   * which argued for one canvas — the shop wants the calendar views it knows
   * from every other tool, and the switch is a toolbar action.
   */
  /**
   * …and it OPENS where you left it (2026-09-23, §10): the last view is
   * remembered on the device, the way Calendar reopens in the view you
   * closed it in. Only the view — a shared front-desk iPad that woke scoped
   * to one chair would be a lie waiting for the first phone call, so the
   * chair lives in links alone.
   */
  private readonly _view = signal<StaffView>(readStoredView());
  readonly view = this._view.asReadonly();

  setView(view: StaffView): void {
    // The scope SURVIVES the switch. A barber who narrowed the week to their
    // own lane and then tapped Day meant to stay on their own lane; resetting
    // it silently handed them the whole shop back.
    this._view.set(view);
    this.publishQuery({ view: view === 'agenda' ? null : view });
    writeStoredView(view);
  }

  /**
   * The URL's say on the view. A valid name applies; silence — a link with
   * no `?view=`, the first load — keeps the restored view and STATES it, so
   * the address bar and the device agree from the first frame and a link
   * copied from the bar carries the reading it shows.
   */
  applyRouteView(requested: string | null | undefined): void {
    const view = parseView(requested);
    if (view !== null) {
      if (view !== this._view()) this.setView(view);
      else this.publishQuery({ view });
      return;
    }
    // A name nobody has («?view=month») is not silence: it falls back to
    // the list, and the address bar is corrected to say so.
    if (requested) {
      this.setView('agenda');
      return;
    }
    // Silence is an EXTERNAL change too — the site menu's plain link to
    // this page arrives with no `?view=` while the record still says the
    // last one (found in review, 2026-09-23). Forgetting the record first
    // makes the restore a real write, so the bar states the view it shows.
    this._published.update((stated) => ({ ...stated, view: undefined }));
    this.publishQuery({
      view: this._view() === 'agenda' ? null : this._view(),
    });
  }

  /**
   * Which barber the sheet is about. `null` is everyone.
   *
   * In the date-columned views it is what stops five barbers across seven
   * days becoming thirty-five columns; in the list and day views it is the
   * barber's own lane, which is the single most-asked thing on this surface.
   */
  private readonly _scope = signal<string | null>(null);
  readonly scope = this._scope.asReadonly();

  setScope(barberId: string | null): void {
    this._scope.set(barberId);
    this.publishQuery({ barber: barberId });
  }

  /** The URL's say on the chair — applied as asked; the catalogue vets it. */
  applyRouteBarber(requested: string | null | undefined): void {
    const barber = requested ? requested : null;
    if (barber !== this._scope()) this.setScope(barber);
    else this.publishQuery({ barber });
  }

  /** How many days each view spans. */
  readonly daySpan = computed(() => DAY_SPAN[this._view()]);

  /**
   * The days on screen, in clock order.
   *
   * A week runs MONDAY-first: Bulgaria's week starts on Monday, and
   * `Intl.Locale.getWeekInfo` is not available in this runtime, so it is
   * stated rather than derived. The other views simply run forward from the
   * anchor day — a 3-day view that re-anchored to some notion of "this
   * period" would move under the chevrons.
   */
  readonly visibleDays = computed<readonly string[]>(() => {
    const anchor = this._dayKey();
    const span = this.daySpan();
    const start = this._view() === 'week' ? startOfWeek(anchor) : anchor;
    return Array.from({ length: span }, (_, offset) => addDays(start, offset));
  });

  /** The chairs this view is about — every active one, or just the scoped. */
  private readonly scopedBarbers = computed(() => {
    const all = this.catalog.barbers();
    const scope = this._scope();
    return scope === null ? all : all.filter((barber) => barber.id === scope);
  });

  /**
   * The live lanes. Re-wired whenever the day or the roster changes; each
   * barber failing alone (`failed` lane) beats one broken listener blanking
   * the whole sheet.
   *
   * ### Listener count
   * One per (barber, day). A week of five chairs is thirty-five tiny
   * single-field-indexed queries — more than the original day sheet's five,
   * and still cheaper than inventing a composite index and a zoned-ISO range
   * query whose ordering breaks across DST. It is also why the multi-day
   * views default to one chair.
   */
  /**
   * A day the screen is NOT showing but something on it needs live.
   *
   * The visit sheet's frame draws the chair's day around the block being
   * edited, and a barber can step that block onto another date without the
   * agenda underneath moving. Before this, only `visibleDays()` was
   * subscribed — in day view that is exactly one day — so the frame kept
   * drawing the ORIGINAL day's neighbours under a pill that said a different
   * date, and the `data-today` marker went on lying too. A picture of who
   * else is booked is the whole reason that frame exists; drawing the wrong
   * day's is worse than drawing none. (owner ruling 2026-09-04)
   *
   * It is a PROBE, not a second anchor: it joins the SUBSCRIPTION set and
   * nothing else. `visibleDays` still decides what the agenda renders, and
   * `lanes` still resolves the anchor, so nothing on screen moves because a
   * sheet is looking somewhere else.
   */
  /* ── The team's note on the OPEN visit ──────────────────────────── */

  /** The appointment whose note the sheet is reading, or `null`. */
  private readonly _noteFor = signal<string | null>(null);

  /**
   * The sheet's own subscription, like `probeDay`: one listener while a
   * visit is open, none when it is not. The note lives in a staff-only
   * sibling collection (see `AppointmentNotes`), so it is read beside the
   * appointment rather than off it.
   */
  probeNote(appointmentId: string | null): void {
    if (appointmentId === this._noteFor()) return;
    this._noteFor.set(appointmentId);
  }

  /**
   * The listener's latest answer, NAMED BY THE VISIT it answers for — a
   * sheet that hops to another visit of the party must not read the last
   * one's note while the new one loads.
   */
  private readonly noteRead = toSignal(
    toObservable(this._noteFor).pipe(
      switchMap((id) =>
        id === null
          ? of(null)
          : this.notes
              .observeAppointmentNote(AppointmentId.of(id))
              .pipe(map((result) => ({ id, result }))),
      ),
    ),
    { initialValue: null },
  );

  /** The note's text, or `null` — while loading, while absent, or with no visit open. */
  readonly teamNote = computed<string | null>(() => {
    const id = this._noteFor();
    return id === null ? null : (this.teamNoteOf(id) ?? null);
  });

  /**
   * The stored note of `appointmentId` as this device hears it now, or
   * `undefined` when it cannot say — nobody is listening to that visit's
   * note, it has not answered yet, or it failed. What a save measures a
   * colleague's note against (`sidesMovedUnder`): a note this device does
   * not hear is not judged, never guessed. A stored note of blanks is no
   * note (the write never leaves one).
   */
  teamNoteOf(appointmentId: string): string | null | undefined {
    const read = this.noteRead();
    if (
      read === null ||
      read.id !== appointmentId ||
      read.id !== this._noteFor() ||
      !read.result.ok
    ) {
      return undefined;
    }
    const note = read.result.value;
    return note === null || note.text.trim().length === 0 ? null : note.text;
  }

  /* ── The shop's photos of the open visit ─────────────────────────────── */

  private readonly _photosFor = signal<string | null>(null);

  /** Read the visit's photos live beside it, like the note; `null` releases them. */
  probePhotos(appointmentId: string | null): void {
    if (appointmentId === this._photosFor()) return;
    this._photosFor.set(appointmentId);
  }

  private readonly photosResult = toSignal(
    toObservable(this._photosFor).pipe(
      switchMap(
        (
          id,
        ): Observable<Result<readonly AppointmentPhoto[], RepositoryError>> =>
          id === null
            ? of(Result.ok([]))
            : this.photos.observeAppointmentPhotos(AppointmentId.of(id)),
      ),
    ),
    { initialValue: undefined },
  );

  /**
   * The open visit's photos in the order they were taken — none while
   * loading, absent, or with no visit open. The read is one equality, so
   * the order is the store's (an `orderBy` would need a composite index for
   * a list never longer than a visit).
   */
  readonly visitPhotos = computed<readonly AppointmentPhoto[]>(() => {
    const result = this.photosResult();
    if (result === undefined || !result.ok) return [];
    return [...result.value].sort((a, b) =>
      UtcEpochMs.compare(a.takenAtUtcMs, b.takenAtUtcMs),
    );
  });

  private readonly _photoWork = signal(0);
  /** A photo is going up or coming down. */
  readonly photoBusy = computed(() => this._photoWork() > 0);

  /**
   * A shutter press: the picture sized for the wire, checked against the
   * upload guard, then its bytes up and its document written with the
   * visit's facts. The photo's id, its instant and its taker are stamped
   * HERE, from the store's clock and session (`notes-photos.port.ts`), and
   * the guard runs BEFORE the upload (`media.port.ts`: limits are never the
   * adapter's). `true` once the photo is on the visit — the live read draws
   * it; the caller has no thumbnail to place.
   */
  async attachPhoto(request: {
    readonly appointmentId: string;
    readonly barberId: string;
    readonly clientCustomerId: string | null;
    readonly clientLabel: string;
    readonly file: Blob;
  }): Promise<boolean> {
    this._photoWork.update((count) => count + 1);
    try {
      const sized = await downscaleImage(request.file);
      if (photoUploadRefusal(sized.image) !== null) return false;
      const facts: Omit<AppointmentPhoto, 'path' | 'url'> = {
        id: AppointmentPhotoId.of(this.ids.next()),
        appointmentId: AppointmentId.of(request.appointmentId),
        barberId: BarberId.of(request.barberId),
        clientCustomerId:
          request.clientCustomerId === null
            ? null
            : CustomerId.of(request.clientCustomerId),
        clientLabel: request.clientLabel,
        takenByUserId: this.currentUserId(),
        takenAtUtcMs: this.nowUtcMs(),
        width: sized.width,
        height: sized.height,
        photoOrigin: PhotoOrigin.Shot,
        label: null,
      };
      const stored = await this.photos.uploadPhotoBytes(facts, sized.image);
      if (!stored.ok) return false;
      const saved = await this.photos.saveAppointmentPhoto({
        ...facts,
        path: stored.value.path,
        url: stored.value.url,
      });
      return saved.ok;
    } finally {
      this._photoWork.update((count) => count - 1);
    }
  }

  /** One of the shop's own pictures onto the visit: a document, no bytes. */
  async adoptPhoto(reference: {
    readonly appointmentId: string;
    readonly barberId: string;
    readonly clientCustomerId: string | null;
    readonly clientLabel: string;
    readonly path: string;
    readonly url: string;
    readonly label: string | null;
  }): Promise<boolean> {
    this._photoWork.update((count) => count + 1);
    try {
      const result = await this.photos.saveAppointmentPhoto({
        id: AppointmentPhotoId.of(this.ids.next()),
        appointmentId: AppointmentId.of(reference.appointmentId),
        barberId: BarberId.of(reference.barberId),
        clientCustomerId:
          reference.clientCustomerId === null
            ? null
            : CustomerId.of(reference.clientCustomerId),
        clientLabel: reference.clientLabel,
        takenByUserId: this.currentUserId(),
        takenAtUtcMs: this.nowUtcMs(),
        path: reference.path,
        url: reference.url,
        width: null,
        height: null,
        photoOrigin: PhotoOrigin.Library,
        label: reference.label,
      });
      return result.ok;
    } finally {
      this._photoWork.update((count) => count - 1);
    }
  }

  async removePhoto(photo: AppointmentPhoto): Promise<boolean> {
    this._photoWork.update((count) => count + 1);
    try {
      const result = await this.photos.deleteAppointmentPhoto(photo);
      return result.ok;
    } finally {
      this._photoWork.update((count) => count - 1);
    }
  }

  /** The client RECORD whose usable coupons the sheet is offering, or `null`. */
  private readonly _grantsFor = signal<string | null>(null);

  /**
   * THE CLIENT'S PROMISES, read while a visit is open (2026-09-10).
   *
   * The sheet's «Отстъпка» row offers the coupons the client already holds
   * — the shop keeping its own word, which a barber may do at the chair —
   * so they are read beside the visit, like the team note, and released
   * with it. They are held by the client RECORD (D29): the seat's
   * `subjectCustomerId`. A walk-in has no record and no grants; `null`
   * reads as none. One read per client rather than a listener: a grant does
   * not change under an open sheet, and the save re-checks it on the server
   * anyway.
   */
  probeGrants(customerId: string | null): void {
    if (customerId === this._grantsFor()) return;
    this._grantsFor.set(customerId);
  }

  private readonly grantsResult = toSignal(
    toObservable(this._grantsFor).pipe(
      switchMap((id) =>
        id === null
          ? of(Result.ok<readonly HeldGrant[]>([]))
          : from(this.loadGrants(CustomerId.of(id))),
      ),
    ),
    { initialValue: undefined },
  );

  /**
   * The record's ACTIVE grants (the port's query) that are still usable now
   * (`CouponGrantSystem.isUsable`, so an expired one never reaches the
   * menu), each joined to its coupon by id — WHATEVER the coupon's status
   * (`loadCoupons`): a held grant whose coupon was disabled since keeps its
   * name, value and exclusivity in the menu. A grant whose coupon is gone
   * altogether has nothing to say and is left out.
   */
  private async loadGrants(
    customerId: CustomerId,
  ): Promise<Result<readonly HeldGrant[], RepositoryError>> {
    const held = await this.couponsVouchers.listUsableCouponGrants(customerId);
    if (!held.ok) return held;
    const nowUtcMs = this.nowUtcMs();
    const usable = held.value.filter((grant) =>
      CouponGrantSystem.isUsable(grant, nowUtcMs),
    );
    if (usable.length === 0) return Result.ok([]);
    const coupons = await this.couponsVouchers.loadCoupons([
      ...new Set<CouponId>(usable.map((grant) => grant.couponId)),
    ]);
    if (!coupons.ok) return coupons;
    const byId = new Map(coupons.value.map((coupon) => [coupon.id, coupon]));
    return Result.ok(
      usable.flatMap((grant) => {
        const coupon = byId.get(grant.couponId);
        return coupon === undefined ? [] : [{ grant, coupon }];
      }),
    );
  }

  /** What the sheet's discount menu offers — empty while loading, on failure, or for nobody. */
  readonly grants = computed<readonly VisitEditorGrantOption[]>(() => {
    const result = this.grantsResult();
    if (result === undefined || !result.ok) return [];
    const zone = this.shopZone();
    return result.value.map(({ grant, coupon }) => ({
      grantId: grant.id,
      couponId: coupon.id,
      label: coupon.name,
      value: discountValueOf(grant),
      exclusive: Combinability.isExclusive(coupon.combinability),
      // The coupon's moment (revision 3 §4.6): the client card heads a
      // birthday gift with its band only when the coupon says so — a
      // grant that reaches it without one is a plain ticket, every day.
      occasion:
        coupon.couponOccasion === CouponOccasion.Birthday ? 'birthday' : null,
      // When it lapses, on the shop's calendar: the card's tickets print
      // it as their chip («до 28.10») and put the soonest first; a grant
      // that never lapses prints none (review 2: every ticket was chipless).
      expiresOn: grantExpiresOn(grant, zone),
    }));
  });

  /**
   * THE SHOP'S LIVE CODES, read once for the day (owner, 2026-09-16: "you
   * are the staff — you know the valid promo codes; list them"): what the
   * sheet's «Промо код» kind offers as rows, so nobody types a code the
   * shop published. A failed read is an empty list — the voucher field
   * still takes a typed code, and the save re-resolves on the server.
   */
  private readonly promosResult = toSignal(
    from(this.couponsVouchers.listOpenCoupons()),
    { initialValue: undefined },
  );

  readonly promos = computed<readonly VisitEditorPromoOption[]>(() => {
    const result = this.promosResult();
    if (result === undefined || !result.ok) return [];
    return (
      result.value
        .flatMap((coupon) =>
          coupon.code === null
            ? []
            : [
                {
                  code: coupon.code,
                  couponId: coupon.id,
                  label: coupon.name,
                  value: discountValueOf(coupon),
                  exclusive: Combinability.isExclusive(coupon.combinability),
                },
              ],
        )
        // By name, the way a barber says them — not by the store's own ids.
        .sort((a, b) => a.label.localeCompare(b.label, 'bg'))
    );
  });

  /**
   * A promo code typed at the counter → the enabled coupon it opens, or
   * `null` for no such code. A failed read is `null` too: at the chair,
   * "could not check" and "no such code" call for the same next move —
   * try again — and the save re-resolves the code on the server regardless.
   * A typed code that is not a code's shape opens nothing.
   */
  async resolveCode(code: string): Promise<Coupon | null> {
    const typed = VoucherCode.parseTyped(code);
    if (!typed.ok) return null;
    const result = await this.couponsVouchers.findCouponByCode(typed.value);
    return result.ok ? result.value : null;
  }

  /**
   * The other thing a typed code can be: a gift voucher, WHATEVER its state
   * — the sheet says why an empty or a void one will not take, which "no
   * such code" cannot (`VoucherSystem.refusal`, at the store's clock).
   */
  async resolveVoucher(code: string): Promise<{
    readonly voucher: GiftVoucher;
    readonly refusal: 'void' | 'expired' | 'empty' | null;
  } | null> {
    const typed = VoucherCode.parseTyped(code);
    if (!typed.ok) return null;
    const result = await this.couponsVouchers.findGiftVoucherByCode(
      typed.value,
    );
    if (!result.ok || result.value === null) return null;
    const refusal = VoucherSystem.refusal(result.value, this.nowUtcMs());
    return {
      voucher: result.value,
      refusal: refusal === null ? null : VOUCHER_REFUSAL_WORD[refusal],
    };
  }

  /** The last note write that failed, by appointment — the sheet says so. */
  private readonly _noteError = signal<string | null>(null);
  readonly noteError = this._noteError.asReadonly();

  /**
   * Writes straight through; an empty text deletes. The note's author and
   * instant are stamped here, from the store's session and clock.
   */
  async saveTeamNote(
    appointmentId: string,
    text: string | null,
  ): Promise<boolean> {
    const id = AppointmentId.of(appointmentId);
    const trimmed = text?.trim() ?? '';
    const note: AppointmentNote | null =
      trimmed.length === 0
        ? null
        : {
            id,
            text: trimmed,
            authorUserId: this.currentUserId(),
            writtenAtUtcMs: this.nowUtcMs(),
          };
    const result = await this.notes.saveAppointmentNote(id, note);
    this._noteError.set(result.ok ? null : appointmentId);
    return result.ok;
  }

  private readonly _probeDay = signal<string | null>(null);

  /** Keep `dayKey` live while nothing on screen shows it. `null` releases it. */
  probeDay(dayKey: string | null): void {
    const valid =
      dayKey !== null && /^\d{4}-\d{2}-\d{2}$/.test(dayKey) ? dayKey : null;
    if (valid === this._probeDay()) return;
    this._probeDay.set(valid);
  }

  /**
   * Every day with a live listener — what is on screen, plus the probe.
   *
   * `dayCells` and `geometryResult` both pair against THIS list, in this
   * order, which is what keeps the index arithmetic honest when a probe is
   * appended.
   */
  private readonly subscribedDays = computed<readonly string[]>(() => {
    const visible = this.visibleDays();
    const probe = this._probeDay();
    return probe === null || visible.includes(probe)
      ? visible
      : [...visible, probe];
  });

  private readonly laneInputs = computed(() => ({
    dayKey: this._dayKey(),
    days: this.subscribedDays(),
    barbers: this.scopedBarbers().map((barber) => barber.id),
  }));

  /** The appointments of one chair on one shop day — `busyKeys array-contains`. */
  private barberDay(
    barberId: BarberId,
    dayKey: string,
  ): Observable<Result<readonly Appointment[], RepositoryError>> {
    const day = localDateOf(dayKey);
    return day === null
      ? of(Result.ok([]))
      : this.appointments.observeBarberDay(BusyKey.of(barberId, day));
  }

  /**
   * Appointments for every (day, barber) on screen, flattened in that order
   * so the index arithmetic below is the only place the pairing lives.
   */
  /**
   * …KEYED to the inputs they answer (2026-09-23): `switchMap` keeps the
   * previous answer in the signal until the new day's first emission, so a
   * reader who has just jumped is looking at yesterday's lanes under
   * today's key for a moment. `settled` below is how the calendar tells
   * the two apart before it reveals its working day.
   */
  private readonly lanesResult = toSignal(
    toObservable(this.laneInputs).pipe(
      switchMap(({ days, barbers }) =>
        (barbers.length === 0
          ? of([])
          : combineLatest(
              days.flatMap((dayKey) =>
                barbers.map((barberId) => this.barberDay(barberId, dayKey)),
              ),
            )
        ).pipe(map((lanes) => ({ key: laneKeyOf(days, barbers), lanes }))),
      ),
    ),
    { initialValue: undefined },
  );

  /**
   * The RAW GEOMETRY of every visible day — each scoped chair's schedule,
   * and per (day, chair) its busy projection and its exception — the same
   * public streams `/book` reads, deliberately so: the shop must not be
   * shown a hole the public grid would refuse to sell. PII-free by
   * construction, which is why it can answer "what can I sell" without
   * touching the appointment documents the lanes already carry. What it
   * MEANS (windows, blocks, padded busy) is derived in `dayGeometry`, never
   * behind a port (F1-10).
   */
  private readonly geometryResult = toSignal(
    toObservable(this.laneInputs).pipe(
      switchMap(({ days, barbers }) => {
        const key = laneKeyOf(days, barbers);
        if (barbers.length === 0) {
          return of({ key, schedules: [], days: undefined });
        }
        const schedules = combineLatest(
          barbers.map((barberId) => this.scheduling.observeSchedule(barberId)),
        );
        const perDay = combineLatest(
          days.map((dayKey) => {
            const day = localDateOf(dayKey);
            if (day === null) return of(null);
            return combineLatest(
              barbers.map((barberId) => {
                const busyKey = BusyKey.of(barberId, day);
                return combineLatest([
                  this.scheduling.observeBusyDay(busyKey),
                  this.scheduling.observeExceptions(busyKey),
                ]);
              }),
            );
          }),
        );
        return combineLatest([schedules, perDay]).pipe(
          map(([schedules, perDayAnswers]) => ({
            key,
            schedules,
            days: perDayAnswers,
          })),
        );
      }),
    ),
    { initialValue: undefined },
  );

  readonly loading = computed(() => this.lanesResult() === undefined);

  /**
   * Do the lanes and the geometry on hand answer the days and chairs on
   * screen? `false` for the moment between a change of day and the
   * repository's first word on it, while the previous answer still shows.
   */
  readonly settled = computed(() => {
    const { days, barbers } = this.laneInputs();
    const key = laneKeyOf(days, barbers);
    return (
      this.lanesResult()?.key === key &&
      this.geometryResult()?.key === key &&
      // The shops' hours clamp every window: a roster read before them
      // would draw the day unclamped, so the day is not yet answered.
      this.catalog.locationsKnown()
    );
  });

  /**
   * Every visible day, each with one lane per scoped chair.
   *
   * The flat `lanesResult` is re-paired here and NOWHERE else — day-major,
   * barber-minor, matching the order it was subscribed in.
   */
  /**
   * THE ROW FOLD — every visible day's lanes with their HOLES, and no clock
   * (blueprint hot path #3): it re-runs when the data changes, never on the
   * minute tick. `dayCells` splits the holes at now.
   */
  private readonly dayGeometry = computed<readonly DayGeometryCell[]>(() => {
    const results = this.lanesResult()?.lanes;
    const barbers = this.scopedBarbers();
    // ⚠ `subscribedDays`, not `visibleDays` — the list the results were
    // FETCHED against. Pairing against the shorter one would drop the probe's
    // cell and, worse, would still be index-correct for every visible day, so
    // the bug would only ever show on the day nobody is looking at.
    const days = this.subscribedDays();
    if (!results) return [];

    const geometry = this.geometryResult();
    const schedules = geometry?.schedules ?? [];
    const locations = this.catalog.locations();
    const zone = this.shopZone();

    return days.map((dayKey, dayIndex) => {
      const localDate = localDateOf(dayKey);
      const answers = geometry?.days?.[dayIndex] ?? null;
      // One chair's read failing is the whole day's geometry failing:
      // quietly dropping one would render a grid that looks complete while
      // hiding someone's free time.
      const dayFailed =
        answers === null ||
        schedules.length !== barbers.length ||
        schedules.some((result) => !result.ok) ||
        answers.some(([busy, exception]) => !busy.ok || !exception.ok);

      const lanes = barbers.map((barber, barberIndex) => {
        const result = results[dayIndex * barbers.length + barberIndex];
        const appointments = result?.ok ? result.value : [];
        const answer = answers?.[barberIndex];
        const schedule = schedules[barberIndex];
        const geo =
          localDate === null ||
          dayFailed ||
          answer === undefined ||
          schedule === undefined
            ? NO_GEOMETRY
            : laneGeometryOf(
                barber.id,
                localDate,
                schedule.ok ? schedule.value : null,
                answer[0].ok ? answer[0].value : null,
                answer[1].ok ? answer[1].value : null,
                locations,
              );
        // The lane's shop day: its windows and busy spans in its minutes.
        const day = localDate === null ? null : laneDayOf(localDate, zone);

        return {
          barberId: barber.id as string,
          appointments,
          rostered: day === null ? [] : intervalsOn(day, geo.rostered),
          blocks: day === null ? [] : intervalsOn(day, geo.blocks),
          day,
          holes:
            day === null
              ? []
              : GridLayoutSystem.holes(
                  geo.rostered,
                  occupiedOn(day, appointments, barber.id, geo.busy),
                ),
          failed: result !== undefined && !result.ok,
        };
      });

      return { dayKey, lanes };
    });
  });

  /**
   * Every visible day, each with one lane per scoped chair.
   *
   * The flat `lanesResult` is re-paired in `dayGeometry` and NOWHERE else —
   * day-major, barber-minor, matching the order it was subscribed in. The
   * minute tick reaches only the split at now (`GridLayoutSystem.sellableAt`).
   */
  readonly dayCells = computed<readonly StaffDayCell[]>(() => {
    const nowMs = this._nowMs();
    const now = shopNowOf(nowMs, this.shopZone());
    return this.dayGeometry().map((cell) => ({
      dayKey: cell.dayKey,
      lanes: cell.lanes.map(({ holes, day, ...lane }) => ({
        ...lane,
        gaps:
          day === null
            ? []
            : gapsOn(
                day,
                GridLayoutSystem.sellableAt(holes, now, day.localDate),
                cutOf(day, now, nowMs),
              ),
      })),
    }));
  });

  /** One subscribed day's cell, anchor or probe — `null` when it is neither. */
  cellFor(dayKey: string): StaffDayCell | null {
    return this.dayCells().find((cell) => cell.dayKey === dayKey) ?? null;
  }

  /** The anchor day's lanes — what the single-day views draw. */
  readonly lanes = computed<readonly BarberDayLane[]>(() => {
    const cells = this.dayCells();
    const anchor = this._dayKey();
    return cells.find((cell) => cell.dayKey === anchor)?.lanes ?? [];
  });

  /**
   * Lanes worth drawing: rostered today, OR holding bookings anyway.
   *
   * The second arm is not defensive padding. `catalog.barbers()` resolves
   * through `listActiveBarbers`, so a barber deactivated mid-month takes the
   * rest of their booked clients off the sheet while `barberBusy` still holds
   * the slots and those clients still walk through the door.
   */
  readonly workingLanes = computed(() =>
    this.lanes().filter(
      (lane) => lane.rostered.length > 0 || lane.appointments.length > 0,
    ),
  );

  /** Rostered nowhere today — named under the run, never drawn as a column. */
  readonly offToday = computed(() =>
    this.lanes()
      .filter(
        (lane) => lane.rostered.length === 0 && lane.appointments.length === 0,
      )
      .map((lane) => lane.barberId),
  );

  // ── The pen ────────────────────────────────────────────────────────

  /**
   * The appointments whose transition round-trips are in flight — a SET.
   *
   * It was one id, and the template disabled every button in the shop while
   * it was held. On a Saturday that means a receptionist marking one arrival
   * freezes four other chairs for the length of a callable round trip, and a
   * barber whose tap does nothing taps again. Concurrency is the operating
   * mode of a shop with four phones over one book; the only write that must
   * not overlap is a second one on the SAME appointment.
   */
  private readonly _pending = signal<ReadonlySet<string>>(new Set());
  readonly pending = this._pending.asReadonly();

  isPending(appointmentId: string): boolean {
    return this._pending().has(appointmentId);
  }

  /**
   * The last refusal, KEYED BY APPOINTMENT — it renders in the row that
   * earned it, never as a page banner three screens away from the tap.
   */
  private readonly _errors = signal<ReadonlyMap<string, BookingGatewayError>>(
    new Map(),
  );
  readonly errors = this._errors.asReadonly();

  errorFor(appointmentId: string): BookingGatewayError | null {
    return this._errors().get(appointmentId) ?? null;
  }

  // ── Search ──────────────────────────────────────────────────────────

  private readonly _searching = signal(false);
  readonly searching = this._searching.asReadonly();

  private readonly _searchLoading = signal(false);
  readonly searchLoading = this._searchLoading.asReadonly();

  private readonly _term = signal('');
  readonly term = this._term.asReadonly();

  /**
   * The window the search matches against, loaded ONCE when search opens.
   *
   * Not live and not re-fetched per keystroke: the shop's book does not
   * change between two letters, and a listener held open for as long as a
   * field has text in it is a second subscription over the whole collection.
   */
  private readonly _pool = signal<readonly Appointment[]>([]);
  readonly pool = this._pool.asReadonly();

  async openSearch(): Promise<void> {
    this._searching.set(true);
    if (this._pool().length > 0) return;
    await this.reloadSearchPool();
  }

  closeSearch(): void {
    this._searching.set(false);
    this._term.set('');
  }

  setTerm(term: string): void {
    this._term.set(term);
  }

  /** The window as last read — the add-client page's «Скорошни» read it too. */
  readonly window = this._pool.asReadonly();

  /** The window, read once if nobody has yet — the add-client page's way in. */
  async ensureWindow(): Promise<void> {
    if (this._pool().length === 0) await this.reloadSearchPool();
  }

  /**
   * Re-read the window — after a write, or when search is reopened stale:
   * the `SEARCH_WINDOW_PER_SIDE` visits each side of now, by their start
   * instant (`searchAppointmentWindow`, the range `utcEpochMs` is for).
   */
  async reloadSearchPool(): Promise<void> {
    const now = this.clock.now(untracked(() => this.shopZone()));
    if (now.isFailure()) return;
    this._searchLoading.set(true);
    try {
      const result = await this.appointments.searchAppointmentWindow(
        utcMsOf(now.value.toMillis()),
        SEARCH_WINDOW_PER_SIDE,
      );
      if (result.ok) this._pool.set(result.value);
    } finally {
      this._searchLoading.set(false);
    }
  }

  // ── The roster pen ──────────────────────────────────────────────────

  private readonly _absencePending = signal(false);
  readonly absencePending = this._absencePending.asReadonly();

  private readonly _absenceError = signal<string | null>(null);
  readonly absenceError = this._absenceError.asReadonly();

  /**
   * Stand a chair down for the day, or block a range inside it.
   *
   * `ranges` empty means the whole day; otherwise the given spans are carved
   * out of an otherwise ordinary roster. Either way what reaches Firestore is
   * the sanitized public EFFECT (`ExceptionEffectRule` — `CLOSED` or
   * `BLOCKED`); a reason has no field to ride in.
   */
  async blockTime(
    barberId: string,
    locationId: string,
    ranges: readonly MinuteRange[],
    // THE DAY IS A PARAMETER (2026-09-09): the block sheet steps its frame
    // off the shown day, and a series is written day by day. Defaults to
    // the day on screen, which is what every earlier caller meant.
    dayKey: string = this._dayKey(),
  ): Promise<boolean> {
    if (this._absencePending()) return false;
    if (localDateOf(dayKey) === null || !barberId || !locationId) {
      this._absenceError.set('invalid');
      return false;
    }
    // A RANGE ACCUMULATES; a whole day REPLACES (2026-09-08). One document
    // per barber-day made a second lunch overwrite the first; the merge
    // reads the day inside the write and adds to it instead.
    return this.writeBlocks(barberId, locationId, ranges, [dayKey]);
  }

  /**
   * A SERIES — the same block on many days of one chair, as ONE write
   * (2026-09-24): every day is read and merged inside one transaction,
   * where a day-by-day `blockTime` loop was two round trips a day — a year
   * of lunches, a minute of spinner. `ranges` empty stands each day down
   * whole. Same pending and error signals as `blockTime`: from the sheet's
   * side it is the same act.
   */
  async blockSeries(
    barberId: string,
    locationId: string,
    ranges: readonly MinuteRange[],
    dayKeys: readonly string[],
  ): Promise<boolean> {
    if (this._absencePending()) return false;
    if (dayKeys.some((dayKey) => localDateOf(dayKey) === null)) {
      this._absenceError.set('failed');
      return false;
    }
    return this.writeBlocks(barberId, locationId, ranges, dayKeys);
  }

  /**
   * The one exception write behind `blockTime` and `blockSeries`: per day,
   * a whole-day stand-down REPLACES what the day held (`CLOSED`), and a
   * range MERGES into its stored blocks (`ScheduleExceptionSystem.addRanges`
   * — a day already off whole stays off, never demoted to a partial block).
   */
  private async writeBlocks(
    barberId: string,
    locationId: string,
    ranges: readonly MinuteRange[],
    dayKeys: readonly string[],
  ): Promise<boolean> {
    const barber = BarberId.of(barberId);
    const days = dayKeys.flatMap((dayKey) => {
      const day = localDateOf(dayKey);
      return day === null ? [] : [day];
    });
    // The exception's day instant is read in ITS shop's zone (Law 7.2).
    const zone =
      untracked(() => this.catalog.locations()).find(
        (shop) => shop.id === locationId,
      )?.timeZone ?? untracked(() => this.shopZone());
    this._absencePending.set(true);
    this._absenceError.set(null);
    try {
      const result = await this.exceptions.writeScheduleException(
        days.map((day) => BusyKey.of(barber, day)),
        (stored) => {
          const next: (ScheduleException | null)[] = [];
          for (const [index, day] of days.entries()) {
            const existing = stored[index] ?? null;
            const effect: Result<ExceptionEffectRule, SchedulingError> | null =
              ranges.length === 0
                ? Result.ok(ExceptionEffectRule.closed())
                : ScheduleExceptionSystem.addRanges(existing, ranges);
            if (effect === null) {
              // A whole day off already covers every minute asked for.
              next.push(existing);
              continue;
            }
            if (!effect.ok) return effect;
            next.push({
              ...exceptionMetaOf(barber, day, locationId, zone),
              ...effect.value,
            });
          }
          return Result.ok(next);
        },
      );
      if (!result.ok) {
        this._absenceError.set('failed');
        return false;
      }
      return true;
    } finally {
      this._absencePending.set(false);
    }
  }

  /**
   * Lift ONE block when a range is given, or the whole day when it is not —
   * the day-wide form is the armed, destructive path the sheet names as such.
   * A day off WHOLE has no ranges to lift one from: the range form refuses
   * it, and the day-wide clear is the honest path.
   */
  async clearBlock(
    barberId: string,
    range: MinuteRange | null = null,
    dayKey: string = this._dayKey(),
  ): Promise<boolean> {
    if (this._absencePending()) return false;
    const day = localDateOf(dayKey);
    if (day === null) {
      this._absenceError.set('failed');
      return false;
    }
    this._absencePending.set(true);
    this._absenceError.set(null);
    try {
      const result = await this.exceptions.writeScheduleException(
        [BusyKey.of(BarberId.of(barberId), day)],
        (stored) => {
          const existing = stored[0] ?? null;
          if (range === null || existing === null) {
            return Result.ok([null]);
          }
          if (existing.exceptionEffect === ExceptionEffect.Closed) {
            return Result.err(
              SchedulingError.scheduleExceptionEmptyRanges(
                ExceptionEffect.Closed,
              ),
            );
          }
          const left = ScheduleExceptionSystem.withoutRange(
            existing.exceptionRanges,
            range,
          );
          if (left.length === 0) return Result.ok([null]);
          const effect =
            existing.exceptionEffect === ExceptionEffect.Hours
              ? ExceptionEffectRule.hours(left)
              : ExceptionEffectRule.blocked(left);
          if (!effect.ok) return effect;
          return Result.ok([{ ...metaOfStored(existing), ...effect.value }]);
        },
      );
      if (!result.ok) {
        this._absenceError.set('failed');
        return false;
      }
      return true;
    } finally {
      this._absencePending.set(false);
    }
  }

  /**
   * Stamp the arrival. Same in-flight and error handling as a transition,
   * because from the row's point of view it is the same kind of act — a
   * server write it must not pretend succeeded.
   */
  /* ── Creating a booking from the desk ─────────────────────────── */

  private readonly _creating = signal(false);
  readonly creating = this._creating.asReadonly();
  private readonly _createError = signal<BookingGatewayError | null>(null);
  readonly createError = this._createError.asReadonly();

  /**
   * The shop placing its own book — `commitBooking` with `onBehalfOfUserId`
   * set (a client's id, or `null` for a walk-in). The lane's live listener
   * draws the new visit; nothing is written locally.
   */
  async createBooking(request: CommitBookingRequest): Promise<boolean> {
    if (this._creating()) return false;
    this._creating.set(true);
    this._createError.set(null);
    try {
      const result = await this.gateway.commit(request);
      if (result.isFailure()) {
        this._createError.set(result.error);
        return false;
      }
      return true;
    } finally {
      this._creating.set(false);
    }
  }

  async markArrived(appointmentId: string): Promise<boolean> {
    const id = appointmentId;
    if (this._pending().has(id)) return false;

    this._pending.update((set) => new Set(set).add(id));
    this._errors.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });

    try {
      const result = await this.gateway.markArrived(id);
      if (result.isFailure()) {
        this._errors.update((map) => new Map(map).set(id, result.error));
        return false;
      }
      return true;
    } finally {
      this._pending.update((set) => {
        const next = new Set(set);
        next.delete(id);
        return next;
      });
    }
  }

  /** The stamp taken back — the undo behind `markArrived`, same discipline. */
  async clearArrival(appointmentId: string): Promise<boolean> {
    const id = appointmentId;
    if (this._pending().has(id)) return false;

    this._pending.update((set) => new Set(set).add(id));
    this._errors.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });

    try {
      const result = await this.gateway.clearArrival(id);
      if (result.isFailure()) {
        this._errors.update((map) => new Map(map).set(id, result.error));
        return false;
      }
      return true;
    } finally {
      this._pending.update((set) => {
        const next = new Set(set);
        next.delete(id);
        return next;
      });
    }
  }

  /**
   * Move, resize, re-price, re-time or re-chair the visit.
   *
   * Same shape as `transition` and `markArrived`, and same discipline: NO
   * optimistic mutation. The live listener is what redraws the lane, so the
   * block moves when the server says it moved and never before — which is the
   * only version of this that cannot show a barber a booking at a time it is
   * not at. The refusals matter more here than anywhere else on this surface:
   * `slot_unavailable` carrying `serverCode: 'booking.staffEdit.overlaps'` is
   * an OFFER (re-send with `acknowledgedOverlap`), and it is the row's error
   * signal that carries it, so the offer renders in the visit that earned it
   * rather than as a banner three screens away.
   *
   * ### Every send goes out NAMED (2026-09-25)
   * Each intent — a save, an undo, a queued drop — carries an `operationId`
   * minted here, the one funnel every staff edit passes through, and the
   * SAME intent sent again after a failure carries the same one — whatever
   * landed in between (see `unsettledOperations`). The server remembers the
   * names it applied, so a
   * save whose answer was lost in transit and is tapped again lands ONCE,
   * with one audit row, instead of twice. A caller that names its own
   * intent keeps its name.
   *
   * ### Every send states the revision it was made on (round 5)
   * `expectedVersion` is REQUIRED here (`StaffIntent`): the revision of the
   * copy the sheet's draft was drawn from. A colleague's save since is
   * refused by the server as `booking.staffEdit.stale`, and the sheet then
   * reloads the visit and says so, instead of overwriting it with an older
   * screen. This device's OWN landed intents are not someone else's change:
   * the claim is rebased across them before it goes (`claimFor`), so a
   * queued drop, a second save from the same sheet and a save's undo are
   * never refused by the save before them. A re-send under the same name is
   * still answered from the server's ledger ahead of the stale check.
   */
  async staffEdit(intent: StaffIntent): Promise<boolean> {
    const id = intent.appointmentId;

    /*
     * ⚠ A SECOND EDIT SUPERSEDES THE FIRST — IT IS NOT DISCARDED.
     * (fixed 2026-09-04)
     *
     * This used to `return false` while a write for the same appointment was
     * in flight, and nothing anywhere told the user: the block stayed where
     * it was dropped, because the grid's own draft had already moved it, and
     * the edit simply never reached the server. It came back on the next
     * store tick. Measured: five drops in quick succession produced ONE
     * write and four silent losses; the same five spaced 600ms apart all
     * landed. That is exactly "sometimes the drop does not stick", and it is
     * timing-dependent, which is why it looked random.
     *
     * The guard itself is right — two concurrent writes to one aggregate
     * would race, and the second would carry a version the first has already
     * moved past. What was wrong is throwing the newer intent away. A drag
     * is a stream of positions whose LAST one is the answer, so the newest
     * request replaces any queued one and goes the moment the wire is free.
     * Intermediate drops are still dropped, which is the point; the final
     * one no longer is.
     */
    if (this._pending().has(id)) {
      this.queuedEdits.set(id, intent);
      return true;
    }

    this._pending.update((set) => new Set(set).add(id));
    this._errors.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });

    const request: StaffIntent = {
      ...intent,
      expectedVersion: this.claimFor(id, intent.expectedVersion),
    };
    const key = intentOf(request);
    const operationId = this.operationIdFor(request, key);
    try {
      const result = await this.gateway.staffEdit({ ...request, operationId });
      if (result.isFailure()) {
        // Refused, or LOST — the two look the same from here, so the same
        // intent sent again goes under the same name.
        this.rememberUnsettled(id, key, operationId);
        this._errors.update((map) => new Map(map).set(id, result.error));
        return false;
      }
      this.settle(id, key);
      this.recordLanded(id, request.expectedVersion, result.value.revision);
      return true;
    } finally {
      this._pending.update((set) => {
        const next = new Set(set);
        next.delete(id);
        return next;
      });
      // Whatever arrived while this was in flight, sent now — including
      // after a FAILURE, because the queued position is still what the user
      // last asked for and re-sending it is their best chance of it landing.
      const next = this.queuedEdits.get(id);
      if (next !== undefined) {
        this.queuedEdits.delete(id);
        void this.staffEdit(next);
      }
    }
  }

  /**
   * The newest edit per appointment that arrived while one was in flight.
   *
   * At most ONE per id: a drag produces a stream of positions and only the
   * last is meaningful, so a newer request overwrites the queued one rather
   * than joining a line of stale ones behind it.
   */
  private readonly queuedEdits = new Map<string, StaffIntent>();

  /**
   * THIS DEVICE'S OWN LANDED INTENTS, per visit: the revision each was made
   * on → the revision it stamped. At most `LANDED_PER_VISIT`, oldest
   * dropped.
   */
  private readonly landed = new Map<string, readonly LandedRevision[]>();

  /**
   * The claim an intent goes out with: the revision it was made on, carried
   * forward across every intent of THIS device that landed on it since.
   *
   * A sheet's draft is drawn once, at open; the save it sends lands at the
   * next revision, and the undo of that save — or a second save, or a drop
   * queued behind the first — was made on the same screen. Claiming the
   * drawn revision would have the server refuse them as stale against the
   * device's own write. Only a revision somebody ELSE stamped is left
   * unexplained, and that is exactly the save that must not be
   * overwritten. `null` claims nothing and stays so.
   */
  private claimFor(appointmentId: string, drawn: number | null): number | null {
    return StaffIntentSystem.claimFor(
      this.landed.get(appointmentId) ?? [],
      drawn,
    );
  }

  /** An intent of this device landed: `from` → `to`, kept for `claimFor`. */
  private recordLanded(
    appointmentId: string,
    from: number | null,
    to: number,
  ): void {
    // A claim of nothing, or a stamp that does not climb, is not recorded
    // (`StaffIntentSystem.recordLanded` hands the chain back unchanged).
    const chain = this.landed.get(appointmentId) ?? [];
    const next = StaffIntentSystem.recordLanded(chain, from, to);
    if (next !== chain) this.landed.set(appointmentId, next);
  }

  /**
   * THE INTENTS THAT DID NOT LAND, per appointment — each keyed by the
   * intent itself (`intentOf`), with the name it went out under.
   *
   * A failed send was either refused or lost after the server committed it,
   * and nothing here can tell which. So a later send of the SAME intent —
   * the barber tapping «Запази» again on the same draft — reuses the name,
   * and the server answers a lost one with what it already committed rather
   * than applying it twice (a refused one it simply applies, having never
   * seen the name).
   *
   * KEYED BY INTENT, NOT BY VISIT (round 3, 2026-09-25). It held one entry
   * per appointment, cleared by any success: an intent that failed — lost,
   * but committed — and was then superseded by a queued drop that landed
   * lost its name, and sending the same batch again applied it twice. Now
   * an intent's name is dropped only when THAT intent lands: the same batch
   * again after its own success is the barber doing it again (a move, its
   * undo, the move once more), and reusing the name would answer "saved"
   * while applying nothing. Everything else — a changed draft, an
   * acknowledged overlap — is a new intent with a new name.
   *
   * The ruling's price, stated: a failed intent re-sent after a DIFFERENT
   * one landed is answered from the ledger when it had in fact committed,
   * so the visit stays where the later intent put it — which the live lane
   * shows, since nothing here moves a block before the server does. Never
   * applied twice is the promise; the lane is the receipt.
   *
   * AT MOST `AppliedOperations.CAP` (`StaffIntentSystem.UNSETTLED_PER_VISIT`)
   * FAILED NAMES PER VISIT, oldest dropped.
   * That bounds this map and promises nothing about the server's ledger,
   * which keeps the last CAP intents APPLIED to the visit, from any device:
   * once CAP other intents have landed since a name was kept, the server no
   * longer knows it, and a re-send under it is applied as new. (Round 4,
   * 2026-09-25: this used to promise "never a name kept longer than the
   * server's ledger remembers it". No client can keep that promise, since
   * it never sees other devices' intents, so no pruning here could make it
   * true.) What stops such a re-send from doubling anything is the batch
   * itself: an `addSeat` names the seat id minted here and is refused the
   * second time, a `removeSeat` of a seat already gone is refused, and
   * every other arm states a target (a start, an end, a price, a chair, the
   * bill's whole set), so applying it again writes the visit it already
   * wrote, over whatever landed since, as an unnamed re-send always did. A
   * sheet also sends `expectedVersion` (round 5), so a colleague's save in
   * between is refused as stale rather than written over.
   */
  private readonly unsettledOperations = new Map<
    string,
    readonly UnsettledName[]
  >();

  /** The name this send goes out under — see `unsettledOperations`. */
  private operationIdFor(
    request: StaffEditAppointmentRequest,
    intent: string,
  ): string {
    if (request.operationId !== undefined) return request.operationId;
    return (
      StaffIntentSystem.operationIdFor(
        this.unsettledOperations.get(request.appointmentId) ?? [],
        intent,
      ) ?? this.ids.next()
    );
  }

  /** A send that failed: its name kept under its intent, newest last. */
  private rememberUnsettled(
    appointmentId: string,
    intent: string,
    operationId: string,
  ): void {
    this.unsettledOperations.set(
      appointmentId,
      StaffIntentSystem.rememberUnsettled(
        this.unsettledOperations.get(appointmentId) ?? [],
        intent,
        OperationId.of(operationId),
      ),
    );
  }

  /** A send that landed: THAT intent is settled; every other keeps its name. */
  private settle(appointmentId: string, intent: string): void {
    const intents = this.unsettledOperations.get(appointmentId);
    if (intents === undefined) return;
    const left = StaffIntentSystem.settle(intents, intent);
    if (left.length === 0) this.unsettledOperations.delete(appointmentId);
    else this.unsettledOperations.set(appointmentId, left);
  }

  /**
   * Record — or clear — what one seat was tipped.
   *
   * No pending guard and no coalescing: a tip is entered once, by hand, on a
   * visit that is already over. There is no stream of positions to collapse
   * and nothing racing it, so the request goes straight out and the error,
   * if any, lands on the row like every other write's.
   */
  async recordTip(request: RecordSeatTipRequest): Promise<boolean> {
    const id = request.appointmentId;
    this._errors.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });
    const result = await this.gateway.recordTip(request);
    if (result.isFailure()) {
      this._errors.update((map) => new Map(map).set(id, result.error));
      return false;
    }
    return true;
  }

  /** `true` on success — the caller closes whatever asked for the reason. */
  async transition(request: TransitionAppointmentRequest): Promise<boolean> {
    const id = request.appointmentId;
    if (this._pending().has(id)) return false;

    this._pending.update((set) => new Set(set).add(id));
    this._errors.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });

    try {
      const result = await this.gateway.transition(request);
      if (result.isFailure()) {
        this._errors.update((map) => new Map(map).set(id, result.error));
        return false;
      }
      return true;
    } finally {
      this._pending.update((set) => {
        const next = new Set(set);
        next.delete(id);
        return next;
      });
    }
  }
}
