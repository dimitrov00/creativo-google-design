import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, startWith, switchMap } from 'rxjs';
import {
  APPOINTMENT_READ_PORTS,
  CLOCK_PORTS,
  GATEWAY_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import type { Appointment } from '@core/entities';
import { Callables } from '@core/ports';
import {
  type AppointmentId,
  LocalDate,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { type PipelineError } from '@core/errors';
import { BookingCall, BookingLifecycle, ShopNow } from '@core/components';
import { VisitListSystem, ZonedTimeSystem } from '@core/systems';
import { LoadSlice, LoadState } from '@creativo/shared/view-state';

/**
 * How far back the history reads.
 *
 * Two years of monthly visits, give or take — enough that the month pills
 * cover a real relationship with the shop, few enough that the read is a
 * constant rather than a function of how long someone has been a client.
 */
export const HISTORY_LIMIT = 30;

/**
 * Each load state as the page's `data-state` attribute spells it — the e2e
 * suite's contract, kept lowercase (Phase 4a 4A-10): this page says `error`
 * where the shared `loadStateWords` says `failed`, so it keeps ONE page
 * table over the ONE shared dictionary (UI residue cleanup UR-3). `EMPTY` is
 * never drawn here (the upcoming read is a plain {@link LoadSlice}); its word
 * completes the table.
 */
export const appointmentsStateWords = {
  [LoadState.Loading]: 'loading',
  [LoadState.Failed]: 'error',
  [LoadState.Ready]: 'ready',
  [LoadState.Empty]: 'empty',
} as const satisfies Record<LoadState, string>;

/**
 * Page-scoped store for `/account/appointments` (goal 6.4) — the account's
 * live bookings (`APPOINTMENT_READ_PORTS.observeUpcoming`) and its newest
 * visits (`observeHistory`) as signals of the stored `Appointment` entities,
 * the cancel through the callable gateway, plus the calendar's
 * focused-month cursor. Component-provided (not root): unlike
 * `AccountStateService`, nothing outside this screen needs this state.
 */
@Injectable()
export class AppointmentsStore {
  private readonly appointments$ = inject(APPOINTMENT_READ_PORTS);
  // The GATEWAY, not a write port: cancellation is a server-side write
  // (callable + projection rebuild); the web never writes an appointment.
  private readonly cancelCall = inject(GATEWAY_PORTS).callableClient(
    Callables.CancelAppointment,
  );

  /**
   * "Now" as the instant the cancellation window is measured against (an
   * elapsed-time rule on `UtcEpochMs`, T2) — read ONCE, at store
   * construction, through the clock port (never a raw JS date).
   */
  readonly nowUtcMs: UtcEpochMs = inject(CLOCK_PORTS).nowUtcMs();

  /**
   * The shop's zone the page's "today" is read on — the deployment's
   * default location's (no location is in scope for a person's whole
   * book; F-4, Phase 4a 4A-11). `null` until it resolves.
   */
  private readonly shopZones = inject(ShopZoneService);
  readonly zone = this.shopZones.defaultZone();
  /** `true` once that zone could not be read — the page's failed state (4A-2 (e)). */
  private readonly zoneFailed = this.shopZones.defaultZoneFailed();

  /**
   * The same "now" on the shop's wall clock (`ShopNow`, Law 7.3) — what
   * "has this visit begun" is compared with: `localDate` + `currentMinute`,
   * never an instant. `null` until the shop's zone has resolved.
   */
  readonly now = computed<ShopNow | null>(() => {
    const zone = this.zone();
    return zone === null ? null : ZonedTimeSystem.shopNow(this.nowUtcMs, zone);
  });

  /** The shop's day today — `null` until the shop's zone has resolved. */
  readonly today = computed<LocalDate | null>(
    () => this.now()?.localDate ?? null,
  );

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

  /**
   * The upcoming list's state. Loading until the listener answers AND the
   * shop's zone has resolved: the page files and draws every visit against
   * "today", which is a day on the shop's wall clock. A zone that cannot be
   * read is the page's failed state, as a failed listener is (4A-2 (e)).
   */
  readonly upcoming = computed<LoadSlice<readonly Appointment[]>>(() => {
    const result = this.upcomingResult();
    if (result === null) return LoadSlice.loading;
    if (this.zoneFailed()) return LoadSlice.failed;
    if (result === undefined || this.now() === null) return LoadSlice.loading;
    if (!result.ok) return LoadSlice.failed;
    return LoadSlice.ready(
      // The account's live bookings — a settled one is never "upcoming".
      result.value.filter(
        (appointment) => !BookingLifecycle.isSettled(appointment),
      ),
    );
  });

  readonly appointments = computed<readonly Appointment[]>(
    () => LoadSlice.dataOf(this.upcoming()) ?? [],
  );

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
   * queries) by `VisitListSystem.isHistory`; "begun" is the visit's start on
   * the shop's wall clock against {@link now} (nothing is history until the
   * shop's zone has resolved).
   */
  readonly history = computed<readonly Appointment[]>(() => {
    const result = this.historyResult();
    const shopNow = this.now();
    if (!result || !result.ok || shopNow === null) return [];
    return result.value.filter((appointment) =>
      VisitListSystem.isHistory(appointment, shopNow),
    );
  });

  /** The month the calendar is focused on, as its first day; `null` follows today's. */
  private readonly _focusedMonth = signal<LocalDate | null>(null);

  /**
   * The focused month as its first shop day (`2026-09-01`) — today's month
   * until moved; `null` until the shop's zone has resolved.
   */
  readonly focusedMonth = computed<LocalDate | null>(() => {
    const focused = this._focusedMonth();
    if (focused !== null) return focused;
    const today = this.today();
    return today === null ? null : LocalDate.startOfMonth(today);
  });

  private readonly _cancellingId = signal<AppointmentId | null>(null);
  readonly cancellingId = this._cancellingId.asReadonly();

  private readonly _cancelError = signal<PipelineError | null>(null);
  readonly cancelError = this._cancelError.asReadonly();

  setUserId(userId: UserId): void {
    this.userId.set(userId);
  }

  /**
   * Read both lists again, from scratch — the list's «Опитай пак».
   *
   * A live query that failed for good (a rule denial, a document that will
   * not parse) has stopped listening (`subscribeWithRetry` retries only the
   * healable codes), so the only way back is a new listener: the upcoming
   * list shows as loading until it answers. A shop zone that could not be
   * read is read again too.
   */
  retry(): void {
    this.shopZones.retryDefaultZone();
    this.attempt.update((attempt) => attempt + 1);
  }

  nextMonth(): void {
    this.moveFocus(1);
  }

  previousMonth(): void {
    this.moveFocus(-1);
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
   * `reason` is what the client typed — the call carries the code it is
   * filed under (`OTHER` when anything was typed, else `UNSPECIFIED`).
   * Resolves `true` on success.
   */
  async cancel(appointmentId: AppointmentId, reason: string): Promise<boolean> {
    this._cancellingId.set(appointmentId);
    this._cancelError.set(null);
    const result = await this.cancelCall(
      BookingCall.clientCancel(appointmentId, reason),
    );
    this._cancellingId.set(null);
    if (!result.ok) {
      this._cancelError.set(result.error);
      return false;
    }
    return true;
  }

  /** Shift the focused month by whole months (a no-op until today is known). */
  private moveFocus(months: number): void {
    const focused = this.focusedMonth();
    if (focused === null) return;
    this._focusedMonth.set(LocalDate.addMonths(focused, months));
  }
}
