import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NotificationPayload,
  NotificationTopic,
  RewardRefFields,
} from '@core/components';
import type { InboxNotification } from '@core/entities';
import {
  AppointmentId,
  CouponGrantId,
  NotificationId,
  type UtcEpochMs,
  WaitlistRequestId,
} from '@core/primitives';
import { deepFreeze, localDate, minute, utcMs } from '@core/testing';
import {
  type InboxInput,
  type InboxTranslate,
  inboxRowOf,
  inboxRowsOf,
} from './inbox.presenter';
import { notificationGlyphs } from './inbox.vm';

/*
 * THE INBOX'S WORDS (OR-19) — every topic worded in Bulgarian and in
 * English from the real catalogues (a key the presenter names and a
 * catalogue lacks fails here, not on a screen), each row's link built from
 * the payload's ids, its age measured to the page's one "now".
 */

type Catalogue = Record<string, unknown>;

function catalogue(lang: 'bg' | 'en'): Catalogue {
  return JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the app's own catalogue.
    readFileSync(
      resolve(
        __dirname,
        `../../../../../infrastructure/i18n/src/assets/i18n/${lang}.json`,
      ),
      'utf8',
    ),
  ) as Catalogue;
}

/** Transloco's reading, in miniature: a dotted key, `{{param}}` filled in. */
function translator(tree: Catalogue): InboxTranslate {
  return (key, params = {}) => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node !== null && typeof node === 'object'
            ? new Map(Object.entries(node)).get(part)
            : undefined,
        tree,
      );
    if (typeof value !== 'string') throw new Error(`missing word ${key}`);
    const filled = new Map(Object.entries(params));
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
      String(filled.get(name) ?? ''),
    );
  };
}

const WORDS = {
  bg: translator(catalogue('bg')),
  en: translator(catalogue('en')),
};

/** Monday 28 September 2026, noon in Sofia — the instant the page read. */
const NOW = utcMs('2026-09-28T12:00:00+03:00');

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

/** A freed slot on Friday 2 October at 10:00, matched two hours ago. */
const MATCH = note(
  'n-match',
  '2026-09-28T10:00:00+03:00',
  NotificationPayload.waitlistMatch(
    WaitlistRequestId.of('wl-1'),
    localDate('2026-10-02'),
    minute(600),
  ),
);

/** Friday's 14:30 visit, reminded yesterday. */
const REMINDER = note(
  'n-reminder',
  '2026-09-27T12:00:00+03:00',
  NotificationPayload.appointmentReminder(
    AppointmentId.of('appt-1'),
    localDate('2026-10-02'),
    minute(870),
  ),
);

/** A visit moved to Monday 5 October at 09:00, three days ago. */
const CHANGED = note(
  'n-changed',
  '2026-09-25T12:00:00+03:00',
  NotificationPayload.appointmentChanged(
    AppointmentId.of('appt-2'),
    localDate('2026-10-05'),
    minute(540),
  ),
);

/** A coupon granted 25 minutes ago. */
const REWARD = note(
  'n-reward',
  '2026-09-28T11:35:00+03:00',
  NotificationPayload.rewardGranted(
    RewardRefFields.couponGrant(CouponGrantId.of('grant-1')),
  ),
);

/** The shop's own news, four weeks old. */
const NEWS = note(
  'n-news',
  '2026-08-31T12:00:00+03:00',
  NotificationPayload.announcement(
    { bg: 'Нов салон в Лозенец', en: 'A new shop in Lozenets' },
    { bg: 'Отваряме на 1 октомври.', en: 'We open on 1 October.' },
  ),
);

function inputOf(
  lang: 'bg' | 'en',
  overrides: Partial<InboxInput> = {},
): InboxInput {
  return {
    notifications: [MATCH, REMINDER, CHANGED, REWARD, NEWS],
    unread: new Set(),
    nowUtcMs: NOW,
    lang,
    translate: lang === 'en' ? WORDS.en : WORDS.bg,
    ...overrides,
  };
}

