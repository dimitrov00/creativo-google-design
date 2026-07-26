# Auth + Onboarding Flow — Adopted Design (2026-07-25)

Produced by a research/design fleet (2 web researchers, 2 repo auditors, 2
competing designers). The HIG-first proposal below is adopted **with these
amendments**, which override the matching sections of the appendix:

1. **No routed sub-states.** `/auth` stays a single route with the in-page
   `AuthFlow` state machine (§1.2 and the route bindings in §3.3 of the
   appendix are NOT adopted). The codebase's documented decision stands:
   back-navigation between steps is the flow's own explicit `back()` /
   `change_identifier` event from an in-page control, never the browser's
   history API (`client-auth.ts` header comment). `/onboarding` likewise
   stays one route.
2. **Registration submit is honest, not optimistic.** The profile step shows
   `uiLoading` until `RegisterUserUseCase` settles; no rollback edge is added
   to the onboarding machine.
3. **The real transactional email sender is deferred.** `ConsoleLogOtpSender`
   remains this pass (emulator `devCode` drives dev + e2e). Wiring
   Postmark/Resend on the dedicated OTP identity (never the campaign
   identity) is a follow-up that needs a provider decision + credentials.

Additionally adopted from the conversion-first proposal:

- `completeRegistration` must verify the caller's auth context (bind
  registration to the verified session's uid).

Everything else — flow map, per-screen specs, copy, kernel country API,
`AuthDeployment`, `UiPhoneField` spec, slices — is as written below.

---

# /auth + /onboarding Design Proposal — Creativo (Trust & HIG-First lens)

