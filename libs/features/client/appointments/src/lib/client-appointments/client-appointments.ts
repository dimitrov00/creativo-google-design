import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { UserId, ZonedDateTime } from '@creativo/application/accounts';
import {
  Appointment,
  AppointmentId,
  AppointmentStatusKind,
} from '@creativo/application/booking';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  UiBadge,
  UiBadgeTone,
  UiButton,
  UiChip,
  UiSkeleton,
} from '@creativo/ui/controls';
import { UiSheet, UiStack } from '@creativo/ui/layout';
import { UiCalendarGrid, UiCard, UiDateBadge } from '@creativo/ui/patterns';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { translateDomainError } from '@creativo/infrastructure/i18n';
import { AppointmentsStore, APPOINTMENTS_ZONE } from '../appointments.store';
import { CalendarMonth, buildCalendarMonth } from '../calendar-month';
import {
  AppointmentDayGroup,
  groupAppointmentsByDay,
} from '../appointment-groups';

type AppointmentsView = 'list' | 'calendar';

const CANCELLABLE_STATUSES = new Set<AppointmentStatusKind>([
  'pending',
  'confirmed',
]);

const STATUS_TONES: Record<AppointmentStatusKind, UiBadgeTone> = {
  pending: 'neutral',
  confirmed: 'accent',
  completed: 'success',
  cancelled: 'destructive',
  no_show: 'warning',
};
const DEFAULT_CANCEL_REASON = 'Cancelled by client.';

/**
 * `/account/appointments` (blueprint §8 Phase 6 item 4, goal 6.4) — a
 * calendar + list, both bound to `AppointmentsStore.appointments()`
 * (itself `ObserveUpcomingUseCase` → `observeUpcomingFor`, blueprint §5.2).
 * Cancelling runs the domain `Appointment.cancel()` transition through the
 * repository (`CancelAppointmentUseCase`); the store's live listener then
 * drops the now-terminal appointment from the list on its own — no manual
 * local removal.
 *
 * `observeUpcomingFor` only ever returns non-terminal (`pending`/
 * `confirmed`) appointments — there is no port for appointment *history*
 * yet, so unlike v2's status-filtered list/calendar this screen shows
 * upcoming visits only (a real, if narrower, scope than v2's; add a
 * history port + filter UI once one exists).
 */
@Component({
  selector: 'lib-client-appointments',
  imports: [
    RouterLink,
    TranslocoDirective,
    UiBadge,
    UiButton,
    UiCalendarGrid,
    UiCard,
    UiChip,
    UiDateBadge,
    UiSheet,
    UiSkeleton,
    UiStack,
    UiTextDirective,
  ],
  providers: [AppointmentsStore],
  templateUrl: './client-appointments.html',
  styleUrl: './client-appointments.css',
  host: {
    'data-testid': 'appointments-page',
    '[attr.data-state]': 'store.upcoming().kind',
  },
})
export class ClientAppointments {
  private readonly accountState = inject(AccountStateService);
  private readonly transloco = inject(TranslocoService);

  protected readonly store = inject(AppointmentsStore);

  protected readonly view = signal<AppointmentsView>('list');
  protected readonly selectedDayKey = signal<string | null>(null);

  protected readonly confirmingId = signal<AppointmentId | null>(null);
  protected readonly cancelReason = signal(DEFAULT_CANCEL_REASON);

  protected readonly calendarMonth = computed<CalendarMonth>(() =>
    buildCalendarMonth(
      this.store.focusedMonth(),
      this.store.today,
      this.store.appointments(),
    ),
  );

  private readonly visibleAppointments = computed<readonly Appointment[]>(
    () => {
      const all = this.store.appointments();
      if (this.view() !== 'calendar') return all;
      const key = this.selectedDayKey();
      return key ? all.filter((a) => a.timeSlot.calendarDayKey() === key) : all;
    },
  );

  protected readonly groups = computed<readonly AppointmentDayGroup[]>(() =>
    groupAppointmentsByDay(this.visibleAppointments()),
  );

  constructor() {
    effect(() => {
      const principal = this.accountState.principal();
      if (principal.kind !== 'active') return;
      const userIdResult = UserId.create(principal.uid.value);
      if (userIdResult.isSuccess()) {
        this.store.setUserId(userIdResult.value);
      }
    });
  }

  protected weekdayLabels(): readonly string[] {
    return ZonedDateTime.weekdayLabels(
      APPOINTMENTS_ZONE,
      this.transloco.getActiveLang(),
    );
  }

  protected formatMonthLabel(): string {
    return this.store
      .focusedMonth()
      .toLocaleString(this.transloco.getActiveLang(), {
        month: 'long',
        year: 'numeric',
      });
  }

  protected formatDayLabel(date: ZonedDateTime): string {
    return date.toLocaleString(this.transloco.getActiveLang(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  protected formatTime(date: ZonedDateTime): string {
    return date.toLocaleString(this.transloco.getActiveLang(), {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected setView(next: AppointmentsView): void {
    this.view.set(next);
    this.selectedDayKey.set(null);
  }

  protected selectDay(dayKey: string): void {
    this.selectedDayKey.set(this.selectedDayKey() === dayKey ? null : dayKey);
  }

  protected canCancel(appointment: Appointment): boolean {
    return CANCELLABLE_STATUSES.has(appointment.status.kind);
  }

  protected statusTone(kind: AppointmentStatusKind): UiBadgeTone {
    return STATUS_TONES[kind];
  }

  protected requestCancel(id: AppointmentId): void {
    this.confirmingId.set(id);
    this.cancelReason.set(DEFAULT_CANCEL_REASON);
  }

  protected dismissCancel(): void {
    this.confirmingId.set(null);
  }

  protected async confirmCancel(): Promise<void> {
    const id = this.confirmingId();
    if (!id) return;
    const cancelled = await this.store.cancel(id, this.cancelReason());
    if (cancelled) {
      this.confirmingId.set(null);
    }
  }

  protected translateCancelError(): string | null {
    const error = this.store.cancelError();
    if (!error) return null;
    return translateDomainError(this.transloco, {
      code: error.code,
      params: error.params,
    });
  }

  protected translateListError(): string {
    return translateDomainError(this.transloco, { code: 'repository_failure' });
  }
}
