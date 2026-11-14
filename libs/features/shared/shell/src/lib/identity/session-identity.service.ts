import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { from, of, startWith, switchMap } from 'rxjs';
import {
  ANALYTICS_CACHE_PORTS,
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
} from '@creativo/infrastructure/firebase-app';
import {
  AccountStateService,
  StaffAccessService,
} from '@creativo/features/client/account-state';
import {
  E164,
  OnboardingFlowStep,
  Principal,
  Roles,
  StaffLink,
} from '@core/components';
import { Profile } from '@core/entities';
import {
  AccessScope,
  type BarberId,
  IdentifierChannel,
  StaffCapability,
  type UserId,
} from '@core/primitives';
import { OnboardingFlowSystem, ProfileCompletionSystem } from '@core/systems';
import { OnboardingStepHint } from './onboarding-link';

/**
 * "Who is signed in, and what does the app-wide chrome show for them" — the
 * header's account circle, the menu's identity portrait and the menu's
 * finish-your-profile row all read from here.
 *
 * The session itself (principal + the `users/{uid}` snapshot) belongs to
 * `AccountStateService`, which owns the one `onIdTokenChanged` listener;
 * this service adds only what the CHROME needs on top: a display name, the
 * identifier label, and the single-object avatar lookup. Before the scope
 * flattening (2026-07-28) the shell could not see `AccountStateService` at
 * all and kept its own duplicate principal subscription — the two are now
 * one chain.
 *
 * The avatar lookup and the profile's completion are the APP's, not the
 * chrome's alone: `/account`'s completion card, the menu's nudge and the
 * onboarding resume all read `profileProgress` from here (round 6,
 * 2026-09-26). The dashboard used to run a second Storage lookup and a
 * second `profileCompletion` of its own — two answers that could disagree
 * after an upload, and twice the requests. Whoever uploads a photo calls
 * `refreshAvatar()` and every reader follows.
 */
@Injectable({ providedIn: 'root' })
export class SessionIdentityService {
  private readonly session = inject(AUTH_SESSION_PORTS);
  private readonly avatars = inject(AVATAR_PORTS);
  private readonly accountState = inject(AccountStateService);
  private readonly access = inject(StaffAccessService);
  /**
   * The device's analytics report cache — optional, so a host that binds
   * none (a test bed, the showcase) is no session without one.
   */
  private readonly analyticsCache = inject(ANALYTICS_CACHE_PORTS, {
    optional: true,
  });

  readonly principal = this.accountState.principal;

  /**
   * Whose session this is — the account's uid while signed in (onboarding
   * included), `null` signed out. Equal by value, so a token refresh for
   * the same account is no change.
   */
  readonly userId = computed<UserId | null>(() => {
    const principal = this.principal();
    return 'userId' in principal ? principal.userId : null;
  });

  /**
   * The barber record this account is linked to (`StaffLink`,
   * `docs/designs/staff-analytics.md` «Which barber the caller is») — read
   * off the session's OWN `users/{uid}` snapshot, never a token claim;
   * `null` while it loads, for an account with no link and for a document
   * written before the link existed (`StaffLink.of`). The «Анализи» screen's
   * barber scope; nothing security-bearing: the callable judges the stored
   * record itself.
   */
  readonly linkedBarberId = computed<BarberId | null>(() => {
    const account = this.accountState.account();
    return account === null ? null : StaffLink.of(account).linkedBarberId;
  });

  /**
   * Readers of the analytics menu row — whoever the `ANALYTICS` capability
   * reaches at all (staff permissions P8): a barber and the admin on the
   * standard, and whoever the owner has given it since. The route's guard
   * decides on the same capability, and the callable judges the stored
   * account and the cells again.
   */
  readonly readsAnalytics = computed(
    () => this.access.scopeOf(StaffCapability.Analytics) !== AccessScope.None,
  );

  /** The uid the cache-clearing effect last saw; `undefined` before its first run. */
  private cacheOwner: UserId | null | undefined = undefined;

  /** Onboarded — a client or a staff member (`Principal.isActive`). */
  readonly isAuthed = computed(() => Principal.isActive(this.principal()));

  /**
   * A staff-tier principal — the SAME grouping firestore.rules' `isStaff()`
   * and the /staff route guard use, read off the token's claims. Drives the
   * menu's day-sheet entry and nothing security-bearing: the guard and the
   * rules re-check for themselves.
   */
  readonly isStaffMember = computed(() =>
    Principal.hasAnyRole(this.principal(), Roles.STAFF),
  );

