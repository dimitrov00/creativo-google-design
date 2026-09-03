import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { worksTheBook } from '@creativo/domain/accounts';
import {
  Appointment,
  type AppointmentStatus,
  BookingPolicy,
  SEAT_SCHEDULED,
  Seat,
  type SeatOutcome,
  canTransition,
} from '@creativo/domain/scheduling';
import type { ClockPort } from '@creativo/application/shared';
import {
  arrivedAtFromDocument,
  bookedAtFromDocument,
  contactFromDocument,
  type PersistedDocument,
  preservedAppointmentFields,
  revisionOf,
  seatOutcomeFromDocument,
} from '@creativo/application/booking';
import { FirestoreBookingStore } from '../adapters/firestore-booking-store';
import {
  type CommitBookingError,
  CommitBookingInvalidInputError,
  CommitBookingInvariantError,
  CommitBookingStoreError,
} from './commit-booking.errors';
import {
  type BookingDecision,
  type BookingSnapshot,
  type DecideBookingRequest,
  type RequestedSeat,
  type StaffTermsOverride,
  decideBooking,
} from './decide-booking';
import {
  type StaffEditError,
  StaffEditBeforeArrivalError,
  StaffEditForbiddenError,
  StaffEditInvalidCommandError,
  StaffEditOverlapError,
  StaffEditStaleError,
  StaffEditUnauthenticatedError,
} from './staff-edit-appointment.errors';

/**
 * What the shop is doing to this appointment — a DISCRIMINATED command, never
 * a patch of two timestamps.
 *
 * A `PATCH {start, end}` would collapse five different acts into one shape and
 * lose the only thing that makes a refusal actionable: WHICH edge is the
 * problem. "Ivan is busy" is not an answer a receptionist can act on; "the
 * bottom handle runs into Ivan's 11:00" is. It also loses the acts that are
 * not geometry at all — a discount and a chair swap are not two timestamps in
 * any encoding.
 *
 * The five arms map one-to-one onto what the editor can actually do, which
 * after Ruling B is start-and-duration rather than start-and-end:
 *   - `move`     — drag the block, or tap a running-late chip. Holds duration,
 *                  changes the start of the WHOLE party. Sweeps the entire
 *                  interval and both buffers, and may land on another day.
 *   - `resize`   — drag a handle. `end` holds the start and writes a duration;
 *                  `start` holds the END and writes both, which is the honest
 *                  form of "I'll start ten minutes later but still finish at
 *                  eleven".
 *   - `redurate` — the `Времетраене` ladder: one seat, one duration, typed.
 *   - `reprice`  — a discount or a correction on one seat.
 *   - `restaff`  — `⋯ → Смени стола`: one seat changes lane.
 */
export type StaffEditCommand =
  | { readonly kind: 'move'; readonly startIso: string }
  | {
      readonly kind: 'resize';
      readonly edge: 'start' | 'end';
      readonly atIso: string;
    }
  | {
      readonly kind: 'reprice';
      readonly seatId: string;
      readonly priceMinorUnits: number;
    }
  | {
      readonly kind: 'redurate';
      readonly seatId: string;
      readonly minutes: number;
    }
  | {
      readonly kind: 'restaff';
      readonly seatId: string;
      readonly barberId: string;
    };

export interface StaffEditAppointmentInput {
  readonly appointmentId: string;
  /** From `request.auth.uid`. `null` is a refusal, never an anonymous edit. */
  readonly actorUserId: string | null;
  /** From the VERIFIED token's `roles` claim. */
  readonly actorRoles: readonly string[];
  readonly command: StaffEditCommand;
  /**
   * The sheet said «Запази въпреки застъпването» and the user tapped it.
   *
   * The ONLY thing that turns the collision check off, and the reason it is a
   * request field while `allowOutsideWindow` is not: placing a booking outside
   * the roster is simply the staff rule, but sitting on somebody else's slot
   * is a decision somebody has to make out loud.
   */
  readonly acknowledgedOverlap?: boolean;
  /**
   * The revision the sheet was drawn from, when it has one.
   *
   * Absent means the caller makes no claim about what it read and is not
   * refused for it — a chip that pushes a running-late visit by ten minutes
   * has no draft to be stale.
   */
  readonly expectedVersion?: number | null;
}

export interface StaffEditResult {
  readonly appointmentId: string;
  /** What the sheet should send as `expectedVersion` on its next save. */
  readonly revision: number;
}

