import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, from, of, switchMap } from 'rxjs';
import {
  APPOINTMENT_NOTES,
  APPOINTMENT_REPOSITORY,
  AVAILABILITY_READER,
  Appointment,
  BOOKING_GATEWAY,
  BookingGatewayError,
  type CommitBookingRequest,
  CalendarDay,
  Interval,
  LocalTimeRange,
  SCHEDULE_EXCEPTION_WRITER,
  ScheduleException,
  ScheduleExceptionId,
  type RecordSeatTipRequest,
  type StaffEditAppointmentRequest,
  type TransitionAppointmentRequest,
  Result,
  ok,
} from '@creativo/application/booking';
import { BarberId, LocationId } from '@creativo/application/catalog';
import {
  COUPON_GRANT_REPOSITORY,
  COUPON_READER,
  type Coupon,
  CouponCombinability,
  type CouponGrantWithCoupon,
  GIFT_VOUCHER_READER,
  type GiftVoucher,
} from '@creativo/application/engagement';
import { UserId } from '@creativo/application/identity';
import { CLOCK, RepositoryError } from '@creativo/application/shared';
import {
  type VisitEditorGrantOption,
  discountValueOf,
} from './visit-editor/staff-visit-editor';
import { CatalogContentService } from '@creativo/features/shared/catalog';

/** The whole product is Europe/Sofia-only for now (blueprint §7.1). */
const STAFF_ZONE = 'Europe/Sofia';

/**
 * The shortest hole the run will call sellable.
 *
 * NOT `foldBarberDay`'s 15-minute default, which that code describes as
 * deliberately small for REPORTING. Set the bar that low here and a lane
 * becomes a ladder of booking/gap/booking, and the three-second read is gone.
 * 20 minutes is under the shop's shortest service and over its turnaround.
 */
const SHORTEST_SELLABLE_MINUTES = 20;

/**
 * How many appointments the search reads each side of now.
 *
 * A 3–5 chair shop books ~40 a day, so 300 reaches roughly a working week
 * back and a working week forward — past the horizon anyone searches by
 * name, and small enough to match in memory without a pause.
 */
const SEARCH_WINDOW_PER_SIDE = 300;

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

