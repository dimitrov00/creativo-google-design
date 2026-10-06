import type {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import {
  type AdminRhythmLeaving,
  adminRhythmCanDeactivate,
} from './admin-rhythm.guard';

// The guard reads its first argument alone: the route and the two states
// the router hands it beside the page are never looked at.
const ROUTE = {} as ActivatedRouteSnapshot;
const STATE = {} as RouterStateSnapshot;

const leave = (component: AdminRhythmLeaving | null) =>
  adminRhythmCanDeactivate(component, ROUTE, STATE, STATE);

/** A page that answers what the spec tells it to, when the spec tells it to. */
function page(): AdminRhythmLeaving & {
  readonly confirmLeave: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  answer(leaves: boolean): void;
} {
  let settle: (leaves: boolean) => void = () => undefined;
  const asked = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  return {
    confirmLeave: vi.fn(() => asked),
    answer: (leaves) => settle(leaves),
  };
}

describe('adminRhythmCanDeactivate', () => {
  it('lets the admin go when the page says so', async () => {
    const rhythm = page();
    const answer = leave(rhythm);
    rhythm.answer(true);

    await expect(answer).resolves.toBe(true);
    expect(rhythm.confirmLeave).toHaveBeenCalledTimes(1);
  });

  it('keeps the admin on the page when they chose to go on editing', async () => {
    const rhythm = page();
    const answer = leave(rhythm);
    rhythm.answer(false);

    await expect(answer).resolves.toBe(false);
  });

  it('waits for the question to be answered: it decides nothing itself', async () => {
    const rhythm = page();
    let answered = false;
    const answer = Promise.resolve(leave(rhythm)).then((leaves) => {
      answered = true;
      return leaves;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(answered).toBe(false);

    rhythm.answer(true);
    await expect(answer).resolves.toBe(true);
  });

  it('asks the page every time the admin tries to leave', async () => {
    const rhythm: AdminRhythmLeaving = {
      confirmLeave: vi
        .fn<() => Promise<boolean>>()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    };

    await expect(leave(rhythm)).resolves.toBe(false);
    await expect(leave(rhythm)).resolves.toBe(true);
    expect(rhythm.confirmLeave).toHaveBeenCalledTimes(2);
  });

  it('lets the admin go from a route whose page never came to be', () => {
    expect(leave(null)).toBe(true);
  });
});
