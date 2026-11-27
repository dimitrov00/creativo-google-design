import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import type { ContactLink } from '@core/components';
import { UiIcon, UiModalSheet } from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { UiListGroup, UiListRow, UiSheetHeadline } from '@creativo/ui/patterns';
import { opensNewTab } from './program-contact.presenter';
import { CONTACT_ICON, type ContactSheetVm } from './program-contact.vm';

/**
 * The ways to answer a role, a course or an event that has more than one:
 * a short sheet under the thing's name, each way a row that opens it — a
 * call, a mail, the Instagram profile, the link. `/careers`, `/courses` and
 * `/events` mount it once and hand it the row that was tapped; a thing with
 * a single way never opens it (its row is the link).
 *
 * It closes itself: a dismissal plays the sheet's exit, then `uiClosed`
 * tells the page to let go of the row.
 */
@Component({
  selector: 'cr-contact-sheet',
  imports: [
    TranslocoDirective,
    UiForegroundStyleDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiModalSheet,
    UiSheetHeadline,
    UiTextDirective,
  ],
  template: `
    <ng-container *transloco="let t">
      @if (uiContact(); as contact) {
        <ui-modal-sheet
          sheetId="contact-sheet"
          labelledBy="contact-sheet-title"
          uiPresentationSizing="automatic"
          [fitted]="true"
          [closeLabel]="t('programs.contact.close')"
          [open]="!closing()"
          [closing]="closing()"
          data-testid="contact-sheet"
          (dismissed)="closing.set(true)"
          (closeFinished)="finish()"
        >
          <span sheet-title>{{ contact.title }}</span>
          <div class="cr-contact-sheet">
            <ui-sheet-headline>
              <h2
                id="contact-sheet-title"
                uiSheetLargeTitle
                uiText
                uiFont="title2"
              >
                {{ contact.title }}
              </h2>
              <p uiText uiFont="subheadline" uiForegroundStyle="secondary">
                {{ t('programs.contact.choose') }}
              </p>
            </ui-sheet-headline>
            <ui-list-group>
              @for (link of contact.contacts; track link.contactMethod) {
                <a
                  uiListRow
                  uiSize="large"
                  [uiInteractive]="true"
                  [href]="link.href"
                  [attr.target]="newTab(link) ? '_blank' : null"
                  rel="noopener"
                  [attr.data-testid]="'contact-link-' + link.contactMethod"
                >
                  <span uiLeading>
                    <ui-icon
                      [uiName]="icons[link.contactMethod]"
                      aria-hidden="true"
                    />
                  </span>
                  {{ t('programs.contact.action.' + link.contactMethod) }}
                </a>
              }
            </ui-list-group>
          </div>
        </ui-modal-sheet>
      }
    </ng-container>
  `,
  styles: `
    .cr-contact-sheet {
      display: flex;
      flex-direction: column;
      gap: var(--sys-space-comfortable);
      min-inline-size: 0;
      padding-inline: var(--modal-sheet-safe);
      padding-block: var(--sys-space-comfortable) var(--sys-space-loose);
    }
  `,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactSheetComponent {
  /** The thing to answer; `null` while no row is open. */
  readonly uiContact = input<ContactSheetVm | null>(null);
  /** The sheet has left: the page lets go of the row. */
  readonly uiClosed = output<void>();

  protected readonly icons = CONTACT_ICON;
  protected readonly closing = signal(false);

  protected newTab(link: ContactLink): boolean {
    return opensNewTab(link);
  }

  protected finish(): void {
    this.closing.set(false);
    this.uiClosed.emit();
  }
}
