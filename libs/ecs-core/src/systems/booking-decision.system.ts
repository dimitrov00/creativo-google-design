import {
  type BookingCall,
  BookingContact,
  type ChairTime,
  RequestedSubjectRole,
  BookingLifecycle,
  BookingPolicy,
  type ExceptionEffectRule,
  MinuteRange,
  type DayHours,
  type E164,
  type Placement,
  type PlacementPolicy,
  StaffTermsOverride,
  type ScheduleVersion,
  type SeatIdPair,
  SeatLabel,
  SeatOutcome,
  Seat,
  SeatOccupant,
  SubjectRelationship,
  ServiceTerms,
  type ShopNow,
} from '@core/components';
import {
  Result,
  BusyKey,
  Currency,
  type DurationMinutes,
  MinuteCount,
  AppointmentId,
  BarberId,
  type CustomerId,
  defect,
  LocationId,
  SeatId,
  ServiceId,
  UserId,
  LocalDate,
  EndMinute,
  MinuteOfDay,
  PriceCents,
  type UtcEpochMs,
} from '@core/primitives';
import {
  BookingError,
  ShopUnavailableReason,
  SchedulingError,
} from '@core/errors';
import type { Appointment, ScheduleException, Service } from '@core/entities';
import { AppointmentIndexSystem } from './appointment-index.system';
import { AvailabilitySystem } from './availability.system';
import { GuestLabelSystem } from './guest-label.system';
import { OfferingPriceSystem } from './offering-price.system';
import {
  type AdmissionSeatInput,
  type AdmittedSeat,
  PartyAdmissionSystem,
} from './party-admission.system';
import { RosterSystem } from './roster.system';
import { type SeatedSpan, SeatingRuleSystem } from './seating-rule.system';

/**
 * What a commit asks for (`decide-booking.ts:102-153`), every field present —
 * foreign input (the L3 escape): the shop, the ONE shop day every seat is on
 * (T7), the seats, `attemptId` (used verbatim as the appointment id — a
 * retry finds its own booking), the rebooking edge (an analytics edge, no
 * authority), the contact snapshot, and who is placing it (stamped on the
 * new document, never read by the decision).
 */
export type DecideBookingInput = {
  readonly locationId: string;
  readonly localDate: string;
  readonly seats: readonly BookingCall.SeatInput[];
  readonly attemptId: string | null;
  readonly bookedFromAppointmentId: string | null;
  readonly contact: BookingContact.Input | null;
  readonly placement: Placement | null;
};

/** One barber's roster as loaded from `barberSchedules/{barberId}`. */
export type DecisionSchedule = {
  readonly barberId: BarberId;
  readonly versions: readonly ScheduleVersion[];
  readonly turnaroundMinutes: MinuteCount;
};

/** One busy day as the projection stores it — UNPADDED minute ranges of its shop day. */
export type DecisionBusyDay = {
  readonly id: BusyKey;
  readonly spans: readonly MinuteRange[];
};

/** A published exception, as the commit reads it by `BusyKey` — a whole `ScheduleException` passes. */
export type DecisionException = Pick<
  ScheduleException,
  'barberId' | 'localDate'
> &
  ExceptionEffectRule;

/**
 * Everything the decision reads, loaded INSIDE the transaction so the commit
 * fails rather than races if any of it changes underneath
 * (`decide-booking.ts:163-198`). `shopHours` is the shop's Mon-first week
 * (not seven entries: the shop publishes none). A barber with no schedule
 * entry has no roster. No zone (Law 7.2): the shop day is the request's.
 */
export type BookingSnapshot = {
  readonly shopHours: readonly DayHours[];
  readonly services: readonly Service[];
  readonly schedules: readonly DecisionSchedule[];
  readonly busy: readonly DecisionBusyDay[];
  readonly exceptions: readonly DecisionException[];
};