  /**
   * One of the admin pair, `admin | sysadmin` (`Roles.ADMIN`, ONE home) —
   * the SAME grouping firestore.rules' `isAdmin()` and the `/admin` routes'
   * `rolesGuard` use, read off the token's claims. Drives the menu's «Лоялност» entry (the one
   * way to the admin page `/admin/loyalty/rhythm`; client-card revision 3
   * §3.17) and nothing security-bearing: the route's guard, the rules and
   * the callable re-check for themselves.
   */
  readonly isAdmin = computed(() =>
    Principal.hasAnyRole(this.principal(), Roles.ADMIN),
  );

  /**
   * The profile's own name once the snapshot lands, falling back to the
   * Auth record's display name (stamped at registration) and then to the
   * identifier's local part — the monogram renders '?' only when none of
   * the three exists. The fallbacks matter for the first paint: the Auth
   * record is session-cached and answers instantly, while the profile is a
   * Firestore round trip.
   */
  readonly displayName = computed(() => {
    if (!this.isAuthed()) return '';
    const account = this.accountState.account();
    const fullName = account === null ? '' : Profile.fullName(account);
    if (fullName) return fullName;
    const displayName = this.session.currentDisplayName();
    if (displayName) return displayName;
    const identifier = this.session.currentIdentifier();
    return identifier?.identifierChannel === IdentifierChannel.Email
      ? (identifier.identifier.split('@')[0] ?? '')
      : '';
  });

  /**
   * The phone formatter, loaded lazily (F6): `libphonenumber-js` stays out
   * of the initial chunk, so the shell asks for it the first time a phone
   * session needs its label — `null` until it lands (or when its chunk
   * failed to load; the next sign-in asks again).
   */
  private readonly formatPhone = signal<((e164: E164) => string) | null>(null);
  private phoneFormatRequested = false;

  /**
   * The channel this session authenticated with, formatted for reading — the
   * secondary line under the portrait (and its primary line when there is no
   * name). A phone reads in its grouped international form once the
   * formatter has loaded, and as the raw E.164 the moment before — or for
   * good when the chunk failed to load — so the line is never blank
   * (departure 4A-2 (g)).
   */
  readonly identifierLabel = computed(() => {
    if (!this.isAuthed()) return '';
    const identifier = this.session.currentIdentifier();
    if (!identifier) return '';
    if (identifier.identifierChannel === IdentifierChannel.Email) {
      return identifier.identifier;
    }
    const format = this.formatPhone();
    return format === null
      ? identifier.identifier
      : format(E164.of(identifier.identifier));
  });

  constructor() {
    // The analytics cache is keyed by uid, and still never outlives its
    // account on this device (staff-analytics, Cache): a sign-out or a
    // switch to another account clears every cached report. The first look
    // only remembers who is signed in — a cold load is no change of account.
    effect(() => {
      const owner = this.userId();
      const before = this.cacheOwner;
      this.cacheOwner = owner;
      if (before === undefined || before === null || before === owner) return;
      untracked(() => this.analyticsCache?.clearCachedReports());
    });
    // A phone session needs the formatter: start loading it as soon as one
    // is signed in, so the label is ready before the menu opens.
    effect(() => {
      if (!this.isAuthed() || this.phoneFormatRequested) return;
      const identifier = untracked(() => this.session.currentIdentifier());
      if (identifier?.identifierChannel !== IdentifierChannel.Phone) return;
      this.phoneFormatRequested = true;
      void import('./phone-format.lazy').then(
        ({ PhoneSystem }) => {
          this.formatPhone.set((e164) => PhoneSystem.formatInternational(e164));
        },
        () => {
          // The chunk did not load (offline, a deploy rotated the hashes):
          // the label keeps the raw E.164 and the next run may ask again.
          this.phoneFormatRequested = false;
        },
      );
    });
  }

  /** Bumped by `refreshAvatar()` — the lookup is one-shot per (session,
   *  bump), so a photo uploaded during this same session needs a nudge to
   *  show up (there's no live storage listener). */
  private readonly avatarReload = signal(0);

  /**
   * Whose photo `avatarLookup` last answered for (a uid), or `null` when it
   * last answered for no one. A re-check for the SAME person keeps that
   * answer on screen while it runs; a new person starts from "still
   * looking".
   */
  private avatarOwner: UserId | null = null;

