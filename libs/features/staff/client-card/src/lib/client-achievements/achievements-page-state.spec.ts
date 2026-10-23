import { describe, expect, it } from 'vitest';
import {
  GEORGI_PREVIOUS_MS,
  achievementsContextOf,
  achievementsDataOf,
  georgiContext,
} from '../../testing/client-card.fixtures';
import {
  achievementsIdPrefix,
  achievementsPageState,
} from './achievements-page-state';
import { LoadState } from '@creativo/shared/view-state';

const DATA = achievementsDataOf('georgi', GEORGI_PREVIOUS_MS);
const CTX = achievementsContextOf(georgiContext(), 'Георги Петров');
const READY = { loadState: LoadState.Ready, data: DATA } as const;

describe('achievementsPageState', () => {
  it('is absent (EMPTY) where there is no achievements data at all', () => {
    expect(achievementsPageState(null, CTX, () => 'vm')).toEqual({
      loadState: LoadState.Empty,
    });
  });

  it('waits for the reads, and for the card’s words', () => {
    expect(
      achievementsPageState({ loadState: LoadState.Loading }, CTX, () => 'vm'),
    ).toEqual({ loadState: LoadState.Loading });
    expect(achievementsPageState(READY, null, () => 'vm')).toEqual({
      loadState: LoadState.Loading,
    });
  });

  it('fails with the read', () => {
    expect(
      achievementsPageState({ loadState: LoadState.Failed }, CTX, () => 'vm'),
    ).toEqual({ loadState: LoadState.Failed });
  });

  it('is the page’s VM and its words once built', () => {
    const state = achievementsPageState(READY, CTX, (data, ctx) =>
      data === DATA && ctx === CTX ? 'built' : null,
    );
    expect(state).toEqual({
      loadState: LoadState.Ready,
      data: { vm: 'built', words: CTX.words },
    });
  });

  it('fails a scope or a family the catalogue does not hold: nothing true can be drawn', () => {
    expect(achievementsPageState(READY, CTX, () => null)).toEqual({
      loadState: LoadState.Failed,
    });
  });
});

describe('achievementsIdPrefix', () => {
  it('names each mounted page apart', () => {
    const first = achievementsIdPrefix('achievements');
    const second = achievementsIdPrefix('achievements');
    expect(first).toMatch(/^achievements-\d+$/);
    expect(second).not.toBe(first);
  });
});
