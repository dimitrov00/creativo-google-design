import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';
import type { AppointmentPhoto } from './appointment-photos.port';

/**
 * A CLIENT'S PAST CUTS, across their visits — the staff card's photo rail
 * and the history's photo marks (client-card-redesign §6.1). Read-only,
 * staff-only, the same `appointmentPhotos` documents a visit's own photos
 * are (`APPOINTMENT_PHOTOS`); a new port rather than a new method on that
 * one, so nothing that already fakes it has to change.
 *
 * Only the visits' own pictures count (`origin == 'shot'`): a catalogue
 * cover assigned to a visit is the shop's picture, not the client's cut.
 */
export interface ClientPhotosReader {
  /**
   * The newest of the client's photos, newest first. The `limit` bounds the
   * read before the shop's own pictures are set aside, so fewer may come
   * back than asked for.
   */
  listForClient(
    userId: string,
    options: { readonly limit: number },
  ): Promise<Result<readonly AppointmentPhoto[], RepositoryError>>;
  /**
   * How many of its own photos each visit has, for the history's marks —
   * every asked id is a key, `0` included.
   */
  countByAppointment(
    appointmentIds: readonly string[],
  ): Promise<Result<ReadonlyMap<string, number>, RepositoryError>>;
}

export const CLIENT_PHOTOS_READER = new InjectionToken<ClientPhotosReader>(
  'ClientPhotosReader',
);
