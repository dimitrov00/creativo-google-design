import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from 'firebase/firestore';
import { PhotoOrigin } from '@core/components';
import {
  AppointmentId,
  BarberId,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { RepositoryError, RepositoryErrorCode } from '@core/errors';
import type { AppointmentNote, AppointmentPhoto } from '@core/entities';
import type { ClockPorts, IdPorts } from '@core/ports';
import {
  type VisitPhotoSubject,
  adoptVisitPhoto,
  appendTeamNote,
  attachVisitPhoto,
  saveTeamNote,
} from '@core/pipelines';
import {
  appointmentFixture,
  bodyOf,
  customerOf,
  memoryAppointmentPhotoPorts,
  recordingTelemetry,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { appointmentNotePorts } from './appointment-notes.adapter';
import { guardedReads } from './observe';

/*
 * The LIVE writers of the two browser-written collections under the real
 * `firestore.rules` (audit hardening WS-3.4, DEP-15, DEP-16): the rules now
 * demand the caller's uid as the author and a stamp within ±300 s of the
 * server's clock, so every body the web actually writes must still pass.
 *
 * - Notes: `saveTeamNote` (a straight write, and a delete) and
 *   `appendTeamNote` (a transaction) over the notes adapter ITSELF
 *   (`appointmentNotePorts`, the composition root's `guardedReads`).
 * - Photos: `attachVisitPhoto` and `adoptVisitPhoto` over memory ports —
 *   this spec drives no Storage emulator (`test:emulator` starts one since
 *   audit-hardening Phase 3, for the functions' erasure proof only) — with
 *   the document written by the storage adapter's own line,
 *   `setDoc(doc(db, 'appointmentPhotos', id), body)`
 *   (`appointment-photos.adapter.ts` `saveAppointmentPhoto`).
 *
 * The clock the pipelines read is the EMULATOR's (`emulatorNowMs`, RU-18):
 * the rule judges `request.time`, which no spec can pin.
 *
 * Since security hardening S-DEP-5 a note or a photo must name a visit that
 * exists, and a photo id is UUID-shaped (its one minter is the browser's
 * `crypto.randomUUID()`): each case runs on a seeded `appointments/appt-1`,
 * and the photo writer's id source answers {@link PHOTO_ID}.
 */

const APPOINTMENT = AppointmentId.of('appt-1');
const NOTE_PATH = `appointmentNotes/${APPOINTMENT}`;

/** The id every photo below is written under — UUID-shaped, as `browserIdPorts` mints. */
const PHOTO_ID = '7c3e9a51-2f4b-4d8e-9a6c-0b1d2e3f4a5b';

/** The photo pipelines' id source: one photo per case, so one fixed UUID. */
const photoIds: IdPorts = { nextId: () => PHOTO_ID };

/** The book's two workers: the author of each write is its caller. */
const IVAN = 'staff-ivan';
const MARIA = 'staff-maria';

describe('the visit-media writers under firestore.rules (emulator)', () => {
  let testEnv: RulesTestEnvironment;
  let telemetry = recordingTelemetry();

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-visit-media-writers');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    telemetry = recordingTelemetry();
    await testEnv.clearFirestore();
    // The visit every note and photo below names (rules off — appointments
    // are callable-only): `firestore.rules` admits neither for a visit that
    // does not exist (S-DEP-5).
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), `appointments/${APPOINTMENT}`),
        bodyOf(appointmentFixture()),
      );
    });
  });

  /** A signed-in caller whose ID token carries exactly these role claims. */
  function signedIn(uid: string, ...roles: string[]): RulesTestContext {
    return testEnv.authenticatedContext(uid, { roles });
  }

  /**
   * THE ONE READ OF THE EMULATOR'S CLOCK in this file (RU-18): a
   * `serverTimestamp()` written (rules off) to a probe document and read
   * back, the probe then removed — the instant `request.time` stands at,
   * read immediately before the write it times.
   */
  async function emulatorNowMs(): Promise<UtcEpochMs> {
    // Assigned inside the callback: typed wide so the check below is real.
    let at = null as number | null;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const probe = doc(ctx.firestore(), 'clockProbes/now');
      await setDoc(probe, { at: serverTimestamp() });
      const read = (await getDoc(probe)).get('at') as Timestamp;
      at = read.toMillis();
      await deleteDoc(probe);
    });
    if (at === null) throw new Error('emulatorNowMs: the probe read nothing');
    return unwrapOk(UtcEpochMs.of(at));
  }

  /** A clock that answers `instants` in order, one per read — and refuses a read too many. */
  function clockReading(...instants: UtcEpochMs[]): ClockPorts {
    const queue = [...instants];
    return {
      nowUtcMs: () => {
        const next = queue.shift();
        if (next === undefined) throw new Error('the clock was read too often');
        return next;
      },
    };
  }

  /** What is stored at `path`, read with the rules off. */
  async function stored(path: string): Promise<Record<string, unknown> | null> {
    let data = null as Record<string, unknown> | null;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), path));
      data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
    });
    return data;
  }

  describe('team notes — the notes adapter itself', () => {
    /** The notes adapter as `uid` (a barber), and a clock reading `instants`. */
    const notesFor = (uid: string, ...instants: UtcEpochMs[]) => ({
      ...appointmentNotePorts(
        modularFirestore(signedIn(uid, 'barber')),
        guardedReads(telemetry),
      ),
      ...clockReading(...instants),
    });

    it('saves a note its caller wrote, stamped by the emulator’s clock (`saveTeamNote`)', async () => {
      const now = await emulatorNowMs();
      const note = unwrapOk(
        await saveTeamNote(notesFor(IVAN, now))({
          appointmentId: APPOINTMENT,
          text: '  Иска същото като миналия път.  ',
          authorUserId: UserId.of(IVAN),
        }),
      );

      expect(note).toEqual({
        id: APPOINTMENT,
        text: 'Иска същото като миналия път.',
        authorUserId: UserId.of(IVAN),
        writtenAtUtcMs: now,
      } satisfies AppointmentNote);
      expect(await stored(NOTE_PATH)).toEqual({
        text: 'Иска същото като миналия път.',
        authorUserId: IVAN,
        writtenAtUtcMs: now,
      });
    });

    it('appends a line below another worker’s note in one transaction (`appendTeamNote`)', async () => {
      unwrapOk(
        await saveTeamNote(notesFor(IVAN, await emulatorNowMs()))({
          appointmentId: APPOINTMENT,
          text: 'Иска същото.',
          authorUserId: UserId.of(IVAN),
        }),
      );

      const now = await emulatorNowMs();
      const appended = unwrapOk(
        await appendTeamNote(notesFor(MARIA, now))({
          appointmentId: APPOINTMENT,
          line: 'Отказа по телефона.',
          authorUserId: UserId.of(MARIA),
        }),
      );

      expect(appended?.authorUserId).toBe(MARIA);
      expect(appended?.writtenAtUtcMs).toBe(now);
      expect(await stored(NOTE_PATH)).toEqual({
        text: appended?.text,
        authorUserId: MARIA,
        writtenAtUtcMs: now,
      });
      expect(telemetry.lines).toEqual([]);
    });

    it('lets another worker clear the note — an empty note deletes the document', async () => {
      unwrapOk(
        await saveTeamNote(notesFor(IVAN, await emulatorNowMs()))({
          appointmentId: APPOINTMENT,
          text: 'Иска същото.',
          authorUserId: UserId.of(IVAN),
        }),
      );

      // A delete reads no clock: an empty one would refuse a read.
      const cleared = await saveTeamNote(notesFor(MARIA))({
        appointmentId: APPOINTMENT,
        text: '   ',
        authorUserId: UserId.of(MARIA),
      });

      expect(unwrapOk(cleared)).toBeNull();
      expect(await stored(NOTE_PATH)).toBeNull();
    });

    it('answers a write naming someone else, or nobody, as the store’s refusal — and writes nothing', async () => {
      for (const authorUserId of [UserId.of(MARIA), null]) {
        const refused = await saveTeamNote(
          notesFor(IVAN, await emulatorNowMs()),
        )({
          appointmentId: APPOINTMENT,
          text: 'Иска същото.',
          authorUserId,
        });
        expect(unwrapErr(refused).errorCode).toBe(
          RepositoryErrorCode.WriteFailed,
        );
      }
      expect(await stored(NOTE_PATH)).toBeNull();
    });
  });

  describe('visit photos — the pipelines’ bodies, written with the storage adapter’s own line', () => {
    const subject = (takenBy: string | null): VisitPhotoSubject => ({
      appointmentId: APPOINTMENT,
      barberId: BarberId.of('ivan'),
      clientCustomerId: customerOf(UserId.of('client-1')),
      clientLabel: 'Иван Петров',
      takenByUserId: takenBy === null ? null : UserId.of(takenBy),
    });

    /** The photo ports over memory, the document saved exactly as `appointmentPhotoPorts` saves it. */
    function photosFor(uid: string, clock: ClockPorts) {
      const db = modularFirestore(signedIn(uid, 'barber'));
      const photos: AppointmentPhoto[] = [];
      return {
        ...memoryAppointmentPhotoPorts(photos),
        ...photoIds,
        ...clock,
        saveAppointmentPhoto: async (
          photo: AppointmentPhoto,
        ): Promise<Result<void, RepositoryError>> => {
          const { id, ...body } = photo;
          try {
            await setDoc(doc(db, 'appointmentPhotos', id), body);
            return Result.ok(undefined);
          } catch {
            return Result.err(
              RepositoryError.writeFailed(`appointmentPhotos/${id}`, 'denied'),
            );
          }
        },
      };
    }

    const image = { type: 'image/jpeg', size: 2048 } as unknown as Blob;

    it('saves a shot whose upload outlasted the window — its document stamp is read after the bytes are up (L6, DEP-16)', async () => {
      const landed = await emulatorNowMs();
      // The shutter was pressed six minutes before the upload finished: a
      // stamp read then would be refused; the document carries `landed`.
      const pressed = UtcEpochMs.plusMs(landed, -360_000);
      const photo = unwrapOk(
        await attachVisitPhoto(photosFor(IVAN, clockReading(pressed, landed)))({
          ...subject(IVAN),
          image,
          width: 1280,
          height: 960,
        }),
      );

      expect(photo.takenAtUtcMs).toBe(landed);
      expect(photo.takenByUserId).toBe(IVAN);
      expect(photo.id).toBe(PHOTO_ID);
      expect(await stored(`appointmentPhotos/${photo.id}`)).toMatchObject({
        takenByUserId: IVAN,
        takenAtUtcMs: landed,
        photoOrigin: PhotoOrigin.Shot,
        path: `appointmentPhotos/${APPOINTMENT}/${PHOTO_ID}`,
      });
    });

    it('saves a library picture adopted onto the visit, stamped at the adoption', async () => {
      const now = await emulatorNowMs();
      const photo = unwrapOk(
        await adoptVisitPhoto(photosFor(MARIA, clockReading(now)))({
          ...subject(MARIA),
          path: '/work/fade.jpg',
          url: 'https://media.test/work/fade.jpg',
          label: 'Фейд · витрина',
        }),
      );

      expect(await stored(`appointmentPhotos/${photo.id}`)).toMatchObject({
        takenByUserId: MARIA,
        takenAtUtcMs: now,
        photoOrigin: PhotoOrigin.Library,
      });
    });

    it('answers a photo with no signed-in taker as the store’s refusal', async () => {
      const now = await emulatorNowMs();
      const refused = await adoptVisitPhoto(photosFor(IVAN, clockReading(now)))(
        {
          ...subject(null),
          path: '/work/fade.jpg',
          url: 'https://media.test/work/fade.jpg',
          label: null,
        },
      );

      expect(unwrapErr(refused).errorCode).toBe(
        RepositoryErrorCode.WriteFailed,
      );
      expect(await stored(`appointmentPhotos/${PHOTO_ID}`)).toBeNull();
    });
  });
});
