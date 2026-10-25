import { describe, expect, it } from 'vitest';
import { AccountsError } from '@core/errors';
import { nameRefusalsOf } from './own-profile';

/*
 * The owner's profile write itself (`saveOwnProfile`) moved to
 * `@core/pipelines` with its cases (pass C, C-31:
 * `save-own-profile.pipeline.spec.ts`); its callers are stores, which
 * import it from there. This spec keeps the name rule's words — since pass D
 * (E-8) each refusal is its struct, so its `minLength` rides to the words.
 */

describe('nameRefusalsOf', () => {
  it('names each field the two-character rule refuses, null where it passes', () => {
    expect(nameRefusalsOf('A', 'Petrova')).toEqual({
      firstName: AccountsError.firstNameTooShort('A', 2),
      lastName: null,
    });
    expect(nameRefusalsOf('Maria', ' B ')).toEqual({
      firstName: null,
      lastName: AccountsError.lastNameTooShort(' B ', 2),
    });
  });
});
