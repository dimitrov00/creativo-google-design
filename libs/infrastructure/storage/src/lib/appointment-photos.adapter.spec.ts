import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import { PhotoOrigin } from '@core/components';
import {
  AppointmentId,
  AppointmentPhotoId,
  BarberId,
  CustomerId,
  Result,
  UserId,
} from '@core/primitives';
import { MediaErrorCode, RepositoryErrorCode } from '@core/errors';
import type { AppointmentPhoto } from '@core/entities';
import { utcMs } from '@core/testing';

const {
  refMock,
  uploadBytesMock,
  getDownloadURLMock,
  deleteObjectMock,
  docMock,
  setDocMock,
  deleteDocMock,
  getDocsMock,
  onSnapshotMock,
  whereMock,
  orderByMock,
  limitMock,
} = vi.hoisted(() => ({
  refMock: vi.fn((_storage: unknown, path: string) => ({ path })),
  uploadBytesMock: vi.fn(),
  getDownloadURLMock: vi.fn(),
  deleteObjectMock: vi.fn(),
  docMock: vi.fn((_db: unknown, col: string, id: string) => `${col}/${id}`),
  setDocMock: vi.fn(),
  deleteDocMock: vi.fn(),
  getDocsMock: vi.fn(),
  onSnapshotMock: vi.fn(),
  whereMock: vi.fn((...parts: unknown[]) => ({ where: parts })),
  orderByMock: vi.fn((...parts: unknown[]) => ({ orderBy: parts })),
  limitMock: vi.fn((max: number) => ({ limit: max })),
}));

vi.mock('firebase/storage', () => ({
  ref: refMock,
  uploadBytes: uploadBytesMock,
  getDownloadURL: getDownloadURLMock,
  deleteObject: deleteObjectMock,
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ collection: name })),
  query: vi.fn((...parts: unknown[]) => parts),
  where: whereMock,
  orderBy: orderByMock,
  limit: limitMock,
  doc: docMock,
  setDoc: setDocMock,
  deleteDoc: deleteDocMock,
  getDocs: getDocsMock,
  onSnapshot: onSnapshotMock,
}));

import { appointmentPhotoPorts } from './appointment-photos.adapter';

const ports = () =>
  appointmentPhotoPorts({} as Firestore, {} as FirebaseStorage);

/** A visit photo as the staff flow hands it over: the facts, stamped by the caller. */
function photo(overrides: Partial<AppointmentPhoto> = {}): AppointmentPhoto {
  return {
    id: AppointmentPhotoId.of('p1'),
    appointmentId: AppointmentId.of('appt-1'),
    barberId: BarberId.of('ivan'),
    clientCustomerId: CustomerId.of('cus_georgi'),
    clientLabel: 'Георги Петров',
    takenByUserId: UserId.of('staff-ivan'),
    takenAtUtcMs: utcMs('2026-09-17T16:00:00+03:00'),
    path: 'appointmentPhotos/appt-1/p1',
    url: 'https://cdn/p1.jpg',
    width: 1600,
    height: 1200,
    photoOrigin: PhotoOrigin.Shot,
    label: null,
    ...overrides,
  };
}

/** What `uploadPhotoBytes` is handed: the photo before its bytes have a home. */
function facts(overrides: Partial<AppointmentPhoto> = {}) {
  const { path, url, ...rest } = photo(overrides);
  expect([path, url]).toHaveLength(2);
  return rest;
}

/** A stored photo document, as `saveAppointmentPhoto` writes it. */
function stored(overrides: Partial<AppointmentPhoto>) {
  const { id, ...body } = photo(overrides);
  return { id, data: () => body };
}

type StoredPhoto = ReturnType<typeof stored>;

/** A stored document's field, by the name a query part gives it. */
const fieldOf = (entry: StoredPhoto, field: string): unknown =>
  new Map<string, unknown>(Object.entries(entry.data())).get(field);

/** One part of the query the mocked `query` hands `getDocs`. */
type QueryPart = {
  readonly where?: readonly [string, string, unknown];
  readonly orderBy?: readonly [string, 'asc' | 'desc'];
  readonly limit?: number;
};

