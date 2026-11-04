import { afterEach, describe, expect, it } from 'vitest';
import { SearchFilter, SearchQuery } from '@core/components';
import { BarberId } from '@core/primitives';
import {
  SEARCH_RECENTS_KEY,
  SEARCH_RECENTS_MAX,
  clearRecents,
  loadRecents,
  pushRecent,
  saveRecents,
} from './staff-search-recents';

const text = (searchText: string) =>
  SearchQuery.withText(SearchQuery.empty(), searchText);

describe('pushRecent', () => {
  it('puts the newest first', () => {
    const list = pushRecent(pushRecent([], text('петър')), text('фейд'));
    expect(list.map((q) => q.searchText)).toEqual(['фейд', 'петър']);
  });

  it('moves a repeated search to the front instead of listing it twice (trimmed, structural)', () => {
    const withChip = SearchQuery.withFilter(
      text('иван'),
      SearchFilter.barber([BarberId.of('ivan')]),
    );
    let list = pushRecent([], withChip);
    list = pushRecent(list, text('фейд'));
    list = pushRecent(list, SearchQuery.withText(withChip, 'иван '));
    expect(list).toHaveLength(2);
    expect(list[0]?.searchText).toBe('иван ');
    expect(list[1]?.searchText).toBe('фейд');
  });

  it('keeps a search with the same text and other chips apart', () => {
    const list = pushRecent(
      pushRecent([], text('иван')),
      SearchQuery.withFilter(text('иван'), SearchFilter.note()),
    );
    expect(list).toHaveLength(2);
  });

  it('caps the list at 8, dropping the oldest', () => {
    let list: readonly SearchQuery[] = [];
    for (let i = 0; i < 12; i++) list = pushRecent(list, text(`q${i}`));
    expect(list).toHaveLength(SEARCH_RECENTS_MAX);
    expect(list[0]?.searchText).toBe('q11');
    expect(list[7]?.searchText).toBe('q4');
  });

  it('ignores an empty search, and leaves the list it was given alone', () => {
    const held = Object.freeze([text('петър')]);
    expect(pushRecent(held, SearchQuery.empty())).toBe(held);
    expect(pushRecent(held, text('   '))).toBe(held);
    pushRecent(held, text('фейд'));
    expect(held).toHaveLength(1);
  });
});

describe('the device’s recents', () => {
  afterEach(() => localStorage.clear());

  it('reads back what was saved, chips and all', () => {
    const list = pushRecent(
      pushRecent([], text('петър')),
      SearchQuery.withFilter(
        text('иван'),
        SearchFilter.barber([BarberId.of('ivan')]),
      ),
    );
    saveRecents(localStorage, list);
    expect(loadRecents(localStorage)).toEqual(list);
  });

  it('drops a corrupt entry and keeps the rest', () => {
    localStorage.setItem(
      SEARCH_RECENTS_KEY,
      JSON.stringify([
        { searchText: 'петър', searchFilters: [] },
        { searchText: 4 },
        { searchText: 'x', searchFilters: [{ searchFilterField: 'NOPE' }] },
        { searchText: '', searchFilters: [] },
        { searchText: 'фейд', searchFilters: [] },
      ]),
    );
    expect(loadRecents(localStorage).map((q) => q.searchText)).toEqual([
      'петър',
      'фейд',
    ]);
  });

  it('reads nothing from garbage, a non-list or an empty store', () => {
    expect(loadRecents(localStorage)).toEqual([]);
    localStorage.setItem(SEARCH_RECENTS_KEY, '{not json');
    expect(loadRecents(localStorage)).toEqual([]);
    localStorage.setItem(SEARCH_RECENTS_KEY, '{"searchText":"x"}');
    expect(loadRecents(localStorage)).toEqual([]);
  });

  it('survives storage that is unavailable or throws', () => {
    expect(loadRecents(null)).toEqual([]);
    expect(() => saveRecents(null, [text('x')])).not.toThrow();
    expect(() => clearRecents(null)).not.toThrow();
    const hostile = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadRecents(hostile)).toEqual([]);
    expect(() => saveRecents(hostile, [text('x')])).not.toThrow();
    expect(() => clearRecents(hostile)).not.toThrow();
  });

  it('forgets everything on clear', () => {
    saveRecents(localStorage, [text('петър')]);
    clearRecents(localStorage);
    expect(loadRecents(localStorage)).toEqual([]);
  });
});
