import { describe, expect, it } from 'vitest';
import { Result, ZonedDateTime } from '@creativo/domain/kernel';
import { Service } from '@creativo/domain/catalog';
import { BookingPolicy, CalendarDay } from '@creativo/domain/scheduling';
import {
  type DecideWaitlistDeps,
  type DecideWaitlistRequest,
  decideWaitlist,
} from './decide-waitlist';
import { RequestWaitlistInvalidError } from './request-waitlist.errors';
import type { Firestore } from 'firebase-admin/firestore';
import { CommitBookingShopUnavailableError } from './commit-booking.errors';
import { CommitBookingUseCase } from './commit-booking.use-case';
import {
  type BookingSnapshot,
  type RequestedSeat,
  decideBooking,
} from './decide-booking';
import { FirestoreBookingStore } from '../adapters/firestore-booking-store';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { FixedClock } from '../test-support/fixed-clock';

/*
 * A WAITLIST REQUEST IS REFUSED NOW WHEN THE COMMIT WOULD REFUSE IT AT
 * EVERY TIME (BA decision, round 6). A request is a promise to notify, and
 * a client kept waiting for a booking no freed slot could ever make — too
 * many people, a retired service, a variant never chosen, two services one
 * person may not have — is a promise broken on day one. So the request is
 * admitted through the commit's OWN checks (`cartAdmissible` →
 * `partyAdmissible`, the function `decideBooking` asks), never a restatement
 * of them: each refusal below is also shown to be the commit's, code for
 * code.
 */

const ZONE = 'Europe/Sofia';
const OWNER = 'user-waiting';
const CENTER = 'loc-center';
const MLADOST = 'loc-mladost';
const NOW_ISO = '2030-01-13T08:00:00.000+02:00';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const now = unwrap(ZonedDateTime.fromISO(NOW_ISO, ZONE));

function service(
  id: string,
  overrides: {
    readonly locationIds?: readonly string[];
    readonly conflictsWith?: readonly string[];
    readonly variants?: readonly string[];
  } = {},
): Service {
  return unwrap(
    Service.create({
      id,
      name: { bg: id, en: id },
      description: { bg: '—', en: '—' },
      categoryId: 'cat-hair',
      priceMinorUnits: 2500,
      currencyCode: 'EUR',
      durationMinutes: 30,
      locationIds: overrides.locationIds ?? [],
      conflictsWith: overrides.conflictsWith ?? [],
      variants: (overrides.variants ?? []).map((variant) => ({
        id: variant,
        name: { bg: variant, en: variant },
      })),
      offerings: [],
      composition: { kind: 'single' },
      upsellOnly: false,
      popular: false,
      status: 'active',
      sortOrder: 1,
    }),
  );
}

/** The catalogue, as the callable reads it for a cart: active rows only. */
const CATALOGUE: readonly Service[] = [
  service('svc-cut'),
  service('svc-royal', { locationIds: [CENTER] }),
  service('svc-beard', { conflictsWith: ['svc-shave'] }),
  service('svc-shave'),
  service('svc-color', { variants: ['short', 'long'] }),
];

interface Line {
  readonly serviceId: string;
  readonly variantId?: string | null;
}

/** One seat per entry, keyed as the web cart keys them. */
function cartOf(
  seats: readonly (readonly Line[])[],
): DecideWaitlistRequest['cart'] {
  let sequence = 0;
  return {
    seats: seats.map((lines, index) => ({
      seatKey: index === 0 ? 'self' : `guest-${index}`,
      lines: lines.map((line) => ({
        id: `line-${sequence++}`,
        serviceId: line.serviceId,
        variantId: line.variantId ?? null,
        barberId: null,
      })),
    })),
    nextSequence: sequence,
  };
}

function ask(
  seats: readonly (readonly Line[])[],
  locationId: string | null = CENTER,
): DecideWaitlistRequest {
  return {
    locationId,
    days: [{ dayKey: '2030-01-15', windows: [{ from: '10:00', to: '12:00' }] }],
    cart: cartOf(seats),
  };
}

