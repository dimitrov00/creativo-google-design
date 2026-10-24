import { describe, expect, it } from 'vitest';
import { PhotoOrigin } from '@core/components';
import { Result, UserId, type UtcEpochMs } from '@core/primitives';
import {
  MediaError,
  MediaErrorCode,
  RepositoryError,
  RepositoryErrorCode,
} from '@core/errors';
import type { AppointmentPhoto } from '@core/entities';
import { MediaSystem } from '@core/systems';
import {
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  memoryAppointmentPhotoPorts,
  memoryClockPorts,
  memoryIdPorts,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import {
  adoptVisitPhoto,
  attachVisitPhoto,
  type VisitPhotoSubject,
} from './attach-visit-photo.pipeline';

/*
 * The visit photo use cases MOVED out of the staff day store (pass C, Y-1,
 * Y-2, D-3, D-10): `attachPhoto` (the guard on the downscaled blob, BEFORE
 * the id or the clock is read; the record; the bytes; the document) and
 * `adoptPhoto` (a library picture: a document, no bytes, no guard), sharing
 * one record builder — the id first, then the taker, then the stamp. In
 * memory, with a pinned clock and id source; the calls each port saw are
 * recorded in order.
 */
const IVAN = UserId.of('dev-staff-ivan');

const subject: VisitPhotoSubject = {
  appointmentId: FIXTURE_IDS.appointment,
  barberId: FIXTURE_IDS.barber,
  clientCustomerId: FIXTURE_IDS.customer,
  clientLabel: 'Ана',
  takenByUserId: IVAN,
};

/** A blob-shaped picture — its type and size are all the guard reads. */
const image = (type: string, size: number): Blob =>
  ({ type, size }) as unknown as Blob;

/** The in-memory photo store, the pinned clock and ids — every port call logged in order. */
function harness(
  overrides: {
    readonly upload?: () => Promise<
      Result<{ path: string; url: string }, MediaError>
    >;
    readonly save?: () => Promise<Result<void, RepositoryError>>;
  } = {},
) {
  const photos: AppointmentPhoto[] = [];
  const calls: string[] = [];
  const store = memoryAppointmentPhotoPorts(photos);
  const ids = memoryIdPorts('photo');
  const clock = memoryClockPorts();
  const ports = {
    ...store,
    nextId: () => {
      calls.push('nextId');
      return ids.nextId();
    },
    nowUtcMs: (): UtcEpochMs => {
      calls.push('nowUtcMs');
      return clock.nowUtcMs();
    },
    uploadPhotoBytes: async (
      ...args: Parameters<typeof store.uploadPhotoBytes>
    ) => {
      calls.push('uploadPhotoBytes');
      return overrides.upload
        ? overrides.upload()
        : store.uploadPhotoBytes(...args);
    },
    saveAppointmentPhoto: async (photo: AppointmentPhoto) => {
      calls.push('saveAppointmentPhoto');
      return overrides.save
        ? overrides.save()
        : store.saveAppointmentPhoto(photo);
    },
  };
  return { ports, photos, calls };
}

describe('attachVisitPhoto — a shutter press onto a visit', () => {
  it('stamps the record, uploads the bytes, then writes the document — and answers the photo', async () => {
    const { ports, photos, calls } = harness();

    const photo = unwrapOk(
      await attachVisitPhoto(ports)({
        ...subject,
        image: image('image/jpeg', 2048),
        width: 1280,
        height: 960,
      }),
    );

    expect(photo).toEqual({
      id: 'photo-1',
      appointmentId: FIXTURE_IDS.appointment,
      barberId: FIXTURE_IDS.barber,
      clientCustomerId: FIXTURE_IDS.customer,
      clientLabel: 'Ана',
      takenByUserId: IVAN,
      takenAtUtcMs: FIXTURE_NOW_UTC_MS,
      width: 1280,
      height: 960,
      photoOrigin: PhotoOrigin.Shot,
      label: null,
      path: 'appointmentPhotos/appt-1/photo-1',
      url: 'memory://appointmentPhotos/appt-1/photo-1',
    });
    expect(photos).toEqual([photo]);
    expect(calls).toEqual([
      'nextId',
      'nowUtcMs',
      'uploadPhotoBytes',
      'saveAppointmentPhoto',
    ]);
  });

  it('refuses what is not an image — before the id, the clock or the upload', async () => {
    const { ports, photos, calls } = harness();

    const refused = await attachVisitPhoto(ports)({
      ...subject,
      image: image('application/pdf', 10),
      width: 10,
      height: 10,
    });

    expect(unwrapErr(refused)).toEqual({
      errorCode: MediaErrorCode.PhotoNotAnImage,
    });
    expect(calls).toEqual([]);
    expect(photos).toEqual([]);
  });

  it('refuses a picture of exactly the 8 MiB limit (DEP-7) — naming the limit, using up no id', async () => {
    const { ports, photos, calls } = harness();

    const refused = await attachVisitPhoto(ports)({
      ...subject,
      image: image('image/jpeg', MediaSystem.PHOTO_MAX_BYTES),
      width: 4000,
      height: 3000,
    });

    expect(unwrapErr(refused)).toEqual({
      errorCode: MediaErrorCode.PhotoTooLarge,
      maxBytes: MediaSystem.PHOTO_MAX_BYTES,
    });
    expect(calls).toEqual([]);
    expect(photos).toEqual([]);

    // One byte under the limit goes up, and takes the FIRST id.
    const taken = unwrapOk(
      await attachVisitPhoto(ports)({
        ...subject,
        image: image('image/jpeg', MediaSystem.PHOTO_MAX_BYTES - 1),
        width: 4000,
        height: 3000,
      }),
    );
    expect(taken.id).toBe('photo-1');
  });

  it('answers the upload’s failure as it comes — and writes no document', async () => {
    const failure = MediaError.transient('appointmentPhotos/appt-1/photo-1');
    const { ports, photos, calls } = harness({
      upload: async () => Result.err(failure),
    });

    const failed = await attachVisitPhoto(ports)({
      ...subject,
      image: image('image/jpeg', 10),
      width: 10,
      height: 10,
    });

    expect(unwrapErr(failed)).toEqual(failure);
    expect(calls).toEqual(['nextId', 'nowUtcMs', 'uploadPhotoBytes']);
    expect(photos).toEqual([]);
  });

  it('answers the save’s failure as it comes', async () => {
    const failure = RepositoryError.writeFailed('appointmentPhotos', 'denied');
    const { ports, calls } = harness({
      save: async () => Result.err(failure),
    });

    const failed = await attachVisitPhoto(ports)({
      ...subject,
      image: image('image/jpeg', 10),
      width: 10,
      height: 10,
    });

    expect(unwrapErr(failed).errorCode).toBe(RepositoryErrorCode.WriteFailed);
    expect(calls).toEqual([
      'nextId',
      'nowUtcMs',
      'uploadPhotoBytes',
      'saveAppointmentPhoto',
    ]);
  });

  it('stamps no taker when nobody is signed in', async () => {
    const { ports } = harness();

    const photo = unwrapOk(
      await attachVisitPhoto(ports)({
        ...subject,
        takenByUserId: null,
        clientCustomerId: null,
        image: image('image/png', 10),
        width: 10,
        height: 10,
      }),
    );

    expect(photo.takenByUserId).toBeNull();
    expect(photo.clientCustomerId).toBeNull();
  });
});

describe('adoptVisitPhoto — one of the shop’s own pictures onto a visit', () => {
  it('writes a LIBRARY document pointing at the library object — id, then stamp, no bytes', async () => {
    const { ports, photos, calls } = harness();

    const photo = unwrapOk(
      await adoptVisitPhoto(ports)({
        ...subject,
        path: '/work/fade.jpg',
        url: 'https://media.test/work/fade.jpg',
        label: 'Фейд · витрина',
      }),
    );

    expect(photo).toEqual({
      id: 'photo-1',
      appointmentId: FIXTURE_IDS.appointment,
      barberId: FIXTURE_IDS.barber,
      clientCustomerId: FIXTURE_IDS.customer,
      clientLabel: 'Ана',
      takenByUserId: IVAN,
      takenAtUtcMs: FIXTURE_NOW_UTC_MS,
      path: '/work/fade.jpg',
      url: 'https://media.test/work/fade.jpg',
      width: null,
      height: null,
      photoOrigin: PhotoOrigin.Library,
      label: 'Фейд · витрина',
    });
    expect(photos).toEqual([photo]);
    expect(calls).toEqual(['nextId', 'nowUtcMs', 'saveAppointmentPhoto']);
  });

  it('runs no upload guard — a library picture has no bytes to judge', async () => {
    const { ports, calls } = harness();

    unwrapOk(
      await adoptVisitPhoto(ports)({
        ...subject,
        path: 'library/brochure.pdf',
        url: 'https://media.test/library/brochure.pdf',
        label: null,
      }),
    );

    expect(calls).not.toContain('uploadPhotoBytes');
  });

  it('answers the save’s failure as it comes', async () => {
    const failure = RepositoryError.writeFailed('appointmentPhotos', 'denied');
    const { ports } = harness({ save: async () => Result.err(failure) });

    const failed = await adoptVisitPhoto(ports)({
      ...subject,
      path: '/work/fade.jpg',
      url: '/work/fade.jpg',
      label: null,
    });

    expect(unwrapErr(failed)).toEqual(failure);
  });
});
