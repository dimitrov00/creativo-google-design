import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { map, of, switchMap } from 'rxjs';
import { TranslocoDirective } from '@jsverse/transloco';
import { UserId } from '@creativo/application/accounts';
import {
  NOTIFICATION_READER,
  unreadCount,
} from '@creativo/application/notifications';
import {
  APPOINTMENT_REPOSITORY,
  ObserveUpcomingUseCase,
} from '@creativo/application/booking';
import { AUTH_GATEWAY, SignOutUseCase } from '@creativo/application/identity';
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
  UiRevealDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { UiListGroup, UiListRow } from '@creativo/ui/patterns';
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
    UiListGroup,
    UiListRow,
    UiProgressView,
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
  readonly closed = output();

  protected readonly behavior = inject(UiSheetBehavior);
  private readonly router = inject(Router);
  private readonly signOutUseCase = new SignOutUseCase(inject(AUTH_GATEWAY));

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
  private readonly observeUpcoming = new ObserveUpcomingUseCase(
    inject(APPOINTMENT_REPOSITORY),
  );

  protected readonly upcomingCount = toSignal(
    toObservable(this.identity.principal).pipe(
      switchMap((principal) => {
        if (principal.kind !== 'active') return of(0);
        const userId = UserId.create(principal.uid.value);
        if (userId.isFailure()) return of(0);
        return this.observeUpcoming
          .execute(userId.value)
          .pipe(
            map((result) => (result.isSuccess() ? result.value.length : 0)),
          );
      }),
    ),
    { initialValue: 0 },
  );

  /**
   * Unread notifications — the row's indicator, on the SAME rule as the
   * bookings count: absent at zero, because a "0" badge is noise and its
   * absence already says the inbox is clear.
   *
   * Derived from the inbox stream via the domain's own `unreadCount`, not
   * a second count query — one source, so the badge can never disagree
   * with the list it stands for.
   */
  private readonly notifications = inject(NOTIFICATION_READER);

  protected readonly unreadNotifications = toSignal(
    toObservable(this.identity.principal).pipe(
      switchMap((principal) => {
        if (principal.kind !== 'active') return of(0);
        const userId = UserId.create(principal.uid.value);
        if (userId.isFailure()) return of(0);
        return this.notifications
          .list(userId.value)
          .pipe(
            map((result) =>
              result.isSuccess() ? unreadCount(result.value) : 0,
            ),
          );
      }),
    ),
    { initialValue: 0 },
  );

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
      if (this.open()) this.identity.refreshAvatar();
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
    await this.signOutUseCase.execute();
    this.close();
    await this.router.navigateByUrl('/');
  }
}
