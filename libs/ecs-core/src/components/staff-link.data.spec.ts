import { describe, expect, it } from 'vitest';
import { deepFreeze } from '@core/testing';
import { StaffLink } from './staff-link.data';

describe('StaffLink.of — the absent-as-null reader of users/{uid}', () => {
  it('reads a stored barber id', () => {
    expect(StaffLink.of(deepFreeze({ linkedBarberId: 'ivan' }))).toEqual({
      linkedBarberId: 'ivan',
    });
  });

  it('reads an absent field (a document older than the link) as null', () => {
    expect(StaffLink.of(deepFreeze({ roles: ['barber'] }))).toEqual({
      linkedBarberId: null,
    });
  });

  it('reads a stored null as null', () => {
    expect(StaffLink.of(deepFreeze({ linkedBarberId: null }))).toEqual(
      StaffLink.NONE,
    );
  });

  it('reads a malformed field as not linked, never a barber it was not given', () => {
    for (const raw of [42, '', ['ivan'], { id: 'ivan' }, 'a/b']) {
      expect(StaffLink.of({ linkedBarberId: raw })).toEqual(StaffLink.NONE);
    }
  });

  it('reads a non-object body as not linked', () => {
    for (const raw of [null, undefined, 'ivan', 3]) {
      expect(StaffLink.of(raw)).toEqual(StaffLink.NONE);
    }
  });

  it('is pure: same input, same answer, input unchanged', () => {
    const body = deepFreeze({ linkedBarberId: 'niko' });
    expect(StaffLink.of(body)).toEqual(StaffLink.of(body));
    expect(body).toEqual({ linkedBarberId: 'niko' });
  });
});
