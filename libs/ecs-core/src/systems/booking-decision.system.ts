import type { BarberPrefKind } from '../components/barber-pref.data';
import {
  BookingCommitError,
  ShopUnavailableReason,
} from '../components/booking-commit-errors.data';
import { BookingContact } from '../components/booking-contact.data';
import { BookingPolicy } from '../components/booking-policy.data';
import { BookingStatus } from '../components/booking-status.data';
import { BusyKey } from '../components/busy-key.data';
import type { DayKey } from '../components/day-key.data';
import { DayOffset } from '../components/day-offset.data';
import type { DayHours } from '../components/opening-hours.data';
import type { E164 } from '../components/phone-number.data';
import type { PlacementKind } from '../components/placement-kind.data';
import {
  type PlacementPolicy,
  StaffTermsOverride,
} from '../components/placement-policy.data';
import { Result } from '../components/result.data';
import type { ScheduleVersion } from '../components/schedule-version.data';
import { SchedulingError } from '../components/scheduling-errors.data';
import type { SeatIdPair } from '../components/seat-id-pair.data';
import { SeatLabel } from '../components/seat-label.data';
import { SeatOutcome } from '../components/seat-outcome.data';
import {
  Seat,
  SeatId,
  SeatRelationship,
  SeatSubject,
} from '../components/seat.data';
import { ServiceTerms } from '../components/service-terms.data';
import { TimeInterval } from '../components/time-interval.data';
import {
  AppointmentId,
  type AppointmentEntity,
} from '../entities/appointment.entity';
import { BarberId } from '../entities/barber.entity';
import { LocationId } from '../entities/location.entity';
import type { ScheduleExceptionEntity } from '../entities/schedule-exception.entity';
import { type ServiceEntity, ServiceId } from '../entities/service.entity';
import { UserId } from '../entities/user.entity';
import { AppointmentIndexSystem } from './appointment-index.system';
import { AvailabilitySystem, type ChairTime } from './availability.system';
import {
  GuestLabelSystem,
  type RequestedSubject,
  RequestedSubjectKind,
} from './guest-label.system';
import { OfferingPriceSystem } from './offering-price.system';
import {
  type AdmissionSeat,
  type AdmittedSeat,
  PartyAdmissionSystem,
} from './party-admission.system';
import { RosterSystem } from './roster.system';
import { type SeatedSpan, SeatingRuleSystem } from './seating-rule.system';
import { ZonedTimeSystem } from './zoned-time.system';

const MS_PER_MINUTE = 60_000;

/**
 * One seat as the client asked for it (`decide-booking.ts:60-100`). The ids
 * are the raw request strings; `startMs` is the requested start as an
 * instant, `null` when the payload's start did not parse — refused
 * (`invalid_input: startIso`) at the point the commit always refused it.
 * `barberPref` is what the client ASKED for; `null` is stored as unknown,
 * never guessed.
 */
export type RequestedSeat = {
  readonly lineId: string;
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly barberId: string;
  readonly barberPref: BarberPrefKind | null;
  readonly startMs: number | null;
  readonly subject: RequestedSubject;
};

/**
 * What a commit asks for (`decide-booking.ts:102-153`), every field present:
 * `attemptId` (used verbatim as the appointment id — a retry finds its own
 * booking), the rebooking edge (an analytics edge, no authority), the
 * contact snapshot, and who is placing it (stamped on the new document,
 * never read by the decision).
 */
export type DecideBookingRequest = {
  readonly locationId: string;
  readonly seats: readonly RequestedSeat[];
  readonly attemptId: string | null;
  readonly bookedFromAppointmentId: string | null;
  readonly contact: BookingContact.Input | null;
  readonly placement: PlacementKind | null;
};

/** One barber's roster as loaded from `barberSchedules/{barberId}`. */
export type DecisionSchedule = {
  readonly barberId: BarberId;
  readonly versions: readonly ScheduleVersion[];
  readonly turnaroundMinutes: number;
};

