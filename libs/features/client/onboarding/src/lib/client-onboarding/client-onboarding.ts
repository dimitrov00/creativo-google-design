import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService, TranslocoDirective } from '@jsverse/transloco';
import {
  CATALOG_READER,
  Service,
  ServiceId,
} from '@creativo/application/catalog';
import {
  BirthDate,
  BirthDateError,
  CountryIso2,
  PhoneNumber,
  PhoneNumberInvalidReason,
  RedirectPath,
  RegistrationField,
  ZonedDateTime,
  authStrategyRequires,
  examplePhoneNumber,
  identifierKindForStrategy,
} from '@creativo/application/identity';
import { CLOCK } from '@creativo/application/shared';
import {
  UiButton,
  UiChip,
  UiDateField,
  UiDateFieldBlurEvent,
  UiDateFieldParts,
  UiIcon,
  UiPhoneField,
  UiTextField,
  UiProgressView,
} from '@creativo/ui/controls';
import { UiFlow, UiSpacer, UiStack, UiToolbar } from '@creativo/ui/layout';
import {
  UiConfetti,
  UiPageActionBar,
  UiSectionHeader,
  UiStepper,
} from '@creativo/ui/patterns';
import {
  UiFrameDirective,
  UiPaddingDirective,
  UiRevealDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { translateDomainError } from '@creativo/infrastructure/i18n';
import { OnboardingFlowStore } from '../onboarding-flow.store';

/**
 * `/onboarding` — about → reward → services → birthday → avatar →
 * entering, `OnboardingFlowStore`-driven (blueprint §5.3, design doc
 * §2.5–2.6). The required about form is deliberately minimal (names +
 * phone); the optional birthday lives in the personalization phase as its
 * own skippable step (progressive disclosure — rarely-filled optional
 * fields never tax the required path).
 * Route-guarded by `anonGuard` (bounces only true anonymous visitors to
 * `/auth`); an authed-but-inactive visitor always resumes here at `about`
 * (no cross-reload progress persistence, matching the flow's own
 * statelessness — v2 does the same). No popstate listener — `back()` is
 * the flow's own explicit event.
 *
 * Strategy-driven about step: the fields rendered are exactly
 * `strategy.required` minus the identifier's own channel (which the login
 * already proved — `RegisterUserUseCase` applies the same fallback). Under
 * a phone-OTP deployment there is NO phone input here; under email-OTP the
 * composite `ui-phone-field` collects it, primed with the honest
 * "your salon may need to call you" hint. (An email input for a
 * phone-identified user is deliberately not built — no strategy requires
 * `email` beyond its own login channel today.)
 */
@Component({
  selector: 'lib-client-onboarding',
  imports: [
    TranslocoDirective,
    UiButton,
    UiChip,
    UiConfetti,
    UiDateField,
    UiFlow,
    UiFrameDirective,
    UiIcon,
    UiPageActionBar,
    UiPhoneField,
    UiRevealDirective,
    UiSectionHeader,
    UiStepper,
    UiTextField,
    UiToolbar,
    UiPaddingDirective,
    UiSpacer,
    UiProgressView,
    UiStack,
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

  /** Country names in the picker follow the active UI language, not LOCALE_ID. */
  protected readonly activeLang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  private readonly redirect = computed(() =>
    RedirectPath.parseOrRoot(this.route.snapshot.queryParamMap.get('redirect')),
  );

  /* ── About step (fields from strategy.required, design §2.5) ────── */

  /** The login channel — subtracted from `strategy.required` below. */
  private readonly identifierKind = identifierKindForStrategy(
    this.store.deployment.strategy,
  );
  protected readonly needsFirstName = authStrategyRequires(
    this.store.deployment.strategy,
    'firstName',
  );
  protected readonly needsLastName = authStrategyRequires(
    this.store.deployment.strategy,
    'lastName',
  );
  /** Phone renders ONLY when required and not already the login channel (email-OTP deployments). */
  protected readonly needsPhone =
    authStrategyRequires(this.store.deployment.strategy, 'phone') &&
    this.identifierKind !== 'phone';

  protected readonly defaultCountry = this.store.deployment.defaultCountry;

  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  /** Selected picker country (two-way with `ui-phone-field`). */
  protected readonly phoneCountry = signal<CountryIso2 | undefined>(undefined);
  /** Canonical E.164 from `ui-phone-field` — null while the draft is invalid. */
  protected readonly phoneValue = signal<string | null>(null);
  /** Reason from `PhoneNumber.create` — set on blur/submit, cleared live once the draft turns valid (reward early, punish late). */
  protected readonly phoneErrorReason = signal<PhoneNumberInvalidReason | null>(
    null,
  );

  /* ── Optional birthday step (personalization phase — rewards may offer
        birthday presents) ────────────────────────────────────────────── */

  /** "Today" for the age window — sourced from the Clock port (§7.1: never a raw `Date`), UTC like the server's own check. `null` only if the hardcoded zone were ever invalid (unreachable); validation then falls through to the use-case backstop. */
  private readonly today: ZonedDateTime | null = (() => {
    const result = inject(CLOCK).now('UTC');
    return result.isSuccess() ? result.value : null;
  })();

  /** Complete segments from `ui-date-field` — null while empty/unfinished. */
  protected readonly birthValue = signal<UiDateFieldParts | null>(null);
  /** Domain error from `BirthDate.create` — set on blur/submit, cleared live once the date turns valid (same reward-early grammar as the phone). `'partial'` marks an unfinished group left behind. */
  private readonly birthErrorState = signal<BirthDateError | 'partial' | null>(
    null,
  );

  /** Save gates on a complete, VO-valid date — an empty group's exit is the Skip affordance, never a dead primary. */
  protected readonly canSubmitBirthday = computed(() => {
    const parts = this.birthValue();
    return (
      parts !== null &&
      this.today !== null &&
      BirthDate.create(parts, this.today).isSuccess()
    );
  });

  protected readonly canSubmitAbout = computed(
    () =>
      (!this.needsFirstName || this.firstName().trim() !== '') &&
      (!this.needsLastName || this.lastName().trim() !== '') &&
      (!this.needsPhone || this.phoneValue() !== null),
  );

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

  constructor() {
    // Reward early: the punishing copy goes away the moment the phone
    // draft turns valid (errors themselves only ever appear on blur/submit).
    effect(() => {
      if (this.phoneValue() !== null) {
        this.phoneErrorReason.set(null);
      }
    });
    // Same grammar for the birthday: the moment the completed segments form
    // a valid date, any quiet error clears live.
    effect(() => {
      const parts = this.birthValue();
      if (
        parts !== null &&
        this.today !== null &&
        BirthDate.create(parts, this.today).isSuccess()
      ) {
        this.birthErrorState.set(null);
      }
    });

    // An already-ACTIVE account has nothing to do on the About form —
    // registration is complete, identity + profile exist. This is the
    // refresh-after-registration case (owner report 2026-07-26): the store
    // now warms the claims right after registering, so a reload classifies
    // `active` and bounces to the destination instead of re-presenting an
    // empty required form. Guarded to the untouched `about` state so an
    // in-session personalization run (which also turns `active`) is never
    // yanked.
    void this.bounceActiveAccount();
  }

  private async bounceActiveAccount(): Promise<void> {
    const settled = await firstValueFrom(
      this.store.observeSettled().pipe(filter((s) => s !== 'loading')),
    );
    if (settled === 'active' && this.store.state().kind === 'about') {
      await this.router.navigateByUrl(this.redirect().authDestination().value);
    }
  }

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

  /**
   * Reason-mapped, example-bearing phone copy (design §2.5): the kernel's
   * stable `PhoneNumberInvalidReason` maps 1:1 onto
   * `errors.identity.phone.*` keys, each interpolating a REAL example
   * number for the effective country so the fix is shown, not described.
   */
  protected phoneError(): string | null {
    const reason = this.phoneErrorReason();
    if (!reason) return null;
    const example =
      examplePhoneNumber(this.phoneCountry() ?? this.defaultCountry) ?? '';
    return translateDomainError(this.transloco, {
      code: `identity.phone.${reason.replace(/-/g, '_')}`,
      params: { example },
    });
  }

  /** `ui-phone-field` validate-on-blur — never on keystroke (design §2.5). */
  protected onPhoneBlur(fieldText: string): void {
    if (fieldText.trim() === '' || this.phoneValue() !== null) return;
    const result = PhoneNumber.create(
      fieldText,
      this.phoneCountry() ?? this.defaultCountry,
    );
    this.phoneErrorReason.set(result.isFailure() ? result.error.reason : null);
  }

  /**
   * Quiet, reason-mapped birthday copy — the `BirthDate` VO's stable codes
   * (`identity.birth_date.*`) map straight onto the error catalog; an
   * unfinished group reads as the generic `invalid`.
   */
  protected birthError(): string | null {
    const state = this.birthErrorState();
    if (state === null) return null;
    if (state === 'partial') {
      return translateDomainError(this.transloco, {
        code: 'identity.birth_date.invalid',
      });
    }
    return translateDomainError(this.transloco, {
      code: state.code,
      params: state.params,
    });
  }

  /** `ui-date-field` validate-on-blur — never on keystroke; an untouched (empty) optional field stays silent. */
  protected onBirthBlur(event: UiDateFieldBlurEvent): void {
    if (event.kind === 'empty') {
      this.birthErrorState.set(null);
      return;
    }
    if (event.kind === 'partial') {
      this.birthErrorState.set('partial');
      return;
    }
    if (this.today === null) return;
    const result = BirthDate.create(event.parts, this.today);
    this.birthErrorState.set(result.isFailure() ? result.error : null);
  }

  protected submitAbout(): void {
    const fields: Partial<Record<RegistrationField, string>> = {};
    if (this.needsFirstName) fields.firstName = this.firstName();
    if (this.needsLastName) fields.lastName = this.lastName();
    if (this.needsPhone) {
      const phone = this.phoneValue();
      if (phone === null) {
        // Unreachable through the UI (the CTA gates on `canSubmitAbout`),
        // kept as the honest validate-on-submit backstop.
        this.phoneErrorReason.set('invalid');
        return;
      }
      fields.phone = phone;
    }
    void this.store.submitAbout(fields);
  }

  /** Quiet inline copy for a failed birthday SAVE (use-case/port failure) — the flow state carries the stable code, `translateDomainError` maps it. */
  protected birthdaySaveError(): string | undefined {
    const state = this.store.state();
    return state.kind === 'birthday' ? state.error : undefined;
  }

  /** Birthday-step Save — the CTA gates on `canSubmitBirthday`, the VO check here is the honest validate-on-submit backstop (same grammar as the phone). */
  protected submitBirthdayNow(): void {
    const parts = this.birthValue();
    if (parts === null || this.today === null) return;
    const result = BirthDate.create(parts, this.today);
    if (result.isFailure()) {
      this.birthErrorState.set(result.error);
      return;
    }
    void this.store.submitBirthday(parts);
  }

  protected skipBirthdayNow(): void {
    this.store.skipBirthday();
  }

  /** Footer escape hatch — sign out, then land on neutral ground. */
  protected async signOutNow(): Promise<void> {
    await this.store.signOut();
    await this.router.navigateByUrl('/');
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
