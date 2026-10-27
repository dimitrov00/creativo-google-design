import {
  type Actor,
  AuditAction,
  AuditContext,
  AuditTarget,
  AuditTargetRef,
  BookingContact,
  ClientPrivacyCall,
  PrivacyMarker,
  type Seat,
  SeatSubject,
  type VoucherRedemption,
} from '@core/components';
import { PrivacyError } from '@core/errors';
import {
  type AppointmentId,
  type AuditEntryId,
  AuditResourceId,
  type CustomerId,
  type OperationId,
  Result,
  type UserId,
  UtcEpochMs,
} from '@core/primitives';
import type {
  Appointment,
  AppointmentNote,
  AppointmentPhoto,
  AuditEntry,
  BadgeProgress,
  ClientMoneyRecord,
  ClientStatsRecord,
  CouponGrant,
  Customer,
  GiftVoucher,
  InboxNotification,
  Invitation,
  JournalEntry,
  LoyaltyAccount,
  SeasonProgress,
  User,
  WaitlistRequest,
} from '@core/entities';
import { type AuditRowPlan, AuditSystem } from './audit.system';
import { CanonicalJsonSystem } from './canonical-json.system';
import {
  type ClientPerson,
  ClientPrivacySystem,
} from './client-privacy.system';

/**
 * The most documents one export holds, audit rows included (P3-L-6): past
 * it the export is REFUSED (`PRIVACY_EXPORT_TOO_LARGE`), never truncated —
 * the pipeline's reads stop at this + 1, so the refusal is certain.
 */
export const EXPORT_MAX_DOCUMENTS = 20_000;

/**
 * The most UTF-8 bytes of canonical JSON one export answers (4 MiB,
 * P3-L-6) — far below a callable's response size; past it, refused whole.
 */
export const EXPORT_MAX_BYTES = 4_194_304;

/**
 * `Omit` distributed over every variant of a union archetype (the `BodyOf`
 * idiom of `streak-publish.system.ts`), so a lifecycle variant keeps its own
 * fields where a plain `Omit` would keep only the keys every variant shares.
 */
type Without<E, K extends PropertyKey> = E extends unknown ? Omit<E, K> : never;

/**
 * What the export pipeline READ about one person (audit-hardening Phase 3,
 * WS-C) — every document as stored (`{ id, ...body }`), zero mapping (Law
 * 5): the record and its linked account, the visits that seat the record,
 * the notes of the visits only the person sat, the photos that may be the
 * person's (every origin naming the record, and those of the person's
 * sole-subject visits), money, loyalty, statistics, the journal, the
 * account's inbox, waitlist requests and invitations, and the audit rows
 * filed against the record or the account. In no promised order: the
 * system orders, filters and redacts.
 */
export type ClientFootprint = {
  readonly record: Customer;
  readonly account: User | null;
  readonly visits: readonly Appointment[];
  readonly notes: readonly AppointmentNote[];
  readonly photos: readonly AppointmentPhoto[];
  readonly couponGrants: readonly CouponGrant[];
  readonly giftVouchers: readonly GiftVoucher[];
  readonly loyaltyAccount: LoyaltyAccount | null;
  readonly badgeProgress: readonly BadgeProgress[];
  readonly seasonProgress: readonly SeasonProgress[];
  readonly clientStats: ClientStatsRecord | null;
  readonly clientMoney: ClientMoneyRecord | null;
  readonly journal: readonly JournalEntry[];
  readonly notifications: readonly InboxNotification[];
  readonly waitlistRequests: readonly WaitlistRequest[];
  readonly invitations: readonly Invitation[];
  readonly auditRows: readonly AuditEntry[];
};

/** A photo as stored, without its tokenised download URL — a bearer capability never leaves in a file (P3-L-5). */
export type ExportedPhoto = Without<AppointmentPhoto, 'url'>;

/** A gift voucher as stored, without its `code` — the bearer secret that spends it (P3-L-5). */
export type ExportedGiftVoucher = Without<GiftVoucher, 'code'>;

/** A visit's voucher line without the `code` presented — a party visit may have been paid with somebody else's voucher. */
export type ExportedVoucherRedemption = Without<VoucherRedemption, 'code'>;

/**
 * A visit as stored, but for the redactions (P3-RU-18): no voucher `code`
 * on any line; on a shared visit the other people's seat labels are
 * markers; a contact not provably the person's is {@link BookingContact.NONE}.
 */
