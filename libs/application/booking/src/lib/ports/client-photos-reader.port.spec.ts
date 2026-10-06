import { describe, expect, it } from 'vitest';
import { RepositoryError } from '@creativo/application/shared';
import { InMemoryClientPhotosReader } from '../../testing';
import type { AppointmentPhoto } from './appointment-photos.port';
import { CLIENT_PHOTOS_READER } from './client-photos-reader.port';

function photo(
  photoId: string,
  appointmentId: string,
  takenAtIso: string,
  over: Partial<AppointmentPhoto> = {},
): AppointmentPhoto {
  return {
    photoId,
    appointmentId,
    barberId: 'ivan',
    clientUserId: 'georgi',
    clientLabel: 'Георги Петров',
    takenByUid: 'dev-staff-ivan',
    takenAtIso,
    path: `appointmentPhotos/${appointmentId}/${photoId}`,
    url: `https://example.test/${photoId}.jpg`,
    width: 1600,
    height: 1200,
    origin: 'shot',
    label: null,
    ...over,
  };
}

const photos = [
  photo('p1', 'a-01', '2026-06-02T08:00:00.000Z'),
  photo('p2', 'a-03', '2026-08-05T08:00:00.000Z'),
  photo('p3', 'a-03', '2026-08-05T08:05:00.000Z'),
  photo('p4', 'a-05', '2026-09-28T08:00:00.000Z', {
    origin: 'library',
    label: 'Корица: Фейд',
  }),
  photo('p5', 'a-05', '2026-09-28T07:55:00.000Z'),
  photo('m1', 'a-04', '2026-09-02T08:00:00.000Z', { clientUserId: 'martin' }),
];

/** The port's reference reader, held to the port's promises. */
describe('ClientPhotosReader — the in-memory reference', () => {
  it('names its token', () => {
    expect(CLIENT_PHOTOS_READER.toString()).toContain('ClientPhotosReader');
  });

  it('lists the client’s own cuts, newest first — never another client’s, never the shop’s pictures', async () => {
    const reader = new InMemoryClientPhotosReader(photos);
    const listed = await reader.listForClient('georgi', { limit: 10 });
    expect(listed.isSuccess() && listed.value.map((p) => p.photoId)).toEqual([
      'p5',
      'p3',
      'p2',
      'p1',
    ]);
  });

  it('bounds the read before setting the shop’s pictures aside', async () => {
    const reader = new InMemoryClientPhotosReader(photos);
    const listed = await reader.listForClient('georgi', { limit: 2 });
    expect(listed.isSuccess() && listed.value.map((p) => p.photoId)).toEqual([
      'p5',
    ]);
  });

  it('counts each asked visit’s own photos, zero included', async () => {
    const reader = new InMemoryClientPhotosReader(photos);
    const counts = await reader.countByAppointment(['a-03', 'a-05', 'a-02']);
    expect(counts.isSuccess() && [...counts.value]).toEqual([
      ['a-03', 2],
      ['a-05', 1],
      ['a-02', 0],
    ]);
    const none = await reader.countByAppointment([]);
    expect(none.isSuccess() && none.value.size).toBe(0);
  });

  it('fails while told to, and records every read', async () => {
    const reader = new InMemoryClientPhotosReader(photos).failWith();
    const listed = await reader.listForClient('georgi', { limit: 6 });
    const counted = await reader.countByAppointment(['a-01']);
    expect(listed.isFailure() && listed.error).toBeInstanceOf(RepositoryError);
    expect(counted.isFailure()).toBe(true);
    reader.recover();
    expect(
      (await reader.listForClient('georgi', { limit: 6 })).isSuccess(),
    ).toBe(true);
    expect(reader.calls).toEqual([
      { method: 'listForClient', userId: 'georgi' },
      { method: 'countByAppointment', appointmentIds: ['a-01'] },
      { method: 'listForClient', userId: 'georgi' },
    ]);
  });
});
