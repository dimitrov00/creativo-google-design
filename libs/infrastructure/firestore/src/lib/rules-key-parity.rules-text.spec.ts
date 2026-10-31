import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  AppointmentNote,
  AppointmentPhoto,
  ScheduleException,
} from '@core/entities';

/*
 * The book's three browser-written collections as rules TEXT (security
 * hardening S-DEP-5, S-L-14): each create / update names only the keys its
 * entity stores — `keys().hasOnly([…])` — and this spec ties every such
 * list to a key table the COMPILER checks against the entity, so a field
 * added to, renamed in or dropped from `AppointmentNote`, `AppointmentPhoto`
 * or `ScheduleException` fails here instead of in production (a list that
 * lags the entity refuses the app's own write). It also pins the id proofs
 * the emulator suite exercises: one `exists(` in the notes and in the photos
 * block, none in the exceptions block (a multi-day block writes many days
 * in one transaction), and the photo id's UUID pattern once. Like
 * `stamp-window.rules-text.spec.ts` and `role.rules-parity.spec.ts`, it
 * reads the rules file as text, comments removed.
 */

/** The workspace's own rules file, a fixed path from this spec. */
const SOURCE = readFileSync(
  resolve(__dirname, '../../../../../firestore.rules'),
  'utf8',
);

/** The rules text without its `//` and block comments — quoted strings kept whole. */
function rulesCode(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (ch === "'" || ch === '"') {
      let end = i + 1;
      while (end < src.length && src.charAt(end) !== ch) {
        end += src.charAt(end) === '\\' ? 2 : 1;
      }
      out += src.slice(i, end + 1);
      i = end + 1;
    } else if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

const CODE = rulesCode(SOURCE);

/** The text of `match <path> { … }`, braces balanced; throws when absent. */
function blockOf(path: string): string {
  const head = `match ${path} {`;
  const start = CODE.indexOf(head);
  if (start === -1) throw new Error(`no ${head} in firestore.rules`);
  let depth = 0;
  for (let i = start + head.length - 1; i < CODE.length; i++) {
    if (CODE.charAt(i) === '{') depth += 1;
    else if (CODE.charAt(i) === '}') {
      depth -= 1;
      if (depth === 0) return CODE.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${head}`);
}

/** How often `needle` occurs in `text`. */
const occurrences = (text: string, needle: string): number =>
  text.split(needle).length - 1;

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

/** Over the three effect variants: `CLOSED` stores no `exceptionRanges`, the ranged two do. */
const EXCEPTION_KEYS: KeyTable<ScheduleException> = {
  barberId: true,
  exceptionEffect: true,
  exceptionRanges: true,
  localDate: true,
  locationId: true,
  utcEpochMs: true,
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
    ['/scheduleExceptions/{dayDocId}', EXCEPTION_KEYS],
  ] as const)(
    '%s lists exactly its entity’s stored keys, once',
    (path, table) => {
      expect(hasOnlyLists(blockOf(path))).toEqual([sortedKeys(table)]);
    },
  );

  it('ties a note and a photo to an existing appointment with one exists( each, and an exception to no read at all', () => {
    expect(
      occurrences(blockOf('/appointmentNotes/{appointmentId}'), 'exists('),
    ).toBe(1);
    expect(
      occurrences(
        blockOf('/appointmentNotes/{appointmentId}'),
        'exists(/databases/$(database)/documents/appointments/$(appointmentId))',
      ),
    ).toBe(1);
    expect(
      occurrences(blockOf('/appointmentPhotos/{photoId}'), 'exists('),
    ).toBe(1);
    expect(
      occurrences(
        blockOf('/appointmentPhotos/{photoId}'),
        'exists(/databases/$(database)/documents/appointments/$(request.resource.data.appointmentId))',
      ),
    ).toBe(1);
    const exceptions = blockOf('/scheduleExceptions/{dayDocId}');
    expect(occurrences(exceptions, 'exists(')).toBe(0);
    expect(occurrences(exceptions, 'get(')).toBe(0);
    expect(exceptions).toContain(
      "dayDocId == request.resource.data.barberId + '__' + request.resource.data.localDate",
    );
  });

  it('holds the photo id’s UUID pattern once, inside the photos block', () => {
    expect(occurrences(CODE, PHOTO_ID_PATTERN)).toBe(1);
    expect(blockOf('/appointmentPhotos/{photoId}')).toContain(PHOTO_ID_PATTERN);
  });
});
