import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  FIREBASE_AUTH,
  FIREBASE_FIRESTORE,
} from '@creativo/infrastructure/firebase-app';
import type { AppointmentPhoto } from '@creativo/application/booking';
import { FIREBASE_STORAGE } from './storage.provider';

const {
  refMock,
  uploadBytesMock,
  getDownloadURLMock,
  deleteObjectMock,
  docMock,
  setDocMock,
  deleteDocMock,
  onSnapshotMock,
} = vi.hoisted(() => ({
  refMock: vi.fn(),
  uploadBytesMock: vi.fn(),
  getDownloadURLMock: vi.fn(),
  deleteObjectMock: vi.fn(),
  docMock: vi.fn(),
  setDocMock: vi.fn(),
  deleteDocMock: vi.fn(),
  onSnapshotMock: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: refMock,
  uploadBytes: uploadBytesMock,
  getDownloadURL: getDownloadURLMock,
  deleteObject: deleteObjectMock,
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'photos-collection'),
  query: vi.fn((...parts: unknown[]) => parts),
  where: vi.fn((...parts: unknown[]) => parts),
  doc: docMock,
  setDoc: setDocMock,
  deleteDoc: deleteDocMock,
  onSnapshot: onSnapshotMock,
}));

import { FirebaseAppointmentPhotos } from './appointment-photos.adapter';

function createPhotos(): FirebaseAppointmentPhotos {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_STORAGE, useValue: {} },
      { provide: FIREBASE_FIRESTORE, useValue: {} },
      {
        provide: FIREBASE_AUTH,
        useValue: { currentUser: { uid: 'staff-ivan' } },
      },
      FirebaseAppointmentPhotos,
    ],
  });
  return TestBed.inject(FirebaseAppointmentPhotos);
}

const attachment = (image: Blob) => ({
  appointmentId: 'appt-1',
  barberId: 'ivan',
  clientUserId: 'user-georgi',
  clientLabel: 'Георги Петров',
  image,
  width: 1600,
  height: 1200,
});

