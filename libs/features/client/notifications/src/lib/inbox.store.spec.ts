import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NEVER, type Observable, Subject, defer, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  CLOCK_PORTS,
  INBOX_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { AccountStateService } from '@creativo/features/client/account-state';
import { NotificationPayload, type Principal } from '@core/components';
import type { InboxNotification } from '@core/entities';
import type {
  InboxPorts,
  MarkNotificationsRead,
  ObserveInbox,
} from '@core/ports';
import {
  NotificationId,
  Result,
  UserId,
  type UtcEpochMs,
  WaitlistRequestId,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  localDate,
  memoryClockPorts,
  memoryInboxPorts,
  minute,
  principalFixture,
  utcMs,
} from '@core/testing';
import { LoadState } from '@creativo/shared/view-state';
import { InboxStore } from './inbox.store';

/*
 * THE INBOX STORE (OR-19): one listener for the badge and the page, the
 * unread count from `NotificationSystem`, and the page's ONE receipt per
 * entry — none when nothing is unread.
 */

const ANA = UserId.of('u-ana');
const NOW = utcMs('2026-09-28T12:00:00+03:00');

function note(
  id: string,
  sentAt: string,
  readAtUtcMs: UtcEpochMs | null = null,
): InboxNotification {
  return {
    id: NotificationId.of(id),
    sentAtUtcMs: utcMs(sentAt),
    readAtUtcMs,
    ...NotificationPayload.waitlistMatch(
      WaitlistRequestId.of(`wl-${id}`),
      localDate('2026-10-02'),
      minute(600),
    ),
  };
}

const UNREAD_OLD = note('n1', '2026-09-27T10:00:00+03:00');
const READ = note('n2', '2026-09-27T11:00:00+03:00', NOW);
const UNREAD_NEW = note('n3', '2026-09-28T11:00:00+03:00');

function setup(options: {
  readonly inbox?: InboxNotification[];
  readonly principal?: Principal;
  readonly now?: UtcEpochMs;
  /** Stands in for the listener outright. */
  readonly observeInbox?: ObserveInbox;
}) {
  const principal = signal<Principal>(
    options.principal ?? principalFixture.client(ANA),
  );
  const memory = memoryInboxPorts(new Map([[ANA, [...(options.inbox ?? [])]]]));
  let listeners = 0;
  const observe: ObserveInbox = options.observeInbox ?? memory.observeInbox;
  const receipts = vi.fn<MarkNotificationsRead>(memory.markNotificationsRead);
  const ports: InboxPorts = {
    observeInbox: (userId) =>
      defer(() => {
        listeners += 1;
        return observe(userId);
      }),
    markNotificationsRead: receipts,
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: INBOX_PORTS, useValue: ports },
      { provide: CLOCK_PORTS, useValue: memoryClockPorts(options.now ?? NOW) },
      {
        provide: AccountStateService,
        useValue: { principal } as unknown as AccountStateService,
      },
    ],
  });
  const store = TestBed.inject(InboxStore);
  TestBed.tick();
  return {
    store,
    principal,
    receipts,
    listeners: () => listeners,
  };
}

