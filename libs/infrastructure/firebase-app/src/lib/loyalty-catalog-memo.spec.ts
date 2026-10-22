import { describe, expect, it } from 'vitest';
import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RepositoryError, Result } from '@core/primitives';
import { localDate, loyaltyCatalogFixture } from '@core/testing';
import {
  LOYALTY_CATALOG_MEMO,
  type LoyaltyCatalogRead,
  loyaltyCatalogMemo,
} from './loyalty-catalog-memo';

const TODAY = localDate('2026-09-28');
const TOMORROW = localDate('2026-09-29');

const aRead = (): LoyaltyCatalogRead =>
  Promise.resolve(Result.ok(loyaltyCatalogFixture()));
const aFailedRead = (): LoyaltyCatalogRead =>
  Promise.resolve(Result.err(RepositoryError.unavailable()));

describe('loyaltyCatalogMemo — the session’s copy of the catalogue', () => {
  it('keeps a read for its day, and answers it for no other day', () => {
    const memo = loyaltyCatalogMemo();
    const read = aRead();

    expect(memo.readOn(TODAY)).toBeNull();
    memo.keep(read, TODAY);

    expect(memo.readOn(TODAY)).toBe(read);
    expect(memo.readOn(TOMORROW)).toBeNull();
  });

  it('keeps one read at a time: the day’s new copy takes the old one’s place', () => {
    const memo = loyaltyCatalogMemo();
    const yesterday = aRead();
    const today = aRead();

    memo.keep(yesterday, TODAY);
    memo.keep(today, TOMORROW);

    expect(memo.readOn(TODAY)).toBeNull();
    expect(memo.readOn(TOMORROW)).toBe(today);
  });

  it('drops the read it names — never a newer one that took its place meanwhile', () => {
    const memo = loyaltyCatalogMemo();
    const failed = aFailedRead();
    const newer = aRead();

    memo.keep(failed, TODAY);
    memo.drop(failed);
    expect(memo.readOn(TODAY)).toBeNull();

    memo.keep(failed, TODAY);
    memo.keep(newer, TODAY);
    memo.drop(failed);
    expect(memo.readOn(TODAY)).toBe(newer);
  });

  it('forgets whatever is kept on invalidate; a read in flight still answers whoever waited on it', async () => {
    const memo = loyaltyCatalogMemo();
    const inFlight = aRead();
    memo.keep(inFlight, TODAY);

    memo.invalidate();

    expect(memo.readOn(TODAY)).toBeNull();
    const answered = await inFlight;
    expect(answered.ok).toBe(true);
  });

  it('is ONE memo for the session: the root token answers the same one in every injector', () => {
    const root = TestBed.inject(EnvironmentInjector);
    const catalogue = createEnvironmentInjector([], root).get(
      LOYALTY_CATALOG_MEMO,
    );
    const gateway = createEnvironmentInjector([], root).get(
      LOYALTY_CATALOG_MEMO,
    );
    const read = aRead();

    catalogue.keep(read, TODAY);
    expect(gateway.readOn(TODAY)).toBe(read);

    gateway.invalidate();
    expect(catalogue.readOn(TODAY)).toBeNull();
    expect(gateway).toBe(TestBed.inject(LOYALTY_CATALOG_MEMO));
  });
});
