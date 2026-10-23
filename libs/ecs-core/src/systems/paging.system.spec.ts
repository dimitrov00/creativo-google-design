import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { UtcEpochMs } from '@core/primitives';
import { deepFreeze, utcMs } from '@core/testing';
import { type Page, PageStep, PagingSystem } from './paging.system';

/*
 * COPIED and re-targeted: the three paging cases of libs/infrastructure/
 * firestore/src/lib/client-history-reader.adapter.integration.spec.ts
 * («reads every visit … newest first», «pages on the stored start until
 * nothing older is left», «keeps visits starting at the same instant on one
 * page» — the rule `:156` protects). The emulator's queries are played by
 * `pageFor` below — the adapter's own three reads over an in-memory book,
 * every decision taken by `PagingSystem`. The other two cases of that spec
 * (a document that does not parse, the rules refusing a content manager)
 * are the adapter's and the rules', not paging, and stay there. Plus a
 * property (paging to the end reads every row exactly once, newest first)
 * and purity.
 *
 * Flatten pass (Law 7): the page key is the visit's start INSTANT — the typed
 * cursor `beforeUtcMs: UtcEpochMs` of the `PageClientHistory` port
 * (flatten-spec §3.8) — while `PageKey` stays generic and opaque to the system
 * (the legacy adapter's shim once kept its stored ISO string as the key).
 */

const S = PagingSystem;

type Row = { readonly id: string; readonly startUtcMs: UtcEpochMs };

const visit = (id: string, local: string): Row => ({
  id,
  startUtcMs: utcMs(`${local}.000+03:00`),
});
const keyOf = (row: Row): UtcEpochMs => row.startUtcMs;
const idOf = (row: Row): string => row.id;

/** The store's order: newest first by the stored start (ties in no promised order). */
function newestFirst(rows: readonly Row[]): Row[] {
  return [...rows].sort((a, b) => b.startUtcMs - a.startUtcMs);
}

/** The adapter's reads, the system's decisions — `pageForSubject` without the SDK. */
function pageFor(
  book: readonly Row[],
  page: { readonly beforeUtcMs: UtcEpochMs | null; readonly limit: number },
): Page<Row, UtcEpochMs> {
  const size = S.pageSize(page.limit);
  const below = (bound: UtcEpochMs | null) =>
    newestFirst(book).filter((row) => bound === null || row.startUtcMs < bound);
  const read = below(page.beforeUtcMs).slice(0, size + 1);
  const step = S.nextCursor(read, size, keyOf);
  if (step.pageStep === PageStep.Page) return step;
  const tied = book.filter((row) => row.startUtcMs === step.boundary);
  const older = below(step.boundary).slice(0, 1);
  return S.sameInstantBoundary(
    step.newer,
    tied,
    idOf,
    older.length > 0,
    step.boundary,
  );
}

const ids = (page: Page<Row, UtcEpochMs>) => page.rows.map((row) => row.id);

describe('the client history pages (client-history-reader)', () => {
  // Georgi's visits: as company on a-02, his own on the rest.
  const book: readonly Row[] = [
    visit('a-01', '2026-06-02T10:00:00'),
    visit('a-02', '2026-07-01T10:00:00'),
    visit('a-03', '2026-08-05T10:00:00'),
    visit('a-05', '2026-09-28T10:00:00'),
  ];

  it('reads every visit with a seat for the person — as company too — newest first', () => {
    const page = pageFor(book, { beforeUtcMs: null, limit: 10 });
    expect(ids(page)).toEqual(['a-05', 'a-03', 'a-02', 'a-01']);
    expect(page.cursor).toBeNull();
  });

  it('pages on the stored start until nothing older is left', () => {
    const first = pageFor(book, { beforeUtcMs: null, limit: 3 });
    expect(ids(first)).toEqual(['a-05', 'a-03', 'a-02']);
    expect(first.cursor).toBe(visit('x', '2026-07-01T10:00:00').startUtcMs);
    const next = pageFor(book, { beforeUtcMs: first.cursor, limit: 3 });
    expect(ids(next)).toEqual(['a-01']);
    expect(next.cursor).toBeNull();
  });

  it('keeps visits starting at the same instant on one page, and says when nothing is older', () => {
    const tiedBook = [...book, visit('a-05b', '2026-09-28T10:00:00')];
    const page = pageFor(tiedBook, { beforeUtcMs: null, limit: 1 });
    expect([...ids(page)].sort()).toEqual(['a-05', 'a-05b']);
    const rest = pageFor(tiedBook, { beforeUtcMs: page.cursor, limit: 5 });
    expect(ids(rest)).toEqual(['a-03', 'a-02', 'a-01']);

    const only = [
      visit('b-01', '2026-09-28T10:00:00'),
      visit('b-02', '2026-09-28T10:00:00'),
    ];
    const whole = pageFor(only, { beforeUtcMs: null, limit: 1 });
    expect(whole.cursor).toBeNull();
    expect(whole.rows).toHaveLength(2);
  });
});

