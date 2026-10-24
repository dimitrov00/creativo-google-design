import { LocalDate, type TimeZone, type UtcEpochMs } from '@core/primitives';
import type { StreakRule, StreakState } from '@core/components';
import {
  type StreakFacts,
  type StreakPreview,
  StreakPreviewSystem,
  ZonedTimeSystem,
} from '@core/systems';
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
 * Beside it, the rule card's sample run: one invented client under the
 * draft, through the same projector (`StreakPreviewSystem.sampleRun`), so
 * the track on the card is what the rule really does and never a drawing
 * of it.
 *
 * The walk's names (`readRhythmPreviewFacts`, `rhythmPreviewSource`,
 * `streakFactsReader`, `RHYTHM_PREVIEW_*`) are re-exported here from their
 * one home, and `rhythmPreviewReadsFacts`, `sampleRhythmFacts` and
 * `sampleRhythmRun` are thin delegates of the system — never a second copy
 * of a rule.
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

/**
 * Whether the two rules can be previewed from visit days alone
 * (`StreakPreviewSystem.readsFacts`): a rule that counts by a list asks
 * what a visit HELD, which the statistics do not say.
 */
export function rhythmPreviewReadsFacts(
  inForce: StreakRule,
  draft: StreakRule,
): boolean {
  return StreakPreviewSystem.readsFacts(inForce, draft);
}

/** The fold: `StreakPreviewSystem.estimate` (`@core/systems`), over the facts the walk read. */
export function rhythmPreviewOf(input: {
  readonly inForce: StreakRule;
  readonly draft: StreakRule;
  readonly facts: RhythmPreviewFacts;
  /** The shop's today, as written: on a day that is no day nobody is judged. */
  readonly today: string;
}): StreakPreview {
  const today = LocalDate.parse(input.today);
  return StreakPreviewSystem.estimate(
    input.inForce,
    input.draft,
    input.facts.clients,
    today.ok ? today.value : null,
  );
}

// ── The rule card's sample run ─────────────────────────────────────────────

/** Each sample visit stamped with the first instant of its shop day on `zone` (the boundary's reader). */
const dayStartOn =
  (zone: TimeZone) =>
  (day: LocalDate): UtcEpochMs =>
    ZonedTimeSystem.startOfLocalDay(day, zone);

/**
 * One invented client's visits under a rule, ending yesterday
 * (`StreakPreviewSystem.sampleFacts`), each stamped with the first instant
 * of its shop day on `zone`. On a day that is no day, no visit.
 */
export function sampleRhythmFacts(
  rule: StreakRule,
  today: string,
  zone: TimeZone,
): StreakFacts {
  const day = LocalDate.parse(today);
  return day.ok
    ? StreakPreviewSystem.sampleFacts(rule, day.value, dayStartOn(zone))
    : StreakPreviewSystem.NO_FACTS;
}

/**
 * The sample client's rhythm under a rule (`StreakPreviewSystem.sampleRun`):
 * what the rule card's track draws. `null` under a rule that is off (it
 * judges nobody), and on a day that is no day.
 */
export function sampleRhythmRun(
  rule: StreakRule,
  today: string,
  zone: TimeZone,
): StreakState | null {
  const day = LocalDate.parse(today);
  return day.ok
    ? StreakPreviewSystem.sampleRun(rule, day.value, dayStartOn(zone))
    : null;
}