/**
 * One seat of a visit as it STANDS before a rebuild
 * (`decide-booking.ts:237-243`): its id, who sits in it, and the minutes
 * they were sold, on the visit's shop day. A rebuilt seat minted with a
 * standing seat's id IS that seat.
 */
export type DecisionStandingSeat = {
  readonly seatId: SeatId;
  readonly subject: BookingCall.SubjectInput;
  readonly startMinutes: MinuteOfDay;
  readonly durationMinutes: DurationMinutes;
};

/**
 * The decision's context (`DecideBookingDeps`): the shop's "now" (derived
 * once at the boundary from the location's zone — compared on `localDate` +
 * `currentMinute`, `utcEpochMs` only stamps), the envelope's start instant
 * as the boundary computed it ONCE from the call's `localDate` +
 * `startMinutes` on the location's zone (`ZonedTimeSystem.toUtc` — the
 * appointment's one `utcEpochMs`; the wire carries no instant) — the
 * transaction's id mint, the VERIFIED owner (`null`: a
 * walk-in the shop entered itself), the client record of every account on
 * the cart (D29 — resolved by the pipeline, `CustomerId.forUser(uid, hash)`
 * for each of {@link BookingDecisionSystem.accountSubjects}; the system is
 * handed ids, never a hash), the staff term overrides, the visit as it
 * stands and the pairs its last save broke (both `[]` on a commit), and the
 * edge's phone parser.
 */
export type DecideBookingContext = {
  readonly now: ShopNow;
  readonly startUtcMs: UtcEpochMs;
  readonly nextId: () => string;
  readonly ownerUserId: UserId | null;
  readonly customerIds: ReadonlyMap<UserId, CustomerId>;
  readonly termsOverrides: readonly StaffTermsOverride[];
  readonly standing: readonly DecisionStandingSeat[];
  readonly stood: readonly SeatIdPair[];
  readonly parsePhone: (raw: string) => E164 | null;
};

/** A span to add to one barber's public busy projection — flat, on its shop day. */
export type BusyWrite = {
  readonly barberId: BarberId;
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
};

/** The appointment draft and the spans it claims. */
export type BookingDecision = {
  readonly appointment: Appointment;
  readonly busyWrites: readonly BusyWrite[];
};

/* ── helpers ──────────────────────────────────────────────────────────── */

function isBlank(raw: string): boolean {
  return raw.trim().length === 0;
}

/** A set-algebra start back under its brand — chair time never leaves `[0, 1440)`. */
function startOf(minutes: number): MinuteOfDay {
  return MinuteOfDay.ofProven(minutes);
}

/** A set-algebra end back under its brand — chair time never leaves `(0, 1440]`. */
function endOf(minutes: number): EndMinute {
  return EndMinute.ofProven(minutes);
}

function findSchedule(
  schedules: readonly DecisionSchedule[],
  barberId: BarberId,
): DecisionSchedule | null {
  for (let i = 0; i < schedules.length; i++) {
    const schedule = schedules[i] as DecisionSchedule;
    if (schedule.barberId === barberId) return schedule;
  }
  return null;
}

function findException(
  exceptions: readonly DecisionException[],
  barberId: BarberId,
  localDate: LocalDate,
): DecisionException | null {
  for (let i = 0; i < exceptions.length; i++) {
    const exception = exceptions[i] as DecisionException;
    if (exception.barberId === barberId && exception.localDate === localDate) {
      return exception;
    }
  }
  return null;
}

function busySpans(
  busy: readonly DecisionBusyDay[],
  key: BusyKey,
): readonly MinuteRange[] {
  for (let i = 0; i < busy.length; i++) {
    const day = busy[i] as DecisionBusyDay;
    if (day.id === key) return day.spans;
  }
  return [];
}

/** The terms the seat is written with, and the catalogue's when the two differ. */
type ResolvedTerms = {
  readonly terms: ServiceTerms;
  readonly provenance: ServiceTerms | null;
};

