import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BookingCart,
  BookingContact,
  BookingDraft,
  BookingDraftOrigin,
  BookingFlowState,
  BookingFlowStep,
  Party,
} from '@core/components';
import {
  AppointmentId,
  BarberId,
  EndMinute,
  LocalDate,
  LocationId,
  MinuteOfDay,
  RepositoryErrorCode,
  UserId,
} from '@core/primitives';
import { unwrapErr, unwrapOk } from '@core/testing';
import { sessionStorageBookingDraftPorts } from './session-storage-booking-draft.adapter';

const KEY = 'creativo.booking-draft/v2';
/** Where the pre-flatten build kept its draft (a `{ version, draft }` envelope). */
const PRE_FLATTEN_KEY = 'creativo.booking-draft';

const DAY = unwrapOk(LocalDate.parse('2026-10-06'));
const OWNER = UserId.of('client-1');
const VISIT = AppointmentId.of('appt-source');

const LOCATION: BookingFlowState = BookingFlowState.initial(Party.anonymous());
const SERVICES: BookingFlowState = {
  bookingFlowStep: BookingFlowStep.Services,
  party: { ...Party.owned(OWNER), nextGuestSequence: 7 },
  cart: { ...BookingCart.empty(), cartNextSequence: 4 },
  locationId: LocationId.of('loc-center'),
};

const fresh = (state: BookingFlowState = LOCATION) =>
  BookingDraft.fresh(state, BookingContact.NONE, null);