/**
 * `getDocs` answering from `documents` as Firestore does — every `==`
 * filter, then the `orderBy`, then the `limit` — so a spec reads what the
 * query really asks for, not what a canned answer happens to hold.
 */
function answerFrom(documents: readonly StoredPhoto[]): void {
  getDocsMock.mockImplementation(async (parts: readonly QueryPart[]) => {
    let docs = [...documents];
    for (const part of parts) {
      if (part.where !== undefined) {
        const [field, op, value] = part.where;
        expect(op).toBe('==');
        docs = docs.filter((entry) => fieldOf(entry, field) === value);
      }
    }
    for (const part of parts) {
      if (part.orderBy !== undefined) {
        const [field, direction] = part.orderBy;
        const sign = direction === 'desc' ? -1 : 1;
        const of = (entry: StoredPhoto) => fieldOf(entry, field) as number;
        docs.sort((a, b) => sign * (of(a) - of(b)));
      }
    }
    for (const part of parts) {
      if (part.limit !== undefined) docs = docs.slice(0, part.limit);
    }
    return { docs };
  });
}

const image = (type: string, size = 120_000) => ({ type, size }) as Blob;

describe('appointmentPhotoPorts', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('uploadPhotoBytes', () => {
    it('puts the bytes under the visit, the facts as the object’s own metadata, and answers the path and URL', async () => {
      uploadBytesMock.mockResolvedValue(undefined);
      getDownloadURLMock.mockResolvedValue('https://cdn/photo.jpg');

      const answer = await ports().uploadPhotoBytes(
        facts(),
        image('image/jpeg'),
      );

      expect(answer).toEqual(
        Result.ok({
          path: 'appointmentPhotos/appt-1/p1',
          url: 'https://cdn/photo.jpg',
        }),
      );
      expect(refMock).toHaveBeenCalledWith({}, 'appointmentPhotos/appt-1/p1');
      const [, , metadata] = uploadBytesMock.mock.calls[0] as [
        unknown,
        Blob,
        { contentType: string; customMetadata: Record<string, string> },
      ];
      expect(metadata.contentType).toBe('image/jpeg');
      expect(metadata.customMetadata).toEqual({
        appointmentId: 'appt-1',
        barberId: 'ivan',
        clientCustomerId: 'cus_georgi',
        clientLabel: 'Георги Петров',
        takenByUserId: 'staff-ivan',
        takenAtUtcMs: String(utcMs('2026-09-17T16:00:00+03:00')),
      });
      // The bytes only: the document is the caller's next step.
      expect(setDocMock).not.toHaveBeenCalled();
    });

    it('writes an empty string for a guest with no record and a shot nobody signed', async () => {
      uploadBytesMock.mockResolvedValue(undefined);
      getDownloadURLMock.mockResolvedValue('https://cdn/photo.jpg');

      await ports().uploadPhotoBytes(
        facts({ clientCustomerId: null, takenByUserId: null }),
        image('image/png'),
      );

      const [, , metadata] = uploadBytesMock.mock.calls[0] as [
        unknown,
        Blob,
        { customMetadata: Record<string, string> },
      ];
      expect(metadata.customMetadata['clientCustomerId']).toBe('');
      expect(metadata.customMetadata['takenByUserId']).toBe('');
    });

    it('leaves the limits to the caller’s guard: what slips past it goes to Storage, whose refusal is MEDIA_FORBIDDEN', async () => {
      // Not an image, and over 8 MiB: `attachVisitPhoto`'s `MediaSystem.check`
      // stops both before this call (`media.port.ts`); the adapter judges nothing.
      uploadBytesMock.mockRejectedValue({ code: 'storage/unauthorized' });
      const blob = image('application/pdf', 8 * 1024 * 1024 + 1);

      const answer = await ports().uploadPhotoBytes(facts(), blob);

      expect(answer).toEqual(
        Result.err({
          errorCode: MediaErrorCode.Forbidden,
          path: 'appointmentPhotos/appt-1/p1',
        }),
      );
      const [object, bytes, metadata] = uploadBytesMock.mock.calls[0] as [
        { path: string },
        Blob,
        { contentType: string },
      ];
      expect(object.path).toBe('appointmentPhotos/appt-1/p1');
      expect(bytes).toBe(blob);
      expect(metadata.contentType).toBe('application/pdf');
      expect(getDownloadURLMock).not.toHaveBeenCalled();
    });

    it.each([
      ['storage/unauthorized', MediaErrorCode.Forbidden],
      ['storage/retry-limit-exceeded', MediaErrorCode.Transient],
    ])('answers Storage’s %s as %s', async (code, errorCode) => {
      uploadBytesMock.mockRejectedValue({ code });

      const answer = await ports().uploadPhotoBytes(
        facts(),
        image('image/jpeg'),
      );

      expect(answer).toEqual(
        Result.err({ errorCode, path: 'appointmentPhotos/appt-1/p1' }),
      );
    });
  });

  describe('saveAppointmentPhoto', () => {
    it('writes the document — the photo minus its id — keyed by its id', async () => {
      setDocMock.mockResolvedValue(undefined);
      const { id, ...body } = photo();

      const answer = await ports().saveAppointmentPhoto(photo());

      expect(answer).toEqual(Result.ok(undefined));
      expect(setDocMock).toHaveBeenCalledWith(`appointmentPhotos/${id}`, body);
    });

    it("assigns one of the shop's own pictures by the document alone — nothing goes up", async () => {
      setDocMock.mockResolvedValue(undefined);
      const library = photo({
        photoOrigin: PhotoOrigin.Library,
        label: 'Модерна визия',
        path: '/work/modern-cut.jpg',
        url: '/work/modern-cut.jpg',
        width: null,
        height: null,
      });

      const answer = await ports().saveAppointmentPhoto(library);

      expect(answer).toEqual(Result.ok(undefined));
      expect(uploadBytesMock).not.toHaveBeenCalled();
      expect(setDocMock).toHaveBeenCalledTimes(1);
    });

    it('turns a refused write into REPOSITORY_WRITE_FAILED', async () => {
      setDocMock.mockRejectedValue({ code: 'permission-denied' });

      const answer = await ports().saveAppointmentPhoto(photo());

      expect(answer).toEqual(
        Result.err({
          errorCode: RepositoryErrorCode.WriteFailed,
          path: 'appointmentPhotos/p1',
          reason: 'permission-denied',
        }),
      );
    });
  });

  describe('observeAppointmentPhotos', () => {
    it("reads the visit's photos by one equality, in the order they were taken", async () => {
      onSnapshotMock.mockImplementation(
        (
          _query: unknown,
          onNext: (snapshot: { docs: ReturnType<typeof stored>[] }) => void,
        ) => {
          onNext({
            docs: [
              stored({
                id: AppointmentPhotoId.of('later'),
                takenAtUtcMs: utcMs('2026-09-17T17:00:00+03:00'),
              }),
              stored({
                id: AppointmentPhotoId.of('earlier'),
                takenAtUtcMs: utcMs('2026-09-17T16:00:00+03:00'),
              }),
            ],
          });
          return () => undefined;
        },
      );

      const seen: Result<readonly AppointmentPhoto[], unknown>[] = [];
      const subscription = ports()
        .observeAppointmentPhotos(AppointmentId.of('appt-1'))
        .subscribe((answer) => seen.push(answer));

      expect(whereMock).toHaveBeenCalledWith('appointmentId', '==', 'appt-1');
      expect(
        seen.map((answer) => answer.ok && answer.value.map((p) => p.id)),
      ).toEqual([['earlier', 'later']]);
      subscription.unsubscribe();
    });

    it('answers a refused listen as the port’s RepositoryError', () => {
      onSnapshotMock.mockImplementation(
        (_query: unknown, _onNext: unknown, onError: (e: unknown) => void) => {
          onError({ code: 'permission-denied' });
          return () => undefined;
        },
      );

      const seen: unknown[] = [];
      ports()
        .observeAppointmentPhotos(AppointmentId.of('appt-1'))
        .subscribe((answer) => seen.push(answer))
        .unsubscribe();

      expect(seen).toEqual([
        Result.err({
          errorCode: RepositoryErrorCode.ReadFailed,
          path: 'appointmentPhotos',
          reason: 'permission-denied',
        }),
      ]);
    });
  });

  describe('deleteAppointmentPhoto', () => {
    it('drops the document and the bytes of a shot', async () => {
      deleteDocMock.mockResolvedValue(undefined);
      deleteObjectMock.mockResolvedValue(undefined);

      const answer = await ports().deleteAppointmentPhoto(photo());

      expect(answer).toEqual(Result.ok(undefined));
      expect(deleteDocMock).toHaveBeenCalledWith('appointmentPhotos/p1');
      expect(deleteObjectMock).toHaveBeenCalledWith({
        path: 'appointmentPhotos/appt-1/p1',
      });
    });

    it("leaves the shop's own picture where it is when a library photo goes", async () => {
      deleteDocMock.mockResolvedValue(undefined);

      const answer = await ports().deleteAppointmentPhoto(
        photo({
          photoOrigin: PhotoOrigin.Library,
          label: 'Модерна визия',
          path: '/work/modern-cut.jpg',
        }),
      );

      expect(answer).toEqual(Result.ok(undefined));
      expect(deleteDocMock).toHaveBeenCalledWith('appointmentPhotos/p1');
      expect(deleteObjectMock).not.toHaveBeenCalled();
    });

    it('treats bytes already gone as gone', async () => {
      deleteDocMock.mockResolvedValue(undefined);
      deleteObjectMock.mockRejectedValue({ code: 'storage/object-not-found' });

      const answer = await ports().deleteAppointmentPhoto(photo());

      expect(answer).toEqual(Result.ok(undefined));
    });

    it('surfaces a real storage failure', async () => {
      deleteDocMock.mockResolvedValue(undefined);
      deleteObjectMock.mockRejectedValue({ code: 'storage/unauthorized' });

      const answer = await ports().deleteAppointmentPhoto(photo());

      expect(answer).toEqual(
        Result.err({
          errorCode: RepositoryErrorCode.WriteFailed,
          path: 'appointmentPhotos/appt-1/p1',
          reason: 'storage/unauthorized',
        }),
      );
    });
  });

  describe('listClientPhotos', () => {
    it('asks for the client record’s newest shots, both filters in the query, ordered so the limit keeps the newest', async () => {
      getDocsMock.mockResolvedValue({
        docs: [
          stored({ id: AppointmentPhotoId.of('p3') }),
          stored({ id: AppointmentPhotoId.of('p2') }),
        ],
      });

      const answer = await ports().listClientPhotos(
        CustomerId.of('cus_georgi'),
        6,
      );

      // Index #22: (clientCustomerId, photoOrigin, takenAtUtcMs desc).
      expect(whereMock.mock.calls).toEqual([
        ['clientCustomerId', '==', 'cus_georgi'],
        ['photoOrigin', '==', PhotoOrigin.Shot],
      ]);
      expect(orderByMock).toHaveBeenCalledWith('takenAtUtcMs', 'desc');
      expect(limitMock).toHaveBeenCalledWith(6);
      // The answer is the read as it came: nothing is set aside afterwards.
      expect(answer.ok && answer.value.map((p) => p.id)).toEqual(['p3', 'p2']);
    });

    it('fills every place with a shot although library pictures adopted onto the visits are the newest documents', async () => {
      answerFrom([
        stored({
          id: AppointmentPhotoId.of('cover-new'),
          photoOrigin: PhotoOrigin.Library,
          label: 'Фейд · витрина',
          takenAtUtcMs: utcMs('2026-09-17T19:00:00+03:00'),
        }),
        stored({
          id: AppointmentPhotoId.of('shot-4'),
          takenAtUtcMs: utcMs('2026-09-17T18:00:00+03:00'),
        }),
        stored({
          id: AppointmentPhotoId.of('cover-old'),
          photoOrigin: PhotoOrigin.Library,
          label: 'Модерна визия',
          takenAtUtcMs: utcMs('2026-09-17T17:30:00+03:00'),
        }),
        stored({
          id: AppointmentPhotoId.of('shot-3'),
          takenAtUtcMs: utcMs('2026-09-10T17:00:00+03:00'),
        }),
        stored({
          id: AppointmentPhotoId.of('someone-else'),
          clientCustomerId: CustomerId.of('cus_ivo'),
          takenAtUtcMs: utcMs('2026-09-12T12:00:00+03:00'),
        }),
        stored({
          id: AppointmentPhotoId.of('shot-2'),
          takenAtUtcMs: utcMs('2026-08-20T17:00:00+03:00'),
        }),
        stored({
          id: AppointmentPhotoId.of('shot-1'),
          takenAtUtcMs: utcMs('2026-08-01T17:00:00+03:00'),
        }),
      ]);

      const answer = await ports().listClientPhotos(
        CustomerId.of('cus_georgi'),
        3,
      );

      // Filtered after the limit, the two covers would have taken two of
      // the three places and left one shot (`shot-4`) on the card.
      expect(answer.ok && answer.value.map((p) => p.id)).toEqual([
        'shot-4',
        'shot-3',
        'shot-2',
      ]);
    });

    it('reads nothing for no room', async () => {
      const answer = await ports().listClientPhotos(
        CustomerId.of('cus_georgi'),
        0,
      );

      expect(answer).toEqual(Result.ok([]));
      expect(getDocsMock).not.toHaveBeenCalled();
    });

    it('answers a failed read with a failed Result', async () => {
      getDocsMock.mockRejectedValue({ code: 'permission-denied' });

      const answer = await ports().listClientPhotos(
        CustomerId.of('cus_georgi'),
        6,
      );

      expect(answer).toEqual(
        Result.err({
          errorCode: RepositoryErrorCode.ReadFailed,
          path: 'appointmentPhotos',
          reason: 'permission-denied',
        }),
      );
    });
  });

  describe('countPhotosByAppointment', () => {
    it('counts each visit’s own photos, every asked id answered in its place', async () => {
      getDocsMock.mockResolvedValue({
        docs: [
          stored({
            id: AppointmentPhotoId.of('p1'),
            appointmentId: AppointmentId.of('a-03'),
          }),
          stored({
            id: AppointmentPhotoId.of('p2'),
            appointmentId: AppointmentId.of('a-03'),
          }),
          stored({
            id: AppointmentPhotoId.of('cover'),
            appointmentId: AppointmentId.of('a-05'),
            photoOrigin: PhotoOrigin.Library,
          }),
        ],
      });

      const answer = await ports().countPhotosByAppointment([
        AppointmentId.of('a-03'),
        AppointmentId.of('a-05'),
        AppointmentId.of('a-07'),
      ]);

      expect(whereMock).toHaveBeenCalledWith('appointmentId', 'in', [
        'a-03',
        'a-05',
        'a-07',
      ]);
      expect(answer).toEqual(Result.ok([2, 0, 0]));
    });

    it('asks thirty ids at a time — Firestore’s cap on one `in`', async () => {
      getDocsMock.mockResolvedValue({ docs: [] });
      const ids = Array.from({ length: 65 }, (_, i) =>
        AppointmentId.of(`a-${i}`),
      );

      const answer = await ports().countPhotosByAppointment(ids);

      expect(getDocsMock).toHaveBeenCalledTimes(3);
      const sizes = whereMock.mock.calls.map(
        (call) => (call[2] as readonly string[]).length,
      );
      expect(sizes).toEqual([30, 30, 5]);
      expect(answer.ok && answer.value).toHaveLength(65);
    });

    it('reads nothing for no ids, and asks for an id once however often it is listed', async () => {
      getDocsMock.mockResolvedValue({ docs: [] });

      const none = await ports().countPhotosByAppointment([]);
      expect(none).toEqual(Result.ok([]));
      expect(getDocsMock).not.toHaveBeenCalled();

      const twice = await ports().countPhotosByAppointment([
        AppointmentId.of('a-1'),
        AppointmentId.of('a-1'),
        AppointmentId.of('a-2'),
      ]);
      expect(whereMock).toHaveBeenCalledWith('appointmentId', 'in', [
        'a-1',
        'a-2',
      ]);
      expect(twice).toEqual(Result.ok([0, 0, 0]));
    });

    it('answers a failed read with a failed Result', async () => {
      getDocsMock.mockRejectedValue({ code: 'unavailable' });

      const answer = await ports().countPhotosByAppointment([
        AppointmentId.of('a-1'),
      ]);

      expect(answer.ok).toBe(false);
    });
  });
});