const row = (
  notification: InboxNotification,
  lang: 'bg' | 'en',
  overrides: Partial<InboxInput> = {},
) => inboxRowOf(notification, inputOf(lang, overrides));

describe('inboxRowOf — WAITLIST_MATCH', () => {
  it('words a freed time in Bulgarian and deep-links to /book on its day', () => {
    expect(row(MATCH, 'bg')).toEqual({
      id: 'n-match',
      topic: NotificationTopic.WaitlistMatch,
      glyph: 'calendar.watching',
      title: 'Освободи се час',
      detail: 'пт, 2 октомври · 10:00',
      label: 'Освободи се час: пт, 2 октомври, 10:00. Запиши се',
      age: 'преди 2 ч',
      meta: 'преди 2 ч',
      unread: false,
      route: { path: '/book', query: { waitlist: 'wl-1', day: '2026-10-02' } },
    });
  });

  it('words it in English', () => {
    expect(row(MATCH, 'en')).toMatchObject({
      title: 'A time opened up',
      detail: 'Fri 2 October · 10:00',
      label: 'A time opened up: Fri 2 October, 10:00. Book it',
      age: '2 hr ago',
      route: { path: '/book', query: { waitlist: 'wl-1', day: '2026-10-02' } },
    });
  });
});

describe('inboxRowOf — the appointment topics', () => {
  it('words a reminder in both languages and leads to the account’s visits', () => {
    expect(row(REMINDER, 'bg')).toEqual({
      id: 'n-reminder',
      topic: NotificationTopic.AppointmentReminder,
      glyph: 'visit.calendar',
      title: 'Напомняне за часа ти',
      detail: 'пт, 2 октомври · 14:30',
      label: 'Напомняне за часа ти: пт, 2 октомври, 14:30. Виж часовете си',
      age: 'вчера',
      meta: 'вчера',
      unread: false,
      route: { path: '/account/appointments', query: null },
    });
    expect(row(REMINDER, 'en')).toMatchObject({
      title: 'Reminder: your visit',
      detail: 'Fri 2 October · 14:30',
      label:
        'Reminder: your visit — Fri 2 October, 14:30. See your appointments',
      age: 'yesterday',
      route: { path: '/account/appointments', query: null },
    });
  });

  it('words a changed visit in both languages and leads to the account’s visits', () => {
    expect(row(CHANGED, 'bg')).toEqual({
      id: 'n-changed',
      topic: NotificationTopic.AppointmentChanged,
      glyph: 'visit.reschedule',
      title: 'Часът ти е променен',
      detail: 'пн, 5 октомври · 09:00',
      label: 'Часът ти е променен: пн, 5 октомври, 09:00. Виж часовете си',
      age: 'преди 3 дни',
      meta: 'преди 3 дни',
      unread: false,
      route: { path: '/account/appointments', query: null },
    });
    expect(row(CHANGED, 'en')).toMatchObject({
      title: 'Your visit has changed',
      detail: 'Mon 5 October · 09:00',
      label:
        'Your visit has changed: Mon 5 October, 09:00. See your appointments',
      age: '3 days ago',
    });
  });
});

describe('inboxRowOf — REWARD_GRANTED', () => {
  it('words a new reward in both languages and leads to the account that holds it', () => {
    expect(row(REWARD, 'bg')).toEqual({
      id: 'n-reward',
      topic: NotificationTopic.RewardGranted,
      glyph: 'loyalty.reward',
      title: 'Имаш нова награда',
      detail: 'Виж я в профила си',
      label: 'Имаш нова награда. Виж я в профила си',
      age: 'преди 25 мин',
      meta: 'преди 25 мин',
      unread: false,
      route: { path: '/account', query: null },
    });
    expect(row(REWARD, 'en')).toMatchObject({
      title: "You've got a new reward",
      detail: 'See it in your account',
      label: "You've got a new reward. See it in your account",
      age: '25 min ago',
    });
  });
});

