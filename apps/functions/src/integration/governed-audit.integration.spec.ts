import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import {
  Actor,
  AuditAction,
  AuditTargetRef,
  GovernedCollection,
  SystemSource,
} from '@core/components';
import { CustomerId, UserId } from '@core/primitives';
import { Collections } from '@core/entities';
import { auditDocumentChange } from '@core/pipelines';
import { pinnedNowUtcMs, recordingTelemetry, utcMs } from '@core/testing';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreAuditPorts } from '../adapters/firestore-audit.adapter';
import {
  type AuthDocumentWriteEvent,
  decodeDocumentChangeEvent,
} from '../wire/triggers.wire';

/**
 * The document-change audit (audit-hardening WS-3, RU-40) against the REAL
 * Firestore emulator: a write made through the Admin SDK, its two sides
 * read back as the platform's snapshots, decoded by the ONE decoder
 * (`decodeDocumentChangeEvent`) and audited by the ONE pipeline
 * (`auditDocumentChange`) over the real audit adapter — a note, a photo, a
 * customer record, a schedule exception and its DELETE each become ONE
 * `GOVERNED_DOC_*` row named by field (never a value), credited to the
 * writer the auth context names; a redelivered event writes nothing new.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-governed-audit';

const FIRESTORE_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!FIRESTORE_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const EVENT_TIME = '2026-10-11T07:00:00.000Z';
const BARBER = 'u-barber';
/** A browser write: the auth context names the end user's uid, nothing else. */
const BROWSER = { authType: 'unknown', authId: BARBER } as const;
/** An Admin-SDK or console write. */
const CONSOLE = { authType: 'service_account' } as const;

/** A value no row may ever carry — the note's own words (R36). */
const NOTE_TEXT = 'Fade, two on the sides, keep the fringe';

