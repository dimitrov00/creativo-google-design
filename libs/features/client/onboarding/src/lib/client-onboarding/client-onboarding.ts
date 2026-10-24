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
  AuthStrategy,
  type CountryIso2,
  OnboardingFlowStep,
  Principal,
  RegistrationField,
  type RegistrationFields,
} from '@core/components';
import type { Service } from '@core/entities';
import {
  IdentifierChannel,
  RedirectPath,
  type ServiceId,
} from '@core/primitives';
import {
  type IdentityError,
  IdentityErrorCode,
  PhoneErrorCode,
  PhoneInvalidReason,
} from '@core/errors';
import {
  AgeSystem,
  AvatarSystem,
  OfferingPriceSystem,
  PERSONALIZE_STEPS,
  type PersonalizeStep,
  PhoneSystem,
  ProfileCompletionKey,
  SettledVerdict,
} from '@core/systems';
import { formatCents } from '@creativo/ui/wall-clock';
import {
  CatalogContentService,
  ServiceCardComponent,
  ServiceDetailSheetComponent,
  type ServiceVm,
  formatServiceMeta,
} from '@creativo/features/shared/catalog';
import {
  UiAvatar,
  UiButton,
  UiDateField,
  UiDateFieldBlurEvent,
  UiDateFieldFill,
  UiDateFieldParts,
  UiIcon,
  UiPhoneField,
  UiTextField,
  UiProgressView,
} from '@creativo/ui/controls';
import { UiGrid, UiSpacer, UiStack, UiToolbar } from '@creativo/ui/layout';
import {
  UiRewardMoment,
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
import {
  ageDayOf,
  nameRefusalCodes,
} from '@creativo/features/client/account-state';
import { CLOCK_PORTS } from '@creativo/infrastructure/firebase-app';
import { translateCodedError } from '@creativo/infrastructure/i18n';
import { OnboardingFlowStore } from '../onboarding-flow.store';
import { ONBOARDING_SERVICES_CAP } from '../services-cap';

/**
 * The `data-state` word per flow step — the lowercase spelling the e2e
 * suite and the stylesheet read (Phase 4a 4A-10: one table, the step's
 * SCREAMING dictionary mapped once).
 */
const ONBOARDING_STEP_WORDS = {
  [OnboardingFlowStep.About]: 'about',
  [OnboardingFlowStep.Reward]: 'reward',
  [OnboardingFlowStep.Services]: 'services',
  [OnboardingFlowStep.Birthday]: 'birthday',
  [OnboardingFlowStep.Avatar]: 'avatar',
  [OnboardingFlowStep.Entering]: 'entering',
} as const satisfies Record<OnboardingFlowStep, string>;

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
 * already proved — `registerUser` applies the same fallback). Under
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
    ServiceCardComponent,
    ServiceDetailSheetComponent,
    UiAvatar,
    UiButton,
    UiRewardMoment,
    UiDateField,
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
    '[attr.data-state]': 'stepWord()',
  },
})
export class ClientOnboarding {
  /**
   * The live catalogue with its media resolved — the SAME source `/book`
   * reads. Onboarding used to run its own two subscriptions and its own
   * cover cache, which marked a cover requested before it answered and
   * never unmarked it (a cover that failed once stayed on its placeholder
   * for the session), and mapped services with no art direction (an empty
   * gallery in the shared detail sheet).
   */
  private readonly catalog = inject(CatalogContentService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  /** The profile snapshot the resume computes its remaining steps from. */
  private readonly identity = inject(SessionIdentityService);

  protected readonly store = inject(OnboardingFlowStore);
  protected readonly OnboardingFlowStep = OnboardingFlowStep;

  /** The flow step as its `data-state` word. */
  protected readonly stepWord = computed(
    () => ONBOARDING_STEP_WORDS[this.store.state().onboardingFlowStep],
  );

  /** Country names in the picker follow the active UI language, not LOCALE_ID. */
  protected readonly activeLang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  private readonly redirect = computed(() =>
    RedirectPath.parseOrRoot(this.route.snapshot.queryParamMap.get('redirect')),
  );

  /* ── About step (fields from strategy.required, design §2.5) ────── */

  /** The login channel — subtracted from `strategy.required` below. */
  private readonly identifierChannel = AuthStrategy.identifierKind(
    this.store.deployment.strategy,
  );
  protected readonly needsFirstName = AuthStrategy.requires(
    this.store.deployment.strategy,
    RegistrationField.FirstName,
  );
  protected readonly needsLastName = AuthStrategy.requires(
    this.store.deployment.strategy,
    RegistrationField.LastName,
  );
  /** Phone renders ONLY when required and not already the login channel (email-OTP deployments). */
  protected readonly needsPhone =
    AuthStrategy.requires(
      this.store.deployment.strategy,
      RegistrationField.Phone,
    ) && this.identifierChannel !== IdentifierChannel.Phone;

  protected readonly defaultCountry = this.store.deployment.defaultCountry;

  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  /** Name-rule error codes (`ProfileEditSystem.nameRefusals`, through `nameRefusalCodes`) — set on blur/submit, cleared live once the draft turns valid (reward early, punish late; the SAME rule the server's registration applies, so a submit can never be rejected for a reason the form didn't already show). */
  protected readonly firstNameErrorCode = signal<string | null>(null);
  protected readonly lastNameErrorCode = signal<string | null>(null);
  /** Selected picker country (two-way with `ui-phone-field`). */
  protected readonly phoneCountry = signal<CountryIso2 | null>(null);
  /** Canonical E.164 from `ui-phone-field` — null while the draft is invalid. */
  protected readonly phoneValue = signal<string | null>(null);
  /** Reason from `PhoneSystem.parse` — set on blur/submit, cleared live once the draft turns valid (reward early, punish late). */
  protected readonly phoneErrorReason = signal<PhoneInvalidReason | null>(null);

  /* ── Optional birthday step (personalization phase — rewards may offer
        birthday presents) ────────────────────────────────────────────── */

  /** The day the age window is judged on — the UTC civil date, from the clock port (§7.1: never a raw `Date`), like the server's own check. */
  private readonly ageDay = ageDayOf(inject(CLOCK_PORTS));

  /** Complete segments from `ui-date-field` — null while empty/unfinished. */
  protected readonly birthValue = signal<UiDateFieldParts | null>(null);
  /** The refusal from `AgeSystem.fromParts` — set on blur/submit, cleared live once the date turns valid (same reward-early grammar as the phone). `'partial'` marks an unfinished group left behind. */
  private readonly birthErrorState = signal<IdentityError | 'partial' | null>(
    null,
  );

  /** Save gates on a complete, VO-valid date — an empty group's exit is the Skip affordance, never a dead primary. */
  protected readonly canSubmitBirthday = computed(() => {
    const parts = this.birthValue();
    return parts !== null && AgeSystem.fromParts(parts, this.ageDay).ok;
  });

  /** The two name drafts through the ONE name rule the write enforces. */
  private readonly nameRefusals = computed(() =>
    nameRefusalCodes(this.firstName(), this.lastName()),
  );

  protected readonly canSubmitAbout = computed(() => {
    const refused = this.nameRefusals();
    return (
      (!this.needsFirstName || refused.firstName === null) &&
      (!this.needsLastName || refused.lastName === null) &&
      (!this.needsPhone || this.phoneValue() !== null)
    );
  });

  protected readonly services = this.catalog.services;
  protected readonly selectedServiceIds = signal<readonly ServiceId[]>([]);

  /* ── Services grid (capped multi-select, design: image-forward cards) ── */

  /** Deployment-configurable selection ceiling (default 3). */
  protected readonly servicesCap = inject(ONBOARDING_SERVICES_CAP);
  protected readonly selectionCount = computed(
    () => this.selectedServiceIds().length,
  );
  protected readonly capReached = computed(
    () => this.selectionCount() >= this.servicesCap,
  );

  /** The service whose details sheet is open (null = shut). */
  protected readonly detailsService = signal<Service | null>(null);

  /* ── Shared service-detail sheet ──────────────────────────────────────
     The SAME `cr-service-detail-sheet` the landing renders — gallery,
     variant capsules, bundle members, performer cards and all. Onboarding
     projects its own `[sheet-actions]` (select/remove instead of book) and
     changes nothing else, which is the whole point: a second hand-rolled
     body is how two surfaces drift apart. */

  /** Performers, mapped for the sheet — avatars resolved, art direction applied. */
  protected readonly barberVms = this.catalog.barberVms;

  /** Every service as a view model — the sheet resolves bundle members against it. */
  protected readonly serviceVms = this.catalog.serviceVms;

  /** The open service as a view model, or null when the sheet is shut. */
  protected readonly detailsVm = computed<ServiceVm | null>(() => {
    const service = this.detailsService();
    return service ? this.catalog.toServiceVm(service) : null;
  });

  /** Id-keyed twins of the entity helpers — the sheet hands back view models, not entities. */
  protected isServiceSelectedById(id: string): boolean {
    return this.selectedServiceIds().some((existing) => existing === id);
  }

  /** Following a reference inside the sheet reopens it on that service (one surface, one subject). */
  protected openDetailsById(id: string): void {
    const service = this.services().find((s) => s.id === id);
    if (service) this.detailsService.set(service);
  }

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
    // Same grammar for the names — one effect per field, keyed on its rule.
    effect(() => {
      if (this.nameRefusals().firstName === null) {
        this.firstNameErrorCode.set(null);
      }
    });
    effect(() => {
      if (this.nameRefusals().lastName === null) {
        this.lastNameErrorCode.set(null);
      }
    });
    // Same grammar for the birthday: the moment the completed segments form
    // a valid date, any quiet error clears live.
    effect(() => {
      const parts = this.birthValue();
      if (parts !== null && AgeSystem.fromParts(parts, this.ageDay).ok) {
        this.birthErrorState.set(null);
      }
    });

    inject(DestroyRef).onDestroy(() => this.revokeAvatarPreview());

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
      this.store
        .observeSettled()
        .pipe(filter((verdict) => verdict !== SettledVerdict.Loading)),
    );
    if (
      settled !== SettledVerdict.Active ||
      this.store.state().onboardingFlowStep !== OnboardingFlowStep.About
    ) {
      return;
    }

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
          RedirectPath.authDestination(this.redirect()),
        );
        return;
      }
      this.store.beginPersonalization(remaining);
      return;
    }
    await this.router.navigateByUrl(
      RedirectPath.authDestination(this.redirect()),
    );
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
      progress.items
        .filter((item) => !item.done)
        .map((item) => item.profileCompletionKey),
    );
    return PERSONALIZE_STEPS.filter(
      (step) =>
        (step === OnboardingFlowStep.Birthday &&
          open.has(ProfileCompletionKey.Birthday)) ||
        (step === OnboardingFlowStep.Avatar &&
          open.has(ProfileCompletionKey.Photo)),
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
    if (principal !== null && Principal.isActive(principal)) {
      await this.router.navigateByUrl(
        RedirectPath.authDestination(this.redirect()),
      );
      return;
    }
    // Either a hard gateway failure (`null`) or the backoff exhausted
    // still on `onboarding` — both land the visitor on a retry affordance
    // rather than silently stranding them on a blank "entering" screen.
    this.enteringFailed.set(true);
  }

  protected translateError(code: string | undefined | null): string | null {
    if (!code) return null;
    return translateCodedError(this.transloco, { errorCode: code });
  }

  protected currentError(): string | null {
    const state = this.store.state();
    return state.onboardingFlowStep === OnboardingFlowStep.About
      ? state.error
      : null;
  }

  /**
   * Reason-worded, example-bearing phone copy (design §2.5): the stable
   * `PhoneInvalidReason` IS the reason segment of its
   * `errors.PHONE_INVALID.<reason>` key (nothing mapped), each
   * interpolating a REAL example number for the effective country so the
   * fix is shown, not described.
   */
  protected phoneError(): string | null {
    const reason = this.phoneErrorReason();
    if (!reason) return null;
    const example =
      PhoneSystem.example(this.phoneCountry() ?? this.defaultCountry) ?? '';
    return translateCodedError(
      this.transloco,
      { errorCode: PhoneErrorCode.Invalid, example },
      reason,
    );
  }

  /** Name validate-on-blur — an untouched (empty) field stays silent; the disabled CTA already says "not done", a red line would say "wrong" (punish late). */
  protected onFirstNameBlur(): void {
    if (this.firstName().trim() === '') return;
    this.firstNameErrorCode.set(this.nameRefusals().firstName);
  }

  protected onLastNameBlur(): void {
    if (this.lastName().trim() === '') return;
    this.lastNameErrorCode.set(this.nameRefusals().lastName);
  }

  /** `ui-phone-field` validate-on-blur — never on keystroke (design §2.5). */
  protected onPhoneBlur(fieldText: string): void {
    if (fieldText.trim() === '' || this.phoneValue() !== null) return;
    const result = PhoneSystem.parse(
      fieldText,
      this.phoneCountry() ?? this.defaultCountry,
    );
    this.phoneErrorReason.set(
      result.ok
        ? null
        : result.error.errorCode === PhoneErrorCode.Invalid
          ? result.error.reason
          : PhoneInvalidReason.InvalidCountry,
    );
  }

  /**
   * Quiet, reason-mapped birthday copy — `AgeSystem`'s stable error structs
   * (`IDENTITY_BIRTH_DATE_*`, their own fields the params) map straight onto
   * the error catalog; an unfinished group reads as the generic `invalid`.
   */
  protected birthError(): string | null {
    const state = this.birthErrorState();
    if (state === null) return null;
    if (state === 'partial') {
      return translateCodedError(this.transloco, {
        errorCode: IdentityErrorCode.BirthDateInvalid,
      });
    }
    return translateCodedError(this.transloco, state);
  }

  /** `ui-date-field` validate-on-blur — never on keystroke; an untouched (empty) optional field stays silent. */
  protected onBirthBlur(event: UiDateFieldBlurEvent): void {
    if (event.uiDateFieldFill === UiDateFieldFill.Empty) {
      this.birthErrorState.set(null);
      return;
    }
    if (event.uiDateFieldFill === UiDateFieldFill.Partial) {
      this.birthErrorState.set('partial');
      return;
    }
    const result = AgeSystem.fromParts(event.parts, this.ageDay);
    this.birthErrorState.set(result.ok ? null : result.error);
  }

  protected submitAbout(): void {
    let phone: string | null = null;
    if (this.needsPhone) {
      phone = this.phoneValue();
      if (phone === null) {
        // Unreachable through the UI (the CTA gates on `canSubmitAbout`),
        // kept as the honest validate-on-submit backstop.
        this.phoneErrorReason.set(PhoneInvalidReason.Invalid);
        return;
      }
    }
    // Every key present: a field the form did not collect is `null`.
    const fields: RegistrationFields = {
      [RegistrationField.Phone]: phone,
      [RegistrationField.Email]: null,
      [RegistrationField.FirstName]: this.needsFirstName
        ? this.firstName()
        : null,
      [RegistrationField.LastName]: this.needsLastName ? this.lastName() : null,
      [RegistrationField.BirthDate]: null,
    };
    void this.store.submitAbout(fields);
  }

  /** Quiet inline copy for a failed birthday SAVE (a refused or failed `updateProfile` call) — the flow state carries the stable code, `translateCodedError` words it. */
  protected birthdaySaveError(): string | null {
    const state = this.store.state();
    return state.onboardingFlowStep === OnboardingFlowStep.Birthday
      ? state.error
      : null;
  }

  /** Birthday-step Save — the CTA gates on `canSubmitBirthday`, the age check here is the honest validate-on-submit backstop (same grammar as the phone). */
  protected submitBirthdayNow(): void {
    const parts = this.birthValue();
    if (parts === null) return;
    const result = AgeSystem.fromParts(parts, this.ageDay);
    if (!result.ok) {
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

  /** Value-compared (a branded string — a snapshot re-emit hands back the same id). Adding past the cap is a no-op: the card is disabled, this is the honest backstop. */
  protected toggleService(id: ServiceId): void {
    const current = this.selectedServiceIds();
    if (this.isServiceSelected(id)) {
      this.selectedServiceIds.set(
        current.filter((existing) => existing !== id),
      );
      return;
    }
    if (this.capReached()) return;
    this.selectedServiceIds.set([...current, id]);
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

  protected serviceDescription(service: Service): string {
    return this.transloco.getActiveLang() === 'en'
      ? service.description.en
      : service.description.bg;
  }

  /**
   * "45 мин · 15,00 €", or "35–50 мин · от 13,00 €" once barbers price the
   * service differently — one pre-formatted line shared by card and sheet.
   *
   * Reads the terms matrix's folded RANGES (`OfferingPriceSystem`), not
   * one canonical price: with a
   * barber × variant matrix there is no single number to show before the
   * customer has picked either, so the grid quotes the cheapest and says
   * so. `priceRange().min === max` collapses back to a bare price, which
   * is what a service nobody prices differently should look like.
   *
   * The SHAPE of the line — which fact leads, where the "from" goes — comes
   * from `formatServiceMeta`, because booking's grid renders the same card
   * and its own copy of this had already drifted away from it. Only the
   * inputs are local: onboarding folds them off the service entity, and
   * formats the cents with the currency's own exponent (`formatCents`).
   */
  protected serviceMeta(service: Service): string {
    const lang = this.transloco.getActiveLang();
    const locale = lang === 'en' ? 'en-GB' : 'bg-BG';

    const duration = OfferingPriceSystem.durationRange(service);
    const minutes = this.transloco.translate('onboarding.services.minutes', {
      minutes:
        duration.min === duration.max
          ? duration.min
          : `${duration.min}–${duration.max}`,
    });

    // `formatCents` reads the currency's own exponent and fraction digits —
    // the old inline formatter divided by a hardcoded 100 and forced
    // `maximumFractionDigits: 0`, printing `28 лв.` for a price the rest of
    // the app renders as `28,00 €`. Every price of one service shares its
    // currency (the one-currency invariant of the matrix).
    const { min, max } = OfferingPriceSystem.priceRange(service);
    return formatServiceMeta({
      duration: minutes,
      price: formatCents(min, service.currency, locale),
      fromLabel: this.transloco.translate('onboarding.services.from'),
      spread: min !== max,
    });
  }

  /**
   * Null while unknown, and for good once Storage says the cover is gone —
   * the card's scissors fallback IS that state. Read off the service in
   * hand (`coverUrlOf`), not by id: every card asks on every pass, and a
   * search of the catalogue per card made the grid quadratic.
   */
  protected serviceCoverUrl(service: Service): string | null {
    return this.catalog.coverUrlOf(service) ?? null;
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

    const checked = AvatarSystem.check({
      contentType: file.type,
      sizeBytes: file.size,
    });
    if (!checked.ok) {
      this.avatarErrorCode.set(checked.error.errorCode);
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
      // The header portrait and /account read ONE shared lookup; the uploader
      // tells it a new photo landed (`SessionIdentityService.refreshAvatar`).
      this.identity.refreshAvatar();
    }
    this.store.enterApp();
    await this.finishEntering();
  }
}