export type ExportedAppointment = Without<Appointment, 'voucherRedemptions'> & {
  readonly voucherRedemptions: readonly ExportedVoucherRedemption[];
};

/**
 * The person's ONE bundle (Art. 15 / 20) — what `exportClientData` answers
 * as canonical JSON (`CanonicalJsonSystem.of`: keys sorted at every depth),
 * each section an array in a fixed order, so the same documents always
 * print the same bytes. The format is {@link ClientPrivacyCall.EXPORT_VERSION}:
 * a change of a section's shape or order bumps it.
 */
export type ClientExportBundle = {
  readonly clientExportVersion: number;
  readonly exportedAtUtcMs: UtcEpochMs;
  readonly exportedCustomerId: CustomerId;
  /** The account the record links (`record.userId`); `null` for a walk-in's record. */
  readonly exportedUserId: UserId | null;
  /** `[record]`. */
  readonly customers: readonly Customer[];
  /** `[]` or `[account]`. */
  readonly users: readonly User[];
  /** Newest `utcEpochMs` first, a tie by id (code units); redacted. */
  readonly appointments: readonly ExportedAppointment[];
  /** The notes of the visits only the person sat (a party note may hold a companion's words — P3-RU-33); by id. */
  readonly appointmentNotes: readonly AppointmentNote[];
  /** The person's photos, by id; no `url`. */
  readonly appointmentPhotos: readonly ExportedPhoto[];
  /** By id; no `code`. */
  readonly giftVouchers: readonly ExportedGiftVoucher[];
  readonly couponGrants: readonly CouponGrant[];
  readonly loyaltyAccounts: readonly LoyaltyAccount[];
  readonly badgeProgress: readonly BadgeProgress[];
  readonly seasonProgress: readonly SeasonProgress[];
  readonly clientStats: readonly ClientStatsRecord[];
  readonly clientMoney: readonly ClientMoneyRecord[];
  /** By id — `{customerId}_{seq:6}`, so in `seq` order. */
  readonly clientJournal: readonly JournalEntry[];
  readonly notifications: readonly InboxNotification[];
  readonly waitlistRequests: readonly WaitlistRequest[];
  readonly invitations: readonly Invitation[];
  /**
   * The rows filed AGAINST the person (`targetCustomerId` = the record,
   * `targetUserId` = the account), in `AuditSystem.chronological` order —
   * never a row where the person is only the actor, never the row this
   * call plans.
   */
  readonly auditLog: readonly AuditEntry[];
};

/** The figures an export's row and outcome carry — counts only, never a value. */
export type ClientExportCounts = {
  /** The documents in the bundle, audit rows included. */
  readonly documentCount: number;
  /** Of those, the audit rows. */
  readonly auditRowCount: number;
  /** The UTF-8 bytes of the canonical JSON. */
  readonly byteCount: number;
};

/** An answered export: the canonical JSON and its figures. */
export type ClientExport = ClientExportCounts & {
  readonly json: string;
};

/**
 * The documents a bundle holds before redaction — the footprint filtered
 * to what is the person's and ordered, the call's own row left out. One
 * derivation for the count and the bundle, so they never disagree.
 */
type Sections = {
  readonly userId: UserId | null;
  readonly visits: readonly Appointment[];
  readonly soleSubjectVisitIds: ReadonlySet<AppointmentId>;
  readonly notes: readonly AppointmentNote[];
  readonly photos: readonly AppointmentPhoto[];
  readonly giftVouchers: readonly GiftVoucher[];
  readonly couponGrants: readonly CouponGrant[];
  readonly badgeProgress: readonly BadgeProgress[];
  readonly seasonProgress: readonly SeasonProgress[];
  readonly journal: readonly JournalEntry[];
  readonly notifications: readonly InboxNotification[];
  readonly waitlistRequests: readonly WaitlistRequest[];
  readonly invitations: readonly Invitation[];
  readonly auditRows: readonly AuditEntry[];
};

/** Code-unit order of two ids — the store's own id order, locale-free. */
function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A sorted copy by id; the input untouched. */
function byId<E extends { readonly id: string }>(
  documents: readonly E[],
): readonly E[] {
  return [...documents].sort((a, b) => byText(a.id, b.id));
}