describe('PagingSystem — the steps', () => {
  it('honours a whole page size of at least one', () => {
    expect(S.pageSize(3.7)).toBe(3);
    expect(S.pageSize(0)).toBe(1);
    expect(S.pageSize(-4)).toBe(1);
  });

  it('cuts a page below its last key, ties the instant the extra row shares', () => {
    const read = [
      visit('c', '2026-09-03T10:00:00'),
      visit('b', '2026-09-02T10:00:00'),
      visit('a', '2026-09-01T10:00:00'),
    ];
    expect(S.nextCursor(read, 2, keyOf)).toEqual({
      pageStep: 'PAGE',
      rows: read.slice(0, 2),
      cursor: read[1]?.startUtcMs,
    });
    const tied = [
      visit('c', '2026-09-03T10:00:00'),
      visit('b', '2026-09-02T10:00:00'),
      visit('a', '2026-09-02T10:00:00'),
    ];
    expect(S.nextCursor(tied, 2, keyOf)).toEqual({
      pageStep: 'TIED',
      boundary: tied[1]?.startUtcMs,
      newer: [tied[0]],
    });
  });

  it('takes the tied instant whole, newest id first, resuming only when something is older', () => {
    const newer = [visit('z', '2026-09-03T10:00:00')];
    const tied = [
      visit('a', '2026-09-02T10:00:00'),
      visit('c', '2026-09-02T10:00:00'),
      visit('b', '2026-09-02T10:00:00'),
    ];
    const boundary = utcMs('2026-09-02T10:00:00.000+03:00');
    expect(S.sameInstantBoundary(newer, tied, idOf, true, boundary)).toEqual({
      rows: [newer[0], tied[1], tied[2], tied[0]],
      cursor: boundary,
    });
    expect(
      S.sameInstantBoundary(newer, tied, idOf, false, boundary).cursor,
    ).toBeNull();
  });

  it('reads every row exactly once, newest first, whatever the page size and ties (property)', () => {
    const minute = fc.integer({ min: 0, max: 12 });
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 999 }), { maxLength: 30 }),
        fc.array(minute, { minLength: 30, maxLength: 30 }),
        fc.integer({ min: 1, max: 6 }),
        (idNumbers, minutes, limit) => {
          const book = idNumbers.map((n, i) =>
            visit(
              `id-${String(n).padStart(3, '0')}`,
              `2026-09-01T10:${String(minutes.at(i) ?? 0).padStart(2, '0')}:00`,
            ),
          );
          const seen: Row[] = [];
          let cursor: UtcEpochMs | null = null;
          for (let guard = 0; guard <= book.length + 1; guard++) {
            const page = pageFor(book, { beforeUtcMs: cursor, limit });
            seen.push(...page.rows);
            cursor = page.cursor;
            if (cursor === null) break;
          }
          expect(cursor).toBeNull();
          expect(seen.map((row) => row.id).sort()).toEqual(
            book.map((row) => row.id).sort(),
          );
          for (let i = 1; i < seen.length; i++) {
            expect(
              (seen.at(i - 1) as Row).startUtcMs >=
                (seen.at(i) as Row).startUtcMs,
            ).toBe(true);
          }
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const read = deepFreeze([
      visit('c', '2026-09-03T10:00:00'),
      visit('b', '2026-09-02T10:00:00'),
      visit('a', '2026-09-02T10:00:00'),
    ]);
    expect(S.nextCursor(read, 2, keyOf)).toEqual(S.nextCursor(read, 2, keyOf));
    const tied = deepFreeze([read[2] as Row, read[1] as Row]);
    const k = utcMs('2026-09-02T10:00:00.000+03:00');
    const once = S.sameInstantBoundary([], tied, idOf, true, k);
    expect(S.sameInstantBoundary([], tied, idOf, true, k)).toEqual(once);
    expect(tied.map((row) => row.id)).toEqual(['a', 'b']);
  });
});