/** One busy day as the projection stores it — UNPADDED instants. */
export type DecisionBusyDay = {
  readonly id: BusyKey;
  readonly spans: readonly TimeInterval[];
};

/** A published exception, as the commit reads it by `BusyKey`. */
export type DecisionException = Pick<
  ScheduleExceptionEntity,
  'barberId' | 'dayKey' | 'effect'
>;

/**
 * Everything the decision reads, loaded INSIDE the transaction so the commit
 * fails rather than races if any of it changes underneath
 * (`decide-booking.ts:163-198`). `shopHours` is the shop's Mon-first week
 * (not seven entries: the shop publishes none). A barber with no schedule
 * entry has no roster.
 */
export type BookingSnapshot = {
  readonly zone: string;
  readonly shopHours: readonly DayHours[];
  readonly services: readonly ServiceEntity[];
  readonly schedules: readonly DecisionSchedule[];
  readonly busy: readonly DecisionBusyDay[];
  readonly exceptions: readonly DecisionException[];
};

/**
 * One seat of a visit as it STANDS before a rebuild
 * (`decide-booking.ts:237-243`): its id, who sits in it, and the minutes
 * they were sold. A rebuilt seat minted with a standing seat's id IS that
 * seat.
 */
export type DecisionStandingSeat = {
  readonly id: string;
  readonly subject: RequestedSubject;
  readonly startMs: number;
  readonly durationMinutes: number;
};

/**
 * The decision's context (`DecideBookingDeps`): the transaction's clock and
 * id mint, the zone table (covering today, every requested day and the
 * horizon), the VERIFIED owner (`null`: a walk-in the shop entered itself),
 * the staff term overrides, the visit as it stands and the pairs its last
 * save broke (both `[]` on a commit), and the edge's phone parser.
 */
export type DecideBookingContext = {
  readonly nowMs: number;
  readonly nextId: () => string;
  readonly days: readonly DayOffset[];
  readonly ownerUserId: string | null;
  readonly termsOverrides: readonly StaffTermsOverride[];
  readonly standing: readonly DecisionStandingSeat[];
  readonly stood: readonly SeatIdPair[];
  readonly parsePhone: (raw: string) => E164 | null;
};

/** A span to add to one barber's public busy projection. */
export type BusyWrite = {
  readonly barberId: BarberId;
  readonly dayKey: DayKey;
  readonly interval: TimeInterval;
};

/** The appointment draft and the spans it claims. */
export type BookingDecision = {
  readonly appointment: AppointmentEntity;
  readonly busyWrites: readonly BusyWrite[];
};

/* ── helpers ──────────────────────────────────────────────────────────── */

function isBlank(raw: string): boolean {
  return raw.trim().length === 0;
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
  dayKey: DayKey,
): DecisionException | null {
  for (let i = 0; i < exceptions.length; i++) {
    const exception = exceptions[i] as DecisionException;
    if (exception.barberId === barberId && exception.dayKey === dayKey) {
      return exception;
    }
  }
  return null;
}