function deps(overrides: Partial<DecideWaitlistDeps> = {}): DecideWaitlistDeps {
  const policy = overrides.policy ?? BookingPolicy.default();
  return {
    now,
    zone: ZONE,
    maxFlexibleDays: policy.maxFlexibleDays,
    horizonEnd: policy.horizonEndFrom(CalendarDay.fromZonedDateTime(now)),
    nextId: () => 'wl-1',
    ownerUserId: OWNER,
    policy,
    services: CATALOGUE,
    // The named shop, as the callable reads it: there, and listed.
    shop: { active: true },
    ...overrides,
  };
}

/** The refusal's reason, as the client receives it — or `'accepted'`. */
function answer(
  request: DecideWaitlistRequest,
  overrides: Partial<DecideWaitlistDeps> = {},
): string {
  const decided = decideWaitlist(request, deps(overrides));
  if (decided.isSuccess()) return 'accepted';
  expect(decided.error.code).toBe('booking.waitlist.invalid_request');
  return String(decided.error.params['field']);
}

/**
 * The commit's answer for the same party, at a start that is otherwise
 * fine — `decideBooking` itself, so a refusal here is the commit's own.
 */
function commitAnswer(
  request: DecideWaitlistRequest,
  policy: BookingPolicy = BookingPolicy.default(),
): string {
  const seats = request.cart.seats.flatMap((seat) =>
    seat.lines.map((line): RequestedSeat => ({
      lineId: line.id,
      serviceId: line.serviceId,
      variantId: line.variantId,
      barberId: 'ivan',
      startIso: '2030-01-15T10:00:00.000+02:00',
      subject:
        seat.seatKey === 'self'
          ? { kind: 'self' }
          : { kind: 'guest', label: seat.seatKey, guestKey: seat.seatKey },
    })),
  );
  const snapshot: BookingSnapshot = {
    zone: ZONE,
    shopHours: [],
    services: CATALOGUE,
    schedules: new Map(),
    busy: new Map(),
    exceptions: new Map(),
  };
  const decided = decideBooking(
    { locationId: request.locationId ?? CENTER, seats },
    snapshot,
    { now, policy, nextId: () => 'seat', ownerUserId: OWNER },
  );
  return decided.isSuccess() ? 'accepted' : decided.error.code;
}

