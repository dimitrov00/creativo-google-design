import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { AUTH_GATEWAY, SignOutUseCase } from '@creativo/application/identity';
import { UiIcon } from '@creativo/ui/controls';
import { UiSheetBehavior, UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiRevealDirective,
} from '@creativo/ui/modifiers';
import { UiListGroup, UiListRow } from '@creativo/ui/patterns';
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
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiRevealDirective,
    UiStack,
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
