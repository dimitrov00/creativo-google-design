import { describe, expect, it } from 'vitest';
import { RepositoryError } from '@core/errors';
import { entityOf, readFailed, reasonOf, writeFailed } from './stored-entity';

type Thing = {
  readonly id: string;
  readonly rank: number;
  readonly tag: string;
};

describe('stored-entity — the document is the entity', () => {
  it('spreads the body beside its id, and nothing else', () => {
    expect(entityOf<Thing>('t1', { rank: 2, tag: 'a' })).toEqual({
      id: 't1',
      rank: 2,
      tag: 'a',
    });
  });
});

describe('stored-entity — a failure as the store’s own reason', () => {
  it('reads a failure’s reason as Firestore’s code, else its message', () => {
    expect(reasonOf({ code: 'permission-denied' })).toBe('permission-denied');
    expect(reasonOf(new Error('boom'))).toBe('boom');
    expect(reasonOf('???')).toBeNull();
  });

  it('reads Storage’s code the same way', () => {
    expect(reasonOf({ code: 'storage/unauthorized' })).toBe(
      'storage/unauthorized',
    );
  });

  it('prefers the code to the message, and ignores a non-string code', () => {
    expect(
      reasonOf(Object.assign(new Error('boom'), { code: 'unavailable' })),
    ).toBe('unavailable');
    expect(reasonOf(Object.assign(new Error('boom'), { code: 14 }))).toBe(
      'boom',
    );
    expect(reasonOf(null)).toBeNull();
  });

  it('wraps the reason into the read and write refusals of a path', () => {
    const cause = { code: 'permission-denied' };
    expect(readFailed('things/t1', cause)).toEqual(
      RepositoryError.readFailed('things/t1', 'permission-denied'),
    );
    expect(writeFailed('things/t1', cause)).toEqual(
      RepositoryError.writeFailed('things/t1', 'permission-denied'),
    );
  });
});
