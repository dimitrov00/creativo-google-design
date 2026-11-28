import type { CallableRequest } from 'firebase-functions/v2/https';
import { EngagementErrorCode } from '@core/errors';
import {
  decodeAddProgramImage,
  decodeSweepProgramImagesEvent,
} from './programs.wire';

/*
 * The programs pictures' wire: the token gate before the payload, every
 * field re-read, the first unreadable one named; and a description's write
 * as the sweep reads it.
 */

function callable(
  data: unknown,
  roles: readonly unknown[] | null = ['content_manager'],
): CallableRequest<unknown> {
  return {
    data,
    ...(roles === null ? {} : { auth: { uid: 'u-editor', token: { roles } } }),
  } as unknown as CallableRequest<unknown>;
}

const SENT = {
  programId: 'role-barber',
  stagedName: 'staged-0123456789',
  mediaWidth: 1600,
  mediaHeight: 900,
  operationId: 'operation-0123456789ab',
};

/** The refusal of a decode: its code, and the field it names (or `null`). */
function refusalOf(decoded: {
  readonly ok: boolean;
  readonly error?: { readonly errorCode: string; readonly field?: unknown };
}): readonly [string, unknown] | null {
  return decoded.ok || decoded.error === undefined
    ? null
    : [decoded.error.errorCode, decoded.error.field ?? null];
}

describe('decodeAddProgramImage', () => {
  it('reads the call beside the verified caller', () => {
    expect(decodeAddProgramImage(callable(SENT))).toEqual({
      ok: true,
      value: {
        callerUserId: 'u-editor',
        callerRoles: ['content_manager'],
        ...SENT,
      },
    });
  });

  it('refuses a call with no session before reading the payload', () => {
    expect(refusalOf(decodeAddProgramImage(callable(null, null)))).toEqual([
      EngagementErrorCode.ProgramImageUnauthenticated,
      null,
    ]);
  });

  it('refuses a token whose roles do not write the programs pages', () => {
    expect(
      refusalOf(decodeAddProgramImage(callable(SENT, ['barber']))),
    ).toEqual([EngagementErrorCode.ProgramImageForbidden, null]);
  });

  it.each([
    ['programId', { programId: 'a/b' }],
    ['programId', { programId: 7 }],
    ['operationId', { operationId: 'short' }],
    ['stagedName', { stagedName: null }],
    ['mediaWidth', { mediaWidth: '1600' }],
    ['mediaHeight', { mediaHeight: undefined }],
  ])('names an unreadable %s', (field, over) => {
    expect(
      refusalOf(decodeAddProgramImage(callable({ ...SENT, ...over }))),
    ).toEqual([EngagementErrorCode.ProgramImageInvalidInput, field]);
  });
});

describe('decodeSweepProgramImagesEvent', () => {
  const event = (docId: string, after: unknown) => ({
    id: 'event-1',
    time: '2026-11-28T10:00:00.000Z',
    params: { docId },
    data: {
      after:
        after === undefined
          ? { exists: false, data: () => undefined }
          : {
              exists: true,
              data: () => after as { readonly [field: string]: unknown },
            },
    },
  });

  it('reads the saved description', () => {
    expect(
      decodeSweepProgramImagesEvent(
        event('role-barber', { body: { bg: 'Текст', en: 'Words' } }),
      ),
    ).toEqual({
      programId: 'role-barber',
      body: { bg: 'Текст', en: 'Words' },
    });
  });

  it('reads a removed description as none', () => {
    expect(
      decodeSweepProgramImagesEvent(event('role-barber', undefined)),
    ).toEqual({ programId: 'role-barber', body: null });
  });

  it.each([
    ['no body', {}],
    ['a body that is no text', { body: 'words' }],
    ['a language that is no string', { body: { bg: 'Текст', en: 4 } }],
  ])('sweeps nothing after %s', (_, stored) => {
    expect(
      decodeSweepProgramImagesEvent(event('role-barber', stored)),
    ).toBeNull();
  });

  it('sweeps nothing for an id that names no folder', () => {
    expect(
      decodeSweepProgramImagesEvent(event('x'.repeat(200), undefined)),
    ).toBeNull();
  });
});
