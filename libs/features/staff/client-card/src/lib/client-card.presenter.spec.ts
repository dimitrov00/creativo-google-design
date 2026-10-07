import { describe, expect, it } from 'vitest';
import { AccountStatus, User } from '@creativo/application/accounts';
import {
  capsulesRun,
  clientHeadVm,
  clientPhotoVm,
  displayNameOf,
  isBirthdayToday,
  isInChairToday,
  medalStripVm,
  pauseOf,
  photoRailVm,
  quickActionsVm,
} from './client-card.presenter';
import type { ClientCapsuleVm } from './client-pages.vm';
import {
  GEORGI,
  GEORGI_PREVIOUS_MS,
  GUEST,
  MARTIN,
  MARTIN_PREVIOUS_MS,
  NOW_MS,
  SHOP_CATALOG,
  TODAY,
  achievementsContextOf,
  achievementsDataOf,
  at,
  georgiContext,
  georgiHistory,
  georgiOpenContext,
  georgiPhotos,
  georgiUser,
  martinContext,
  martinHistory,
  martinUser,
  must,
  pausedUntilOctober,
  statsOf,
  subjectOf,
  wordsOf,
} from '../testing/client-card.fixtures';

const WORDS = wordsOf('bg');
const GEORGI_BOOK = georgiHistory();
const GEORGI_STATS = statsOf(GEORGI, GEORGI_BOOK);
const MARTIN_BOOK = martinHistory();
const MARTIN_STATS = statsOf(MARTIN, MARTIN_BOOK);
const LOYALTY = achievementsDataOf('georgi', GEORGI_PREVIOUS_MS);

function headOf(overrides: Partial<Parameters<typeof clientHeadVm>[0]> = {}) {
  return clientHeadVm({
    subject: subjectOf(GEORGI),
    user: georgiUser(),
    settled: true,
    stats: GEORGI_STATS,
    statsKnown: true,
    avatarSrc: null,
    nowMs: NOW_MS,
    words: WORDS,
    ...overrides,
  });
}

describe('the head (A)', () => {
  it('names the account and says the tenure in the one state line — the cadence is the history band’s', () => {
    expect(
      headOf({ avatarSrc: 'https://example.test/avatars/georgi.jpg' }),
    ).toEqual({
      name: 'Георги Петров',
      stateLine: 'Клиент от март 2025 г.',
      avatarSrc: 'https://example.test/avatars/georgi.jpg',
      initialsFrom: 'Георги Петров',
      paused: false,
    });
  });

  it('renders from the seat at once, the state line held until the profile and the stats answer (D-9)', () => {
    expect(headOf({ user: null, settled: false, stats: null })).toEqual({
      name: 'Георги П.',
      stateLine: null,
      avatarSrc: null,
      initialsFrom: 'Георги П.',
      paused: false,
    });
  });

  it('renders from the seat before the card’s words have loaded, the line waiting for them', () => {
    expect(
      headOf({ user: null, settled: false, stats: null, words: null }),
    ).toEqual({
      name: 'Георги П.',
      stateLine: null,
      avatarSrc: null,
      initialsFrom: 'Георги П.',
      paused: false,
    });
    expect(headOf({ words: null }).stateLine).toBeNull();
    expect(headOf({ subject: GUEST, user: null, words: null })).toMatchObject({
      name: 'Иво',
      stateLine: null,
    });
  });

  it('prefers the seat’s own picture', () => {
    const subject = subjectOf(GEORGI, {
      avatarSrc: 'https://example.test/seat.jpg',
    });
    expect(
      headOf({ subject, avatarSrc: 'https://example.test/avatars/georgi.jpg' })
        .avatarSrc,
    ).toBe('https://example.test/seat.jpg');
  });

  it('says a pause and nothing else, rings the head, and says when it ends', () => {
    expect(headOf({ user: georgiUser(pausedUntilOctober()) })).toMatchObject({
      stateLine: 'Онлайн записването е спряно до 12.10',
      paused: true,
    });
    const permanent = AccountStatus.blocked({ reason: 'manual' });
    expect(headOf({ user: georgiUser(permanent) }).stateLine).toBe(
      'Онлайн записването е спряно за постоянно',
    );
  });

  it('treats a pause that has run out as none', () => {
    const lapsed = AccountStatus.blocked({
      reason: 'manual',
      until: at('2026-09-01T00:00:00'),
    });
    expect(headOf({ user: georgiUser(lapsed) })).toMatchObject({
      paused: false,
      stateLine: 'Клиент от март 2025 г.',
    });
  });

  it('says «Първо посещение» before the first worked visit, «Клиент от …» with or without a cadence, and «Гост» for a walk-in', () => {
    expect(headOf({ stats: null }).stateLine).toBe('Първо посещение');
    expect(
      headOf({ stats: { ...GEORGI_STATS, avgCadenceDays: null } }).stateLine,
    ).toBe('Клиент от март 2025 г.');
    // A one-week regular reads the same: the head never words a cadence.
    expect(
      headOf({ stats: { ...GEORGI_STATS, avgCadenceDays: 7 } }).stateLine,
    ).toBe('Клиент от март 2025 г.');
    expect(
      headOf({ subject: GUEST, user: null, stats: null, settled: false })
        .stateLine,
    ).toBe('Гост · без профил');
  });

  it('claims no tenure when the stats were never read', () => {
    expect(headOf({ stats: null, statsKnown: false }).stateLine).toBeNull();
  });

  it('keeps the seat’s label until a profile names the person', () => {
    expect(displayNameOf(subjectOf(GEORGI), null)).toBe('Георги П.');
    expect(displayNameOf(subjectOf(GEORGI), georgiUser())).toBe(
      'Георги Петров',
    );
  });
});