/**
 * The terms this seat is actually written with (`decide-booking.ts:650-694`).
 * Three cases, none of them "trust the caller": no override is the catalogue
 * verbatim (every client commit); an override over a live catalogue row is a
 * staff edit, the row kept as provenance; an override with no row left is a
 * booking whose service has since retired. The `field` strings are wire
 * params and keep their spelling (flatten-spec §4.3).
 */
function resolveTerms(
  catalog: ServiceTerms | null,
  override: StaffTermsOverride | null,
): Result<ResolvedTerms, BookingError> {
  if (override === null) {
    if (catalog === null) {
      return Result.err(BookingError.invalidInput('terms'));
    }
    return Result.ok({ terms: catalog, provenance: null });
  }

  const currency =
    override.currency ?? (catalog === null ? null : catalog.currency);
  const cents =
    override.priceCents ?? (catalog === null ? null : catalog.priceCents);
  const duration =
    override.durationMinutes ??
    (catalog === null ? null : catalog.durationMinutes);
  if (cents === null || duration === null) {
    return Result.err(BookingError.invalidInput('terms'));
  }
  // A carried price is HISTORY, not a new figure: it keeps the currency it
  // was stored in (any of the four stored codes — EUR, BGN, USD, GBP), as
  // the legacy kernel read it, instead of being narrowed to the shop's own
  // tradable currency — a pre-2026 seat priced in leva rebuilds in leva (a
  // visit mixing currencies is still refused by `Seat.violations`). The
  // override is carried from STORED seats, server-side; the guards below
  // are the decision's own, so a corrupt carry is refused where it always
  // was.
  const stored = currency === null ? null : storedCurrencyOf(currency);
  if (stored === null || !Number.isInteger(cents) || cents < 0) {
    return Result.err(BookingError.invalidInput('priceCents'));
  }
  // Padding is chair geometry, not a price: whichever answer the caller
  // carried forward is the one the busy projection was drawn from; with no
  // catalogue row left, an unstated pad is none.
  const setup =
    override.setupMinutes ??
    (catalog === null ? MinuteCount.ZERO : catalog.setupMinutes);
  const cleanup =
    override.cleanupMinutes ??
    (catalog === null ? MinuteCount.ZERO : catalog.cleanupMinutes);
  if (
    !Number.isInteger(duration) ||
    duration <= 0 ||
    !isPad(setup) ||
    !isPad(cleanup)
  ) {
    return Result.err(BookingError.invalidInput('durationMinutes'));
  }
  const terms = ServiceTerms.of(
    // `+ 0` folds a negative zero, so `-0` never reaches a document.
    PriceCents.add(cents, PriceCents.ZERO),
    stored,
    duration,
    setup,
    cleanup,
  );
  return Result.ok({
    terms,
    // Equal terms are not an override — a move that changes nothing about
    // the money must not start claiming the catalogue was overruled.
    provenance:
      catalog !== null && !ServiceTerms.equals(catalog, terms) ? catalog : null,
  });
}

/**
 * The stored currency a carried code names — one of the four codes a stored
 * price may carry, case-insensitive and untrimmed, as the legacy kernel read
 * it (`money.ts` `CURRENCIES_BY_CODE`) — or `null`.
 */
function storedCurrencyOf(code: Currency): Currency | null {
  if (code.trim() !== code) return null;
  const parsed = Currency.parse(code);
  return parsed.ok ? parsed.value : null;
}

/** A pad is a non-negative whole number of minutes (`ServiceTerms.parse`). */
function isPad(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 0;
}

/**
 * The client record the pipeline resolved for an account on the cart (D29).
 * The map names every one of {@link BookingDecisionSystem.accountSubjects},
 * so a miss is the caller's defect, never a refusal.
 */
function customerOf(
  customerIds: ReadonlyMap<UserId, CustomerId>,
  userId: UserId,
): CustomerId {
  return (
    customerIds.get(userId) ??
    defect('an account subject without its resolved client record (D29)')
  );
}

