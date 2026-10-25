import { type Brand, Tag } from '@core/primitives';
import { CancellationReason } from './cancellation-reason.data';

/** The one separator of a reason set's stored text. */
const SET_SEPARATOR = '+';

/**
 * A party's cancellation reasons as ONE stored string — the root
 * `cancellationReason` of a cancelled appointment (flatten-spec §3.2, F-24):
 * the distinct {@link CancellationReason} codes of the party, sorted and
 * `+`-joined (`'CLIENT_UNWELL+STAFF_SHOP_CLOSURE'`), so the field stays one
 * groupable string while a party cancelled seat by seat can hold several.
 * A staff cancel of the whole party files its one code (`'STAFF_SHOP_CLOSURE'`).
 *
 * Built only through its companion — {@link CancellationReasonSet.of} joins,
 * {@link CancellationReasonSet.codes} splits — so no system ever joins or
 * splits the text itself. A domain-value brand (F-15): its cast lives here,
 * in its own file (split out of `seat-outcome.data.ts`, pass D, L-1).
 */
export type CancellationReasonSet = Brand<string, 'CancellationReasonSet'>;

export const CancellationReasonSet = {
  /**
   * The set of `reasons` — de-duplicated, sorted, `+`-joined, so one set
   * of codes is always stored as the same string.
   */
  of(reasons: readonly CancellationReason[]): CancellationReasonSet {
    const distinct: CancellationReason[] = [];
    for (let i = 0; i < reasons.length; i++) {
      const reason = reasons[i] as CancellationReason;
      if (!distinct.includes(reason)) distinct.push(reason);
    }
    distinct.sort();
    return distinct.join(SET_SEPARATOR) as CancellationReasonSet;
  },

  /** The codes the set holds, in stored order — text that is no code is skipped. */
  codes(set: CancellationReasonSet): readonly CancellationReason[] {
    const out: CancellationReason[] = [];
    if (set.length === 0) return out;
    const parts = set.split(SET_SEPARATOR);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as string;
      if (Tag.has(CancellationReason, part)) out.push(part);
    }
    return out;
  },
} as const;
