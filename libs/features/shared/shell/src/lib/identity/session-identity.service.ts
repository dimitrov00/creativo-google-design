import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, from, of, startWith, switchMap } from 'rxjs';
import { AUTH_GATEWAY, type Role } from '@creativo/application/identity';
import {
  AVATAR_UPLOADER,
  type UserRole,
  profileCompletion,
  STAFF_ROLES,
} from '@creativo/application/accounts';
import { AccountStateService } from '@creativo/features/client/account-state';
import { Profile } from '@core/entities';
import { UserId } from '@core/primitives';

/** An avatar answer that has ARRIVED — `undefined` is reserved for "still looking". */
function settled(url: string | null): Observable<string | null | undefined> {
  return of(url);
}

/**
 * The admin pair — the SAME two roles `isAdmin()` in firestore.rules names,
 * `rolesGuard('admin', 'sysadmin')` on every `/admin` route checks, and the
 * `publishStreakDefinition` callable admits (`callerIsAdmin`). Four dialects
 * of one rule; keep them equal. Narrower than `STAFF_ROLES`, which the pair
 * is also part of: an admin is staff, a barber is not an admin.
 */
const ADMIN_ROLES: readonly UserRole[] = ['admin', 'sysadmin'];

/**
 * Whether the token's claims hold one of `roles`. Claims-tolerant, like
 * `worksTheBook`: an unrecognised claim is simply not in the list and grants
 * nothing, so the claims are never narrowed to the vocabulary first.
 */
function holdsAnyOf(
  claims: readonly Role[],
  roles: readonly UserRole[],
): boolean {
  return claims.some((claim) =>
    (roles as readonly string[]).includes(claim as string),
  );
}

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
  private readonly authGateway = inject(AUTH_GATEWAY);
  private readonly avatarUploader = inject(AVATAR_UPLOADER);
  private readonly accountState = inject(AccountStateService);

  readonly principal = this.accountState.principal;

  readonly isAuthed = computed(() => this.principal().kind === 'active');

  /**
   * A staff-tier principal — the SAME grouping firestore.rules' `isStaff()`
   * and the /staff route guard use, read off the token's claims. Drives the
   * menu's day-sheet entry and nothing security-bearing: the guard and the
   * rules re-check for themselves.
   */
  readonly isStaffMember = computed(() => {
    const principal = this.principal();
    return (
      principal.kind === 'active' && holdsAnyOf(principal.roles, STAFF_ROLES)
    );
  });

  /**
   * One of the admin pair, `admin | sysadmin` — the SAME grouping
   * firestore.rules' `isAdmin()` and the `/admin` routes' `rolesGuard` use,
   * read off the token's claims. Drives the menu's «Лоялност» entry (the one
   * way to the admin page `/admin/loyalty/rhythm`; client-card revision 3
   * §3.17) and nothing security-bearing: the route's guard, the rules and
   * the callable re-check for themselves.
   */
  readonly isAdmin = computed(() => {
    const principal = this.principal();
    return (
      principal.kind === 'active' && holdsAnyOf(principal.roles, ADMIN_ROLES)
    );
  });

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
    const displayName = this.authGateway.currentDisplayName();
    if (displayName) return displayName;
    const identifier = this.authGateway.currentIdentifier();
    return identifier?.kind === 'email'
      ? (identifier.value.toString().split('@')[0] ?? '')
      : '';
  });

  /** The channel this session authenticated with, formatted for reading — the secondary line under the portrait. */
  readonly identifierLabel = computed(() => {
    if (!this.isAuthed()) return '';
    const identifier = this.authGateway.currentIdentifier();
    if (!identifier) return '';
    return identifier.kind === 'phone'
      ? identifier.value.formatInternational()
      : identifier.value.toString();
  });

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
  private avatarOwner: string | null = null;

  /**
   * The uploaded photo's URL, `null` when the user has none, `undefined`
   * while the lookup is still in flight — the third state exists so the
   * completion model below can wait for a real answer instead of counting
   * a not-yet-loaded photo as missing and flashing the wrong fraction.
   * Avatar existence is a storage lookup, not a profile field (see
   * `AvatarUploader.find`).
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
        // alongside `null` (settled: no photo) in this signal's type.
        const userId =
          principal.kind === 'active'
            ? UserId.parse(principal.uid.value)
            : null;
        if (userId === null || !userId.ok) {
          this.avatarOwner = null;
          return settled(null);
        }
        const owner = userId.value;
        const samePerson = this.avatarOwner === userId.value;
        this.avatarOwner = userId.value;
        const answer = from(
          this.avatarUploader
            .find(owner)
            .then((result) =>
              result.isSuccess() ? (result.value?.url ?? null) : null,
            ),
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
    return profileCompletion(user, photo !== null);
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
   * still open. `name`/`phone` are registration invariants, so the only
   * candidates are the two optional enhancements. A hint for the deep
   * link's `?step=`; the onboarding screen recomputes the full remaining
   * set from `profileProgress` on arrival, so a stale hint costs nothing.
   */
  readonly nextOpenStep = computed<'birthday' | 'avatar'>(() =>
    this.accountState.account()?.birthDate ? 'avatar' : 'birthday',
  );
}
