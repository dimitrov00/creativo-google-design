import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiAvatar, UiModalSheet, UiSearchField } from '@creativo/ui/controls';
import { UiIcon } from '@creativo/ui/icons';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiAlert,
  UiEmptyState,
  UiListGroup,
  UiListRow,
  UiNotice,
  UiSectionHeader,
  UiSheetActionBar,
  UiSheetHeadline,
} from '@creativo/ui/patterns';
import type { LinkQuestionVm, LinkRowVm, LinkVm } from '../link.vm';

/**
 * AN ACCOUNT, PICKED FROM A LOOKUP — the one sheet «Свържи профил» and
 * «Добави в екипа» both are (team onboarding D8): a headline that says
 * what the account is for, the accounts on show, what the sheet says with
 * none, the search in the dock (the house sheet-search grammar: the
 * headline folds while it is engaged), and the question a row asks before
 * anything is sent.
 *
 * It holds what was typed and nothing else. Which accounts are on show,
 * what a row's question says and what its answer does are its host's: it
 * prints the display structs it is handed and reports the presses.
 */
@Component({
  selector: 'lib-account-pick-sheet',
  imports: [
    TranslocoDirective,
    UiAlert,
    UiAvatar,
    UiEmptyState,
    UiForegroundStyleDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiModalSheet,
    UiNotice,
    UiSearchField,
    UiSectionHeader,
    UiSheetActionBar,
    UiSheetHeadline,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './account-pick-sheet.html',
  styleUrl: '../team-pages.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Every selector in the stylesheet is `team-page`-prefixed.
  encapsulation: ViewEncapsulation.None,
})
export class AccountPickSheet {
  /** Names the sheet's parts for a test: `<id>-sheet`, `<id>-query`, `<id>-question`, … */
  readonly uiSheetId = input.required<string>();
  /** The sheet's title, in the bar and as the headline. */
  readonly uiTitle = input.required<string>();
  /** The accounts on show and what the sheet says with none; `null` until its words have loaded. */
  readonly uiVm = input.required<LinkVm | null>();
  /** The question about the account picked; `null` until one is. */
  readonly uiQuestion = input<LinkQuestionVm | null>(null);
  /** That question is up. */
  readonly uiQuestionOpen = input(false);
  /** Why the last call was refused, in words; `null` when it was not. */
  readonly uiRefusal = input<string | null>(null);
  /** A call is on its way: the rows take no press. */
  readonly uiPending = input(false);
  /** The lookup in force has not answered yet. */
  readonly uiSearching = input(false);
  /** The sheet is leaving: its close animation runs. */
  readonly uiClosing = input(false);
  /**
   * An answer that is no account at all («Без профил в приложението»),
   * offered first, above the accounts; `null` for a sheet whose answer has
   * to be an account.
   */
  readonly uiSkipLabel = input<string | null>(null);

  /** What was typed, on every keystroke. */
  readonly queried = output<string>();
  /** A row was pressed. */
  readonly picked = output<LinkRowVm>();
  /** The no-account answer was pressed. */
  readonly skipped = output<void>();
  /** The question was answered, with the answer's id. */
  readonly answered = output<string>();
  /** The question was let go: Escape, the scrim. */
  readonly questionDismissed = output<void>();
  /** ✕, Escape, the scrim. */
  readonly dismissed = output<void>();
  /** The close animation ended. */
  readonly closeFinished = output<void>();

  protected readonly query = signal('');
  protected readonly searchFocused = signal(false);
  /** The field holds the keyboard or a query: the headline folds. */
  protected readonly searchEngaged = computed(
    () => this.searchFocused() || this.query().trim() !== '',
  );

  protected ask(query: string): void {
    this.query.set(query);
    this.queried.emit(query);
  }
}