/** Each id once — the first spelling read wins (two reads may meet one document). */
function distinct<E extends { readonly id: string }>(
  documents: readonly E[],
): readonly E[] {
  const seen = new Set<string>();
  const out: E[] = [];
  for (let i = 0; i < documents.length; i++) {
    const document = documents[i] as E;
    if (seen.has(document.id)) continue;
    seen.add(document.id);
    out.push(document);
  }
  return out;
}

/** `[value]`, or `[]` for none. */
function listOf<E>(value: E | null): readonly E[] {
  return value === null ? [] : [value];
}

/** Whether an audit row is filed against the person — the record, or the linked account. */
function targetsPerson(
  row: AuditEntry,
  customerId: CustomerId,
  userId: UserId | null,
): boolean {
  if (row.auditTarget === AuditTarget.Customer) {
    return row.targetCustomerId === customerId;
  }
  return (
    row.auditTarget === AuditTarget.User &&
    userId !== null &&
    row.targetUserId === userId
  );
}

function sectionsOf(
  footprint: ClientFootprint,
  ownRowId: AuditEntryId,
): Sections {
  const customerId = footprint.record.id;
  const userId = footprint.record.userId;
  const visits: Appointment[] = [];
  const soleSubjectVisitIds = new Set<AppointmentId>();
  const read = distinct(footprint.visits);
  for (let i = 0; i < read.length; i++) {
    const visit = read[i] as Appointment;
    if (!visit.subjectCustomerIds.includes(customerId)) continue;
    visits.push(visit);
    if (ClientPrivacySystem.isSoleSubject(visit, customerId)) {
      soleSubjectVisitIds.add(visit.id);
    }
  }
  visits.sort(
    (a, b) =>
      UtcEpochMs.compare(b.utcEpochMs, a.utcEpochMs) || byText(a.id, b.id),
  );
  const notes: AppointmentNote[] = [];
  for (const note of distinct(footprint.notes)) {
    if (soleSubjectVisitIds.has(note.id)) notes.push(note);
  }
  const photos: AppointmentPhoto[] = [];
  for (const photo of distinct(footprint.photos)) {
    if (
      ClientPrivacySystem.photoIsPersons(photo, soleSubjectVisitIds, customerId)
    ) {
      photos.push(photo);
    }
  }
  const auditRows: AuditEntry[] = [];
  for (const row of distinct(footprint.auditRows)) {
    if (row.id === ownRowId) continue;
    if (targetsPerson(row, customerId, userId)) auditRows.push(row);
  }
  return {
    userId,
    visits,
    soleSubjectVisitIds,
    notes: byId(notes),
    photos: byId(photos),
    giftVouchers: byId(distinct(footprint.giftVouchers)),
    couponGrants: byId(distinct(footprint.couponGrants)),
    badgeProgress: byId(distinct(footprint.badgeProgress)),
    seasonProgress: byId(distinct(footprint.seasonProgress)),
    journal: byId(distinct(footprint.journal)),
    notifications: byId(distinct(footprint.notifications)),
    waitlistRequests: byId(distinct(footprint.waitlistRequests)),
    invitations: byId(distinct(footprint.invitations)),
    auditRows: AuditSystem.chronological(auditRows),
  };
}

function countOf(footprint: ClientFootprint, sections: Sections): number {
  return (
    1 +
    (footprint.account === null ? 0 : 1) +
    sections.visits.length +
    sections.notes.length +
    sections.photos.length +
    sections.giftVouchers.length +
    sections.couponGrants.length +
    (footprint.loyaltyAccount === null ? 0 : 1) +
    sections.badgeProgress.length +
    sections.seasonProgress.length +
    (footprint.clientStats === null ? 0 : 1) +
    (footprint.clientMoney === null ? 0 : 1) +
    sections.journal.length +
    sections.notifications.length +
    sections.waitlistRequests.length +
    sections.invitations.length +
    sections.auditRows.length
  );
}

/**
 * A stored value without one bearer field — every other key as stored (a
 * redaction by KEY, never a rewrite of a value). The variants of a union
 * archetype keep their own fields ({@link Without}).
 */
function withoutKey<E extends object, K extends keyof E & string>(
  document: E,
  key: K,
): Without<E, K> {
  return Object.fromEntries(
    Object.entries(document).filter(([name]) => name !== key),
  ) as Without<E, K>;
}