describe('FirebaseAppointmentPhotos', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('attach', () => {
    it('puts the bytes under the visit with the facts as metadata, writes the document with the URL, and hands the photo back', async () => {
      refMock.mockImplementation((_storage: unknown, path: string) => ({
        path,
      }));
      uploadBytesMock.mockResolvedValue(undefined);
      getDownloadURLMock.mockResolvedValue('https://cdn/photo.jpg');
      docMock.mockImplementation(
        (_db: unknown, col: string, id: string) => `${col}/${id}`,
      );
      setDocMock.mockResolvedValue(undefined);
      const photos = createPhotos();

      const result = await photos.attach(
        attachment({ type: 'image/jpeg', size: 120_000 } as Blob),
      );

      expect(result.isSuccess()).toBe(true);
      if (!result.isSuccess()) return;
      const photo = result.value;
      expect(photo.path).toBe(`appointmentPhotos/appt-1/${photo.photoId}`);
      expect(photo.url).toBe('https://cdn/photo.jpg');
      expect(photo.takenByUid).toBe('staff-ivan');
      expect(photo.barberId).toBe('ivan');
      expect(photo.clientLabel).toBe('Георги Петров');
      expect(photo.origin).toBe('shot');
      expect(photo.label).toBeNull();
      // The object carries the facts itself.
      const [, , metadata] = uploadBytesMock.mock.calls[0] as [
        unknown,
        Blob,
        { contentType: string; customMetadata: Record<string, string> },
      ];
      expect(metadata.contentType).toBe('image/jpeg');
      expect(metadata.customMetadata).toEqual({
        appointmentId: 'appt-1',
        barberId: 'ivan',
        clientUserId: 'user-georgi',
        clientLabel: 'Георги Петров',
        takenByUid: 'staff-ivan',
        takenAtIso: photo.takenAtIso,
      });
      // The document is the photo, keyed by its id.
      expect(setDocMock).toHaveBeenCalledWith(
        `appointmentPhotos/${photo.photoId}`,
        photo,
      );
    });

    it('refuses what is not an image before anything goes up', async () => {
      const photos = createPhotos();
      const result = await photos.attach(
        attachment({ type: 'application/pdf', size: 1000 } as Blob),
      );
      expect(result.isFailure()).toBe(true);
      expect(uploadBytesMock).not.toHaveBeenCalled();
      expect(setDocMock).not.toHaveBeenCalled();
    });
  });

  describe('adopt', () => {
    it("assigns one of the shop's own pictures by writing the document alone — nothing goes up", async () => {
      docMock.mockImplementation(
        (_db: unknown, col: string, id: string) => `${col}/${id}`,
      );
      setDocMock.mockResolvedValue(undefined);
      const photos = createPhotos();

      const result = await photos.adopt({
        appointmentId: 'appt-1',
        barberId: 'ivan',
        clientUserId: null,
        clientLabel: 'Гост',
        path: '/work/modern-cut.jpg',
        url: '/work/modern-cut.jpg',
        label: 'Модерна визия',
        width: null,
        height: null,
      });

      expect(result.isSuccess()).toBe(true);
      if (!result.isSuccess()) return;
      expect(result.value.origin).toBe('library');
      expect(result.value.label).toBe('Модерна визия');
      expect(result.value.takenByUid).toBe('staff-ivan');
      expect(uploadBytesMock).not.toHaveBeenCalled();
      expect(setDocMock).toHaveBeenCalledWith(
        `appointmentPhotos/${result.value.photoId}`,
        result.value,
      );
    });
  });

  describe('observe', () => {
    it("reads the visit's photos in the order they were taken and drops a document that does not say what a photo must", async () => {
      onSnapshotMock.mockImplementation(
        (
          _query: unknown,
          onNext: (snapshot: {
            docs: { id: string; data: () => unknown }[];
          }) => void,
        ) => {
          onNext({
            docs: [
              {
                id: 'later',
                data: () => ({
                  appointmentId: 'appt-1',
                  barberId: 'ivan',
                  takenAtIso: '2026-09-17T14:00:00.000Z',
                  path: 'appointmentPhotos/appt-1/later',
                  url: 'https://cdn/later.jpg',
                  clientLabel: 'Георги Петров',
                }),
              },
              { id: 'broken', data: () => ({ appointmentId: 'appt-1' }) },
              {
                id: 'earlier',
                data: () => ({
                  appointmentId: 'appt-1',
                  barberId: 'ivan',
                  takenAtIso: '2026-09-17T13:00:00.000Z',
                  path: 'appointmentPhotos/appt-1/earlier',
                  url: 'https://cdn/earlier.jpg',
                  width: 1600,
                  height: 1200,
                }),
              },
            ],
          });
          return () => undefined;
        },
      );
      const photos = createPhotos();

      const seen: readonly AppointmentPhoto[][] = [];
      photos.observe('appt-1').subscribe((result) => {
        if (result.isSuccess()) seen.push([...result.value]);
      });
      await vi.waitFor(() => expect(seen.length).toBe(1));

      expect(seen[0]?.map((photo) => photo.photoId)).toEqual([
        'earlier',
        'later',
      ]);
      expect(seen[0]?.[0]?.width).toBe(1600);
      expect(seen[0]?.[1]?.clientLabel).toBe('Георги Петров');
    });
  });

  describe('remove', () => {
    const photo: AppointmentPhoto = {
      photoId: 'p1',
      appointmentId: 'appt-1',
      barberId: 'ivan',
      clientUserId: null,
      clientLabel: 'Гост',
      takenByUid: 'staff-ivan',
      takenAtIso: '2026-09-17T13:00:00.000Z',
      path: 'appointmentPhotos/appt-1/p1',
      url: 'https://cdn/p1.jpg',
      width: null,
      height: null,
      origin: 'shot',
      label: null,
    };

    it('drops the document and the bytes', async () => {
      docMock.mockImplementation(
        (_db: unknown, col: string, id: string) => `${col}/${id}`,
      );
      refMock.mockImplementation((_storage: unknown, path: string) => ({
        path,
      }));
      deleteDocMock.mockResolvedValue(undefined);
      deleteObjectMock.mockResolvedValue(undefined);
      const photos = createPhotos();

      const result = await photos.remove(photo);

      expect(result.isSuccess()).toBe(true);
      expect(deleteDocMock).toHaveBeenCalledWith('appointmentPhotos/p1');
      expect(deleteObjectMock).toHaveBeenCalledWith({ path: photo.path });
    });

    it("leaves the shop's own picture where it is when a library photo goes", async () => {
      docMock.mockImplementation(
        (_db: unknown, col: string, id: string) => `${col}/${id}`,
      );
      deleteDocMock.mockResolvedValue(undefined);
      const photos = createPhotos();

      const result = await photos.remove({
        ...photo,
        origin: 'library',
        label: 'Модерна визия',
        path: '/work/modern-cut.jpg',
      });

      expect(result.isSuccess()).toBe(true);
      expect(deleteDocMock).toHaveBeenCalledWith('appointmentPhotos/p1');
      expect(deleteObjectMock).not.toHaveBeenCalled();
    });

    it('treats bytes already gone as gone', async () => {
      docMock.mockImplementation(
        (_db: unknown, col: string, id: string) => `${col}/${id}`,
      );
      refMock.mockImplementation((_storage: unknown, path: string) => ({
        path,
      }));
      deleteDocMock.mockResolvedValue(undefined);
      deleteObjectMock.mockRejectedValue({ code: 'storage/object-not-found' });
      const photos = createPhotos();

      const result = await photos.remove(photo);

      expect(result.isSuccess()).toBe(true);
    });

    it('surfaces a real storage failure', async () => {
      docMock.mockImplementation(
        (_db: unknown, col: string, id: string) => `${col}/${id}`,
      );
      refMock.mockImplementation((_storage: unknown, path: string) => ({
        path,
      }));
      deleteDocMock.mockResolvedValue(undefined);
      deleteObjectMock.mockRejectedValue({ code: 'storage/unauthorized' });
      const photos = createPhotos();

      const result = await photos.remove(photo);

      expect(result.isFailure()).toBe(true);
    });
  });
});
