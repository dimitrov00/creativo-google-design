import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiButton } from '@creativo/ui/controls';
import { CrIcon } from '../shared/icons/icons';
import { LocaleThemeToggleComponent } from '../shared/prefs/locale-theme-toggle.component';

/**
 * The full-screen guest navigation overlay — v2 `nav-menu.tsx` +
 * `nav-overlay.tsx` in their signed-out projection: preferences lead
 * (locale · theme), the standalone inverted "Book now" card, the
 * guest-locked account rows (bookings, rewards → /auth), then the site
 * anchor rows (work · team · services · visit · careers). The signed-in
 * identity/account rows arrive with the account slices (06.3+).
 */
@Component({
  selector: 'cr-landing-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CrIcon,
    LocaleThemeToggleComponent,
    RouterLink,
    TranslocoDirective,
    UiButton,
  ],
  templateUrl: './landing-menu.component.html',
  styleUrl: './landing-menu.component.css',
})
export class LandingMenuComponent {
  readonly open = input.required<boolean>();
  readonly isAuthed = input(false);
  readonly closed = output();

  private readonly document = inject(DOCUMENT);

  constructor() {
    // Body scroll lock while the overlay is up (v2 NavOverlay effect).
    effect(() => {
      this.document.body.style.overflow = this.open() ? 'hidden' : '';
    });
  }

  protected close(): void {
    this.closed.emit();
  }
}
