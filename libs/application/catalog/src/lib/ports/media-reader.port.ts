import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import { MediaRef } from '@creativo/domain/catalog';
import { RepositoryError } from '@creativo/application/shared';

/** A single resolved rendition of a `MediaRef` at a given width, ready to bind to `<img>`/`srcset`. */
export interface MediaVariant {
  readonly width: number;
  readonly url: string;
}

/** Resolves a denormalized `MediaRef` pointer to actual, servable URLs (Firebase Storage, Goal 04). */
export interface MediaReader {
  resolve(
    ref: MediaRef,
  ): Promise<Result<readonly MediaVariant[], RepositoryError>>;
}

export const MEDIA_READER = new InjectionToken<MediaReader>('MediaReader');
