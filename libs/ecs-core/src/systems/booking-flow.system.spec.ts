import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BarberPrefKind, BarberPref } from '../components/barber-pref.data';
import { BookingFlowErrorCode } from '../components/booking-flow-errors.data';
import {
  BookingFlowState,
  BookingFlowStep,
} from '../components/booking-flow.data';
import { BookingPolicy } from '../components/booking-policy.data';
import { BookingCart, type CartLine } from '../components/cart-line.data';
import { DayKey } from '../components/day-key.data';
import { DayWindows } from '../components/day-windows.data';
import { FlexibleWhen } from '../components/flexible-when.data';
import { MinuteRange } from '../components/minute-range.data';
import { Party, PartyMember } from '../components/party.data';
import { Result } from '../components/result.data';
import { SchedulingErrorCode } from '../components/scheduling-errors.data';
import { SeatLabel } from '../components/seat-label.data';
import { TimeInterval } from '../components/time-interval.data';
import { AppointmentId } from '../entities/appointment.entity';
import { BarberId } from '../entities/barber.entity';
import { LocationId } from '../entities/location.entity';
import { ServiceId } from '../entities/service.entity';
import { UserId } from '../entities/user.entity';
import { WaitlistRequestId } from '../entities/waitlist-request.entity';
import { deepFreeze, unwrapOk } from '../testing';
import {
  type BookingFlowEvent,
  BookingFlowEventKind as E,
  BookingFlowSystem,
} from './booking-flow.system';

const LIMITS = BookingPolicy.DEFAULT;
/** How many people one booking can seat (the legacy `MAX_PARTY_SIZE`). */
const MAX_PARTY_SIZE = LIMITS.maxPartySize;

function next(
  state: BookingFlowState,
  event: BookingFlowEvent,
): Result<BookingFlowState, { readonly code: string }> {
  return BookingFlowSystem.next(state, event, LIMITS);
}

function newParty(): Party {
  return Party.owned(UserId.of('owner_1'));
}

/** The services step, reached the way a person reaches it: through WHERE. */
function guestsState(): BookingFlowState.Services {
  const advanced = next(BookingFlowState.initial(newParty()), { kind: E.Next });
  if (!advanced.ok || advanced.value.kind !== BookingFlowStep.Services) {
    throw new Error('unexpected');
  }
  return advanced.value;
}

const CUT: BookingCart.NewLine = {
  serviceId: ServiceId.of('service_1'),
  variantId: null,
  barberId: null,
  locationId: null,
};

/** Walks to `services` with one line in the bag for `self`. */
function servicesStateWithOneLine(): BookingFlowState.Services {
  const withLine = next(guestsState(), {
    kind: E.AddLine,
    seatKey: 'self',
    line: CUT,
  });
  if (!withLine.ok || withLine.value.kind !== BookingFlowStep.Services) {
    throw new Error('unexpected');
  }
  return withLine.value;
}

function services(
  result: Result<BookingFlowState, unknown>,
): BookingFlowState.Services {
  if (!result.ok || result.value.kind !== BookingFlowStep.Services) {
    throw new Error('unexpected');
  }
  return result.value;
}

const guests = (party: Party) => Party.guests(party);

/*
 * Copied (not moved) from
 * libs/application/booking/src/lib/flow/booking-flow.spec.ts — all 23
 * cases, re-targeted from `advanceBookingFlow(state, { type })` to
 * `BookingFlowSystem.next(state, { kind }, policy)` over the ECS bags
 * (`Party`, `BookingCart`, seat keys as strings), `isSuccess()` → `.ok` and
 * `error.params.x` → `error.x`.
 */
