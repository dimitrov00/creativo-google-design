import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Injectable, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type Translation,
  type TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  CLOCK_PORTS,
  INBOX_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { AccountStateService } from '@creativo/features/client/account-state';
import {
  NotificationPayload,
  type Principal,
  RewardRefFields,
} from '@core/components';
import type { InboxNotification } from '@core/entities';
import type { MarkNotificationsRead } from '@core/ports';
import {
  AppointmentId,
  CouponGrantId,
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
  minute,
  principalFixture,
  utcMs,
} from '@core/testing';
import { AccountNotifications } from './account-notifications';

/*
 * `/account/notifications` (OR-19): the inbox's rows, worded and linked;
 * the entry's ONE receipt for what was unread, whose dots stay for the
 * visit; no receipt when nothing is unread; the empty and failed states.
 */

const ANA = UserId.of('u-ana');
const NOW = utcMs('2026-09-28T12:00:00+03:00');

/** The app's own catalogue — the page is worded from the real keys. */
function catalogue(lang: 'bg' | 'en'): Translation {
  return JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
    readFileSync(
      resolve(
        __dirname,
        `../../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
      ),
      'utf8',
    ),
  ) as Translation;
}

@Injectable()
class CatalogueLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(catalogue(lang === 'en' ? 'en' : 'bg'));
  }
}

function note(
  id: string,
  sentAt: string,
  payload: NotificationPayload,
  readAtUtcMs: UtcEpochMs | null = null,
): InboxNotification {
  return {
    id: NotificationId.of(id),
    sentAtUtcMs: utcMs(sentAt),
    readAtUtcMs,
    ...payload,
  };
}

const MATCH = note(
  'n-match',
  '2026-09-28T10:00:00+03:00',
  NotificationPayload.waitlistMatch(
    WaitlistRequestId.of('wl-1'),
    localDate('2026-10-02'),
    minute(600),
  ),
);
const REMINDER = note(
  'n-reminder',
  '2026-09-27T12:00:00+03:00',
  NotificationPayload.appointmentReminder(
    AppointmentId.of('appt-1'),
    localDate('2026-10-02'),
    minute(870),
  ),
);
const REWARD = note(
  'n-reward',
  '2026-09-26T12:00:00+03:00',
  NotificationPayload.rewardGranted(
    RewardRefFields.couponGrant(CouponGrantId.of('grant-1')),
  ),
  utcMs('2026-09-26T13:00:00+03:00'),
);
const NEWS = note(
  'n-news',
  '2026-09-20T12:00:00+03:00',
  NotificationPayload.announcement(
    { bg: 'Нов салон в Лозенец', en: 'A new shop in Lozenets' },
    null,
  ),
  utcMs('2026-09-21T12:00:00+03:00'),
);

type InboxAnswer = Result<readonly InboxNotification[], RepositoryError>;

async function render(options: {
  /** The live inbox — the spec `next`s it. */
  readonly inbox$: BehaviorSubject<InboxAnswer | null>;
  readonly principal?: Principal;
}) {
  const receipts = vi.fn<MarkNotificationsRead>(async () =>
    Result.ok(undefined),
  );
  await TestBed.configureTestingModule({
    imports: [AccountNotifications],
    providers: [
      provideRouter([]),
      provideTransloco({
        config: {
          availableLangs: ['bg', 'en'],
          defaultLang: 'bg',
          fallbackLang: 'bg',
          missingHandler: { logMissingKey: false },
        },
        loader: CatalogueLoader,
      }),
      {
        provide: INBOX_PORTS,
        useValue: {
          // A `null` stands for "no answer yet": the listener is open, silent.
          observeInbox: () =>
            new Observable<InboxAnswer>((subscriber) =>
              options.inbox$.subscribe((answer) => {
                if (answer !== null) subscriber.next(answer);
              }),
            ),
          markNotificationsRead: receipts,
        },
      },
      { provide: CLOCK_PORTS, useValue: memoryClockPorts(NOW) },
      {
        provide: AccountStateService,
        useValue: {
          principal: signal(options.principal ?? principalFixture.client(ANA)),
        } as unknown as AccountStateService,
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AccountNotifications);
  const settle = async () => {
    for (let pass = 0; pass < 3; pass++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  await settle();
  const host: HTMLElement = fixture.nativeElement;
  const rows = () =>
    Array.from(
      host.querySelectorAll<HTMLElement>('[data-testid="notifications-row"]'),
    );
  return { fixture, host, rows, receipts, settle };
}

describe('AccountNotifications — the inbox page', () => {
  it('heads the page «Известия» and words every row, newest first', async () => {
    const inbox$ = new BehaviorSubject<InboxAnswer | null>(
      Result.ok([MATCH, REMINDER, REWARD, NEWS]),
    );
    const { host, rows } = await render({ inbox$ });

    expect(host.getAttribute('data-state')).toBe('ready');
    expect(
      host.querySelector('[data-testid="notifications-title"]')?.textContent,
    ).toContain('Известия');
    expect(host.querySelector('ui-sheet-headline')).not.toBeNull();
    expect(rows().map((row) => row.getAttribute('data-topic'))).toEqual([
      'WAITLIST_MATCH',
      'APPOINTMENT_REMINDER',
      'REWARD_GRANTED',
      'ANNOUNCEMENT',
    ]);
    const [match] = rows();
    expect(match?.textContent).toContain('Освободи се час');
    expect(match?.textContent).toContain('пт, 2 октомври · 10:00');
    expect(match?.textContent).toContain('преди 2 ч');
    expect(match?.getAttribute('aria-label')).toBe(
      'Освободи се час: пт, 2 октомври, 10:00. Запиши се',
    );
  });

  it('deep-links a waitlist match to /book on its day, a visit to the account’s visits, a reward to the account', async () => {
    const inbox$ = new BehaviorSubject<InboxAnswer | null>(
      Result.ok([MATCH, REMINDER, REWARD, NEWS]),
    );
    const { rows } = await render({ inbox$ });
    const [match, reminder, reward, news] = rows();

    expect(match?.getAttribute('href')).toBe(
      '/book?waitlist=wl-1&day=2026-10-02',
    );
    expect(reminder?.getAttribute('href')).toBe('/account/appointments');
    expect(reward?.getAttribute('href')).toBe('/account');
    // An announcement only says something: a static row, named by its sentence.
    expect(news?.tagName.toLowerCase()).toBe('ui-list-row');
    expect(news?.hasAttribute('href')).toBe(false);
    expect(news?.getAttribute('aria-label')).toBe(
      'Съобщение от салона: Нов салон в Лозенец',
    );
  });

  it('stamps ONE receipt on entry for what was unread, and keeps their dots after it lands', async () => {
    const inbox$ = new BehaviorSubject<InboxAnswer | null>(
      Result.ok([MATCH, REMINDER, REWARD, NEWS]),
    );
    const { rows, receipts, settle } = await render({ inbox$ });

    expect(receipts).toHaveBeenCalledTimes(1);
    expect(receipts).toHaveBeenCalledWith(ANA, ['n-match', 'n-reminder'], NOW);
    const dotted = () =>
      rows()
        .filter((row) => row.hasAttribute('data-unread'))
        .map((row) => row.getAttribute('data-topic'));
    expect(dotted()).toEqual(['WAITLIST_MATCH', 'APPOINTMENT_REMINDER']);

    // The receipt comes back through the live listener…
    inbox$.next(
      Result.ok([
        { ...MATCH, readAtUtcMs: NOW },
        { ...REMINDER, readAtUtcMs: NOW },
        REWARD,
        NEWS,
      ]),
    );
    await settle();

    // …and changes nothing on the page: no second receipt, the dots stay.
    expect(receipts).toHaveBeenCalledTimes(1);
    expect(dotted()).toEqual(['WAITLIST_MATCH', 'APPOINTMENT_REMINDER']);
    // Each dot is the accent disc, its box kept on a read row too.
    expect(
      rows()[0]
        ?.querySelector('.notifications__dot')
        ?.hasAttribute('data-unread'),
    ).toBe(true);
    expect(
      rows()[2]
        ?.querySelector('.notifications__dot')
        ?.hasAttribute('data-unread'),
    ).toBe(false);
  });

  it('describes every row for a screen reader — the unread word on an unread row, then its age — since the dot is a shape', async () => {
    const inbox$ = new BehaviorSubject<InboxAnswer | null>(
      Result.ok([MATCH, REMINDER, REWARD, NEWS]),
    );
    const { host, rows } = await render({ inbox$ });
    const description = (row: Element | undefined) => {
      const id = row?.getAttribute('aria-describedby');
      expect(id).toBeTruthy();
      const line = host.querySelector(`[id="${id}"]`);
      // The line lives in the row's own trailing run, hidden from sight.
      expect(row?.contains(line ?? null)).toBe(true);
      expect(line?.hasAttribute('data-visually-hidden')).toBe(true);
      return line?.textContent?.trim();
    };
    const [match, , reward, news] = rows();
    // The name stays the whole sentence (OR-19); the description adds
    // what the dot draws and the age the name leaves out.
    expect(match?.getAttribute('aria-label')).toBe(
      'Освободи се час: пт, 2 октомври, 10:00. Запиши се',
    );
    expect(description(match)).toBe('Ново, преди 2 ч');
    // A read row is described by its age alone — the static row too.
    const rewardAge = description(reward);
    expect(rewardAge).not.toContain('Ново');
    expect(
      reward?.querySelector('.notifications__trail')?.textContent,
    ).toContain(rewardAge ?? '');
    expect(description(news)).not.toContain('Ново');
    // The visible age is not read twice.
    expect(
      match
        ?.querySelector('.notifications__trail > [aria-hidden="true"]')
        ?.textContent?.trim(),
    ).toBe('преди 2 ч');
  });

  it('dots a notification that arrives while the page is open, without a second receipt', async () => {
    const inbox$ = new BehaviorSubject<InboxAnswer | null>(Result.ok([REWARD]));
    const { rows, receipts, settle } = await render({ inbox$ });

    inbox$.next(Result.ok([MATCH, REWARD]));
    await settle();

    expect(receipts).not.toHaveBeenCalled();
    expect(rows()[0]?.hasAttribute('data-unread')).toBe(true);
    expect(rows()[1]?.hasAttribute('data-unread')).toBe(false);
  });

  it('writes no receipt when nothing is unread', async () => {
    const inbox$ = new BehaviorSubject<InboxAnswer | null>(
      Result.ok([REWARD, NEWS]),
    );
    const { rows, receipts } = await render({ inbox$ });

    expect(receipts).not.toHaveBeenCalled();
    expect(rows().some((row) => row.hasAttribute('data-unread'))).toBe(false);
  });

  it('waits for the inbox on a cold entry, then stamps its one receipt', async () => {
    const inbox$ = new BehaviorSubject<InboxAnswer | null>(null);
    const { host, receipts, settle } = await render({ inbox$ });

    expect(host.getAttribute('data-state')).toBe('loading');
    expect(
      host.querySelector('[data-testid="notifications-skeleton"]'),
    ).not.toBeNull();
    expect(receipts).not.toHaveBeenCalled();

    inbox$.next(Result.ok([MATCH]));
    await settle();

    expect(host.getAttribute('data-state')).toBe('ready');
    expect(receipts).toHaveBeenCalledTimes(1);
    expect(receipts).toHaveBeenCalledWith(ANA, ['n-match'], NOW);
  });

  it('says «Няма известия» for an empty inbox, and writes nothing', async () => {
    const inbox$ = new BehaviorSubject<InboxAnswer | null>(Result.ok([]));
    const { host, receipts } = await render({ inbox$ });

    expect(host.getAttribute('data-state')).toBe('empty');
    expect(
      host.querySelector('[data-testid="notifications-empty"]')?.textContent,
    ).toContain('Няма известия');
    expect(receipts).not.toHaveBeenCalled();
  });

  it('says why a failed read failed, offers «Опитай пак», and stamps nothing', async () => {
    const inbox$ = new BehaviorSubject<InboxAnswer | null>(
      Result.err(
        RepositoryError.readFailed(
          'users/u-ana/notifications',
          'permission-denied',
        ),
      ),
    );
    const { host, receipts } = await render({ inbox$ });

    expect(host.getAttribute('data-state')).toBe('failed');
    const notice = host.querySelector('[data-testid="notifications-failed"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent?.trim().length).toBeGreaterThan(0);
    expect(notice?.textContent).not.toContain('errors.');
    expect(
      host.querySelector('[data-testid="notifications-retry"]')?.textContent,
    ).toContain('Опитай пак');
    expect(receipts).not.toHaveBeenCalled();
  });

  it('leads back to the account with an icon-only back', async () => {
    const inbox$ = new BehaviorSubject<InboxAnswer | null>(Result.ok([]));
    const { host } = await render({ inbox$ });

    const back = host.querySelector('[data-testid="notifications-back"]');
    expect(back?.getAttribute('href')).toBe('/account');
    expect(back?.getAttribute('aria-label')).toBe('Назад');
    expect(back?.textContent?.trim()).toBe('');
  });
});
