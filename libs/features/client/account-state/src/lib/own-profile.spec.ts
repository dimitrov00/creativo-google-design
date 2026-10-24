import { describe, expect, it } from 'vitest';
import { AccountsErrorCode } from '@core/errors';
import { nameRefusalCodes } from './own-profile';

/*
 * The owner's profile write itself (`saveOwnProfile`) moved to
 * `@core/pipelines` with its cases (pass C, C-31:
 * `save-own-profile.pipeline.spec.ts`); its callers are stores, which
 * import it from there. This spec keeps the name rule's words.
 */

describe('nameRefusalCodes', () => {
  it('names each field the two-character rule refuses, null where it passes', () => {
    expect(nameRefusalCodes('A', 'Petrova')).toEqual({
      firstName: AccountsErrorCode.FirstNameTooShort,
      lastName: null,
    });
    expect(nameRefusalCodes('Maria', ' B ')).toEqual({
      firstName: null,
      lastName: AccountsErrorCode.LastNameTooShort,
    });
  });
});