describe('BookingFlowSystem.next', () => {
  it('starts on WHERE, with any shop, an empty party and an empty cart', () => {
    const state = BookingFlowState.initial(newParty());
    expect(state.kind).toBe(BookingFlowStep.Location);
    expect(state.locationId).toBeNull();
    expect(guests(state.party)).toHaveLength(0);
    expect(BookingCart.isEmpty(state.cart)).toBe(true);
  });

  it('advances off WHERE without a shop — "any shop" IS the answer', () => {
    const advanced = next(BookingFlowState.initial(newParty()), {
      kind: E.Next,
    });
    expect(advanced.ok).toBe(true);
    if (advanced.ok && advanced.value.kind === BookingFlowStep.Services) {
      expect(advanced.value.locationId).toBeNull();
    }
  });

  it('carries the chosen shop all the way to the schedule', () => {
    const locationId = LocationId.of('loc-center');
    let state: BookingFlowState = BookingFlowState.initial(newParty());

    const events: readonly BookingFlowEvent[] = [
      { kind: E.SelectLocation, locationId },
      { kind: E.Next },
      { kind: E.AddLine, seatKey: 'self', line: CUT },
      { kind: E.Next },
    ];
    for (const event of events) state = unwrapOk(next(state, event));

    expect(state.kind).toBe(BookingFlowStep.Schedule);
    if (state.kind === BookingFlowStep.Schedule) {
      expect(state.locationId).toBe(locationId);
    }
  });

  it('starts anonymous when no party is supplied', () => {
    const state = BookingFlowState.initial(Party.anonymous());
    expect(state.kind).toBe(BookingFlowStep.Location);
    expect(Party.isClaimed(state.party)).toBe(false);
  });

  it('adds a guest and stays on the services step', () => {
    const result = next(guestsState(), { kind: E.AddGuest, label: 'Alex' });
    expect(result.ok).toBe(true);
    const state = services(result);
    expect(guests(state.party)).toHaveLength(1);
    expect(guests(state.party)[0]?.guestId).toBe('guest-0');
  });

  it('renames a guest without changing their identity', () => {
    const added = services(
      next(guestsState(), { kind: E.AddGuest, label: 'Guest 2' }),
    );
    const guestId = (guests(added.party)[0] as PartyMember.Guest).guestId;

    const renamed = next(added, {
      kind: E.RenameGuest,
      guestId,
      label: 'Maria',
    });
    expect(renamed.ok).toBe(true);
    const state = services(renamed);
    expect(guests(state.party)[0]?.label).toBe('Maria');
    expect(guests(state.party)[0]?.guestId).toBe(guestId);
  });

  it('rejects a blank rename with a translatable code', () => {
    const added = services(
      next(guestsState(), { kind: E.AddGuest, label: 'Guest 2' }),
    );
    const result = next(added, {
      kind: E.RenameGuest,
      guestId: (guests(added.party)[0] as PartyMember.Guest).guestId,
      label: '   ',
    });
    expect(!result.ok && result.error.code).toBe(
      BookingFlowErrorCode.InvalidGuest,
    );
  });

  it('refuses another guest’s label in its OWN words — not «enter a name» to someone who just did', () => {
    let state: BookingFlowState = guestsState();
    for (const label of ['Maria', 'Guest 2']) {
      state = services(next(state, { kind: E.AddGuest, label }));
    }
    const second =
      state.kind === BookingFlowStep.Services ? guests(state.party)[1] : null;
    if (!second) throw new Error('unexpected');

    const renamed = next(state, {
      kind: E.RenameGuest,
      guestId: second.guestId,
      label: 'Maria',
    });
    const added = next(state, { kind: E.AddGuest, label: 'Maria' });

    for (const result of [renamed, added]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({
          code: SchedulingErrorCode.PartyDuplicateLabel,
          label: 'Maria',
        });
      }
    }
  });

  it('never reuses a removed guest id (§7.7 regression)', () => {
    let state = guestsState();

    state = services(next(state, { kind: E.AddGuest, label: 'Guest A' }));
    const guestA = guests(state.party)[0] as PartyMember.Guest;
    expect(guestA.guestId).toBe('guest-0');

    state = services(next(state, { kind: E.AddGuest, label: 'Guest B' }));
    state = services(
      next(state, { kind: E.RemoveGuest, guestId: guestA.guestId }),
    );
    expect(guests(state.party)).toHaveLength(1);

    state = services(next(state, { kind: E.AddGuest, label: 'Guest C' }));

    const ids = guests(state.party).map((g) => g.guestId);
    expect(ids).toContain('guest-1'); // Guest B, unaffected by the removal
    expect(ids).toContain('guest-2'); // Guest C — NOT "guest-0"
    expect(ids).not.toContain(guestA.guestId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses a guest past the party cap — the rule lives here, not in a template', () => {
    let state: BookingFlowState = guestsState();
    // The booker occupies one seat, so MAX - 1 guests fill the party.
    for (let i = 0; i < MAX_PARTY_SIZE - 1; i++) {
      state = unwrapOk(next(state, { kind: E.AddGuest, label: `Guest ${i}` }));
    }

    const overflow = next(state, { kind: E.AddGuest, label: 'One too many' });
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.error).toEqual({
        code: BookingFlowErrorCode.PartyFull,
        max: MAX_PARTY_SIZE,
      });
    }
  });

  it('removing an unknown guest id fails without mutating the party', () => {
    const result = next(guestsState(), {
      kind: E.RemoveGuest,
      guestId: 'guest-999',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: BookingFlowErrorCode.GuestNotFound,
        guestId: 'guest-999',
      });
    }
  });

  it('drops a departing guest’s cart lines with them', () => {
    const added = services(
      next(servicesStateWithOneLine(), { kind: E.AddGuest, label: 'Maria' }),
    );
    const guestId = (guests(added.party)[0] as PartyMember.Guest).guestId;

    const withGuestLine = services(
      next(added, { kind: E.AddLine, seatKey: guestId, line: CUT }),
    );
    expect(BookingCart.lineCount(withGuestLine.cart)).toBe(2);

    const removed = services(
      next(withGuestLine, { kind: E.RemoveGuest, guestId }),
    );
    // The booker's own line survives; the guest's leaves with the guest.
    expect(BookingCart.lineCount(removed.cart)).toBe(1);
    expect(BookingCart.linesFor(removed.cart, 'self')).toHaveLength(1);
  });

  it('lets a guest be added from the SERVICES step without losing the bag', () => {
    const result = next(servicesStateWithOneLine(), {
      kind: E.AddGuest,
      label: 'Maria',
    });
    expect(result.ok).toBe(true);
    const state = services(result);
    expect(guests(state.party)).toHaveLength(1);
    expect(BookingCart.lineCount(state.cart)).toBe(1);
  });

  it('re-points a line’s variant and barber preference', () => {
    const state = servicesStateWithOneLine();
    const lineId = (BookingCart.linesFor(state.cart, 'self')[0] as CartLine)
      .lineId;

    const pinned = next(state, {
      kind: E.SetLineBarber,
      seatKey: 'self',
      lineId,
      barberId: BarberId.of('ivan'),
    });
    expect(pinned.ok).toBe(true);
    const line = BookingCart.linesFor(services(pinned).cart, 'self')[0];
    expect(BarberPref.fromBarberId(line?.barberId ?? null).kind).toBe(
      BarberPrefKind.Specific,
    );
  });

  it('rejects advancing past services with an empty bag', () => {
    const result = next(guestsState(), { kind: E.Next });
    expect(!result.ok && result.error.code).toBe(
      BookingFlowErrorCode.EmptyCart,
    );
  });

  it('refuses to leave services while a guest is booking nothing', () => {
    const withGuest = next(servicesStateWithOneLine(), {
      kind: E.AddGuest,
      label: 'Maria',
    });
    const result = next(unwrapOk(withGuest), { kind: E.Next });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // It NAMES the seat.
      expect(result.error).toEqual({
        code: BookingFlowErrorCode.SeatWithoutService,
        seatKey: 'guest-0',
      });
    }
  });

  it('refuses when the BOOKER is the empty one, guest or not', () => {
    const withGuest = services(
      next(guestsState(), { kind: E.AddGuest, label: 'Maria' }),
    );
    const guestOnly = next(withGuest, {
      kind: E.AddLine,
      seatKey: (guests(withGuest.party)[0] as PartyMember.Guest).guestId,
      line: CUT,
    });

    const result = next(unwrapOk(guestOnly), { kind: E.Next });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: BookingFlowErrorCode.SeatWithoutService,
        seatKey: 'self',
      });
    }
  });

  it('advances once every seat holds something', () => {
    const withGuest = services(
      next(servicesStateWithOneLine(), { kind: E.AddGuest, label: 'Maria' }),
    );
    // The SAME service on another seat is legal.
    const both = next(withGuest, {
      kind: E.AddLine,
      seatKey: (guests(withGuest.party)[0] as PartyMember.Guest).guestId,
      line: CUT,
    });

    const result = next(unwrapOk(both), { kind: E.Next });
    expect(result.ok && result.value.kind).toBe(BookingFlowStep.Schedule);
  });

  it('keeps a restored party with two guests under one label here, naming the label', () => {
    // Only a restored draft can hold one (a draft saved before the rule).
    const restored: Party = {
      ownerUserId: UserId.of('owner_1'),
      members: [
        PartyMember.owner(),
        PartyMember.guest('guest-0', SeatLabel.of('Гост 1')),
        PartyMember.guest('guest-1', SeatLabel.of('Гост 1')),
      ],
      nextGuestSequence: 2,
    };
    let state: BookingFlowState = {
      ...servicesStateWithOneLine(),
      party: restored,
    };
    for (const guest of guests(restored)) {
      state = unwrapOk(
        next(state, { kind: E.AddLine, seatKey: guest.guestId, line: CUT }),
      );
    }

    const refused = next(state, { kind: E.Next });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toEqual({
        code: SchedulingErrorCode.PartyDuplicateLabel,
        label: 'Гост 1',
      });
    }

    // One rename, and the party moves on.
    const renamed = unwrapOk(
      next(state, { kind: E.RenameGuest, guestId: 'guest-1', label: 'Мария' }),
    );
    const moved = next(renamed, { kind: E.Next });
    expect(moved.ok && moved.value.kind).toBe(BookingFlowStep.Schedule);
  });

  it('unblocks when the empty guest leaves the party', () => {
    const withGuest = services(
      next(servicesStateWithOneLine(), { kind: E.AddGuest, label: 'Maria' }),
    );
    const guestId = (guests(withGuest.party)[0] as PartyMember.Guest).guestId;

    const removed = next(withGuest, { kind: E.RemoveGuest, guestId });
    const result = next(unwrapOk(removed), { kind: E.Next });
    expect(result.ok && result.value.kind).toBe(BookingFlowStep.Schedule);
  });

  it('walks location -> services -> schedule -> review, carrying the cart', () => {
    const locationId = LocationId.of('location_1');
    const toSchedule = unwrapOk(
      next(servicesStateWithOneLine(), { kind: E.Next }),
    );
    if (toSchedule.kind !== BookingFlowStep.Schedule) {
      throw new Error('unexpected');
    }
    expect(BookingCart.lineCount(toSchedule.cart)).toBe(1);

    const toReview = next(toSchedule, {
      kind: E.SelectSchedule,
      selection: {
        locationId,
        timeInterval: TimeInterval.of(0, 1_800_000),
        assignments: [],
      },
    });
    expect(toReview.ok).toBe(true);
    if (toReview.ok && toReview.value.kind === BookingFlowStep.Review) {
      expect(BookingCart.lineCount(toReview.value.cart)).toBe(1);
      expect(toReview.value.selection.locationId).toBe(locationId);
    }
  });

  it('keeps the chosen location when stepping back from review', () => {
    const locationId = LocationId.of('location_1');
    const toSchedule = unwrapOk(
      next(servicesStateWithOneLine(), { kind: E.Next }),
    );
    const toReview = unwrapOk(
      next(toSchedule, {
        kind: E.SelectSchedule,
        selection: {
          locationId,
          timeInterval: TimeInterval.of(0, 1_800_000),
          assignments: [],
        },
      }),
    );

    const back = next(toReview, { kind: E.Back });
    expect(back.ok).toBe(true);
    if (back.ok && back.value.kind === BookingFlowStep.Schedule) {
      expect(back.value.locationId).toBe(locationId);
    }
  });

  it('rejects an event illegal for the current state', () => {
    const result = next(guestsState(), {
      kind: E.SelectLocation,
      locationId: LocationId.of('location_1'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: BookingFlowErrorCode.InvalidTransition,
        from: 'services',
        event: 'select_location',
      });
    }
  });
});