/**
 * The seat's occupant (`decide-booking.ts:860-890`): `SELF` is bound to the
 * TOKEN — refused outright with no owner, because the self seat IS the
 * owner's seat; a companion is only ever a stored person carried forward; a
 * guest is their label. An account carries its client record beside it.
 */
function toOccupant(
  subject: BookingCall.SubjectInput,
  owner: UserId | null,
  customerIds: ReadonlyMap<UserId, CustomerId>,
): Result<SeatOccupant, BookingError> {
  if (subject.requestedSubjectRole === RequestedSubjectRole.Self) {
    if (owner === null) {
      return Result.err(BookingError.invalidInput('ownerUserId'));
    }
    return Result.ok(
      SeatOccupant.account(
        owner,
        customerOf(customerIds, owner),
        SubjectRelationship.Self,
      ),
    );
  }
  if (subject.requestedSubjectRole === RequestedSubjectRole.Companion) {
    // Foreign input: the smart constructor is the door (Law 7.4) — a blank
    // id, or one that would name a nested document, is no companion.
    const companion = UserId.parse(subject.companionUserId);
    if (!companion.ok) {
      return Result.err(BookingError.invalidInput('companion'));
    }
    return Result.ok(
      SeatOccupant.account(
        companion.value,
        customerOf(customerIds, companion.value),
        SubjectRelationship.Companion,
      ),
    );
  }
  const label = SeatLabel.parse(subject.label);
  if (!label.ok) {
    return Result.err(BookingError.invalidInput('guest label'));
  }
  return Result.ok(SeatOccupant.anonymous(label.value));
}

/** Per (barber, day), the bookable windows and the padded busy — memoized within ONE call. */
type PlacementFacts = {
  readonly windows: readonly MinuteRange[] | null;
  readonly taken: readonly MinuteRange[];
};

/**
 * BookingDecisionSystem — whether a requested booking may be written, and
 * what writing it means (`decide-booking.ts:60-191,278-330,450,743`). Pure:
 * every fact comes from the snapshot and the context, so the whole
 * server-side authority is unit-testable without an emulator.
 *
 * What the server RE-DERIVES rather than trusts: the TERMS (the catalogue's
 * `termsFor(barber, variant)` — a client naming its own price would book a
 * 40 € fade for nothing), the OWNER (the verified token), the WINDOWS (roster
 * ∩ the shop's hours, minus exceptions), CONFLICTS per person, PEOPLE (no
 * write puts one person in two chairs anew; two guests the client tells
 * apart may not share their label), and COLLISIONS against the busy set read
 * in this transaction — which is what makes two people racing for 14:00
 * resolve to one winner.
 *
 * Time-zone-blind (Law 7.3): every seat is on the request's ONE `localDate`
 * (T7), every check is on that day's wall clock against `ShopNow`'s
 * `localDate` + `currentMinute`, and the only instants are the stamps —
 * `now.utcEpochMs` (booked/confirmed) and the edge's `startUtcMs`.
 *
 * The windows and the padded busy of each barber are computed once per call
 * (hot path #4) and never cached across calls: the memo lives and dies
 * inside `decide`, so a transaction retry recomputes from its fresh read.
 * The availability engine is never run.
 */