/**
 * A visit's seats as the person may see them: the person's own seats as
 * stored; every OTHER labelled seat (a guest's, another walk-in's) with its
 * label replaced by a marker `— <n>`, `n` its ordinal among the visit's
 * marked seats; another account's seat (ids only, no label) as stored.
 */
function seatsSeenBy(
  seats: readonly Seat[],
  customerId: CustomerId,
): readonly Seat[] {
  const out: Seat[] = [];
  let marked = 0;
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i] as Seat;
    if (
      seat.seatSubject === SeatSubject.Account ||
      (seat.seatSubject === SeatSubject.WalkIn &&
        seat.subjectCustomerId === customerId)
    ) {
      out.push(seat);
      continue;
    }
    marked++;
    out.push({ ...seat, guestLabel: PrivacyMarker.seatLabel(marked) });
  }
  return out;
}

/** One visit as exported: no voucher code; a shared visit's other labels marked; an unproven contact withheld. */
function exportedVisit(
  visit: Appointment,
  person: ClientPerson,
  soleSubject: boolean,
  walkInHash: (input: string) => string,
): ExportedAppointment {
  const contact = ClientPrivacySystem.contactIsPersons(
    visit,
    person,
    walkInHash,
  )
    ? BookingContact.of(visit)
    : BookingContact.NONE;
  const redemptions: ExportedVoucherRedemption[] = [];
  for (let i = 0; i < visit.voucherRedemptions.length; i++) {
    redemptions.push(
      withoutKey(visit.voucherRedemptions[i] as VoucherRedemption, 'code'),
    );
  }
  return {
    ...visit,
    ...contact,
    seats: soleSubject
      ? visit.seats
      : seatsSeenBy(visit.seats, person.record.id),
    voucherRedemptions: redemptions,
  };
}

function bundleFrom(
  footprint: ClientFootprint,
  sections: Sections,
  exportedAtUtcMs: UtcEpochMs,
  walkInHash: (input: string) => string,
): ClientExportBundle {
  const person: ClientPerson = {
    record: footprint.record,
    account: footprint.account,
  };
  const appointments: ExportedAppointment[] = [];
  for (let i = 0; i < sections.visits.length; i++) {
    const visit = sections.visits[i] as Appointment;
    appointments.push(
      exportedVisit(
        visit,
        person,
        sections.soleSubjectVisitIds.has(visit.id),
        walkInHash,
      ),
    );
  }
  const photos: ExportedPhoto[] = [];
  for (let i = 0; i < sections.photos.length; i++) {
    photos.push(withoutKey(sections.photos[i] as AppointmentPhoto, 'url'));
  }
  const vouchers: ExportedGiftVoucher[] = [];
  for (let i = 0; i < sections.giftVouchers.length; i++) {
    vouchers.push(withoutKey(sections.giftVouchers[i] as GiftVoucher, 'code'));
  }
  return {
    clientExportVersion: ClientPrivacyCall.EXPORT_VERSION,
    exportedAtUtcMs,
    exportedCustomerId: footprint.record.id,
    exportedUserId: sections.userId,
    customers: [footprint.record],
    users: listOf(footprint.account),
    appointments,
    appointmentNotes: sections.notes,
    appointmentPhotos: photos,
    giftVouchers: vouchers,
    couponGrants: sections.couponGrants,
    loyaltyAccounts: listOf(footprint.loyaltyAccount),
    badgeProgress: sections.badgeProgress,
    seasonProgress: sections.seasonProgress,
    clientStats: listOf(footprint.clientStats),
    clientMoney: listOf(footprint.clientMoney),
    clientJournal: sections.journal,
    notifications: sections.notifications,
    waitlistRequests: sections.waitlistRequests,
    invitations: sections.invitations,
    auditLog: sections.auditRows,
  };
}

/**
 * The client export's pure half (audit-hardening Phase 3, WS-C): what of a
 * person's footprint is theirs, in which order, redacted how, how big — and
 * the ONE audit row the act writes. Art. 15 needs the person's data, never
 * another person's values or a bearer capability (P3-L-5): every document
 * the person owns leaves as stored, except that no photo `url` and no
 * voucher `code` (their own or anybody's) is exported, a shared visit's
 * other seats' labels are markers ({@link PrivacyMarker}), a visit contact
 * not provably the person's is withheld
 * ({@link ClientPrivacySystem.contactIsPersons}), and a party visit's note
 * is left out (P3-RU-33). Other people appear only as the opaque ids already
 * on a shared document. No clock, no I/O, no crypto: the instant, the row id
 * and the walk-in key are parameters (Law 3).
 */