describe('inboxRowOf — ANNOUNCEMENT', () => {
  it('prints the shop’s own text in the active language, and leads nowhere', () => {
    expect(row(NEWS, 'bg')).toEqual({
      id: 'n-news',
      topic: NotificationTopic.Announcement,
      glyph: 'account.notifications',
      title: 'Нов салон в Лозенец',
      detail: 'Отваряме на 1 октомври.',
      label: 'Съобщение от салона: Нов салон в Лозенец',
      age: 'преди 4 седм.',
      meta: 'преди 4 седм.',
      unread: false,
      route: null,
    });
    expect(row(NEWS, 'en')).toMatchObject({
      title: 'A new shop in Lozenets',
      detail: 'We open on 1 October.',
      label: 'From the shop: A new shop in Lozenets',
      age: '4 wk ago',
      route: null,
    });
  });

  it('has no second line when the announcement has no body', () => {
    const headline = note(
      'n-headline',
      '2026-09-28T11:00:00+03:00',
      NotificationPayload.announcement(
        { bg: 'Затворено на 3 март', en: 'Closed on 3 March' },
        null,
      ),
    );
    expect(row(headline, 'bg')).toMatchObject({
      title: 'Затворено на 3 март',
      detail: null,
    });
  });

  it('reads an unknown language as the shop’s own, Bulgarian', () => {
    expect(row(NEWS, 'de' as 'bg', { translate: WORDS.bg })).toMatchObject({
      title: 'Нов салон в Лозенец',
      age: 'преди 4 седм.',
    });
  });
});

describe('inboxRowsOf', () => {
  it('words every topic of the dictionary, in the read’s order', () => {
    const rows = inboxRowsOf(inputOf('bg'));
    expect(rows.map((each) => each.id)).toEqual([
      'n-match',
      'n-reminder',
      'n-changed',
      'n-reward',
      'n-news',
    ]);
    expect(new Set(rows.map((each) => each.topic))).toEqual(
      new Set(Object.values(NotificationTopic)),
    );
    // One glyph per topic — the table is total over the dictionary.
    expect(Object.keys(notificationGlyphs).sort()).toEqual(
      Object.values(NotificationTopic).sort(),
    );
  });

  it('words an unread row’s description — the unread word, then the age — since the dot says nothing to a reader', () => {
    expect(row(MATCH, 'bg', { unread: new Set([MATCH.id]) })).toMatchObject({
      unread: true,
      meta: 'Ново, преди 2 ч',
    });
    expect(row(MATCH, 'en', { unread: new Set([MATCH.id]) })).toMatchObject({
      unread: true,
      meta: 'New, 2 hr ago',
    });
    // A read row's description is its age alone.
    expect(row(MATCH, 'en')).toMatchObject({
      unread: false,
      meta: '2 hr ago',
    });
  });

  it('draws the dot from the snapshot it is handed, never from the stamp', () => {
    // REMINDER is unread in its stamp but not in the snapshot; REWARD was
    // read (the receipt landed) but was unread on entry: the snapshot
    // decides, the presenter only draws it.
    const stampedReward = { ...REWARD, readAtUtcMs: NOW };
    const rows = inboxRowsOf(
      inputOf('bg', {
        notifications: [REMINDER, stampedReward],
        unread: new Set([REWARD.id]),
      }),
    );
    expect(rows.map((each) => [each.id, each.unread])).toEqual([
      ['n-reminder', false],
      ['n-reward', true],
    ]);
  });

  it('is empty for an empty inbox', () => {
    expect(inboxRowsOf(inputOf('en', { notifications: [] }))).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const input = deepFreeze(inputOf('bg', { unread: new Set([MATCH.id]) }));
    const once = inboxRowsOf(input);
    const twice = inboxRowsOf(input);
    expect(twice).toEqual(once);
    expect(input.notifications[0]).toEqual(MATCH);
  });
});
