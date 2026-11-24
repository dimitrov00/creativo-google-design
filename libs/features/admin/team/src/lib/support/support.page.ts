import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { UserId } from '@core/primitives';
import { SiteHeaderComponent } from '@creativo/features/shared/shell';
import { UiStack } from '@creativo/ui/layout';
import { UiButton } from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiPaddingDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { AccountLookupStore } from '../account-lookup.store';
import { AccountPickSheet } from '../account-pick-sheet/account-pick-sheet';
import type { LinkRowVm, LinkVm } from '../link.vm';
import { TeamWording } from '../team-wording.service';
import { ReadAsSheet } from './read-as-sheet';
import { supportLookupVm } from './support.presenter';
import { supportWordsOf } from './support.words';

type Target = { readonly userId: UserId; readonly name: string };

/**
 * `/support` — THE SUPPORT READ-AS PAGE (OR-24, docs/designs/
 * support-read-as.md): the vendor's sysadmin finds an account with the
 * Team's one lookup sheet and reads the app as that person — read-only,
 * up to 15 minutes, the reason written down. A root page: the site header
 * carries the menu. The sysadmin opens no Team page (its permissions hold
 * no team column), so this page is support's door, behind `Roles.SUPPORT`.
 */
@Component({
  selector: 'lib-support-page',
  imports: [
    AccountPickSheet,
    ReadAsSheet,
    SiteHeaderComponent,
    TranslocoDirective,
    UiButton,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiPaddingDirective,
    UiStack,
    UiTextDirective,
  ],
  providers: [AccountLookupStore],
  templateUrl: './support.page.html',
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'team-page', 'data-testid': 'support-page' },
})
export class SupportPage {
  protected readonly lookup = inject(AccountLookupStore);
  private readonly wording = inject(TeamWording);
  private readonly transloco = inject(TranslocoService);

  protected readonly lookupOpen = signal(false);
  protected readonly lookupClosing = signal(false);
  protected readonly target = signal<Target | null>(null);
  protected readonly sheetClosing = signal(false);

  protected readonly lookupVm = computed<LinkVm | null>(() => {
    const words = this.wording.words();
    if (words === null) return null;
    const lang = this.wording.locale();
    return supportLookupVm({
      found: this.lookup.accounts(),
      asked: this.lookup.asked(),
      searching: this.lookup.searching(),
      failed: this.lookup.failed(),
      words,
      supportWords: supportWordsOf((key, params) =>
        this.transloco.translate(key, { ...params }, lang),
      ),
    });
  });

  constructor() {
    inject(Title).setTitle(
      this.transloco.translate('admin.support.documentTitle'),
    );
  }

  protected openLookup(): void {
    this.target.set(null);
    this.lookupClosing.set(false);
    this.lookupOpen.set(true);
  }

  /** A row picked: the lookup steps away, and the reason's sheet comes up once it has. */
  protected pick(row: LinkRowVm): void {
    this.target.set({ userId: row.userId, name: row.name });
    this.lookupClosing.set(true);
  }

  protected lookupClosed(): void {
    this.lookupOpen.set(false);
    this.lookupClosing.set(false);
    this.sheetClosing.set(false);
  }

  protected sheetClosed(): void {
    this.target.set(null);
    this.sheetClosing.set(false);
  }
}
