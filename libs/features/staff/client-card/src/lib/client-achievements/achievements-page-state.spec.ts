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

const DATA = achievementsDataOf('georgi', GEORGI_PREVIOUS_MS);
const CTX = achievementsContextOf(georgiContext(), 'Георги Петров');
const READY = { status: 'ready', data: DATA } as const;

describe('achievementsPageState', () => {
  it('is absent where there is no achievements data at all', () => {
    expect(achievementsPageState(null, CTX, () => 'vm')).toEqual({
      kind: 'absent',
    });
  });

  it('waits for the reads, and for the card’s words', () => {
    expect(
      achievementsPageState({ status: 'loading' }, CTX, () => 'vm'),
    ).toEqual({ kind: 'loading' });
    expect(achievementsPageState(READY, null, () => 'vm')).toEqual({
      kind: 'loading',
    });
  });

  it('fails with the read', () => {
    expect(
      achievementsPageState({ status: 'failed' }, CTX, () => 'vm'),
    ).toEqual({ kind: 'failed' });
  });

  it('is the page’s VM and its words once built', () => {
    const state = achievementsPageState(READY, CTX, (data, ctx) =>
      data === DATA && ctx === CTX ? 'built' : null,
    );
    expect(state).toEqual({ kind: 'ready', vm: 'built', words: CTX.words });
  });

  it('fails a scope or a family the catalogue does not hold: nothing true can be drawn', () => {
    expect(achievementsPageState(READY, CTX, () => null)).toEqual({
      kind: 'failed',
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