export const ClientExportSystem = {
  /**
   * How many documents the bundle of this footprint holds — audit rows
   * included, the call's own row (`ownRowId`) left out, so a replay counts
   * what the first call counted. What the cap is measured on.
   */
  documentCount(footprint: ClientFootprint, ownRowId: AuditEntryId): number {
    return countOf(footprint, sectionsOf(footprint, ownRowId));
  },

  /**
   * The bundle — ordered and redacted. `ownRowId` (the id of the row this
   * call plans, known before the read — {@link ClientExportSystem.rowIdBasis})
   * is left out of `auditLog`, so a replay of one operation id answers the
   * same bytes under one clock.
   */
  bundleOf(
    footprint: ClientFootprint,
    exportedAtUtcMs: UtcEpochMs,
    ownRowId: AuditEntryId,
    walkInHash: (input: string) => string,
  ): ClientExportBundle {
    return bundleFrom(
      footprint,
      sectionsOf(footprint, ownRowId),
      exportedAtUtcMs,
      walkInHash,
    );
  },

  /**
   * The answer, or the refusal — never a truncated bundle: past
   * {@link EXPORT_MAX_DOCUMENTS} documents (refused before a byte is
   * printed, `exportByteCount` 0) or {@link EXPORT_MAX_BYTES} bytes of
   * canonical JSON, `PRIVACY_EXPORT_TOO_LARGE` with how far it reached.
   */
  exportOf(
    footprint: ClientFootprint,
    exportedAtUtcMs: UtcEpochMs,
    ownRowId: AuditEntryId,
    walkInHash: (input: string) => string,
  ): Result<ClientExport, PrivacyError.ExportTooLarge> {
    const sections = sectionsOf(footprint, ownRowId);
    const documentCount = countOf(footprint, sections);
    if (documentCount > EXPORT_MAX_DOCUMENTS) {
      return Result.err(PrivacyError.exportTooLarge(documentCount, 0));
    }
    const json = CanonicalJsonSystem.of(
      bundleFrom(footprint, sections, exportedAtUtcMs, walkInHash),
    );
    const byteCount = CanonicalJsonSystem.utf8Bytes(json);
    if (byteCount > EXPORT_MAX_BYTES) {
      return Result.err(PrivacyError.exportTooLarge(documentCount, byteCount));
    }
    return Result.ok({
      json,
      documentCount,
      auditRowCount: sections.auditRows.length,
      byteCount,
    });
  },

  /**
   * The id basis of the export's row — the verb, the record's resource
   * `customers/<id>`, the record as target, keyed by the act's operation id
   * (`AuditSystem.changeKey.clientExported`). One home: the pipeline hashes
   * it BEFORE the read (the row it must leave out of the bundle, and probe
   * for), {@link ClientExportSystem.planClientExported} carries it.
   */
  rowIdBasis(customerId: CustomerId, operationId: OperationId): string {
    return AuditSystem.idBasisOf(
      AuditAction.PrivacyClientExported,
      AuditResourceId.forCustomer(customerId),
      customerId,
      AuditSystem.changeKey.clientExported(operationId),
    );
  },

  /**
   * The ONE row an export writes (`PRIVACY_CLIENT_EXPORTED`, P3-RU-15):
   * credited to `actor` (the admin, `Actor.forCaller` over the stored
   * roles), naming the record `customers/<id>` and targeting it, with the
   * act's operation id, stamped `nowUtcMs`. Counts only — never the bundle,
   * a section or a value (R36 / T5).
   */
  planClientExported(
    customerId: CustomerId,
    counts: ClientExportCounts,
    actor: Actor,
    operationId: OperationId,
    nowUtcMs: UtcEpochMs,
  ): AuditRowPlan {
    return {
      row: {
        recordedAtUtcMs: nowUtcMs,
        resourceId: AuditResourceId.forCustomer(customerId),
        auditOperationId: operationId,
        ...actor,
        ...AuditContext.clientExported(
          counts.documentCount,
          counts.auditRowCount,
          counts.byteCount,
        ),
        ...AuditTargetRef.customer(customerId),
      },
      idBasis: ClientExportSystem.rowIdBasis(customerId, operationId),
    };
  },
} as const;
