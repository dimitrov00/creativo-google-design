import type { ReadAsClaims } from '@core/components';
import type { TimeZone } from '@core/primitives';
import { formatInstant } from '@creativo/ui/wall-clock';
import type { ReadAsBannerVm } from './read-as-banner.vm';
import type { ReadAsBannerWords } from './read-as.words';

export type ReadAsBannerInput = {
  /** The session's read-as claims, off its ID token; `null` on a plain session. */
  readonly readAs: ReadAsClaims | null;
  /** The target's display name off the Auth record; `null` when it has none. */
  readonly name: string | null;
  /** The shop's zone — the window's end is worded on the shop's clock. */
  readonly zone: TimeZone | null;
  readonly locale: string;
  readonly words: ReadAsBannerWords;
};

/**
 * THE READ-AS BANNER'S WORDS (OR-24, docs/designs/support-read-as.md): whose
 * eyes these are and until when, on the shop's clock. Decides nothing —
 * whether a read-as is on is the token's, and when it ends is `impExp`.
 */
export function readAsBannerVm(
  input: ReadAsBannerInput,
): ReadAsBannerVm | null {
  const readAs = input.readAs;
  if (readAs === null) return null;
  const name = input.name?.trim() ?? '';
  return {
    title: input.words.actingAs(name === '' ? input.words.someone : name),
    until:
      input.zone === null
        ? ''
        : input.words.until(
            formatInstant(
              readAs.readAsExpiresAtUtcMs,
              input.zone,
              input.locale,
              {
                hour: '2-digit',
                minute: '2-digit',
              },
            ),
          ),
    end: input.words.end,
    label: input.words.label,
  };
}
