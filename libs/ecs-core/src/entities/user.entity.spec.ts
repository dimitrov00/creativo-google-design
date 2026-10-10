import { describe, expect, it } from 'vitest';
import { Profile } from './user.entity';

describe('Profile.fullName', () => {
  it('joins first and last name with one space (User.fullName)', () => {
    expect(Profile.fullName({ firstName: 'Иван', lastName: 'Петров' })).toBe(
      'Иван Петров',
    );
  });

  it('reads a provisioned stub with no names as empty, and trims a missing half', () => {
    expect(Profile.fullName({ firstName: null, lastName: null })).toBe('');
    expect(Profile.fullName({ firstName: 'Иван', lastName: null })).toBe(
      'Иван',
    );
    expect(Profile.fullName({ firstName: null, lastName: 'Петров' })).toBe(
      'Петров',
    );
  });
});