Guiding principles applied throughout: delay sign-in until "Book" (HIG's top abandonment finding), one unmistakable primary action per screen, minimal data at each step, honest neutral errors (no account enumeration), explicit user control (visible Verify button, editable identifier, back always works), calm pacing (no stepper on auth, delayed auto-verify, countdown that never feels broken), and every requirement grounded in the existing DS vocabulary and repo seams identified by the audits.

---

## 1. Flow map

### 1.1 Entry policy (the biggest conversion decision)

Browsing salons/services/slots stays unauthenticated. `/auth` is triggered at the point of commitment ("Book"), carrying `?redirect=` (already open-redirect-safe via `RedirectPath`). The auth prompt is always paired with its benefit ("Sign in to hold your slot" — carried as contextual lede when a redirect is present). `/auth` keeps no guard (by design, per `apps/web/src/app/app.routes.ts:18-23`); `/onboarding` keeps `anonGuard`.

### 1.2 Routed states

Each flow state is a URL so browser-back is a legal state-machine transition, not a broken deep link:

```
/auth            → identify   (welcome collapsed into it — see below)
/auth/code       → otp
/onboarding      → profile (names + phone)
/onboarding/…    → reward → services → avatar → entering (existing personalization)
```

### 1.3 Full map

```
Landing "Book" CTA ──► /auth (identify)
   │  [email field · Continue · legal footer · (future: "or" + provider stack)]
   │
   ├─ invalid identifier ──► inline error, stay on identify
   ├─ request_failed(blocked) ──► blocked (terminal, calm cool-down copy)
   ├─ latched active principal ──► redirect().authDestination()   (already signed in)
   ├─ latched onboarding principal ──► /onboarding?redirect=…
   │
   └─ code sent ──► /auth/code (otp)
        │  ["We sent a 6-digit code to {email} · Edit" · OTP field ·
        │   delayed auto-verify + Verify button · Resend w/ countdown]
        │
        ├─ Edit / browser-back ──► /auth (identify, field pre-filled, code invalidated)
        ├─ resend ──► self (cooldown 30 s; escalation copy after 3 sends)
        ├─ wrong code ──► self, inline error, digits KEPT, attempts warning near limit only
        ├─ expired code ──► self, inline error + resend CTA (field cleared here only)
        ├─ verify_failed(blocked) ──► blocked (terminal)
        ├─ verified(returning) ──► authenticated ──► settling ──► redirect destination
        └─ verified(new) ──► done ──► /onboarding?redirect=…

/onboarding (profile)  [single REQUIRED step — no stepper]
   │  [first name · last name · ui-phone-field w/ priming hint · Continue ·
   │   "Signed in as {email} · Sign out" footer]
   ├─ browser-back ──► NOT to /auth/code (identity proven) — exits to app shell
   ├─ registration_failed ──► inline error, stay
   └─ registered ──► reward ──► services (skip) ──► avatar (skip) ──► entering ──► redirect
        (services/avatar labeled "Optional" — existing flow machine unchanged)
```

### 1.4 Where Google/Facebook/Apple slot in (zero rework)

Providers render on the **same** `/auth` identify screen: email field + Continue stays the hero; an "or" divider and a uniform provider stack (`ui-provider-button`) appear below when `AuthDeployment.providers` lists any OAuth provider. Google's "equal prominence" rule is satisfied because all third-party buttons are identical in size/shape; the email path is differentiated by being the field+CTA hero, not by shrinking providers. Choosing a provider dispatches a new `oauth_started` flow event that short-circuits identify/otp and lands in the same `verified`-terminal handling; OAuth sign-ins still funnel through `/onboarding` where `AuthStrategy.required` (which always contains `'phone'`, enforced by `validateRequired`) collects the phone. Budget a 4th slot for Sign in with Apple (App Store Guideline 4.8) the day a native iOS wrapper ships. No account picker, no "sign in vs sign up" fork — ever: the OTP proves ownership, and the server decides new-vs-returning (`SessionKind`).

### 1.5 Welcome step: retired

With one method, a welcome interstitial with a lone "Get started" button is a tap for nothing (research §5). The flow machine's initial state becomes `identify`; the `welcome` state and `get_started` event are removed (greenfield refactors are sanctioned). The identify screen absorbs welcome's job: brand eyebrow + value-line lede.

---

## 2. Per-screen specs

All pages: `<ng-container *transloco="let t">` wrapper; feature CSS ≈ `:host { display:block }`; every interactive element keeps a `data-testid`. Outer skeleton (canonical auth sandwich): `<ui-stack uiAlignment="center" uiSpacing="none" uiFrame uiFrameMinHeight="100svh" uiPaddingHorizontal="regular" uiPaddingVertical="spacious">` with `<ui-spacer/>` above and below an inner `<ui-stack uiSpacing="comfortable" uiFrame uiFrameMaxWidth="28rem">`.

### 2.1 /auth — Identify

**Layout (top→bottom inside the 28rem column):**

1. `ui-section-header uiAlignment="leading"` — `[uiEyebrow]` "Creativo" (eyebrow font), `[uiTitle]` `uiFont="largeTitle"` `t('auth.identify.title')`, `[uiLede]` `uiFont="body" uiForegroundStyle="secondary"` `t('auth.identify.lede')` — or, when `redirect` is present, the contextual benefit line `t('auth.identify.ledeBooking')`.
2. Field block (label convention): `<label><ui-stack uiSpacing="tight"><span uiText uiFont="footnote">{{ t('auth.identify.emailLabel') }}</span><input uiTextField uiControlSize="large" type="email" autocomplete="email" inputmode="email" autofocus [uiInvalid]="!!error" [attr.aria-describedby]="…"/></ui-stack></label>` — attrs branch on `identifierKind()` (email vs `type="tel" autocomplete="tel" inputmode="tel"` for phone_otp deployments, where the input is `ui-phone-field` instead).
3. Error: `<p uiText uiFont="footnote" uiForegroundStyle="destructive" role="alert">` under `@if`.
4. CTA: `<button uiButton uiButtonStyle="borderedProminent" uiControlSize="large" uiFrame uiFrameMaxWidth="infinity" [uiLoading]="store.pending()" [disabled]="…">{{ t('auth.identify.continue') }}</button>`.
5. (Future) `ui-divider` with centered "or" caption + `<ui-stack uiSpacing="compact">` of `ui-provider-button`s, all `uiControlSize="large"`.
6. Legal footer: `<p uiText uiFont="footnote" uiForegroundStyle="secondary">` with two `plain`-style inline links (Terms, Privacy) — plain footer links per SwiftUI-parity ruling.

**Motion:** staggered `uiReveal uiRevealTrigger="mount"` (header 0 ms, field 150 ms, CTA 300 ms) — the marketing motion tiers, used once, on entry only.

**Copy (en; bg mirrors):**

- `auth.identify.title`: "Log in or sign up"
- `auth.identify.lede`: "Book and manage your salon appointments."
- `auth.identify.ledeBooking`: "Sign in to hold your slot."
- `auth.identify.emailLabel`: "Email" · `auth.identify.phoneLabel`: "Phone number"
- `auth.identify.continue`: "Continue"
- `auth.identify.legal`: "By continuing you agree to the {terms} and {privacy}." · `terms`: "Terms" · `privacy`: "Privacy Policy"

**States:** idle · invalid (domain error via `translateDomainError`, field `uiInvalid`) · pending (`uiLoading`, field readonly) · blocked (routes to blocked view). **Anti-enumeration:** the app never reveals whether the email has an account — always sends, always advances to /auth/code. **Trust note:** validate on submit only (an email field punished per keystroke reads as hostile).

### 2.2 /auth/code — Enter the code

**Layout:**

1. Back affordance top-leading: `<button uiButton uiButtonStyle="plain" uiControlSize="small"><ui-icon uiName="nav.back"/> {{ t('auth.code.back') }}</button>` → `change_identifier` transition (identify, pre-filled). Browser-back does the same.
2. `ui-section-header`: `[uiTitle]` largeTitle `t('auth.code.title')`; `[uiLede]` body secondary: `t('auth.code.sentTo', { destination })` with the email in `uiWeight="semibold"`, followed inline by a `plain` small button `t('auth.code.edit')` → same transition.
3. `<ui-otp-field uiLength="6" [(value)]="rawCode" [uiInvalid]="!!error" data-testid="otp-input"/>` — autofocused on route entry (page context; the no-autofocus ruling applies to sheets). Underlying input semantics: `inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*"`, never `type="number"`; paste fully supported and distributed across slots (verify `UiOtpField` handles multi-char paste — see slice 7).
4. Error line: footnote destructive `role="alert"`, `aria-live="polite"`. Near-limit warning appears here too (only at ≤1 attempt remaining).
5. CTA: `borderedProminent large` `t('auth.code.verify')`, `uiFrameMaxWidth="infinity"`, `[uiLoading]="store.pending()"`. **Auto-verify:** on 6th digit, wait ~250 ms (visible "checking" — button flips to `uiLoading`, field disabled) then submit; suppressed entirely while an error from a previous attempt is displayed (user must edit first). The button remains the accessible/explicit path.
6. Resend row: `<ui-stack uiAxis="horizontal" uiSpacing="tight" uiAlignment="center">` — during cooldown a disabled `plain` button showing `t('auth.code.resendIn', { seconds })` with the countdown in an `aria-live="polite"` region (announce at 30/10/0, not every tick); after cooldown, enabled `plain` button `t('auth.code.resend')` with `<ui-icon uiName="auth.resend"/>`. Cooldown 30 s. After the 3rd send, add escalation footnote secondary: `t('auth.code.escalation')`.

**Copy:**

- `auth.code.title`: "Enter the code"
- `auth.code.sentTo`: "We sent a 6-digit code to {destination}" · `auth.code.edit`: "Edit" · `auth.code.back`: "Back"
- `auth.code.verify`: "Verify" · `auth.code.resend`: "Resend code" · `auth.code.resendIn`: "Resend code in {seconds}"
- `auth.code.escalation`: "Still nothing? Check spam, or try a different email."
- `errors.otp_wrong`: "That code isn't right — check and try again."
- `errors.otp_expired`: "That code expired. We can send you a new one."
- `auth.code.attemptsWarning`: "1 attempt left before sign-in is paused."

**Error behavior (change from today):** wrong code KEEPS the entered digits so the user can correct in place — the current wipe-on-failure (`client-auth.ts:107-114`) is replaced; the field is cleared only on expiry/resend (a genuinely new code). Wrong vs expired are distinct copy via distinct `Result` variants. Attempts counter never shown from attempt one.

**Email formatting (infrastructure, same slice as the sender):** sender name "Creativo", code in huge type near the top, "Expires in 5 minutes" stated (matches `policy.ttlMinutes`).

### 2.3 Blocked (terminal)

Calm, honest, no jargon. `ui-section-header` center: `<ui-icon uiName="auth.locked" uiScale="large"/>` above `[uiTitle]` title `t('auth.blocked.title')` "Too many attempts", `[uiLede]` body secondary `t('auth.blocked.body')` "To protect your account, sign-in is paused for a while. Please try again later." One `bordered` (neutral tint) large button `t('auth.blocked.home')` "Back to home" → `/`. No countdown promise we can't keep (server lockout window isn't surfaced); no dead end.

