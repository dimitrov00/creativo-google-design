import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { map, of, switchMap } from 'rxjs';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  APPOINTMENT_READ_PORTS,
  AUTH_SESSION_PORTS,
  CLOCK_PORTS,
  INBOX_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import { Principal } from '@core/components';
import { NotificationSystem } from '@core/systems';
import {
  UiAvatar,
  UiBadge,
  UiButton,
  UiIcon,
  UiProgressView,
} from '@creativo/ui/controls';
import { UiSheetBehavior, UiSpacer, UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiInteractiveDirective,
  UiRadiusDirective,
  UiRevealDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { UiListGroup, UiListRow } from '@creativo/ui/patterns';
import { formatInstant } from '@creativo/ui/wall-clock';
import { SessionIdentityService } from '../identity/session-identity.service';
import { LocaleThemeToggleComponent } from '../prefs/locale-theme-toggle.component';

/**
 * The full-screen guest navigation overlay — v2 `nav-menu.tsx` +
 * `nav-overlay.tsx` in their signed-out projection: preferences lead
 * (locale · theme), the standalone "Book now" prominent list row, the
 * guest-locked account rows (bookings, rewards → /auth), then the site
 * anchor rows (work · team · services · visit · careers). The signed-in
 * identity/account rows arrive with the account slices (06.3+).
 *
 * The modal contract (body scroll lock + scrollbar compensation, Escape,
 * Tab trap, focus capture/restore, background `inert`) comes from
 * UiSheetBehavior — dismissal is only *requested*; the header owns the
 * open state and flips it on `closed`.
 */
@Component({
  selector: 'cr-site-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LocaleThemeToggleComponent,
    RouterLink,
    TranslocoDirective,
    UiAvatar,
    UiBadge,
    UiButton,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiProgressView,
    UiRadiusDirective,
    UiRevealDirective,
    UiSpacer,
    UiStack,
    UiTextDirective,
  ],
  hostDirectives: [UiSheetBehavior],
  templateUrl: './site-menu.component.html',
  styleUrl: './site-menu.component.css',
})
export class SiteMenuComponent {
  readonly open = input.required<boolean>();
  readonly isAuthed = input(false);
  /** A staff-tier session — shows the day-sheet entry. UI-only: the /staff
   *  route guard and firestore.rules re-check for themselves. */
  readonly isStaffMember = input(false);
  /** One of the admin pair (`admin | sysadmin`) — shows the «Лоялност»
   *  entry, the ONE way to the admin page `/admin/loyalty/rhythm`
   *  (client-card revision 3 §3.17). UI-only, like `isStaffMember`: the
   *  route's `rolesGuard` and firestore.rules' `isAdmin()` are the locks. */
  readonly isAdmin = input(false);
  readonly closed = output();

  protected readonly behavior = inject(UiSheetBehavior);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly session = inject(AUTH_SESSION_PORTS);
  /** The injected clock — the schedule row's date reads it on every open. */
  private readonly clock = inject(CLOCK_PORTS);

  /**
   * The shop's zone — the default location's (Law 7.2, F-4: no zone
   * constant), read ONCE per session through the root `ShopZoneService`.
   * Asked here, at construction, because the header mounts this menu with
   * the shell: the read starts at shell mount, long before the menu opens.
   */
  private readonly shopZone = inject(ShopZoneService).defaultZone();

  /** Name + photo for the identity portrait — the same shell-level read
   *  model backing the header's trigger circle. */
  protected readonly identity = inject(SessionIdentityService);

  /**
   * Upcoming-visit count for the bookings row's trailing accessory — the
   * iOS badge grammar: a row states what is waiting behind it. Lives here
   * rather than in `SessionIdentityService` because it is not identity;
   * the menu is its only consumer today.
   *
   * Rendered only when non-zero — a "0" badge is noise, and its absence
   * already says "nothing upcoming".
   */
  private readonly appointments = inject(APPOINTMENT_READ_PORTS);

  protected readonly upcomingCount = toSignal(
    toObservable(this.identity.principal).pipe(
      switchMap((principal) => {
        if (!Principal.isActive(principal)) return of(0);
        return this.appointments
          .observeUpcoming(principal.userId)
          .pipe(map((result) => (result.ok ? result.value.length : 0)));
      }),
    ),
    { initialValue: 0 },
  );

  /**
   * Unread notifications — the row's indicator, on the SAME rule as the
   * bookings count: absent at zero, because a "0" badge is noise and its
   * absence already says the inbox is clear.
   *
   * Derived from the inbox stream via `NotificationSystem.unreadCount`,
   * not a second count query — one source, so the badge can never disagree
   * with the list it stands for.
   */
  private readonly inbox = inject(INBOX_PORTS);

