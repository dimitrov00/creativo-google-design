import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { SessionAccessSystem } from '@core/systems';
import { HomeLandingService } from '@creativo/features/client/account-state';
import { AUTH_SESSION_PORTS } from '@creativo/infrastructure/firebase-app';
import { firstValueFrom } from 'rxjs';
import { isStandalone } from '../shell/is-standalone';

/**
 * `/`, THE DISPATCHER (blueprint §1.4; owner rulings 2026-11-25, Q3–Q4 of
 * the role-aware homes brief): an installed-app launch by an active person
 * skips the marketing landing straight to their home — the schedule on
 * their own chair, the programs, or the account
 * (`SessionAccessSystem.rootLandingOf`, `HomeLandingService`). The manifest's
 * `start_url` is `./`, so this is the one hook every launch passes. A
 * one-shot read of the current `Principal` — no session-ready backoff,
 * this never blocks an anonymous visitor from seeing the landing page; a
 * browser tab keeps the landing page (the brief's open Q5).
 */
export const homeGuard: CanActivateFn = async () => {
  if (!isStandalone()) return true;

  const session = inject(AUTH_SESSION_PORTS);
  const landing = inject(HomeLandingService);
  const principal = await firstValueFrom(session.observePrincipal());
  return SessionAccessSystem.rootLandingOf(principal, true) === null
    ? true
    : landing.homeUrl(principal);
};

/**
 * A door with no page of its own (`/admin`): the person's home. Beside
 * `activeGuard`, which sends anyone not signed in to sign in first.
 */
export const landingGuard: CanActivateFn = () =>
  inject(HomeLandingService).homeUrl();
