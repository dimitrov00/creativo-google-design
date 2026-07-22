import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { CLOCK } from '@creativo/application/shared';
import { UserId, ZonedDateTime } from '@creativo/application/accounts';
import {
  APPOINTMENT_REPOSITORY,
  Appointment,
  AppointmentId,
  CancelAppointmentUseCase,
  DomainError,
  ObserveUpcomingUseCase,
} from '@creativo/application/booking';

/** The whole product is Europe/Sofia-only for now (blueprint §7.1) — no tenant-configurable zone source exists yet. */
export const APPOINTMENTS_ZONE = 'Europe/Sofia';

export type UpcomingListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly appointments: readonly Appointment[] };

/**
 * Page-scoped store for `/account/appointments` (goal 6.4) — wraps the
 * already-built `ObserveUpcomingUseCase`/`CancelAppointmentUseCase`
 * (`@creativo/application/booking`) in signals, plus the calendar's
 * focused-month cursor. Component-provided (not root): unlike
 * `AccountStateService`, nothing outside this screen needs this state.
 */
@Injectable()
export class AppointmentsStore {
  private readonly appointmentRepository = inject(APPOINTMENT_REPOSITORY);
  private readonly clock = inject(CLOCK);
  private readonly observeUpcomingUseCase = new ObserveUpcomingUseCase(
    this.appointmentRepository,
  );
  private readonly cancelAppointmentUseCase = new CancelAppointmentUseCase(
    this.appointmentRepository,
  );

  /** "Now" in the product's fixed zone — resolved once at store construction via the injected Clock port, never a raw JS date constructor. */
  readonly today: ZonedDateTime;

  private readonly userId = signal<UserId | null>(null);

  private readonly upcomingResult = toSignal(
    toObservable(this.userId).pipe(
      switchMap((userId) =>
        userId ? this.observeUpcomingUseCase.execute(userId) : of(null),
      ),
    ),
    { initialValue: undefined },
  );

  readonly upcoming = computed<UpcomingListState>(() => {
    const result = this.upcomingResult();
    if (result === undefined || result === null) return { kind: 'loading' };
    if (result.isFailure()) return { kind: 'error' };
    return { kind: 'ready', appointments: result.value };
  });

  readonly appointments = computed<readonly Appointment[]>(() => {
    const state = this.upcoming();
    return state.kind === 'ready' ? state.appointments : [];
  });

  private readonly _focusedMonth = signal<ZonedDateTime | null>(null);
  readonly focusedMonth = computed(() => this._focusedMonth() ?? this.today);

  private readonly _cancellingId = signal<AppointmentId | null>(null);
  readonly cancellingId = this._cancellingId.asReadonly();

  private readonly _cancelError = signal<DomainError | null>(null);
  readonly cancelError = this._cancelError.asReadonly();

  constructor() {
    const nowResult = this.clock.now(APPOINTMENTS_ZONE);
    if (nowResult.isFailure()) {
      throw new Error(`Invalid appointments zone: ${APPOINTMENTS_ZONE}`);
    }
    this.today = nowResult.value;
  }

  setUserId(userId: UserId): void {
    this.userId.set(userId);
  }

  nextMonth(): void {
    this._focusedMonth.set(this.focusedMonth().plusMonths(1));
  }

  previousMonth(): void {
    this._focusedMonth.set(this.focusedMonth().plusMonths(-1));
  }

  /** Runs the domain `cancel()` transition through the repository (blueprint §5, goal 6.4). Resolves `true` on success. */
  async cancel(appointmentId: AppointmentId, reason: string): Promise<boolean> {
    this._cancellingId.set(appointmentId);
    this._cancelError.set(null);
    const result = await this.cancelAppointmentUseCase.execute({
      appointmentId,
      reason,
    });
    this._cancellingId.set(null);
    if (result.isFailure()) {
      this._cancelError.set(result.error);
      return false;
    }
    return true;
  }
}
