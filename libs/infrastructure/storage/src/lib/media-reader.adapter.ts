import { Injectable, inject } from '@angular/core';
import { getDownloadURL, ref } from 'firebase/storage';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { MediaRef } from '@creativo/domain/catalog';
import { MediaReader, MediaVariant } from '@creativo/application/catalog';
import { RepositoryError } from '@creativo/application/shared';
import { FIREBASE_STORAGE } from './storage.provider';

/**
 * Resolves a `MediaRef` to a single servable variant at its own native
 * width. Deliberate Phase-4 simplification, not a stub: true multi-
 * resolution `srcset` variants need an image-resizing pipeline/extension
 * that isn't provisioned yet — when one lands, this adapter grows the
 * extra width lookups without any port/domain change.
 */
@Injectable()
export class StorageMediaReader implements MediaReader {
  private readonly storage = inject(FIREBASE_STORAGE);

  async resolve(
    mediaRef: MediaRef,
  ): Promise<Result<readonly MediaVariant[], RepositoryError>> {
    try {
      const url = await getDownloadURL(ref(this.storage, mediaRef.path));
      return ok([{ width: mediaRef.width, url }]);
    } catch (error) {
      return fail(
        new RepositoryError(
          `Failed to resolve media at "${mediaRef.path}"`,
          error,
        ),
      );
    }
  }
}
