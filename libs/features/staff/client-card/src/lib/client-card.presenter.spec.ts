import { describe, expect, it } from 'vitest';
import { BirthDate, E164 } from '@core/components';
import { AppointmentId, AppointmentPhotoId, UserId } from '@core/primitives';
import { registeredUserFixture } from '@core/testing';
import {
  capsulesRun,
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
  SHOP_TIME_ZONE,
  TODAY,
  achievementsContextOf,
  achievementsDataOf,
  georgiContext,
  georgiOpenContext,
  georgiPhotos,
  georgiUser,
  martinContext,
  martinHistory,
  martinUser,
  must,
  pausedUntilOctober,
  sofia,
  statsOf,
  subjectOf,
  wordsOf,
} from '../testing/client-card.fixtures';

const WORDS = wordsOf('bg');
const MARTIN_BOOK = martinHistory();
const MARTIN_STATS = statsOf(MARTIN, MARTIN_BOOK);
const LOYALTY = achievementsDataOf('georgi', GEORGI_PREVIOUS_MS);

describe('displayNameOf, pauseOf, isBirthdayToday, isInChairToday', () => {
  it('keeps the seat’s label until a profile names the person', () => {
    expect(displayNameOf(subjectOf(GEORGI), null)).toBe('Георги П.');
    expect(displayNameOf(subjectOf(GEORGI), georgiUser())).toBe(
      'Георги Петров',
    );
  });

  it('reads a pause on the shop’s calendar', () => {
    expect(
      pauseOf(georgiUser(pausedUntilOctober()), NOW_MS, SHOP_TIME_ZONE),
    ).toEqual({
      until: '2026-10-12',
    });
    expect(pauseOf(georgiUser(), NOW_MS, SHOP_TIME_ZONE)).toBeNull();
    expect(pauseOf(null, NOW_MS, SHOP_TIME_ZONE)).toBeNull();
  });

  it('knows a birthday by month and day, a 29 February one on the 28th in other years', () => {
    expect(isBirthdayToday(martinUser(), TODAY)).toBe(true);
    expect(isBirthdayToday(georgiUser(), TODAY)).toBe(false);
    const leapling = registeredUserFixture({
      id: UserId.of('leap'),
      phone: E164.of('+359881112233'),
      firstName: 'Лили',
      lastName: 'Високосна',
      birthDate: BirthDate.of('2000-02-29'),
    });
    expect(isBirthdayToday(leapling, '2027-02-28')).toBe(true);
    expect(isBirthdayToday(leapling, '2028-02-28')).toBe(false);
    expect(isBirthdayToday(leapling, '2028-02-29')).toBe(true);
  });

  it('puts the client in the chair only on an open visit today', () => {
    expect(isInChairToday(martinContext(), NOW_MS, SHOP_TIME_ZONE)).toBe(true);
    expect(isInChairToday(georgiContext(), NOW_MS, SHOP_TIME_ZONE)).toBe(false);
    expect(isInChairToday(georgiOpenContext(), NOW_MS, SHOP_TIME_ZONE)).toBe(
      false,
    );
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
      zone: SHOP_TIME_ZONE,
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
        legs: MARTIN_STATS.lastVisitLegs,
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
        zone: SHOP_TIME_ZONE,
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
        zone: SHOP_TIME_ZONE,
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
        SHOP_TIME_ZONE,
        WORDS,
      ),
    ).toEqual([
      {
        photoId: 'photo-dev-georgi-3',
        appointmentId: 'appt-hist-c1-22',
        url: 'https://example.test/photos/photo-dev-georgi-3.jpg',
        takenAtUtcMs: sofia('2026-08-06T10:44:00'),
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
      id: AppointmentPhotoId.of(`p-${i}`),
      appointmentId: AppointmentId.of(`appt-${i}`),
    }));
    expect(
      photoRailVm(many, [null], NOW_MS, SHOP_TIME_ZONE, WORDS).map(
        (p) => p.photoId,
      ),
    ).toEqual(['p-0', 'p-1', 'p-2', 'p-3', 'p-4', 'p-5']);
  });

  it('dates a photo from another year with its year', () => {
    const old = {
      ...must(georgiPhotos()[0]),
      takenAtUtcMs: sofia('2025-12-01T10:00:00'),
    };
    expect(clientPhotoVm(old, NOW_MS, SHOP_TIME_ZONE, WORDS)).toMatchObject({
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
      previousVisitAtMs: sofia('2025-09-01T12:00:00'),
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
      previousVisitAtMs: sofia('2026-09-28T11:00:00'),
    };
    expect(
      medalStripVm(
        since,
        achievementsContextOf(georgiContext(), 'Георги Петров'),
      ).cue,
    ).toBe('Близо: Фейд, 24 от 25 до ниво\u00a0III');
  });
});
