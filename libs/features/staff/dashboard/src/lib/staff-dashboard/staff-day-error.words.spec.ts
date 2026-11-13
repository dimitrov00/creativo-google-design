import { describe, expect, it } from 'vitest';
import {
  BookingErrorCode,
  PipelineError,
  PipelineErrorCode,
  SchedulingError,
  SchedulingErrorCode,
} from '@core/errors';
import { BarberId, BookingStatus } from '@core/primitives';
import { catalogueTranslate } from './catalogue.spec-support';
import { blockFailureSentence, refusalSentence } from './staff-day-error.words';

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

describe('blockFailureSentence — why a block or the hours did not save', () => {
  const refused = (serverErrorCode: string): PipelineError =>
    PipelineError.of(
      PipelineErrorCode.InvalidRequest,
      serverErrorCode,
      null,
      null,
    );
  const GENERIC = 'Не се запази. Опитай пак.';

  it('says the server’s refusal when the catalogue has a line for it — in both languages', () => {
    const forbidden = refused(SchedulingErrorCode.RosterForbidden);
    expect(blockFailureSentence(forbidden, wordCode(translate), GENERIC)).toBe(
      'Можеш да променяш само своето работно време.',
    );
    expect(blockFailureSentence(forbidden, wordCode(english), GENERIC)).toBe(
      'You can only change your own hours.',
    );
    expect(
      blockFailureSentence(
        refused(SchedulingErrorCode.RosterDeparted),
        wordCode(translate),
        GENERIC,
      ),
    ).toBe('Този бръснар е напуснал. Работното му време не се променя.');
  });

  it('falls back to the sheet’s own line for a code with no copy, and a call that named none', () => {
    expect(
      blockFailureSentence(
        refused('SCHEDULING_SOMETHING_UNWORDED'),
        wordCode(translate),
        GENERIC,
      ),
    ).toBe(GENERIC);
    expect(
      blockFailureSentence(
        PipelineError.bare(PipelineErrorCode.Unavailable),
        wordCode(translate),
        GENERIC,
      ),
    ).toBe(GENERIC);
  });

  it('keeps a failure no call made — a chair with no shop — on the generic line', () => {
    expect(
      blockFailureSentence(
        SchedulingError.blockChairWithoutHome(BarberId.of('ivan')),
        wordCode(translate),
        GENERIC,
      ),
    ).toBe(GENERIC);
  });
});
