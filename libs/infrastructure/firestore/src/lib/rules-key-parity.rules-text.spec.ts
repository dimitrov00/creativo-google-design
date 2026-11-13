import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppointmentNote, AppointmentPhoto } from '@core/entities';
import { blockOf, occurrences, rulesCode } from '@core/testing';

/*
 * The book's two browser-written collections as rules TEXT (security
 * hardening S-DEP-5, S-L-14): each create / update names only the keys its
 * entity stores — `keys().hasOnly([…])` — and this spec ties every such
 * list to a key table the COMPILER checks against the entity, so a field
 * added to, renamed in or dropped from `AppointmentNote` or
 * `AppointmentPhoto` fails here instead of in production (a list that lags
 * the entity refuses the app's own write). It also pins the id proofs the
 * emulator suite exercises: one `exists(` in the notes and in the photos
 * block, and the photo id's UUID pattern once — and that
 * `scheduleExceptions`, once the third, has no client writer at all (team
 * onboarding O4: the `setDayExceptions` callable is its one door). Like
 * `stamp-window.rules-text.spec.ts` and `role.rules-parity.spec.ts`, it
 * reads the rules file as text, comments removed — through the one rules
 * reader of `@core/testing` (`rules-text.ts`).
 */

/** The workspace's own `firestore.rules`, comments removed (`src/lib` is five levels down). */
const CODE = rulesCode(
  readFileSync(resolve(__dirname, '../../../../../firestore.rules'), 'utf8'),
);

/** The quoted keys of every `keys().hasOnly([…])` in `block`, one list per call. */
function hasOnlyLists(block: string): string[][] {
  return [...block.matchAll(/keys\(\)\.hasOnly\(\[([^\]]*)\]\)/g)].map(
    ([, inner = '']) =>
      [...inner.matchAll(/'([^']*)'/g)].map(([, key = '']) => key),
  );
}

/** Every stored root key of an entity, over all its variants — its `id` is the document id, never a field. */
type StoredKey<T> = T extends unknown ? Exclude<keyof T, 'id'> : never;

/** EVERY stored key of one entity and nothing else: a renamed, added or dropped field fails to compile here. */
type KeyTable<T> = { readonly [K in StoredKey<T>]: true };

const NOTE_KEYS: KeyTable<AppointmentNote> = {
  authorUserId: true,
  text: true,
  writtenAtUtcMs: true,
};

const PHOTO_KEYS: KeyTable<AppointmentPhoto> = {
  appointmentId: true,
  barberId: true,
  clientCustomerId: true,
  clientLabel: true,
  height: true,
  label: true,
  path: true,
  photoOrigin: true,
  takenAtUtcMs: true,
  takenByUserId: true,
  url: true,
  width: true,
};

/** A key table's keys in code-unit order — the order the rules lists are written in. */
const sortedKeys = (table: Readonly<Record<string, true>>): string[] =>
  Object.keys(table).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const PHOTO_ID_PATTERN =
  "photoId.matches('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')";

describe('firestore.rules — the book’s key lists match the entities (S-DEP-5)', () => {
  it.each([
    ['/appointmentNotes/{appointmentId}', NOTE_KEYS],
    ['/appointmentPhotos/{photoId}', PHOTO_KEYS],
  ] as const)(
    '%s lists exactly its entity’s stored keys, once',
    (path, table) => {
      expect(hasOnlyLists(blockOf(CODE, path))).toEqual([sortedKeys(table)]);
    },
  );

  it('ties a note and a photo to an existing appointment with one exists( each', () => {
    expect(
      occurrences(
        blockOf(CODE, '/appointmentNotes/{appointmentId}'),
        'exists(',
      ),
    ).toBe(1);
    expect(
      occurrences(
        blockOf(CODE, '/appointmentNotes/{appointmentId}'),
        'exists(/databases/$(database)/documents/appointments/$(appointmentId))',
      ),
    ).toBe(1);
    expect(
      occurrences(blockOf(CODE, '/appointmentPhotos/{photoId}'), 'exists('),
    ).toBe(1);
    expect(
      occurrences(
        blockOf(CODE, '/appointmentPhotos/{photoId}'),
        'exists(/databases/$(database)/documents/appointments/$(request.resource.data.appointmentId))',
      ),
    ).toBe(1);
  });

  it('gives a day exception no client writer: world-readable, every write refused, no key list and no read (team onboarding O4)', () => {
    const exceptions = blockOf(CODE, '/scheduleExceptions/{dayDocId}');
    expect(occurrences(exceptions, 'allow read: if true;')).toBe(1);
    expect(occurrences(exceptions, 'allow write: if false;')).toBe(1);
    expect(occurrences(exceptions, 'allow ')).toBe(2);
    expect(hasOnlyLists(exceptions)).toEqual([]);
    expect(occurrences(exceptions, 'exists(')).toBe(0);
    expect(occurrences(exceptions, 'get(')).toBe(0);
    // The roster-editor grant it once used is gone with its last user.
    expect(occurrences(CODE, 'mayEditRoster')).toBe(0);
  });

  it('holds the photo id’s UUID pattern once, inside the photos block', () => {
    expect(occurrences(CODE, PHOTO_ID_PATTERN)).toBe(1);
    expect(blockOf(CODE, '/appointmentPhotos/{photoId}')).toContain(
      PHOTO_ID_PATTERN,
    );
  });
});
