import { describe, expect, it } from 'vitest';
import { BarberId, OperationId, UserId } from '@core/primitives';
import { TeamErrorCode } from '@core/errors';
import { barberFixture, deepFreeze, unwrapErr, unwrapOk } from '@core/testing';
import {
  type BarberPhotoInput,
  BarberPhotoSystem,
} from './barber-photo.system';

/*
 * A barber's ONE photo
 * (`docs/architecture/decisions/2026-11-15-one-photo-per-barber.md`): where
 * the staged bytes are, what the record will hold, which uploads are a
 * picture the shop shows, and what a change leaves behind.
 */

const CALLER = UserId.of('u-editor');
const IVAN = BarberId.of('ivan');
const OP = OperationId.of('operation-photo-0123456');

const input = (over: Partial<BarberPhotoInput> = {}): BarberPhotoInput =>
  deepFreeze({
    callerUserId: CALLER,
    barberId: IVAN,
    operationId: OP,
    stagedName: 'a1b2c3d4-staged',
    mediaWidth: 1200,
    mediaHeight: 1600,
    ...over,
  });

describe('BarberPhotoSystem.planOf — where the bytes are and what the record will hold', () => {
  it('reads the staged file under the CALLER’S own folder, and names the new object after the act', () => {
    expect(unwrapOk(BarberPhotoSystem.planOf(input()))).toEqual({
      stagedPath: 'staffUploads/u-editor/a1b2c3d4-staged',
      media: {
        mediaId: OP,
        mediaPath: `media/barbers/ivan/${OP}`,
        mediaWidth: 1200,
        mediaHeight: 1600,
        mediaBlurhash: null,
        mediaFocalX: 0.5,
        mediaFocalY: 0.5,
      },
    });
  });

  it('refuses a staged name that is not one plain segment — nothing that climbs or nests', () => {
    for (const stagedName of [
      '../u-other/secret-file',
      'folder/file-name',
      'short',
      '',
      'name with spaces',
      'x'.repeat(65),
    ]) {
      expect(
        unwrapErr(BarberPhotoSystem.planOf(input({ stagedName }))),
        stagedName,
      ).toEqual({ errorCode: TeamErrorCode.InvalidInput, field: 'stagedName' });
    }
  });

  it('refuses a size that is not positive whole pixels, naming the axis', () => {
    for (const mediaWidth of [0, -4, 12.5, Number.NaN]) {
      expect(
        unwrapErr(BarberPhotoSystem.planOf(input({ mediaWidth }))),
      ).toEqual({ errorCode: TeamErrorCode.InvalidInput, field: 'mediaWidth' });
    }
    expect(
      unwrapErr(BarberPhotoSystem.planOf(input({ mediaHeight: 0 }))),
    ).toEqual({ errorCode: TeamErrorCode.InvalidInput, field: 'mediaHeight' });
  });

  it('a replay of the act names the same object', () => {
    expect(BarberPhotoSystem.planOf(input())).toEqual(
      BarberPhotoSystem.planOf(input()),
    );
  });
});

describe('BarberPhotoSystem.admitObject — a picture the shop shows', () => {
  it('takes a JPEG, a PNG and a WebP up to the limit', () => {
    for (const contentType of BarberPhotoSystem.CONTENT_TYPES) {
      expect(
        BarberPhotoSystem.admitObject({
          contentType,
          sizeBytes: BarberPhotoSystem.MAX_BYTES,
        }).ok,
        contentType,
      ).toBe(true);
    }
  });

  it('refuses what is no such image, an empty object and one over the limit', () => {
    for (const facts of [
      { contentType: 'image/svg+xml', sizeBytes: 1000 },
      { contentType: 'application/pdf', sizeBytes: 1000 },
      { contentType: null, sizeBytes: 1000 },
      { contentType: 'image/jpeg', sizeBytes: 0 },
      { contentType: 'image/jpeg', sizeBytes: BarberPhotoSystem.MAX_BYTES + 1 },
    ]) {
      expect(unwrapErr(BarberPhotoSystem.admitObject(facts))).toEqual({
        errorCode: TeamErrorCode.PhotoInvalid,
      });
    }
  });
});

describe('BarberPhotoSystem — what a record holds and what a change leaves behind', () => {
  const plan = unwrapOk(BarberPhotoSystem.planOf(input()));
  const own = barberFixture({
    id: IVAN,
    avatarMediaPath: 'media/barbers/ivan/operation-older-0123456',
  });
  const seeded = barberFixture({
    id: IVAN,
    avatarMediaPath: 'media/barbers/ivan.jpg',
  });
  const withPhoto = barberFixture({
    id: IVAN,
    avatarMediaPath: plan.media.mediaPath,
  });

  it('isHeld says the record already holds this act’s photo', () => {
    expect(BarberPhotoSystem.isHeld(withPhoto, plan.media)).toBe(true);
    expect(BarberPhotoSystem.isHeld(own, plan.media)).toBe(false);
  });

  it('replacedPathOf names the barber’s own older photo, and nothing else', () => {
    expect(BarberPhotoSystem.replacedPathOf(own, withPhoto)).toBe(
      'media/barbers/ivan/operation-older-0123456',
    );
    // A catalogue picture kept outside the barber's folder is nobody's to delete.
    expect(BarberPhotoSystem.replacedPathOf(seeded, withPhoto)).toBeNull();
    // No photo before, and the same photo again, leave nothing behind.
    expect(
      BarberPhotoSystem.replacedPathOf(
        barberFixture({ id: IVAN, avatarMediaPath: null }),
        withPhoto,
      ),
    ).toBeNull();
    expect(BarberPhotoSystem.replacedPathOf(withPhoto, withPhoto)).toBeNull();
  });

  it('names the linked account’s one avatar object', () => {
    expect(BarberPhotoSystem.accountAvatarPathOf(UserId.of('u-ivan'))).toBe(
      'avatars/u-ivan/original',
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const before = deepFreeze(own);
    const after = deepFreeze(withPhoto);
    expect(BarberPhotoSystem.replacedPathOf(before, after)).toBe(
      BarberPhotoSystem.replacedPathOf(before, after),
    );
  });
});
