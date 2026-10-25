import type { LocalDate } from '@core/primitives';
import type { StreakPreview, StreakRule } from '@core/components';
import { StreakPreviewSystem } from '@core/systems';
import type { RhythmPreviewFacts } from '@core/pipelines';

/*
 * «КАКВО ЩЕ СЕ ПРОМЕНИ» (client-card revision 3 §2.6.4, §4.4).
 *
 * The preview is an ESTIMATE made in the browser: every client's visits of
 * the last year folded through the projector twice, once per rule. The
 * fold is `StreakPreviewSystem.estimate` (`@core/systems`, pure); the walk
 * that reads the facts, ONCE per visit to the page, is
 * `rhythm-preview.pipeline.ts` (`@core/pipelines`, Law 8.4), and what
 * counts as a visit fact is `StreakPreviewSystem.factsOfStats`. What stays
 * this file's: how long the preview waits after the last change, and the
 * fold over what the walk read.
 *
 * The rule card's sample run — one invented client under the draft,
 * through the same projector — is `StreakPreviewSystem.sampleRun`, which
 * the store calls itself with the shop's day-start reader, so the track on
 * the card is what the rule really does and never a drawing of it.
 *
 * The walk's names (`readRhythmPreviewFacts`, `rhythmPreviewSource`,
 * `streakFactsReader`, `RHYTHM_PREVIEW_*`) are re-exported here from their
 * one home — never a second copy of a rule. Whether the two rules can be
 * previewed from visit days at all is `StreakPreviewSystem.readsFacts`,
 * which the store calls itself.
 */

export {
  RHYTHM_PREVIEW_CAP,
  RHYTHM_PREVIEW_PAGES,
  RHYTHM_PREVIEW_PAGE_SIZE,
  type RhythmPreviewFacts,
  type RhythmPreviewSource,
  readRhythmPreviewFacts,
  rhythmPreviewSource,
  streakFactsReader,
} from '@core/pipelines';

/** The preview recomputes by itself this long after the last change. */
export const RHYTHM_PREVIEW_DELAY_MS = 600;

/** The fold: `StreakPreviewSystem.estimate` (`@core/systems`), over the facts the walk read. */
export function rhythmPreviewOf(input: {
  readonly inForce: StreakRule;
  readonly draft: StreakRule;
  readonly facts: RhythmPreviewFacts;
  /** The shop's today, read in its zone at the store's edge. */
  readonly today: LocalDate;
}): StreakPreview {
  return StreakPreviewSystem.estimate(
    input.inForce,
    input.draft,
    input.facts.clients,
    input.today,
  );
}