### 2.4 Settling (`@default` branch)

`ui-progress-view` (indeterminate spinner) + body secondary `t('auth.settling')` "Signing you in…". Covers the `ensure-session-ready` claims-lag backoff.

### 2.5 /onboarding — Profile (names + phone)

One required step → **no stepper** (research: progress UI only for ≥2 steps; a bar on a single step inflates perceived length). A completion promise substitutes.

**Layout:**

1. `ui-section-header`: `[uiTitle]` largeTitle `t('onboarding.about.title')` "About you"; `[uiLede]` body secondary `t('onboarding.about.lede')` "Takes about 30 seconds."
2. Fields rendered from `strategy.required` minus `identifierKindForStrategy(strategy)` (finally un-deadening that export): firstName + lastName as `uiTextField uiControlSize="large"` with the footnote-label convention (`autocomplete="given-name"` / `"family-name"`), then for email_otp deployments the phone block:
   `<ui-phone-field [label]="t('onboarding.about.phoneLabel')" [hint]="t('onboarding.about.phoneHint')" [defaultCountry]="deployment.defaultCountry" [(country)]="…" [(value)]="phoneE164" data-testid="onboarding-phone"/>`
   **Permission-priming hint (verbatim):** `onboarding.about.phoneHint`: "Your salon may need to call you about your appointment — running late, confirming, or rescheduling. Never for marketing." (The "never for marketing" promise is already enforced at infrastructure level by the OTP-sender/campaign separation rule.)
