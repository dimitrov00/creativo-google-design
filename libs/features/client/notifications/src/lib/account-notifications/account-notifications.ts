import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { CLOCK_PORTS } from '@creativo/infrastructure/firebase-app';
import {
  loadedLanguage,
  translateCodedError,
} from '@creativo/infrastructure/i18n';
import type { NotificationId } from '@core/primitives';
import { NotificationSystem } from '@core/systems';
import { UiButton, UiIcon, UiSkeleton } from '@creativo/ui/controls';
import { UiStack, UiToolbar } from '@creativo/ui/layout';
import {
  UiEmptyState,
  UiListGroup,
  UiListRow,
  UiNotice,
  UiSheetHeadline,
} from '@creativo/ui/patterns';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiInteractiveDirective,
  UiPaddingDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import { LoadState, loadStateWords } from '@creativo/shared/view-state';
import { inboxRowsOf } from '../inbox.presenter';
import type { InboxRowVm } from '../inbox.vm';
import { InboxStore } from '../inbox.store';

/** How many rows the skeleton stands in for — a glance at an inbox, not its size. */
const SKELETON_ROWS = [0, 1, 2] as const;

/**
 * `/account/notifications` — THE INBOX (OR-19): the account's notifications,
 * newest first, each a row that says what happened and leads to where it
 * can be acted on (a freed time to `/book`, a visit to the account's
 * visits). Reached from the shell menu's «Известия» row.
 *
 * Entering it READS everything: once the inbox has answered, the page
 * snapshots what is unread — those rows keep their accent dot for the
 * visit — and asks the store for ONE batched receipt. No «mark all read»
 * button (quiet chrome): opening the inbox is the act, and the menu's badge
 * clears on the receipt the live listener brings back.
 *
 * Chrome as `/account/appointments`: a sticky bar with an icon-only back to
 * the account, and the page's large title under it (`ui-sheet-headline`).
 */
@Component({
  selector: 'lib-account-notifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslocoDirective,
    UiButton,
    UiEmptyState,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiNotice,
    UiPaddingDirective,
    UiSheetHeadline,
    UiSkeleton,
    UiStack,
    UiTextDirective,
    UiToolbar,
    UiVisuallyHiddenDirective,
    UiWeightDirective,
  ],
  templateUrl: './account-notifications.html',
  styleUrl: './account-notifications.css',
  host: {
    'data-testid': 'notifications-page',
    '[attr.data-state]': 'stateWord()',
  },
})
export class AccountNotifications {
  protected readonly store = inject(InboxStore);
  private readonly transloco = inject(TranslocoService);

  protected readonly LoadState = LoadState;
  protected readonly skeletonRows = SKELETON_ROWS;

  /**
   * "Now", read ONCE on entry through the clock port — what every row's age
   * is measured to (an elapsed-time phrase, T2).
   */
  private readonly nowUtcMs = inject(CLOCK_PORTS).nowUtcMs();

  /** The language whose words are loaded — `null` until they are. */
  private readonly lang = toSignal(loadedLanguage(this.transloco), {
    initialValue: null,
  });

  /** The ids unread when the page was entered — the receipt's, and the dots'. */
  private readonly enteredUnread = signal<readonly NotificationId[]>([]);
  /** The receipt is asked for once per entry. */
  private entered = false;

  /** The page's `data-state` — the e2e contract (`loading | ready | empty | failed`). */
  protected readonly stateWord = computed(
    () => loadStateWords[this.store.state()],
  );

  /**
   * Every row, worded (`inboxRowsOf`). A row is dotted when it was unread on
   * entry — the dot stays for the visit, after the receipt has landed — or
   * is unread now (one that arrived while the page is open: the receipt
   * was asked for before it existed).
   */
  protected readonly rows = computed<readonly InboxRowVm[]>(() => {
    const lang = this.lang();
    if (lang === null) return [];
    const notifications = this.store.notifications();
    return inboxRowsOf({
      notifications,
      unread: new Set([
        ...this.enteredUnread(),
        ...NotificationSystem.unreadIds(notifications),
      ]),
      nowUtcMs: this.nowUtcMs,
      lang,
      translate: (key, params) => this.transloco.translate(key, params, lang),
    });
  });

  /** A failed read in words (`errors.<errorCode>`) — `null` unless it failed. */
  protected readonly failure = computed<string | null>(() => {
    const error = this.store.error();
    if (error === null || this.lang() === null) return null;
    return translateCodedError(this.transloco, error);
  });

  constructor() {
    // THE ENTRY (OR-19): the first time the inbox has answered — at once
    // when the menu's listener already holds it, after the read on a cold
    // deep link, after a retry when it failed — snapshot what is unread and
    // stamp it with ONE receipt. Nothing is written when nothing is unread.
    effect(() => {
      const state = this.store.state();
      if (this.entered) return;
      if (state !== LoadState.Ready && state !== LoadState.Empty) return;
      this.entered = true;
      untracked(() => this.enteredUnread.set(this.store.receipt()));
    });
  }
}