  /**
   * The uploaded photo's URL, `null` when the user has none, `undefined`
   * while the lookup is still in flight — the third state exists so the
   * completion model below can wait for a real answer instead of counting
   * a not-yet-loaded photo as missing and flashing the wrong fraction.
   * Avatar existence is a storage lookup, not a profile field (see
   * `AvatarPorts.findAvatar`).
   *
   * "In flight" is said again every time the PERSON changes (round 6): a
   * cold load starts signed out, and the signed-out answer (`null`) used
   * to stay in the signal while the signed-in lookup ran, so the account
   * snapshot landing first read as "no photo" — a completion card and a
   * `data-completion="open"` for a finished profile, and, on a switch of
   * account, the previous person's picture in the next one's header. A
   * re-check for the same person (`refreshAvatar()`, a token refresh)
   * keeps the last answer instead: the menu re-checks on every open and
   * must not blink its portrait. A failed lookup still settles as "no
   * photo", so nothing that waits for an answer (the onboarding resume)
   * waits forever.
   */
  private readonly avatarLookup = toSignal(
    toObservable(
      // A fresh object per bump on purpose — a computed returning the
      // unchanged principal would compare equal and never re-emit.
      computed(() => ({
        principal: this.principal(),
        bump: this.avatarReload(),
      })),
    ).pipe(
      switchMap(({ principal }) => {
        // The explicit widening is what lets `undefined` (in flight) live
        // alongside `null` (settled: no photo) in this signal's type: an
        // answer that has ARRIVED, `undefined` reserved for "still looking".
        if (!Principal.isActive(principal)) {
          this.avatarOwner = null;
          return of<string | null | undefined>(null);
        }
        const owner = principal.userId;
        const samePerson = this.avatarOwner === owner;
        this.avatarOwner = owner;
        const answer = from(
          this.avatars
            .findAvatar(owner)
            .then((result) => (result.ok ? (result.value?.url ?? null) : null)),
        );
        return samePerson
          ? answer
          : answer.pipe(startWith<string | null | undefined>(undefined));
      }),
    ),
    { initialValue: undefined as string | null | undefined },
  );

  /** The photo for `ui-avatar` — the in-flight state reads as "no photo yet", which is exactly the monogram it already shows. */
  readonly avatarUrl = computed(() => this.avatarLookup() ?? null);

  /**
   * Re-runs the storage lookup, keeping the last answer on screen until the
   * new one lands. Whoever uploads a photo calls it after the upload (the
   * profile screen's store; onboarding's avatar step), and the two screens
   * that SHOW the answer call it on arrival — the menu on every open,
   * `/account` on entry — so a photo added on another device, or by a path
   * that forgot to call it, shows up the next time it is on screen instead
   * of waiting for a reload.
   */
  refreshAvatar(): void {
    this.avatarReload.update((bump) => bump + 1);
  }

  /**
   * How far along the profile is — `null` while the snapshot or the photo
   * lookup is still loading. THE one computation: the menu's nudge
   * (`completion`), `/account`'s completion card and its host's
   * `data-completion`, and the onboarding resume all read it, so they can
   * never disagree about what is still missing.
   */
  readonly profileProgress = computed(() => {
    const user = this.accountState.account();
    const photo = this.avatarLookup();
    // `null` here means ONE thing — still loading. Callers that need to
    // tell "not loaded yet" apart from "nothing left to do" (the
    // onboarding resume, which has to know which steps remain) read this;
    // `completion` below folds both into null because the nudge renders
    // nothing in either case.
    if (!user || photo === undefined) return null;
    return ProfileCompletionSystem.completion(user, photo !== null);
  });

  /**
   * The nudge's model — `null` while loading AND once everything is filled
   * in, so a finished profile shows no nudge anywhere (Apple's suggestion
   * cards disappear when done; owner ruling 2026-07-27).
   */
  readonly completion = computed(() => {
    const progress = this.profileProgress();
    return progress && !progress.complete ? progress : null;
  });

  /**
   * Which personalization step "continue" should land on — the first one
   * still open (`OnboardingFlowSystem.openPersonalizeSteps`, the same rule
   * the onboarding resume reads), the avatar step when none is. `name`/
   * `phone` are registration invariants, so the only candidates are the two
   * optional enhancements. A hint for the deep link's `?step=` (its word);
   * the onboarding screen recomputes the full remaining set from
   * `profileProgress` on arrival, so a stale hint costs nothing.
   */
  readonly nextOpenStep = computed<OnboardingStepHint>(() =>
    OnboardingFlowSystem.openPersonalizeSteps(this.profileProgress())[0] ===
    OnboardingFlowStep.Birthday
      ? OnboardingStepHint.Birthday
      : OnboardingStepHint.Avatar,
  );
}
