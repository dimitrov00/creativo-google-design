import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, startWith, switchMap } from 'rxjs';
import { CLOCK } from '@creativo/application/shared';
import { ZonedDateTime } from '@creativo/application/accounts';
import {
  BOOKING_GATEWAY,
  type BookingGatewayError,
} from '@creativo/application/booking';
import { APPOINTMENT_READ_PORTS } from '@creativo/infrastructure/firebase-app';
import type { Appointment } from '@core/entities';
import {
  type AppointmentId,
  type UserId,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import { BookingLifecycle, ShopNow, WallTime } from '@core/components';
import { ZonedTimeSystem } from '@core/systems';

/** The whole product is Europe/Sofia-only for now (blueprint §7.1) — no tenant-configurable zone source exists yet. */
export const APPOINTMENTS_ZONE = 'Europe/Sofia';

/**
 * How far back the history reads.
 *
 * Two years of monthly visits, give or take — enough that the month pills
 * cover a real relationship with the shop, few enough that the read is a
 * constant rather than a function of how long someone has been a client.
 */
export const HISTORY_LIMIT = 30;

export type UpcomingListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly appointments: readonly Appointment[] };

/**
 * Page-scoped store for `/account/appointments` (goal 6.4) — the account's
 * live bookings (`APPOINTMENT_READ_PORTS.observeUpcoming`) and its newest
 * visits (`observeHistory`) as signals of the stored `Appointment` entities,
 * the cancel through the booking gateway, plus the calendar's focused-month
 * cursor. Component-provided (not root): unlike `AccountStateService`,
 * nothing outside this screen needs this state.
 */
@Injectable()
export class AppointmentsStore {
  private readonly appointments$ = inject(APPOINTMENT_READ_PORTS);
  // The GATEWAY, not a write port: cancellation is a server-side write
  // (callable + projection rebuild); the web never writes an appointment.
  private readonly bookingGateway = inject(BOOKING_GATEWAY);
  private readonly clock = inject(CLOCK);

  /** "Now" in the product's fixed zone — resolved once at store construction via the injected Clock port, never a raw JS date constructor. */
  readonly today: ZonedDateTime;

  /**
   * The same "now" as the instant the cancellation window is measured
   * against (an elapsed-time rule on `UtcEpochMs`, T2) — read once, with
   * {@link today}.
   */
  readonly nowUtcMs: UtcEpochMs;

  /**
   * The same "now" on the shop's wall clock (`ShopNow`, Law 7.3) — what
   * "has this visit begun" is compared with: `localDate` + `currentMinute`,
   * never an instant.
   */
  readonly now: ShopNow;

  private readonly userId = signal<UserId | null>(null);

  /**
   * Whose visits these are — the signed-in owner every list is read for, and
   * the account the domain judges "which seats are yours to move" against
   * (`MoveSystem.hasSeatTheBookerCanMove`).
   */
  readonly owner = this.userId.asReadonly();

  /** Bumped by {@link retry}: each bump is a fresh pair of listeners. */
  private readonly attempt = signal(0);

  /**
   * What the two listeners are opened for — the owner, and which attempt.
   * A new value tears the old listeners down and opens new ones.
   */
  private readonly reading = computed(() => ({
    userId: this.userId(),
    attempt: this.attempt(),
  }));

  private readonly upcomingResult = toSignal(
    toObservable(this.reading).pipe(
      switchMap(({ userId }) =>
        userId
          ? // Loading again until the fresh listener answers: a retry that
            // kept showing the failure it is retrying would look dead.
            this.appointments$
              .observeUpcoming(userId)
              .pipe(startWith(undefined))
          : of(null),
      ),
    ),
    { initialValue: undefined },
  );

  readonly upcoming = computed<UpcomingListState>(() => {
    const result = this.upcomingResult();
    if (result === undefined || result === null) return { kind: 'loading' };
    if (!result.ok) return { kind: 'error' };
    return {
      kind: 'ready',
      // The account's live bookings — a settled one is never "upcoming".
      appointments: result.value.filter(
        (appointment) => !BookingLifecycle.isSettled(appointment),
      ),
    };
  });

  readonly appointments = computed<readonly Appointment[]>(() => {
    const state = this.upcoming();
    return state.kind === 'ready' ? state.appointments : [];
  });

