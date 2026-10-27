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
  type AppointmentId,
  BarberId,
  BusyKey,
  ClientOperationId,
  type CouponGrantId,
  type CustomerId,
  LocalDate,
  type LocationId,
  OperationId,
  Result,
  Tag,
  type TimeZone,
  type UserId,
  type UtcEpochMs,
  type VoucherRefusal,
} from '@core/primitives';
import {
  CatalogError,
  PipelineError,
  PipelineErrorCode,
  type RepositoryError,
  type StaffBlockFailure,
  StaffEditErrorCode,
} from '@core/errors';
import {
  type BookingCall,
  Combinability,
  CouponValue,
  type MinuteRange,
  Principal,
  type ShopNow,
  type VisitEditWrite,
  VisitEditWriteOutcome,
  VoucherCode,
} from '@core/components';
import { type BarberDayRead, Callables } from '@core/ports';
import type {
  Appointment,
  AppointmentPhoto,
  BarberBusyDay,
  BarberSchedule,
  Coupon,
  CouponGrant,
  GiftVoucher,
  ScheduleException,
  ShopLocation,
} from '@core/entities';
import {
  AvailabilitySystem,
  CouponGrantSystem,
  GridLayoutSystem,
  type HeldGrant,
  type LandedRevision,
  type LaneGap,
  RosterSystem,
  ShopZoneSystem,
  StaffIntentSystem,
  type UnsettledName,
  VisitSidesSystem,
  VoucherSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  adoptVisitPhoto,
  appendTeamNote as appendTeamNotePipeline,
  attachVisitPhoto,
  clearScheduleBlock,
  loadHeldGrants,
  saveTeamNote as saveTeamNotePipeline,
  type SaveVisitEditCommand,
  saveVisitEdit,
  type VisitPhotoSubject,
  writeScheduleBlocks,
} from '@core/pipelines';
import { downscaleImage } from '@creativo/infrastructure/storage';
import {
  APPOINTMENT_NOTE_PORTS,
  APPOINTMENT_PHOTO_PORTS,
  APPOINTMENT_READ_PORTS,
  AUTH_SESSION_PORTS,
  CLOCK_PORTS,
  COUPON_VOUCHER_PORTS,
  GATEWAY_PORTS,
  ID_PORTS,
  SCHEDULE_EXCEPTION_PORTS,
  SCHEDULING_READ_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import type {
  VisitEditorGrantOption,
  VisitEditorPromoOption,
} from './visit-editor/staff-visit-editor';
import { CatalogContentService } from '@creativo/features/shared/catalog';

/**
 * What makes two sends the SAME staff intent: the visit, the batch, and the
 * two claims beside it — an acknowledged overlap is a different decision
 * from an unacknowledged one, and a claim on another revision is a draft of
 * another visit. Serialised, because equality is the only question ever
 * asked of it. Read off the request AS SENT (the claim rebased — see
 * `StaffDayStore.claimFor`), so a re-send is recognised by what the wire
 * carried.
 */
function intentOf(request: BookingCall.StaffEditIntent): string {
  return StaffIntentSystem.intentBasis(
    request.appointmentId,
    request.commands,
    request.acknowledgedOverlap,
    request.expectedVersion,
  );
}

/**
 * The refusal a staff intent earns BEFORE it is sent — a field the wire
 * cannot carry (a minted name that is no `ClientOperationId`, a minute off
 * the shop's day): the server's own refusal of it, `field` named, said here
 * so the row reads what the server would have answered.
 */
export function invalidCommand(field: string): PipelineError {
  return PipelineError.of(
    PipelineErrorCode.InvalidRequest,
    StaffEditErrorCode.InvalidCommand,
    null,
    field,
  );
}

/**
 * How many appointments the search reads each side of now.
 *
 * A 3–5 chair shop books ~40 a day, so 300 reaches roughly a working week
 * back and a working week forward — past the horizon anyone searches by
 * name, and small enough to match in memory without a pause.
 */
const SEARCH_WINDOW_PER_SIDE = 300;

/**
 * The shop's day a held coupon lapses on, or `null` for one that never
 * does. Which grants lapse, and when, is the system's
 * (`CouponGrantSystem.expiresAtUtcMs` — an instant); the card prints a DAY
 * on the shop's calendar («до 28.10»), so the instant is read in the shop's
 * zone here, at the boundary — a grant lapsing at 00:30 Sofia is one more
 * day held here, not one less.
 */
function expiresOnIn(grant: CouponGrant, timeZone: TimeZone): LocalDate | null {
  const expiresAt = CouponGrantSystem.expiresAtUtcMs(grant);
  return expiresAt === null
    ? null
    : ZonedTimeSystem.toLocal(expiresAt, timeZone).localDate;
}

/**
 * The renderings the toolbar switches between — the field `view`.
 *
 * `AGENDA` is the complete run — visits and sellable gaps as one list. The
 * three calendar views are proportional time grids; they differ only in what
 * a COLUMN is, which is the whole reason `WEEK` needs a chair scope:
 *
 * - `DAY` — one column per chair. The counter's comparison view.
 * - `THREE_DAY` / `WEEK` — one column per DAY. Five chairs across seven days
 *   is thirty-five columns and unreadable, so these narrow to one chair by
 *   default and merge with attribution when the shop asks for all of them.
 *
 * Values: external contract — the `?view=` query value, the device's
 * stored `staff.schedule.view`, the page's `data-view` hook and the
 * `staff.day.view.<view>` i18n key segment all spell them so.
 */
export const StaffView = {
  Agenda: 'agenda',
  Day: 'day',
  ThreeDay: 'three-day',
  Week: 'week',
} as const;
export type StaffView = Tag<typeof StaffView>;

/** A view named in a URL or on the device, or `null` for anything else. */
export function parseView(raw: string | null | undefined): StaffView | null {
  return Tag.has(StaffView, raw) ? raw : null;
}

/**
 * Where the last view is kept on the device. `try/catch` on both sides:
 * storage is absent in a private window and throws in some embedded views,
 * and a schedule must open either way.
 */
const STORED_VIEW_KEY = 'staff.schedule.view';

function readStoredView(): StaffView {
  try {
    return Tag.or(
      StaffView,
      globalThis.localStorage?.getItem(STORED_VIEW_KEY),
      StaffView.Agenda,
    );
  } catch {
    return StaffView.Agenda;
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
  [StaffView.Agenda]: 1,
  [StaffView.Day]: 1,
  [StaffView.ThreeDay]: 3,
  [StaffView.Week]: 7,
};

/**
 * One visible day with a lane per chair in scope — the shop day itself
 * (`dayKey`), never a key that might name none: the days on screen are
 * walked from today with `LocalDate` arithmetic and the route's `?day=` is
 * parsed once at its edge (`StaffDayStore.applyRouteDay`).
 */
export interface StaffDayCell {
  readonly dayKey: LocalDate;
  readonly lanes: readonly BarberDayLane[];
}

/**
 * A day's lanes before the clock: each lane's holes, not yet split at now —
 * in its shop day's wall-clock minutes (Law 7.3).
 */
interface DayGeometryCell {
  readonly dayKey: LocalDate;
  readonly lanes: readonly (Omit<BarberDayLane, 'gaps'> & {
    readonly holes: readonly MinuteRange[];
  })[];
}

/** The same grant ids, in the same order — a sheet re-probing one visit reads nothing again. */
function sameIds(
  a: readonly CouponGrantId[],
  b: readonly CouponGrantId[],
): boolean {
  return a.length === b.length && a.every((id, index) => id === b.at(index));
}

/** One string for one subscription — the days and the chairs it answers. */
function laneKeyOf(
  days: readonly LocalDate[],
  barbers: readonly BarberId[],
): string {
  return `${days.join('|')}#${barbers.join('|')}`;
}

/**
 * A day named in a URL or by a sheet's probe, as the shop day it names —
 * `null` when absent or when it names no calendar day (`LocalDate.parse`,
 * the one edge where a foreign day becomes the brand).
 */
function dayOfRoute(raw: string | null): LocalDate | null {
  if (raw === null) return null;
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : null;
}

/**
 * What occupied the chair on one lane day, in that day's minutes. The
 * day's appointments are the visits (an `Appointment` IS an occupying
 * visit, Law 3); one on another shop day holds nothing here.
 *
 * ### Why not `barberBusy` alone
 * The projection keeps only `PENDING`/`CONFIRMED` (`rebuildBusy`) and TTLs
 * thirty days after the day it describes. That is exactly right for its
 * job — `/book` reads it anonymously and it must mean "what can I sell" —
 * and it makes it structurally unable to describe a past day: by close of
 * business every completed and no-showed visit has dropped out of it, so it
 * reports the whole rostered day free. The lane already holds every
 * appointment, untruncated and untimed-out, and `GridLayoutSystem`
 * rebuilds the SAME envelope the busy projection writes — the seat's slot
 * padded by its own setup and cleanup — so the two sources coincide
 * exactly wherever both exist. A CANCELLED appointment contributes
 * nothing; a no-show did occupy the chair. `blocks` are deliberately NOT
 * added: they were already subtracted from the windows upstream
 * (`RosterSystem.buildDayWindows`), and counting them again would turn
 * every lunch break into idleness.
 */
function occupiedOn(
  localDate: LocalDate,
  appointments: readonly Appointment[],
  barberId: BarberId,
  busy: readonly MinuteRange[],
): readonly MinuteRange[] {
  return GridLayoutSystem.occupiedIntervals(
    appointments.filter((appointment) => appointment.localDate === localDate),
    barberId,
    busy,
  );
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
 * - the windows are `RosterSystem.offeredWindows` — the version in force,
 *   the day's exception, each shop's published hours — kept only at a shop
 *   the day OFFERS (an active shop of the catalogue): a shop absent from the
 *   hours would otherwise read as "publishes no bound" and its chair reach
 *   the grid unclamped;
 * - the blocks are `RosterSystem.offeredCarveOuts`, the same inputs' second
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
  const input = {
    barberId,
    localDate,
    versions: schedule.versions,
    exceptions: exception === null ? [] : [exception],
    shopHours: RosterSystem.shopHoursOn(locations, localDate),
  };
  const rostered = RosterSystem.offeredWindows(input);
  if (rostered.length === 0) return NO_GEOMETRY;
  return {
    rostered,
    blocks: RosterSystem.offeredCarveOuts(input),
    busy: AvailabilitySystem.paddedBusy(barberId, busyDay, schedule, []),
  };
}

/**
 * One barber's chair for the chosen day, with its own failure flag and its
 * count of visits it could not read.
 *
 * `rostered` is what makes the run COMPLETE rather than sparse: without it a
 * barber on holiday and a barber with a wide-open Saturday both render as
 * "free day", which is the surface's oldest lie.
 */
export interface BarberDayLane {
  readonly barberId: BarberId;
  /** The day's visits on this chair, as stored — every status. */
  readonly appointments: readonly Appointment[];
  /**
   * The chair's working windows today, in the shop day's wall-clock
   * minutes as the roster states them (Law 7.3 — zero inbound mapping).
   * Empty means NOT ROSTERED.
   */
  readonly rostered: readonly MinuteRange[];
  /**
   * Time BLOCKED OUT of the worked day — a break, an admin hour.
   *
   * A separate channel from `rostered` on purpose. A block is the complement
   * of a window, and if it arrived only as that complement there would be no
   * way to tell "Ivan blocked this hour" from "Ivan is not rostered" from
   * "the shop is shut" — which is exactly what the calendar could not do, and
   * why time you blocked yourself came back as anonymous grey shading.
   * Wall-clock minutes, like `rostered`.
   */
  readonly blocks: readonly MinuteRange[];
  /**
   * EVERY hole inside those windows, already padded by turnaround — the
   * elapsed ones as well as the sellable ones, split at the shop's clock
   * and distinguished by `LaneGap.sellable` (`GridLayoutSystem.sellableAt`,
   * in the lane day's minutes).
   */
  readonly gaps: readonly LaneGap[];
  /**
   * The chair's day could not be read at all (OR-2) — a refused listen, or
   * a day whose every stored visit the read-time guard refused. Such a lane
   * holds NO gaps (a hole computed from a list that was never read would be
   * time sold twice) and is neither working nor off: the sheet says it
   * failed, on the day's all-day strip.
   */
  readonly failed: boolean;
  /**
   * How many of the day's stored visits the read-time guard dropped from
   * this chair's answer (`BarberDayRead.unreadableCount`, OR-2) — `0` on a
   * clean read and on a failed one. The sheet words it beside the chair, so
   * a visit nobody can see is never silent.
   */
  readonly unreadable: number;
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
  /** The one typed callable client — every write of the day goes through it. */
  private readonly gateway = inject(GATEWAY_PORTS);
  private readonly clock = inject(CLOCK_PORTS);
  /** Mints each act's `operationId` (WS-4.1) — see `staffEdit` and `mintFor`. */
  private readonly ids = inject(ID_PORTS);
  private readonly catalog = inject(CatalogContentService);
  private readonly shopZones = inject(ShopZoneService);
  /** The default location's zone — the day's clock until the catalogue names a shop (4A-11). */
  private readonly defaultZone = this.shopZones.defaultZone();
  /** That read failed (or found no default location) — see {@link retryZone}. */
  private readonly defaultZoneFailed = this.shopZones.defaultZoneFailed();
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /**
   * WHO IS AT THE BOOK — the session the stamps name: who wrote a team note,
   * who took a photo (`notes-photos.port.ts`: the caller fills them from its
   * own clock and session, never the adapter). `null` until the principal
   * is an onboarded one.
   */
  private readonly principal = toSignal(
    inject(AUTH_SESSION_PORTS).observePrincipal(),
    { initialValue: null },
  );

  /** The signed-in account, or `null` — what a stamp's `*ByUserId` names. */
  private currentUserId(): UserId | null {
    const principal = untracked(this.principal);
    return principal !== null && Principal.isActive(principal)
      ? principal.userId
      : null;
  }

  /**
   * The shop's zone — the LOCATION's (`ShopLocation.timeZone`, Law 7.2), read
   * off the catalogue's shops, never the browser's. Every shop of the tenant
   * keeps one clock (blueprint §7.1), so the first shop that names a zone
   * answers; until the catalogue does, the deployment's DEFAULT location's
   * (`ShopZoneService.defaultZone`, F-4) — and `null` until either answers:
   * there is no "today" before there is a zone, and the day waits on
   * {@link ready} (its chrome drawn, its lanes {@link loading}). "Today",
   * "now" on the wall clock and every lane's shop day are read in it.
   */
  readonly zone = computed<TimeZone | null>(() =>
    ShopZoneSystem.zoneOfScope(
      null,
      this.catalog.locations()[0] ?? null,
      this.defaultZone(),
    ),
  );

  /**
   * The day has a clock: the shop's zone is known, so "today" and every
   * lane's wall clock can be read (4A-11, R13). Until then the page draws
   * its chrome and its lanes stay in their loading state ({@link loading})
   * — nothing on it names a day, no new visible state.
   */
  readonly ready = computed(() => this.zone() !== null);

  /**
   * A day with no clock asks again (4A-11, R13). When the catalogue names no
   * shop and the default location's read failed, the page stays as a failed
   * lane read leaves it — no lanes, no sentence about them — and the two
   * moments that already re-read "now" (the minute tick, the tab's return)
   * read the default location again through
   * `ShopZoneService.retryDefaultZone`. A zone the catalogue names needs no
   * retry; a resolved default stays cached.
   */
  private retryZone(): void {
    if (untracked(this.zone) === null && untracked(this.defaultZoneFailed)) {
      this.shopZones.retryDefaultZone();
    }
  }

  /**
   * Now, on the minute tick that re-reads today.
   *
   * The gaps read it: a hole shrinks as the morning passes, and one that has
   * wholly elapsed stops being drawn at all. An INSTANT (`CLOCK_PORTS`,
   * Law 7.3 T2): it needs no zone, so it is read from the first frame.
   */
  private readonly _nowUtcMs = signal<UtcEpochMs>(this.clock.nowUtcMs());
  /**
   * The page's ONE clock.
   *
   * Exposed because the component used to keep a second one seeded from
   * the device's own clock — so the gaps answered to the injected clock while every
   * verb gate and the now-line answered to the machine. Two clocks on one
   * screen will always drift; this is the one that goes through the port.
   */
  readonly nowUtcMs = this._nowUtcMs.asReadonly();

  /**
   * "Now" as the shop sees it — its day and its minute (`ShopNow`), derived
   * from the one clock in the shop's zone; `null` until the zone is known.
   */
  readonly shopNow = computed<ShopNow | null>(() => {
    const zone = this.zone();
    return zone === null
      ? null
      : ZonedTimeSystem.shopNow(this._nowUtcMs(), zone);
  });

  /**
   * THE ZONE OF A SHOP IN SCOPE (4A-11, Law 7.2): the named shop's own
   * `timeZone` as the catalogue lists it, else the day's ({@link zone}) —
   * `null` only before either is known. A lookup, so a pooled list (the
   * search, «Скорошни») reads each visit's shop without a component
   * re-deriving the rule (`ShopZoneSystem.zoneOr`).
   */
  readonly zoneAt = computed<
    (locationId: LocationId | null) => TimeZone | null
  >(() => {
    const shops = this.catalog.locations();
    const fallback = this.zone();
    return (locationId) =>
      ShopZoneSystem.zoneOr(
        shops.find((shop) => shop.id === locationId) ?? null,
        fallback,
      );
  });

  /**
   * "Now" as a SHOP sees it — the physical chair invariant (Law 7.2): a
   * visit happens on its own shop's wall clock, so a pooled list judges
   * each visit by the `ShopNow` of the zone {@link zoneAt} names for its
   * shop. Derived ONCE per distinct zone per tick, here at the store edge
   * (`ZonedTimeSystem.shopNow` over the one clock), never in a component;
   * `null` when no zone is known for the shop nor for the day.
   */
  readonly shopNowAt = computed<
    (locationId: LocationId | null) => ShopNow | null
  >(() => {
    const nowUtcMs = this._nowUtcMs();
    const zoneAt = this.zoneAt();
    const zones = new Set<TimeZone>();
    for (const shop of this.catalog.locations()) zones.add(shop.timeZone);
    const day = this.zone();
    if (day !== null) zones.add(day);
    const byZone: ReadonlyMap<TimeZone, ShopNow> = new Map(
      [...zones].map((zone) => [zone, ZonedTimeSystem.shopNow(nowUtcMs, zone)]),
    );
    return (locationId) => {
      const zone = zoneAt(locationId);
      return zone === null ? null : (byZone.get(zone) ?? null);
    };
  });

  /**
   * Today on the SHOP's calendar — `null` (no day) until the zone is known;
   * the page renders nothing that names a day before {@link ready}.
   *
   * RE-READ rather than frozen. This used to be resolved once in the
   * constructor, on the assumption that "the store's whole life is one
   * visit". A counter tab is open from open to close and routinely
   * overnight — so at 09:00 the next morning the sheet was still showing
   * yesterday, still calling it today, and hiding the "back to today" button
   * precisely because it believed it was already there. It follows the
   * minute tick now, and only a new DAY reaches its readers.
   */
  readonly todayKey = computed<LocalDate | null>(
    () => this.shopNow()?.localDate ?? null,
  );

  /** The day asked for — `null` until a day is (today, latched once it is known). */
  private readonly _dayKey = signal<LocalDate | null>(untracked(this.todayKey));
  /**
   * The day on screen: the one asked for, or — before any day was, while
   * the shop's zone resolved — today, the moment it is known. `null` only
   * while neither is (no zone yet).
   */
  readonly dayKey = computed<LocalDate | null>(
    () => this._dayKey() ?? this.todayKey(),
  );

  /** Set once today has been read on a known zone — see the constructor. */
  private todayResolved = untracked(this.todayKey) !== null;

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
   * store to state the restored view (see `applyRouteView`). `day` and
   * `barber` are UNDEFINED only for the moment after a `?day=` that names no
   * calendar day, or a `?barber=` that names no chair id, was refused
   * (`applyRouteDay`, `applyRouteBarber`): the record forgets what the bar
   * says, so the correction is a real write.
   */
  private readonly _published = signal<{
    readonly day: LocalDate | null | undefined;
    readonly view: StaffView | null | undefined;
    readonly barber: BarberId | null | undefined;
  }>({ day: null, view: undefined, barber: null });
  readonly published = this._published.asReadonly();

  constructor() {
    // Cheap, and the only two moments the answer can change: the clock
    // crossing midnight while the tab sits open, and the tab coming back
    // after the laptop was shut. A minute's granularity is finer than any
    // decision made off this value.
    // NO auto-jump when today turns over: moving the day under someone
    // mid-tap is its own trust failure — the sheet says it is stale and
    // offers the way back instead (`showingStaleToday`).
    const tick = setInterval(() => {
      this._nowUtcMs.set(this.clock.nowUtcMs());
      this.retryZone();
    }, 60_000);
    const onVisible = () => {
      if (!document.hidden) {
        this._nowUtcMs.set(this.clock.nowUtcMs());
        this.retryZone();
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

    // THE FIRST TODAY (4A-11, R13): a cold load can construct the page before
    // the catalogue or the default location names the shop's zone. The day
    // then latches to today the moment the zone resolves — and a `?day=`
    // that named today before today was known reads as today, not as a day
    // somebody asked for.
    effect(() => {
      const today = this.todayKey();
      if (today === null || this.todayResolved) return;
      this.todayResolved = true;
      untracked(() => {
        const day = this._dayKey();
        if (day === null) {
          this._dayKey.set(today);
        } else if (day === today && this._chosen()) {
          this._chosen.set(false);
          this.publishQuery({ day: null });
        }
      });
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
   * Now as the brand, through the clock port — never the device's clock:
   * what a stamp and an elapsed-time rule read (T2).
   */
  private readNow(): UtcEpochMs {
    return this.clock.nowUtcMs();
  }

  readonly isToday = computed(() => this.dayKey() === this.todayKey());

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
    const day = this.dayKey();
    if (day === null) return;
    this.goToDay(LocalDate.addDays(day, delta * this.daySpan()));
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
    this._dayKey.set(this.todayKey());
    this._chosen.set(false);
    this.publishQuery({ day: null });
    this._pendingReveal.set(true);
  }

  /** A day the reader ASKED for by name — the month popover's pick. */
  jumpToDay(day: LocalDate | null): void {
    this.goToDay(day);
    this._pendingReveal.set(true);
  }

  /** Show a specific day; `null` falls back to today. */
  goToDay(day: LocalDate | null): void {
    const today = this.todayKey();
    const next = day ?? today;
    this._dayKey.set(next);
    this._chosen.set(next !== today);
    this.publishQuery({ day: next === today ? null : next });
  }

  /**
   * The URL's say on the day — the route's `?day=` read ONCE, here at its
   * edge (`LocalDate.parse`, Law 7.4): a calendar day applies; absence, or
   * anything that names no day (`2026-02-30`, `2026-13-01`, a hand-edited
   * word), falls back to today, so a stale or mistyped link lands somewhere
   * real rather than blank, and the address bar is corrected to say so
   * (DEP-13: the old shape check let an impossible day through as a chosen,
   * empty day). An empty `?day=` is silence, as always.
   */
  applyRouteDay(raw: string | null): void {
    const day = dayOfRoute(raw);
    if (raw && day === null) {
      // The bar names no day: forget what the record says it states, so
      // the fall-back below is a write and the bar stops naming it.
      this._published.update((stated) => ({ ...stated, day: undefined }));
    }
    this.goToDay(day);
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
      readonly day: LocalDate | null;
      readonly view: StaffView | null;
      readonly barber: BarberId | null;
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
            day: stated.day ?? null,
            view: stated.view ?? null,
            barber: stated.barber ?? null,
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
    this.publishQuery({ view: view === StaffView.Agenda ? null : view });
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
      this.setView(StaffView.Agenda);
      return;
    }
    // Silence is an EXTERNAL change too — the site menu's plain link to
    // this page arrives with no `?view=` while the record still says the
    // last one (found in review, 2026-09-23). Forgetting the record first
    // makes the restore a real write, so the bar states the view it shows.
    this._published.update((stated) => ({ ...stated, view: undefined }));
    this.publishQuery({
      view: this._view() === StaffView.Agenda ? null : this._view(),
    });
  }

  /**
   * Which barber the sheet is about. `null` is everyone.
   *
   * In the date-columned views it is what stops five barbers across seven
   * days becoming thirty-five columns; in the list and day views it is the
   * barber's own lane, which is the single most-asked thing on this surface.
   */
  private readonly _scope = signal<BarberId | null>(null);
  readonly scope = this._scope.asReadonly();

  setScope(barberId: BarberId | null): void {
    this._scope.set(barberId);
    this.publishQuery({ barber: barberId });
  }

  /**
   * The URL's say on the chair — read ONCE, here at its edge
   * (`BarberId.parse`, Law 7.4), then applied as asked; the catalogue vets
   * the id it names (a chair that left resolves to everyone once the
   * catalogue answers). Absent or empty is everyone, as always. A value no
   * chair id can be — blank (`?barber=%20`) or holding a `/` — is everyone
   * AT ONCE, and the address bar is corrected to say so (DEP-14: it used to
   * stand as a scope of nobody until the catalogue's roster cleared it).
   */
  applyRouteBarber(requested: string | null | undefined): void {
    const parsed = requested ? BarberId.parse(requested) : null;
    const barber = parsed !== null && parsed.ok ? parsed.value : null;
    if (parsed !== null && !parsed.ok) {
      // The bar names no chair: forget what the record says it states, so
      // the correction below is a write and the bar stops naming it.
      this._published.update((stated) => ({ ...stated, barber: undefined }));
    }
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
  readonly visibleDays = computed<readonly LocalDate[]>(() => {
    const anchor = this.dayKey();
    // No day yet (the zone is resolving): nothing on screen, nothing read.
    if (anchor === null) return [];
    const span = this.daySpan();
    const start =
      this._view() === StaffView.Week ? LocalDate.startOfWeek(anchor) : anchor;
    return Array.from({ length: span }, (_, offset) =>
      LocalDate.addDays(start, offset),
    );
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
  private readonly _noteFor = signal<AppointmentId | null>(null);

  /**
   * The sheet's own subscription, like `probeDay`: one listener while a
   * visit is open, none when it is not. The note lives in a staff-only
   * sibling collection (see `AppointmentNotes`), so it is read beside the
   * appointment rather than off it.
   */
  probeNote(appointmentId: AppointmentId | null): void {
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
              .observeAppointmentNote(id)
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
   * colleague's note against (`VisitSidesSystem.movedUnder`): a note this
   * device does not hear is not judged, never guessed. A stored note of
   * blanks is no note (the write never leaves one).
   */
  teamNoteOf(appointmentId: AppointmentId): string | null | undefined {
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
    return note === null || VisitSidesSystem.storedNote(note.text) === null
      ? null
      : note.text;
  }

  /* ── The shop's photos of the open visit ─────────────────────────────── */

  private readonly _photosFor = signal<AppointmentId | null>(null);

  /** Read the visit's photos live beside it, like the note; `null` releases them. */
  probePhotos(appointmentId: AppointmentId | null): void {
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
            : this.photos.observeAppointmentPhotos(id),
      ),
    ),
    { initialValue: undefined },
  );

  /**
   * The open visit's photos in the order they were taken — none while
   * loading, absent, or with no visit open. The order is the port's
   * (`ObserveAppointmentPhotos`: ascending by `takenAtUtcMs`, stably — the
   * adapter's sort stands in for an `orderBy`, which would need a composite
   * index for a list never longer than a visit).
   */
  readonly visitPhotos = computed<readonly AppointmentPhoto[]>(() => {
    const result = this.photosResult();
    if (result === undefined || !result.ok) return [];
    return result.value;
  });

  private readonly _photoWork = signal(0);
  /** A photo is going up or coming down. */
  readonly photoBusy = computed(() => this._photoWork() > 0);

  /**
   * A shutter press: the picture sized for the wire HERE (`downscaleImage`
   * — the guard judges the downscaled blob), then `attachVisitPhoto`: the
   * upload guard BEFORE anything is read or sent (`media.port.ts`: limits
   * are never the adapter's), the photo's id and instant stamped from the
   * store's id source and clock, its taker from the session
   * (`notes-photos.port.ts`), its bytes up and its document written. `true`
   * once the photo is on the visit — the live read draws it; the caller has
   * no thumbnail to place. A refusal or a failure is `false`.
   */
  async attachPhoto(request: {
    readonly appointmentId: AppointmentId;
    readonly barberId: BarberId;
    readonly clientCustomerId: CustomerId | null;
    readonly clientLabel: string;
    readonly file: Blob;
  }): Promise<boolean> {
    this._photoWork.update((count) => count + 1);
    try {
      const sized = await downscaleImage(request.file);
      const result = await attachVisitPhoto({
        ...this.photos,
        ...this.ids,
        ...this.clock,
      })({
        ...this.photoSubjectOf(request),
        image: sized.image,
        width: sized.width,
        height: sized.height,
      });
      return result.ok;
    } finally {
      this._photoWork.update((count) => count - 1);
    }
  }

  /**
   * One of the shop's own pictures onto the visit: a document, no bytes
   * (`adoptVisitPhoto` — the same record builder as a shot, a `LIBRARY`
   * origin).
   */
  async adoptPhoto(reference: {
    readonly appointmentId: AppointmentId;
    readonly barberId: BarberId;
    readonly clientCustomerId: CustomerId | null;
    readonly clientLabel: string;
    readonly path: string;
    readonly url: string;
    readonly label: string | null;
  }): Promise<boolean> {
    this._photoWork.update((count) => count + 1);
    try {
      const result = await adoptVisitPhoto({
        ...this.photos,
        ...this.ids,
        ...this.clock,
      })({
        ...this.photoSubjectOf(reference),
        path: reference.path,
        url: reference.url,
        label: reference.label,
      });
      return result.ok;
    } finally {
      this._photoWork.update((count) => count - 1);
    }
  }

  /** The visit a picture goes onto, its ids as the caller read them off it, and the session's taker. */
  private photoSubjectOf(request: {
    readonly appointmentId: AppointmentId;
    readonly barberId: BarberId;
    readonly clientCustomerId: CustomerId | null;
    readonly clientLabel: string;
  }): VisitPhotoSubject {
    return {
      appointmentId: request.appointmentId,
      barberId: request.barberId,
      clientCustomerId: request.clientCustomerId,
      clientLabel: request.clientLabel,
      takenByUserId: this.currentUserId(),
    };
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

  /**
   * The client RECORD whose usable coupons the sheet is offering, with the
   * grants the open visit's SAVED bill names — or `null`.
   */
  private readonly _grantsFor = signal<{
    readonly customerId: CustomerId;
    readonly billGrantIds: readonly CouponGrantId[];
  } | null>(null);

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
   *
   * THE SAVED BILL'S GRANTS ride along (OR-13): a save burns the grant a
   * bill line names (`USED`), so the usable list no longer holds it — the
   * open visit's own grant-line ids (`billGrantIds`) are read beside it,
   * whatever their status (`loadHeldGrants`), so a burned reward still
   * shows on the visit that spent it.
   */
  probeGrants(
    customerId: CustomerId | null,
    billGrantIds: readonly CouponGrantId[] = [],
  ): void {
    const current = this._grantsFor();
    if (customerId === null) {
      if (current !== null) this._grantsFor.set(null);
      return;
    }
    if (
      current !== null &&
      current.customerId === customerId &&
      sameIds(current.billGrantIds, billGrantIds)
    ) {
      return;
    }
    this._grantsFor.set({ customerId, billGrantIds });
  }

  private readonly grantsResult = toSignal(
    toObservable(this._grantsFor).pipe(
      switchMap((probe) =>
        probe === null
          ? of(Result.ok<readonly HeldGrant[]>([]))
          : from(
              loadHeldGrants({ ...this.couponsVouchers, ...this.clock })(
                probe.customerId,
                probe.billGrantIds,
              ),
            ),
      ),
    ),
    { initialValue: undefined },
  );

  /** What the sheet's discount menu offers — empty while loading, on failure, or for nobody. */
  readonly grants = computed<readonly VisitEditorGrantOption[]>(() => {
    const result = this.grantsResult();
    if (result === undefined || !result.ok) return [];
    const zone = this.zone();
    return result.value.map(({ grant, coupon }) => ({
      grantId: grant.id,
      couponId: coupon.id,
      label: coupon.name,
      value: CouponValue.of(grant),
      exclusive: Combinability.isExclusive(coupon.combinability),
      // The coupon's moment (revision 3 §4.6): the client card heads a
      // birthday gift with its band only when the coupon says so — a
      // grant that reaches it without one is a plain ticket, every day.
      couponOccasion: coupon.couponOccasion ?? null,
      // When it lapses, on the shop's calendar: the card's tickets print
      // it as their chip («до 28.10») and put the soonest first; a grant
      // that never lapses prints none (review 2: every ticket was chipless).
      expiresOn: zone === null ? null : expiresOnIn(grant, zone),
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
        .map((coupon) => ({
          code: coupon.code,
          couponId: coupon.id,
          label: coupon.name,
          value: CouponValue.of(coupon),
          exclusive: Combinability.isExclusive(coupon.combinability),
        }))
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
    readonly refusal: VoucherRefusal | null;
  } | null> {
    const typed = VoucherCode.parseTyped(code);
    if (!typed.ok) return null;
    const result = await this.couponsVouchers.findGiftVoucherByCode(
      typed.value,
    );
    if (!result.ok || result.value === null) return null;
    return {
      voucher: result.value,
      refusal: VoucherSystem.refusal(result.value, this.readNow()),
    };
  }

  /**
   * Writes straight through; an empty text deletes — `saveTeamNote`
   * (`@core/pipelines`, D-10.2: the one record builder it shares with
   * `appendTeamNote`), its author from the store's session and its instant
   * from the store's clock. `true` once the note is written.
   */
  async saveTeamNote(
    appointmentId: AppointmentId,
    text: string | null,
  ): Promise<boolean> {
    const result = await saveTeamNotePipeline({
      ...this.notes,
      ...this.clock,
    })({ appointmentId, text, authorUserId: this.currentUserId() });
    return result.ok;
  }

  /**
   * A line added BELOW the visit's note, never over it — what a cancel's
   * «Друго…» files (D23: the words staff type are the visit's note, not
   * the seat's reason): `appendTeamNote` (`@core/pipelines`) reads the note
   * on the server, joins the line below it and writes the joined text —
   * stamped from the session and the store's clock — in ONE transaction, so
   * a concurrent edit is re-read and kept above the line, never lost.
   * Offline the transaction refuses and nothing is written over the
   * server's note: a failure the sheet says (`false`); blank text writes
   * nothing and is none (the pipeline's `ok(null)`), saying nothing.
   */
  async appendTeamNote(
    appointmentId: AppointmentId,
    line: string,
  ): Promise<boolean> {
    const result = await appendTeamNotePipeline({
      ...this.notes,
      ...this.clock,
    })({
      appointmentId,
      line,
      authorUserId: this.currentUserId(),
    });
    return result.ok;
  }

  private readonly _probeDay = signal<LocalDate | null>(null);

  /**
   * Keep a day live while nothing on screen shows it — the sheets' frame
   * day, read once here (`LocalDate.parse`, the same edge rule as `?day=`).
   * `null`, or text that names no calendar day, releases it.
   */
  probeDay(raw: string | null): void {
    const day = dayOfRoute(raw);
    if (day === this._probeDay()) return;
    this._probeDay.set(day);
  }

  /**
   * Every day with a live listener — what is on screen, plus the probe.
   *
   * `dayCells` and `geometryResult` both pair against THIS list, in this
   * order, which is what keeps the index arithmetic honest when a probe is
   * appended.
   */
  private readonly subscribedDays = computed<readonly LocalDate[]>(() => {
    const visible = this.visibleDays();
    const probe = this._probeDay();
    return probe === null || visible.includes(probe)
      ? visible
      : [...visible, probe];
  });

  private readonly laneInputs = computed(() => ({
    dayKey: this.dayKey(),
    days: this.subscribedDays(),
    barbers: this.scopedBarbers().map((barber) => barber.id),
  }));

  /**
   * The appointments of one chair on one shop day — `busyKeys
   * array-contains` — and how many of them could not be read (OR-2).
   */
  private barberDay(
    barberId: BarberId,
    day: LocalDate,
  ): Observable<Result<BarberDayRead, RepositoryError>> {
    return this.appointments.observeBarberDay(BusyKey.of(barberId, day));
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
          days.map((day) =>
            combineLatest(
              barbers.map((barberId) => {
                const busyKey = BusyKey.of(barberId, day);
                return combineLatest([
                  this.scheduling.observeBusyDay(busyKey),
                  this.scheduling.observeExceptions(busyKey),
                ]);
              }),
            ),
          ),
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

  /**
   * The lanes have not answered — or there is no day to read them on yet:
   * while the shop's zone resolves ({@link ready}) the page's existing
   * loading state covers the wait, never "nobody is on shift" (4A-11, R13).
   */
  readonly loading = computed(
    () => this.zone() === null || this.lanesResult() === undefined,
  );

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
    // No zone, no wall clock to draw a lane on (the page is still loading).
    if (this.zone() === null) return [];

    return days.map((dayKey, dayIndex) => {
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
        const appointments = result?.ok ? result.value.appointments : [];
        // A chair whose day could not be read (OR-2): no visits, and no
        // holes either — a gap computed from a list that was never read
        // would offer time somebody may already hold.
        const failed = result !== undefined && !result.ok;
        const answer = answers?.[barberIndex];
        const schedule = schedules[barberIndex];
        const geo =
          dayFailed || answer === undefined || schedule === undefined
            ? NO_GEOMETRY
            : laneGeometryOf(
                barber.id,
                dayKey,
                schedule.ok ? schedule.value : null,
                answer[0].ok ? answer[0].value : null,
                answer[1].ok ? answer[1].value : null,
                locations,
              );

        // The lane carries the roster's own minutes of its shop day — the
        // windows, the blocks and the holes as `MinuteRange`s (Law 7.3:
        // zero inbound mapping); the drawing reads them as they are.
        return {
          barberId: barber.id,
          appointments,
          rostered: geo.rostered,
          blocks: geo.blocks,
          holes: failed
            ? []
            : GridLayoutSystem.holes(
                geo.rostered,
                occupiedOn(dayKey, appointments, barber.id, geo.busy),
              ),
          failed,
          unreadable: result?.ok ? result.value.unreadableCount : 0,
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
    const now = this.shopNow();
    if (now === null) return [];
    return this.dayGeometry().map((cell) => ({
      dayKey: cell.dayKey,
      lanes: cell.lanes.map(({ holes, ...lane }) => ({
        ...lane,
        gaps: GridLayoutSystem.sellableAt(holes, now, cell.dayKey),
      })),
    }));
  });

  /** One subscribed day's cell, anchor or probe — `null` when it is neither. */
  cellFor(dayKey: LocalDate | null): StaffDayCell | null {
    return this.dayCells().find((cell) => cell.dayKey === dayKey) ?? null;
  }

  /** The anchor day's lanes — what the single-day views draw. */
  readonly lanes = computed<readonly BarberDayLane[]>(() => {
    const cells = this.dayCells();
    const anchor = this.dayKey();
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
    this.lanes().filter((lane) =>
      RosterSystem.worksDay(lane.rostered.length, lane.appointments.length),
    ),
  );

  /**
   * Rostered nowhere today — named under the run, never drawn as a column.
   * A FAILED lane is not off (OR-2): its visits were never read, so «почива»
   * would be a guess; the sheet says it failed instead.
   */
  readonly offToday = computed(() =>
    this.lanes()
      .filter(
        (lane) =>
          !lane.failed &&
          !RosterSystem.worksDay(
            lane.rostered.length,
            lane.appointments.length,
          ),
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
  private readonly _pending = signal<ReadonlySet<AppointmentId>>(new Set());
  readonly pending = this._pending.asReadonly();

  isPending(appointmentId: AppointmentId): boolean {
    return this._pending().has(appointmentId);
  }

  /**
   * The last refusal, KEYED BY APPOINTMENT — it renders in the row that
   * earned it, never as a page banner three screens away from the tap.
   */
  private readonly _errors = signal<ReadonlyMap<AppointmentId, PipelineError>>(
    new Map(),
  );

  errorFor(appointmentId: AppointmentId): PipelineError | null {
    return this._errors().get(appointmentId) ?? null;
  }

  /**
   * A refusal decided on THIS side of the wire — an intent the call cannot
   * carry (`invalidCommand`) — filed on its row like the server's own, so
   * the row and the toast say it the same way.
   */
  refuse(appointmentId: AppointmentId, error: PipelineError): void {
    this._errors.update((map) => new Map(map).set(appointmentId, error));
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
    this._searchLoading.set(true);
    try {
      const result = await this.appointments.searchAppointmentWindow(
        this.readNow(),
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

  /**
   * Why the last block write did not land — the struct, never a word
   * (Law 7.5): the block pipelines' own answers as they answer
   * (`writeScheduleBlocks` / `clearScheduleBlock` — a scheduling refusal or
   * a repository failure), or `CATALOG_LOCATION_ZONE_UNKNOWN` when neither
   * the shop nor the day names a zone to read the block's day in. The
   * sheet words it as one line (`staff.day.blockFailed`); `null` while
   * nothing has failed.
   */
  private readonly _absenceError = signal<StaffBlockFailure | null>(null);
  readonly absenceError = this._absenceError.asReadonly();

  /**
   * Stand a chair down for the day, or block a range inside it.
   *
   * `ranges` empty means the whole day; otherwise the given spans are carved
   * out of an otherwise ordinary roster. Either way what reaches Firestore is
   * the sanitized public EFFECT (`ExceptionEffectRule` — `CLOSED` or
   * `BLOCKED`); a reason has no field to ride in. THE DAY IS A PARAMETER
   * (2026-09-09): the block sheet steps its frame off the shown day, and a
   * series is written day by day. The chair and the shop are the
   * catalogue's own ids, read off its entities by the caller.
   */
  async blockTime(
    barberId: BarberId,
    locationId: LocationId,
    ranges: readonly MinuteRange[],
    day: LocalDate,
  ): Promise<boolean> {
    if (this._absencePending()) return false;
    // A RANGE ACCUMULATES; a whole day REPLACES (2026-09-08). One document
    // per barber-day made a second lunch overwrite the first; the merge
    // reads the day inside the write and adds to it instead.
    return this.writeBlocks(barberId, locationId, ranges, [day]);
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
    barberId: BarberId,
    locationId: LocationId,
    ranges: readonly MinuteRange[],
    days: readonly LocalDate[],
  ): Promise<boolean> {
    if (this._absencePending()) return false;
    return this.writeBlocks(barberId, locationId, ranges, days);
  }

  /**
   * The one exception write behind `blockTime` and `blockSeries` —
   * `writeScheduleBlocks` (`@core/pipelines`): per day, a whole-day
   * stand-down REPLACES what the day held (`CLOSED`), and a range MERGES
   * into its stored blocks (`ScheduleExceptionSystem.block` — a day already
   * off whole stays off, never demoted to a partial block).
   */
  private async writeBlocks(
    barberId: BarberId,
    locationId: LocationId,
    ranges: readonly MinuteRange[],
    days: readonly LocalDate[],
  ): Promise<boolean> {
    // The exception's day instant is read in ITS shop's zone (Law 7.2), the
    // day's own until the catalogue lists that shop; none known, no write.
    const zone = untracked(this.zoneAt)(locationId);
    if (zone === null) {
      this._absenceError.set(CatalogError.locationZoneUnknown(locationId));
      return false;
    }
    this._absencePending.set(true);
    this._absenceError.set(null);
    try {
      const result = await writeScheduleBlocks(this.exceptions)({
        barberId,
        locationId,
        timeZone: zone,
        ranges,
        localDates: days,
      });
      if (!result.ok) {
        this._absenceError.set(result.error);
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
    barberId: BarberId,
    range: MinuteRange | null,
    day: LocalDate,
  ): Promise<boolean> {
    if (this._absencePending()) return false;
    this._absencePending.set(true);
    this._absenceError.set(null);
    try {
      // `clearScheduleBlock` (`@core/pipelines`): the day's stored body
      // through `ScheduleExceptionSystem.unblock` inside the write.
      const result = await clearScheduleBlock(this.exceptions)({
        barberId,
        localDate: day,
        range,
      });
      if (!result.ok) {
        this._absenceError.set(result.error);
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
  private readonly _createError = signal<PipelineError | null>(null);
  readonly createError = this._createError.asReadonly();

  /**
   * The shop placing its own book — `commitBooking` with `onBehalfOfUserId`
   * set (a client's id, or `null` for a walk-in). The lane's live listener
   * draws the new visit; nothing is written locally. `attemptId` is the
   * store's own (`ID_PORTS`): the caller hands the call without one.
   */
  async createBooking(
    request: Omit<BookingCall, 'attemptId'>,
  ): Promise<boolean> {
    if (this._creating()) return false;
    const attemptId = ClientOperationId.parse(this.ids.nextId());
    if (!attemptId.ok) {
      // A minted name the wire cannot carry: refused as the server refuses a
      // malformed booking, before anything goes out.
      this._createError.set(
        PipelineError.bare(PipelineErrorCode.InvalidRequest),
      );
      return false;
    }
    this._creating.set(true);
    this._createError.set(null);
    try {
      const result = await this.gateway.callableClient(Callables.CommitBooking)(
        { ...request, attemptId: attemptId.value },
      );
      if (!result.ok) {
        this._createError.set(result.error);
        return false;
      }
      return true;
    } finally {
      this._creating.set(false);
    }
  }

  async markArrived(appointmentId: AppointmentId): Promise<boolean> {
    const id = appointmentId;
    if (this._pending().has(id)) return false;
    const operationId = this.mintFor(id);
    if (operationId === null) return false;

    this._pending.update((set) => new Set(set).add(id));
    this._errors.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });

    try {
      const result = await this.gateway.callableClient(Callables.MarkArrived)({
        appointmentId: id,
        operationId,
      });
      if (!result.ok) {
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
  async clearArrival(appointmentId: AppointmentId): Promise<boolean> {
    const id = appointmentId;
    if (this._pending().has(id)) return false;
    const operationId = this.mintFor(id);
    if (operationId === null) return false;

    this._pending.update((set) => new Set(set).add(id));
    this._errors.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });

    try {
      const result = await this.gateway.callableClient(Callables.ClearArrival)({
        appointmentId: id,
        operationId,
      });
      if (!result.ok) {
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
   * `PIPELINE_SLOT_UNAVAILABLE` naming `BOOKING_STAFF_EDIT_OVERLAPS` is an
   * OFFER (re-send with `acknowledgedOverlap`), and it is the row's error
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
   * with one audit row, instead of twice. The caller hands the INTENT
   * only (`BookingCall.StaffEditIntent`): the name is this store's to mint
   * and to keep (required on the wire since WS-4.1).
   *
   * ### Every send states the revision it was made on (round 5)
   * `expectedVersion` is required by the call (`BookingCall.StaffEditIntent`): the
   * revision of the copy the sheet's draft was drawn from. A colleague's save
   * since is refused by the server as `BOOKING_STAFF_EDIT_STALE`, and the sheet then
   * reloads the visit and says so, instead of overwriting it with an older
   * screen. This device's OWN landed intents are not someone else's change:
   * the claim is rebased across them before it goes (`claimFor`), so a
   * queued drop, a second save from the same sheet and a save's undo are
   * never refused by the save before them. A re-send under the same name is
   * still answered from the server's ledger ahead of the stale check.
   */
  async staffEdit(intent: BookingCall.StaffEditIntent): Promise<boolean> {
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

    const request: BookingCall.StaffEditIntent = {
      ...intent,
      expectedVersion: this.claimFor(id, intent.expectedVersion),
    };
    const key = intentOf(request);
    const operationId = this.operationIdFor(request, key);
    try {
      if (operationId === null) {
        // A minted name the wire cannot carry is refused as the server
        // refuses one — before anything goes out, so nothing can land.
        this._errors.update((map) =>
          new Map(map).set(id, invalidCommand('operationId')),
        );
        return false;
      }
      const result = await this.gateway.callableClient(
        Callables.StaffEditAppointment,
      )({ ...request, operationId });
      if (!result.ok) {
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
  private readonly queuedEdits = new Map<
    AppointmentId,
    BookingCall.StaffEditIntent
  >();

  /**
   * THIS DEVICE'S OWN LANDED INTENTS, per visit: the revision each was made
   * on → the revision it stamped. At most `LANDED_PER_VISIT`, oldest
   * dropped.
   */
  private readonly landed = new Map<AppointmentId, readonly LandedRevision[]>();

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
  private claimFor(
    appointmentId: AppointmentId,
    drawn: number | null,
  ): number | null {
    return StaffIntentSystem.claimFor(
      this.landed.get(appointmentId) ?? [],
      drawn,
    );
  }

  /** An intent of this device landed: `from` → `to`, kept for `claimFor`. */
  private recordLanded(
    appointmentId: AppointmentId,
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
    AppointmentId,
    readonly UnsettledName[]
  >();

  /**
   * The name this send goes out under — see `unsettledOperations` — or
   * `null` for a freshly minted one the wire cannot carry.
   */
  private operationIdFor(
    request: BookingCall.StaffEditIntent,
    intent: string,
  ): ClientOperationId | null {
    const kept = StaffIntentSystem.operationIdFor(
      this.unsettledOperations.get(request.appointmentId) ?? [],
      intent,
    );
    const name = ClientOperationId.parse(kept ?? this.ids.nextId());
    return name.ok ? name.value : null;
  }

  /** A send that failed: its name kept under its intent, newest last. */
  private rememberUnsettled(
    appointmentId: AppointmentId,
    intent: string,
    operationId: ClientOperationId,
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
  private settle(appointmentId: AppointmentId, intent: string): void {
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
   * if any, lands on the row like every other write's. Each call is its own
   * act under a fresh name (`mintFor`).
   */
  async recordTip(intent: BookingCall.TipIntent): Promise<boolean> {
    const id = intent.appointmentId;
    const operationId = this.mintFor(id);
    if (operationId === null) return false;
    this._errors.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });
    const result = await this.gateway.callableClient(Callables.RecordSeatTip)({
      ...intent,
      operationId,
    });
    if (!result.ok) {
      this._errors.update((map) => new Map(map).set(id, result.error));
      return false;
    }
    return true;
  }

  /**
   * ONE WRITE OF THE VISIT SHEET — «Запази», and the receipt's «Отмени»
   * (OR-4): `saveVisitEdit` (`@core/pipelines`) over this store's own
   * writers — the batch through `staffEdit`, so the queue, the revision
   * claim and the intent's name stay here, then the team note
   * (`saveTeamNote`) and the tip (`recordTip`), each only once the batch
   * landed. Every writer keeps its refusal on the visit's row; a refusal
   * the plan earned before anything went out (a placement the call cannot
   * carry) is filed there too, so the sheet says either the same way. The
   * outcome goes back as it is, for the sheet's saved mark, its toast and
   * its undo.
   */
  async saveVisit(command: SaveVisitEditCommand): Promise<VisitEditWrite> {
    const write = await saveVisitEdit({
      sendStaffEdit: (intent) => this.staffEdit(intent),
      saveTeamNoteText: (appointmentId, text) =>
        this.saveTeamNote(appointmentId, text),
      sendSeatTip: (request) => this.recordTip(request),
    })(command);
    if (
      write.visitEditWriteOutcome === VisitEditWriteOutcome.BatchRefused &&
      write.batchRefusal !== null
    ) {
      this.refuse(command.appointmentId, write.batchRefusal);
    }
    return write;
  }

  /** `true` on success — the caller closes whatever asked for the reason. */
  async transition(intent: BookingCall.TransitionIntent): Promise<boolean> {
    const id = intent.appointmentId;
    if (this._pending().has(id)) return false;
    const operationId = this.mintFor(id);
    if (operationId === null) return false;

    this._pending.update((set) => new Set(set).add(id));
    this._errors.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });

    try {
      const result = await this.gateway.callableClient(
        Callables.TransitionAppointment,
      )({ ...intent, operationId });
      if (!result.ok) {
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
   * A fresh name for ONE act on the visit (WS-4.1) — an arrival, its
   * undo, a transition, a tip: each call is a new act, so a second tap
   * mints a new name (no unsettled-name memory for these verbs, unlike
   * `staffEdit`'s). A minted name the wire cannot carry is refused here as
   * the server refuses a malformed call — on the row, before anything goes
   * out (`createBooking`'s discipline) — and answers `null`.
   */
  private mintFor(appointmentId: AppointmentId): ClientOperationId | null {
    const minted = ClientOperationId.parse(this.ids.nextId());
    if (minted.ok) return minted.value;
    this._errors.update((map) =>
      new Map(map).set(
        appointmentId,
        PipelineError.bare(PipelineErrorCode.InvalidRequest),
      ),
    );
    return null;
  }
}
