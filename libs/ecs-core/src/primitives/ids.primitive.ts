import { Result } from './result.data';
import type { Brand } from './brand';
import { PrimitiveError, PrimitiveErrorCode } from './primitive.error';
import { StoredFields } from './stored-fields.data';

/*
 * The id family (Law 7.4, flatten-spec §1.5) — every entity id, key and
 * reference id of the core as `Brand<string, '<Name>'>`. Nominal per tag:
 * an `AppointmentId` is never a `BarberId`, and a `CustomerId` (the client
 * record) is never a `UserId` (the auth account) — D29.
 *
 * Every companion has two doors (decision F-3):
 * - `parse(raw)` — FOREIGN input (an HTTP body, a callable payload, a route
 *   param): non-empty (not blank), no `/` (a Firestore path separator) and
 *   not a name Firestore reserves (`.`, `..`, `__…__` — OR-44), or a flat
 *   `PrimitiveError`. Mandatory at every edge.
 * - `of(raw)` — a value that is an id BY CONSTRUCTION (a document id the
 *   adapter just read, a derived key, a fixture literal). No check.
 */

/** `/` — the Firestore path separator an id may not hold. */
const SLASH = 47;
/** `.` — a document id of one or two of these alone is reserved. */
const DOT = 46;
/** `_` — a document id wrapped in two of these on each side is reserved. */
const UNDERSCORE = 95;

/**
 * A code unit `String.prototype.trim` strips — ECMAScript's WhiteSpace
 * (TAB, VT, FF, SP, NBSP, ZWNBSP and every `Zs` space) and LineTerminator
 * (LF, CR, LS, PS) — so a scan for anything else answers exactly what
 * `raw.trim().length > 0` answers, without allocating the trimmed copy.
 */