/** One visible day with a lane per chair in scope. */
export interface StaffDayCell {
  readonly dayKey: string;
  readonly lanes: readonly BarberDayLane[];
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

/**
 * `YYYY-MM-DD` → `CalendarDay`, or `null` on anything malformed.
 *
 * The key is ours (produced by `CalendarDay.key()` or the `?day=` param), so
 * this is a parse rather than a validation — but a hand-edited URL reaches it,
 * and a bad day must yield no geometry rather than a thrown listener.
 */
function dayFromKey(dayKey: string): CalendarDay | null {
  const result = CalendarDay.create(dayKey, STAFF_ZONE);
  return result.isSuccess() ? result.value : null;
}

/**
 * What actually occupied a chair, from the appointments themselves.
 *
 * ### Why not `barberBusy`
 * The projection keeps only `pending`/`confirmed` (`rebuild-busy.ts`) and
 * TTLs thirty days after the day it describes. That is exactly right for its
 * job — `/book` reads it anonymously and it must mean "what can I sell" —
 * and it makes it structurally unable to describe a past day: by close of
 * business every completed and no-showed visit has dropped out of it, so it
 * reports the whole rostered day free. Deriving elapsed holes from it would
 * draw a nine-hour "unbooked" card over a fully worked Saturday, and one
 * per chair on any day older than a month.
 *
 * The lane already holds every appointment, untruncated and untimed-out.
 * This rebuilds the SAME envelope `busyContributionsOf` writes — the seat's
 * slot padded by its own setup and cleanup — so the two sources coincide
 * exactly wherever both exist, and there is no padded/unpadded seam at the
 * clock.
 *
 * A CANCELLED appointment contributes nothing: the chair genuinely went
 * empty, and that lost hour becoming visible is the point. Everything else
 * — pending, confirmed, completed, no-show — consumed the chair. A no-show
 * especially: nobody came, but nobody else could have been booked either.
 *
 * `blocks` are deliberately NOT added. They were already subtracted from
 * `windows` upstream (`availability.ts`), and counting them again would turn
 * every lunch break into idleness.
 */
export function occupiedIntervals(
  appointments: readonly Appointment[],
  barberId: string,
  busy: readonly Interval[],
): readonly Interval[] {
  const envelopes: Interval[] = [];
  for (const appointment of appointments) {
    if (appointment.status.kind === 'cancelled') continue;
    for (const seat of appointment.seats) {
      if (seat.barberId.value !== barberId) continue;
      const terms = seat.terms;
      envelopes.push(
        Interval.of(
          seat.slot.start.toMillis() - terms.setupMinutes * 60_000,
          seat.slot.end.toMillis() + terms.cleanupMinutes * 60_000,
        ),
      );
    }
  }
  return Interval.normalize([...busy, ...envelopes]);
}

/**
 * Rostered time minus what is taken — every hole in the chair's day.
 *
 * `busy` arrives ALREADY padded by the barber's turnaround (the reader's own
 * contract), so a gap here is genuinely bookable rather than a sliver that
 * only exists because the padding has not been applied yet. Holes under
 * `SHORTEST_SELLABLE_MINUTES` are dropped, not drawn quieter: an unsellable
 * two-minute rounding artefact is noise on a surface graded on being scannable.
 */
export function laneGaps(
  rostered: readonly Interval[],
  occupied: readonly Interval[],
  nowMs: number,
): readonly LaneGap[] {
  if (rostered.length === 0) return [];
  // SPLIT AT NOW, then floor — never the other way round.
  //
  // The hole is one interval either side of the clock; what changes is what
  // it MEANS. Future minutes are inventory a shop can sell; elapsed minutes
  // are a record of a chair that sat empty. Flooring before the split would
  // let a 105-minute hole with five minutes left on it emit a "5 min free"
  // card, and flooring only the whole would let a mostly-elapsed hole smuggle
  // an unsellable sliver into the sellable side.
  //
  // This used to CLIP to now instead, discarding the elapsed piece outright.
  // That hid a real fact — an idle morning and a fully booked one rendered
  // identically — and it was masking `barberBusy` being wrong about the past
  // rather than fixing it. `occupiedIntervals` fixes the cause, so nothing
  // has to be hidden any more.
  const pieces: Interval[] = [];
  for (const hole of Interval.subtract(rostered, occupied)) {
    if (hole.startMs < nowMs && nowMs < hole.endMs) {
      pieces.push(Interval.of(hole.startMs, nowMs));
      pieces.push(Interval.of(nowMs, hole.endMs));
    } else {
      pieces.push(hole);
    }
  }
  return pieces
    .map((piece) => ({
      startMs: piece.startMs,
      endMs: piece.endMs,
      minutes: Math.round((piece.endMs - piece.startMs) / 60_000),
      // Only time still ahead can be filled. The past piece is a fact.
      sellable: piece.endMs > nowMs,
    }))
    .filter((gap) => gap.minutes >= SHORTEST_SELLABLE_MINUTES);
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
  readonly appointments: readonly Appointment[];
  /** The chair's working windows today. Empty means NOT ROSTERED. */
  readonly rostered: readonly Interval[];
  /**
   * Time BLOCKED OUT of the worked day — a break, an admin hour.
   *
   * A separate channel from `rostered` on purpose. A block is the complement
   * of a window, and if it arrived only as that complement there would be no
   * way to tell "Ivan blocked this hour" from "Ivan is not rostered" from
   * "the shop is shut" — which is exactly what the calendar could not do, and
   * why time you blocked yourself came back as anonymous grey shading.
   */
  readonly blocks: readonly Interval[];
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
 * `{barberId}__{dayKey}` mirror is single-field-indexed, so N tiny listeners
 * beat inventing a new composite index and a zoned-ISO range query whose
 * ordering breaks across DST. The lanes re-subscribe when the day changes.
 *
 * ### Transitions are server writes
 * `gateway.transition` calls the role-checked callable; the live listeners
 * then show the new status on their own — no optimistic local mutation,
 * because the server can refuse (`canTransition` is the law) and a lane
 * that lied for a second teaches staff to distrust it.
 */
@Injectable()
export class StaffDayStore {
  private readonly repository = inject(APPOINTMENT_REPOSITORY);
  private readonly notes = inject(APPOINTMENT_NOTES);
  private readonly grantRepository = inject(COUPON_GRANT_REPOSITORY);
  private readonly coupons = inject(COUPON_READER);
  private readonly giftVouchers = inject(GIFT_VOUCHER_READER);
  private readonly availability = inject(AVAILABILITY_READER);
  private readonly exceptions = inject(SCHEDULE_EXCEPTION_WRITER);
  private readonly gateway = inject(BOOKING_GATEWAY);
  private readonly clock = inject(CLOCK);
  private readonly catalog = inject(CatalogContentService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

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
   * The last value this store wrote into `?day=`.
   *
   * The URL is written by the store and read back as a component input, so
   * without this the echo of our own write looks like an external change and
   * bounces the day straight back to today. Compare against it and only an
   * ACTUAL external change — first load, or the back button — gets applied.
   */
  private readonly _published = signal<string | null>(null);
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
    const now = this.clock.now(STAFF_ZONE);
    return now.isSuccess() ? now.value.toMillis() : 0;
  }

  private resolveToday(): string {
    const now = this.clock.now(STAFF_ZONE);
    return now.isSuccess()
      ? CalendarDay.fromZonedDateTime(now.value).key()
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

  jumpToToday(): void {
    this._dayKey.set(this._todayKey());
    this._chosen.set(false);
    this.publishDay(null);
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
    this.publishDay(next === this._todayKey() ? null : next);
  }

  /**
   * The day lives in the URL so it can be pasted into a staff chat, and so
   * that coming back from a visit returns to the day you were on. Absent
   * means today — a link that pinned today would go stale by morning.
   */
  private publishDay(dayKey: string | null): void {
    this._published.set(dayKey);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { day: dayKey },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ── What the sheet is showing ───────────────────────────────────────

  /**
   * Which rendering. Owner ruling 2026-08-07 reverses §2 of the design brief,
   * which argued for one canvas — the shop wants the calendar views it knows
   * from every other tool, and the switch is a toolbar action.
   */
  private readonly _view = signal<StaffView>('agenda');
  readonly view = this._view.asReadonly();

  setView(view: StaffView): void {
    // The scope SURVIVES the switch. A barber who narrowed the week to their
    // own lane and then tapped Day meant to stay on their own lane; resetting
    // it silently handed them the whole shop back.
    this._view.set(view);
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
    return scope === null
      ? all
      : all.filter((barber) => barber.id.value === scope);
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

  private readonly noteResult = toSignal(
    toObservable(this._noteFor).pipe(
      switchMap((id) => (id === null ? of(ok(null)) : this.notes.observe(id))),
    ),
    { initialValue: undefined },
  );

  /** The note's text, or `null` — while loading, while absent, or with no visit open. */
  readonly teamNote = computed<string | null>(() => {
    const result = this.noteResult();
    if (result === undefined || result.isFailure()) return null;
    return result.value?.text ?? null;
  });

  /** The client whose usable coupons the sheet is offering, or `null`. */
  private readonly _grantsFor = signal<string | null>(null);

  /**
   * THE CLIENT'S PROMISES, read while a visit is open (2026-09-10).
   *
   * The sheet's «Отстъпка» row offers the coupons the client already holds
   * — the shop keeping its own word, which a barber may do at the chair —
   * so they are read beside the visit, like the team note, and released
   * with it. A walk-in has no account and no grants; `null` reads as none.
   * One read per client rather than a listener: a grant does not change
   * under an open sheet, and the save re-checks it on the server anyway.
   */
  probeGrants(userId: string | null): void {
    if (userId === this._grantsFor()) return;
    this._grantsFor.set(userId);
  }

  private readonly grantsResult = toSignal(
    toObservable(this._grantsFor).pipe(
      switchMap((id) =>
        id === null
          ? of(ok<readonly CouponGrantWithCoupon[], RepositoryError>([]))
          : from(this.loadGrants(id)),
      ),
    ),
    { initialValue: undefined },
  );

  private async loadGrants(
    id: string,
  ): Promise<Result<readonly CouponGrantWithCoupon[], RepositoryError>> {
    const userId = UserId.create(id);
    const now = this.clock.now(STAFF_ZONE);
    if (userId.isFailure() || now.isFailure()) return ok([]);
    const result = await this.grantRepository.findUsableForUser(
      userId.value,
      now.value,
    );
    if (result.isFailure()) return result;
    // The port already filters to active grants; the expiry is the domain's
    // own test, applied here so an expired one never reaches the menu.
    return ok(result.value.filter(({ grant }) => grant.isUsable(now.value)));
  }

  /** What the sheet's discount menu offers — empty while loading, on failure, or for nobody. */
  readonly grants = computed<readonly VisitEditorGrantOption[]>(() => {
    const result = this.grantsResult();
    if (result === undefined || result.isFailure()) return [];
    return result.value.map(({ grant, coupon }) => ({
      grantId: grant.id.value,
      label: coupon.name,
      value: discountValueOf(grant.value),
      exclusive: CouponCombinability.isExclusive(coupon.combinability),
    }));
  });

  /**
   * A promo code typed at the counter → the enabled coupon it opens, or
   * `null` for no such code. A failed read is `null` too: at the chair,
   * "could not check" and "no such code" call for the same next move —
   * try again — and the save re-resolves the code on the server regardless.
   */
  async resolveCode(code: string): Promise<Coupon | null> {
    const result = await this.coupons.findByCode(code);
    return result.isSuccess() ? result.value : null;
  }

  /**
   * The other thing a typed code can be: a gift voucher, WHATEVER its state
   * — the sheet says why an empty or a void one will not take, which "no
   * such code" cannot.
   */
  async resolveVoucher(code: string): Promise<{
    readonly voucher: GiftVoucher;
    readonly refusal: 'void' | 'expired' | 'empty' | null;
  } | null> {
    const result = await this.giftVouchers.findByCode(code);
    if (result.isFailure() || result.value === null) return null;
    const now = this.clock.now(STAFF_ZONE);
    return {
      voucher: result.value,
      refusal: now.isSuccess() ? result.value.refusal(now.value) : null,
    };
  }

  /** The last note write that failed, by appointment — the sheet says so. */
  private readonly _noteError = signal<string | null>(null);
  readonly noteError = this._noteError.asReadonly();

  /** Writes straight through; an empty text deletes. */
  async saveTeamNote(
    appointmentId: string,
    text: string | null,
  ): Promise<boolean> {
    const result = await this.notes.save(appointmentId, text);
    this._noteError.set(result.isFailure() ? appointmentId : null);
    return result.isSuccess();
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

  /**
   * Appointments for every (day, barber) on screen, flattened in that order
   * so the index arithmetic below is the only place the pairing lives.
   */
  private readonly lanesResult = toSignal(
    toObservable(this.laneInputs).pipe(
      switchMap(({ days, barbers }) =>
        barbers.length === 0
          ? of([])
          : combineLatest(
              days.flatMap((dayKey) =>
                barbers.map((barberId) =>
                  this.repository.observeBarberDay(barberId, dayKey),
                ),
              ),
            ),
      ),
    ),
    { initialValue: undefined },
  );

  /**
   * The GEOMETRY of every visible day — rostered windows and padded busy
   * intervals.
   *
   * Same reader `/book` uses, and deliberately so: the shop must not be shown
   * a hole the public grid would refuse to sell. It is PII-free by
   * construction, which is why it can answer "what can I sell" without
   * touching the appointment documents the lanes already carry.
   */
  private readonly geometryResult = toSignal(
    toObservable(this.laneInputs).pipe(
      switchMap(({ days, barbers }) => {
        if (barbers.length === 0) return of(undefined);
        const perDay = days.map((dayKey) => {
          const day = dayFromKey(dayKey);
          return day === null
            ? of(undefined)
            : this.availability.observeDay(null, day, barbers);
        });
        return combineLatest(perDay);
      }),
    ),
    { initialValue: undefined },
  );

  readonly loading = computed(() => this.lanesResult() === undefined);

  /**
   * Every visible day, each with one lane per scoped chair.
   *
   * The flat `lanesResult` is re-paired here and NOWHERE else — day-major,
   * barber-minor, matching the order it was subscribed in.
   */
  readonly dayCells = computed<readonly StaffDayCell[]>(() => {
    const results = this.lanesResult();
    const barbers = this.scopedBarbers();
    // ⚠ `subscribedDays`, not `visibleDays` — the list the results were
    // FETCHED against. Pairing against the shorter one would drop the probe's
    // cell and, worse, would still be index-correct for every visible day, so
    // the bug would only ever show on the day nobody is looking at.
    const days = this.subscribedDays();
    if (!results) return [];

    const geometry = this.geometryResult();

    return days.map((dayKey, dayIndex) => {
      const dayGeometry = geometry?.[dayIndex];
      const byBarber = new Map(
        dayGeometry?.isSuccess()
          ? dayGeometry.value.map(
              (entry) => [entry.barberId.value, entry] as const,
            )
          : [],
      );

      const lanes = barbers.map((barber, barberIndex) => {
        const result = results[dayIndex * barbers.length + barberIndex];
        const appointments = result?.isSuccess() ? result.value : [];
        const geo = byBarber.get(barber.id.value);
        const rostered = (geo?.windows ?? []).map((window) => window.interval);
        const blocks = (geo?.blocks ?? []).map((block) => block.interval);

        return {
          barberId: barber.id.value,
          appointments,
          rostered,
          blocks,
          gaps: laneGaps(
            rostered,
            occupiedIntervals(appointments, barber.id.value, geo?.busy ?? []),
            this._nowMs(),
          ),
          failed: result !== undefined && result.isFailure(),
        };
      });

      return { dayKey, lanes };
    });
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

  /** Re-read the window — after a write, or when search is reopened stale. */
  async reloadSearchPool(): Promise<void> {
    const now = this.clock.now(STAFF_ZONE);
    if (now.isFailure()) return;
    this._searchLoading.set(true);
    try {
      const result = await this.repository.searchWindow(
        now.value.toISO(),
        SEARCH_WINDOW_PER_SIDE,
      );
      if (result.isSuccess()) this._pool.set(result.value);
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
   * the sanitized EFFECT — `exceptionToDocument` is total over the kind union
   * and a reason has no field to ride in.
   */
  async blockTime(
    barberId: string,
    locationId: string,
    ranges: readonly LocalTimeRange[],
    // THE DAY IS A PARAMETER (2026-09-09): the block sheet steps its frame
    // off the shown day, and a series is written day by day. Defaults to
    // the day on screen, which is what every earlier caller meant.
    dayKey: string = this._dayKey(),
  ): Promise<boolean> {
    if (this._absencePending()) return false;

    const day = dayFromKey(dayKey);
    const barber = BarberId.create(barberId);
    const location = LocationId.create(locationId);
    if (!day || barber.isFailure() || location.isFailure()) {
      this._absenceError.set('invalid');
      return false;
    }

    const exception = ScheduleException.create({
      id: ScheduleExceptionId.of(`${barberId}__${day.key()}`),
      day,
      barberId: barber.value,
      locationId: location.value,
      // A whole-day stand-down is `time_off`, which the sanitizer collapses
      // to `closed`; a partial block is `admin`, which collapses to
      // `blocked`. Neither carries a reason into the public document.
      detail:
        ranges.length === 0
          ? { kind: 'time_off' }
          : { kind: 'admin', ranges, note: '' },
    });
    if (exception.isFailure()) {
      this._absenceError.set('invalid');
      return false;
    }

    this._absencePending.set(true);
    this._absenceError.set(null);
    try {
      // A RANGE ACCUMULATES; a whole day REPLACES (2026-09-08). One document
      // per barber-day made a second lunch overwrite the first; the writer's
      // `putRange` reads the day and merges instead.
      const result =
        ranges.length === 0
          ? await this.exceptions.put(exception.value)
          : await this.putRanges(barberId, locationId, ranges, dayKey);
      if (result.isFailure()) {
        this._absenceError.set('failed');
        return false;
      }
      return true;
    } finally {
      this._absencePending.set(false);
    }
  }

  /** Lift the block — the chair returns to its ordinary roster. */
  private async putRanges(
    barberId: string,
    locationId: string,
    ranges: readonly LocalTimeRange[],
    dayKey: string,
  ): Promise<Result<void, RepositoryError>> {
    for (const range of ranges) {
      const result = await this.exceptions.putRange(
        barberId,
        locationId,
        dayKey,
        STAFF_ZONE,
        range,
      );
      if (result.isFailure()) return result;
    }
    return ok(undefined);
  }

  /**
   * Lift ONE block when a range is given, or the whole day when it is not —
   * the day-wide form is the armed, destructive path the sheet names as such.
   */
  async clearBlock(
    barberId: string,
    range: LocalTimeRange | null = null,
    dayKey: string = this._dayKey(),
  ): Promise<boolean> {
    if (this._absencePending()) return false;
    this._absencePending.set(true);
    this._absenceError.set(null);
    try {
      const result =
        range === null
          ? await this.exceptions.clear(barberId, dayKey)
          : await this.exceptions.clearRange(barberId, dayKey, range);
      if (result.isFailure()) {
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
   */
  async staffEdit(request: StaffEditAppointmentRequest): Promise<boolean> {
    const id = request.appointmentId;

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
      this.queuedEdits.set(id, request);
      return true;
    }

    this._pending.update((set) => new Set(set).add(id));
    this._errors.update((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });

    try {
      const result = await this.gateway.staffEdit(request);
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
  private readonly queuedEdits = new Map<string, StaffEditAppointmentRequest>();

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
