import { describe, expect, it } from 'vitest';
import { MediaRefusal } from '@core/primitives';
import { deepFreeze } from '@core/testing';
import { MediaSystem } from './media.system';

/*
 * The upload guard (pass C, Y-1): the visit photo's guard (8 MiB after
 * downscaling, formerly the staff day store's own) and the avatar rule's guard
 * (`avatar.system.spec.ts`), one neutral answer — with DEP-7's boundary: a
 * file of exactly the limit is refused, as `storage.rules`' `size < MAX`
 * refuses it. The two wrappings are pinned by `avatar.system.spec.ts`
 * (`ACCOUNTS_UPLOAD_AVATAR_*`) and `attach-visit-photo.pipeline.spec.ts`
 * (`MEDIA_PHOTO_*`).
 */
const MAX = 1_000;

describe('MediaSystem.check — what may go up', () => {
  it('lets an image under the limit through', () => {
    expect(MediaSystem.check({ type: 'image/jpeg', size: 10 }, MAX)).toBeNull();
    expect(MediaSystem.check({ type: 'image/png', size: 0 }, MAX)).toBeNull();
    expect(
      MediaSystem.check({ type: 'image/webp', size: MAX - 1 }, MAX),
    ).toBeNull();
  });

  it('refuses a file of exactly the limit, and one over it (DEP-7)', () => {
    expect(MediaSystem.check({ type: 'image/jpeg', size: MAX }, MAX)).toBe(
      MediaRefusal.TooLarge,
    );
    expect(MediaSystem.check({ type: 'image/jpeg', size: MAX + 1 }, MAX)).toBe(
      MediaRefusal.TooLarge,
    );
  });

  it('refuses what is not an image — before its size', () => {
    expect(MediaSystem.check({ type: 'application/pdf', size: 10 }, MAX)).toBe(
      MediaRefusal.NotAnImage,
    );
    expect(
      MediaSystem.check({ type: 'application/pdf', size: MAX + 1 }, MAX),
    ).toBe(MediaRefusal.NotAnImage);
    // An empty type (a blob nobody typed) is no image either.
    expect(MediaSystem.check({ type: '', size: 10 }, MAX)).toBe(
      MediaRefusal.NotAnImage,
    );
  });

  it('reads the type by its `image/` prefix, case as given', () => {
    expect(
      MediaSystem.check({ type: 'image/svg+xml', size: 10 }, MAX),
    ).toBeNull();
    expect(MediaSystem.check({ type: 'Image/JPEG', size: 10 }, MAX)).toBe(
      MediaRefusal.NotAnImage,
    );
  });

  it('holds the visit photo limit: 8 MiB after downscaling', () => {
    expect(MediaSystem.PHOTO_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(
      MediaSystem.check(
        { type: 'image/jpeg', size: MediaSystem.PHOTO_MAX_BYTES - 1 },
        MediaSystem.PHOTO_MAX_BYTES,
      ),
    ).toBeNull();
    expect(
      MediaSystem.check(
        { type: 'image/jpeg', size: MediaSystem.PHOTO_MAX_BYTES },
        MediaSystem.PHOTO_MAX_BYTES,
      ),
    ).toBe(MediaRefusal.TooLarge);
  });

  it('takes a Blob as it is', () => {
    const blob = new Blob([new Uint8Array(12)], { type: 'image/jpeg' });
    expect(MediaSystem.check(blob, 12)).toBe(MediaRefusal.TooLarge);
    expect(MediaSystem.check(blob, 13)).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const file = deepFreeze({ type: 'image/jpeg', size: MAX });
    const once = MediaSystem.check(file, MAX);
    expect(MediaSystem.check(file, MAX)).toBe(once);
    expect(file).toEqual({ type: 'image/jpeg', size: MAX });
  });
});
