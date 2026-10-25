import {
  AppointmentId,
  AppointmentPhotoId,
  WaitlistRequestId,
} from '@core/primitives';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { VisitRowPhotoSource } from '../visit-row.presenter';
import type {
  VisitPerspective,
  VisitRowPhoto,
  VisitWaitlistWords,
  VisitWords,
} from '../visit-row.vm';
import {
  type VisitCardOptions,
  VisitCardSlot,
  type VisitCardVm,
  type VisitCardWords,
  type VisitLinePart,
  type WaitlistCardOptions,
  visitCardSlotWords,
} from './visit-card.vm';

/*
 * The card's view model is types only: the type cases are checked by the
 * compiler, and they pin the shapes the other packages build against
 * (revision 3 §3.10, §7.3) — the card's builders, the glance's presenter,
 * the client's account page — so a change that would break a host breaks
 * here first. The value cases pin what a hand-built card looks like: the
 * three kinds in ONE order.
 */

const last = {
  id: AppointmentId.of('apt-1'),
  visitCardSlot: VisitCardSlot.Last,
  label: 'Последно посещение',
  services: 'Фейд · Оформяне на брада',
  facts: [
    { text: '5.09', fact: true },
    { text: ' · Иван · Център', fact: false },
  ],
  figure: '27,50 €',
  quote: '„Къса отстрани, по-дълго отгоре“',
  capsule: null,
  barber: { name: 'Иван Колев', avatarSrc: null },
  photos: [
    {
      id: AppointmentPhotoId.of('p1'),
      url: 'p1.jpg',
      alt: 'Снимка от 5 септември',
    },
  ],
  accessibleName:
    'Последно посещение: Фейд · Оформяне на брада, 5 септември, Иван Колев, Център, 27,50 €',
  testId: 'client-visit-last',
} as const satisfies VisitCardVm;

const next = {
  id: AppointmentId.of('apt-2'),
  visitCardSlot: VisitCardSlot.Next,
  label: 'Следващ час',
  services: 'Фейд',
  facts: [
    { text: 'пт, 23.10 · ', fact: false },
    { text: '10:00', fact: true },
    { text: ' · Иван', fact: false },
  ],
  figure: null,
  quote: null,
  capsule: { text: 'Потвърден', tone: 'accent' },
  barber: { name: 'Иван Колев', avatarSrc: null },
  photos: [],
  accessibleName: 'Следващ час: Фейд, петък, 23 октомври, 10:00, Иван Колев',
  testId: 'client-visit-next',
} as const satisfies VisitCardVm;

const waitlist = {
  id: WaitlistRequestId.of('waitlist-1'),
  visitCardSlot: VisitCardSlot.Waitlist,
  label: 'Чака свободен час',
  services: 'Класическа подстрижка',
  facts: [{ text: '8.10 – 9.10, следобед · още 1', fact: false }],
  figure: null,
  quote: null,
  capsule: null,
  barber: null,
  photos: [],
  accessibleName:
    'Класическа подстрижка, чака свободен час: четвъртък и петък, следобед',
  testId: 'client-visit-waitlist',
} as const satisfies VisitCardVm;