describe('sessionStorageBookingDraftPorts', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when nothing has been saved yet', () => {
    expect(
      unwrapOk(sessionStorageBookingDraftPorts().loadBookingDraft()),
    ).toBeNull();
  });

  it('accepts every step on the spine the flow can be saved on — including the first', () => {
    // The whitelist was once a hand-written copy and drifted: a draft saved
    // on step one was discarded on reload. The guard is the flow's own.
    const ports = sessionStorageBookingDraftPorts();
    for (const state of [LOCATION, SERVICES]) {
      expect(ports.saveBookingDraft(fresh(state)).ok).toBe(true);
      expect(unwrapOk(ports.loadBookingDraft())?.bookingFlowStep).toBe(
        state.bookingFlowStep,
      );
    }
  });

  it('round-trips a whole draft through save/load — the flow, the contact, the day, the origin', () => {
    const ports = sessionStorageBookingDraftPorts();
    const draft = BookingDraft.bookedFrom(
      SERVICES,
      { ...BookingContact.NONE, contactName: 'Мария', contactNote: 'бележка' },
      DAY,
      BookingDraft.bookedFromOrigin(VISIT, OWNER),
    );

    expect(ports.saveBookingDraft(draft).ok).toBe(true);

    expect(unwrapOk(ports.loadBookingDraft())).toEqual(draft);
    // Stored flat, under the versioned key.
    expect(JSON.parse(sessionStorage.getItem(KEY) ?? 'null')).toMatchObject({
      bookingDraftOrigin: BookingDraftOrigin.BookedFrom,
      bookedFromAppointmentId: 'appt-source',
      draftLocalDate: '2026-10-06',
    });
  });

  it('round-trips a move with its riders and the chairs it releases', () => {
    const ports = sessionStorageBookingDraftPorts();
    const draft = BookingDraft.reschedule(
      SERVICES,
      BookingContact.NONE,
      DAY,
      BookingDraft.rescheduleOrigin(
        VISIT,
        OWNER,
        DAY,
        [],
        [
          {
            barberId: BarberId.of('ivan'),
            startMinutes: unwrapOk(MinuteOfDay.of(600)),
            endMinutes: unwrapOk(EndMinute.of(660)),
          },
        ],
      ),
    );

    ports.saveBookingDraft(draft);

    expect(unwrapOk(ports.loadBookingDraft())).toEqual(draft);
  });

  it('preserves both monotonic counters — the §7.7 guarantee across a reload', () => {
    const ports = sessionStorageBookingDraftPorts();
    ports.saveBookingDraft(fresh(SERVICES));

    expect(unwrapOk(ports.loadBookingDraft())).toMatchObject({
      party: { nextGuestSequence: 7 },
      cart: { cartNextSequence: 4 },
    });
  });

  it('round-trips an ANONYMOUS draft — /book is browsable before sign-in', () => {
    const ports = sessionStorageBookingDraftPorts();
    ports.saveBookingDraft(fresh());

    expect(unwrapOk(ports.loadBookingDraft())).toMatchObject({
      bookingFlowStep: BookingFlowStep.Location,
      party: { ownerUserId: null },
    });
  });

  it('clears the stored draft', () => {
    const ports = sessionStorageBookingDraftPorts();
    ports.saveBookingDraft(fresh());

    expect(ports.clearBookingDraft().ok).toBe(true);

    expect(unwrapOk(ports.loadBookingDraft())).toBeNull();
  });

  it('restores a rebooking edge that does not parse as a FRESH draft', () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        ...fresh(),
        bookingDraftOrigin: BookingDraftOrigin.BookedFrom,
        bookedFromAppointmentId: 'no/such/id',
        bookedFromOwnerUserId: 'client-1',
      }),
    );

    const loaded = unwrapOk(
      sessionStorageBookingDraftPorts().loadBookingDraft(),
    );

    expect(loaded?.bookingDraftOrigin).toBe(BookingDraftOrigin.Fresh);
  });

  it.each([
    ['corrupted JSON', '{not valid json'],
    [
      'a malformed stored shape',
      JSON.stringify({ bookingFlowStep: 'SERVICES' }),
    ],
    [
      'an unknown step — never restoring the flow into nowhere',
      JSON.stringify({ ...fresh(), bookingFlowStep: 'PAYMENT' }),
    ],
    [
      'a move that does not come back whole',
      JSON.stringify({
        ...fresh(),
        bookingDraftOrigin: BookingDraftOrigin.Reschedule,
        rescheduleAppointmentId: 'appt-source',
        rescheduleOwnerUserId: 'client-1',
        rescheduleLocalDate: '2026-10-06',
        rescheduleRiders: [{ serviceId: 'svc-fade' }],
        rescheduleRelease: [],
      }),
    ],
  ])(
    'surfaces %s as a failed Result and clears it — the flow starts fresh',
    (_what, raw) => {
      sessionStorage.setItem(KEY, raw);

      const failure = unwrapErr(
        sessionStorageBookingDraftPorts().loadBookingDraft(),
      );

      expect(failure).toMatchObject({
        errorCode: RepositoryErrorCode.Malformed,
        path: KEY,
      });
      expect(sessionStorage.getItem(KEY)).toBeNull();
    },
  );

  it('never reads the pre-flatten key: a draft there is absent, not an error', () => {
    // The pre-flatten envelope, still sitting in a tab that was open across
    // a deploy. Nothing the person did wrong, so nothing to report — the
    // flow just starts fresh rather than half-reading a shape it can no
    // longer hold.
    sessionStorage.setItem(
      PRE_FLATTEN_KEY,
      JSON.stringify({ version: 3, draft: { step: 'services' } }),
    );

    expect(
      unwrapOk(sessionStorageBookingDraftPorts().loadBookingDraft()),
    ).toBeNull();
  });

  it('wraps a thrown setItem error (e.g. quota exceeded) in a failed Result', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(
      unwrapErr(sessionStorageBookingDraftPorts().saveBookingDraft(fresh())),
    ).toEqual({
      errorCode: RepositoryErrorCode.WriteFailed,
      path: KEY,
      reason: 'QuotaExceededError',
    });
  });

  it('wraps a thrown getItem error in a failed Result', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });

    expect(
      unwrapErr(sessionStorageBookingDraftPorts().loadBookingDraft()).errorCode,
    ).toBe(RepositoryErrorCode.ReadFailed);
  });
});