describe('pauseOf, isBirthdayToday, isInChairToday', () => {
  it('reads a pause on the shop’s calendar', () => {
    expect(pauseOf(georgiUser(pausedUntilOctober()), NOW_MS)).toEqual({
      until: '2026-10-12',
    });
    expect(pauseOf(georgiUser(), NOW_MS)).toBeNull();
    expect(pauseOf(null, NOW_MS)).toBeNull();
  });

  it('knows a birthday by month and day, a 29 February one on the 28th in other years', () => {
    expect(isBirthdayToday(martinUser(), TODAY)).toBe(true);
    expect(isBirthdayToday(georgiUser(), TODAY)).toBe(false);
    const leapling = User.reconstitute(
      {
        id: 'leap',
        phone: '+359881112233',
        firstName: 'Лили',
        lastName: 'Високосна',
        roles: ['client'],
        status: AccountStatus.active(),
        birthDate: '2000-02-29',
      },
      at('2027-02-28T09:00:00'),
    );
    if (leapling.isFailure()) throw new Error('bad user');
    expect(isBirthdayToday(leapling.value, '2027-02-28')).toBe(true);
    expect(isBirthdayToday(leapling.value, '2028-02-28')).toBe(false);
    expect(isBirthdayToday(leapling.value, '2028-02-29')).toBe(true);
  });

  it('puts the client in the chair only on an open visit today', () => {
    expect(isInChairToday(martinContext(), NOW_MS)).toBe(true);
    expect(isInChairToday(georgiContext(), NOW_MS)).toBe(false);
    expect(isInChairToday(georgiOpenContext(), NOW_MS)).toBe(false);
  });
});

describe('the capsules (B)', () => {
  it('shows four at most, then «+N» stands for the rest', () => {
    const capsule = (n: number): ClientCapsuleVm => ({
      id: 'tier',
      text: `#${n}`,
      tone: 'neutral',
      icon: null,
    });
    const four = [1, 2, 3, 4].map(capsule);
    expect(capsulesRun(four, WORDS)).toEqual({ shown: four, more: null });
    const six = [1, 2, 3, 4, 5, 6].map(capsule);
    expect(capsulesRun(six, WORDS)).toEqual({
      shown: six.slice(0, 3),
      more: { text: '+3', hidden: six.slice(3) },
    });
  });
});