/** One stored seat, read as primitives before anything is decided about it. */
interface StoredSeat {
  readonly id: string;
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly barberId: string;
  readonly barberPref?: 'any' | 'specific';
  readonly zone: string;
  readonly startMs: number;
  readonly durationMinutes: number;
  readonly priceMinorUnits: number;
  readonly currencyCode: string;
  readonly setupMinutes: number;
  readonly cleanupMinutes: number;
  readonly outcome: SeatOutcome;
  readonly subject: RequestedSeat['subject'];
}

const MINUTE_MS = 60_000;

function endMs(seat: StoredSeat): number {
  return seat.startMs + seat.durationMinutes * MINUTE_MS;
}

/**
 * Read one persisted seat, refusing rather than guessing.
 *
 * Nothing is defaulted into existence and nothing is downgraded. In
 * particular an ACCOUNT seat that is not the owner's own is refused outright:
 * the request shape a decision is rebuilt from can express `self` and `guest`
 * and nothing else, so re-deciding such a seat would quietly turn a linked
 * account into an anonymous label — and there would be no source left to
 * recover the link from. No writer in this codebase produces one today; the
 * refusal is here so that if one ever does, an edit stops rather than erases.
 */
function readSeat(
  raw: unknown,
  rootStatus: AppointmentStatus | undefined,
): StoredSeat | null {
  if (raw == null || typeof raw !== 'object') return null;
  const seat = raw as Record<string, unknown>;
  const slot = (seat['slot'] ?? {}) as Record<string, unknown>;
  const terms = (seat['terms'] ?? {}) as Record<string, unknown>;
  const subject = (seat['subject'] ?? {}) as Record<string, unknown>;

  const zone = String(slot['zone'] ?? '');
  const start = ZonedDateTime.fromISO(String(slot['startIso'] ?? ''), zone);
  if (start.isFailure()) return null;

  const durationMinutes = Number(terms['durationMinutes']);
  const priceMinorUnits = Number(terms['priceMinorUnits']);
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes <= 0 ||
    !Number.isFinite(priceMinorUnits)
  ) {
    return null;
  }

  let requested: RequestedSeat['subject'];
  if (subject['kind'] === 'account') {
    if (subject['relationship'] !== 'self') return null;
    requested = { kind: 'self' };
  } else {
    requested = { kind: 'guest', label: String(subject['label'] ?? '') };
  }

  const pref = seat['barberPref'];
  return {
    id: String(seat['id'] ?? ''),
    serviceId: String(seat['serviceId'] ?? ''),
    variantId: seat['variantId'] == null ? null : String(seat['variantId']),
    barberId: String(seat['barberId'] ?? ''),
    // Carried forward, never re-derived. `barberPref` is the one fact that
    // says whether this client can be moved to another chair without a phone
    // call, and a staff edit that dropped it would recreate the very bug the
    // commit path was just fixed for.
    ...(pref === 'any' || pref === 'specific' ? { barberPref: pref } : {}),
    zone,
    startMs: start.value.toMillis(),
    durationMinutes,
    priceMinorUnits,
    currencyCode: String(terms['currencyCode'] ?? ''),
    setupMinutes: Number(terms['setupMinutes'] ?? 0),
    cleanupMinutes: Number(terms['cleanupMinutes'] ?? 0),
    // The ROOT status is the legacy path's discriminator — a seat with no
    // stored outcome on a settled appointment is not "scheduled", and reading
    // it as such would resurrect finished business onto the day sheet.
    outcome: seatOutcomeFromDocument(
      seat['outcome'],
      rootStatus,
      start.value.toMillis() + durationMinutes * MINUTE_MS,
    ),
    subject: requested,
  };
}