export const BookingDecisionSystem = {
  /**
   * The accounts a cart's seats name — the owner for a `SELF` seat (when
   * there is one), each companion id that parses (Law 7.4: an id that does
   * not is refused by {@link decide}, never resolved) — distinct, in seat
   * order. What the pipeline resolves to client records
   * (`CustomerId.forUser(uid, hash)`, and the FIRST_BOOKING `customers`
   * read) before it calls `decide` with {@link DecideBookingContext.customerIds}.
   */
  accountSubjects(
    seats: readonly Pick<BookingCall.SeatInput, 'subject'>[],
    ownerUserId: UserId | null,
  ): readonly UserId[] {
    const out: UserId[] = [];
    for (let i = 0; i < seats.length; i++) {
      const subject = (seats[i] as Pick<BookingCall.SeatInput, 'subject'>)
        .subject;
      let userId: UserId | null = null;
      if (subject.requestedSubjectRole === RequestedSubjectRole.Self) {
        userId =
          ownerUserId !== null && !isBlank(ownerUserId) ? ownerUserId : null;
      } else if (
        subject.requestedSubjectRole === RequestedSubjectRole.Companion
      ) {
        const companion = UserId.parse(subject.companionUserId);
        userId = companion.ok ? companion.value : null;
      }
      if (userId !== null && !out.includes(userId)) out.push(userId);
    }
    return out;
  },

  decide(
    request: DecideBookingInput,
    snapshot: BookingSnapshot,
    policy: BookingPolicy,
    placement: PlacementPolicy,
    release: readonly ChairTime[],
    context: DecideBookingContext,
  ): Result<BookingDecision, BookingError> {
    // A blank id — or one that is no document id at all — names no shop:
    // the one "no usable shop" answer. Foreign input is parsed (Law 7.4).
    const parsedLocation = LocationId.parse(request.locationId);
    if (!parsedLocation.ok) {
      return Result.err(
        BookingError.shopUnavailable(
          request.locationId,
          ShopUnavailableReason.NotFound,
        ),
      );
    }
    const locationId = parsedLocation.value;

    // A walk-in the shop entered itself has no owner at all; a `SELF` seat
    // without one is still refused below.
    const owner = context.ownerUserId;
    if (owner !== null && isBlank(owner)) {
      return Result.err(BookingError.invalidInput('ownerUserId'));
    }

    // Two guests the client tells apart must not share a label — asked
    // before anything counts people, by the party's own rule.
    const subjects: BookingCall.SubjectInput[] = [];
    for (let i = 0; i < request.seats.length; i++) {
      subjects.push((request.seats[i] as BookingCall.SeatInput).subject);
    }
    const sharedLabel = GuestLabelSystem.sharedLabel(subjects);
    if (sharedLabel !== null) {
      return Result.err(BookingError.duplicateGuestLabel(sharedLabel));
    }

    // EVERY REFUSAL THAT DOES NOT DEPEND ON THE TIME, in one place. A seat
    // whose terms staff fixed is CARRIED: it survives its service retiring
    // or gaining variants since it was booked.
    const admissionSeats: AdmissionSeatInput[] = [];
    for (let i = 0; i < request.seats.length; i++) {
      const seat = request.seats[i] as BookingCall.SeatInput;
      admissionSeats.push({
        personKey: GuestLabelSystem.personKeyOf(seat.subject),
        serviceId: seat.serviceId,
        variantId: seat.variantId,
        carried:
          StaffTermsOverride.find(context.termsOverrides, seat.lineId) !== null,
      });
    }
    const admission = PartyAdmissionSystem.admit(
      admissionSeats,
      snapshot.services,
      policy,
      {
        locationId,
        allowConflictingServices: placement.allowConflictingServices,
      },
    );
    if (!admission.ok) return admission;

    const now = context.now;
    const day = LocalDate.parse(request.localDate);
    const horizonEnd = BookingPolicy.horizonEndFrom(policy, now.localDate);

    const busyWrites: BusyWrite[] = [];
    const seats: Seat[] = [];
    /** Every sold span so far, whose, and which seat — "one person, one chair". */
    const seated: SeatedSpan[] = [];
    const standingSpans: SeatedSpan[] = [];
    for (let i = 0; i < context.standing.length; i++) {
      const stood = context.standing[i] as DecisionStandingSeat;
      const end = EndMinute.after(stood.startMinutes, stood.durationMinutes);
      // A stored seat never ran past its shop day (F-6); one that would is
      // judged as ending at midnight, which is all of that day it holds.
      standingSpans.push({
        seatId: stood.seatId,
        personKey: GuestLabelSystem.personKeyOf(stood.subject),
        startMinutes: stood.startMinutes,
        endMinutes: end.ok ? end.value : endOf(1440),
      });
    }
    const standing = SeatingRuleSystem.union(
      SeatingRuleSystem.standingOf(standingSpans),
      SeatingRuleSystem.ofPairs(context.stood),
    );
    const memo = new Map<string, PlacementFacts>();

    for (let index = 0; index < request.seats.length; index++) {
      const requested = request.seats[index] as BookingCall.SeatInput;
      const override = StaffTermsOverride.find(
        context.termsOverrides,
        requested.lineId,
      );
      const admitted = admission.value[index] as AdmittedSeat;

      // Foreign ids through their smart constructors (Law 7.4): blank, or
      // naming a nested document, is no barber or service.
      const parsedBarber = BarberId.parse(requested.barberId);
      const parsedService = ServiceId.parse(requested.serviceId);
      if (!parsedBarber.ok || !parsedService.ok) {
        return Result.err(BookingError.invalidInput('seat identifiers'));
      }
      const barberId = parsedBarber.value;
      const serviceId = parsedService.value;
      const start =
        requested.startMinutes === null
          ? null
          : MinuteOfDay.of(requested.startMinutes);
      if (start === null || !start.ok || !day.ok) {
        return Result.err(BookingError.invalidInput('startMinutes'));
      }
      const localDate = day.value;
      const startMinutes = start.value;

      if (!placement.allowOutsideWindow && !placement.skipMinNotice) {
        const floor = AvailabilitySystem.leadFloor(now, policy, localDate);
        if (floor === null || startMinutes < floor) {
          return Result.err(BookingError.tooSoon(policy.minLeadMinutes));
        }
      }

      if (!placement.allowOutsideWindow && horizonEnd < localDate) {
        return Result.err(BookingError.beyondHorizon(policy.horizonMonths));
      }

      // SERVER-RESOLVED terms — the whole point of the round trip.
      const catalogTerms =
        admitted.service === null
          ? null
          : OfferingPriceSystem.termsFor(
              admitted.service,
              barberId,
              admitted.variantId,
            );
      const resolved = resolveTerms(catalogTerms, override);
      if (!resolved.ok) return resolved;

      const occupant = toOccupant(
        requested.subject,
        owner,
        context.customerIds,
      );
      if (!occupant.ok) return occupant;

      const rawSeatId = context.nextId();
      if (isBlank(rawSeatId)) {
        return Result.err(BookingError.invalidInput('seatId'));
      }

      // One shop day per appointment (F-6): a SOLD service that would run
      // past midnight has no window to sit in — the client's refusal is the
      // slot's; the shop's own placement learns it broke the visit's day.
      const soldEnd = EndMinute.after(
        startMinutes,
        resolved.value.terms.durationMinutes,
      );
      if (!soldEnd.ok) {
        return Result.err(
          placement.allowOutsideWindow
            ? BookingError.invariantViolated([])
            : BookingError.slotUnavailable(
                barberId,
                localDate,
                startMinutes,
                index,
              ),
        );
      }

      const seat = Seat.compose(
        {
          seatId: SeatId.of(rawSeatId),
          serviceId,
          variantId: admitted.variantId,
          barberId,
          barberPreference: requested.barberPreference,
          startMinutes,
          tipCents: null,
        },
        Seat.termsOf(resolved.value.terms, resolved.value.provenance),
        occupant.value,
        SeatOutcome.scheduled(),
      );
      seats.push(seat);

      // ONE PERSON, ONE CHAIR AT A TIME — on the SOLD minutes, on every
      // path, the shop's included. Only a NEW overlap is refused.
      const sold: SeatedSpan = {
        seatId: seat.seatId,
        personKey: GuestLabelSystem.personKeyOf(requested.subject),
        startMinutes,
        endMinutes: soldEnd.value,
      };
      if (SeatingRuleSystem.seatsTwiceAnew(standing, seated, sold)) {
        return Result.err(BookingError.personDoubleBooked(sold.personKey));
      }
      seated.push(sold);

      // The chair is held for setup + service + cleanup (clipped to the shop
      // day); the client is sold the service alone. Placement is checked
      // against the former.
      const occupied = Seat.chairTime(seat);
      const key = BusyKey.of(barberId, localDate);
      let facts = memo.get(key);
      const schedule = findSchedule(snapshot.schedules, barberId);
      if (facts === undefined) {
        facts = placementFacts(
          barberId,
          locationId,
          localDate,
          schedule,
          snapshot,
          release,
          placement,
        );
        memo.set(key, facts);
      }

      if (!placement.allowOutsideWindow) {
        if (schedule === null || facts.windows === null) {
          return Result.err(
            BookingError.barberNotRostered(barberId, localDate),
          );
        }
        let inAWindow = false;
        for (let w = 0; w < facts.windows.length; w++) {
          if (MinuteRange.contains(facts.windows[w] as MinuteRange, occupied)) {
            inAWindow = true;
            break;
          }
        }
        if (!inAWindow) {
          // Rostered that day, but not for this span — the recoverable code:
          // re-picking from a fresh grid is the fix.
          return Result.err(
            BookingError.slotUnavailable(
              barberId,
              localDate,
              startMinutes,
              index,
            ),
          );
        }
      }

      if (!placement.allowOverlap) {
        for (let t = 0; t < facts.taken.length; t++) {
          if (MinuteRange.overlaps(facts.taken[t] as MinuteRange, occupied)) {
            return Result.err(
              BookingError.slotUnavailable(
                barberId,
                localDate,
                startMinutes,
                index,
              ),
            );
          }
        }
      }

      // The projection records what is actually taken, pads included.
      busyWrites.push({
        barberId,
        localDate,
        startMinutes: startOf(occupied.startMinutes),
        endMinutes: endOf(occupied.endMinutes),
      });
    }

    // The contact is validated with the rest of the request: absent is
    // allowed, present-and-broken is not.
    let contact: BookingContact = BookingContact.NONE;
    if (request.contact !== null) {
      const parsed = BookingContact.create(request.contact, context.parsePhone);
      if (!parsed.ok) {
        return Result.err(BookingError.invalidInput('contact'));
      }
      contact = parsed.value;
    }

    // The FUTURE-START invariant of a booking being made; the shop's own
    // placement skips it (the party may be in the chair already). Compared
    // on the shop's wall clock: (day, minute) after (today, now's minute).
    const first = seats[0];
    if (!placement.allowOutsideWindow && first !== undefined && day.ok) {
      let earliest: MinuteOfDay = first.startMinutes;
      for (let i = 1; i < seats.length; i++) {
        const seatStart = (seats[i] as Seat).startMinutes;
        if (seatStart < earliest) earliest = seatStart;
      }
      const ahead =
        day.value > now.localDate ||
        (day.value === now.localDate && earliest > now.currentMinute);
      if (!ahead) {
        return Result.err(
          BookingError.invariantViolated([
            SchedulingError.appointmentPastStartTime(),
          ]),
        );
      }
    }

    // The client's attempt id is FOREIGN input — it becomes the document id,
    // so it is parsed (Law 7.4); a minted one is an id by construction.
    const rawId = request.attemptId ?? context.nextId();
    const violations: SchedulingError[] = [];
    if (isBlank(rawId)) {
      violations.push(SchedulingError.idEmpty('AppointmentId'));
    } else if (
      request.attemptId !== null &&
      !AppointmentId.parse(request.attemptId).ok
    ) {
      return Result.err(BookingError.invalidInput('attemptId'));
    }
    violations.push(...Seat.violations(seats));
    if (violations.length > 0 || first === undefined || !day.ok) {
      // Where a party's own seats colliding on one barber is caught, and
      // where a mixed-currency cart dies.
      return Result.err(BookingError.invariantViolated(violations));
    }

    // Auto-confirm (owner ruling 2026-08-07): acceptance is tenant policy,
    // applied where a booking comes into existence. The shop's own placement
    // confirms — it has already accepted it.
    const lifecycle =
      policy.autoConfirm || placement.allowOutsideWindow
        ? BookingLifecycle.confirm(now.utcEpochMs)
        : BookingLifecycle.pending(now.utcEpochMs);

    // A rebooking link that is no id is dropped, not fatal — `null` already
    // means "we don't know" (foreign input, parsed — Law 7.4).
    const bookedFromId =
      request.bookedFromAppointmentId === null
        ? null
        : AppointmentId.parse(request.bookedFromAppointmentId);
    const bookedFrom =
      bookedFromId === null || !bookedFromId.ok ? null : bookedFromId.value;

    const draft: Appointment = {
      id: AppointmentId.of(rawId),
      locationId,
      ownerUserId: null,
      subjectUserIds: [],
      ownerCustomerId: null,
      subjectCustomerIds: [],
      placement: request.placement,
      inferredPlacement: null,
      barberIds: [],
      busyKeys: [],
      seats,
      bookedFromAppointmentId: bookedFrom,
      discounts: [],
      voucherRedemptions: [],
      revision: 0,
      appliedOperations: [],
      localDate: day.value,
      startMinutes: first.startMinutes,
      endMinutes: Seat.endMinutes(first),
      utcEpochMs: context.startUtcMs,
      ...lifecycle,
      ...contact,
      bookedAtUtcMs: now.utcEpochMs,
      arrivedAtUtcMs: null,
      stoodSeatPairsRevision: null,
      stoodSeatPairs: [],
    };
    return Result.ok({
      appointment: AppointmentIndexSystem.withQueryKeys(draft),
      busyWrites,
    });
  },
} as const;

