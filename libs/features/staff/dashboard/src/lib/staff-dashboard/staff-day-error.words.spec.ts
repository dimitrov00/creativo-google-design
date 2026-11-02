import { describe, expect, it } from 'vitest';
import {
  BookingErrorCode,
  PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import { BookingStatus } from '@core/primitives';
import { catalogueTranslate } from './catalogue.spec-support';
import { refusalSentence } from './staff-day-error.words';

const translate = catalogueTranslate('bg');
const english = catalogueTranslate('en');

/** The host's coded translation: the catalogue's line, the code when it has none. */
const wordCode =
  (say: typeof translate) =>
  (code: string, params: Readonly<Record<string, unknown>>): string => {
    try {
      return say(`errors.${code}`, params as Record<string, string>);
    } catch {
      return code;
    }
  };

const transition = (from: string, to: string): PipelineError => ({
  ...PipelineError.of(
    PipelineErrorCode.InvalidRequest,
    BookingErrorCode.TransitionNotAllowed,
    null,
    null,
  ),
  serverParams: { fromBookingStatus: from, toBookingStatus: to },
});

describe('refusalSentence — a refusal in the shop’s words', () => {
  it('says a transition’s two statuses as the rows do', () => {
    const refused = transition(
      BookingStatus.Cancelled,
      BookingStatus.Completed,
    );
    const bg = refusalSentence(refused, translate, wordCode(translate));
    expect(bg).toContain('Отказан');
    const en = refusalSentence(refused, english, wordCode(english));
    expect(en).toContain('Cancelled');
  });

  it('gives a seat already resolved its own line, never the graph', () => {
    const refused = transition('RESOLVED', BookingStatus.Cancelled);
    expect(refusalSentence(refused, translate, wordCode(translate))).toBe(
      'Това място вече е приключено.',
    );
    expect(refusalSentence(refused, english, wordCode(english))).toBe(
      'That seat is already settled.',
    );
  });

  it('falls back to the surface’s own line', () => {
    const bare = PipelineError.bare(PipelineErrorCode.Unknown);
    expect(refusalSentence(bare, translate, wordCode(translate))).toBe(
      'Нещо се обърка. Опитай пак.',
    );
    expect(refusalSentence(bare, english, wordCode(english))).toBe(
      'Something went wrong. Try again.',
    );
  });
});