describe('visit card view model', () => {
  it('names three kinds: the last visit, the next one, a waiting request', () => {
    expectTypeOf<VisitCardSlot>().toEqualTypeOf<'LAST' | 'NEXT' | 'WAITLIST'>();
    expectTypeOf<VisitCardVm['visitCardSlot']>().toEqualTypeOf<VisitCardSlot>();
    // The host prints each slot's lower-case word (`data-kind`).
    expect(visitCardSlotWords).toEqual({
      LAST: 'last',
      NEXT: 'next',
      WAITLIST: 'waitlist',
    });
  });

  it('always carries the services, and the label of its kind', () => {
    expectTypeOf<VisitCardVm['services']>().toEqualTypeOf<string>();
    expectTypeOf<VisitCardVm['label']>().toEqualTypeOf<string>();
    for (const card of [last, next, waitlist]) {
      expect(card.services).not.toBe('');
      expect(card.label).not.toBe('');
    }
  });

  it('sets a quiet line as runs, the fact among them', () => {
    expectTypeOf<VisitLinePart>().toEqualTypeOf<{
      readonly text: string;
      readonly fact: boolean;
    }>();
    expectTypeOf<VisitCardVm['facts']>().toEqualTypeOf<
      readonly VisitLinePart[]
    >();
    // The runs carry their own separators: a template joins nothing.
    expect(last.facts.map((part) => part.text).join('')).toBe(
      '5.09 · Иван · Център',
    );
    expect(next.facts.map((part) => part.text).join('')).toBe(
      'пт, 23.10 · 10:00 · Иван',
    );
    // ONE fact: the date of a last visit, the time of a next one.
    expect(last.facts.filter((part) => part.fact)).toEqual([
      { text: '5.09', fact: true },
    ]);
    expect(next.facts.filter((part) => part.fact)).toEqual([
      { text: '10:00', fact: true },
    ]);
    expect(waitlist.facts.filter((part) => part.fact)).toEqual([]);
  });

  it('prints money, a status and a face only where the kind has them', () => {
    expectTypeOf<VisitCardVm['figure']>().toEqualTypeOf<string | null>();
    expectTypeOf<
      NonNullable<VisitCardVm['capsule']>['text']
    >().toEqualTypeOf<string>();
    expectTypeOf<VisitCardVm['barber']>().toEqualTypeOf<{
      readonly name: string;
      readonly avatarSrc: string | null;
    } | null>();
    // A status is news on a next visit alone.
    expect(last.capsule).toBeNull();
    expect(waitlist.capsule).toBeNull();
    expect(next.capsule).toEqual({ text: 'Потвърден', tone: 'accent' });
    // Money is a worked visit's.
    expect(next.figure).toBeNull();
    expect(waitlist.figure).toBeNull();
  });

  it('draws the thumbs the row drew: one photo shape in the lib', () => {
    expectTypeOf<VisitCardVm['photos']>().toEqualTypeOf<
      readonly VisitRowPhoto[]
    >();
    expectTypeOf<NonNullable<VisitCardOptions['photos']>>().toEqualTypeOf<
      readonly VisitRowPhotoSource[]
    >();
  });

  it('takes its test id from the host', () => {
    expectTypeOf<VisitCardVm['testId']>().toEqualTypeOf<string>();
    expectTypeOf<VisitCardOptions['testId']>().toEqualTypeOf<string>();
    expectTypeOf<WaitlistCardOptions['testId']>().toEqualTypeOf<string>();
  });

  it('builds a visit from the words the row already reads', () => {
    expectTypeOf<VisitCardOptions['visitCardSlot']>().toEqualTypeOf<
      typeof VisitCardSlot.Last | typeof VisitCardSlot.Next
    >();
    expectTypeOf<
      VisitCardOptions['perspective']
    >().toEqualTypeOf<VisitPerspective>();
    expectTypeOf<VisitCardOptions['words']>().toEqualTypeOf<VisitWords>();
    expectTypeOf<
      VisitCardOptions['cardWords']
    >().toEqualTypeOf<VisitCardWords>();
    // What a host may leave out.
    expectTypeOf<
      Pick<
        VisitCardOptions,
        | 'visitCardSlot'
        | 'perspective'
        | 'subjectUserId'
        | 'now'
        | 'timeZone'
        | 'locale'
        | 'words'
        | 'cardWords'
        | 'testId'
      >
    >().toExtend<VisitCardOptions>();
  });

  it('words only what the row does not: the two labels and the sentence', () => {
    expectTypeOf<keyof VisitCardWords>().toEqualTypeOf<
      'last' | 'next' | 'name'
    >();
    expectTypeOf<VisitCardWords['last']>().toEqualTypeOf<string>();
    expectTypeOf<VisitCardWords['next']>().toEqualTypeOf<string>();
    expectTypeOf<VisitCardWords['name']>().returns.toEqualTypeOf<string>();
    // The status words are the row's: one «Заявен» in the lib.
    expectTypeOf<VisitWords['statusPending']>().toEqualTypeOf<string>();
    expectTypeOf<VisitWords['statusConfirmed']>().toEqualTypeOf<
      string | undefined
    >();
  });

  it('builds a waiting request from the request’s own words', () => {
    expectTypeOf<
      WaitlistCardOptions['words']
    >().toEqualTypeOf<VisitWaitlistWords>();
    expectTypeOf<
      Pick<WaitlistCardOptions, 'words' | 'today' | 'locale' | 'testId'>
    >().toExtend<WaitlistCardOptions>();
  });
});