/* ── The schedule step's flexible declaration and the two terminal exits ── */

function scheduleState(): BookingFlowState.Schedule {
  const state = unwrapOk(next(servicesStateWithOneLine(), { kind: E.Next }));
  if (state.kind !== BookingFlowStep.Schedule) throw new Error('unexpected');
  return state;
}

describe('BookingFlowSystem.next — the schedule step', () => {
  const day = (key: string): DayKey => DayKey.of(key);

  it('toggles a day in and out, and refuses past the policy’s day cap', () => {
    let state: BookingFlowState = scheduleState();
    for (let d = 1; d <= LIMITS.maxFlexibleDays; d++) {
      state = unwrapOk(
        next(state, {
          kind: E.ToggleFlexibleDay,
          dayKey: day(`2026-09-${String(d).padStart(2, '0')}`),
        }),
      );
    }
    const full = next(state, {
      kind: E.ToggleFlexibleDay,
      dayKey: day('2026-09-28'),
    });
    expect(!full.ok && full.error).toEqual({
      code: BookingFlowErrorCode.FlexibleDaysFull,
      max: LIMITS.maxFlexibleDays,
    });
    const off = unwrapOk(
      next(state, { kind: E.ToggleFlexibleDay, dayKey: day('2026-09-01') }),
    );
    expect(off.kind === BookingFlowStep.Schedule && off.when.days.length).toBe(
      LIMITS.maxFlexibleDays - 1,
    );
  });

  it('narrows a selected day, ignores an unselected one, and clears the declaration', () => {
    let state: BookingFlowState = unwrapOk(
      next(scheduleState(), {
        kind: E.ToggleFlexibleDay,
        dayKey: day('2026-09-10'),
      }),
    );
    state = unwrapOk(
      next(state, {
        kind: E.SetDayWindows,
        dayWindows: DayWindows.of(day('2026-09-10'), [
          MinuteRange.of(480, 720),
        ]),
      }),
    );
    state = unwrapOk(
      next(state, {
        kind: E.SetDayWindows,
        dayWindows: DayWindows.of(day('2026-09-11'), [
          MinuteRange.of(480, 720),
        ]),
      }),
    );
    if (state.kind !== BookingFlowStep.Schedule) throw new Error('unexpected');
    expect(state.when).toEqual(
      FlexibleWhen.of([
        DayWindows.of(day('2026-09-10'), [MinuteRange.of(480, 720)]),
      ]),
    );
    const cleared = unwrapOk(next(state, { kind: E.ClearFlexible }));
    expect(cleared.kind === BookingFlowStep.Schedule && cleared.when).toEqual(
      FlexibleWhen.empty(),
    );
  });

  it('refuses a waitlist naming no day, and ends on `waitlisted` with the receipt', () => {
    const none = next(scheduleState(), {
      kind: E.Waitlisted,
      requestId: WaitlistRequestId.of('wl-1'),
    });
    expect(!none.ok && none.error.code).toBe(
      BookingFlowErrorCode.NoFlexibleDays,
    );

    const watched = unwrapOk(
      next(scheduleState(), {
        kind: E.ToggleFlexibleDay,
        dayKey: day('2026-09-10'),
      }),
    );
    const waitlisted = unwrapOk(
      next(watched, {
        kind: E.Waitlisted,
        requestId: WaitlistRequestId.of('wl-1'),
      }),
    );
    expect(waitlisted.kind).toBe(BookingFlowStep.Waitlisted);
    expect(BookingFlowSystem.isTerminal(waitlisted.kind)).toBe(true);
    expect(next(waitlisted, { kind: E.Back }).ok).toBe(false);
  });

  it('confirms from review with the server’s receipt, and the flow is over', () => {
    const review = unwrapOk(
      next(scheduleState(), {
        kind: E.SelectSchedule,
        selection: {
          locationId: LocationId.of('loc-center'),
          timeInterval: TimeInterval.of(0, 1_800_000),
          assignments: [],
        },
      }),
    );
    const confirmed = unwrapOk(
      next(review, {
        kind: E.Confirmed,
        appointmentId: AppointmentId.of('appt-1'),
      }),
    );
    expect(
      confirmed.kind === BookingFlowStep.Confirmed &&
        confirmed.confirmation.appointmentId,
    ).toBe('appt-1');
    expect(BookingFlowSystem.currentStep(confirmed.kind)).toBe(4);
    expect(BookingFlowSystem.canGoBack(confirmed.kind)).toBe(false);
  });
});