  /**
   * Past visits, newest first — a SECOND listener, bounded at
   * {@link HISTORY_LIMIT}.
   *
   * Separate from `upcoming` rather than one query filtered twice: the two
   * have different shapes (one is a handful of open bookings with no date
   * bound, the other is the newest N of an ever-growing record) and only one
   * of them is worth paying for on every mount.
   */
  private readonly historyResult = toSignal(
    toObservable(this.reading).pipe(
      switchMap(({ userId }) =>
        userId
          ? this.appointments$.observeHistory(userId, HISTORY_LIMIT)
          : of(null),
      ),
    ),
    { initialValue: undefined },
  );

  /**
   * The history: of the newest {@link HISTORY_LIMIT}, every visit that has
   * already begun OR reached a settled status. The read is one bounded
   * query, split here (Firestore cannot express that OR without two
   * queries); "begun" is the visit's start on the shop's wall clock against
   * {@link now}.
   */
  readonly history = computed<readonly Appointment[]>(() => {
    const result = this.historyResult();
    if (!result || !result.ok) return [];
    const now = ShopNow.wallTime(this.now);
    return result.value.filter(
      (appointment) =>
        BookingLifecycle.isSettled(appointment) ||
        WallTime.compare(
          WallTime.of(appointment.localDate, appointment.startMinutes),
          now,
        ) <= 0,
    );
  });

  private readonly _focusedMonth = signal<ZonedDateTime | null>(null);
  readonly focusedMonth = computed(() => this._focusedMonth() ?? this.today);

  private readonly _cancellingId = signal<AppointmentId | null>(null);
  readonly cancellingId = this._cancellingId.asReadonly();

  private readonly _cancelError = signal<BookingGatewayError | null>(null);
  readonly cancelError = this._cancelError.asReadonly();

  constructor() {
    const nowResult = this.clock.now(APPOINTMENTS_ZONE);
    if (nowResult.isFailure()) {
      throw new Error(`Invalid appointments zone: ${APPOINTMENTS_ZONE}`);
    }
    this.today = nowResult.value;
    const zone = ZonedTimeSystem.checkZone(APPOINTMENTS_ZONE);
    const instant = UtcEpochMs.of(this.today.toMillis());
    if (!zone.ok || !instant.ok) {
      defect('unreachable: the clock answered a zone and an instant');
    }
    this.nowUtcMs = instant.value;
    this.now = ZonedTimeSystem.shopNow(instant.value, zone.value);
  }

  setUserId(userId: UserId): void {
    this.userId.set(userId);
  }

  /**
   * Read both lists again, from scratch — the list's «Опитай пак».
   *
   * A live query that failed for good (a rule denial, a document that will
   * not parse) has stopped listening (`subscribeWithRetry` retries only the
   * healable codes), so the only way back is a new listener: the upcoming
   * list shows as loading until it answers.
   */
  retry(): void {
    this.attempt.update((attempt) => attempt + 1);
  }

  nextMonth(): void {
    this._focusedMonth.set(this.focusedMonth().plusMonths(1));
  }

  previousMonth(): void {
    this._focusedMonth.set(this.focusedMonth().plusMonths(-1));
  }

  /**
   * Forget the last cancel's refusal. It belongs to the sheet that asked:
   * kept, it would open over the NEXT visit's cancel sheet, and a closed
   * window would disable that visit's confirm (`ClientAppointments`).
   */
  clearCancelError(): void {
    this._cancelError.set(null);
  }

  /**
   * Cancel through the GATEWAY (blueprint §5, goal 6.4): the
   * `cancelAppointment` callable owns the transition (ownership and the
   * lifecycle graph are checked server-side against fresh state), and the
   * `rebuildBusy` trigger frees the slot the moment the status lands.
   * Resolves `true` on success.
   */
  async cancel(appointmentId: AppointmentId, reason: string): Promise<boolean> {
    this._cancellingId.set(appointmentId);
    this._cancelError.set(null);
    const result = await this.bookingGateway.cancel({ appointmentId, reason });
    this._cancellingId.set(null);
    if (result.isFailure()) {
      this._cancelError.set(result.error);
      return false;
    }
    return true;
  }
}
