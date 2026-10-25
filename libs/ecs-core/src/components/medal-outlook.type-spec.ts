/**
 * The medal outlook's dictionaries (one file each since pass D — the
 * decision-extraction pass §2.4), checked at compile time:
 *
 * 1. `Holds` — each dictionary's values are exactly its type, each value
 *    under one key only, and they are the listed SCREAMING literals;
 * 2. the pair lines — the field a system answers each tag under is
 *    `camelCase(Dictionary)` (Law 6), where a system struct carries it
 *    (`MedalCaption` is answered bare; `MedalCue`, `ScopeSection` and
 *    `SeasonTrackState` are the standing and season systems');
 * 3. no dictionary is `MedalState` widened: the ring's fourth form lives in
 *    its own dictionary (D-5).
 *
 * `tsc` failing IS the test; nothing here runs.
 */
import { LadderRung } from './ladder-rung.data';
import { MedalCaption } from './medal-caption.data';
import { MedalCue } from './medal-cue.data';
import { MedalDetailState } from './medal-detail-state.data';
import { MedalMeter } from './medal-meter.data';
import { MedalProgressCard } from './medal-progress-card.data';
import { MedalRingState } from './medal-ring-state.data';
import { ScopeSection } from './scope-section.data';
import { SeasonTrackState } from './season-track-state.data';
import type { MedalState } from './series-standing.data';
import type {
  MedalDetailReading,
  MedalLadderStep,
  MedalMeterReading,
  MedalProgressReading,
} from '@core/systems';

type Expect<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
/** Exact type equality (not mere mutual assignability). */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;
/** The keys of `D` whose value another key also has. */
type SharedValueKeys<D> = {
  [K in keyof D]: D[K] extends D[Exclude<keyof D, K>] ? K : never;
}[keyof D];
/** `D`'s values are exactly `T`, each value under one key only. */
type Holds<D, T> =
  Equals<D[keyof D], T> extends true ? IsNever<SharedValueKeys<D>> : false;
type Screaming<V extends string> = [V] extends [Uppercase<V>] ? true : false;

// (1) Holds — exact values, one key per value, the listed literals.
export type MedalOutlookDictionariesHold = [
  Expect<Holds<typeof MedalCaption, MedalCaption>>,
  Expect<
    Equals<
      MedalCaption,
      | 'WITH_THIS_VISIT'
      | 'NONE'
      | 'LANDS_ON'
      | 'NOT_YET'
      | 'TO_LEVEL'
      | 'ON_DAY'
      | 'COMPLETE'
    >
  >,
  Expect<Holds<typeof MedalRingState, MedalRingState>>,
  Expect<
    Equals<
      MedalRingState,
      'NOT_STARTED' | 'IN_PROGRESS' | 'EARNED' | 'COMPLETE'
    >
  >,
  Expect<Holds<typeof MedalMeter, MedalMeter>>,
  Expect<Equals<MedalMeter, 'PENDING' | 'FRACTION' | 'NONE'>>,
  Expect<Holds<typeof MedalDetailState, MedalDetailState>>,
  Expect<
    Equals<
      MedalDetailState,
      | 'RETIRED'
      | 'REPEATED'
      | 'SEASON_ENDED'
      | 'ONE_OFF_EARNED'
      | 'ONE_OFF_NOT_YET'
      | 'NOT_STARTED'
      | 'UNDER_WAY'
      | 'COMPLETE'
      | 'COMPLETE_SINCE'
      | 'LEVEL_SINCE'
    >
  >,
  Expect<Holds<typeof MedalProgressCard, MedalProgressCard>>,
  Expect<
    Equals<MedalProgressCard, 'ONE_OFF' | 'COMPLETE' | 'STOPPED' | 'TO_NEXT'>
  >,
  Expect<Holds<typeof LadderRung, LadderRung>>,
  Expect<Equals<LadderRung, 'PASSED' | 'NEXT' | 'LATER'>>,
  Expect<Holds<typeof MedalCue, MedalCue>>,
  Expect<Equals<MedalCue, 'WITH_THIS_VISIT' | 'NEW' | 'CLOSE'>>,
  Expect<Holds<typeof ScopeSection, ScopeSection>>,
  Expect<
    Equals<
      ScopeSection,
      'SERVICE_CATEGORY' | 'BARBERS' | 'SHOPS' | 'GENERAL' | 'WHOLE'
    >
  >,
  Expect<Holds<typeof SeasonTrackState, SeasonTrackState>>,
  Expect<
    Equals<SeasonTrackState, 'ENDED' | 'COMPLETE' | 'PENDING' | 'TO_NEXT'>
  >,
];

// (2) The pair lines — the field a system answers the tag under.
export type MedalOutlookFields = [
  Expect<Equals<MedalMeterReading['medalMeter'], MedalMeter>>, // badge.system.ts
  Expect<Equals<MedalDetailReading['medalDetailState'], MedalDetailState>>, // badge.system.ts
  Expect<Equals<MedalProgressReading['medalProgressCard'], MedalProgressCard>>, // badge.system.ts
  Expect<Equals<MedalLadderStep['ladderRung'], LadderRung>>, // badge.system.ts
];

// (3) Screaming, and the ring's fourth form kept out of `MedalState` (D-5).
export type MedalOutlookScream = [
  Expect<Screaming<MedalCaption>>,
  Expect<Screaming<MedalRingState>>,
  Expect<Screaming<MedalMeter>>,
  Expect<Screaming<MedalDetailState>>,
  Expect<Screaming<MedalProgressCard>>,
  Expect<Screaming<LadderRung>>,
  Expect<Screaming<MedalCue>>,
  Expect<Screaming<ScopeSection>>,
  Expect<Screaming<SeasonTrackState>>,
  Expect<Equals<Exclude<MedalRingState, MedalState>, 'COMPLETE'>>,
  Expect<IsNever<Exclude<MedalState, MedalRingState>>>,
];