describe('the quick actions (D)', () => {
  const actions = (
    overrides: Partial<Parameters<typeof quickActionsVm>[0]> = {},
  ) =>
    quickActionsVm({
      subject: subjectOf(MARTIN),
      user: martinUser(),
      name: 'Мартин Илиев',
      stats: MARTIN_STATS,
      context: martinContext(),
      online: true,
      nowMs: NOW_MS,
      words: WORDS,
      ...overrides,
    });

  it('calls, texts and Vibers the account’s own number, and offers the last visit again', () => {
    expect(actions()).toEqual([
      {
        id: 'call',
        icon: 'contact.phone',
        label: 'Обади се',
        href: 'tel:+359887654321',
        accessibleName: 'Обади се на Мартин Илиев, +359 88 765 4321',
      },
      {
        id: 'sms',
        icon: 'contact.sms',
        label: 'SMS',
        href: 'sms:+359887654321',
        accessibleName: 'SMS до Мартин Илиев',
      },
      {
        id: 'viber',
        icon: 'contact.viber',
        label: 'Viber',
        href: 'viber://chat?number=%2B359887654321',
        accessibleName: 'Viber до Мартин Илиев',
      },
      {
        id: 'same',
        icon: 'visit.repeat',
        label: 'Повтори',
        href: null,
        accessibleName:
          'Повтори посещението от 19 август: Класическа подстрижка',
        legs: must(MARTIN_STATS.lastVisit).legs,
      },
    ]);
  });

  it('keeps the phone links offline and drops «Повтори», which writes', () => {
    expect(actions({ online: false }).map((a) => a.id)).toEqual([
      'call',
      'sms',
      'viber',
    ]);
  });

  it('drops «Повтори» on a gone visit, on the last visit itself, and when the draft already holds it', () => {
    expect(
      actions({
        context: martinContext({ settled: true, gone: true }),
      }).map((a) => a.id),
    ).not.toContain('same');
    // A finished visit is still correctable: its services can be repeated.
    expect(
      actions({ context: martinContext({ settled: true }) }).map((a) => a.id),
    ).toContain('same');
    const onLast = martinContext({ appointmentId: 'appt-hist-c2-14' });
    expect(actions({ context: onLast }).map((a) => a.id)).not.toContain('same');
    const alreadyThere = martinContext({
      legs: [{ ...must(martinContext().legs[0]), variantId: null }],
    });
    expect(actions({ context: alreadyThere }).map((a) => a.id)).not.toContain(
      'same',
    );
  });

  it('drops «Повтори» when every one of its services left the catalogue', () => {
    const gone = martinContext({
      catalog: { ...SHOP_CATALOG, serviceName: () => null },
    });
    expect(actions({ context: gone }).map((a) => a.id)).not.toContain('same');
  });

  it('dials a guest from the seat, and offers nothing without a number', () => {
    expect(
      quickActionsVm({
        subject: GUEST,
        user: null,
        name: 'Иво',
        stats: null,
        context: martinContext({ isOwner: false }),
        online: true,
        nowMs: NOW_MS,
        words: WORDS,
      }).map((a) => [a.id, a.href]),
    ).toEqual([
      ['call', 'tel:+359890001111'],
      ['sms', 'sms:+359890001111'],
      ['viber', 'viber://chat?number=%2B359890001111'],
    ]);
    expect(
      quickActionsVm({
        subject: { ...GUEST, phone: null, phoneHref: null },
        user: null,
        name: 'Иво',
        stats: null,
        context: martinContext(),
        online: true,
        nowMs: NOW_MS,
        words: WORDS,
      }),
    ).toEqual([]);
  });
});