function busySpans(
  busy: readonly DecisionBusyDay[],
  key: BusyKey,
): readonly TimeInterval[] {
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
 * booking whose service has since retired.
 */
function resolveTerms(
  catalog: ServiceTerms | null,
  override: StaffTermsOverride | null,
): Result<ResolvedTerms, BookingCommitError> {
  if (override === null) {
    if (catalog === null) {
      return Result.err(BookingCommitError.invalidInput('terms'));
    }
    return Result.ok({ terms: catalog, provenance: null });
  }

  const currencyCode =
    override.currencyCode ?? (catalog === null ? '' : catalog.currencyCode);
  const minorUnits =
    override.priceMinorUnits ??
    (catalog === null ? null : catalog.priceMinorUnits);
  const durationMinutes =
    override.durationMinutes ??
    (catalog === null ? null : catalog.durationMinutes);
  if (minorUnits === null || durationMinutes === null) {
    return Result.err(BookingCommitError.invalidInput('terms'));
  }
  // A carried price is HISTORY, not a new figure: it keeps the currency it
  // was stored in, as the legacy kernel read it, instead of being narrowed
  // to the shop's own `Currency` — a pre-2026 seat priced in leva rebuilds
  // in leva (a visit mixing currencies is still refused by `Seat.violations`).
  const currency = storedCurrencyOf(currencyCode);
  if (currency === null || !Number.isInteger(minorUnits) || minorUnits < 0) {
    return Result.err(BookingCommitError.invalidInput('priceMinorUnits'));
  }
  // Padding is chair geometry, not a price: whichever answer the caller
  // carried forward is the one the busy projection was drawn from.
  const setupMinutes =
    override.setupMinutes ?? (catalog === null ? 0 : catalog.setupMinutes);
  const cleanupMinutes =
    override.cleanupMinutes ?? (catalog === null ? 0 : catalog.cleanupMinutes);
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes <= 0 ||
    !isPad(setupMinutes) ||
    !isPad(cleanupMinutes)
  ) {
    return Result.err(BookingCommitError.invalidInput('durationMinutes'));
  }
  const terms = ServiceTerms.of(
    minorUnits + 0,
    currency,
    durationMinutes,
    setupMinutes,
    cleanupMinutes,
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
 * The codes a STORED price may carry — the legacy kernel's curated list
 * (`money.ts` `CURRENCIES_BY_CODE`), wider than the shop's own `Currency`
 * (EUR only) because carried terms are history.
 */
const StoredCurrency = {
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  BGN: 'BGN',
} as const;
type StoredCurrency = (typeof StoredCurrency)[keyof typeof StoredCurrency];
const STORED_CURRENCIES: readonly StoredCurrency[] =
  Object.values(StoredCurrency);

/** The stored currency a raw code names (case-insensitive, as the kernel read it), or `null`. */
function storedCurrencyOf(code: string): StoredCurrency | null {
  const upper = code.toUpperCase();
  for (let i = 0; i < STORED_CURRENCIES.length; i++) {
    const currency = STORED_CURRENCIES[i] as StoredCurrency;
    if (currency === upper) return currency;
  }
  return null;
}

/** A pad is a non-negative whole number of minutes (`ServiceTerms.parse`). */
function isPad(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 0;
}

/**
 * The seat's subject (`decide-booking.ts:860-890`): `self` is bound to the
 * TOKEN — refused outright with no owner, because the self seat IS the
 * owner's seat; a companion is only ever a stored person carried forward; a
 * guest is their label.
 */
function toSubject(
  subject: RequestedSubject,
  owner: UserId | null,
): Result<SeatSubject, BookingCommitError> {
  if (subject.kind === RequestedSubjectKind.Self) {
    if (owner === null) {
      return Result.err(BookingCommitError.invalidInput('ownerUserId'));
    }
    return Result.ok(SeatSubject.account(owner, SeatRelationship.Self));
  }
  if (subject.kind === RequestedSubjectKind.Companion) {
    if (isBlank(subject.userId)) {
      return Result.err(BookingCommitError.invalidInput('companion'));
    }
    return Result.ok(
      SeatSubject.account(
        UserId.of(subject.userId),
        SeatRelationship.Companion,
      ),
    );
  }
  const label = SeatLabel.parse(subject.label);
  if (!label.ok) {
    return Result.err(BookingCommitError.invalidInput('guest label'));
  }
  return Result.ok(SeatSubject.anonymous(label.value));
}

/** Per (barber, day), the bookable windows and the padded busy — memoized within ONE call. */
type PlacementFacts = {
  readonly windows: readonly TimeInterval[] | null;
  readonly taken: readonly TimeInterval[];
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
 * The windows and the padded busy of each `(barber, day)` are computed once
 * per call (hot path #4) and never cached across calls: the memo lives and
 * dies inside `decide`, so a transaction retry recomputes from its fresh
 * read. The availability engine is never run.
 */
export const BookingDecisionSystem = {
  decide(
    request: DecideBookingRequest,
    snapshot: BookingSnapshot,
    policy: BookingPolicy,
    placement: PlacementPolicy,
    release: readonly ChairTime[],
    context: DecideBookingContext,
  ): Result<BookingDecision, BookingCommitError> {
    // A blank id names no shop: the one "no usable shop" answer.
    if (isBlank(request.locationId)) {
      return Result.err(
        BookingCommitError.shopUnavailable(
          request.locationId,
          ShopUnavailableReason.NotFound,
        ),
      );
    }
    const locationId = LocationId.of(request.locationId);

    // A walk-in the shop entered itself has no owner at all; a `self` seat
    // without one is still refused below.
    let owner: UserId | null = null;
    if (context.ownerUserId !== null) {
      if (isBlank(context.ownerUserId)) {
        return Result.err(BookingCommitError.invalidInput('ownerUserId'));
      }
      owner = UserId.of(context.ownerUserId);
    }

    // Two guests the client tells apart must not share a label — asked
    // before anything counts people, by the party's own rule.
    const subjects: RequestedSubject[] = [];
    for (let i = 0; i < request.seats.length; i++) {
      subjects.push((request.seats[i] as RequestedSeat).subject);
    }
    const sharedLabel = GuestLabelSystem.sharedLabel(subjects);
    if (sharedLabel !== null) {
      return Result.err(BookingCommitError.duplicateGuestLabel(sharedLabel));
    }

    // EVERY REFUSAL THAT DOES NOT DEPEND ON THE TIME, in one place. A seat
    // whose terms staff fixed is CARRIED: it survives its service retiring
    // or gaining variants since it was booked.
    const admissionSeats: AdmissionSeat[] = [];
    for (let i = 0; i < request.seats.length; i++) {
      const seat = request.seats[i] as RequestedSeat;
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

    const notBeforeMs = AvailabilitySystem.leadFloorMs(context.nowMs, policy);
    const today = ZonedTimeSystem.dayKeyOf(context.nowMs, context.days);
    const horizonEnd =
      today === null ? null : BookingPolicy.horizonEndFrom(policy, today);

    const busyWrites: BusyWrite[] = [];
    const seats: Seat[] = [];
    /** Every sold span so far, whose, and which seat — "one person, one chair". */
    const seated: SeatedSpan[] = [];
    const standingSpans: SeatedSpan[] = [];
    for (let i = 0; i < context.standing.length; i++) {
      const stood = context.standing[i] as DecisionStandingSeat;
      standingSpans.push({
        seatId: SeatId.of(stood.id),
        personKey: GuestLabelSystem.personKeyOf(stood.subject),
        startMs: stood.startMs,
        endMs: stood.startMs + stood.durationMinutes * MS_PER_MINUTE,
      });
    }
    const standing = SeatingRuleSystem.union(
      SeatingRuleSystem.standingOf(standingSpans),
      SeatingRuleSystem.ofPairs(context.stood),
    );
    const memo = new Map<string, PlacementFacts>();

    for (let index = 0; index < request.seats.length; index++) {
      const requested = request.seats[index] as RequestedSeat;
      const override = StaffTermsOverride.find(
        context.termsOverrides,
        requested.lineId,
      );
      const admitted = admission.value[index] as AdmittedSeat;

      if (isBlank(requested.barberId) || isBlank(requested.serviceId)) {
        return Result.err(BookingCommitError.invalidInput('seat identifiers'));
      }
      const barberId = BarberId.of(requested.barberId);
      const startMs = requested.startMs;
      if (startMs === null) {
        return Result.err(BookingCommitError.invalidInput('startIso'));
      }

      if (
        !placement.allowOutsideWindow &&
        !placement.skipMinNotice &&
        startMs < notBeforeMs
      ) {
        return Result.err(BookingCommitError.tooSoon(policy.minLeadMinutes));
      }

      const dayKey = ZonedTimeSystem.dayKeyOf(startMs, context.days);
      const day = dayKey === null ? null : DayOffset.find(dayKey, context.days);
      // A day the table does not cover cannot be placed: fail closed.
      if (dayKey === null || day === null) {
        return Result.err(BookingCommitError.invalidInput('startIso'));
      }
      if (
        !placement.allowOutsideWindow &&
        (horizonEnd === null || horizonEnd < dayKey)
      ) {
        return Result.err(
          BookingCommitError.beyondHorizon(policy.horizonMonths),
        );
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

      const subject = toSubject(requested.subject, owner);
      if (!subject.ok) return subject;

      const rawSeatId = context.nextId();
      if (isBlank(rawSeatId)) {
        return Result.err(BookingCommitError.invalidInput('seatId'));
      }

      const seat: Seat = {
        id: SeatId.of(rawSeatId),
        serviceId: ServiceId.of(requested.serviceId),
        variantId: admitted.variantId,
        barberId,
        barberPref: requested.barberPref,
        terms: Seat.termsOf(resolved.value.terms, resolved.value.provenance),
        startMs,
        subject: subject.value,
        outcome: SeatOutcome.scheduled(),
        tip: null,
      };
      seats.push(seat);

      // ONE PERSON, ONE CHAIR AT A TIME — on the SOLD minutes, on every
      // path, the shop's included. Only a NEW overlap is refused.
      const sold: SeatedSpan = {
        seatId: seat.id,
        personKey: GuestLabelSystem.personKeyOf(requested.subject),
        startMs,
        endMs: Seat.endMs(seat),
      };
      if (SeatingRuleSystem.seatsTwiceAnew(standing, seated, sold)) {
        return Result.err(
          BookingCommitError.personDoubleBooked(sold.personKey),
        );
      }
      seated.push(sold);

      // The chair is held for setup + service + cleanup; the client is
      // sold the service alone. Placement is checked against the former.
      const occupied = Seat.chairTime(seat);
      const key = BusyKey.of(barberId, dayKey);
      let facts = memo.get(key);
      const schedule = findSchedule(snapshot.schedules, barberId);
      if (facts === undefined) {
        facts = placementFacts(
          barberId,
          locationId,
          day,
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
            BookingCommitError.barberNotRostered(barberId, dayKey),
          );
        }
        let inAWindow = false;
        for (let w = 0; w < facts.windows.length; w++) {
          if (
            TimeInterval.contains(facts.windows[w] as TimeInterval, occupied)
          ) {
            inAWindow = true;
            break;
          }
        }
        if (!inAWindow) {
          // Rostered that day, but not for this span — the recoverable code:
          // re-picking from a fresh grid is the fix.
          return Result.err(
            BookingCommitError.slotUnavailable(barberId, startMs, index),
          );
        }
      }

      if (!placement.allowOverlap) {
        for (let t = 0; t < facts.taken.length; t++) {
          if (TimeInterval.overlaps(facts.taken[t] as TimeInterval, occupied)) {
            return Result.err(
              BookingCommitError.slotUnavailable(barberId, startMs, index),
            );
          }
        }
      }

      // The projection records what is actually taken, pads included.
      busyWrites.push({ barberId, dayKey, interval: occupied });
    }

    // The contact is validated with the rest of the request: absent is
    // allowed, present-and-broken is not.
    let contact: BookingContact | null = null;
    if (request.contact !== null) {
      const parsed = BookingContact.create(request.contact, context.parsePhone);
      if (!parsed.ok) {
        return Result.err(BookingCommitError.invalidInput('contact'));
      }
      contact = parsed.value;
    }

    // The FUTURE-START invariant of a booking being made; the shop's own
    // placement skips it (the party may be in the chair already).
    if (!placement.allowOutsideWindow) {
      let earliest = Number.POSITIVE_INFINITY;
      for (let i = 0; i < seats.length; i++) {
        const startMs = (seats[i] as Seat).startMs;
        if (startMs < earliest) earliest = startMs;
      }
      if (seats.length > 0 && !(earliest > context.nowMs)) {
        return Result.err(
          BookingCommitError.invariantViolated([
            SchedulingError.appointmentPastStartTime(),
          ]),
        );
      }
    }

    const rawId = request.attemptId ?? context.nextId();
    const violations: SchedulingError[] = [];
    if (isBlank(rawId))
      violations.push(SchedulingError.idEmpty('AppointmentId'));
    violations.push(...Seat.violations(seats));
    if (violations.length > 0) {
      // Where a party's own seats colliding on one barber is caught, and
      // where a mixed-currency cart dies.
      return Result.err(BookingCommitError.invariantViolated(violations));
    }

    // Auto-confirm (owner ruling 2026-08-07): acceptance is tenant policy,
    // applied where a booking comes into existence. The shop's own placement
    // confirms — it has already accepted it.
    const bookingStatus =
      policy.autoConfirm || placement.allowOutsideWindow
        ? BookingStatus.confirm(context.nowMs)
        : BookingStatus.pending(context.nowMs);

    const bookedFrom =
      request.bookedFromAppointmentId === null ||
      isBlank(request.bookedFromAppointmentId)
        ? null
        : AppointmentId.of(request.bookedFromAppointmentId);

    const draft: AppointmentEntity = {
      id: AppointmentId.of(rawId),
      locationId,
      ownerUserId: null,
      subjectUserIds: [],
      placement: request.placement,
      inferredPlacement: null,
      barberIds: [],
      busyKeys: [],
      timeInterval: TimeInterval.of(context.nowMs, context.nowMs),
      zone: snapshot.zone,
      bookingStatus,
      seats,
      contact,
      bookedAtMs: context.nowMs,
      arrivedAtMs: null,
      bookedFromAppointmentId: bookedFrom,
      discounts: [],
      voucherRedemptions: [],
      revision: 0,
      appliedOperations: [],
      stoodSeatPairs: null,
    };
    return Result.ok({
      appointment: AppointmentIndexSystem.withQueryKeys(draft, context.days),
      busyWrites,
    });
  },
} as const;

/**
 * Is this barber placeable on this day — the windows, narrowed to the shop
 * being booked (a barber's Mladost afternoon is somebody else's capacity),
 * `null` when the barber has no roster or none that day; and what is taken,
 * padded by the barber's turnaround by the ONE rule the grid reads by
 * (`AvailabilitySystem.paddedBusy`), a rebuilt visit's own chairs handed
 * back first. A barber with no roster has no declared turnaround: zero.
 */
function placementFacts(
  barberId: BarberId,
  locationId: LocationId,
  day: DayOffset,
  schedule: DecisionSchedule | null,
  snapshot: BookingSnapshot,
  release: readonly ChairTime[],
  placement: PlacementPolicy,
): PlacementFacts {
  let windows: readonly TimeInterval[] | null = null;
  if (schedule !== null && !placement.allowOutsideWindow) {
    const exception = findException(snapshot.exceptions, barberId, day.dayKey);
    const rostered = RosterSystem.windowsAt(
      RosterSystem.buildDayWindows(
        {
          barberId,
          dayKey: day.dayKey,
          versions: schedule.versions,
          exceptions: exception === null ? [] : [exception],
          shopHours: [
            {
              locationId,
              hours: RosterSystem.shopDayHours(snapshot.shopHours, day),
            },
          ],
        },
        [day],
      ),
      locationId,
    );
    windows =
      rostered.length === 0 ? null : RosterSystem.intervalsOf(rostered, day);
  }
  const taken = placement.allowOverlap
    ? []
    : AvailabilitySystem.paddedBusy({
        barberId,
        spans: busySpans(snapshot.busy, BusyKey.of(barberId, day.dayKey)),
        turnaroundMinutes: schedule === null ? 0 : schedule.turnaroundMinutes,
        release,
      });
  return { windows, taken };
}
