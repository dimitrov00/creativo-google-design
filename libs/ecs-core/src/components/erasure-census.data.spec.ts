import { describe, expect, it } from 'vitest';
import { deepFreeze } from '@core/testing';
import { ErasureCensus } from './erasure-census.data';

/* The census of a person's footprint (audit-hardening Phase 3 WS-D,
 * P3-RU-22): eleven counts — eight personal, three retained — and nothing
 * else, so a row or an answer that copies it can carry no value. */

/** Every count set to a distinct number, so a copy that drops or swaps one shows. */
const COUNTED: ErasureCensus = deepFreeze({
  erasureRecordCount: 1,
  erasureAccountCount: 2,
  erasureContactCount: 3,
  erasureLabelCount: 4,
  erasureNoteCount: 5,
  erasurePhotoCount: 6,
  erasureDocumentCount: 7,
  erasurePseudonymCount: 8,
  erasureVisitCount: 9,
  erasureContactKeptCount: 10,
  erasureJournalCount: 11,
});

describe('ErasureCensus', () => {
  it('EMPTY counts nothing — eleven fields in all, every one 0', () => {
    expect(Object.keys(ErasureCensus.EMPTY)).toHaveLength(11);
    expect(Object.values(ErasureCensus.EMPTY)).toEqual(Array(11).fill(0));
    expect(Object.keys(ErasureCensus.EMPTY)).toEqual(Object.keys(COUNTED));
  });

  it('PERSONAL_FIELDS are the eight personal counts, RETAINED_FIELDS the three kept — together every field once', () => {
    expect(ErasureCensus.PERSONAL_FIELDS).toEqual([
      'erasureRecordCount',
      'erasureAccountCount',
      'erasureContactCount',
      'erasureLabelCount',
      'erasureNoteCount',
      'erasurePhotoCount',
      'erasureDocumentCount',
      'erasurePseudonymCount',
    ]);
    expect(ErasureCensus.RETAINED_FIELDS).toEqual([
      'erasureVisitCount',
      'erasureContactKeptCount',
      'erasureJournalCount',
    ]);
    const all = [
      ...ErasureCensus.PERSONAL_FIELDS,
      ...ErasureCensus.RETAINED_FIELDS,
    ];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(Object.keys(ErasureCensus.EMPTY));
  });

  it('every field is domain-prefixed and a count (`erasure…Count`)', () => {
    for (const field of Object.keys(ErasureCensus.EMPTY)) {
      expect(field).toMatch(/^erasure[A-Z][A-Za-z]*Count$/);
    }
  });

  it('countsOf copies exactly the eleven counts — a wider struct’s other fields never ride along', () => {
    const wider = deepFreeze({
      ...COUNTED,
      erasureStatus: 'ERASING',
      erasureDone: false,
      displayName: 'Sentinel Firstname',
    });
    const copied = ErasureCensus.countsOf(wider);
    expect(copied).toEqual(COUNTED);
    expect(Object.keys(copied)).toEqual(Object.keys(ErasureCensus.EMPTY));
    expect(copied).not.toBe(wider);
    expect(JSON.stringify(copied)).not.toContain('Sentinel');
  });

  it('countsOf is pure: same input → same output, the input untouched', () => {
    expect(ErasureCensus.countsOf(COUNTED)).toEqual(
      ErasureCensus.countsOf(COUNTED),
    );
    expect(ErasureCensus.countsOf(ErasureCensus.EMPTY)).toEqual(
      ErasureCensus.EMPTY,
    );
  });
});