3. CTA: `borderedProminent large` `t('onboarding.about.continue')` "Continue", full width, `uiLoading` while registering; disabled until names non-empty and phone draft valid.
4. Inline error footnote destructive `role="alert"` (`registration_field_missing`, phone reason-mapped copy).
5. Footer (explicit control — the user must never feel trapped in a signed-in state they didn't choose): footnote secondary `t('onboarding.about.signedInAs', { identifier })` "Signed in as {identifier}" + `plain small` button `t('onboarding.about.signOut')` "Sign out" → `SignOutUseCase` → `/`.

**Back behavior:** browser-back does NOT return to /auth/code (identity already proven); it exits toward the app shell — the anon guard latch (`latchSettledPrincipal`) already prevents yanking.

**Phone validation timing:** never on keystroke; on blur once non-empty and on submit via `PhoneNumber.create(fieldText, country)`; error clears live the moment `formatPhoneDraft(...).isValid` flips true (reward early, punish late). Reason-mapped, example-bearing copy: `errors.identity.phone.too_short`: "This number looks too short — for example, {example}." · `too_long` analogous · `not_a_number`: "Enter a phone number, like {example}." ({example} = `examplePhoneNumber(country)`).

### 2.6 Reward / Services / Avatar / Entering (existing steps, light polish only)

Machine unchanged. Polish: reward gets `ui-icon uiName="checklist.done" uiScale="large"` + title "You're in" + two CTAs (`borderedProminent` "Personalize", `plain` "Enter app" — short copy); services/avatar headers gain a caption `uiFont="caption" uiForegroundStyle="secondary"` "Optional" and keep Skip as `plain`; avatar uses `ui-avatar` (initials fallback from the just-entered name) — upload affordance stays out of scope (DS gap #8, deferred). Entering keeps spinner/retry.

**Mobile-first:** everything is a single 28rem-capped column, spacing rides `--sys-density`, every hover has its `:active` mirror via `uiInteractive`/control tiers (mobile press parity rule), country picker opens as a bottom sheet on mobile (see §4.2).

---

## 3. Domain/application changes

### 3.1 Kernel — country exposure (per phone research §5, caged API)

New `libs/domain/kernel/src/lib/phone-country.ts`:

- `CountryIso2 = Brand<string,'CountryIso2'>`; `PhoneCountry {code, dialCode, name}` (name localized via `Intl.DisplayNames(locale, {type:'region'})` — zero payload).
- `listPhoneCountries(locale)` (getCountries × getCountryCallingCode, `Intl.Collator`-sorted, memoized per locale), `toCountryIso2(raw): Result<CountryIso2, CountryUnsupportedError>`, `formatPhoneDraft(input, country?): PhoneDraft` (stateless `AsYouType` per call: formatted/country/e164/isValid/template), `examplePhoneNumber(country)` (lazy `examples.mobile.json`).

Changes to `libs/domain/kernel/src/lib/phone-number.ts`:

- Fix the cage breach: `create(raw, defaultCountry?: CountryIso2)` replaces the leaked libphonenumber `CountryCode`.
- Adopt `parsePhoneNumberWithError` and add `readonly reason: 'not-a-number'|'too-short'|'too-long'|'invalid-country'|'invalid'` to `PhoneNumberInvalidError` (maps 1:1 to Transloco keys).
- Add `get country(): CountryIso2 | undefined`, `formatNational()`, `formatInternational()`. Storage stays E.164.
- **Stay on the `min` metadata bundle** (landlines are legitimate; max's strictness rejects fresh ranges; OTP delivery is the real reachability validator). If data quality demands it later, add `max` validation server-side only.
- `IdentifierDefaultCountry` in `identifier.ts` now aliases `CountryIso2`.

### 3.2 Deployment config — strategy + providers + country in one injectable concept

New `libs/domain/identity/src/lib/auth-deployment.ts`:

```ts
type AuthProvider =
  | { kind: 'otp' }
  | { kind: 'oauth'; provider: 'google' | 'apple' | 'facebook' };
interface AuthDeployment {
  readonly strategy: AuthStrategy; // phone-required invariant already enforced by createAuthStrategy
  readonly providers: readonly AuthProvider[]; // welcome/provider-stack rendering; [{kind:'otp'}] today
  readonly defaultCountry: CountryIso2; // 'BG' — threads into createIdentifier/PhoneNumber.create/ui-phone-field
}
export const DEFAULT_AUTH_DEPLOYMENT: AuthDeployment; // email_otp, required:['phone','firstName','lastName'], providers:[otp], 'BG'
```

OAuth deliberately stays OUT of the `AuthStrategy` union (its own doc L44-47 warns against illegal states; `identifierKindForStrategy` stays total). `OtpClient` stays OTP-only; a future `OAuthGateway` port sits beside it.

Application side: `AUTH_DEPLOYMENT` InjectionToken in `libs/application/identity` (provided in `apps/web/src/app/app.config.ts`, defaulting to the const). All three current `DEFAULT_AUTH_STRATEGY` const-import call sites switch to it: `client-auth.ts` (identifierKind via `identifierKindForStrategy` — killing the hardcoded `'phone'` at L79 and the dead export), `onboarding-flow.store.ts:77`, and functions read the same const from a shared config module (env-overridable later). Flipping email↔phone becomes config, not code.

### 3.3 Flow machine (`libs/application/identity/src/lib/flow/auth-flow.ts`)

- Initial state `identify`; `welcome` state + `get_started` event removed (update `advanceAuthFlow`, store, specs).
- Reserve (documented, implemented with OAuth) `oauth_started` event: identify → external → terminal `authenticated`/`done` handling.
- Resend cooldown and the 250 ms auto-verify delay are presentational store state (signals + timer), NOT machine states — the machine stays synchronous and channel-agnostic.
- Route bindings: `/auth` ↔ identify, `/auth/code` ↔ otp; browser-back = `change_identifier` (invalidates outstanding challenge id in the store).

### 3.4 Use-cases & ports

- `RequestOtpUseCase.execute(input, defaultCountry)` — the caller finally passes `deployment.defaultCountry` (parameter already exists).
- `AuthGateway` gains `currentIdentifier(): Identifier | null` (from the Firebase user's phoneNumber/email) — fixes the hexagonal leak where `onboarding-flow.store.ts:19` injects `FIREBASE_AUTH` directly; matters more once OAuth adds providerData shapes. Adapter change in `libs/infrastructure/firebase-auth/src/lib/auth-gateway.adapter.ts`.
- `RegisterUserUseCase` unchanged — its identifier-satisfies-own-channel fallback + `strategy.required` check already produce exactly the right behavior once onboarding supplies phone.

### 3.5 Server (apps/functions) — keep the invariant honest

1. `requestOtpChallenge` validates requested channel: reject `kind !== identifierKindForStrategy(deployment.strategy)` (today a phone deployment can be driven over email).
2. `request-otp.use-case.ts:21-23` reads TTL/maxAttempts/rate-window from `deployment.strategy.policy` instead of silently duplicating them.
3. Replace `ConsoleLogOtpSender` with a Postmark/Resend adapter on the **dedicated OTP sender identity** (standing rule: never share with campaigns). Email template per §2.2.
4. `complete-registration` keeps re-validating `strategy.required` server-side (defense in depth) — now from the shared deployment const. Flag for follow-up (out of this design's scope but noted): it doesn't verify the caller's auth context; bind completion to the verified session.
5. `sessionDays` remains unenforced — acknowledged; Baymard argues for long sessions anyway; document it as intentional on the policy field.
6. i18n: add the missing `errors.identifier_invalid` key in en.json/bg.json (audit gap #10); add per-kind `auth.*` copy (email + phone variants) and all new keys from §2.

---

## 4. New DS components

### 4.1 `UiPhoneField` (libs/ui/controls — the one genuinely new composite)

**Anatomy:** one bordered frame reading as a single control at the 44 px default (36/52 tiers supported): `[ country trigger ▾ +359 | tel input ]`, visible label above (footnote convention), hint + error below. Flag-free v1 (emoji flags broken on Windows Chrome/Edge; dial-code text is unambiguous, zero-asset).
**API (signals):** `country` model (`CountryIso2`), `value` model (E.164 `string | null`), inputs `defaultCountry`, `label`, `hint`, `error` (string | null), `uiControlSize`, `disabled`, `required`. Emits E.164 only; national formatting is presentation.
**Behavior:** every keystroke → `formatPhoneDraft(text, country())` with caret preservation; typed/pasted/autofilled `+…` re-detects and switches the country model (never reject autofill's international value); country change from picker keeps entered digits and refocuses the tel input; placeholder = `examplePhoneNumber(country())`; digits capped ~16; spaces/hyphens/brackets accepted and stripped silently; validate on blur + submit, clear error live on `draft.isValid`.
**States:** rest / hover / focus-within (single shared field-glow ring around the whole frame — the `--sys-focus-glow-*` recipe) / filled / invalid (destructive border + `aria-invalid`) / disabled (`--sys-opacity-disabled`); `:active` mirrors every hover (press parity).
**A11y:** input `type="tel" inputmode="tel" autocomplete="tel"` labelled by the visible label, `aria-describedby` → hint + error, error `role="alert"`; trigger is `<button role="combobox" aria-expanded aria-haspopup="listbox" aria-controls>` with accessible name "Country code: България +359".

### 4.2 Country picker (pattern inside `UiPhoneField`, built from existing primitives)

`ui-sheet` (`uiPlacement="bottom"` mobile, `center` desktop) + `ui-sheet-header` (grabber, title "Country code") + a search `uiTextField` labelled "Search countries" + `ui-list-group` of `button[uiListRow]` rows "Localized name — +dial code", alphabetized by `Intl.Collator(locale)`, filter by name/ISO/dial code. **A11y done correctly** (intl-tel-input's documented failure mode avoided): popup surface is a genuine `role="listbox"` with `role="option" aria-selected` children; `aria-activedescendant` on the element owning focus; Down/Up/Home/End, type-ahead, Enter selects, Esc closes; focus returns to the trigger. Selected row shows `ui-icon uiName="checklist.done"`. No control autofocus on sheet open (owner ruling) — focus lands on the surface; first Tab reaches search. If flags ever land: lazy `aria-hidden` SVG sprites in list rows only, never the trigger.

### 4.3 `UiProviderButton` (future slice, spec now so layout doesn't rework)

`button[uiProviderButton]`, `provider: 'google'|'apple'|'facebook'`, built on the `strokedBorder` recipe at `uiControlSize="large"`, uniform size/shape across providers (Google equal-prominence rule). Brand marks are SVG assets (Material Symbols can't supply them) behind new registry-style intents `auth.provider.google|apple|facebook`; labels are the contractual approved strings ("Continue with Google", "Continue with Apple", "Continue with Facebook") via Transloco. Branding constraints (multicolor G on white, Facebook #1877F2 tile, exact padding) live in this one component.

### 4.4 Not built (deliberate)

- **Resend countdown:** store signal + disabled `plain` button + `aria-live` copy — a documented pattern, not a component (single consumer).
- **Step indicator:** not needed — auth must not have one (anti-pattern #6) and onboarding has one required step; if profile ever splits, reuse `ui-progress-view [uiValue]`.
- **Field wrapper:** keep the hand-assembled label/error convention (house style); `UiPhoneField` is the one place it's baked in because the composite demands it.
- **Checkbox/consent:** legal footer is plain text + links; no acceptance checkbox required.

### 4.5 Icon registry additions (one line each, `libs/ui/controls/src/lib/icon/icon-registry.ts`)

`nav.back` (chevron), `auth.email`, `auth.phone`, `auth.resend`, `auth.editIdentifier`; existing `auth.locked` and `checklist.done` reused. `onboarding.camera` deferred with the uploader.

---

## 5. Implementation plan (ordered, independently verifiable slices)

**Slice 1 — Kernel country API + reason codes.**
Files: `libs/domain/kernel/src/lib/phone-country.ts` (+ `.spec.ts`), `phone-number.ts`, `phone-number.errors.ts`, kernel `index.ts`; `libs/domain/identity/src/lib/identifier.ts` (`IdentifierDefaultCountry` → `CountryIso2`).
Verify: `pnpm nx test domain-kernel` (draft formatting, reason mapping, locale-sorted lists, E.164 round-trips); ESLint cage untouched.

**Slice 2 — AuthDeployment + strategy-driven UI plumbing.**
Files: `libs/domain/identity/src/lib/auth-deployment.ts` + barrel; `libs/application/identity/src/lib/auth-deployment.token.ts`; `apps/web/src/app/app.config.ts` (provide); `libs/features/client/auth/src/lib/client-auth/client-auth.ts` (kill hardcoded `identifierKind`, use `identifierKindForStrategy`, pass `defaultCountry` to `createIdentifier`); `client-auth.html` (kind-branched input attrs); `onboarding-flow.store.ts` (inject token; swap `FIREBASE_AUTH` for new `AuthGateway.currentIdentifier()`); `libs/application/identity/src/lib/ports/auth-gateway.port.ts` + `libs/infrastructure/firebase-auth/src/lib/auth-gateway.adapter.ts`; i18n en/bg: per-kind `auth.*` keys + missing `errors.identifier_invalid`.
Verify: existing phone e2e (`apps/web/e2e/auth-onboarding.spec.ts`) still green with deployment set to phone_otp; unit tests for kind branching.

**Slice 3 — Flow machine + routes.**
Files: `libs/application/identity/src/lib/flow/auth-flow.ts` (+spec): initial `identify`, drop welcome/get_started; `apps/web/src/app/app.routes.ts`: `/auth` + `/auth/code` child routes bound to states; `auth-flow.store.ts`: route sync, browser-back = `change_identifier`, challenge invalidation.
Verify: flow-machine unit tests (every transition incl. back paths); e2e: deep-link `/auth/code` without a challenge redirects to `/auth`.

**Slice 4 — `UiPhoneField` + country picker + showcase.**
Files: `libs/ui/controls/src/lib/phone-field/phone-field.{ts,css,html}` + barrel; icon registry additions; `apps/showcase/src/app/pages/controls/phone-field.page.ts` (sizes ladder, invalid, disabled, autofill-E.164 demo, picker a11y).
Verify: showcase manual pass (keyboard-only picker traversal, VoiceOver names, dark theme, mobile sheet placement); component unit tests for draft/caret/country-switch behavior.

**Slice 5 — Onboarding profile from `strategy.required`.**
Files: `libs/features/client/onboarding/src/lib/client-onboarding/client-onboarding.{ts,html}` (render fields from `strategy.required` minus identifier channel; add `ui-phone-field`; priming hint; signed-in-as footer + sign-out); i18n `onboarding.about.*` + phone reason error keys.
Verify: unit test — with email identifier, submit passes `phone` through `RegisterUserUseCase` and `MissingRegistrationFieldError` is unreachable when the field is filled; with phone identifier the phone input is absent.

**Slice 6 — Server alignment + real email sender.**
Files: `apps/functions/src/use-cases/request-otp.use-case.ts` (policy from deployment; channel-vs-strategy rejection), `apps/functions/src/lib/otp/request-otp.ts`, new `apps/functions/src/adapters/postmark-otp-sender.ts` (dedicated OTP identity; formatted email per §2.2), shared deployment const import.
Verify: emulator e2e — email_otp deployment: request over `kind:'phone'` rejected; devCode side channel still works; TTL/lockout follow policy.

**Slice 7 — Auth screen polish + trust mechanics.**
Files: `client-auth.{html,ts}` + `auth-flow.store.ts`: `ui-section-header` trio, `uiReveal` stagger, resend cooldown (30 s, aria-live, escalation after 3), 250 ms delayed auto-verify with checking state + suppression-while-error, keep-digits-on-wrong-code (replacing the wipe), attempts warning near limit, blocked + settling views per spec, legal footer; `libs/ui/controls/src/lib/otp-field/otp-field.ts` paste-distribution audit/fix.
Verify: extend e2e — resend cooldown, change-identifier prefill, wrong-code-keeps-digits, paste of 6-digit string fills all slots.

**Slice 8 — Flip the deployment + email e2e.**
Files: `apps/web/src/app/app.config.ts` + functions config → `email_otp`; new `apps/web/e2e/auth-onboarding-email.spec.ts` (new email user → code → profile w/ phone via country picker → reward → account; returning email user skips onboarding; blocked path).
Verify: full e2e matrix green under emulators; phone_otp suite kept runnable by config toggle to prove the switch is truly config-only.

---

## 6. Standing invariants preserved

- **Phone-required:** enforced in three places that all read the same `AuthStrategy.required` — `validateRequired` at construction, `RegisterUserUseCase` client-side, `complete-registration` server-side. OAuth (future) cannot bypass it because it lands in the same onboarding gate.
- **OTP sender ≠ campaigns:** the new Postmark adapter lives on the dedicated identity; the "never for marketing" priming copy is therefore honest.
- **Accent discipline:** the only accent anywhere in these flows is #f26b22 via tokens (field focus glow, otp active slot, bordered tint); prominent CTAs are monochrome primary; dark mode free via tokens.
- **E.164 everywhere at rest;** national formatting is presentation-only; the future phone-OTP switch reads the same field.

---

## 7. Addendum — owner-directed quiet-chrome rulings (2026-07-25)

Applied to `/auth` + `/onboarding` after the Apple HIG / SwiftUI conventions research (toolbars & back chrome, Setup Assistant progress, bottom-CTA placement, footnote/caption hierarchy):

- **Icon-only back chevron.** The top-bar back control is a bare `nav.back` chevron (`uiIconOnly`, 44px regular tier), aria-labelled from the existing `auth.*.back` i18n keys — no visible text. Matches the iOS 26 glass-back default where chevron-only is the rule, not the exception.
- **Caption-less stepper.** `ui-stepper` gained `uiLabelsHidden` (≙ SwiftUI `.labelsHidden()`): the journey screens render segments only — no visible "Стъпка X от 3" — while `uiLabel` still names the `progressbar` for assistive tech. Apple's own Setup Assistant shows no step counter; the screen titles carry orientation.
- **No decorative hairlines.** The step screens' sticky toolbar runs `uiToolbarBackground="hidden"` (a sticky hidden-background toolbar now keeps the page's own surface so content never slides through it — toolbar.css); `ui-page-action-bar` dropped its material wash + top hairline and is now chromeless like `ui-sheet-action-bar` — controls float over the page, and scrolled-under separation deliberately gets no cue.
- **Hugged trailing CTA.** The bottom-bar primary (Identify/About "Continue") hugs its intrinsic width and docks trailing (thumb side) at every viewport — the compact full-width spread is removed from `ui-page-action-bar` (SwiftUI bottom-bar trailing placement; the sheet-action-bar primary-trailing slot contract).
- **Buttonless OTP verification.** The code screen has no Verify button and no bottom action bar: verification is automatic on the 6th digit (the existing 250 ms delayed auto-verify + suppression-while-error), the checking state shows on the field itself (slots locked) plus a subtle inline progress row (`auth-otp-checking`), and the accessible explicit path is Enter inside the OTP field. `auth.code.verify` is retired; `auth.code.checking` added.
- **Quiet secondary text.** Hints/helpers (email hint, phone priming hint, signed-in-as, resend countdown, escalation) drop to the caption tier in secondary ink at regular weight; inline errors stay footnote-sized but regular weight destructive — the color carries the state, never boldness (HIG: hierarchy from size + color, "inform without shouting"). The resend countdown is now informational text, not a disabled button. The `ui-phone-field` hint/error convention was updated in the composite itself.
- **Clear the code on every failed verify** (supersedes §2.2's keep-digits ruling). Keep-digits assumed an explicit Verify button; with buttonless auto-verify, retyping a fresh code beats editing a wrong one in place — the native iOS loop. The error line stays until typing resumes.
- **Sheet-chrome pill grammar for toolbar + bottom-bar controls.** Toolbar buttons (back chevron, Sign out) use the same bordered-neutral capsule recipe as sheet close/action buttons; the bottom-bar prominent CTA takes `uiButtonBorderShape="capsule"` — one pill grammar across sheets and page chrome.