describe('the photo rail (I)', () => {
  it('leaves out the featured visit’s photos and the visit on screen’s', () => {
    expect(
      photoRailVm(
        georgiPhotos(),
        ['appt-hist-c1-23', 'appt-dev-1'],
        NOW_MS,
        WORDS,
      ),
    ).toEqual([
      {
        photoId: 'photo-dev-georgi-3',
        appointmentId: 'appt-hist-c1-22',
        url: 'https://example.test/photos/photo-dev-georgi-3.jpg',
        takenAtIso: at('2026-08-06T10:44:00').toISO(),
        dateLabel: '6.08',
        accessibleName: 'Снимка от 6 август',
        barberId: 'ivan',
        width: 1100,
        height: 1400,
      },
    ]);
  });

  it('shows six at most, newest first', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      ...must(georgiPhotos()[2]),
      photoId: `p-${i}`,
      appointmentId: `appt-${i}`,
    }));
    expect(
      photoRailVm(many, [null], NOW_MS, WORDS).map((p) => p.photoId),
    ).toEqual(['p-0', 'p-1', 'p-2', 'p-3', 'p-4', 'p-5']);
  });

  it('dates a photo from another year with its year', () => {
    const old = {
      ...must(georgiPhotos()[0]),
      takenAtIso: at('2025-12-01T10:00:00').toISO(),
    };
    expect(clientPhotoVm(old, NOW_MS, WORDS)).toMatchObject({
      dateLabel: '1.12.2025 г.',
      accessibleName: 'Снимка от 1 декември 2025 г.',
    });
  });
});

describe('the medal strip (G)', () => {
  it('calls only slot 1 «Ново»: the two closest are still to come, even when their last level is new', () => {
    const ctx = achievementsContextOf(georgiContext(), 'Георги Петров');
    // A previous visit before 22.09.2025: the fade's II is new too.
    const since = {
      ...LOYALTY,
      previousVisitAtMs: at('2025-09-01T12:00:00').toMillis(),
    };
    const strip = medalStripVm(since, ctx);
    expect(strip.medals.map((m) => [m.seriesId, m.isNew])).toEqual([
      ['series-rhythm', true],
      ['series-svc-fade', false],
      ['series-self-service', false],
    ]);
    expect(strip.medals[1]?.accessibleName).not.toContain('ново');
  });

  it('cues what this very visit completes first', () => {
    const strip = medalStripVm(
      LOYALTY,
      achievementsContextOf(georgiOpenContext(), 'Георги Петров'),
    );
    expect(strip.cue).toBe('С това посещение: Посещения, ниво\u00a0IV');
    // The family the cue names leads; the newest level follows, unmarked:
    // one callout per strip.
    expect(strip.medals.map((m) => [m.seriesId, m.isNew])).toEqual([
      ['series-visits', false],
      ['series-rhythm', false],
      ['series-svc-fade', false],
    ]);
    expect(strip.medals[2]?.accessibleName).toBe(
      'Фейд, ниво II, спечелено на 22 септември 2025 г., 24 от 25 до ниво III, с това посещение',
    );
  });

  it('puts Мартин’s birthday visit on the strip, and cues it', () => {
    const martin = achievementsDataOf('martin', MARTIN_PREVIOUS_MS);
    const strip = medalStripVm(
      martin,
      achievementsContextOf(martinContext(), 'Мартин Илиев', true),
    );
    // The cue names slot 1 — never the dashed cake in slot 2 while the
    // season's disc in slot 1 wears «Ново».
    expect(strip.medals.map((m) => [m.seriesId, m.isNew])).toEqual([
      ['series-birthday', false],
      ['series-2026-summer-track', false],
      ['series-twelve-months', false],
    ]);
    // A single act has no levels: no «ниво I» (review 3, F9).
    expect(strip.cue).toBe('Рожден ден в салона с това посещение');
  });

  it('cues the closest level when nothing is new and nothing completes', () => {
    const since = {
      ...LOYALTY,
      previousVisitAtMs: at('2026-09-28T11:00:00').toMillis(),
    };
    expect(
      medalStripVm(
        since,
        achievementsContextOf(georgiContext(), 'Георги Петров'),
      ).cue,
    ).toBe('Близо: Фейд, 24 от 25 до ниво\u00a0III');
  });
});
