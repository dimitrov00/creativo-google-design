import { describe, expect, it } from 'vitest';
import { ContactMethod } from './program-contact.data';

describe('ContactMethod', () => {
  it('declares the ways to answer a program SCREAMING, in the order the editor offers them', () => {
    expect(Object.entries(ContactMethod)).toEqual([
      ['Phone', 'PHONE'],
      ['Email', 'EMAIL'],
      ['Instagram', 'INSTAGRAM'],
      ['Link', 'LINK'],
    ]);
  });
});
