import { Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { of, switchMap } from 'rxjs';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { AUTH_GATEWAY } from '@creativo/application/identity';
import {
  APPOINTMENT_REPOSITORY,
  Appointment,
  ObserveUpcomingUseCase,
} from '@creativo/application/booking';
import { UserId } from '@creativo/application/accounts';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiSkeleton,
  UiStack,
} from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { translateDomainError } from '@creativo/infrastructure/i18n';
import { profileCompletion } from '../profile-completion';

type UpcomingState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'error' }
  | { readonly kind: 'populated'; readonly appointment: Appointment };

/**
 * `/account` — the signed-in home (blueprint §5.2, goal 6.3). Every card
 * reads off `AccountStateService`'s single account snapshot plus a live
 * `observeUpcomingFor` subscription; nothing here re-implements auth or
 * profile fetching.
 *
 * Scope gaps, deliberately left honest rather than half-built (see
 * `docs/migration/v2-parity-checklist.md`'s 6.3 row for the same note):
 *  - Loyalty summary needs a program-catalog read port that doesn't exist
 *    yet (`REWARD_PROGRESS_READER.observeForUser` requires already
 *    knowing a program id) — that's 6.6's "Rewards, coupons, invites" job.
 *  - Only "Book a visit" is a live tile — `/account/appointments` and
 *    `/account/settings` don't exist until 6.4/6.7 land, so those tiles
 *    render as inert "coming soon" placeholders instead of dead links.
 *  - No shared cross-role `AppHeader` exists yet in this workspace (v2's
 *    nav chrome wraps `/account`, `/staff`, `/admin` alike); this page
 *    ships its own minimal account-scoped header (title + sign out)
 *    rather than inventing a shared shell component outside this slice's
 *    file scope.
 */
@Component({
  selector: 'lib-client-account',
  imports: [
    RouterLink,
    TranslocoDirective,
    UiBadge,
    UiButton,
    UiCard,
    UiSkeleton,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './client-account.html',
  styleUrl: './client-account.css',
  host: {
    'data-testid': 'account-page',
    '[attr.data-state]': "accountState.accountLoading() ? 'loading' : 'ready'",
  },
})
export class ClientAccount {
  private readonly authGateway = inject(AUTH_GATEWAY);
  private readonly appointmentRepository = inject(APPOINTMENT_REPOSITORY);
  private readonly observeUpcomingUseCase = new ObserveUpcomingUseCase(
    this.appointmentRepository,
  );
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly accountState = inject(AccountStateService);
  protected readonly account = this.accountState.account;

  protected readonly completion = computed(() => {
    const user = this.account();
    return user ? profileCompletion(user) : null;
  });

  private readonly upcomingResult = toSignal(
    toObservable(this.accountState.principal).pipe(
      switchMap((principal) => {
        if (principal.kind !== 'active') return of(null);
        const userIdResult = UserId.create(principal.uid.value);
        if (userIdResult.isFailure()) return of(null);
        return this.observeUpcomingUseCase.execute(userIdResult.value);
      }),
    ),
    { initialValue: undefined },
  );

  protected readonly upcoming = computed<UpcomingState>(() => {
    const result = this.upcomingResult();
    if (result === undefined) return { kind: 'loading' };
    if (result === null) return { kind: 'empty' };
    if (result.isFailure()) return { kind: 'error' };

    const next = [...result.value].sort((a, b) =>
      a.timeSlot.start.isBefore(b.timeSlot.start) ? -1 : 1,
    )[0];
    return next ? { kind: 'populated', appointment: next } : { kind: 'empty' };
  });

  protected readonly upcomingAppointment = computed<Appointment | null>(() => {
    const state = this.upcoming();
    return state.kind === 'populated' ? state.appointment : null;
  });

  protected translateRepositoryError(): string {
    return translateDomainError(this.transloco, { code: 'repository_failure' });
  }

  protected formatAppointmentDate(appointment: Appointment): string {
    return new Intl.DateTimeFormat(this.transloco.getActiveLang(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(appointment.timeSlot.start.toISO()));
  }

  protected formatAppointmentTime(appointment: Appointment): string {
    return new Intl.DateTimeFormat(this.transloco.getActiveLang(), {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(appointment.timeSlot.start.toISO()));
  }

  protected async signOut(): Promise<void> {
    await this.authGateway.signOut();
    await this.router.navigateByUrl('/');
  }
}
