import { describe, expect, it } from 'vitest';
import { StoredObjectFacts, type StoredObjectEntry } from '@core/components';
import {
  OperationId,
  PositionId,
  ProgramImageId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { EngagementErrorCode } from '@core/errors';
import { deepFreeze, unwrapErr, unwrapOk } from '@core/testing';
import { RichText } from '@core/components';
import {
  type ProgramImageInput,
  ProgramImageSystem,
} from './program-image.system';

/*
 * ProgramImageSystem — the pictures of a description: where one lives, what
 * it is called, whether an upload is one a description shows, and which
 * objects a saved description leaves behind.
 */

const ROLE = PositionId.of('role-barber');
const NOW = 1_800_000_000_000 as UtcEpochMs;
const HOUR = 3_600_000;

const input = (over: Partial<ProgramImageInput> = {}): ProgramImageInput => ({
  callerUserId: UserId.of('u-editor'),
  programId: ROLE,
  operationId: OperationId.of('operation-0123456789ab'),
  stagedName: 'staged-0123456789',
  mediaWidth: 1600,
  mediaHeight: 900,
  ...over,
});

const entry = (name: string, ageMs: number | null): StoredObjectEntry => ({
  path: `media/programs/role-barber/${name}`,
  createdUtcMs: ageMs === null ? null : ((NOW - ageMs) as UtcEpochMs),
});

describe('ProgramImageSystem.planOf', () => {
  it('plans the staged path, the id and the object under the folder', () => {
    expect(unwrapOk(ProgramImageSystem.planOf(input()))).toEqual({
      stagedPath: 'pending/u-editor/staged-0123456789',
      imageId: 'operation-0123456789ab_1600x900',
      mediaPath: 'media/programs/role-barber/operation-0123456789ab_1600x900',
      folder: 'media/programs/role-barber/',
    });
  });

  it('makes an id whose size a page reads back', () => {
    const { imageId } = unwrapOk(ProgramImageSystem.planOf(input()));
    expect(RichText.imageSize(imageId)).toEqual({
      pixelWidth: 1600,
      pixelHeight: 900,
    });
  });

  it.each([
    ['stagedName', { stagedName: '../etc' }],
    ['stagedName', { stagedName: 'short' }],
    ['operationId', { operationId: OperationId.of('too-short') }],
    ['operationId', { operationId: OperationId.of('x'.repeat(49)) }],
    ['mediaWidth', { mediaWidth: 0 }],
    ['mediaWidth', { mediaWidth: 2401 }],
    ['mediaWidth', { mediaWidth: 12.5 }],
    ['mediaHeight', { mediaHeight: -4 }],
    ['mediaHeight', { mediaHeight: Number.NaN }],
  ] as const)('refuses a bad %s', (field, over) => {
    expect(unwrapErr(ProgramImageSystem.planOf(input(over)))).toEqual({
      errorCode: EngagementErrorCode.ProgramImageInvalidInput,
      field,
    });
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(input());
    expect(ProgramImageSystem.planOf(frozen)).toEqual(
      ProgramImageSystem.planOf(frozen),
    );
  });
});

describe('ProgramImageSystem.programIdOf', () => {
  it('reads a stored id', () => {
    expect(ProgramImageSystem.programIdOf('role-barber')).toBe('role-barber');
  });

  it.each([[null], [12], [''], ['a/b'], ['..'], ['x'.repeat(129)]])(
    'refuses %j',
    (raw) => {
      expect(ProgramImageSystem.programIdOf(raw)).toBeNull();
    },
  );
});

describe('ProgramImageSystem.admitObject', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('admits %s', (type) => {
    expect(
      ProgramImageSystem.admitObject(StoredObjectFacts.unmeasured(9_000, type))
        .ok,
    ).toBe(true);
  });

  it.each([
    ['no type', null, 9_000],
    ['another type', 'image/svg+xml', 9_000],
    ['nothing in it', 'image/jpeg', 0],
    ['too large', 'image/jpeg', ProgramImageSystem.MAX_BYTES + 1],
  ] as const)('refuses %s', (_, type, size) => {
    expect(
      unwrapErr(
        ProgramImageSystem.admitObject(
          StoredObjectFacts.unmeasured(size, type),
        ),
      ).errorCode,
    ).toBe(EngagementErrorCode.ProgramImageInvalid);
  });
});