describe('auditDocumentChange over decodeDocumentChangeEvent (emulator)', () => {
  let db: Firestore;

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
  });

  afterAll(async () => {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  beforeEach(async () => {
    await fetch(
      `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
  });

  /**
   * One write, as the trigger sees it: the document read before and after
   * `write` runs, the event's id, time and auth context beside them.
   */
  async function writeOf(
    ref: DocumentReference,
    write: () => Promise<unknown>,
    auth: { readonly authType: string; readonly authId?: string },
    eventId: string,
  ): Promise<AuthDocumentWriteEvent<{ readonly docId: string }>> {
    const before = await ref.get();
    await write();
    const after = await ref.get();
    return {
      id: eventId,
      time: EVENT_TIME,
      params: { docId: ref.id },
      data: { before, after },
      ...auth,
    };
  }

  /** The trigger's handler, minus the edge: decode, then audit. */
  function deliver(
    governedCollection: GovernedCollection,
    event: AuthDocumentWriteEvent<{ readonly docId: string }>,
  ) {
    const telemetry = recordingTelemetry();
    return auditDocumentChange({
      ...firestoreAuditPorts(db, telemetry),
      hash: sha256Hex,
      nowUtcMs: pinnedNowUtcMs(),
    })(decodeDocumentChangeEvent(governedCollection, event));
  }

  const auditRows = async () =>
    (await db.collection(Collections.AuditLog).get()).docs.map((row) =>
      row.data(),
    );

  /** What every governed row of these writes carries beside its own fields. */
  const governedRow = (
    resourceId: string,
    governedCollection: GovernedCollection,
  ) => ({
    recordedAtUtcMs: utcMs(EVENT_TIME),
    resourceId,
    // A trigger row names no operation.
    auditOperationId: null,
    governedCollection,
  });

  it('a note written from the browser: ONE created row, credited to the uid, naming the fields — never the text', async () => {
    const ref = db.doc(`${Collections.AppointmentNotes}/apt-1`);
    const event = await writeOf(
      ref,
      () =>
        ref.set({
          text: NOTE_TEXT,
          authorUserId: BARBER,
          writtenAtUtcMs: utcMs(EVENT_TIME),
        }),
      BROWSER,
      'evt-note',
    );
    expect(await deliver(GovernedCollection.AppointmentNotes, event)).toEqual({
      ok: true,
      value: { rows: 1 },
    });
    const rows = await auditRows();
    expect(rows).toEqual([
      {
        ...governedRow(
          'appointmentNotes/apt-1',
          GovernedCollection.AppointmentNotes,
        ),
        ...Actor.user(UserId.of(BARBER)),
        ...AuditTargetRef.none(),
        auditAction: AuditAction.GovernedDocCreated,
        governedFields: ['authorUserId', 'text', 'writtenAtUtcMs'],
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain(NOTE_TEXT);
  });

  it('a photo document: ONE created row on its own resource', async () => {
    const ref = db.doc(`${Collections.AppointmentPhotos}/ph-1`);
    const event = await writeOf(
      ref,
      () =>
        ref.set({
          appointmentId: 'apt-1',
          storagePath: 'appointment-photos/apt-1/ph-1.jpg',
          takenByUserId: BARBER,
          takenAtUtcMs: utcMs(EVENT_TIME),
        }),
      BROWSER,
      'evt-photo',
    );
    await deliver(GovernedCollection.AppointmentPhotos, event);
    expect(await auditRows()).toEqual([
      expect.objectContaining({
        ...governedRow(
          'appointmentPhotos/ph-1',
          GovernedCollection.AppointmentPhotos,
        ),
        auditAction: AuditAction.GovernedDocCreated,
        governedFields: [
          'appointmentId',
          'storagePath',
          'takenAtUtcMs',
          'takenByUserId',
        ],
      }),
    ]);
  });

  it('a customer record edited by the console: ONE updated row, targeted at the record, naming only what changed', async () => {
    const ref = db.doc(`${Collections.Customers}/cus_1`);
    await ref.set({ firstName: 'Maria', phone: '+359888000001', visits: 3 });
    const event = await writeOf(
      ref,
      () => ref.update({ phone: '+359888000002' }),
      CONSOLE,
      'evt-customer',
    );
    await deliver(GovernedCollection.Customers, event);
    const rows = await auditRows();
    expect(rows).toEqual([
      {
        ...governedRow('customers/cus_1', GovernedCollection.Customers),
        ...Actor.system(SystemSource.AdminSdk),
        ...AuditTargetRef.customer(CustomerId.of('cus_1')),
        auditAction: AuditAction.GovernedDocUpdated,
        governedFields: ['phone'],
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain('+359888000002');
  });

  it('a schedule exception and its DELETE: a created row, then a deleted row listing the before-image’s fields', async () => {
    const ref = db.doc(`${Collections.ScheduleExceptions}/b-ivan__2026-10-12`);
    const created = await writeOf(
      ref,
      () =>
        ref.set({ barberId: 'b-ivan', localDate: '2026-10-12', blocks: [] }),
      CONSOLE,
      'evt-exception-create',
    );
    await deliver(GovernedCollection.ScheduleExceptions, created);
    const deleted = await writeOf(
      ref,
      () => ref.delete(),
      CONSOLE,
      'evt-exception-delete',
    );
    expect(
      await deliver(GovernedCollection.ScheduleExceptions, deleted),
    ).toEqual({ ok: true, value: { rows: 1 } });
    const rows = await auditRows();
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(
      expect.objectContaining({
        ...governedRow(
          'scheduleExceptions/b-ivan__2026-10-12',
          GovernedCollection.ScheduleExceptions,
        ),
        auditAction: AuditAction.GovernedDocDeleted,
        governedFields: ['barberId', 'blocks', 'localDate'],
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        auditAction: AuditAction.GovernedDocCreated,
        governedFields: ['barberId', 'blocks', 'localDate'],
      }),
    );
  });

  it('a redelivered event writes nothing new — the row id is keyed by the event id', async () => {
    const ref = db.doc(`${Collections.AppointmentNotes}/apt-2`);
    const event = await writeOf(
      ref,
      () => ref.set({ text: NOTE_TEXT, authorUserId: BARBER }),
      BROWSER,
      'evt-redelivered',
    );
    expect(await deliver(GovernedCollection.AppointmentNotes, event)).toEqual({
      ok: true,
      value: { rows: 1 },
    });
    const first = await db.collection(Collections.AuditLog).get();
    // The second delivery finds its row already there: a success, no rewrite.
    expect(await deliver(GovernedCollection.AppointmentNotes, event)).toEqual({
      ok: true,
      value: { rows: 1 },
    });
    const second = await db.collection(Collections.AuditLog).get();
    expect(second.size).toBe(1);
    expect(second.docs[0]?.id).toBe(first.docs[0]?.id);
    expect(second.docs[0]?.updateTime.toMillis()).toBe(
      first.docs[0]?.updateTime.toMillis(),
    );
  });

  it('a write that changed no field writes no row', async () => {
    const ref = db.doc(`${Collections.Coupons}/c-1`);
    await ref.set({ code: 'AUTUMN', percentOff: 10 });
    const event = await writeOf(
      ref,
      () => ref.set({ percentOff: 10, code: 'AUTUMN' }),
      CONSOLE,
      'evt-noop',
    );
    expect(await deliver(GovernedCollection.Coupons, event)).toEqual({
      ok: true,
      value: { rows: 0 },
    });
    expect(await auditRows()).toEqual([]);
  });
});
