import { describe, expect, it } from 'vitest';
import {
  AppointmentId,
  BarberId,
  DurationMinutes,
  EndMinute,
  LocalDate,
  MinuteCount,
  MinuteDelta,
  MinuteOfDay,
  ServiceId,
  UserId,
} from '@core/primitives';
import { deepFreeze, unwrapOk } from '@core/testing';
import { BookingContact } from './booking-contact.data';
import { BookingDraft, BookingDraftOrigin } from './booking-draft.data';
import { BookingFlowState } from './booking-flow.data';
import type { ChairTime } from './chair-time.data';
import { E164 } from './e164.data';
import { Email } from './email.data';
import type { MoveRider } from './move-rider.data';
import { Party } from './party.data';

/*
 * The flat booking draft (Phase 4a 4A-9) — the booking store's restore
 * rules (`heldSource`, `heldMove`, `isRider`, `isChairTime`) lifted onto the
 * component: a rebooking edge that does not parse is dropped (`FRESH`), a
 * move that does not parse WHOLE leaves no draft (the store dropped it and
 * the move link lands it again), a whole move restores exactly as written.
 */

const DAY = unwrapOk(LocalDate.parse('2026-09-28'));
const STATE = BookingFlowState.initial(Party.anonymous());
const OWNER = UserId.of('client-1');
const VISIT = AppointmentId.of('appt-moving');

const RIDER: MoveRider = {
  serviceId: ServiceId.of('svc-fade'),
  variantId: null,
  barberId: BarberId.of('petar'),
  offsetMinutes: unwrapOk(MinuteDelta.of(30)),
  durationMinutes: unwrapOk(DurationMinutes.of(45)),
  setupMinutes: unwrapOk(MinuteCount.of(0)),
  cleanupMinutes: unwrapOk(MinuteCount.of(5)),
};
const CHAIR: ChairTime = {
  barberId: BarberId.of('ivan'),
  startMinutes: unwrapOk(MinuteOfDay.of(600)),
  endMinutes: unwrapOk(EndMinute.of(660)),
};

/** A draft as JSON gives it back — no brands, no prototypes. */
const stored = (draft: unknown): unknown => JSON.parse(JSON.stringify(draft));

const reschedule = () =>
  BookingDraft.reschedule(
    STATE,
    BookingContact.NONE,
    DAY,
    BookingDraft.rescheduleOrigin(VISIT, OWNER, DAY, [RIDER], [CHAIR]),
  );

describe('BookingDraft — the builders keep every field at the root', () => {
  it('a fresh draft: the flow, the contact slice, the day, FRESH', () => {
    const draft = BookingDraft.fresh(STATE, BookingContact.NONE, null);
    expect(draft).toEqual({
      ...STATE,
      ...BookingContact.NONE,
      bookingDraftOrigin: BookingDraftOrigin.Fresh,
      draftLocalDate: null,
    });
  });

  it('a rebooking carries its source flat', () => {
    expect(
      BookingDraft.bookedFrom(
        STATE,
        BookingContact.NONE,
        DAY,
        BookingDraft.bookedFromOrigin(VISIT, OWNER),
      ),
    ).toMatchObject({
      bookingDraftOrigin: 'BOOKED_FROM',
      bookedFromAppointmentId: 'appt-moving',
      bookedFromOwnerUserId: 'client-1',
      draftLocalDate: '2026-09-28',
    });
  });

  it('a move carries its riders and its chairs on the visit’s day', () => {
    expect(reschedule()).toMatchObject({
      bookingDraftOrigin: 'RESCHEDULE',
      rescheduleAppointmentId: 'appt-moving',
      rescheduleOwnerUserId: 'client-1',
      rescheduleLocalDate: '2026-09-28',
      rescheduleRiders: [RIDER],
      rescheduleRelease: [CHAIR],
    });
  });
});

