import { describe, expect, it } from 'vitest';
import { DurationMinutes, MinuteDelta } from '@core/primitives';
import { VisitDraftSystem } from '@core/systems';
import { unwrapOk } from '@core/testing';
import {
  catalogNoteWords,
  catalogTagWords,
  minutesDeltaWords,
} from './catalog-tag.words';

/*
 * The tag's words over the system's signed figure. The arithmetic itself —
 * the catalogue's sum, a retired service at its booked length, no distance
 * for a visit that runs as sold — is pinned in `visit-draft.system.spec.ts`.
 */

const label = (minutes: number) => `${minutes} мин`;
const d = (raw: number) => unwrapOk(DurationMinutes.of(raw));
const delta = (raw: number) => unwrapOk(MinuteDelta.of(raw));

describe('the catalogue tag’s words', () => {
  it('writes the distance with a true minus, never a hyphen', () => {
    expect(minutesDeltaWords(delta(-5), label)).toBe('−5 мин');
    expect(minutesDeltaWords(delta(15), label)).toBe('+15 мин');
  });

  it('tags only a visit that runs off the catalogue, and only when the catalogue can say', () => {
    const tag = (span: number, catalog: number | null) =>
      catalogTagWords(
        VisitDraftSystem.minutesDelta(
          d(span),
          catalog === null ? null : d(catalog),
        ),
        label,
      );
    expect(tag(45, 50)).toBe('−5 мин');
    expect(tag(60, 45)).toBe('+15 мин');
    expect(tag(45, 45)).toBeNull();
    expect(tag(45, null)).toBeNull();
  });
});

describe('the visit’s catalogue readout', () => {
  const catalog = (minutes: number) => `Каталог: ${minutes} мин`;

  it('says the catalogue’s total and the distance from it', () => {
    expect(catalogNoteWords(45, delta(15), catalog, label)).toBe(
      'Каталог: 45 мин · +15 мин',
    );
    expect(catalogNoteWords(45, delta(-5), catalog, label)).toBe(
      'Каталог: 45 мин · −5 мин',
    );
  });

  it('says nothing when there is no distance, or no catalogue to measure by', () => {
    expect(catalogNoteWords(45, null, catalog, label)).toBeNull();
    expect(catalogNoteWords(null, delta(5), catalog, label)).toBeNull();
  });
});