describe('decideWaitlist — refuses now what the commit refuses at every time', () => {
  it('accepts a party the commit would admit', () => {
    expect(
      answer(ask([[{ serviceId: 'svc-cut' }], [{ serviceId: 'svc-royal' }]])),
    ).toBe('accepted');
  });

  it('refuses more people than the policy seats', () => {
    const policy = unwrap(
      BookingPolicy.create({
        maxPartySize: 2,
        slotStepMinutes: 15,
        minLeadMinutes: 120,
        horizonMonths: 2,
        cancellationWindowHours: 24,
        maxFlexibleDays: 7,
        autoConfirm: true,
      }),
    );
    const three = ask([
      [{ serviceId: 'svc-cut' }],
      [{ serviceId: 'svc-cut' }],
      [{ serviceId: 'svc-cut' }],
    ]);

    expect(answer(three, { policy })).toBe('booking.commit.party_too_large');
    expect(commitAnswer(three, policy)).toBe('booking.commit.party_too_large');
  });

  it('refuses a service the catalogue does not offer — unknown or retired', () => {
    const retired = ask([[{ serviceId: 'svc-retired' }]]);

    expect(answer(retired)).toBe('booking.commit.unknown_service');
    expect(commitAnswer(retired)).toBe('booking.commit.unknown_service');
  });

  it('refuses a service with variants and none chosen, or one it does not declare', () => {
    const none = ask([[{ serviceId: 'svc-color' }]]);
    const undeclared = ask([[{ serviceId: 'svc-color', variantId: 'medium' }]]);
    const chosen = ask([[{ serviceId: 'svc-color', variantId: 'long' }]]);

    expect(answer(none)).toBe('booking.commit.invalid_input');
    expect(commitAnswer(none)).toBe('booking.commit.invalid_input');
    expect(answer(undeclared)).toBe('booking.commit.invalid_input');
    expect(commitAnswer(undeclared)).toBe('booking.commit.invalid_input');
    expect(answer(chosen)).toBe('accepted');
  });

  it('refuses two services one person may not have together — and allows them for two people', () => {
    const onePerson = ask([
      [{ serviceId: 'svc-beard' }, { serviceId: 'svc-shave' }],
    ]);
    const twoPeople = ask([
      [{ serviceId: 'svc-beard' }],
      [{ serviceId: 'svc-shave' }],
    ]);

    expect(answer(onePerson)).toBe('booking.commit.conflicting_services');
    expect(commitAnswer(onePerson)).toBe('booking.commit.conflicting_services');
    expect(answer(twoPeople)).toBe('accepted');
  });

  it('refuses a service the named shop does not offer — and watches any shop for it', () => {
    const atMladost = ask([[{ serviceId: 'svc-royal' }]], MLADOST);

    expect(answer(atMladost)).toBe('booking.commit.service_not_at_location');
    expect(commitAnswer(atMladost)).toBe(
      'booking.commit.service_not_at_location',
    );
    // No shop named: the matcher only ever runs shops that serve the whole
    // party (`shopsServingParty`), and Center does.
    expect(answer(ask([[{ serviceId: 'svc-royal' }]], null))).toBe('accepted');
  });

  it('refuses a cart line that does not read, rather than watching for the rest of the party', () => {
    const broken = ask([[{ serviceId: 'svc-cut' }], [{ serviceId: '' }]]);

    expect(answer(broken)).toBe('cart');
  });

  it('asks who is waiting before anything about the cart', () => {
    const decided = decideWaitlist(
      ask([[{ serviceId: 'svc-retired' }]]),
      deps({ ownerUserId: null }),
    );

    expect(decided.isFailure() && decided.error.code).toBe(
      'booking.waitlist.unauthenticated',
    );
  });
});

/*
 * A WAITLIST REQUEST NAMES A SHOP THE COMMIT WOULD ACCEPT (team decision,
 * 2026-09-26). The shop is read the way the commit reads it (`toShop`) and
 * judged by the one shop rule the matcher also searches by (`shopListed`):
 * one the commit would not find is refused, and so is one the public
 * surface no longer lists — the matcher never searches it, so the promise
 * could never fire. "Any shop" names none and is never refused for it.
 */