describe('BookingFlowSystem — the spine', () => {
  it('numbers the steps 1…4 and lets back work only past the first', () => {
    const location = BookingFlowState.initial(newParty());
    expect(BookingFlowSystem.currentStep(location.kind)).toBe(1);
    expect(BookingFlowSystem.canGoBack(location.kind)).toBe(false);
    const schedule = scheduleState();
    expect(BookingFlowSystem.currentStep(schedule.kind)).toBe(3);
    expect(BookingFlowSystem.canGoBack(schedule.kind)).toBe(true);
  });

  it('rewinds BACKWARD to a step the URL names, and never forward', () => {
    const schedule = scheduleState();
    const rewound = BookingFlowSystem.rewindTo(
      schedule,
      BookingFlowStep.Location,
      LIMITS,
    );
    expect(rewound.kind).toBe(BookingFlowStep.Location);
    // The bag survives the walk back.
    expect(
      rewound.kind === BookingFlowStep.Location &&
        BookingCart.lineCount(rewound.cart),
    ).toBe(1);
    expect(
      BookingFlowSystem.rewindTo(schedule, BookingFlowStep.Review, LIMITS),
    ).toBe(schedule);
    expect(
      BookingFlowSystem.rewindTo(schedule, BookingFlowStep.Schedule, LIMITS),
    ).toBe(schedule);
  });

  it('counts the party’s free seats against the policy', () => {
    let party = newParty();
    for (let i = 1; i < MAX_PARTY_SIZE; i++) {
      expect(BookingFlowSystem.canAddGuest(party, LIMITS)).toBe(true);
      party = unwrapOk(Party.addGuest(party, `Guest ${i}`));
    }
    expect(BookingFlowSystem.canAddGuest(party, LIMITS)).toBe(false);
  });
});