/**
 * `staffEditAppointment` — the shop moving its own book.
 *
 * ### Why this is not `rescheduleAppointment` with a role check
 * Four of its rules are the client's, and every one of them is wrong here:
 * the cancellation window (the shop is not a client asking the shop for a
 * favour — *"the shop itself may always move its own book"*, already ruled
 * for `transitionAppointment`), the ownership check (staff move other
 * people's bookings; that is the job), the rostered window (staff placement
 * is not bookable placement — `roster-window.ts` says so in prose), and the
 * refusal to touch a party with a resolved seat (a party where one guest is
 * already served is exactly the party someone needs to shorten). What is left
 * of `rescheduleAppointment` after removing them is not a reschedule.
 *
 * ### What it restores, and why each one is a bug if it does not
 * A decision rebuilds the appointment from the catalogue and the request, so
 * everything that belongs to the appointment's IDENTITY rather than its
 * placement has to be put back explicitly:
 *   - `status` — a move must not walk a confirmed booking back to pending.
 *   - `contact` — the number the shop dials.
 *   - `bookedAt` — the booking instant; restamping it would collapse booking
 *     lead time toward zero for exactly the bookings planned furthest ahead.
 *   - `arrivedAt` — 🔴 and this one is not merely lossy. `primaryVerb` gates
 *     the completion verb on `arrived`, so an erased stamp makes FINISHING
 *     THE VISIT vanish from the sheet. It cannot be backfilled.
 *   - seat ids and per-seat OUTCOMES — the guest who was served, the guest who
 *     did not show. Fresh ids would also orphan every per-seat action the
 *     sheet has open.
 *   - the seats' `barberPref`, and every document field this mapper does not
 *     own (see `preservedAppointmentFields`).
 */
export class StaffEditAppointmentUseCase {
  constructor(
    private readonly store: FirestoreBookingStore,
    private readonly clock: ClockPort,
    private readonly policy: BookingPolicy = BookingPolicy.default(),
  ) {}

  async execute(
    input: StaffEditAppointmentInput,
  ): Promise<Result<StaffEditResult, StaffEditError>> {
    if (!input.actorUserId) {
      return fail(new StaffEditUnauthenticatedError());
    }
    // `worksTheBook`, NOT `isStaff`. The two differ by `content_manager`, a
    // copy-and-media role that `firestore.rules` refuses every appointment
    // READ — handing it the book's writes would be a permission the reader is
    // denied and the writer is granted.
    if (!worksTheBook(input.actorRoles)) {
      return fail(new StaffEditForbiddenError());
    }
    if (input.appointmentId.length === 0) {
      return fail(new StaffEditInvalidCommandError('appointmentId'));
    }

    const shape = validateCommand(input.command);
    if (shape.isFailure()) return fail(shape.error);
    const command = shape.value;

    /**
     * What `plan` worked out, read back by `decide`.
     *
     * Local to the call and reassigned on every attempt, which is what makes
     * it safe: a Firestore transaction can retry, and `plan` runs first on
     * each attempt, so `decide` can never see a previous attempt's numbers.
     */
    let planned: PlannedEdit | null = null;
    let nextRevision = 0;

    const written = await this.store.reschedule<StaffEditError>(
      input.appointmentId,
      // Staff bypass the owner check entirely — which is also what unfreezes
      // every walk-in already in the collection. `ownerUserId: null` made
      // those rows equal to nobody's uid and therefore unreschedulable by
      // ANYONE, a state nothing ever decided on purpose.
      () => true,
      (current) => {
        const result = this.plan(
          input.appointmentId,
          current,
          command,
          input.expectedVersion,
        );
        if (result.isFailure()) return fail(result.error);
        planned = result.value;
        nextRevision = result.value.nextRevision;
        return ok(result.value.request);
      },
      (snapshot, current, request) => {
        // Unreachable: `plan` runs first on every attempt and either sets this
        // or fails the attempt. Checked rather than asserted because a
        // silently-null plan would decide the WRONG geometry.
        if (planned === null) {
          return fail(new CommitBookingInvalidInputError('command'));
        }
        return this.decide(snapshot, current, request, planned, input);
      },
      (current) => ({
        ...preservedAppointmentFields(current),
        revision: revisionOf(current) + 1,
      }),
    );

    if (written.isFailure()) return fail(written.error);
    return ok({ appointmentId: input.appointmentId, revision: nextRevision });
  }