describe('InboxStore — the one inbox listener', () => {
  it('reads the active account’s inbox and counts its unread', () => {
    const { store, listeners } = setup({
      inbox: [UNREAD_OLD, READ, UNREAD_NEW],
    });

    expect(store.state()).toBe(LoadState.Ready);
    expect(store.notifications().map((each) => each.id)).toEqual([
      'n3',
      'n2',
      'n1',
    ]);
    expect(store.unreadCount()).toBe(2);
    expect(store.error()).toBeNull();
    expect(listeners()).toBe(1);
  });

  it('answers EMPTY for an inbox with nothing in it', () => {
    const { store } = setup({ inbox: [] });
    expect(store.state()).toBe(LoadState.Empty);
    expect(store.unreadCount()).toBe(0);
  });

  it('opens no listener and counts nothing for a visitor who is not signed in', () => {
    const { store, listeners } = setup({
      inbox: [UNREAD_OLD],
      principal: principalFixture.anonymous(),
    });

    expect(listeners()).toBe(0);
    expect(store.unreadCount()).toBe(0);
    expect(store.notifications()).toEqual([]);
    expect(store.state()).toBe(LoadState.Loading);
  });

  it('keeps its one listener when the same account’s token is refreshed', () => {
    const { store, principal, listeners } = setup({ inbox: [UNREAD_OLD] });

    // A refreshed token re-emits an equal principal — a new object.
    principal.set({ ...principalFixture.client(ANA) });
    TestBed.tick();

    expect(listeners()).toBe(1);
    expect(store.unreadCount()).toBe(1);
  });

  it('follows the live inbox: the badge drops as soon as the receipt comes back', () => {
    const live = new Subject<
      Result<readonly InboxNotification[], RepositoryError>
    >();
    const { store } = setup({ observeInbox: () => live });

    expect(store.state()).toBe(LoadState.Loading);
    live.next(Result.ok([UNREAD_NEW, UNREAD_OLD]));
    expect(store.unreadCount()).toBe(2);
    live.next(
      Result.ok([
        { ...UNREAD_NEW, readAtUtcMs: NOW },
        { ...UNREAD_OLD, readAtUtcMs: NOW },
      ]),
    );
    expect(store.unreadCount()).toBe(0);
  });

  it('answers a failed read as FAILED, with its error, and reads again on retry', () => {
    const failure = RepositoryError.readFailed(
      'users/u-ana/notifications',
      'permission-denied',
    );
    let answers: Observable<
      Result<readonly InboxNotification[], RepositoryError>
    > = of(Result.err(failure));
    const { store, listeners } = setup({ observeInbox: () => answers });

    expect(store.state()).toBe(LoadState.Failed);
    expect(store.error()).toEqual(failure);
    expect(store.unreadCount()).toBe(0);

    answers = of(Result.ok([UNREAD_OLD]));
    store.retry();
    TestBed.tick();

    expect(listeners()).toBe(2);
    expect(store.state()).toBe(LoadState.Ready);
    expect(store.error()).toBeNull();
    expect(store.unreadCount()).toBe(1);
  });
});

describe('InboxStore.receipt — one batched receipt per entry', () => {
  it('stamps every unread notification with ONE receipt at the clock’s now, and answers them', () => {
    const { store, receipts } = setup({
      inbox: [UNREAD_OLD, READ, UNREAD_NEW],
    });

    const seen = store.receipt();

    expect(seen).toEqual(['n3', 'n1']);
    expect(receipts).toHaveBeenCalledTimes(1);
    expect(receipts).toHaveBeenCalledWith(ANA, ['n3', 'n1'], NOW);
  });

  it('never stamps before the newest unread message was sent (a clock running behind)', () => {
    const behind = utcMs('2026-09-28T10:00:00+03:00');
    const { store, receipts } = setup({
      inbox: [UNREAD_OLD, UNREAD_NEW],
      now: behind,
    });

    store.receipt();

    expect(receipts).toHaveBeenCalledWith(
      ANA,
      ['n3', 'n1'],
      UNREAD_NEW.sentAtUtcMs,
    );
  });

  it('writes no receipt when nothing is unread', () => {
    const { store, receipts } = setup({ inbox: [READ] });

    expect(store.receipt()).toEqual([]);
    expect(receipts).not.toHaveBeenCalled();
  });

  it('writes no receipt for an empty inbox', () => {
    const { store, receipts } = setup({ inbox: [] });

    expect(store.receipt()).toEqual([]);
    expect(receipts).not.toHaveBeenCalled();
  });

  it('writes no receipt before the inbox has answered', () => {
    const { store, receipts } = setup({ observeInbox: () => NEVER });

    expect(store.receipt()).toEqual([]);
    expect(receipts).not.toHaveBeenCalled();
  });

  it('writes no receipt for a visitor who is not signed in', () => {
    const { store, receipts } = setup({
      inbox: [UNREAD_OLD],
      principal: principalFixture.anonymous(),
    });

    expect(store.receipt()).toEqual([]);
    expect(receipts).not.toHaveBeenCalled();
  });
});
