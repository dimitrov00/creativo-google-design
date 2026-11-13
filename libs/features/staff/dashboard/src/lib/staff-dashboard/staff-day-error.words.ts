import { BookingStatus, Tag } from '@core/primitives';
import {
  BookingErrorCode,
  type PipelineError,
  type StaffBlockFailure,
} from '@core/errors';
import {
  bookingStatusWords,
  type TranslateCode,
  wordPipelineError,
  wordServerRefusal,
} from '@creativo/infrastructure/i18n';
import type { StaffTranslate } from './staff-day.vm';

/**
 * A refusal, as a sentence.
 *
 * The server's OWN code (`serverErrorCode`) is the one that knows why. It
 * is translated first, when the catalogue has a line for it, with a status
 * name in the shop's words rather than the graph's; a seat already
 * resolved has its own line, because "from resolved to cancelled" is the
 * graph talking. The surface's own "something went wrong"
 * (`BookingErrorCode.CallFailed`) is only the fallback.
 *
 * `wordCode` is the page's `translateCodedError` — a code, with its params,
 * the code itself when the catalogue has no line for it.
 */
export function refusalSentence(
  error: PipelineError,
  translate: StaffTranslate,
  wordCode: (code: string, params: Readonly<Record<string, unknown>>) => string,
): string {
  // THE TRANSITION'S TWO STATUSES, in the shop's words: the wire carries
  // the stored tags (`fromBookingStatus`, `toBookingStatus`), and the
  // sentence says them as the rows do — the shared words table, then the
  // catalogue's label for the word. A seat already resolved has its own
  // line, because "from resolved to cancelled" is the graph talking.
  const extra: Record<string, string> = {};
  if (error.serverErrorCode === BookingErrorCode.TransitionNotAllowed) {
    const fromRaw = error.serverParams['fromBookingStatus'];
    const from = Tag.has(BookingStatus, fromRaw) ? fromRaw : null;
    // A SEAT already resolved names no status it moves from.
    if (typeof fromRaw === 'string' && fromRaw.length > 0 && from === null) {
      return translate(`errors.${BookingErrorCode.TransitionSeatResolved}`);
    }
    const toRaw = error.serverParams['toBookingStatus'];
    const to = Tag.has(BookingStatus, toRaw) ? toRaw : null;
    for (const [side, status] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (status === null) continue;
      const word = bookingStatusWords[status];
      const key = 'appointments.status.' + word;
      const label = translate(key);
      extra[side] = label !== key ? label : word;
    }
  }
  // ONE LEVEL DEEPER FIRST (round 4, 2026-09-25): the refusal's own
  // reason (`field` — «one person, two chairs», a shared guest label — or
  // a carried seat's `refusal`) has copy of its own, so
  // `<serverErrorCode>.<reason>` is tried before `<serverErrorCode>`, then
  // the surface's own generic key. The client's rule
  // (`wordPipelineError`), reused: a staff save refused for seating one
  // person twice said only "invalid input".
  return wordPipelineError(error, wordCode, BookingErrorCode.CallFailed, extra);
}

/**
 * Why a block, a day's breaks or the hours did not save, as one line: the
 * server's own refusal when the catalogue has copy for it — «Можеш да
 * променяш само своето работно време.» for a barber touching a
 * colleague's days — else the surface's `generic` line. A failure no call
 * made (a chair with no shop to file at) is the generic line too.
 */
export function blockFailureSentence(
  failure: StaffBlockFailure,
  wordCode: TranslateCode,
  generic: string,
): string {
  return 'serverErrorCode' in failure
    ? (wordServerRefusal(failure, wordCode) ?? generic)
    : generic;
}
