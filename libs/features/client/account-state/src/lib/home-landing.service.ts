import { Injectable, inject } from '@angular/core';
import { Router, type UrlTree } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  HomeDestination,
  type HomeLanding,
  type Principal,
} from '@core/components';
import { RedirectPath } from '@core/primitives';
import { SessionAccessSystem } from '@core/systems';
import { AUTH_SESSION_PORTS } from '@creativo/infrastructure/firebase-app';
import { StaffAccessService } from './staff-access.service';

/** The route each home is — one per `HomeDestination`. */
export const HOME_PATH = {
  [HomeDestination.Schedule]: '/staff/schedule',
  [HomeDestination.Programs]: '/admin/programs',
  [HomeDestination.Account]: '/account',
} as const satisfies Record<HomeDestination, string>;

/**
 * The key a sign-in's own navigation carries in its `state`: a guard that
 * refuses it sends the person home, never to `/forbidden`
 * ({@link HomeLandingService.isLanding}).
 */
export const LANDING_NAVIGATION = 'creativoLanding';

/**
 * WHERE A PERSON LANDS (owner rulings 2026-11-25, Q3–Q4 of the role-aware
 * homes brief) — the one place the web turns `SessionAccessSystem`'s
 * landing into a URL. The installed app's `/`, every post-sign-in
 * navigation, `/forbidden`'s way out and the bare `/admin` ask it, so no
 * page names a home of its own.
 *
 * - **Home by role.** Whoever works the book lands on the schedule, a
 *   content manager who does not on the programs, a client on the account
 *   (`SessionAccessSystem.homeOf`, from the token's roles).
 * - **On their own chair.** The schedule opens on the account's linked
 *   barber record (`?barber=`, the scope travels in the link, never on the
 *   device). That is the account document's answer, so only a landing on
 *   the schedule waits for it (`StaffAccessService.whenSettled`); the
 *   persistent cache answers it on every launch after the first.
 * - **A remembered link first.** After sign-in a link the person came for
 *   is followed; one they can no longer open lands them home: the
 *   navigation carries {@link LANDING_NAVIGATION}, and the role and
 *   capability gates answer a refusal of it with the home
 *   ({@link HomeLandingService.isLanding}).
 */
@Injectable({ providedIn: 'root' })
export class HomeLandingService {
  private readonly router = inject(Router);
  private readonly session = inject(AUTH_SESSION_PORTS);
  private readonly access = inject(StaffAccessService);

  /** The landing of `principal`; on the schedule, once the account has answered its chair. */
  async landingOf(principal: Principal): Promise<HomeLanding> {
    if (SessionAccessSystem.homeOf(principal) !== HomeDestination.Schedule) {
      return SessionAccessSystem.landingOf(principal, null);
    }
    await this.access.whenSettled();
    return SessionAccessSystem.landingOf(
      principal,
      this.access.linkedBarberId(),
    );
  }

  /** A landing's URL: its route, and the chair in the link. */
  urlOf(landing: HomeLanding): UrlTree {
    const path = HOME_PATH[landing.homeDestination];
    return landing.homeBarberId === null
      ? this.router.createUrlTree([path])
      : this.router.createUrlTree([path], {
          queryParams: { barber: landing.homeBarberId },
        });
  }

  /** The home of `principal` — the signed-in one when none is given — as a URL. */
  async homeUrl(principal?: Principal): Promise<UrlTree> {
    const who =
      principal ?? (await firstValueFrom(this.session.observePrincipal()));
    return this.urlOf(await this.landingOf(who));
  }

  /**
   * AFTER SIGN-IN: the link the person came for (`?redirect=`), else their
   * home. The link's navigation is marked a landing, so a gate that would
   * refuse it sends the person home instead of to `/forbidden`.
   */
  async enter(redirect: RedirectPath): Promise<boolean> {
    const intent = RedirectPath.intentOf(redirect);
    if (intent !== null) {
      return this.router.navigateByUrl(intent, {
        state: { [LANDING_NAVIGATION]: true },
      });
    }
    return this.router.navigateByUrl(await this.homeUrl());
  }

  /**
   * Whether the navigation under way is a sign-in's landing — read by the
   * role and capability gates, whose refusal of it is the home (owner
   * ruling 2026-11-25, Q3: a remembered link the person can no longer open
   * is never `/forbidden`).
   */
  isLanding(): boolean {
    return (
      this.router.currentNavigation()?.extras.state?.[LANDING_NAVIGATION] ===
      true
    );
  }
}
