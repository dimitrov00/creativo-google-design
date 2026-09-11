import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { BarberId, ServiceTerms } from '@creativo/domain/catalog';
import { CouponCombinability, CouponValue } from '@creativo/domain/engagement';
import {
  AppliedDiscount,
  Appointment,
  AppointmentStatus,
  BarberPref,
  BookingContact,
  CalendarDay,
  CancellationReason,
  Interval,
  SEAT_SCHEDULED,
  SeatOutcome,
  VoucherRedemption,
} from '@creativo/domain/scheduling';

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
 * Appointment → document.
 *
 * `barberIds` and the top-level `timeSlot` are QUERY MIRRORS, not truth. The
 * seats are the truth and both are recomputed on read, so a corrupt mirror
 * cannot change what an appointment says — only which queries find it.
 */
export function appointmentToDocument(
  appointment: Appointment,
): PersistedDocument {
  return {
    locationId: appointment.locationId.value,
    ownerUserId: ownerUserIdOf(appointment),
    barberIds: appointment.barberIds().map((id) => id.value),
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
      };
  }
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

/**
 * The booker, denormalized so "my appointments" is one indexed query rather
 * than a scan. Taken from the `self` seat — the one seat whose subject is the
 * account that owns the booking; a party's guests are anonymous subjects and
 * never own anything.
 */
export function ownerUserIdOf(appointment: Appointment): string | null {
  for (const seat of appointment.seats) {
    if (
      seat.subject.kind === 'account' &&
      seat.subject.relationship === 'self'
    ) {
      return seat.subject.userId.value;
    }
  }
  return null;
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
  return `${barberId}__${dayKey}`;
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
  const keys = new Set<string>();
  for (const seat of appointment.seats) {
    keys.add(
      busyDocumentId(
        seat.barberId.value,
        CalendarDay.fromZonedDateTime(seat.slot.start).key(),
      ),
    );
  }
  return [...keys].sort();
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
  const seats = Array.isArray(data['seats'])
    ? (data['seats'] as readonly Record<string, unknown>[])
    : [];

  for (const seat of seats) {
    const slot = (seat['slot'] ?? {}) as Record<string, unknown>;
    const terms = (seat['terms'] ?? {}) as Record<string, unknown>;
    const zone = String(slot['zone'] ?? '');
    const barberId = String(seat['barberId'] ?? '');
    if (zone.length === 0 || barberId.length === 0) continue;

    const start = ZonedDateTime.fromISO(String(slot['startIso'] ?? ''), zone);
    const end = ZonedDateTime.fromISO(String(slot['endIso'] ?? ''), zone);
    if (start.isFailure() || end.isFailure()) continue;

    const setup = Number(terms['setupMinutes'] ?? 0);
    const cleanup = Number(terms['cleanupMinutes'] ?? 0);

    const key = busyDocumentId(
      barberId,
      CalendarDay.fromZonedDateTime(start.value).key(),
    );
    const entry = byKey.get(key) ?? { zone, intervals: [] };
    entry.intervals.push(
      Interval.of(
        start.value.toMillis() - (Number.isFinite(setup) ? setup : 0) * 60_000,
        end.value.toMillis() +
          (Number.isFinite(cleanup) ? cleanup : 0) * 60_000,
      ),
    );
    byKey.set(key, entry);
  }
  return byKey;
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
  const merged = Interval.normalize([
    ...busyIntervalsOf(existing, zone),
    ...added,
  ]);

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