  /**
   * The stored appointment plus the command → the request a decision runs on.
   *
   * Every seat is rebuilt from the DOCUMENT, not from a payload: the caller
   * names an act, never a cart. That is what keeps a chair swap from being a
   * back door to re-pricing every other leg of the party.
   */
  private plan(
    appointmentId: string,
    current: PersistedDocument,
    command: StaffEditCommand,
    expectedVersion: number | null | undefined,
  ): Result<PlannedEdit, StaffEditError> {
    const revision = revisionOf(current);
    if (expectedVersion != null && expectedVersion !== revision) {
      return fail(new StaffEditStaleError(expectedVersion, revision));
    }

    const rootStatus = current['status'] as AppointmentStatus | undefined;
    const rawSeats = Array.isArray(current['seats']) ? current['seats'] : [];
    const stored: StoredSeat[] = [];
    for (const raw of rawSeats) {
      const seat = readSeat(raw, rootStatus);
      if (!seat) return fail(new CommitBookingInvalidInputError('seats'));
      stored.push(seat);
    }
    if (stored.length === 0) {
      return fail(new CommitBookingInvalidInputError('seats'));
    }

    const applied = applyCommand(stored, command);
    if (applied.isFailure()) return fail(applied.error);
    const next = applied.value;

    const seats: RequestedSeat[] = [];
    const overrides = new Map<string, StaffTermsOverride>();
    for (const seat of next) {
      const start = ZonedDateTime.fromMillis(seat.startMs, seat.zone);
      if (start.isFailure()) {
        return fail(new CommitBookingInvalidInputError('startIso'));
      }
      seats.push({
        // The SEAT ID is the line id, so the terms carried forward land back
        // on the seat they came from however the party is ordered.
        lineId: seat.id,
        serviceId: seat.serviceId,
        variantId: seat.variantId,
        barberId: seat.barberId,
        ...(seat.barberPref ? { barberPref: seat.barberPref } : {}),
        startIso: start.value.toISO(),
        subject: seat.subject,
      });
      // The terms are a SNAPSHOT taken when the booking was made, and a move
      // is not a re-sale. Carrying every one of them forward is what stops a
      // catalogue price rise from silently re-pricing a booking somebody
      // merely dragged fifteen minutes — the decision still resolves the
      // catalogue's answer, but only to record it as provenance.
      overrides.set(seat.id, {
        priceMinorUnits: seat.priceMinorUnits,
        currencyCode: seat.currencyCode,
        durationMinutes: seat.durationMinutes,
        setupMinutes: seat.setupMinutes,
        cleanupMinutes: seat.cleanupMinutes,
      });
    }

    const contact = contactFromDocument(current)?.toProps();
    return ok({
      request: {
        locationId: String(current['locationId'] ?? ''),
        seats,
        // REUSED as the attempt id, which is what keeps the edited
        // appointment the same DOCUMENT rather than minting a new one — the
        // client's deep links, the reminder that named it and every per-seat
        // action the sheet has open all key off this id.
        attemptId: appointmentId,
        ...(contact ? { contact } : {}),
      },
      stored,
      next,
      overrides,
      nextRevision: revision + 1,
    });
  }

  private decide(
    snapshot: BookingSnapshot,
    current: PersistedDocument,
    request: DecideBookingRequest,
    planned: PlannedEdit,
    input: StaffEditAppointmentInput,
  ): Result<BookingDecision, StaffEditError> {
    const now = this.clock.now(snapshot.zone);
    if (now.isFailure()) {
      return fail(new CommitBookingStoreError(now.error));
    }

    const status = (current['status'] ?? {}) as AppointmentStatus;
    // The domain's own lifecycle graph, never a re-encoded copy: a completed,
    // no-showed or already-cancelled visit is HISTORY. `canTransition(_,
    // 'cancelled')` is the liveness test the reschedule path already uses,
    // and asking the same question twice in two dialects is how the two come
    // to disagree.
    if (!canTransition(status, 'cancelled')) {
      return fail(new CommitBookingInvalidInputError('status'));
    }

    const arrivedAt = arrivedAtFromDocument(current);
    if (arrivedAt !== null) {
      const finish = Math.max(...planned.next.map(endMs));
      if (finish <= arrivedAt.toMillis()) {
        // A DATA-INTEGRITY refusal, not a scheduling one: nothing is wrong
        // with the chair, but the visit would claim to have ended before the
        // client walked in. The stamp is the fact that cannot move.
        const finishIso = ZonedDateTime.fromMillis(finish, snapshot.zone);
        return fail(
          new StaffEditBeforeArrivalError(
            finishIso.isSuccess() ? finishIso.value.toISO() : String(finish),
            arrivedAt.toISO(),
          ),
        );
      }
    }

    const ids = planned.next.map((seat) => seat.id);
    let cursor = 0;

    const decided = decideBooking(request, snapshot, {
      now: now.value,
      policy: this.policy,
      // The STORED ids, in order, so per-seat outcomes and every open per-seat
      // action on the sheet survive the rebuild.
      nextId: () => ids[cursor++] ?? '',
      // The appointment's OWN owner, off the document — never the staff actor.
      // Taking the actor here would hand the receptionist the client's
      // booking. `null` is a walk-in and stays a walk-in.
      ownerUserId:
        typeof current['ownerUserId'] === 'string'
          ? current['ownerUserId']
          : null,
      // Unconditional, no request field, no second tap — see the deps' doc.
      allowOutsideWindow: true,
      // Acknowledged, and only acknowledged.
      allowOverlap: input.acknowledgedOverlap === true,
      termsOverrides: planned.overrides,
    });
    if (decided.isFailure()) {
      return fail(translateRefusal(decided.error, input.command));
    }

    // Per-seat outcomes are restored by INDEX, which is exact: the decision
    // consumed `request.seats` in order and `request.seats` was built from
    // `planned.next` in order.
    const seats = decided.value.appointment.seats.map((seat, index) =>
      Seat.of({
        id: seat.id,
        subject: seat.subject,
        serviceId: seat.serviceId,
        variantId: seat.variantId,
        barberId: seat.barberId,
        terms: seat.terms,
        catalogTerms: seat.catalogTerms,
        startsAt: seat.startsAt,
        pref: seat.pref,
        // eslint-disable-next-line security/detect-object-injection -- `index` is the array index this very `map` produced, over an array the decision built from `planned.next` in order.
        outcome: planned.next[index]?.outcome ?? SEAT_SCHEDULED,
      }),
    );

    const restored = Appointment.reconstitute({
      id: decided.value.appointment.id.value,
      locationId: decided.value.appointment.locationId.value,
      seats,
      status,
      contact: contactFromDocument(current),
      bookedAt: bookedAtFromDocument(current),
      bookedFromAppointmentId:
        typeof current['bookedFromAppointmentId'] === 'string'
          ? current['bookedFromAppointmentId']
          : null,
      arrivedAt,
    });
    if (restored.isFailure()) {
      return fail(new CommitBookingInvariantError(restored.error));
    }

    return ok({
      appointment: restored.value,
      busyWrites: decided.value.busyWrites,
    });
  }
}