describe('BookingDraft.read — the restore', () => {
  it('restores a whole move exactly as it was written', () => {
    const draft = reschedule();
    expect(BookingDraft.read(stored(draft))).toEqual(draft);
    expect(BookingDraft.is(stored(draft))).toBe(true);
  });

  it('restores a fresh draft and a rebooking as written', () => {
    const fresh = BookingDraft.fresh(STATE, BookingContact.NONE, DAY);
    expect(BookingDraft.read(stored(fresh))).toEqual(fresh);
    const rebook = BookingDraft.bookedFrom(
      STATE,
      BookingContact.NONE,
      null,
      BookingDraft.bookedFromOrigin(VISIT, OWNER),
    );
    expect(BookingDraft.read(stored(rebook))).toEqual(rebook);
  });

  it('restores a present contact exactly as the app wrote it — through the brands', () => {
    const contact: BookingContact = {
      contactName: 'Мария Петрова',
      contactPhone: E164.of('+359888123456'),
      contactEmail: Email.of('maria@example.com'),
      contactNote: 'Ще закъснея 5 мин.',
    };
    const draft = BookingDraft.fresh(STATE, contact, DAY);
    const restored = BookingDraft.read(stored(draft));
    expect(restored).toEqual(draft);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(draft));
  });

  it('restores a contact e-mail that does not parse as none — the rest of the contact kept', () => {
    const draft = BookingDraft.fresh(
      STATE,
      {
        contactName: 'Мария Петрова',
        contactPhone: E164.of('+359888123456'),
        contactEmail: null,
        contactNote: null,
      },
      DAY,
    );
    const corrupted = {
      ...(stored(draft) as object),
      contactEmail: 'not an e-mail',
    };
    expect(BookingDraft.read(corrupted)).toEqual(draft);
  });

  it('drops a rebooking edge that does not parse — the draft restores FRESH', () => {
    const broken = {
      ...(stored(
        BookingDraft.bookedFrom(
          STATE,
          BookingContact.NONE,
          null,
          BookingDraft.bookedFromOrigin(VISIT, OWNER),
        ),
      ) as object),
      bookedFromOwnerUserId: '',
    };
    expect(BookingDraft.read(broken)?.bookingDraftOrigin).toBe(
      BookingDraftOrigin.Fresh,
    );
    expect(BookingDraft.is(broken)).toBe(false);
  });

  it('never restores a move with a malformed chair — no draft at all', () => {
    const broken = {
      ...(stored(reschedule()) as object),
      rescheduleRelease: [
        { barberId: 'ivan', startMinutes: 660, endMinutes: 600 },
      ],
    };
    expect(BookingDraft.read(broken)).toBeNull();
  });

  it('never restores a move written before its chairs were stored', () => {
    const withoutChairs: Record<string, unknown> = {
      ...(stored(reschedule()) as Record<string, unknown>),
    };
    delete withoutChairs['rescheduleRelease'];
    expect(BookingDraft.read(withoutChairs)).toBeNull();
  });

  it('never restores a move with a malformed rider — a dropped rider is a seat the grid stops checking', () => {
    const broken = {
      ...(stored(reschedule()) as object),
      rescheduleRiders: [{ serviceId: 'svc-beard', barberId: 'petar' }],
    };
    expect(BookingDraft.read(broken)).toBeNull();
  });

  it('turns away a value that is no draft — a stale flow, no contact slice, a day that is no day', () => {
    const fresh = stored(BookingDraft.fresh(STATE, BookingContact.NONE, DAY));
    expect(
      BookingDraft.read({ ...(fresh as object), bookingFlowStep: 'nope' }),
    ).toBeNull();
    const noContact: Record<string, unknown> = {
      ...(fresh as Record<string, unknown>),
    };
    delete noContact['contactName'];
    expect(BookingDraft.read(noContact)).toBeNull();
    expect(
      BookingDraft.read({ ...(fresh as object), draftLocalDate: '2026-02-30' }),
    ).toBeNull();
    expect(BookingDraft.read(null)).toBeNull();
  });
});

describe('BookingDraft.of — the draft to persist, its origin chosen', () => {
  const SOURCE_VISIT = AppointmentId.of('appt-source');
  const moving = (readerUserId: UserId | null): BookingDraft.Moving => ({
    appointmentId: VISIT,
    readerUserId,
    localDate: DAY,
    riders: [RIDER],
    release: [CHAIR],
  });
  const source = (readerUserId: UserId | null): BookingDraft.Source => ({
    appointmentId: SOURCE_VISIT,
    readerUserId,
  });
  const of = (
    move: BookingDraft.Moving | null,
    from: BookingDraft.Source | null,
  ) => BookingDraft.of(STATE, BookingContact.NONE, DAY, move, from);

  it('persists a move bound to an account as a RESCHEDULE, whatever the rebooking edge says', () => {
    expect(of(moving(OWNER), source(OWNER))).toEqual(reschedule());
    expect(of(moving(OWNER), null)).toEqual(reschedule());
  });

  it('persists a rebooking edge bound to an account as BOOKED_FROM when no bound move wins', () => {
    const bookedFrom = BookingDraft.bookedFrom(
      STATE,
      BookingContact.NONE,
      DAY,
      BookingDraft.bookedFromOrigin(SOURCE_VISIT, OWNER),
    );
    expect(of(null, source(OWNER))).toEqual(bookedFrom);
    // A move bound to nobody lives in memory alone — the next rung answers.
    expect(of(moving(null), source(OWNER))).toEqual(bookedFrom);
  });

  it('persists a fresh draft when nothing bound to an account is held', () => {
    const fresh = BookingDraft.fresh(STATE, BookingContact.NONE, DAY);
    expect(of(null, null)).toEqual(fresh);
    expect(of(moving(null), source(null))).toEqual(fresh);
    expect(of(null, source(null))).toEqual(fresh);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const move = deepFreeze(moving(OWNER));
    const from = deepFreeze(source(OWNER));
    expect(of(move, from)).toEqual(of(move, from));
  });
});
