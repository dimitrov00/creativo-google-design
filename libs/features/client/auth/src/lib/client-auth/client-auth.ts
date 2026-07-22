import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService, TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import {
  AUTH_GATEWAY,
  RedirectPath,
  Settled,
  classify,
  latchSettledPrincipal,
} from '@creativo/application/identity';
import { OtpCode, createIdentifier } from '@creativo/application/identity';
import { UiButton, UiInput, UiOtpField } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { translateDomainError } from '@creativo/infrastructure/i18n';
import { AuthFlowStore } from '../auth-flow.store';

/**
 * `/auth` — welcome → identify → otp, `AuthFlowStore`-driven (blueprint
 * §5.3). No route guard (v2 deliberately lets a user become authed
 * mid-flow); this component's own `classify`/`latchSettledPrincipal` latch
 * decides whether to render the flow or bounce an already-settled visitor
 * — freezing the FIRST verdict so a token refresh mid-flow never yanks
 * them out from under themselves (see `guest-guard.ts`'s own docs).
 *
 * No popstate listener anywhere here — back-navigation between steps is
 * the flow's own explicit `back()` event, dispatched from an in-page
 * control, never the browser's history API.
 */
@Component({
  selector: 'lib-client-auth',
  imports: [TranslocoDirective, UiButton, UiInput, UiOtpField, UiTextDirective],
  providers: [AuthFlowStore],
  templateUrl: './client-auth.html',
  styleUrl: './client-auth.css',
  host: {
    'data-testid': 'auth-page',
    '[attr.data-state]': 'store.state().kind',
  },
})
export class ClientAuth {
  private readonly authGateway = inject(AUTH_GATEWAY);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly store = inject(AuthFlowStore);

  private readonly principal = toSignal(this.authGateway.observePrincipal(), {
    initialValue: null,
  });
  private readonly liveSettled = computed<Settled>(() =>
    classify(this.principal()),
  );
  private readonly latched = signal<Exclude<Settled, 'loading'> | null>(null);

  private readonly redirect = computed(() =>
    RedirectPath.parseOrRoot(this.route.snapshot.queryParamMap.get('redirect')),
  );

  /** Phone-vs-email per the deployment's `AuthStrategy` — see `DEFAULT_AUTH_STRATEGY`'s own doc for why this isn't yet a real per-tenant lookup. */
  protected readonly identifierKind: 'phone' | 'email' = 'phone';
  protected readonly rawIdentifier = signal('');
  protected readonly identifierResult = computed(() => {
    const raw = this.rawIdentifier();
    if (!raw) return null;
    return createIdentifier({ kind: this.identifierKind, value: raw });
  });

  protected readonly rawCode = signal('');

  constructor() {
    effect(() => {
      this.latched.set(
        latchSettledPrincipal(this.latched(), this.liveSettled()),
      );
    });

    effect(() => {
      const settled = this.latched();
      if (settled === 'active') {
        void this.router.navigateByUrl(this.redirect().authDestination().value);
      } else if (settled === 'onboarding') {
        void this.router.navigate(['/onboarding'], {
          queryParams: { redirect: this.redirect().value },
        });
      }
    });

    // Mirrors v2's otp-step: any verify failure wipes the entered code
    // (never leaves a stale, already-wrong code sitting in the field).
    effect(() => {
      const state = this.store.state();
      if (state.kind === 'otp' && state.error) {
        this.rawCode.set('');
      }
    });
  }

  protected translateError(code: string | undefined): string | null {
    if (!code) return null;
    return translateDomainError(this.transloco, { code });
  }

  protected currentError(): string | undefined {
    const state = this.store.state();
    return state.kind === 'identify' || state.kind === 'otp'
      ? state.error
      : undefined;
  }

  protected identifierErrorMessage(): string | null {
    const result = this.identifierResult();
    if (!result || result.isSuccess()) return null;
    return translateDomainError(this.transloco, { code: result.error.code });
  }

  protected submitIdentifier(): void {
    const result = this.identifierResult();
    if (!result || result.isFailure()) return;
    void this.store.submitIdentifier(result.value);
  }

  protected codeErrorMessage(): string | null {
    const raw = this.rawCode();
    if (raw.length < 6) return null;
    const result = OtpCode.create(raw);
    return result.isSuccess()
      ? null
      : translateDomainError(this.transloco, { code: result.error.code });
  }

  protected submitCode(): void {
    const result = OtpCode.create(this.rawCode());
    if (result.isFailure()) return;
    void this.afterSubmitCode(result.value.value);
  }

  /**
   * Awaits the verify round-trip directly (rather than reacting to
   * `AuthFlowStore.state()` via `effect()`) and only then navigates —
   * driving the terminal redirect from an explicit async continuation
   * sidesteps a real interaction between zoneless effect scheduling and
   * Angular Router's `withViewTransitions()`: an effect-triggered
   * `navigate()` here was observed to resolve `true` and update
   * `Router.url`, yet never actually commit the browser's address bar.
   *
   * Also waits for `AUTH_GATEWAY.observePrincipal()` to actually reflect
   * the sign-in before navigating to `/onboarding` — `signInWithCustomToken()`
   * resolving does not guarantee Firebase's `onIdTokenChanged` listener has
   * fired yet, and navigating too early races `anonGuard` (it would read a
   * still-`anonymous` principal and bounce straight back to `/auth`).
   */
  private async afterSubmitCode(rawCode: string): Promise<void> {
    const session = await this.store.submitCode(rawCode);
    if (!session) return;

    await firstValueFrom(
      this.authGateway
        .observePrincipal()
        .pipe(filter((principal) => principal.kind !== 'anonymous')),
    );

    if (session.kind === 'returning') {
      await this.router.navigateByUrl(this.redirect().authDestination().value);
    } else {
      await this.router.navigate(['/onboarding'], {
        queryParams: { redirect: this.redirect().value },
      });
    }
  }
}