/**
 * Is this barber placeable on this shop day — the windows, narrowed to the
 * shop being booked (a barber's Mladost afternoon is somebody else's
 * capacity), `null` when the barber has no roster or none that day; and what
 * is taken, padded by the barber's turnaround by the ONE rule the grid reads
 * by (`AvailabilitySystem.paddedBusy`), a rebuilt visit's own chairs handed
 * back first. A barber with no roster has no declared turnaround: zero.
 */
function placementFacts(
  barberId: BarberId,
  locationId: LocationId,
  localDate: LocalDate,
  schedule: DecisionSchedule | null,
  snapshot: BookingSnapshot,
  release: readonly ChairTime[],
  placement: PlacementPolicy,
): PlacementFacts {
  let windows: readonly MinuteRange[] | null = null;
  if (schedule !== null && !placement.allowOutsideWindow) {
    const exception = findException(snapshot.exceptions, barberId, localDate);
    const rostered = RosterSystem.windowsAt(
      RosterSystem.buildDayWindows({
        barberId,
        localDate,
        versions: schedule.versions,
        exceptions: exception === null ? [] : [exception],
        shopHours: [
          {
            locationId,
            hours: RosterSystem.shopDayHours(snapshot.shopHours, localDate),
          },
        ],
      }),
      locationId,
    );
    // Roster windows ARE minute ranges of the day.
    windows = rostered.length === 0 ? null : rostered;
  }
  const taken = placement.allowOverlap
    ? []
    : AvailabilitySystem.paddedBusy({
        barberId,
        spans: busySpans(snapshot.busy, BusyKey.of(barberId, localDate)),
        turnaroundMinutes:
          schedule === null ? MinuteCount.ZERO : schedule.turnaroundMinutes,
        release,
      });
  return { windows, taken };
}