describe('ProgramImageSystem.hasRoom', () => {
  it('takes one more until the folder is full', () => {
    expect(ProgramImageSystem.hasRoom(ProgramImageSystem.FOLDER_MAX - 1)).toBe(
      true,
    );
    expect(ProgramImageSystem.hasRoom(ProgramImageSystem.FOLDER_MAX)).toBe(
      false,
    );
  });
});

describe('ProgramImageSystem.namedIn', () => {
  it('names nothing for no description', () => {
    expect(ProgramImageSystem.namedIn(null)).toEqual([]);
  });

  it('reads every language, each picture once', () => {
    expect(
      ProgramImageSystem.namedIn({
        bg: 'Текст\n\n![Стол](pic-a)\n\n![Огледало](pic-b)',
        en: 'Words\n\n![Chair](pic-a)\n\n![Door](pic-c)',
      }),
    ).toEqual(['pic-a', 'pic-b', 'pic-c']);
  });

  it('does not read a picture written inside a line', () => {
    expect(
      ProgramImageSystem.namedIn({ bg: 'Виж ![x](pic-a) тук', en: '' }),
    ).toEqual([]);
  });
});

describe('ProgramImageSystem.admitBody', () => {
  const pictures = (count: number): string =>
    Array.from({ length: count }, (_, at) => `![](pic-${at})`).join('\n\n');

  it('admits no description, and a language at the picture limit', () => {
    expect(ProgramImageSystem.admitBody(null).ok).toBe(true);
    expect(
      ProgramImageSystem.admitBody({
        bg: pictures(RichText.BODY_MAX_IMAGES),
        en: 'Words.',
      }).ok,
    ).toBe(true);
  });

  it('refuses each language one over, naming how many it holds', () => {
    const over = pictures(RichText.BODY_MAX_IMAGES + 1);
    expect(
      unwrapErr(ProgramImageSystem.admitBody({ bg: over, en: over })),
    ).toEqual([
      {
        errorCode: EngagementErrorCode.ProgramBodyTooManyImages,
        rawValue: RichText.BODY_MAX_IMAGES + 1,
      },
      {
        errorCode: EngagementErrorCode.ProgramBodyTooManyImages,
        rawValue: RichText.BODY_MAX_IMAGES + 1,
      },
    ]);
  });
});

describe('ProgramImageSystem.staleOf', () => {
  const named = [ProgramImageId.of('kept')];

  it('answers what is not named and older than an hour', () => {
    expect(
      ProgramImageSystem.staleOf(
        ROLE,
        [
          entry('kept', 5 * HOUR),
          entry('old', 2 * HOUR),
          entry('exactly', HOUR),
          entry('young', HOUR - 1),
          entry('undated', null),
        ],
        named,
        NOW,
      ),
    ).toEqual([
      'media/programs/role-barber/old',
      'media/programs/role-barber/exactly',
    ]);
  });

  it('never answers an object outside the folder', () => {
    expect(
      ProgramImageSystem.staleOf(
        ROLE,
        [
          {
            path: 'media/programs/role-barber-2/old',
            createdUtcMs: (NOW - 9 * HOUR) as UtcEpochMs,
          },
          {
            path: 'media/barbers/ivan/photo',
            createdUtcMs: (NOW - 9 * HOUR) as UtcEpochMs,
          },
        ],
        [],
        NOW,
      ),
    ).toEqual([]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const listed = deepFreeze([entry('old', 2 * HOUR), entry('kept', HOUR)]);
    const frozen = deepFreeze(named);
    expect(ProgramImageSystem.staleOf(ROLE, listed, frozen, NOW)).toEqual(
      ProgramImageSystem.staleOf(ROLE, listed, frozen, NOW),
    );
  });
});
