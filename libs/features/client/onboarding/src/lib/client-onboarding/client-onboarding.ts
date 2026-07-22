import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService, TranslocoDirective } from '@jsverse/transloco';
import {
  CATALOG_READER,
  Service,
  ServiceId,
} from '@creativo/application/catalog';
import { RedirectPath } from '@creativo/application/identity';
import { UiButton, UiChip, UiInput, UiSpinner } from '@creativo/ui/controls';
import { UiTextDirective } from '@creativo/ui/modifiers';
import { translateDomainError } from '@creativo/infrastructure/i18n';
import { OnboardingFlowStore } from '../onboarding-flow.store';

/**
 * `/onboarding` — about → reward → services → avatar → entering,
 * `OnboardingFlowStore`-driven (blueprint §5.3). Route-guarded by
 * `anonGuard` (bounces only true anonymous visitors to `/auth`); an
 * authed-but-inactive visitor always resumes here at `about` (no
 * cross-reload progress persistence, matching the flow's own statelessness
 * — v2 does the same). No popstate listener — `back()` is the flow's own
 * explicit event.
 */
@Component({
  selector: 'lib-client-onboarding',
  imports: [
    TranslocoDirective,
    UiButton,
    UiChip,
    UiInput,
    UiSpinner,
    UiTextDirective,
  ],
  providers: [OnboardingFlowStore],
  templateUrl: './client-onboarding.html',
  styleUrl: './client-onboarding.css',
  host: {
    'data-testid': 'onboarding-page',
    '[attr.data-state]': 'store.state().kind',
  },
})
export class ClientOnboarding {
  private readonly catalogReader = inject(CATALOG_READER);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly store = inject(OnboardingFlowStore);

  private readonly redirect = computed(() =>
    RedirectPath.parseOrRoot(this.route.snapshot.queryParamMap.get('redirect')),
  );

  protected readonly firstName = signal('');
  protected readonly lastName = signal('');

  private readonly servicesResult = toSignal(
    this.catalogReader.listActiveServices(),
    { initialValue: null },
  );
  protected readonly services = computed<readonly Service[]>(() => {
    const result = this.servicesResult();
    return result?.isSuccess() ? result.value : [];
  });
  protected readonly selectedServiceIds = signal<readonly ServiceId[]>([]);

  protected readonly enteringFailed = signal(false);

  /**
   * Drives the terminal redirect from a direct async continuation off the
   * user's own action (skip/finish personalizing), never a `state()`-watching
   * `effect()` — mirrors `ClientAuth`'s identical fix: an effect-triggered
   * `router.navigateByUrl()` here was observed to resolve successfully yet
   * never actually commit the browser's address bar (a real interaction
   * between zoneless effect scheduling and `withViewTransitions()`).
   */
  private async finishEntering(): Promise<void> {
    this.enteringFailed.set(false);
    const principal = await this.store.pollActivation();
    if (principal?.kind === 'active') {
      await this.router.navigateByUrl(this.redirect().authDestination().value);
      return;
    }
    // Either a hard gateway failure (`null`) or the backoff exhausted
    // still on `onboarding` — both land the visitor on a retry affordance
    // rather than silently stranding them on a blank "entering" screen.
    this.enteringFailed.set(true);
  }

  protected translateError(code: string | undefined): string | null {
    if (!code) return null;
    return translateDomainError(this.transloco, { code });
  }

  protected currentError(): string | undefined {
    const state = this.store.state();
    return state.kind === 'about' ? state.error : undefined;
  }

  protected submitAbout(): void {
    void this.store.submitAbout({
      firstName: this.firstName(),
      lastName: this.lastName(),
    });
  }

  protected toggleService(id: ServiceId): void {
    const current = this.selectedServiceIds();
    this.selectedServiceIds.set(
      current.includes(id)
        ? current.filter((existing) => existing !== id)
        : [...current, id],
    );
  }

  protected isServiceSelected(id: ServiceId): boolean {
    return this.selectedServiceIds().includes(id);
  }

  protected submitServices(): void {
    this.store.submitServices(this.selectedServiceIds());
  }

  protected serviceName(service: Service): string {
    return this.transloco.getActiveLang() === 'en'
      ? service.name.en
      : service.name.bg;
  }

  protected retryEntering(): void {
    void this.finishEntering();
  }

  protected enterAppNow(): void {
    this.store.enterApp();
    void this.finishEntering();
  }

  protected skipAvatarNow(): void {
    this.store.skipAvatar();
    void this.finishEntering();
  }
}
