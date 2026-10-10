import {
  Money,
  Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import {
  BarberId,
  ServiceId,
  ServiceTerms,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import { CouponCombinability, CouponValue } from '@creativo/domain/engagement';
import {
  AppliedDiscount,
  Appointment,
  AppointmentStatus,
  BarberPref,
  BookingContact,
  CancellationReason,
  CancellationWindow,
  type ChairTime,
  Interval,
  SEAT_SCHEDULED,
  Seat,
  SeatId,
  SeatLabel,
  type SeatIdPair,
  type SeatRelationship,
  SeatOutcome,
  SeatSubject,
  TimeSlot,
  VoucherRedemption,
} from '@creativo/domain/scheduling';
import { RepositoryError } from '@creativo/application/shared';
import {
  AppointmentIndexSystem,
  BarberId as EcsBarberId,
  BusyKey,
  BusySystem,
  DayKey as EcsDayKey,
  type DayOffset,
  type IndexedSeat,
  Seat as EcsSeat,
  SeatId as EcsSeatId,
  SeatLabel as EcsSeatLabel,
  SeatOutcome as EcsSeatOutcome,
  ServiceId as EcsServiceId,
  SeatSubject as EcsSeatSubject,
  UserId as EcsUserId,
  ZonedTimeSystem,
} from '@creativo/ecs-core';

/**
 * The persisted shape of an appointment, and of the public busy projection —
 * defined HERE, in the port layer, because two different SDKs write them.
 *
 * The browser reads appointments through `firebase/firestore`; the
 * `commitBooking` function writes them through `firebase-admin`. Neither may
 * import the other's adapter, so without a shared definition the shape would
 * exist twice and drift on the first field either side added. This module
 * imports no SDK at all — it is plain objects both can produce.
 */
export type PersistedDocument = Record<string, unknown>;

/** A slot as stored: wall-clock ISO plus the zone that makes it meaningful. */
export interface PersistedSlot {
  readonly startIso: string;
  readonly endIso: string;
  readonly zone: string;
}

/**
 * Who put the booking in the book (R33): the client themselves, or the shop
 * on their behalf. Stamped once at commit and carried through every later
 * write, because nothing about the seats can say it afterwards. `null` is a
 * row from before the field, which nobody may read as either.
 *
 * The stored `placement` field is the COMMIT'S OWN stamp and nothing else's.
 * It is therefore also the mark of a row whose seat preferences the P0
 * commit path recorded — an omitted preference stored as unknown, never as
 * the old defaulted `specific` — which is what lets the preferred barber
 * (§11.2 #6) take its `specific` seats as a request. An answer reconstructed
 * later, from the audit trail, lives in `inferredPlacement` instead (see
 * `inferredPlacementFromDocument`), so no inference can ever pass for it.
 */
export type AppointmentPlacement = 'self' | 'staff';

/** What a write knows that the aggregate does not carry. */
export interface AppointmentWriteContext {
  /** The commit path's answer, or the stored one on every later write. */
  readonly placement?: AppointmentPlacement | null;
}

/**
 * Appointment → document.
 *
 * `barberIds`, `subjectUserIds` and the top-level `timeSlot` are QUERY
 * MIRRORS, not truth. The seats are the truth and all three are recomputed on
 * read, so a corrupt mirror cannot change what an appointment says — only
 * which queries find it.
 */
export function appointmentToDocument(
  appointment: Appointment,
  context: AppointmentWriteContext = {},
): PersistedDocument {
  return {
    locationId: appointment.locationId.value,
    ownerUserId: ownerUserIdOf(appointment),
    // Every PERSON on the visit, not only the booker — a companion's visits
    // are invisible to an `ownerUserId` query. One array behind one index is
    // what lets the stats trigger read a client's whole history (R33).
    subjectUserIds: subjectUserIdsOf(appointment),
    placement: context.placement ?? null,
    barberIds: AppointmentIndexSystem.queryKeys(indexedSeatsOf(appointment), [])
      .barberIds,
    // The (barber, day) projection docs this appointment occupies — the
    // rebuild trigger's reverse index. `array-contains` on this plus a
    // status filter is what lets one cancelled booking recompute exactly
    // the busy docs it touched, instead of scanning the collection.
    busyKeys: busyKeysOf(appointment),
    timeSlot: {
      startIso: appointment.timeSlot.start.toISO(),
      endIso: appointment.timeSlot.end.toISO(),
      zone: appointment.timeSlot.start.zoneName,
    },
    seats: appointment.seats.map((seat) => ({
      id: seat.id.value,
      serviceId: seat.serviceId.value,
      variantId: seat.variantId?.value ?? null,
      barberId: seat.barberId.value,
      // WHAT THEY ASKED FOR, beside what they got. `null` for rows written
      // before the field existed — never silently read as `any`, because
      // "anyone will do" is exactly the permission this flag grants.
      barberPref: seat.pref === null ? null : seat.pref.kind,
      terms: {
        priceMinorUnits: seat.terms.price.toMinorUnits(),
        currencyCode: seat.terms.price.currencyCode(),
        durationMinutes: seat.terms.durationMinutes,
        setupMinutes: seat.terms.setupMinutes,
        cleanupMinutes: seat.terms.cleanupMinutes,
        // WHAT THE CATALOGUE SAID, beside what was charged — written only
        // when staff overrode it, `null` otherwise. Without this pair a
        // discounted seat round-trips indistinguishable from a catalogue
        // price: the stored terms are the whole truth, the catalogue row has
        // since moved on, and "how much did we give away last quarter" has no
        // answer left anywhere. It cannot be backfilled, which is why it
        // ships with the first write path that can produce an override.
        catalogPriceMinorUnits: seat.catalogTerms?.price.toMinorUnits() ?? null,
        catalogDurationMinutes: seat.catalogTerms?.durationMinutes ?? null,
      },
      slot: {
        startIso: seat.slot.start.toISO(),
        endIso: seat.slot.end.toISO(),
        zone: seat.slot.start.zoneName,
      },
      subject:
        seat.subject.kind === 'account'
          ? {
              kind: 'account' as const,
              userId: seat.subject.userId.value,
              relationship: seat.subject.relationship,
            }
          : { kind: 'anonymous' as const, label: seat.subject.label.value },
      // What became of THIS person. Written per seat because a party of three
      // has three answers, and the root status can only hold one.
      outcome: seatOutcomeToDocument(seat.outcome),
      // WHAT WAS LEFT FOR THE BARBER, in the seat's own currency.
      //
      // Per seat for the same reason the outcome is: a party can be two
      // barbers, and a tip belongs to whoever did the work. `null` is "not
      // recorded", which a report must be able to tell apart from a genuine
      // zero — so it is written as `null` rather than omitted, and never
      // defaulted to `0`.
      //
      // No currency of its own: a tip is settled in the same money the seat
      // was priced in, and a second currency field could only ever agree
      // with `terms.currencyCode` until the day it did not.
      tipMinorUnits: seat.tip?.toMinorUnits() ?? null,
    })),
    status: appointment.status,
    // WHEN the booking was made. Both halves are stored: the ISO carries the
    // instant (offset included) and the zone lets a staff surface render it in
    // shop time. `null` marks a row written before this field existed — which
    // is also the flag for "this row's timing metrics are not trustworthy",
    // see `seatOutcomeFromDocument`.
    bookedAt: appointment.bookedAt
      ? {
          iso: appointment.bookedAt.toISO(),
          zone: appointment.bookedAt.zoneName,
        }
      : null,
    /** The rebooking edge. Nothing reconstructs this after the fact. */
    bookedFromAppointmentId: appointment.bookedFrom?.value ?? null,
    // WHEN they walked in. Same shape and same reasoning as `bookedAt`: the
    // instant plus the zone, because a staff surface renders it in shop time.
    // `null` is "not yet" — never "on time".
    arrivedAt: appointment.arrivedAt
      ? {
          iso: appointment.arrivedAt.toISO(),
          zone: appointment.arrivedAt.zoneName,
        }
      : null,
    // A SNAPSHOT, deliberately denormalized: the number given for THIS
    // booking is the number the shop dials for it, whatever the profile says
    // two months later. `null` for appointments booked before contacts
    // existed, and for a staff-entered walk-in with nobody to call.
    contact: appointment.contact?.toProps() ?? null,
    // WHAT WAS TAKEN OFF, as snapshots — the value copied at the moment of
    // applying, with the grant or the code kept as provenance and never
    // re-resolved. An empty list is the ordinary full-price visit; it is
    // written rather than omitted so a reader can tell "no discount" from
    // "written before discounts existed".
    discounts: appointment.discounts.map(appliedDiscountToDocument),
    // WHAT VOUCHERS PAID — snapshots too, reversed ones kept as history.
    voucherRedemptions: appointment.voucherRedemptions.map(
      voucherRedemptionToDocument,
    ),
  };
}

/** One voucher draw-down → its stored shape. */
export function voucherRedemptionToDocument(
  redemption: VoucherRedemption,
): Record<string, unknown> {
  return {
    voucherId: redemption.voucherId,
    code: redemption.code,
    amountMinorUnits: redemption.amount.toMinorUnits(),
    balanceAfterMinorUnits: redemption.balanceAfter.toMinorUnits(),
    currencyCode: redemption.amount.currencyCode(),
    appliedAt: {
      iso: redemption.appliedAt.toISO(),
      zone: redemption.appliedAt.zoneName,
    },
    reversedAt:
      redemption.reversedAt === null
        ? null
        : {
            iso: redemption.reversedAt.toISO(),
            zone: redemption.reversedAt.zoneName,
          },
  };
}

/** Document → the voucher draw-downs, best-effort per entry, like the discounts. */
export function voucherRedemptionsFromDocument(
  data: PersistedDocument,
): VoucherRedemption[] {
  const raw = data['voucherRedemptions'];
  if (!Array.isArray(raw)) return [];
  const redemptions: VoucherRedemption[] = [];
  for (const entry of raw) {
    const parsed = voucherRedemptionFromDocument(entry);
    if (parsed !== null) redemptions.push(parsed);
  }
  return redemptions;
}

function voucherRedemptionFromDocument(raw: unknown): VoucherRedemption | null {
  if (raw == null || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const voucherId = entry['voucherId'];
  const code = entry['code'];
  const amount = entry['amountMinorUnits'];
  const after = entry['balanceAfterMinorUnits'];
  const currency = entry['currencyCode'];
  if (typeof voucherId !== 'string' || voucherId.length === 0) return null;
  if (typeof code !== 'string' || code.length === 0) return null;
  if (typeof amount !== 'number' || typeof currency !== 'string') return null;
  const money = Money.fromMinorUnitsAndCode(amount, currency);
  const balance = Money.fromMinorUnitsAndCode(
    typeof after === 'number' ? after : 0,
    currency,
  );
  if (money.isFailure() || balance.isFailure()) return null;
  const appliedAt = zonedFieldFromDocument(entry, 'appliedAt');
  if (appliedAt === null) return null;
  return VoucherRedemption.of({
    voucherId,
    code,
    amount: money.value,
    balanceAfter: balance.value,
    appliedAt,
    reversedAt: zonedFieldFromDocument(entry, 'reversedAt'),
  });
}

/** One applied discount → its stored shape. Same value vocabulary as `coupons/*`. */
export function appliedDiscountToDocument(
  discount: AppliedDiscount,
): Record<string, unknown> {
  return {
    id: discount.id,
    source: discount.source,
    label: discount.label,
    value: couponValueToDocument(discount.value),
    grantId: discount.grantId,
    code: discount.code,
    appliedAt: {
      iso: discount.appliedAt.toISO(),
      zone: discount.appliedAt.zoneName,
    },
    combinability: discount.combinability.kind,
  };
}

function couponValueToDocument(value: CouponValue): Record<string, unknown> {
  switch (value.kind) {
    case 'percent_off':
      return { kind: 'percent_off', percent: value.percent };
    case 'fixed_amount':
      return {
        kind: 'fixed_amount',
        amountMinorUnits: value.amount.toMinorUnits(),
        currencyCode: value.amount.currencyCode(),
      };
    case 'free_service':
      return { kind: 'free_service' };
  }
}

/**
 * Document → the discounts applied, best-effort per entry.
 *
 * A malformed entry is DROPPED rather than failing the appointment: the
 * booking is real and the chair is booked whether or not one line of its
 * bill parses, and the honest reading of a snapshot nobody can interpret is
 * "no discount" — which the receipt then shows at full price, loudly, rather
 * than hiding the whole visit. Absent (rows written before discounts
 * existed) reads as none.
 */
export function discountsFromDocument(
  data: PersistedDocument,
): AppliedDiscount[] {
  const raw = data['discounts'];
  if (!Array.isArray(raw)) return [];
  const discounts: AppliedDiscount[] = [];
  for (const entry of raw) {
    const parsed = appliedDiscountFromDocument(entry);
    if (parsed !== null) discounts.push(parsed);
  }
  return discounts;
}

const DISCOUNT_SOURCES: readonly AppliedDiscount['source'][] = [
  'grant',
  'code',
  'manual',
];

function appliedDiscountFromDocument(raw: unknown): AppliedDiscount | null {
  if (raw == null || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const id = entry['id'];
  const label = entry['label'];
  const source = entry['source'];
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof label !== 'string' || label.length === 0) return null;
  if (!DISCOUNT_SOURCES.includes(source as never)) return null;
  const value = couponValueFromDocument(entry['value']);
  if (value === null) return null;
  const appliedAt = zonedFieldFromDocument(entry, 'appliedAt');
  if (appliedAt === null) return null;
  return AppliedDiscount.of({
    id,
    source: source as AppliedDiscount['source'],
    label,
    value,
    grantId: typeof entry['grantId'] === 'string' ? entry['grantId'] : null,
    code: typeof entry['code'] === 'string' ? entry['code'] : null,
    appliedAt,
    // Absent on rows written before stacking existed: stackable, the
    // permissive reading — the shop's own promise, already kept.
    combinability:
      entry['combinability'] === 'exclusive'
        ? CouponCombinability.exclusive()
        : CouponCombinability.stackable(),
  });
}

/** The stored value → `CouponValue`, through the domain's own validating doors. */
export function couponValueFromDocument(raw: unknown): CouponValue | null {
  if (raw == null || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  switch (value['kind']) {
    case 'percent_off': {
      const percent = value['percent'];
      if (typeof percent !== 'number') return null;
      const result = CouponValue.percentOff(percent);
      return result.isSuccess() ? result.value : null;
    }
    case 'fixed_amount': {
      const amount = value['amountMinorUnits'];
      const currency = value['currencyCode'];
      if (typeof amount !== 'number' || typeof currency !== 'string') {
        return null;
      }
      const money = Money.fromMinorUnitsAndCode(amount, currency);
      if (money.isFailure()) return null;
      const result = CouponValue.fixedAmount(money.value);
      return result.isSuccess() ? result.value : null;
    }
    case 'free_service':
      return CouponValue.freeService();
    default:
      return null;
  }
}

/**
 * Every top-level field `appointmentToDocument` produces.
 *
 * Kept beside the writer so the two cannot drift, and used by
 * `preservedAppointmentFields` below. A field added to the writer without
 * being added here becomes a field a staff edit silently deletes.
 */
export const APPOINTMENT_DOCUMENT_FIELDS: readonly string[] = [
  'locationId',
  'ownerUserId',
  'subjectUserIds',
  'placement',
  'barberIds',
  'busyKeys',
  'timeSlot',
  'seats',
  'status',
  'bookedAt',
  'bookedFromAppointmentId',
  'arrivedAt',
  'contact',
  'discounts',
  'voucherRedemptions',
];

/**
 * Everything the stored document holds that this mapper does not write.
 *
 * An appointment is persisted with `set()`, not `update()` — the seats, the
 * mirrors and the envelope have to be replaced wholesale or they disagree.
 * That makes every write a potential DELETE of any field the mapper has not
 * heard of: the revision counter, a staff note, whatever the next milestone
 * adds. Carrying the unknown remainder forward is what stops a barber's move
 * from quietly discarding it, and it is the mapper's job because the mapper
 * is what knows which fields it owns.
 */
export function preservedAppointmentFields(
  current: PersistedDocument,
): PersistedDocument {
  const preserved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    if (APPOINTMENT_DOCUMENT_FIELDS.includes(key)) continue;
    // eslint-disable-next-line security/detect-object-injection -- keys come from the stored document's own entries, filtered against this mapper's owned set.
    preserved[key] = value;
  }
  return preserved;
}

/**
 * A seat's `terms` map → the CATALOGUE's answer at the time of the last
 * write, or `null` when there was no override to record.
 *
 * The pads and the currency come from the effective terms rather than being
 * stored twice: staff can override a price and a duration and nothing else,
 * so a second copy of the padding would be a field that can only ever agree
 * — until the day it did not.
 */
export function catalogTermsFromDocument(
  raw: unknown,
  effective: ServiceTerms,
): ServiceTerms | null {
  if (raw == null || typeof raw !== 'object') return null;
  const terms = raw as Record<string, unknown>;
  const price = terms['catalogPriceMinorUnits'];
  const duration = terms['catalogDurationMinutes'];
  if (typeof price !== 'number' || typeof duration !== 'number') return null;

  const money = Money.fromMinorUnitsAndCode(
    price,
    effective.price.currencyCode(),
  );
  if (money.isFailure()) return null;
  const result = ServiceTerms.create(money.value, duration, {
    setupMinutes: effective.setupMinutes,
    cleanupMinutes: effective.cleanupMinutes,
  });
  // A malformed provenance pair reads as "not recorded" rather than failing
  // the seat: the booking is real and the terms that were CHARGED are intact.
  return result.isSuccess() ? result.value : null;
}

/**
 * The stored document's optimistic-concurrency counter.
 *
 * `0` for every row written before staff editing existed, which is the right
 * answer: a sheet that has never seen a revision sends none, and the first
 * staff edit stamps `1`. It counts EDITS, not versions of the schema — two
 * receptionists holding the same visit open both read `3`, and the second to
 * save is told the book moved rather than overwriting the first.
 */
export function revisionOf(current: PersistedDocument): number {
  const raw = current['revision'];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/**
 * THE PAIRS A STAFF SAVE BROKE, REMEMBERED FOR ITS UNDO (round 6) — the
 * document field.
 *
 * «Отмени» restores exactly what the save changed. A save that removed one
 * seat of a pair the visit already held (one person in two chairs, from
 * before the rule), or moved the two apart, leaves a visit that no longer
 * holds the pair — and the undo that puts the seat back, under its old id,
 * would be judged a NEW double seating and refused. So the save remembers,
 * by seat id, the pairs it broke, stamped with the revision it wrote; an
 * edit made on that revision may stand by them (`liveStoodSeatPairs`).
 *
 * THE WINDOW is "until the next revision-stamping write": a staff edit or a
 * client move. Writes that update in place and stamp no revision (arrival,
 * clearing it, an outcome transition, a tip, a client cancel) leave the
 * memory live. Deliberately so (BA ruling, 2026-09-26): an undo right after
 * an arrival still works, and the most the memory can do is let a pair the
 * visit held one save earlier stand again.
 *
 * NOT one of `APPOINTMENT_DOCUMENT_FIELDS`: the aggregate knows nothing of
 * it. Every staff edit rewrites it (`withStoodSeatPairs`); a client move
 * carries it forward through `preservedAppointmentFields` under a revision
 * that has moved on, where it is inert.
 */
export const STOOD_SEAT_PAIRS_FIELD = 'stoodSeatPairs';

/** What the field holds: the pairs, and the revision of the save that broke them. */
export interface StoodSeatPairs {
  /** The revision the breaking save STAMPED — the one the undo is made on. */
  readonly revision: number;
  /** Each pair by seat id, in id order. Never empty: an empty memory is no field. */
  readonly pairs: readonly SeatIdPair[];
}

/**
 * The stored memory, or `null` when there is none. Tolerant, like the
 * ledger: a malformed pair costs that pair — its undo is then judged in
 * full, as it would have been without the memory — never the edit.
 */
export function stoodSeatPairsFromDocument(
  current: PersistedDocument,
): StoodSeatPairs | null {
  const raw = new Map(Object.entries(current)).get(STOOD_SEAT_PAIRS_FIELD);
  if (raw === null || typeof raw !== 'object') return null;
  const field = new Map(Object.entries(raw));
  const revision = field.get('revision');
  const rawPairs = field.get('pairs');
  if (typeof revision !== 'number' || !Number.isInteger(revision)) return null;
  if (!Array.isArray(rawPairs)) return null;
  const pairs: SeatIdPair[] = [];
  for (const item of rawPairs) {
    if (item === null || typeof item !== 'object') continue;
    const entry = new Map(Object.entries(item));
    const seatId = entry.get('seatId');
    const otherSeatId = entry.get('otherSeatId');
    if (typeof seatId !== 'string' || seatId.length === 0) continue;
    if (typeof otherSeatId !== 'string' || otherSeatId.length === 0) continue;
    pairs.push([seatId, otherSeatId]);
  }
  return pairs.length === 0 ? null : { revision, pairs };
}

/**
 * The remembered pairs an edit of `current` may stand by: the memory's,
 * while the visit is still at the revision the breaking save stamped, so no
 * staff edit or client move has landed since (in practice, the edit is the
 * save's undo, sent on its stamp). In-place writes that stamp no revision
 * do not close the window (see `STOOD_SEAT_PAIRS_FIELD`). After the next
 * revision-stamping write, re-adding the seat is judged new.
 */
export function liveStoodSeatPairs(
  current: PersistedDocument,
): readonly SeatIdPair[] {
  const memory = stoodSeatPairsFromDocument(current);
  return memory !== null && memory.revision === revisionOf(current)
    ? memory.pairs
    : [];
}

/**
 * `fields` with the memory a write leaves behind: `memory`'s pairs under
 * its revision, or NO field at all — an older memory is dropped, never
 * carried, so a save that broke nothing leaves nothing to stand by.
 */
export function withStoodSeatPairs(
  fields: PersistedDocument,
  memory: StoodSeatPairs | null,
): PersistedDocument {
  const kept = Object.fromEntries(
    Object.entries(fields).filter(([key]) => key !== STOOD_SEAT_PAIRS_FIELD),
  );
  if (memory === null || memory.pairs.length === 0) return kept;
  return {
    ...kept,
    [STOOD_SEAT_PAIRS_FIELD]: {
      revision: memory.revision,
      pairs: memory.pairs.map(([seatId, otherSeatId]) => ({
        seatId,
        otherSeatId,
      })),
    },
  };
}

/**
 * Seat outcome → document. Explicit rather than a structural dump, so the
 * persisted vocabulary is reviewable in one place and a new union arm cannot
 * reach storage without someone deciding how it is written.
 */
export function seatOutcomeToDocument(
  outcome: SeatOutcome,
): Record<string, unknown> {
  switch (outcome.kind) {
    case 'scheduled':
      return { kind: 'scheduled' };
    case 'worked':
      return { kind: 'worked', atMs: outcome.atMs };
    case 'no_show':
      return { kind: 'no_show', atMs: outcome.atMs };
    case 'cancelled':
      return {
        kind: 'cancelled',
        atMs: outcome.atMs,
        by: outcome.by,
        reason:
          outcome.reason.kind === 'other'
            ? { kind: 'other', note: outcome.reason.note }
            : { kind: outcome.reason.kind },
        // The window in force when it was called off (2026-09-25), as its
        // whole hours. OMITTED when unknown, never written as `null`: absent
        // is what every row before the stamp already says, so a legacy seat
        // that a later edit rewrites keeps its exact bytes.
        ...(outcome.window === null
          ? {}
          : { windowHours: outcome.window.hours }),
      };
  }
}

/**
 * A cancellation's stamped window → a `CancellationWindow`, or `null` —
 * "not recorded". Never throws.
 *
 * Absent on every cancellation written before the stamp (2026-09-25), and
 * the stats judge those by the current policy instead. A value the domain
 * refuses (`CancellationWindow.create` — the same rule `BookingPolicy`
 * validates the setting by, so nothing a policy could have set is lost)
 * reads as unrecorded too, rather than as a window nobody ever set. The
 * seat is real either way; only the rule it was judged under is unknown.
 */
function cancellationWindowFromDocument(
  raw: unknown,
): CancellationWindow | null {
  if (typeof raw !== 'number') return null;
  const parsed = CancellationWindow.create(raw);
  return parsed.isSuccess() ? parsed.value : null;
}

const CANCELLATION_REASON_KINDS: readonly CancellationReason['kind'][] = [
  'client_changed_plans',
  'client_unwell',
  'staff_barber_absence',
  'staff_shop_closure',
  'no_show_converted',
  'unspecified',
  'other',
];

/**
 * A ROOT's cancellation string, read back as a reason.
 *
 * The root carries one string: the code a staff cancel filed, the sentence
 * a client typed, or — from before the reason was optional — the stand-in
 * `cancelled_by_client` the client path wrote when nothing was typed. A code
 * is a code; the stand-in and an empty string mean nobody said; anything
 * else is somebody's sentence.
 */
function cancellationReasonFromRoot(reason: string): CancellationReason {
  const trimmed = reason.trim();
  if (trimmed.length === 0 || trimmed === 'cancelled_by_client') {
    return { kind: 'unspecified' };
  }
  return CANCELLATION_REASON_KINDS.includes(trimmed as never) &&
    trimmed !== 'other'
    ? ({ kind: trimmed } as CancellationReason)
    : { kind: 'other', note: trimmed };
}

function cancellationReasonFromDocument(raw: unknown): CancellationReason {
  const data = (raw ?? {}) as Record<string, unknown>;
  const kind = String(data['kind'] ?? '');
  if (kind === 'other' || !CANCELLATION_REASON_KINDS.includes(kind as never)) {
    // An unrecognised code degrades to `other` WITH the code preserved in the
    // note, rather than being discarded — a vocabulary that grew in a later
    // version stays readable by an older client.
    return { kind: 'other', note: String(data['note'] ?? kind) };
  }
  return { kind } as CancellationReason;
}

/**
 * Document → seat outcome, with a best-effort answer for rows written before
 * outcomes existed.
 *
 * ### The legacy derivation, and its one honest limitation
 * A seat with no stored outcome on a TERMINAL appointment is not really
 * "scheduled" — the visit is over, and leaving it open would make every
 * historical booking look like unfinished business on the day sheet. So the
 * kind is derived from the root status, and the instant is approximated by the
 * seat's own end time.
 *
 * That approximation is close for `worked`/`no_show` (a shop resolves those at
 * the chair) and can be far off for `cancelled`, which is exactly why it must
 * never feed a cancellation-lead-time figure. **`bookedAt === null` is the
 * discriminator**: a row with no booking instant is a row whose timing numbers
 * are derived, and every report must exclude it from lead-time statistics
 * rather than average it in.
 */
/**
 * A seat's stored tip → `Money`, or `null` when none was recorded.
 *
 * `null` and zero are DIFFERENT answers and both survive the round trip: a
 * visit nobody has settled up yet is not a visit that tipped nothing, and a
 * day's report has to be able to say which. So only a finite number becomes
 * money; anything else — absent, `null`, a string, a row written before this
 * field existed — reads back as "not recorded" rather than as `0`.
 *
 * The currency is the seat's own, because a tip is settled in the money the
 * seat was priced in.
 */
export function seatTipFromDocument(
  raw: unknown,
  currencyCode: string,
): Money | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const money = Money.fromMinorUnitsAndCode(raw, currencyCode);
  return money.isSuccess() ? money.value : null;
}

export function seatOutcomeFromDocument(
  raw: unknown,
  rootStatus: AppointmentStatus | undefined,
  seatEndMs: number,
): SeatOutcome {
  if (raw != null && typeof raw === 'object') {
    const data = raw as Record<string, unknown>;
    const kind = String(data['kind'] ?? '');
    const atMs = Number(data['atMs']);
    if (kind === 'worked' && Number.isFinite(atMs)) return { kind, atMs };
    if (kind === 'no_show' && Number.isFinite(atMs)) return { kind, atMs };
    if (kind === 'cancelled' && Number.isFinite(atMs)) {
      return {
        kind,
        atMs,
        by: data['by'] === 'client' ? 'client' : 'staff',
        reason: cancellationReasonFromDocument(data['reason']),
        window: cancellationWindowFromDocument(data['windowHours']),
      };
    }
    if (kind === 'scheduled') return SEAT_SCHEDULED;
    // Anything else is malformed and falls through to the derivation below,
    // which is a better answer than a shape nobody can interpret.
  }

  switch (rootStatus?.kind) {
    case 'completed':
      return { kind: 'worked', atMs: seatEndMs };
    case 'no_show':
      return { kind: 'no_show', atMs: seatEndMs };
    case 'cancelled':
      return {
        kind: 'cancelled',
        atMs: seatEndMs,
        // The client path stamped no seats before 2026-09-11 and left its
        // stand-in on the root; that is the one root string that names its
        // side. Everything else was the shop's.
        by:
          rootStatus.reason.trim() === 'cancelled_by_client'
            ? 'client'
            : 'staff',
        reason: cancellationReasonFromRoot(rootStatus.reason),
        // Older than the stamp by construction: judged by the current policy.
        window: null,
      };
    default:
      return SEAT_SCHEDULED;
  }
}

/** Document → the instant the booking was made, or `null` for a legacy row. */
export function bookedAtFromDocument(
  data: PersistedDocument,
): ZonedDateTime | null {
  return zonedFieldFromDocument(data, 'bookedAt');
}

/**
 * Document → the preference this seat was resolved from.
 *
 * An unrecognised or absent value reads as `null` — "we do not know" — and
 * NEVER as `any`. Guessing `any` here would tell a receptionist on a sick day
 * that a client is happy with whichever barber is free, on no evidence, and
 * the shop would move a booking it should have phoned about.
 */
export function barberPrefFromDocument(
  raw: unknown,
  barberId: BarberId,
): BarberPref | null {
  if (raw === 'any') return BarberPref.any();
  if (raw === 'specific') return BarberPref.specific(barberId);
  return null;
}

/**
 * Document → arrival instant. `null` is "has not walked in", which every
 * report must keep distinct from "arrived exactly on time".
 */
export function arrivedAtFromDocument(
  data: PersistedDocument,
): ZonedDateTime | null {
  return zonedFieldFromDocument(data, 'arrivedAt');
}

/** The `{iso, zone}` pair both instant fields are written as. */
function zonedFieldFromDocument(
  data: PersistedDocument,
  field: string,
): ZonedDateTime | null {
  const raw = data[field];
  if (raw == null || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const parsed = ZonedDateTime.fromISO(
    String(entry['iso'] ?? ''),
    String(entry['zone'] ?? ''),
  );
  return parsed.isSuccess() ? parsed.value : null;
}

/**
 * Document → contact, for the readers that show it (the client's own
 * appointments, the staff day view).
 *
 * A contact that does not parse reads as ABSENT rather than failing the
 * appointment: the booking is still real, still cancellable, and still worth
 * showing — losing the phone number is not worth losing the row.
 */
export function contactFromDocument(
  data: PersistedDocument,
): BookingContact | null {
  const raw = data['contact'];
  if (raw === null || typeof raw !== 'object') return null;
  const contact = raw as Record<string, unknown>;

  const result = BookingContact.create({
    name: String(contact['name'] ?? ''),
    phone: String(contact['phone'] ?? ''),
    email: contact['email'] == null ? null : String(contact['email']),
    note: contact['note'] == null ? null : String(contact['note']),
  });
  return result.isSuccess() ? result.value : null;
}

const SEAT_RELATIONSHIPS: readonly SeatRelationship[] = [
  'self',
  'companion',
  'client',
];

/** A stored pad that is not a whole, non-negative minute count reads as none. */
function padMinutes(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

function malformed(what: string, cause?: unknown): RepositoryError {
  return new RepositoryError(`Malformed appointment ${what}`, cause);
}

/** One stored seat → `Seat`. Identity, subject, price and slot must parse; the rest degrades. */
function seatFromDocument(
  raw: unknown,
  rootStatus: AppointmentStatus | undefined,
): Result<Seat, RepositoryError> {
  if (raw === null || typeof raw !== 'object') return fail(malformed('seat'));
  const entry = raw as Record<string, unknown>;

  const id = SeatId.create(String(entry['id'] ?? ''));
  if (id.isFailure()) return fail(malformed('seat id', id.error));
  const serviceId = ServiceId.create(String(entry['serviceId'] ?? ''));
  if (serviceId.isFailure()) {
    return fail(malformed('seat serviceId', serviceId.error));
  }
  const barberId = BarberId.create(String(entry['barberId'] ?? ''));
  if (barberId.isFailure()) {
    return fail(malformed('seat barberId', barberId.error));
  }
  let variantId: ServiceVariantId | null = null;
  if (entry['variantId'] != null) {
    const parsed = ServiceVariantId.create(String(entry['variantId']));
    if (parsed.isFailure()) {
      return fail(malformed('seat variantId', parsed.error));
    }
    variantId = parsed.value;
  }

  const subjectData = (entry['subject'] ?? {}) as Record<string, unknown>;
  let subject: SeatSubject;
  if (subjectData['kind'] === 'account') {
    const userId = UserId.create(String(subjectData['userId'] ?? ''));
    if (userId.isFailure()) {
      return fail(malformed('seat subject userId', userId.error));
    }
    const relationship = subjectData['relationship'];
    subject = SeatSubject.account(
      userId.value,
      // An unknown relationship is somebody the shop booked, never the owner:
      // `self` is what authority hangs off, so it is not guessed into being.
      SEAT_RELATIONSHIPS.includes(relationship as SeatRelationship)
        ? (relationship as SeatRelationship)
        : 'client',
    );
  } else {
    const label = SeatLabel.create(String(subjectData['label'] ?? ''));
    if (label.isFailure()) return fail(malformed('seat label', label.error));
    subject = SeatSubject.anonymous(label.value);
  }

  const termsData = (entry['terms'] ?? {}) as Record<string, unknown>;
  const priceMinor = termsData['priceMinorUnits'];
  const currency = termsData['currencyCode'];
  // Shape first: `Money` validates values, and a missing currency would throw
  // inside it rather than fail. The currency is named on its own because it
  // is the one a hand-written or legacy row most often lacks.
  if (typeof currency !== 'string') {
    return fail(malformed('seat price: no currency'));
  }
  if (typeof priceMinor !== 'number') return fail(malformed('seat price'));
  const price = Money.fromMinorUnitsAndCode(priceMinor, currency);
  if (price.isFailure()) return fail(malformed('seat price', price.error));
  const terms = ServiceTerms.create(
    price.value,
    termsData['durationMinutes'] as number,
    {
      setupMinutes: padMinutes(termsData['setupMinutes']),
      cleanupMinutes: padMinutes(termsData['cleanupMinutes']),
    },
  );
  if (terms.isFailure()) return fail(malformed('seat terms', terms.error));

  const slotData = (entry['slot'] ?? {}) as Record<string, unknown>;
  const slot = TimeSlot.create({
    startIso: String(slotData['startIso'] ?? ''),
    endIso: String(slotData['endIso'] ?? ''),
    zone: String(slotData['zone'] ?? ''),
  });
  if (slot.isFailure()) return fail(malformed('seat slot', slot.error));

  return ok(
    Seat.of({
      id: id.value,
      subject,
      serviceId: serviceId.value,
      variantId,
      barberId: barberId.value,
      terms: terms.value,
      // Only the START: the seat derives its end from the sold duration.
      startsAt: slot.value.start,
      outcome: seatOutcomeFromDocument(
        entry['outcome'],
        rootStatus,
        slot.value.end.toMillis(),
      ),
      pref: barberPrefFromDocument(entry['barberPref'], barberId.value),
      catalogTerms: catalogTermsFromDocument(entry['terms'], terms.value),
      tip: seatTipFromDocument(
        entry['tipMinorUnits'],
        terms.value.price.currencyCode(),
      ),
    }),
  );
}

/**
 * Document → `Appointment`, for the readers that hold the whole aggregate —
 * the functions' client-stats projection and backfill today.
 *
 * The inverse of `appointmentToDocument`, and in the port layer for the same
 * reason the writer is: two SDKs read this shape. The mirrors (`timeSlot`,
 * `barberIds`, `subjectUserIds`) are never read back — the seats are the
 * truth. A seat that does not parse fails the whole appointment rather than
 * silently shrinking the party; the side facts (contact, discounts,
 * vouchers) degrade exactly as their own readers do.
 */
export function appointmentFromDocument(
  id: string,
  data: PersistedDocument,
): Result<Appointment, RepositoryError> {
  const status = data['status'] as AppointmentStatus | undefined;
  if (status == null || typeof status !== 'object') {
    return fail(malformed('status'));
  }
  const rawSeats = data['seats'];
  if (!Array.isArray(rawSeats)) return fail(malformed('seats'));
  const seats: Seat[] = [];
  for (const raw of rawSeats) {
    const seat = seatFromDocument(raw, status);
    if (seat.isFailure()) return fail(seat.error);
    seats.push(seat.value);
  }

  const appointment = Appointment.reconstitute({
    id,
    locationId: String(data['locationId'] ?? ''),
    seats,
    status,
    contact: contactFromDocument(data),
    bookedAt: bookedAtFromDocument(data),
    arrivedAt: arrivedAtFromDocument(data),
    bookedFromAppointmentId:
      typeof data['bookedFromAppointmentId'] === 'string'
        ? data['bookedFromAppointmentId']
        : null,
    discounts: discountsFromDocument(data),
    voucherRedemptions: voucherRedemptionsFromDocument(data),
    // THE REVISION THIS COPY WAS READ AT — what every staff intent drawn
    // from it claims (`expectedVersion`). Read by the same `revisionOf` the
    // server's stale check reads, so an absent counter is `0` on both sides
    // and a sheet opened on a legacy row claims exactly what the server
    // holds. Left out, every copy read `null`, every staff save claimed
    // nothing, and the stale-screen guard never refused an older sheet.
    revision: revisionOf(data),
  });
  return appointment.isFailure()
    ? fail(malformed('document', appointment.error))
    : ok(appointment.value);
}

/**
 * The booker, denormalized so "my appointments" is one indexed query rather
 * than a scan. Taken from the `self` seat — the one seat whose subject is the
 * account that owns the booking; a party's guests are anonymous subjects and
 * never own anything.
 */
export function ownerUserIdOf(appointment: Appointment): string | null {
  return AppointmentIndexSystem.queryKeys(indexedSeatsOf(appointment), [])
    .ownerUserId;
}

/**
 * Every account on the visit, deduplicated and sorted — the `busyKeys`
 * precedent: one array mirror, one `array-contains` index. Sorted so the
 * same seats always write the same bytes; guests have no account and no
 * history to find.
 */
export function subjectUserIdsOf(appointment: Appointment): readonly string[] {
  return AppointmentIndexSystem.queryKeys(indexedSeatsOf(appointment), [])
    .subjectUserIds;
}

/**
 * The same set read off a STORED document's seats, tolerant of any shape —
 * for the paths that hold raw data: the trigger's before/after, and the
 * backfill stamping rows written before the mirror existed.
 */
export function subjectUserIdsFromDocument(
  data: PersistedDocument | undefined,
): readonly string[] {
  const seats = Array.isArray(data?.['seats'])
    ? (data['seats'] as readonly unknown[])
    : [];
  // Only the accounts matter here: each raw account subject becomes a seat
  // the mirror reads (no chair, no day — neither is asked of it).
  const accounts: IndexedSeat[] = [];
  for (const raw of seats) {
    if (raw === null || typeof raw !== 'object') continue;
    const subject = (raw as Record<string, unknown>)['subject'];
    if (subject === null || typeof subject !== 'object') continue;
    const fields = subject as Record<string, unknown>;
    const userId = fields['userId'];
    if (
      fields['kind'] === 'account' &&
      typeof userId === 'string' &&
      userId.trim().length > 0
    ) {
      accounts.push({
        barberId: EcsBarberId.of(''),
        startMs: Number.NaN,
        subject: EcsSeatSubject.account(EcsUserId.of(userId), 'companion'),
      });
    }
  }
  return AppointmentIndexSystem.queryKeys({ seats: accounts }, [])
    .subjectUserIds;
}

function placementOf(raw: unknown): AppointmentPlacement | null {
  return raw === 'self' || raw === 'staff' ? raw : null;
}

/**
 * The placement the COMMIT stamped, or `null` for a row it did not — one
 * written before the field, whatever the backfill has since inferred. Read
 * as evidence that the row's seat preferences were recorded, not defaulted.
 */
export function placementFromDocument(
  data: PersistedDocument | undefined,
): AppointmentPlacement | null {
  return placementOf(data?.['placement']);
}

/**
 * The placement the backfill reconstructed from a pre-P0 row's commit audit
 * row (§12.5.1), or `null` when there is none. A statement of who most
 * likely placed the booking — never evidence about its seats: the commit
 * that wrote them stored an omitted barber preference as `specific`, so a
 * phone booking into whichever chair was free reads exactly like a request.
 *
 * `inferredPlacement` is deliberately NOT a field `appointmentToDocument`
 * owns: the mapper writes what the aggregate and the commit know, and this
 * is neither. Left out of `APPOINTMENT_DOCUMENT_FIELDS`, it rides every
 * rewrite through `preservedAppointmentFields` (a staff edit) or `update()`
 * (every other write), so no edit can erase it or promote it to a stamp.
 */
export function inferredPlacementFromDocument(
  data: PersistedDocument | undefined,
): AppointmentPlacement | null {
  return placementOf(data?.['inferredPlacement']);
}

/**
 * The PUBLIC busy projection for one (barber, day).
 *
 * Geometry and nothing else — no client, no service, no price, and above all
 * no reason. `/book` is browsable anonymously and Firestore rules cannot
 * redact fields, so a visitor must be able to read this document whole
 * without learning anything about who is in the chair. (A `sick` day is GDPR
 * Art. 9 special-category data; it must never be derivable from here.)
 *
 * Intervals are stored UNPADDED — the barber's turnaround is applied by
 * whoever reads them, from the roster document, so changing a barber's reset
 * time takes effect immediately instead of only for bookings written
 * afterwards.
 */
export interface PersistedBusyDocument {
  readonly barberId: string;
  readonly dayKey: string;
  readonly zone: string;
  readonly busy: readonly PersistedSlot[];
}

/** Composite key — the barber AND the day, so the grid reads exactly what it renders. */
export function busyDocumentId(barberId: string, dayKey: string): string {
  return BusyKey.of(EcsBarberId.of(barberId), EcsDayKey.of(dayKey));
}

/**
 * Every busy-doc key this appointment's seats occupy.
 *
 * Keyed by the SOLD slot's start day — the same day `decideBooking` keys its
 * busy writes by — so the mirror and the projection always name the same
 * documents. Deduplicated because two seats with one barber on one day are
 * one projection doc.
 */
export function busyKeysOf(appointment: Appointment): readonly string[] {
  return AppointmentIndexSystem.queryKeys(
    indexedSeatsOf(appointment),
    seatDayTableOf(appointment),
  ).busyKeys;
}

/* ── Phase 2 shim converters: the aggregate's seats → ecs-core structs ──── */

/** What `AppointmentIndexSystem.queryKeys` reads of each seat. */
function indexedSeatsOf(appointment: Appointment): {
  readonly seats: readonly IndexedSeat[];
} {
  return {
    seats: appointment.seats.map((seat) => ({
      barberId: EcsBarberId.of(seat.barberId.value),
      startMs: seat.slot.start.toMillis(),
      subject:
        seat.subject.kind === 'account'
          ? EcsSeatSubject.account(
              EcsUserId.of(seat.subject.userId.value),
              seat.subject.relationship,
            )
          : EcsSeatSubject.anonymous(EcsSeatLabel.of(seat.subject.label.value)),
    })),
  };
}

/**
 * The zone table the busy keys are resolved over: the seats' zone (one per
 * visit — the shop's), the days from the first sold start to the last.
 */
function seatDayTableOf(appointment: Appointment): readonly DayOffset[] {
  const starts = appointment.seats.map((seat) => seat.slot.start);
  const first = starts[0];
  if (first === undefined) return [];
  const ms = starts.map((start) => start.toMillis());
  return ZonedTimeSystem.dayTableAround(
    first.zoneName,
    Math.min(...ms),
    Math.max(...ms),
    0,
  );
}

/** One (barber, day) projection doc's share of a stored appointment. */
export interface BusyContribution {
  readonly zone: string;
  readonly intervals: readonly Interval[];
}

/**
 * What a PERSISTED appointment occupies, per busy-doc key.
 *
 * The same envelope `decideBooking` writes — setup + service + cleanup
 * around each seat's sold slot — re-derived from the stored seats, so the
 * rebuild trigger reproduces the commit path's geometry byte-for-byte
 * instead of keeping a second copy of the rule. A seat that does not parse
 * contributes nothing: fail-closed FREES time rather than inventing a block
 * nobody can explain, and the appointment itself remains the truth.
 */
export function busyContributionsOf(
  data: PersistedDocument,
): ReadonlyMap<string, BusyContribution> {
  const byKey = new Map<string, { zone: string; intervals: Interval[] }>();
  // The seats grouped by zone (a visit's seats share the shop's), in the
  // order the zones first appear: ONE day table per zone, over its seats'
  // span, and one `contributionsOf` per zone — never Intl per seat.
  const seatsByZone = new Map<string, EcsSeat[]>();
  for (const { seat, zone } of persistedSeatsOf(data)) {
    const seats = seatsByZone.get(zone);
    if (seats === undefined) seatsByZone.set(zone, [seat]);
    else seats.push(seat);
  }
  for (const [zone, seats] of seatsByZone) {
    let minStart = Number.POSITIVE_INFINITY;
    let maxStart = Number.NEGATIVE_INFINITY;
    for (const seat of seats) {
      if (seat.startMs < minStart) minStart = seat.startMs;
      if (seat.startMs > maxStart) maxStart = seat.startMs;
    }
    // The system keys the chair by its sold start's local day.
    const days = ZonedTimeSystem.dayTableAround(zone, minStart, maxStart, 0);
    for (const contribution of BusySystem.contributionsOf(
      { seats, zone },
      days,
    )) {
      const entry = byKey.get(contribution.id) ?? {
        zone: contribution.zone,
        intervals: [],
      };
      for (const span of contribution.spans) {
        entry.intervals.push(Interval.of(span.startMs, span.endMs));
      }
      byKey.set(contribution.id, entry);
    }
  }
  return byKey;
}

/**
 * Every chair a PERSISTED appointment holds, read straight off its stored
 * seats: the same geometry `busyContributionsOf` projects, as the chair time
 * a move hands back (`BookingSnapshot.release`).
 *
 * For a visit the aggregate reads, `Appointment.chairTimes()` is the source
 * and says the same. This is for one it cannot (a legacy document, a field
 * the mapper refuses): its chairs are still in the busy projection, because
 * the rebuild trigger projects exactly this, so they are still its own to
 * hand back. A seat that does not parse holds no chair here either, as in
 * the projection.
 */
export function persistedChairTimesOf(
  data: PersistedDocument,
): readonly ChairTime[] {
  return persistedSeatsOf(data).flatMap((seat): readonly ChairTime[] => {
    const barberId = BarberId.create(seat.seat.barberId);
    if (barberId.isFailure()) return [];
    const occupied = EcsSeat.chairTime(seat.seat);
    return [
      {
        barberId: barberId.value,
        occupied: Interval.of(occupied.startMs, occupied.endMs),
      },
    ];
  });
}

/**
 * The stored seats as `BusySystem` reads them — the edge parse of the raw
 * seat geometry (the sold slot's ISO pair, the pads), for the projection and
 * the release alike. Each seat carries its zone; the day table is the
 * projection's to build (once per zone), and the release needs none. A seat
 * with no zone or barber, or an unparseable slot, is skipped.
 */
function persistedSeatsOf(data: PersistedDocument): readonly {
  readonly seat: EcsSeat;
  readonly zone: string;
}[] {
  const seats = Array.isArray(data['seats'])
    ? (data['seats'] as readonly Record<string, unknown>[])
    : [];
  return seats.flatMap((seat) => {
    const slot = (seat['slot'] ?? {}) as Record<string, unknown>;
    const terms = (seat['terms'] ?? {}) as Record<string, unknown>;
    const zone = String(slot['zone'] ?? '');
    const barberId = String(seat['barberId'] ?? '');
    if (zone.length === 0 || barberId.length === 0) return [];

    const start = ZonedDateTime.fromISO(String(slot['startIso'] ?? ''), zone);
    const end = ZonedDateTime.fromISO(String(slot['endIso'] ?? ''), zone);
    if (start.isFailure() || end.isFailure()) return [];

    const setup = Number(terms['setupMinutes'] ?? 0);
    const cleanup = Number(terms['cleanupMinutes'] ?? 0);
    const startMs = start.value.toMillis();
    const struct: EcsSeat = {
      id: EcsSeatId.of(String(seat['id'] ?? '')),
      serviceId: EcsServiceId.of(String(seat['serviceId'] ?? '')),
      variantId: null,
      barberId: EcsBarberId.of(barberId),
      barberPref: null,
      terms: {
        priceMinorUnits: 0,
        currencyCode: '',
        // The stored END is the truth the projection was drawn from.
        durationMinutes: (end.value.toMillis() - startMs) / 60_000,
        setupMinutes: Number.isFinite(setup) ? setup : 0,
        cleanupMinutes: Number.isFinite(cleanup) ? cleanup : 0,
        catalogPriceMinorUnits: null,
        catalogDurationMinutes: null,
      },
      startMs,
      subject: EcsSeatSubject.anonymous(EcsSeatLabel.of('')),
      outcome: EcsSeatOutcome.scheduled(),
      tip: null,
    };
    return [{ seat: struct, zone }];
  });
}

/** Stored slots → intervals. An unparseable entry is skipped, never guessed at. */
export function busyIntervalsOf(
  slots: readonly PersistedSlot[],
  zone: string,
): readonly Interval[] {
  const intervals: Interval[] = [];
  for (const slot of slots) {
    const start = ZonedDateTime.fromISO(slot.startIso, zone);
    const end = ZonedDateTime.fromISO(slot.endIso, zone);
    if (start.isFailure() || end.isFailure()) continue;
    intervals.push(Interval.of(start.value.toMillis(), end.value.toMillis()));
  }
  return intervals;
}

/**
 * Merge new spans into a busy document's slots.
 *
 * `Interval.normalize` merges touching runs, which is deliberate: two
 * back-to-back seats become one span, so the projection leaks booking
 * DENSITY (what anyone learns by looking through the window) but never how
 * many clients were served.
 */
export function mergeBusy(
  existing: readonly PersistedSlot[],
  added: readonly Interval[],
  zone: string,
): readonly PersistedSlot[] {
  const merged = BusySystem.mergeBusy(
    busyIntervalsOf(existing, zone),
    added,
    [],
  );

  const slots: PersistedSlot[] = [];
  for (const interval of merged) {
    const start = ZonedDateTime.fromMillis(interval.startMs, zone);
    const end = ZonedDateTime.fromMillis(interval.endMs, zone);
    // Unreachable for a valid zone; dropping beats writing a broken span.
    if (start.isFailure() || end.isFailure()) continue;
    slots.push({
      startIso: start.value.toISO(),
      endIso: end.value.toISO(),
      zone,
    });
  }
  return slots;
}