describe('decideWaitlist — the shop it names, as the commit reads it', () => {
  const cut = [[{ serviceId: 'svc-cut' }]];

  it('refuses a shop the commit would not find, as the stable field `locationId`', () => {
    const decided = decideWaitlist(ask(cut), deps({ shop: null }));

    expect(decided.isFailure()).toBe(true);
    if (decided.isSuccess()) return;
    expect(decided.error).toBeInstanceOf(RequestWaitlistInvalidError);
    expect(decided.error.code).toBe('booking.waitlist.invalid_request');
    expect(decided.error.params).toEqual({ field: 'locationId' });
  });

  it('refuses a shop the public surface no longer lists', () => {
    expect(answer(ask(cut), { shop: { active: false } })).toBe('locationId');
  });

  it('accepts a listed shop', () => {
    expect(answer(ask(cut), { shop: { active: true } })).toBe('accepted');
  });

  it('never asks about a shop for an any-shop request — nothing was read', () => {
    expect(answer(ask(cut, null), { shop: null })).toBe('accepted');
  });

  it('asks about the shop before the party, in the commit’s order', () => {
    // A retired service AND a shop that is not there: the commit's load
    // refuses the shop before a seat is looked at.
    expect(answer(ask([[{ serviceId: 'svc-retired' }]]), { shop: null })).toBe(
      'locationId',
    );
  });

  /*
   * NAMES NO USABLE SHOP, HOWEVER IT IS SPELLED: one stable field, the
   * commit's own (`CommitBookingShopUnavailableError.FIELD`). An empty id
   * used to reach the aggregate and come back as ITS code
   * (`scheduling.waitlist.invalid`), a second answer for the same refusal.
   */
  it.each([
    ['an empty id', '', null],
    ['a blank id', '   ', null],
    ['a shop the commit would not find', 'loc-nowhere', null],
    ['a shop the public surface no longer lists', CENTER, { active: false }],
  ] as const)(
    'refuses %s as the one field `locationId`',
    (_label, id, shop) => {
      const decided = decideWaitlist(ask(cut, id), deps({ shop }));

      expect(decided.isFailure() && decided.error.code).toBe(
        'booking.waitlist.invalid_request',
      );
      expect(decided.isFailure() && decided.error.params).toEqual({
        field: CommitBookingShopUnavailableError.FIELD,
      });
      expect(CommitBookingShopUnavailableError.FIELD).toBe('locationId');
    },
  );

  it('refuses an empty id whatever shop it is handed — the spelling alone names none', () => {
    expect(answer(ask(cut, ''), { shop: { active: true } })).toBe('locationId');
  });

  /*
   * …and the commit's DOOR answers the same spellings with the same field,
   * through its own store: `FirestoreBookingStore.load` refuses an id that
   * could not name a document unread, where building its reference would
   * throw and answer `store_failed` (shown against the Admin SDK's own path
   * check in `firestore-booking-store.spec.ts`).
   */
  it.each([
    ['an empty id', ''],
    ['a blank id', '   '],
  ])(
    'answers %s as the commit’s door answers it — the one field',
    async (_label, id) => {
      const committed = await new CommitBookingUseCase(
        new FirestoreBookingStore(
          createProjectionFirestore().db as unknown as Firestore,
        ),
        new FixedClock(NOW_ISO),
        { next: () => 'appt-1' },
      ).execute({
        locationId: id,
        seats: [
          {
            lineId: 'line-1',
            serviceId: 'svc-cut',
            variantId: null,
            barberId: 'ivan',
            startIso: '2030-01-15T10:00:00.000+02:00',
            subject: { kind: 'self' },
          },
        ],
        ownerUserId: OWNER,
      });
      // The shop as the callable reads it for that spelling: none.
      const waited = decideWaitlist(ask(cut, id), deps({ shop: null }));

      expect(committed.isFailure() && committed.error).toBeInstanceOf(
        CommitBookingShopUnavailableError,
      );
      expect(committed.isFailure() && committed.error.params).toEqual({
        field: CommitBookingShopUnavailableError.FIELD,
      });
      expect(waited.isFailure() && waited.error.params).toEqual({
        field: CommitBookingShopUnavailableError.FIELD,
      });
    },
  );

  it('is refused by the commit’s decision too, should an empty id ever get past the store', () => {
    const decided = decideBooking(
      { locationId: '', seats: [] },
      {
        zone: ZONE,
        shopHours: [],
        services: CATALOGUE,
        schedules: new Map(),
        busy: new Map(),
        exceptions: new Map(),
      },
      {
        now,
        policy: BookingPolicy.default(),
        nextId: () => 'seat',
        ownerUserId: OWNER,
      },
    );

    expect(decided.isFailure() && decided.error).toBeInstanceOf(
      CommitBookingShopUnavailableError,
    );
    expect(decided.isFailure() && decided.error.params).toEqual({
      field: 'locationId',
    });
  });

  it('asks about the shop before the days it watches', () => {
    const badDay = {
      ...ask(cut, ''),
      days: [
        { dayKey: 'not-a-day', windows: [{ from: '10:00', to: '12:00' }] },
      ],
    };

    expect(answer(badDay, { shop: null })).toBe('locationId');
  });
});
