import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import { MediaRef } from '@creativo/domain/catalog';
import { MediaReadError } from './media-reader.errors';

/** A single resolved rendition of a `MediaRef` at a given width, ready to bind to `<img>`/`srcset`. */
export interface MediaVariant {
  readonly width: number;
  readonly url: string;
}

/**
 * Resolves a denormalized `MediaRef` pointer to actual, servable URLs
 * (Firebase Storage, Goal 04).
 *
 * A failure says whether asking again can help: `MediaUnavailableError`
 * (the object is missing, or the caller may not read it) is permanent;
 * a `RepositoryError` (network, quota, server) is transient.
 */
export interface MediaReader {
  resolve(
    ref: MediaRef,
  ): Promise<Result<readonly MediaVariant[], MediaReadError>>;
}

export const MEDIA_READER = new InjectionToken<MediaReader>('MediaReader');
