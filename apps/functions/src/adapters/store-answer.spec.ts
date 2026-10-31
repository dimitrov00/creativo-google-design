import { RepositoryErrorCode } from '@core/errors';
import {
  ALREADY_EXISTS,
  bodyOf,
  readFailed,
  writeFailed,
} from './store-answer';

/*
 * What an adapter answers its port with: a failure's `reason` is the SDK
 * failure's canonical code (`FailureCodeSystem.codeOf` — its own spec pins
 * the full code table), never the message; a stored body is the entity
 * minus its id, in the entity's own key order.
 */

describe('store-answer — the one home of an adapter’s failure and body spellings', () => {
  it('answers a read that threw an Admin SDK numeric gRPC code by its canonical name', () => {
    expect(readFailed('appointments/a1', { code: 14 })).toStrictEqual({
      errorCode: RepositoryErrorCode.ReadFailed,
      path: 'appointments/a1',
      reason: 'unavailable',
    });
  });

  it('answers a write that threw a `firestore/…` string code by its canonical name', () => {
    expect(
      writeFailed('auditLog', { code: 'firestore/aborted', message: 'x' }),
    ).toStrictEqual({
      errorCode: RepositoryErrorCode.WriteFailed,
      path: 'auditLog',
      reason: 'aborted',
    });
  });

  it('answers a non-object throw as `unknown`, never its text', () => {
    expect(readFailed('otps', 'boom')).toStrictEqual({
      errorCode: RepositoryErrorCode.ReadFailed,
      path: 'otps',
      reason: 'unknown',
    });
    expect(writeFailed('otps', null).reason).toBe('unknown');
  });

  it('names gRPC 6 as the code `FailureCodeSystem` reads it', () => {
    expect(readFailed('triggerFailures/f1', { code: 6 }).reason).toBe(
      ALREADY_EXISTS,
    );
  });

  it('drops only `id` from a stored body and keeps the key order', () => {
    const entity = { id: 'a1', b: 1, a: 'two', id2: null, nested: { id: 'x' } };
    const body = bodyOf(entity);
    expect(Object.keys(body)).toStrictEqual(['b', 'a', 'id2', 'nested']);
    expect(body).toStrictEqual({
      b: 1,
      a: 'two',
      id2: null,
      nested: { id: 'x' },
    });
    expect(entity.id).toBe('a1');
  });
});
