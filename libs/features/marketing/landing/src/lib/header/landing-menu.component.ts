import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiIcon } from '@creativo/ui/controls';
import { UiDivider, UiSheetBehavior, UiStack } from '@creativo/ui/layout';
import { UiFrameDirective, UiRevealDirective } from '@creativo/ui/modifiers';
import { UiCard, UiListRow } from '@creativo/ui/patterns';
import { LocaleThemeToggleComponent } from '../shared/prefs/locale-theme-toggle.component';

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
  selector: 'cr-landing-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LocaleThemeToggleComponent,
    RouterLink,
    TranslocoDirective,
    UiCard,
    UiDivider,
    UiFrameDirective,
    UiIcon,
    UiListRow,
    UiRevealDirective,
    UiStack,
  ],
  hostDirectives: [UiSheetBehavior],
  templateUrl: './landing-menu.component.html',
  styleUrl: './landing-menu.component.css',
})
export class LandingMenuComponent {
  readonly open = input.required<boolean>();
  readonly isAuthed = input(false);
  readonly closed = output();

  protected readonly behavior = inject(UiSheetBehavior);

  constructor() {
    this.behavior.connect({
      open: this.open,
      dialogSelector: '.cr-menu',
      scrollerSelector: '.cr-menu__body',
      initialFocusSelector:
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      // Background chrome frozen while the overlay is up; the header stays
      // live — its trigger is the menu's ✕.
      inertSelectors: [
        'cr-landing-hero',
        '.cr-landing__main',
        'cr-landing-footer',
      ],
    });
    this.behavior.uiSheetDismissed.subscribe(() => this.closed.emit());
  }

  protected close(): void {
    this.closed.emit();
  }
}