describe('BookingFlowSystem — purity and properties', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const state = deepFreeze(servicesStateWithOneLine());
    const event = deepFreeze<BookingFlowEvent>({
      kind: E.AddGuest,
      label: 'Maria',
    });
    const before = JSON.stringify(state);
    const once = BookingFlowSystem.next(state, event, LIMITS);
    expect(BookingFlowSystem.next(state, event, LIMITS)).toEqual(once);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('is total: any event sequence yields a well-formed state or a coded refusal', () => {
    const event = fc.oneof(
      fc.constant<BookingFlowEvent>({ kind: E.Next }),
      fc.constant<BookingFlowEvent>({ kind: E.Back }),
      fc
        .constantFrom('Maria', 'Ani', ' ', 'Maria')
        .map((label): BookingFlowEvent => ({ kind: E.AddGuest, label })),
      fc
        .constantFrom('guest-0', 'guest-1', 'guest-9')
        .map((guestId): BookingFlowEvent => ({ kind: E.RemoveGuest, guestId })),
      fc
        .constantFrom('self', 'guest-0', 'guest-1')
        .map((seatKey): BookingFlowEvent => ({
          kind: E.AddLine,
          seatKey,
          line: CUT,
        })),
      fc.integer({ min: 1, max: 9 }).map((d): BookingFlowEvent => ({
        kind: E.ToggleFlexibleDay,
        dayKey: DayKey.of(`2026-09-0${d}`),
      })),
      fc.constant<BookingFlowEvent>({ kind: E.ClearFlexible }),
    );
    fc.assert(
      fc.property(fc.array(event, { maxLength: 25 }), (events) => {
        let state: BookingFlowState = BookingFlowState.initial(newParty());
        for (const e of events) {
          const result = BookingFlowSystem.next(state, e, LIMITS);
          if (result.ok) {
            state = result.value;
            expect(BookingFlowState.is(JSON.parse(JSON.stringify(state)))).toBe(
              true,
            );
            expect(
              state.kind === BookingFlowStep.Location ||
                state.kind === BookingFlowStep.Services ||
                state.kind === BookingFlowStep.Schedule,
            ).toBe(true);
            if ('party' in state) {
              expect(state.party.members.length).toBeLessThanOrEqual(
                MAX_PARTY_SIZE,
              );
            }
          } else {
            expect(typeof result.error.code).toBe('string');
          }
        }
      }),
    );
  });
});