  protected readonly unreadNotifications = toSignal(
    toObservable(this.identity.principal).pipe(
      switchMap((principal) => {
        if (!Principal.isActive(principal)) return of(0);
        return this.inbox
          .observeInbox(principal.userId)
          .pipe(
            map((result) =>
              result.ok ? NotificationSystem.unreadCount(result.value) : 0,
            ),
          );
      }),
    ),
    { initialValue: 0 },
  );

  /**
   * "ср, 6 август" — the day the schedule opens on, as its own subtitle.
   *
   * The weekday SHORT (owner, 2026-09-17): «четвъртък, 17 септември» — the
   * longest weekday and month Bulgarian has — outgrew the room the row
   * leaves beside its mark on a 330px phone and wrapped to two lines,
   * dropping the chevron under the date and growing the row. The short
   * weekday reads as a date at a glance, can never wrap at any phone
   * width, and is the weekday the staff day pill already uses.
   *
   * Deliberately a CLOCK READ, not a query. The obvious richer subtitle is
   * a live count ("4 visits today"), but the shop's day is N per-barber
   * listeners (see `StaffDayStore`, which is page-scoped for exactly that
   * reason) and this menu is mounted for the whole session — permanent
   * listeners to decorate a row nobody has tapped yet. The date carries
   * most of the value for none of the cost.
   *
   * Zone-pinned to the shop, like every other date in the product: a
   * barber checking the schedule from a phone set to another timezone must
   * still see the shop's own calendar day. The zone is the default
   * location's; until that one read resolves (or when it fails) there is
   * no date to name, and the subtitle is absent (Phase 4a 4A-2 (f)).
   */
  protected readonly todayLabel = computed(() => {
    const zone = this.shopZone();
    if (zone === null) return null;
    return formatInstant(
      this.openedAt(),
      zone,
      this.lang() === 'en' ? 'en-GB' : 'bg-BG',
      { weekday: 'short', day: 'numeric', month: 'long' },
    );
  });

  /**
   * The active language as a SIGNAL.
   *
   * `getActiveLang()` is a plain method call — reading it inside a
   * `computed` captures no dependency, so the date kept rendering in the
   * previous locale after the toggle while the title beside it switched.
   * `langChanges$` is the reactive half of the same API.
   */
  private readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  /**
   * Recomputed on every open, so a menu left mounted across midnight does
   * not keep naming yesterday. `computed` needs a signal to depend on, and
   * the clock's reading is not one — this is that dependency.
   */
  private readonly openedAt = signal(this.clock.nowUtcMs());

  /** The portrait's headline: the name, or — for a session with no name
   *  stamped — the identifier itself rather than an empty line. */
  protected readonly identityTitle = computed(
    () => this.identity.displayName() || this.identity.identifierLabel(),
  );

  /** The quiet second line, suppressed when the identifier already IS the headline. */
  protected readonly identitySubtitle = computed(() =>
    this.identity.displayName() ? this.identity.identifierLabel() : '',
  );

  constructor() {
    this.behavior.connect({
      open: this.open,
      dialogSelector: '.cr-menu',
      scrollerSelector: '.cr-menu__body',
      // The dialog container itself takes focus (tabindex="-1") — keyboard
      // users are inside the overlay without a visible ring on the first
      // link (owner call 2026-07-23: no control autofocus).
      initialFocusSelector: '.cr-menu',
      // Background chrome frozen while the overlay is up; the header stays
      // live — its trigger is the menu's ✕. One generic selector instead
      // of a per-page list: every page's root wrapper carries
      // `data-page-shell` (home.page.html, and now every other page that
      // renders this menu), so this works unmodified on any route.
      inertSelectors: ['[data-page-shell]'],
      // The header stays LIVE while the menu is up: it reads as part of
      // the open-menu chrome (logo, Вход pill) and its trigger doubles as
      // the menu's ✕ — freezing it left the close control unclickable.
      inertExemptSelectors: ['[data-testid="site-header"]'],
    });
    this.behavior.uiSheetDismissed.subscribe(() => this.closed.emit());

    // Every open re-checks storage for the portrait — a photo added
    // earlier in this same session (onboarding's avatar step) would
    // otherwise stay invisible behind the monogram until a reload.
    effect(() => {
      if (!this.open()) return;
      this.identity.refreshAvatar();
      // …and re-reads the clock, so the schedule row's date is right on a
      // menu opened after midnight in a session left running overnight.
      this.openedAt.set(this.clock.nowUtcMs());
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  /**
   * The menu's own session exit — signs out, closes the overlay and lands
   * on neutral ground regardless of the result (a failed sign-out must
   * never strand the user inside a stale-session menu; same posture as
   * onboarding's escape hatch).
   */
  protected async signOut(): Promise<void> {
    await this.session.signOut();
    this.close();
    await this.router.navigateByUrl('/');
  }
}
