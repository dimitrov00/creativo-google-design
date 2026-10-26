import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { map, of, shareReplay, startWith, switchMap } from 'rxjs';
import {
  CLOCK_PORTS,
  INBOX_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { AccountStateService } from '@creativo/features/client/account-state';
import { Principal } from '@core/components';
import type { InboxNotification } from '@core/entities';
import type { NotificationId, Result, UserId } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import { NotificationSystem } from '@core/systems';
import { LoadState } from '@creativo/shared/view-state';

/** One answer of the inbox listener, with the account it was read for. */
type InboxAnswer = {
  readonly owner: UserId;
  readonly result: Result<readonly InboxNotification[], RepositoryError>;
};

/**
 * THE SIGNED-IN ACCOUNT'S INBOX (OR-19) — `users/{uid}/notifications`, the
 * newest 50, live. Root-provided because two surfaces read it: the shell
 * menu's «Известия» badge (mounted for the whole session) and the
 * `/account/notifications` page. Both read THIS store, so there is ONE
 * listener and the badge can never disagree with the list it stands for.
 *
 * Read state lives on each notification (`readAtUtcMs`); the store words
 * none of it and decides none of it — the unread count and the receipt's
 * ids and instant are `NotificationSystem`'s. The receipt itself is the
 * page's to ask for, once per entry ({@link receipt}).
 */
@Injectable({ providedIn: 'root' })
export class InboxStore {
  private readonly ports = inject(INBOX_PORTS);
  private readonly clock = inject(CLOCK_PORTS);
  private readonly principal = inject(AccountStateService).principal;

  /** Bumped by {@link retry}: each bump is a fresh listener. */
  private readonly attempt = signal(0);

  /**
   * Whose inbox is read — the active account, `null` for anyone else (the
   * menu shows no count to them, the page is guarded). A string, so a
   * refreshed token for the same account keeps the listener it has.
   */
  private readonly owner = computed<UserId | null>(() => {
    const principal = this.principal();
    return Principal.isActive(principal) ? principal.userId : null;
  });

  /** What the listener is opened for — the owner, and which attempt. */
  private readonly reading = computed(() => ({
    owner: this.owner(),
    attempt: this.attempt(),
  }));

  /**
   * THE inbox stream — one `observeInbox` listener per owner, shared with a
   * replay of its latest answer (`shareReplay(1)`, ref-counted) by every
   * reader. `undefined` until the listener answers (again, after a
   * retry), `null` with no active account.
   */
  private readonly inbox$ = toObservable(this.reading).pipe(
    switchMap(({ owner }) =>
      owner === null
        ? of(null)
        : this.ports.observeInbox(owner).pipe(
            map((result): InboxAnswer => ({ owner, result })),
            // Loading again until the fresh listener answers: a retry that
            // kept showing the failure it retries would look dead.
            startWith(undefined),
          ),
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private readonly answer = toSignal(this.inbox$, { initialValue: undefined });

  /**
   * Where the read stands — the page's skeleton, rows, empty line or
   * failure. Loading until an active account's listener answers.
   */
  readonly state = computed<LoadState>(() => {
    const answer = this.answer();
    if (answer === undefined || answer === null) return LoadState.Loading;
    if (!answer.result.ok) return LoadState.Failed;
    return answer.result.value.length === 0 ? LoadState.Empty : LoadState.Ready;
  });

  /** The inbox, the newest first — empty until it answers, with no account, or on a failed read. */
  readonly notifications = computed<readonly InboxNotification[]>(() => {
    const answer = this.answer();
    if (answer === undefined || answer === null) return [];
    return answer.result.ok ? answer.result.value : [];
  });

  /**
   * How many are unread (`NotificationSystem.unreadCount`) — the menu
   * badge's figure: 0 with no account, so a signed-out visitor is never
   * shown one.
   */
  readonly unreadCount = computed(() =>
    NotificationSystem.unreadCount(this.notifications()),
  );

  /** Why the read failed — `null` unless it did. */
  readonly error = computed<RepositoryError | null>(() => {
    const answer = this.answer();
    if (answer === undefined || answer === null || answer.result.ok) {
      return null;
    }
    return answer.result.error;
  });

  /** Opens the listener again — after a failed read. */
  retry(): void {
    this.attempt.update((attempt) => attempt + 1);
  }

  /**
   * THE READ RECEIPT (OR-19) — the inbox page's entry, an automatic action
   * (never a «mark all read» button). Snapshots the ids unread in the
   * latest answer (`NotificationSystem.unreadIds`) and stamps them ALL with
   * ONE batched receipt, at `NotificationSystem.receiptAt` — the clock's
   * now, never before the newest of them was sent (DEP-F14). Answers the
   * snapshot: the page's dots. Writes nothing, and answers none, when
   * nothing is unread or no inbox has answered.
   *
   * The write is not awaited: the live listener carries its outcome — a
   * stamped inbox clears the badge, a refused one (the rules allow one
   * stamp, never before its message) leaves it as it was, and the next
   * entry asks again.
   */
  receipt(): readonly NotificationId[] {
    const answer = this.answer();
    if (answer === undefined || answer === null || !answer.result.ok) {
      return [];
    }
    const inbox = answer.result.value;
    const ids = NotificationSystem.unreadIds(inbox);
    if (ids.length === 0) return ids;
    const unread = inbox.filter((notification) =>
      NotificationSystem.isUnread(notification),
    );
    void this.ports.markNotificationsRead(
      answer.owner,
      ids,
      NotificationSystem.receiptAt(unread, this.clock.nowUtcMs()),
    );
    return ids;
  }
}