describe('BookingFlowSystem.next — the rest of the arms', () => {
  it('re-points a line’s variant, removes a line, and refuses a line the seat does not hold', () => {
    const state = servicesStateWithOneLine();
    const lineId = (BookingCart.linesFor(state.cart, 'self')[0] as CartLine)
      .lineId;
    const varied = services(
      next(state, {
        kind: E.SetLineVariant,
        seatKey: 'self',
        lineId,
        variantId: null,
      }),
    );
    expect(BookingCart.lineCount(varied.cart)).toBe(1);
    const removed = services(
      next(varied, { kind: E.RemoveLine, seatKey: 'self', lineId }),
    );
    expect(BookingCart.isEmpty(removed.cart)).toBe(true);
    const missing = next(removed, {
      kind: E.RemoveLine,
      seatKey: 'self',
      lineId,
    });
    expect(!missing.ok && missing.error).toEqual({
      code: BookingFlowErrorCode.InvalidCartOperation,
      reasonCode: SchedulingErrorCode.CartLineNotFound,
    });
  });

  it('changes the shop on the schedule step, and refuses what neither step has an arm for', () => {
    const state = scheduleState();
    const moved = unwrapOk(
      next(state, {
        kind: E.SelectLocation,
        locationId: LocationId.of('loc-x'),
      }),
    );
    expect(moved.kind === BookingFlowStep.Schedule && moved.locationId).toBe(
      'loc-x',
    );
    const confirmedEarly = next(state, {
      kind: E.Confirmed,
      appointmentId: AppointmentId.of('appt-1'),
    });
    expect(!confirmedEarly.ok && confirmedEarly.error.code).toBe(
      BookingFlowErrorCode.InvalidTransition,
    );
    const review = unwrapOk(
      next(state, {
        kind: E.SelectSchedule,
        selection: {
          locationId: LocationId.of('loc-center'),
          timeInterval: TimeInterval.of(0, 1_800_000),
          assignments: [],
        },
      }),
    );
    const skipped = next(review, { kind: E.Next });
    expect(!skipped.ok && skipped.error).toMatchObject({
      code: BookingFlowErrorCode.InvalidTransition,
      from: 'review',
      event: 'next',
    });
  });
});
