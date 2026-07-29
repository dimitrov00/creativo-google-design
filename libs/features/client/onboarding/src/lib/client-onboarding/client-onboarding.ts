import {
  Component,
  DestroyRef,
  Injector,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService, TranslocoDirective } from '@jsverse/transloco';
import {
  FirstName,
  LastName,
  MAX_AVATAR_BYTES,
} from '@creativo/application/accounts';
import {
  CATALOG_READER,
  MEDIA_READER,
  Service,
  ServiceId,
  formatMoney,
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
  UiAsyncImage,
  UiAvatar,
  UiButton,
  UiDateField,
  UiDateFieldBlurEvent,
  UiDateFieldParts,
  UiDetailSheet,
  UiIcon,
  UiPhoneField,
  UiTextField,
  UiProgressView,
} from '@creativo/ui/controls';
import { UiGrid, UiSpacer, UiStack, UiToolbar } from '@creativo/ui/layout';
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
import { SessionIdentityService } from '@creativo/features/shared/shell';
import { translateDomainError } from '@creativo/infrastructure/i18n';
import {
  OnboardingFlowStore,
  PERSONALIZE_STEPS,
  PersonalizeStep,
} from '../onboarding-flow.store';
import { ONBOARDING_SERVICES_CAP } from '../services-cap';
import { OnboardingServiceCard } from '../service-card/onboarding-service-card';

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
    OnboardingServiceCard,
    UiAsyncImage,
    UiAvatar,
    UiButton,
    UiConfetti,
    UiDateField,
    UiDetailSheet,
    UiFrameDirective,
    UiGrid,
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
  private readonly injector = inject(Injector);
  /** The profile snapshot the resume computes its remaining steps from. */
  private readonly identity = inject(SessionIdentityService);

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
  /** VO error codes from `FirstName`/`LastName` — set on blur/submit, cleared live once the draft turns valid (reward early, punish late; the SAME validators `RegisterUserUseCase` and the server apply, so a submit can never be rejected for a reason the form didn't already show). */
  protected readonly firstNameErrorCode = signal<string | null>(null);
  protected readonly lastNameErrorCode = signal<string | null>(null);
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
      (!this.needsFirstName ||
        FirstName.create(this.firstName()).isSuccess()) &&
      (!this.needsLastName || LastName.create(this.lastName()).isSuccess()) &&
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

  /* ── Services grid (capped multi-select, design: image-forward cards) ── */

  private readonly mediaReader = inject(MEDIA_READER);

  /** Deployment-configurable selection ceiling (default 3). */
  protected readonly servicesCap = inject(ONBOARDING_SERVICES_CAP);
  protected readonly selectionCount = computed(
    () => this.selectedServiceIds().length,
  );
  protected readonly capReached = computed(
    () => this.selectionCount() >= this.servicesCap,
  );

  /** Resolved cover URLs by service id — filled as `MEDIA_READER` answers. */
  protected readonly coverUrls = signal<Readonly<Record<string, string>>>({});
  /** Ids with a resolve already in flight — a snapshot re-emit must not re-fetch. */
  private readonly coverRequests = new Set<string>();

  /** The service whose details sheet is open (null = shut). */
  protected readonly detailsService = signal<Service | null>(null);

  protected readonly enteringFailed = signal(false);

  /* ── Optional avatar step ───────────────────────────────────────────
     The big monogram avatar is the entire step: initials from the names
     the About form just collected, a picked image previews INSTANTLY via
     an object URL (no network), and the actual Storage upload happens
     inside the ONE primary exit. No separate Skip — with nothing picked
     the primary IS the skip (the old pair did the identical thing). */

  /** Staged image — chosen locally, uploaded only when entering the app. */
  protected readonly avatarFile = signal<File | null>(null);
  /** Local preview object URL for the staged file (revoked on replace/destroy). */
  protected readonly avatarPreviewUrl = signal<string | null>(null);
  /** Stable error code under the avatar — picker rejections and upload failures share the line. */
  protected readonly avatarErrorCode = signal<string | null>(null);
  /** Monogram source — the names collected two steps ago (same component instance). */
  protected readonly fullName = computed(() =>
    `${this.firstName()} ${this.lastName()}`.trim(),
  );

  constructor() {
    // Reward early: the punishing copy goes away the moment the phone
    // draft turns valid (errors themselves only ever appear on blur/submit).
    effect(() => {
      if (this.phoneValue() !== null) {
        this.phoneErrorReason.set(null);
      }
    });
    // Same grammar for the names — one effect per field, keyed on its VO.
    effect(() => {
      if (FirstName.create(this.firstName()).isSuccess()) {
        this.firstNameErrorCode.set(null);
      }
    });
    effect(() => {
      if (LastName.create(this.lastName()).isSuccess()) {
        this.lastNameErrorCode.set(null);
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

    inject(DestroyRef).onDestroy(() => this.revokeAvatarPreview());

    // Resolve each service's cover exactly once as the catalog streams in
    // (MediaRef → servable URL is the media reader port's job; failures
    // stay silent — the card's scissors fallback IS the degraded state).
    effect(() => {
      for (const service of this.services()) {
        const id = service.id.value;
        if (!service.cover || this.coverRequests.has(id)) continue;
        this.coverRequests.add(id);
        void this.mediaReader.resolve(service.cover).then((result) => {
          if (result.isFailure()) return;
          const [variant] = result.value;
          if (!variant) return;
          this.coverUrls.update((urls) => ({ ...urls, [id]: variant.url }));
        });
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
    if (settled !== 'active' || this.store.state().kind !== 'about') return;

    // `?phase=personalize` (the menu's finish-your-profile row): an ACTIVE
    // account re-enters the flow at the personalization phase instead of
    // being bounced — the About form is already satisfied. Which steps it
    // shows is COMPUTED from the profile, not taken from the URL: someone
    // who set their birthday from the profile screen must never be asked
    // for it again just because a link said so.
    if (this.route.snapshot.queryParamMap.get('phase') === 'personalize') {
      const remaining = await this.remainingPersonalizeSteps();
      if (remaining.length === 0) {
        // Nothing left — the profile was finished elsewhere (or between
        // the tap and the arrival). Don't present an empty flow.
        await this.router.navigateByUrl(
          this.redirect().authDestination().value,
        );
        return;
      }
      this.store.beginPersonalization(remaining);
      return;
    }
    await this.router.navigateByUrl(this.redirect().authDestination().value);
  }

  /**
   * The open personalization steps for THIS profile, in flow order.
   * Waits for the profile snapshot and the avatar lookup to actually
   * settle — `profileProgress` is null only while in flight, which is the
   * whole reason it exists alongside `completion`.
   *
   * `services` is deliberately never included: nothing about a service
   * selection is persisted yet, so it can never be "done" and would nag on
   * every single resume. The steps offered are exactly the open items the
   * menu row counted.
   */
  private async remainingPersonalizeSteps(): Promise<
    readonly PersonalizeStep[]
  > {
    const progress = await firstValueFrom(
      toObservable(this.identity.profileProgress, {
        injector: this.injector,
      }).pipe(filter((value) => value !== null)),
    );
    const open = new Set(
      progress.items.filter((item) => !item.done).map((item) => item.key),
    );
    return PERSONALIZE_STEPS.filter(
      (step) =>
        (step === 'birthday' && open.has('birthday')) ||
        (step === 'avatar' && open.has('photo')),
    );
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

  protected translateError(code: string | undefined | null): string | null {
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

  /** Name validate-on-blur — an untouched (empty) field stays silent; the disabled CTA already says "not done", a red line would say "wrong" (punish late). */
  protected onFirstNameBlur(): void {
    if (this.firstName().trim() === '') return;
    const result = FirstName.create(this.firstName());
    this.firstNameErrorCode.set(result.isFailure() ? result.error.code : null);
  }

  protected onLastNameBlur(): void {
    if (this.lastName().trim() === '') return;
    const result = LastName.create(this.lastName());
    this.lastNameErrorCode.set(result.isFailure() ? result.error.code : null);
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

  /** Toolbar glass-back on the personalization steps — the flow machine's own `back` event (services → reward, birthday → services, avatar → birthday), never the browser's history. */
  protected goBack(): void {
    this.store.back();
  }

  /** Footer escape hatch — sign out, then land on neutral ground. */
  protected async signOutNow(): Promise<void> {
    await this.store.signOut();
    await this.router.navigateByUrl('/');
  }

  /** Value-compared (snapshot re-emits rebuild `ServiceId` instances — reference identity would silently break toggling). Adding past the cap is a no-op: the card is disabled, this is the honest backstop. */
  protected toggleService(id: ServiceId): void {
    const current = this.selectedServiceIds();
    if (this.isServiceSelected(id)) {
      this.selectedServiceIds.set(
        current.filter((existing) => existing.value !== id.value),
      );
      return;
    }
    if (this.capReached()) return;
    this.selectedServiceIds.set([...current, id]);
  }

  protected isServiceSelected(id: ServiceId): boolean {
    return this.selectedServiceIds().some(
      (existing) => existing.value === id.value,
    );
  }

  protected submitServices(): void {
    this.store.submitServices(this.selectedServiceIds());
  }

  protected serviceName(service: Service): string {
    return this.transloco.getActiveLang() === 'en'
      ? service.name.en
      : service.name.bg;
  }

  protected serviceDescription(service: Service): string {
    return this.transloco.getActiveLang() === 'en'
      ? service.description.en
      : service.description.bg;
  }

  /**
   * "45 мин · 15,00 €", or "35–50 мин · от 13,00 €" once barbers price the
   * service differently — one pre-formatted line shared by card and sheet.
   *
   * Reads the aggregate's folded RANGES, not one canonical price: with a
   * barber × variant matrix there is no single number to show before the
   * customer has picked either, so the grid quotes the cheapest and says
   * so. `priceRange().min === max` collapses back to a bare price, which
   * is what a service nobody prices differently should look like.
   */
  protected serviceMeta(service: Service): string {
    const lang = this.transloco.getActiveLang();
    const locale = lang === 'en' ? 'en-GB' : 'bg-BG';

    const duration = service.durationRange();
    const minutes = this.transloco.translate('onboarding.services.minutes', {
      minutes:
        duration.min === duration.max
          ? duration.min
          : `${duration.min}–${duration.max}`,
    });

    // `formatMoney` takes the VO and reads the currency's own exponent and
    // fraction digits — the old inline formatter divided by a hardcoded 100
    // and forced `maximumFractionDigits: 0`, printing `28 лв.` for a price
    // the rest of the app renders as `28,00 €`.
    const { min, max } = service.priceRange();
    const price = formatMoney(min, locale);
    const from = min.equals(max)
      ? ''
      : `${this.transloco.translate('onboarding.services.from')} `;
    return `${minutes} · ${from}${price}`;
  }

  protected serviceCoverUrl(service: Service): string | null {
    return this.coverUrls()[service.id.value] ?? null;
  }

  protected openDetails(service: Service): void {
    this.detailsService.set(service);
  }

  protected closeDetails(): void {
    this.detailsService.set(null);
  }

  protected toggleDetailsService(): void {
    const service = this.detailsService();
    if (service) this.toggleService(service.id);
  }

  protected retryEntering(): void {
    void this.finishEntering();
  }

  /**
   * Stages a picked image locally (instant object-URL preview, no network)
   * — the same client-side pre-checks the Storage rule enforces (image/*,
   * 5 MiB) run here so a doomed pick fails at pick time, quietly, instead
   * of at the final CTA.
   */
  protected onAvatarPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    // Same-file re-picks should still fire `change` next time.
    input.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.avatarErrorCode.set('accounts.upload_avatar.not_an_image');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      this.avatarErrorCode.set('accounts.upload_avatar.too_large');
      return;
    }

    this.revokeAvatarPreview();
    this.avatarErrorCode.set(null);
    this.avatarFile.set(file);
    this.avatarPreviewUrl.set(URL.createObjectURL(file));
  }

  private revokeAvatarPreview(): void {
    const url = this.avatarPreviewUrl();
    if (url) URL.revokeObjectURL(url);
    this.avatarPreviewUrl.set(null);
  }

  /**
   * The avatar step's ONE exit — uploads the staged image first when there
   * is one (a failure keeps the user on the step with the reason inline;
   * their picked photo must never silently vanish), then enters the app.
   * With nothing staged this IS the skip.
   */
  protected async enterAppNow(): Promise<void> {
    const file = this.avatarFile();
    if (file) {
      const errorCode = await this.store.uploadAvatar(file);
      if (errorCode) {
        this.avatarErrorCode.set(errorCode);
        return;
      }
    }
    this.store.enterApp();
    await this.finishEntering();
  }
}
