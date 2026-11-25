import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiAvatar, UiButton, type UiControlSize } from '@creativo/ui/controls';
import { UiVisuallyHiddenDirective } from '@creativo/ui/modifiers';
import { SessionIdentityService } from '../identity/session-identity.service';
import { SiteMenuComponent } from '../menu/site-menu.component';

/**
 * THE ACCOUNT MENU ON A PAGE WITH NO SITE HEADER — the signed-in face that
 * opens the SAME menu the site header opens (one navigation component
 * app-wide, owner ruling 2026-07-27), for a page whose own toolbar fills
 * the top of the screen: the schedule. Without it, a person who lands on
 * such a page in the installed app, where there is no browser back, cannot
 * sign out or reach any other page.
 *
 * The trigger is the header's monogram trigger: the face IS the button and
 * its name is the word «Меню», never an aria-label over the face (WCAG
 * 2.5.3). The menu draws its own ✕ and rises in the top layer
 * (`closeButton`), since there is no header trigger to double as the ✕.
 *
 * The menu comes to be on the first tap, not with the page: it reads the
 * bookings, the inbox and the shops the moment it exists, and a schedule
 * a barber never leaves should not pay for a menu nobody opened. Once
 * made it stays, so its close plays out and gives the focus back.
 */
@Component({
  selector: 'cr-account-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SiteMenuComponent,
    TranslocoDirective,
    UiAvatar,
    UiButton,
    UiVisuallyHiddenDirective,
  ],
  template: `
    <ng-container *transloco="let t">
      <button
        type="button"
        uiButton
        uiButtonStyle="bordered"
        uiTint="neutral"
        [uiControlSize]="size()"
        [uiIconOnly]="true"
        class="cr-account-menu__trigger"
        data-testid="account-menu-trigger"
        [attr.aria-expanded]="open()"
        (click)="present()"
      >
        <span uiVisuallyHidden>{{ t('landing.nav.menu') }}</span>
        <ui-avatar
          class="cr-account-menu__face"
          aria-hidden="true"
          [uiSrc]="identity.avatarUrl()"
          [uiName]="identity.displayName()"
          [uiControlSize]="size()"
        />
      </button>
      @if (made()) {
        <cr-site-menu
          [open]="open()"
          [closeButton]="true"
          [isAuthed]="identity.isAuthed()"
          [isStaffMember]="identity.isStaffMember()"
          [worksTheBook]="identity.worksTheBook()"
          [managesCatalog]="identity.managesCatalog()"
          [isAdmin]="identity.isAdmin()"
          [readsAnalytics]="identity.readsAnalytics()"
          [opensTeam]="identity.opensTeam()"
          [opensOwnProfile]="identity.opensOwnProfile()"
          (closed)="open.set(false)"
        />
      }
    </ng-container>
  `,
  styleUrl: './account-menu.component.css',
  host: { class: 'cr-account-menu' },
})
export class AccountMenuComponent {
  /** The face's rung on the 36/44/52 scale — the bar's own controls' size
   *  (the schedule's thumb bar is `large`). */
  readonly size = input<UiControlSize>('regular');
  protected readonly identity = inject(SessionIdentityService);
  protected readonly open = signal(false);
  /** Whether the menu has been opened once — it is made on that tap. */
  protected readonly made = signal(false);

  protected present(): void {
    this.made.set(true);
    this.open.set(true);
  }
}