function isTrimmedAway(code: number): boolean {
  if (code <= 0x20) {
    return code === 0x20 || (code >= 0x09 && code <= 0x0d);
  }
  if (code < 0xa0) return false;
  return (
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/**
 * `text[start, end)` is a name Firestore keeps for itself (OR-44): `.` or
 * `..` alone, or four or more code units wrapped in `__…__` (the server's
 * `__.*__`) — `__` itself and `a__b` are plain ids. Gated on the length and
 * read by code unit: no slice, no regular expression.
 */
function isReservedSpan(text: string, start: number, end: number): boolean {
  const length = end - start;
  if (length === 1) return text.charCodeAt(start) === DOT;
  if (length === 2) {
    return text.charCodeAt(start) === DOT && text.charCodeAt(start + 1) === DOT;
  }
  return (
    length >= 4 &&
    text.charCodeAt(start) === UNDERSCORE &&
    text.charCodeAt(start + 1) === UNDERSCORE &&
    text.charCodeAt(end - 2) === UNDERSCORE &&
    text.charCodeAt(end - 1) === UNDERSCORE
  );
}

/**
 * `text[start, end)` is a plain id — not blank, no `/`, not reserved — read
 * in place by code unit: exactly what `parse` accepts of that slice,
 * without the slice.
 */
function isIdSpan(text: string, start: number, end: number): boolean {
  let blank = true;
  for (let i = start; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code === SLASH) return false;
    if (blank && !isTrimmedAway(code)) blank = false;
  }
  return !blank && !isReservedSpan(text, start, end);
}

/** The companion every plain id shares — built once per brand. */
function idCompanion<B extends string>(brand: B) {
  return {
    /**
     * The read-time door (edge hardening D-1): `raw` is a string
     * {@link parse} accepts — not blank, no `/`, not reserved — and `false`
     * for every other value (`parse` itself is never called with a
     * non-string: its `trim()` would throw). Allocates nothing — no
     * `trim()` copy, no `Result` — so a stored-document guard runs it per id
     * per document, and a pipeline asks it before it names a document
     * (OR-44: `.`, `..` and `__…__` would make the SDK throw as the
     * reference is built).
     */
    is(raw: unknown): raw is Brand<string, B> {
      return typeof raw === 'string' && isIdSpan(raw, 0, raw.length);
    },
    /**
     * `text[start, end)` would pass {@link is} — read in place, no slice:
     * how a composite key (`BusyKey`'s barber half) checks its id part.
     */
    isSpan(text: string, start: number, end: number): boolean {
      return isIdSpan(text, Math.max(0, start), Math.min(end, text.length));
    },
    /** Foreign input (an HTTP body, a callable payload, a route param). */
    parse(raw: string): Result<Brand<string, B>, PrimitiveError> {
      if (raw.trim().length === 0) {
        return Result.err(
          PrimitiveError.of(PrimitiveErrorCode.IdEmpty, raw, brand),
        );
      }
      if (raw.includes('/')) {
        return Result.err(
          PrimitiveError.of(PrimitiveErrorCode.IdHasSlash, raw, brand),
        );
      }
      if (isReservedSpan(raw, 0, raw.length)) {
        return Result.err(
          PrimitiveError.of(PrimitiveErrorCode.IdReserved, raw, brand),
        );
      }
      return Result.ok(raw as Brand<string, B>);
    },
    /**
     * A value that is an id by construction: a Firestore document id the
     * adapter just read, a derived key, a fixture literal.
     */
    of(raw: string): Brand<string, B> {
      return raw as Brand<string, B>;
    },
  } as const;
}

/* ── Tenancy and catalogue ──────────────────────────────────────────────── */

/** The tenant a document belongs to (§9 D13) — `creativo`. */
export type TenantId = Brand<string, 'TenantId'>;
export const TenantId = {
  ...idCompanion('TenantId'),
  equals(a: TenantId, b: TenantId): boolean {
    return a === b;
  },
} as const;

/** A shop location (`locations/{id}`) — the owner of the IANA `timeZone`. */
export type LocationId = Brand<string, 'LocationId'>;
export const LocationId = idCompanion('LocationId');

/** A barber (`barbers/{id}`). */
export type BarberId = Brand<string, 'BarberId'>;
export const BarberId = idCompanion('BarberId');

/** A catalogue service (`services/{id}`). */
export type ServiceId = Brand<string, 'ServiceId'>;
export const ServiceId = idCompanion('ServiceId');

/** A catalogue category (`serviceCategories/{id}`). */
export type ServiceCategoryId = Brand<string, 'ServiceCategoryId'>;
export const ServiceCategoryId = idCompanion('ServiceCategoryId');

/** A variant of a service's terms (an entry of its offerings). */
export type ServiceVariantId = Brand<string, 'ServiceVariantId'>;
export const ServiceVariantId = idCompanion('ServiceVariantId');

/* ── Scheduling ─────────────────────────────────────────────────────────── */

/** An appointment (`appointments/{id}`). */
export type AppointmentId = Brand<string, 'AppointmentId'>;
export const AppointmentId = idCompanion('AppointmentId');

/** A seat of an appointment — its own id inside the `seats[]` array (`seatId`). */
export type SeatId = Brand<string, 'SeatId'>;
export const SeatId = idCompanion('SeatId');

/** A visit photo (`appointmentPhotos/{id}`). */
export type AppointmentPhotoId = Brand<string, 'AppointmentPhotoId'>;
export const AppointmentPhotoId = idCompanion('AppointmentPhotoId');

/** A barber's busy day (`barberBusy/{id}`) — its raw text is a `BusyKey`. */
export type BarberBusyDayId = Brand<string, 'BarberBusyDayId'>;
export const BarberBusyDayId = idCompanion('BarberBusyDayId');

/** A lead-time sample (`barberLeadTimeSamples/{id}`). */
export type BarberLeadTimeSampleId = Brand<string, 'BarberLeadTimeSampleId'>;
export const BarberLeadTimeSampleId = idCompanion('BarberLeadTimeSampleId');

/** The booking-policy settings document (`settings/bookingPolicy`). */
export type BookingPolicySettingsId = Brand<string, 'BookingPolicySettingsId'>;
export const BookingPolicySettingsId = {
  ...idCompanion('BookingPolicySettingsId'),
  /** The one document id there is (`BOOKING_POLICY_DOC`). */
  FIXED: 'bookingPolicy' as BookingPolicySettingsId,
} as const;

/** A capacity month (`capacity/{YYYY-MM}`) — built by `LocalDate.monthKey`. */
export type CapacityMonthId = Brand<string, 'CapacityMonthId'>;
export const CapacityMonthId = idCompanion('CapacityMonthId');

/** A barber's schedule exception (`scheduleExceptions/{id}`) — its raw text is a `BusyKey`. */
export type ScheduleExceptionId = Brand<string, 'ScheduleExceptionId'>;
export const ScheduleExceptionId = idCompanion('ScheduleExceptionId');

/** A waitlist request (`waitlistRequests/{id}`). */
export type WaitlistRequestId = Brand<string, 'WaitlistRequestId'>;
export const WaitlistRequestId = idCompanion('WaitlistRequestId');

/** A line of the booking cart — `line-<n>` (today's `CartLine.lineIdOf`). */
export type CartLineId = Brand<string, 'CartLineId'>;
export const CartLineId = {
  ...idCompanion('CartLineId'),
  /** The `n`-th line of a cart: `line-<n>`. */
  forSequence(n: number): CartLineId {
    return `line-${n}` as CartLineId;
  },
} as const;

/** A guest seat of a party — `guest-…`. */
export type GuestId = Brand<string, 'GuestId'>;
export const GuestId = idCompanion('GuestId');

/** A discount applied to a visit (today `AppliedDiscount.id`). */
export type AppliedDiscountId = Brand<string, 'AppliedDiscountId'>;
export const AppliedDiscountId = idCompanion('AppliedDiscountId');

/** A staff edit operation applied to a visit (today `AppliedOperation.id`). */
export type OperationId = Brand<string, 'OperationId'>;
export const OperationId = idCompanion('OperationId');

/** The shape every client-minted idempotency key holds: a UUID-ish charset, a bounded length. */
const CLIENT_OPERATION_ID = /^[A-Za-z0-9_-]{16,64}$/;
/** The shape of a guest's key on the wire: the cart's seat key, bounded. */
const GUEST_KEY = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A client-minted idempotency key (4A-12) — a commit's and a move's
 * `attemptId`, a staff intent's `operationId`, a streak publish's
 * `requestId`: a UUID-ish charset and a bounded length, because the server
 * uses it as a document id (a commit) and inside audit keys. ONE definition
 * for the client that mints (`ID_PORTS.nextId` — a UUID passes) and the
 * server that checks, so the two cannot drift (was the legacy
 * `isClientOperationId`).
 */
export type ClientOperationId = Brand<string, 'ClientOperationId'>;
export const ClientOperationId = {
  /** Foreign input: `[A-Za-z0-9_-]`, 16 to 64 characters. */
  parse(raw: string): Result<ClientOperationId, PrimitiveError> {
    return CLIENT_OPERATION_ID.test(raw)
      ? Result.ok(raw as ClientOperationId)
      : Result.err(
          PrimitiveError.of(
            PrimitiveErrorCode.ClientOperationIdInvalid,
            raw,
            'ClientOperationId',
          ),
        );
  },
  /** The guard — anything, a string of the key's shape or not. */
  is(raw: unknown): raw is ClientOperationId {
    return typeof raw === 'string' && CLIENT_OPERATION_ID.test(raw);
  },
  /**
   * The client-minted id `payload[field]` carries, else `null` — never an
   * unvalidated string (WS-4.1): `payload` a record, `field` its OWN
   * property (an inherited `operationId` is no id the caller sent), its
   * value of the key's shape. How the edge reads an operation id from a
   * callable payload, and how the web's callable client asks whether the
   * input already names one. No allocation.
   */
  inPayload(payload: unknown, field: string): ClientOperationId | null {
    if (!StoredFields.isRecord(payload) || !Object.hasOwn(payload, field)) {
      return null;
    }
    const raw = payload[field];
    return typeof raw === 'string' && CLIENT_OPERATION_ID.test(raw)
      ? (raw as ClientOperationId)
      : null;
  },
} as const;

/**
 * A guest's key on the wire (4A-12) — the cart's seat key (`guest-3`), so
 * two DIFFERENT guests under one label can be told apart. Charset and
 * length are bounded because the server reads it from an untrusted payload;
 * a key that does not fit is dropped there (`null`), never refused (was the
 * legacy `isGuestKey`).
 */
export type GuestKey = Brand<string, 'GuestKey'>;
export const GuestKey = {
  /** Foreign input: `[A-Za-z0-9_-]`, 1 to 64 characters. */
  parse(raw: string): Result<GuestKey, PrimitiveError> {
    return GUEST_KEY.test(raw)
      ? Result.ok(raw as GuestKey)
      : Result.err(
          PrimitiveError.of(
            PrimitiveErrorCode.GuestKeyInvalid,
            raw,
            'GuestKey',
          ),
        );
  },
  /** The guard — anything, a string of the key's shape or not. */
  is(raw: unknown): raw is GuestKey {
    return typeof raw === 'string' && GUEST_KEY.test(raw);
  },
} as const;

/* ── Identity (D29) ─────────────────────────────────────────────────────── */

/**
 * The Firebase Auth uid — the ACCOUNT: who acted, who is notified, who may
 * read. Never a `CustomerId`; never cast to (L7) — made by
 * `UserId.of/parse` only.
 */
export type UserId = Brand<string, 'UserId'>;
export const UserId = idCompanion('UserId');

/**
 * The client RECORD (`customers/{id}`, D29) — whom the shop served, billed or
 * rewarded. Never a `UserId` and never assignable to one: a record may
 * reference an account through an explicit `userId` field, never by sharing
 * a value. Minted only by {@link CustomerId.forUser} (an account holder) or
 * {@link CustomerId.forWalkIn} (a walk-in the desk took a contact for,
 * OR-26) — nothing converts a uid string into one.
 */
export type CustomerId = Brand<string, 'CustomerId'>;
export const CustomerId = {
  ...idCompanion('CustomerId'),
  /**
   * The deterministic record id of an account holder: `cus_` + the first 20
   * hex digits of `hash('customer/v1:' + userId)`. `hash` is the pipeline's
   * `Hash` port (sha256 hex in production) — a primitive never imports a port.
   */
  forUser(userId: UserId, hash: (input: string) => string): CustomerId {
    return `cus_${hash(`customer/v1:${userId}`).slice(0, 20)}` as CustomerId;
  },
  /**
   * The deterministic record id of a walk-in (OR-26): `cus_` + the first 20
   * hex digits of `keyedHash('walkin/v1:' + contactKey)`, where `contactKey`
   * is the walk-in's E.164 phone, or else their lower-cased e-mail
   * (`CustomerRecordSystem.walkInKey` builds it). The same number twice is
   * the same record, and a retried save meets the record it already
   * created — dedupe and idempotency with no query. Its own namespace, so a
   * walk-in's id never equals an account holder's.
   *
   * `keyedHash` is the pipeline's `KeyedHash` port (HMAC-SHA-256 under the
   * server's `WALKIN_ID_KEY` in production), never the plain `Hash`: the id
   * sits on every visit that seats the walk-in, where the visit's owner can
   * read it, and an unkeyed digest of a phone number gives the number back
   * to anyone who tries the country's few tens of millions of candidates.
   */
  forWalkIn(
    contactKey: string,
    keyedHash: (input: string) => string,
  ): CustomerId {
    return `cus_${keyedHash(`walkin/v1:${contactKey}`).slice(0, 20)}` as CustomerId;
  },
} as const;

/** A one-time-password challenge (`otps/{id}`). */
export type OtpId = Brand<string, 'OtpId'>;
export const OtpId = idCompanion('OtpId');

/** An impersonation session (`impersonationSessions/{id}`). */
export type ImpersonationSessionId = Brand<string, 'ImpersonationSessionId'>;
export const ImpersonationSessionId = idCompanion('ImpersonationSessionId');

/** An invitation (`invitations/{id}`). */
export type InvitationId = Brand<string, 'InvitationId'>;
export const InvitationId = idCompanion('InvitationId');

/** An inbox notification (`users/{uid}/notifications/{id}`). */
export type NotificationId = Brand<string, 'NotificationId'>;
export const NotificationId = idCompanion('NotificationId');

/** A media reference (an avatar, a cover, a photo object). */
export type MediaRefId = Brand<string, 'MediaRefId'>;
export const MediaRefId = idCompanion('MediaRefId');

/* ── Governance and operations ──────────────────────────────────────────── */

/** An audit row (`auditLog/{id}`, id `hash(rowBasis)`). */
export type AuditEntryId = Brand<string, 'AuditEntryId'>;
export const AuditEntryId = idCompanion('AuditEntryId');

/** A backfill job (`backfillJobs/{id}`). */
export type BackfillJobId = Brand<string, 'BackfillJobId'>;
export const BackfillJobId = idCompanion('BackfillJobId');

/** The policy-recompute job (`backfillJobs/clientStatsPolicy`). */
export type PolicyRecomputeJobId = Brand<string, 'PolicyRecomputeJobId'>;
export const PolicyRecomputeJobId = {
  ...idCompanion('PolicyRecomputeJobId'),
  /** The one document id there is (`POLICY_RECOMPUTE_JOB`) — a stable path key (OQ-9). */
  FIXED: 'clientStatsPolicy' as PolicyRecomputeJobId,
} as const;

/** The client-money record (`clientStats/{uid}/restricted/money`). */
export type ClientMoneyStatsId = Brand<string, 'ClientMoneyStatsId'>;
export const ClientMoneyStatsId = {
  ...idCompanion('ClientMoneyStatsId'),
  /** The one document id there is (`CLIENT_MONEY_DOC`). */
  FIXED: 'money' as ClientMoneyStatsId,
} as const;

/** A request id of a streak publish (today `StreakDefinitionVersion.requestId`). */
export type PublishRequestId = Brand<string, 'PublishRequestId'>;
export const PublishRequestId = idCompanion('PublishRequestId');

/** A correlation id tying journal entries of one operation together. */
export type CorrelationId = Brand<string, 'CorrelationId'>;
export const CorrelationId = idCompanion('CorrelationId');

/* ── Engagement and loyalty ─────────────────────────────────────────────── */

/** A coupon (`coupons/{id}`). */
export type CouponId = Brand<string, 'CouponId'>;
export const CouponId = idCompanion('CouponId');

/** A coupon grant (`couponGrants/{id}`). */
export type CouponGrantId = Brand<string, 'CouponGrantId'>;
export const CouponGrantId = idCompanion('CouponGrantId');

/** A gift voucher (`giftVouchers/{id}`). */
export type GiftVoucherId = Brand<string, 'GiftVoucherId'>;
export const GiftVoucherId = idCompanion('GiftVoucherId');

/** A course (`courses/{id}`). */
export type CourseId = Brand<string, 'CourseId'>;
export const CourseId = idCompanion('CourseId');

/** A shop event (`events/{id}`). */
export type EventId = Brand<string, 'EventId'>;
export const EventId = idCompanion('EventId');

/** An open position (`positions/{id}`). */
export type PositionId = Brand<string, 'PositionId'>;
export const PositionId = idCompanion('PositionId');

/** A badge category (`badgeCategories/{id}`). */
export type BadgeCategoryId = Brand<string, 'BadgeCategoryId'>;
export const BadgeCategoryId = idCompanion('BadgeCategoryId');

/** A badge series (`badgeSeries/{id}`) — was `SeriesId`. */
export type BadgeSeriesId = Brand<string, 'BadgeSeriesId'>;
export const BadgeSeriesId = idCompanion('BadgeSeriesId');

/** A season (`seasons/{id}`). */
export type SeasonId = Brand<string, 'SeasonId'>;
export const SeasonId = idCompanion('SeasonId');

/** A tier definition (`tierDefinitions/{id}`). */
export type TierId = Brand<string, 'TierId'>;
export const TierId = idCompanion('TierId');

/** A reward of the catalogue (`rewardsCatalog/{id}`). */
export type RewardId = Brand<string, 'RewardId'>;
export const RewardId = idCompanion('RewardId');

/** The streak definition head (`streakDefinitions/{id}`). */
export type StreakDefinitionId = Brand<string, 'StreakDefinitionId'>;
export const StreakDefinitionId = idCompanion('StreakDefinitionId');

/** A published version of a streak definition — the version padded to six digits. */
export type StreakDefinitionVersionId = Brand<
  string,
  'StreakDefinitionVersionId'
>;
export const StreakDefinitionVersionId = {
  ...idCompanion('StreakDefinitionVersionId'),
  /** A version's document id: six-digit zero padding, so history sorts by id. */
  forVersion(version: number): StreakDefinitionVersionId {
    return String(version).padStart(6, '0') as StreakDefinitionVersionId;
  },
} as const;

/**
 * A journal entry (`clientJournal/{id}`, id `{customerId}_{seq:06}`) — keyed
 * by the client RECORD it rewarded (D29), never by an account.
 */
export type JournalEntryId = Brand<string, 'JournalEntryId'>;
export const JournalEntryId = {
  ...idCompanion('JournalEntryId'),
  /**
   * The id of a client record's `seq`-th entry: `${customerId}_${seq:06}` —
   * the zero padding makes document ids sort as the ledger does.
   */
  forEntry(customerId: CustomerId, seq: number): JournalEntryId {
    return `${customerId}_${String(seq).padStart(6, '0')}` as JournalEntryId;
  },
} as const;

/** A reward redemption recorded in the journal. */
export type RedemptionId = Brand<string, 'RedemptionId'>;
export const RedemptionId = idCompanion('RedemptionId');

/** A loyalty pause recorded in the journal. */
export type PauseId = Brand<string, 'PauseId'>;
export const PauseId = idCompanion('PauseId');

/** A manual points adjustment recorded in the journal. */
export type AdjustmentId = Brand<string, 'AdjustmentId'>;
export const AdjustmentId = idCompanion('AdjustmentId');

/** An achievement rule (a badge level's, a punch card's, a journal source's `ruleId`). */
export type AchievementRuleId = Brand<string, 'AchievementRuleId'>;
export const AchievementRuleId = idCompanion('AchievementRuleId');

/** The event a RULE journal source answers (today its `eventId`). */
export type JournalEventId = Brand<string, 'JournalEventId'>;
export const JournalEventId = idCompanion('JournalEventId');

/** The batch a MIGRATION journal source belongs to (today its `batchId`). */
export type MigrationBatchId = Brand<string, 'MigrationBatchId'>;
export const MigrationBatchId = idCompanion('MigrationBatchId');

/**
 * A delivered CloudEvent's own id (`event.id`) — the key a retrying
 * trigger's attempt line names its delivery by (stats-ops, L3).
 */
export type TriggerEventId = Brand<string, 'TriggerEventId'>;
export const TriggerEventId = idCompanion('TriggerEventId');

/* ── Keys that are not plain ids ────────────────────────────────────────── */

/** `Collections.StreakDefinitions` — restated so a primitive imports no registry (spec-checked). */
const STREAK_DEFINITIONS = 'streakDefinitions';

/** `Collections.ImpersonationSessions` — restated likewise (spec-checked). */
const IMPERSONATION_SESSIONS = 'impersonationSessions';

/** `Collections.Otps` — restated likewise (spec-checked). */
const OTPS = 'otps';

/** `Collections.Customers` — restated likewise (spec-checked). */
const CUSTOMERS = 'customers';

/**
 * The resource an audit row names — the one id whose text may hold ONE `/`
 * (`users/{uid}`, `streakDefinitions/{id}`, `impersonationSessions/{id}`,
 * `otps/{id}`, `customers/{id}`),
 * so it has its own companion instead of the plain one: one `for*` door per
 * spelling a writer derives from a brand. A governed document's
 * `<path>/<docId>` (audit-hardening WS-3, RU-40) arrives as foreign text
 * from the trigger's path and becomes a brand through `parse` alone, at the
 * wire edge (Law 7.4) — there is no door taking a raw collection or id.
 */
export type AuditResourceId = Brand<string, 'AuditResourceId'>;
export const AuditResourceId = {
  /** Foreign input: non-empty and at most one `/`. */
  parse(raw: string): Result<AuditResourceId, PrimitiveError> {
    const slash = raw.indexOf('/');
    return raw.trim().length === 0 ||
      (slash >= 0 && raw.indexOf('/', slash + 1) >= 0)
      ? Result.err(
          PrimitiveError.of(
            PrimitiveErrorCode.AuditResourceIdInvalid,
            raw,
            'AuditResourceId',
          ),
        )
      : Result.ok(raw as AuditResourceId);
  },
  /** An appointment row names the bare appointment id. */
  forAppointment(id: AppointmentId): AuditResourceId {
    return id as string as AuditResourceId;
  },
  /** A profile row names `users/{uid}`. */
  forUser(id: UserId): AuditResourceId {
    return `users/${id}` as AuditResourceId;
  },
  /** A streak-definition row names `streakDefinitions/{id}`. */
  forStreakDefinition(id: StreakDefinitionId): AuditResourceId {
    return `${STREAK_DEFINITIONS}/${id}` as AuditResourceId;
  },
  /** An impersonation row names `impersonationSessions/{id}` (audit-hardening WS-3). */
  forImpersonationSession(id: ImpersonationSessionId): AuditResourceId {
    return `${IMPERSONATION_SESSIONS}/${id}` as AuditResourceId;
  },
  /** A pre-session sign-in row names its challenge, `otps/{id}` (audit-hardening Phase 3 WS-B). */
  forOtp(id: OtpId): AuditResourceId {
    return `${OTPS}/${id}` as AuditResourceId;
  },
  /** A data-subject row (an export, an erasure) names the client record, `customers/{id}` (audit-hardening Phase 3 WS-C). */
  forCustomer(id: CustomerId): AuditResourceId {
    return `${CUSTOMERS}/${id}` as AuditResourceId;
  },
} as const;

/**
 * The text a cart seat is told apart by — a key brand, not an entity id:
 * `self`, `guest-…` or `companion-<uid>`, unchanged — built by
 * `SeatKey.text(key)` in `seat-key.data.ts`. The party PERSON key family
 * (`self`, `account:<uid>`, `guest:<label>`) it once carried too (pass D,
 * D-3) is its own brand since OR-49 (`PersonKey`, `person-key.primitive.ts`):
 * the two only share the `self` spelling, and neither is assignable to the
 * other.
 */
export type SeatKeyText = Brand<string, 'SeatKeyText'>;
export const SeatKeyText = {
  /** Foreign input: non-empty. */
  parse(raw: string): Result<SeatKeyText, PrimitiveError> {
    return raw.trim().length === 0
      ? Result.err(
          PrimitiveError.of(
            PrimitiveErrorCode.SeatKeyTextEmpty,
            raw,
            'SeatKeyText',
          ),
        )
      : Result.ok(raw as SeatKeyText);
  },
  /** A key text that is one by construction. */
  of(raw: string): SeatKeyText {
    return raw as SeatKeyText;
  },
} as const;

/** The key a service picked before anyone was named sits on (a staff sheet's draft). */
const DRAFT_PLACEHOLDER = 'primary';
/**
 * The prefix of a stranger's draft key — a walk-in by label
 * (`guest-<label>`) or a person minted on the add-client page
 * (`guest-<base36>-<n>`). Never an account's.
 */
const DRAFT_GUEST_PREFIX = 'guest-';

/**
 * A person's key in a staff sheet's DRAFT (the visit editor and the
 * dashboard's rows) — UI draft read-state minted only inside the editor,
 * never sent on the wire as itself. Three spellings, byte-identical to the
 * sheet's: an account's uid AS IS, `guest-<label>` (a walk-in by its label,
 * Cyrillic included — `guest-Мария`) or `guest-<base36>-<n>` (minted on the
 * add-client page), and {@link DraftPersonKey.PLACEHOLDER} (`primary`).
 * Why none of the other key brands: not a `GuestId` (a draft key may be a
 * bare uid or `primary`), not a `GuestKey` (its typed label fails the wire
 * charset), not a {@link SeatKeyText} (never `self`/`companion-…`/
 * `account:…`).
 */
export type DraftPersonKey = Brand<string, 'DraftPersonKey'>;
export const DraftPersonKey = {
  /** The placeholder a service picked before anyone was named sits on — `primary`. */
  PLACEHOLDER: DRAFT_PLACEHOLDER as DraftPersonKey,

  /** An account's key — its uid, as is. */
  account(id: UserId): DraftPersonKey {
    return id as string as DraftPersonKey;
  },

  /** A walk-in by its label — `guest-<label>`. */
  guest(label: string): DraftPersonKey {
    return `${DRAFT_GUEST_PREFIX}${label}` as DraftPersonKey;
  },

  /** A person minted on the add-client page — `guest-<base36>-<n>`. */
  minted(base36: string, n: number): DraftPersonKey {
    return `${DRAFT_GUEST_PREFIX}${base36}-${n}` as DraftPersonKey;
  },

  /**
   * Foreign input (a design-system option id handed back as a plain string):
   * exactly the three spellings the sheet mints, byte for byte —
   * {@link DraftPersonKey.PLACEHOLDER} (`primary`), `guest-<rest>` with a
   * non-empty rest (a typed label as is, Cyrillic, spaces or `/` included),
   * or an account's uid as `UserId.parse` takes it (non-blank, no `/`,
   * not reserved). Anything else is that refusal (`PRIMITIVE_ID_EMPTY` /
   * `PRIMITIVE_ID_HAS_SLASH` / `PRIMITIVE_ID_RESERVED`), named for this
   * brand.
   */
  parse(raw: string): Result<DraftPersonKey, PrimitiveError> {
    if (
      raw === DRAFT_PLACEHOLDER ||
      (raw.startsWith(DRAFT_GUEST_PREFIX) &&
        raw.length > DRAFT_GUEST_PREFIX.length)
    ) {
      return Result.ok(raw as DraftPersonKey);
    }
    const account = UserId.parse(raw);
    return account.ok
      ? Result.ok(raw as DraftPersonKey)
      : Result.err(
          PrimitiveError.of(account.error.errorCode, raw, 'DraftPersonKey'),
        );
  },

  /** A key that is one by construction (a key the sheet minted, a fixture literal). */
  of(raw: string): DraftPersonKey {
    return raw as DraftPersonKey;
  },

  /**
   * The ACCOUNT a draft key names — `null` for the placeholder and for a
   * stranger's `guest-…` key. Every other key is an account's uid, through
   * `UserId.parse` (a refused key — blank, one that would name a nested
   * document, or a reserved name — is no account).
   */
  accountOf(key: DraftPersonKey): UserId | null {
    if (key === DRAFT_PLACEHOLDER || key.startsWith(DRAFT_GUEST_PREFIX)) {
      return null;
    }
    const account = UserId.parse(key);
    return account.ok ? account.value : null;
  },
} as const;