interface PlannedEdit {
  readonly request: DecideBookingRequest;
  readonly stored: readonly StoredSeat[];
  readonly next: readonly StoredSeat[];
  readonly overrides: ReadonlyMap<string, StaffTermsOverride>;
  readonly nextRevision: number;
}

/**
 * Shape-check the command before anything is read.
 *
 * Every field is checked as a primitive and nothing is coerced into
 * plausibility: a `redurate` of `"45"` is a caller bug, and rounding it into
 * existence is how a bug becomes a booking.
 */
function validateCommand(
  raw: unknown,
): Result<StaffEditCommand, StaffEditError> {
  const parses = (iso: unknown): boolean =>
    typeof iso === 'string' && Number.isFinite(Date.parse(iso));
  const command = (raw ?? {}) as StaffEditCommand;

  switch (command.kind) {
    case 'move':
      return parses(command.startIso)
        ? ok(command)
        : fail(new StaffEditInvalidCommandError('startIso'));
    case 'resize':
      if (command.edge !== 'start' && command.edge !== 'end') {
        return fail(new StaffEditInvalidCommandError('edge'));
      }
      return parses(command.atIso)
        ? ok(command)
        : fail(new StaffEditInvalidCommandError('atIso'));
    case 'reprice':
      if (typeof command.seatId !== 'string' || command.seatId.length === 0) {
        return fail(new StaffEditInvalidCommandError('seatId'));
      }
      return Number.isInteger(command.priceMinorUnits) &&
        command.priceMinorUnits >= 0
        ? ok(command)
        : fail(new StaffEditInvalidCommandError('priceMinorUnits'));
    case 'redurate':
      if (typeof command.seatId !== 'string' || command.seatId.length === 0) {
        return fail(new StaffEditInvalidCommandError('seatId'));
      }
      return Number.isInteger(command.minutes) && command.minutes > 0
        ? ok(command)
        : fail(new StaffEditInvalidCommandError('minutes'));
    case 'restaff':
      if (typeof command.seatId !== 'string' || command.seatId.length === 0) {
        return fail(new StaffEditInvalidCommandError('seatId'));
      }
      return typeof command.barberId === 'string' &&
        command.barberId.trim().length > 0
        ? ok(command)
        : fail(new StaffEditInvalidCommandError('barberId'));
    default:
      return fail(new StaffEditInvalidCommandError('kind'));
  }
}

