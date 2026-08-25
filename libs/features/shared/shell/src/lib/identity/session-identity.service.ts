import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, of, switchMap } from 'rxjs';
import { AUTH_GATEWAY } from '@creativo/application/identity';
import {
  AVATAR_UPLOADER,
  UserId,
  profileCompletion,
  STAFF_ROLES,
} from '@creativo/application/accounts';
import { AccountStateService } from '@creativo/features/client/account-state';

/** An avatar answer that has ARRIVED — `undefined` is reserved for "still looking". */
function settled(url: string | null): Observable<string | null | undefined> {
  return of(url);
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
      principal.kind === 'active' &&
      principal.roles.some((role) =>
        (STAFF_ROLES as readonly string[]).includes(role as string),
      )
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
    const fullName = this.accountState.account()?.fullName();
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
   * The uploaded photo's URL, `null` when the user has none, `undefined`
   * while the lookup is still in flight — the third state exists so the
   * completion model below can wait for a real answer instead of counting
   * a not-yet-loaded photo as missing and flashing the wrong fraction.
   * Avatar existence is a storage lookup, not a profile field (see
   * `AvatarUploader.find`).
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
        if (principal.kind !== 'active') return settled(null);
        const userIdResult = UserId.create(principal.uid.value);
        if (userIdResult.isFailure()) return settled(null);
        return this.avatarUploader
          .find(userIdResult.value)
          .then((result) =>
            result.isSuccess() ? (result.value?.url ?? null) : null,
          );
      }),
    ),
    { initialValue: undefined as string | null | undefined },
  );

  /** The photo for `ui-avatar` — the in-flight state reads as "no photo yet", which is exactly the monogram it already shows. */
  readonly avatarUrl = computed(() => this.avatarLookup() ?? null);

  /**
   * Re-runs the storage lookup — the menu calls this on every open, so a
   * photo added later in the same session (onboarding's avatar step, a
   * future settings screen) shows up the next time the portrait is on
   * screen instead of waiting for a reload.
   */
  refreshAvatar(): void {
    this.avatarReload.update((bump) => bump + 1);
  }

  /**
   * How far along the profile is — `null` while the snapshot is still
   * loading AND once everything is filled in, so the menu's nudge simply
   * doesn't exist for a finished profile (same rule as the dashboard's
   * completion card). Shares `profileCompletion` with that card, so the
   * two can never disagree about what is still missing.
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
