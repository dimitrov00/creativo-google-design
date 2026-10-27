import { describe, expect, it } from 'vitest';
import { Tag } from '@core/primitives';
import { Collections } from '@core/entities';
import { GovernedCollection } from './governed-collection.data';
import type { GovernedDocCollection } from './governed-doc-collection.data';

/** `appointmentNotes` → `APPOINTMENT_NOTES` — a path upper-snaked. */
const screaming = (path: string): string =>
  path.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

describe('GovernedCollection — every collection the document-change trigger audits (WS-3, RU-15, RU-40)', () => {
  const entries = Object.entries(GovernedCollection);

  it('holds fourteen tags, USERS included, each once', () => {
    expect(entries).toHaveLength(14);
    expect(new Set(Tag.values(GovernedCollection)).size).toBe(14);
    expect(GovernedCollection.Users).toBe('USERS');
  });

  it('names each member after a real collection: the same key in Collections, its path upper-snaked', () => {
    const collections = new Map<string, string>(Object.entries(Collections));
    for (const [key, tag] of entries) {
      const path = collections.get(key);
      expect(path, key).toBeDefined();
      expect(screaming(path as string)).toBe(tag);
    }
  });

  it('keeps the profile verbs’ collection apart: GovernedDocCollection is every member but USERS (tsc)', () => {
    type Docs = Exclude<GovernedCollection, typeof GovernedCollection.Users>;
    // `tsc` failing on either constant IS the failure.
    const same: [Docs] extends [GovernedDocCollection]
      ? [GovernedDocCollection] extends [Docs]
        ? true
        : false
      : false = true;
    const noUsers: [
      Extract<GovernedDocCollection, typeof GovernedCollection.Users>,
    ] extends [never]
      ? true
      : false = true;
    expect([same, noUsers]).toEqual([true, true]);
  });
});
