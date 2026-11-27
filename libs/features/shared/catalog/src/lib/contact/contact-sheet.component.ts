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
import {
  UiListGroup,
  UiListRow,
  UiRichText,
  UiSheetHeadline,
} from '@creativo/ui/patterns';
import { opensNewTab } from './program-contact.presenter';
import { CONTACT_ICON, type ContactSheetVm } from './program-contact.vm';

/**
 * A role, a course or an event, opened: its name, where it is worked, its
 * words in full and its description (`ui-rich-text`) when the page hands
 * them over, then the ways to answer
 * it — each a row that opens a call, a mail, the Instagram profile or the
 * link. `/careers` opens it for every role (the row is the door to the
 * role); `/courses` and `/events` open it for a thing answered several
 * ways, and link a thing answered one way straight from its row.
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
    UiRichText,
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
                uiFont="largeTitle"
              >
                {{ contact.title }}
              </h2>
              @if (contact.workplaceTag || contact.shopsLine) {
                <p
                  uiText
                  uiFont="subheadline"
                  uiForegroundStyle="secondary"
                  class="cr-contact-sheet__where"
                  data-testid="contact-sheet-where"
                >
                  <ui-icon uiName="location.place" aria-hidden="true" />
                  <span>
                    @if (contact.workplaceTag; as tag) {
                      {{ t('programs.workplace.' + tag) }}
                    }
                    @if (contact.workplaceTag && contact.shopsLine) {
                      ·
                    }
                    {{ contact.shopsLine }}</span
                  >
                </p>
              }
            </ui-sheet-headline>
            @if (contact.summary; as summary) {
              <p
                class="cr-contact-sheet__summary"
                data-testid="contact-sheet-summary"
              >
                {{ summary }}
              </p>
            }
            @if (contact.body?.length) {
              <ui-rich-text
                [uiBlocks]="contact.body ?? []"
                [uiHeadingLevel]="3"
                data-testid="contact-sheet-body"
              />
            }
            <h3 uiText uiFont="headline" class="cr-contact-sheet__ways">
              {{ t('programs.contact.choose') }}
            </h3>
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

    .cr-contact-sheet__where {
      display: flex;
      align-items: center;
      gap: var(--sys-space-tight);
      margin: 0;
    }

    .cr-contact-sheet__summary,
    .cr-contact-sheet__ways {
      margin: 0;
    }

    .cr-contact-sheet__summary {
      white-space: pre-line;
      text-wrap: pretty;
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