/**
 * The command, applied to the stored seats.
 *
 * ### Which seats an edge belongs to
 * A `move` is the whole party: every seat shifts by one delta, so the
 * arrangement the shop offered — two guests in parallel, or one barber back
 * to back — is preserved exactly.
 *
 * A `resize` acts on the seats that OWN the edge being dragged: the ones
 * starting at the envelope's start, or ending at its end. Two guests
 * finishing together both extend when the bottom handle is pulled down; the
 * last leg of a sequential chain extends alone. Anything else would either
 * silently stretch a leg nobody touched or refuse a gesture the frame draws.
 */
function applyCommand(
  stored: readonly StoredSeat[],
  command: StaffEditCommand,
): Result<readonly StoredSeat[], StaffEditError> {
  const envelopeStart = Math.min(...stored.map((seat) => seat.startMs));
  const envelopeEnd = Math.max(...stored.map(endMs));

  switch (command.kind) {
    case 'move': {
      const delta = Date.parse(command.startIso) - envelopeStart;
      return ok(
        stored.map((seat) => ({ ...seat, startMs: seat.startMs + delta })),
      );
    }
    case 'resize': {
      if (command.edge === 'end') {
        const deltaMinutes = Math.round(
          (Date.parse(command.atIso) - envelopeEnd) / MINUTE_MS,
        );
        return reshape(stored, (seat) =>
          endMs(seat) === envelopeEnd
            ? { ...seat, durationMinutes: seat.durationMinutes + deltaMinutes }
            : seat,
        );
      }
      // The top handle HOLDS THE END: the start moves and the duration
      // absorbs it. "I'll start ten minutes later but still finish at eleven"
      // is one gesture and two written values, which is exactly why a resize
      // cannot be a patch of one timestamp.
      const at = Date.parse(command.atIso);
      const deltaMinutes = Math.round((at - envelopeStart) / MINUTE_MS);
      return reshape(stored, (seat) =>
        seat.startMs === envelopeStart
          ? {
              ...seat,
              startMs: at,
              durationMinutes: seat.durationMinutes - deltaMinutes,
            }
          : seat,
      );
    }
    case 'redurate':
      return reshapeSeat(stored, command.seatId, (seat) => ({
        ...seat,
        durationMinutes: command.minutes,
      }));
    case 'reprice':
      return reshapeSeat(stored, command.seatId, (seat) => ({
        ...seat,
        priceMinorUnits: command.priceMinorUnits,
      }));
    case 'restaff':
      return reshapeSeat(stored, command.seatId, (seat) => ({
        ...seat,
        barberId: command.barberId,
      }));
  }
}

/** Map every seat, refusing a duration the edit drove to zero or below. */
function reshape(
  stored: readonly StoredSeat[],
  map: (seat: StoredSeat) => StoredSeat,
): Result<readonly StoredSeat[], StaffEditError> {
  const next = stored.map(map);
  // Not `invalid_range` — there is no range. The end is DERIVED, so the only
  // thing that can be wrong is the duration, and that is what is named.
  return next.every(
    (seat) =>
      Number.isInteger(seat.durationMinutes) && seat.durationMinutes > 0,
  )
    ? ok(next)
    : fail(new StaffEditInvalidCommandError('minutes'));
}

/** The same, for the commands that name one seat. */
function reshapeSeat(
  stored: readonly StoredSeat[],
  seatId: string,
  map: (seat: StoredSeat) => StoredSeat,
): Result<readonly StoredSeat[], StaffEditError> {
  if (!stored.some((seat) => seat.id === seatId)) {
    return fail(new StaffEditInvalidCommandError('seatId'));
  }
  return reshape(stored, (seat) => (seat.id === seatId ? map(seat) : seat));
}

/**
 * A decision's refusal → what the sheet can act on.
 *
 * Only one is rewritten, and it is the only one that is an OFFER: with the
 * window check switched off for staff, a `slot_unavailable` can mean nothing
 * but a collision — so it becomes the acknowledgeable overlap, carrying the
 * edge that a resize can name and a move cannot. Everything else keeps the
 * commit path's code, because the sheet has nothing different to say about a
 * service that vanished or a store that would not write.
 */
function translateRefusal(
  error: CommitBookingError,
  command: StaffEditCommand,
): StaffEditError {
  if (error.code !== 'booking.commit.slot_unavailable') return error;
  return new StaffEditOverlapError(
    command.kind === 'resize' ? command.edge : null,
    String(error.params['barberId'] ?? ''),
    String(error.params['startIso'] ?? ''),
  );
}
